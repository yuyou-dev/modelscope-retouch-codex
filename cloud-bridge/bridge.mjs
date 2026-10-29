#!/usr/bin/env node
// Credential-only transport bridge. ALL protocol/tool responses come from ModelScope.
import {createInterface} from 'node:readline';
import {createTransport} from './transport.mjs';

const endpoint = 'https://studio-yuyou80-codex-minimal-mcp.api-inference.modelscope.net/mcp';
let token = process.env.MODELSCOPE_TOKEN;
if (!token || /[\r\n]/.test(token)) {
  process.stderr.write('MODELSCOPE_CREDENTIAL_UNAVAILABLE\n');
  process.exit(1);
}

const lines = createInterface({input: process.stdin, crlfDelay: Infinity});
const forward = createTransport({endpoint, token,
  log: event => process.stderr.write(JSON.stringify(event) + '\n')});
let protocolVersion;
for await (const line of lines) {
  let request;
  try {
    if (line.length > 8 * 1024 * 1024) throw Error('request limit');
    request = JSON.parse(line);
    const result = await forward(request, protocolVersion);
    if (result === null) continue;
    if (request.method === 'initialize') protocolVersion = result.result?.protocolVersion;
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch (error) {
    const diagnostic = error.diagnostic ?? {stage: 'parse_request', errorType: error.name};
    if (request && Object.hasOwn(request, 'id')) {
      process.stdout.write(JSON.stringify({jsonrpc: '2.0', id: request.id,
        error: {code: -32000, message: 'ModelScope remote MCP transport failed', data: diagnostic}}) + '\n');
    } else process.stderr.write('MCP_FORWARD_FAILED\n');
  }
}
