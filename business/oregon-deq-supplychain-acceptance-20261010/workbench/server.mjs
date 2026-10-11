// MIT. Local retained operator for vendor-authorized material-trace exports.
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {readFile,writeFile,mkdir,mkdtemp,open,rename,readdir,unlink,stat,link,rm} from 'node:fs/promises';
import {randomBytes,randomUUID,createHash,timingSafeEqual} from 'node:crypto';
import {parseTable,suggestedMapping,FIELDS,ENUMS,readMapped,stable,clone,plain,instant} from './table.mjs';
import {createProject,applyCommand,deriveProject} from './model.mjs';
import {exportBundle,exportWorkbook,exportTables,readBundle} from './export.mjs';
import {csv} from './table.mjs';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const identifier=value=>typeof value==='string' && /^[A-Za-z0-9._-]{1,100}$/.test(value);
const fail=(message,status=400)=>{const e=new Error(message);e.status=status;throw e;};
const utf8=bytes=>new TextDecoder('utf-8',{fatal:true}).decode(bytes);
async function durableFile(filename,bytes,{exclusive=false}={}) {
  const handle=await open(filename,exclusive?'wx':'w',0o600);
  try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
}
async function atomicJSON(filename,value) {
  const temporary=filename+'.'+randomUUID()+'.tmp';
  await durableFile(temporary,JSON.stringify(value));
  await rename(temporary,filename);
  const parent=await open(path.dirname(filename),'r');
  try{await parent.sync();}finally{await parent.close();}
}
function validateState(state) {
  if(!plain(state) || state.schema!=='oregon-deq.trace-workbench.v1' || !identifier(state.id) ||
     !Number.isSafeInteger(state.revision) || state.revision<0 || !Number.isSafeInteger(state.dataRevision) || state.dataRevision<0 ||
     !Array.isArray(state.imports) || state.imports.length>100 || !plain(state.reviews)) fail('Invalid retained workspace');
  let checked=createProject({id:state.id,title:state.title,asOf:state.asOf});
  checked=applyCommand(checked,{type:'options',title:state.title,asOf:state.asOf,maxAgeDays:state.maxAgeDays},{actor:'restore'});
  for(const item of state.imports) {
    if(!plain(item) || !identifier(item.id) || typeof item.fileName!=='string' || item.fileName.length>512 ||
       !['csv','tsv','json'].includes(item.format) || !Array.isArray(item.columns) || item.columns.length>256 ||
       item.columns.some(c=>typeof c!=='string'||!c||c.length>256) || new Set(item.columns).size!==item.columns.length ||
       (item.part && !['products','nodes','links','risks'].includes(item.part))) fail('Invalid source metadata');
    checked=applyCommand(checked,{type:'import',item},{actor:'restore'});
    checked=applyCommand(checked,{type:'mapping',importId:item.id,mapping:item.mapping,valueMaps:item.valueMaps},{actor:'restore'});
    for(const [row,values] of Object.entries(item.corrections || {})) {
      const note=item.correctionNotes?.[row];
      checked=applyCommand(checked,{type:'correct',importId:item.id,row:Number(row),values,reason:note?.reason},{actor:note?.actor || 'restore',now:note?.at});
    }
    for(const [row,note] of Object.entries(item.excluded || {}))
      checked=applyCommand(checked,{type:'exclude',importId:item.id,row:Number(row),excluded:true,reason:note.reason},{actor:note.actor,now:note.at});
    if(!item.enabled) checked=applyCommand(checked,{type:'enable',importId:item.id,enabled:false,reason:item.enabledNote?.reason},{actor:item.enabledNote?.actor || 'restore',now:item.enabledNote?.at});
  }
  for(const [issueKey,review] of Object.entries(state.reviews))
    applyCommand(checked,{type:'review',issueKey,status:review.status,note:review.note},{actor:review.actor,now:review.at});
  return clone(state);
}
function parseSource(bytes,item) {
  const text=utf8(bytes);
  if(!item.part) return parseTable(text,item.format);
  const graph=JSON.parse(text);
  if(graph?.schema!=='oregon-deq.trace-evidence.v1' || !Array.isArray(graph[item.part])) fail('Original graph source is missing its retained section');
  return parseTable(JSON.stringify(graph[item.part]),'json');
}
function safeName(name) {return String(name).replace(/[\r\n"\\]/g,'_').slice(0,120);}
function responseJSON(res,value,status=200) {res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));}
async function body(req) {
  const chunks=[];let total=0;
  for await(const chunk of req) {total+=chunk.length;if(total>24*1024*1024) fail('Request exceeds 24 MiB',413);chunks.push(chunk);}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail('Request body must be JSON');}
}
async function contentBytes(request) {
  if(typeof request.contentBase64!=='string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(request.contentBase64)) fail('Invalid source encoding');
  const bytes=Buffer.from(request.contentBase64,'base64');
  if(!bytes.length || bytes.length>16*1024*1024) fail('Source must contain 1 byte to 16 MiB');
  utf8(bytes);return bytes;
}
export async function createWorkbench({directory,port=0,hostname='127.0.0.1'}={}) {
  if(!directory || hostname!=='127.0.0.1') fail('Choose a private data directory; the operator binds to 127.0.0.1');
  const root=path.resolve(directory),sourcesDir=path.join(root,'sources'),versionsDir=path.join(root,'versions'),operationsDir=path.join(root,'operations');
  for(const dir of [root,sourcesDir,versionsDir,operationsDir]) await mkdir(dir,{recursive:true,mode:0o700});
  const lockPath=path.join(root,'operator.lock'),lockId=randomUUID();
  try{await durableFile(lockPath,JSON.stringify({id:lockId,pid:process.pid,hostname:os.hostname(),startedAt:new Date().toISOString()}),{exclusive:true});}
  catch(e){if(e.code==='EEXIST') fail('This workspace already has an operator lock. Close its original operator or use the documented lock recovery command.',409);throw e;}
  let server,queue=Promise.resolve(),closing=false,current,cache=null,accessKey;
  const serial=fn=>{const task=queue.then(fn);queue=task.catch(()=>{});return task;};
  const pointer=path.join(root,'current.json');
  const release=async()=>{try{const value=JSON.parse(await readFile(lockPath,'utf8'));if(value.id===lockId) await unlink(lockPath);}catch(e){if(e.code!=='ENOENT')throw e;}};
  try {
    const accessFile=path.join(root,'operator-access.json');
    try{const key=JSON.parse(await readFile(accessFile,'utf8'));accessKey=key.accessKey;if(!/^[a-f0-9]{64}$/.test(accessKey)) fail('Invalid operator access file');}
    catch(e){if(e.code!=='ENOENT')throw e;accessKey=randomBytes(32).toString('hex');await durableFile(accessFile,JSON.stringify({accessKey}),{exclusive:true});}
    try {
      const head=JSON.parse(await readFile(pointer,'utf8'));
      if(!Number.isSafeInteger(head.revision)||head.revision<0) fail('Invalid workspace head');
      const version=JSON.parse(await readFile(path.join(versionsDir,head.revision+'.json'),'utf8'));
      current=validateState(version.state);
    } catch(e) {
      if(e.code!=='ENOENT')throw e;
      const retainedVersions=(await readdir(versionsDir)).filter(name=>/^\d+\.json$/.test(name));
      if(retainedVersions.length===1) {
        const existing=JSON.parse(await readFile(path.join(versionsDir,retainedVersions[0]),'utf8'));
        if(existing.command?.type!=='create' && existing.command?.type!=='restore-bundle') fail('Workspace head is missing; inspect retained versions before recovery',409);
        current=validateState(existing.state);await loadTables(current);
      } else if(retainedVersions.length) fail('Workspace head is missing; preserve and inspect its retained versions',409);
      else {current=createProject({id:randomUUID()});await atomicJSON(path.join(versionsDir,'0.json'),{state:current,operationId:null,command:{type:'create'}});}
      await atomicJSON(pointer,{revision:current.revision});
    }
    async function loadTables(state) {
      const tables=new Map(),byHash=new Map();
      for(const item of state.imports) {
        let bytes=byHash.get(item.sha256);
        if(!bytes) {bytes=await readFile(path.join(sourcesDir,item.sha256));if(digest(bytes)!==item.sha256) fail('Source bytes changed for '+item.fileName,409);byHash.set(item.sha256,bytes);}
        const table=parseSource(bytes,item);
        if(stable(table.columns)!==stable(item.columns) || table.rows.length!==item.rowCount) fail('Source shape changed for '+item.fileName,409);
        tables.set(item.id,table);
      }
      return tables;
    }
    async function computed() {
      if(cache?.revision===current.revision) return cache;
      const tables=await loadTables(current),report=deriveProject(current,tables);
      cache={revision:current.revision,tables,report};return cache;
    }
    await computed();
    while(true) {
      let prepared;
      try{prepared=JSON.parse(await readFile(path.join(versionsDir,(current.revision+1)+'.json'),'utf8'));}catch(e){if(e.code==='ENOENT')break;throw e;}
      if(prepared.parentRevision!==current.revision || !identifier(prepared.operationId) || !/^[a-f0-9]{64}$/.test(prepared.hash)) fail('Prepared version does not follow the current workspace');
      const recovered=validateState(prepared.state);await loadTables(recovered);
      await atomicJSON(pointer,{revision:recovered.revision});current=recovered;cache=null;
      await atomicJSON(path.join(operationsDir,digest(prepared.operationId)),{hash:prepared.hash,result:{revision:current.revision,operationId:prepared.operationId}});
    }
    async function retainSource(bytes) {
      const sha=digest(bytes),filename=path.join(sourcesDir,sha);
      const temporary=path.join(sourcesDir,'.upload-'+randomUUID());
      try {
        await durableFile(temporary,bytes,{exclusive:true});
        try{await link(temporary,filename);}
        catch(e){if(e.code!=='EEXIST')throw e;if(digest(await readFile(filename))!==sha) fail('Retained source digest mismatch',409);}
        const parent=await open(sourcesDir,'r');try{await parent.sync();}finally{await parent.close();}
      } finally {await unlink(temporary).catch(e=>{if(e.code!=='ENOENT')throw e;});}
      return sha;
    }
    async function commit(request) {
      if(!identifier(request.operationId) || !Number.isSafeInteger(request.expectedRevision) || typeof request.actor!=='string') fail('Operation identity, current revision and reviewer are required');
      const hash=digest(Buffer.from(stable({expectedRevision:request.expectedRevision,actor:request.actor,command:request.command})));
      const receiptPath=path.join(operationsDir,digest(request.operationId));
      let retained=null;
      try{retained=JSON.parse(await readFile(receiptPath,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
      if(retained) {
        if(retained.hash!==hash) fail('Operation ID already belongs to different content',409);
        return {...retained.result,replayed:true,currentRevision:current.revision};
      }
      const candidatePath=path.join(versionsDir,(request.expectedRevision+1)+'.json');
      let candidate=null;
      try{candidate=JSON.parse(await readFile(candidatePath,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
      if(candidate?.operationId===request.operationId) {
        if(candidate.hash!==hash) fail('Retained operation content differs',409);
        if(current.revision===request.expectedRevision) {await atomicJSON(pointer,{revision:candidate.state.revision});current=validateState(candidate.state);cache=null;}
        const result={revision:candidate.state.revision,operationId:request.operationId};
        await atomicJSON(receiptPath,{hash,result});return {...result,replayed:true,currentRevision:current.revision};
      }
      if(request.expectedRevision!==current.revision) fail('Workspace changed. Refresh before applying this edit.',409);
      if(candidate) fail('An earlier durable operation is awaiting recovery. Reopen the workspace.',409);
      const command=request.command;
      if(command?.type==='review') {
        const report=(await computed()).report;
        if(!report.issues.some(issue=>issue.key===command.issueKey)) fail('This finding is no longer present. Refresh the report.',409);
      }
      let next;
      if(command?.type==='upload') {
        if(!Object.hasOwn(FIELDS,command.kind) || typeof command.fileName!=='string' || command.fileName.length>512 || !['csv','tsv','json'].includes(command.format)) fail('Select a table type, file name and format');
        const bytes=await contentBytes(command),table=parseTable(utf8(bytes),command.format),sha256=await retainSource(bytes);
        const item={id:randomUUID(),kind:command.kind,sha256,fileName:command.fileName,format:command.format,columns:table.columns,rowCount:table.rows.length};
        next=applyCommand(current,{type:'import',item},{actor:request.actor});
      } else if(command?.type==='upload-graph') {
        const bytes=await contentBytes(command),graph=JSON.parse(utf8(bytes));
        if(graph?.schema!=='oregon-deq.trace-evidence.v1' || !instant(graph.asOf)) fail('Choose an original trace-evidence.v1 graph');
        const sha256=await retainSource(bytes);next=clone(current);
        for(const kind of ['products','nodes','links','risks']) {
          const table=parseTable(JSON.stringify(graph[kind]),'json');
          const item={id:randomUUID(),kind,sha256,fileName:String(command.fileName).slice(0,512),format:'json',part:kind,columns:table.columns,rowCount:table.rows.length};
          next=applyCommand(next,{type:'import',item},{actor:request.actor});
          next=applyCommand(next,{type:'mapping',importId:item.id,mapping:suggestedMapping(table.columns,kind)},{actor:request.actor});
        }
        if(current.imports.length===0) next.asOf=graph.asOf;
        next.revision=current.revision+1;next.dataRevision=current.dataRevision+1;
      } else next=applyCommand(current,command,{actor:request.actor});
      validateState(next);
      const retainedCommand=['upload','upload-graph'].includes(command?.type)?{type:command.type,fileName:command.fileName,kind:command.kind,sourceSha256:digest(Buffer.from(command.contentBase64,'base64'))}:command;
      const version={state:next,parentRevision:current.revision,operationId:request.operationId,hash,command:retainedCommand,actor:request.actor,at:next.updatedAt};
      await atomicJSON(candidatePath,version);
      await atomicJSON(pointer,{revision:next.revision});current=next;cache=null;
      const result={revision:next.revision,operationId:request.operationId};
      await atomicJSON(receiptPath,{hash,result});return result;
    }
    const assets=new Map([['/','index.html'],['/ui.mjs','ui.mjs'],['/style.css','style.css']]);
    let origin;
    server=http.createServer(async(req,res)=>{
      res.setHeader('Cache-Control','no-store');
      res.setHeader('X-Content-Type-Options','nosniff');
      res.setHeader('Referrer-Policy','no-referrer');
      res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
      try {
        if(closing) fail('Operator is closing',503);
        if(req.headers.host!==new URL(origin).host || (req.headers.origin && req.headers.origin!==origin)) fail('Use the original local operator address',403);
        const url=new URL(req.url,origin);
        if(req.method==='GET' && assets.has(url.pathname)) {
          const file=assets.get(url.pathname),mime=file.endsWith('.mjs')?'text/javascript; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8';
          const bytes=await readFile(path.join(HERE,file));res.writeHead(200,{'Content-Type':mime});res.end(bytes);return;
        }
        const candidate=String(req.headers.authorization || '').replace(/^Bearer /,'');
        const left=Buffer.from(candidate),right=Buffer.from(accessKey);
        if(left.length!==right.length || !timingSafeEqual(left,right)) fail('Enter the operator access key',401);
        if(req.method==='POST' && url.pathname==='/api/command') {
          const request=await body(req);return responseJSON(res,await serial(()=>commit(request)));
        }
        if(req.method!=='GET') fail('Method not supported',405);
        await serial(async()=>{
          if(url.pathname==='/api/history') {
            const names=(await readdir(versionsDir)).filter(n=>/^\d+\.json$/.test(n)).sort((a,b)=>parseInt(b)-parseInt(a));
            const offset=Math.max(0,Math.floor(Number(url.searchParams.get('offset'))||0)),history=[];
            for(const name of names.slice(offset,offset+100)) {const v=JSON.parse(await readFile(path.join(versionsDir,name),'utf8'));history.push({revision:v.state.revision,at:v.at || v.state.updatedAt,actor:v.actor || '',command:v.command,operationId:v.operationId});}
            responseJSON(res,{history,total:names.length,offset,currentRevision:current.revision});return;
          }
          const {tables,report}=await computed();
          if(url.pathname==='/api/view') {
            const issueOffset=Math.max(0,Number(url.searchParams.get('issueOffset'))||0),search=(url.searchParams.get('search')||'').toLowerCase();
            const filtered=report.issues.filter(i=>!search || JSON.stringify(i).toLowerCase().includes(search));
            responseJSON(res,{state:current,fields:FIELDS,enums:ENUMS,report:{summary:report.summary,counts:report.counts,branches:report.branches,products:report.data.products,
              audit:report.audit?{summary:report.audit.summary,decision:report.audit.decision,products:report.audit.products.map(p=>({productId:p.productId,name:p.name,pathStatus:p.pathStatus,acceptance:p.acceptance,sourceToMarketNodes:p.sourceToMarketNodes,sourceToMarketEdges:p.sourceToMarketEdges}))}:null,
              issues:filtered.slice(issueOffset,issueOffset+100),issueTotal:filtered.length,issueOffset,carriedReviews:report.carriedReviews},exports:exportTables({state:current,report}).map(t=>({name:t.name,rows:t.rows.length}))});return;
          }
          if(url.pathname==='/api/trace') {
            const product=report.data.products.find(p=>p.id===url.searchParams.get('productId'));if(!product) fail('Select a product',404);
            const branch=report.branches.find(b=>b.productId===product.id),edges=report.data.links.filter(e=>e.productId===product.id),ids=new Set([...branch.upstreamNodeIds,...edges.flatMap(e=>[e.from,e.to])]);
            const nodes=report.data.nodes.filter(n=>ids.has(n.id)),nodeOffset=Math.max(0,Math.floor(Number(url.searchParams.get('nodeOffset'))||0)),linkOffset=Math.max(0,Math.floor(Number(url.searchParams.get('linkOffset'))||0));
            responseJSON(res,{product,branch,nodes:nodes.slice(nodeOffset,nodeOffset+500),nodeOffset,nodeTotal:nodes.length,
              links:edges.slice(linkOffset,linkOffset+1000),linkOffset,linkTotal:edges.length,revision:current.revision});return;
          }
          if(url.pathname==='/api/rows') {
            const item=current.imports.find(i=>i.id===url.searchParams.get('importId'));
            if(!item) fail('Select an imported source',404);
            const offset=Math.max(0,Number(url.searchParams.get('offset'))||0),query=(url.searchParams.get('search')||'').toLowerCase();
            const table=tables.get(item.id),tracked=new Map(report.rows.filter(r=>r.importId===item.id).map(r=>[r.row,r]));
            const sourceRows=table.rows.filter(r=>!query||r.cells.join(' ').toLowerCase().includes(query)||String(r.number)===query);
            responseJSON(res,{import:item,total:sourceRows.length,rows:sourceRows.slice(offset,offset+50).map(row=>({...row,mapped:readMapped(row,table,item),disposition:tracked.get(row.number)})),fields:FIELDS[item.kind],enums:ENUMS,suggestion:suggestedMapping(table.columns,item.kind),revision:current.revision});return;
          }
          if(url.pathname==='/api/source') {
            const item=current.imports.find(i=>i.id===url.searchParams.get('importId'));if(!item) fail('Unknown source',404);
            const bytes=await readFile(path.join(sourcesDir,item.sha256));
            res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="'+safeName(item.fileName)+'"'});res.end(bytes);return;
          }
          if(url.pathname.startsWith('/api/export/')) {
            if(Number(url.searchParams.get('revision'))!==current.revision) fail('Workspace changed. Refresh before exporting.',409);
            const type=url.pathname.slice('/api/export/'.length);let bytes,mime,name;
            if(type==='bundle') {
              const sources=[];
              for(const item of current.imports) sources.push({id:item.id,fileName:item.fileName,sha256:item.sha256,bytes:await readFile(path.join(sourcesDir,item.sha256))});
              bytes=exportBundle({state:current,report,sources});mime='application/zip';name='trace-workspace-r'+current.revision+'.zip';
            } else if(type==='workbook') {bytes=exportWorkbook({state:current,report});mime='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';name='trace-review-r'+current.revision+'.xlsx';}
            else if(type==='graph') {if(report.summary.errors) fail('Resolve source and graph errors before exporting the normalized graph',409);bytes=Buffer.from(JSON.stringify(report.data,null,2)+'\n');mime='application/json';name='trace-graph.json';}
            else if(type==='report') {bytes=Buffer.from(JSON.stringify(report,null,2)+'\n');mime='application/json';name='trace-review.json';}
            else {
              const table=exportTables({state:current,report}).find(t=>t.name===type);
              if(!table) fail('Unknown export',404);bytes=Buffer.from(csv(table.columns,table.rows));mime='text/csv; charset=utf-8';name=type+'.csv';
            }
            res.writeHead(200,{'Content-Type':mime,'Content-Length':bytes.length,'Content-Disposition':'attachment; filename="'+name+'"'});res.end(bytes);return;
          }
          fail('Route not found',404);
        });
      } catch(e) {if(!res.headersSent) responseJSON(res,{error:e.message},e.status || 400);else res.destroy(e);}
    });
    server.requestTimeout=30000;server.headersTimeout=10000;server.keepAliveTimeout=1000;server.maxConnections=8;
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,hostname,resolve);});
    origin='http://'+hostname+':'+server.address().port;
    return {url:origin,accessKey,accessFile,directory:root,
      close:async()=>{if(closing)return;closing=true;await new Promise(resolve=>server.close(resolve));await queue;await release();},
      inspect:()=>serial(async()=>({state:clone(current),report:(await computed()).report}))};
  } catch(e) {if(server) await new Promise(resolve=>server.close(resolve));await release();throw e;}
}
export async function restoreBundle(bundlePath,directory) {
  if(!bundlePath || !directory) fail('Choose the retained bundle and a new data directory');
  const packet=readBundle(await readFile(bundlePath));
  const state=validateState(packet.state),root=path.resolve(directory);
  try{if((await readdir(root)).length) fail('Restore into a new empty data directory');}catch(e){if(e.code!=='ENOENT')throw e;}
  const sourceMap=new Map(packet.sources.map(s=>[s.sha256,s]));
  const tables=new Map();
  for(const item of state.imports) {
    const original=sourceMap.get(item.sha256);if(!original || digest(original.bytes)!==item.sha256) fail('Bundle source mismatch');
    const table=parseSource(original.bytes,item);
    if(stable(table.columns)!==stable(item.columns) || table.rows.length!==item.rowCount) fail('Bundle source shape mismatch');
    tables.set(item.id,table);
  }
  deriveProject(state,tables);
  const parentPath=path.dirname(root);await mkdir(parentPath,{recursive:true,mode:0o700});
  const staging=await mkdtemp(path.join(parentPath,'.trace-restore-'));
  try {
    for(const sub of ['sources','versions','operations']) await mkdir(path.join(staging,sub),{mode:0o700});
    for(const [sha,original] of sourceMap) await durableFile(path.join(staging,'sources',sha),original.bytes,{exclusive:true});
    await durableFile(path.join(staging,'versions',state.revision+'.json'),JSON.stringify({state,command:{type:'restore-bundle'},at:new Date().toISOString()}),{exclusive:true});
    await atomicJSON(path.join(staging,'current.json'),{revision:state.revision});
    for(const sub of ['sources','versions', '']) {
      const handle=await open(path.join(staging,sub),'r');try{await handle.sync();}finally{await handle.close();}
    }
    // POSIX directory rename publishes a complete tree and refuses a populated destination.
    await rename(staging,root);
    const parent=await open(parentPath,'r');try{await parent.sync();}finally{await parent.close();}
  } finally {await rm(staging,{recursive:true,force:true});}
  return {directory:root,projectId:state.id,revision:state.revision,sources:sourceMap.size};
}
async function recoverLock(directory) {
  const lockPath=path.join(path.resolve(directory),'operator.lock'),lock=JSON.parse(await readFile(lockPath,'utf8'));
  if(lock.hostname!==os.hostname() || !Number.isInteger(lock.pid)) fail('Lock belongs to a different host; inspect that original operator');
  try{process.kill(lock.pid,0);fail('The original operator process is still present');}
  catch(e){if(e.code!=='ESRCH')throw e;}
  const again=JSON.parse(await readFile(lockPath,'utf8'));if(again.id!==lock.id) fail('Lock changed during recovery');
  await unlink(lockPath);return {recovered:true,previousProcess:lock.pid};
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const args=process.argv.slice(2),command=['restore','recover-lock'].includes(args[0])?args.shift():'serve';
  const get=name=>{const index=args.indexOf(name);return index<0?null:args[index+1];};
  if(args.includes('--help') || !get('--data')) {
    process.stdout.write('Trace workbench\n\nnode workbench/server.mjs --data /private/trace-case [--port 8765]\nnode workbench/server.mjs restore --bundle /path/workspace.zip --data /private/restored-case\nnode workbench/server.mjs recover-lock --data /private/closed-case\n\nThe access key is stored in operator-access.json inside the private data directory.\n');
  } else {
    try {
      if(command==='restore') process.stdout.write(JSON.stringify(await restoreBundle(get('--bundle'),get('--data')))+'\n');
      else if(command==='recover-lock') process.stdout.write(JSON.stringify(await recoverLock(get('--data')))+'\n');
      else {
        const app=await createWorkbench({directory:get('--data'),port:Number(get('--port')||0)});
        process.stdout.write('Trace workbench: '+app.url+'\nOperator access file: '+app.accessFile+'\n');
        const close=()=>app.close().then(()=>{process.exitCode=0;},e=>{process.stderr.write(e.message+'\n');process.exitCode=1;});
        process.once('SIGTERM',close);process.once('SIGINT',close);
      }
    } catch(e) {process.stderr.write(e.message+'\n');process.exitCode=1;}
  }
}
