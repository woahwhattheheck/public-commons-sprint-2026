#!/usr/bin/env node
/** Continue one actual original-workbook return in the existing Measurements case. */
import fs from 'node:fs';
import path from 'node:path';
import {MeasurementWorkspace} from './workspace.mjs';
import {hash,stable} from './normalise.mjs';
import {previewHandback,publishHandback,readManifest,readHandbackView,handbackMember,handbackBundle,receiveHandbackBytes} from './source_handback.mjs';
const args=process.argv.slice(2),options={};
for(let i=0;i<args.length;i+=2){
 if(!['--workspace','--output','--selection'].includes(args[i])||args[i+1]===undefined)throw Error('Use --workspace ORIGINAL_DIRECTORY --output SAME_RETURN_DIRECTORY --selection ORIGINAL_SELECTION_JSON');
 if(options[args[i].slice(2)]!==undefined)throw Error('Repeat no receiving option.');
 options[args[i].slice(2)]=args[i+1];
}
if(!options.workspace||!options.output||!options.selection)throw Error('Keep the original workspace, operation directory and full source selection.');
const workspace=path.resolve(options.workspace),output=path.resolve(options.output),selectionPath=path.resolve(options.selection);
if(!fs.existsSync(path.join(workspace,'measurements.sqlite')))throw Error('Select the actual retained Measurements database.');
const raw=fs.readFileSync(selectionPath),selected=JSON.parse(raw);
if(Object.keys(selected).some(x=>!['expectedRevision','sourceIds','exportIds','title','note'].includes(x)))throw Error('Keep only the complete source selection, title and note.');
if(typeof selected.title!=='string'||!selected.title.trim()||typeof selected.note!=='string')throw Error('Name and describe this actual workbook return.');
const {title,note,...selection}=selected;
const intent={operation:'ECO-ORIGINAL-WORKBOOK-RESULTS-20261013',workspace,selectionSha256:hash(raw),selection:selected};
fs.mkdirSync(output,{recursive:true});
const lock=path.join(output,'receiving.lock');
let lease;try{lease=fs.openSync(lock,'wx',0o600);}catch(e){throw Error('The original receiving lease exists. Reconcile that process before continuing: '+lock);}
fs.writeFileSync(lease,JSON.stringify({pid:process.pid,intent})+'\n');fs.fsyncSync(lease);
const json=v=>JSON.stringify(v,null,2)+'\n',read=name=>JSON.parse(fs.readFileSync(path.join(output,name),'utf8'));
function retain(name,value){
 if(path.isAbsolute(name)||name.split(/[\\/]/).some(x=>!x||x==='.'||x==='..'))throw Error('Invalid operation member.');
 const target=path.join(output,name),bytes=Buffer.isBuffer(value)?value:Buffer.from(typeof value==='string'?value:json(value));
 if(fs.existsSync(target)){if(!fs.readFileSync(target).equals(bytes))throw Error('Keep the exact existing operation member: '+name);return;}
 fs.mkdirSync(path.dirname(target),{recursive:true});
 const temporary=target+'.pending-'+process.pid,fd=fs.openSync(temporary,'wx',0o600);
 try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 try{fs.linkSync(temporary,target);}catch(e){if(e.code!=='EEXIST'||!fs.readFileSync(target).equals(bytes))throw e;}
 finally{fs.rmSync(temporary,{force:true});}
}
const scientific=workspace=>{const value=workspace.fullSnapshot(),portable={...value.portable};delete portable.createdAt;return hash(stable({...value,portable}));};
let original,receiver;
try{
 retain('intent.json',intent);retain('original-selection.json',raw);
 original=new MeasurementWorkspace(workspace);
 const before=scientific(original);let preview,request;
 if(fs.existsSync(path.join(output,'publication-request.json'))){
  preview=read('preview.json');request=read('publication-request.json');
  if(stable({...selection,previewSha256:preview.previewSha256,title,note})!==stable(request))throw Error('The retained publication no longer matches this original operation.');
 }else{
  preview=previewHandback(original,selection);
  if(!preview.originalWorkbooks?.length)throw Error('Select the original imported worksheet source carrying its retained binary/row lineage.');
  retain('preview.json',preview);
  request={...selection,previewSha256:preview.previewSha256,title,note};
  retain('publication-request.json',request);
 }
 const edition=publishHandback(original,request);
 if(edition.deliveryEdition!==3||!edition.originalWorkbooks?.length)throw Error('Keep the complete original-workbook edition.');
 retain('manifest.json',edition);
 if(stable(publishHandback(original,request))!==stable(edition))throw Error('Exact original publication replay changed.');
 if(stable(readHandbackView(original,edition.id))!==stable(preview))throw Error('Published workbook view changed.');
 const files=[];
 for(const member of edition.files){
  const {data}=handbackMember(original,edition.id,member.name);
  retain('delivery/'+member.name,data);files.push({path:'delivery/'+member.name,bytes:data.length,sha256:hash(data)});
 }
 retain('delivery/manifest.json',edition);
 const bundle=handbackBundle(original,edition.id),bytes=Buffer.from(bundle.contentBase64,'base64');
 if(bytes.length!==bundle.bytes||hash(bytes)!==bundle.sha256)throw Error('Complete source-return ZIP identity changed.');
 retain(bundle.filename,bytes);
 if(scientific(original)!==before)throw Error('Source return changed the original scientific project.');
 receiver=new MeasurementWorkspace(path.join(output,'cold-receiver'));
 const receiverBefore=scientific(receiver),received=receiveHandbackBytes(receiver,bytes);
 if(stable(received)!==stable(edition)||stable(readHandbackView(receiver,received.id))!==stable(preview))throw Error('The whole cold-received edition changed.');
 if(scientific(receiver)!==receiverBefore)throw Error('Receiving an immutable return changed the recipient scientific project.');
 receiver.close();receiver=new MeasurementWorkspace(path.join(output,'cold-receiver'));
 if(stable(readManifest(receiver,edition.id))!==stable(edition)||stable(receiveHandbackBytes(receiver,bytes))!==stable(edition))throw Error('Cold reopen or exact received replay changed.');
 for(const member of edition.files)if(!handbackMember(receiver,edition.id,member.name).data.equals(fs.readFileSync(path.join(output,'delivery',member.name))))throw Error('A cold-reopened original or generated member changed.');
 const result={operation:intent.operation,workspace,editionId:edition.id,revision:edition.revision,counts:preview.counts,
  originalWorkbooks:edition.originalWorkbooks,sourceIds:selection.sourceIds,exportIds:selection.exportIds,
  completeZip:{filename:bundle.filename,bytes:bytes.length,sha256:hash(bytes)},files,
  unchangedScientificProject:true,coldReceived:true,coldReopened:true,exactPublicationReplay:true,exactReceiveReplay:true,
  visualInspection:{state:'awaiting_producer_review',artifacts:['delivery/report.html',...edition.originalWorkbooks.flatMap(x=>[x.originalPath,x.returnedPath].filter(Boolean).map(x=>'delivery/'+x)),...edition.files.filter(x=>x.name.endsWith('.csv')||x.name==='returned-workbook.xlsx').map(x=>'delivery/'+x.name)]}};
 retain('native-result.json',result);
 process.stdout.write(json(result));
}catch(error){
 const target=path.join(output,'error-'+Date.now()+'-'+process.pid+'.json');
 fs.writeFileSync(target,json({message:error.message,stack:error.stack}),{flag:'wx',mode:0o600});throw error;
}finally{
 try{receiver?.close();}finally{try{original?.close();}finally{fs.closeSync(lease);fs.rmSync(lock,{force:true});}}
}
