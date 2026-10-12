
// Functions-only environment adapter, restricted to the actual absolute HTTPS
// source-URL subset. It neither resolves a new URL nor performs a request.
class AbsoluteSourceURL {
 constructor(value,base) {
   if(typeof value!=='string'||!/^https:\/\/[a-z0-9.-]+(?::[0-9]+)?(?:\/|$)/.test(value)||/[\u0000-\u0020\u007f\\]/u.test(value))throw Error('Source analysis requires an original absolute HTTPS URL');
   const m=/^(https:)\/\/([^/?#]+)([^?#]*)(\?[^#]*)?(#.*)?$/.exec(value);
   if(!m||m[2].includes('@')||m[3].split('/').some(x=>x==='.'||x==='..'))throw Error('Source URL lies outside the literal analysis subset');
   this.protocol=m[1];this.host=m[2];this.hostname=m[2].replace(/:[0-9]+$/,'');
   this.origin=m[1]+'//'+m[2];this.pathname=m[3]||'/';this.search=m[4]||'';this.hash=m[5]||'';this.username='';this.password='';
 }
 get href(){return this.origin+this.pathname+this.search+this.hash;}
}
const clonePlain=value=>JSON.parse(JSON.stringify(value));

const utf8=s=>Uint8Array.from(Array.from(unescape(encodeURIComponent(s)),c=>c.charCodeAt(0)));
const decode=bytes=>{let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return decodeURIComponent(escape(s));};
class OriginalTextDecoder { constructor(label='utf-8'){if(label!=='utf-8'&&label!=='utf8')throw Error('Only UTF-8 is used by this retained-source calculation.');} decode(bytes){return decode(bytes);} }
const BufferView={from(value,encoding='utf8'){if(typeof value==='string'){if(encoding!=='utf8'&&encoding!=='utf-8')throw Error('Unrequested encoding in source calculation');return utf8(value);}return Uint8Array.from(value);},byteLength(value){return utf8(value).length;}};
const sha256=new Function(load('source_text_sha256_helper')+';return sha256bytes;')();
const createHash=kind=>{if(kind!=='sha256')throw Error('Unexpected hash');let all=[];return {update(value){for(const byte of (typeof value==='string'?utf8(value):value))all.push(byte);return this;},digest(encoding){if(encoding!=='hex')throw Error('Unexpected hash format');return sha256(all);}};};
const plainSource=s=>s.replace(/^import[\s\S]*?;\r?\n/gm,'').replace(/^export \{[^\n]*\}[^\n]*\n/gm,'').replace(/^export /gm,'');
const original=load('scout_multi_dependency_source_0');
const numberSource=plainSource(original.slice(0,original.indexOf('function count(value)')));
const sourceFns=new Function('TextDecoder',numberSource+';return {JsonNumber,parseSource};')(OriginalTextDecoder);
const exact=new Function(plainSource(load('scout_multi_dependency_source_1'))+';return parseExactJSON;')();
const schema=new Function('MAX_RETAINED_CHUNK_BYTES',plainSource(load('scout_multi_source_schema_source'))+';return {ENTITIES,SOURCE_CONTRACT};')(196608);
const contract=new Function('URL','structuredClone','createHash','Buffer','TextDecoder','JsonNumber','parseSource','parseExactJSON','ENTITIES','SOURCE_CONTRACT',
 plainSource(load('scout_multi_contract_source'))+';return {JsonNumber,entityId,numericId,fields,plain,identity,stable,sourceDocument,valueCell,instant,timeCell,integer,text,fault,sourceURL,linksFromEntity,sha,streamMeaning,escapePointer,selectedStream,sourceConfig};')(
 AbsoluteSourceURL,clonePlain,createHash,BufferView,OriginalTextDecoder,sourceFns.JsonNumber,sourceFns.parseSource,exact,schema.ENTITIES,schema.SOURCE_CONTRACT);
const domain=new Function(...Object.keys(contract),plainSource(load('sensorthings_numeric_domain_source'))+';return {OBSERVATION_COLUMNS,graphIndex,observationRows,entityOccurrences};')(...Object.values(contract));
const required={OBSERVATION_COLUMNS:domain.OBSERVATION_COLUMNS,graphIndex:domain.graphIndex,observationRows:domain.observationRows,...contract};
const components=new Function('Buffer',...Object.keys(required),plainSource(load('sensorthings_multi_components_source'))+
 ';return {COMPONENT_SCHEMA,COMPONENT_COLUMNS,COMPONENT_MEANING,bindComponentMetadata,componentCatalog,normalizeComponentSelection,validateComponentChoice,validateComponentBindings,projectComponentRow,componentNumericEligibility,componentExactEligibility,selectedComponentRows,createComponentStatistics,accumulateComponentStatistics,finishComponentStatistics,describeComponentSelection,componentRowsPage,componentCSVHeader,componentCSVRow,componentCSV,compareComponentSelection};')(BufferView,...Object.values(required));
return {utf8,decode,BufferView,OriginalTextDecoder,contract,domain,components};
