// Additional real Web/RPC acceptance, after pi140-joint-web and browser checks.
import assert from 'node:assert/strict';
const base='http://127.0.0.1:30141',control='http://127.0.0.1:8081';
const {cwd,fixtures}=await(await fetch(`${control}/fixture`)).json();
const json=async(path,body,status=200)=>{const response=await fetch(base+path,body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{});const data=await response.json();assert.equal(response.status,status,JSON.stringify(data));return data;};
const command=(id,body)=>json(`/api/agent/${id}`,{...body,cwd});
await json('/api/cwd/validate',{cwd});
const id=fixtures.default.id;
const idle=async()=>{for(let i=0;i<200;i++){const state=(await command(id,{type:'get_state'})).data;if(!state.isPromptRunning&&!state.isStreaming)return;await new Promise(r=>setTimeout(r,25));}throw Error('not idle');};
// The tiny echo model and default reserve intentionally force auto compaction.
const beforeAuto=await(await fetch(`${control}/snapshot?name=default`)).json();
const countCompactions=content=>content.split('\n').filter(line=>{try{return JSON.parse(line).type==='compaction';}catch{return false;}}).length;
await command(id,{type:'set_auto_compaction',enabled:true});
await command(id,{type:'prompt',message:'auto compaction acceptance'});await idle();
let snapshot=await(await fetch(`${control}/snapshot?name=default`)).json();assert.ok(countCompactions(snapshot.content)>countCompactions(beforeAuto.content));
assert.equal((await command(id,{type:'get_state'})).data.isCompacting,false);
console.log('PASS actual auto compaction persisted + idle state');
// Explicit tools must persist across true restart.
const explicit=fixtures.explicit.id;
let tools=(await command(explicit,{type:'get_tools'})).data;const active=tools=>(Array.isArray(tools)?tools:tools.tools).filter(t=>t.active).map(t=>t.name);
assert.deepEqual(active(tools),[]);
await fetch(`${control}/restart`,{method:'POST'});await json('/api/cwd/validate',{cwd});
assert.deepEqual(active((await command(explicit,{type:'get_tools'})).data),[]);
assert.deepEqual(active((await command(fixtures.none.id,{type:'get_tools'})).data),[]);
console.log('PASS explicit UI-selected Chat only and original Chat only survive process restart');
// Expired replay cursor must not silently become a fresh subscription.
const response=await fetch(`${base}/api/agent/${id}/events?cwd=${encodeURIComponent(cwd)}`);assert.equal(response.status,200);
const reader=response.body.getReader();let first='';for(let i=0;i<8&&!/^id: /m.test(first);i++){await command(id,{type:'set_session_name',name:`cursor-seed-${i}`});const chunk=await reader.read();first+=new TextDecoder().decode(chunk.value);}
const cursor=/^id: (.+)$/m.exec(first)?.[1];assert.ok(cursor);await reader.cancel();
for(let i=0;i<1005;i++)await command(id,{type:'set_session_name',name:`overflow-${i}`});
const upstream=await fetch(`${control}/internal/v1/api/agent/${id}/events?cwd=${encodeURIComponent(cwd)}`,{headers:{'last-event-id':cursor}});assert.equal(upstream.status,409);assert.equal((await upstream.json()).error.code,'resync_required');
const stale=await fetch(`${base}/api/agent/${id}/events?cwd=${encodeURIComponent(cwd)}&cursor=${encodeURIComponent(cursor)}`);assert.equal(stale.status,200);assert.match(await stale.text(),/"type":"resync_required"/);
console.log('PASS bounded replay overflow: RPC 409, existing Web EventSource control translation resync_required');
