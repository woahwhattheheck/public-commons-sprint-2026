// MIT — TokenJunkieLabs. Rialto catalogue and original-buyer receiving contracts.
export const SCHEMA = 'stellar-forge.rialto-customer.v1';
export const UPSTREAM = {repository:'0d1026/Rialto',commit:'267155c08475ecba40a5b28d7e32a6d005bd956a'};
export const DEFAULTS = {discovery:'https://rialto-production-97c9.up.railway.app',facilitator:'https://facilitator-production-0beb.up.railway.app',network:'stellar:testnet',scheme:'exact',limit:100};
export function need(ok,message){if(!ok)throw new Error(message);}
export function object(x){return x!==null&&typeof x==='object'&&!Array.isArray(x);}
export function integer(n,name,min=0,max=Number.MAX_SAFE_INTEGER){need(Number.isSafeInteger(n)&&n>=min&&n<=max,name+' must be an integer from '+min+' through '+max);return n;}
export function https(raw){need(typeof raw==='string','HTTPS URL required');const u=new URL(raw);need(u.protocol==='https:'&&u.hostname&&!u.username&&!u.password&&!u.hash,'HTTPS URL without credentials or fragment required');return u;}
export function canonical(x){if(x===null||typeof x!=='object')return JSON.stringify(x);if(Array.isArray(x))return '['+x.map(canonical).join(',')+']';return '{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}';}
export function resourceKey(row){need(object(row)&&typeof row.resource==='string'&&typeof(row.toolName??'')==='string','Original resource/tool identity required');return JSON.stringify([row.resource,row.toolName??'']);}
export function parseBody(record){need(object(record)&&typeof record.bodyUtf8==='string','Complete UTF-8 response required');return JSON.parse(record.bodyUtf8);}
export function plan(input){
 need(object(input),'Capture plan required');
 const d=https(input.discovery??DEFAULTS.discovery),f=https(input.facilitator??DEFAULTS.facilitator);
 need(!d.search&&!f.search,'Discovery and facilitator base URLs must not contain queries');
 const value={schema:SCHEMA,upstream:UPSTREAM,discovery:d.href.replace(/\/$/,''),facilitator:f.href.replace(/\/$/,''),network:input.network??DEFAULTS.network,scheme:input.scheme??DEFAULTS.scheme,limit:integer(input.limit??100,'limit',1,100)};
 need(['stellar:testnet','stellar:pubnet'].includes(value.network),'Select a Stellar network');
 need(value.scheme==='exact','This original SF88 receiving route selects exact payments');
 for(const k of ['type','payTo'])if(input[k]!==undefined){need(typeof input[k]==='string'&&input[k].length>0,k+' must be nonempty');value[k]=input[k];}
 if(value.type)need(['http','mcp'].includes(value.type),'Invalid resource type');
 return value;
}
export function pageUrl(p,offset){const u=new URL(p.discovery+'/discovery/resources');for(const k of ['network','scheme','limit','type','payTo'])if(p[k]!==undefined)u.searchParams.set(k,String(p[k]));u.searchParams.set('offset',String(integer(offset,'offset')));return u.href;}
export function page(record,p,offset){
 need(record.status===200,'Catalogue HTTP '+record.status+'; original response is retained');
 need(record.method==='GET'&&record.url===pageUrl(p,offset),'Catalogue page belongs to another request');
 const b=parseBody(record);need(b.x402Version===2&&Array.isArray(b.items)&&object(b.pagination),'Original Rialto list envelope required');
 const q=b.pagination;integer(q.offset,'returned offset');integer(q.limit,'returned limit',1,100);integer(q.total,'reported total');
 need(q.offset===offset&&q.limit===p.limit,'Provider changed requested pagination');
 need(b.items.length<=q.limit,'Page exceeds the advertised limit');
 need(b.items.length>0||offset>=q.total,'Empty page before the reported end; refresh the catalogue in a new edition');
 for(const row of b.items)resourceKey(row);
 return{items:b.items,total:q.total,nextOffset:offset+b.items.length,terminal:offset+b.items.length>=q.total};
}
export function catalogue(p,records){
 let offset=0,terminal=false,rows=[],totals=[],findings=[],occurrences=new Map();
 for(let n=0;n<records.length;n++){
  need(!terminal,'Extra page follows the reported terminal page');
  const read=page(records[n],p,offset);totals.push(read.total);
  for(let j=0;j<read.items.length;j++){const original=read.items[j],key=resourceKey(original);const prior=occurrences.get(key)??[];if(prior.length)findings.push({code:'REPEATED_RESOURCE_IDENTITY',key,previousIndices:prior.slice(),index:rows.length});prior.push(rows.length);occurrences.set(key,prior);rows.push({index:rows.length,page:n,pageRow:j,key,original});}
  offset=read.nextOffset;terminal=read.terminal;
 }
 if(new Set(totals).size>1)findings.push({code:'CATALOGUE_TOTAL_CHANGED_DURING_READ',totals});
 return{schema:SCHEMA,plan:p,rows,pageCount:records.length,sourceTotals:totals,enumerationComplete:terminal,nextOffset:offset,findings,coverage:'Sequential original offset pages; the provider does not expose a snapshot token.',firstObservedAt:records[0]?.retrievedAt??null,lastObservedAt:records.at(-1)?.retrievedAt??null};
}
export function compare(before,after){
 need(before.schema===SCHEMA&&after.schema===SCHEMA,'Two complete Rialto catalogues required');
 const map=c=>{const out=new Map();for(const row of c.rows){const a=out.get(row.key)??[];a.push(row.original);out.set(row.key,a);}return out;};
 const a=map(before),b=map(after),rows=[];
 for(const key of [...new Set([...a.keys(),...b.keys()])].sort()){
  const old=a.get(key)??[],now=b.get(key)??[];
  const state=!old.length?'added':!now.length?'removed':canonical(old)===canonical(now)?'unchanged':'changed';
  let fields=[];if(old.length===1&&now.length===1)fields=[...new Set([...Object.keys(old[0]),...Object.keys(now[0])])].sort().filter(k=>canonical(old[0][k])!==canonical(now[0][k]));
  rows.push({key,state,changedFields:fields,before:old,after:now});
 }
 return{schema:SCHEMA,kind:'catalogue-comparison',beforePlan:before.plan,afterPlan:after.plan,sameScope:canonical(before.plan)===canonical(after.plan),beforeComplete:before.enumerationComplete,afterComplete:after.enumerationComplete,counts:Object.fromEntries(['added','removed','changed','unchanged'].map(k=>[k,rows.filter(r=>r.state===k).length])),rows};
}
export function selection(c,input,catalogueSha256){
 const index=integer(input.rowIndex,'rowIndex',0,c.rows.length-1),entry=c.rows[index],row=entry.original;
 need(c.enumerationComplete,'Finish receiving the original catalogue before selecting');
 need(row.type===undefined||row.type==='http','Use Rialto original MCP tool workflow for an MCP resource');
 const ai=integer(input.acceptIndex,'acceptIndex',0,(row.accepts?.length??0)-1),offer=row.accepts[ai];
 need(object(offer)&&offer.scheme==='exact'&&offer.network===c.plan.network,'Select the original exact offer on the reviewed network');
 need(typeof offer.amount==='string'&&/^[1-9][0-9]*$/.test(offer.amount),'Positive original atomic amount required');
 need(typeof offer.asset==='string'&&typeof offer.payTo==='string','Original asset and recipient required');
 const advertised=https(row.resource),requested=https(input.url);
 need(advertised.origin===requested.origin&&advertised.pathname===requested.pathname&&!/[{}]|%7[bd]/i.test(requested.pathname),'Concrete request must match the selected resource origin/path');
 need(['GET','HEAD','POST','PUT','PATCH','DELETE'].includes(input.method),'Explicit HTTP method required');
 const method=row.extensions?.bazaar?.info?.input?.method;
 need(method===undefined||method===input.method,'Method conflicts with original Bazaar input');
 need(typeof input.intentId==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(input.intentId),'Stable original intent ID required');
 const cap=input.maxAtomic??offer.amount;need(typeof cap==='string'&&/^[1-9][0-9]*$/.test(cap)&&BigInt(cap)>=BigInt(offer.amount),'Explicit cap must cover the selected original offer');
 need(/^[a-f0-9]{64}$/.test(catalogueSha256),'Original catalogue SHA-256 required');
 return{schema:SCHEMA,kind:'selected-customer-request',catalogueSha256,rowIndex:index,page:entry.page,pageRow:entry.pageRow,resourceKey:entry.key,originalListing:row,acceptIndex:ai,selectedTerms:offer,intentId:input.intentId,url:requested.href,method:input.method,maxAtomic:cap,task:typeof input.task==='string'?input.task:'',usefulOutput:typeof input.usefulOutput==='string'?input.usefulOutput:'',facilitator:c.plan.facilitator,network:c.plan.network};
}
export function challenge(selection,value,index){
 need(value.x402Version===2&&object(value.resource)&&Array.isArray(value.accepts),'Actual v2 resource challenge required');
 const advertised=https(value.resource.url),requested=https(selection.url);need(advertised.origin===requested.origin&&advertised.pathname===requested.pathname&&!/[{}]|%7[bd]/i.test(advertised.pathname),'Actual challenge must match the selected resource origin/path');
 integer(index,'challenge accept index',0,value.accepts.length-1);const offer=value.accepts[index],old=selection.selectedTerms;
 need(object(offer),'Original challenge option required');
 for(const key of ['scheme','network','asset','payTo'])need(offer[key]===old[key],'Actual challenge changed '+key+'; receive and select the new source explicitly');
 need(typeof offer.amount==='string'&&/^[1-9][0-9]*$/.test(offer.amount)&&BigInt(offer.amount)<=BigInt(selection.maxAtomic),'Actual challenge exceeds the selected atomic cap');
 integer(offer.maxTimeoutSeconds,'actual authorization timeout',1,86400);
 return{actualTerms:offer,changedAmount:offer.amount!==old.amount,acceptIndex:index,envelope:{mode:'ORIGINAL_UNSIGNED_CATALOG',source:selection.url,sourceEnvelope:'resources',originalListings:[value]}};
}
