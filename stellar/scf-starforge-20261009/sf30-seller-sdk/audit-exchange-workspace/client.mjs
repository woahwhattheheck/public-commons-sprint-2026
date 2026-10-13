/**
 * Browser and Node client for one Audit Exchange workspace.
 * Native XML values and structural paths remain exact strings.
 *
 * @typedef {{code:string,message:string,line?:number,column?:number,path?:string,severity:'error'|'warning',profileId?:string}} AuditDiagnostic
 * @typedef {{id:string,valid:boolean,diagnostics:AuditDiagnostic[],svrl?:string}} AuditProfileValidation
 * @typedef {{xsd:{valid:boolean,diagnostics:AuditDiagnostic[]},profiles:AuditProfileValidation[]}} AuditValidation
 * @typedef {{entities:number,facilities:number,buildings:number,systems:number,measures:number,scenarios:number,resources:number,timeSeries:number}} AuditCounts
 * @typedef {{id:string,name:string,originalSha256:string,currentRevisionId:string,revisionNumber:number,declaredVersion:string,selectedSchema:string,profileIds:string[],counts:AuditCounts,validation:AuditValidation,importedAt:string,originUri?:string}} AuditSource
 * @typedef {{id:string,number:number,parentId:string|null,sha256:string,bytes:number,createdAt:string,actor:string,note:string,selectedSchema:string,profileIds:string[],declaredVersion:string}} AuditRevision
 * @typedef {'root'|'facility'|'site'|'building'|'section'|'thermal-zone'|'space'|'system'|'measure'|'report'|'scenario'|'resource-use'|'time-series'|'utility'|'rate-schedule'|'contact'|'tenant'|'schedule'|'weather-station'|'derived-model'|'model'|'saving-summary'|''} AuditSemanticKind
 * @typedef {{key:string,kind:string,semanticKind:AuditSemanticKind,xmlId:string|null,path:string,label:string,facilityKeys:string[],buildingKeys:string[],fieldKeys:string[]}} AuditEntity
 * @typedef {{key:string,entityKey:string,path:string,kind:'text'|'attribute',attributeName?:string,name:string,value:string,editable:boolean}} AuditField
 * @typedef {{fromKey:string,path:string,targetXmlId:string,targetKey:string|null,resolution:'resolved'|'missing'|'ambiguous'}} AuditReference
 * @typedef {'absent'|'resolved'|'ambiguous'|'invalid'} AuditReferenceState
 * @typedef {{key:string,path:string,entityKey:string,resourceKey:string,resourceXmlId:string,readingType:string,units:string,start:string,end:string,value:string,interval:string,scenarioKey:string,buildingKeys:string[],streamKey:string,peakType:string,intervalDuration:string,intervalDurationUnits:string,quantity:string,phase:string,flowDirection:string,valueSource:string,unitsSourcePath:string,energyResource:string,resourceUnits:string,peakResourceUnits:string,weatherStationKey:string,weatherStationXmlId:string,resourceState:AuditReferenceState,weatherStationState:AuditReferenceState,buildingScopeState:'unassigned'|'associated'|'conflict',resourceKeys:string[],weatherStationKeys:string[],scenarioBuildingKeys:string[],resourceBuildingKeys:string[]}} AuditSeries
 * @typedef {{source:AuditSource,revision:AuditRevision,revisions:AuditRevision[],xmlText:string,model:{entities:AuditEntity[],fields:AuditField[],references:AuditReference[],timeSeries:AuditSeries[],diagnostics:AuditDiagnostic[]},validation:AuditValidation}} AuditSourceDetail
 * @typedef {{id:string,number:number,name:string,note:string,actor:string,createdAt:string,version:number,sources:{sourceId:string,revisionId:string,sha256:string}[]}} AuditEditionSummary
 * @typedef {AuditEditionSummary & {reviews:AuditReview[],links:AuditLink[],analysisRuns:AuditAnalysis[]}} AuditEdition
 * @typedef {{id:string,sourceId:string,revisionId:string,entityKey?:string,status:'open'|'investigating'|'resolved'|'accepted',title:string,note:string,assignee:string,dueDate:string,evidence:{label:string,url:string}[],actor:string,createdAt?:string}} AuditReview
 * @typedef {{id:string,sourceId:string,revisionId:string,entityKey:string,targetKind:'haystack'|'lda'|'turnover',targetWorkspaceId:string,targetRecordId:string,note:string,actor:string}} AuditLink
 * @typedef {{id:string,kind:'xml'|'review'|'workspace'|'application'|'turnover-projection'|'analysis-output'|'colleague-return',name:string,bytes:number,sha256:string,downloadUrl:string,createdAt:string,mime?:string,sourceId?:string,revisionId?:string}} AuditExport
 * @typedef {{name:string,downloadUrl:string,bytes?:number,sha256?:string}} AuditOutput
 * @typedef {'Mean'|'SLR'|'3PC'|'3PH'|'4P'|'5P'|'HDD'|'CDD'|'HDD-CDD'|'TOW'|'TOWT'} AuditNativeModel
 * @typedef {{models?:AuditNativeModel[],sourceTimezone?:string,weatherTimezone?:string,weatherColumns?:{time:string,temp:string,end?:string,station?:string},weatherUnits?:'F'|'C'|'degF'|'degC'|'°F'|'°C',weatherInterval?:'15-min'|'Hourly'|'Daily',endPolicy?:'required'|'next-reading'|'frequency',lastEnd?:string,interval?:'15-min'|'Hourly'|'Daily'|'Monthly',baseline?:{start:string,end:string},reporting?:{start:string,end:string},normalization?:{start:string,end:string},modelArguments?:Record<string,unknown>,balancePoint?:number,confidenceLevel?:number,allowNegativePredictions?:boolean,seed?:number,timeoutSeconds?:number,weatherMissingValues?:string[]}} AuditModelOptions
 * @typedef {'queued'|'running'|'complete'|'partial'|'failed'|'needs-input'|'needs-runtime'} AuditAnalysisStatus
 * @typedef {{id?:string,analysisId?:string,status:AuditAnalysisStatus,sourceId?:string,revisionId?:string,outputs:AuditOutput[],diagnostics:AuditDiagnostic[],createdAt?:string,completedAt?:string,selectionSummary?:Omit<AuditNativeAnalysisSelection,'readings'>,readingCount?:number,modelOptions?:AuditModelOptions,weather?:{name:string,source:string,sha256:string,bytes:number},metadata?:Record<string,unknown> & {terminal?:boolean},continuations?:{at:string,actor:string,note:string,previousStatus:AuditAnalysisStatus,previousDiagnostics:AuditDiagnostic[],previousMetadata:Record<string,unknown>,previousOutputs:AuditOutput[]}[]}} AuditAnalysis
 * @typedef {'entities'|'fields'|'references'|'timeSeries'|'diagnostics'} AuditModelSection
 * @typedef {{sourceId:string,revisionId:string,sha256:string,section:AuditModelSection,offset:number,total:number,nextOffset:number|null,items:(AuditEntity|AuditField|AuditReference|AuditSeries|AuditDiagnostic)[]}} AuditSourcePage
 * @typedef {{id:string,sha256:string,bytes:number,offset:number,length:number,nextOffset:number|null,complete:boolean,contentBase64:string}} AuditByteRange
 * @typedef {{format:'commons.audit-exchange.workspace.v1',workspaceId:string,name:string,version:number,createdAt:string,sources:AuditSource[],editions:AuditEditionSummary[],reviews:AuditReview[],links:AuditLink[],analysisRuns:AuditAnalysis[],exports:AuditExport[],standards:{schemas:{id:string,version:string,label:string}[],profiles:{id:string,label:string}[],licenses:{path:string,label:string}[]}}} AuditState
 * @typedef {{sourceId:string,revisionId?:string,buildingKey:string,scenarioKey:string,resourceKey:string,readingType:string,units:string,streamKey?:string}} AuditAnalysisSelection
 * @typedef {{path:string,kind:'text'|'attribute',attributeName?:string,expected:string,value:string}} AuditPatch
 * @typedef {{sourceId:string,revisionId?:string,assetEntityKeys:string[],documentEntityKeys:string[],requirementEntityKeys:string[]}} AuditProjectionSelection
 * @typedef {{sourceId:string,revisionId:string,sourceSha256:string,building:AuditEntity & {latitude:string,longitude:string},scenario:AuditEntity,resource:AuditEntity & {energyResource:string,resourceUnits:string,peakResourceUnits:string},readingType:string,units:string,readings:AuditSeries[],streamKey:string,selectedStreamKey:string,selectionSha256:string}} AuditNativeAnalysisSelection
 * @typedef {{selection:AuditNativeAnalysisSelection,readings:AuditSeries[],diagnostics:AuditDiagnostic[],nativeProfile:{processor:string,requiresWeather:boolean,selectionSha256:string}}} AuditAnalysisPreview
 * @typedef {{tables:Record<string,Record<string,unknown>[]>,diagnostics:AuditDiagnostic[],sourceId:string,revisionId:string,selectionSha256:string}} AuditProjectionPreview
 * @typedef {{sourceId:string,fromRevisionId:string,toRevisionId:string,added:AuditField[],removed:AuditField[],changed:{key:string,before:AuditField,after:AuditField}[],referenceChanges:{kind:'added'|'removed',reference:AuditReference}[],counts:{added:number,removed:number,changed:number,referenceChanges:number}}} AuditComparison
 * @typedef {{
 * 'return.preview':{contentBase64:string,name:string,baselines?:{sourceId:string,returnedSourceId:string,baselineRevisionId:string}[]},
 * 'return.plan':AuditReturnInput,
 * 'return.apply':AuditReturnInput & {expectedPlanSha256:string,acceptDiagnostics:boolean,actor:string,note?:string,editionName?:string},
 * 'workspace.get':{},
 * 'source.get':{sourceId:string,revisionId?:string},
 * 'source.page':{sourceId:string,revisionId?:string,section:AuditModelSection,offset?:number,limit?:number},
 * 'source.bytes':{sourceId:string,revisionId?:string,offset?:number,length?:number},
 * 'export.read':{exportId:string,offset?:number,length?:number},
 * 'operation.get':{requestId:string},
 * 'edition.get':{editionId:string},
 * 'source.compare':{sourceId:string,fromRevisionId:string,toRevisionId:string},
 * 'export.get':{exportId:string},
 * 'analysis.preview':AuditAnalysisSelection,
 * 'projection.preview':AuditProjectionSelection,
 * 'source.import':{name:string,contentBase64:string,selectedSchema:string,profileIds:string[],actor:string,note:string},
 * 'source.replace':{sourceId:string,expectedRevisionId:string,name?:string,contentBase64:string,selectedSchema:string,profileIds:string[],actor:string,note:string},
 * 'source.patch':{sourceId:string,expectedRevisionId:string,patches:AuditPatch[],selectedSchema?:string,profileIds?:string[],actor:string,note:string},
 * 'source.validate':{sourceId:string,expectedRevisionId:string,selectedSchema:string,profileIds:string[],actor:string,note:string},
 * 'edition.save':{name:string,note:string,actor:string},
 * 'review.save':{id?:string,sourceId:string,revisionId:string,entityKey?:string,status:'open'|'investigating'|'resolved'|'accepted',title:string,note:string,assignee:string,dueDate:string,evidence:{label:string,url:string}[],actor:string},
 * 'link.save':{id?:string,sourceId:string,revisionId:string,entityKey:string,targetKind:'haystack'|'lda'|'turnover',targetWorkspaceId:string,targetRecordId:string,note:string,actor:string},
 * 'projection.save':AuditProjectionSelection & {revisionId:string,expectedSelectionSha256:string,actor:string,note:string},
 * 'analysis.run':AuditAnalysisSelection & {revisionId:string,weatherCsvBase64:string,weatherName:string,weatherSource:string,modelOptions:AuditModelOptions,actor:string,note:string},
 * 'analysis.resume':{analysisId:string,actor:string,note:string},
 * 'export.create':{kind:'xml'|'review'|'workspace'|'application',sourceId?:string,revisionId?:string,editionId?:string,actor:string,note:string},
 * 'workspace.receive':{contentBase64:string,name:string,actor:string,note:string}
 * }} AuditInputMap
 * @typedef {{
 * 'return.preview':Record<string,unknown>,
 * 'return.plan':Record<string,unknown> & {planSha256:string},
 * 'return.apply':{archive:AuditExport,sources:{sourceId:string,sourceName:string,revisionId:string,changed:boolean,reviewIds:string[]}[],planSha256:string,edition:{editionId:string}},
 * 'workspace.get':AuditState,
 * 'source.get':AuditSourceDetail,
 * 'source.page':AuditSourcePage,
 * 'source.bytes':AuditByteRange,
 * 'export.read':AuditByteRange,
 * 'operation.get':{requestId:string,action:AuditMutationAction,result:unknown,version:number,createdAt:string},
 * 'edition.get':AuditEdition,
 * 'source.compare':AuditComparison,
 * 'export.get':AuditExport,
 * 'analysis.preview':AuditAnalysisPreview,
 * 'projection.preview':AuditProjectionPreview,
 * 'source.import':{sourceId:string,revisionId:string,validation:AuditValidation},
 * 'source.replace':{sourceId:string,revisionId:string,validation:AuditValidation},
 * 'source.patch':{sourceId:string,revisionId:string,validation:AuditValidation},
 * 'source.validate':{sourceId:string,revisionId:string,validation:AuditValidation},
 * 'edition.save':{editionId:string,number:number},
 * 'review.save':{reviewId:string},
 * 'link.save':{linkId:string},
 * 'projection.save':{projectionId:string,exportId:string,downloadUrl:string},
 * 'analysis.run':AuditAnalysis,
 * 'analysis.resume':AuditAnalysis,
 * 'export.create':AuditExport,
 * 'workspace.receive':{receivedSources:number,receivedEditions:number,receivedReviews:number,receivedLinks:number,sourceIdMap:Record<string,string>,packageSha256:string}
 * }} AuditResultMap
 * @typedef {{fieldId:string,choice:'current'|'returned'|'custom',value?:string}} AuditReturnDecision
 * @typedef {{sourceId:string,returnedSourceId:string,baselineRevisionId:string,expectedCurrentRevisionId:string,expectedCurrentSha256:string,mode:'fields'|'current'|'returned-document',decisions:AuditReturnDecision[],reviewIds:string[],note:string}} AuditReturnSelection
 * @typedef {{contentBase64:string,name:string,expectedPreviewSha256:string,baselines?:{sourceId:string,returnedSourceId:string,baselineRevisionId:string}[],selections:AuditReturnSelection[]}} AuditReturnInput
 * @typedef {'return.preview'|'return.plan'|'workspace.get'|'source.get'|'source.page'|'source.bytes'|'edition.get'|'source.compare'|'export.get'|'export.read'|'operation.get'|'analysis.preview'|'projection.preview'} AuditReadAction
 * @typedef {'return.apply'|'source.import'|'source.replace'|'source.patch'|'source.validate'|'edition.save'|'review.save'|'link.save'|'projection.save'|'analysis.run'|'analysis.resume'|'export.create'|'workspace.receive'} AuditMutationAction
 * @typedef {{action:AuditMutationAction,inputs:Record<string,unknown>,requestId:string,expectedVersion:number}} AuditMutationEnvelope
 * @typedef {{schema:'commons.audit-exchange.startup.v1',url:string,workspaceId:string,workspaceCreatedAt:string,instanceId:string,directory:string}} AuditServerIdentity
 */

export const AUDIT_MUTATIONS = new Set([
  "source.import","source.replace","source.patch","source.validate","edition.save",
  "review.save","link.save","projection.save","analysis.run","analysis.resume","export.create","workspace.receive","return.apply"
]);
export const AUDIT_READS = new Set([
  "workspace.get","source.get","source.page","source.bytes","edition.get","source.compare","export.get","export.read","operation.get",
  "analysis.preview","projection.preview","return.preview","return.plan"
]);

export class AuditExchangeError extends Error {
  /** @param {string} message @param {{code?:string,status?:number,details?:unknown,stateVersion?:number,outcomeUnknown?:boolean,cause?:unknown}} [options] */
  constructor(message, options = {}) {
    super(message);
    this.name = "AuditExchangeError";
    this.code = options.code || "AUDIT_CLIENT_ERROR";
    this.status = options.status || 0;
    this.details = options.details;
    this.stateVersion = options.stateVersion;
    this.outcomeUnknown = Boolean(options.outcomeUnknown);
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

/** @returns {string} */
export function auditRequestId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  if (!globalThis.crypto?.getRandomValues) throw new AuditExchangeError("This browser needs secure random values to retain an original request.");
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const value = Array.from(bytes, x => x.toString(16).padStart(2,"0")).join("");
  return value.slice(0,8)+"-"+value.slice(8,12)+"-"+value.slice(12,16)+"-"+value.slice(16,20)+"-"+value.slice(20);
}

/** @param {Uint8Array|ArrayBuffer} bytes @returns {Promise<string>} */
export async function auditSha256(bytes) {
  if (!globalThis.crypto?.subtle) throw new AuditExchangeError("Web Crypto is required to verify the complete file bytes.");
  const hash = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), x => x.toString(16).padStart(2,"0")).join("");
}

/** @param {Blob} file @returns {Promise<string>} */
export async function auditFileBase64(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let value = "";
  for (let at = 0; at < bytes.length; at += 32768) value += String.fromCharCode(...bytes.subarray(at, at + 32768));
  return btoa(value);
}

function isState(value) {
  return value && value.format === "commons.audit-exchange.workspace.v1" &&
    typeof value.workspaceId === "string" && value.workspaceId &&
    Number.isSafeInteger(value.version) && value.version >= 0 &&
    Array.isArray(value.sources) && Array.isArray(value.editions);
}

/**
 * One pinned HTTP workspace. Requests are never automatically retried.
 * The caller retains a complete mutation envelope before execute().
 */
export class AuditExchangeClient {
  /** @param {{baseUrl:string,workspaceId?:string,token?:string,fetch?:typeof globalThis.fetch}} options */
  constructor({baseUrl, workspaceId, token, fetch: fetchImpl} = {}) {
    if (!baseUrl) throw new AuditExchangeError("Enter the URL of the original Audit Exchange server.");
    const base = new URL(baseUrl);
    if (!["http:","https:"].includes(base.protocol) || base.username || base.password || base.search || base.hash)
      throw new AuditExchangeError("Use an HTTP server URL without credentials, a query, or a fragment.");
    base.pathname = base.pathname.replace(/\/?$/, "/");
    this.baseUrl = base.href;
    this.workspaceId = workspaceId || null;
    this.token = token || "";
    this.fetch = fetchImpl || globalThis.fetch?.bind(globalThis);
    if (!this.fetch) throw new AuditExchangeError("An HTTP fetch implementation is required.");
    /** @type {AuditState|null} */
    this.state = null;
  }

  /** @param {AuditState} state @returns {AuditState} */
  acceptState(state) {
    if (!isState(state)) throw new AuditExchangeError("The server returned another workspace format.", {code:"AUDIT_STATE_FORMAT"});
    if (this.workspaceId && this.workspaceId !== state.workspaceId)
      throw new AuditExchangeError("This server now points to another workspace. Open it deliberately as a new connection.", {code:"AUDIT_WORKSPACE_CHANGED",status:409});
    this.workspaceId = state.workspaceId;
    this.state = state;
    return state;
  }

  /** @returns {Promise<AuditState>} */
  async connect() {
    const response = await this.http("api/state", {method:"GET"});
    return this.acceptState(response.result);
  }

  /** @returns {Promise<AuditState>} */
  async getState() { return this.connect(); }

  /** @returns {Promise<AuditServerIdentity>} */
  async identity() {
    if (!this.workspaceId) await this.connect();
    const value = await this.http("api/identity", {method:"GET",raw:true});
    if (value?.schema !== "commons.audit-exchange.startup.v1" || value.workspaceId !== this.workspaceId ||
        typeof value.instanceId !== "string" || typeof value.workspaceCreatedAt !== "string")
      throw new AuditExchangeError("The application identity differs from this original workspace.", {code:"AUDIT_WORKSPACE_CHANGED",status:409});
    return value;
  }

  /**
   * @template {AuditReadAction} A
   * @param {A} action
   * @param {AuditInputMap[A]} inputs
   * @returns {Promise<AuditResultMap[A]>}
   */
  async read(action, inputs = {}) {
    if (!AUDIT_READS.has(action)) throw new AuditExchangeError("Use a retained mutation envelope for "+action+".");
    if (!this.workspaceId) await this.connect();
    const response = await this.http("api/action", {method:"POST", body:{action, inputs}, mutation:false});
    if (response.state) this.acceptState(response.state);
    if (action === "workspace.get") this.acceptState(response.result);
    return response.result;
  }

  /**
   * Prepare once, retain unchanged, then execute or recover this same envelope.
   * @template {AuditMutationAction} A
   * @param {A} action
   * @param {AuditInputMap[A]} inputs
   * @param {{requestId?:string,expectedVersion?:number}} [options]
   * @returns {AuditMutationEnvelope}
   */
  envelope(action, inputs, {requestId = auditRequestId(), expectedVersion = this.state?.version} = {}) {
    if (!AUDIT_MUTATIONS.has(action)) throw new AuditExchangeError("Unknown Audit Exchange mutation: "+action);
    if (!this.workspaceId || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0)
      throw new AuditExchangeError("Open the workspace before retaining its original request.");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId))
      throw new AuditExchangeError("Use the original UUID request identity.");
    return JSON.parse(JSON.stringify({action, inputs, requestId, expectedVersion}));
  }

  /**
   * Execute one complete retained envelope. Reuse it verbatim after a lost reply.
   * @param {AuditMutationEnvelope} envelope
   * @returns {Promise<{result:AuditResultMap[AuditMutationAction],state:AuditState}>}
   */
  async execute(envelope) {
    if (!envelope || !AUDIT_MUTATIONS.has(envelope.action) ||
        !Number.isSafeInteger(envelope.expectedVersion) || !envelope.requestId)
      throw new AuditExchangeError("Open the complete original mutation envelope.");
    if (!this.workspaceId) await this.connect();
    const response = await this.http("api/action", {method:"POST", body:envelope, mutation:true});
    if (!response.state || !Object.prototype.hasOwnProperty.call(response,"result")) throw new AuditExchangeError("The mutation response omitted its workspace state or original result. Recover the same request.", {code:"AUDIT_RESPONSE_INCOMPLETE",outcomeUnknown:true});
    try { this.acceptState(response.state); }
    catch (error) { error.outcomeUnknown = true; throw error; }
    return response;
  }

  /**
   * Download the complete retained server file and verify supplied byte/hash metadata.
   * @param {AuditExport|AuditOutput} item
   * @returns {Promise<{bytes:Uint8Array,name:string,mediaType:string,sha256:string}>}
   */
  async download(item) {
    if (!this.workspaceId) await this.connect();
    if (!item || typeof item.downloadUrl !== "string") throw new AuditExchangeError("Select the original retained download.");
    const url = new URL(item.downloadUrl, this.baseUrl);
    const base = new URL(this.baseUrl), prefix = base.pathname+"api/download/";
    if (url.origin !== base.origin || !url.pathname.startsWith(prefix) || url.search || url.hash || url.username || url.password)
      throw new AuditExchangeError("The download must belong to this connected Audit Exchange server.", {code:"AUDIT_DOWNLOAD_SCOPE"});
    let response;
    try { response = await this.fetch(url.href, {headers:this.headers(),cache:"no-store",redirect:"error"}); }
    catch (cause) { throw new AuditExchangeError("The retained file could not be downloaded. Retry this same file.", {code:"AUDIT_DOWNLOAD_TRANSPORT",cause}); }
    if (!response.ok) throw new AuditExchangeError("The retained download returned HTTP "+response.status+".", {code:"AUDIT_DOWNLOAD_HTTP",status:response.status});
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (Number.isSafeInteger(item.bytes) && bytes.length !== item.bytes)
      throw new AuditExchangeError("The downloaded byte count differs from the retained file.", {code:"AUDIT_DOWNLOAD_SIZE"});
    const sha256 = await auditSha256(bytes);
    if (item.sha256 && sha256 !== item.sha256)
      throw new AuditExchangeError("The complete downloaded file differs from its retained SHA256.", {code:"AUDIT_DOWNLOAD_SHA"});
    return {bytes,name:item.name || "audit-exchange-download",mediaType:response.headers.get("content-type") || "application/octet-stream",sha256};
  }

  headers() {
    const headers = {"Accept":"application/json"};
    if (this.workspaceId) headers["X-Audit-Workspace-Id"] = this.workspaceId;
    if (this.token) headers["Authorization"] = "Bearer "+this.token;
    return headers;
  }

  async http(path, {method,body,mutation = false,raw = false}) {
    const headers = this.headers();
    if (body !== undefined) headers["Content-Type"] = "application/json";
    let response, value;
    try {
      response = await this.fetch(new URL(path,this.baseUrl).href, {
        method,headers,body:body === undefined ? undefined : JSON.stringify(body),
        cache:"no-store",redirect:"error"
      });
      value = await response.json();
    } catch (cause) {
      throw new AuditExchangeError(mutation ?
        "The server response was lost. Recover the retained original request." :
        "The server response could not be read. Reopen the same workspace connection.", {
        code:"AUDIT_TRANSPORT",status:response?.status || 0,outcomeUnknown:mutation,cause
      });
    }
    if (!response.ok || (!raw && value?.ok !== true)) {
      const error = value?.error || {};
      throw new AuditExchangeError(error.message || "Audit Exchange returned HTTP "+response.status+".", {
        code:error.code || "AUDIT_HTTP",status:response.status,details:error.details,
        stateVersion:value?.stateVersion,outcomeUnknown:mutation && response.status >= 500
      });
    }
    return value;
  }
}
