// MIT. Versioned host settings for the original buyer intake and native operator.
import {constants} from 'node:fs';
import {access,open,rename,unlink} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {isDeepStrictEqual} from 'node:util';

const REVISION='stellar-forge.buyer-operator-preset-revision.v1';
const SELECTION='stellar-forge.buyer-operator-preset-selection.v1';
const REVIEW='stellar-forge.buyer-operator-preset-review.v1';
const ID=/^preset-[a-f0-9]{64}$/,SHA=/^[a-f0-9]{64}$/;
const KEYS=['schema','actor','service','payer','python','maxTotalAtomic','maxDailyAtomic',
  'secretEnv','signerProvider','rpc','httpsProxyEnv'];
const hash=raw=>createHash('sha256').update(raw).digest('hex');
const encode=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const check=(ok,code,status=422)=>{if(!ok)throw Object.assign(new Error(code),{code,status});};
const codeOf=error=>/^[A-Z0-9_]{1,120}$/.test(error?.code??'')?error.code:'OPERATOR_SETTINGS_UNAVAILABLE';
function canonicalSettings(value) {
  const result=Object.fromEntries(KEYS.filter(key=>Object.hasOwn(value,key)).map(key=>[key,value[key]]));
  // This is the original native default. An explicit default in the form can
  // adopt a launcher preset that omitted it without changing the preset bytes.
  if(result.signerProvider===undefined&&result.secretEnv===undefined)result.secretEnv='STELLAR_SECRET';
  return result;
}

/** One host selection, under the same lease as original request preparation. */
export async function openBuyerOperatorSetup({directory,declaredSettingsFile,readPreset,validatePreset,storage}) {
  const {privateDirectory,bytes,publish,json,optional,readdir,lease}=storage;
  const root=join(directory,'operator-presets'),records=join(root,'revisions'),selectionFile=join(root,'current.json');
  await privateDirectory(root,true);await privateDirectory(records,true);
  function paths(id) {
    check(typeof id==='string'&&ID.test(id),'OPERATOR_REVISION_INVALID');
    return {metadata:join(records,id+'.json'),settings:join(records,id+'.settings.json'),
      previous:join(records,id+'.previous.json'),previousSelection:join(records,id+'.previous-selection.json')};
  }
  async function maybeBytes(file,limit=16384) {
    try{return await bytes(file,limit);}catch(error){if(error.code==='ENOENT')return null;throw error;}
  }
  async function record(id) {
    const files=paths(id),item=await json(files.metadata),proof=item.proof;
    check(item.schema===REVISION&&item.id===id&&Number.isSafeInteger(item.revision)&&item.revision>0&&item.revision<=10000&&
      typeof item.createdAt==='string'&&Number.isFinite(Date.parse(item.createdAt))&&object(proof)&&proof.schema===REVIEW&&
      proof.directory===directory&&object(proof.base)&&SHA.test(proof.settingsSha256??'')&&
      typeof proof.note==='string'&&(proof.sourceRevision===null||ID.test(proof.sourceRevision??''))&&
      id==='preset-'+hash(encode(proof)),'OPERATOR_REVISION_CHANGED',409);
    const preset=await readPreset(files.settings);
    check(preset.sha256===proof.settingsSha256,'OPERATOR_REVISION_SETTINGS_CHANGED',409);
    return {...item,preset,files};
  }
  async function snapshot() {
    let selectionRaw=null,raw=null,preset=null,item=null,error=null;
    const base={mode:'NONE',selectionSha256:null,selectedId:null,file:null,settingsSha256:null,error:null};
    try {
      selectionRaw=await maybeBytes(selectionFile);
      if(selectionRaw!==null) {
        base.mode='WORKSPACE';base.selectionSha256=hash(selectionRaw);
        let selection;try{selection=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(selectionRaw));}
        catch{check(false,'OPERATOR_SELECTION_INVALID',409);}
        check(object(selection)&&Object.keys(selection).length===3&&selection.schema===SELECTION&&
          ID.test(selection.id??'')&&SHA.test(selection.settingsSha256??''),'OPERATOR_SELECTION_INVALID',409);
        base.selectedId=selection.id;base.file=paths(selection.id).settings;
        raw=await maybeBytes(base.file);base.settingsSha256=raw===null?null:hash(raw);
        item=await record(selection.id);preset=item.preset;
        check(raw!==null&&hash(raw)===preset.sha256&&selection.settingsSha256===preset.sha256,
          'OPERATOR_SELECTION_SETTINGS_CHANGED',409);
      } else if(declaredSettingsFile!==null) {
        base.mode='DECLARED';base.file=declaredSettingsFile;
        raw=await maybeBytes(declaredSettingsFile);base.settingsSha256=raw===null?null:hash(raw);
        preset=await readPreset(declaredSettingsFile);
        check(raw!==null&&hash(raw)===preset.sha256,'OPERATOR_DECLARED_SETTINGS_CHANGED',409);
      }
    } catch(failure) {error=codeOf(failure);base.error=error;preset=null;}
    return {base,stateSha256:hash(encode(base)),selectionRaw,raw,preset,item,error};
  }
  async function currentFile() {return (await snapshot()).base.file;}
  async function read() {
    const current=await snapshot();
    check(!current.error,current.error??'OPERATOR_SETTINGS_UNAVAILABLE',409);
    check(current.preset,'REQUEST_OPERATOR_PRESET_REQUIRED');
    return {...current.preset,raw:current.raw};
  }
  async function readMatching(settingsSha256) {
    check(typeof settingsSha256==='string'&&SHA.test(settingsSha256),'OPERATOR_SETTINGS_DIGEST_INVALID');
    const current=await snapshot();
    if(current.preset?.sha256===settingsSha256)return {...current.preset,raw:current.raw};
    // Legacy in-progress requests predate attempt-local preset copies. Adopt
    // only actual original preset bytes retained by a host revision/change.
    for(const name of (await readdir(records)).filter(name=>/^preset-[a-f0-9]{64}\.(?:settings|previous)\.json$/.test(name))) {
      try {const file=join(records,name),raw=await bytes(file,16384);
        if(hash(raw)!==settingsSha256)continue;
        const preset=await readPreset(file);
        check(preset.sha256===settingsSha256,'OPERATOR_REVISION_SETTINGS_CHANGED',409);
        return {...preset,raw};
      } catch(error) {if(error.code==='OPERATOR_REVISION_SETTINGS_CHANGED')throw error;}
    }
    check(false,'OPERATOR_RETAINED_SETTINGS_REQUIRED',409);
  }
  async function history(selectedId) {
    const names=(await readdir(records)).filter(name=>/^preset-[a-f0-9]{64}\.json$/.test(name));
    check(names.length<=10000,'OPERATOR_REVISION_LIMIT');
    const result=[];
    for(const name of names) {
      const id=name.slice(0,-5);
      try {const item=await record(id);result.push({id,revision:item.revision,createdAt:item.createdAt,
        actor:item.preset.value.actor,service:item.preset.value.service,note:item.proof.note,
        settingsSha256:item.preset.sha256,current:id===selectedId,sourceRevision:item.proof.sourceRevision});}
      catch(error){result.push({id,error:codeOf(error),current:id===selectedId});}
    }
    return result.sort((a,b)=>(b.revision??0)-(a.revision??0)||a.id.localeCompare(b.id));
  }
  async function availability(value) {
    if(!value)return null;
    const available=async(path,mode)=>{try{await access(path,mode);return true;}catch{return false;}};
    return {python:{path:value.python,available:await available(value.python,constants.X_OK)},
      signer:value.signerProvider!==undefined?
        {kind:'TRUSTED_SEP43_PROVIDER',path:value.signerProvider,available:await available(value.signerProvider,constants.R_OK)}:
        {kind:'ENVIRONMENT',name:value.secretEnv??'STELLAR_SECRET',available:Boolean(process.env[value.secretEnv??'STELLAR_SECRET'])},
      proxy:value.httpsProxyEnv===undefined?null:{name:value.httpsProxyEnv,available:Boolean(process.env[value.httpsProxyEnv])}};
  }
  async function state() {
    const current=await snapshot();
    return {schema:SELECTION,directory,configured:Boolean(current.preset),mode:current.base.mode,
      revision:current.base.selectedId,revisionNumber:current.item?.revision??null,
      stateSha256:current.stateSha256,settingsFile:current.base.file,settingsSha256:current.preset?.sha256??null,
      operator:current.preset?.view??null,settings:current.preset?.value??null,error:current.error,
      defaultPython:'/usr/bin/python3',declaredSettingsFile,history:await history(current.base.selectedId),
      availability:await availability(current.preset?.value)};
  }
  async function inputSettings(input,current,{save=false}={}) {
    const allowed=['settings','expectedStateSha256','note','sourceRevision',...(save?['expectedReviewSha256']:[])];
    check(object(input)&&Object.keys(input).every(key=>allowed.includes(key))&&object(input.settings)&&
      SHA.test(input.expectedStateSha256??'')&&(!save||SHA.test(input.expectedReviewSha256??'')),
      'OPERATOR_SETTINGS_FIELDS_INVALID');
    validatePreset(input.settings);
    const settings=canonicalSettings(input.settings),note=input.note??'',sourceRevision=input.sourceRevision??null;
    check(typeof note==='string'&&note.length<=1000&&!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(note),'OPERATOR_NOTE_INVALID');
    check(sourceRevision===null||typeof sourceRevision==='string'&&ID.test(sourceRevision),'OPERATOR_REVISION_INVALID');
    let raw;
    if(sourceRevision) {
      const retained=await record(sourceRevision);
      check(isDeepStrictEqual(settings,canonicalSettings(retained.preset.value)),'OPERATOR_REVISION_INPUT_CHANGED',409);
      raw=await bytes(retained.files.settings,16384);
      check(hash(raw)===retained.preset.sha256,'OPERATOR_REVISION_SETTINGS_CHANGED',409);
    } else if(current.preset&&isDeepStrictEqual(settings,canonicalSettings(current.preset.value)))raw=current.raw;
    else raw=encode(settings);
    check(raw&&raw.length<=16384,'OPERATOR_SETTINGS_TOO_LARGE');
    return {settings,raw,note,sourceRevision};
  }
  function reviewed(current,proposal) {
    const settingsSha256=hash(proposal.raw),proof={schema:REVIEW,directory,base:current.base,
      settingsSha256,note:proposal.note,sourceRevision:proposal.sourceRevision};
    const before=current.preset?canonicalSettings(current.preset.value):{};
    return {schema:REVIEW,reviewSha256:hash(encode(proof)),expectedStateSha256:current.stateSha256,
      settingsSha256,settings:proposal.settings,proof,note:proposal.note,
      noChange:current.base.mode==='WORKSPACE'&&!current.error&&current.preset.sha256===settingsSha256,
      adoption:current.base.mode==='DECLARED',repair:Boolean(current.error),
      changes:KEYS.filter(key=>key!=='schema'&&!isDeepStrictEqual(before[key],proposal.settings[key]))
        .map(field=>({field,before:before[field]??null,after:proposal.settings[field]??null}))};
  }
  async function review(input) {
    const current=await snapshot(),proposal=await inputSettings(input,current);
    check(input.expectedStateSha256===current.stateSha256,'OPERATOR_SETTINGS_CHANGED_REVIEW_AGAIN',409);
    const result=reviewed(current,proposal);
    return {...result,availability:await availability(proposal.settings)};
  }
  async function replaceSelection(value) {
    const temporary=selectionFile+'.'+randomUUID()+'.tmp';
    const file=await open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    try {
      await file.writeFile(encode(value));await file.sync();await file.close();
      await rename(temporary,selectionFile);
      const parent=await open(root,'r');try{await parent.sync();}finally{await parent.close();}
    } finally {await file.close().catch(()=>{});await unlink(temporary).catch(()=>{});}
  }
  async function save(input) {
    const current=await snapshot(),proposal=await inputSettings(input,current,{save:true});
    const id='preset-'+input.expectedReviewSha256,files=paths(id);
    // Recover a lost successful save response without creating a second version.
    // The prior review pin and exact bytes still have to identify this revision.
    if(current.base.selectedId===id&&current.item&&!current.error) {
      const proof=current.item.proof;
      check(hash(encode(proof.base))===input.expectedStateSha256&&proof.settingsSha256===hash(proposal.raw)&&
        proof.note===proposal.note&&proof.sourceRevision===proposal.sourceRevision,
        'OPERATOR_REVIEW_CHANGED',409);
      return {...await state(),alreadySaved:true};
    }
    check(current.stateSha256===input.expectedStateSha256,'OPERATOR_SETTINGS_CHANGED_REVIEW_AGAIN',409);
    const result=reviewed(current,proposal);
    check(result.reviewSha256===input.expectedReviewSha256,'OPERATOR_REVIEW_CHANGED',409);
    if(result.noChange)return {...await state(),alreadySaved:true};
    let item=await optional(files.metadata);
    if(item) {
      // An earlier attempt may have written a complete immutable revision but
      // stopped before selecting it. Reuse that original publication.
      item=await record(id);check(isDeepStrictEqual(item.proof,result.proof),'OPERATOR_REVISION_CHANGED',409);
    } else {
      const previous=await history(current.base.selectedId);
      const revision=1+previous.reduce((max,value)=>Math.max(max,value.revision??0),0);
      check(revision<=10000,'OPERATOR_REVISION_LIMIT');
      await publish(files.settings,proposal.raw,{same:true,raw:true});
      if(current.raw!==null)await publish(files.previous,current.raw,{same:true,raw:true});
      if(current.selectionRaw!==null)await publish(files.previousSelection,current.selectionRaw,{same:true,raw:true});
      item={schema:REVISION,id,revision,createdAt:new Date().toISOString(),proof:result.proof};
      await publish(files.metadata,item,{same:true});
    }
    // Check the selected host again before the only mutable publication. The
    // shared intake lease serializes cooperating CLI/console preparation.
    check((await snapshot()).stateSha256===current.stateSha256,'OPERATOR_SETTINGS_CHANGED_REVIEW_AGAIN',409);
    await replaceSelection({schema:SELECTION,id,settingsSha256:result.settingsSha256});
    return {...await state(),alreadySaved:false};
  }
  async function revision(id) {
    const item=await record(id);
    return {schema:REVISION,id:item.id,revision:item.revision,createdAt:item.createdAt,note:item.proof.note,
      settingsSha256:item.preset.sha256,settings:item.preset.value,operator:item.preset.view,
      sourceRevision:item.proof.sourceRevision};
  }
  async function attachment(id) {
    const item=await record(id),raw=await bytes(item.files.settings,16384);
    check(hash(raw)===item.preset.sha256,'OPERATOR_REVISION_SETTINGS_CHANGED',409);
    return {bytes:raw,name:id+'.settings.json',sha256:item.preset.sha256};
  }
  return {state,currentFile,read,readMatching,revision,attachment,review:input=>lease(()=>review(input)),save:input=>lease(()=>save(input))};
}
