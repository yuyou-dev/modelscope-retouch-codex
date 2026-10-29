// Bounded recovery for discovery and the explicitly read-only synthetic ping tool.
import {setTimeout as delay} from 'node:timers/promises';

const safeMethods = new Set(['initialize', 'notifications/initialized', 'tools/list',
  'resources/list', 'resources/templates/list', 'prompts/list', 'ping']);
const transientStatuses = new Set([408, 429, 502, 503, 504]);

export function createTransport({endpoint, token, fetchFn = fetch, sleep = delay,
  now = Date.now, gapMs = 1500, budgetMs = 28000, log = () => {}}) {
  let nextRequestAt = 0;
  return async function forward(request, protocolVersion) {
    const deadline = now() + budgetMs;
    const mayRetry = safeMethods.has(request.method)
      || (request.method === 'tools/call' && request.params?.name === 'ping');
    for (let attempt = 1; attempt <= 5; attempt++) {
      let stage = 'request', httpStatus, retryAfterMs = 0;
      try {
        const wait = Math.max(0, nextRequestAt - now());
        if (wait) await sleep(wait);
        const remaining = deadline - now();
        if (remaining <= 0) throw new DOMException('Request budget exhausted', 'TimeoutError');
        nextRequestAt = now() + gapMs;
        const headers = {Authorization: `Bearer ${token}`, 'X-MCP-Operator-Token': token, 'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream'};
        if (protocolVersion) headers['MCP-Protocol-Version'] = protocolVersion;
        const response = await fetchFn(endpoint, {method: 'POST', headers,
          body: JSON.stringify(request), redirect: 'error',
          signal: AbortSignal.timeout(Math.min(10000, remaining))});
        httpStatus = response.status;
        stage = 'http_status';
        if (!response.ok) {
          const retryAfter = response.headers.get('retry-after');
          if (retryAfter) retryAfterMs = /^\d+(\.\d+)?$/.test(retryAfter)
            ? Number(retryAfter) * 1000 : Math.max(0, Date.parse(retryAfter) - now()) || 0;
          await response.body?.cancel();
          throw new Error('HTTP rejection');
        }
        if (!Object.hasOwn(request, 'id')) {
          await response.body?.cancel();
          return null;
        }
        stage = 'content_type';
        if (!response.headers.get('content-type')?.includes('application/json')) throw Error('Content type');
        stage = 'parse_response';
        const result = await response.json();
        stage = 'validate_response';
        if (result.id !== request.id || result.jsonrpc !== '2.0') throw Error('Response mismatch');
        return result;
      } catch (error) {
        const diagnostic = {stage, method: request.method, httpStatus,
          errorType: error.name, networkCode: error.cause?.code, attempt};
        const transient = stage === 'request' || transientStatuses.has(httpStatus);
        const wait = Math.max(retryAfterMs, Math.min(8000, 1000 * 2 ** (attempt - 1)));
        const retry = mayRetry && transient && attempt < 5 && now() + wait < deadline;
        log({event: 'modelscope_mcp_transport_error', ...diagnostic, retry, retryAfterMs: wait});
        if (!retry) {
          const failure = new Error('ModelScope remote MCP transport failed');
          failure.diagnostic = diagnostic;
          throw failure;
        }
        await sleep(wait);
      }
    }
  };
}
