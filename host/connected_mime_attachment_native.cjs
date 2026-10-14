#!/usr/bin/env node
'use strict';
/** Receive an original Gmail raw response into an explicitly chosen new local file. */
const fs=require('node:fs');
const path=require('node:path');
const {receiveGmailRawAttachment}=require('./connected_mime_attachment.cjs');
const {sha256Bytes}=require('./connected_sha256.cjs');
function need(ok,message){if(!ok)throw TypeError(message);}
function readJSON(filename,maxBytes){
  const stat=fs.statSync(filename);
  need(stat.isFile()&&stat.size<=maxBytes,'Choose a complete JSON file within the selected capacity');
  const data=fs.readFileSync(filename);
  need(data.length<=maxBytes,'Input grew beyond the selected capacity');
  return JSON.parse(data.toString('utf8'));
}
function sameOutput(filename,expected){
  const stat=fs.lstatSync(filename);
  need(stat.isFile()&&!stat.isSymbolicLink(),'Existing output must be a regular file');
  need(stat.size===expected.bytes,'Existing output has different bytes; choose a new path');
  const actual=sha256Bytes(fs.readFileSync(filename));
  need(actual.bytes===expected.bytes&&actual.sha256===expected.sha256,'Existing output differs; choose a new path');
}
function receiveRawFile(rawFile,selectionFile,outputFile){
  need([rawFile,selectionFile,outputFile].every(value=>typeof value==='string'&&value.length),'Choose input, selection and output files');
  const selection=readJSON(selectionFile,64*1024);
  const capacity=selection.maxMessageBytes??64*1024*1024;
  need(Number.isSafeInteger(capacity)&&capacity>0,'Choose a positive message byte capacity');
  const rawLimit=Math.ceil(capacity/3)*4+8*1024*1024;
  need(Number.isSafeInteger(rawLimit),'Selected message capacity is too large');
  const response=readJSON(rawFile,rawLimit);
  // Accept the normalized message or the untouched structured connector envelope.
  const message=response.raw!==undefined?response:response.structuredContent;
  const received=receiveGmailRawAttachment(message,selection);
  const output=path.resolve(outputFile);
  need(output!==path.resolve(rawFile)&&output!==path.resolve(selectionFile),'Choose an output separate from the input files');
  let disposition='created';
  try{fs.writeFileSync(output,received.data,{flag:'wx',mode:0o600});}
  catch(error){if(error.code!=='EEXIST')throw error;sameOutput(output,received.attachment);disposition='already-identical';}
  sameOutput(output,received.attachment);
  return {schema:received.schema,source:received.source,attachment:received.attachment,output,disposition};
}
function main(argv){
  if(argv.length!==3)throw TypeError('Usage: node host/connected_mime_attachment_native.cjs RAW_RESPONSE.json SELECTION.json OUTPUT_FILE');
  process.stdout.write(JSON.stringify(receiveRawFile(...argv),null,2)+'\n');
}
module.exports={receiveRawFile,main};
if(require.main===module){try{main(process.argv.slice(2));}catch(error){process.stderr.write('Attachment receive failed: '+error.message+'\n');process.exitCode=1;}}
