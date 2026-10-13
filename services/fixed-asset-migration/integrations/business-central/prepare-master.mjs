import {encodeCsv, LIMITS} from '../../engine.mjs';
import {sha256Utf8} from '../../sha256.mjs';

export const CAPTURE_SCHEMA='tjlabs.business-central-master-capture.v1';
const kinds=Object.freeze({
  fixedAssets:{tail:'/fixedAssets',api:'/api/v2.0/',number:'number',description:'displayName',category:'classCode',parent:null},
  maintenanceAssets:{tail:'/assets',api:'/api/dynaway/eam/v1.0/',number:'assetNo',description:'description',category:'categoryCode',parent:'parentAssetNo'}
});
const need=(ok,message)=>{if(!ok)throw new Error(message);};
const value=(x,label,max=1000)=>{need(typeof x==='string'&&x.length>0&&x.length<=max,'Supply '+label+'.');return x;};
const guid=(x,label)=>{value(x,label,36);need(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x),'Use the actual GUID for '+label+'.');return x;};
const field=(row,key)=>{const v=row[key];need(v===undefined||v===null||typeof v==='string','Expected original text in '+key+'.');return v??'';};
const optionalText=(x,label,max=4000)=>{need(x===undefined||x===null||typeof x==='string'&&x.length<=max,'Retain the original text for '+label+'.');return x??null;};
function queryNames(url){
  const query=url.includes('?')?url.slice(url.indexOf('?')+1):'';
  return query.split('&').filter(Boolean).map(part=>{
    try{return decodeURIComponent(part.split('=')[0].replace(/\+/g,' ')).toLowerCase();}
    catch{throw new Error('The retained page query has an invalid escaped field name.');}
  });
}
function pageUrl(input,collectionUrl){
  const url=value(input,'original requested page URL',16000);
  need(url.split('?')[0]===collectionUrl&&!/[\s#\\]/.test(url),'Retain pages only from the selected original company collection.');
  need(!queryNames(url).some(name=>['access_token','client_secret','password','authorization','token','api_key','apikey','sig','signature'].includes(name)),'Keep authentication values out of the capture URL.');
  return url;
}
const artifact=(path,mimeType,text)=>({path,mimeType,text,...sha256Utf8(text)});

/**
 * Convert complete, already-received native master-data pages into the original
 * migration CSV contract. No HTTP, credentials, tenant edits or financial posting.
 * The raw response text stays byte-identical in the returned source artifacts.
 */
export function prepareMasterCapture(capture){
  need(capture&&capture.schema===CAPTURE_SCHEMA,'Use the complete native master capture schema.');
  need(Object.hasOwn(kinds,capture.kind),'Select fixedAssets or maintenanceAssets.');const spec=kinds[capture.kind];
  const companyId=guid(capture.companyId,'native company ID');
  const canonicalCompanyId=value(capture.canonicalCompanyId,'declared original company identifier',128);
  need(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(canonicalCompanyId),'Use the original company identifier accepted by the migration workspace.');
  value(capture.tenantId,'actual tenant identity',200);
  value(capture.environment,'actual environment',200);
  value(capture.observedAt,'actual observation time',64);
  need(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(capture.observedAt)&&Number.isFinite(Date.parse(capture.observedAt))&&new Date(capture.observedAt.slice(0,10)+'T00:00:00Z').toISOString().slice(0,10)===capture.observedAt.slice(0,10),'Use the actual ISO observation timestamp.');
  const collectionUrl=value(capture.collectionUrl,'selected complete collection URL',4000);
  need(/^https:\/\/[^/?#@]+\//i.test(collectionUrl)&&!/[?#\\\s]/.test(collectionUrl),'Supply an HTTPS collection URL without query, credentials, fragment or whitespace.');
  need(collectionUrl.includes(spec.api)&&collectionUrl.endsWith('/companies('+companyId+')'+spec.tail),'The selected URL must identify this API kind and actual company GUID.');
  need(capture.population&&typeof capture.population.complete==='boolean','Declare whether the selected master population is complete.');
  const scopeNote=value(capture.population.description,'actual population and filter description',4000);
  need(Array.isArray(capture.pages)&&capture.pages.length>0&&capture.pages.length<=LIMITS.supportingFiles-4,'Supply the ordered actual response pages within the original attachment limit.');
  const rows=[],identities=[],links=[],files=[],pageManifest=[],seenIds=new Set(),seenNumbers=new Set(),seenUrls=new Set();
  let expectedUrl=null,sourceBytes=0;
  for(let pageIndex=0;pageIndex<capture.pages.length;pageIndex++){
    const page=capture.pages[pageIndex];
    need(page&&page.status===200,'Every retained master page must have actual HTTP 200 status.');
    const url=pageUrl(page.url,collectionUrl);
    need(!seenUrls.has(url),'The original page sequence repeats a URL.');seenUrls.add(url);
    if(pageIndex)need(url===expectedUrl,'The next captured page must exactly match the previous native continuation URL.');
    if(capture.population.complete&&pageIndex===0)need(!queryNames(url).some(name=>['$filter','$top','$skip','$skiptoken','$search','$apply'].includes(name)),'A filtered, limited or resumed first page cannot declare the whole master population complete.');
    const raw=value(page.bodyText,'complete original response text',LIMITS.supportingBytes);
    const identity=sha256Utf8(raw);sourceBytes+=identity.bytes;
    need(identity.bytes<=LIMITS.supportingBytes&&sourceBytes<=LIMITS.workspaceBytes,'Original page bytes exceed the workspace source limits.');
    if(page.sha256!==undefined)need(page.sha256===identity.sha256,'Retained original response hash differs.');
    let data;try{data=JSON.parse(raw);}catch{throw new Error('A retained page is not valid original JSON.');}
    need(data&&Array.isArray(data.value),'Each master page must retain its native value array.');
    const next=data['@odata.nextLink']??null;
    need(next===null||typeof next==='string'&&next.length>0,'The native continuation URL is malformed.');
    if(next!==null)pageUrl(next,collectionUrl);
    expectedUrl=next;
    const path='originals/page-'+String(pageIndex+1).padStart(4,'0')+'.json';
    files.push(artifact(path,'application/json',raw));
    pageManifest.push({path,url,status:200,requestId:optionalText(page.requestId,'native request ID'),etag:optionalText(page.etag,'page ETag'),bytes:identity.bytes,sha256:identity.sha256,nextLink:next,rows:data.value.length});
    for(let rowIndex=0;rowIndex<data.value.length;rowIndex++){
      const row=data.value[rowIndex];need(row&&typeof row==='object'&&!Array.isArray(row),'Retain complete native master records.');
      const nativeId=guid(row.id,'native asset record ID');
      const number=value(row[spec.number],'native asset number',128);
      need(!seenIds.has(nativeId.toLowerCase()),'A native record ID occurs more than once in the captured population.');
      need(!seenNumbers.has(number),'A native asset number occurs more than once in the captured population.');
      seenIds.add(nativeId.toLowerCase());seenNumbers.add(number);
      rows.push([canonicalCompanyId,number,spec.parent?field(row,spec.parent):'',field(row,spec.category),field(row,spec.description)]);
      identities.push([canonicalCompanyId,capture.kind,nativeId,number,optionalText(row['@odata.etag'],'record ETag')??'',path,String(rowIndex)]);
      if(capture.kind==='maintenanceAssets'){
        const fixed=field(row,'fixedAssetNumber');
        if(fixed)links.push([canonicalCompanyId,number,nativeId,fixed,path,String(rowIndex)]);
      }
      need(rows.length<=LIMITS.rows,'Master population exceeds the original workspace row limit.');
    }
    if(pageIndex<capture.pages.length-1)need(next!==null,'Extra pages follow a native terminal page.');
  }
  need(expectedUrl===null,'The source has an unreceived continuation page. Retain that original response before preparing the population.');
  const scope={schema:'tjlabs.business-central-master-preparation.v1',kind:capture.kind,tenantId:capture.tenantId,environment:capture.environment,
    companyId,canonicalCompanyId,collectionUrl,observedAt:capture.observedAt,population:{complete:capture.population.complete,description:scopeNote},
    pageChainComplete:true,snapshotConsistency:'Not established by pagination; retain the native export or observation basis separately.',rowCount:rows.length,assetIdentifier:'native business number',nativeIdCrosswalk:'native-identities.csv',
    financialAmountsPrepared:false,sourcePages:pageManifest,
    notes:capture.kind==='fixedAssets'?
      ['The standard asset-card projection does not establish depreciation-book balances, ledger history or parent hierarchy.','All additional native fields remain in the exact original response files.']:
      ['Maintenance asset numbers are a separate identity space from fixed-asset numbers.','Several maintenance assets may link to one fixed asset; retain every link without multiplying financial balances.','Category is retained as the master classification; it is not a declaration of a financial fixed-asset class.']};
  const assetFile=artifact('assets.csv','text/csv',encodeCsv([['company_id','asset_id','parent_asset_id','class_code','description'],...rows]));
  need(assetFile.bytes<=LIMITS.csvBytes,'Prepared asset CSV exceeds the original complete CSV limit.');
  files.push(assetFile);
  files.push(artifact('native-identities.csv','text/csv',encodeCsv([['company_id','native_kind','native_id','native_number','etag','source_page','source_record_index'],...identities])));
  files.push(artifact('maintenance-fixed-asset-links.csv','text/csv',encodeCsv([['company_id','maintenance_asset_number','maintenance_native_id','fixed_asset_number','source_page','source_record_index'],...links])));
  files.push(artifact('capture-scope.json','application/json',JSON.stringify(scope,null,2)+'\n'));
  const manifest={schema:'tjlabs.business-central-master-preparation-manifest.v1',scope,files:files.map(({text,...f})=>f)};
  files.push(artifact('manifest.json','application/json',JSON.stringify(manifest,null,2)+'\n'));
  return {scope,files};
}
