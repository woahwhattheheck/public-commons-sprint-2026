// MIT. Generated companion. The installed native MPP buyer owns every operation.
const {connect,initialize,source}=await import(new URL('./merchant-client.mjs',import.meta.url).href);
const MAX_INPUT=4*1024*1024,MAX_OUTPUT=6*1024*1024;
const plain=value=>value!==null && typeof value==='object' && !Array.isArray(value);
function requireValue(value,code){if(!value)throw Object.assign(new Error(code),{code});}
async function main() {
  const chunks=[];let size=0;
  for await(const chunk of process.stdin){size+=chunk.length;requireValue(size<=MAX_INPUT,'MPP_CUSTOMER_INPUT_TOO_LARGE');chunks.push(chunk);}
  const input=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(Buffer.concat(chunks)));
  requireValue(plain(input) && Object.keys(input).every(k=>['operation','configuration','contractSha256',
    'offerId','options','purchaseId','destination'].includes(k)),'MPP_CUSTOMER_BRIDGE_INPUT_INVALID');
  requireValue(input.contractSha256===source.contractSha256,'MPP_CUSTOMER_BRIDGE_CONTRACT_CHANGED');
  const allowed=['init','prepare','inspect','execute','resume','finalize','result','save','list','refresh'];
  requireValue(allowed.includes(input.operation),'MPP_CUSTOMER_BRIDGE_OPERATION_INVALID');
  let client,value;
  try {
    if(input.operation==='init')value=await initialize(input.configuration);
    else {
      client=await connect(input.configuration);
      if(input.operation==='prepare')value=await(await client.prepare(input.offerId,input.options)).inspect();
      else if(input.operation==='list')value=await client.list(input.options);
      else if(input.operation==='refresh')value=await client.refresh();
      else {
        const purchase=client.purchase(input.purchaseId);
        if(input.operation==='result'){
          const result=await purchase.result(),bytes=Buffer.from(await result.response.arrayBuffer());
          value={status:result.response.status,headers:Object.fromEntries(result.response.headers),
            bodyBase64:bytes.toString('base64'),bytes:result.bytes,sha256:result.sha256,
            receipt:result.receipt,transaction:result.transaction,accounting:result.accounting,
            contractSha256:result.contractSha256,offerId:result.offerId};
        } else if(input.operation==='save')value=await purchase.save(input.destination);
        else value=await purchase[input.operation]();
      }
    }
  } finally {await client?.close();}
  const output=JSON.stringify({schema:'stellar-forge.mpp-customer-bridge.v1',
    contractSha256:source.contractSha256,operation:input.operation,value})+'\n';
  requireValue(Buffer.byteLength(output)<=MAX_OUTPUT,'MPP_CUSTOMER_OUTPUT_TOO_LARGE');
  process.stdout.write(output);
}
main().catch(error=>{
  const code=typeof error.code==='string' && /^[A-Z0-9_]{1,100}$/.test(error.code)?error.code:'MPP_CUSTOMER_CALL_FAILED';
  process.stderr.write(JSON.stringify({code})+'\n');process.exitCode=2;
});
