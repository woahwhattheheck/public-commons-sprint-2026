// MIT. Complete report editorial requests through the original running Analysis owner.
import {WorldBankProgrammeClient} from './worldbank-programme-client.mjs';
import {readWorkflowSeriesPrivateFile,workflowSeriesPrivateDirectory} from './workflow-series-connection.mjs';
import {writeConsoleWorkflowFile} from './console/client-files.mjs';
import {join,resolve} from 'node:path';
import {REPORT_REVIEW_ID,REPORT_REVIEW_SHA,REPORT_REVIEW_MAX_RETURN,plain,canonical,encode,digest,need,identity} from './report-editorial-records.mjs';
export {REPORT_REVIEW_ID,REPORT_REVIEW_SHA,REPORT_REVIEW_MAX_RETURN,plain,canonical,encode,digest,need,identity} from './report-editorial-records.mjs';

function page(options={},detail=false){
  need(plain(options)&&Object.keys(options).every(k=>(detail?['returns_before','applies_before','limit']:['before','limit']).includes(k)),'Use the original history page options.');
  const query=new URLSearchParams();
  for(const[k,v]of Object.entries(options)){
    if(v===null||v===undefined)continue;
    need(Number.isSafeInteger(v)&&v>=1&&(k!=='limit'||v<=100),'Keep the original positive history cursor and limit.');
    query.set(k,String(v));
  }
  return query.size?'?'+query:'';
}
export class AnalysisReportReviewClient{
  #native;#workspaceId;
  constructor({launch,workspaceId,signal}){
    this.#native=new WorldBankProgrammeClient({launch,workspaceId,signal});this.#workspaceId=workspaceId;
  }
  get workspaceId(){return this.#workspaceId;}
  state(){return this.#native.state();}
  history(options){return this.#native.json('report-reviews'+page(options));}
  detail(id,options){return this.#native.json('report-reviews/'+identity(id)+page(options,true));}
  returned(id){return this.#native.json('report-review-returns/'+identity(id));}
  status(id){return this.#native.json('report-review-applies/'+identity(id));}
  preview(id,mapping=null){need(mapping===null||Array.isArray(mapping),'Supply the complete reviewed section mapping.');return this.#native.json('report-review-returns/'+identity(id)+'/preview',{mapping});}
  download(id,name,output){return this.#native.reportReviewDownload(identity(id),name,output);}
  /** Only the native model interprets/validates editorial choices and row sources. */
  async dispatch(action,request,{returnId}={}){
    need(['issue','receive','apply'].includes(action)&&plain(request),'Select an original editorial write and full request.');
    identity(request.id);
    const raw=encode(request);
    need(Buffer.byteLength(JSON.stringify(request))<=(action==='receive'?REPORT_REVIEW_MAX_RETURN:1024*1024),'The complete request exceeds its original native route limit.');
    await this.state();
    if(action==='issue')return this.#native.json('report-reviews',request);
    if(action==='receive')return this.#native.reportReviewReceive(request);
    return this.#native.json('report-review-returns/'+identity(returnId)+'/apply',request);
  }
  /** The caller supplies the request ID once; identical replays retain its intent. */
  async mutate(action,request,operation,{returnId}={}){
    need(typeof operation==='string','Choose the private original operation directory.');
    need(['issue','receive','apply'].includes(action)&&plain(request),'Select the original action and complete request.');
    identity(request.id); if(action==='apply')identity(returnId);
    need(Buffer.byteLength(JSON.stringify(request))<=(action==='receive'?REPORT_REVIEW_MAX_RETURN:1024*1024),'Keep the original native request size.');
    const directory=await workflowSeriesPrivateDirectory(resolve(operation),true);
    const intent={schema:'stellar-forge.report-editorial-client-intent.v1',workspaceId:this.#workspaceId,
      action,returnId:returnId??null,request};
    identity(request?.id);
    const raw=encode(intent),filename=join(directory,'intent.json');
    await writeConsoleWorkflowFile(filename,raw);
    const retained=await readWorkflowSeriesPrivateFile(filename,REPORT_REVIEW_MAX_RETURN+1024*1024);
    need(retained.equals(raw),'The original editorial intent changed.','REPORT_REVIEW_INTENT_CHANGED');
    // Read the original request outcome before the same idempotent native replay.
    const resultRoute=action==='issue'?'report-reviews/':action==='receive'?'report-review-returns/':'report-review-applies/';
    const observedAt=new Date().toISOString();
    try{
      const value=await this.#native.json(resultRoute+identity(request.id));
      const observation=encode({observedAt,value});
      await writeConsoleWorkflowFile(join(directory,'before-'+digest(observation)+'.json'),observation);
    }catch(error){
      if(error.code!=='REPORT_REVIEW_NOT_FOUND')throw error;
    }
    try{
      const value=await this.dispatch(action,request,{returnId}),bytes=encode(value);
      const result={schema:'stellar-forge.report-editorial-client-result.v1',workspaceId:this.#workspaceId,
        action,requestId:request.id,intentSha256:digest(raw),resultSha256:digest(bytes),value};
      const full=encode(result);
      await writeConsoleWorkflowFile(join(directory,'result-'+digest(full)+'.json'),full);
      return result;
    }catch(error){
      const observation=encode({schema:'stellar-forge.report-editorial-client-attempt.v1',workspaceId:this.#workspaceId,
        action,requestId:request.id,intentSha256:digest(raw),at:new Date().toISOString(),
        code:String(error.code||'REPORT_REVIEW_REQUEST_FAILED'),message:String(error.message),
        outcomeUnknown:error.outcomeUnknown===true});
      await writeConsoleWorkflowFile(join(directory,'attempt-'+digest(observation)+'.json'),observation)
        .catch(saveError=>{error.preservationError=saveError;});
      throw error;
    }
  }
  close(){this.#native.close();}
}
