// Run inside isolated Chromium peer against the locally built production Web candidate.
import assert from 'node:assert/strict';
import { chromium } from '/tmp/web-browser/node_modules/playwright/index.mjs';
const base='http://127.0.0.1:30141',control='http://127.0.0.1:8081';
const {cwd,fixtures}=await(await fetch(`${control}/fixture`)).json();
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
const mutations=[];
const command=async(page,id,body)=>page.evaluate(async({id,body,cwd})=>{const r=await fetch(`/api/agent/${id}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...body,cwd})});return {status:r.status,body:await r.json()};},{id,body,cwd});
try{
for(const name of (process.env.COST_ONLY ? ['costs'] : ['default','explicit','none','costs'])){
 const context=await browser.newContext({locale:'en-US'});
 await context.addInitScript(({cwd,id,name})=>{
 localStorage.setItem('pi-web:session-cwd:default',JSON.stringify({[id]:cwd}));
 localStorage.setItem('pi-tool-preset',name==='none'?'full':'none');
 // Force an actual passive SSE reconnect on demand without changing application source.
 const Native=window.EventSource;window.__jointSources=[];
 window.EventSource=class extends Native{constructor(...args){super(...args);window.__jointSources.push(this);}};
 },{cwd,id:fixtures[name].id,name});
 const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
 page.on('request',request=>{if(request.method()==='POST'&&request.url().includes('/api/agent/')){let data;try{data=request.postDataJSON();}catch{}if(data?.type==='set_tools'||data?.toolNames!==undefined)mutations.push({name,path:new URL(request.url()).pathname,data});}});
 await page.goto(`${base}/?session=${fixtures[name].id}`);
 await page.getByText(name==='costs'?'cost-true':name==='default'?'echo:joint after real restart':`seed-${name}`,{exact:true}).first().waitFor({timeout:60000});
 if(name==='costs'){
  await page.getByText('Process details · 2 messages',{exact:true}).click();
  const text=await page.locator('body').innerText();assert.ok(text.includes('Invalid JSON: {"path":'));assert.equal((text.match(/\$0\.1250/g)||[]).length,4);assert.ok(text.includes('$0.50'));assert.ok(!text.includes('$10.0000'));
 }else{
 const tools=await command(page,fixtures[name].id,{type:'get_tools'});assert.equal(tools.status,200);const all=Array.isArray(tools.body.data)?tools.body.data:tools.body.data.tools;
 const active=all.filter(tool=>tool.active).map(tool=>tool.name);assert.equal(active.includes('new_tool'),name!=='none');assert.equal(active.includes('removed_tool'),false);assert.equal(active.includes('inactive_tool'),false);
 }
 await page.reload();await page.getByText(name==='costs'?'cost-true':name==='default'?'echo:joint after real restart':`seed-${name}`,{exact:true}).first().waitFor({timeout:30000});
 assert.deepEqual(errors,[]);
 console.log('PASS Chromium cold + refresh restore, no default tool override:',name);
 if(name==='explicit'){
  // Explicit user action through the real composer Tools menu.
  await page.locator('button[title^="Change tool preset"]').click();
  await page.getByText('Chat only',{exact:true}).click();
  await page.waitForTimeout(800);
  const tools=await command(page,fixtures[name].id,{type:'get_tools'});const all=Array.isArray(tools.body.data)?tools.body.data:tools.body.data.tools;assert.deepEqual(all.filter(tool=>tool.active),[]);
  console.log('PASS explicit UI tool change sent set_tools and took effect');
 }
 if(name==='default'){
  await page.locator('textarea').fill('slow browser reconnect');
  await page.locator('textarea').press('Enter');
  // Reconnect an active source; application creates replacement after onerror.
  await page.waitForFunction(()=>window.__jointSources.length>0);
  const count=await page.evaluate(()=>{const count=window.__jointSources.length;const source=window.__jointSources.at(-1);source.close();source.dispatchEvent(new Event('error'));return count;});
  await page.waitForFunction(count=>window.__jointSources.length>count,count,{timeout:15000});
  await page.getByText('echo:slow browser reconnect',{exact:true}).first().waitFor({timeout:30000});
  console.log('PASS Chromium active SSE replacement + reconciled continuation');
 }
 await context.close();
}
if(!process.env.COST_ONLY){assert.equal(mutations.filter(item=>item.data.type==='set_tools').length,1,JSON.stringify(mutations));assert.equal(mutations[0].name,'explicit');assert.deepEqual(mutations[0].data.toolNames,[]);}
console.log('PASS captured browser requests: exactly one explicit set_tools; no passive override, fixtures displayed with server totals');
}finally{await browser.close();}
