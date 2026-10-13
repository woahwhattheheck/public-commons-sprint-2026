import {observationEditionOperation,observationEditionCSV,observationCalibration} from './observation_editions.mjs';
import {observationEditionHTML} from '../web/observation_editions.mjs';
import {benchmarkOperation,readBenchmark,benchmarkCSV} from './benchmark_workspace.mjs';
import {benchmarkHTML} from './benchmark_reports.mjs';
import {flowStudyBundle,flowLoadBundle} from './flow_bundles.mjs';
import {flowLoadOperation,readFlowLoadResult,flowLoadCSV} from './flow_results.mjs';
import {renderFlowStudy,renderFlowLoads} from './flow_reports.mjs';
import {nativeSourceOperation} from './native_observations.mjs';
import {reconciliationOperation,reconciliationReport,reconciliationCSV} from './source_reconciliation.mjs';
import {sourceReviewHTML} from '../web/source_reconciliation.mjs';
import {intakeOperation} from './intake.mjs';
import {handbackOperation,handbackMember} from './source_handback.mjs';
import {flowOperation,readFlowStudy,flowCSV} from './flow_workspace.mjs';
import {largeOperation} from './large_http.mjs';
import {previewCollection,receiveCollection,listCollections,publishCollection,readEdition,editionMember,editionBundle} from './collections.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {MeasurementWorkspace} from './workspace.mjs';
import {InputError,safeJSON} from './parse.mjs';
import {providerQuery,fetchProvider} from './providers.mjs';
import {calibrationExport,calibrationCSV,pairedLoads} from './calibration.mjs';
const DEFAULT_BASE='/api/measurement-workspace';
const MAX_BODY=Number(process.env.MEASUREMENTS_UPLOAD_BYTES)||128*1024*1024;
async function readBody(request) {
  if(request.body!==undefined)return request.body;
  let size=0;const chunks=[];
  for await(const chunk of request){size+=chunk.length;if(size>MAX_BODY)throw new InputError('Upload exceeds configured process limit',413);chunks.push(chunk);}
  try{return safeJSON(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}catch(e){if(e instanceof InputError)throw e;throw new InputError('Request must be UTF-8 JSON');}
}
async function baseData(directory,name) {
  try{return JSON.parse(await fs.readFile(path.join(directory,name),'utf8'));}catch(e){if(e.code==='ENOENT')return [];throw e;}
}
export function createMeasurementHandler({directory,base=DEFAULT_BASE,fetcher=globalThis.fetch,workspace,reachProvider}={}) {
  let store=workspace;
  const get=()=>store||(store=new MeasurementWorkspace(directory));
  function send(response,status,value,type='application/json; charset=utf-8',filename) {
    response.statusCode=status;response.setHeader('Content-Type',type);response.setHeader('Cache-Control','no-store');response.setHeader('X-Content-Type-Options','nosniff');
    if(filename)response.setHeader('Content-Disposition',`attachment; filename="${filename}"`);
    response.end(type.startsWith('application/json')?JSON.stringify(value):value);
  }
  const handler=async(request,response,next)=>{
    const url=new URL(request.originalUrl||request.url,'http://localhost');
    if(!url.pathname.startsWith(base+'/')&&url.pathname!==base){if(next)return next();send(response,404,{error:'Not found'});return;}
    try{
    if(!['GET','HEAD'].includes(request.method)&&request.headers.origin){
      let origin;try{origin=new URL(request.headers.origin);}catch{throw new InputError('Invalid request origin',403);}
      if(origin.host!==request.headers.host)throw new InputError('Cross-origin writes are not accepted',403);
    }
    const parts=url.pathname.slice(base.length).split('/').filter(Boolean).map(decodeURIComponent),method=request.method,query=Object.fromEntries(url.searchParams);
      const s=get();
      if(parts[0]==='observation-editions'){
        if(method==='GET'&&parts[1]==='editions'&&parts.length===4&&['report.html','observations.csv','report.csv','calibration.json'].includes(parts[3])){
          const edition=await observationEditionOperation(s,'GET',['editions',parts[2]],{},{}),format=parts[3];
          const value=format==='report.html'?observationEditionHTML(edition):format==='calibration.json'?observationCalibration(edition):observationEditionCSV(edition);
          const type=format==='report.html'?'text/html; charset=utf-8':format==='calibration.json'?'application/json; charset=utf-8':'text/csv; charset=utf-8';
          send(response,200,value,type,'observation-edition-'+parts[2].slice(0,12)+'-'+format);return;
        }
        send(response,200,await observationEditionOperation(s,method,parts.slice(1),query,method==='POST'?await readBody(request):{}));return;
      }
      if(parts[0]==='native-observations'){send(response,200,nativeSourceOperation(s,method,parts.slice(1),query));return;}
      if(parts[0]==='benchmarks'){
        if(method==='GET'&&parts[1]==='studies'&&parts.length===4&&['report.html','rows.csv','periods.csv'].includes(parts[3])){
          const study=readBenchmark(s,parts[2]),html=parts[3]==='report.html';
          send(response,200,html?benchmarkHTML(study):benchmarkCSV(study,parts[3].split('.')[0]),html?'text/html; charset=utf-8':'text/csv; charset=utf-8','observed-benchmark-'+study.id.slice(0,12)+'-'+parts[3]);return;
        }
        send(response,200,await benchmarkOperation(s,method,parts.slice(1),method==='POST'?await readBody(request):{}));return;
      }
      if(parts[0]==='intake'){send(response,200,intakeOperation(s,method,parts.slice(1),['POST','PUT'].includes(method)?await readBody(request):{}));return;}
      if(parts[0]==='reconciliation'){
        if(method==='GET'&&parts[1]==='reports'&&parts.length===4&&parts[3]==='report.csv'){
          send(response,200,reconciliationCSV(reconciliationReport(s,parts[2])),'text/csv; charset=utf-8','source-reconciliation.csv');return;
        }
        if(method==='GET'&&parts[1]==='reports'&&parts.length===4&&parts[3]==='report.html'){
          send(response,200,sourceReviewHTML(reconciliationReport(s,parts[2])),'text/html; charset=utf-8','source-reconciliation.html');return;
        }
        send(response,200,reconciliationOperation(s,method,parts.slice(1),query,method==='POST'?await readBody(request):{}));return;
      }
      if(parts[0]==='flow'){
        if(method==='GET'&&parts.length===4&&parts[3]==='bundle'){
          if(parts[1]==='studies'){send(response,200,flowStudyBundle(s,parts[2]));return;}
          if(parts[1]==='load-results'){send(response,200,flowLoadBundle(s,parts[2]));return;}
        }
        if(method==='GET'&&parts[1]==='studies'&&parts.length===4&&parts[3]==='report.html'){send(response,200,renderFlowStudy(readFlowStudy(s,parts[2])),'text/html; charset=utf-8','daily-discharge-study.html');return;}
        if(parts[1]?.startsWith('load-')){
          if(method==='GET'&&parts[1]==='load-results'&&parts.length===4){
            const result=readFlowLoadResult(s,parts[2]),format=parts[3];
            if(format==='report.html'){send(response,200,renderFlowLoads(result),'text/html; charset=utf-8','concentration-discharge.html');return;}
            if(['daily.csv','periods.csv','context.csv','annual.csv'].includes(format)){send(response,200,flowLoadCSV(result,format.split('.')[0]),'text/csv; charset=utf-8',format);return;}
          }
          send(response,200,await flowLoadOperation(s,method,parts.slice(1),method==='POST'?await readBody(request):{}));return;
        }
        if(method==='GET'&&parts[1]==='studies'&&parts.length===4&&['daily.csv','periods.csv','samples.csv'].includes(parts[3])){send(response,200,flowCSV(readFlowStudy(s,parts[2]),parts[3].split('.')[0]),'text/csv; charset=utf-8',parts[3]);return;}
        send(response,200,await flowOperation(s,method,parts.slice(1),method==='POST'?await readBody(request):{}));return;
      }
      if(parts[0]==='large'){send(response,200,await largeOperation(s,method,parts.slice(1),query,['POST','PUT'].includes(method)?await readBody(request):{}));return;}
      if(parts[0]==='handbacks'){
        if(method==='GET'&&parts.length===3&&parts[2]==='files'){
          const member=handbackMember(s,parts[1],query.name);
          response.writeHead(200,{'Content-Type':member.type,'Content-Length':member.data.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Disposition':'attachment; filename="source-return-member"'});
          response.end(member.data);return;
        }
        send(response,200,handbackOperation(s,method,parts.slice(1),query,method==='POST'?await readBody(request):{}));return;
      }
      const reaches=async()=>reachProvider?await reachProvider():await baseData(s.directory,'reaches.json');
      if(parts[0]==='collections'){
        if(method==='GET'&&parts.length===1){send(response,200,{collections:listCollections(s)});return;}
        if(method==='POST'&&parts[1]==='preview'&&parts.length===2){send(response,200,previewCollection(s,await readBody(request)));return;}
        if(method==='POST'&&parts[1]==='receive'&&parts.length===2){send(response,200,receiveCollection(s,await readBody(request)));return;}
        if(method==='POST'&&parts.length===3&&parts[2]==='publish'){send(response,200,publishCollection(s,parts[1]));return;}
        if(method==='GET'&&parts[2]==='editions'&&parts[3]){
          if(parts.length===5&&parts[4]==='bundle'){send(response,200,editionBundle(s,parts[1],parts[3]));return;}
          if(parts.length===4){send(response,200,readEdition(s,parts[1],parts[3]));return;}
          const member=editionMember(s,parts[1],parts[3],parts.slice(4).join('/'));
          response.writeHead(200,{'Content-Type':member.type,'Content-Length':member.data.length,'X-Content-Type-Options':'nosniff'});response.end(member.data);return;
        }
      }
      if(method==='GET'&&!parts.length){send(response,200,{...s.summary(),reaches:await reaches()});return;}
      if(method==='GET'&&parts.length===1&&parts[0]==='snapshot'){send(response,200,s.fullSnapshot(query));return;}
      if(method==='GET'&&parts[0]==='records'){send(response,200,parts[1]?s.record(parts[1]):s.records(query));return;}
      if(method==='POST'&&parts[0]==='preview'){send(response,200,s.preview(await readBody(request)));return;}
      if(method==='POST'&&parts[0]==='imports'){send(response,201,s.import(await readBody(request)));return;}
      if(method==='GET'&&parts[0]==='sources'&&parts[1]){
        const source=s.source(parts[1]);
        if(parts[2]==='original')send(response,200,source.content,source.kind==='usgs-daily'?'application/geo+json; charset=utf-8':'text/csv; charset=utf-8',`source-${source.id.slice(0,12)}.${source.kind==='usgs-daily'?'geojson':'csv'}`);
        else if(parts[2]==='rejected')send(response,200,JSON.parse(source.rejected),'application/json; charset=utf-8',`source-${source.id.slice(0,12)}-rejected.json`);
        else send(response,200,{...source,content:undefined,mapping:JSON.parse(source.mapping),summary:JSON.parse(source.summary),rejected:JSON.parse(source.rejected),origin:JSON.parse(source.origin)});
        return;
      }
      if(method==='POST'&&parts[0]==='provider-query'){send(response,200,providerQuery(await readBody(request)));return;}
      if(method==='POST'&&parts[0]==='provider-fetch'){
        const input=await readBody(request),controller=new AbortController();
        const abort=()=>{if(!response.writableEnded)controller.abort();};response.once('close',abort);
        try{const source=await fetchProvider(input,{fetcher,signal:controller.signal});send(response,200,{source,preview:s.preview(source)});}finally{response.removeListener('close',abort);}return;
      }
      if(method==='PUT'&&parts[0]==='stations'&&parts[2]==='mapping'){
        const reachRows=await reaches(),input=await readBody(request),selected=reachRows.find(r=>r.id===input.reachId);input.domainSourceReference=selected?.sourceSha256?{sourceSha256:selected.sourceSha256,sourcePath:selected.source_path}:null;send(response,200,s.mapping(parts[1],input,reachRows.map(r=>r.id)));return;
      }
      if(method==='PUT'&&parts[0]==='records'&&parts[2]==='review'){send(response,200,s.review(parts[1],await readBody(request)));return;}
      if(method==='GET'&&parts[0]==='export.csv'){send(response,200,s.exportRecords(query),'text/csv; charset=utf-8','measurements.csv');return;}
      if(method==='POST'&&parts[0]==='calibration'){
        const input=await readBody(request),value=calibrationExport(s,input.filters||{});
        if(input.format==='csv')send(response,200,calibrationCSV(value),'text/csv; charset=utf-8','calibration-input.csv');else send(response,200,value);return;
      }
      if(method==='POST'&&parts[0]==='paired-loads'){send(response,200,pairedLoads(s,await readBody(request)));return;}
      if(method==='GET'&&parts[0]==='exports'&&parts.length===1){
        const offset=Number(query.offset??0),limit=Number(query.limit??20);
        if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>100)throw new InputError('Choose a nonnegative offset and a result page size from 1 to 100.');
        const value=s.readConsistent(()=>({total:s.db.prepare('SELECT COUNT(*) n FROM exports').get().n,offset,limit,
          rows:s.db.prepare('SELECT id,kind,created_at AS createdAt,revision AS workspaceRevision FROM exports ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?').all(limit,offset)}));
        send(response,200,value);return;
      }
      if(method==='GET'&&parts[0]==='exports'&&parts[1]){const row=s.db.prepare('SELECT content FROM exports WHERE id=?').get(parts[1]);if(!row)throw new InputError('Export not found',404);send(response,200,JSON.parse(row.content),'application/json; charset=utf-8','measurement-export.json');return;}
      if(method==='GET'&&parts[0]==='portable'){send(response,200,s.portable(),'application/json; charset=utf-8','upper-savannah-measurements.json');return;}
      if(method==='POST'&&parts[0]==='receive'){send(response,201,s.receive(await readBody(request)));return;}
      send(response,404,{error:'Measurement operation not found'});
    }catch(error){if(response.destroyed)return;send(response,error instanceof InputError?error.status:500,{error:error instanceof InputError?error.message:'Measurement operation failed; details are in the server log.'});if(!(error instanceof InputError))console.error('[measurements]',error);}
  };
  handler.close=()=>store?.close();return handler;
}
