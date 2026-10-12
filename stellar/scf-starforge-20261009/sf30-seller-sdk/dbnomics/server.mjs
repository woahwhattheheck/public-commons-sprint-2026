// MIT. Private industrial console on the maintained dataset publisher HTTP host.
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {startPostgresPublisherServer} from '../postgres/publisher/server.mjs';
import {need,isRecord,jsonBytes,MAX_CAPTURE_BYTES} from './model.mjs';
import {sealDbnomicsCapture} from './provider.mjs';
import {importDbnomicsInput} from './source.mjs';
import {prepareDbnomicsRelease,stageDbnomicsRelease,activateDbnomicsRelease} from './release.mjs';
const PREFIX='/api/dbnomics/';
async function body(req){
  need(/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']??''),'Send application/json.','DBNOMICS_JSON_REQUIRED',415);
  const chunks=[];let size=0;
  for await(const chunk of req){size+=chunk.length;need(size<=MAX_CAPTURE_BYTES*2,'The complete browser input exceeds its capacity.','DBNOMICS_REQUEST_TOO_LARGE',413);chunks.push(chunk);}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}
  catch{need(false,'The request is not complete JSON.','DBNOMICS_JSON_INVALID');}
}
const number=(url,name)=>url.searchParams.has(name)?Number(url.searchParams.get(name)):undefined;
const options=url=>({offset:number(url,'offset'),limit:number(url,'limit')});
function download(res,filename){res.setHeader('content-disposition','attachment; filename="'+filename.replace(/["\r\n\\]/g,'_')+'"');}
export async function startDbnomicsServer({workbench,port=8459}={}){
  need(workbench&&typeof workbench.capture==='function','Open the original DBnomics workbench.');
  const assets=await Promise.all([['/dbnomics.mjs','./public/dbnomics.mjs','text/javascript; charset=utf-8'],
    ['/dbnomics.css','./public/dbnomics.css','text/css; charset=utf-8']].map(async([path,file,type])=>({path,type,bytes:await readFile(new URL(file,import.meta.url))})));
  return startPostgresPublisherServer({publisher:workbench.publisher,port,extension:{assets,
    head:'<link rel="stylesheet" href="/dbnomics.css"><script type="module" src="/dbnomics.mjs"></script>',
    async handle({req,res,url,send}){
      if(!url.pathname.startsWith(PREFIX))return false;
      const route=url.pathname.slice(PREFIX.length),id=url.searchParams.get('id');
      try{
        if(req.method==='GET'){
          if(route==='status'){send(200,await workbench.status());return true;}
          if(route==='operation'){send(200,await workbench.operation(id));return true;}
          if(route==='capture'){
            const c=await workbench.capture(id),m=c.model;
            send(200,{captureId:id,captureSha256:c.captureSha256,selection:c.capture.selection,sourceMode:c.capture.sourceMode,terms:c.capture.terms,
              receipts:m.receipts,retrievedAt:m.retrievedAt,retrievalWindow:m.retrievalWindow,series:m.series,metadata:m.metadata,rowCount:m.rowCount,missing:m.missing});return true;
          }
          if(route==='observations'){send(200,await workbench.observations(id,{...options(url),seriesId:url.searchParams.get('seriesId')??undefined,search:url.searchParams.get('search')??undefined}));return true;}
          if(route==='facets'){send(200,await workbench.facets(id,{field:url.searchParams.get('field')??undefined,limit:number(url,'limit')}));return true;}
          if(route==='compare'){send(200,await workbench.compare(url.searchParams.get('before'),url.searchParams.get('after'),options(url)));return true;}
          if(route==='notes'){send(200,await workbench.notes(id,number(url,'revision')??null));return true;}
          if(route==='report'){
            const result=await workbench.report(id),offset=number(url,'offset')??0,limit=number(url,'limit')??100;
            need(Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(limit)&&limit>0&&limit<=5000,'Choose a report page of 1–5,000 original rows.');
            send(200,{...result,rows:result.rows.slice(offset,offset+limit),page:{offset,limit,total:result.rows.length,returned:Math.min(limit,Math.max(0,result.rows.length-offset)),next:offset+limit<result.rows.length?offset+limit:null}});return true;
          }
          if(route==='report-export'){
            const result=await workbench.exportReport(id,url.searchParams.get('format')??'json');download(res,result.filename);
            send(200,await readFile(result.path),result.mediaType);return true;
          }
          if(route==='source-export'){download(res,'dbnomics-source-handover.json');send(200,jsonBytes(await workbench.exportSources()));return true;}
          if(route==='capture-export'){const c=await workbench.capture(id);download(res,'dbnomics-capture-'+id+'.json');send(200,c.captureBytes);return true;}
          if(route==='original'){
            const c=await workbench.capture(id),index=number(url,'index')??0;need(Number.isSafeInteger(index)&&index>=0&&index<c.capture.responses.length,'Choose an original response index.');
            download(res,'dbnomics-source-'+id+'-'+index+'.json');send(200,Buffer.from(c.capture.responses[index].contentBase64,'base64'));return true;
          }
          need(false,'This DBnomics read route does not exist.','DBNOMICS_NOT_FOUND',404);
        }
        need(req.method==='POST','Use the supported read or write operation.','DBNOMICS_NOT_FOUND',404);
        const input=await body(req);
        if(route==='discover')send(200,await workbench.discover(input));
        else if(route==='acquire')send(200,await workbench.acquire(input));
        else if(route==='refresh')send(200,await workbench.refresh(input));
        else if(route==='seed'){
          const capture=await importDbnomicsInput(fileURLToPath(new URL('./examples/insee-ipc.import.json',import.meta.url)));
          send(200,await workbench.importCapture({id:input.id,capture}));
        }
        else if(route==='import'){
          let capture=input.capture;
          if(!capture){
            need(isRecord(input.manifest)&&isRecord(input.files),'Select the import manifest and every complete original response file.');
            const manifest=input.manifest;need(manifest.schema==='stellar-forge.dbnomics-response-import.v1'&&Array.isArray(manifest.responses),'Use an original response-import manifest.');
            capture=sealDbnomicsCapture({selection:manifest.selection,rights:manifest.rights,sourceMode:manifest.sourceMode,
              responses:manifest.responses.map(row=>{need(typeof input.files[row.file]==='string','A complete original response is missing: '+row.file);return {receipt:row.receipt,bytes:Buffer.from(input.files[row.file],'utf8')};})});
          }
          send(200,await workbench.importCapture({id:input.id,capture}));
        }
        else if(route==='source-import')send(200,await workbench.importSources(input));
        else if(route==='notes')send(200,await workbench.saveNotes(input));
        else if(route==='report')send(200,await workbench.saveReport(input));
        else if(route==='query')send(200,await workbench.saveQuery(input));
        else if(route==='plan-template')send(200,await workbench.planTemplate(input.name));
        else if(route==='publication-plan')send(200,await workbench.savePublicationPlan(input));
        else if(route==='extract')send(202,workbench.startPublication(input));
        else if(route==='release-prepare')send(200,await prepareDbnomicsRelease({...input,publisher:workbench.publisher}));
        else if(route==='release-stage')send(200,await stageDbnomicsRelease(input));
        else if(route==='release-activate')send(200,await activateDbnomicsRelease(input.releaseDirectory,input.id,input.options));
        else need(false,'This DBnomics write route does not exist.','DBNOMICS_NOT_FOUND',404);
      }catch(error){
        if(!res.headersSent)send([400,403,404,409,413,415,422,429,500,502,503].includes(error.status)?error.status:422,
          {error:error.code??'DBNOMICS_OPERATION_FAILED',message:String(error.message??error),providerStatus:error.providerStatus??null,retryAt:error.retryAt??null});
        else if(!res.writableEnded)res.end();
      }
      return true;
    }}});
}
