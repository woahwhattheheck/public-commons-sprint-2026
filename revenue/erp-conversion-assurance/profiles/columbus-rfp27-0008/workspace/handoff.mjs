// MIT. Group the original service's private replay exports for a whole project.
import {mkdtemp,open,writeFile,stat,rm,mkdir} from 'node:fs/promises';
import {createReadStream,createWriteStream,constants} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pipeline} from 'node:stream/promises';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';

/** Every completed run is exported by the same original createHandoff path.
 * The manifest also preserves pending run identities; their replay awaits their
 * original report. No source files or service database are read directly here. */
export async function createProjectHandoff({model,project}) {
  if(!project||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(project.projectId)||!Array.isArray(project.jobs))
    throw new Error('Use the original project selection for its handoff.');
  const temporary=await mkdtemp(join(tmpdir(),'columbus-project-handoff-'));
  let output;
  try {
    const name='columbus-'+project.projectId,folder=join(temporary,name);
    await mkdir(folder,{mode:0o700});
    const completed=project.jobs.filter(j=>j.state==='COMPLETED'&&j.report);
    if(!completed.length)throw new Error('This project has no completed original runs to export.');
    const replays=[];
    for(const job of completed) {
      const original=await model.createHandoff(job.jobId);
      try {
        if(original.exported.bundleId!==job.bundleId||original.exported.reportSha256!==job.report.sha256)
          throw new Error('The original replay identity changed during project export.');
        const filename=original.filename,destination=join(folder,filename);
        const digest=createHash('sha256');
        const input=original.stream();input.on('data',chunk=>digest.update(chunk));
        await pipeline(input,createWriteStream(destination,{flags:'wx',mode:0o600}));
        replays.push({jobId:job.jobId,bundleId:job.bundleId,reportSha256:job.report.sha256,
          filename,bytes:(await stat(destination)).size,sha256:digest.digest('hex')});
      }finally{await original.close();}
    }
    const manifest={schema:'erp-columbus.project-handoff.v1',createdAt:new Date().toISOString(),
      project,completedReplays:replays,pendingRuns:project.jobs.filter(j=>j.state!=='COMPLETED').map(j=>({jobId:j.jobId,bundleId:j.bundleId,state:j.state})),
      contents:'Complete original replay for each completed project trial, including original inputs, mapping and City plan, pinned engine, original report, reviews and the private report-identity key. All retained bundle manifests and parsed mapping/plan snapshots are in project.bundles, including staged plans without a run. New inputs unique to an uncompleted bundle remain in the original service root.'};
    await writeFile(join(folder,'project.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
    await writeFile(join(folder,'README.txt'),
      'Columbus conversion project handoff\n\n'+
      'project.json contains the retained trial, phase, source and reviewer identities.\n'+
      'project.bundles includes every saved plan and its parsed mapping with original byte pins.\n'+
      'These parsed snapshots preserve planning content; original mapping bytes are in completed replay archives.\n'+
      'Each reconciliation-*.tar.gz is produced by the original reconciliation service.\n'+
      'Extract an individual archive in a private directory and follow its replay guide.\n'+
      'The completed replay archives contain original inputs and the private HMAC key.\n'+
      'Pending run identities are recorded in project.json; pending runs do not yet have replay reports.\n'+
      'New input bytes unique to an uncompleted bundle remain in the original private service root.\n'+
      'The shared operator directory remains the source of ongoing work.\n',{flag:'wx',mode:0o600});
    const archive=join(temporary,name+'.tar.gz');
    output=await open(archive,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY,0o600);
    const child=spawn('tar',['-czf','-','-C',temporary,name],{stdio:['ignore',output.fd,'pipe']});
    child.stderr.on('data',()=>{});let timer;
    try {
      const result=await new Promise((yes,no)=>{
        child.once('error',no);child.once('close',(code,signal)=>yes({code,signal}));
        timer=setTimeout(()=>child.kill('SIGKILL'),60000);
      });
      if(result.code!==0)throw new Error('The original project replay could not be packaged.');
    }finally{clearTimeout(timer);await output.close();output=null;}
    return {filename:name+'.tar.gz',bytes:(await stat(archive)).size,manifest,
      stream:()=>createReadStream(archive),close:()=>rm(temporary,{recursive:true,force:true})};
  }catch(error){
    if(output)await output.close().catch(()=>{});
    await rm(temporary,{recursive:true,force:true});throw error;
  }
}
