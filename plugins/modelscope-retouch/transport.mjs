import {open} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';

export const ENDPOINT = 'https://mcp.api-inference.modelscope.net/a4e36be807c842/mcp';
export const MAX_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

async function readImage(path) {
  if (typeof path !== 'string' || !isAbsolute(path)) throw Error('ABSOLUTE_IMAGE_PATH_REQUIRED');
  const file = await open(path, 'r');
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size < 4 || stat.size > MAX_IMAGE_BYTES) throw Error('IMAGE_SIZE_INVALID');
    const buffer = Buffer.alloc(MAX_IMAGE_BYTES + 1);
    let size = 0;
    while (size < buffer.length) {
      const {bytesRead} = await file.read(buffer, size, buffer.length - size, null);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size > MAX_IMAGE_BYTES) throw Error('IMAGE_TOO_LARGE');
    const data = buffer.subarray(0, size);
    const png = data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    const jpeg = data[0] === 255 && data[1] === 216 && data[2] === 255;
    const webp = data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP';
    if (!png && !jpeg && !webp) throw Error('UNSUPPORTED_IMAGE_FORMAT');
    return data.toString('base64');
  } finally { await file.close(); }
}

async function responseForId(response, id) {
  const reader = response.body?.getReader();
  if (!reader) throw Error('EMPTY_UPSTREAM_RESPONSE');
  const decoder = new TextDecoder();
  const isJson = response.headers.get('content-type')?.includes('application/json');
  let total = 0, buffer = '', event = [];
  const match = text => {
    const parsed = JSON.parse(text);
    const values = Array.isArray(parsed) ? parsed : [parsed];
    return values.find(item => item?.jsonrpc === '2.0' && item.id === id);
  };
  try {
    while (true) {
      const {value, done} = await reader.read();
      if (value) {
        total += value.byteLength;
        if (total > MAX_BYTES) throw Error('UPSTREAM_RESPONSE_TOO_LARGE');
        buffer += decoder.decode(value, {stream: true});
      }
      if (done) buffer += decoder.decode();
      if (isJson) {
        if (done) {
          const result = match(buffer);
          if (!result) throw Error('UPSTREAM_RESPONSE_ID_MISMATCH');
          return result;
        }
      } else {
        let newline;
        while ((newline = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newline).replace(/\r$/, '');
          buffer = buffer.slice(newline + 1);
          if (line.startsWith('data:')) event.push(line.slice(5).replace(/^ /, ''));
          else if (!line && event.length) {
            const result = match(event.join('\n'));
            event = [];
            if (result) return result;
          }
        }
        if (done) {
          if (buffer.startsWith('data:')) event.push(buffer.slice(5).replace(/^ /, ''));
          if (event.length) { const result = match(event.join('\n')); if (result) return result; }
          throw Error('UPSTREAM_RESPONSE_ID_MISMATCH');
        }
      }
      if (done) throw Error('UPSTREAM_RESPONSE_ID_MISMATCH');
    }
  } finally { await reader.cancel(); }
}

export function createAdapter({fetchFn = fetch, readImageFn = readImage, gapMs = 1500} = {}) {
  let protocolVersion, sessionId, nextRequestAt = 0;
  return async function forward(input) {
    if (!input || input.jsonrpc !== '2.0' || typeof input.method !== 'string') throw Error('INVALID_RPC');
    let request = input;
    if (request.method === 'tools/call' && request.params?.name === 'retouch_submit') {
      const args = request.params.arguments ?? {};
      if (Object.hasOwn(args, 'image_base64')) throw Error('USE_IMAGE_PATH');
      const {image_path, ...rest} = args;
      request = {...request, params: {...request.params,
        arguments: {...rest, image_base64: await readImageFn(image_path)}}};
    }
    const body = JSON.stringify(request);
    if (Buffer.byteLength(body) > MAX_BYTES) throw Error('REQUEST_TOO_LARGE');
    const headers = {'Content-Type': 'application/json', Accept: 'application/json, text/event-stream'};
    if (protocolVersion) headers['MCP-Protocol-Version'] = protocolVersion;
    if (sessionId) headers['Mcp-Session-Id'] = sessionId;
    if (nextRequestAt > Date.now()) await sleep(nextRequestAt - Date.now());
    nextRequestAt = Date.now() + gapMs;
    // Deliberately no Authorization, credential lookup, redirect, or automatic retry.
    const response = await fetchFn(ENDPOINT, {method: 'POST', headers, body,
      redirect: 'error', signal: AbortSignal.timeout(55000)});
    if (!response.ok) { await response.body?.cancel(); throw Error('UPSTREAM_HTTP_FAILED'); }
    if (!Object.hasOwn(request, 'id')) { await response.body?.cancel(); return null; }
    const result = await responseForId(response, request.id);
    if (request.method === 'initialize' && result.result) {
      protocolVersion = result.result.protocolVersion;
      sessionId = response.headers.get('mcp-session-id') ?? undefined;
    }
    if (request.method === 'tools/list' && result.result?.tools) {
      result.result.tools = result.result.tools.map(tool => {
        if (tool.name !== 'retouch_submit') return tool;
        const schema = tool.inputSchema ?? {};
        const {image_base64, ...properties} = schema.properties ?? {};
        return {...tool, description: `${tool.description ?? ''} Supply an absolute local image_path; the plugin uploads the original image bytes.`,
          inputSchema: {...schema, properties: {...properties,
            image_path: {type: 'string', description: 'Absolute local path to the user-approved PNG, JPEG, or WebP image (max 5 MiB).'}},
            required: [...new Set([...(schema.required ?? []).filter(name => name !== 'image_base64'), 'image_path'])]}};
      });
    }
    return result;
  };
}
