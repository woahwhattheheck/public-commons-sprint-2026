// MIT. Pure configured host composition and saved-profile comparison.
const schema='stellar-forge.merchant-host-composition.v1';
export function canonicalHostValue(value) {
  if(Array.isArray(value))return '['+value.map(canonicalHostValue).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().filter(key=>value[key]!==undefined)
    .map(key=>JSON.stringify(key)+':'+canonicalHostValue(value[key])).join(',')+'}';
  const result=JSON.stringify(value);
  if(result===undefined)throw new TypeError('Host composition contains only JSON values.');
  return result;
}
const same=(left,right)=>canonicalHostValue(left)===canonicalHostValue(right);
const order=(a,b)=>a<b?-1:a>b?1:0;
const ordered=values=>[...values].sort(order);
const own=value=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
const annotationNames=['readOnlyHint','destructiveHint','idempotentHint','openWorldHint'];
export function captureHostComposition({registry,configured,tools,familyFor,sha256}) {
  const selected=new Set(),roots=new Set(configured);
  function select(family) {
    if(selected.has(family))return;
    const definition=registry.providers[family];
    if(!definition)throw new TypeError('Unknown original provider '+family);
    selected.add(family);for(const dependency of definition.dependencies)select(dependency);
  }
  for(const family of roots)select(family);
  const sources=new Map(registry.sources.map(value=>[value.family,value]));
  const providers=ordered(selected).map(family=>{
    const definition=registry.providers[family],source=sources.get(family);
    if(!source)throw new TypeError('Missing original provider declaration '+family);
    return {family,id:source.id,title:source.title,configured:roots.has(family),
      configurationInput:source.configurationInput??null,
      dependencies:ordered(definition.dependencies),concurrency:definition.concurrency,shutdown:definition.shutdown,
      concurrentTools:ordered(definition.concurrentTools??[]),maxRequestBytes:definition.maxRequestBytes,
      source:{path:source.path,sha256:source.sha256,bytes:source.bytes,contributions:ordered(source.contributions??[])}};
  });
  const catalog=tools.map(definition=>({name:definition.name,family:familyFor(definition.name)??'core',
    sha256:sha256(canonicalHostValue(definition)),
    annotations:Object.fromEntries(annotationNames.filter(key=>Object.hasOwn(definition.annotations??{},key))
      .map(key=>[key,definition.annotations[key]]))})).sort((a,b)=>order(a.name,b.name));
  if(new Set(catalog.map(value=>value.name)).size!==catalog.length)throw new TypeError('Duplicate configured tool.');
  const catalogSha256=sha256(canonicalHostValue(catalog)),registrySha256=sha256(canonicalHostValue(providers));
  return {schema,sourceCommit:registry.sourceCommit??null,catalogSha256,registrySha256,
    fingerprint:sha256(canonicalHostValue({catalogSha256,registrySha256})),catalog,providers};
}
export function validateHostComposition(value,sha256) {
  if(value===undefined)return false;
  if(!own(value)||value.schema!==schema||!Array.isArray(value.catalog)||!Array.isArray(value.providers))
    throw new TypeError('Retain the complete original host composition.');
  const tools=new Set(),families=new Set();
  for(const item of value.catalog) {
    if(!own(item)||typeof item.name!=='string'||!item.name||tools.has(item.name)||
        typeof item.family!=='string'||!item.family||!own(item.annotations)||!/^[a-f0-9]{64}$/.test(item.sha256))
      throw new TypeError('Retain unique original host tool identities.');
    tools.add(item.name);
  }
  for(const item of value.providers) {
    if(!own(item)||typeof item.family!=='string'||!item.family||families.has(item.family)||
        typeof item.id!=='string'||typeof item.configured!=='boolean'||!Array.isArray(item.dependencies)||
        !Array.isArray(item.concurrentTools)||!Number.isSafeInteger(item.maxRequestBytes)||item.maxRequestBytes<1||
        !own(item.source)||typeof item.source.path!=='string'||!/^[a-f0-9]{64}$/.test(item.source.sha256))
      throw new TypeError('Retain unique original provider declarations.');
    families.add(item.family);
  }
  if(sha256(canonicalHostValue(value.catalog))!==value.catalogSha256||
      sha256(canonicalHostValue(value.providers))!==value.registrySha256||
      sha256(canonicalHostValue({catalogSha256:value.catalogSha256,registrySha256:value.registrySha256}))!==value.fingerprint)
    throw new TypeError('The saved host composition differs from its original digests.');
  return true;
}
function difference(before,after,key,fields) {
  const left=new Map(before.map(value=>[value[key],value])),right=new Map(after.map(value=>[value[key],value]));
  const added=[],removed=[],changed=[];let unchanged=0;
  for(const name of ordered(new Set([...left.keys(),...right.keys()]))) {
    const previous=left.get(name),current=right.get(name);
    if(!previous){added.push(current);continue;}
    if(!current){removed.push(previous);continue;}
    const changedFields=fields.filter(field=>!same(previous[field]??null,current[field]??null));
    if(changedFields.length)changed.push({[key]:name,fields:changedFields,before:previous,after:current});
    else unchanged++;
  }
  return {before:before.length,after:after.length,added,removed,changed,unchanged};
}
function composition(host) {
  const value=host?.composition;
  return value?.schema===schema&&Array.isArray(value.catalog)&&Array.isArray(value.providers)?value:null;
}
function hostSummary(host) {
  const value=composition(host);
  return {merchant:host.merchant??null,configurationFingerprint:host.configurationFingerprint??null,
    maxRequestBytes:host.maxRequestBytes??null,toolCount:host.capabilities?.tools??null,
    compositionFingerprint:value?.fingerprint??null,sourceCommit:value?.sourceCommit??null};
}
export function compareHostProfiles(before,after) {
  if(!own(before)||!own(after))throw new TypeError('Compare two complete saved host objects.');
  const baseline=composition(before),current=composition(after),complete=Boolean(baseline&&current);
  const providers=host=>composition(host)?.providers??(host.providers??[]).map(value=>({
    family:value.name,configured:value.configured,dependencies:ordered(value.dependencies??[])}));
  const selectedProviders=host=>complete?providers(host):providers(host).filter(value=>value.configured);
  const providerChanges=difference(selectedProviders(before),selectedProviders(after),'family',complete?
    ['id','title','configured','configurationInput','dependencies','concurrency','shutdown','concurrentTools','maxRequestBytes','source']:
    ['configured','dependencies']);
  providerChanges.coverage=complete?'COMPLETE':'DECLARATION_SNAPSHOT_UNAVAILABLE';
  const tools=complete?{...difference(baseline.catalog,current.catalog,'name',['family','sha256','annotations']),coverage:'COMPLETE'}:
    {before:before.capabilities?.tools??null,after:after.capabilities?.tools??null,added:[],removed:[],changed:[],unchanged:null,coverage:'TOOL_SNAPSHOT_UNAVAILABLE'};
  const sourceBindings=difference(before.sources??[],after.sources??[],'source',['label']);
  const configurationChanged=before.configurationFingerprint!==after.configurationFingerprint;
  const capacityChanged=before.maxRequestBytes!==after.maxRequestBytes;
  const changes=values=>values.added.length+values.removed.length+values.changed.length;
  const observedChanges=Number(configurationChanged)+Number(capacityChanged)+changes(providerChanges)+changes(tools)+
    Number(!complete&&tools.before!==tools.after)+changes(sourceBindings);
  return {schema:'stellar-forge.merchant-host-review.v1',
    state:observedChanges?'CHANGED':complete?'UNCHANGED':'BASELINE_INCOMPLETE',complete,
    before:hostSummary(before),after:hostSummary(after),configurationChanged,
    requestCapacity:{before:before.maxRequestBytes??null,after:after.maxRequestBytes??null,changed:capacityChanged},
    tools,providers:providerChanges,sourceBindings,observedChanges,
    scope:{comparison:'Configured tool definitions, provider declarations, native request capacity and saved configuration.',
      providerSource:'SHA-256 identifies the original provider declaration module. Source commit is retained separately when supplied by the installed distribution.',
      runtime:'Provider load, active-call and shutdown observations are outside this configuration comparison.',
      baseline:complete?'Complete configured tool and provider declaration snapshots.':
        'This saved host predates complete tool or declaration snapshots; available counts, provider membership and source bindings are compared.'}};
}
