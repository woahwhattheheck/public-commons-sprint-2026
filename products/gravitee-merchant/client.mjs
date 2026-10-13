// SPDX-License-Identifier: MIT
export const READ_METHODS=['view','list','get','readObject','readSource','readDraft','readCapture'];
export const WRITE_METHODS=['saveConnection','importSource','saveDraft','capture','prepareOperation','refreshOperation','executeOperation','reconcileOperation','commission','probe','addNote','exportHandover'];
export function createGraviteeWorkspaceClient({url,token,workspaceId,fetch=globalThis.fetch}={}) {
  const base=new URL(url);token??=base.hash.slice(1);base.hash='';
  if(!['http:','https:'].includes(base.protocol)||base.username||base.password||base.search)throw new TypeError('Use the original workspace URL.');
  if(!token)throw new TypeError('The workspace access token is required.');
  async function action(method,input={},options={}) {
    if(!READ_METHODS.includes(method)&&!WRITE_METHODS.includes(method))throw new TypeError('Unknown workspace action.');
    const args={...input};
    if(WRITE_METHODS.includes(method)&&!['refreshOperation','executeOperation','reconcileOperation'].includes(method))args.requestId??=globalThis.crypto.randomUUID();
    const request={method,input:args};
    let response;
    try{
      response=await fetch(new URL('/api/action',base),{method:'POST',headers:{'content-type':'application/json','x-workspace-token':token,...(workspaceId?{'x-workspace-id':workspaceId}:{})},
        body:JSON.stringify(request),signal:options.signal,redirect:'error',credentials:'omit'});
      const text=await response.text();let value;try{value=JSON.parse(text);}catch{throw new Error('The workspace returned an incomplete JSON response.');}
      if(!response.ok||value.ok!==true)throw Object.assign(new Error(value.error?.message??'The original workspace request failed.'),value.error??{status:response.status});
      return value.result;
    }catch(error){error.originalRequest=request;error.requestId=args.requestId??null;throw error;}
  }
  async function download(reference,options={}) {
    const endpoint=new URL('/api/object',base);endpoint.searchParams.set('sha256',reference.sha256);endpoint.searchParams.set('bytes',String(reference.bytes));
    const response=await fetch(endpoint,{headers:{'x-workspace-token':token,...(workspaceId?{'x-workspace-id':workspaceId}:{})},signal:options.signal,redirect:'error',credentials:'omit'});
    if(!response.ok)throw new Error('The retained file could not be read: '+response.status);
    const bytes=await response.arrayBuffer();
    if(bytes.byteLength!==reference.bytes)throw new Error('The retained file length differs from its original reference.');
    const hash=[...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
    if(hash!==reference.sha256)throw new Error('The retained file differs from its original SHA-256.');
    return bytes;
  }
  return{action,download,read:method=>input=>action(method,input)};
}
