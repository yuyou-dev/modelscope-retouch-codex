import {randomUUID} from 'node:crypto';
import {createAdapter, ENDPOINT} from './transport.mjs';

const forward = createAdapter();
async function rpc(id, method, params) {
  const response = await forward({jsonrpc:'2.0',id,method,params});
  if (response.error || response.result?.isError) throw Error(JSON.stringify(response.error ?? response.result));
  return response.result;
}
await rpc(1,'initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'modelscope-retouch-check',version:'0.2.1'}});
await forward({jsonrpc:'2.0',method:'notifications/initialized'});
const list = await rpc(2,'tools/list',{});
const names = list.tools.map(tool=>tool.name);
for (const name of ['ping','retouch_submit','retouch_status','retouch_result']) {
  if (!names.includes(name)) throw Error(`MISSING_TOOL_${name}`);
}
const result = await rpc(3,'tools/call',{name:'ping',arguments:{run_id:`setup-${randomUUID()}`}});
console.log(JSON.stringify({endpoint:ENDPOINT,anonymous:true,tools:names,ping:result,image_submitted:false},null,2));
