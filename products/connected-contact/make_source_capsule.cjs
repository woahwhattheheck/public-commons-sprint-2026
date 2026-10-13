#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const LOADER_BODY="function loadCurrentContactClosure(packet) {\n  if (!packet || packet.schema !== 'commons.connected-contact-required-source-closure.v1' ||\n      packet.repository !== 'woahwhattheheck/public-commons-sprint-2026' || packet.source_commit !== SOURCE_COMMIT ||\n      !Array.isArray(packet.files) || packet.files.length !== MANIFEST.length)\n    throw new TypeError('Receive the complete selected original contact-source closure');\n  const rows=new Map();\n  for(const row of packet.files){\n    if(!row || typeof row.path!=='string' || rows.has(row.path) || typeof row.content!=='string')\n      throw new TypeError('Unique complete repository-relative source bodies required');\n    rows.set(row.path,row);\n  }\n  const sourceMap={};\n  for(const expected of MANIFEST){\n    const row=rows.get(expected.path);\n    if(!row || row.bytes!==expected.bytes || row.sha256!==expected.sha256 || row.git_blob!==expected.git_blob)\n      throw new TypeError('Selected source identity changed: '+expected.path);\n    sourceMap[row.path]=row.content;\n  }\n  // Verify this entire capsule against its independently supplied SHA before\n  // evaluating this receiver. This selected maintained hash module supplies\n  // per-file UTF-8 verification; it does not replace that external identity.\n  const hash={exports:{}};\n  new Function('module','exports',sourceMap['host/connected_sha256.cjs'])(hash,hash.exports);\n  if(typeof hash.exports.sha256Utf8!=='function')throw new TypeError('Original hash export required');\n  for(const expected of MANIFEST){\n    const actual=hash.exports.sha256Utf8(sourceMap[expected.path]);\n    if(actual.bytes!==expected.bytes || actual.sha256!==expected.sha256)\n      throw new TypeError('Complete selected source bytes changed: '+expected.path);\n  }\n  const factory={exports:{}};\n  new Function('module','exports',sourceMap['host/connected_first_contact.cjs'])(factory,factory.exports);\n  const drafts={exports:{}};\n  new Function('module','exports',sourceMap['host/connected_first_contact_draft.cjs'])(drafts,drafts.exports);\n  if(typeof drafts.exports.createConnectedExistingFirstContactDraft!=='function')\n    throw new TypeError('Complete original saved-draft receiver required');\n  const carrier=factory.exports;\n  const selectedFactory=Object.freeze({...carrier,createConnectedFirstContact:options=>\n    options?.input?.native_draft!==undefined\n      ? drafts.exports.createConnectedExistingFirstContactDraft({...options,\n          createConnectedFirstContact:carrier.createConnectedFirstContact})\n      : carrier.createConnectedFirstContact(options)});\n  const keys={\n    hash:'host/connected_sha256.cjs',\n    intent:'host/revenue_outbound_intent.cjs',\n    gateway:'host/first_contact_gateway.cjs',\n    mailboxAdmission:'host/connected_mailbox_admission.cjs',\n    publicationPolicy:'commons-publication-policy.cjs',\n    attachments:'host/connected_contact_attachments.cjs',\n    deliveryCorrection:'host/contact_delivery_correction.cjs',\n    content:'host/first_contact_content.cjs',\n    deliveryNotices:'host/connected_delivery_notices.cjs'\n  };\n  const sources=Object.fromEntries(Object.entries(keys).map(([key,path])=>[key,sourceMap[path]]));\n  const modules=factory.exports.loadOriginalContactModules({\n    ...sources,deliveryNoticeSources:sourceMap\n  });\n  const checkpoint={exports:{}};\n  new Function('module','exports',sourceMap['host/connected_first_contact_checkpoint.cjs'])(checkpoint,checkpoint.exports);\n  if(typeof factory.exports.createConnectedFirstContact!=='function' ||\n      typeof checkpoint.exports.openConnectedContactCheckpoint!=='function' ||\n      typeof checkpoint.exports.readConnectedContactCheckpoint!=='function' ||\n      typeof modules.mailboxAdmission?.createConnectedMailboxAdmission!=='function' ||\n      typeof modules.deliveryNotices?.readDeliveryNotice!=='function' ||\n      typeof modules.deliveryNotices?.deliveryState!=='function')\n    throw new TypeError('Complete original factory, checkpoint, admission and delivery interfaces required');\n  return Object.freeze({\n    repository:packet.repository,sourceCommit:SOURCE_COMMIT,\n    manifest:Object.freeze(MANIFEST.map(row=>Object.freeze({...row}))),\n    factory:selectedFactory,drafts:drafts.exports,modules,checkpoint:checkpoint.exports,\n    sources:Object.freeze(sourceMap)\n  });\n}\nmodule.exports={loadCurrentContactClosure};\n";
function makeSourceCapsule(directory,sourceCommit){
 if(!/^[a-f0-9]{40}$/.test(sourceCommit||''))throw Error('Select the actual published source commit.');
 const manifestText=fs.readFileSync(path.join(directory,'SOURCE_MANIFEST.json'),'utf8');
 const manifest=JSON.parse(manifestText);
 if(manifest.schema!=='commons.connected-contact-source-manifest/v1'||!Array.isArray(manifest.files))throw Error('Complete product source manifest required.');
 const rows=[...manifest.files,{path:'SOURCE_MANIFEST.json',bytes:Buffer.byteLength(manifestText,'utf8'),sha256:crypto.createHash('sha256').update(manifestText,'utf8').digest('hex')}],seen=new Set();
 const files=rows.map(row=>{
  if(!row.path||row.path.startsWith('/')||row.path.split('/').some(x=>!x||x==='.'||x==='..'))throw Error('Invalid source path.');
  if(seen.has(row.path))throw Error('Repeated source path.');seen.add(row.path);
  const file=path.join(directory,row.path),st=fs.lstatSync(file);if(!st.isFile()||st.isSymbolicLink())throw Error('Select original regular source.');
  const raw=fs.readFileSync(file),sha256=crypto.createHash('sha256').update(raw).digest('hex');
  if(raw.length!==row.bytes||sha256!==row.sha256)throw Error('Source changed: '+row.path);
  const content=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw);
  const git_blob=crypto.createHash('sha1').update(Buffer.from('blob '+raw.length+String.fromCharCode(0))).update(raw).digest('hex');
  return {path:row.path,content,bytes:raw.length,sha256,git_blob};
 });
 const selected=files.map(({content,...row})=>row);
 const content="'use strict';\nconst SOURCE_COMMIT="+JSON.stringify(sourceCommit)+";\nconst MANIFEST="+JSON.stringify(selected,null,2)+";\n"+LOADER_BODY;
 const loader={filename:'load_connected_contact_source.cjs',content,bytes:Buffer.byteLength(content,'utf8'),sha256:crypto.createHash('sha256').update(content,'utf8').digest('hex')};
 return {schema:'commons.connected-contact-required-source-closure.v1',repository:'woahwhattheheck/public-commons-sprint-2026',source_commit:sourceCommit,files,loader};
}
module.exports={makeSourceCapsule};
if(require.main===module){
 const [sourceCommit,output]=process.argv.slice(2);if(!output)throw Error('Usage: node make_source_capsule.cjs ACTUAL_COMMIT OUTPUT.json');
 const content=JSON.stringify(makeSourceCapsule(__dirname,sourceCommit));
 if(fs.existsSync(output)){if(fs.readFileSync(output,'utf8')!==content)throw Error('Existing selected capsule differs.');}
 else {
  const target=path.resolve(output),pending=target+'.writing-'+crypto.randomUUID(),fd=fs.openSync(pending,'wx',0o600);
  try{fs.writeFileSync(fd,content,'utf8');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  try{fs.linkSync(pending,target);const dir=fs.openSync(path.dirname(target),'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}}
  catch(error){if(error.code!=='EEXIST'||fs.readFileSync(target,'utf8')!==content)throw error;}
  finally{fs.unlinkSync(pending);}
 }
}
