// Complete original OTF workbook transformation; no network or external writes.
import { inflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';

export const ISSUER_TEMPLATE = Object.freeze({
  file: 'Budget_Template-RFP-2026.original.xlsx',
  sha256: '1994a0b3ad589193c6ff8dd29bf8a9d08dfa4c6e85eebdb4a6aa5c9d994ce55d',
  bytes: 5983,
  source: 'https://docs.google.com/spreadsheets/d/16aSRmyc9-s6T8ob3fkEiOFl9_MYGoihs/edit?gid=1909710743#gid=1909710743',
  sheet: 'RRF RFP Budget Template 2026 (',
  worksheet: 'xl/worksheets/sheet1.xml',
  ceilingCents: 15000000
});
const encode = s => new TextEncoder().encode(s);
const decode = b => new TextDecoder('utf-8', {fatal:true}).decode(b);
const digest = b => createHash('sha256').update(b).digest('hex');
const bytes = b => b instanceof Uint8Array ? b : new Uint8Array(b);
const view = b => new DataView(b.buffer, b.byteOffset, b.byteLength);
const join = parts => {
  const result = new Uint8Array(parts.reduce((n,p)=>n+p.length,0));
  let i=0; for(const p of parts){result.set(p,i);i+=p.length;} return result;
};
const fail = message => { throw new Error(message); };
let table;
function crc32(b) {
  if(!table) table=Uint32Array.from({length:256},(_,i)=>{let c=i;for(let j=0;j<8;j++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
  let c=0xffffffff;for(const n of b)c=table[(c^n)&255]^(c>>>8);return(c^0xffffffff)>>>0;
}
export function readWorkbookZip(input) {
  const raw=bytes(input);
  if(raw.length>10000000||raw.length<22)fail('Workbook ZIP size outside supported range');
  const v=view(raw);let end=raw.length-22;
  while(end>=Math.max(0,raw.length-65557)&&v.getUint32(end,true)!==0x06054b50)end--;
  if(end<0||v.getUint16(end+4,true)||v.getUint16(end+6,true))fail('Single-volume ZIP required');
  if(end+22+v.getUint16(end+20,true)!==raw.length)fail('Invalid ZIP end');
  const count=v.getUint16(end+10,true),offset=v.getUint32(end+16,true),length=v.getUint32(end+12,true);
  if(count!==v.getUint16(end+8,true)||count>200||offset+length!==end)fail('Invalid ZIP catalogue');
  let p=offset,total=0;const names=new Set(),members=[];
  for(let i=0;i<count;i++){
    if(p+46>end||v.getUint32(p,true)!==0x02014b50)fail('Invalid ZIP member');
    const flags=v.getUint16(p+8,true),method=v.getUint16(p+10,true),crc=v.getUint32(p+16,true);
    const packed=v.getUint32(p+20,true),size=v.getUint32(p+24,true);
    const nl=v.getUint16(p+28,true),el=v.getUint16(p+30,true),cl=v.getUint16(p+32,true),local=v.getUint32(p+42,true);
    const finish=p+46+nl+el+cl;if(finish>end||flags&1||![0,8].includes(method))fail('Unsupported ZIP member');
    const name=decode(raw.slice(p+46,p+46+nl));
    if(!name||names.has(name)||name.startsWith('/')||name.split('/').some(x=>x==='..')||name.includes('\\'))fail('Invalid or duplicate ZIP path');
    names.add(name);total+=size;if(total>20000000)fail('Workbook expanded size too large');
    if(local+30>offset||v.getUint32(local,true)!==0x04034b50)fail('Invalid local ZIP header');
    const lnl=v.getUint16(local+26,true),lel=v.getUint16(local+28,true),start=local+30+lnl+lel;
    if(decode(raw.slice(local+30,local+30+lnl))!==name||start+packed>offset)fail('ZIP member binding mismatch');
    const compressed=raw.slice(start,start+packed);
    const content=method===0?compressed:bytes(inflateRawSync(compressed,{maxOutputLength:size+1}));
    if(content.length!==size||crc32(content)!==crc)fail('ZIP content checksum mismatch: '+name);
    members.push({name,content,compressed,method,flags,local:raw.slice(local,start),central:raw.slice(p,finish)});
    p=finish;
  }
  if(p!==end)fail('ZIP catalogue boundary mismatch');
  return {members,comment:raw.slice(end+22)};
}
export function writeWorkbookZip(archive, replacements) {
  const chunks=[],centrals=[];let offset=0;
  for(const member of archive.members){
    const changed=Object.prototype.hasOwnProperty.call(replacements,member.name);
    const content=changed?bytes(replacements[member.name]):member.content;
    const method=changed?0:member.method,packed=changed?content:member.compressed;
    const local=member.local.slice(),central=member.central.slice(),lv=view(local),cv=view(central),crc=crc32(content);
    // The emitted archive has explicit lengths, including when an input used a data descriptor.
    lv.setUint16(8,method,true);cv.setUint16(10,method,true);
    lv.setUint16(6,member.flags&~8,true);lv.setUint32(14,crc,true);lv.setUint32(18,packed.length,true);lv.setUint32(22,content.length,true);
    cv.setUint16(8,member.flags&~8,true);cv.setUint32(16,crc,true);cv.setUint32(20,packed.length,true);cv.setUint32(24,content.length,true);cv.setUint32(42,offset,true);
    chunks.push(local,packed);centrals.push(central);offset+=local.length+packed.length;
  }
  for(const name of Object.keys(replacements))if(!archive.members.some(x=>x.name===name))fail('Replacement member missing: '+name);
  const central=join(centrals),end=new Uint8Array(22),e=view(end);
  e.setUint32(0,0x06054b50,true);e.setUint16(8,centrals.length,true);e.setUint16(10,centrals.length,true);e.setUint32(12,central.length,true);e.setUint32(16,offset,true);e.setUint16(20,archive.comment.length,true);
  return join([...chunks,central,end,archive.comment]);
}
const clean = (value,label,max=8000) => {
  if(typeof value!=='string')fail(label+' must be text');
  if(value.length>max||/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value))fail(label+' contains unsupported characters or is too long');
  return value.trim();
};
const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
const validCents = (v,label,max=Number.MAX_SAFE_INTEGER) => {
  if(!Number.isSafeInteger(v)||v<0||v>max)fail(label+' must be nonnegative integer USD cents at or below '+max);
  return v;
};
function cell(xml,ref,value) {
  const re=new RegExp('<c\\b([^>]*\\br="'+ref+'"[^>]*?)(?:\\/>|>[\\s\\S]*?<\\/c>)');
  const match=xml.match(re);if(!match)fail('Original template cell missing: '+ref);
  const attrs=match[1].replace(/\s+t="[^"]*"/g,'');
  const body=value===null?'<c'+attrs+'/>':typeof value==='number'?'<c'+attrs+'><v>'+value+'</v></c>':'<c'+attrs+' t="inlineStr"><is><t xml:space="preserve">'+esc(value)+'</t></is></c>';
  return xml.replace(re,body);
}
export function buildIssuerBudget(template,doc) {
  const original=bytes(template);
  if(original.length!==ISSUER_TEMPLATE.bytes||digest(original)!==ISSUER_TEMPLATE.sha256)fail('Expected exact original 2026 OTF budget workbook');
  if(!doc||typeof doc!=='object'||Array.isArray(doc))fail('Vendor input must be an object');
  const archive=readWorkbookZip(original),sheet=archive.members.find(x=>x.name===ISSUER_TEMPLATE.worksheet);
  if(!sheet)fail('Original worksheet not found');
  const input=doc.budget||{},rates=doc.laborRates||[],missing=[],changes=[];
  if(!Array.isArray(rates)||rates.length>5)fail('Issuer budget permits at most five labor categories');
  const applicant=clean(doc.applicant?.name||'','applicant.name',500);
  if(!applicant)missing.push('applicant.name');
  let xml=decode(sheet.content);
  const put=(ref,value,key)=>{xml=cell(xml,ref,value);changes.push({cell:ref,key,value});};
  put('A4',applicant||null,'applicant.name');
  const seen=new Set(),normalized=[];
  for(let i=0;i<5;i++){
    const ref=i+8,r= rates[i];
    if(!r){put('A'+ref,null,'laborRates['+i+'].title');put('B'+ref,null,'laborRates['+i+'].loadedHourlyCents');continue;}
    const title=clean(r.title||'','laborRates['+i+'].title',500);
    if(!title)missing.push('laborRates['+i+'].title');
    if(title&&seen.has(title.toLowerCase()))fail('Duplicate labor category: '+title);
    seen.add(title.toLowerCase());
    let cents=null;
    if(r.loadedHourlyCents===null||r.loadedHourlyCents===undefined)missing.push('laborRates['+i+'].loadedHourlyCents');
    else{cents=validCents(r.loadedHourlyCents,'laborRates['+i+'].loadedHourlyCents',100000000);if(!cents)fail('Loaded hourly rates must be positive');}
    put('A'+ref,title||null,'laborRates['+i+'].title');put('B'+ref,cents===null?null:cents/100,'laborRates['+i+'].loadedHourlyCents');
    normalized.push({title,loadedHourlyCents:cents});
  }
  if(!rates.length)missing.push('laborRates');
  const direct=clean(input.otherDirectCostsCategory||'','budget.otherDirectCostsCategory',120);
  if(!direct)missing.push('budget.otherDirectCostsCategory');
  put('A16',direct||null,'budget.otherDirectCostsCategory');
  let directCents=null;
  if(input.otherDirectCostsCents===null||input.otherDirectCostsCents===undefined)missing.push('budget.otherDirectCostsCents');
  else directCents=validCents(input.otherDirectCostsCents,'budget.otherDirectCostsCents',ISSUER_TEMPLATE.ceilingCents);
  put('B16',directCents===null?null:directCents/100,'budget.otherDirectCostsCents');
  let ceiling=null;
  if(input.requestedContractCeilingCents===null||input.requestedContractCeilingCents===undefined)missing.push('budget.requestedContractCeilingCents');
  else{ceiling=validCents(input.requestedContractCeilingCents,'budget.requestedContractCeilingCents',ISSUER_TEMPLATE.ceilingCents);if(!ceiling)fail('Requested total contract value must be positive');}
  if(ceiling!==null&&directCents!==null&&directCents>ceiling)fail('Evaluation direct costs exceed requested contract ceiling');
  put('B17',ceiling===null?null:ceiling/100,'budget.requestedContractCeilingCents');
  const originalStyles=archive.members.find(x=>x.name==='xl/styles.xml');
  let styles=decode(originalStyles.content);
  const match=styles.match(/<cellXfs count="13">([\s\S]*?)<\/cellXfs>/);
  if(!match)fail('Original workbook styles do not match the retained template');
  const originalXfs=match[1].match(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g);
  if(!originalXfs||originalXfs.length!==13)fail('Original style catalogue changed');
  const wrapStyle=originalXfs[10].replace(/<alignment[^>]*\/>/,'<alignment vertical="top" wrapText="1"/>');
  const moneyStyle=originalXfs[11].replace('numFmtId="0"','numFmtId="164"').replace('/>',' applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf>');
  const nameStyle=originalXfs[3].replace('/>',' applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>');
  styles=styles.replace(match[0],'<cellXfs count="16">'+match[1]+wrapStyle+moneyStyle+nameStyle+'</cellXfs>');
  const setStyle=(ref,index)=>{const re=new RegExp('(<c\\b[^>]*\\br="'+ref+'"[^>]*\\bs=")\\d+(")');if(!re.test(xml))fail('Missing original cell style '+ref);xml=xml.replace(re,(_m,a,b)=>a+index+b);};
  setStyle('A4',15);
  for(let i=8;i<=12;i++){
    setStyle('A'+i,13);setStyle('B'+i,14);
    const title=normalized[i-8]?.title||'';
    const height=Math.max(15,Math.ceil(title.length/43)*15);
    xml=xml.replace(new RegExp('<row r="'+i+'"[^>]*>'),'<row r="'+i+'" ht="'+height+'" customHeight="1">');
  }
  setStyle('A16',13);setStyle('B16',14);
  xml=xml.replace(/<row r="16"[^>]*>/,'<row r="16" ht="'+Math.max(15,Math.ceil(direct.length/43)*15)+'" customHeight="1">');
  const output=writeWorkbookZip(archive,{[ISSUER_TEMPLATE.worksheet]:encode(xml),'xl/styles.xml':encode(styles)});
  const reopened=readWorkbookZip(output);
  const unchanged=archive.members.filter(x=>x.name!==ISSUER_TEMPLATE.worksheet&&x.name!=='xl/styles.xml');
  for(const before of unchanged){const after=reopened.members.find(x=>x.name===before.name);if(!after||digest(before.content)!==digest(after.content))fail('Unrelated template member changed: '+before.name);}
  return {
    bytes:output,
    mapping:{
      schema:'otf-rrf-issuer-budget/v1',currency:'USD',
      original:{...ISSUER_TEMPLATE},output:{file:'Budget_Template-RFP-2026.completed.xlsx',bytes:output.length,sha256:digest(output)},
      applicant, laborRates:normalized, otherDirectCostsCategory:direct, otherDirectCostsCents:directCents, requestedContractCeilingCents:ceiling,
      changes,missing,
      worksheet:ISSUER_TEMPLATE.sheet,layout:{originalStylesPreserved:13,addedStyles:['wrapped category','USD amount','wrapped vendor'],modifiedMembers:[ISSUER_TEMPLATE.worksheet,'xl/styles.xml']},unchangedMembers:unchanged.map(x=>({name:x.name,bytes:x.content.length,sha256:digest(x.content)})),
      interpretation:'Requested contract ceiling for evaluation; no assumed case utilization. At-cost direct expenses remain separate from loaded hourly rates.'
    }
  };
}
