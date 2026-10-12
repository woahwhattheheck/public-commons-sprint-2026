// MIT. Validate an original SF74 handoff for the existing SF47 delivery workspace.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {importRuntimeHandoff, reviewRuntime, runtimeHtml} from '../../../scf-starforge-20261009/sf74-merchant-support-console/runtime-support.mjs';
import {parseWorkspace} from '../../../scf-starforge-20261009/sf74-merchant-support-console/workspace-file.mjs';
import {caseMetadata} from '../../../scf-starforge-20261009/sf74-merchant-support-console/case-store.mjs';

const MAX_INPUT=8*1024*1024, MAX_OUTPUT=16*1024*1024;
const hash=value=>createHash('sha256').update(value).digest('hex');
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const ordered=value=>Array.isArray(value)?value.map(ordered):plain(value)?
  Object.fromEntries(Object.keys(value).sort().map(key=>[key,ordered(value[key])])):value;
const canonical=value=>JSON.stringify(ordered(value));
const fail=(code,message,status=422)=>Object.assign(new Error(message),{code,status});

export async function inspectSupportHandoff(raw) {
  if(!Buffer.isBuffer(raw))raw=Buffer.from(raw);
  if(raw.length===0||raw.length>MAX_INPUT)
    throw fail('SUPPORT_HANDOFF_SIZE','Select an original support handoff up to 8 MiB.',413);
  const handoffText=new TextDecoder('utf-8',{fatal:true}).decode(raw);
  const imported=await importRuntimeHandoff(handoffText);
  const workspace=await parseWorkspace(imported.workspaceText), metadata=caseMetadata(imported.metadata);
  const original=JSON.parse(handoffText);
  const report=reviewRuntime(imported.supportText,workspace.inputs);
  const identity={workspaceSha256:hash(imported.workspaceText),supportSha256:hash(imported.supportText),metadata};
  const readerFiles=[
    ['./support_handoff.mjs','sf47/workspace/support_handoff.mjs'],
    ['../../../scf-starforge-20261009/sf74-merchant-support-console/runtime-support.mjs','sf74/runtime-support.mjs'],
    ['../../../scf-starforge-20261009/sf74-merchant-support-console/workspace-file.mjs','sf74/workspace-file.mjs'],
    ['../../../scf-starforge-20261009/sf74-merchant-support-console/case-store.mjs','sf74/case-store.mjs'],
  ];
  const reader={};
  for(const [relative,label] of readerFiles)reader[label]=hash(await readFile(new URL(relative,import.meta.url)));
  // The retained document labels its original export time. Current calculation
  // timestamps remain in the JSON review; capture and event times are untouched.
  const exportedAt=new Date(original.generatedAt).toISOString();
  const footer='<small>Generated '+exportedAt+'</small>';
  let html=runtimeHtml({...report,generatedAt:exportedAt},{name:workspace.name,metadata});
  if(html.split(footer).length!==2)
    throw fail('SUPPORT_RENDERER_CHANGED','The original support report footer changed. Update this installed receiving edition.');
  html=html.replace(footer,'<small>Original support export '+exportedAt+'</small>');
  return {schema:'stellar-forge.sf47-support-source.v1',
    source:{sha256:hash(raw),bytes:raw.length,generatedAt:original.generatedAt,
      workspaceSha256:identity.workspaceSha256,supportSha256:identity.supportSha256,
      identitySha256:hash(canonical(identity))},
    workspace:{name:workspace.name,inputs:workspace.inputs,summary:workspace.summary},
    metadata,reader,report,html};
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]) {
  try {
    const chunks=[];let length=0;
    for await(const chunk of process.stdin){
      length+=chunk.length;
      if(length>MAX_INPUT)throw fail('SUPPORT_HANDOFF_SIZE','Select an original support handoff up to 8 MiB.',413);
      chunks.push(chunk);
    }
    const result=await inspectSupportHandoff(Buffer.concat(chunks));
    const output=JSON.stringify({ok:true,result});
    if(Buffer.byteLength(output)>MAX_OUTPUT)
      throw fail('SUPPORT_REVIEW_SIZE','The original review exceeds the receiving size. Select a shorter original capture period.',413);
    process.stdout.write(output+'\n');
  }catch(error){
    const code=typeof error.code==='string'&&/^[A-Z0-9_]{1,100}$/.test(error.code)?
      error.code:'SUPPORT_HANDOFF_INVALID';
    const message=String(error.message||'The original support handoff could not be read.').slice(0,1000);
    process.stdout.write(JSON.stringify({ok:false,error:{code,message,status:error.status===413?413:422}})+'\n');
    process.exitCode=2;
  }
}
