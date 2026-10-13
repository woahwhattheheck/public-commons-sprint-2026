#!/usr/bin/env node
// MIT. Publish the exact built BIM browser into an explicitly selected Next public directory.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {applicationSelection} from '../lib/workspace.mjs';
import {confined,directory,writeExact,lease,fileDescriptor} from '../lib/files.mjs';
import {need,bytes,hash} from '../lib/value.mjs';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const ASSETS={'settlement-operator.mjs':'web/settlement-operator.mjs','settlement-controller.mjs':'web/settlement-controller.mjs','index.html':'web/index.html','app.mjs':'web/app.mjs','styles.css':'web/styles.css','working.mjs':'web/working.mjs','exchange-domain.mjs':'lib/exchange-domain.mjs','wallet-entry.bundle.mjs':'web/wallet-entry.bundle.mjs','wallet-entry.bundle.css':'web/wallet-entry.bundle.css','wallet-entry.bundle.mjs.LEGAL.txt':'web/wallet-entry.bundle.mjs.LEGAL.txt','wallet-entry.bundle.css.LEGAL.txt':'web/wallet-entry.bundle.css.LEGAL.txt'};
function separate(a,b){const rel=path.relative(a,b);return rel.startsWith('..'+path.sep)||rel==='..'||path.isAbsolute(rel);}
export async function exportNextAssets({out,apiPrefix='/api/bim'}){
 need(typeof out==='string'&&path.isAbsolute(out)&&separate(ROOT,path.resolve(out))&&separate(path.resolve(out),ROOT),'SEPARATE_PUBLIC_TARGET_REQUIRED');
 need(/^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(apiPrefix),'API_PREFIX_REQUIRED');
 const source=await applicationSelection(ROOT);await directory(out);const owner=await lease(out,'asset-publication');
 try{
  const files=[];for(const [target,relative]of Object.entries(ASSETS)){
   const expected=source.files.find(f=>f.path===relative);need(expected,'BUILT_ASSET_MISSING',{path:relative});
   let data=await fs.readFile(await confined(ROOT,relative));need(data.length===expected.bytes&&hash(data)===expected.sha256,'BUILT_ASSET_CHANGED',{path:relative});
   if(target==='index.html'){
    let text=new TextDecoder('utf-8',{fatal:true}).decode(data);need((text.match(/<html lang="en">/g)??[]).length===1,'HTML_MOUNT_CHANGED');
    text=text.replace('<html lang="en">','<html lang="en" data-api-prefix="'+apiPrefix+'">').replace('href="/styles.css"','href="./styles.css"').replace('src="/app.mjs"','src="./app.mjs"');
    data=Buffer.from(text,'utf8');
   }
   await writeExact(await confined(out,target,true),data,0o644);const actual=await fileDescriptor(await confined(out,target),target);files.push({path:target,bytes:actual.bytes,sha256:actual.sha256,source:relative,sourceSha256:expected.sha256});
  }
  need((await applicationSelection(ROOT)).sha256===source.sha256,'APPLICATION_SOURCE_CHANGED');
  const result={schema:'bim.next-assets.v1',applicationSha256:source.sha256,apiPrefix,files,serverExecution:false};await writeExact(path.join(out,'BIM_ASSETS.json'),bytes(result),0o644);return result;
 }finally{await owner.release();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args={};for(let i=2;i<process.argv.length;i+=2){const k=process.argv[i];need(['--out','--api-prefix'].includes(k)&&process.argv[i+1]&&!Object.hasOwn(args,k),'ASSET_OPTIONS');args[k]=process.argv[i+1];}
 exportNextAssets({out:args['--out'],apiPrefix:args['--api-prefix']??'/api/bim'}).then(r=>process.stdout.write(JSON.stringify(r)+'\n')).catch(e=>{process.stderr.write(JSON.stringify({error:{code:e.code??'ASSET_EXPORT_FAILED'}})+'\n');process.exitCode=1;});
}
