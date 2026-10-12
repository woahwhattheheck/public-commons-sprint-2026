#!/usr/bin/env python3
"""Continue the saved Aviary application directly with its original runtime and tool saves."""
from __future__ import annotations
import argparse,ast,contextlib,hashlib,json,os,sys,traceback
from pathlib import Path

def run_lean_aviary(value):
 operation="AVIARY-COMPLETE-DELIVERY-6BA15-20261012"
 def need(ok,message):
  if not ok:raise RuntimeError(message)
 def sha(raw):return hashlib.sha256(raw).hexdigest()
 def emit(event,**data):print(json.dumps({"event":event,"operation":operation,**data},ensure_ascii=False),flush=True)
 need(value.get("schema")=="commons.aviary.newhost-original-continuation.v6","Unknown complete original Aviary input")
 source_keys=("runtimeSource","bridgeSource","releaseSource","entryText","runtimeArchiveSource")
 for key in source_keys:ast.parse(value[key],filename=key+".py")
 self_raw=Path("/proc/self/stat").read_text()
 boot=Path("/proc/sys/kernel/random/boot_id").read_text().strip()
 emit("AVIARY_LEAN_CONTINUATION_STARTED",namespacePid=os.getpid(),procSelfStat=self_raw.strip(),
      bootId=boot,originalCheckpointSha256=value["checkpoint"]["sha256"],
      runtimeCopiesBeforeBrowser=0,runtimeDownloadsBeforeBrowser=0)
 prior=[
  (70551,132093,693581,"c79cf85a537de2f71605724359e444f847d8b53fe455d45f34434295e60f5393"),
  (53559,112388,632707,"0bb6fb46dd929b6252deb5aa99eae4847f5887238c6c93d87a38e8a6e77541bd"),
  (30165,75903,553061,"161cf5eae51eebf5b788e7914dc7a246cec49a68b8938e7e6a5825a84ea12aca")]
 observations=[]
 for session,pid,ticks,source_sha in prior:
  item={"session":session,"hostPid":pid,"startTicks":ticks,"bootstrapSha256":source_sha,
        "originalBootId":"bcc80c23-bcac-4c6b-8daa-1f97825fc4ae"}
  if boot!=item["originalBootId"]:item["status"]="ORIGINAL_BOOT_ENDED"
  else:
   try:
    root=Path("/proc")/str(pid);raw=(root/"stat").read_text();fields=raw[raw.rfind(")")+2:].split()
    command=(root/"cmdline").read_bytes().rstrip(b"\0").split(b"\0")
    matches=int(fields[19])==ticks and len(command)==4 and command[1:3]==[b"-B",b"-c"] and sha(command[3])==source_sha
    item.update(status="ORIGINAL_PROCESS_PRESENT" if matches and fields[0]!="Z" else "ORIGINAL_PROCESS_ENDED",
                observedState=fields[0],observedStartTicks=int(fields[19]))
    need(not (matches and fields[0]!="Z"),"An original Aviary producer is still live; retain that lifetime without dispatch")
   except FileNotFoundError:item["status"]="ORIGINAL_PROCESS_ABSENT"
  observations.append(item)
 emit("ORIGINAL_AVIARY_PRODUCERS_RECONCILED",observations=observations,providerDispatches=0)
 namespace={"__name__":"aviary_original_continuation","__file__":"continue_original_aviary.py",
            "AVIARY_INPUT_RAW":value["inputText"].encode(),"AVIARY_HISTORY_RAW":value["historyText"].encode(),
            "AVIARY_CHECKPOINT":value["checkpoint"],"AVIARY_TRANSFER":value.get("transfer"),
            "AVIARY_ENTRY_SOURCE":value["entryText"],"AVIARY_NEW_HOST_VALUE":value}
 exec(compile(value["runtimeSource"],"aviary_lean_runtime.py","exec"),namespace)
 exec(compile(value["bridgeSource"],"aviary_official_library_save.py","exec"),namespace)
 exec(compile(value["releaseSource"],"aviary_completed_lock_release.py","exec"),namespace)
 runtime_context=namespace["restore_current_aviary_runtime"](value)
 original_bridge_install=namespace["install_aviary_library_tool_bridge"]
 def install_runtime_and_save_bridge(producer):
  original_bridge_install(producer)
  namespace["install_aviary_runtime_selection"](producer,value,runtime_context)
 namespace["install_aviary_library_tool_bridge"]=install_runtime_and_save_bridge
 history=Path("/dev/aviary-complete-final-6ba15/producer-source/history-86320")
 history.mkdir(parents=True,exist_ok=True,mode=0o700)
 retained=[
  ("lean-runtime",value["runtimeSource"].encode(),".py"),
  ("official-library-save",value["bridgeSource"].encode(),".py"),
  ("completed-lock-release",value["releaseSource"].encode(),".py"),
  ("late-runtime-preservation",value["runtimeArchiveSource"].encode(),".py"),
  ("lean-continuation",value["mainSource"].encode(),".py"),
  ("original-70551-history",value["runtimeHistoryText"].encode(),".json"),
  ("original-runtime-extra-observation",(json.dumps(value["runtimeDuplicateHistory"],sort_keys=True,indent=2)+"\n").encode(),".json"),
  ("retained-runtime-owner-receipt",(json.dumps(value["existingRuntimeArtifact"],sort_keys=True,indent=2)+"\n").encode(),".json"),
  ("previous-runtime-admissions",(json.dumps(value["priorNativeAdmission"],sort_keys=True,indent=2)+"\n").encode(),".json"),
  ("original-producer-observation",(json.dumps(observations,sort_keys=True,indent=2)+"\n").encode(),".json")]
 for name,raw,suffix in retained:
  target=history/(name+"-"+sha(raw)+suffix)
  if target.exists():need(not target.is_symlink() and target.read_bytes()==raw,"An original continuation source/history differs")
  else:
   with open(target,"xb") as output:output.write(raw);output.flush();os.fsync(output.fileno())
 try:
  exec(compile(value["entryText"],"continue_original_aviary.py","exec"),namespace)
 except BaseException as error:
  emit("AVIARY_CONTINUATION_PAUSED",error=type(error).__name__,message=str(error),
       traceback=traceback.format_exc(),namespacePid=os.getpid(),procSelfStat=Path("/proc/self/stat").read_text().strip())
  raise
 emit("AVIARY_APPLICATION_DELIVERY_FINISHED",originalCheckpointSha256=value["checkpoint"]["sha256"])
 if value.get("saveOfficialRuntimeAfterApplication",False):
  exec(compile(value["runtimeArchiveSource"],"preserve_official_aviary_runtime.py","exec"),namespace)
  namespace["preserve_official_aviary_runtime"](value,namespace)
 else:
  emit("OFFICIAL_BROWSER_RUNTIME_REUSED",existingOwnerReceipt=value["existingRuntimeArtifact"],newRuntimeDownloads=0,newRuntimeSaves=0)
 emit("AVIARY_CONTINUATION_FINISHED")

if __name__=="__main__":
 selected=globals().get("AVIARY_LEAN_VALUE")
 if selected is None:
  parser=argparse.ArgumentParser(description=__doc__)
  parser.add_argument("input",help="Complete authorized input JSON with original saved file identities")
  parser.add_argument("--python",help="Actual installed Python; must be the interpreter running this entry")
  parser.add_argument("--node",help="Actual installed Node executable")
  parser.add_argument("--playwright-module",help="Actual installed Playwright entry module")
  parser.add_argument("--browser-executable",help="Actual installed browser executable")
  arguments=parser.parse_args()
  selected=json.loads(Path(arguments.input).read_bytes())
  supplied=dict(selected.get("runtimeSelection") or {})
  for key,item in {"python":arguments.python,"node":arguments.node,"playwrightModule":arguments.playwright_module,
                   "browserExecutable":arguments.browser_executable}.items():
   if item is not None:supplied[key]=item
  selected={**selected,"runtimeSelection":supplied}
 run_lean_aviary(selected)
