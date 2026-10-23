// Docker-only Chromium regression with HTTP fixtures: no RPC deletion or model calls.
import assert from 'node:assert/strict';
import{chromium}from'/tmp/web-browser/node_modules/playwright/index.mjs';
const base=process.env.WEB_TEST_URL??'http://127.0.0.1:30152';
const cwd='/tmp/recent-only',other='/tmp/other-project';
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
try{
 const context=await browser.newContext({locale:'en-US'});const page=await context.newPage();const mutations=[];
 await context.addInitScript(({cwd,other})=>{if(!sessionStorage.getItem('seeded')){localStorage.setItem('pi-web:local-workspaces-v1',JSON.stringify([cwd,other]));localStorage.setItem('pi-web:last-custom-cwd:default',cwd);sessionStorage.setItem('seeded','1');}},{cwd,other});
 const session={id:'local-only',cwd,projectRoot:cwd,projectKey:cwd,path:'/tmp/fixtures/local.jsonl',messageCount:1,firstMessage:'Preserved local session',created:'2026-10-23',modified:'2026-10-23'};
 await page.route('**/api/**',async route=>{
 const request=route.request(),url=new URL(request.url());if(request.method()==='DELETE')mutations.push(url.pathname);
 const json=body=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
 if(url.pathname==='/api/agent/version')return json({protocolVersion:1,serverVersion:'0.3.0',piVersion:'1.4.0',capabilities:['project-session-discovery']});
 if(url.pathname==='/api/agent-backends')return json({backends:[{id:'default',name:'Test',hasToken:true}]});
 if(url.pathname==='/api/cwd/validate'){const{cwd}=request.postDataJSON();return json({cwd,projectRoot:cwd,projectKey:cwd});}
 if(url.pathname==='/api/cwd/browse')return json({path:cwd,parent:'/tmp',entries:[],homeDir:'/home/node'});
 if(url.pathname==='/api/sessions')return json({sessions:url.searchParams.get('cwd')===cwd?[session]:[],runningSessionIds:[]});
 if(url.pathname==='/api/agent/running')return json({runningSessionIds:[]});
 if(url.pathname==='/api/home')return json({home:'/home/node'});
 if(url.pathname==='/api/models')return json({models:{},modelList:[],defaultModel:null});
 if(url.pathname.startsWith('/api/files/'))return json({entries:[]});
 return json({});
 });
 await page.goto(base);await page.waitForTimeout(800);
 const selector=page.locator('button').filter({hasText:/Select.*project|Select.*directory/i}).first();
 // Select the remembered project before exercising removal of the current directory.
 await selector.click();await page.locator(`button[title="${cwd}"]`).click();await page.getByText('Preserved local session',{exact:true}).waitFor();
 await page.getByRole('button',{name:cwd,exact:true}).click();
 await page.getByRole('button',{name:`Remove recent directory: ${cwd} (does not delete files or sessions)`,exact:true}).click();
 await page.waitForTimeout(400);
 assert.equal(await page.getByText('Preserved local session',{exact:true}).count(),0);
 let stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('pi-web:local-workspaces-v1')));assert.deepEqual(stored,[other]);
 assert.equal(await page.evaluate(()=>localStorage.getItem('pi-web:last-custom-cwd:default')),null);
 assert.equal(await page.locator(`button[title="${cwd}"]`).count(),0);
 await page.reload();await page.waitForTimeout(700);await selector.click();assert.equal(await page.locator(`button[title="${cwd}"]`).count(),0);assert.equal(await page.locator(`button[title="${other}"]`).count(),1);
 await page.getByRole('button',{name:`Remove recent directory: ${other} (does not delete files or sessions)`,exact:true}).click();
 assert.equal(await page.locator(`button[title="${other}"]`).count(),0);
 await page.getByText('Custom path',{exact:false}).click();await page.getByRole('dialog').waitFor();await page.locator('#directory-path').fill(cwd);await page.getByRole('button',{name:'Go',exact:true}).click();await page.getByRole('button',{name:'Select this folder',exact:true}).click();
 await page.getByText('Preserved local session',{exact:true}).waitFor();stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('pi-web:local-workspaces-v1')));assert.ok(stored.includes(cwd));assert.deepEqual(mutations,[]);
 console.log('PASS current directory forgotten, global/unselected recovery, refresh persistence, siblings retained, manual re-add discovers original session, no DELETE requests');await context.close();
}finally{await browser.close();}
