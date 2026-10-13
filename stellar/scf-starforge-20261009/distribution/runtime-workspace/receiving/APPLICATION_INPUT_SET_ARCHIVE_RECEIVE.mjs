// MIT. The same companion-set receiving operation, browser and workspaces.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {openRuntimeWorkspace} from '../model.mjs';
import {inspectApplicationInputSetArchiveFile,receiveApplicationInputSetArchive,exportApplicationInputSetArchive} from '../application-input-set-archives.mjs';
import {applicationInputSetJSON} from '../public/application-input-set-format.mjs';
const check=(ok,message)=>{if(!ok)throw Error(message);},sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const command=promisify(execFile);
export async function receiveCompanionArchiveBrowser({browser,sourceURL,sourceModel,receivingURL,receivingModel,
 setId,manifest,outputDirectory,memberPath,selectionRequestId,applicationLabel,runtimeDirectory}){
 await mkdir(outputDirectory,{recursive:true,mode:0o700});
 const contexts=[],screenshots=[],errors=[];let cold=null;
 async function page(url){const context=await browser.newContext({viewport:{width:1360,height:950},acceptDownloads:true});contexts.push(context);
  const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(url);
  await p.locator('[data-view="applications"]').click();await p.locator('#application-input-sets').evaluate(n=>{n.open=true;});return p;}
 async function capture(p,name){for(const width of [1360,390]){await p.setViewportSize({width,height:width===390?844:950});
  check(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Companion archive controls overflow at '+width+'px.');
  const path=join(outputDirectory,name+'-'+width+'.png');await p.screenshot({path,fullPage:true});screenshots.push(path);
 }await p.setViewportSize({width:1360,height:950});}
 try{
  const source=await page(sourceURL),shelf=source.locator('#application-input-sets');
  const opened=source.waitForResponse(r=>r.url().includes('/api/application-input-sets/inspect?'));
  await shelf.getByRole('button',{name:'Open original source set',exact:true}).first().click();
  const response=await opened,actual=await response.json();check(response.ok()&&actual.setId===setId,'The browser opened another original source set.');
  const downloading=source.waitForEvent('download');await shelf.getByRole('button',{name:'Download complete source-set ZIP',exact:true}).click();
  const downloaded=await downloading,archive=join(outputDirectory,'complete-original-source.zip');await downloaded.saveAs(archive);
  check(!await downloaded.failure(),'The complete archive download failed.');
  const sourceBytes=await readFile(archive),review=await inspectApplicationInputSetArchiveFile({archive});
  check(review.setId===setId&&applicationInputSetJSON(review.manifest)===applicationInputSetJSON(manifest),'Downloaded original identity changed.');
  const extracted=join(outputDirectory,'ordinary-zip-receiving');
  const python='import sys,zipfile,pathlib,hashlib,json\nroot=pathlib.Path(sys.argv[2]);root.mkdir(mode=0o700)\nrows=[]\nwith zipfile.ZipFile(sys.argv[1]) as z:\n if z.testzip() is not None: raise RuntimeError("ZIP CRC failed")\n for info in z.infolist():\n  target=root.joinpath(*info.filename.split("/"))\n  if info.is_dir(): target.mkdir(mode=0o700,parents=True,exist_ok=True);continue\n  target.parent.mkdir(mode=0o700,parents=True,exist_ok=True)\n  data=z.read(info)\n  with target.open("xb") as out: out.write(data)\n  rows.append({"path":info.filename,"bytes":len(data),"sha256":hashlib.sha256(data).hexdigest()})\nprint(json.dumps(rows))\n';
  const ordinary=JSON.parse((await command(process.env.PYTHON??'python3',['-c',python,archive,extracted],{maxBuffer:8*1024*1024})).stdout);
  for(const file of manifest.files){const got=ordinary.find(x=>x.path==='originals/'+file.path);
   check(got?.bytes===file.bytes&&got.sha256===file.sha256,'Ordinary extraction changed: '+file.path);}
  await capture(source,'archive-source');
  const receiver=await page(receivingURL),receivingShelf=receiver.locator('#application-input-sets');
  const archiveInput=receivingShelf.getByLabel('Or receive a complete Runtime source-set ZIP',{exact:true});
  await archiveInput.setInputFiles(archive);
  await receivingShelf.getByRole('status').filter({hasText:'Complete ZIP verified'}).waitFor();
  await capture(receiver,'archive-reviewed');
  const damaged=Buffer.from(sourceBytes);damaged[0]^=1;const damagedPath=join(outputDirectory,'deliberately-damaged-copy.zip');
  await writeFile(damagedPath,damaged,{flag:'wx',mode:0o600});await archiveInput.setInputFiles(damagedPath);
  await receivingShelf.getByRole('status').filter({hasText:'disagree'}).waitFor();
  check(await receivingShelf.getByRole('button',{name:'Save complete source set',exact:true}).isEnabled(),'A refused archive lost the previous selection.');
  check(await receivingShelf.getByLabel('Source set name',{exact:true}).inputValue()===manifest.name,'A refused archive replaced the reviewed name.');
  await capture(receiver,'archive-refused-current-preserved');
  await archiveInput.setInputFiles(archive);await receivingShelf.getByRole('status').filter({hasText:'Complete ZIP verified'}).waitFor();
  const completed=receiver.waitForResponse(r=>r.url().endsWith('/api/application-input-sets/complete')&&r.request().method()==='POST');
  await receivingShelf.getByRole('button',{name:'Save complete source set',exact:true}).click();
  const receivedResponse=await completed,received=await receivedResponse.json();
  check(receivedResponse.ok()&&received.phase==='READY'&&received.setId===setId,'Browser did not receive the original set.');
  await receivingShelf.getByRole('status').filter({hasText:'Complete original source set saved'}).waitFor();
  const replay=await receiveApplicationInputSetArchive(receivingModel,{archive,expectedSetId:setId});
  check(replay.setId===setId&&replay.phase==='READY','CLI receiving did not reopen the same original set.');
  const attached=await receivingModel.attach({directory:runtimeDirectory,label:'Original companion archive runtime'});
  check(attached.status==='READY','The selected Runtime must remain ready.');
  const selection=await receivingModel.applicationInputSetPrepare({requestId:selectionRequestId,setId,
   kind:'grant-workspace',field:'scenarioFile',memberPath});
  check(!selection.error&&selection.phase==='PREPARED','The received source did not prepare its original working selection.');
  await receiver.reload();await receiver.locator('[data-view="applications"]').click();
  const existing=(await receivingModel.applicationsState({historyLimit:1})).applications.filter(x=>x.label===applicationLabel);
  check(existing.length<=1,'More than one Application uses the original receiving label.');
  let applicationId=existing[0]?.id;
  if(!applicationId){
   await receiver.locator('#application-label').fill(applicationLabel);
   await receiver.locator('#application-runtime').selectOption(attached.runtimeId);
   await receiver.locator('#application-kind').selectOption('grant-workspace');
   await receiver.locator('#application-setting-workspaceDirectory').fill(join(receivingModel.directory,'archive-grant-application'));
   const setting=receiver.locator('#application-setting-scenarioFile');
   await setting.locator('..').getByRole('button',{name:'Use saved file',exact:true}).click();
   const copy=receiver.locator('#application-input-sets article').filter({hasText:selection.path});
   await copy.getByRole('button',{name:'Use current working set',exact:true}).click();
   check(await setting.inputValue()===selection.path,'The actual form selected another working path.');
   await receiver.getByRole('button',{name:'Review application',exact:true}).click();
   const saved=receiver.waitForResponse(r=>r.url().endsWith('/api/applications/save')&&r.request().method()==='POST');
   await receiver.getByRole('button',{name:'Save application',exact:true}).click();
   const saveResponse=await saved,value=await saveResponse.json();
   check(saveResponse.ok()&&value.saved,'Original provider review/save did not accept the received source.');applicationId=value.applicationId;
  }
  const saved=(await receivingModel.applicationsState({historyLimit:1})).applications.find(x=>x.id===applicationId);
  check(saved?.settings.scenarioFile===selection.path&&saved.kind==='grant-workspace','Saved Application differs from the receiving selection.');
  await receiver.locator('#application-input-sets').evaluate(n=>{n.open=true;});await capture(receiver,'archive-received-application');
  cold=await openRuntimeWorkspace({directory:receivingModel.directory});
  const reopened=await cold.applicationInputSetInspect({setId}),reopenedSelection=await cold.applicationInputSetSelection({requestId:selectionRequestId});
  check(reopened.phase==='READY'&&applicationInputSetJSON(reopened.manifest)===applicationInputSetJSON(manifest),'Cold reopen changed the manifest.');
  for(const file of manifest.files){const current=reopenedSelection.current.find(x=>x.path===file.path);
   check(current?.bytes===file.bytes&&current.sha256===file.sha256,'Cold reopen changed a working member: '+file.path);}
  const reexport=await exportApplicationInputSetArchive(cold,{setId,output:join(outputDirectory,'received-source-reexport.zip')});
  const reexported=await inspectApplicationInputSetArchiveFile({archive:reexport.path});
  check(reexported.setId===setId&&applicationInputSetJSON(reexported.manifest)===applicationInputSetJSON(manifest),'Re-export changed original identity.');
  const original=await sourceModel.applicationInputSetInspect({setId});
  check(applicationInputSetJSON(original.manifest)===applicationInputSetJSON(manifest),'Receiving replaced the source.');
  check(errors.length===0,'Actual browser errors: '+errors.join('; '));
  return {setId,sourceWorkspaceId:review.originWorkspaceId,receivingWorkspaceId:reopened.workspaceId,
   archive:{path:archive,bytes:sourceBytes.length,sha256:sha(sourceBytes)},ordinaryExtractedDirectory:extracted,
   ordinaryMembers:ordinary,selectionRequestId,selectionPath:selection.path,applicationId,applicationRevision:saved.revision,
   reexport,screenshots,originalFiles:manifest.files.length,originalDirectories:manifest.directories.length,
   visualInspection:'Producing peer opens and LOOKS at all returned images and uses every outgoing archive/member in its recipient application.'};
 }finally{if(cold)await cold.close();for(const context of contexts.reverse())await context.close();}
}
