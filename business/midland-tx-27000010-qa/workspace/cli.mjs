#!/usr/bin/env node
// MIT. Original Midland operator entrypoint; Node.js 24+ and optional PDF carrier.
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {writeFile,readFile,mkdir,copyFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {Workspace} from './store.mjs';
import {createWorkspaceServer} from './server.mjs';
import {buildEdition,editionFile,exportWorkspace,restoreWorkspace} from './delivery.mjs';
import {defaultDictionary,fault} from './contract.mjs';

const usage=[
  'Midland geospatial delivery workspace — Node.js 24+',
  '',
  'node workspace/cli.mjs serve --workspace /private/midland [--port 8787]',
  'node workspace/cli.mjs create --workspace /private/midland --title "Project" --actor "Reviewer"',
  'node workspace/cli.mjs import --workspace DIR --project ID --metadata metadata.json --rows rows.ndjson --label "Draft 1" --actor NAME [--sample] [--parent SOURCE_ID] [--source-ref URL]',
  'node workspace/cli.mjs artifact --workspace DIR --project ID --file FILE --role ROLE --label LABEL --actor NAME [--source-ref URL]',
  'node workspace/cli.mjs dictionary --workspace DIR --project ID --file dictionary.json --actor NAME [--approval-ref URL --approver NAME --approval-date YYYY-MM-DD]',
  'node workspace/cli.mjs run --workspace DIR --project ID --actor NAME [--retry RUN_ID]',
  'node workspace/cli.mjs status --workspace DIR [--project ID]',
  'node workspace/cli.mjs edition --workspace DIR --project ID --run RUN_ID --label LABEL --note CONTEXT --actor NAME [--out /new/delivery.zip]',
  'node workspace/cli.mjs backup --workspace DIR --project ID --out /new/case.zip',
  'node workspace/cli.mjs restore --workspace /new/private/directory --archive /retained/case.zip',
  'node workspace/cli.mjs default-dictionary --out /new/dictionary.json',
  '',
  '--upload-limit-mib raises the explicit per-file limit (default 512).',
  '--python or MIDLAND_PYTHON selects Python with reportlab for CSV/PDF delivery editions.',
  'Original ArcPy exports and preflight.mjs remain usable independently.'
].join('\n');
export async function main(args){
  const command=args[0],value=name=>{const index=args.indexOf('--'+name);return index<0?undefined:args[index+1];};
  if(!command||command==='--help'||command==='help'){process.stdout.write(usage+'\n');return;}
  const output=value=>process.stdout.write(JSON.stringify(value,null,2)+'\n');
  if(command==='default-dictionary'){
    if(!value('out'))throw fault(422,'Supply --out.');await writeFile(resolve(value('out')),JSON.stringify(defaultDictionary(),null,2)+'\n',{flag:'wx',mode:0o600});output({path:resolve(value('out'))});return;
  }
  if(!value('workspace'))throw fault(422,'Supply a private --workspace directory.');
  const directory=resolve(value('workspace')),uploadLimit=value('upload-limit-mib')?Number(value('upload-limit-mib'))*1024*1024:undefined;
  if(uploadLimit!==undefined&&(!Number.isSafeInteger(uploadLimit)||uploadLimit<1024))throw fault(422,'Choose a positive upload byte limit.');
  const options={python:value('python'),uploadLimit};
  if(command==='restore'){
    if(!value('archive'))throw fault(422,'Supply --archive.');
    output(await restoreWorkspace(resolve(value('archive')),directory,options));return;
  }
  if(command==='serve'){
    const port=value('port')===undefined?8787:Number(value('port'));
    if(!Number.isInteger(port)||port<0||port>65535)throw fault(422,'Choose a valid port.');
    const application=await createWorkspaceServer({workspace:directory,port,...options});
    output({workspace:directory,url:application.url});
    let stopping=false;
    const stop=async()=>{if(stopping)return;stopping=true;await application.close();};
    process.once('SIGINT',stop);process.once('SIGTERM',stop);return application;
  }
  const workspace=await Workspace.open(directory,{uploadLimit});
  try{
    if(command==='create'){output(workspace.create({title:value('title'),owner:value('actor')}));return;}
    if(command==='status'){output(value('project')?workspace.state(value('project')):workspace.list());return;}
    const projectId=value('project'),actor=value('actor'),project=workspace.project(projectId),expected=project.revision;
    if(command==='import'){
      if(!value('metadata')||!value('rows'))throw fault(422,'Supply --metadata and --rows.');
      const metadata=await workspace.uploadFile(projectId,resolve(value('metadata'))),rows=await workspace.uploadFile(projectId,resolve(value('rows')));
      output(await workspace.addSource(projectId,{expected,actor,metadata_upload:metadata.id,rows_upload:rows.id,
        sample:args.includes('--sample'),label:value('label'),parent_id:value('parent'),source_ref:value('source-ref')||''}));return;
    }
    if(command==='artifact'||command==='dictionary'){
      if(!value('file'))throw fault(422,'Supply --file.');
      const upload=await workspace.uploadFile(projectId,resolve(value('file'))),input={expected,actor,upload_id:upload.id,source_ref:value('source-ref')||''};
      if(command==='artifact')output(workspace.addArtifact(projectId,{...input,role:value('role'),label:value('label')}));
      else output(await workspace.addDictionary(projectId,{...input,approval:value('approval-ref')?'RECORDED_CITY_APPROVAL':'DRAFT',
        approval_ref:value('approval-ref')||'',approver:value('approver')||'',approval_date:value('approval-date')||''}));
      return;
    }
    if(command==='run'){
      const started=workspace.startRun(projectId,{expected,actor,parent_run_id:value('retry')});
      await workspace.waitRun(started.run_id);const run=workspace.getRun(projectId,started.run_id);output(run);
      if(run.status!=='COMPLETED')process.exitCode=1;
      else if(run.reports.some(report=>report.verdict==='REVIEW_REQUIRED'))process.exitCode=2;
      return;
    }
    if(command==='edition'){
      const release=workspace.createRelease(projectId,{expected,actor,run_id:value('run'),label:value('label'),note:value('note')});
      const edition=await buildEdition(workspace,projectId,release.release_id,options);
      const file=await editionFile(workspace,projectId,release.release_id,'delivery.zip',options);
      if(value('out'))await copyFile(file.path,resolve(value('out')),constants.COPYFILE_EXCL);
      output({...edition,delivery:value('out')?resolve(value('out')):file.path});return;
    }
    if(command==='backup'){
      if(!value('out'))throw fault(422,'Supply a new --out package filename.');
      const file=await exportWorkspace(workspace,projectId,options);
      await copyFile(file.path,resolve(value('out')),constants.COPYFILE_EXCL);output({...file,path:resolve(value('out'))});return;
    }
    throw fault(422,'Unknown command. Run --help.');
  }finally{await workspace.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  main(process.argv.slice(2)).catch(error=>{process.stderr.write(String(error.message||error)+'\n');process.exitCode=1;});
