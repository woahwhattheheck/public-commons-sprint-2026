#!/usr/bin/env node
import {runLargeCLI} from './large_cli.mjs';
import {collectionFromFiles,previewCollection,receiveCollection,listCollections,publishCollection} from './collections.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {MeasurementWorkspace} from './workspace.mjs';
import {createMeasurementHandler} from './http.mjs';
import {fetchProvider} from './providers.mjs';
import {calibrationExport,calibrationCSV,pairedLoads} from './calibration.mjs';
const [command='help',...args]=process.argv.slice(2), options={};
for(let i=0;i<args.length;i++){if(!args[i].startsWith('--')||args[i+1]===undefined)throw new Error('Options require --name value pairs');options[args[i].slice(2)]=args[++i];}
const directory=path.resolve(options.workspace||process.env.DATA_DIR||'./data');
const readText=async file=>new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await fs.readFile(file));
const output=async value=>{const text=typeof value==='string'?value:JSON.stringify(value,null,2)+'\n';if(options.output)await fs.writeFile(options.output,text);else process.stdout.write(text);};
if(command.startsWith('large-'))await runLargeCLI(command.slice(6),options,directory);
else if(command==='help')console.log(`Measurements workspace, Node >=22.16\n\nlarge-prepare|large-import --workspace ./data --file original.csv --kind wqp --label Source\nlarge-commit --workspace ./data --intake ID\nlarge-status --workspace ./data\nlarge-export --workspace ./data --output ./complete-edition\nlarge-receive --workspace ./empty-data --file complete-edition/project.zip\n\ncollection-preview|collection-receive --workspace ./data --manifest collection.json --source-root ./originals\ncollection-publish --workspace ./data --id COLLECTION_SHA\ncollections --workspace ./data\nserve --workspace ./data --port 3101\npreview|import --workspace ./data --kind wqp|stations|usgs-daily --file input.csv --label Source\nfetch --workspace ./data --kind wqp|stations|usgs-daily --station USGS-... --from YYYY-MM-DD --to YYYY-MM-DD\nsummary|records|calibration|export|portable --workspace ./data --output result.json\nreceive --workspace ./empty-data --file complete-workspace.json\nmap --workspace ./data --station ORG-ID --reach r1 --reviewer Name --reason Rationale\nreview --workspace ./data --id HASH --state include|exclude|pending --reviewer Name --reason Rationale\nloads --workspace ./data --station ORG-ID --flow-station USGS-ID --parameter tn|tp --reason Rationale\n\nThe server also exposes the original-app integration API /api/measurement-workspace.\n`);
else if(command==='serve'){
  const handler=createMeasurementHandler({directory}),publicDir=fileURLToPath(new URL('../web/',import.meta.url));
  const token=process.env.MEASUREMENTS_INTERNAL_TOKEN;
  const server=http.createServer(async(req,res)=>{
    if(token&&req.headers['x-measurement-internal-token']!==token){res.statusCode=403;res.end('Forbidden');return;}
    if(req.headers.origin){try{if(new URL(req.headers.origin).host!==req.headers.host){res.statusCode=403;res.end('Cross-origin request rejected');return;}}catch{res.statusCode=403;res.end('Invalid origin');return;}}
    if(req.url.startsWith('/api/measurement-workspace'))return handler(req,res);
    const name=new URL(req.url,'http://localhost').pathname;
    if(name==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Upper Savannah · Measured data</title><body style="margin:0"><section id="large-files"></section><section id="collections"></section><main id="measurements"></main><script type="module">import{mountLargeFilePanel}from'/measurements/large_files.mjs';import{mountMeasurements}from'/measurements/workspace.js';import{mountCollectionPanel}from'/measurements/collections.mjs';const desk=mountMeasurements(document.getElementById('measurements'));mountLargeFilePanel(document.getElementById('large-files'),{refresh:()=>desk.refresh()});mountCollectionPanel(document.getElementById('collections'),{request:(path,method='GET',payload)=>fetch('/api/measurement-workspace'+path,{method,headers:{'Content-Type':'application/json'},body:payload===undefined?undefined:JSON.stringify(payload)}),refresh:()=>desk.refresh()});</script></body></html>`);}
    const files={'/measurements/large_files.mjs':['large_files.mjs','text/javascript'],'/measurements/workspace.js':['workspace.js','text/javascript'],'/measurements/workspace.css':['workspace.css','text/css'],'/measurements/collections.mjs':['collections.mjs','text/javascript']};
    if(files[name])try{const[file,mime]=files[name];res.setHeader('Content-Type',mime+'; charset=utf-8');res.end(await fs.readFile(path.join(publicDir,file)));return;}catch(error){console.error(error);}
    res.statusCode=404;res.end('Not found');
  });
  server.listen(Number(options.port||3101),options.host||'127.0.0.1',()=>console.log(JSON.stringify({ready:true,host:options.host||'127.0.0.1',port:server.address().port,pid:process.pid})));
  if(token){process.stdin.resume();process.stdin.once('end',()=>server.close(()=>{handler.close();process.exit(0);}));}
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>{handler.close();process.exit(0);}));
}else{
  const w=new MeasurementWorkspace(directory);
  try{
    const input=options.file?{kind:options.kind||'wqp',text:await readText(options.file),label:options.label||path.basename(options.file),mapping:options.mapping?JSON.parse(await fs.readFile(options.mapping,'utf8')):{}}:null;
    if(command==='preview')await output(w.preview(input));
    else if(command==='import')await output(w.import(input));
    else if(command==='fetch')await output(w.import(await fetchProvider({kind:options.kind||'wqp',stationId:options.station,huc:options.huc,from:options.from,to:options.to,characteristic:options.characteristic,label:options.label})));
    else if(command==='collection-preview'||command==='collection-receive'){const manifest=JSON.parse(await readText(options.manifest));const received=collectionFromFiles(manifest,options['source-root']||path.dirname(path.resolve(options.manifest)));await output(command==='collection-preview'?previewCollection(w,received):receiveCollection(w,received));}
    else if(command==='collections')await output(listCollections(w));
    else if(command==='collection-publish')await output(publishCollection(w,options.id));
    else if(command==='summary')await output(w.summary());
    else if(command==='records')await output(w.records({stationId:options.station,parameter:options.parameter,limit:options.limit,offset:options.offset}));
    else if(command==='export')await output(w.exportRecords());
    else if(command==='calibration'){const x=calibrationExport(w,{stationId:options.station,parameter:options.parameter});await output(options.format==='csv'?calibrationCSV(x):x);}
    else if(command==='portable')await output(w.portable());
    else if(command==='receive')await output(w.receive(JSON.parse(input.text)));
    else if(command==='map'){const reaches=JSON.parse(await fs.readFile(path.join(directory,'reaches.json'),'utf8'));await output(w.mapping(options.station,{reachId:options.reach,reviewer:options.reviewer,reason:options.reason},reaches.map(x=>x.id)));}
    else if(command==='review')await output(w.review(options.id,{state:options.state,reviewer:options.reviewer,reason:options.reason,selectVersion:options['select-version']==='true'}));
    else if(command==='loads')await output(pairedLoads(w,{stationId:options.station,flowStationId:options['flow-station'],parameter:options.parameter,rationale:options.reason,from:options.from,to:options.to}));
    else throw new Error('Unknown command: '+command);
  }finally{w.close();}
}
