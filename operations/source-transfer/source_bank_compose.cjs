'use strict';
/** Compose complete UTF-8 source-bank members into an existing application.
 * This pure planner performs no I/O and never executes supplied source.
 */
function createSourceBankComposer({identity}) {
  if (typeof identity !== 'function') throw Error('identity(text) is required');
  const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
  const object=(v,label)=>{if(!v||typeof v!=='object'||Array.isArray(v))throw Error(label+' must be an object');return v;};
  const path=(v)=>{if(typeof v!=='string'||!v||v.includes('\\')||v.includes('\0')||/^[A-Za-z]:/.test(v)||v.startsWith('/')||v.split('/').some(s=>!s||s==='.'||s==='..'))throw Error('Unsafe source path: '+JSON.stringify(v));return v;};
  const digest=(v,label)=>{if(typeof v!=='string'||!/^[a-f0-9]{64}$/.test(v))throw Error(label+' must be a lowercase SHA256');return v;};
  const occurrences=(s,q)=>{const out=[];for(let p=0;;){const i=s.indexOf(q,p);if(i<0)return out;out.push(i);p=i+1;}};
  function bind(text,expected,label) {
    if(typeof text!=='string')throw Error(label+' content must be text');
    const actual=identity(text);
    if(!Number.isSafeInteger(expected.bytes)||expected.bytes<0||actual.bytes!==expected.bytes||actual.sha256!==digest(expected.sha256,label+' SHA256'))throw Error(label+' complete bytes/SHA256 differ');
    return actual;
  }
  function replaceUnique(text,oldValue,newValue,label){
    const found=occurrences(text,oldValue);
    if(found.length!==1)throw Error(label+' requires one exact anchor; found '+found.length);
    return text.slice(0,found[0])+newValue+text.slice(found[0]+oldValue.length);
  }
  function validateBank(bank) {
    object(bank,'bank');
    if(bank.schema!=='commons.source-bank/v1')throw Error('Unsupported source bank schema');
    if(!Array.isArray(bank.files)||!bank.files.length)throw Error('bank.files must contain complete members');
    const members=new Map();
    for(const f of bank.files) {
      object(f,'member');const p=path(f.path);
      if(members.has(p))throw Error('Duplicate bank path: '+p);
      bind(f.content,f,p);
      if(f.mode!==undefined&&!['100644','100755','644','755',420,493].includes(f.mode))throw Error('Unsupported source mode: '+p);
      members.set(p,f);
    }
    const composition=object(bank.composition,'bank.composition');
    if(!Array.isArray(composition.delta_paths)||!composition.delta_paths.length)throw Error('Explicit nonempty composition.delta_paths required');
    const deltas=new Set();
    for(const raw of composition.delta_paths){const p=path(raw);if(deltas.has(p)||!members.has(p))throw Error('Duplicate or absent selected delta: '+p);deltas.add(p);}
    const patches=new Map();
    if(composition.patches!==undefined&&!Array.isArray(composition.patches))throw Error('composition.patches must be an array');
    for(const rawPatch of composition.patches||[]) {
      object(rawPatch,'patch');
      if(!Array.isArray(rawPatch.edits))throw Error('Patch edits must be an array');
      const patch={...rawPatch,edits:rawPatch.edits.map(e=>{
        object(e,'edit');
        if(e.old!==undefined&&e.before!==undefined&&e.old!==e.before||e.new!==undefined&&e.after!==undefined&&e.new!==e.after)throw Error('Conflicting literal edit aliases');
        return {old:e.old??e.before,new:e.new??e.after};
      })};
      object(patch,'patch');const p=path(patch.path);
      if(patches.has(p)||!deltas.has(p))throw Error('Patch must name one selected delta: '+p);
      digest(patch.preimage_sha256,p+' preimage');digest(patch.postimage_sha256,p+' postimage');
      if(members.get(p).sha256!==patch.postimage_sha256)throw Error('Patch postimage is not the complete member: '+p);
      if(!Array.isArray(patch.edits)||!patch.edits.length)throw Error('Patch edits missing: '+p);
      for(const e of patch.edits)if(!e||typeof e.old!=='string'||!e.old||typeof e.new!=='string'||!e.new||e.old===e.new)throw Error('Patch requires distinct nonempty literal sides: '+p);
      let before=members.get(p).content;
      for(let i=patch.edits.length-1;i>=0;i--)before=replaceUnique(before,patch.edits[i].new,patch.edits[i].old,p+' reverse edit '+i);
      if(identity(before).sha256!==patch.preimage_sha256)throw Error('Reconstructed patch preimage differs: '+p);
      let after=before;
      for(let i=0;i<patch.edits.length;i++)after=replaceUnique(after,patch.edits[i].old,patch.edits[i].new,p+' forward edit '+i);
      if(after!==members.get(p).content)throw Error('Patch does not reproduce complete member: '+p);
      patches.set(p,patch);
    }
    return {members,deltas,patches};
  }
  function mergeEdits(current,patch,p) {
    let out=current;
    const applied=[],retained=[];
    for(let i=0;i<patch.edits.length;i++){
      const e=patch.edits[i],atNew=occurrences(out,e.new),atOld=occurrences(out,e.old);
      if(atNew.length===1&&atOld.every(at=>at>=atNew[0]&&at+e.old.length<=atNew[0]+e.new.length)){retained.push(i);continue;}
      if(atNew.length)throw Error(p+' edit '+i+' has ambiguous applied text');
      out=replaceUnique(out,e.old,e.new,p+' edit '+i);applied.push(i);
    }
    return {content:out,applied,retained};
  }
  function compose({banks,current={},sourcePrefix=''}) {
    if(!Array.isArray(banks)||!banks.length)throw Error('At least one source bank is required');
    object(current,'current source map');
    const prefix=sourcePrefix?path(sourcePrefix.replace(/\/$/,''))+'/':'';
    const local=p=>{path(p);if(prefix&&!p.startsWith(prefix))throw Error('Member is outside --source-prefix: '+p);return path(prefix?p.slice(prefix.length):p);};
    const complete=new Map(),initial=new Map(),steps=[];
    for(const [p,raw] of Object.entries(current)){path(p);const f=typeof raw==='string'?{content:raw}:object(raw,p);if(typeof f.content!=='string')throw Error(p+' current source must be UTF-8 text');complete.set(p,{content:f.content,mode:f.mode});initial.set(p,{content:f.content,mode:f.mode});}
    for(let layer=0;layer<banks.length;layer++){
      const checked=validateBank(banks[layer]);
      for(const [p,f] of checked.members){
        const destination=local(p),prior=complete.get(destination),selected=checked.deltas.has(p),patch=checked.patches.get(p);
        if(prior&&!selected){steps.push({layer,path:destination,action:'preserve-existing-dependency'});continue;}
        if(prior&&prior.content===f.content){steps.push({layer,path:destination,action:'already-current'});continue;}
        let content=f.content,detail={};
        if(prior){
          if(!patch)throw Error('Existing selected member differs and has no guarded patch: '+destination);
          const oldIdentity=identity(prior.content);
          if(oldIdentity.sha256!==patch.preimage_sha256){const merged=mergeEdits(prior.content,patch,destination);content=merged.content;detail={applied_edits:merged.applied,retained_edits:merged.retained};}
          detail.before_sha256=oldIdentity.sha256;
        }
        const mode=prior?.mode??f.mode;
        complete.set(destination,{content,mode});
        steps.push({layer,path:destination,action:prior?'compose-existing-source':'add-source',...detail,...identity(content)});
      }
    }
    const changes=[];
    for(const [p,f] of complete)if(!initial.has(p)||f.content!==initial.get(p).content)changes.push({path:p,...f,...identity(f.content),before_sha256:initial.has(p)?identity(initial.get(p).content).sha256:null});
    return {schema:'commons.source-composition-plan/v1',changes,steps};
  }
  return Object.freeze({validateBank,compose});
}
if(typeof module!=='undefined'&&module.exports)module.exports={createSourceBankComposer};
