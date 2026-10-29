import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createAdapter, ENDPOINT, MAX_BYTES} from '../plugins/modelscope-retouch/transport.mjs';

const json = value => new Response(JSON.stringify(value), {headers: {'content-type': 'application/json'}});

test('anonymous adapter uploads exact local bytes and preserves remote receipt and image blocks', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'retouch-plugin-test-'));
  try {
    const path = join(directory, 'image.png');
    const bytes = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), Buffer.alloc(1200000, 7)]);
    await writeFile(path, bytes);
    const imageBlock = {type: 'image', mimeType: 'image/png', data: 'AQIDBA=='};
    const remote = {jsonrpc: '2.0', id: 3, result: {content: [imageBlock], isError: false}};
    const calls = [];
    const adapter = createAdapter({gapMs: 0, fetchFn: async (url, options) => {
      assert.equal(url, ENDPOINT);
      assert.equal(options.headers.Authorization, undefined);
      assert.equal(options.headers['X-MCP-Operator-Token'], undefined);
      const request = JSON.parse(options.body);
      calls.push(request);
      if (request.method === 'tools/call' && request.params.name === 'retouch_submit') {
        assert.equal(request.params.arguments.image_path, undefined);
        assert.deepEqual(Buffer.from(request.params.arguments.image_base64, 'base64'), bytes);
        assert.equal(request.params.arguments.run_id, 'example');
        return json({jsonrpc: '2.0', id: request.id, result: {content: [{type: 'text', text: '{"status":"queued"}'}]}});
      }
      return json(remote);
    }});
    await adapter({jsonrpc: '2.0', id: 2, method: 'tools/call', params: {name: 'retouch_submit', arguments: {run_id: 'example', image_path: path, instruction: 'preserve shape'}}});
    assert.deepEqual(await adapter({jsonrpc: '2.0', id: 3, method: 'tools/call', params: {name: 'retouch_result', arguments: {run_id: 'example'}}}), remote);
    assert.equal(calls.length, 2);
  } finally { await rm(directory, {recursive: true, force: true}); }
});

test('tools/list replaces only the upload field; other tools remain unchanged', async () => {
  const ping = {name: 'ping', inputSchema: {type: 'object', properties: {run_id: {type: 'string'}}}};
  const adapter = createAdapter({gapMs: 0, fetchFn: async () => json({jsonrpc: '2.0', id: 1, result: {tools: [ping, {name: 'retouch_submit', inputSchema: {type: 'object', additionalProperties: false, properties: {run_id: {type: 'string'}, image_base64: {type: 'string'}}, required: ['run_id', 'image_base64']}}]}})});
  const response = await adapter({jsonrpc: '2.0', id: 1, method: 'tools/list'});
  assert.deepEqual(response.result.tools[0], ping);
  const schema = response.result.tools[1].inputSchema;
  assert.equal(schema.properties.image_base64, undefined);
  assert.equal(schema.properties.image_path.type, 'string');
  assert.deepEqual(schema.required, ['run_id', 'image_path']);
  assert.equal(schema.additionalProperties, false);
});

test('SSE matches response ID, carries session/protocol headers, and emits nothing for notification', async () => {
  let number = 0;
  const adapter = createAdapter({gapMs: 0, fetchFn: async (url, options) => {
    number++;
    if (number === 1) return new Response('data: {"jsonrpc":"2.0","method":"notifications/message"}\n\ndata: {"jsonrpc":"2.0","id":99,"result":{}}\n\ndata: {"jsonrpc":"2.0",\ndata: "id":1,"result":{"protocolVersion":"2025-03-26","serverInfo":{"name":"remote"}}}\n\n', {headers: {'content-type': 'text/event-stream', 'mcp-session-id': 'remote-session'}});
    assert.equal(options.headers['Mcp-Session-Id'], 'remote-session');
    assert.equal(options.headers['MCP-Protocol-Version'], '2025-03-26');
    return new Response(null, {status: 202});
  }});
  const result = await adapter({jsonrpc: '2.0', id: 1, method: 'initialize', params: {}});
  assert.equal(result.result.serverInfo.name, 'remote');
  assert.equal(await adapter({jsonrpc: '2.0', method: 'notifications/initialized'}), null);
});

test('failed submission is never automatically replayed', async () => {
  let calls = 0;
  const adapter = createAdapter({gapMs: 0, readImageFn: async () => 'AQID', fetchFn: async () => { calls++; return new Response('rate limited', {status: 429}); }});
  await assert.rejects(adapter({jsonrpc: '2.0', id: 1, method: 'tools/call', params: {name: 'retouch_submit', arguments: {image_path: '/test.png'}}}));
  assert.equal(calls, 1);
});

test('oversized payload is rejected before network submission', async () => {
  let calls = 0;
  const adapter = createAdapter({gapMs: 0, readImageFn: async () => 'a'.repeat(MAX_BYTES), fetchFn: async () => { calls++; }});
  await assert.rejects(adapter({jsonrpc: '2.0', id: 1, method: 'tools/call', params: {name: 'retouch_submit', arguments: {image_path: '/test.png'}}}));
  assert.equal(calls, 0);
});
