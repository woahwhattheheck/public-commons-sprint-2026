import {createHash} from 'node:crypto';
import {classify} from './model.mjs';

const VALID_CURRENCIES=new Set(['USD','EUR','GBP','CAD','AUD','JPY']);
const TERMINAL=new Set(['SUCCESS','FAILED','RETURNED','BLOCKED','DENIED','REFUNDED','UNCLAIMED']);
export function cents(value,currency='USD'){
  if(!VALID_CURRENCIES.has(currency))throw new Error('unsupported amount currency');
  const minor=currency==='JPY'?0:2;
  const pattern=minor===0?/^\d{1,11}$/:/^\d{1,11}(?:\.\d{1,2})?$/;
  if(typeof value!=='string'||!pattern.test(value))throw new Error('invalid exact amount string');
  const [whole,decimal='']=value.split('.');
  return BigInt(whole)*BigInt(10**minor)+BigInt(decimal.padEnd(minor,'0')||0);
}
export function money(amount,currency){
  const minor=currency==='JPY'?0:2;
  const v=BigInt(amount), base=BigInt(10**minor);
  return minor===0?v.toString():`${v/base}.${(v%base).toString().padStart(minor,'0')}`;
}
function hash(value){return createHash('sha256').update(value).digest('hex');}
function shortReceiver(value){
  const s=String(value||'');
  if(!s)return '(absent)';
  const at=s.indexOf('@');
  return at>0?`${s[0]}***@${s.slice(at+1).replace(/^[^.]+/, '***')}`:`***${s.slice(-4)}`;
}
function canonicalSnapshot(pages){
  if(!Array.isArray(pages)||!pages.length||pages.length>10)throw new Error('invalid pages');
  const header=pages[0].batch_header;
  if(!header||typeof header.payout_batch_id!=='string')throw new Error('missing PayPal batch header');
  const id=header.payout_batch_id;
  let expected=Number(pages[0].total_pages??1);
  if(!Number.isSafeInteger(expected)||expected<1||expected>10)throw new Error('unsupported page count');
  if(pages.length!==expected)throw new Error('partial pagination: no complete reconciliation');
  const items=[];
  for(const page of pages){
    if(page.batch_header?.payout_batch_id!==id)throw new Error('batch ID changed across pages');
    if(Number(page.total_pages??1)!==expected)throw new Error('page count changed');
    if(!Array.isArray(page.items))throw new Error('missing page items');
    items.push(...page.items);
    if(items.length>1000)throw new Error('too many payout items');
  }
  const declared=Number(pages[0].total_items??items.length);
  if(!Number.isSafeInteger(declared)||declared<0||declared!==items.length)throw new Error('incomplete item count');
  return {header,items,id};
}
export function reconcile(pages,{source='fixture',now=new Date().toISOString()}={}){
  const {header,items,id}=canonicalSnapshot(pages);
  const currency=String(header.amount?.currency||'USD').toUpperCase();
  const seenItems=new Set(),seenSender=new Set();
  let amountTotal=0n;const rows=[];let unresolved=0;
  for(let index=0;index<items.length;index++){
    const raw=items[index]; const data=raw.payout_item||{};
    const itemId=String(raw.payout_item_id||`missing-id-${index}`);
    if(seenItems.has(itemId))throw new Error('duplicated provider payout_item_id across pages');
    seenItems.add(itemId);
    const senderItemId=String(data.sender_item_id||'');
    const key=senderItemId||itemId;
    const duplicate=seenSender.has(key);seenSender.add(key);
    const status=String(raw.transaction_status||'UNKNOWN').toUpperCase();
    if(!TERMINAL.has(status))unresolved++;
    const c=String(data.amount?.currency||currency).toUpperCase();
    const amount=cents(String(data.amount?.value??''),c);
    if(c!==currency)throw new Error('mixed currencies need explicit separate reconciliation');
    amountTotal+=amount;
    const notes=String(data.note||'').slice(0,320);
    const ml=classify(notes);
    const flags=[];
    if(duplicate)flags.push('DUPLICATE_SENDER_ITEM_ID');
    if(!TERMINAL.has(status))flags.push('NONFINAL_STATUS');
    if(status==='FAILED'||status==='DENIED'||status==='BLOCKED'||status==='RETURNED')flags.push('FAILED_OR_RETURNED');
    if(ml.reviewProbability>=0.67)flags.push('MODEL_NOTE_REVIEW');
    const caseId=hash(`${id}:${itemId}`).slice(0,16);
    rows.push({caseId,itemId,senderItemId,status,currency,amount:money(amount,c),receiver:shortReceiver(data.receiver),note:notes,signals:ml,flags,severity:flags.includes('FAILED_OR_RETURNED')?'high':flags.length?'review':'clear'});
  }
  const hasDeclared=header.amount?.value!=null;
  const batchAmount=hasDeclared?cents(String(header.amount.value),currency):null;
  const balanced=hasDeclared?batchAmount===amountTotal:null;
  const evidenceHash=hash(JSON.stringify(pages));
  return {
    id,status:String(header.batch_status||'UNKNOWN'),source,evidenceHash,observedAt:now,
    totals:{count:items.length,currency,itemSum:money(amountTotal,currency),declaredBatch:hasDeclared?money(batchAmount,currency):null,match:balanced,unresolved},
    items:rows,
    limitations:[
      'PayPal status and original batch amount are provider facts; machine-learning scores are advisory only.',
      ...(hasDeclared?[]:['Provider batch amount absent: total consistency is unverified.']),
      ...(source==='fixture'?['All displayed payout records are synthetic fixtures, not live payments.']:[])
    ]
  };
}
