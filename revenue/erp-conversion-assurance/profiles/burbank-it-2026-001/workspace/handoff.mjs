// MIT. Complete project transfer with original comparison replays and native response exports.
import {mkdir,mkdtemp,writeFile,copyFile,stat,rm,open,readdir} from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {pipeline} from 'node:stream/promises';
import {createHash} from 'node:crypto';
import {responseTransfers} from './responses.mjs';
import {REFERENCE_DIRECTORY} from './catalog.mjs';
import {requireValue} from './schema.mjs';
export async function runProgram(command,args,options={}) {
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{stdio:['pipe','pipe','pipe'],...options}),output=[],errors=[];let size=0;
    child.stdout?.on('data',x=>{size+=x.length;if(size>32*1024*1024)child.kill('SIGKILL');else output.push(x);});
    child.stderr?.on('data',x=>{if(errors.length<20)errors.push(x);});
    child.once('error',reject);child.once('close',code=>{
      if(code===0)return resolve(Buffer.concat(output));
      let message=Buffer.concat(errors).toString('utf8').slice(0,1000);
      if(!message){try{message=JSON.parse(Buffer.concat(output)).error;}catch{}}
      reject(new Error(message||'The local helper failed.'));
    });
    if(options.input)child.stdin.end(options.input);else child.stdin.end();
  });
}
export async function projectRuns(service,projectId) {
  const bundles=[],jobs=[],index=new Map();let after='';
  do {
    const page=await service.listBundles({limit:1000,after});
    for(const item of page.bundles) {
      const retained=await service.getBundle(item.bundleId),plan=retained.spec?.workspace?.burbank;
      if(plan?.projectId===projectId){const entry={bundle:retained.bundle,plan};bundles.push(entry);index.set(item.bundleId,entry);}
    }
    const next=page.nextCursor??'';requireValue(!next||next!==after,'The original bundle page did not advance.');after=next;
  }while(after);
  do {
    const page=await service.listJobs({limit:1000,after});
    for(const job of page.jobs)if(index.has(job.bundleId))jobs.push({...job,plan:index.get(job.bundleId).plan,
      reviews:job.state==='COMPLETED'?await service.getReviews(job.jobId):[]});
    const next=page.nextCursor??'';requireValue(!next||next!==after,'The original job page did not advance.');after=next;
  }while(after);
  return {bundles,jobs,observedAt:new Date().toISOString()};
}
export async function createProjectHandoff({store,model,service,projectId}) {
  const project=await store.get(projectId),snapshot=await store.snapshot(projectId,project.revision),runs=await projectRuns(service,projectId);
  const temporary=await mkdtemp(join(tmpdir(),'burbank-handoff-')),folder=join(temporary,'project');await mkdir(folder,{mode:0o700});
  const files=[];
  async function retain(name,bytes) {
    const path=join(folder,name);await mkdir(join(path,'..'),{recursive:true,mode:0o700});await writeFile(path,bytes,{flag:'wx',mode:0o600});
    files.push({file:name,bytes:Buffer.byteLength(bytes),sha256:createHash('sha256').update(bytes).digest('hex')});
  }
  try {
    await retain('project.json',JSON.stringify(snapshot,null,2)+'\n');
    await retain('project-history.json',JSON.stringify(await store.history(projectId),null,2)+'\n');
    await retain('original-runs.json',JSON.stringify(runs,null,2)+'\n');
    const transfers=responseTransfers(project,store.catalog);
    await retain('native-response-transfers.json',JSON.stringify({...transfers,files:undefined},null,2)+'\n');
    for(const [name,bytes]of Object.entries(transfers.files))await retain('responses/'+name,bytes);
    for(const pin of store.catalog.pins) {
      const {readFile}=await import('node:fs/promises'),bytes=await readFile(join(store.catalog.referenceDirectory,pin.file));
      requireValue(createHash('sha256').update(bytes).digest('hex')===pin.sha256,'The retained source changed during handoff.');await retain('reference/'+pin.file,bytes);
    }
    for(const hash of Object.keys(project.assets)){const original=await store.readAsset(projectId,hash);await retain('assets/'+hash,original.bytes);}
    const replayIndex=[];
    for(const job of runs.jobs.filter(x=>x.state==='COMPLETED')) {
      const replay=await model.createHandoff(job.jobId);
      try {
        requireValue(replay.exported.bundleId===job.bundleId&&replay.exported.reportSha256===job.result.report.sha256,'The original replay identity changed.');
        const name='runs/'+job.jobId+'.tar.gz',destination=join(folder,name);await mkdir(join(destination,'..'),{recursive:true,mode:0o700});
        const hash=createHash('sha256'),stream=replay.stream();stream.on('data',x=>hash.update(x));
        await pipeline(stream,createWriteStream(destination,{flags:'wx',mode:0o600}));
        const entry={file:name,bytes:(await stat(destination)).size,sha256:hash.digest('hex')};files.push(entry);
        replayIndex.push({jobId:job.jobId,bundleId:job.bundleId,reportSha256:job.result.report.sha256,...entry});
        if(job.plan.snapshotSha256&&job.plan.snapshotSha256!==snapshot.sha256) {
          const name='trial-plans/'+job.plan.snapshotSha256+'.json';
          if(!files.some(x=>x.file===name))await retain(name,JSON.stringify(await store.getSnapshot(job.plan.snapshotSha256),null,2)+'\n');
        }
      } finally {await replay.close();}
    }
    await retain('README.txt',
      'Burbank ERP project handoff\n\n'+
      'project.json is the exact signed project snapshot used for this transfer.\n'+
      'The source catalogs and original uploaded attachments are included unchanged.\n'+
      'responses/ contains all native response rows. native-response-transfers.json identifies exact editable worksheet cells and original-template capacities.\n'+
      'runs/ contains the maintained conversion service replay for every completed project job, including original source/target input bytes, mapping, report and reviews. It contains private identity key material; keep the package private.\n'+
      'trial-plans/ retains the original project plan for prior trials. A later project edit never relabels an earlier result.\n'+
      'Original pending bundles/jobs are identified in original-runs.json. Their pending input bytes remain in the service directory until completion.\n'+
      'For a full operational restart including pending work, stop this operator and use the encrypted backup/restore commands in the application README.\n'+
      'Reopen the native XLSX overlays in Excel or the selected spreadsheet application to recalculate the original workbook formulas.\n');
    const manifest={schema:'erp-burbank.project-handoff.v1',projectId,revision:project.revision,snapshotSha256:snapshot.sha256,
      createdAt:new Date().toISOString(),catalogPins:store.catalog.pins,files,replayIndex,pending:runs.jobs.filter(x=>x.state!=='COMPLETED').map(x=>({jobId:x.jobId,state:x.state,bundleId:x.bundleId}))};
    await writeFile(join(folder,'MANIFEST.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
    const path=join(temporary,'burbank-'+projectId+'.tar.gz');await runProgram('tar',['-czf',path,'-C',folder,'.']);
    const filename='burbank-'+projectId+'-r'+project.revision+'.tar.gz';
    return {path,filename,bytes:(await stat(path)).size,manifest,stream:()=>createReadStream(path),close:()=>rm(temporary,{recursive:true,force:true})};
  }catch(error){await rm(temporary,{recursive:true,force:true});throw error;}
}
