// MIT. Fixed stdin operation for the original buyer bookkeeping return.
import {inspectBuyerReturn} from './buyer-return.mjs';
try{
  let size=0;const chunks=[];
  for await(const part of process.stdin){size+=part.length;if(size>180*1024*1024)throw Object.assign(new Error('The original source and return exceed the supported input size.'),{code:'BUYER_RETURN_SIZE'});chunks.push(part);}
  const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if(!value||Object.keys(value).sort().join(',')!=='buyerSourceBase64,packetBase64')throw Object.assign(new Error('Use the fixed original source and returned packet inputs.'),{code:'BUYER_RETURN_INPUT'});
  const decode=x=>{if(typeof x!=='string')throw Error('Use exact base64 original bytes.');const b=Buffer.from(x,'base64');if(!b.length||b.toString('base64')!==x)throw Error('Use exact base64 original bytes.');return b;};
  const result=inspectBuyerReturn({buyerSourceBytes:decode(value.buyerSourceBase64),packetBytes:decode(value.packetBase64)});
  process.stdout.write(JSON.stringify(result)+'\n');
}catch(error){process.stderr.write(JSON.stringify({error:{code:error.code??'BUYER_RETURN_REJECTED',message:error.message,status:error.status??422}})+'\n');process.exitCode=1;}
