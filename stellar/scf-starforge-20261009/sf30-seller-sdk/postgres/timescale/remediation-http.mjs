// MIT. Borrow the original publisher listener and body/origin policy.
import { fault } from '../publisher/files.mjs';

function remediationHttp({workspace,jsonBody}){
  if(!workspace?.remediation||typeof jsonBody!=='function')throw new TypeError('Use the original Timescale listener and desk.');
  const prefix='/api/timescale/remediation/';
  const workspaceId=workspace.settings.id;
  return async function handleRemediation({req,res,url,send}){
    if(!url.pathname.startsWith(prefix))return false;
    const path=url.pathname.slice(prefix.length),query=url.searchParams,desk=workspace.remediation;
    let input=null;
    try{
      if(req.method==='GET'){
        const paging={offset:query.has('offset')?Number(query.get('offset')):0,limit:query.has('limit')?Number(query.get('limit')):25};
        if(path==='list')send(200,desk.list({...paging,...(query.has('status')?{status:query.get('status')}:{}),
          ...(query.has('owner')?{owner:query.get('owner')}:{}),...(query.has('q')?{q:query.get('q')}:{} )}));
        else if(path==='sources')send(200,await desk.sources(paging));
        else if(path==='item')send(200,await desk.item(query.get('id')));
        else if(path==='context')send(200,await desk.context(query.get('id'),{...paging,
          ...(query.has('editionId')?{editionId:query.get('editionId')}: {})}));
        else if(path==='operation')send(200,{schema:'stellar-forge.timescale-remediation-operation.v1',
          workspaceId,operation:workspace.operation(query.get('id'))});
        else if(path==='report'){
          const report=await desk.report(query.get('id'));
          if(query.get('format')==='html'){
            res.setHeader('content-disposition','attachment; filename="'+report.workItemId+'-r'+report.itemRevision+'.html"');
            send(200,Buffer.from(report.html,'utf8'),'text/html; charset=utf-8');
          }else if(!query.has('format')||query.get('format')==='json'){
            res.setHeader('content-disposition','attachment; filename="'+report.workItemId+'-r'+report.itemRevision+'.json"');
            send(200,report.json);
          }else throw fault('TIMESCALE_REMEDIATION_FORMAT_INVALID','Choose HTML or JSON.',400);
        }else throw fault('TIMESCALE_REMEDIATION_ROUTE_NOT_FOUND','Choose an original work route.',404);
        return true;
      }
      if(req.method!=='POST'||path!=='command')throw fault('TIMESCALE_REMEDIATION_METHOD_INVALID','Use the original work command endpoint.',405);
      input=await jsonBody(req);
      const started=desk.command(input);
      send(202,{schema:'stellar-forge.timescale-remediation-ack.v1',workspaceId,
        requestId:started.id,action:input.action,id:started.id,reused:started.reused});
    }catch(issue){
      const known=typeof issue?.code==='string'&&/^[A-Z0-9_]{1,100}$/.test(issue.code);
      const status=[400,403,404,405,409,413,415,422,502,503].includes(issue?.status)?issue.status:422;
      send(status,{schema:'stellar-forge.timescale-remediation-error.v1',workspaceId,
        requestId:typeof input?.requestId==='string'?input.requestId:null,
        action:typeof input?.action==='string'?input.action:null,
        error:known?issue.code:'TIMESCALE_REMEDIATION_REQUEST_FAILED',
        message:known?issue.message:'The retained work request did not return; keep its original identity and inspect the workspace.'});
    }
    return true;
  };
}
export { remediationHttp };
