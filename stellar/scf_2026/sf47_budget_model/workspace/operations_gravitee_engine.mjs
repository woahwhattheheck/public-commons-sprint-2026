// SPDX-License-Identifier: MIT
// The original complete Gravitee reader/preparer. Read-only process adapter.
import {readFileSync} from 'node:fs';
import {readProfile} from '../../sf49_data_commissioning/installation-workorders/profiles.mjs';
import {inspectGraviteeInstallation,graviteeInstallationTemplate,prepareGraviteeInstallation} from '../../sf49_data_commissioning/installation-workorders/gravitee-installation-core.mjs';
const input=JSON.parse(readFileSync(0,'utf8'));
const raw=Buffer.from(input.packetBase64,'base64');
try {
 let result;
 if(input.action==='inspect') {
  result=inspectGraviteeInstallation(raw);
  const packet=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
  result.members=packet.files.map(({path,bytes,sha256})=>({path,bytes,sha256}));
 } else if(input.action==='member') {
  const source=inspectGraviteeInstallation(raw),packet=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
  const file=packet.files.find(row=>row.path===input.path);
  if(!file)throw new Error('Select a complete retained member of this original handover.');
  const bytes=Buffer.from(file.base64,'base64');
  let value;try{value=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{}
  if(value===undefined)result={file:{path:file.path,bytes:file.bytes,sha256:file.sha256},encoding:'base64',base64:file.base64,source:source.file};
  else {
   const chars=Array.from(value),offset=input.offset??0,limit=input.limit??16000;
   if(!Number.isSafeInteger(offset)||offset<0||offset>chars.length||!Number.isSafeInteger(limit)||limit<1||limit>32000)throw new Error('Select a valid original source page.');
   const end=Math.min(chars.length,offset+limit);
   result={file:{path:file.path,bytes:file.bytes,sha256:file.sha256},encoding:'utf8',offset,end,total:chars.length,nextOffset:end<chars.length?end:null,text:chars.slice(offset,end).join(''),source:source.file};
  }
 } else if(input.action==='template') {
  result=graviteeInstallationTemplate({raw,seed:input.seed,caseValue:input.caseValue,profile:readProfile('gravitee-commissioning').value});
 } else if(input.action==='prepare') {
  result=prepareGraviteeInstallation({raw,seed:input.seed,caseValue:input.caseValue,profile:readProfile('gravitee-commissioning').value,bindings:input.bindings,selectionRaw:Buffer.from(input.cohortBase64,'base64'),cohortSourceId:input.cohortSourceId});
 } else throw new Error('Select an original Gravitee source operation.');
 process.stdout.write(JSON.stringify({ok:true,result}));
} catch(error) {
 process.stdout.write(JSON.stringify({ok:false,error:{code:'GRAVITEE_SOURCE_INPUT',message:error.message}}));process.exitCode=1;
}
