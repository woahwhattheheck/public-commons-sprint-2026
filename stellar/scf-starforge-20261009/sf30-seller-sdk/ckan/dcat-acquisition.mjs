// MIT. Original HTTP editions and selected recurring decisions in the catalog workspace.
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { catalogOrigin, parseCkanJson, ExactCkanNumber } from './capture.mjs';
import { object, bytes, digest, identity, readPrivate, createFile, atomicJson,
  privateDirectory, fault, stamp } from '../postgres/publisher/files.mjs';

export const DCAT_ACQUISITION_SCHEMA = 'stellar-forge.dcat-acquisition.v1';
const HASH = /^[a-f0-9]{64}$/, UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const MAX = 134217728, RECEIPT_MAX = 1048576;
const CONFIG = ['label','url','profile','authTokenEnv','timeoutMs','maxResponseBytes','intervalMinutes','enabled'];
const TERMINAL = ['ACQUIRED','UNCHANGED','NOT_MODIFIED','FAILED','INTERRUPTED'];
const SUCCESS = ['ACQUIRED','UNCHANGED','NOT_MODIFIED'];
const need = (ok, code, message = code, status = 400) => { if (!ok) throw fault(code, message, status); };
const own = (value,key) => Object.prototype.hasOwnProperty.call(value,key);
const clone = value => parseCkanJson(bytes(value));
const integer = (value,min,max,code) => {
  need(Number.isSafeInteger(value) && value>=min && value<=max,code); return value;
};
const time = value => typeof value==='string' && Number.isFinite(Date.parse(value));
function item(rows,id) {
  need(UUID.test(id??''),'DCAT_SOURCE_ITEM_NOT_FOUND','Choose a saved source or acquisition.',404);
  const row=rows.find(x=>x.id===id);
  need(row,'DCAT_SOURCE_ITEM_NOT_FOUND','Choose a saved source or acquisition.',404);return row;
}
function sourceURL(value) {
  let url;try { url=new URL(value); } catch { throw fault('DCAT_SOURCE_URL_INVALID','Enter an HTTPS catalog URL.'); }
  need(typeof value==='string' && value.length<=4096 && !url.username && !url.password && !url.hash,
    'DCAT_SOURCE_URL_INVALID','Use an HTTPS catalog URL without credentials or a fragment.');
  catalogOrigin(url.origin);
  return url.href;
}
export function dcatSourceConfig(input,previous={}) {
  need(object(input),'DCAT_SOURCE_INVALID');
  const pick=(key,fallback)=>own(input,key)?input[key]:(previous[key]??fallback);
  const label=pick('label','Catalog source');
  need(typeof label==='string' && label.trim() && label.length<=512,'DCAT_SOURCE_LABEL_INVALID');
  const profile=pick('profile','auto');
  need(['auto','1.1','3.0'].includes(profile),'DCAT_PROFILE_INVALID');
  const authTokenEnv=pick('authTokenEnv',null),enabled=pick('enabled',true);
  need(authTokenEnv===null || typeof authTokenEnv==='string' && /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(authTokenEnv),
    'DCAT_SOURCE_TOKEN_REFERENCE_INVALID');
  need(typeof enabled==='boolean','DCAT_SOURCE_ENABLED_INVALID');
  return {label:label.trim(),url:sourceURL(pick('url')),profile,authTokenEnv,
    timeoutMs:integer(pick('timeoutMs',30000),100,300000,'DCAT_SOURCE_TIMEOUT_INVALID'),
    maxResponseBytes:integer(pick('maxResponseBytes',MAX),1024,MAX,'DCAT_SOURCE_SIZE_INVALID'),
    intervalMinutes:integer(pick('intervalMinutes',60),1,525600,'DCAT_SOURCE_INTERVAL_INVALID'),enabled};
}
function validateVersion(version) {
  need(object(version) && HASH.test(version.sourceSha256??'') && time(version.savedAt),'DCAT_SOURCE_VERSION_INVALID');
  const config=dcatSourceConfig(version.config);
  need(identity(config)===version.sourceSha256 && JSON.stringify(config)===JSON.stringify(version.config),
    'DCAT_SOURCE_VERSION_CHANGED');
}
function configOf(source) { return Object.fromEntries(CONFIG.map(key=>[key,source[key]])); }
export function validateDcatAcquisitions(state) {
  const sources=state.sources??[],attempts=state.acquisitions??[];
  need(Array.isArray(sources)&&Array.isArray(attempts),'DCAT_SOURCE_STATE_INVALID');
  for(const rows of [sources,attempts]) {
    const ids=new Set();
    for(const row of rows) {
      need(object(row)&&UUID.test(row.id??'')&&!ids.has(row.id),'DCAT_SOURCE_STATE_INVALID');ids.add(row.id);
    }
  }
  for(const source of sources) {
    need(Array.isArray(source.versions)&&source.versions.length>0,'DCAT_SOURCE_VERSION_INVALID');
    const versions=new Set();
    for(const version of source.versions) {
      validateVersion(version);need(!versions.has(version.sourceSha256),'DCAT_SOURCE_VERSION_INVALID');
      versions.add(version.sourceSha256);
    }
    need(versions.has(source.sourceSha256)&&identity(configOf(source))===source.sourceSha256,
      'DCAT_SOURCE_VERSION_CHANGED');
    if(source.selections!==undefined) {
      need(Array.isArray(source.selections)&&source.selections.length>0&&source.selections.every(row=>
        object(row)&&versions.has(row.sourceSha256)&&time(row.selectedAt))&&
        source.selections.at(-1).sourceSha256===source.sourceSha256&&source.selections.at(-1).selectedAt===source.updatedAt,
        'DCAT_SOURCE_SELECTION_CHANGED');
    }
    for(const key of ['createdAt','updatedAt'])need(time(source[key]),'DCAT_SOURCE_STATE_INVALID');
    for(const key of ['lastCheckedAt','nextCheckAt','retryNotBefore'])
      need(source[key]===null||time(source[key]),'DCAT_SOURCE_STATE_INVALID');
    if(source.latestCatalogId!==null)item(state.catalogs,source.latestCatalogId);
    if(source.latestAcquisitionId!==null) {
      const selected=item(attempts,source.latestAcquisitionId);
      need(selected.sourceId===source.id&&selected.sourceSha256===source.sourceSha256,'DCAT_SOURCE_BINDING_CHANGED');
    }
    if(source.lastSuccessfulAcquisitionId!==null) {
      const selected=item(attempts,source.lastSuccessfulAcquisitionId);
      need(selected.sourceId===source.id&&selected.sourceSha256===source.sourceSha256&&SUCCESS.includes(selected.status)&&
        selected.catalogId===source.latestCatalogId,'DCAT_SOURCE_BINDING_CHANGED');
    } else need(source.latestCatalogId===null,'DCAT_SOURCE_BINDING_CHANGED');
  }
  for(const attempt of attempts) {
    const source=item(sources,attempt.sourceId);
    const version=source.versions.find(v=>v.sourceSha256===attempt.sourceSha256);
    need(version&&identity(attempt.config)===version.sourceSha256&&
      (attempt.status==='FETCHING'||TERMINAL.includes(attempt.status))&&time(attempt.startedAt),
      'DCAT_ACQUISITION_INVALID');
    if(attempt.previousCatalogId!==null)item(state.catalogs,attempt.previousCatalogId);
    if(attempt.catalogId!==null)item(state.catalogs,attempt.catalogId);
    if(attempt.retryOf!==null) {
      const previous=item(attempts,attempt.retryOf);
      need(previous.id!==attempt.id&&previous.sourceId===source.id&&['FAILED','INTERRUPTED'].includes(previous.status),
        'DCAT_ACQUISITION_RETRY_INVALID');
    }
    if(SUCCESS.includes(attempt.status))need(attempt.catalogId!==null&&attempt.responseComplete===true,'DCAT_ACQUISITION_INVALID');
    if(TERMINAL.includes(attempt.status))need(time(attempt.completedAt),'DCAT_ACQUISITION_INVALID');
    for(const kind of ['receipt','response']) {
      const hash=attempt[kind+'Sha256'],count=attempt[kind+'Bytes'];
      need(hash===null&&count===null || HASH.test(hash??'')&&Number.isSafeInteger(count)&&count>=0&&
        count<=(kind==='response'?attempt.config.maxResponseBytes:RECEIPT_MAX),'DCAT_ACQUISITION_FILE_INVALID');
    }
    if(SUCCESS.includes(attempt.status))need(attempt.receiptSha256&&attempt.responseSha256&&!attempt.receiptNeedsRecovery,
      'DCAT_ACQUISITION_FILE_INVALID');
    need(attempt.receiptNeedsRecovery===undefined||typeof attempt.receiptNeedsRecovery==='boolean','DCAT_ACQUISITION_INVALID');
    if(attempt.receiptNeedsRecovery)need(['FAILED','INTERRUPTED'].includes(attempt.status),'DCAT_ACQUISITION_INVALID');
  }
  for(const review of state.reviews) if(review.acquisitionSourceId) {
    const source=item(sources,review.acquisitionSourceId),attempt=item(attempts,review.acquisitionId);
    need(attempt.sourceId===source.id&&attempt.catalogId===review.sourceId&&
      attempt.sourceSha256===review.acquisitionSourceSha256&&SUCCESS.includes(attempt.status),
      'DCAT_SOURCE_REVIEW_BINDING_CHANGED');
    if(review.baselineReleaseId!==null) {
      const release=item(state.releases,review.baselineReleaseId);
      need(release.sha256===review.baselineSha256&&release.reviewSha256===review.baselineReviewSha256,
        'DCAT_SOURCE_REVIEW_BINDING_CHANGED');
      if(review.comparisonId) {
        const comparison=item(state.catalogs,review.comparisonId);
        need(comparison.sha256===release.sha256&&comparison.bytes===release.bytes&&
          comparison.acceptedReleaseId===release.id,'DCAT_SOURCE_REVIEW_BINDING_CHANGED');
      } else need(!['READY','NEEDS_CORRECTION'].includes(review.status),'DCAT_SOURCE_REVIEW_BINDING_CHANGED');
    }
  }
}
function attemptRoot(directory,id) { return join(directory,'dcat','acquisitions',id); }
function receiptFor(attempt) {
  return {schema:DCAT_ACQUISITION_SCHEMA,acquisitionId:attempt.id,sourceId:attempt.sourceId,
    sourceSha256:attempt.sourceSha256,config:attempt.config,startedAt:attempt.startedAt,
    previousCatalogId:attempt.previousCatalogId,retryOf:attempt.retryOf,unconditional:attempt.unconditional,
    bodyEncoding:'decoded-http-entity',hops:[],status:'FETCHING',completedAt:null,error:null};
}
async function saveReceipt(directory,attempt,receipt) {
  const root=attemptRoot(directory,attempt.id);
  await privateDirectory(root,true);
  const raw=bytes(receipt);
  need(raw.length<=RECEIPT_MAX,'DCAT_RECEIPT_TOO_LARGE');
  await atomicJson(root,'receipt.json',receipt);
  attempt.receiptSha256=digest(raw);attempt.receiptBytes=raw.length;
  if(receipt.status===attempt.status&&TERMINAL.includes(attempt.status))attempt.receiptNeedsRecovery=false;
}
export async function interruptDcatAcquisitions(directory,state) {
  for(const attempt of state?.acquisitions??[]) if(attempt.status==='FETCHING'||attempt.receiptNeedsRecovery) {
    const interrupted=attempt.status==='FETCHING';
    let receipt;
    try { receipt=parseCkanJson(await readPrivate(join(attemptRoot(directory,attempt.id),'receipt.json'),RECEIPT_MAX)); }
    catch(error) { if(error.code!=='ENOENT')throw error;receipt=receiptFor(attempt); }
    need(receipt.acquisitionId===attempt.id&&receipt.sourceId===attempt.sourceId&&
      receipt.sourceSha256===attempt.sourceSha256&&identity(receipt.config)===attempt.sourceSha256,
      'DCAT_RECEIPT_BINDING_CHANGED');
    attempt.httpStatus=receipt.httpStatus??attempt.httpStatus;
    attempt.finalUrl=receipt.finalUrl??attempt.finalUrl;
    attempt.retryNotBefore=receipt.retryNotBefore??attempt.retryNotBefore;
    if(interrupted) {
      attempt.status='INTERRUPTED';attempt.completedAt=stamp();
      attempt.error={code:'PROCESS_INTERRUPTED',message:'The process ended before this acquisition completed.'};
    }
    // A crash may leave an atomically saved final receipt ahead of workbench.json.
    // Recover its actual bounded body, but never promote an uncommitted catalog.
    let retainedComplete=false;
    try {
      const raw=await readPrivate(join(attemptRoot(directory,attempt.id),'response.bin'),attempt.config.maxResponseBytes);
      attempt.responseSha256=digest(raw);attempt.responseBytes=raw.length;
      retainedComplete=receipt.responseComplete===true&&receipt.responseSha256===attempt.responseSha256&&
        receipt.responseBytes===attempt.responseBytes;
    } catch(error) { if(error.code!=='ENOENT')throw error; }
    if(interrupted)attempt.responseComplete=retainedComplete;
    Object.assign(receipt,{status:attempt.status,completedAt:attempt.completedAt,error:attempt.error,
      catalogId:attempt.catalogId,responseSha256:attempt.responseSha256,responseBytes:attempt.responseBytes,
      responseComplete:attempt.responseComplete});
    await saveReceipt(directory,attempt,receipt);
    const source=item(state.sources,attempt.sourceId);
    if(source.sourceSha256===attempt.sourceSha256) {
      source.lastCheckedAt=attempt.completedAt;
      source.retryNotBefore=attempt.retryNotBefore;
      source.nextCheckAt=new Date(Math.max(Date.parse(attempt.completedAt)+source.intervalMinutes*60000,
        Date.parse(source.retryNotBefore??'')||0)).toISOString();
    }
  }
}
export async function validateDcatAcquisitionFiles(directory,state) {
  validateDcatAcquisitions(state);
  for(const source of state.sources??[])for(const version of source.versions) {
    const raw=await readPrivate(join(directory,'dcat','sources',source.id,version.sourceSha256+'.json'),65536);
    need(digest(raw)===digest(bytes(version)),'DCAT_SOURCE_VERSION_CHANGED');
  }
  for(const attempt of state.acquisitions??[]) {
    if(attempt.receiptSha256) {
      const raw=await readPrivate(join(attemptRoot(directory,attempt.id),'receipt.json'),RECEIPT_MAX);
      need(digest(raw)===attempt.receiptSha256&&raw.length===attempt.receiptBytes,'DCAT_RECEIPT_CHANGED');
      const receipt=parseCkanJson(raw);
      need(receipt.schema===DCAT_ACQUISITION_SCHEMA&&receipt.acquisitionId===attempt.id&&receipt.sourceId===attempt.sourceId&&
        receipt.sourceSha256===attempt.sourceSha256&&identity(receipt.config)===attempt.sourceSha256&&
        (attempt.receiptNeedsRecovery||receipt.status===attempt.status&&receipt.responseSha256===attempt.responseSha256&&
          receipt.responseBytes===attempt.responseBytes&&receipt.responseComplete===attempt.responseComplete&&
          receipt.catalogId===attempt.catalogId),'DCAT_RECEIPT_BINDING_CHANGED');
    }
    if(attempt.responseSha256) {
      const raw=await readPrivate(join(attemptRoot(directory,attempt.id),'response.bin'),attempt.config.maxResponseBytes);
      need(digest(raw)===attempt.responseSha256&&raw.length===attempt.responseBytes,'DCAT_RESPONSE_CHANGED');
      if(['ACQUIRED','UNCHANGED'].includes(attempt.status)) {
        const catalog=item(state.catalogs,attempt.catalogId);
        need(catalog.sha256===attempt.responseSha256&&catalog.bytes===attempt.responseBytes,'DCAT_RESPONSE_BINDING_CHANGED');
      }
    }
    if(attempt.status==='NOT_MODIFIED')need(attempt.catalogId===attempt.previousCatalogId&&
      attempt.httpStatus===304&&attempt.responseBytes===0,'DCAT_RESPONSE_BINDING_CHANGED');
  }
}
function headersOf(response) {
  const names=['content-type','content-length','content-encoding','etag','last-modified','date','retry-after','cache-control','vary'];
  return Object.fromEntries(names.filter(name=>response.headers.has(name)).map(name=>[name,response.headers.get(name)]));
}
function retryAfter(value,now=Date.now()) {
  if(typeof value!=='string')return null;
  const deadline=/^\d+$/.test(value.trim())?now+Number(value.trim())*1000:Date.parse(value);
  return Number.isFinite(deadline)&&deadline>now&&deadline<=8640000000000000?new Date(deadline).toISOString():null;
}
function safeError(error,signal) {
  if(signal?.aborted)return {code:'DCAT_ACQUISITION_CANCELLED',message:'The catalog acquisition was cancelled.'};
  const code=typeof error.code==='string'&&/^DCAT_[A-Z_]+$/.test(error.code)?error.code:'DCAT_ACQUISITION_FAILED';
  return {code,message:code==='DCAT_ACQUISITION_FAILED'?'The catalog HTTP request could not complete.':
    (error.message??code)};
}
/** Byte-preserving HTTP GET; original fetch consumes content-coding, not JSON charset. */
async function receive(config,prior,environment,signal,receipt,checkpoint,progress) {
  const combined=AbortSignal.any([signal,AbortSignal.timeout(config.timeoutMs)]);
  const token=config.authTokenEnv?environment[config.authTokenEnv]:null;
  need(!config.authTokenEnv||typeof token==='string'&&token.length>0&&!/[\r\n]/.test(token),
    'DCAT_SOURCE_AUTH_UNAVAILABLE','The source authorization environment reference is unavailable.');
  let url=config.url,body=Buffer.alloc(0),complete=false;
  const seen=new Set(),initialOrigin=new URL(url).origin;
  try {
    for(let hopIndex=0;hopIndex<=5;hopIndex++) {
      need(!seen.has(url),'DCAT_REDIRECT_LOOP','The catalog source repeated a redirect.');seen.add(url);
      const headers={accept:'application/json, application/ld+json', 'accept-encoding':'identity'};
      const auth=!!token&&new URL(url).origin===initialOrigin;
      if(auth)headers.authorization=token;
      const conditional=prior?.finalUrl===url&&!config.authTokenEnv?prior.validators:null;
      if(conditional?.etag)headers['if-none-match']=conditional.etag;
      else if(conditional?.lastModified)headers['if-modified-since']=conditional.lastModified;
      const hop={url,method:'GET',requestedAt:stamp(),authorizationOrigin:auth,
        authTokenEnv:auth?config.authTokenEnv:null,
        conditional:conditional?{etag:headers['if-none-match']??null,lastModified:headers['if-modified-since']??null}:null,
        status:null,headers:{},receivedAt:null,targetUrl:null};
      receipt.hops.push(hop);await checkpoint();
      progress?.({phase:'FETCHING_CATALOG',url,redirects:hopIndex});
      const response=await fetch(url,{method:'GET',headers,redirect:'manual',signal:combined});
      hop.status=response.status;hop.receivedAt=stamp();hop.headers=headersOf(response);
      receipt.httpStatus=response.status;receipt.finalUrl=url;
      const defer=retryAfter(hop.headers['retry-after']);if(defer)receipt.retryNotBefore=defer;
      if([301,302,303,307,308].includes(response.status)) {
        await response.body?.cancel();
        const location=response.headers.get('location');
        need(location,'DCAT_REDIRECT_LOCATION_MISSING','The catalog redirect has no destination.');
        hop.targetUrl=sourceURL(new URL(location,url).href);await checkpoint();
        need(!defer,'DCAT_PROVIDER_RETRY_AFTER','The provider requires a later retry before following its redirect.',409);
        need(hopIndex<5,'DCAT_REDIRECT_LIMIT','The catalog source exceeded five redirects.');
        url=hop.targetUrl;continue;
      }
      await checkpoint();
      const chunks=[];let count=0;
      if(response.body) {
        const reader=response.body.getReader();
        try {
          for(;;) {
            const next=await reader.read();if(next.done)break;
            const left=config.maxResponseBytes-count;
            if(next.value.length>left) {
              if(left>0){chunks.push(Buffer.from(next.value.subarray(0,left)));count+=left;}
              body=Buffer.concat(chunks,count);await reader.cancel();
              throw fault('DCAT_RESPONSE_TOO_LARGE','The returned catalog exceeds the configured response limit.');
            }
            chunks.push(Buffer.from(next.value));count+=next.value.length;
          }
        } catch(error) { body=Buffer.concat(chunks,count);throw error; }
        finally {reader.releaseLock();}
        body=Buffer.concat(chunks,count);
      }
      complete=true;
      if(response.status===304) {
        need(prior&&conditional&&(headers['if-none-match']||headers['if-modified-since'])&&body.length===0,
          'DCAT_UNBOUND_NOT_MODIFIED','The provider returned 304 without the exact retained conditional edition.');
      } else need(response.status===200,'DCAT_HTTP_STATUS','The catalog source returned HTTP '+response.status+'.',502);
      need(response.status===304||body.length>=2,'DCAT_RESPONSE_EMPTY','The catalog response has no complete JSON document.');
      return {body,complete,httpStatus:response.status,finalUrl:url,
        validators:{etag:hop.headers.etag??(response.status===304?prior?.validators?.etag:null)??null,
          lastModified:hop.headers['last-modified']??(response.status===304?prior?.validators?.lastModified:null)??null}};
    }
  } catch(error) {
    if(combined.aborted&&!signal.aborted)error=fault('DCAT_ACQUISITION_TIMEOUT','The catalog request exceeded its configured time limit.');
    error.acquisitionBody=body;error.acquisitionComplete=complete;throw error;
  }
}
function exactNumberIdentity(source) {
  const match=/^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(source);
  if(!match)throw fault('DCAT_MAPPING_NUMBER_INVALID');
  const fraction=match[3]??'';
  let digits=(match[2]+fraction).replace(/^0+/,'');
  if(!digits)return match[1]+'0e0';
  const trailing=/0*$/.exec(digits)[0].length;
  if(trailing)digits=digits.slice(0,-trailing);
  return match[1]+digits+'e'+(BigInt(match[4]??'0')-BigInt(fraction.length)+BigInt(trailing));
}
function exactKey(value) {
  if(value instanceof ExactCkanNumber)return 'number:'+exactNumberIdentity(value.source);
  if(typeof value==='number')return 'number:'+exactNumberIdentity(Object.is(value,-0)?'-0':String(value));
  if(value===null||typeof value!=='object')return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(exactKey).join(',')+']';
  return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+exactKey(value[key])).join(',')+'}';
}
function atPointer(value,path) {
  need(typeof path==='string'&&path.startsWith('/'),'DCAT_MAPPING_PATH_INVALID');
  let current=value;
  for(const part of path.slice(1).split('/').map(x=>x.replace(/~1/g,'/').replace(/~0/g,'~'))) {
    need(object(current)||Array.isArray(current),'DCAT_MAPPING_PATH_INVALID');
    need(own(current,part),'DCAT_MAPPING_PATH_INVALID');current=current[part];
  }
  need(object(current),'DCAT_MAPPING_PATH_INVALID');return current;
}
/** Apply only selected identifier decisions to the freshly generated candidate. */
export function reuseDcatIdentityMappings(baseline,fresh,indexes,additional=[],{preserveCandidate=false}={}) {
  need(Array.isArray(indexes)&&new Set(indexes).size===indexes.length&&
    indexes.every(x=>Number.isSafeInteger(x)&&x>=0&&x<(baseline.identity_mappings?.length??0)),
    'DCAT_MAPPING_SELECTION_INVALID','Select retained identity decisions from the accepted baseline.');
  need(typeof fresh.candidate_text==='string'&&fresh.candidate_inventory,
    'DCAT_MAPPING_CANDIDATE_REQUIRED','The current source must produce a fresh candidate before identity decisions can be reapplied.');
  const candidate=preserveCandidate?null:parseCkanJson(Buffer.from(fresh.candidate_text,'utf8'));
  const mappings=clone(additional),used=new Set();
  for(const index of indexes) {
    const rule=baseline.identity_mappings[index];
    const old=baseline.source_inventory.records.find(row=>row.path===rule.source_path);
    need(old&&!old.scope_key.startsWith('catalog-path:')&&exactKey(old.identifier)===exactKey(rule.source_identifier),
      'DCAT_MAPPING_BASELINE_CHANGED','The selected baseline decision no longer binds its retained original record.');
    const matches=fresh.source_inventory.records.filter(row=>row.scope_key===old.scope_key&&row.role===old.role&&
      exactKey(row.identifier)===exactKey(old.identifier));
    need(matches.length===1,'DCAT_MAPPING_SOURCE_AMBIGUOUS',
      'A selected identity decision does not match exactly one current source record. Review that decision against this edition.',409);
    const source=matches[0];let target;
    if(preserveCandidate) {
      const oldTarget=baseline.candidate_inventory.records.find(row=>row.path===rule.target_path);
      need(oldTarget&&!oldTarget.scope_key.startsWith('catalog-path:')&&
        exactKey(oldTarget.identifier)===exactKey(rule.target_identifier),'DCAT_MAPPING_BASELINE_CHANGED');
      const targets=fresh.candidate_inventory.records.filter(row=>row.scope_key===oldTarget.scope_key&&
        row.role===oldTarget.role&&exactKey(row.identifier)===exactKey(rule.target_identifier));
      need(targets.length===1,'DCAT_MAPPING_TARGET_AMBIGUOUS',
        'A selected identity decision does not match exactly one record in this edited candidate. Supply the current mapping explicitly.',409);
      target=targets[0];
    } else {
      const links=fresh.conservation.mappings.filter(row=>row.source_path===source.path);
      need(links.length===1,'DCAT_MAPPING_TARGET_AMBIGUOUS',
        'A selected identity decision has no unique current generated target. Supply a reviewed candidate for this edition.',409);
      target=fresh.candidate_inventory.records.find(row=>row.path===links[0].target_path);
    }
    need(target&&!used.has(target.path)&&!mappings.some(row=>row.source_path===source.path||row.target_path===target.path),
      'DCAT_MAPPING_TARGET_AMBIGUOUS','Selected identity decisions overlap. Review this edition explicitly.',409);
    if(!preserveCandidate) {
      const body=atPointer(candidate,target.path);
      need(exactKey(body[target.identifier_field])===exactKey(target.identifier),'DCAT_MAPPING_TARGET_CHANGED');
      body[target.identifier_field]=clone(rule.target_identifier);
    }
    used.add(target.path);
    mappings.push({source_path:source.path,target_path:target.path,
      source_identifier:clone(source.identifier),target_identifier:clone(rule.target_identifier)});
  }
  return {candidate:preserveCandidate?null:bytes(candidate),mappings};
}

export function createDcatAcquisition({directory,current,launch,persist,environment,catalogBytes,
  saveCatalog,review,runReview,runFresh,download}) {
  current.sources??=[];current.acquisitions??=[];
  const get=id=>item(current.sources,id);
  const cooldown=(id,url)=>{
    const origin=new URL(url).origin;
    const deadlines=current.acquisitions.filter(row=>row.sourceId===id&&(new URL(row.config.url).origin===origin||row.finalUrl&&new URL(row.finalUrl).origin===origin))
      .map(row=>Date.parse(row.retryNotBefore??'')).filter(value=>Number.isFinite(value)&&value>Date.now());
    return deadlines.length?new Date(Math.max(...deadlines)).toISOString():null;
  };
  function selected(input) {
    const source=get(input.sourceId);
    need(source.sourceSha256===input.expectedSourceSha256,'DCAT_SOURCE_CHANGED',
      'Refresh the saved source configuration before continuing.',409);
    need(own(input,'expectedLatestCatalogId')&&source.latestCatalogId===input.expectedLatestCatalogId,
      'DCAT_SOURCE_EDITION_CHANGED','Refresh the latest acquired catalog before continuing.',409);
    return source;
  }
  function baselineSelection(input) {
    need(own(input,'baselineReleaseId'),'DCAT_BASELINE_REQUIRED','Choose an accepted baseline or explicitly select none.');
    if(input.baselineReleaseId===null)return null;
    const release=item(current.releases,input.baselineReleaseId);
    need(release.sha256===input.expectedBaselineSha256&&release.reviewSha256===input.expectedBaselineReviewSha256,
      'DCAT_BASELINE_CHANGED','Refresh both exact hashes of the selected accepted baseline.',409);
    return release;
  }
  return {
    saveDcatSource(input) {
      need(object(input),'DCAT_SOURCE_INPUT_INVALID');input=clone(input);
      need(own(input,'id')===own(input,'expectedSourceSha256'),'DCAT_SOURCE_UPDATE_BINDING_REQUIRED',
        'Bind a source update with both its saved ID and inspected configuration hash.');
      const previous=own(input,'id')?get(input.id):null;
      need(!previous||input.expectedSourceSha256===previous.sourceSha256,'DCAT_SOURCE_CHANGED',
        'Refresh the saved source before editing its configuration.',409);
      const config=dcatSourceConfig(input,previous??{}),sha256=identity(config),id=previous?.id??randomUUID();
      return {...launch('save DCAT HTTP source',async()=>{
        const now=stamp(),version={sourceSha256:sha256,config,savedAt:now};
        if(previous?.sourceSha256===sha256)return structuredClone(previous);
        const row=previous??{id,createdAt:now,versions:[],selections:[],retryNotBefore:null};
        if(!row.versions.some(v=>v.sourceSha256===sha256)) {
          const root=join(directory,'dcat','sources',id);await privateDirectory(root,true);
          await createFile(join(root,sha256+'.json'),bytes(version));row.versions.push(version);
        }
        // Preserve a provider cooldown when returning to or editing its origin.
        const retryNotBefore=cooldown(id,config.url);
        row.selections??=row.versions.filter(v=>v.sourceSha256!==sha256).map(v=>({sourceSha256:v.sourceSha256,selectedAt:v.savedAt}));
        row.selections.push({sourceSha256:sha256,selectedAt:now});
        Object.assign(row,config,{sourceSha256:sha256,updatedAt:now,latestCatalogId:null,
          latestAcquisitionId:null,lastSuccessfulAcquisitionId:null,lastCheckedAt:null,nextCheckAt:null,
          retryNotBefore});
        if(!previous)current.sources.push(row);
        await persist();return structuredClone(row);
      }),sourceId:id};
    },
    acquireDcatSource(input) {
      need(object(input),'DCAT_SOURCE_INPUT_INVALID');input=clone(input);
      const source=selected(input),now=Date.now(),retryDeadline=cooldown(source.id,source.url);
      need(!retryDeadline||Date.parse(retryDeadline)<=now,'DCAT_PROVIDER_RETRY_AFTER',
        'Wait until the retained provider retry deadline before requesting this source.',409);
      need(!input.onlyIfDue||source.enabled&&(!source.nextCheckAt||Date.parse(source.nextCheckAt)<=now),
        'DCAT_SOURCE_NOT_DUE','This source is paused or its next check is not due.',409);
      for(const key of ['onlyIfDue','unconditional'])need(input[key]===undefined||typeof input[key]==='boolean','DCAT_SOURCE_INPUT_INVALID');
      const retry=input.retryOf?item(current.acquisitions,input.retryOf):null;
      need(!retry||retry.sourceId===source.id&&['FAILED','INTERRUPTED'].includes(retry.status),'DCAT_ACQUISITION_RETRY_INVALID');
      const id=randomUUID(),attempt={id,sourceId:source.id,sourceSha256:source.sourceSha256,config:configOf(source),
        startedAt:stamp(),completedAt:null,status:'FETCHING',previousCatalogId:source.latestCatalogId,
        catalogId:null,unconditional:input.unconditional??false,retryOf:retry?.id??null,httpStatus:null,finalUrl:null,
        responseSha256:null,responseBytes:null,responseComplete:null,receiptSha256:null,receiptBytes:null,
        retryNotBefore:null,error:null,validators:null,receiptNeedsRecovery:false};
      return {...launch('acquire DCAT catalog edition',async(signal,progress)=>{
        const previousSuccess=source.lastSuccessfulAcquisitionId,previousCatalog=source.latestCatalogId;
        current.acquisitions.push(attempt);source.latestAcquisitionId=id;await persist();
        const receipt=receiptFor(attempt);let body=null,complete=false;
        const checkpoint=async()=>{await saveReceipt(directory,attempt,receipt);await persist();};
        const finishTiming=()=>{
          attempt.completedAt=stamp();attempt.httpStatus=receipt.httpStatus??attempt.httpStatus;
          attempt.finalUrl=receipt.finalUrl??attempt.finalUrl;attempt.retryNotBefore=receipt.retryNotBefore??null;
          source.lastCheckedAt=attempt.completedAt;
          source.retryNotBefore=cooldown(source.id,source.url);
          source.nextCheckAt=new Date(Math.max(Date.parse(attempt.completedAt)+source.intervalMinutes*60000,
            Date.parse(source.retryNotBefore??'')||0)).toISOString();
        };
        const finalReceipt=()=>Object.assign(receipt,{status:attempt.status,completedAt:attempt.completedAt,error:attempt.error,
          catalogId:attempt.catalogId,responseSha256:attempt.responseSha256,responseBytes:attempt.responseBytes,
          responseComplete:attempt.responseComplete,validators:attempt.validators});
        const retainBody=async()=>{
          if(body===null)return;
          const root=attemptRoot(directory,id);await privateDirectory(root,true);
          await createFile(join(root,'response.bin'),body);
          attempt.responseSha256=digest(body);attempt.responseBytes=body.length;attempt.responseComplete=complete;
        };
        try {
          await checkpoint();
          const previous=previousCatalog?item(current.catalogs,previousCatalog):null;
          if(previous)await catalogBytes(previous);
          const last=previousSuccess?item(current.acquisitions,previousSuccess):null;
          const prior=!attempt.unconditional&&last?.sourceSha256===source.sourceSha256?last:null;
          const result=await receive(attempt.config,prior,environment,signal,receipt,checkpoint,progress);
          body=result.body;complete=result.complete;
          Object.assign(attempt,{httpStatus:result.httpStatus,finalUrl:result.finalUrl,validators:result.validators});
          await retainBody();
          if(result.httpStatus===304) {attempt.catalogId=previous.id;attempt.status='NOT_MODIFIED';}
          else if(previous&&previous.sha256===digest(body)&&previous.bytes===body.length) {
            attempt.catalogId=previous.id;attempt.status='UNCHANGED';
          } else {
            const catalog=await saveCatalog(body,{label:source.label+' '+stamp(),profile:source.profile,
              origin:result.finalUrl,acquisitionId:id,acquisitionSourceId:source.id,acquisitionSourceSha256:source.sourceSha256});
            attempt.catalogId=catalog.id;attempt.status='ACQUIRED';
          }
          finishTiming();
          await saveReceipt(directory,attempt,finalReceipt());
          // Publish success only after the complete response and final receipt exist.
          source.latestCatalogId=attempt.catalogId;source.lastSuccessfulAcquisitionId=id;
          await persist();
          return structuredClone(attempt);
        } catch(error) {
          source.latestCatalogId=previousCatalog;source.lastSuccessfulAcquisitionId=previousSuccess;
          body=error.acquisitionBody??body;complete=error.acquisitionComplete??complete;
          attempt.status=signal.aborted?'INTERRUPTED':'FAILED';attempt.catalogId=null;
          attempt.error=safeError(error,signal);attempt.responseComplete=complete;
          // File failures can occur after an atomic write reached disk. Read the
          // actual bounded files before binding this retained failure to bytes.
          try {
            const raw=await readPrivate(join(attemptRoot(directory,id),'response.bin'),attempt.config.maxResponseBytes);
            attempt.responseSha256=digest(raw);attempt.responseBytes=raw.length;
            attempt.responseComplete=complete&&body!==null&&raw.length===body.length&&digest(raw)===digest(body);
          } catch(readError) {
            if(readError.code==='ENOENT') {
              attempt.responseSha256=null;attempt.responseBytes=null;
              try {await retainBody();} catch {attempt.responseComplete=false;}
            } else {attempt.responseSha256=null;attempt.responseBytes=null;attempt.responseComplete=false;}
          }
          finishTiming();
          try {await saveReceipt(directory,attempt,finalReceipt());}
          catch {
            attempt.receiptNeedsRecovery=true;
            try {
              const raw=await readPrivate(join(attemptRoot(directory,id),'receipt.json'),RECEIPT_MAX);
              const saved=parseCkanJson(raw);
              need(saved.acquisitionId===id&&saved.sourceSha256===attempt.sourceSha256,'DCAT_RECEIPT_BINDING_CHANGED');
              attempt.receiptSha256=digest(raw);attempt.receiptBytes=raw.length;
            } catch {attempt.receiptSha256=null;attempt.receiptBytes=null;}
          }
          await persist();
          throw fault(attempt.error.code,attempt.error.message,502);
        }
      }),sourceId:source.id,acquisitionId:id};
    },
    dcatSource(id) {
      const source=get(id);
      return {source:structuredClone(source),
        acquisitions:structuredClone(current.acquisitions.filter(row=>row.sourceId===id)),
        reviews:structuredClone(current.reviews.filter(row=>row.acquisitionSourceId===id))};
    },
    prepareDcatSourceReview(input) {
      need(object(input),'DCAT_SOURCE_INPUT_INVALID');input=clone(input);
      const source=selected(input),baseline=baselineSelection(input);
      need(source.latestCatalogId&&source.lastSuccessfulAcquisitionId,'DCAT_SOURCE_HAS_NO_EDITION',
        'Acquire a complete edition for this source configuration first.',409);
      need(input.reuseMappingIndexes===undefined||Array.isArray(input.reuseMappingIndexes),'DCAT_MAPPING_SELECTION_INVALID');
      need(!input.reuseMappingIndexes?.length||baseline,'DCAT_MAPPING_BASELINE_REQUIRED');
      need(input.identityMappings===undefined||Array.isArray(input.identityMappings),'DCAT_MAPPINGS_INVALID');
      need(input.normalizeV3===undefined||typeof input.normalizeV3==='boolean','DCAT_NORMALIZATION_INVALID');
      const value=randomUUID(),attempt=item(current.acquisitions,source.lastSuccessfulAcquisitionId);
      const binding={acquisitionSourceId:source.id,acquisitionSourceSha256:source.sourceSha256,
        acquisitionId:attempt.id,baselineReleaseId:baseline?.id??null,baselineSha256:baseline?.sha256??null,
        baselineReviewSha256:baseline?.reviewSha256??null,reuseMappingIndexes:[...(input.reuseMappingIndexes??[])]};
      return {...launch('review following DCAT catalog edition',(signal,progress)=>
        runReview({...input,sourceId:source.latestCatalogId},value,binding,signal,progress,async()=>{
          let comparison=null,candidateId=input.candidateId,mappings=input.identityMappings??[];
          if(baseline) {
            await review(baseline.reviewId);
            const raw=await readPrivate(join(directory,'dcat','reviews',baseline.reviewId,'candidate.json'),MAX);
            need(digest(raw)===baseline.sha256&&raw.length===baseline.bytes,'DCAT_BASELINE_CHANGED');
            comparison=current.catalogs.find(row=>row.acceptedReleaseId===baseline.id&&row.sha256===baseline.sha256);
            if(comparison)await catalogBytes(comparison);
            else comparison=await saveCatalog(raw,{label:'Accepted baseline '+baseline.id,profile:'3.0',origin:null,
              acceptedReleaseId:baseline.id,acceptedReviewSha256:baseline.reviewSha256});
          }
          if(input.reuseMappingIndexes?.length) {
            const old=await review(baseline.reviewId),fresh=await runFresh(
              {sourceId:source.latestCatalogId,candidateId,normalizeV3:input.normalizeV3??false},signal,progress);
            const edited=reuseDcatIdentityMappings(old,fresh,input.reuseMappingIndexes,mappings,{preserveCandidate:!!candidateId});
            if(!candidateId) {
              const selected=await saveCatalog(edited.candidate,{label:'Selected identity decisions for '+source.label,
              profile:'3.0',origin:null,derivedFromCatalogId:source.latestCatalogId,baselineReleaseId:baseline.id,
              reuseMappingIndexes:binding.reuseMappingIndexes});
              candidateId=selected.id;
            }
            mappings=edited.mappings;
          }
          return {...input,sourceId:source.latestCatalogId,comparisonId:comparison?.id??null,
            candidateId,identityMappings:mappings};
        })),sourceId:source.id,reviewId:value};
    },
    async dcatAcquisitionDownload(id,kind='receipt') {
      need(['receipt','response'].includes(kind),'DCAT_ACQUISITION_DOWNLOAD_KIND');
      const selected=item(current.acquisitions,id),hash=selected[kind+'Sha256'],count=selected[kind+'Bytes'];
      need(hash,'DCAT_ACQUISITION_FILE_UNAVAILABLE','This attempt has no retained '+kind+' file.',404);
      const member='acquisitions/'+id+'/'+(kind==='receipt'?'receipt.json':'response.bin');
      const raw=await readPrivate(join(directory,'dcat',member),kind==='receipt'?RECEIPT_MAX:MAX);
      need(digest(raw)===hash&&raw.length===count,'DCAT_ACQUISITION_FILE_CHANGED');
      return {...download(member,{id,sha256:hash,bytes:count},kind,'dcat-'+kind+'-'+id+(kind==='receipt'?'.json':'.bin')),
        mediaType:kind==='receipt'?'application/json; charset=utf-8':'application/octet-stream'};
    },
  };
}
