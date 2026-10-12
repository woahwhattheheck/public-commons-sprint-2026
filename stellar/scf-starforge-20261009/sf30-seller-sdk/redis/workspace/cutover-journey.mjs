// MIT. Browser continuation inside the original physical Redis-to-Valkey operation.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {inflateRawSync} from 'node:zlib';
import {openRedisCutoverWorkspace} from './cutover-workspace.mjs';
import {startRedisCutoverServer} from './cutover-server.mjs';

const command=promisify(execFile),clone=value=>structuredClone(value);
const sha=value=>createHash('sha256').update(value).digest('hex');
const encode=value=>JSON.stringify(value,null,2)+'\n';
const timeout=180000;
async function ready(page,url){
  await page.goto(url);await page.locator('#cutover-main').waitFor();
  await page.waitForFunction(()=>document.querySelector('#cutover-control-state')?.dataset.owner==='true'&&
    !document.querySelector('#cutover-review')?.disabled);
}
async function reviewed(page,checks){
  await page.locator('[data-cutover-tab="contract"]').click();
  await page.locator('#cutover-review').click();
  await page.locator('#cutover-status').filter({hasText:'Complete paired source, examples, comparison rules and candidate stage reviewed.'}).waitFor();
  assert.equal(await page.locator('#cutover-review-products tbody tr').count(),checks);
}
async function completed(page,workspace,mode,afterAttempt=null){
  await page.waitForFunction(async({mode,afterAttempt})=>{
    const token=sessionStorage.getItem('redis-cutover-token:'+location.origin);
    const response=await fetch('/api/progress',{headers:{'x-workspace-token':token},cache:'no-store'});
    if(!response.ok)return false;const original=await response.json();
    return !original.attached&&original.progress?.mode===mode&&original.progress.state==='COMPLETED'&&
      original.progress.attemptId!==afterAttempt&&document.querySelector('#cutover-state')?.textContent==='COMPLETED'&&
      document.querySelector('#cutover-pending')?.hidden;
  },{mode,afterAttempt},{timeout});
  const result=await workspace.state();
  assert.equal(result.attached,null);assert.equal(result.progress?.state,'COMPLETED');
  assert.equal(result.progress.mode,mode);assert.equal(result.lastFailure,null);
  return result;
}
// Read this original writer's ZIP central directory and every complete member.
function archiveMembers(bytes){
  assert.equal(bytes.readUInt32LE(bytes.length-22),0x06054b50);
  const count=bytes.readUInt16LE(bytes.length-12),members=new Map();let at=bytes.readUInt32LE(bytes.length-6);
  for(let i=0;i<count;i++){
    assert.equal(bytes.readUInt32LE(at),0x02014b50);
    const method=bytes.readUInt16LE(at+10),compressed=bytes.readUInt32LE(at+20),logical=bytes.readUInt32LE(at+24);
    const nameSize=bytes.readUInt16LE(at+28),extra=bytes.readUInt16LE(at+30),comment=bytes.readUInt16LE(at+32);
    const name=bytes.subarray(at+46,at+46+nameSize).toString('utf8'),local=bytes.readUInt32LE(at+42);
    assert.equal(members.has(name),false);assert.equal(bytes.readUInt32LE(local),0x04034b50);
    const start=local+30+bytes.readUInt16LE(local+26)+bytes.readUInt16LE(local+28);
    const packed=bytes.subarray(start,start+compressed);
    const body=method===8?inflateRawSync(packed,{maxOutputLength:536870912}):packed;
    assert.ok([0,8].includes(method));assert.equal(body.length,logical);
    members.set(name,body);at+=46+nameSize+extra+comment;
  }
  const manifest=JSON.parse(members.get('manifest.json'));
  assert.equal(manifest.schema,'stellar-forge.redis-cutover-handover-manifest.v1');
  assert.equal(manifest.members.length,members.size-1);
  for(const member of manifest.members){
    const body=members.get(member.path);assert.ok(body,'Complete archive member '+member.path);
    assert.equal(body.length,member.bytes);assert.equal(sha(body),member.sha256);
  }
  for(const side of ['baseline','candidate']){
    const lines=members.get(side+'/native-previews.jsonl').toString('utf8').trim().split('\n').filter(Boolean);
    assert.ok(lines.length>=6);
    for(const line of lines){const original=JSON.parse(line);assert.equal(original.operation.status,'COMPLETED');
      assert.equal(original.operation.id,original.receivingPage.requestId);}
  }
  return {manifest,members};
}
export async function createRedisCutoverBrowserJourney({directory,environment=process.env}={}){
  const playwright=await import(process.env.SF30_PLAYWRIGHT_MODULE??'playwright');
  const chromium=playwright.chromium??playwright.default?.chromium;
  assert.equal(typeof chromium?.launch,'function','Use the original equipped Playwright Chromium.');
  const browser=await chromium.launch({headless:true,args:['--no-sandbox'],
    ...(process.env.SF30_CHROMIUM_EXECUTABLE?{executablePath:process.env.SF30_CHROMIUM_EXECUTABLE}:{})});
  const records=[],issues=[];let active=null;
  async function opened(input,action){
    const workspace=await openRedisCutoverWorkspace({directory:input.directory,input:input.input,environment});
    let server,context;
    try{
      server=await startRedisCutoverServer({workspace,port:0});
      context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
      const page=await context.newPage();page.on('pageerror',error=>issues.push(error.message));
      active={workspace,server,context};await ready(page,server.operatorUrl);
      return await action({workspace,server,context,page});
    }finally{
      await context?.close();if(server)await server.close();else await workspace.close();active=null;
    }
  }
  async function differences(page,state){
    const observed=[];
    for(const compared of state.result.comparisons){
      await page.locator('[data-cutover-tab="receiving"]').click();
      await page.locator('#cutover-result').getByRole('button',{name:compared.checkId,exact:true}).click();
      await page.locator('#cutover-difference-summary h3').filter({hasText:compared.checkId+' · '}).waitFor();
      const group=compared.mode==='ordered'?'changed':'removed';
      assert.equal(await page.locator('#cutover-difference-kind').inputValue(),group);
      const response=await page.evaluate(async({edition,checkId,kind})=>{
        const token=sessionStorage.getItem('redis-cutover-token:'+location.origin);
        const url='/api/difference?'+new URLSearchParams({edition,checkId,kind,limit:'100'});
        const response=await fetch(url,{headers:{'x-workspace-token':token}});return {status:response.status,value:await response.json()};
      },{edition:state.edition,checkId:compared.checkId,kind:group});
      assert.equal(response.status,200);assert.equal(response.value.sha256,compared.differenceSha256);
      assert.equal(response.value.metadata.matched,compared.matched);
      observed.push({checkId:compared.checkId,sha256:response.value.sha256,counts:response.value.counts});
    }
    return observed;
  }
  return {
    records,
    async receive({directory:pair,input,interrupt=false}){
      return opened({directory:pair,input},async({workspace,server,context,page:initialPage})=>{
        let page=initialPage,ownerReopen=null;
        await page.locator('#cutover-import').setInputFiles({name:'original-paired-input.json',mimeType:'application/json',buffer:Buffer.from(encode(input))});
        await page.locator('#cutover-status').filter({hasText:'Complete paired input imported.'}).waitFor();
        if(interrupt){
          const first=input.consistency.reference+'\nOriginal editing tab.';
          await page.locator('#cutover-consistency-reference').fill(first);
          await page.waitForFunction(()=>document.querySelector('#cutover-draft-state')?.textContent.startsWith('Complete local edits retained'));
          const viewing=await context.newPage();viewing.on('pageerror',error=>issues.push(error.message));
          await viewing.goto(server.operatorUrl);await viewing.locator('#cutover-main').waitFor();
          assert.equal(await viewing.locator('#cutover-control-state').getAttribute('data-owner'),'false');
          assert.equal(await viewing.locator('#cutover-save').isDisabled(),true);
          const current=input.consistency.reference+'\nLatest retained original edit.';
          await page.locator('#cutover-consistency-reference').fill(current);
          // Use the actual retained helper read to wait for this complete raw form.
          await page.waitForFunction(async expected=>{
            const {createDraftStore}=await import('/local-draft-store.mjs');
            const directory=document.querySelector('#cutover-directory').textContent;
            const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(directory+'\noriginal'));
            const id='redis-cutover:'+Array.from(new Uint8Array(bytes),value=>value.toString(16).padStart(2,'0')).join('');
            return (await createDraftStore(id).readDraft())?.raw?.['cutover-consistency-reference']===expected;
          },current);
          await page.close();page=viewing;
          await page.locator('#cutover-take-control').click();
          await page.waitForFunction(()=>document.querySelector('#cutover-control-state')?.dataset.owner==='true'&&
            !document.querySelector('#cutover-save')?.disabled);
          assert.equal(await page.locator('#cutover-consistency-reference').inputValue(),current);
          await page.locator('#cutover-consistency-reference').fill(input.consistency.reference);
          ownerReopen={sameOriginalStore:true,viewingTabReadOnly:true,completeLatestDraftRetained:true};
        }
        await page.locator('#cutover-save').click();
        await page.locator('#cutover-status').filter({hasText:'Complete draft saved.'}).waitFor();
        assert.deepEqual((await workspace.state()).input,input);
        await reviewed(page,input.comparisons.length);
        let interrupted=null,interception;
        if(interrupt){
          let finish,reject;interception=new Promise((resolve,fail)=>{finish=resolve;reject=fail;});
          await page.route('**/api/start',async route=>{
            try{
            const response=await route.fetch(),accepted=await response.json();
            assert.equal(response.status(),200);assert.equal(accepted.operationId,input.operationId);
            const current=await workspace.state();let paused=false;
            if(current.attached){await workspace.pause();await workspace.wait();paused=true;}
            interrupted={operationId:accepted.operationId,inputSha256:accepted.inputSha256,
              retainedNativePause:paused,acceptedBeforeLostResponse:true};
            await route.abort('connectionreset');finish();
            }catch(error){reject(error);await route.abort().catch(()=>{});}
          });
        }
        await page.locator('[data-cutover-tab="receiving"]').click();
        await page.locator('#cutover-receive').click();
        if(interrupt){
          await interception;await page.unroute('**/api/start');
          await page.waitForFunction(async()=>{
            if(!document.querySelector('#cutover-pending')?.hidden&&!document.querySelector('#cutover-pending-continue')?.disabled)return true;
            const token=sessionStorage.getItem('redis-cutover-token:'+location.origin);
            const response=await fetch('/api/progress',{headers:{'x-workspace-token':token},cache:'no-store'});
            if(!response.ok)return false;const original=await response.json();
            return !original.attached&&original.progress?.mode==='receive'&&original.progress.state==='COMPLETED';
          });
          await page.reload();await page.locator('#cutover-main').waitFor();
          await page.waitForFunction(()=>document.querySelector('#cutover-control-state')?.dataset.owner==='true'&&
            (document.querySelector('#cutover-pending')?.hidden||!document.querySelector('#cutover-pending-continue')?.disabled));
          if(await page.locator('#cutover-pending').isVisible())await page.locator('#cutover-pending-continue').click();
        }
        const received=await completed(page,workspace,'receive');
        assert.equal(received.operationId,input.operationId);assert.deepEqual(received.input,input);
        const observed=await differences(page,received);
        assert.deepEqual(issues,[]);
        records.push({stage:'browser-receive',directory:pair,operationId:input.operationId,status:received.result.status,
          inputSha256:received.inputSha256,resultSha256:received.resultSha256,ownerReopen,interrupted,differences:observed});
        return received.result;
      });
    },
    async cold({directory:pair,input,createEdition=false}){
      return opened({directory:pair,input},async({workspace,server,context,page})=>{
        const before=await workspace.state();
        await reviewed(page,input.comparisons.length);
        await page.locator('[data-cutover-tab="receiving"]').click();await page.locator('#cutover-compare').click();
        const compared=await completed(page,workspace,'compare',before.progress?.attemptId??null);
        assert.equal(compared.operationId,before.operationId);assert.deepEqual(compared.result,before.result);
        await differences(page,compared);
        for(const side of ['baseline','candidate']){
          await page.locator('[data-cutover-tab="receiving"]').click();
          await page.locator('#cutover-open-'+side).click();
          const original=await page.locator('#cutover-'+side+'-link a').getAttribute('href');
          assert.ok(original);
          const editor=await context.newPage();await editor.goto(original);
          await editor.locator('#status').filter({hasText:'Workspace ready.'}).waitFor();
          assert.equal(await editor.locator('#query-list button').count(),input.comparisons.length);
          await editor.close();
        }
        await page.locator('#cutover-close-editors').click();
        await page.locator('#cutover-status').filter({hasText:'Original authoring owners closed.'}).waitFor();
        await page.locator('[data-cutover-tab="handover"]').click();await page.locator('#cutover-handover').click();
        await page.waitForFunction(()=>!document.querySelector('#cutover-download-handover')?.disabled&&
          document.querySelector('#cutover-pending')?.hidden,{}, {timeout});
        const handover=(await workspace.state()).handover;assert.equal(handover.state,'READY');
        const event=page.waitForEvent('download');await page.locator('#cutover-download-handover').click();
        const download=await event,path=join(pair,'browser-'+handover.file.name);await download.saveAs(path);
        const bytes=await readFile(path);assert.equal(bytes.length,handover.file.bytes);assert.equal(sha(bytes),handover.file.sha256);
        const complete=archiveMembers(bytes);assert.equal(complete.manifest.operationId,input.operationId);
        assert.deepEqual(JSON.parse(complete.members.get('cutover-input.json')),input);
        assert.deepEqual(JSON.parse(complete.members.get('result.json')),compared.result);
        for(const side of ['baseline','candidate'])for(const original of compared.result.packages[side]?.customerFiles??[]){
          const body=complete.members.get(side+'/customer/'+original.path);assert.ok(body);
          assert.equal(body.length,original.bytes);assert.equal(sha(body),original.sha256);
        }
        // CLI operates the same original pair and reuses this exact completed file.
        const cli=await command(process.execPath,[fileURLToPath(new URL('./cutover-operator-cli.mjs',import.meta.url)),
          'export','--directory',pair,'--kind','handover','--output',path],{env:environment,maxBuffer:8388608});
        const exported=JSON.parse(cli.stdout);assert.equal(exported.reused,true);assert.equal(exported.sha256,sha(bytes));
        let child=null;
        if(createEdition){
          await page.locator('#cutover-new').click();
          const operationId='native-cutover-following-edition';
          await page.locator('#cutover-new-operation').fill(operationId);
          await page.locator('#cutover-new-note').fill('Keep the completed physical cutover while editing the following approved source edition.');
          await page.locator('#cutover-new-submit').click();
          await page.locator('#cutover-edition-label').filter({hasText:'Receiving edition '+operationId}).waitFor();
          const creation=await workspace.state({edition:operationId});assert.equal(creation.creation.state,'COMPLETED');
          await page.locator('[data-cutover-tab="contract"]').click();
          const reference=creation.input.consistency.reference+'\nFollowing customer receiving window.';
          await page.locator('#cutover-consistency-reference').fill(reference);await page.locator('#cutover-save').click();
          await page.locator('#cutover-status').filter({hasText:'Complete draft saved.'}).waitFor();
          child=await workspace.state({edition:operationId});assert.equal(child.input.consistency.reference,reference);
          assert.equal(child.bound,false);assert.equal(child.origin.parentOperationId,input.operationId);
          const replay=await workspace.newEdition(creation.creation.arguments);
          assert.equal(replay.input.consistency.reference,reference);assert.equal(replay.draftSha256,child.draftSha256);
          await ready(page,server.operatorUrl);
          await page.locator('#cutover-editions .edition').filter({hasText:operationId}).click();
          await page.locator('#cutover-edition-label').filter({hasText:'Receiving edition '+operationId}).waitFor();
          assert.equal(await page.locator('#cutover-consistency-reference').inputValue(),reference);
          const original=await workspace.state();assert.deepEqual(original.result,compared.result);
          child={edition:operationId,origin:child.origin,creation:child.creation,draftSha256:child.draftSha256,received:false};
        }
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
        await page.screenshot({path:join(pair,'cutover-operator.png'),fullPage:true});
        assert.deepEqual(issues,[]);
        const result={stage:'browser-cold-reopen',directory:pair,operationId:input.operationId,resultSha256:compared.resultSha256,
          status:compared.result.status,originalEditors:2,handover:{...handover.file,path,members:complete.members.size},
          originalCli:exported,followingEdition:child};
        records.push(result);return result;
      });
    },
    async close(){
      if(active){await active.context?.close();if(active.server)await active.server.close();else await active.workspace.close();active=null;}
      await browser.close();
      await writeFile(join(directory,'native-cutover-browser.json'),encode({schema:'stellar-forge.redis-cutover-browser-journey.v1',
        records,browserErrors:issues}),{mode:0o600});
    },
  };
}
