import {mkdir, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {createAdapter} from './transport.mjs';
import {WHITE_RETOUCH_PROMPT} from './prompt.mjs';

const args = process.argv.slice(2);
const [mode, runId, outputDir, imagePath] = args;
const instruction = WHITE_RETOUCH_PROMPT;
if (!['submit','resume'].includes(mode) || !/^[A-Za-z0-9_-]{1,80}$/.test(runId ?? '') || !outputDir || (mode === 'submit' ? args.length !== 4 : args.length !== 3)) {
  throw Error('Usage: node client.mjs submit|resume RUN_ID OUTPUT_DIR [IMAGE_PATH]');
}
const output = resolve(outputDir);
await mkdir(output, {recursive:true});
const forward = createAdapter();
let id = 0;
async function rpc(method, params) {
  const response = await forward({jsonrpc:'2.0', id:++id, method, params});
  if (response.error) throw Error(JSON.stringify(response.error));
  if (response.result?.isError) throw Error(JSON.stringify(response.result));
  return response.result;
}
async function call(name, args) { return rpc('tools/call', {name, arguments:args}); }
function receipt(result) {
  if (result.structuredContent?.run_id) return result.structuredContent;
  for (const block of result.content ?? []) {
    if (block.type === 'text') { try { const value = JSON.parse(block.text); if (value.run_id) return value; } catch {} }
  }
  throw Error('MISSING_CLOUD_RECEIPT');
}
async function saveReceipt(value) {
  await writeFile(resolve(output, `${runId}.json`), JSON.stringify(value,null,2));
  console.log(JSON.stringify(value));
}
await rpc('initialize',{protocolVersion:'2024-11-05', capabilities:{},clientInfo:{name:'modelscope-retouch-plugin-client',version:'0.2.0'}});
await forward({jsonrpc:'2.0',method:'notifications/initialized'});
const list = await rpc('tools/list',{});
console.log(JSON.stringify({anonymous:true, tools:list.tools.map(tool=>tool.name)}));
let state;
if (mode === 'submit') {
  await writeFile(resolve(output, `${runId}.request.json`), JSON.stringify({run_id:runId,image_path:imagePath,instruction,backend_prefix:'精修图片中的饰品',client_version:'0.2.0'},null,2));
  state = receipt(await call('retouch_submit',{run_id:runId,image_path:imagePath,instruction}));
  await saveReceipt(state);
}
for (let attempt=0; attempt<90; attempt++) {
  if (!state || !['succeeded','failed','poll_timeout','submission_uncertain','interrupted'].includes(state.status)) {
    if (state) await sleep(8000);
    state = receipt(await call('retouch_status',{run_id:runId}));
    await saveReceipt(state);
  }
  if (state.status === 'succeeded') {
    const result = await call('retouch_result',{run_id:runId});
    const block = result.content?.find(item=>item.type === 'image');
    if (!block) throw Error('MISSING_IMAGE');
    const bytes = Buffer.from(block.data,'base64');
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (hash !== state.output_sha256) throw Error('OUTPUT_HASH_MISMATCH');
    const extension = {'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[block.mimeType];
    if (!extension) throw Error('INVALID_IMAGE_TYPE');
    const path = resolve(output, `${runId}.${extension}`);
    await writeFile(path,bytes);
    console.log(JSON.stringify({saved_image:path,sha256:hash,bytes:bytes.length}));
    process.exit(0);
  }
  if (['failed','poll_timeout','submission_uncertain','interrupted'].includes(state.status)) throw Error(`CLOUD_${state.status}`);
}
throw Error('CLIENT_POLL_TIMEOUT: resume with same run_id; do not resubmit');
