import { createHash } from 'node:crypto';
export const sha = x => createHash('sha256').update(x).digest('hex');
const fields = ['scheme','network','asset','payTo','amount','maxTimeoutSeconds'];
const obj = (v, depth = 0) => {
  if (depth > 48) throw Error('MPP_NESTING_LIMIT');
  if (Array.isArray(v)) return '[' + v.map(x=>obj(x,depth+1)).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+obj(v[k],depth+1)).join(',') + '}';
  return JSON.stringify(v);
};
export function extract(report, flags) {
  const x=[],m=[];
  if (report.x402.status === 'parsed') {
    if(report.serviceUrl && report.serviceUrl !== report.x402.offer.resourceUrl) flags.push('X402_RESOURCE_DIFFERS_FROM_CAPTURE_URL');
    for (const offer of report.x402.offer.options) {
      const row=Object.fromEntries(fields.map(k=>[k,Object.hasOwn(offer,k)?offer[k]:null]));
      if(fields.slice(0,5).some(k=>row[k]===null||row[k]==='')) flags.push('X402_INCOMPLETE_MATERIAL_TERMS');
      if(row.scheme && !['exact','upto'].includes(row.scheme)) flags.push('X402_UNKNOWN_PAYMENT_SCHEME');
      if(row.amount!==null && !/^(0|[1-9][0-9]*)$/.test(row.amount)) flags.push('X402_AMOUNT_NEEDS_SOURCE_REVIEW');
      x.push({...row,originalOfferSha256:offer.originalOfferSha256});
    }
  }
  if (report.mpp.status === 'parsed') for(const c of report.mpp.challenges) {
    if(!c.knownStellarIntent) flags.push('MPP_METHOD_OR_INTENT_NOT_SUPPORTED_ON_STELLAR');
    m.push({method:c.method,intent:c.intent,realm:c.realm,requestSha256:sha(obj(c.advertisedRequest)),challengeId:c.challengeId});
  }
  return {x,m};
}
const id = (rail,row) => rail === 'x402' ? JSON.stringify(fields.map(k=>row[k])) :
  JSON.stringify([row.method,row.intent,row.realm,row.requestSha256]);
const counts = (a,rail) => {
  const m=new Map();
  for(const row of a){const k=id(rail,row),entry=m.get(k)||{row,count:0,opaque:[]};
    entry.count++;entry.opaque.push(rail==='x402'?row.originalOfferSha256:row.challengeId);m.set(k,entry);}
  return m;
};
export function diff(before,after,rail) {
  const a=counts(before,rail),b=counts(after,rail),changes=[],opaque=[];
  for(const k of [...new Set([...a.keys(),...b.keys()])].sort()) {
    const left=a.get(k)?.count||0,right=b.get(k)?.count||0;
    if(left>right) changes.push({rail,kind:'REMOVED',count:left-right,...a.get(k).row});
    if(right>left) changes.push({rail,kind:'ADDED',count:right-left,...b.get(k).row});
    if(a.has(k)&&b.has(k)&&JSON.stringify(a.get(k).opaque.sort())!==JSON.stringify(b.get(k).opaque.sort()))
      opaque.push({rail,kind:rail==='mpp'?'CHALLENGE_ID_ROTATION':'ADDITIONAL_OFFER_FIELDS_OR_ENCODING_CHANGED',materialIdentitySha256:sha(k)});
  }
  return {changes,opaque};
}
