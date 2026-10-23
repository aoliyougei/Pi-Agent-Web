// Docker-only, all application HTTP requests go through the actual Web candidate.
import assert from 'node:assert/strict';
const base = 'http://127.0.0.1:30141', control = 'http://127.0.0.1:8081';
const fixture = await (await fetch(`${control}/fixture`)).json();
const { cwd, fixtures } = fixture;
const expect = async (response, status = 200) => { const data = await response.json(); assert.equal(response.status,status,JSON.stringify(data)); return data; };
const send = (path, body) => fetch(base+path, body === undefined ? {} : {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
const validate = () => send('/api/cwd/validate',{cwd}).then(expect);
const command = (id, body) => send(`/api/agent/${id}`,{...body,cwd}).then(expect);
const detail = id => send(`/api/sessions/${id}?cwd=${encodeURIComponent(cwd)}`).then(expect);
const pause = ms => new Promise(resolve=>setTimeout(resolve,ms));
async function idle(id) { for(let i=0;i<200;i++){ const state=(await command(id,{type:'get_state'})).data; if(!state.isPromptRunning && !state.isStreaming) return state; await pause(30); } throw Error('not idle'); }
async function stream(id, cursor) {
 const abort=new AbortController(); const response=await fetch(`${base}/api/agent/${id}/events?cwd=${encodeURIComponent(cwd)}${cursor?`&cursor=${encodeURIComponent(cursor)}`:''}`,{signal:abort.signal});
 assert.equal(response.status,200,await (response.status===200?Promise.resolve(''):response.text()));
 const reader=response.body.getReader(); let buffer=''; const queue=[];
 return { async next(type) { const timeout=setTimeout(()=>abort.abort(),20000); try { for(;;){ while(buffer.includes('\n\n')){const at=buffer.indexOf('\n\n'),frame=buffer.slice(0,at);buffer=buffer.slice(at+2);const data=frame.split('\n').find(line=>line.startsWith('data: '));if(data)queue.push({event:JSON.parse(data.slice(6)),id:frame.split('\n').find(line=>line.startsWith('id: '))?.slice(4)}); } const at=queue.findIndex(item=>item.event.type===type);if(at>=0)return queue.splice(at,1)[0];const chunk=await reader.read();if(chunk.done)throw Error('SSE ended');buffer+=new TextDecoder().decode(chunk.value,{stream:true});} }finally{clearTimeout(timeout);} },async close(){abort.abort();await reader.cancel().catch(()=>{});} };
}
const version=await expect(await send('/api/agent/version'));
assert.equal(version.piVersion,'1.4.0');assert.equal(version.protocolVersion,1);assert.equal(version.serverVersion,'0.3.0');assert.equal(version.piRevision,'4a080252f06caf63a525d7873c5d94d3c23887e0');
console.log('PASS actual authenticated version via Web:',JSON.stringify(version));
await validate();
// Cold details and tools, before any LIST.
for(const name of ['default','explicit','none']) {
 await detail(fixtures[name].id);
 const tools=(await command(fixtures[name].id,{type:'get_tools'})).data;
 const names=(Array.isArray(tools)?tools:tools.tools).filter(tool=>tool.active).map(tool=>tool.name);
 if(name==='none') assert.deepEqual(names,[]); else {assert.ok(names.includes('read'));assert.ok(names.includes('new_tool'));for(const excluded of ['removed_tool','inactive_tool','bash'])assert.equal(names.includes(excluded),false,`${name} ${excluded}`);}
 console.log('PASS cold tool restore',name,JSON.stringify(names));
}
const id=fixtures.default.id;
await command(id,{type:'set_auto_compaction',enabled:false});
const models=await expect(await send(`/api/models?cwd=${encodeURIComponent(cwd)}`)); assert.ok(JSON.stringify(models).includes('echo')); console.log('PASS model list',JSON.stringify(models.modelList?.filter(model=>model.provider==='phase2')));
await command(id,{type:'set_model',provider:'phase2',modelId:'echo'});
for(const level of ['medium','off','high']) {await command(id,{type:'set_thinking_level',level});assert.equal((await command(id,{type:'get_state'})).data.thinkingLevel,level);}
await command(id,{type:'set_thinking_level',level:'medium'});
const events=await stream(id);await events.next('connected');await command(id,{type:'prompt',message:'joint hello'});const done=await events.next('prompt_done');assert.ok(done.id);await idle(id);await events.close();assert.equal((await command(id,{type:'get_last_assistant_text'})).data.text,'echo:joint hello');
await command(id,{type:'set_session_name',name:'replay-one'});await command(id,{type:'set_session_name',name:'replay-two'});
const replay=await stream(id,done.id);assert.equal((await replay.next('session_info_changed')).event.name,'replay-one');assert.equal((await replay.next('session_info_changed')).event.name,'replay-two');await replay.close();
console.log('PASS model/thinking/prompt and ordered cursor replay');
// Static messages cross the real RPC detail projection, separate from execution refusal.
const costs=await detail(fixtures.costs.id);const assistants=costs.context.messages.filter(message=>message.role==='assistant');
for(const [index,flag] of [undefined,false,true].entries()) {assert.equal(assistants[index].usage.cost.total,0.125);assert.equal(assistants[index].usage.cost.totalFromProvider,flag);}
assert.equal(assistants.at(-1).content[0].argumentsError,'Invalid JSON: {"path":');console.log('PASS actual RPC detail cost flags and malformed diagnostic');
for(let i=0;i<3;i++){await command(id,{type:'prompt',message:`compact seed ${i}`});await idle(id);}
const compaction=await stream(id);await compaction.next('connected');await command(id,{type:'compact',customInstructions:'short'});await compaction.next('compaction_end');await compaction.close();assert.equal((await command(id,{type:'get_state'})).data.isCompacting,false);
await command(id,{type:'prompt',message:'after compact'});await idle(id);console.log('PASS manual compaction + completion event + continuation');
const snapshot=await (await fetch(`${control}/snapshot?name=default`)).json();assert.equal(snapshot.file,fixtures.default.file);assert.match(snapshot.content,/echo:after compact/);
await expect(await fetch(`${control}/restart`,{method:'POST'}));
const traceStart=(await (await fetch(`${control}/trace`)).json()).length;
await validate();const cold=await detail(id);assert.equal(cold.filePath,fixtures.default.file);
const resumed=await stream(id);await resumed.next('connected');await command(id,{type:'prompt',message:'joint after real restart'});await resumed.next('prompt_done');await idle(id);await resumed.close();
const after=await (await fetch(`${control}/snapshot?name=default`)).json();assert.equal(after.file,snapshot.file);assert.match(after.content,/echo:joint after real restart/);
const trace=await (await fetch(`${control}/trace`)).json();assert.equal(trace.slice(traceStart).some(item=>new URL(item.url,base).pathname==='/internal/v1/api/sessions'),false);assert.ok(trace.some(item=>item.cursor===done.id&&new URL(item.url,base).searchParams.get('cwd')===cwd));
assert.equal(trace.some(item=>item.type==='set_tools'),false);
console.log('PASS real RPC process restart, cold cwd/detail/SSE before LIST, same JSONL continuation, no implicit set_tools');
console.log('FIXTURE',JSON.stringify(fixture));
