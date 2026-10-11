// MIT. Burbank project API and UI hosted by the original access-controlled operator.
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {pipeline} from 'node:stream/promises';
import {randomUUID} from 'node:crypto';
import {WorkspaceError} from '../../../scap-workspace/mapping.mjs';
import {PROFILE_ID,PROCUREMENT,TRIAL_KINDS,newPlan} from './profile.mjs';
import {ID,SHA,requireValue,summarize} from './schema.mjs';
import {retainWorkspaceCatalog} from './catalog.mjs';
import {openProjectStore} from './store.mjs';
import {responseTransfers,importResponses} from './responses.mjs';
import {createProjectHandoff,projectRuns,runProgram} from './handoff.mjs';
const safeFilename=name=>name.replace(/[^A-Za-z0-9._-]/g,'_').slice(0,180)||'attachment';
function binary(res,filename,bytes,type='application/octet-stream') {
  res.statusCode=200;res.setHeader('Content-Type',type);res.setHeader('Content-Disposition',`attachment; filename="${safeFilename(filename)}"`);
  res.setHeader('Content-Length',bytes.length);res.end(bytes);
}
export async function createBurbankExtension({directory,referenceDirectory}) {
  const catalog=await retainWorkspaceCatalog(directory,referenceDirectory),store=await openProjectStore(directory,catalog);
  async function planSnapshot(plan) {
    requireValue(plan&&plan.schema==='erp-burbank.trial-plan.v1'&&ID.test(plan.projectId??''),'Select a Burbank project for this trial.');
    requireValue(ID.test(plan.trialId??'')&&Number.isInteger(plan.trialNumber)&&plan.trialNumber>=1&&plan.trialNumber<=10000,'Use a stable trial family and a positive trial number.');
    requireValue(TRIAL_KINDS.includes(plan.kind),'Choose a trial kind.');
    for(const [field,known]of [['requirementIds',catalog.requirementIds],['interfaceIds',catalog.interfaceIds]])
      requireValue(Array.isArray(plan[field])&&plan[field].length<=1000&&plan[field].every(x=>known.has(x)),'Choose original '+field+' for this run.');
    const snapshot=plan.snapshotSha256?await store.getSnapshot(plan.snapshotSha256):await store.snapshot(plan.projectId,plan.projectRevision);
    requireValue(snapshot.project.id===plan.projectId&&snapshot.project.revision===plan.projectRevision,'The selected plan snapshot belongs to another revision.');
    return {schema:plan.schema,projectId:plan.projectId,projectRevision:plan.projectRevision,snapshotSha256:snapshot.sha256,
      trialId:plan.trialId,trialNumber:plan.trialNumber,kind:plan.kind,requirementIds:[...new Set(plan.requirementIds)],
      interfaceIds:[...new Set(plan.interfaceIds)],notes:String(plan.notes??'').slice(0,8000),catalogSha256:catalog.catalogSha256};
  }
  async function verifyReview(record,projectId,service) {
    const ref=record.reference;if(!ref)return;
    requireValue(typeof ref==='object'&&typeof ref.jobId==='string'&&SHA.test(ref.reportSha256??''),'Choose an original completed report.');
    const job=await service.getJob(ref.jobId),bundle=await service.getBundle(job.bundleId);
    requireValue(job.state==='COMPLETED'&&job.result?.report?.sha256===ref.reportSha256&&bundle.spec.workspace?.burbank?.projectId===projectId,'The referenced report does not belong to this project.');
    if(ref.reviewId)requireValue((await service.getReviews(job.jobId)).some(x=>x.reviewId===ref.reviewId&&x.reportSha256===ref.reportSha256),'The selected original review was not found.');
  }
  async function workbook({projectId,assetSha256,kind,action,patches}) {
    const original=await store.readAsset(projectId,assetSha256);
    requireValue(original.asset.kind===kind+'-template','Choose the retained original '+kind+' workbook.');
    const temporary=await mkdtemp(join(tmpdir(),'burbank-workbook-'));
    try {
      const input=join(temporary,'original.xlsx'),output=join(temporary,'response.xlsx');await writeFile(input,original.bytes,{mode:0o600,flag:'wx'});
      let result;
      try{result=JSON.parse(await runProgram(process.env.BURBANK_PYTHON??'python3',[fileURLToPath(new URL('workbook.py',import.meta.url))],
        {input:JSON.stringify({reference:catalog.referenceDirectory,input,output,kind,action,patches})}));}
      catch(error){throw new Error('The original workbook could not be inspected or overlaid. '+error.message);}
      requireValue(!result.error,result.error);
      return {inspection:result,...(action==='overlay'?{bytes:await readFile(output)}:{})};
    }finally{await rm(temporary,{recursive:true,force:true});}
  }
  const extension={id:PROFILE_ID,browserModule:'/burbank/panel.mjs',store,
    assets:['panel.mjs','panel.css','profile.mjs','schema.mjs'].map(name=>({path:'/burbank/'+name,file:new URL(name,import.meta.url),
      type:name.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8'})),
    decorateDraft({spec,draft}){return {...draft,burbank:spec.workspace?.burbank??null};},
    async compileSpec({spec,draft}) {
      try{return {...spec,workspace:{...spec.workspace,burbank:await planSnapshot(draft.burbank)}};}
      catch(error){throw new WorkspaceError('BURBANK_PLAN_INVALID',error.message,error.status??400);}
    },
    async handleRequest({req,res,url,service,model,readJson,send}) {
      if(!url.pathname.startsWith('/api/burbank/'))return false;
      try {
        const route=url.pathname.slice('/api/burbank/'.length),id=url.searchParams.get('projectId');
        if(req.method==='GET') {
          if(route==='catalog')send(res,200,{...catalog.publicView(),procurement:PROCUREMENT});
          else if(route==='projects')send(res,200,{projects:await store.list()});
          else if(route==='project') {
            const hash=url.searchParams.get('snapshot');if(hash){const snapshot=await store.getSnapshot(hash);requireValue(snapshot.project.id===id,'Snapshot project mismatch.');send(res,200,{project:snapshot.project,summary:summarize(snapshot.project,catalog),snapshotSha256:hash});}
            else send(res,200,await store.view(id));
          } else if(route==='runs')send(res,200,await projectRuns(service,id));
          else if(route==='history')send(res,200,{history:await store.history(id)});
          else if(route==='asset'){const {asset,bytes}=await store.readAsset(id,url.searchParams.get('sha256'));binary(res,asset.name,bytes);}
          else if(route==='transfers')binary(res,'burbank-'+id+'-responses.json',Buffer.from(JSON.stringify(responseTransfers(await store.get(id),catalog),null,2)+'\n'),'application/json');
          else if(route==='csv') {
            const transfers=responseTransfers(await store.get(id),catalog),name=url.searchParams.get('file');requireValue(Object.hasOwn(transfers.files,name),'Choose a native response export.');binary(res,name,Buffer.from(transfers.files[name]),'text/csv; charset=utf-8');
          } else if(route==='workbook') {
            const project=await store.get(id),kind=url.searchParams.get('kind'),transfers=responseTransfers(project,catalog);
            requireValue(Object.hasOwn(transfers.patches,kind),'Choose the original workbook kind.');
            const exceeded=transfers.capacity.filter(x=>kind==='staffing'?/Staffing/.test(x):kind==='price'?!/Staffing/.test(x):false);
            requireValue(exceeded.length===0,exceeded.join(' '));
            const artifact=await workbook({projectId:id,assetSha256:url.searchParams.get('sha256'),kind,action:'overlay',patches:transfers.patches[kind]});
            binary(res,'Burbank-'+kind+'-r'+project.revision+'.xlsx',artifact.bytes,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
          } else if(route==='handoff') {
            const artifact=await createProjectHandoff({store,model,service,projectId:id});
            try{res.statusCode=200;res.setHeader('Content-Type','application/gzip');res.setHeader('Content-Disposition',`attachment; filename="${artifact.filename}"`);res.setHeader('Content-Length',artifact.bytes);await pipeline(artifact.stream(),res);}
            finally{await artifact.close();}
          } else throw new WorkspaceError('NOT_FOUND','The Burbank endpoint was not found.',404);
          return true;
        }
        if(req.method!=='POST')throw new WorkspaceError('METHOD_NOT_ALLOWED','Use the workspace controls.',405);
        const body=await readJson(req,36*1024*1024);
        if(route==='create') {const project=await store.create(body);send(res,201,{project,summary:summarize(project,catalog)});}
        else if(route==='change') {
          requireValue(Array.isArray(body.operations),'Choose project changes.');
          for(const op of body.operations) {
            requireValue(['metadata','upsert','remove','review'].includes(op.type),'Choose an editable project operation.');
            if(op.type==='review'){op.record.id='review-'+randomUUID();await verifyReview(op.record,body.projectId,service);}
          }
          const project=await store.commit(body.projectId,body.revision,body.actor,body.operations);send(res,200,{project,summary:summarize(project,catalog)});
        } else if(route==='upload') {
          requireValue(typeof body.data==='string'&&body.data.length<=35*1024*1024&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(body.data),'Upload a valid original file of at most 25 MiB.');
          const bytes=Buffer.from(body.data,'base64');requireValue(bytes.toString('base64')===body.data,'The upload encoding changed.');
          const result=await store.putAsset({...body,bytes});send(res,201,{...result,summary:summarize(result.project,catalog)});
        } else if(route==='import-workbook') {
          const project=await store.get(body.projectId);requireValue(project.revision===body.revision,'Reload the current project first.');
          const {inspection}=await workbook({projectId:body.projectId,assetSha256:body.assetSha256,kind:body.kind,action:'inspect'});
          const operations=importResponses(body.kind,inspection.values,project,catalog);
          const updated=await store.commit(body.projectId,body.revision,body.actor,operations);send(res,200,{project:updated,summary:summarize(updated,catalog),imported:operations.length});
        } else throw new WorkspaceError('NOT_FOUND','The Burbank endpoint was not found.',404);
        return true;
      }catch(error){if(error instanceof WorkspaceError)throw error;throw new WorkspaceError('BURBANK_OPERATION_FAILED',error.message,/another view|Reload|changed in another/.test(error.message)?409:error.status??400);}
    },
  };
  return extension;
}
