// MIT. Serve one unchanged Helgoland release against one saved analysis version.
import {readFile} from 'node:fs/promises';
import {extname} from 'node:path';
import {fault,identity,json,plain,sha,sourceDocument} from '../../contract.mjs';
import {derivedIndex,viewerSettings,VIEWER_LIMITS} from '../viewer.mjs';
import {nativeEntityCompatibility} from '../model.mjs';

const HASH=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const STATIC_ROOT='/analysis/viewer/',API_ROOT='/api/analysis/viewers/';
const MAX_JSON_BYTES=16*1024*1024;
const TYPES={
  '.html':'text/html; charset=utf-8','.htm':'text/html; charset=utf-8',
  '.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8',
  '.map':'application/json; charset=utf-8','.svg':'image/svg+xml',
  '.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif',
  '.webp':'image/webp','.ico':'image/x-icon','.woff':'font/woff','.woff2':'font/woff2',
  '.ttf':'font/ttf','.otf':'font/otf','.eot':'application/vnd.ms-fontobject',
  '.txt':'text/plain; charset=utf-8','.xml':'application/xml; charset=utf-8',
  '.webmanifest':'application/manifest+json','.wasm':'application/wasm'
};
function exactPath(value,{directory=false}={}){
  if(typeof value!=='string'||value.length>512||value.startsWith('/')||
    /[\u0000-\u001f\u007f\\]/.test(value)||value.split('/').some((part,index,all)=>
      !(directory&&index===all.length-1&&part==='')&&(!part||part==='.'||part==='..'||part.includes(':'))))
    throw fault('VIEWER_PATH','Use an exact original retained viewer asset path.',404);
  return value;
}
function count(value,label){
  if(!Number.isSafeInteger(value)||value<0)throw fault('VIEWER_SUMMARY','The retained '+label+' count is invalid.',409);
  return value;
}
function contentPolicy(index){
  const inline=[];
  for(const match of index.toString('utf8').matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)){
    if(!/\bsrc\s*=/i.test(match[1])&&match[2].trim())inline.push("'sha256-"+Buffer.from(sha(Buffer.from(match[2])),'hex').toString('base64')+"'");
  }
  return "default-src 'self'; script-src 'self' "+inline.join(' ')+"; style-src 'self' 'unsafe-inline'; "+
    "img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; "+
    "object-src 'none'; base-uri 'self'; frame-ancestors 'self'; form-action 'none'";
}
async function sendBytes(req,res,bytes,type,{immutable=false,csp=null,etag=null}={}){
  if(res.destroyed)throw fault('CLIENT_CLOSED','The original viewer connection closed.',499);
  const headers={'Content-Type':type,'Content-Length':bytes.length,'Cache-Control':immutable?'private, max-age=31536000, immutable':'no-store',
    'Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin'};
  if(csp)headers['Content-Security-Policy']=csp;
  if(etag)headers.ETag='"'+etag+'"';
  const notModified=immutable&&etag&&String(req.headers['if-none-match']??'').split(',').map(x=>x.trim()).includes('"'+etag+'"');
  if(notModified)delete headers['Content-Length'];
  await new Promise((resolve,reject)=>{
    let settled=false;
    const done=error=>{if(settled)return;settled=true;res.off('finish',finish);res.off('close',closed);res.off('error',failed);error?reject(error):resolve();};
    const finish=()=>done(),closed=()=>done(res.writableFinished?null:fault('CLIENT_CLOSED','The original viewer connection closed.',499)),failed=error=>done(error);
    res.once('finish',finish);res.once('close',closed);res.once('error',failed);
    try{res.writeHead(notModified?304:200,headers);res.end(notModified||req.method==='HEAD'?undefined:bytes);}catch(error){done(error);}
  });
}
function decodeAsset(raw){
  if(/%(?:2f|5c)/i.test(raw))throw fault('VIEWER_PATH','An encoded path separator is not a retained viewer asset.',404);
  let value;try{value=decodeURIComponent(raw);}catch{throw fault('VIEWER_PATH','The retained asset URL is malformed.',404);}
  if(value==='')return '';
  return exactPath(value,{directory:value.endsWith('/')});
}
function readOnly(req){if(!['GET','HEAD'].includes(req.method))throw fault('VIEWER_METHOD','Native viewer deployment routes are read only.',405);}

/**
 * Mounted by the existing listener. The parent authenticates handleApi before
 * calling it. This adapter neither opens another store nor creates a session.
 */
export function createAnalysisDeployment({workspace,origin}){
  if(!workspace?.analysis||typeof workspace.store?.object!=='function'||typeof workspace.schema!=='function')
    throw fault('VIEWER_INSTALL','Use the original complete analysis workspace and object reader.',409);
  if(typeof origin!=='string'||origin.length>2048)throw fault('VIEWER_ORIGIN','Supply the existing workspace origin.');
  let allowed;try{allowed=new URL(origin);}catch{throw fault('VIEWER_ORIGIN','Supply the existing workspace origin.');}
  if(!['http:','https:'].includes(allowed.protocol)||allowed.username||allowed.password||allowed.search||allowed.hash||allowed.pathname!=='/')
    throw fault('VIEWER_ORIGIN','Supply the original HTTP(S) workspace origin without a path or credentials.');
  const analysis=workspace.analysis,workspaceId=workspace.schema().workspaceId,pending=new Set();
  if(!UUID.test(workspaceId??''))throw fault('VIEWER_WORKSPACE','The original workspace UUID is unavailable.',409);
  let closing=false,closePromise=null,bridgePromise=null;
  function context({url,workspaceId:received}){
    if(closing)throw fault('VIEWER_CLOSING','The original viewer deployment is closing.',503);
    if(!(url instanceof URL)||url.origin!==allowed.origin||received!==workspaceId)
      throw fault('VIEWER_WORKSPACE','Use the original selected workspace and origin.',409);
  }
  async function bridge(){
    if(!bridgePromise){
      bridgePromise=readFile(new URL('./bridge.js',import.meta.url)).then(bytes=>{
        if(bytes.length<1||bytes.length>128*1024)throw fault('VIEWER_BRIDGE','The installed connection bridge is missing or exceeds its source capacity.',409);
        return bytes;
      });
      void bridgePromise.catch(()=>{bridgePromise=null;});
    }
    return bridgePromise;
  }
  async function object(member){
    if(!plain(member)||!HASH.test(member.sha256??'')||!Number.isSafeInteger(member.bytes)||member.bytes<0||
      member.bytes>VIEWER_LIMITS.memberBytes)throw fault('VIEWER_ASSET','The original asset descriptor is invalid.',409);
    const bytes=await workspace.store.object(member.sha256);
    if(!Buffer.isBuffer(bytes)||bytes.length!==member.bytes||sha(bytes)!==member.sha256)
      throw fault('VIEWER_ASSET','The original retained asset differs from its exact SHA256 or length.',409);
    return bytes;
  }
  async function manifest(id){
    if(!HASH.test(id))throw fault('VIEWER_ROUTE','Choose an installed original viewer ID.',404);
    const viewer=await analysis.viewer(id);
    if(viewer.id!==id||viewer.schema!=='stellar-forge.sensorthings-analysis-viewer.v1'||
      !Array.isArray(viewer.files)||viewer.files.length>VIEWER_LIMITS.entries||
      !Array.isArray(viewer.upstreamSources)||viewer.upstreamSources.length>VIEWER_LIMITS.entries+1)
      throw fault('VIEWER_MANIFEST','The original installed viewer manifest is invalid.',409);
    const {id:claimed,...body}=viewer;
    if(identity(body)!==claimed)throw fault('VIEWER_MANIFEST','The installed viewer identity changed.',409);
    if(viewer.prefix!=='')exactPath(viewer.prefix,{directory:true});
    if(typeof viewer.prefix!=='string'||(viewer.prefix!==''&&!viewer.prefix.endsWith('/'))||
      viewer.indexPath!==viewer.prefix+'index.html'||viewer.settingsPath!==viewer.prefix+'assets/settings.json')
      throw fault('VIEWER_MANIFEST','The original release root or settings path is invalid.',409);
    const paths=new Set();
    for(const member of viewer.files){
      exactPath(member.path);
      if(paths.has(member.path)||!HASH.test(member.sha256??'')||!Number.isSafeInteger(member.bytes)||
        member.bytes<0||member.bytes>VIEWER_LIMITS.memberBytes)throw fault('VIEWER_MANIFEST','The retained viewer asset inventory is ambiguous.',409);
      paths.add(member.path);
    }
    if(!paths.has(viewer.indexPath)||!paths.has(viewer.settingsPath))
      throw fault('VIEWER_MANIFEST','The original index or settings object is missing from the manifest.',409);
    return viewer;
  }
  async function binding(viewerId,versionId,mode,{withSummary=false}={}){
    if(!HASH.test(viewerId)||!HASH.test(versionId)||!['map','numeric'].includes(mode))
      throw fault('VIEWER_ROUTE','Select an installed viewer, saved version and native view.',404);
    const [viewer,version]=await Promise.all([manifest(viewerId),analysis.version(versionId)]);
    if(version.id!==versionId||version.selection?.viewerId!==viewerId)
      throw fault('VIEWER_VERSION','Save this installed viewer ID in the original analysis version before opening it.',409);
    const summary=withSummary?await analysis.summary(versionId):null;
    if(summary&&(summary.editionId!==version.editionId||identity(summary.selection)!==identity(version.selection)||!Array.isArray(summary.streams)))
      throw fault('VIEWER_SUMMARY','The retained summary differs from the saved source selection.',409);
    const basePath=STATIC_ROOT+viewerId+'/'+versionId+'/'+mode+'/',apiPath=API_ROOT+viewerId+'/'+versionId+'/'+mode+'/';
    return {viewer,version,summary,mode,basePath,apiPath,staRoot:allowed.origin+'/api/analysis/sta/'+versionId+'/'+mode+'/'};
  }
  function availability(selected){
    const streams=selected.summary.streams;
    const numericEligibleRows=streams.reduce((sum,stream)=>sum+count(stream.numericEligibleRows,'numeric eligible row'),0);
    if(!Number.isSafeInteger(numericEligibleRows))throw fault('VIEWER_SUMMARY','The retained row counts exceed exact metadata capacity.',409);
    function metadata(selectedStreams){
      const checked=selectedStreams.every(stream=>typeof stream.nativeViewer?.metadataCompatible==='boolean');
      const issues=selectedStreams.flatMap(stream=>(stream.nativeViewer?.issues??[]).map(issue=>({streamKey:stream.key,...issue})));
      return {checked,compatible:checked?selectedStreams.every(stream=>stream.nativeViewer.metadataCompatible):null,issues,
        meaning:'Saved native-client metadata checks. Actual native rendering and any runtime projection errors are recorded separately.'};
    }
    const mapMetadata=metadata(streams),numericMetadata=metadata(streams.filter(stream=>stream.numericEligibleRows>0));
    const missingMetadata={code:'SENSORTHINGS_VIEWER_NATIVE_METADATA',
      message:'The retained source metadata has explicit native-client compatibility findings. Review those originals before opening this expanded view.'};
    const numeric={available:numericEligibleRows>0&&numericMetadata.compatible!==false,numericEligibleRows,metadata:numericMetadata,
      issue:!numericEligibleRows?{code:'SENSORTHINGS_VIEWER_NUMERIC_UNAVAILABLE',
        message:'This saved selection has no eligible original numeric instantaneous observations. Its categorical and interval results remain source events.'}:
        numericMetadata.compatible===false?missingMetadata:null};
    const map={available:mapMetadata.compatible!==false,streams:streams.length,metadata:mapMetadata,
      issue:mapMetadata.compatible===false?missingMetadata:null,
      meaning:'Only retained original spatial information is shown. The native expanded view uses the first original Thing Location; this is not inferred as every observation location.'};
    return {map,numeric,selected:selected.mode==='numeric'?numeric:map};
  }
  function nativeNavigation(selected){
    const source={permalink:'52North/helgoland@a17117b955d3453af0cfc056be012ded507426b0:src/common/timeseries/diagram/diagram-permalink.service.ts',
      internalId:'52North/helgoland-toolbox@ddd2b20f40ddd5fc80084f8d336644a06d53a484:libs/core/src/lib/dataset-api/internal-id-handler.service.ts'};
    const result={schema:'stellar-forge.sensorthings-native-view-navigation.v1',applied:false,datasets:[],period:null,query:null,issue:null,source,
      meaning:'Only the native initial dataset and display interval are derived. Exact original source identities, timestamps and saved selection remain unchanged.'};
    if(selected.mode!=='numeric')return result;
    const streams=selected.summary.streams.filter(stream=>stream.numericEligibleRows>0),seen=new Set();
    if(!streams.length)return result;
    for(const stream of streams){
      let compatibility;try{compatibility=nativeEntityCompatibility(sourceDocument(Buffer.from(stream.sourceJson))['@iot.id']);}catch{}
      if(!compatibility?.compatible||typeof compatibility.clientId!=='string'||compatibility.clientId.includes('!!')){
        result.issue={code:'SENSORTHINGS_VIEWER_NATIVE_PERMALINK',
          message:'The original selected stream ID cannot be represented by this native viewer permalink. Its source and analysis remain retained.'};return result;
      }
      const internalId=selected.staRoot+'__'+compatibility.clientId;
      if(seen.has(internalId)){result.issue={code:'SENSORTHINGS_VIEWER_NATIVE_PERMALINK',
        message:'Distinct selected source streams have the same native permalink identity. Review the original typed IDs.'};return result;}
      seen.add(internalId);result.datasets.push({streamKey:stream.key,id:compatibility.id,clientId:compatibility.clientId,internalId});
    }
    const period=selected.version.selection.period;
    const starts=streams.map(stream=>stream.firstUtc).filter(value=>typeof value==='string').sort();
    const ends=streams.map(stream=>stream.lastUtc).filter(value=>typeof value==='string').sort();
    const fromUtc=period?.startUtc??starts[0],toUtc=period?.endUtc??ends.at(-1);
    function epoch(value,ceil){
      const m=typeof value==='string'&&/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\.(\d{9})Z$/.exec(value);
      if(!m)return null;
      let ms=Date.parse(m[1]+'.'+m[2].slice(0,3)+'Z');
      if(ceil&&/[1-9]/.test(m[2].slice(3)))ms++;
      return Number.isSafeInteger(ms)?ms:null;
    }
    const from=epoch(fromUtc,false),end=epoch(toUtc,true);
    if(from===null||end===null||end<from){result.issue={code:'SENSORTHINGS_VIEWER_NATIVE_TIME',
      message:'The retained time bounds cannot be represented by the native millisecond display. Inspect their exact source timestamps.'};return result;}
    const to=end===from?end+1:end;
    if(!Number.isSafeInteger(to)){result.issue={code:'SENSORTHINGS_VIEWER_NATIVE_TIME',
      message:'The retained native display endpoint is outside exact millisecond capacity.'};return result;}
    result.period={basis:period?'saved_selection_period':'saved_source_summary_extent',fromUtc,toUtc,
      fromEpochMs:from,toEpochMs:to,precision:'millisecond',singleInstantDisplayWidthMs:end===from?1:0,
      meaning:'Start is rounded down and end up only for the native display. An exact single instant receives a one-millisecond display width, without an observation validity interval or interpolation claim.'};
    result.query={ids:result.datasets.map(item=>item.internalId).join('!!'),time:from+'|'+to};
    result.applied=true;return result;
  }
  async function deployment(selected){
    const indexMember=selected.viewer.files.find(x=>x.path===selected.viewer.indexPath);
    const settingsMember=selected.viewer.files.find(x=>x.path===selected.viewer.settingsPath);
    const [indexOriginal,settingsOriginal,bridgeBytes]=await Promise.all([object(indexMember),object(settingsMember),bridge()]);
    const originalSettings=sourceDocument(settingsOriginal);
    const settings=viewerSettings(originalSettings,{root:selected.staRoot,title:selected.version.title,period:selected.version.selection.period});
    const settingsBytes=json(settings),settingsPath=selected.viewer.settingsPath.slice(selected.viewer.prefix.length);
    const indexBytes=derivedIndex(indexOriginal,{base:selected.basePath,viewerId:selected.viewer.id,versionId:selected.version.id,
      mode:selected.mode,workspaceId,settingsPath});
    const navigation=nativeNavigation(selected),viewAvailability=availability(selected);
    if(navigation.issue){viewAvailability.selected.available=false;viewAvailability.selected.issue=navigation.issue;}
    const query=navigation.applied?'?'+new URLSearchParams(navigation.query).toString():'';
    const paths={base:selected.basePath,entry:selected.basePath+(selected.mode==='map'?'timeseries/map-selection':'timeseries/diagram')+query,
      settings:selected.apiPath+'settings.json',metadata:selected.apiPath+'deployment.json',sta:new URL(selected.staRoot).pathname,
      bridge:'/analysis/viewer-bridge.js'};
    const original={viewerId:selected.viewer.id,archive:selected.viewer.archive,index:indexMember,settings:settingsMember,
      upstream:selected.viewer.upstream,upstreamSources:selected.viewer.upstreamSources};
    const derived={index:{bytes:indexBytes.length,sha256:sha(indexBytes)},settings:{bytes:settingsBytes.length,sha256:sha(settingsBytes)},
      bridge:{path:paths.bridge,bytes:bridgeBytes.length,sha256:sha(bridgeBytes)}};
    const body={schema:'stellar-forge.sensorthings-analysis-deployment.v1',workspaceId,origin:allowed.origin,
      viewerId:selected.viewer.id,versionId:selected.version.id,projectId:selected.version.projectId,editionId:selected.version.editionId,
      mode:selected.mode,selection:selected.version.selection,paths,availability:viewAvailability,nativeNavigation:navigation,original,derived,
      sourceScope:selected.summary.sourceScope,sourceIssues:selected.summary.sourceIssues,license:selected.summary.license,
      connection:'Existing analyst-frame Bearer and workspace headers, supplied for same-origin retained analysis XHR only.',
      derivation:'Only the served index/base/connection script and configured settings are local derivatives. Original archive, assets and source/license bytes remain unchanged.'};
    return {metadata:{id:identity(body),...body},indexBytes,settingsBytes,contentPolicy:contentPolicy(indexBytes)};
  }
  function requireAvailable(metadata){
    if(!metadata.availability.selected.available){
      const issue=metadata.availability.selected.issue;
      throw fault(issue.code.replace(/^SENSORTHINGS_/,''),issue.message,409,{viewerId:metadata.viewerId,versionId:metadata.versionId,metadata:metadata.availability.selected.metadata});
    }
  }
  async function api(req,res,request){
    const {url}=request;if(!url.pathname.startsWith(API_ROOT))return false;
    context(request);readOnly(req);
    if(url.search)throw fault('VIEWER_PARAMETER','Use the exact declared viewer read without query parameters.');
    const path=url.pathname.slice(API_ROOT.length),parts=path.split('/');
    if(parts.length===1&&HASH.test(parts[0])){
      const bytes=json(await manifest(parts[0]));
      if(bytes.length>MAX_JSON_BYTES)throw fault('VIEWER_PAGE','Use the original manifest-bound file download for this complete source.',413);
      await sendBytes(req,res,bytes,TYPES['.json']);return true;
    }
    if(parts.length!==4||!['settings.json','deployment.json'].includes(parts[3]))
      throw fault('VIEWER_ROUTE','Choose the installed viewer manifest, configured settings or deployment read.',404);
    const selected=await binding(parts[0],parts[1],parts[2],{withSummary:true}),value=await deployment(selected);
    if(parts[3]==='settings.json'){
      requireAvailable(value.metadata);await sendBytes(req,res,value.settingsBytes,TYPES['.json']);
    }else{
      const bytes=json(value.metadata);if(bytes.length>MAX_JSON_BYTES)throw fault('VIEWER_PAGE','The complete deployment metadata exceeds its declared response capacity.',413);
      await sendBytes(req,res,bytes,TYPES['.json']);
    }
    return true;
  }
  async function assets(req,res,request){
    const {url}=request;
    if(url.pathname==='/analysis/viewer-bridge.js'){
      context(request);readOnly(req);await sendBytes(req,res,await bridge(),TYPES['.js']);return true;
    }
    if(!url.pathname.startsWith(STATIC_ROOT))return false;
    context(request);readOnly(req);
    const match=/^([a-f0-9]{64})\/([a-f0-9]{64})\/(map|numeric)\/(.*)$/.exec(url.pathname.slice(STATIC_ROOT.length));
    if(!match)throw fault('VIEWER_ROUTE','Use the exact saved native viewer path.',404);
    const relative=decodeAsset(match[4]);
    const index=relative===''||relative==='index.html'||relative==='timeseries'||relative==='timeseries/'||
      (relative.startsWith('timeseries/')&&!extname(relative));
    const selected=await binding(match[1],match[2],match[3],{withSummary:index});
    if(index){
      const value=await deployment(selected);requireAvailable(value.metadata);
      await sendBytes(req,res,value.indexBytes,TYPES['.html'],{csp:value.contentPolicy});return true;
    }
    const originalPath=selected.viewer.prefix+relative;
    if(originalPath===selected.viewer.settingsPath)
      throw fault('VIEWER_SETTINGS_PROTECTED','Open the native viewer through the registered analysis frame for its configured settings.',401);
    const member=selected.viewer.files.find(x=>x.path===originalPath);
    if(!member)throw fault('VIEWER_ASSET','The requested asset is not in this original installed release.',404);
    await sendBytes(req,res,await object(member),TYPES[extname(member.path).toLowerCase()]??'application/octet-stream',
      {immutable:true,etag:member.sha256});return true;
  }
  function tracked(fn){
    return (req,res,request)=>{
      const promise=Promise.resolve().then(()=>fn(req,res,request));pending.add(promise);
      void promise.finally(()=>pending.delete(promise)).catch(()=>{});
      return promise;
    };
  }
  function close(){
    if(closePromise)return closePromise;closing=true;
    closePromise=(async()=>{await Promise.allSettled([...pending]);bridgePromise=null;})();
    return closePromise;
  }
  return {staticHandler:tracked(assets),handleApi:tracked(api),close};
}
