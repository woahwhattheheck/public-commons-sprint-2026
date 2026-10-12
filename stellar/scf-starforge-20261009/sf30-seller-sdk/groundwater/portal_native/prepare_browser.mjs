#!/usr/bin/env node
/** Exercise the actual ordinary-account portal before any model receiving. */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
const require=(v,m)=>{if(!v)throw new Error(m);};
const input=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
const output=path.resolve(input.output_directory);
await fs.mkdir(output,{recursive:true,mode:0o700});
const stable=v=>Array.isArray(v)?'['+v.map(stable).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}':JSON.stringify(v);
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const inputSha=sha(stable(input)+'\n');
async function publish(file,value){
 const raw=Buffer.from(stable(value)+'\n'),tmp=file+'.'+crypto.randomUUID()+'.tmp';
 const fd=await fs.open(tmp,'wx',0o600);try{await fd.writeFile(raw);await fd.sync();}finally{await fd.close();}
 try{await fs.link(tmp,file);}catch(e){if(e.code!=='EEXIST')throw e;require((await fs.readFile(file)).equals(raw),'Original preparation browser outcome changed.');}
 finally{await fs.unlink(tmp).catch(()=>{});}
 const dir=await fs.open(path.dirname(file),'r');try{await dir.sync();}finally{await dir.close();}
}
const previous=await fs.readFile(path.join(output,'browser-result.json'),'utf8').then(JSON.parse).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
if(previous){
 require(previous.input_sha256===inputSha,'The original preparation browser input changed.');
 process.stdout.write(JSON.stringify({state:'complete',historical_replay:true,native_model_runs_started:0})+'\n');
}else{
 const credentials=JSON.parse(await fs.readFile(input.credentials_file,'utf8'));
 const playwright=createRequire(path.join(input.playwright_directory,'package.json'))('playwright-core');
 const browser=await playwright.chromium.launch({executablePath:input.chromium_executable,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 let closePromise;
 const close=()=>closePromise??=browser.close();
 process.on('SIGINT',close);process.on('SIGTERM',close);
 const contexts=[],failures=[],observations={};
 try{
  const origin=new URL(input.base_url).origin;
  require(input.base_url===origin,'Use the selected local portal origin.');
  for(const role of ['operator','reader']){
   const context=await browser.newContext({viewport:{width:1380,height:960}});contexts.push(context);
   const page=await context.newPage();
   page.on('pageerror',e=>failures.push({kind:'script',message:e.message}));
   page.on('response',r=>{const u=new URL(r.url());if(u.origin===origin&&r.status()>=400)failures.push({kind:'resource',path:u.pathname,status:r.status()});});
   const login=await page.goto(origin+input.login_path,{waitUntil:'networkidle'});
   require(login?.ok(),'The actual Tethys login page is unavailable.');
   await page.locator('[name="username"]').fill(credentials.accounts[role].username);
   await page.locator('[name="password"]').fill(credentials.accounts[role].password);
   await Promise.all([page.waitForURL(u=>!u.pathname.endsWith('/accounts/login/')) ,page.locator('#login-submit').click()]);
   const response=await page.goto(origin+input.home_path,{waitUntil:'networkidle'});
   require(response?.ok(),'The actual native app launcher is unavailable.');
   const text=await page.locator('main').innerText();
   require(text.includes(credentials.accounts[role].username)&&text.includes('your private user workspace'),
           'The launcher does not show the actual private ordinary account.');
   require(text.includes('No original workspace has been opened'),'Portal preparation unexpectedly has a model workspace.');
   const permissions=await page.locator('details dl').evaluate(dl=>Object.fromEntries([...dl.querySelectorAll('dt')].map(dt=>[dt.textContent.trim(),dt.nextElementSibling.textContent.trim()==='Granted'])));
   require(stable(permissions)===stable(input.accounts[role].permissions),'Actual rendered permissions differ from native object permissions.');
   const forms=page.locator('form[action*="create-workspace"]');
   require(await forms.count()===(role==='operator'?1:0),'Native edit permission is not reflected in the original launcher.');
   const cookies=await context.cookies();
   const csrf=cookies.find(c=>c.name==='csrftoken')?.value;
   require(csrf,'The native portal did not establish its actual CSRF token.');
   if(role==='operator'){
    observations.create_url=await forms.first().getAttribute('action');
    observations.creation_id=await forms.first().locator('[name="creation_id"]').inputValue();
    const denied=await context.request.post(origin+observations.create_url,{form:{workspace:'not-created',creation_id:observations.creation_id},headers:{Origin:origin},maxRedirects:0});
    require(denied.status()===403,'The original creation endpoint did not require CSRF.');
   }else{
    const denied=await context.request.post(origin+observations.create_url,{form:{workspace:'not-created',creation_id:observations.creation_id},
       headers:{Origin:origin,'X-CSRFToken':csrf},maxRedirects:0});
    require(denied.status()===403,'The ordinary reader unexpectedly received workspace-creation permission.');
   }
   // Screenshots are local inspection aids; they are not part of the private saved artifact.
   await fs.mkdir(path.join(output,'screenshots'),{recursive:true,mode:0o700});
   await page.screenshot({path:path.join(output,'screenshots',role+'-launcher.png'),fullPage:true});
   observations[role]={id:input.accounts[role].id,username:credentials.accounts[role].username,
       is_staff:false,is_superuser:false,permissions,launcher_text_sha256:sha(text),
       csrf_required:role==='operator',creation_denied:role==='reader'};
  }
  const anonymous=await browser.newContext();contexts.push(anonymous);
  const denied=await anonymous.request.get(input.base_url+input.home_path,{maxRedirects:0});
  require(denied.status()===302&&new URL(denied.headers().location,input.base_url).pathname.endsWith('/accounts/login/'),
          'The native app launcher did not require an actual account.');
  require(failures.length===0,'The original portal returned an unresolved script or resource failure: '+JSON.stringify(failures));
  for(const context of contexts)await context.close();
  contexts.length=0;await close();
  const result={schema:'groundwater.tethys-preparation-browser-result.v1',state:'complete',
      operation_id:input.operation_id,input_sha256:inputSha,
      accounts:{operator:observations.operator,reader:observations.reader},anonymous_login_required:true,
      native_permission_routing:true,model_workspace_created:false,native_model_runs_started:0,
      all_owned_browser_contexts_closed:true,completed_at:new Date().toISOString()};
  await publish(path.join(output,'browser-result.json'),result);
  process.stdout.write(JSON.stringify({state:'complete',result_file:path.join(output,'browser-result.json'),native_model_runs_started:0})+'\n');
 }finally{
  for(const context of contexts)await context.close().catch(()=>{});
  await close().catch(()=>{});
  process.removeListener('SIGINT',close);process.removeListener('SIGTERM',close);
 }
}
