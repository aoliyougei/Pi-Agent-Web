// Real Chromium -> production Web -> pinned RPC. Model gating is fixture-only.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { chromium } from '/tmp/web-browser/node_modules/playwright/index.mjs';
const base='http://127.0.0.1:30141',control='http://127.0.0.1:8081';
const fixture=await(await fetch(`${control}/fixture`)).json(),{cwd,fixtures}=fixture;
const evidence={fixture,events:[]};
const controlCall=async(path)=>{const r=await fetch(control+path,{method:path==='/gate-state'||path==='/trace'?'GET':'POST'});assert.equal(r.status,200);return r.json();};
const api=async(path,body)=>{const r=await fetch(base+path,body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{});const d=await r.json();assert.equal(r.status,200,`${path} ${JSON.stringify(d)}`);return d;};
const command=(id,body)=>api(`/api/agent/${id}`,{...body,cwd});
const eventually=async(fn,label)=>{for(let i=0;i<200;i++){const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,50));}throw Error(`Timeout: ${label}`);};
const active=tools=>(Array.isArray(tools)?tools:tools.tools).filter(t=>t.active).map(t=>t.name).sort();
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
async function open(name,preference){
 const context=await browser.newContext({locale:'en-US'});
 await context.addInitScript(({id,cwd,preference})=>{
 localStorage.setItem('pi-web:session-cwd:default',JSON.stringify({[id]:cwd}));localStorage.setItem('pi-tool-preset',preference);
 const Native=EventSource;window.__sources=[];window.__events=[];
 window.EventSource=class extends Native{constructor(...args){super(...args);window.__sources.push(this);this.addEventListener('message',event=>{try{window.__events.push(JSON.parse(event.data));}catch{}});}};
 },{id:fixtures[name].id,cwd,preference});
 const page=await context.newPage();
 page.on('request',r=>{if(r.url().includes('/api/')){let data;try{data=r.postDataJSON();}catch{}evidence.events.push({at:Date.now(),scenario:name,method:r.method(),url:new URL(r.url()).pathname,type:data?.type,toolNames:data?.toolNames});}});
 page.on('pageerror',error=>evidence.events.push({at:Date.now(),scenario:name,pageError:error.message}));
 await page.goto(`${base}/?session=${fixtures[name].id}`);
 await page.getByText(`seed-${name}`,{exact:true}).first().waitFor({timeout:60000});return{context,page};
}
try{
 const version=await api('/api/agent/version');assert.equal(version.piVersion,'1.4.0');evidence.version=version;
 await api('/api/cwd/validate',{cwd});
 for(const name of ['explicit','none']){
  const id=fixtures[name].id,{page,context}=await open(name,name==='none'?'full':'none');
  const before=active((await command(id,{type:'get_tools'})).data);
  if(name==='explicit'){assert.ok(before.includes('read'));assert.ok(before.includes('new_tool'));}else assert.deepEqual(before,[]);
  await command(id,{type:'set_auto_compaction',enabled:false});
  await controlCall('/gate');
  await page.locator('textarea').fill(`remaining reconnect ${name}`);await page.locator('textarea').press('Enter');
  await eventually(async()=> (await controlCall('/gate-state')).waiting>0,'model request gated');
  await page.waitForFunction(()=>window.__sources.length>0);
  const n=await page.evaluate(()=>{const n=window.__sources.length,s=window.__sources.at(-1);s.close();s.dispatchEvent(new Event('error'));return n;});
  await page.waitForFunction(n=>window.__sources.length>n,n,{timeout:15000});
  await page.waitForFunction(()=>window.__events.filter(e=>e.type==='connected').length>=2);
  await controlCall('/release');
  await page.getByText(`echo:remaining reconnect ${name}`,{exact:true}).first().waitFor({timeout:30000});
  assert.deepEqual(active((await command(id,{type:'get_tools'})).data),before);
  assert.equal(evidence.events.some(e=>e.scenario===name&&e.type==='set_tools'),false);
  evidence.events.push({scenario:name,check:'active reconnect received reply and tools unchanged',tools:before});
  console.log('PASS active reconnect',name,JSON.stringify(before));await context.close();
 }
 for(const preference of ['none','default']){
  const {context,page}=await open('none',preference);
  const before=active((await command(fixtures.none.id,{type:'get_tools'})).data);assert.deepEqual(before,[]);
  await page.getByRole('button',{name:'New',exact:true}).click();
  // Real accessible label is System prompt, not its shorter visible text System.
  const creation=page.waitForRequest(r=>r.url().endsWith('/api/agent/new')&&r.method()==='POST');
  await page.getByRole('button',{name:'System prompt',exact:true}).click();
  const request=await creation;assert.deepEqual(request.postDataJSON().toolNames,preference==='none'?[]:['read','bash','edit','write']);
  const response=await request.response();assert.equal(response.status(),200);const created=await response.json();
  const actual=active((await command(created.sessionId,{type:'get_tools'})).data);
  if(preference==='none')assert.deepEqual(actual,[]);else for(const tool of ['read','bash','edit','write'])assert.ok(actual.includes(tool));
  assert.deepEqual(active((await command(fixtures.none.id,{type:'get_tools'})).data),before);
  evidence.events.push({check:'new composer preference',preference,id:created.sessionId,tools:actual});
  console.log('PASS browser new composer creation',preference,JSON.stringify(actual));await context.close();
 }
 // Explicit fixture is still nonempty. A real provider request is held until after refresh.
 const id=fixtures.explicit.id,{context,page}=await open('explicit','none');
 const toolsBefore=active((await command(id,{type:'get_tools'})).data);
 for(let i=0;i<3;i++){await command(id,{type:'prompt',message:`compaction warmup ${i}`});await eventually(async()=>!(await command(id,{type:'get_state'})).data.isPromptRunning,'warmup idle');}
 const snapshot=async()=> (await(await fetch(`${control}/snapshot?name=explicit`)).json());
 const count=content=>content.split('\n').filter(line=>{try{return JSON.parse(line).type==='compaction';}catch{return false;}}).length;
 const initial=await snapshot();const compactsBefore=count(initial.content);
 await controlCall('/gate');
 // Trigger from actual composer control so its existing SSE subscription is exercised.
 await page.getByRole('button',{name:'Compact context',exact:true}).click();
 await eventually(async()=> (await controlCall('/gate-state')).waiting>0,'compaction provider waiting');
 const state=(await command(id,{type:'get_state'})).data;assert.equal(state.isCompacting,true);
 evidence.events.push({check:'before refresh',isCompacting:state.isCompacting,gate:await controlCall('/gate-state')});
 await page.reload();
 await page.waitForFunction(()=>document.body.innerText.includes('seed-explicit')||document.body.innerText.includes('compaction warmup'));
 await page.getByRole('button',{name:'Stop compaction',exact:true}).waitFor({timeout:15000});
 assert.equal((await command(id,{type:'get_state'})).data.isCompacting,true);
 const startEvents=evidence.events.filter(e=>e.type==='compact').length;assert.equal(startEvents,1);
 await controlCall('/release');
 await eventually(async()=>!(await command(id,{type:'get_state'})).data.isCompacting,'compaction settled');
 await page.getByRole('button',{name:'Compact context',exact:true}).waitFor({timeout:30000});
 const end=await snapshot();assert.equal(count(end.content),compactsBefore+1);
 assert.deepEqual(active((await command(id,{type:'get_tools'})).data),toolsBefore);
 assert.equal(evidence.events.filter(e=>e.type==='compact').length,1);
 assert.equal(evidence.events.some(e=>e.type==='set_tools'),false);
 const observed=await page.evaluate(()=>window.__events.map(e=>e.type));
 evidence.events.push({check:'after compaction refresh',observed,compactionsBefore:compactsBefore,compactionsAfter:count(end.content)});
 assert.ok(observed.includes('compaction_end'),'completion event must reach refreshed browser');
 await page.locator('textarea').fill('after refreshed compaction');await page.locator('textarea').press('Enter');
 await page.getByText('echo:after refreshed compaction',{exact:true}).first().waitFor({timeout:30000});
 console.log('PASS refresh during confirmed gated compaction: state, completion event, one persisted record, continuation, no implicit mutation');
 await context.close();
}finally{
 await controlCall('/release').catch(()=>{});
 await writeFile('/tmp/pi140-remaining-evidence.json',JSON.stringify(evidence,null,2));
 await browser.close();
}
