// MIT. Browser and Node fetch binding to the original local merchant tariff controller.
const ACTIONS=['status','catalog','selection','capture','inspect','attach','case','restore','download'];
const MUTATIONS=new Set(['capture','attach','restore']);
const HASH=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
export class CommercialTariffError extends Error{
  constructor(message,{code='COMMERCIAL_TARIFF_REQUEST_FAILED',status,requestState}={}){
    super(message);this.name='CommercialTariffError';this.code=code;
    if(status!==undefined)this.status=status;if(requestState)this.requestState=requestState;
  }
}
export function createCommercialTariffClient({url,caseId,workspaceId,fetch:request=globalThis.fetch}={}){
  const base=new URL(url);
  if(base.protocol!=='http:'||!['127.0.0.1','[::1]','localhost'].includes(base.hostname)||
      base.username||base.password||base.search||base.hash||base.pathname!=='/'||
      !UUID.test(caseId??'')||!HASH.test(workspaceId??'')||typeof request!=='function')
    throw new TypeError('Use the original loopback merchant listener, case and workspace identity.');
  const scope=Object.freeze({workspaceId,caseId});
  async function call(action,args={}){
    if(!ACTIONS.includes(action)||!args||typeof args!=='object'||Array.isArray(args))
      throw new TypeError('Choose the original tariff action and arguments.');
    if(args.id!==undefined&&args.id!==caseId||args.scope!==undefined&&
        (args.scope.caseId!==caseId||args.scope.workspaceId!==workspaceId))
      throw new CommercialTariffError('Reopen the original selected merchant workspace and case.',{code:'COMMERCIAL_SCOPE_CHANGED',status:409,requestState:'REJECTED'});
    const body={...args,scope};delete body.id;
    let response;
    try{
      response=await request(new URL('/api/cases/'+caseId+'/commercial/tariff-'+action,base),{
        method:'POST',redirect:'error',credentials:'omit',cache:'no-store',
        headers:{'content-type':'application/json',origin:base.origin},body:JSON.stringify(body)});
    }catch(error){
      throw new CommercialTariffError(String(error.message||error),{
        code:'COMMERCIAL_TARIFF_TRANSPORT',requestState:MUTATIONS.has(action)?'UNKNOWN':undefined});
    }
    if(!response.ok){
      let value;try{value=await response.json();}catch{value={};}
      throw new CommercialTariffError(value.detail||value.error||'The original tariff request did not complete.',
        {code:value.error,status:response.status,requestState:value.requestState??(MUTATIONS.has(action)?'UNKNOWN':undefined)});
    }
    if(action==='download'){
      const encoded=response.headers.get('x-sf74-file-name'),count=response.headers.get('x-sf74-file-bytes');
      const hash=response.headers.get('x-content-sha256'),bytes=new Uint8Array(await response.arrayBuffer());
      if(!encoded||!/^(0|[1-9]\d*)$/.test(count??'')||!HASH.test(hash??'')||
          !Number.isSafeInteger(Number(count))||bytes.length!==Number(count)||await digest(bytes)!==hash)
        throw new CommercialTariffError('The original downloaded tariff file differs from its descriptor.',
          {code:'COMMERCIAL_TARIFF_DOWNLOAD_CHANGED',status:409});
      const filename=decodeURIComponent(encoded);
      if(!filename||/[\\/\0]/.test(filename))throw new CommercialTariffError('The original file name is invalid.');
      return {scope,descriptor:{filename,bytes:bytes.length,sha256:hash,mediaType:response.headers.get('content-type')||'application/octet-stream'},bytes};
    }
    let value;
    try{value=await response.json();}catch{
      throw new CommercialTariffError('The original tariff response is incomplete.',
        {code:'COMMERCIAL_TARIFF_RESPONSE_INCOMPLETE',requestState:MUTATIONS.has(action)?'UNKNOWN':undefined});
    }
    if(value?.scope?.workspaceId!==workspaceId||value.scope.caseId!==caseId)
      throw new CommercialTariffError('The response belongs to another original workspace or case.',
        {code:'COMMERCIAL_SCOPE_CHANGED',status:409,requestState:MUTATIONS.has(action)?'UNKNOWN':undefined});
    return value;
  }
  return Object.freeze({scope,call,...Object.fromEntries(ACTIONS.map(action=>[action,args=>call(action,args)]))});
}
