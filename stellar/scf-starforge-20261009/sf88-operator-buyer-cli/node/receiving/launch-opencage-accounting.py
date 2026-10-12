#!/usr/bin/env python3
"""Admit one original-response accounting receiving operation."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys

OPERATION = "scf-node-operation-accounting-free-a39c-20261012"
INTENT = "scf-opencage-native-customer-a39c-20261011"
RECEIVER = json.loads("\"import {readFile,lstat,realpath,mkdir,open,link,unlink} from 'node:fs/promises';\\nimport {createHash,randomUUID} from 'node:crypto';\\nimport {resolve,join,dirname} from 'node:path';\\nimport {execFile} from 'node:child_process';\\nimport {promisify,isDeepStrictEqual} from 'node:util';\\nconst exec=promisify(execFile),hash=raw=>createHash('sha256').update(raw).digest('hex');\\nconst need=(ok,code)=>{if(!ok)throw new Error(code);};\\nconst json=value=>Buffer.from(JSON.stringify(value,null,2)+'\\\\n');\\nconst [inputPath,inputSha256]=process.argv.slice(1);\\nneed(inputPath&&/^[a-f0-9]{64}$/.test(inputSha256??''),'RECEIVING_INPUT_REQUIRED');\\nconst inputRaw=await readFile(inputPath);need(hash(inputRaw)===inputSha256,'RECEIVING_INPUT_CHANGED');\\nconst input=JSON.parse(inputRaw);need(input.schema==='commons.scf-node-accounting-receiving/v1','RECEIVING_SCHEMA');\\nconst root=resolve(input.project),out=join(root,'run');\\nneed(root===input.project&&await realpath(root)===root,'RECEIVING_PROJECT_CHANGED');\\nconst manifestRaw=await readFile(input.sourceManifest),manifest=JSON.parse(manifestRaw);\\nneed(hash(manifestRaw)===input.sourceManifestSha256&&manifest.project===root,'RECEIVING_SOURCE_MANIFEST_CHANGED');\\nfor(const file of manifest.files){\\n const path=resolve(root,file.path);need(path.startsWith(root+'/')&&await realpath(path)===path,'RECEIVING_SOURCE_PATH');\\n const stat=await lstat(path),raw=await readFile(path);\\n need(stat.isFile()&&!stat.isSymbolicLink()&&raw.length===file.bytes&&hash(raw)===file.sha256,'RECEIVING_SOURCE_CHANGED');\\n const git=createHash('sha1').update(Buffer.from('blob '+raw.length+'\\\\0')).update(raw).digest('hex');\\n need(git===file.gitBlob,'RECEIVING_GIT_SOURCE_CHANGED');\\n}\\nfor(const file of Object.values(manifest.runtimePeers.packages)){\\n const raw=await readFile(file.path);need(hash(raw)===file.sha256,'RECEIVING_DEPENDENCY_CHANGED');\\n}\\nneed(await realpath(input.node)===input.node,'RECEIVING_NODE_CHANGED');\\nneed(await realpath(input.runtimeDirectory)===input.runtimeDirectory,'RECEIVING_FINANCIAL_RUNTIME_CHANGED');\\nconst originals=[];\\nfor(const file of input.original.files){\\n const raw=await readFile(file.path);need(raw.length===file.bytes&&hash(raw)===file.sha256,'ORIGINAL_BUYER_SOURCE_CHANGED');\\n originals.push({file,raw});\\n}\\nconst meta=JSON.parse(originals.find(x=>x.file.kind==='operation').raw);\\nconst cfg=JSON.parse(originals.find(x=>x.file.kind==='configuration').raw);\\nconst attempt=JSON.parse(originals.find(x=>x.file.kind==='attempt').raw);\\nneed(meta.intentId===input.intentId&&meta.runtimeDirectory===input.original.producerRuntimeDirectory&&\\n meta.configSha256===input.original.configurationSha256&&attempt.exitCode===0&&\\n cfg.operation.intentId===input.intentId&&cfg.operation.expect.maxAtomic==='0','ORIGINAL_UNPAID_ATTEMPT_CHANGED');\\nawait mkdir(out,{recursive:true,mode:0o700});need(await realpath(out)===out,'RECEIVING_OUTPUT_CHANGED');\\nasync function retain(path,raw){\\n try{need((await readFile(path)).equals(raw),'RECEIVING_OUTPUT_CONFLICT');return;}catch(error){if(error.code!=='ENOENT')throw error;}\\n const temp=path+'.tmp-'+randomUUID();let handle;\\n try{\\n  handle=await open(temp,'wx',0o600);await handle.writeFile(raw);await handle.sync();await handle.close();handle=null;\\n  try{await link(temp,path);}catch(error){if(error.code!=='EEXIST')throw error;need((await readFile(path)).equals(raw),'RECEIVING_OUTPUT_CONFLICT');}\\n  const parent=await open(dirname(path),'r');try{await parent.sync();}finally{await parent.close();}\\n }finally{if(handle)await handle.close();await unlink(temp).catch(error=>{if(error.code!=='ENOENT')throw error;});}\\n}\\nconst controller=new AbortController(),abort=()=>controller.abort();\\nprocess.once('SIGTERM',abort);process.once('SIGINT',abort);\\nconst shared=['--runtime',input.runtimeDirectory,'--state',input.stateDirectory,'--intent',input.intentId];\\nasync function run(action,args=[]){\\n const result=await exec(input.node,[input.example,action,...shared,...args],{\\n  cwd:root,encoding:'utf8',maxBuffer:4194304,timeout:480000,signal:controller.signal});\\n return JSON.parse(result.stdout);\\n}\\ntry{\\n const prior=await run('recover');\\n let result=prior?.lastComplete??null;\\n if(!result){\\n  need(prior===null,'ORIGINAL_ACCOUNTING_COMMAND_REQUIRES_RECONCILIATION');\\n  result=await run('finalize');\\n }\\n need(result.native.kind==='UNPAID_RESPONSE'&&result.native.result.outcome==='NO_PAYMENT_REQUIRED'&&\\n result.native.approvedRequestSha256===null&&result.native.recordAuthority==='ORIGINAL_UNSIGNED_RESPONSE',\\n 'ORIGINAL_UNPAID_ACCOUNTING_RESULT_REQUIRED');\\n need(result.native.identity.intentId===input.intentId&&\\n result.native.identity.producerRuntimeDirectory===input.original.producerRuntimeDirectory&&\\n result.native.accountingRuntimeDirectory===input.runtimeDirectory&&\\n result.native.identity.configurationSha256===input.original.configurationSha256,\\n 'ACCOUNTING_SOURCE_IDENTITY_CHANGED');\\n const view=await run('recover',['--command',result.commandId]);\\n need(view?.latest?.commandId===result.commandId&&view.latest.result&&\\n isDeepStrictEqual(view.latest.result.native,result.native),'ACCOUNTING_REOPEN_CHANGED');\\n const exportPath=join(out,'Operation_Accounting.json');\\n let exported;\\n try{\\n  const raw=await readFile(exportPath);exported={path:exportPath,bytes:raw.length,sha256:hash(raw)};\\n }catch(error){if(error.code!=='ENOENT')throw error;\\n  exported=await run('export',['--command',result.commandId,'--output',exportPath]);}\\n const exportRaw=await readFile(exportPath),document=JSON.parse(exportRaw);\\n need(exportRaw.length===exported.bytes&&hash(exportRaw)===exported.sha256&&\\n document.schema==='stellar-forge.node-operation-accounting-export.v1'&&\\n document.intentId===input.intentId&&document.commandId===result.commandId&&\\n isDeepStrictEqual(document.result.native,result.native)&&\\n document.contextSha256===result.native.contextSha256&&\\n hash(json(document.context))===result.native.contextSha256,'ACCOUNTING_EXPORT_CHANGED');\\n for(const name of ['attempt','evidence']){\\n  const original=input.original.files.find(f=>f.kind===name),saved=document.source[name],raw=Buffer.from(saved.base64,'base64');\\n  need(saved.base64===raw.toString('base64')&&raw.length===original.bytes&&\\n   hash(raw)===original.sha256&&saved.bytes===original.bytes&&saved.sha256===original.sha256,\\n   'ACCOUNTING_EXPORTED_ORIGINAL_CHANGED');\\n }\\n for(const {file,raw} of originals){\\n  need((await readFile(file.path)).equals(raw),'ORIGINAL_BUYER_SOURCE_MUTATED');\\n  await retain(join(out,file.outputName),raw);\\n }\\n await retain(join(out,'Source_Manifest.json'),manifestRaw);\\n await retain(join(out,'Accounting_View.json'),json(view));\\n const files=[];\\n for(const name of [...input.original.files.map(f=>f.outputName),'Source_Manifest.json','Accounting_View.json','Operation_Accounting.json']){\\n  const raw=await readFile(join(out,name));files.push({path:name,bytes:raw.length,sha256:hash(raw)});\\n }\\n const report={schema:'commons.scf-node-accounting-receiving-result/v1',state:'COMPLETE',\\n  operationId:input.operationId,intentId:input.intentId,inputSha256,sourceManifestSha256:input.sourceManifestSha256,\\n  sourceSelections:manifest.sourceSelections,original:input.original,accounting:{\\n   commandId:result.commandId,commandDirectory:result.commandDirectory,kind:result.native.kind,\\n   outcome:result.native.result.outcome,authority:result.native.recordAuthority,\\n   producerRuntimeDirectory:result.native.identity.producerRuntimeDirectory,\\n   selectedRuntimeDirectory:result.native.accountingRuntimeDirectory,\\n   completedAt:result.native.completedAt},stages:['original-source','finalize-existing-attempt',\\n   'new-process-reopen','private-complete-export','original-bytes-preserved'],files};\\n await retain(join(out,'Accounting_Receiving.json'),json(report));\\n const reopened=JSON.parse(await readFile(join(out,'Accounting_Receiving.json')));\\n need(isDeepStrictEqual(reopened,report),'RECEIVING_REOPEN_CHANGED');\\n process.stdout.write(JSON.stringify({state:'COMPLETE',operationId:input.operationId,intentId:input.intentId,\\n  commandId:result.commandId,outcome:result.native.result.outcome,files:files.length,\\n  report:join(out,'Accounting_Receiving.json')})+'\\\\n');\\n}finally{\\n process.removeListener('SIGTERM',abort);process.removeListener('SIGINT',abort);\\n}\\n\"")

def directory(value):
    p = Path(value).absolute()
    if p.resolve(strict=True) != p or not p.is_dir():
        raise ValueError("Use a canonical existing directory")
    return p

def regular(value):
    p = Path(value).absolute()
    if p.resolve(strict=True) != p or p.is_symlink() or not p.is_file():
        raise ValueError("Use a canonical original file")
    return p

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("input", "input-sha256", "host-root", "records-root", "peer", "worker-root", "temp-root"):
        parser.add_argument("--" + name, required=True)
    args = parser.parse_args()
    input_path = regular(args.input)
    raw = input_path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != args.input_sha256:
        raise ValueError("The selected original receiving input changed")
    value = json.loads(raw)
    if (value.get("schema") != "commons.scf-node-accounting-receiving/v1"
            or value.get("operationId") != OPERATION or value.get("intentId") != INTENT):
        raise ValueError("Select this original completed free response")
    project = directory(value["project"])
    node = regular(value["node"])
    manifest = regular(value["sourceManifest"])
    if hashlib.sha256(manifest.read_bytes()).hexdigest() != value["sourceManifestSha256"]:
        raise ValueError("The selected implementation manifest changed")
    selected = json.loads(manifest.read_bytes())
    if selected.get("project") != str(project):
        raise ValueError("The implementation manifest belongs to another project")
    example = regular(value["example"])
    source = directory(project / "source")
    financial_source = directory(project / "financial-source")
    runtime = directory(value["runtimeDirectory"])
    state = directory(value["stateDirectory"])
    producer = directory(value["original"]["producerRuntimeDirectory"])
    for p in (input_path, manifest, example, runtime):
        if p == project or not p.is_relative_to(project):
            raise ValueError("Keep the receiving implementation and input in the selected project")
    if not example.is_relative_to(source) or not runtime.is_relative_to(financial_source):
        raise ValueError("Preserve the selected SDK and original financial runtime")
    operation = directory(value["original"]["operationDirectory"])
    if operation.parent != state or operation.name != hashlib.sha256(INTENT.encode()).hexdigest():
        raise ValueError("Preserve the original Buyer operation directory")
    host = directory(args.host_root)
    sys.path.insert(0, str(host))
    from native_foreground import ForegroundLaunch, load_native
    native = load_native(host)
    dependencies = directory(selected["runtimePeers"]["dependencyRoot"])
    command = [str(node), "--input-type=module", "-e", RECEIVER, str(input_path), args.input_sha256]
    values = argparse.Namespace(
        operation_id=OPERATION, peer=args.peer, project=str(project),
        command=command, java=None, node=None,
        artifact=[input_path.relative_to(project).as_posix(), manifest.relative_to(project).as_posix()],
        artifact_on_success=["run"], artifact_on_failure=["run"],
        retain_artifacts=True, records_root=str(Path(args.records_root).resolve()),
        worker_root=str(directory(args.worker_root)), temp_root=str(directory(args.temp_root)),
        runtime_path=sorted({str(host), str(source), str(financial_source), str(node),
                             str(producer), str(state), str(dependencies)}),
        runtime_consumers_root=None, memory_mib=256, memory_reserve_mib=64,
        memory_reservations_root=None, memory_reclaim="clean-cache", memory_storage="included",
        disk_space=[str(project)+"=2", str(state)+"=2"],
        disk_inodes=[str(project)+"=128", str(state)+"=128"],
        disk_reserve_mib=1, disk_reserve_inodes=64, disk_reservations_root=None,
    )
    launch = ForegroundLaunch(native)
    report = native.start(values, launcher=launch)
    print(json.dumps({"operation_id":OPERATION,
                      "record":str(native.run_path(OPERATION, args.records_root)),
                      "input_sha256":args.input_sha256,
                      "receiver_sha256":hashlib.sha256(RECEIVER.encode()).hexdigest(),
                      "original_native":report}), flush=True)
    if launch.root is not None:
        return launch.handoff()
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
