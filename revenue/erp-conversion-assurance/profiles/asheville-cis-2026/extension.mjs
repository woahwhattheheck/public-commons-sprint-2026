// MIT. Authenticated native utility API hosted by the original loopback operator.
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openUtilityEngine} from './engine.mjs';
import {need,json,sha,text} from './util.mjs';
import {runProgram} from './backup.mjs';
const prefix='/api/utility/';
function bytes(body,maximum=48*1024*1024){need(body.encoding==='base64'&&typeof body.data==='string'&&body.data.length<=Math.ceil(maximum/3)*4,'Supply a retained file as base64 within its intake limit.');const result=Buffer.from(body.data,'base64');need(result.length<=maximum&&result.toString('base64')===body.data,'The source file encoding is invalid.');return result;}
function binary(res,data,name,type='application/octet-stream'){res.statusCode=200;res.setHeader('Content-Type',type);res.setHeader('Content-Length',data.length);res.setHeader('Content-Disposition','attachment; filename="'+name.replace(/[^A-Za-z0-9._-]/g,'_')+'"');res.setHeader('X-Source-Sha256',sha(data));res.end(data);}
export async function createUtilityExtension({directory}){
  const engine=await openUtilityEngine(directory),store=engine.store;
  async function packageProject(body){const project=store.project(body.projectId);need(project.revision===body.revision,'Refresh this project before freezing its handoff.');text(body.note,'Handoff note',2000);const temporary=await mkdtemp(join(store.root,'handoff-'));try{const output=join(temporary,'project.zip'),manifest=JSON.parse(await runProgram(process.env.UTILITY_PYTHON??'python3',[fileURLToPath(new URL('package.py',import.meta.url)),store.file,body.projectId,String(body.revision),output])),content=await readFile(output);return store.transaction(body.projectId,body.revision,body.actor,'project_handoff',{snapshotRevision:body.revision,sha256:sha(content),note:body.note},(p,next)=>{const hash=store.putBlob(body.projectId,content,'utility-'+body.projectId+'-r'+body.revision+'.zip','frozen_handoff');return {sha256:hash,manifest,artifact:store.saveArtifact(body.projectId,next,'project_handoff',{sourceSha256:hash,snapshotRevision:body.revision,manifest,note:body.note})};});}finally{await rm(temporary,{recursive:true,force:true});}}
  const extension={id:'asheville-utility',browserModule:'/utility/panel.mjs',engine,
    assets:[['panel.mjs','text/javascript; charset=utf-8'],['panel.css','text/css; charset=utf-8']].map(([name,type])=>({path:'/utility/'+name,type,file:new URL(name,import.meta.url)})),
    decorateDraft:({spec,draft})=>({...draft,utility:spec.workspace?.utility??null}),
    compileSpec:({spec,draft,inputPins})=>{if(!draft.utility)return spec;const plan=draft.utility,billing=store.artifact(plan.projectId,plan.billingId);need(billing.kind==='billing'&&billing.sha256===plan.billingSha256,'The billing plan changed its pinned source.');need(inputPins.source.sha256===plan.sourceSha256&&inputPins.target.sha256===plan.targetSha256,'The comparison input does not match its original utility billing selection.');return {...spec,workspace:{...spec.workspace,utility:{...plan}}};},
    async handleRequest({req,res,url,model,readJson,send}){if(!url.pathname.startsWith(prefix))return false;const route=url.pathname.slice(prefix.length),projectId=url.searchParams.get('projectId');
      if(req.method==='GET'){
        if(route==='catalog'){send(res,200,engine.catalog);return true;}
        if(route==='projects'){send(res,200,{projects:store.list()});return true;}
        if(route==='project'){send(res,200,store.summary(projectId));return true;}
        if(route==='validate'){send(res,200,engine.validate(projectId));return true;}
        if(route==='history'){send(res,200,{events:store.history(projectId)});return true;}
        if(route==='dataset'){const id=url.searchParams.get('datasetId'),meta=store.dataset(projectId,id),limit=Number(url.searchParams.get('limit')??50),offset=Number(url.searchParams.get('offset')??0);need(limit>=1&&limit<=200,'Choose a page within 200 records.');send(res,200,{dataset:meta,rows:store.rows(projectId,id,{limit,offset,query:url.searchParams.get('query')??'',issuesOnly:url.searchParams.get('issuesOnly')==='true'}),offset,limit});return true;}
        if(route==='dataset.csv'){const id=url.searchParams.get('datasetId');binary(res,store.csv(projectId,id),store.dataset(projectId,id).kind+'-'+id.slice(0,12)+'.csv','text/csv; charset=utf-8');return true;}
        if(route==='asset'){const hash=url.searchParams.get('sha256'),name=url.searchParams.get('name')??hash+'.data';binary(res,store.blob(projectId,hash),name);return true;}
        if(route==='artifact'){const artifact=store.artifact(projectId,url.searchParams.get('artifactId')),offset=Number(url.searchParams.get('offset')??0),limit=Number(url.searchParams.get('limit')??50);need(Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(limit)&&limit>0&&limit<=200,'Choose a valid operation page.');const value={...artifact.value};for(const key of ['rows','details','orders','results','findings','ledgerChanges'])if(Array.isArray(value[key])){value[key+'Count']=value[key].length;value[key]=value[key].slice(offset,offset+limit);}send(res,200,{...artifact,value,offset,limit});return true;}
        if(route==='artifact.json'){const artifact=store.artifact(projectId,url.searchParams.get('artifactId'));binary(res,store.blob(projectId,artifact.sha256),artifact.kind+'-'+artifact.id+'.json','application/json; charset=utf-8');return true;}
      }
      if(req.method==='POST'){
        const body=await readJson(req,70*1024*1024);let result;
        if(route==='create')result=store.create(body);
        else if(route==='import')result=store.importDataset({...body,bytes:bytes(body)});
        else if(route==='correct')result=store.correctDataset(body);
        else if(route==='asset')result=engine.uploadAsset({...body,bytes:bytes(body,32*1024*1024)});
        else if(route==='billing')result=engine.billing(body);
        else if(route==='compare')result=await engine.compare(body,model);
        else if(route==='billing-review')result=await engine.reviewBilling(body,model);
        else if(route==='payments')result=engine.payments(body);
        else if(route==='record-payments')result=engine.recordPayments(body);
        else if(route==='account-action')result=engine.adjustment(body);
        else if(route==='transition')result=engine.transition(body);
        else if(route==='native-import')result=engine.nativeImport({...body,bytes:bytes(body)});
        else if(route==='native-export')result=engine.nativeExport(body);
        else if(route==='field-packet')result=engine.fieldPacket(body);
        else if(route==='field-return')result=engine.fieldReturn({...body,bytes:bytes(body)});
        else if(route==='aging')result=engine.aging(body);
        else if(route==='handoff')result=await packageProject(body);
        else if(route==='settings'){need(body.settings&&typeof body.settings==='object'&&!Array.isArray(body.settings)&&json(body.settings).length<=64000,'Provide the operator settings within 64 KiB.');result=store.transaction(body.projectId,body.revision,body.actor,'operator_settings',{settings:body.settings},(p,next)=>{const updated={...p,settings:body.settings};delete updated.revision;store.db.prepare('UPDATE projects SET body=? WHERE id=?').run(json(updated),body.projectId);return {artifact:store.saveArtifact(body.projectId,next,'operator_settings',body.settings)};});}
        else{send(res,404,{error:'UTILITY_NOT_FOUND',message:'This utility operation was not found.'});return true;}
        send(res,200,result);return true;
      }
      send(res,404,{error:'UTILITY_NOT_FOUND',message:'This utility endpoint was not found.'});return true;
    },close:()=>engine.close(),packageProject};return extension;
}
