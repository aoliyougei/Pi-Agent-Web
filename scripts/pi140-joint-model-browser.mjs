import assert from 'node:assert/strict';
import {chromium} from '/tmp/web-browser/node_modules/playwright/index.mjs';
const {cwd,fixtures}=await(await fetch('http://127.0.0.1:8081/fixture')).json();
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
try{
 const context=await browser.newContext({locale:'en-US'});await context.addInitScript(({cwd,id})=>localStorage.setItem('pi-web:session-cwd:default',JSON.stringify({[id]:cwd})),{cwd,id:fixtures.default.id});const page=await context.newPage();
 await page.goto(`http://127.0.0.1:30141/?session=${fixtures.default.id}`);await page.getByText('echo:auto compaction acceptance',{exact:true}).first().waitFor({timeout:60000});
 await page.getByRole('button',{name:'Change reasoning level',exact:true}).click();
 await page.getByText('off',{exact:true}).last().click();
 await page.waitForTimeout(500);
 const state=await page.evaluate(async({id,cwd})=>(await(await fetch(`/api/agent/${id}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'get_state',cwd})})).json()).data,{id:fixtures.default.id,cwd});assert.equal(state.thinkingLevel,'off');assert.deepEqual(state.model,{provider:'phase2',id:'echo'});
 await page.reload();await page.getByText('echo:auto compaction acceptance',{exact:true}).first().waitFor();assert.equal(await page.getByRole('button',{name:'Change reasoning level',exact:true}).innerText(),'off');console.log('PASS actual model display and explicit UI thinking off persisted after reload');
 await context.close();
}finally{await browser.close();}
