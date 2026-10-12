// MIT. Commissioning HTTP joins the existing local workspace authority and writer.
const fail=(message,status=422)=>Object.assign(new Error(message),{code:'REDIS_COMMISSIONING_HTTP_INPUT',status});
function query(url,allowed){
  const names=new Set();
  for(const key of url.searchParams.keys()){
    if(!allowed.includes(key)||names.has(key))throw fail('Use the supported commissioning query fields.');
    names.add(key);
  }
}
function fields(value,names){
  if(Object.keys(value).some(key=>!names.includes(key)))throw fail('Use the original commissioning fields.');
}
export async function handleRedisCommissioningHttp({workspace,req,res,url,origin,json,body}){
  if(!url.pathname.startsWith('/api/commissioning/'))return false;
  const command=url.pathname.slice('/api/commissioning/'.length);
  if(req.method==='GET'){
    if(command==='template'){
      query(url,['revision']);json(res,200,await workspace.commissioningTemplate({revisionId:url.searchParams.get('revision')??undefined}));return true;
    }
    if(command==='history'){
      query(url,['after','limit']);json(res,200,await workspace.commissioningHistory({after:url.searchParams.get('after')??'',limit:Number(url.searchParams.get('limit')??20)}));return true;
    }
    if(command==='operation'){
      query(url,['id']);const record=workspace.operation(url.searchParams.get('id'));
      if(!record.kind.startsWith('commission-'))throw fail('Choose an original commissioning operation.',404);
      json(res,200,record);return true;
    }
    if(command==='rows'){
      query(url,['run','check','cursor','limit']);
      json(res,200,await workspace.commissioningRows({runId:url.searchParams.get('run'),checkId:url.searchParams.get('check'),
        cursor:url.searchParams.get('cursor')??'',limit:Number(url.searchParams.get('limit')??50)}));return true;
    }
    if(command==='handover'){
      query(url,['id']);const file=await workspace.commissioningFile(url.searchParams.get('id'));
      res.writeHead(200,{'content-type':file.type,'content-length':file.bytes.length,
        'content-disposition':'attachment; filename="'+file.name+'"','cache-control':'no-store',
        'x-content-type-options':'nosniff','referrer-policy':'no-referrer','x-content-sha256':file.sha256});
      res.end(file.bytes);return true;
    }
  }
  if(req.method==='POST'&&!url.search){
    if(req.headers.origin!==origin)throw fail('Send the operation from this original workspace origin.',403);
    const input=await body(req,5242880);
    if(command==='review'){json(res,200,await workspace.commissioningReview(input));return true;}
    if(command==='save'){
      const result=await workspace.commissioningSave(input);json(res,result.status==='FAILED'?422:200,result);return true;
    }
    if(command==='receive'){json(res,202,workspace.commissioningReceive(input));return true;}
    if(command==='continue'){
      fields(input,['requestId']);json(res,202,workspace.commissioningContinue(input.requestId));return true;
    }
    if(command==='handover'){json(res,202,await workspace.commissioningHandover(input));return true;}
  }
  json(res,404,{error:'REDIS_COMMISSIONING_ROUTE_NOT_FOUND',message:'Choose an existing commissioning action.'});return true;
}
