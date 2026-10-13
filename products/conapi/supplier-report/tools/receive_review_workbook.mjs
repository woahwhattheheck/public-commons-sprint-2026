#!/usr/bin/env node
/**
 * One connected workbook receiving continuation on the original Elite reimport.
 * Run sequentially inside the maintained Conapi programme; this file registers
 * no second native job and preserves all source, decisions and receiving output.
 */
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash, randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {createServer as netServer} from 'node:net';
import {spawn} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {
  canonicalJSON, reopenWorkspace, serializeWorkspace, decideMany, finalize
} from '../supplier-report.mjs';
import {
  createReviewWorkbookModel, reviewWorkbookReturn, verifyWorkbookOperation,
  createWorkbookDelivery, receiveWorkbookDelivery, recoverWorkbookReturn
} from '../review-workbook.mjs';
import {readReviewWorkbook} from '../review-workbook-host.mjs';

const INPUT_SHA='4020b1ee82e66b7b25886159248c92b7a1ee5006bc7fc71f698844e61a8924b9';
const INPUT_BLOB='6f4ae11b0d7ffabcc05143b48a6c60159c229c9e';
const CORE_SHA='f5643bf116141787d5412e8e444c12d7a18ea59415cca1d5302b55cc7725ede4';
const SOURCE_DIRECTORY=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const DEFAULT_INPUT=path.join(SOURCE_DIRECTORY,'examples','elite-reimport-workspace.json');
const SCHEMA='conapi.supplier-workbook-receiving.v1';
const textJSON=value=>JSON.stringify(value,null,2)+'\n';
const sha=value=>createHash('sha256').update(value).digest('hex');
const same=(a,b)=>canonicalJSON(a)===canonicalJSON(b);
const ensure=(condition,message,code='WORKBOOK_RECEIVING_FAILED')=>{
  if(!condition)throw Object.assign(new Error(message),{code});
};
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const utf8=data=>new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(data);
const PYTHON_HELPER="import base64, hashlib, json, os, pathlib, sqlite3, sys, tempfile, zipfile\nfrom datetime import datetime, timezone\n\ndef sha(data):\n    return hashlib.sha256(data).hexdigest()\n\ndef save(path, data):\n    target = pathlib.Path(path)\n    target.parent.mkdir(parents=True, exist_ok=True)\n    with tempfile.NamedTemporaryFile(dir=target.parent, prefix='.' + target.name, delete=False) as handle:\n        temporary = pathlib.Path(handle.name)\n        handle.write(data)\n        handle.flush()\n        os.fsync(handle.fileno())\n    try:\n        os.link(temporary, target)\n        temporary.unlink()\n        descriptor = os.open(target.parent, os.O_RDONLY)\n        try:\n            os.fsync(descriptor)\n        finally:\n            os.close(descriptor)\n    finally:\n        temporary.unlink(missing_ok=True)\n\ndef inspect_runtime(value):\n    import openpyxl\n    return {'python': sys.version, 'python_executable': sys.executable,\n            'openpyxl': openpyxl.__version__, 'sqlite': sqlite3.sqlite_version}\n\ndef edit(value):\n    import openpyxl\n    source = pathlib.Path(value['source'])\n    data = source.read_bytes()\n    if sha(data) != value['source_sha256']:\n        raise ValueError('The original exported workbook changed.')\n    book = openpyxl.load_workbook(source, data_only=False, keep_links=False)\n    review = book['Review']\n    for coordinate, text in [('B8', value['reviewer']), ('D8', value['note'])]:\n        review[coordinate] = text\n        review[coordinate].data_type = 's'\n    wanted = {row['itemId']: row for row in value['decisions']}\n    seen = set()\n    for cells in review.iter_rows(min_row=11, max_col=10):\n        identifier = cells[0].value\n        if identifier not in wanted:\n            continue\n        decision = wanted[identifier]\n        seen.add(identifier)\n        for column, field in [(6, 'action'), (7, 'reason'), (8, 'side')]:\n            cells[column].value = decision.get(field, '')\n            cells[column].data_type = 's'\n        cells[9].value = str(decision['rowNumber']) if 'rowNumber' in decision else ''\n        cells[9].data_type = 's'\n    if seen != set(wanted):\n        raise ValueError('An original reviewed item is absent from the workbook.')\n    # This is an ordinary spreadsheet sort, applied to the actual exported rows.\n    # The immutable identifiers and every original field travel together.\n    original_rows = [[cell.value for cell in cells] for cells in review.iter_rows(min_row=11, max_col=10)]\n    for row_number, values in enumerate(reversed(original_rows), 11):\n        for column, text in enumerate(values, 1):\n            cell = review.cell(row_number, column, '' if text is None else text)\n            if isinstance(cell.value, str):\n                cell.data_type = 's'\n    target = pathlib.Path(value['target'])\n    target.parent.mkdir(parents=True, exist_ok=True)\n    with tempfile.NamedTemporaryFile(dir=target.parent, suffix='.xlsx', delete=False) as handle:\n        temporary = pathlib.Path(handle.name)\n    try:\n        book.save(temporary)\n        with temporary.open('rb') as handle:\n            os.fsync(handle.fileno())\n        os.link(temporary, target)\n    finally:\n        book.close()\n        temporary.unlink(missing_ok=True)\n    result = target.read_bytes()\n    return {'path': str(target), 'bytes': len(result), 'sha256': sha(result),\n            'decisions': len(wanted), 'source_sha256': sha(data), 'sorted_review_rows': len(original_rows)}\n\ndef sqlite_receive(value):\n    directory = pathlib.Path(value['directory'])\n    target = pathlib.Path(value['database'])\n    existed = target.exists()\n    lineage = json.loads((directory / 'lineage.json').read_text())\n    columns = lineage['columns']\n    quote = lambda word: '\"' + word.replace('\"', '\"\"') + '\"'\n    with sqlite3.connect('file:' + str(target) + '?mode=ro', uri=True) if existed else sqlite3.connect(target) as con:\n        if not existed:\n            con.executescript((directory / 'accepted.sql').read_text())\n        rows = con.execute('SELECT ' + ','.join(map(quote, columns)) +\n                           ' FROM ' + quote(value['table']) + ' ORDER BY rowid').fetchall()\n    expected = [tuple(row[column] for column in columns) for row in lineage['rows']]\n    if rows != expected:\n        raise ValueError('The actual SQLite snapshot differs from the original accepted rows.')\n    data = target.read_bytes()\n    return {'database': str(target), 'bytes': len(data), 'sha256': sha(data),\n            'rows': len(rows), 'columns': columns,\n            'null_values': sum(cell is None for row in rows for cell in row),\n            'numeric_text_values': sum(isinstance(cell, str) and cell.replace('.', '', 1).isdigit() for row in rows for cell in row),\n            'resultDigest': lineage['resultDigest']}\n\ndef package(value):\n    root = pathlib.Path(value['root']).resolve()\n    target = pathlib.Path(value['target']).resolve()\n    manifest = json.loads((root / 'receiving-manifest.json').read_text())\n    files = list(manifest['files'])\n    manifest_data = (root / 'receiving-manifest.json').read_bytes()\n    files.append({'path': 'receiving-manifest.json', 'bytes': len(manifest_data), 'sha256': sha(manifest_data)})\n    if target.exists():\n        with zipfile.ZipFile(target, 'r') as archive:\n            if set(archive.namelist()) != {entry['path'] for entry in files}:\n                raise ValueError('The retained package inventory differs.')\n            for entry in files:\n                data = archive.read(entry['path'])\n                if len(data) != entry['bytes'] or sha(data) != entry['sha256']:\n                    raise ValueError('The retained package member differs.')\n        result = target.read_bytes()\n        return {'path': str(target), 'bytes': len(result), 'sha256': sha(result), 'members': len(files)}\n    with tempfile.NamedTemporaryFile(dir=target.parent, suffix='.zip', delete=False) as handle:\n        temporary = pathlib.Path(handle.name)\n    try:\n        with zipfile.ZipFile(temporary, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6, strict_timestamps=False) as archive:\n            for entry in files:\n                name = entry['path']\n                path = root.joinpath(*name.split('/'))\n                if path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to(root):\n                    raise ValueError('An original package member is not a regular owned file: ' + name)\n                data = path.read_bytes()\n                if len(data) != entry['bytes'] or sha(data) != entry['sha256']:\n                    raise ValueError('A package member changed: ' + name)\n                archive.writestr(name, data)\n        with zipfile.ZipFile(temporary, 'r') as archive:\n            if set(archive.namelist()) != {entry['path'] for entry in files}:\n                raise ValueError('The completed package inventory differs.')\n            for entry in files:\n                data = archive.read(entry['path'])\n                if len(data) != entry['bytes'] or sha(data) != entry['sha256']:\n                    raise ValueError('The completed package member differs.')\n        with temporary.open('rb') as handle:\n            os.fsync(handle.fileno())\n        os.link(temporary, target)\n    finally:\n        temporary.unlink(missing_ok=True)\n    result = target.read_bytes()\n    return {'path': str(target), 'bytes': len(result), 'sha256': sha(result), 'members': len(files)}\n\nvalue = json.load(sys.stdin)\naction = value.pop('action')\nresult = {'inspect': inspect_runtime, 'edit': edit, 'sqlite': sqlite_receive, 'package': package}[action](value)\nprint(json.dumps(result, ensure_ascii=False, separators=(',', ':'), allow_nan=False))\n";

async function exists(filename){try{return await fs.lstat(filename);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function syncDirectory(directory){const fd=await fs.open(directory,'r');try{await fd.sync();}finally{await fd.close();}}
async function write(filename,value,{replace=false}={}){
  const data=Buffer.isBuffer(value)?value:Buffer.from(value,'utf8');
  await fs.mkdir(path.dirname(filename),{recursive:true,mode:0o700});
  const current=await exists(filename);
  if(current&&!replace){
    ensure(current.isFile()&&!current.isSymbolicLink(),'Keep an original regular output: '+filename);
    ensure((await fs.readFile(filename)).equals(data),'The retained output differs: '+filename);
    return;
  }
  if(current)ensure(current.isFile()&&!current.isSymbolicLink(),'Keep an original regular output: '+filename);
  const temporary=filename+'.'+randomUUID()+'.tmp',fd=await fs.open(temporary,'wx',0o600);
  try{await fd.writeFile(data);await fd.sync();}finally{await fd.close();}
  try{
    if(replace)await fs.rename(temporary,filename);
    else{await fs.link(temporary,filename);await fs.unlink(temporary);}
    await syncDirectory(path.dirname(filename));
  }finally{await fs.unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
async function jsonFile(filename){return JSON.parse(utf8(await fs.readFile(filename)));}
async function identity(filename,root){
  const stat=await fs.lstat(filename);
  ensure(stat.isFile()&&!stat.isSymbolicLink(),'Expected a regular retained file: '+filename);
  const data=await fs.readFile(filename);
  return {path:root?path.relative(root,filename).split(path.sep).join('/'):filename,bytes:data.length,sha256:sha(data)};
}
async function inventory(root,{exclude=[]}={}){
  const result=[],omitted=new Set(exclude);
  async function walk(relative){
    for(const entry of await fs.readdir(path.join(root,relative),{withFileTypes:true})){
      const name=relative?relative+'/'+entry.name:entry.name;
      if(omitted.has(name)||[...omitted].some(value=>name.startsWith(value+'/')))continue;
      ensure(!entry.isSymbolicLink(),'A source/output symlink is not part of this complete receiving tree: '+name);
      if(entry.isDirectory())await walk(name);
      else if(entry.isFile())result.push(await identity(path.join(root,name),root));
      else throw Error('Unsupported receiving member: '+name);
    }
  }
  await walk('');return result.sort((a,b)=>a.path.localeCompare(b.path));
}
async function command(executable,args,{input,env={},cwd,timeout=120000,maximum=32*1024*1024}={}){
  return await new Promise((resolve,reject)=>{
    const child=spawn(executable,args,{cwd,env:{...process.env,...env},stdio:['pipe','pipe','pipe'],shell:false});
    const output=[],errors=[];let size=0,settled=false;
    const timer=setTimeout(()=>{child.kill('SIGTERM');setTimeout(()=>child.kill('SIGKILL'),3000).unref();},timeout);
    const end=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(value);};
    child.once('error',error=>end(error));
    child.stdout.on('data',chunk=>{size+=chunk.length;if(size>maximum){child.kill('SIGTERM');end(Error('Native output exceeded its declared receiving bound.'));}else output.push(chunk);});
    child.stderr.on('data',chunk=>{if(errors.reduce((n,x)=>n+x.length,0)<1024*1024)errors.push(chunk);});
    child.once('close',(code,signal)=>{
      const stdout=Buffer.concat(output).toString('utf8'),stderr=Buffer.concat(errors).toString('utf8');
      if(code!==0)end(Object.assign(new Error('Original command failed ('+String(code||signal)+'): '+stderr),{stdout,stderr,exitCode:code,signal}));
      else end(null,{stdout,stderr,exitCode:code});
    });
    child.stdin.on('error',()=>{});child.stdin.end(input===undefined?undefined:typeof input==='string'?input:JSON.stringify(input));
  });
}
async function python(executable,action,value){const result=await command(executable,['-c',PYTHON_HELPER],{input:{action,...value},timeout:120000});return JSON.parse(result.stdout);}
async function freePort(){
  const server=netServer();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;
}
async function processIdentity(pid){
  try{
    const [stat,namespace]=await Promise.all([fs.readFile('/proc/'+pid+'/stat','utf8'),fs.readlink('/proc/'+pid+'/ns/pid')]);
    return {pid,start:stat.slice(stat.lastIndexOf(')')+2).trim().split(/\s+/)[19],namespace,host:os.hostname()};
  }catch(error){if(error.code==='ENOENT'||error.code==='ESRCH')return null;throw error;}
}
async function acquire(root,operationId){
  const filename=path.join(root,'native-owner.json'),current=await exists(filename),owner=await processIdentity(process.pid);
  ensure(owner,'The native owner process identity is unavailable.');
  if(current){
    const previous=await jsonFile(filename),live=await processIdentity(previous.pid);
    ensure(!live||!same(live,{pid:previous.pid,start:previous.start,namespace:previous.namespace,host:previous.host}),
      'This original workbook continuation still has its owning native process.','WORKBOOK_ORIGINAL_RUNNING');
    ensure(previous.operationId===operationId,'The native owner record belongs to another operation.');
    await fs.unlink(filename);
  }
  const value={...owner,operationId,nonce:randomUUID()};
  await write(filename,textJSON(value));
  return async()=>{if(await exists(filename)){const saved=await jsonFile(filename);if(saved.nonce===value.nonce)await fs.unlink(filename);}};
}

export async function runWorkbookReceiving(options={}){
  const operationId=String(options.operationId||'CONAPI-SUPPLIER-WORKBOOK-RECEIVING-7A2F-20261012');
  const output=path.resolve(options.outputDirectory||'');
  ensure(options.outputDirectory&&output!==path.parse(output).root,'Select this operation’s owned output directory.');
  ensure(!output.startsWith(SOURCE_DIRECTORY+path.sep)&&output!==SOURCE_DIRECTORY,'Keep native outputs outside the maintained product source.');
  const inputPath=path.resolve(options.inputWorkspace||DEFAULT_INPUT);
  const pythonExecutable=options.pythonExecutable||process.env.CONAPI_WORKBOOK_PYTHON||process.env.CODEX_PRIMARY_RUNTIME_PYTHON||'python3';
  ensure(/^[a-f0-9]{40}$/.test(String(options.sourceCommit||'')),'Pass the exact published complete-source commit for this original programme.');
  const nodeModules=options.nodeModulesPath||process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES;
  ensure(nodeModules,'Select the existing installed Playwright dependency closure.');
  const require=createRequire(path.join(path.resolve(nodeModules),'playwright','package.json'));
  const {chromium}=require('playwright');
  const browserExecutable=options.browserExecutable||process.env.CONAPI_WORKBOOK_BROWSER||chromium.executablePath();
  ensure((await fs.stat(browserExecutable)).isFile(),'The selected installed Chromium executable is absent.');
  await fs.mkdir(output,{recursive:true,mode:0o700});
  const originalBytes=await fs.readFile(inputPath),coreBytes=await fs.readFile(path.join(SOURCE_DIRECTORY,'supplier-report.mjs'));
  ensure(originalBytes.length===65289&&sha(originalBytes)===INPUT_SHA,'Use the exact completed original Elite reimport workspace.');
  ensure(sha(coreBytes)===(options.coreSha256||CORE_SHA),'The operated original core differs from its selected source identity.');
  const binding={operationId,input:{bytes:originalBytes.length,sha256:sha(originalBytes),blob:INPUT_BLOB},
    core:{sha256:sha(coreBytes),bytes:coreBytes.length},sourceCommit:options.sourceCommit||null};
  const statePath=path.join(output,'native-state.json');
  let state=await exists(statePath)?await jsonFile(statePath):{schema:SCHEMA,binding,startedAt:new Date().toISOString(),status:'PREPARING',steps:[]};
  ensure(state.schema===SCHEMA&&same(state.binding,binding),'Continue this exact operation, source and original workspace.');
  async function saveState(){await write(statePath,textJSON(state),{replace:true});}
  async function verifyFiles(files){for(const expected of files){const actual=await identity(path.join(output,expected.path),output);ensure(same(actual,expected),'A retained stage output changed: '+expected.path);}}
  if(state.status==='COMPLETE'){
    await verifyFiles(state.steps.flatMap(step=>step.files));
    const completed=await jsonFile(path.join(output,'COMPLETE.json'));
    ensure(completed.operationId===operationId,'The retained completion selects another operation.');
    const zip=await identity(completed.package.path);
    ensure(zip.bytes===completed.package.bytes&&zip.sha256===completed.package.sha256,'The original completed package changed.');
    return completed;
  }
  const releaseOwner=await acquire(output,operationId);
  let context=null,receiverContext=null,server=null,serverLog=null,page=null,closed=false,stage='preparing';
  let serverClosed=false,serverClose=null;
  const events=[];
  const out=name=>path.join(output,name);
  const pyEnv={CONAPI_WORKBOOK_PYTHON:pythonExecutable};
  async function cli(args){const result=await command(process.execPath,[path.join(SOURCE_DIRECTORY,'supplier-report-cli.mjs'),...args],{env:pyEnv,cwd:SOURCE_DIRECTORY,timeout:180000});return JSON.parse(result.stdout);}
  async function step(name,run){
    stage=name;const previous=state.steps.find(item=>item.name===name);
    if(previous){await verifyFiles(previous.files);return previous.data;}
    state.status='RUNNING';state.currentStep=name;await saveState();
    const result=await run(),files=[];
    for(const name of result.files||[])files.push(await identity(out(name),output));
    const completed={name,completedAt:new Date().toISOString(),data:result.data||{},files};
    state.steps.push(completed);state.currentStep=null;await saveState();
    process.stdout.write(textJSON({schema:SCHEMA,operationId,stage:name,status:'COMPLETE',data:completed.data}));
    return completed.data;
  }
  async function originalServer(){
    if(options.url){
      const parsed=new URL(options.url);
      ensure(parsed.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(parsed.hostname)&&!parsed.username&&!parsed.password,
        'Borrow only the original local supplier server.');
      state.url=parsed.origin+'/';state.borrowedServer=true;await saveState();
    }else{
      const port=state.port||await freePort();state.port=port;state.url='http://127.0.0.1:'+port+'/';state.borrowedServer=false;await saveState();
      const prior=state.serverOwner&&await processIdentity(state.serverOwner.pid);
      if(prior&&same(prior,state.serverOwner)){
        state.reusedServer=true;
      }else{
        serverLog=await fs.open(out('server.log'),'a',0o600);
        server=spawn(process.execPath,[path.join(SOURCE_DIRECTORY,'supplier-report-cli.mjs'),'serve','--port',String(port)],
          {env:{...process.env,...pyEnv},cwd:SOURCE_DIRECTORY,stdio:['ignore',serverLog.fd,serverLog.fd],shell:false});
        serverClose=new Promise(resolve=>server.once('close',()=>{serverClosed=true;resolve();}));
        await new Promise((resolve,reject)=>{server.once('spawn',resolve);server.once('error',reject);});
        state.serverOwner=await processIdentity(server.pid);await saveState();
      }
    }
    const deadline=Date.now()+30000;let last;
    while(Date.now()<deadline){
      if(server&&(serverClosed||server.exitCode!==null||server.signalCode!==null))throw Error('The original supplier HTTP process ended before its ready response.');
      try{
        const response=await fetch(new URL('/api/workbook/status',state.url),{signal:AbortSignal.timeout(2000)}),body=await response.json();
        if(response.ok&&body.schema==='conapi.supplier-review-workbook-io.v1'&&body.status==='ready'){last=null;break;}
        last=Error('The selected original server has no ready workbook route.');
      }catch(error){last=error;}
      await delay(200);
    }
    if(last)throw last;
    for(const name of ['supplier-report.mjs','review-workbook.mjs','review-workbook-ui.mjs','review.html']){
      const response=await fetch(new URL(name,state.url),{signal:AbortSignal.timeout(5000)});
      ensure(response.ok,'The original server is missing '+name);
      const actual=Buffer.from(await response.arrayBuffer()),local=await fs.readFile(path.join(SOURCE_DIRECTORY,name));
      ensure(actual.equals(local),'The existing original server is serving a different source file: '+name);
    }
  }
  async function openPage(targetContext){
    const target=await targetContext.newPage();target.setDefaultTimeout(45000);
    target.on('dialog',dialog=>dialog.accept());
    target.on('pageerror',error=>events.push({at:new Date().toISOString(),type:'pageerror',message:error.message}));
    await target.goto(state.url,{waitUntil:'domcontentloaded'});
    await target.locator('#shell-workbook h2').waitFor();
    await target.waitForFunction(()=>{const input=document.querySelector('#shell-workspace-file');return input&&!input.disabled;});
    return target;
  }
  async function loadWorkspace(target,filename,revision){
    await target.locator('#shell-workspace-file').setInputFiles(filename);
    await target.waitForFunction(value=>{
      const title=document.querySelector('#shell-current')?.textContent||'';
      return title.includes('revision '+value+' ·')&&!document.querySelector('#shell-workspace-file')?.disabled;
    },revision);
    ensure(!(await target.locator('#shell-error').innerText()),'The original shell rejected this saved workspace.');
  }
  async function download(target,action,filename){
    const received=target.waitForEvent('download');await action();const result=await received;
    await result.saveAs(out(filename));ensure(!await result.failure(),'The original browser download did not finish: '+filename);
    return await identity(out(filename),output);
  }
  async function browserEntries(target){
    return await target.evaluate(()=>new Promise((resolve,reject)=>{
      const opening=indexedDB.open('conapi-supplier-workbooks-v1',1);
      opening.onerror=()=>reject(opening.error);
      opening.onsuccess=()=>{
        const db=opening.result;
        if(!db.objectStoreNames.contains('operations')){db.close();resolve([]);return;}
        const tx=db.transaction('operations','readonly'),request=tx.objectStore('operations').getAll();let value=[];
        request.onsuccess=()=>{value=request.result;};tx.oncomplete=()=>{db.close();resolve(value);};tx.onerror=()=>{db.close();reject(tx.error);};
      };
    }));
  }
  async function screenshot(target,name){await target.screenshot({path:out(name),fullPage:true});}
  async function closeResources(){
    if(closed)return;closed=true;
    if(receiverContext)await receiverContext.close().catch(()=>{});
    if(context)await context.close().catch(()=>{});
    if(server){
      if(!serverClosed){
        if(server.exitCode===null&&server.signalCode===null)server.kill('SIGTERM');
        await Promise.race([serverClose,delay(10000)]);
        if(!serverClosed&&server.exitCode===null&&server.signalCode===null)server.kill('SIGKILL');
        await serverClose;
      }
      state.serverClosed={pid:server.pid,exitCode:server.exitCode,signal:server.signalCode,at:new Date().toISOString()};
    }else if(state.reusedServer&&!state.borrowedServer&&state.serverOwner){
      const actual=await processIdentity(state.serverOwner.pid);
      if(actual&&same(actual,state.serverOwner)){
        process.kill(actual.pid,'SIGTERM');
        for(let count=0;count<50&&await processIdentity(actual.pid);count++)await delay(100);
        state.serverClosed={pid:actual.pid,closed:!await processIdentity(actual.pid),at:new Date().toISOString()};
      }
    }
    if(serverLog)await serverLog.close();
    await saveState();
  }
  try{
    // If every operating stage finished and only packaging lost its response,
    // finish from the exact retained manifest without restarting the app/browser.
    if(await exists(out('receiving-manifest.json'))&&await exists(out('native-result.json'))){
      const manifest=await jsonFile(out('receiving-manifest.json'));
      ensure(manifest.operationId===operationId&&manifest.inputSha256===INPUT_SHA,'The retained final package selects another original operation.');
      await verifyFiles(manifest.files);
      const result=await jsonFile(out('native-result.json'));
      ensure(result.status==='COMPLETE'&&result.operationId===operationId&&same(result.source,binding),'The retained complete result differs from this operation.');
      const packageResult=await python(pythonExecutable,'package',{root:output,target:out('Supplier_Workbook_Receiving.zip')});
      const completion={...result,package:packageResult};await write(out('COMPLETE.json'),textJSON(completion));
      state.status='COMPLETE';state.completedAt=completion.completedAt;state.package=packageResult;await saveState();await releaseOwner();
      process.stdout.write(textJSON(completion));return completion;
    }
    const original=reopenWorkspace(utf8(originalBytes)),model=createReviewWorkbookModel(original);
    ensure(original.revision===0&&original.items.length===23&&original.items.every(item=>item.kind==='unchanged'),
      'Continue the completed original 23-item accepted reimport.');
    const selected=original.items.slice(0,6);
    const plan={
      schema:'conapi.supplier-workbook-receiving-selection.v1',
      operationId,comparisonId:original.comparisonId,originalRevision:original.revision,selectedItemIds:selected.map(item=>item.id),
      reviewer:'7A2F native workbook receiving exercise',
      note:'Original Elite accepted-source reimport. These attributed receiving exercise decisions demonstrate offline review, overlap resolution and customer reopening.',
      returnDecisions:[
        {itemId:selected[0].id,action:'choose_source',side:'candidate',rowNumber:selected[0].candidate[0].rowNumber,reason:'Receiving exercise: keep this exact candidate source row after overlap review.'},
        {itemId:selected[2].id,action:'replace',values:selected[2].candidate[0].values,reason:'Receiving exercise: accept the complete canonical values retained in Corrections.'},
        {itemId:selected[3].id,action:'use_candidate',reason:'Receiving exercise: retain the original candidate row.'},
        {itemId:selected[4].id,action:'exclude',reason:'Receiving exercise: demonstrate an explicitly attributed exclusion in the copied receiving case.'}
      ],
      concurrentDecisions:[
        {itemId:selected[0].id,action:'exclude',reason:'Receiving exercise: an independently saved local decision while the XLSX is offline.'},
        {itemId:selected[1].id,action:'keep_baseline',reason:'Receiving exercise: an unrelated local decision that the workbook return must preserve.'}
      ],
      laterDecision:{itemId:selected[5].id,action:'keep_baseline',reason:'Receiving exercise: later local history preserved by the original workbook replay.'}
    };
    const retainedPlan=await exists(out('selection.json'))?await jsonFile(out('selection.json')):plan;
    ensure(same(retainedPlan,plan),'The original receiving exercise selection changed.');
    const prepared=await step('original-source-and-runtime',async()=>{
      const runtime=await python(pythonExecutable,'inspect',{});
      const sources=await inventory(SOURCE_DIRECTORY,{exclude:['node_modules','.git','__pycache__']});
      ensure(sources.reduce((n,file)=>n+file.bytes,0)<=96*1024*1024,'The full source tree exceeds this receiving operation’s declared source bound.');
      for(const file of sources)await write(out('source/'+file.path),await fs.readFile(path.join(SOURCE_DIRECTORY,file.path)));
      await write(out('original.workspace.json'),originalBytes);
      await write(out('selection.json'),textJSON(plan));
      await write(out('workbook-model.json'),textJSON(model));
      await write(out('source-manifest.json'),textJSON({sourceCommit:binding.sourceCommit,files:sources}));
      await write(out('runtime.json'),textJSON({...runtime,node:process.version,nodeModules:path.resolve(nodeModules),chromiumExecutable:browserExecutable,sourceDirectory:SOURCE_DIRECTORY,inputPath}));
      return {data:{comparisonId:original.comparisonId,items:23,sourceFragments:model.sourceRows.length,
        correctionFields:model.replacementRows.length,nullableCorrections:model.replacementRows.filter(row=>row.kind==='null').length,
        inputSha256:INPUT_SHA,runtime,sourceFiles:sources.length},
        files:['original.workspace.json','selection.json','workbook-model.json','source-manifest.json','runtime.json',...sources.map(file=>'source/'+file.path)]};
    });
    await originalServer();
    context=await chromium.launchPersistentContext(out('browser-profile'),{
      executablePath:browserExecutable,headless:true,acceptDownloads:true,viewport:{width:1440,height:1000},
      timezoneId:'UTC',args:process.getuid?.()===0?['--no-sandbox']:[],
      downloadsPath:out('browser-downloads')
    });
    page=await openPage(context);
    await step('original-browser-workbook-export',async()=>{
      await loadWorkspace(page,out('original.workspace.json'),0);
      if(!await exists(out('review.xlsx'))){
        await download(page,()=>page.getByRole('button',{name:'Download review workbook',exact:true}).click(),'review.xlsx');
      }
      const parsed=await readReviewWorkbook(await fs.readFile(out('review.xlsx')),{python:pythonExecutable});
      ensure(parsed.workbookId===model.workbookId&&parsed.basisSha256===model.basisSha256&&parsed.basisText===model.basisText,
        'The actual exported XLSX differs from the original complete source model.');
      ensure(parsed.rows.length===23&&parsed.sourceRows.length===966&&parsed.replacementRows.length===253,
        'The actual original XLSX lost review/source/correction rows.');
      await write(out('exported-workbook-return.json'),textJSON(parsed));
      await screenshot(page,'01-original-workbook.png');
      return {data:{workbookId:parsed.workbookId,file:parsed.file,sourceFragments:parsed.sourceRows.length,correctionFields:parsed.replacementRows.length},
        files:['review.xlsx','exported-workbook-return.json','01-original-workbook.png']};
    });
    const returned=await step('offline-workbook-and-concurrent-history',async()=>{
      if(!await exists(out('returned.xlsx'))){
        const edited=await python(pythonExecutable,'edit',{source:out('review.xlsx'),source_sha256:(await identity(out('review.xlsx'))).sha256,
          target:out('returned.xlsx'),reviewer:plan.reviewer,note:plan.note,decisions:plan.returnDecisions});
        await write(out('workbook-edit.json'),textJSON(edited));
      }
      const input=await readReviewWorkbook(await fs.readFile(out('returned.xlsx')),{python:pythonExecutable});
      const time=state.concurrentAt||(state.concurrentAt=new Date().toISOString());await saveState();
      const concurrent=decideMany(original,plan.concurrentDecisions,{reviewer:'7A2F concurrent receiving exercise',expectedRevision:0,at:time});
      const reviewedAt=state.offlineReviewAt||(state.offlineReviewAt=new Date().toISOString());await saveState();
      const preview=reviewWorkbookReturn(concurrent,input,{reviewedAt});
      ensure(preview.conflicts===1&&preview.unresolved===1&&preview.rows.some(row=>row.itemId===selected[0].id&&row.status==='conflict'),
        'The actual returned workbook did not expose the overlapping original decision.');
      ensure(!preview.rows.some(row=>row.itemId===selected[1].id),'The untouched original decision appeared as a returned workbook edit.');
      await write(out('returned-input.json'),textJSON(input));
      await write(out('concurrent.workspace.json'),serializeWorkspace(concurrent));
      await write(out('unresolved-review.json'),textJSON(preview));
      return {data:{revision:concurrent.revision,returnedFile:input.file,conflicts:preview.conflicts,returnedDecisions:preview.rows.length},
        files:['returned.xlsx','returned-input.json','concurrent.workspace.json','unresolved-review.json']};
    });
    const applied=await step('browser-conflict-review-and-original-adoption',async()=>{
      const concurrent=reopenWorkspace(utf8(await fs.readFile(out('concurrent.workspace.json'))));
      const input=await jsonFile(out('returned-input.json'));
      await loadWorkspace(page,out('concurrent.workspace.json'),concurrent.revision);
      const entries=(await browserEntries(page)).filter(entry=>entry.operation?.receipt?.comparisonId===original.comparisonId&&
        entry.operation?.input?.file?.sha256===input.file.sha256&&entry.operation?.beforeSha256===sha(serializeWorkspace(concurrent)));
      ensure(entries.length<=1,'Multiple different workbook attempts exist for this retained receiving selection; resume the original selected one.');
      let entry=entries[0];
      if(entry){
        verifyWorkbookOperation(entry.operation);
        ensure(['PREPARED','RECEIVING','ADOPTED'].includes(entry.state),'The retained original browser attempt was deliberately superseded; use its current selected receiving continuation.');
        await page.getByRole('button',{name:'Refresh saved workbook operations',exact:true}).click();
        const row=page.locator('.swb-history-row').filter({hasText:entry.id});
        if(entry.state==='PREPARED'||entry.state==='RECEIVING')await row.getByRole('button',{name:'Resume original adoption',exact:true}).click();
        else await row.getByRole('button',{name:'Open saved result',exact:true}).click();
      }else{
        await page.getByLabel('Return reviewed workbook',{exact:true}).setInputFiles(out('returned.xlsx'));
        const resolution=page.getByLabel('Resolve '+canonicalJSON(selected[0].key),{exact:true});
        await resolution.waitFor();
        ensure(await page.getByRole('button',{name:'Apply reviewed return',exact:true}).isDisabled(),'An unresolved stale decision was available for adoption.');
        await screenshot(page,'02-offline-overlap.png');
        await resolution.selectOption('use_returned');
        await page.waitForFunction(()=>{const b=[...document.querySelectorAll('#shell-workbook button')].find(x=>x.textContent==='Apply reviewed return');return b&&!b.disabled;});
        await page.getByText('Require complete finalized output',{exact:true}).locator('..').locator('input').check();
        await download(page,()=>page.getByRole('button',{name:'Download exact review JSON',exact:true}).click(),'review.json');
        await page.getByRole('button',{name:'Apply reviewed return',exact:true}).click();
      }
      await page.waitForFunction(()=>/revision 6 ·/.test(document.querySelector('#shell-current')?.textContent||'')&&
        document.querySelector('#shell-save')&&!document.querySelector('#shell-save').disabled);
      const saved=(await browserEntries(page)).filter(item=>item.operation?.receipt?.comparisonId===original.comparisonId&&item.operation?.input?.file?.sha256===input.file.sha256);
      ensure(saved.length===1,'Keep the one original accepted workbook operation.');
      entry=saved[0];const operation=verifyWorkbookOperation(entry.operation),report=reopenWorkspace(operation.afterWorkspace);
      ensure(entry.state==='ADOPTED'&&operation.receipt.beforeRevision===2&&operation.receipt.afterRevision===6&&operation.receipt.finalized,
        'The original workbook result is not fully adopted and finalized.');
      ensure(same(operation.input,input),'The browser operation differs from the actual parsed XLSX.');
      ensure(same(report.decisions[selected[1].id],concurrent.decisions[selected[1].id]),'The unrelated concurrent decision was changed.');
      ensure(same(report.history.slice(0,concurrent.history.length),concurrent.history),'The original concurrent history prefix was lost.');
      ensure(finalize(report).rows.length===22,'The receiving exercise output does not contain the exact selected original rows.');
      await write(out('browser-operation.json'),textJSON(operation));
      if(!await exists(out('review.json')))await write(out('review.json'),canonicalJSON(operation.preview)+'\n');
      ensure(same(await jsonFile(out('review.json')),operation.preview),'The retained browser review differs from its original adopted operation.');
      await download(page,()=>page.locator('#shell-save').click(),'adopted.workspace.json');
      const native=reopenWorkspace(utf8(await fs.readFile(out('adopted.workspace.json'))));
      ensure(same(native,report),'The original shell download differs from its adopted operation result.');
      const history=page.locator('.swb-history-row').filter({hasText:operation.operationId});
      await download(page,()=>history.getByRole('button',{name:'Download complete delivery',exact:true}).click(),'workbook-delivery.json');
      const packet=await jsonFile(out('workbook-delivery.json'));
      const checked=await receiveWorkbookDelivery(packet,{readWorkbook:base64=>readReviewWorkbook(Buffer.from(base64,'base64'),{python:pythonExecutable})});
      ensure(same(checked.operation,operation),'The downloaded original packet selected another operation.');
      await screenshot(page,'03-adopted-workspace.png');
      return {data:{operationId:operation.operationId,requestSha256:operation.requestSha256,revision:report.revision,
        resultDigest:finalize(report).resultDigest,acceptedRows:22,preservedConcurrentItem:selected[1].id},
        files:['browser-operation.json','review.json','adopted.workspace.json','workbook-delivery.json','03-adopted-workspace.png',...(await exists(out('02-offline-overlap.png'))?['02-offline-overlap.png']:[])]};
    });
    await step('fresh-browser-customer-receiving',async()=>{
      receiverContext=await context.browser().newContext({acceptDownloads:true,viewport:{width:1440,height:1000},timezoneId:'UTC'});
      const receiver=await openPage(receiverContext);
      const responses=[];receiver.on('response',response=>{if(new URL(response.url()).pathname==='/api/workbook/read')responses.push({status:response.status(),url:response.url()});});
      await receiver.getByLabel('Open complete workbook delivery',{exact:true}).setInputFiles(out('workbook-delivery.json'));
      await receiver.waitForFunction(()=>/revision 6 ·/.test(document.querySelector('#shell-current')?.textContent||'')&&
        !document.querySelector('#shell-save')?.disabled);
      await download(receiver,()=>receiver.locator('#shell-save').click(),'fresh-browser.workspace.json');
      const restored=reopenWorkspace(utf8(await fs.readFile(out('fresh-browser.workspace.json'))));
      ensure(serializeWorkspace(restored)===serializeWorkspace(reopenWorkspace(utf8(await fs.readFile(out('adopted.workspace.json'))))),
        'Fresh browser receiving changed original source or accepted history.');
      ensure(responses.some(response=>response.status===200),'Fresh receiving did not use the actual native XLSX reader.');
      await screenshot(receiver,'04-fresh-receiving.png');
      await receiver.setViewportSize({width:390,height:844});
      await screenshot(receiver,'05-fresh-receiving-mobile.png');
      await write(out('fresh-browser-reader.json'),textJSON(responses));
      await receiverContext.close();receiverContext=null;
      return {data:{revision:restored.revision,sourcePreserved:true,nativeXlsxRead:responses},
        files:['fresh-browser.workspace.json','fresh-browser-reader.json','04-fresh-receiving.png','05-fresh-receiving-mobile.png']};
    });
    await step('original-cli-review-receive-and-later-history',async()=>{
      const operation=verifyWorkbookOperation(await jsonFile(out('browser-operation.json')));
      await write(out('resolutions.json'),textJSON(operation.preview.resolutions));
      let review;
      if(await exists(out('cli-review/manifest.json'))){
        review={preview:await jsonFile(out('cli-review/review.json'))};
      }else review=await cli(['workbook-review','--workspace',out('concurrent.workspace.json'),'--returned',out('returned.xlsx'),
        '--resolutions',out('resolutions.json'),'--reviewed-at',operation.preview.reviewedAt,'--out-dir',out('cli-review'),'--python',pythonExecutable]);
      ensure(same(review.preview,operation.preview),'Native CLI review differs from the exact original browser selection.');
      if(!await exists(out('cli-received/manifest.json')))await cli(['workbook-receive','--packet',out('workbook-delivery.json'),'--out-dir',out('cli-received'),'--python',pythonExecutable]);
      const receipt=await jsonFile(out('cli-received/operation.json'));
      ensure(same(receipt,operation),'Original CLI receiving changed the selected operation.');
      const after=reopenWorkspace(operation.afterWorkspace),at=state.laterAt||(state.laterAt=new Date().toISOString());await saveState();
      const later=decideMany(after,[plan.laterDecision],{reviewer:'7A2F later local receiving exercise',expectedRevision:after.revision,at});
      await write(out('later.workspace.json'),serializeWorkspace(later));
      const replay=await cli(['workbook-apply','--workspace',out('later.workspace.json'),'--review-dir',out('cli-review'),
        '--operation',operation.operationId,'--out',out('replayed.workspace.json'),'--delivery-dir',out('cli-received'),'--finalize','--force','--python',pythonExecutable]);
      ensure(replay.status==='ALREADY_APPLIED','The original replay did not recover its existing applied operation.');
      const retained=reopenWorkspace(utf8(await fs.readFile(out('replayed.workspace.json'))));
      ensure(same(retained,later)&&retained.revision===7,'Workbook replay overwrote later original decision history.');
      const inspected=await cli(['inspect','--workspace',out('replayed.workspace.json')]);
      ensure(inspected.revision===7&&inspected.comparisonId===original.comparisonId,'The actual original CLI reopened another result.');
      await write(out('cli-replay.json'),textJSON(replay));
      await write(out('cli-inspection.json'),textJSON(inspected));
      return {data:{replayStatus:replay.status,originalOperation:operation.operationId,revision:retained.revision,
        laterItem:plan.laterDecision.itemId,resultDigest:finalize(retained).resultDigest},
        files:['resolutions.json','later.workspace.json','replayed.workspace.json','cli-replay.json','cli-inspection.json',
          ...(await inventory(out('cli-review'))).map(file=>'cli-review/'+file.path),
          ...(await inventory(out('cli-received'))).map(file=>'cli-received/'+file.path)]};
    });
    await step('complete-original-customer-export-and-sqlite',async()=>{
      if(await exists(out('customer'))&&!await exists(out('customer/manifest.json'))){
        const partial='preserved-partial-customer-'+randomUUID();await fs.rename(out('customer'),out(partial));
        state.preservedPartialExports=[...(state.preservedPartialExports||[]),partial];await saveState();
      }
      if(!await exists(out('customer/manifest.json')))await cli(['export','--workspace',out('replayed.workspace.json'),
        '--out-dir',out('customer'),'--table-name','workbook_accepted','--workbook-delivery',out('cli-received')]);
      const manifest=await jsonFile(out('customer/manifest.json'));
      ensure(manifest.format==='conapi-supplier-delivery'&&manifest.revision===7,'The complete original customer export is absent.');
      const names=new Set();
      for(const file of manifest.files){
        ensure(typeof file.filename==='string'&&!file.filename.includes('..')&&!path.isAbsolute(file.filename)&&!names.has(file.filename),
          'The original customer manifest member is not unique and portable.');
        names.add(file.filename);
        const actual=await identity(out('customer/'+file.filename));
        ensure(actual.bytes===file.bytes&&actual.sha256===file.sha256,'An original customer export member changed: '+file.filename);
      }
      for(const name of ['workspace.json','accepted.csv','accepted.sql','report.html','lineage.json','workbook-return.packet.json','workbook-return.xlsx',
        'review-workbook.mjs','review_workbook.py','review-workbook-ui.mjs','review-workbook-host.mjs','WORKBOOK_REVIEW.md']){
        ensure(names.has(name),'The original customer export is missing its complete operated workbook source: '+name);
      }
      const customerPacket=await receiveWorkbookDelivery(await jsonFile(out('customer/workbook-return.packet.json')),
        {readWorkbook:base64=>readReviewWorkbook(Buffer.from(base64,'base64'),{python:pythonExecutable})});
      const current=reopenWorkspace(utf8(await fs.readFile(out('customer/workspace.json'))));
      ensure(recoverWorkbookReturn(current,customerPacket.operation).status==='ALREADY_APPLIED'&&current.revision===7,
        'The customer export lost the workbook operation or later local work.');
      let sqlite;
      if(await exists(out('sqlite.json'))){sqlite=await jsonFile(out('sqlite.json'));const actual=await identity(out('accepted.sqlite3'));ensure(actual.sha256===sqlite.sha256,'The retained SQLite snapshot changed.');}
      else{
        sqlite=await python(pythonExecutable,'sqlite',{directory:out('customer'),database:out('accepted.sqlite3'),table:'workbook_accepted'});
        await write(out('sqlite.json'),textJSON(sqlite));
      }
      ensure(sqlite.rows===22,'The native SQLite receiver lost an accepted source row.');
      await write(out('customer-receiving.json'),textJSON({members:manifest.files.length,revision:current.revision,workbookOperation:customerPacket.operation.operationId,sqlite}));
      return {data:{customerFiles:manifest.files.length,revision:current.revision,sqliteRows:sqlite.rows,nullValues:sqlite.null_values,numericTextValues:sqlite.numeric_text_values},
        files:['accepted.sqlite3','sqlite.json','customer-receiving.json',...(await inventory(out('customer'))).map(file=>'customer/'+file.path)]};
    });
    if(!await exists(out('browser-events.json')))await write(out('browser-events.json'),textJSON(events));
    await closeResources();
    const result=await exists(out('native-result.json'))?await jsonFile(out('native-result.json')):{
      schema:SCHEMA,operationId,status:'COMPLETE',startedAt:state.startedAt,completedAt:new Date().toISOString(),
      source:binding,original:{comparisonId:original.comparisonId,revision:0,rows:23,sourceSha256:INPUT_SHA},
      operated:{operationId:applied.operationId,reviewedRevision:6,finalRevision:7,acceptedRows:22},
      outcome:'Actual original XLSX export and return, stale-decision review, native adoption, fresh browser receiving, same-operation CLI replay preserving later history, complete original customer export and actual SQLite receiving.',
      steps:state.steps.map(item=>({name:item.name,completedAt:item.completedAt,data:item.data})),
      server:state.serverClosed||{borrowed:!!state.borrowedServer,url:state.url}
    };
    await write(out('native-result.json'),textJSON(result));
    const guide=[
      '# Supplier workbook receiving',
      '',
      'The original Elite accepted reimport remains in original.workspace.json. It contains 23 unchanged source items.',
      'The operated copy contains explicitly attributed receiving exercise decisions. Source editions, captured dates, exact text values and nulls remain in its original native workspace.',
      '',
      'Open customer/workspace.json using customer/supplier-report-cli.mjs serve. The complete original customer folder includes the reviewed CSV, HTML, SQLite snapshot SQL, full source and the workbook return packet.',
      'To receive the workbook operation independently, run:',
      '',
      'node customer/supplier-report-cli.mjs workbook-receive --packet customer/workbook-return.packet.json --out-dir NEW_DIRECTORY',
      '',
      'Use the existing Analysis Python environment with openpyxl; set CONAPI_WORKBOOK_PYTHON if needed. Every packet adoption reparses the exact original XLSX before comparing its saved decision input.',
      'The workbook operation finishes at revision 6. customer/workspace.json and replayed.workspace.json preserve a later original decision at revision 7.',
      'The native-result.json and receiving-manifest.json retain actual source identities, observed output and full package members.',
      ''
    ].join('\n');
    await write(out('RECEIVING.md'),guide);
    const files=await inventory(output,{exclude:['browser-profile','browser-downloads','native-state.json','native-owner.json','server.log','COMPLETE.json','receiving-manifest.json','Supplier_Workbook_Receiving.zip']});
    const manifest={schema:'conapi.supplier-workbook-receiving-package.v1',operationId,inputSha256:INPUT_SHA,files};
    await write(out('receiving-manifest.json'),textJSON(manifest));
    const packageResult=await python(pythonExecutable,'package',{root:output,target:out('Supplier_Workbook_Receiving.zip')});
    const completion={...result,package:packageResult};
    await write(out('COMPLETE.json'),textJSON(completion));
    state.status='COMPLETE';state.completedAt=completion.completedAt;state.package=packageResult;await saveState();
    await releaseOwner();
    process.stdout.write(textJSON(completion));return completion;
  }catch(error){
    if(page&&!page.isClosed()){
      try{
        const entries=await browserEntries(page);await write(out('retained-browser-operations.json'),textJSON(entries),{replace:true});
        for(const entry of entries){
          if(entry.operation?.receipt?.comparisonId!==reopenWorkspace(utf8(originalBytes)).comparisonId)continue;
          const packet=await createWorkbookDelivery(entry.operation,entry.contentBase64);
          await write(out('retained-'+entry.id+'.workbook-delivery.json'),canonicalJSON(packet)+'\n');
        }
        await page.screenshot({path:out('interrupted-browser.png'),fullPage:true}).catch(()=>{});
      }catch(preserveError){state.preservationError=preserveError.message;}
    }
    state.status='INTERRUPTED';state.failure={stage,code:error.code||'WORKBOOK_RECEIVING_FAILED',message:error.message,at:new Date().toISOString()};
    await write(out('native-error.json'),textJSON(state.failure),{replace:true}).catch(()=>{});
    await closeResources().catch(closeError=>{state.closeError=closeError.message;});
    await saveState().catch(()=>{});await releaseOwner().catch(()=>{});throw error;
  }
}
function options(argv){
  const values={};
  for(let i=0;i<argv.length;i+=2){ensure(/^--[a-z-]+$/.test(argv[i])&&argv[i+1]!==undefined,'Use complete named receiving options.');ensure(!Object.hasOwn(values,argv[i]),'Do not repeat a receiving option.');values[argv[i]]=argv[i+1];}
  const names={'--out':'outputDirectory','--input':'inputWorkspace','--python':'pythonExecutable','--browser':'browserExecutable',
    '--node-modules':'nodeModulesPath','--operation-id':'operationId','--source-commit':'sourceCommit','--core-sha256':'coreSha256','--url':'url'};
  for(const key of Object.keys(values))ensure(Object.hasOwn(names,key),'Unknown receiving option: '+key);
  return Object.fromEntries(Object.entries(values).map(([key,value])=>[names[key],value]));
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  runWorkbookReceiving(options(process.argv.slice(2))).catch(error=>{
    process.stderr.write(textJSON({schema:SCHEMA,status:'INTERRUPTED',code:error.code||'WORKBOOK_RECEIVING_FAILED',message:error.message}));
    process.exitCode=1;
  });
}
