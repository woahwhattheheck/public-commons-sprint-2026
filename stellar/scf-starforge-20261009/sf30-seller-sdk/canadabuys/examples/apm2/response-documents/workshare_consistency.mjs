/* Keep commercial edits consistent across an APM2 workshare and its authored response content.
   This module reads selected current-scope fields. It never rewrites authored prose. */
const WORDS = Object.freeze({zero:0,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,seventeen:17,eighteen:18,nineteen:19,twenty:20,thirty:30,forty:40,fifty:50,sixty:60,seventy:70,eighty:80,ninety:90});
const WORD = "(?:" + Object.keys(WORDS).join("|") + "|hundred|thousand)";
const NUMBER = "(?:[0-9]+(?:\\.[0-9]+)?|" + WORD + "(?:[ -]+" + WORD + "){0,8})";
function proseNumber(raw) {
  if (/^[0-9]+(?:\.[0-9]+)?$/.test(raw)) return Number(raw);
  let total=0, group=0;
  for(const token of raw.toLowerCase().split(/[ -]+/)){
    if(Object.hasOwn(WORDS,token)) group+=WORDS[token];
    else if(token==="hundred") group=(group||1)*100;
    else if(token==="thousand"){total+=(group||1)*1000;group=0;}
    else return NaN;
  }
  return total+group;
}
function cents(value) {
  const raw = typeof value==="number" ? String(value) : typeof value==="string" ? value : "";
  if(!/^(?:0|[1-9][0-9]*|[1-9][0-9]{0,2}(?:,[0-9]{3})+)(?:\.[0-9]{1,2})?$/.test(raw)) return null;
  const [whole,fraction=""]=raw.replace(/,/g,"").split(".");
  const amount=BigInt(whole)*100n+BigInt(fraction.padEnd(2,"0"));
  return amount<=BigInt(Number.MAX_SAFE_INTEGER)?amount:null;
}
function claims(text){
  const out=[];
  const re=new RegExp("\\b("+NUMBER+")[\\s-]+(?:(production|partner|review)[\\s-]+)?(hours?|working[\\s-]+days?)\\b","gi");
  for(const match of text.matchAll(re)){
    const value=proseNumber(match[1]);
    if(Number.isFinite(value))out.push({value,role:(match[2]||"").toLowerCase(),unit:/^working/i.test(match[3])?"workingDays":"hours",text:match[0],index:match.index});
  }
  return out;
}
function selectedFields(content) {
  const rows=[];
  const add=(path,text,role)=>{if(typeof text==="string"&&text.trim())rows.push({path,text,role});};
  add("workshareScope",content?.workshareScope,"production");
  add("supplierProfile.capacity.note",content?.supplierProfile?.capacity?.note,"production");
  add("supplierProfile.commercial.note",content?.supplierProfile?.commercial?.note,"production");
  for(const [ai,annex] of (Array.isArray(content?.annexes)?content.annexes:[]).entries()){
    for(const [si,section] of (Array.isArray(annex?.sections)?annex.sections:[]).entries()){
      const title=String(section?.title??"").toLowerCase();
      if(/response engineering scope|commercial and response owner|review allocation/.test(title))
        add("annexes["+ai+"].sections["+si+"].text",section?.text,/review allocation/.test(title)?"partner":"production");
    }
  }
  return rows;
}
/**
 * Return concrete current-scope disagreements before regenerating a reading edition.
 * Monetary values use exact hundredths (the selected APM2 workshare's money format).
 * Unknown prose stays authored; checkedFields/observedClaims disclose what was read.
 */
export function inspectWorkshareConsistency({workshare, content}) {
  const issues=[], observedClaims=[], checkedFields=[];
  const issue=(path,code,message,actual,expected)=>issues.push({path,code,message,actual,expected});
  const w=workshare&&typeof workshare==="object"?workshare:{};
  const fee=cents(w.fee);
  if(fee===null)issue("fee","INVALID_MONEY","Enter a non-negative fee with at most two decimal places.",w.fee??null,"money");
  if(typeof w.currency!=="string"||! /^[A-Z]{3}$/.test(w.currency))issue("currency","INVALID_CURRENCY","Enter the selected three-letter currency code.",w.currency??null,"ISO-style code");
  for(const key of ["productionHours","workingDays","partnerHours"]){
    const value=w[key],valid=typeof value==="number"&&Number.isFinite(value)&&value>=(key==="partnerHours"?0:Number.MIN_VALUE)&&(key!=="workingDays"||Number.isInteger(value));
    if(!valid)issue(key,"INVALID_ALLOCATION","Enter a finite "+(key==="workingDays"?"positive whole number of working days":key==="partnerHours"?"non-negative partner-hour allocation":"positive production-hour allocation")+".",value??null,key);
  }
  if(!Array.isArray(w.milestones)||!w.milestones.length)issue("milestones","MISSING_MILESTONES","Retain the selected commercial milestone allocations.",null,"non-empty array");
  else {
    let sum=0n,valid=true;
    for(const [i,row] of w.milestones.entries()){
      const amount=Array.isArray(row)?cents(row[1]):null;
      if(amount===null){valid=false;issue("milestones["+i+"][1]","INVALID_MILESTONE","Use an unambiguous amount such as 1800 or 1,800.00.",Array.isArray(row)?row[1]??null:row,"money");}
      else sum+=amount;
    }
    if(valid&&fee!==null&&sum!==fee)issue("milestones","MILESTONE_TOTAL","Milestone allocations must add to the selected fee.",sum.toString(),fee.toString());
  }
  for(const row of selectedFields(content)){
    checkedFields.push(row.path);
    const money=/\b([A-Z]{3})\s*((?:[1-9][0-9]{0,2}(?:,[0-9]{3})+|[0-9]+)(?:\.[0-9]{1,2})?)\b/g;
    for(const m of row.text.matchAll(money)){
      // The selected fields describe this workshare. A currency/amount here is a current scope claim.
      const amount=cents(m[2]);observedClaims.push({path:row.path,kind:"fee",text:m[0],currency:m[1],value:m[2]});
      if(m[1]!==w.currency)issue(row.path,"SCOPE_CURRENCY","Update the authored scope currency to match the selected workshare.",m[1],w.currency??null);
      if(amount!==null&&fee!==null&&amount!==fee)issue(row.path,"SCOPE_FEE","Update the authored scope amount to match the selected workshare.",amount.toString(),fee.toString());
    }
    const quantities=claims(row.text);
    const coverIndex=row.role==="partner"?row.text.search(/\b(?:cover|covers|comprise|comprises)\b/i):-1;
    for(const q of quantities){
      // Values following 'cover' in Review allocation are component hours, not the total.
      if(coverIndex>=0&&q.index>coverIndex&&q.unit==="hours"&&!q.role)continue;
      const key=q.unit==="workingDays"?"workingDays":q.role==="partner"||q.role==="review"||row.role==="partner"?"partnerHours":"productionHours";
      observedClaims.push({path:row.path,kind:key,text:q.text,value:q.value});
      if(typeof w[key]==="number"&&Number.isFinite(w[key])&&q.value!==w[key])issue(row.path,"SCOPE_ALLOCATION","Update the authored "+key+" statement to match the selected workshare.",q.value,w[key]);
    }
    if(coverIndex>=0){
      const parts=quantities.filter(q=>q.index>coverIndex&&q.unit==="hours"&&!q.role);
      if(parts.length>1){
        const total=parts.reduce((s,q)=>s+q.value,0);
        observedClaims.push({path:row.path,kind:"partnerAllocationSum",value:total,parts:parts.map(q=>q.text)});
        if(typeof w.partnerHours==="number"&&Math.abs(total-w.partnerHours)>1e-9)issue(row.path,"PARTNER_ALLOCATION_TOTAL","Partner review activities must add to the selected partner-hour allocation.",total,w.partnerHours);
      }
    }
  }
  return {ok:issues.length===0,issues,checkedFields,observedClaims};
}

export function checkWorkshareConsistency(input) {
  return inspectWorkshareConsistency(input).issues;
}
