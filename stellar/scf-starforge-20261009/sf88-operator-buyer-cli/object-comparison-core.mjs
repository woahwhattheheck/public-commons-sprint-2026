/** Compare two original authenticated Object-session backups without restoring either. */
import {createHash} from 'node:crypto';
import {verifyObjectSessionRecovery} from './workspace-recovery.mjs';
import {need,InputError} from './config.mjs';

function createObjectComparisonTools(hash,byteLength){
  // Reserve room for the original CLI failure wrapper and terminating newline.
  const MAX_RESULT_BYTES=255*1024*1024-64*1024;
  const withinLimit=value=>{need(byteLength(JSON.stringify(value))<=MAX_RESULT_BYTES,'OBJECT_COMPARISON_RESULT_SIZE_LIMIT');return value;};
  const SCHEMA='stellar-forge.sf88.object-session-comparison.v1',RECORD='stellar-forge.sf88.object-session-recovery.v1';
  const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k),object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
  const clone=v=>JSON.parse(JSON.stringify(v)),hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
  const need=(v,code)=>{if(!v)throw Object.assign(new Error(code),{code});};
  function canonical(v,depth=0){
    need(depth<=128,'OBJECT_COMPARISON_STRUCTURE_TOO_DEEP');
    if(v===null||typeof v==='string'||typeof v==='boolean')return JSON.stringify(v);
    if(typeof v==='number'){need(Number.isFinite(v),'OBJECT_COMPARISON_VALUE_INVALID');return JSON.stringify(v);}
    if(Array.isArray(v))return '['+v.map(x=>canonical(x,depth+1)).join(',')+']';
    need(object(v),'OBJECT_COMPARISON_VALUE_INVALID');return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k],depth+1)).join(',')+'}';
  }
  const same=(a,b)=>canonical(a)===canonical(b),sha=v=>hash(canonical(v));
  function inventory(rows,{root=false}={}){
    need(Array.isArray(rows)&&rows.length<=9500,'OBJECT_COMPARISON_INVENTORY_INVALID');const seen=new Set();
    for(const f of rows){
      need(object(f)&&typeof f.path==='string'&&f.path.length<=2048&&
        (root&&f.path===''&&f.kind==='directory'||f.path!==''&&!f.path.includes('\\')&&!f.path.includes('\0')&&f.path.split('/').every(p=>p&&p!=='.'&&p!=='..'))&&
        !seen.has(f.path)&&['file','directory'].includes(f.kind),'OBJECT_COMPARISON_MEMBER_INVALID');
      seen.add(f.path);
      if(f.kind==='file')need(Number.isSafeInteger(f.size)&&f.size>=0&&hex(f.sha256),'OBJECT_COMPARISON_MEMBER_INVALID');
    }
    if(root)need(seen.has(''),'OBJECT_COMPARISON_ROOT_MEMBER_REQUIRED');
    return rows;
  }
  function recordIdentity(record){
    need(object(record)&&record.schema===RECORD&&object(record.plan)&&record.plan.schema===RECORD&&
      object(record.plan.objectSession)&&typeof record.plan.objectSession.sessionId==='string'&&record.plan.objectSession.sessionId.length>0&&
      typeof record.plan.stateRoot==='string'&&record.plan.stateRoot.startsWith('/')&&
      typeof record.plan.directory==='string'&&record.plan.directory.startsWith(record.plan.stateRoot==='/'?'/':record.plan.stateRoot+'/')&&record.plan.directory!==record.plan.stateRoot&&
      record.plan.objectSession.directory===record.plan.directory&&
      typeof record.createdAt==='string'&&Number.isFinite(Date.parse(record.createdAt))&&
      hex(record.plan.reviewSha256),'OBJECT_COMPARISON_RECORD_INVALID');
    inventory(record.files,{root:true});inventory(record.plan.sourceFiles);
    return {sessionId:record.plan.objectSession.sessionId,directory:record.plan.directory,stateRoot:record.plan.stateRoot};
  }
  function compareInventory(before,after){
    const left=new Map(before.map((r,index)=>[r.path,{row:r,index}])),right=new Map(after.map((r,index)=>[r.path,{row:r,index}]));
    const paths=[...new Set([...left.keys(),...right.keys()])].sort();
    const counts={added:0,removed:0,changed:0,unchanged:0};
    const members=paths.map(path=>{
      const b=left.get(path),a=right.get(path),status=!b?'added':!a?'removed':same(b.row,a.row)?'unchanged':'changed';
      counts[status]++;
      const changedFields=b&&a?[...new Set([...Object.keys(b.row),...Object.keys(a.row)])].sort().filter(key=>
        own(b.row,key)!==own(a.row,key)||own(b.row,key)&&!same(b.row[key],a.row[key])):[];
      return {path,status,beforeIndex:b?.index??null,afterIndex:a?.index??null,...(changedFields.length?{changedFields}:{})};
    });
    return {counts,members};
  }
  function statistics(files){
    let bytes=0n,regularFiles=0,directories=0;
    for(const f of files)if(f.kind==='file'){regularFiles++;bytes+=BigInt(f.size);}else directories++;
    return {regularFiles,directories,bytes:bytes.toString()};
  }
  const pointerToken=k=>String(k).replaceAll('~','~0').replaceAll('/','~1');
  function changes(before,after,pointer=''){
    const out=[];
    function visit(b,a,path,bPresent=true,aPresent=true,depth=0){
      need(depth<=128,'OBJECT_COMPARISON_STRUCTURE_TOO_DEEP');
      if(bPresent&&aPresent&&same(b,a))return;
      if(bPresent&&aPresent&&object(b)&&object(a)){
        for(const key of [...new Set([...Object.keys(b),...Object.keys(a)])].sort())
          visit(b[key],a[key],path+'/'+pointerToken(key),own(b,key),own(a,key),depth+1);
      }else if(bPresent&&aPresent&&Array.isArray(b)&&Array.isArray(a)){
        for(let index=0;index<Math.max(b.length,a.length);index++)visit(b[index],a[index],path+'/'+index,index<b.length,index<a.length,depth+1);
      }else out.push({pointer:path,kind:!bPresent?'added':!aPresent?'removed':'changed',beforePresent:bPresent,afterPresent:aPresent,...(bPresent?{before:clone(b)}:{}),...(aPresent?{after:clone(a)}:{})});
    }
    visit(before,after,pointer);return out;
  }
  function metadata(record){
    const copy=clone(record);delete copy.files;delete copy.plan.sourceFiles;return copy;
  }
  /** Pure comparison only. Authentication remains the original native verifier's responsibility. */
  function compareRecords(before,after){
    const identity=recordIdentity(before);need(same(identity,recordIdentity(after)),'OBJECT_COMPARISON_DIFFERENT_ORIGINAL_SESSION');
    const members=compareInventory(before.files,after.files),sourceFiles=compareInventory(before.plan.sourceFiles,after.plan.sourceFiles);
    const metadataChanges=changes(metadata(before),metadata(after));
    const elapsed=Date.parse(after.createdAt)-Date.parse(before.createdAt);
    return {schema:'stellar-forge.sf88.object-session-record-diff.v1',identity,
      chronology:{beforeCreatedAt:before.createdAt,afterCreatedAt:after.createdAt,order:elapsed>0?'forward':elapsed<0?'reversed':'same_time'},
      summary:{before:statistics(before.files),after:statistics(after.files),members:members.counts,sourceFiles:sourceFiles.counts,
        metadataChanges:metadataChanges.length,identicalRecord:same(before,after)},
      members:members.members,sourceFiles:sourceFiles.members,metadataChanges,
      indexMeaning:{members:'beforeIndex/afterIndex resolve through the complete respective record.files arrays.',
        sourceFiles:'beforeIndex/afterIndex resolve through the complete respective record.plan.sourceFiles arrays.',
        metadataChanges:'JSON Pointers refer to the complete original record. File inventories are compared separately; absent values use presence flags.'}};
  }
  function side(side){
    need(object(side)&&typeof side.bundle==='string'&&side.bundle.startsWith('/')&&hex(side.recordSha256)&&object(side.verification),'OBJECT_COMPARISON_SIDE_INVALID');
    const identity=recordIdentity(side.record),v=side.verification,p=side.record.plan,stats=statistics(side.record.files);
    need(v.status==='OBJECT_SESSION_BACKUP_VERIFIED'&&v.schema===RECORD&&v.recordSha256===side.recordSha256&&
      v.directory===identity.directory&&v.stateRoot===identity.stateRoot&&v.createdAt===side.record.createdAt&&v.reviewSha256===p.reviewSha256&&
      same(v.objectSession,p.objectSession)&&same(v.checkpoint,side.record.checkpoint)&&same(v.absentLedger,p.absentLedger)&&
      same(v.runtime,p.runtime)&&v.files===stats.regularFiles&&String(v.bytes)===stats.bytes&&
      v.walletEnvironmentExported===false&&v.restoreMode==='ORIGINAL_CANONICAL_STATE_ROOT',
      'OBJECT_COMPARISON_NATIVE_RESULT_CHANGED');
    return identity;
  }
  function finishComparison(before,after){
    const identity=side(before);need(same(identity,side(after)),'OBJECT_COMPARISON_DIFFERENT_ORIGINAL_SESSION');
    const body={schema:SCHEMA,status:'OBJECT_SESSION_BACKUPS_COMPARED',authenticated:true,...identity,before:clone(before),after:clone(after),
      comparison:compareRecords(before.record,after.record)};
    return withinLimit({...body,comparisonSha256:sha(body)});
  }

  function finishPartialComparison(completed,failedSide,errorCode,selection){
    need(['before','after','comparison'].includes(failedSide),'OBJECT_COMPARISON_FAILURE_STAGE_INVALID');
    const selected={};
    for(const name of ['before','after']){
      need(object(selection[name])&&typeof selection[name].bundle==='string'&&hex(selection[name].expected),'OBJECT_COMPARISON_EXACT_BACKUPS_REQUIRED');
      selected[name]={bundle:selection[name].bundle,expected:selection[name].expected};
      if(completed[name]){side(completed[name]);need(completed[name].bundle===selected[name].bundle&&completed[name].recordSha256===selected[name].expected,'OBJECT_COMPARISON_NATIVE_SELECTION_CHANGED');}
    }
    need((!completed.after||completed.before)&&
      (failedSide!=='before'||!completed.after)&&
      (failedSide!=='comparison'||completed.before&&completed.after),'OBJECT_COMPARISON_FAILURE_STAGE_INVALID');
    const body={schema:SCHEMA,status:'OBJECT_SESSION_BACKUP_COMPARISON_INCOMPLETE',authenticated:false,failedSide,
      errorCode:/^[A-Z][A-Z0-9_]{0,127}$/.test(errorCode??'')?errorCode:'OBJECT_COMPARISON_FAILED',selection:selected,
      ...(completed.before?{before:clone(completed.before)}:{}),...(completed.after?{after:clone(completed.after)}:{})};
    return withinLimit({...body,partialComparisonSha256:sha(body)});
  }
  function validatePartialComparison(result){
    need(object(result)&&result.schema===SCHEMA&&result.status==='OBJECT_SESSION_BACKUP_COMPARISON_INCOMPLETE'&&
      result.authenticated===false&&hex(result.partialComparisonSha256),'OBJECT_COMPARISON_RESULT_INVALID');
    const {partialComparisonSha256,...body}=result;
    need(sha(body)===partialComparisonSha256,'OBJECT_COMPARISON_SAVED_CONTENT_CHANGED');
    const expected=finishPartialComparison({before:result.before,after:result.after},result.failedSide,result.errorCode,result.selection);
    need(same(result,expected),'OBJECT_COMPARISON_SAVED_CONTENT_CHANGED');return result;
  }

  /** Reopen saved comparison content; this checks its retained data, not the ciphertext again. */
  function validateObjectRecoveryComparison(result){
    if(result?.status==='OBJECT_SESSION_BACKUP_COMPARISON_INCOMPLETE')return validatePartialComparison(result);
    withinLimit(result);
    need(object(result)&&result.schema===SCHEMA&&result.status==='OBJECT_SESSION_BACKUPS_COMPARED'&&result.authenticated===true&&
      hex(result.comparisonSha256),'OBJECT_COMPARISON_RESULT_INVALID');
    const {comparisonSha256,...body}=result;
    need(sha(body)===comparisonSha256,'OBJECT_COMPARISON_SAVED_CONTENT_CHANGED');
    const identity=side(result.before);need(same(identity,side(result.after))&&result.sessionId===identity.sessionId&&
      result.directory===identity.directory&&result.stateRoot===identity.stateRoot,'OBJECT_COMPARISON_DIFFERENT_ORIGINAL_SESSION');
    need(same(result.comparison,compareRecords(result.before.record,result.after.record)),'OBJECT_COMPARISON_SAVED_DIFF_CHANGED');
    return result;
  }
  function resolveComparisonMember(result,row,collection='members'){
    need(['members','sourceFiles'].includes(collection),'OBJECT_COMPARISON_COLLECTION_INVALID');
    const left=collection==='members'?result.before.record.files:result.before.record.plan.sourceFiles;
    const right=collection==='members'?result.after.record.files:result.after.record.plan.sourceFiles;
    const b=row.beforeIndex===null?null:left[row.beforeIndex],a=row.afterIndex===null?null:right[row.afterIndex];
    need((b===null||b?.path===row.path)&&(a===null||a?.path===row.path),'OBJECT_COMPARISON_MEMBER_INDEX_INVALID');
    return {before:b,after:a};
  }
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const pretty=v=>JSON.stringify(v,null,2);
  function renderObjectRecoveryComparison(result,{format='html'}={}){
    validateObjectRecoveryComparison(result);need(['html','markdown'].includes(format),'OBJECT_COMPARISON_REPORT_FORMAT_INVALID');
    if(result.status==='OBJECT_SESSION_BACKUP_COMPARISON_INCOMPLETE')return renderPartialComparison(result,format);
    const c=result.comparison,summary=c.summary;
    const fileLabel=f=>f===null?'Absent':f.kind==='directory'?'Directory':f.size+' bytes · SHA-256 '+f.sha256;
    const memberRows=collection=>c[collection].map(row=>{const original=resolveComparisonMember(result,row,collection);return [
      row.path||'(state root)',row.status,fileLabel(original.before),fileLabel(original.after),(row.changedFields||[]).join(', ')];});
    const metadataRows=c.metadataChanges.map(change=>[change.pointer,change.kind,change.beforePresent?pretty(change.before):'Absent',change.afterPresent?pretty(change.after):'Absent']);
    const identityRows=[['Session',result.sessionId],['Original directory',result.directory],['Original state root',result.stateRoot],['Comparison SHA-256',result.comparisonSha256],
      ['Before backup',result.before.bundle],['Before record SHA-256',result.before.recordSha256],['Before created',result.before.record.createdAt],
      ['After backup',result.after.bundle],['After record SHA-256',result.after.recordSha256],['After created',result.after.record.createdAt],['Selection chronology',c.chronology.order]];
    const summaryRows=[['Backup regular files',summary.before.regularFiles,summary.after.regularFiles],['Backup directories',summary.before.directories,summary.after.directories],['Backup bytes',summary.before.bytes,summary.after.bytes]];
    const countRows=[['Complete backup members',summary.members.added,summary.members.removed,summary.members.changed,summary.members.unchanged],
      ['Original source members',summary.sourceFiles.added,summary.sourceFiles.removed,summary.sourceFiles.changed,summary.sourceFiles.unchanged]];
    const meaning='Both selected backups completed the existing native authentication and original-session verification before this comparison was created. Before and after are the operator’s selected order. This report records the complete retained comparison; opening it does not decrypt either backup again or restore any state.';
    const sourceMeaning='Complete backup members include the snapshot’s own retained capture records. Original source members follow each authenticated plan.sourceFiles selection. Both lists include every member and retain their complete original rows through the two records below.';
    if(format==='markdown'){
      const cell=v=>esc(v).replaceAll('|','&#124;').replaceAll('`','&#96;').replace(/\r?\n/g,'<br>');
      const table=(headers,rows)=>'| '+headers.map(cell).join(' | ')+' |\n| '+headers.map(()=>'---').join(' | ')+' |\n'+rows.map(r=>'| '+r.map(cell).join(' | ')+' |').join('\n')+'\n';
      const section=(title,body)=>'\n## '+title+'\n\n'+body+'\n';
      return '# Object session backup comparison\n\n'+meaning+'\n'+section('Original selection',table(['Field','Value'],identityRows))+
        section('Inventory totals',table(['Measure','Before','After'],summaryRows)+ '\n'+table(['Inventory','Added','Removed','Changed','Unchanged'],countRows))+
        section('Complete member comparison',sourceMeaning+'\n\n'+table(['Path','Change','Before','After','Changed fields'],memberRows('members')))+
        section('Original source member comparison',table(['Path','Change','Before','After','Changed fields'],memberRows('sourceFiles')))+
        section('Session, configuration, checkpoint and other record changes',metadataRows.length?table(['Original JSON Pointer','Change','Before','After'],metadataRows):'No non-inventory record changes.')+
        section('Complete before verification and original record','<pre>'+esc(pretty(result.before))+'</pre>')+
        section('Complete after verification and original record','<pre>'+esc(pretty(result.after))+'</pre>');
    }
    const table=(headers,rows)=>'<div class="table"><table><thead><tr>'+headers.map(x=>'<th scope="col">'+esc(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(v=>'<td>'+esc(v)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
    return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Object session backup comparison</title><style>'+
      'body{font:16px/1.5 system-ui,sans-serif;color:#17191b;background:#fff;margin:0}main{max-width:1280px;margin:auto;padding:32px}h1{font-size:2rem}h2{margin-top:2rem}p{max-width:90ch}.muted{color:#555}.table{overflow:auto;border:1px solid #b9bdc1;margin:1rem 0}table{border-collapse:collapse;width:100%;font-size:.88rem}th,td{border-bottom:1px solid #d4d7da;padding:.6rem;text-align:left;vertical-align:top;white-space:pre-wrap;overflow-wrap:anywhere}th{background:#f1f2f3}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:.82rem;background:#f5f6f7;padding:1rem}summary{cursor:pointer;font-weight:600}details{margin:1rem 0}a{color:inherit}@media print{main{padding:0}.table{overflow:visible}table{font-size:8pt}tr{break-inside:avoid}pre{font-size:8pt}}'+
      '</style></head><body><main><p class="muted">Starforge / Recovery</p><h1>Object session backup comparison</h1><p>'+esc(meaning)+'</p>'+
      '<h2>Original selection</h2>'+table(['Field','Value'],identityRows)+'<h2>Inventory totals</h2>'+table(['Measure','Before','After'],summaryRows)+table(['Inventory','Added','Removed','Changed','Unchanged'],countRows)+
      '<h2>Complete member comparison</h2><p>'+esc(sourceMeaning)+'</p>'+table(['Path','Change','Before','After','Changed fields'],memberRows('members'))+
      '<h2>Original source member comparison</h2>'+table(['Path','Change','Before','After','Changed fields'],memberRows('sourceFiles'))+
      '<h2>Session, configuration, checkpoint and other record changes</h2>'+(metadataRows.length?table(['Original JSON Pointer','Change','Before','After'],metadataRows):'<p>No non-inventory record changes.</p>')+
      '<details><summary>Complete before verification and original record</summary><pre>'+esc(pretty(result.before))+'</pre></details>'+
      '<details><summary>Complete after verification and original record</summary><pre>'+esc(pretty(result.after))+'</pre></details>'+
      '<p class="muted">Selecting a restore remains an explicit action in the existing recovery workspace, using the chosen original record hash.</p></main></body></html>\n';
  }

  function renderPartialComparison(result,format){
    const meaning='This comparison did not complete. The completed sides below retain the original native verification and complete original record. No paired difference or restore choice has been produced. Reopening this report checks its retained content and does not decrypt a backup again.';
    const rows=[['Status',result.status],['Failed stage',result.failedSide],['Original error code',result.errorCode],['Partial comparison SHA-256',result.partialComparisonSha256]];
    for(const name of ['before','after']){
      rows.push([name+' selected bundle',result.selection[name].bundle],[name+' selected record SHA-256',result.selection[name].expected],
        [name+' native verification',result[name]?'Completed; retained below':'Not completed'] );
    }
    const completed=['before','after'].filter(name=>result[name]);
    if(format==='markdown'){
      const cell=v=>esc(v).replaceAll('|','&#124;').replaceAll(String.fromCharCode(96),'&#96;').replace(/\r?\n/g,'<br>');
      return '# Incomplete object session backup comparison\n\n'+meaning+'\n\n| Field | Value |\n| --- | --- |\n'+
        rows.map(row=>'| '+row.map(cell).join(' | ')+' |').join('\n')+'\n'+
        completed.map(name=>'\n## Complete '+name+' native verification and original record\n\n<pre>'+esc(pretty(result[name]))+'</pre>\n').join('')+
        '\nThe two original selections remain attached to this report. Complete the indicated verification before comparing or choosing a restore.\n';
    }
    return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Incomplete object session backup comparison</title><style>'+
      'body{font:16px/1.5 system-ui,sans-serif;color:#17191b;background:#fff;margin:0}main{max-width:1280px;margin:auto;padding:32px}h1{font-size:2rem}h2{margin-top:2rem}table{border-collapse:collapse;width:100%}th,td{padding:.6rem;text-align:left;vertical-align:top;border:1px solid #d4d7da;overflow-wrap:anywhere}th{background:#f1f2f3}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f5f6f7;padding:1rem;font-size:.82rem}summary{cursor:pointer;font-weight:600}details{margin:1.5rem 0}@media print{main{padding:0}pre{font-size:8pt}}'+
      '</style></head><body><main><p>Starforge / Recovery</p><h1>Incomplete object session backup comparison</h1><p>'+esc(meaning)+'</p>'+
      '<table><thead><tr><th scope="col">Field</th><th scope="col">Value</th></tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(value=>'<td>'+esc(value)+'</td>').join('')+'</tr>').join('')+'</tbody></table>'+
      completed.map(name=>'<details><summary>Complete '+name+' native verification and original record</summary><pre>'+esc(pretty(result[name]))+'</pre></details>').join('')+
      '<p>The two original selections remain attached to this report. Complete the indicated verification before comparing or choosing a restore.</p></main></body></html>\n';
  }

  return Object.freeze({SCHEMA,canonical,compareRecords,finishComparison,finishPartialComparison,validateSide:side,validateObjectRecoveryComparison,resolveComparisonMember,renderObjectRecoveryComparison});
}

async function compareObjectRecoveryBackups({before,after}={},context={}){
  need(context.inspectSnapshot===undefined,'OBJECT_COMPARISON_CAPTURE_HOOK_RESERVED');
  const valid=selection=>selection&&typeof selection.bundle==='string'&&
    /^[a-f0-9]{64}$/.test(selection.expected??'')&&
    (selection.passEnv===undefined||typeof selection.passEnv==='string'&&/^[A-Za-z_][A-Za-z0-9_]*$/.test(selection.passEnv));
  need(valid(before)&&valid(after),'OBJECT_COMPARISON_EXACT_BACKUPS_REQUIRED');
  const completed={},onProgress=context.onProgress??(()=>{});
  let currentSide='before';
  try{
    for(const name of ['before','after']){
      currentSide=name;need(!context.signal?.aborted,'WORKSPACE_RECOVERY_INTERRUPTED');
      const selection=name==='before'?before:after;let captured;
      const verification=await verifyObjectSessionRecovery({bundle:selection.bundle,expected:selection.expected,passEnv:selection.passEnv},{
        environment:context.environment,signal:context.signal,
        onProgress:event=>onProgress({...event,comparisonSide:name}),
        inspectSnapshot:async({record})=>{need(captured===undefined,'OBJECT_COMPARISON_CAPTURE_REPEATED');captured=JSON.parse(JSON.stringify(record));}
      });
      need(captured!==undefined&&verification.recordSha256===selection.expected,'OBJECT_COMPARISON_NATIVE_SELECTION_CHANGED');
      const original={bundle:selection.bundle,recordSha256:verification.recordSha256,verification,record:captured};
      comparisonTools.validateSide(original);completed[name]=original;
      onProgress({stage:'OBJECT_COMPARISON_BACKUP_VERIFIED',comparisonSide:name,recordSha256:verification.recordSha256});
    }
    currentSide='comparison';
    need(!context.signal?.aborted,'WORKSPACE_RECOVERY_INTERRUPTED');
    return comparisonTools.finishComparison(completed.before,completed.after);
  }catch(error){
    const failure=error instanceof Error?error:new InputError('OBJECT_COMPARISON_FAILED');
    failure.partialComparison=comparisonTools.finishPartialComparison(completed,currentSide,failure.code,{before,after});
    throw failure;
  }
}

const comparisonTools=createObjectComparisonTools(value=>createHash('sha256').update(value,'utf8').digest('hex'),value=>Buffer.byteLength(value,'utf8'));
export const {compareRecords,validateObjectRecoveryComparison,resolveComparisonMember,renderObjectRecoveryComparison}=comparisonTools;
export {compareObjectRecoveryBackups};
