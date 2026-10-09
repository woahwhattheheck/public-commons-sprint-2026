/** Sandbox-only READ endpoints. No POST payout operation exists here. */
const BASE='https://api-m.sandbox.paypal.com';
const MAX_PAGE_BYTES=400_000;
async function boundedJson(response){
  if(!response.ok){
    throw new Error(`PayPal sandbox HTTP ${response.status}${response.status===403?' (Payouts scope may be unavailable)':''}`);
  }
  const reader=response.body?.getReader();
  if(!reader)throw new Error('empty PayPal response');
  const buffers=[];let length=0;
  try{
    while(true){
      const {value,done}=await reader.read();if(done)break;
      length+=value.byteLength;
      if(length>MAX_PAGE_BYTES)throw new Error('PayPal response exceeds page size limit');
      buffers.push(value);
    }
  }finally{reader.releaseLock();}
  const output=new Uint8Array(length);let pos=0;
  for(const part of buffers){output.set(part,pos);pos+=part.byteLength;}
  let result;
  try{
    result=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(output));
  }catch{
    // Parser errors can quote provider bodies; never pass them to the browser.
    throw new Error('PayPal response is not valid UTF-8 JSON');
  }
  if(!result||typeof result!=='object'||Array.isArray(result))throw new Error('PayPal response is not an object');
  return result;
}
async function call(url,opts){
  // Never follow credentials-bearing requests to a redirect or production origin.
  const response=await fetch(url,{...opts,redirect:'error',signal:AbortSignal.timeout(9000)});
  return boundedJson(response);
}
function credentials(){
  const id=process.env.PAYPAL_CLIENT_ID,secret=process.env.PAYPAL_CLIENT_SECRET;
  if(!id||!secret)throw new Error('PayPal sandbox credentials are not configured; fixture mode remains available');
  return {id,secret};
}
async function oauth(){
  const {id,secret}=credentials();
  const token=await call(`${BASE}/v1/oauth2/token`,{
    method:'POST',
    headers:{Authorization:`Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,'Content-Type':'application/x-www-form-urlencoded'},
    body:'grant_type=client_credentials'
  });
  if(typeof token.access_token!=='string'||!token.access_token)throw new Error('sandbox token missing');
  return token.access_token;
}
export async function fetchBatch(batchId){
  if(typeof batchId!=='string'||! /^[A-Za-z0-9_-]{3,64}$/.test(batchId))throw new Error('invalid payout batch ID');
  const token=await oauth();
  const pages=[];
  let expectedPages=null;
  const seenItemIds=new Set();
  for(let page=1;page<=10;page++){
    const url=`${BASE}/v1/payments/payouts/${encodeURIComponent(batchId)}?page=${page}&page_size=100&total_required=true`;
    const payload=await call(url,{method:'GET',headers:{Authorization:`Bearer ${token}`,Accept:'application/json'}});
    if(payload.batch_header?.payout_batch_id!==batchId)throw new Error('sandbox returned an unexpected payout batch');
    const total=Number(payload.total_pages??1);
    if(!Number.isSafeInteger(total)||total<1||total>10)throw new Error('payout batch exceeds supported pages');
    if(expectedPages===null)expectedPages=total;
    else if(total!==expectedPages)throw new Error('payout batch pagination changed during read; retry sync');
    // A changing live batch must not silently reuse a payout item across pages.
    for(const item of payload.items??[]){
      const itemId=item?.payout_item_id;
      if(typeof itemId!=='string'||!itemId)continue;
      if(seenItemIds.has(itemId))throw new Error('payout item repeated during pagination; retry sync');
      seenItemIds.add(itemId);
    }
    pages.push(payload);
    if(page===expectedPages)return pages;
  }
  throw new Error('payout batch pagination exceeded');
}
