"""Exercise named World Bank programmes in the existing recurring receiving course.

The original source handovers, customer edits, Analysis jobs, archive receiver
and process-family helper remain authoritative. This optional continuation
creates no external source edition and uses no separate provider or writer.
"""
from __future__ import annotations

from copy import deepcopy
import fcntl
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import threading
import time
import uuid
import zipfile

from .analysis_workspace import AnalysisWorkspace, serve
from .storage import private_directory
from .workspace_archive_receive import restore_archive
from .worldbank_analysis import encoded, regular, require, sha, sql_identifier, typed_rows, write

FAMILY_BYTES = 13765
FAMILY_SHA = "8522835d848533ff66b8fad6900c5c0c781eaae4967a5b5ac2f9dac1ed458412"
BROWSER_SOURCE = "import assert from 'node:assert/strict';\nimport {readFile,writeFile,open,mkdir,link,unlink,stat} from 'node:fs/promises';\nimport {join,dirname} from 'node:path';\nimport {pathToFileURL} from 'node:url';\nimport {createHash,randomUUID} from 'node:crypto';\nconst config=JSON.parse(await readFile(process.argv[2],'utf8'));\nconst hash=b=>createHash('sha256').update(b).digest('hex');\nconst canon=v=>Array.isArray(v)?v.map(canon):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canon(v[k])])):v;\nconst equal=(a,b)=>assert.equal(JSON.stringify(canon(a)),JSON.stringify(canon(b)));\nconst sleep=ms=>new Promise(r=>setTimeout(r,ms));\nconst announce=v=>{try{process.stdout.write(JSON.stringify(v)+'\\n');}catch{}};\nasync function sync(dir){const h=await open(dir,'r');try{await h.sync();}finally{await h.close();}}\nasync function read(name){try{return JSON.parse(await readFile(join(config.output,name),'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}\nasync function save(name,value){\n const file=join(config.output,name),body=Buffer.from(JSON.stringify(value,null,2)+'\\n'),tmp=file+'.writing';\n for(;;){let h;try{\n  try{equal(JSON.parse(await readFile(file,'utf8')),value);await sync(dirname(file));return;}catch(e){if(e.code!=='ENOENT')throw e;}\n  h=await open(tmp,'w',0o600);await h.writeFile(body);await h.sync();await h.close();h=null;\n  try{await link(tmp,file);}catch(e){if(e.code!=='EEXIST')throw e;equal(JSON.parse(await readFile(file,'utf8')),value);}\n  await sync(dirname(file));await unlink(tmp).catch(e=>{if(e.code!=='ENOENT')throw e;});await sync(dirname(file));return;\n }catch(e){if(h)await h.close().catch(()=>{});announce({state:'AWAITING_ORIGINAL_BROWSER_RECORD',name,error:String(e)});await sleep(2000);}\n }\n}\nasync function describe(file){const b=await readFile(file);return{path:file,bytes:b.length,sha256:hash(b)};}\nawait mkdir(config.output,{recursive:true,mode:0o700});\nconst previous=await read('browser-complete.json');\nif(previous){equal(previous.binding,config.binding);for(const f of [...previous.images,...previous.downloads])equal(await describe(f.path),f);announce(previous);process.exit(0);}\nconst imported=await import(pathToFileURL(config.playwright).href),chromium=imported.chromium||imported.default?.chromium;\nassert(chromium,'Use the selected original Playwright chromium.');\nlet browser,context,page,activeCapture=null,captured=null;\nconst images=[],downloads=[],errors=[];\nconst captureRoot=join(config.output,'captures',randomUUID());await mkdir(captureRoot,{recursive:true,mode:0o700});\nconst origin=config.url.split('#')[0].replace(/\\/$/,''),capability=config.url.split('#')[1];\nconst base='/api/worldbank-programmes/'+encodeURIComponent(config.name);\nasync function request(path,body){\n const response=await context.request.fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{'X-Analysis-Capability':capability,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{data:body})});\n const result=await response.json();if(!response.ok()){const e=Error(result.error||'HTTP '+response.status());e.status=response.status();e.detail=result.error;throw e;}return result;\n}\nasync function status(id){return request(base+'/operations/'+id);}\nasync function wait(id){\n for(;;){const result=await status(id);if(result.status!=='RUNNING')return result;await sleep(200);}\n}\nasync function recordedAction(key,kind,click,check){\n const name=key+'-request.json';let original=await read(name);\n const route=kind==='save'?base:kind==='publish'?null:base+'/'+kind;\n if(!original){\n  activeCapture={name,kind,route};captured=null;\n  await click();\n  while(!captured)await sleep(50);\n  original=captured;activeCapture=null;\n } else {\n  equal(original.binding,config.binding);check(original.body);\n }\n check(original.body);\n if(kind==='save'){const answer=await request(original.path,original.body);return{request:original,answer};}\n let answer;\n try{answer=await status(original.body.id);}catch(e){if(e.detail!=='WORLDBANK_PROGRAMME_OPERATION_NOT_FOUND')throw e;}\n if(!answer)answer=await request(original.path,original.body);\n if(kind==='publish'){\n  if(answer.action==='prepare'&&answer.status==='RUNNING')answer=await wait(original.body.id);\n  if(answer.publish_request===null||answer.publish_request===undefined){\n   assert.equal(answer.status,'REVIEW_READY','Finish the original prepare before accepting its frozen publish request.');\n   answer=await request(original.path,original.body);\n  }else equal(answer.publish_request,Object.fromEntries(Object.entries(original.body).filter(([k])=>k!=='resume')));\n }\n if(['ERROR','INTERRUPTED'].includes(answer.status)&&answer.action===kind){\n  assert(config.resume,'The retained original operation needs explicit --resume.');\n  const prior=answer[kind+'_request'];assert(prior,'The original operation request is absent.');\n  equal(canon(Object.fromEntries(Object.entries(original.body).filter(([k])=>k!=='resume'))),canon(prior));\n  answer=await request(original.path,{...original.body,resume:true});\n }\n answer=await wait(original.body.id);\n assert(!['ERROR','INTERRUPTED'].includes(answer.status)||(kind==='prepare'&&answer.review),JSON.stringify(answer));\n return{request:original,answer};\n}\nasync function showOperation(id){\n await page.reload();await page.getByRole('button',{name:'World Bank',exact:true}).click();\n const programme=page.locator('#wb-programmes tr').filter({hasText:config.name});\n await programme.getByRole('button',{name:'Open',exact:true}).click();\n const row=page.locator('#wb-operations tr').filter({hasText:id});\n await row.getByRole('button',{name:'Open',exact:true}).click();\n await page.locator('#wb-operation-state').filter({hasText:id}).waitFor();\n}\nasync function capture(label,selector='#wb-operation-panel'){\n for(const size of [{width:1440,height:1000},{width:390,height:844}]){\n  await page.setViewportSize(size);await page.locator(selector).scrollIntoViewIfNeeded();\n  const dimensions=await page.evaluate(()=>({innerWidth:innerWidth,scrollWidth:document.documentElement.scrollWidth}));\n  assert(dimensions.scrollWidth<=dimensions.innerWidth+1,'The original operator page overflows this viewport.');\n  const file=join(captureRoot,label+'-'+size.width+'.png');await page.screenshot({path:file,fullPage:true});images.push(await describe(file));\n }\n}\nasync function receiveDownload(record){\n const existing=join(config.output,record.filename);\n try{const d=await describe(existing);assert.equal(d.bytes,record.bytes);assert.equal(d.sha256,record.sha256);downloads.push(d);return;}\n catch(e){if(e.code!=='ENOENT')throw e;}\n assert(record.bytes<=64*1024*1024,'This real browser course needs the original ordinary download flow for its small retained fixture.');\n const row=page.locator('#wb-delivery tr').filter({hasText:record.filename});\n const pending=page.waitForEvent('download');await row.getByRole('button',{name:'Download',exact:true}).click();const download=await pending;\n const staged=existing+'.download-'+Date.now();await download.saveAs(staged);assert.equal(await download.failure(),null);\n const d=await describe(staged);assert.equal(d.bytes,record.bytes);assert.equal(d.sha256,record.sha256);\n try{await link(staged,existing);}catch(e){if(e.code!=='EEXIST')throw e;const prior=await describe(existing);assert.equal(prior.bytes,record.bytes);assert.equal(prior.sha256,record.sha256);}\n const f=await open(existing,'r');try{await f.sync();}finally{await f.close();}await sync(config.output);await unlink(staged);await sync(config.output);downloads.push(await describe(existing));\n}\n\nasync function intakeStatus(id){return request('/api/worldbank-intake/'+id);}\nfunction checkIntake(value){\n assert.equal(value.status,'REGISTERED',JSON.stringify(value));\n assert.equal(value.intent.sha256,config.candidate.sha256);\n assert.equal(value.intent.bytes,config.candidate.bytes);\n assert.equal(value.result.handover.sha256,config.candidate.sha256);\n assert.equal(value.result.handover.bytes,config.candidate.bytes);\n assert(value.result.source.name&&Number.isInteger(value.result.source.revision));\n assert(value.result.source.document_id);\n assert(value.result.original_review&&value.result.source_metadata);\n return value;\n}\nasync function enterIntake(){\n await page.goto(config.url);await page.getByRole('button',{name:'World Bank',exact:true}).click();\n await page.getByRole('button',{name:'Receive approved handover',exact:true}).click();\n await page.locator('#workspace').filter({hasText:'Customer workspace:'}).waitFor();\n}\nasync function chooseRetainedIntake(value){\n for(;;){\n  const row=page.locator('#history tr').filter({hasText:value.result.source.name});\n  if(await row.count()){assert.equal(await row.count(),1);await row.getByRole('button',{name:'Open',exact:true}).click();break;}\n  assert(await page.locator('#older').isEnabled(),'The original registered intake is absent from the received history.');\n  const previous=await page.locator('#history').innerHTML();\n  const response=page.waitForResponse(r=>r.request().method()==='GET'&&new URL(r.url()).pathname==='/api/worldbank-intake');\n  await page.locator('#older').click();await response;\n  await page.waitForFunction(previous=>document.getElementById('history').innerHTML!==previous,previous);\n }\n await page.locator('#identity').filter({hasText:value.id}).waitFor();\n await page.locator('#original').waitFor({state:'visible'});\n equal(JSON.parse(await page.locator('#source-metadata').textContent()),value.result.source_metadata);\n equal(JSON.parse(await page.locator('#original-review').textContent()),value.result.original_review);\n}\nasync function intakeDownload(value){\n const existing=join(config.output,'WorldBank_Approved_Handover.zip');\n try{const d=await describe(existing);assert.equal(d.bytes,value.intent.bytes);assert.equal(d.sha256,value.intent.sha256);downloads.push(d);return;}\n catch(e){if(e.code!=='ENOENT')throw e;}\n const pending=page.waitForEvent('download');await page.locator('#original').click();const download=await pending;\n const staged=existing+'.download-'+randomUUID();await download.saveAs(staged);assert.equal(await download.failure(),null);\n const d=await describe(staged);assert.equal(d.bytes,value.intent.bytes);assert.equal(d.sha256,value.intent.sha256);\n const f=await open(staged,'r');try{await f.sync();}finally{await f.close();}\n try{await link(staged,existing);}catch(e){if(e.code!=='EEXIST')throw e;const prior=await describe(existing);assert.equal(prior.bytes,value.intent.bytes);assert.equal(prior.sha256,value.intent.sha256);}\n await sync(config.output);await unlink(staged);await sync(config.output);downloads.push(await describe(existing));\n}\nasync function receiveIntake(){\n let recorded=await read('intake-request.json');\n if(recorded){equal(recorded.binding,config.binding);assert.equal(recorded.body.sha256,config.candidate.sha256);assert.equal(recorded.body.bytes,config.candidate.bytes);}\n await page.route('**/api/worldbank-intake',async route=>{\n  const r=route.request();\n  if(r.method()==='POST'){\n   const body=r.postDataJSON();assert.equal(body.sha256,config.candidate.sha256);assert.equal(body.bytes,config.candidate.bytes);\n   const value={binding:config.binding,path:'/api/worldbank-intake',body};\n   await save('intake-request.json',value);recorded=value;\n  }\n  await route.continue();\n });\n await enterIntake();\n if(recorded){\n  const history=await request('/api/worldbank-intake');\n  await page.evaluate(({workspace,body})=>localStorage.setItem('worldbank-intake:'+workspace,JSON.stringify(body)),{workspace:history.workspace_id,body:recorded.body});\n  await page.reload();await page.locator('#workspace').filter({hasText:'Customer workspace:'}).waitFor();\n }\n let value;\n if(recorded){\n  try{value=await intakeStatus(recorded.body.id);}catch(e){if(e.detail!=='WORLDBANK_INTAKE_NOT_FOUND')throw e;}\n }\n if(value?.status!=='REGISTERED'){\n  await page.locator('#handover').setInputFiles(config.candidate.path);\n  await page.getByRole('button',{name:'Receive and register source',exact:true}).click();\n  await page.waitForFunction(()=>!document.getElementById('upload').disabled);\n  const failure=await page.locator('#message').textContent();\n  assert(!failure||failure==='The original registration is already running.'||failure==='This exact handover is already registered.',failure);\n  assert(recorded,'The original browser intake request was not retained.');\n  for(;;){\n   value=await intakeStatus(recorded.body.id);\n   if(value.status==='REGISTERED')break;\n   assert(!['ERROR','INTERRUPTED'].includes(value.status),JSON.stringify(value));\n   const message=await page.locator('#message').textContent();\n   assert(!message||message==='The original registration is already running.',message);await sleep(200);\n  }\n }\n checkIntake(value);equal(recorded.body,{id:value.id,...value.intent});\n await page.reload();await page.locator('#workspace').filter({hasText:'Customer workspace:'}).waitFor();\n await chooseRetainedIntake(value);\n await capture('approved-handover-registration','#selected');\n await intakeDownload(value);\n await page.getByRole('button',{name:'Review in customer programmes',exact:true}).click();\n await page.locator('#wb-source').waitFor({state:'attached'});\n await page.waitForFunction(expected=>document.getElementById('wb-source')?.value===expected,value.result.source.name+'\\n'+value.result.source.revision);\n await capture('registered-source-selected','#tab-worldbank');\n assert.equal(errors.length,0,JSON.stringify(errors));\n return {schema:'stellar-forge.worldbank-programme-browser-receiving.v1',status:'COMPLETE',\n  binding:config.binding,mode:config.mode,operation_id:value.id,request:recorded,\n  source:{name:value.result.source.name,revision:value.result.source.revision},\n  intake:value,original_download_verified:true,images,downloads,errors};\n}\n\nlet outcome;\ntry{\n browser=await chromium.launch({executablePath:config.chromium,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});\n context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});\n page=await context.newPage();page.setDefaultTimeout(60000);\n page.on('pageerror',e=>errors.push(String(e)));\n await page.route('**/api/worldbank-programmes/**',async route=>{\n  const r=route.request();if(r.method()==='POST'&&activeCapture){\n   const path=new URL(r.url()).pathname,body=r.postDataJSON(),want=activeCapture;\n   assert.equal(path,want.kind==='publish'?base+'/operations/'+body.id+'/publish':want.route);\n   const value={binding:config.binding,path,body};await save(want.name,value);captured=value;\n  }await route.continue();\n });\n if(config.mode==='intake'){\n  outcome=await receiveIntake();\n }else{\n await page.goto(config.url);await page.getByRole('button',{name:'World Bank',exact:true}).click();\n if(config.mode==='restored'){\n  const restored=checkIntake(await intakeStatus(config.intake.id));\n  equal(restored.result,config.intake.result);equal(restored.intent,config.intake.intent);\n  await enterIntake();await chooseRetainedIntake(restored);\n  await capture('restored-original-handover','#selected');await intakeDownload(restored);\n  await page.getByRole('button',{name:'Review in customer programmes',exact:true}).click();\n  await page.locator('#wb-source').waitFor({state:'attached'});await page.waitForFunction(expected=>document.getElementById('wb-source')?.value===expected,config.source.name+'\\n'+config.source.revision);\n }\n let action;\n if(config.mode==='customer'){\n  const definition=config.definition;\n  const saved=await recordedAction('save','save',async()=>{\n   await page.getByRole('button',{name:'New programme',exact:true}).click();\n   await page.locator('#wb-name').fill(config.name);await page.locator('#wb-title').fill(definition.title);\n   for(const key of ['view','report','workbook'])await page.locator('#wb-'+key).selectOption(definition[key]);\n   await page.locator('#wb-prefix').fill(definition.prefix);await page.locator('#wb-keys').fill(definition.keys.join('\\n'));\n   await page.getByRole('button',{name:'Save programme definition',exact:true}).click();\n  },body=>{equal(body.definition,definition);assert.equal(body.expected_revision,0);});\n  const selected=page.locator('#wb-programmes tr').filter({hasText:config.name});\n  await selected.getByRole('button',{name:'Open',exact:true}).click();\n  const prepared=await recordedAction('prepare','prepare',async()=>{\n   await page.locator('#wb-source').selectOption(config.source.name+'\\n'+config.source.revision);\n   await page.getByRole('button',{name:'Prepare source review',exact:true}).click();\n  },body=>{equal(body.source,config.source);assert.equal(body.expected_revision,saved.answer.revision);});\n  assert(prepared.answer.review,'The original complete source review is not ready.');await showOperation(prepared.request.body.id);\n  const metadata=prepared.answer.review.metadata_review;assert(metadata,'Keep the original complete provider metadata review.');\n  assert.equal(metadata.same_capture,true);\n  for(const key of ['added','removed','changed'])assert.equal(metadata.provider_metadata_counts[key],0);\n  equal(metadata.selection_changes,{});equal(metadata.review_changes,{});\n  await page.locator('#wb-metadata-panel').waitFor();\n  assert((await page.locator('#wb-metadata-panel').textContent()).includes('Provider metadata records'));\n  equal(JSON.parse(await page.locator('#wb-metadata-json').textContent()),metadata);\n  const reviewFile=join(config.output,'WorldBank_Recurring_Review.json');\n  try{equal(JSON.parse(await readFile(reviewFile,'utf8')),prepared.answer.review);}\n  catch(e){if(e.code!=='ENOENT')throw e;const pending=page.waitForEvent('download');\n   await page.getByRole('button',{name:'Download review JSON',exact:true}).click();const download=await pending;\n   const staged=reviewFile+'.download-'+randomUUID();await download.saveAs(staged);assert.equal(await download.failure(),null);\n   equal(JSON.parse(await readFile(staged,'utf8')),prepared.answer.review);\n   const handle=await open(staged,'r');try{await handle.sync();}finally{await handle.close();}\n   try{await link(staged,reviewFile);}catch(e){if(e.code!=='EEXIST')throw e;equal(JSON.parse(await readFile(reviewFile,'utf8')),prepared.answer.review);}\n   await sync(config.output);await unlink(staged);await sync(config.output);}\n  downloads.push(await describe(reviewFile));\n  await capture('retained-source-and-provider-review');\n  action=await recordedAction('publish','publish',async()=>{\n   await page.locator('#wb-note').fill(config.note);\n   await page.getByRole('button',{name:'Refresh reviewed report and workbook',exact:true}).click();\n  },body=>{assert.equal(body.id,prepared.request.body.id);assert.equal(body.review_sha256,prepared.answer.review.review_sha256);assert.equal(body.note,config.note);assert.equal(body.columns,null);});\n  assert.equal(action.answer.status,'COMPLETE','Keep the actual workbook mapping choice if this original fixture changed.');\n }else{\n  const original=await status(config.parent);\n  assert.equal(original.status,'INTERRUPTED');assert.equal(original.can_reopen,true);equal(original.accepted_edition,config.accepted);\n  await showOperation(config.parent);await capture('restored-accepted-edition');\n  action=await recordedAction('reopen','reopen',async()=>{\n   await page.getByRole('button',{name:'Create portable delivery from this accepted edition',exact:true}).click();\n  },body=>{assert.equal(body.operation_id,config.parent);assert.notEqual(body.id,config.parent);});\n  assert.equal(action.answer.status,'COMPLETE');equal(action.answer.accepted_edition,config.accepted);\n  assert.equal(action.answer.parent_operation_id,config.parent);\n }\n await showOperation(action.request.body.id);await capture(config.mode+'-complete');\n for(const file of action.answer.result.files)await receiveDownload(file);\n const replay=await request(action.request.path,action.request.body);equal(replay,action.answer);\n assert.equal(errors.length,0,JSON.stringify(errors));\n outcome={schema:'stellar-forge.worldbank-programme-browser-receiving.v1',status:'COMPLETE',binding:config.binding,mode:config.mode,operation_id:action.request.body.id,request:action.request,operation:action.answer,exact_request_replayed:true,images,downloads,errors};\n }\n} finally {\n if(browser){for(;;){try{await browser.close();break;}catch(e){announce({state:'AWAITING_ORIGINAL_BROWSER_CLOSE',error:String(e)});await sleep(2000);}}}\n}\nawait save('browser-complete.json',outcome);announce({state:'WORLD_BANK_PROGRAMME_BROWSER_COMPLETE',mode:config.mode,operation:outcome.operation_id});\n"


def _observe(value):
    try:
        print(json.dumps(value, ensure_ascii=False), flush=True)
    except (OSError, ValueError):
        pass


def _retain(label, action):
    previous = None
    while True:
        try:
            return action()
        except OSError as error:
            current = (type(error).__name__, str(error))
            if current != previous:
                _observe({"state": "AWAITING_ORIGINAL_RECEIVING_RETENTION", "label": label, "error": current})
                previous = current
            time.sleep(2)


def _read(path):
    return json.loads(regular(path, 64 * 1024 * 1024))


def _file(path):
    path = Path(path)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        before = os.fstat(fd)
        require(stat.S_ISREG(before.st_mode), "Keep the original regular receiving file.")
        with os.fdopen(fd, "rb", closefd=False) as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        after = os.fstat(fd)
        require((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) ==
                (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns),
                "The receiving file changed during its read.")
        return {"path": str(path), "bytes": before.st_size, "sha256": digest}
    finally:
        os.close(fd)


def _verify_browser(result, binding):
    require(result["status"] == "COMPLETE" and result["binding"] == binding,
            "Keep the complete original browser phase.")
    for row in result["images"] + result["downloads"]:
        require(_file(row["path"]) == row, "A complete original browser output changed.")
    return result


def _business(workspace):
    """Compare original customer definitions/history and non-delivery native jobs."""
    with workspace.database._connection(readonly=True) as db:
        db.execute("BEGIN")
        tables = [row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
                  if row[0].startswith(("sf_analysis_queries", "sf_analysis_query_history",
                                        "sf_analysis_report", "sf_analysis_workbook"))]
        converted = lambda row: {key: value.hex() if isinstance(value, bytes) else value
                                 for key, value in dict(row).items()}
        result = {table: [converted(row) for row in db.execute(
                    "SELECT * FROM " + sql_identifier(table) + " ORDER BY rowid")] for table in tables}
        result["business_jobs"] = [converted(row) for row in db.execute(
            "SELECT * FROM sf_analysis_jobs WHERE kind NOT IN ('change-export','report-export','workspace-export') ORDER BY sequence")]
    result["views"] = workspace.database.view_bindings()
    return result


def _values(workspace, view, candidate):
    with zipfile.ZipFile(io.BytesIO(regular(candidate))) as archive:
        columns, rows = typed_rows(archive.read("dataset.csv"), json.loads(archive.read("dataset.json")))
    projection = ",".join(
        ("CASE " + sql_identifier(column) + " WHEN 1 THEN 'true' WHEN 0 THEN 'false' END AS " +
         sql_identifier(column)) if column == "aggregate" else sql_identifier(column) for column in columns)
    result = workspace.database.query("SELECT " + projection + " FROM " + sql_identifier(view),
        max_rows=max(1000, len(rows) + 1), expected_views=workspace.database.view_bindings())
    canonical = lambda entries: sorted(json.dumps(row, ensure_ascii=False, sort_keys=True,
                                                  separators=(",", ":")) for row in entries)
    expected = [{key: ("true" if value else "false") if type(value) is bool else value
                 for key, value in row.items()} for row in rows]
    actual = [dict(zip(result.columns, row)) for row in result.rows]
    require(not result.truncated and canonical(actual) == canonical(expected),
            "The original complete World Bank values changed.")
    return {"rows": len(rows), "columns": columns, "sha256": sha(encoded(canonical(actual)))}


def _session(directory, phase, base, runtime, family_path, script, *, core):
    """One original browser child, original server and unchanged owned family."""
    output = private_directory(base / phase, create=True)
    binding = {**runtime["binding"], "phase": phase, "workspace": str(directory)}
    finished = output / "browser-complete.json"
    current = output / "current.json"
    previous = None
    if current.exists():
        old = _read(current)
        require(old.get("binding") == binding and
                re.fullmatch(r"[a-f0-9]{32}", old.get("attempt", "")) is not None,
                "Keep the exact original browser attempt selection.")
        ended = output / old["attempt"] / "closed.json"
        require(ended.exists(), "Reconcile the original browser family before continuing.")
        previous = _read(ended)
        require(previous.get("attempt") == old["attempt"] and previous.get("binding") == binding and
                previous.get("state") == "CLOSED" and
                (previous.get("family") is None or previous["family"].get("state") == "CLOSED") and
                (previous.get("main") is None or
                 type(previous["main"].get("pid")) is int and type(previous["main"].get("exitCode")) is int),
                "Keep the complete original main-child and family closure.")
        _retain("reconcile completed original browser attempt", lambda: write(current, encoded(previous)))
    if finished.exists():
        require(previous is not None and previous.get("main") is not None and
                previous["main"]["exitCode"] == 0 and previous.get("family") is not None and
                previous["family"]["state"] == "CLOSED",
                "Retain actual original child/family closure before accepting a browser return.")
        return _verify_browser(_read(finished), binding)
    attempt = uuid.uuid4().hex
    attempt_root = private_directory(output / attempt, create=True)
    state = {"binding": binding, "attempt": attempt, "state": "PREPARED"}
    _retain("original browser selection", lambda: write(current, encoded(state)))
    spec = importlib.util.spec_from_file_location("worldbank_original_process_family", family_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    scope = module.ProcessFamily("WORLDBANK-PROGRAMMES-" + runtime["binding"]["operation_id"] + "-" + phase)
    workspace = server = thread = child = stdout = stderr = None
    stopped, handlers = [], {}
    failure = None
    main = None

    def stop(number, frame):
        stopped.append(number)
        if child is not None and child.poll() is None:
            try:
                child.send_signal(signal.SIGTERM)
            except ProcessLookupError:
                pass

    try:
        scope.__enter__()
        for number in (signal.SIGINT, signal.SIGTERM):
            handlers[number] = signal.getsignal(number)
            signal.signal(number, stop)
        workspace = AnalysisWorkspace(directory, worldbank_core=core)
        server, control, url = serve(workspace, port=0)
        thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.1})
        thread.start()
        config = {**runtime, "mode": phase, "url": url, "output": str(output), "binding": binding}
        config_path = output / "browser-input.json"
        _retain("actual private browser input", lambda: write(config_path, encoded(config)))
        require(not stopped, "Stop requested before original browser launch.")
        stdout = open(attempt_root / "stdout.log", "xb", buffering=0)
        stderr = open(attempt_root / "stderr.log", "xb", buffering=0)
        child = subprocess.Popen([runtime["node"], str(script), str(config_path)],
            stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr,
            env=dict(os.environ, PYTHONDONTWRITEBYTECODE="1"))
        state.update(state="RUNNING", pid=child.pid)
        _retain("original browser PID", lambda: write(current, encoded(state)))
        if stopped and child.poll() is None:
            child.send_signal(signal.SIGTERM)
        child.wait()
    except BaseException as error:
        failure = {"type": type(error).__name__, "message": str(error)}
    finally:
        if child is not None:
            if failure and child.poll() is None:
                try:
                    child.send_signal(signal.SIGTERM)
                except ProcessLookupError:
                    pass
            while True:
                try:
                    child.wait()
                    break
                except BaseException as error:
                    _observe({"state": "AWAITING_ORIGINAL_BROWSER_CHILD", "error": str(error)})
                    time.sleep(2)
            main = {"pid": child.pid, "exitCode": child.returncode}
        # No new work is admitted before the existing coordinator drains.
        for number in (signal.SIGINT, signal.SIGTERM):
            signal.signal(number, signal.SIG_IGN)
        if server is not None:
            while True:
                try:
                    if thread is not None and thread.ident is not None:
                        server.shutdown()
                        thread.join()
                    server.server_close()
                    break
                except BaseException as error:
                    _observe({"state": "AWAITING_ORIGINAL_ANALYSIS_SERVER_CLOSE", "error": str(error)})
                    time.sleep(2)
        if workspace is not None:
            while True:
                try:
                    workspace.close()
                    break
                except BaseException as error:
                    _observe({"state": "AWAITING_ORIGINAL_ANALYSIS_CLOSE", "error": str(error)})
                    time.sleep(2)
        while scope.entered and not scope.closed:
            try:
                scope.close()
            except BaseException as error:
                _observe({"state": "AWAITING_ORIGINAL_BROWSER_FAMILY", "error": str(error)})
                time.sleep(2)
        for stream in (stdout, stderr):
            if stream is not None:
                _retain("closed browser output", lambda stream=stream: os.fsync(stream.fileno()))
                _retain("close browser output", stream.close)
        closed = json.loads(encoded({**state, "state": "CLOSED", "main": main,
            "family": scope.report if scope.entered else None, "failure": failure, "stops": stopped}))
        _retain("original browser and family closure", lambda: write(attempt_root / "closed.json", encoded(closed), exact=True))
        _retain("original current closure", lambda: write(current, encoded(closed)))
        for number, handler in handlers.items():
            signal.signal(number, handler)
    require(failure is None and main is not None and main["exitCode"] == 0 and
            closed["family"]["state"] == "CLOSED",
            "Continue the same original browser phase after reading its retained logs.")
    return _verify_browser(_read(finished), binding)


def receive_programmes(original, candidate, core, directory, operation_id, *,
                       node, playwright, chromium, process_family, source_commit, resume=False):
    os.umask(0o077)
    root = private_directory(Path(directory).expanduser().absolute(), create=True)
    base = private_directory(root / "programme-receiving", create=True)
    require(re.fullmatch(r"[a-f0-9]{40}", source_commit) is not None,
            "Select the actual complete published source commit.")
    runtime_paths = {key: Path(value).expanduser().absolute()
                     for key, value in (("node", node), ("playwright", playwright), ("chromium", chromium),
                                        ("process_family", process_family))}
    for path in runtime_paths.values():
        require(path.resolve() == path and path.is_file(), "Select original real runtime files.")
    family = _file(runtime_paths["process_family"])
    require(family["bytes"] == FAMILY_BYTES and family["sha256"] == FAMILY_SHA,
            "Use the unchanged original process-family helper.")
    lock = os.open(base / "receiving.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        info = os.fstat(lock)
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and not info.st_mode & 0o077,
                "Keep the original private programme receiving lease.")
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return _receive(original, Path(candidate), Path(core), root, base, operation_id,
                        runtime_paths, family, source_commit, resume)
    finally:
        os.close(lock)


def _receive(original, candidate, core, root, base, operation_id, runtime_paths, family, source_commit, resume):
    customer = root / "customer"
    require(original["status"] == "COMPLETE" and original["intent"]["operation_id"] == operation_id and
            original["intent"]["candidate_sha256"] == sha(regular(candidate)),
            "Continue the original completed recurring course and its actual candidate handover.")
    original_review_path = customer / "worldbank-analysis" / original["recurring_operation"] / "recurring-review.json"
    original_review = _read(original_review_path)
    require(original_review.get("metadata_review") is not None,
            "Keep the complete original A/B provider metadata and review comparison.")
    binding = {"operation_id": operation_id, "source_commit": source_commit,
               "original_recurring_review_sha256": sha(regular(original_review_path)),
               "candidate_sha256": original["intent"]["candidate_sha256"],
               "original_receiving_sha256": sha(regular(root / "recurring-receiving.json")),
               "helper": _file(Path(__file__).resolve()), "browser_sha256": sha(BROWSER_SOURCE.encode()),
               "family": family, "runtime": {name: _file(path) for name, path in runtime_paths.items() if name != "process_family"}}
    _retain("original complete receiving selection", lambda: write(base / "intent.json", encoded(binding), exact=True))
    final = base / "programme-receiving.json"
    if final.exists():
        result = _read(final)
        require(result["binding"] == binding, "Keep the original complete programme receiving selection.")
        for browser in (result["intake_browser"], result["customer_browser"], result["restored_browser"]):
            _verify_browser(browser, browser["binding"])
        return result
    script = base / "programme-browser.mjs"
    _retain("original full browser source", lambda: write(script, BROWSER_SOURCE.encode(), exact=True))
    intake_runtime = {"binding": binding, "candidate": _file(candidate.resolve(strict=True)),
                      "node": str(runtime_paths["node"]), "playwright": str(runtime_paths["playwright"]),
                      "chromium": str(runtime_paths["chromium"]), "resume": resume}
    intake_browser = _session(customer, "intake", base, intake_runtime,
                              runtime_paths["process_family"], script, core=core)
    edits = _read(root / "customer-edits.json")
    before_path = base / "customer-before.json"
    workspace = AnalysisWorkspace(customer, worldbank_core=core)
    try:
        if before_path.exists():
            before = _read(before_path)
        else:
            before = {"query": workspace.saved_query(edits["query"]["name"]),
                      "report": workspace.reports.definition(edits["report_name"]),
                      "workbook": workspace.workbooks.definition(edits["workbook_name"]),
                      "values": _values(workspace, edits["view"], candidate)}
            _retain("original current customer basis", lambda: write(before_path, encoded(before), exact=True))
        before_cursor, sources = None, []
        while True:
            page = workspace.worldbank_programmes.sources(before=before_cursor)
            sources.extend(page["sources"])
            before_cursor = page["next_before"]
            if before_cursor is None:
                break
        choices = [row for row in sources if row["handover"]["sha256"] == binding["candidate_sha256"]]
        require(choices, "Use the actual registered candidate document from the existing recurring course.")
        source = intake_browser["source"]
        selected = next((row for row in choices if row["name"] == source["name"] and
                         row["revision"] == source["revision"]), None)
        require(selected is not None and selected["document_id"] == intake_browser["intake"]["result"]["source"]["document_id"],
                "Use the exact source registered by the original browser intake.")
    finally:
        workspace.close()
    name = "recurring_" + operation_id[:16]
    definition = {"title": "Existing World Bank customer programme", "view": edits["view"],
                  "report": edits["report_name"], "workbook": edits["workbook_name"],
                  "keys": ["source_id", "country_id", "country_iso3", "indicator_id", "period"], "prefix": "monitor"}
    selection_path = base / "programme-selection.json"
    proposed_selection = {"name": name, "definition": definition, "source": source,
                          "note": "Reviewed the same actual retained candidate edition in the customer's live programme."}
    if selection_path.exists():
        selected_programme = _read(selection_path)
        require(selected_programme["name"] == name and selected_programme["definition"] == definition and
                selected_programme["note"] == proposed_selection["note"] and
                selected_programme["source"] == source and
                any(row["name"] == selected_programme["source"]["name"] and
                    row["revision"] == selected_programme["source"]["revision"] for row in choices),
                "Keep the original programme and exact registered source revision.")
    else:
        selected_programme = proposed_selection
        _retain("original registered programme source", lambda: write(selection_path, encoded(selected_programme), exact=True))
    runtime = {**selected_programme, "candidate": intake_runtime["candidate"],
               "intake": intake_browser["intake"],
               "binding": {**binding, "programme_selection_sha256": sha(encoded(selected_programme)),
                           "intake_browser_sha256": sha(encoded(intake_browser))},
               "node": str(runtime_paths["node"]), "playwright": str(runtime_paths["playwright"]),
               "chromium": str(runtime_paths["chromium"]), "resume": resume}
    customer_browser = _session(customer, "customer", base, runtime, runtime_paths["process_family"], script, core=core)
    accepted_id = customer_browser["operation_id"]
    workspace = AnalysisWorkspace(customer, worldbank_core=core)
    try:
        status = workspace.worldbank_programmes.status(name, accepted_id)
        require(status["status"] == "COMPLETE" and status["accepted_edition"] is not None,
                "Keep the actual accepted programme edition.")
        report_current = workspace.reports.definition(edits["report_name"])
        require(workspace.saved_query(edits["query"]["name"]) == before["query"] and
                all(report_current[key] == before["report"][key] for key in ("sha256", "head_revision", "definition")),
                "The programme refresh changed the customer's saved query or report.")
        current = workspace.workbooks.definition(edits["workbook_name"])
        old, new = before["workbook"]["definition"], current["definition"]
        require(new["revision"] == old["revision"] + 1 and new["title"] == old["title"] and new["notes"] == old["notes"] and
                len(new["sheets"]) == len(old["sheets"]), "The programme changed the customer workbook layout.")
        for older, newer in zip(old["sheets"], new["sheets"]):
            require(older["name"] == newer["name"] and older["columns"] == newer["columns"],
                    "The programme changed customer worksheet names or column choices.")
            require(workspace.workbooks.source(older["source"]) == older["source"] and
                    workspace.workbooks.source(newer["source"]) == newer["source"],
                    "The original older/current complete worksheet source cannot reopen.")
        require(_values(workspace, edits["view"], candidate) == before["values"],
                "The programme changed the original complete lexical source values.")
        accepted = deepcopy(status["accepted_edition"])
    finally:
        workspace.close()
    archive = next(row for row in customer_browser["downloads"] if Path(row["path"]).name == "WorldBank_Analysis_Workspace.zip")
    portable = root / "programme-received-analysis"
    restore_id = sha((operation_id + ":programme-own-archive").encode())[:32]
    restored = restore_archive(Path(archive["path"]), portable, operation=restore_id, expected_sha256=archive["sha256"])
    workspace = AnalysisWorkspace(portable, worldbank_core=core)
    try:
        original_status = workspace.worldbank_programmes.status(name, accepted_id)
        require(original_status["status"] == "INTERRUPTED" and original_status["can_reopen"] and
                original_status["accepted_edition"] == accepted,
                "The programme's own archive must expose its accepted edition without replaying an old export.")
        require(workspace.saved_query(edits["query"]["name"]) == before["query"] and
                workspace.reports.definition(edits["report_name"]) == report_current and
                workspace.workbooks.definition(edits["workbook_name"]) == current,
                "The programme's own delivered archive lost current customer definitions.")
        require(_values(workspace, edits["view"], candidate) == before["values"],
                "The received original source values differ.")
        business_before = _business(workspace)
    finally:
        workspace.close()
    restored_runtime = {**runtime, "parent": accepted_id, "accepted": accepted}
    restored_browser = _session(portable, "restored", base, restored_runtime,
                                runtime_paths["process_family"], script, core=core)
    workspace = AnalysisWorkspace(portable, worldbank_core=core)
    try:
        require(_business(workspace) == business_before,
                "Fresh portable delivery replayed or changed an accepted business job or customer definition.")
        parent = workspace.worldbank_programmes.status(name, accepted_id)
        delivered = workspace.worldbank_programmes.status(name, restored_browser["operation_id"])
        require(parent["status"] == "INTERRUPTED" and delivered["status"] == "COMPLETE" and
                delivered["parent_operation_id"] == accepted_id and delivered["accepted_edition"] == accepted,
                "Keep the separate original interrupted and new completed delivery identities.")
        require(_values(workspace, edits["view"], candidate) == before["values"],
                "New portable delivery changed original source values.")
        for sheet in old["sheets"] + new["sheets"]:
            require(workspace.workbooks.source(sheet["source"]) == sheet["source"],
                    "The earlier or current source cannot reopen after linked delivery.")
    finally:
        workspace.close()
    again = restore_archive(Path(archive["path"]), portable, operation=restore_id, expected_sha256=archive["sha256"])
    require(again.get("reused") is True, "The same original workspace receive did not reopen.")
    record = {"schema": "stellar-forge.worldbank-programme-receiving.v1", "status": "COMPLETE",
              "binding": binding, "programme": name, "intake_browser": intake_browser,
              "customer_browser": customer_browser,
              "restored_browser": restored_browser, "accepted_edition": accepted,
              "own_archive_receive": {"operation_id": restore_id, "directory": str(portable),
                                      "archive": archive, "original_receive_reused": True},
              "source_values": before["values"], "original_metadata_review": original_review["metadata_review"],
              "business_records_unchanged_by_reopen": True,
              "original_interrupted_delivery_preserved": True}
    _retain("complete original programme receiving result", lambda: write(final, encoded(record), exact=True))
    return record
