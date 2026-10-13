/* Curriculum Migration Workbench — deterministic, dependency-free domain model. */
export const FORMAT = 'curriculum-migration-workspace.v1';
const own = (o,k) => Object.prototype.hasOwnProperty.call(o,k);
export function copy(x) { return JSON.parse(canonical(x)); }
export function canonical(x) {
  if(x === undefined || typeof x === 'function' || typeof x === 'symbol' || typeof x === 'bigint' || (typeof x==='number' && !Number.isFinite(x))) throw new Error('Value is not a finite JSON value.');
  if(x === null || typeof x !== 'object') return JSON.stringify(x);
  if(Array.isArray(x)) return '['+x.map(canonical).join(',')+']';
  return '{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}';
}
function requireValue(ok,message) { if(!ok) throw new Error(message); }
function stamp(context) {
  requireValue(context && typeof context.actor==='string' && context.actor.trim(),'Enter the operating engineer.');
  requireValue(typeof context.at==='string' && Number.isFinite(Date.parse(context.at)), 'An operation time is required.');
  return {actor:context.actor.trim(),at:context.at};
}
function event(w, type, detail, context) {
  w.revision++; w.history.push({sequence:w.revision,type,...stamp(context),detail:copy(detail)});
  return w;
}
function tokens(pointer) {
  requireValue(typeof pointer==='string' && (pointer==='' || pointer[0]==='/'),'Use a JSON Pointer, starting with /.');
  if(pointer==='') return [];
  return pointer.slice(1).split('/').map(s=>{
    requireValue(!/~(?:[^01]|$)/.test(s),'Invalid JSON Pointer escape.');
    return s.replace(/~1/g,'/').replace(/~0/g,'~');
  });
}
const escape = s => String(s).replace(/~/g,'~0').replace(/\//g,'~1');
export function readPointer(value,pointer) {
  let v=value;
  for(const k of tokens(pointer)) {
    if(v===null || typeof v!=='object' || !own(v,k)) return {present:false};
    v=v[k];
  }
  return {present:true,value:v};
}
function writePointer(value,pointer,newValue,remove=false) {
  const parts=tokens(pointer);
  if(!parts.length) { requireValue(!remove,'Cannot omit the whole document.'); return copy(newValue); }
  let v=value;
  for(let i=0;i<parts.length-1;i++) {
    const k=parts[i]; requireValue(v!==null && typeof v==='object','Mapping parent is not a container: '+pointer);
    requireValue(own(v,k),'Mapping target parent does not exist: '+pointer); v=v[k];
  }
  const last=parts[parts.length-1];
  requireValue(v!==null && typeof v==='object','Mapping target parent is not a container: '+pointer);
  if(Array.isArray(v)) {
    requireValue(/^(0|[1-9][0-9]*)$/.test(last) && Number(last)<v.length,'Array mapping index must already exist.');
    requireValue(!remove,'Use a field mapping inside an array; array element omission changes cardinality.');
    v[Number(last)]=copy(newValue);
  } else if(remove) delete v[last];
  else Object.defineProperty(v,last,{value:copy(newValue),writable:true,enumerable:true,configurable:true});
  return value;
}
function expand(value,pattern) {
  const parts=tokens(pattern), matches=[];
  function visit(v,i,path,indices) {
    if(i===parts.length) {matches.push({pointer:path,indices});return;}
    const p=parts[i];
    if(p==='*') {
      requireValue(Array.isArray(v),'Wildcard requires an existing array: '+path);
      v.forEach((x,j)=>visit(x,i+1,path+'/'+j,[...indices,j]));
    } else {
      requireValue(v!==null && typeof v==='object' && own(v,p),'Mapping source is absent: '+path+'/'+escape(p));
      visit(v[p],i+1,path+'/'+escape(p),indices);
    }
  }
  visit(value,0,'',[]);return matches;
}
export function applyMappings(body,mappings=[]) {
  let out=copy(body); const applied=[];
  for(const m of mappings) {
    requireValue(['copy','move','omit','constant'].includes(m.action),'Unknown mapping action.');
    requireValue(typeof m.reason==='string' && m.reason.trim(),'Every mapping needs its reason.');
    if(m.action==='constant') {
      requireValue(own(m,'value'),'Constant mapping requires value.');
      requireValue(!tokens(m.to).includes('*'),'Constant target uses an explicit pointer.');
      out=writePointer(out,m.to,m.value); applied.push({action:m.action,to:m.to}); continue;
    }
    const matches=expand(out,m.from);
    for(const match of matches) {
      const val=copy(readPointer(out,match.pointer).value);
      if(m.action!=='omit') {
        let n=0; const target=tokens(m.to).map(p=>p==='*'?String(match.indices[n++]):p);
        requireValue(n===match.indices.length,'Source and target wildcard counts must agree.');
        const targetPointer=target.length?'/'+target.map(escape).join('/'):'';
        requireValue(!(m.action==='move' && targetPointer.startsWith(match.pointer+'/')),'Cannot move a value into itself.');
        out=writePointer(out,targetPointer,val);
        if(m.action==='move' && targetPointer!==match.pointer) out=writePointer(out,match.pointer,null,true);
        applied.push({action:m.action,from:match.pointer,to:targetPointer});
      } else {out=writePointer(out,match.pointer,null,true);applied.push({action:m.action,from:match.pointer});}
    }
  }
  return {body:out,applied};
}
function jsonType(v) {return v===null?'null':Array.isArray(v)?'array':typeof v;}
export function compareValues(before,after,arrayKeys={}) {
  const differences=[];
  function difference(path,kind,a,b,extra={}) {
    differences.push({path,kind,...(a.present?{before:copy(a.value)}:{}),...(b.present?{after:copy(b.value)}:{}),...extra});
  }
  function visit(a,b,path) {
    if(!a.present || !b.present) {difference(path,a.present?'missing':'added',a,b);return;}
    const av=a.value,bv=b.value,at=jsonType(av),bt=jsonType(bv);
    if(at!==bt) {difference(path,'type',a,b);return;}
    if(at==='array') {
      const key=arrayKeys[path];
      if(key) {
        function index(v,label) {
          const map=new Map();
          v.forEach((row,i)=>{const k=readPointer(row,key);
            requireValue(k.present && ['string','number','boolean'].includes(typeof k.value),label+' array key is missing or non-scalar: '+path+'/'+i+key);
            const id=canonical(k.value);requireValue(!map.has(id),label+' array key is duplicated: '+id);map.set(id,{row,i});});
          return map;
        }
        const aa=index(av,'Original'),bb=index(bv,'Candidate');
        for(const id of new Set([...aa.keys(),...bb.keys()])) {
          const x=aa.get(id),y=bb.get(id);visit(x?{present:true,value:x.row}:{present:false},y?{present:true,value:y.row}:{present:false},path+'/@'+escape(id));
        }
      } else for(let i=0;i<Math.max(av.length,bv.length);i++) visit(i<av.length?{present:true,value:av[i]}:{present:false},i<bv.length?{present:true,value:bv[i]}:{present:false},path+'/'+i);
    } else if(at==='object') for(const k of new Set([...Object.keys(av),...Object.keys(bv)])) visit(own(av,k)?{present:true,value:av[k]}:{present:false},own(bv,k)?{present:true,value:bv[k]}:{present:false},path+'/'+escape(k));
    else if(av!==bv) difference(path,'value',a,b);
  }
  visit({present:true,value:before},{present:true,value:after},'');
  return differences;
}
/* Evaluates the exact keyword vocabulary used by the pinned bulk/REST schemas.
   Unsupported assertion keywords and unresolved refs are reported explicitly. */
export function validate(value,schema,root=schema) {
  const errors=[],unsupported=[];
  const known=new Set(['$schema','$id','$ref','$defs','definitions','title','description','default','examples','example','deprecated','readOnly','writeOnly','type','properties','required','additionalProperties','items','prefixItems','enum','const','anyOf','oneOf','allOf','not','nullable','format','minimum','maximum','exclusiveMinimum','exclusiveMaximum','minLength','maxLength','pattern','minItems','maxItems','uniqueItems','minProperties','maxProperties']);
  function run(v,s,path,depth=0) {
    if(depth>100) {unsupported.push({path,keyword:'depth',message:'Schema recursion exceeds 100.'});return;}
    if(s===true) return;
    if(s===false) {errors.push({path,rule:'false',message:'Value is prohibited.'});return;}
    if(!s || typeof s!=='object') {unsupported.push({path,message:'Schema is not an object or boolean.'});return;}
    for(const k of Object.keys(s)) if(!known.has(k)) unsupported.push({path,keyword:k,message:'Unsupported schema keyword.'});
    if(s.$ref) {
      if(!s.$ref.startsWith('#/')) {unsupported.push({path,keyword:'$ref',message:'External reference needs its source edition: '+s.$ref});return;}
      const found=readPointer(root,s.$ref.slice(1));
      if(!found.present) {unsupported.push({path,keyword:'$ref',message:'Unresolved reference '+s.$ref});return;}
      run(v,found.value,path,depth+1);
    }
    const fail=(rule,message)=>errors.push({path,rule,message});
    if(s.nullable && v===null) return;
    if(s.type) {
      const allowed=Array.isArray(s.type)?s.type:[s.type];
      if(!allowed.some(t=>t==='integer'?typeof v==='number'&&Number.isInteger(v):t==='number'?typeof v==='number'&&Number.isFinite(v):jsonType(v)===t)) {fail('type','Expected '+allowed.join(' or ')+', received '+jsonType(v));return;}
    }
    if(s.enum && !s.enum.some(x=>canonical(x)===canonical(v))) fail('enum','Value is outside the enum.');
    if(own(s,'const') && canonical(s.const)!==canonical(v)) fail('const','Value differs from the constant.');
    for(const op of ['anyOf','oneOf','allOf']) if(s[op]) {
      const results=s[op].map(branch=>validate(v,branch,root));
      results.forEach(r=>unsupported.push(...r.unsupported.map(e=>({...e,path:path+e.path}))));
      const n=results.filter(r=>r.valid).length;
      if((op==='anyOf' && !n)||(op==='oneOf'&&n!==1)||(op==='allOf'&&n!==results.length)) fail(op,op+' matched '+n+' of '+results.length+' branches.');
    }
    if(s.not && validate(v,s.not,root).valid) fail('not','Value matches the prohibited schema.');
    if(v!==null && typeof v==='object' && !Array.isArray(v)) {
      for(const k of s.required||[]) if(!own(v,k)) errors.push({path:path+'/'+escape(k),rule:'required',message:'Required property is absent.'});
      for(const [k,x] of Object.entries(v)) {
        if(s.properties && own(s.properties,k)) run(x,s.properties[k],path+'/'+escape(k),depth+1);
        else if(s.additionalProperties===false) errors.push({path:path+'/'+escape(k),rule:'additionalProperties',message:'Undeclared property.'});
        else if(s.additionalProperties && typeof s.additionalProperties==='object') run(x,s.additionalProperties,path+'/'+escape(k),depth+1);
      }
      if(s.minProperties!==undefined && Object.keys(v).length<s.minProperties) fail('minProperties','Too few properties.');
      if(s.maxProperties!==undefined && Object.keys(v).length>s.maxProperties) fail('maxProperties','Too many properties.');
    }
    if(Array.isArray(v)) {
      if(s.minItems!==undefined && v.length<s.minItems) fail('minItems','Too few array elements.');
      if(s.maxItems!==undefined && v.length>s.maxItems) fail('maxItems','Too many array elements.');
      if(s.uniqueItems && new Set(v.map(canonical)).size!==v.length) fail('uniqueItems','Array contains duplicate values.');
      v.forEach((x,i)=>{const item=s.prefixItems?.[i] ?? s.items;if(item!==undefined)run(x,item,path+'/'+i,depth+1);});
    }
    if(typeof v==='number') {
      for(const [key,ok] of [['minimum',v>=s.minimum],['maximum',v<=s.maximum],['exclusiveMinimum',v>s.exclusiveMinimum],['exclusiveMaximum',v<s.exclusiveMaximum]]) if(s[key]!==undefined&&!ok)fail(key,'Number violates '+key+'.');
    }
    if(typeof v==='string') {
      if(s.minLength!==undefined && [...v].length<s.minLength)fail('minLength','String is too short.');
      if(s.maxLength!==undefined && [...v].length>s.maxLength)fail('maxLength','String is too long.');
      if(s.pattern && !new RegExp(s.pattern,'u').test(v))fail('pattern','String differs from required pattern.');
      if(s.format) {
        if(['uri','uri-reference'].includes(s.format)) { const syntax=/^(?:[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=\-]|%[0-9A-Fa-f]{2})*$/.test(v); const absolute=/^[A-Za-z][A-Za-z0-9+.-]*:/.test(v); if(!syntax || (s.format==='uri' && !absolute)) fail('format','Invalid '+s.format); }
        else if(s.format==='date-time') {if(!Number.isFinite(Date.parse(v)) || !/T/.test(v))fail('format','Invalid date-time.');}
        else if(s.format==='date') {if(!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v)))fail('format','Invalid date.');}
        else unsupported.push({path,keyword:'format',message:'Unsupported format '+s.format});
      }
    }
  }
  run(value,schema,'');
  return {valid:errors.length===0&&unsupported.length===0,errors,unsupported};
}
export function operations(edition) {
  return Object.entries(edition.surface.paths).flatMap(([path,methods])=>Object.entries(methods).filter(([method,o])=>o.operationId).map(([method,o])=>({key:method.toUpperCase()+' '+path,path,method,operationId:o.operationId,...copy(o)})));
}
export function createWorkspace({id,name,edition},context) {
  requireValue(id && name && edition?.id,'Workspace, name and source edition are required.');
  const w={format:FORMAT,id,name,revision:0,editions:[copy(edition)],cases:[],assets:[],history:[]};
  return event(w,'created',{edition:edition.id},context);
}
export function addEdition(workspace,edition,context) {
  const w=copy(workspace);
  requireValue(edition?.id && edition.provenance && edition.surface?.paths,'Edition requires identity, provenance and its complete API surface.');
  const existing=w.editions.find(e=>e.id===edition.id);
  if(existing) {requireValue(canonical(existing)===canonical(edition),'An existing edition cannot be overwritten.');return w;}
  w.editions.push(copy(edition));return event(w,'edition-added',{id:edition.id},context);
}
export function addCase(workspace,{id,name,operationKey,sourceEditionId,targetEditionId,request={}},context) {
  const w=copy(workspace);requireValue(id&&!w.cases.some(c=>c.id===id),'Case ID is missing or already used.');
  for(const eid of [sourceEditionId,targetEditionId]) {
    const e=w.editions.find(e=>e.id===eid);requireValue(e,'Unknown source edition.');
    requireValue(operationKey==='BULK' || operations(e).some(o=>o.key===operationKey),'Operation is absent from this edition.');
  }
  w.cases.push({id,name,operationKey,sourceEditionId,targetEditionId,request:copy(request),revision:0,responses:{original:null,candidate:null},mappings:[],arrayKeys:{},runs:[],decisions:[]});
  return event(w,'case-added',{id,operationKey},context);
}
export function updateCase(workspace,caseId,patch,context) {
  const w=copy(workspace),c=w.cases.find(x=>x.id===caseId);requireValue(c,'Case not found.');
  const allowed=['name','request','mappings','arrayKeys','targetEditionId'];
  for(const k of Object.keys(patch)) requireValue(allowed.includes(k),'Unsupported case edit '+k);
  if(patch.targetEditionId) requireValue(w.editions.some(e=>e.id===patch.targetEditionId),'Target edition not found.');
  if(patch.mappings) applyMappings(c.responses.original?.body??{},patch.mappings);
  Object.assign(c,copy(patch));c.revision++;
  return event(w,'case-edited',{id:caseId,patch},context);
}
export function saveResponse(workspace,caseId,lane,response,context) {
  requireValue(['original','candidate'].includes(lane),'Choose original or candidate.');
  requireValue(response && Number.isInteger(response.status) && response.status>=100 && response.status<=599,'Response needs an HTTP status.');
  requireValue(own(response,'body') && response.provenance?.kind && response.provenance?.label,'Retain response body and source description.');
  const w=copy(workspace),c=w.cases.find(x=>x.id===caseId);requireValue(c,'Case not found.');
  const previous=c.responses[lane]; c.responses[lane]=copy(response);c.revision++;
  return event(w,'response-saved',{id:caseId,lane,previous,response},context);
}
function schemaFor(e,c,r) {
  if(c.operationKey==='BULK') return {schema:e.bulkSchema,root:e.bulkSchema};
  const op=operations(e).find(o=>o.key===c.operationKey);
  requireValue(op,'Operation is absent from selected edition.');
  const response=op.responses[String(r.status)] || op.responses.default;
  if(!response)return {problem:'Status '+r.status+' is absent from the contract.'};
  if(r.status===302) return {redirect:true};
  const media=response.content?.[r.contentType||'application/json'];
  if(!media)return {problem:'Response media type is absent from the contract.'};
  return {schema:media.schema||media,root:e.surface};
}
export function compareCase(workspace,caseId,context) {
  const w=copy(workspace),c=w.cases.find(x=>x.id===caseId);requireValue(c,'Case not found.');
  const a=c.responses.original,b=c.responses.candidate;requireValue(a&&b,'Save both original and candidate responses first.');
  const mapped=applyMappings(a.body,c.mappings);
  const check=(lane,response)=>{const e=w.editions.find(x=>x.id===(lane==='original'?c.sourceEditionId:c.targetEditionId)),s=schemaFor(e,c,response);
    if(s.problem)return {valid:false,errors:[{path:'',rule:'response',message:s.problem}],unsupported:[]};
    if(s.redirect)return {valid:typeof response.headers?.location==='string'&&response.headers.location.length>0,errors:typeof response.headers?.location==='string'&&response.headers.location.length>0?[]:[{path:'/headers/location',rule:'redirect',message:'The retained302 response requires Location.'}],unsupported:[]};
    return validate(response.body,s.schema,s.root);};
  const differences=compareValues(mapped.body,b.body,c.arrayKeys);
  if(a.status!==b.status)differences.unshift({path:'/@http/status',kind:'status',before:a.status,after:b.status});
  if(a.status===302 || b.status===302)differences.push(...compareValues(a.headers?.location??null,b.headers?.location??null).map(d=>({...d,path:'/@http/location'+d.path})));
  const originalValidation=check('original',a),candidateValidation=check('candidate',b);
  const run={id:c.id+'-run-'+(c.runs.length+1),caseRevision:c.revision,...stamp(context),sourceEditionId:c.sourceEditionId,targetEditionId:c.targetEditionId,original:copy(a),candidate:copy(b),mappings:copy(c.mappings),arrayKeys:copy(c.arrayKeys),expected:mapped.body,appliedMappings:mapped.applied,differences,originalValidation,candidateValidation,status:differences.length===0&&originalValidation.valid&&candidateValidation.valid?'MATCH':'REVIEW'};
  c.runs.push(run);return event(w,'comparison-completed',{caseId,id:run.id,status:run.status,differences:differences.length},context);
}
export function decide(workspace,caseId,{runId,outcome,note},context) {
  requireValue(['accepted','changes-required'].includes(outcome)&&note?.trim(),'Choose an outcome and record the engineering decision.');
  const w=copy(workspace),c=w.cases.find(x=>x.id===caseId);requireValue(c,'Case not found.');
  const r=c.runs.find(x=>x.id===runId);requireValue(r,'Comparison run not found.');
  requireValue(r.caseRevision===c.revision,'Run a comparison after the latest edit before deciding.');
  c.decisions.push({runId,outcome,note,...stamp(context)});return event(w,'decision-recorded',{caseId,runId,outcome,note},context);
}
export function addAsset(workspace,asset,context) {
  requireValue(asset.id&&asset.name&&['sql','hasura-metadata','drizzle','graphql-introspection','source-notes'].includes(asset.kind)&&typeof asset.content==='string','Source asset needs identity, kind, name and complete content.');
  const w=copy(workspace); const old=w.assets.find(a=>a.id===asset.id);
  if(old){requireValue(canonical(old)===canonical(asset),'Use a new asset ID for a new source edition.');return w;}
  w.assets.push(copy(asset));return event(w,'asset-added',{id:asset.id,name:asset.name,kind:asset.kind},context);
}
export function receiveWorkspace(value) {
  requireValue(value?.format===FORMAT && value.id && typeof value.name==='string','Unrecognised workspace.');
  requireValue(Array.isArray(value.editions)&&value.editions.length&&Array.isArray(value.cases)&&Array.isArray(value.history)&&Array.isArray(value.assets),'Workspace is incomplete.');
  requireValue(value.revision===value.history.length && value.history.every((h,i)=>h.sequence===i+1),'Workspace history sequence is incomplete.');
  const ids=new Set();for(const e of value.editions){requireValue(e.id&&!ids.has(e.id)&&e.surface?.paths&&e.provenance,'Edition identity is invalid.');ids.add(e.id);}
  const caseIds=new Set();for(const c of value.cases){requireValue(c.id&&!caseIds.has(c.id)&&ids.has(c.sourceEditionId)&&ids.has(c.targetEditionId)&&Array.isArray(c.runs)&&Array.isArray(c.mappings)&&Array.isArray(c.decisions)&&c.responses&&own(c.responses,'original')&&own(c.responses,'candidate')&&c.request&&c.arrayKeys&&Number.isInteger(c.revision),'Case is incomplete.');caseIds.add(c.id);}
  return copy(value);
}
export function portfolio(workspace) {
  return workspace.cases.map(c=>{const r=c.runs.at(-1),d=c.decisions.at(-1);return {id:c.id,name:c.name,operation:c.operationKey,state:!r?'READY':r.caseRevision!==c.revision?'CHANGED':r.status,differences:r?.differences.length??null,decision:d&&r&&d.runId===r.id&&r.caseRevision===c.revision?d.outcome:'pending',source:c.sourceEditionId,target:c.targetEditionId};});
}
export function sourceInventory(edition) {
  const types=edition.graphql?.data?.__schema?.types || edition.graphql?.__schema?.types || [];
  const relations=types.filter(x=>/^columns and relationships of /.test(x.description||'')).map(x=>({name:x.name,description:x.description,fields:Array.isArray(x.fields)?copy(x.fields):null}));
  const constants=[...(edition.owaSource||'').matchAll(/export const (\w+)\s*=\s*'([^']+)'/g)].map(m=>({name:m[1],value:m[2]}));
  return {edition:edition.id,operations:operations(edition).map(o=>({key:o.key,id:o.operationId})),relations,constants,fieldMetadataPresent:relations.some(r=>r.fields!==null)};
}
