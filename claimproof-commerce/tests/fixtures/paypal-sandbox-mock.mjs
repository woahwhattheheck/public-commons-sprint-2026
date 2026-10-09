// Isolated child-process fixture. No external network is delegated.
let creates=0,captures=0,auth=0,afterCaptureReads=0;
const id='ORDER123456789';
const amount={currency_code:'USD',value:'19.99'};
const result=data=>({ok:true,status:200,json:async()=>data});
globalThis.fetch=async(url,options={})=>{
  if(!String(url).startsWith('https://api-m.sandbox.paypal.com/'))throw new Error('unexpected external URL');
  if(url.endsWith('/token')){auth++;return result({access_token:'synthetic-token',expires_in:300})}
  if(url.endsWith('/capture')){captures++;await new Promise(r=>setTimeout(r,10));return result({id,status:'COMPLETED'})}
  if(options.method==='POST'){creates++;await new Promise(r=>setTimeout(r,10));return result({id,status:'CREATED',links:[{rel:'approve',href:'https://www.sandbox.paypal.com/checkoutnow?token='+id}]})}
  const unit={amount};
  if(captures){afterCaptureReads++;unit.payments={captures:[{id:'CAPTURE123456',status:afterCaptureReads===1?'PENDING':'COMPLETED',amount}]}}
  return result({id,intent:'CAPTURE',status:captures?'COMPLETED':'APPROVED',purchase_units:[unit]});
};
process.on('message',message=>{if(message==='stats')process.send({creates,captures,auth})});
