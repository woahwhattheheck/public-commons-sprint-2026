#!/usr/bin/env node
import {readFile,lstat,mkdir,realpath,open,link,unlink} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {compileInstitutionReport,reportHtml,reportCsv} from './compile_report.mjs';
const fail=m=>{throw Error(m);};
const args={};
for(let i=2;i<process.argv.length;i+=2){const k=process.argv[i];if(!['--input','--output'].includes(k)||!process.argv[i+1]||args[k])fail('Use --input COMPLETE_INPUT.json --output PRIVATE_OUTPUT_DIRECTORY');args[k]=process.argv[i+1];}
if(!args['--input']||!args['--output'])fail('Use --input COMPLETE_INPUT.json --output PRIVATE_OUTPUT_DIRECTORY');
const source=resolve(args['--input']),out=resolve(args['--output']);
const info=await lstat(source);
if(!info.isFile()||info.isSymbolicLink()||info.size>128*1024*1024)fail('Choose a regular complete input at most 128 MiB');
const inputBytes=await readFile(source),inputText=new TextDecoder('utf-8',{fatal:true}).decode(inputBytes);
if(!Buffer.from(inputText).equals(inputBytes))fail('Input must retain exact UTF-8 bytes');
const input=JSON.parse(inputText);
const sha256=s=>createHash('sha256').update(s).digest('hex');
for(const original of input.originals??[])if(typeof original.text!=='string'||Buffer.byteLength(original.text)>32*1024*1024)fail('Each original must be UTF-8 and at most 32 MiB');
const report=compileInstitutionReport(input,{sha256});
await mkdir(out,{recursive:true,mode:0o700});
const outInfo=await lstat(out);
if(!outInfo.isDirectory()||outInfo.isSymbolicLink()||await realpath(out)!==out||outInfo.mode&0o077)fail('Use a canonical private output directory with mode 0700');
async function retain(name,bytes){
  const path=join(out,name);let previous;
  try{const stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink())fail('Preserve nonregular output '+name);previous=await readFile(path);}catch(e){if(e.code!=='ENOENT')throw e;}
  if(previous){if(!previous.equals(bytes))fail('Preserve different existing output '+name);return;}
  const temporary=join(out,'.pending-'+randomUUID());let fd;
  try{fd=await open(temporary,'wx',0o600);await fd.writeFile(bytes);await fd.sync();await fd.close();fd=null;
    try{await link(temporary,path);}catch(e){if(e.code!=='EEXIST')throw e;const stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink()||!(await readFile(path)).equals(bytes))fail('Concurrent different output '+name);}
    const directory=await open(out,'r');try{await directory.sync();}finally{await directory.close();}
  }finally{if(fd)await fd.close();await unlink(temporary).catch(e=>{if(e.code!=='ENOENT')throw e;});}
}
const files={'input.json':inputBytes,'report.json':Buffer.from(JSON.stringify(report,null,2)+'\n'),'report.html':Buffer.from(reportHtml(report)),'observations.csv':Buffer.from(reportCsv(report))};
const manifest={schema:'commons.institution-report-delivery.v1',inputSha256:sha256(inputBytes),selectionHash:report.selectionHash,institutionRows:report.institutionRows.length,peerRows:report.peerRows.length,exceptions:report.exceptions.length,files:Object.entries(files).map(([path,bytes])=>({path,bytes:bytes.length,sha256:sha256(bytes)}))};
for(const [name,bytes]of Object.entries(files))await retain(name,bytes);
await retain('manifest.json',Buffer.from(JSON.stringify(manifest,null,2)+'\n'));
console.log(JSON.stringify({state:'COMPLETE',directory:out,...manifest}));
