// MIT. Commissioning borrows the original private publisher listener.
import { identity, fault } from '../publisher/files.mjs';
const PREFIX='/api/timescale/commissioning/';
function attachment(res,filename){
  res.setHeader('content-disposition',"attachment; filename*=UTF-8''"+encodeURIComponent(filename).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase()));
}
function commissioningHttp({workspace,jsonBody}){
  if(!workspace?.commissioning||typeof jsonBody!=='function')throw new TypeError('Use the original Timescale listener and commissioning workspace.');
  const desk=workspace.commissioning,workspaceId=workspace.settings.id;
  return async function handleCommissioning({req,res,url,send}){
    if(!url.pathname.startsWith(PREFIX))return false;
    const path=url.pathname.slice(PREFIX.length),query=url.searchParams;
    let input=null;
    try{
      if(req.method==='GET'){
        const paging={offset:query.has('offset')?Number(query.get('offset')):0,limit:query.has('limit')?Number(query.get('limit')):25};
        const id=query.get('id');
        if(path==='list')send(200,desk.list({...paging,...(query.has('q')?{q:query.get('q')}:{}),...(query.has('status')?{status:query.get('status')}:{})}));
        else if(path==='item')send(200,desk.item(id));
        else if(path==='reports')send(200,desk.reports(id,paging));
        else if(path==='context')send(200,await desk.context(id,{...paging,...(query.has('kind')?{kind:query.get('kind')}:{})}));
        else if(path==='operation'){const operation=workspace.operation(id);send(200,{workspaceId,operation,digest:identity(operation)});}
        else if(path==='source'||path==='intake'){
          const result=path==='intake'?await desk.intakeFile(id):await desk.source(id,query.get('source'));
          if(query.get('format')==='original'){
            attachment(res,result.descriptor.filename);send(200,Buffer.from(result.original.content,'utf8'),'application/json; charset=utf-8');
          }else if(!query.has('format')||query.get('format')==='json')send(200,result);
          else throw fault('TIMESCALE_COMMISSIONING_FORMAT','Choose original or json.',400);
        }else if(path==='comparison')send(200,await desk.comparison(id,query.get('comparison'),paging));
        else if(path==='comparison-file'){
          const result=await desk.comparisonOriginal(id,query.get('comparison'));
          attachment(res,'comparison-'+result.descriptor.id+'.json');send(200,result.record);
        }else if(path==='report-file'){
          const result=await desk.reportFile(id,query.get('format')??'json');
          attachment(res,result.descriptor.filename);send(200,Buffer.from(result.content,'utf8'),result.descriptor.type);
        }else throw fault('TIMESCALE_COMMISSIONING_ROUTE','Select an existing commissioning route.',404);
        return true;
      }
      if(req.method!=='POST'||!['command','publish-report'].includes(path))
        throw fault('TIMESCALE_COMMISSIONING_METHOD','Use an original commissioning command.',405);
      input=await jsonBody(req);
      const started=path==='command'?desk.command(input):desk.publishReport(input);
      send(202,{schema:'stellar-forge.timescale-commissioning-ack.v1',workspaceId,requestId:started.id,id:started.id,reused:started.reused});
    }catch(issue){
      const known=typeof issue?.code==='string'&&/^[A-Z0-9_]{1,100}$/.test(issue.code);
      const status=[400,403,404,405,409,413,415,422,502,503].includes(issue?.status)?issue.status:422;
      send(status,{schema:'stellar-forge.timescale-commissioning-error.v1',workspaceId,
        requestId:typeof input?.requestId==='string'?input.requestId:null,
        error:known?issue.code:'TIMESCALE_COMMISSIONING_REQUEST_FAILED',
        message:known?issue.message:'Read the original request and its retained outcome before continuing.'});
    }
    return true;
  };
}
export { commissioningHttp };
