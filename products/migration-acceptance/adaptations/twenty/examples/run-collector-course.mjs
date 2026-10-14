#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Authored reference operating course. The fetch adapter cannot contact a server.
import {readFile,mkdir,writeFile,readdir} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {runCollectorCourse,authoredRoutes} from './collector-course.mjs';
import {captureDirectory} from '../capture-twenty.mjs';
import {canonical,digest} from '../provider-input.mjs';
const HERE=dirname(fileURLToPath(import.meta.url));
const json=value=>JSON.stringify(value,null,2)+'\n';
const check=(ok,message)=>{if(!ok)throw Error(message);};
async function read(name){return JSON.parse(await readFile(join(HERE,name),'utf8'));}
async function write(path,value){await writeFile(path,json(value),{flag:'wx',mode:0o600});}
export async function runAuthoredCollector(directory){
 const output=resolve(directory);await mkdir(dirname(output),{recursive:true,mode:0o700});await mkdir(output,{recursive:false,mode:0o700});
 const reference=await read('capture.json'),configuration=await read('capture-configuration.json'),mapping=await read('mapping.json');
 const protocol=await runCollectorCourse({reference,configuration,mapping});await write(join(output,'complete-protocol-course.json'),protocol);
 const config=protocol.configuration;await mkdir(join(output,'source'),{mode:0o700});
 for(let i=0;i<config.source.objects.length;i++){
  const path=config.source.objects[i].path;check(/^source\/[A-Za-z0-9_-]+\.json$/.test(path),'The authored source filename differs.');
  await writeFile(join(output,path),reference.source.objects[i].original.body,{flag:'wx',mode:0o600});
 }
 const configurationPath=join(output,'capture-configuration.json');await write(configurationPath,config);
 const routes=authoredRoutes(reference),requests=[];
 const fetchImpl=async(url,options)=>{
  check(Object.hasOwn(routes,url),'This authored course permits no external URL.');
  check(options.method==='GET'&&options.redirect==='error','The original CLI must preserve read-only requests.');
  check(options.headers.Authorization==='Bearer authored-interface-placeholder','This course accepts only its nonsecret authored marker.');
  const response=routes[url];requests.push({url,method:options.method,redirect:options.redirect,requestedAt:new Date().toISOString(),response});
  const bytes=new TextEncoder().encode(response.body),cut=Math.floor(bytes.length/2);
  return new Response(new ReadableStream({start(controller){controller.enqueue(bytes.slice(0,cut));controller.enqueue(bytes.slice(cut));controller.close();}}),{status:response.status,headers:{'content-type':'application/json',...(response.retryAfter?{'retry-after':response.retryAfter}:{})}});
 };
 const options={fetchImpl,environment:{TWENTY_AUTHORED_ONLY:'authored-interface-placeholder'}};
 const captureRoot=join(output,'authored-cli-capture'),first=await captureDirectory(configurationPath,captureRoot,options),before=requests.length;
 const repeated=await captureDirectory(configurationPath,captureRoot,options);
 check(canonical(first)===canonical(repeated)&&requests.length===before,'Completed CLI resume must preserve identity with zero new GETs.');
 const index=JSON.parse(await readFile(join(captureRoot,'HTTP_INDEX.json'),'utf8'));
 for(const row of index.files){const body=await readFile(join(captureRoot,'originals',row.key+'.json'),'utf8'),pin=digest(body);check(pin.bytes===row.bytes&&pin.sha256===row.sha256,'Full retained original index differs: '+row.key);}
 check(!(await readdir(captureRoot)).includes('.collector-lock.json'),'Completed original process lock must be released.');
 const result={schema:'twenty.collector-native-course.v1',evidenceKind:'authored-interface-exercise',nativeNodeExecuted:true,externalRequests:0,providerDataObserved:false,completeCapture:first,completeResume:repeated,requests,index,completedAt:new Date().toISOString(),statement:'Actual CLI filesystem and streaming HTTP interfaces operated in Node with exclusively authored local response bodies; no CRM was contacted. Original production capture envelopes remain inside the explicitly labelled authored-course directory.'};
 await write(join(output,'complete-native-cli-course.json'),result);
 const summary={schema:'twenty.collector-course-delivery.v1',evidenceKind:'authored-interface-exercise',nativeNodeExecuted:true,externalRequests:0,providerDataObserved:false,protocolScenarios:protocol.summary,nativeCli:{requests:requests.length,indexedPages:index.files.length,capture:first},files:['complete-protocol-course.json','complete-native-cli-course.json','capture-configuration.json','source/companies.json','source/people.json','source/opportunities.json','authored-cli-capture/']};
 await write(join(output,'RESULT.json'),summary);return summary;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 if(process.argv.length!==3)throw Error('Usage: node examples/run-collector-course.mjs NEW_PRIVATE_OUTPUT_DIRECTORY');
 console.log(json(await runAuthoredCollector(process.argv[2])));
}
