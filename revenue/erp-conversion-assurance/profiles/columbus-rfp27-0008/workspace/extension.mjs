// MIT. Trusted profile adapter for the original conversion server and service.
import {pipeline} from 'node:stream/promises';
import {WorkspaceError} from '../../../scap-workspace/mapping.mjs';
import {PROFILE_ID} from './profile.mjs';
import {fromSpec,withPlan,newColumbusPlan,projectView} from './acceptance.mjs';
import {createProjectHandoff} from './handoff.mjs';

const JOB=/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;
const fail=(message,status=400)=>{throw new WorkspaceError('COLUMBUS_PLAN_INVALID',message,status);};

/** Uses the existing service's paged jobs, verified bundles and original reviews.
 * Report bodies are not fetched to show a project overview. */
export async function readProject(service,projectId) {
  if(typeof projectId!=='string'||!JOB.test(projectId))fail('Choose a stable Columbus project ID.');
  const entries=new Map(),seen=new Set();let after='';
  // A saved phase plan can be a staged bundle awaiting a comparison. Include it
  // without launching a redundant engine run merely to retain operator notes.
  do {
    const page=await service.listBundles({limit:1000,after});
    for(const bundle of page.bundles) {
      if(entries.has(bundle.bundleId))fail('The original bundle continuation repeated an input.',409);
      const retained=await service.getBundle(bundle.bundleId);
      entries.set(bundle.bundleId,{bundle:retained.bundle,spec:retained.spec,jobs:[],reviewsByJob:{}});
    }
    const next=page.nextCursor??'';
    if(next&&next===after)fail('The original bundle continuation did not advance.',409);
    after=next;
  }while(after);
  do {
    const page=await service.listJobs({limit:1000,after});
    for(const job of page.jobs) {
      if(seen.has(job.jobId))fail('The original job continuation repeated a run.',409);
      seen.add(job.jobId);
      let entry=entries.get(job.bundleId);
      if(!entry){
        const retained=await service.getBundle(job.bundleId);
        entry={bundle:retained.bundle,spec:retained.spec,jobs:[],reviewsByJob:{}};entries.set(job.bundleId,entry);
      }
      if(fromSpec(entry.spec)?.projectId!==projectId)continue;
      entry.jobs.push(job);
      if(job.state==='COMPLETED')entry.reviewsByJob[job.jobId]=await service.getReviews(job.jobId);
    }
    const next=page.nextCursor??'';
    if(next&&next===after)fail('The original job continuation did not advance.',409);
    after=next;
  }while(after);
  return {...projectView([...entries.values()],projectId),observedAt:new Date().toISOString()};
}

async function validateReferences(plan,service) {
  const refs=new Map();
  for(const ref of [...plan.dispositions,...plan.phaseSelection]) {
    const prior=refs.get(ref.jobId);
    if(prior&&prior.reportSha256!==ref.reportSha256)fail('One run cannot refer to two different original reports.');
    refs.set(ref.jobId,ref);
  }
  for(const [jobId,ref] of refs) {
    const job=await service.getJob(jobId);
    if(job.state!=='COMPLETED'||job.result?.report?.sha256!==ref.reportSha256)
      fail('Reopen the original completed report for '+jobId+'.',409);
    const retained=await service.getBundle(job.bundleId);
    if(fromSpec(retained.spec)?.projectId!==plan.projectId)fail('The selected report belongs to another project.',409);
    const phase=plan.phaseSelection.find(p=>p.jobId===jobId);
    if(phase&&phase.bundleId!==job.bundleId)fail('The selected phase bundle changed.',409);
    if(phase?.reviewId){
      const reviews=await service.getReviews(jobId);
      if(!reviews.some(r=>r.jobId===jobId&&r.reportSha256===ref.reportSha256&&r.reviewId===phase.reviewId))
        fail('The selected original reviewer record is unavailable.',409);
    }
  }
}

export default Object.freeze({
  id:PROFILE_ID,browserModule:'/columbus/panel.mjs',
  assets:['profile.mjs','acceptance.mjs','panel.mjs','panel.css'].map(name=>({
    path:'/columbus/'+name,file:new URL(name,import.meta.url),
    type:name.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8',
  })),
  decorateDraft({spec,draft}) {
    if(draft.profile?.id!==PROFILE_ID)fail('Use the Columbus operator profile with this extension.');
    return {...draft,columbus:fromSpec(spec)??newColumbusPlan(draft)};
  },
  async compileSpec({spec,draft,service}) {
    if(spec.workspace?.profile?.id!==PROFILE_ID)fail('Use the Columbus operator profile with this extension.');
    let result;
    try {result=withPlan(spec,draft.columbus??newColumbusPlan(draft));}
    catch(error){fail(error.message);}
    await validateReferences(result.workspace.columbus,service);
    return result;
  },
  async handleRequest({req,res,url,service,model,send}) {
    if(req.method!=='GET')return false;
    if(url.pathname==='/api/columbus/project') {
      send(res,200,await readProject(service,url.searchParams.get('projectId')));return true;
    }
    if(url.pathname==='/api/columbus/handoff') {
      const project=await readProject(service,url.searchParams.get('projectId'));
      if(!project.completed)fail('This project has no completed original runs to export.');
      const artifact=await createProjectHandoff({model,project});
      try {
        res.statusCode=200;res.setHeader('Content-Type','application/gzip');
        res.setHeader('Content-Disposition',`attachment; filename="${artifact.filename}"`);
        res.setHeader('Content-Length',artifact.bytes);
        await pipeline(artifact.stream(),res);
      }finally{await artifact.close();}
      return true;
    }
    return false;
  },
});
