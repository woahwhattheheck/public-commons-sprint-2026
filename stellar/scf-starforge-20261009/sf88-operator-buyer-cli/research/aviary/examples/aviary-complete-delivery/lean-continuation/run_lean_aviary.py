#!/usr/bin/env python3
"""Continue the saved Aviary application directly with its original runtime and tool saves."""
from __future__ import annotations
import ast,contextlib,hashlib,json,os,sys,traceback
from pathlib import Path

def run_lean_aviary(value):
 operation="AVIARY-COMPLETE-DELIVERY-6BA15-20261012"
 def need(ok,message):
  if not ok:raise RuntimeError(message)
 def sha(raw):return hashlib.sha256(raw).hexdigest()
 def emit(name,**data):print(json.dumps({"event":name,"operation":operation,**data},ensure_ascii=False),flush=True)
 need(value.get("schema")=="commons.aviary.newhost-original-continuation.v5","Unknown complete original Aviary input")
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
 namespace["restore_current_aviary_runtime"](value)
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
  if len(sys.argv)!=2:raise SystemExit("usage: run_lean_aviary.py /absolute/authorized-complete-input.json")
  selected=json.loads(Path(sys.argv[1]).read_bytes())
 run_lean_aviary(selected)
