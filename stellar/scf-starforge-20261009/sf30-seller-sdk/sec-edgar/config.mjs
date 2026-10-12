// MIT. Immutable SEC data editions offered through the original SF30 seller.
import {readFile,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {compileHttpSellerOffer} from '../seller.mjs';
import {compileSellerRoutes} from '../resource-server.mjs';
import {compileSellerOpenApi} from '../developer-portal.mjs';

export const SCHEMA='stellar-forge.sec-edgar-merchant.v1';
export const SOURCE_ORIGIN='https://data.sec.gov';
export const DOCUMENTATION='https://www.sec.gov/search-filings/edgar-application-programming-interfaces';
export const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
export const json=v=>JSON.stringify(v,null,2)+'\n';
export const sha256=v=>createHash('sha256').update(v).digest('hex');
export function fail(message,status=400,code='EDGAR_INPUT_INVALID'){
  throw Object.assign(new Error(message),{status,code});
}
export function fields(value,allowed,label){
  if(!object(value)||Object.keys(value).some(key=>!allowed.includes(key)))fail('Invalid '+label+' fields.');
}
export function text(value,label,max=256){
  if(typeof value!=='string'||!value.trim()||value.length>max||/[\x00-\x1f\x7f]/.test(value))fail('Invalid '+label+'.');
  return value;
}
export function cik(value){
  const v=String(value??'');
  if(!/^\d{1,10}$/.test(v)||BigInt(v)===0n)fail('Use the company’s 1–10 digit SEC CIK.');
  return v.padStart(10,'0');
}
export function editionId(value){
  if(typeof value!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(value))fail('Use an edition ID containing letters, digits, underscores or hyphens.');
  return value;
}
export function date(value,label='date'){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))fail('Use YYYY-MM-DD for '+label+'.');
  const d=new Date(value+'T00:00:00Z');
  if(!Number.isFinite(d.valueOf())||d.toISOString().slice(0,10)!==value)fail('Invalid '+label+'.');
  return value;
}
export function sourceUrl(kind,company){
  if(!['facts','filings'].includes(kind))fail('Choose facts or filings.');
  return SOURCE_ORIGIN+(kind==='facts'?'/api/xbrl/companyfacts/':'/submissions/')+'CIK'+cik(company)+'.json';
}
export function conceptKey(value){
  if(typeof value!=='string'||!/^[A-Za-z_][A-Za-z0-9._-]{0,127}:[A-Za-z_][A-Za-z0-9._-]{0,255}$/.test(value))fail('Use a taxonomy:concept identifier.');
  return value;
}
export const QUERY_FIELDS=Object.freeze({
  facts:['taxonomy','concept','unit','form','accession','filedFrom','filedTo','periodFrom','periodTo','limit','cursor'],
  filings:['form','accession','filedFrom','filedTo','limit','cursor']
});
const DESCRIPTIONS={
  taxonomy:'SEC XBRL taxonomy; restricted to the merchant’s selected concepts',
  concept:'Exact XBRL concept tag, preserving the original units and filing versions',
  unit:'Exact reported unit, such as USD, shares or USD/shares',
  form:'Exact filing form, including amendment suffix when present',
  accession:'Original SEC accession number',
  filedFrom:'Inclusive earliest filing date (YYYY-MM-DD)',
  filedTo:'Inclusive latest filing date (YYYY-MM-DD); filters what was filed by that date',
  periodFrom:'Inclusive earliest original period end (YYYY-MM-DD)',
  periodTo:'Inclusive latest original period end (YYYY-MM-DD)',
  limit:'Number of rows in this page, within the merchant’s configured maximum',
  cursor:'Exact nextCursor returned by this edition and query'
};
export function validateEdgarQuery(product,input={}){
  fields(input,QUERY_FIELDS[product.kind]??[],'EDGAR query');
  const q={};
  for(const [key,value] of Object.entries(input)){
    if(value===undefined||value===null||value==='')continue;
    if(key==='limit'){
      const v=String(value);
      if(!/^[1-9]\d*$/.test(v)||!Number.isSafeInteger(Number(v))||Number(v)>product.maxPageSize)fail('Choose a page size from 1 to '+product.maxPageSize+'.');
      q.limit=Number(v);
    }else if(['filedFrom','filedTo','periodFrom','periodTo'].includes(key))q[key]=date(value,key);
    else q[key]=text(value,key,key==='cursor'?2048:300);
  }
  q.limit??=Math.min(25,product.maxPageSize);
  for(const [from,to] of [['filedFrom','filedTo'],['periodFrom','periodTo']]){
    if(q[from]&&q[to]&&q[from]>q[to])fail(from+' must precede '+to+'.');
  }
  if(q.accession&&!/^\d{10}-\d{2}-\d{6}$/.test(q.accession))fail('Use the complete SEC accession number.');
  if(q.form&&product.forms?.length&&!product.forms.includes(q.form))fail('Choose a filing form offered by this product.');
  if(product.kind==='facts'){
    if(q.taxonomy&&!/^[A-Za-z_][A-Za-z0-9._-]{0,127}$/.test(q.taxonomy))fail('Invalid taxonomy.');
    if(q.concept&&!/^[A-Za-z_][A-Za-z0-9._-]{0,255}$/.test(q.concept))fail('Invalid concept.');
    if((q.taxonomy||q.concept)&&!product.concepts.some(key=>{
      const [taxonomy,concept]=key.split(':');
      return (!q.taxonomy||q.taxonomy===taxonomy)&&(!q.concept||q.concept===concept);
    }))fail('Choose one of this product’s selected concepts.');
  }
  return q;
}
export function compileEdgarMerchant(input){
  fields(input,['schema','title','publicOrigin','products'],'merchant');
  if(input.schema!==SCHEMA)fail('Expected '+SCHEMA+'.');
  const config=structuredClone(input);
  text(config.title,'merchant title',120);
  let origin;try{origin=new URL(config.publicOrigin);}catch{fail('Use the merchant’s public HTTPS origin.');}
  if(origin.protocol!=='https:'||origin.origin!==config.publicOrigin||origin.username||origin.password)fail('Use a public HTTPS origin without a path.');
  if(!Array.isArray(config.products)||config.products.length<1||config.products.length>64)fail('Configure 1–64 company-data products.');
  const ids=new Set(),paths=new Set(),products=[],routes=[];
  for(const p of config.products){
    fields(p,['id','path','kind','cik','editionId','sourceSha256','description','concepts','forms','maxPageSize','paymentOptions','example'],'product');
    if(!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(p.id??'')||ids.has(p.id))fail('Use a unique product ID.');
    if(!/^\/[A-Za-z0-9_/-]+$/.test(p.path??'')||p.path.includes('//')||p.path.startsWith('/_seller/')||paths.has(p.path))fail('Use a unique fixed product route.');
    if(!Object.hasOwn(QUERY_FIELDS,p.kind))fail('Choose facts or filings.');
    p.cik=cik(p.cik);editionId(p.editionId);
    if(!/^[a-f0-9]{64}$/.test(p.sourceSha256??''))fail('Bind the product to the selected edition’s source SHA-256.');
    text(p.description,'description',512);
    p.concepts??=[];p.forms??=[];p.maxPageSize??=100;p.example??={limit:String(Math.min(25,p.maxPageSize))};
    if(!Number.isSafeInteger(p.maxPageSize)||p.maxPageSize<1||p.maxPageSize>1000)fail('Use a maximum page size from 1 to 1,000.');
    if(!Array.isArray(p.concepts)||p.concepts.length>256||new Set(p.concepts).size!==p.concepts.length)fail('Choose unique XBRL concepts.');
    if(p.kind==='facts'&&!p.concepts.length)fail('Select at least one XBRL concept for a facts product.');
    if(p.kind==='filings'&&p.concepts.length)fail('Concept selection belongs to facts products.');
    p.concepts.forEach(conceptKey);
    if(!Array.isArray(p.forms)||p.forms.length>64||new Set(p.forms).size!==p.forms.length)fail('Choose unique filing forms.');
    p.forms.forEach(v=>text(v,'filing form',32));
    validateEdgarQuery(p,p.example);
    const parameters=QUERY_FIELDS[p.kind].map(name=>({name,type:'string',required:false,
      description:DESCRIPTIONS[name],example:p.example[name]===undefined?'':String(p.example[name])}));
    const offer=compileHttpSellerOffer({url:config.publicOrigin+p.path,method:'GET',
      description:p.description,serviceName:config.title,tags:['company-data','sec-edgar',p.kind],
      paymentOptions:p.paymentOptions,queryParameters:parameters,mimeType:'application/json'});
    for(const parameter of parameters){
      const schema=offer.extensions.bazaar.schema.properties.input.properties.queryParams.properties[parameter.name];
      schema.maxLength=parameter.name==='cursor'?2048:300;
      if(p.example[parameter.name]===undefined)delete offer.extensions.bazaar.info.input.queryParams[parameter.name];
    }
    const product={...p,offer};
    products.push(product);ids.add(p.id);paths.add(p.path);
    routes.push({id:p.id,path:p.path,offer,validateInput:true,handler:p.id,admit:p.id+'Admission'});
  }
  const service={schema:'stellar-forge.seller-service.v1',publicOrigin:config.publicOrigin,
    handlerTimeoutMs:15000,maxResponseBytes:8388608,routes};
  compileSellerRoutes(routes.map(({id,offer})=>({id,offer,handler:async()=>({status:503,body:null})})));
  const serialized=json(config);
  if(Buffer.byteLength(serialized)>1048576)fail('Keep the normalized merchant configuration within 1 MiB.');
  return {config,products,service,inputSha256:sha256(serialized)};
}
export function merchantOpenApi(compiled,mode='CHALLENGE_ONLY'){
  return compileSellerOpenApi(compileSellerRoutes(compiled.service.routes.map(({id,offer})=>({
    id,offer,handler:async()=>({status:503,body:null})
  }))),{mode});
}
export function merchantReview(compiled){
  return {schema:'stellar-forge.sec-edgar-review.v1',title:compiled.config.title,publicOrigin:compiled.config.publicOrigin,
    inputSha256:compiled.inputSha256,documentation:DOCUMENTATION,
    products:compiled.products.map(({offer,...p})=>({...p,paymentOptions:offer.accepts})),
    dates:'Original filing dates and fiscal periods. Period filters use the reported period end.',
    numbers:'Reported numeric values are exact decimal strings with valueType=number.',
    versions:'Distinct accessions and filing dates remain separate rows.',
    paging:'Each cursor is bound to one source edition, product selection and query.'};
}
export function buyerHandoff(compiled){
  return {schema:'stellar-forge.sec-edgar-buyer-handoff.v1',title:compiled.config.title,
    merchantOrigin:compiled.config.publicOrigin,inputSha256:compiled.inputSha256,
    products:compiled.products.map(p=>{
      const url=new URL(p.path,compiled.config.publicOrigin);
      for(const [key,value] of Object.entries(p.example))url.searchParams.set(key,String(value));
      return {id:p.id,description:p.description,request:{method:'GET',url:url.href,query:p.example},
        editionId:p.editionId,sourceSha256:p.sourceSha256,cik:p.cik,kind:p.kind,
        paymentOptions:p.offer.accepts};
    }),
    client:{module:'./client/seller-client.mjs',factory:'createSellerClient',
      buyer:'Use the existing configured SF31/SF88 buyer and its approval, spending ledger and native signer.'}};
}
export async function readEdgarMerchant(file){
  const path=resolve(file),s=await lstat(path);
  if(!s.isFile()||s.isSymbolicLink()||s.size>1048576)fail('Use a regular merchant JSON file up to 1 MiB.');
  return compileEdgarMerchant(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readFile(path))));
}

