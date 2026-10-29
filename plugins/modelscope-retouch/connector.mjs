#!/usr/bin/env node
// Local file adapter only. Inference and all successful MCP responses are remote.
import {createInterface} from 'node:readline';
import {createAdapter, MAX_BYTES} from './transport.mjs';

const forward = createAdapter();
for await (const line of createInterface({input: process.stdin, crlfDelay: Infinity})) {
  let request;
  try {
    if (Buffer.byteLength(line) > MAX_BYTES) throw Error('REQUEST_TOO_LARGE');
    request = JSON.parse(line);
    const response = await forward(request);
    if (response !== null) process.stdout.write(JSON.stringify(response) + '\n');
  } catch (error) {
    // Do not expose file contents, local file paths, upstream bodies, or images in diagnostics.
    const message = 'ModelScope retouch adapter failed';
    if (request && Object.hasOwn(request, 'id')) {
      process.stdout.write(JSON.stringify({jsonrpc: '2.0', id: request.id,
        error: {code: -32000, message}}) + '\n');
    } else process.stderr.write(message + '\n');
  }
}
