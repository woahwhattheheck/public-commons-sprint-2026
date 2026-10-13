#!/usr/bin/env node
// MIT. Independent complete source/report/review receiving without a repository connection.
import {constants} from 'node:fs';
import {open,mkdir,link,unlink,lstat} from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {serveDocumentComparison} from './document-comparison-service.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex'),need=(x,m)=>{if(!x)throw Error(m);};
async function read(file,max=128*1024*1024){const h=await open(path.resolve(file),constants.O_RDONLY|constants.O_NOFOLLOW);try{const s=await h.stat();need(s.isFile()&&s.size<=max,'Select a bounded ordinary source file');const b=await h.readFile();need(b.length===s.size,'File changed during receiving');return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(b);}finally{await h.close();}}
async function publish(file,text){const b=Buffer.from(text),temp=file+'.pending-'+randomUUID();let h;try{h=await open(temp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);await h.writeFile(b);await h.sync();await h.close();h=null;try{await link(temp,file);}catch(e){if(e.code!=='EEXIST')throw e;need(await read(file)===text,'Different original output already exists: '+path.basename(file));}const d=await open(path.dirname(file),constants.O_RDONLY|constants.O_DIRECTORY);try{await d.sync();}finally{await d.close();}}finally{await h?.close();await unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});}return{path:file,bytes:b.length,sha256:sha(b)};}
export async function receiveDocumentComparisonFiles({source,review,delivery,output}){
 need(Boolean(source)!==Boolean(delivery),'Choose source or complete delivery');
 const input=delivery?{deliveryText:await read(delivery)}:{sourceText:await read(source,64*1024*1024),reviewText:review?await read(review,1024*1024):null};
 const result=await serveDocumentComparison({method:delivery?'receive':'delivery',input}),out=path.resolve(output);
 await mkdir(out,{recursive:true,mode:0o700});need((await lstat(out)).isDirectory()&&!(await lstat(out)).isSymbolicLink(),'Select an owned ordinary output directory');
 const files={},body=delivery?input.deliveryText:result.deliveryText;
 for(const [name,text]of Object.entries({'comparison-delivery.json':body,'comparison-report.json':JSON.stringify(result.report,null,2)+'\n','comparison-report.html':result.html,'comparison-pairs.csv':result.pairsCSV,'comparison-fields.csv':result.fieldsCSV}))files[name]=await publish(path.join(out,name),text);
 // A fresh independent parse/reproduction is part of receiving, not an asserted native outcome.
 const reopened=await serveDocumentComparison({method:'receive',input:{deliveryText:await read(path.join(out,'comparison-delivery.json'))}});
 need(JSON.stringify(reopened.report)===JSON.stringify(result.report)&&reopened.html===result.html&&reopened.pairsCSV===result.pairsCSV&&reopened.fieldsCSV===result.fieldsCSV,'Cold receiving changed a complete output');
 const receipt={schema:'stellar-forge.document-comparison-file-receiving.v1',state:'RECEIVED_AND_REOPENED',source:result.report.source,delivery:{bytes:Buffer.byteLength(body),sha256:sha(body)},files,counts:result.report.counts};
 await publish(path.join(out,'comparison-receiving.json'),JSON.stringify(receipt,null,2)+'\n');return receipt;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const opts={},a=process.argv.slice(2);for(let i=0;i<a.length;i+=2){need(['--source','--review','--delivery','--out'].includes(a[i])&&a[i+1],'Use --source FILE [--review FILE] or --delivery FILE, plus --out DIRECTORY');opts[a[i]]=a[i+1];}
 try{need(opts['--out'],'Select --out DIRECTORY');process.stdout.write(JSON.stringify(await receiveDocumentComparisonFiles({source:opts['--source'],review:opts['--review'],delivery:opts['--delivery'],output:opts['--out']}),null,2)+'\n');}
 catch(e){process.stderr.write(JSON.stringify({error:e.code??'DOCUMENT_COMPARISON_RECEIVING_FAILED',message:e.message})+'\n');process.exitCode=1;}
}
