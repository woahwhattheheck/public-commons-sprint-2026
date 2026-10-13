// MIT. Receive the complete Installation-return workflow on the existing Page,
// typed client and MCP provider. The owning host keeps those borrowed lifetimes.
import {readFile,mkdir,open,rename,lstat,realpath} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join,resolve,isAbsolute,dirname} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {acquireStateLease} from '../../../scf-starforge-20261009/merchant-fleet-gateway/state-lease.mjs';
import {GRANT_TRANSFER_CHUNK_BYTES} from './agent-contracts.mjs';

const SCHEMA='stellar-forge.sf47-installation-return-page-receiving.v1';
const ROOT_SCHEMA='stellar-forge.sf47-installation-return-receiving.v1';
const EDITOR='sf47.installation-return-editor.v1';
const MAX=64*1024*1024;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const bytes=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const order=value=>Array.isArray(value)?value.map(order):plain(value)?
  Object.fromEntries(Object.keys(value).sort().map(key=>[key,order(value[key])])):value;
const same=(left,right)=>JSON.stringify(order(left))===JSON.stringify(order(right));
const need=(ok,message)=>{if(!ok)throw new Error(message);};
const observed=promise=>{promise.catch(()=>{});return promise;};
const safeName=value=>typeof value==='string'&&value!==''&&!value.startsWith('/')&&
  !value.includes('\\')&&!value.includes('\0')&&value.split('/').every(x=>x&&x!=='.'&&x!=='..');
async function optional(path){try{return await readFile(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function originalFile(path,maximum=MAX){
  const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const first=await fd.stat();need(first.isFile()&&first.size<=maximum,'Select a complete bounded original file.');
    const named=await lstat(path);need(!named.isSymbolicLink()&&named.dev===first.dev&&named.ino===first.ino,'The original file identity changed.');
    const raw=await fd.readFile(),last=await fd.stat();
    need(raw.length===first.size&&first.size===last.size&&first.mtimeMs===last.mtimeMs&&first.ctimeMs===last.ctimeMs,
      'The complete original file changed during its read.');return raw;
  }finally{await fd.close();}
}
async function privateDirectory(path){
  need(isAbsolute(path),'Use an absolute original private output directory.');
  await mkdir(path,{recursive:true,mode:0o700});
  const stat=await lstat(path);
  need(stat.isDirectory()&&!stat.isSymbolicLink()&&!(stat.mode&0o077)&&await realpath(path)===path&&
    (!process.getuid||stat.uid===process.getuid()),'Keep the complete receiving output private and owned.');
}
async function publish(path,raw,lease){
  lease.assertHeld();need(Buffer.isBuffer(raw)&&raw.length<=MAX,'Retain every complete artifact within its declared bound.');
  await mkdir(dirname(path),{recursive:true,mode:0o700});
  const previous=await optional(path);
  if(previous){need((await originalFile(path)).equals(raw),'The complete retained receiving artifact changed.');return;}
  const stage=path+'.'+randomUUID()+'.partial',fd=await open(stage,'wx',0o600);
  try{await fd.writeFile(raw);await fd.sync();}finally{await fd.close();}
  need((await originalFile(stage)).equals(raw),'The staged complete receiving file differs.');
  lease.assertHeld();await rename(stage,path);
  const parent=await open(dirname(path),'r');try{await parent.sync();}finally{await parent.close();}
}
function python(pythonExecutable,sourceRoot,program,args){
  return new Promise((resolveResult,reject)=>{
    const child=spawn(pythonExecutable,['-B','-c',program,...args],{
      env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',SF30_XML_NODE:process.execPath},stdio:['ignore','pipe','pipe']});
    const stdout=[],stderr=[];let total=0,failure=null,settled=false;
    const collect=target=>chunk=>{total+=chunk.length;if(total>MAX){failure=new Error('The complete native reader exceeded its output bound.');child.kill('SIGTERM');}else target.push(chunk);};
    child.stdout.on('data',collect(stdout));child.stderr.on('data',collect(stderr));
    child.once('error',error=>{failure=error;});
    child.once('close',(code,signal)=>{if(settled)return;settled=true;
      const result={code,signal,stdout:Buffer.concat(stdout),stderr:Buffer.concat(stderr)};
      if(failure)reject(Object.assign(failure,{result}));
      else if(code!==0)reject(Object.assign(new Error('The original native archive reader failed: '+result.stderr.toString('utf8').slice(-2000)),{result}));
      else resolveResult(result);
    });
  });
}
const VERIFY_CORE=[
  "import sys,json,pathlib,hashlib,zipfile",
  "root=pathlib.Path(sys.argv[1]);result_raw=(root/'result.json').read_bytes();result=json.loads(result_raw)",
  "assert hashlib.sha256(result_raw).hexdigest()==sys.argv[3]",
  "assert result['schema']=='stellar-forge.sf47-installation-return-receiving.v1' and result['state']=='COMPLETE' and result['operationId']==sys.argv[2]",
  "selected={}",
  "for row in result['files']:",
  " relative=pathlib.Path(row['path'])",
  " assert not relative.is_absolute() and '..' not in relative.parts and str(relative) not in selected and str(relative) not in ('result.json','complete-receiving.zip')",
  " path=root/relative;assert path.is_file() and not path.is_symlink();raw=path.read_bytes()",
  " assert len(raw)==row['bytes'] and hashlib.sha256(raw).hexdigest()==row['sha256'];selected[str(relative)]=raw",
  "selected['result.json']=result_raw",
  "path=root/'complete-receiving.zip';assert path.is_file() and not path.is_symlink();archive_raw=path.read_bytes()",
  "with zipfile.ZipFile(path) as archive:",
  " assert len(archive.infolist())==len(selected) and set(archive.namelist())==set(selected)",
  " for name,raw in selected.items():",
  "  assert archive.read(name)==raw",
  "print(json.dumps({'schema':'sf47.installation-return-core-archive-readback.v1','operationId':result['operationId'],'bytes':len(archive_raw),'sha256':hashlib.sha256(archive_raw).hexdigest(),'files':[{'path':name,'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()} for name,raw in sorted(selected.items())]}))"
].join('\n');
const VERIFY_EXPORT=['import sys,json,pathlib,hashlib',
   'root=pathlib.Path(sys.argv[1]);sys.path.insert(0,str(root/"stellar/scf_2026/sf47_budget_model/workspace"))',
   'from operations import Operations',
   'from operations_installation_returns import selection_from_files',
   'raw=pathlib.Path(sys.argv[2]).read_bytes();document,files=Operations._unpack(raw)',
   'selected=selection_from_files(document,files)',
   'expected=json.loads(pathlib.Path(sys.argv[3]).read_bytes())',
   'assert document["program"]["id"]==expected["caseId"]',
   'row=next(row for row in document["reviews"] if row["id"]==expected["review"]["id"])',
   'assert row==expected["review"]',
   'assert selected["sha256"]==row["sha256"]',
   'if "installation" in expected:',
   ' selected_edition=next(row for row in document["installations"] if row["id"]==expected["installation"]["id"] and row["revision"]==expected["installation"]["revision"])',
   ' assert selected_edition["sha256"]==expected["installation"]["sha256"]',
   'print(json.dumps({"schema":"sf47.installation-return-export-readback.v1","caseId":document["program"]["id"],"version":document["program"]["version"],"review":selected,"files":[{"path":name,"bytes":len(body),"sha256":hashlib.sha256(body).hexdigest()} for name,body in sorted(files.items())]}))'
  ].join('\n');
const BUILD_BUNDLE=['import sys,json,pathlib,hashlib,io,zipfile',
   'root=pathlib.Path(sys.argv[1]);selection=json.loads((root/"result.json").read_bytes())',
   'files={}',
   'for row in selection["files"]:',
   ' raw=(root/row["path"]).read_bytes();assert len(raw)==row["bytes"] and hashlib.sha256(raw).hexdigest()==row["sha256"];files[row["path"]]=raw',
   'files["result.json"]=(root/"result.json").read_bytes()',
   'out=io.BytesIO()',
   'with zipfile.ZipFile(out,"w",compression=zipfile.ZIP_DEFLATED) as archive:',
   ' for name,raw in sorted(files.items()):',
   '  info=zipfile.ZipInfo(name,(2026,10,12,0,0,0));info.external_attr=0o100600<<16;info.compress_type=zipfile.ZIP_DEFLATED;archive.writestr(info,raw)',
   'sys.stdout.buffer.write(out.getvalue())'
  ].join('\n');

/**
 * Requires the actual original Delivery operations Page, its already-open
 * GrantWorkspaceClient, and callTool(name,args) bound to the original
 * MerchantGrantWorkspaces.call. openOperations(page) reopens the owning
 * application's existing Delivery operations view after a normal Page reload.
 * The owner serializes this callback; this module additionally holds the
 * original Linux output lease and leaves all borrowed lifetimes open.
 */
export async function runInstallationReturnPageReceiving({
  page,client,callTool,workspace,openOperations,coreOutputDirectory,
  outputDirectory,sourceRoot,pythonExecutable,operationId,
}){
  need(page&&client&&typeof callTool==='function'&&typeof openOperations==='function',
    'Use the original Page, typed client, MCP provider and original view-opening callback.');
  need(typeof workspace==='string'&&/^[a-z0-9][a-z0-9_-]{0,63}$/.test(workspace)&&
    typeof operationId==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(operationId),
    'Select one original workspace alias and retained receiving operation.');
  for(const path of [coreOutputDirectory,outputDirectory,sourceRoot,pythonExecutable])
    need(isAbsolute(path),'Select the complete original absolute runtime and output paths.');
  coreOutputDirectory=resolve(coreOutputDirectory);outputDirectory=resolve(outputDirectory);sourceRoot=resolve(sourceRoot);
  need(outputDirectory!==coreOutputDirectory&&outputDirectory!==sourceRoot&&!outputDirectory.startsWith(sourceRoot+'/')&&
    !coreOutputDirectory.startsWith(outputDirectory+'/'),'Keep this receiving output separate from source and the complete original core.');
  await privateDirectory(outputDirectory);
  const lease=await acquireStateLease(outputDirectory);
  const beforeViewport=page.viewportSize();
  const errors=[],onError=error=>errors.push(String(error.stack||error));
  page.on('pageerror',onError);
  let state;
  try{
    const coreRaw=await originalFile(join(coreOutputDirectory,'result.json')),core=JSON.parse(coreRaw);
    const coreInputRaw=await originalFile(join(coreOutputDirectory,'input.json')),coreInput=JSON.parse(coreInputRaw);
    need(core.schema===ROOT_SCHEMA&&core.state==='COMPLETE'&&core.mode==='WALKTHROUGH'&&
      core.operationId===coreInput.operationId&&coreInput.sourceRoot===sourceRoot,
      'Receive the complete original model walkthrough with its exact current source root.');
    const instance=await client.inspect();
    need(instance.original?.selection?.workspaceDirectory===coreInput.workspaceDirectory&&
      instance.original.selection.sourceDirectory===join(sourceRoot,'stellar/scf_2026/sf47_budget_model/workspace'),
      'Borrow the same complete original source workspace and selected application.');
    const origin=new URL(instance.original.url).origin;
    need(new URL(page.url()).origin===origin,'Use the actual already-authorized original application Page.');
    const input={schema:SCHEMA+'.input',operationId,workspace,sourceRoot,pythonExecutable,
      coreOutputDirectory,coreOperationId:core.operationId,coreSha256:hash(coreRaw),
      coreInputSha256:hash(coreInputRaw),workspaceDirectory:coreInput.workspaceDirectory};
    await publish(join(outputDirectory,'input.json'),bytes(input),lease);
    const savedState=await optional(join(outputDirectory,'progress.json'));
    state=savedState?JSON.parse(savedState):{schema:SCHEMA+'.progress',operationId,inputSha256:hash(bytes(input)),files:{},phases:{},browserDrafts:{}};
    need(state.schema===SCHEMA+'.progress'&&state.operationId===operationId&&state.inputSha256===hash(bytes(input)),
      'Continue the same original complete Page receiving selection.');
    async function checkpoint(){
      const raw=bytes(state),target=join(outputDirectory,'progress.json'),stage=target+'.'+randomUUID()+'.partial';
      await publish(stage,raw,lease);lease.assertHeld();await rename(stage,target);
      const fd=await open(outputDirectory,'r');try{await fd.sync();}finally{await fd.close();}
    }
    async function file(name,make){
      need(safeName(name),'Retain a plain relative original artifact name.');
      const selected=state.files[name];
      if(selected){
        const raw=await originalFile(join(outputDirectory,name));
        need(raw.length===selected.bytes&&hash(raw)===selected.sha256,'The retained complete artifact changed.');return raw;
      }
      // A lost checkpoint can leave the original file already published.
      const old=await optional(join(outputDirectory,name)),raw=old||await make();
      await publish(join(outputDirectory,name),raw,lease);
      state.files[name]={path:name,bytes:raw.length,sha256:hash(raw)};
      await checkpoint();return raw;
    }
    async function jsonFile(name,make){return JSON.parse(await file(name,async()=>bytes(await make())));}
    async function complete(result){
      need(result.schema===SCHEMA&&result.state==='COMPLETE'&&result.operationId===operationId&&
        result.inputSha256===state.inputSha256,'The complete original Page receiving result changed.');
      for(const selected of [...result.files,...(result.localQa??[])]){
        need(safeName(selected.path),'The complete result has an invalid artifact name.');
        const raw=await originalFile(join(outputDirectory,selected.path));
        need(raw.length===selected.bytes&&hash(raw)===selected.sha256,'The selected complete output changed.');
      }
      let archive=await optional(join(outputDirectory,'complete-page-receiving.zip'));
      if(!archive){
        const built=await python(pythonExecutable,sourceRoot,BUILD_BUNDLE,[outputDirectory]);
        archive=built.stdout;await publish(join(outputDirectory,'complete-page-receiving.zip'),archive,lease);
      }
      // The native assembler verifies every input before returning the full ZIP.
      // A retained archive must reproduce the same deterministic member bytes.
      const verified=await python(pythonExecutable,sourceRoot,BUILD_BUNDLE,[outputDirectory]);
      need(verified.stdout.equals(archive),'The retained complete receiving ZIP changed.');
      return {...result,completeArtifact:{path:join(outputDirectory,'complete-page-receiving.zip'),bytes:archive.length,sha256:hash(archive)}};
    }
    const completeRaw=await optional(join(outputDirectory,'result.json'));
    if(completeRaw)return await complete(JSON.parse(completeRaw));
    const sourceObservation={schema:SCHEMA+'.source',selection:instance.original.selection,
      selectionSha256:instance.selectionSha256,nodeExecutable:process.execPath,pythonExecutable};
    await file('source-observations/'+instance.selectionSha256+'.json',async()=>bytes(sourceObservation));
    await file('core/result.json',async()=>coreRaw);await file('core/input.json',async()=>coreInputRaw);
    for(const selected of core.files){
      need(safeName(selected.path),'Use the original complete core artifact selection.');
      const raw=await originalFile(join(coreOutputDirectory,selected.path));
      need(raw.length===selected.bytes&&hash(raw)===selected.sha256,'An original core file changed.');
      const retained=await file('core/'+selected.path,async()=>raw);
      need(retained.equals(raw),'The retained complete core artifact differs from its selected original.');
    }
    const coreArchive=await file('core/complete-receiving.zip',()=>originalFile(join(coreOutputDirectory,'complete-receiving.zip')));
    const coreVerification=await python(pythonExecutable,sourceRoot,VERIFY_CORE,
      [join(outputDirectory,'core'),core.operationId,hash(coreRaw)]);
    const coreVerified=JSON.parse(coreVerification.stdout);
    need(coreVerified.bytes===coreArchive.length&&coreVerified.sha256===hash(coreArchive),
      'The complete original core archive differs from its fully verified retained members.');
    await file('core-archive-readback.json',async()=>coreVerification.stdout);
    await file('core-archive-readback.stderr',async()=>coreVerification.stderr);
    const report=JSON.parse(await originalFile(join(coreOutputDirectory,'receiving-report.json')));
    const selected=[
      {key:'receiver',caseId:core.receiverCaseId,review:report.returned,request:'receiving-report',result:'receiving-report'},
      {key:'owner',caseId:core.ownerCaseId,review:report.ownerStage,request:'owner-stage',result:'owner-stage'},
    ];
    for(const item of selected){
      const response=await client.read('review',{caseId:item.caseId,reviewId:item.review.id});
      need(response.status===200&&same(response.value,item.review),'The typed client reopened another original review.');
      await file('typed/'+item.key+'-review.json',async()=>response.bytes);
      const list=await client.read('installation-returns',{caseId:item.caseId});
      need(list.value.reviews.some(row=>row.id===item.review.id&&row.sha256===item.review.sha256),
        'The complete original review is absent from the typed list.');
      await file('typed/'+item.key+'-reviews.json',async()=>list.bytes);
      const originalBody=JSON.parse(await originalFile(join(coreOutputDirectory,'requests',item.request+'.json')));
      const originalResult=JSON.parse(await originalFile(join(coreOutputDirectory,'results',item.result+'.json')));
      const before=await client.read('case',{caseId:item.caseId});
      const replay=await client.command(item.caseId,originalBody);
      need(same(replay.value,originalResult),'The typed client changed the original native request result.');
      const after=await client.read('case',{caseId:item.caseId});
      need(before.value.program.version===after.value.program.version,'Original request replay appended another event.');
      await file('typed/'+item.key+'-replay.json',async()=>replay.bytes);
      await file('typed/'+item.key+'-case.json',async()=>after.bytes);
    }
    const current=await client.read('installation',{caseId:core.ownerCaseId,installationId:core.installationId,revision:core.revision});
    need(current.value.sha256===core.installationSha256&&current.value.preview.document.checks[2].state==='OPEN',
      'The original confirmed edition or deliberately unfinished changed check was lost.');
    await file('typed/confirmed-installation.json',async()=>current.bytes);
    async function fullSnapshot(name,tool,args){
      const selectedSnapshot=await jsonFile('mcp/'+name+'-snapshot.json',async()=>{
        const result=await callTool(tool,{workspace,...args});
        need(result.retention?.state==='COMPLETE'&&result.id&&result.file?.sha256,
          'The original MCP provider must retain its complete response before receiving.');return result;
      });
      const raw=await file('mcp/'+name+'.bin',async()=>{
        const blocks=[];let offset=0,readId;
        try{
          while(true){
            const part=await callTool('merchant_grant_file_read',{workspace,snapshotId:selectedSnapshot.id,
              expectedSha256:selectedSnapshot.file.sha256,offset,limit:GRANT_TRANSFER_CHUNK_BYTES,...(readId?{readId}:{})});
            need(part.offset===offset&&part.encoding==='base64','The original MCP read moved to another byte offset.');
            const data=Buffer.from(part.data,'base64');
            need(data.length===part.bytesRead&&data.length>0,'The original MCP byte page is incomplete.');
            if(readId)need(part.readId===readId,'The original MCP byte lease changed.');
            readId=part.readId;blocks.push(data);
            const end=offset+data.length;
            need(end<=selectedSnapshot.file.bytes&&(part.nextOffset===null?end===selectedSnapshot.file.bytes:part.nextOffset===end),
              'The original MCP byte page did not advance through the complete file.');
            if(part.nextOffset===null)break;offset=part.nextOffset;
          }
        }finally{
          if(readId)await callTool('merchant_grant_file_release',{workspace,snapshotId:selectedSnapshot.id,readId});
        }
        return Buffer.concat(blocks);
      });
      need(raw.length===selectedSnapshot.file.bytes&&hash(raw)===selectedSnapshot.file.sha256,
        'The complete original MCP file differs from its retained identity.');
      return raw;
    }
    for(const item of selected){
      const raw=await fullSnapshot(item.key+'-review','merchant_grant_review',{caseId:item.caseId,reviewId:item.review.id});
      need(same(JSON.parse(raw),item.review),'MCP changed the complete original receiving review.');
      const request=JSON.parse(await originalFile(join(coreOutputDirectory,'requests',item.request+'.json')));
      const tool=item.key==='receiver'?'merchant_grant_installation_return':'merchant_grant_installation_return_stage';
      const args={caseId:item.caseId,expectedVersion:request.expectedVersion,requestId:request.requestId,
        actor:request.actor,note:request.note,...request.data};
      const replay=await fullSnapshot(item.key+'-replay',tool,args);
      need(same(JSON.parse(replay),JSON.parse(await originalFile(join(coreOutputDirectory,'results',item.result+'.json')))),
        'MCP did not recover the exact original native request result.');
      const list=JSON.parse(await fullSnapshot(item.key+'-list','merchant_grant_installation_returns',{caseId:item.caseId}));
      need(list.reviews.some(row=>row.id===item.review.id&&row.sha256===item.review.sha256),'MCP omitted the saved full report.');
    }
    async function selectCase(caseId){
      await openOperations(page);
      const selector=page.locator('.operations select[name="caseSelect"]');await selector.waitFor({state:'visible'});
      await selector.selectOption(caseId);
      await page.waitForFunction(id=>{
        const root=document.querySelector('.operations'),select=root?.querySelector('select[name="caseSelect"]');
        return select?.value===id&&root?.getAttribute('aria-busy')==='false';
      },caseId);
      await page.locator('.operations [data-ops-tab="installation-returns"]').click();
      await page.locator('.installation-return-desk').waitFor({state:'visible'});
      await page.waitForFunction(()=>document.querySelector('.installation-return-desk')?.getAttribute('aria-busy')==='false');
    }
    async function screen(name){
      if(state.files[name])return file(name,()=>Promise.reject(new Error('Retained screenshot is unavailable.')));
      return file(name,()=>page.locator('.operations').screenshot({animations:'disabled'}));
    }
    // Restore only the original saved request in its own WALKTHROUGH case.
    // No browser UUID or replacement mutation is generated for this recovery.
    const browserPhases=[...selected.map(item=>({...item,action:item.key==='receiver'?'installation.return':'installation.return-stage'})),
      {key:'confirmed',caseId:core.ownerCaseId,review:report.ownerStage,request:'confirmed-edition',result:'confirmed-edition',action:'installation.save'}];
    for(const item of browserPhases){
      if(state.phases[item.key])continue;
      const originalBody=JSON.parse(await originalFile(join(coreOutputDirectory,'requests',item.request+'.json')));
      const originalResult=JSON.parse(await originalFile(join(coreOutputDirectory,'results',item.result+'.json')));
      need(originalBody.action===item.action,'Select the original saved action for browser recovery.');
      const key='sf47.installation-returns.'+item.caseId;
      const before=await client.read('case',{caseId:item.caseId});
      const previousDraft=await jsonFile('browser/'+item.key+'-previous-draft.json',async()=>({
        original:await page.evaluate(key=>sessionStorage.getItem(key),key),
      }));
      need(plain(previousDraft)&&Object.keys(previousDraft).length===1&&
        (previousDraft.original===null||typeof previousDraft.original==='string'),
        'The original saved browser draft companion changed.');
      const saved=previousDraft.original?JSON.parse(previousDraft.original):null;
      need(!saved?.pending||same(saved.pending.body,originalBody),
        'An existing different receiving request still owns this browser case. Continue it first.');
      const expectedSelection={schema:EDITOR,caseId:item.caseId,mode:'saved',selectedReview:item.review.id,
        receiver:saved?.receiver??null,owner:saved?.owner??null,stage:saved?.stage??null,
        rejected:saved?.rejected??[],previousDrafts:saved?.previousDrafts??[],
        pending:{caseId:item.caseId,body:originalBody},accepted:null,notice:'Continue the original retained receiving request.'};
      const retainedSelection=await jsonFile('browser/'+item.key+'-recovery-input.json',async()=>expectedSelection);
      need(same(retainedSelection,expectedSelection),
        'The retained original browser recovery input differs from its saved draft and native request.');
      if(state.browserDrafts[item.key])need(same(state.browserDrafts[item.key],retainedSelection),
        'The browser progress differs from its original complete recovery input.');
      else{state.browserDrafts[item.key]=retainedSelection;await checkpoint();}
      const currentDraft=await page.evaluate(key=>sessionStorage.getItem(key),key);
      const currentSaved=currentDraft?JSON.parse(currentDraft):null;
      need(!currentSaved?.pending||same(currentSaved.pending.body,originalBody),
        'A different original request now owns this browser case. Continue it before replacing its draft.');
      const currentDraftRaw=bytes({original:currentDraft});
      await file('browser/'+item.key+'-observed-drafts/'+hash(currentDraftRaw)+'.json',async()=>currentDraftRaw);
      await page.evaluate(({key,selection})=>sessionStorage.setItem(key,JSON.stringify(selection)),{key,selection:state.browserDrafts[item.key]});
      await page.reload({waitUntil:'domcontentloaded'});
      await selectCase(item.caseId);
      const waiting=observed(page.waitForResponse(response=>new URL(response.url()).pathname==='/api/operations/'+item.caseId+'/command'&&
        response.request().method()==='POST'&&response.request().postDataJSON()?.requestId===originalBody.requestId));
      await page.locator('.installation-return-desk [data-return-action="resume"]').click();
      const response=await waiting;
      need(response.ok()&&same(await response.json(),originalResult),'The original Page recovered another native result.');
      await page.waitForFunction(key=>{
        const value=JSON.parse(sessionStorage.getItem(key)||'null');
        return value&&!value.pending&&!value.accepted;
      },key);
      const after=await client.read('case',{caseId:item.caseId});
      need(after.value.program.version===before.value.program.version,'The Page recovery appended another native event.');
      await file('browser/'+item.key+'-response.json',()=>response.body());
      for(const width of [1360,390]){
        await page.setViewportSize({width,height:900});
        await screen('views/'+item.key+'-'+width+'.png');
      }
      state.phases[item.key]={action:item.action,requestId:originalBody.requestId,
        caseId:item.caseId,caseVersion:after.value.program.version};await checkpoint();
    }
    async function download(name,click){
      return file(name,async()=>{
        const waiting=observed(page.waitForEvent('download'));
        await click();const download=await waiting,stream=await download.createReadStream();
        need(stream,'The original browser download is unavailable.');const chunks=[];let count=0;
        for await(const part of stream){count+=part.length;need(count<=32*1024*1024,'Keep the complete original bounded download.');chunks.push(part);}
        const error=await download.failure();need(!error,'The original complete browser download failed: '+error);
        return Buffer.concat(chunks);
      });
    }
    async function inspectExport(name,expected){
      await file('exports/'+name+'-expected.json',async()=>bytes(expected));
      const read=await python(pythonExecutable,sourceRoot,VERIFY_EXPORT,
        [sourceRoot,join(outputDirectory,'exports',name+'.zip'),join(outputDirectory,'exports',name+'-expected.json')]);
      await file('exports/'+name+'-readback.json',async()=>read.stdout);
      await file('exports/'+name+'-readback.stderr',async()=>read.stderr);
    }
    for(const item of selected){
      await selectCase(item.caseId);
      await page.locator('.installation-return-desk [data-return-action="mode"][data-mode="saved"]').click();
      await page.locator('.installation-return-desk [data-return-action="open-review"][data-review="'+item.review.id+'"]').click();
      await page.waitForFunction(id=>document.querySelector('.installation-return-desk')?.textContent.includes(id),item.review.id);
      const review=await download('browser/'+item.key+'-review.json',()=>page.locator('.installation-return-desk [data-return-action="review-download"]').click());
      need(same(JSON.parse(review),item.review),'The browser full JSON changed the original receiving report.');
      await download('exports/'+item.key+'-browser.zip',()=>page.locator('.installation-return-desk [data-return-action="export"]').click());
      await inspectExport(item.key+'-browser',{caseId:item.caseId,review:item.review,...(item.key==='owner'?{installation:report.confirmed}:{})});
      await file('exports/'+item.key+'-typed.zip',async()=>{
        const value=await client.download('installation-return',{caseId:item.caseId,reviewId:item.review.id});
        need(value.status===200,'The original complete typed export failed.');return value.bytes;
      });
      await inspectExport(item.key+'-typed',{caseId:item.caseId,review:item.review,...(item.key==='owner'?{installation:report.confirmed}:{})});
      const mcp=await fullSnapshot(item.key+'-export','merchant_grant_export',
        {kind:'installation-return',caseId:item.caseId,reviewId:item.review.id});
      await file('exports/'+item.key+'-mcp.zip',async()=>mcp);
      await inspectExport(item.key+'-mcp',{caseId:item.caseId,review:item.review,...(item.key==='owner'?{installation:report.confirmed}:{})});
    }
    await page.reload({waitUntil:'domcontentloaded'});await selectCase(core.ownerCaseId);
    await page.locator('.installation-return-desk [data-return-action="mode"][data-mode="saved"]').click();
    await page.locator('.installation-return-desk [data-return-action="open-review"][data-review="'+core.ownerReviewId+'"]').click();
    await page.waitForFunction(id=>document.querySelector('.installation-return-desk')?.textContent.includes(id),core.ownerReviewId);
    const reopened=await client.read('installation',{caseId:core.ownerCaseId,installationId:core.installationId,revision:core.revision});
    need(reopened.value.sha256===core.installationSha256,'The original saved edition changed on Page reopen.');
    await file('browser/reopened-installation.json',async()=>reopened.bytes);
    need(errors.length===0,'The original Page reported JavaScript errors: '+errors.join('\n'));
    const result={schema:SCHEMA,state:'COMPLETE',operationId,inputSha256:state.inputSha256,
      coreOperationId:core.operationId,mode:core.mode,ownerCaseId:core.ownerCaseId,receiverCaseId:core.receiverCaseId,
      installationId:core.installationId,revision:core.revision,installationSha256:core.installationSha256,
      reviewedRequests:Object.values(state.phases),viewports:[1360,390],javascriptErrors:errors,
      checks:['Complete original model/CLI/cold receive artifacts verified.',
        'Typed HTTP and MCP reopen both full original receiving reports.',
        'Original typed/MCP/Page request replay preserves case versions and saved receipts.',
        'Desktop and mobile Page retain the original receiving, owner stage and saved Installation.',
        'Browser, typed HTTP and MCP return whole case ZIPs verified by the original Operations reader.',
        'Reloaded original Page retains the same saved Installation and owner review.'],
      files:Object.values(state.files).filter(row=>!row.path.startsWith('views/')).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0),
      localQa:Object.values(state.files).filter(row=>row.path.startsWith('views/')).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0)};
    await publish(join(outputDirectory,'result.json'),bytes(result),lease);
    return await complete(result);
  }catch(error){
    try{
      const failure={schema:SCHEMA+'.interrupted',operationId,inputSha256:state?.inputSha256??null,
        code:error.code??null,message:error.message,stack:error.stack??null,javascriptErrors:errors,
        nativeRead:error.result?{code:error.result.code,signal:error.result.signal,
          stdout:error.result.stdout?.toString('base64'),stderr:error.result.stderr?.toString('base64')}:null};
      const raw=bytes(failure);await publish(join(outputDirectory,'attempts','interrupted-'+hash(raw)+'.json'),raw,lease);
    }catch(retentionError){error.retentionError=retentionError.message;}
    throw error;
  }finally{
    page.off('pageerror',onError);
    try{if(beforeViewport&&!page.isClosed())await page.setViewportSize(beforeViewport);}finally{await lease.close();}
  }
}
