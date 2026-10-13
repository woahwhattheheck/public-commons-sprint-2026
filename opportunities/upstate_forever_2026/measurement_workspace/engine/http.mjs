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
      if(method==='GET'&&parts[0]==='exports'&&parts[1]){const row=s.db.prepare('SELECT content FROM exports WHERE id=?').get(parts[1]);if(!row)throw new InputError('Export not found',404);send(response,200,JSON.parse(row.content),'application/json; charset=utf-8','measurement-export.json');return;}
      if(method==='GET'&&parts[0]==='portable'){send(response,200,s.portable(),'application/json; charset=utf-8','upper-savannah-measurements.json');return;}
      if(method==='POST'&&parts[0]==='receive'){send(response,201,s.receive(await readBody(request)));return;}
      send(response,404,{error:'Measurement operation not found'});
    }catch(error){if(response.destroyed)return;send(response,error instanceof InputError?error.status:500,{error:error instanceof InputError?error.message:'Measurement operation failed; details are in the server log.'});if(!(error instanceof InputError))console.error('[measurements]',error);}
  };
  handler.close=()=>store?.close();return handler;
}
