#!/usr/bin/env node
import {intakeOperation,compareIntakePreparations,reopenIntakeComparison} from './intake.mjs';
import {intakeComparisonHTML} from '../web/intake_comparison.mjs';
import {flowComparisonOperation} from './flow_comparison.mjs';
import {hash} from './normalise.mjs';
import {sedimentOperation,readSedimentStudy} from './sediment_workspace.mjs';
import {sedimentHTML,sedimentCSV} from './sediment_reports.mjs';
import {observationEditionOperation,observationEditionCSV,observationCalibration} from './observation_editions.mjs';
import {observationEditionHTML} from '../web/observation_editions.mjs';
import {benchmarkOperation,readBenchmark,benchmarkCSV} from './benchmark_workspace.mjs';
import {benchmarkHTML} from './benchmark_reports.mjs';
import {runReconciliationCLI} from './reconciliation_cli.mjs';
import {publishExactFile} from './file_product.mjs';
import {flowStudyBundle,flowLoadBundle} from './flow_bundles.mjs';
import {flowLoadOperation,readFlowLoadResult,flowLoadCSV} from './flow_results.mjs';
import {renderFlowStudy,renderFlowLoads} from './flow_reports.mjs';
import {flowOperation,readFlowStudy,flowCSV} from './flow_workspace.mjs';
import {runSourceHandbackCLI} from './source_handback_cli.mjs';
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
import {resultSourceSelection} from './result_handback.mjs';
const [command='help',...args]=process.argv.slice(2), options={};
for(let i=0;i<args.length;i++){if(!args[i].startsWith('--')||args[i+1]===undefined)throw new Error('Options require --name value pairs');options[args[i].slice(2)]=args[++i];}
const directory=path.resolve(options.workspace||process.env.DATA_DIR||'./data');
const readText=async file=>new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await fs.readFile(file));
const output=async value=>{const text=typeof value==='string'?value:JSON.stringify(value,null,2)+'\n';if(options.output)await fs.writeFile(options.output,text);else process.stdout.write(text);};
if(command.startsWith('source-handback-'))await runSourceHandbackCLI(command.slice(16),options,directory);
else if(command.startsWith('large-'))await runLargeCLI(command.slice(6),options,directory);
else if(command==='help')console.log(`Measurements workspace, Node >=22.16\n\nintake-comparison-history --workspace ORIGINAL --id PREPARATION --output history.json\nintake-compare --workspace ORIGINAL --id PREPARATION --file exact-selection.json --format json|html --output comparison.json\nintake-comparison-reopen --workspace ORIGINAL --file complete-comparison.json --format json|html --output reopened.json\n\nsediment-catalogue|sediment-project --workspace ./data --output complete.json\n sediment-observations|sediment-pairs-preview|sediment-deployment-preview|sediment-preview|sediment-save|sediment-drafts|sediment-receive|sediment-abandon --workspace ./data --file exact-input.json --output result.json\n sediment-read|sediment-draft|sediment-request|sediment-report|sediment-pairs|sediment-residuals|sediment-predictions|sediment-coefficients --workspace ./data --id ORIGINAL_ID --output result.json\n\nobservation-edition-catalogue|observation-edition-list --workspace ./data\nobservation-edition-inspect|observation-edition-preview|observation-edition-save --workspace ./data --file selection.json\nobservation-edition-read|observation-edition-report|observation-edition-csv|observation-edition-calibration --workspace ./data --id EDITION_ID --output result.json\n\nbenchmark-catalogue|benchmark-project --workspace ./data --output complete.json\nbenchmark-preview|benchmark-save|benchmark-drafts|benchmark-receive|benchmark-abandon --workspace ./data --file exact-request.json --output result.json\nbenchmark-read|benchmark-request|benchmark-draft|benchmark-report|benchmark-rows|benchmark-periods --workspace ./data --id ORIGINAL_ID --output result.json\n\nreconciliation-catalogue|reconciliation-reports --workspace ./data\nreconciliation-groups --workspace ./data --file scope.json\nreconciliation-group --workspace ./data --id LOGICAL_KEY\nreconciliation-decide|reconciliation-save-report --workspace ./data --file reviewed-input.json\nreconciliation-report --workspace ./data --id REPORT_ID --format json|csv|html --output report.json\n\nflow-comparison-report|flow-comparison-csv|flow-comparison-bundle --workspace ./data --file comparison-selection.json --output complete-file\nflow-catalogue --workspace ./data\nflow-inspect|flow-preview|flow-save|flow-receive|flow-compare --workspace ./data --file input.json\nflow-load-preview|flow-load-save --workspace ./data --file load-selection.json\nflow-load-catalogue --workspace ./data\nflow-load-read|flow-load-report|flow-load-periods --workspace ./data --id ID --output result.json\nflow-bundle|flow-load-bundle --workspace ./data --id ID --output complete.zip\nflow-report --workspace ./data --id ID --output report.html\nflow-read|flow-daily|flow-periods|flow-samples --workspace ./data --id ID --output result.json\n\nsource-handback-list --workspace ./data\nsource-handback-preview|source-handback-publish --workspace ./data --selection selection.json --output result.json\nsource-handback-inspect --workspace ./data --id RETURN_SHA\nsource-handback-bundle --workspace ./data --id RETURN_SHA --output returned.zip\nsource-handback-receive --workspace ./data --file returned.zip\n\nlarge-prepare|large-import --workspace ./data --file original.csv --kind wqp --label Source\nlarge-commit --workspace ./data --intake ID\nlarge-status --workspace ./data\nlarge-export --workspace ./data --output ./complete-edition\nlarge-receive --workspace ./empty-data --file complete-edition/project.zip\n\ncollection-preview|collection-receive --workspace ./data --manifest collection.json --source-root ./originals\ncollection-publish --workspace ./data --id COLLECTION_SHA\ncollections --workspace ./data\nserve --workspace ./data --port 3101\npreview|import --workspace ./data --kind wqp|stations|usgs-daily --file input.csv --label Source\nfetch --workspace ./data --kind wqp|stations|usgs-daily --station USGS-... --from YYYY-MM-DD --to YYYY-MM-DD\nsummary|records|calibration|export|portable --workspace ./data --output result.json\nresult-source-selection --workspace ./data --id ORIGINAL_EXPORT_ID --output selection.json\nreceive --workspace ./empty-data --file complete-workspace.json\nmap --workspace ./data --station ORG-ID --reach r1 --reviewer Name --reason Rationale\nreview --workspace ./data --id HASH --state include|exclude|pending --reviewer Name --reason Rationale\nloads --workspace ./data --station ORG-ID --flow-station USGS-ID --parameter tn|tp --reason Rationale\n\nThe server also exposes the original-app integration API /api/measurement-workspace.\n`);
else if(command==='serve'){
  const handler=createMeasurementHandler({directory}),publicDir=fileURLToPath(new URL('../web/',import.meta.url));
  const token=process.env.MEASUREMENTS_INTERNAL_TOKEN;
  const server=http.createServer(async(req,res)=>{
    if(token&&req.headers['x-measurement-internal-token']!==token){res.statusCode=403;res.end('Forbidden');return;}
    if(req.headers.origin){try{if(new URL(req.headers.origin).host!==req.headers.host){res.statusCode=403;res.end('Cross-origin request rejected');return;}}catch{res.statusCode=403;res.end('Invalid origin');return;}}
    if(req.url.startsWith('/api/measurement-workspace'))return handler(req,res);
    const name=new URL(req.url,'http://localhost').pathname;
    if(name==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Upper Savannah · Measured data</title><body style="margin:0"><section id="large-files"></section><section id="collections"></section><main id="measurements"></main><script type="module">import{mountLargeFilePanel}from'/measurements/large_files.mjs';import{mountMeasurements}from'/measurements/workspace.js';import{mountCollectionPanel}from'/measurements/collections.mjs';const desk=mountMeasurements(document.getElementById('measurements'));mountLargeFilePanel(document.getElementById('large-files'),{refresh:()=>desk.refresh()});mountCollectionPanel(document.getElementById('collections'),{request:(path,method='GET',payload)=>fetch('/api/measurement-workspace'+path,{method,headers:{'Content-Type':'application/json'},body:payload===undefined?undefined:JSON.stringify(payload)}),refresh:()=>desk.refresh()});</script></body></html>`);}
    const files={'/measurements/intake_comparison.mjs':['intake_comparison.mjs','text/javascript'],'/measurements/result_handback.mjs':['result_handback.mjs','text/javascript'],'/measurements/sediment.mjs':['sediment.mjs','text/javascript'],'/measurements/observation_editions.mjs':['observation_editions.mjs','text/javascript'],'/measurements/observation_editions.css':['observation_editions.css','text/css'],'/measurements/benchmarks.mjs':['benchmarks.mjs','text/javascript'],'/measurements/source_handback.mjs':['source_handback.mjs','text/javascript'],'/measurements/source_handback.css':['source_handback.css','text/css'],'/measurements/flow_loads_ui.mjs':['flow_loads_ui.mjs','text/javascript'],'/measurements/intake.mjs':['intake.mjs','text/javascript'],'/measurements/source_reconciliation.mjs':['source_reconciliation.mjs','text/javascript'],'/measurements/source_reconciliation.css':['source_reconciliation.css','text/css'],'/measurements/results.mjs':['results.mjs','text/javascript'],'/measurements/flow_editions.mjs':['flow_editions.mjs','text/javascript'],'/measurements/flow_editions.css':['flow_editions.css','text/css'],'/measurements/large_files.mjs':['large_files.mjs','text/javascript'],'/measurements/workspace.js':['workspace.js','text/javascript'],'/measurements/workspace.css':['workspace.css','text/css'],'/measurements/collections.mjs':['collections.mjs','text/javascript']};
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
    if(command==='intake-comparison-history')await output(intakeOperation(w,'GET',[options.id,'comparison-history']));
    else if(command==='intake-compare'||command==='intake-comparison-reopen'){
      const body=input?JSON.parse(input.text):null;
      if(!body)throw Error('Select the complete original JSON input.');
      const report=command==='intake-compare'?compareIntakePreparations(w,options.id,body):reopenIntakeComparison(body);
      await output(options.format==='html'?intakeComparisonHTML(report):report);
    }
    else if(command.startsWith('sediment-')){
      const op=command.slice(9),body=input?JSON.parse(input.text):{};
      if(['report','pairs','residuals','predictions','coefficients'].includes(op)){const study=readSedimentStudy(w,options.id);await output(op==='report'?sedimentHTML(study):sedimentCSV(study,op));}
      else if(['read','request','draft'].includes(op))await output(sedimentOperation(w,'GET',[{read:'studies',request:'requests',draft:'drafts'}[op],options.id]));
      else await output(sedimentOperation(w,['catalogue','project'].includes(op)?'GET':'POST',[op],body));
    }
    else if(command.startsWith('observation-edition-')){
      const op=command.slice('observation-edition-'.length),body=input?JSON.parse(input.text):{};
      if(['read','report','csv','calibration'].includes(op)){
        if(!options.id)throw Error('Select the original observation edition with --id.');
        const edition=await observationEditionOperation(w,'GET',['editions',options.id],{},{});
        await output(op==='read'?edition:op==='report'?observationEditionHTML(edition):op==='csv'?observationEditionCSV(edition):observationCalibration(edition));
      }else if(op==='catalogue'||op==='list')await output(await observationEditionOperation(w,'GET',op==='list'?['editions']:[],{},{}));
      else if(['inspect','preview','save'].includes(op)){
        if(!input)throw Error('Supply the complete reviewed selection with --file.');
        await output(await observationEditionOperation(w,'POST',[op==='save'?'editions':op],{},body));
      }else throw Error('Unknown observation edition operation: '+op);
    }
    else if(command.startsWith('benchmark-')){
      const op=command.slice(10),body=input?JSON.parse(input.text):{};
      if(['report','rows','periods'].includes(op)){const study=readBenchmark(w,options.id);await output(op==='report'?benchmarkHTML(study):benchmarkCSV(study,op));}
      else if(['read','request','draft'].includes(op))await output(await benchmarkOperation(w,'GET',[{read:'studies',request:'requests',draft:'drafts'}[op],options.id]));
      else await output(await benchmarkOperation(w,['catalogue','project'].includes(op)?'GET':'POST',[op],body));
    }
    else if(command.startsWith('reconciliation-'))await runReconciliationCLI(command.slice('reconciliation-'.length),options,w,{readText,output});
    else if(command.startsWith('flow-')){
      const op=command.slice(5);
      if(['comparison-report','comparison-bundle','comparison-csv'].includes(op)){
        if(!input)throw Error('Supply the complete original comparison selection with --file.');
        if(op==='comparison-bundle'&&!options.output)throw Error('A complete comparison ZIP requires --output FILE.zip.');
        const product=flowComparisonOperation(w,'POST',[op],JSON.parse(input.text));
        if(options.output){
          const body=op==='comparison-bundle'?Buffer.from(product.base64,'base64'):Buffer.from(product.content);
          await publishExactFile(options.output,body);
          process.stdout.write(JSON.stringify({output:options.output,name:product.name,bytes:body.length,sha256:hash(body),comparison_id:product.comparison_id,before_id:product.before_id,after_id:product.after_id})+'\n');
        }else await output(product.content);
      }
      else if(op==='bundle'||op==='load-bundle'){
        if(!options.output)throw Error('A complete ZIP requires --output FILE.zip');
        const bundle=op==='bundle'?flowStudyBundle(w,options.id):flowLoadBundle(w,options.id);
        await publishExactFile(options.output,Buffer.from(bundle.base64,'base64'));
        process.stdout.write(JSON.stringify({output:options.output,name:bundle.name,bytes:bundle.bytes,sha256:bundle.sha256})+'\n');
      }
      else if(op==='report')await output(renderFlowStudy(readFlowStudy(w,options.id)));
      else if(op==='load-report')await output(renderFlowLoads(readFlowLoadResult(w,options.id)));
      else if(op==='load-read')await output(readFlowLoadResult(w,options.id));
      else if(['load-daily','load-periods','load-context','load-annual'].includes(op))await output(flowLoadCSV(readFlowLoadResult(w,options.id),op.slice(5)));
      else if(op.startsWith('load-'))await output(await flowLoadOperation(w,op==='load-catalogue'?'GET':'POST',[op],input?JSON.parse(input.text):{}));
      else if(op==='read')await output(readFlowStudy(w,options.id));
      else if(['daily','periods','samples'].includes(op))await output(flowCSV(readFlowStudy(w,options.id),op));
      else await output(await flowOperation(w,op==='catalogue'?'GET':'POST',[op],input?JSON.parse(input.text):{}));
    }
    else if(command==='preview')await output(w.preview(input));
    else if(command==='import')await output(w.import(input));
    else if(command==='fetch')await output(w.import(await fetchProvider({kind:options.kind||'wqp',stationId:options.station,huc:options.huc,from:options.from,to:options.to,characteristic:options.characteristic,label:options.label})));
    else if(command==='collection-preview'||command==='collection-receive'){const manifest=JSON.parse(await readText(options.manifest));const received=collectionFromFiles(manifest,options['source-root']||path.dirname(path.resolve(options.manifest)));await output(command==='collection-preview'?previewCollection(w,received):receiveCollection(w,received));}
    else if(command==='collections')await output(listCollections(w));
    else if(command==='collection-publish')await output(publishCollection(w,options.id));
    else if(command==='result-source-selection')await output(resultSourceSelection(w,options.id));
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
