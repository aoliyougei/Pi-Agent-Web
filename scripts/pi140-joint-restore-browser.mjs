import assert from 'node:assert/strict';
import{chromium}from'/tmp/web-browser/node_modules/playwright/index.mjs';
const {cwd,fixtures}=await(await fetch('http://127.0.0.1:8081/fixture')).json();
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
try{
 for(const name of (process.env.FRESH_ONLY ? [] : ['explicit','none'])){
  const context=await browser.newContext({locale:'en-US'});await context.addInitScript(({id,cwd})=>{localStorage.setItem('pi-web:session-cwd:default',JSON.stringify({[id]:cwd}));localStorage.setItem('pi-tool-preset','full');const Native=EventSource;window.__sources=[];window.EventSource=class extends Native{constructor(...args){super(...args);window.__sources.push(this);}};},{id:fixtures[name].id,cwd});
  const page=await context.newPage();const mutations=[];page.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/api/agent/')){let d;try{d=r.postDataJSON();}catch{}if(d?.type==='set_tools'||d?.toolNames!==undefined)mutations.push(d);}});
  await page.goto(`http://127.0.0.1:30141/?session=${fixtures[name].id}`);await page.getByText(`seed-${name}`,{exact:true}).first().waitFor({timeout:60000});
  // Bash commands are wrapper operations and do not require a model/Chat-only extensions.
  await page.locator('textarea').fill('!sleep 2; printf joint-reconnect');await page.locator('textarea').press('Enter');await page.waitForFunction(()=>window.__sources.length>0);
  const n=await page.evaluate(()=>{const n=window.__sources.length,s=window.__sources.at(-1);s.close();s.dispatchEvent(new Event('error'));return n;});
  await page.waitForFunction(n=>window.__sources.length>n,n,{timeout:15000});await page.waitForTimeout(3000);
  assert.deepEqual(mutations,[]);
  const state=await page.evaluate(async({id,cwd})=>{const r=await fetch(`/api/agent/${id}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'get_tools',cwd})});return(await r.json()).data;},{id:fixtures[name].id,cwd});const active=(Array.isArray(state)?state:state.tools).filter(t=>t.active);assert.deepEqual(active,[]);
  console.log('PASS browser reconnect with conflicting full preference preserves tools:',name);await context.close();
 }
 for(const preference of ['none','default']){
  const context=await browser.newContext({locale:'en-US'});await context.addInitScript(({id,cwd,preference})=>{localStorage.setItem('pi-web:session-cwd:default',JSON.stringify({[id]:cwd}));localStorage.setItem('pi-tool-preset',preference);},{id:fixtures.none.id,cwd,preference});const page=await context.newPage();const creations=[];
  page.on('request',r=>{if(r.url().endsWith('/api/agent/new')&&r.method()==='POST')creations.push(r.postDataJSON());});
  await page.goto(`http://127.0.0.1:30141/?session=${fixtures.none.id}`);await page.getByText('seed-none',{exact:true}).first().waitFor({timeout:60000});
  await page.getByRole('button',{name:'New',exact:true}).click();await page.getByRole('button',{name:'System',exact:true}).click();
  await page.waitForFunction(()=>document.body.innerText.includes('System prompt'));await page.waitForTimeout(1000);
  assert.equal(creations.length,1);assert.deepEqual(creations[0].toolNames,preference==='none'?[]:['read','bash','edit','write']);console.log('PASS fresh composer preference applied at creation:',preference);await context.close();
 }
}finally{await browser.close();}
