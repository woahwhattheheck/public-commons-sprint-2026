import re

def library_name_matches(actual,requested):
 """Accept the original basename or Library's observed numbered collision name."""
 if not isinstance(actual,str) or Path(actual).name!=actual:return False
 if actual==requested:return True
 stem,suffix=os.path.splitext(requested)
 return re.fullmatch(re.escape(stem)+r"\([1-9][0-9]*\)"+re.escape(suffix),actual) is not None

def _install_aviary_official_local_bridge(n):
 original_finish=n["finish_saved_artifact"]
 def finish(path,kept,reused):
  if kept.get("transferSourceKind")!="official-library-local-file":
   return original_finish(path,kept,reused)
  rec=n["record"](path);n["require"](kept["source"]==rec,"Original official saved artifact bytes differ")
  evidence=Path(kept["officialToolEvidence"]["path"])
  n["require"](evidence==n["ROOT"]/"library-tool-receipts"/(Path(path).name+".response.json"),"Original official receipt path differs")
  normalized_result(kept["providerReceipt"],Path(path).name,rec["bytes"])
  raw=n["encoded"](kept["providerReceipt"])
  n["require"](len(raw)==kept["officialToolEvidence"]["bytes"] and n["sha"](raw)==kept["officialToolEvidence"]["sha256"],"Retained original official response bytes differ")
  n["publish"](evidence,raw);n["same"](kept["officialToolEvidence"],evidence)
  item=kept["result"]
  n["require"](item["local_path"]==str(path) and item["purpose"]=="create_library_file"
               and item["status"]=="succeeded" and item["file_id"] and item["library_file_id"],
               "Original official save receipt is incomplete")
  n["emit"]("ARTIFACT_SAVED",**item,bytes=rec["bytes"],sha256=rec["sha256"],reused=reused)
  try:n["pubjson"](n["SHARED"]/"receipts"/(Path(path).name+".json"),kept)
  except OSError as error:n["emit"]("SHARED_SAVE_RECEIPT_PENDING",name=Path(path).name,errorType=type(error).__name__,library_file_id=item["library_file_id"])
  return kept
 def read_command():
  line=bytearray()
  while not line.endswith(b"\n"):
   block=os.read(sys.stdin.fileno(),1)
   n["require"](block,"Official save reply input ended before its original receipt")
   line.extend(block);n["require"](len(line)<=2000000,"Official save reply exceeds its bound")
  return json.loads(line)
 def normalized_result(raw,name,size):
  n["require"](isinstance(raw,dict) and raw.get("isError") is False,"Official Library tool did not return success")
  item=raw.get("structuredContent")
  n["require"](isinstance(item,dict) and item.get("operation")=="create_library_file"
      and item.get("status")=="succeeded" and library_name_matches(item.get("file_name"),name)
      and item.get("file_size_bytes")==size and isinstance(item.get("file_id"),str)
      and item["file_id"].startswith("file_") and isinstance(item.get("library_file_id"),str)
      and item["library_file_id"].startswith("libfile_")
      and type(item.get("current_version_number")) is int,
      "Official Library returned identity/name/size/version does not match the exact staged artifact")
  return item
 def save(path):
  path=Path(path);rec=n["record"](path);name=path.name
  folder=n["ROOT"]/"library-receipts";folder.mkdir(parents=True,exist_ok=True,mode=0o700)
  journal=folder/(name+".json")
  if journal.exists():return finish(path,n["readjson"](journal),True)
  n["require"](not (folder/(name+".attempt.json")).exists(),"An original canonical upload remains unresolved; official save was not dispatched")
  bridge_root=n["ROOT"]/"library-tool-receipts";bridge_root.mkdir(parents=True,exist_ok=True,mode=0o700)
  stage=n["SHARED"]/"official-save-source"/name
  n["copy_exact"](path,stage,rec);stage_rec=n["record"](stage)
  request={"schema":"commons.aviary.official-library-local-save.v1","operation":n["OP"],
           "tool":"library_create_library_file","source":rec,"staged":stage_rec,
           "arguments":{"file":str(stage),"library_artifact_type":"other"}}
  request_sha=n["sha"](n["encoded"](request))
  intent=bridge_root/(name+".request.json");response=bridge_root/(name+".response.json")
  reused=intent.exists()
  if reused:
   n["require"](n["readjson"](intent)==request,"The retained official save request differs")
   n["require"](response.is_file(),"The original official save is unresolved; no duplicate save was requested")
  else:
   n["pubjson"](intent,request)
   n["emit"]("LIBRARY_SAVE_REQUEST",requestSha256=request_sha,name=name,source=rec,staged=stage_rec,
             arguments=request["arguments"],requestEvidence=n["record"](intent))
   command=read_command()
   n["require"](command.get("action")=="official-library-save-result" and command.get("requestSha256")==request_sha,
                "Official Library reply belongs to another original artifact")
   n["pubjson"](response,command["result"])
  raw=n["readjson"](response);selected=normalized_result(raw,name,rec["bytes"])
  n["same"](rec,path);n["same"](stage_rec,stage)
  xattrs=selected.get("xattrs",[])
  applied=[]
  for item in xattrs:
   if not isinstance(item,dict) or not isinstance(item.get("name"),str) or not isinstance(item.get("value"),str):continue
   for target in (path,stage):
    try:os.setxattr(target,item["name"],item["value"].encode());applied.append({"path":str(target),"name":item["name"],"applied":True})
    except OSError as error:applied.append({"path":str(target),"name":item["name"],"applied":False,"errno":error.errno})
  item={"local_path":str(path),"purpose":"create_library_file","status":"succeeded",
        "file_id":selected["file_id"],"library_file_id":selected["library_file_id"],"file_name":selected["file_name"],
        "current_version_number":selected.get("current_version_number",selected.get("version_number")),
        "local_metadata_applied":bool(applied) and all(x["applied"] for x in applied)}
  kept={"source":rec,"staged":stage_rec,"transferSourceKind":"official-library-local-file",
        "providerReceipt":raw,"officialToolEvidence":n["record"](response),
        "originalRequest":n["record"](intent),"result":item,"saved":n["now"](),
        "responseReconciled":reused,"xattrs":applied,
        "verification":"Supported library_create_library_file result, complete original response and exact private/staged bytes"}
  n["pubjson"](journal,kept);return finish(path,kept,reused)
 n["save_artifact"]=save;n["finish_saved_artifact"]=finish

 n["_official_saved_result"]=normalized_result
 exec(compile("def restore_receiving_checkpoint(selected):\n if selected is None:return\n require(isinstance(selected,dict) and set(selected)=={\"path\",\"bytes\",\"sha256\",\"file_id\",\"library_file_id\",\"saveReceipt\"},\n         \"The original checkpoint selection needs its exact saved source and receipt\")\n path=Path(selected[\"path\"]);require(path.is_absolute() and not path.is_symlink(),\n         \"The original checkpoint must be an already-authorized local regular file\")\n saved=selected[\"saveReceipt\"]\n require(isinstance(saved,dict) and saved.get(\"transferSourceKind\") in (\"private-original\",\"official-library-local-file\"),\n         \"The original checkpoint has no original canonical save receipt\")\n destination=Path(saved[\"source\"][\"path\"])\n require(destination.parent==ROOT/\"checkpoints\" and\n         re.fullmatch(r\"Aviary_Receiving_Checkpoint_[0-9a-f]{16}\\.zip\",destination.name),\n         \"The original saved checkpoint path differs\")\n same(selected,path)\n require(saved[\"source\"].get(\"bytes\")==selected[\"bytes\"] and saved[\"source\"].get(\"sha256\")==selected[\"sha256\"]\n         and saved[\"staged\"].get(\"bytes\")==selected[\"bytes\"] and saved[\"staged\"].get(\"sha256\")==selected[\"sha256\"],\"The original saved checkpoint identity differs\")\n if saved[\"transferSourceKind\"]==\"private-original\":\n  require(saved[\"staged\"]==saved[\"source\"],\"Original private checkpoint source differs\")\n  returned=save_result(saved[\"providerReceipt\"],destination)\n else:\n  require(saved[\"staged\"].get(\"path\")==str(SHARED/\"official-save-source\"/destination.name),\"Original official checkpoint staging path differs\")\n  returned=_official_saved_result(saved[\"providerReceipt\"],destination.name,selected[\"bytes\"])\n require(returned[\"file_id\"]==selected[\"file_id\"] and returned[\"library_file_id\"]==selected[\"library_file_id\"],\n         \"The original checkpoint's saved file IDs differ\")\n with open(path,\"rb\") as held:\n  before=os.fstat(held.fileno());require(stat.S_ISREG(before.st_mode),\"Checkpoint source is not regular\")\n  digest=hashlib.sha256()\n  for block in iter(lambda:held.read(262144),b\"\"):digest.update(block)\n  require(before.st_size==selected[\"bytes\"] and digest.hexdigest()==selected[\"sha256\"],\n          \"The held checkpoint differs from the original selected bytes\")\n  held.seek(0)\n  with zipfile.ZipFile(held) as archive:\n   infos=archive.infolist();names=[info.filename for info in infos]\n   require(len(names)==len(set(names)) and all(not info.is_dir() for info in infos),\n           \"The checkpoint contains duplicate or unexpected directory entries\")\n   for info in infos:\n    validrel(info.filename);mode=(info.external_attr>>16)&0xffff\n    require(stat.S_IFMT(mode) in (0,stat.S_IFREG),\"The checkpoint contains a nonregular member\")\n   raw=archive.read(\"DELIVERY_MEMBERS.json\");manifest=json.loads(raw)\n   require(manifest.get(\"schema\")==\"commons.aviary.complete-delivery-members.v1\"\n           and manifest.get(\"operation\")==OP\n           and manifest.get(\"kind\")==\"original-aviary-receiving-checkpoint\"\n           and manifest.get(\"phase\") in (\"BROWSER_COMPLETE_VISUAL_PENDING\",\"INTERRUPTED_RECEIVING\")\n           and manifest.get(\"root\")==str(ROOT)\n           and manifest.get(\"sourcePacketSha256\")==SOURCE_SHA\n           and manifest.get(\"nativeWorkspaceId\")==WORKSPACE_ID\n           and manifest.get(\"originalProviderOperation\")==PROVIDER_OPERATION\n           and manifest.get(\"originalArchives\")==ARCHIVES\n           and type(manifest.get(\"pixelsIncluded\")) is bool\n           and manifest.get(\"checkpointRevision\",1) in (1,2),\n           \"The checkpoint belongs to another original source or operation\")\n   if manifest.get(\"checkpointRevision\",1)==1:\n    require(manifest[\"pixelsIncluded\"] is False,\"The original v1 checkpoint unexpectedly includes QA pixels\")\n   else:\n    require(manifest.get(\"pixelPurpose\")==\"private-recovery-only\"\n            and manifest.get(\"customerPixelFilesSaved\") is False,\n            \"The checkpoint changed the retained image purpose\")\n   declared={}\n   for item in manifest[\"files\"]:\n    name=item[\"path\"];parts=validrel(name).parts\n    require(parts[0]==\"root\" and len(parts)>1 and name not in declared,\n            \"The checkpoint member left its original root or is duplicated\")\n    require(type(item[\"bytes\"]) is int and item[\"bytes\"]>=0\n            and isinstance(item[\"sha256\"],str) and re.fullmatch(r\"[0-9a-f]{64}\",item[\"sha256\"]),\n            \"Invalid checkpoint member identity\")\n    declared[name]=item\n   require(set(names)==set(declared)|{\"DELIVERY_MEMBERS.json\"},\n           \"The checkpoint inventory differs from its complete manifest\")\n   for name,item in declared.items():\n    check=hashlib.sha256();count=0\n    with archive.open(name) as stream:\n     for block in iter(lambda:stream.read(262144),b\"\"):check.update(block);count+=len(block)\n    require(count==item[\"bytes\"] and check.hexdigest()==item[\"sha256\"],\n            \"An original checkpoint member changed: \"+name)\n   if manifest[\"pixelsIncluded\"]:\n    result_name=\"root/browser-receiving/browser-receiving-result.json\"\n    require(result_name in declared,\"The private image checkpoint lacks its original browser result\")\n    model=json.loads(archive.read(result_name));screens=manifest.get(\"localQAScreenshotDescriptors\")\n    require(isinstance(screens,list) and len(screens)==4 and model.get(\"screenshots\")==screens,\n            \"The private recovery images differ from the original browser result\")\n    for item in screens:\n     original=Path(item[\"path\"])\n     require(original.is_relative_to(ROOT/\"browser-receiving\"),\n             \"A private recovery image left the original browser output\")\n     member=\"root/\"+original.relative_to(ROOT).as_posix()\n     require(member in declared and declared[member][\"bytes\"]==item[\"bytes\"]\n             and declared[member][\"sha256\"]==item[\"sha256\"],\n             \"An original private recovery PNG is missing or changed\")\n   # Verify every archive member before publishing any restored member.\n   for name,item in declared.items():\n    dest=beneath(ROOT,str(PurePosixPath(name).relative_to(\"root\")))\n    if dest.exists():same(item,dest);continue\n    dest.parent.mkdir(parents=True,exist_ok=True,mode=0o700)\n    fd,temporary=tempfile.mkstemp(prefix=\".aviary-checkpoint-\",dir=dest.parent)\n    try:\n     with archive.open(name) as source,os.fdopen(fd,\"wb\") as output:\n      shutil.copyfileobj(source,output,262144);output.flush();os.fsync(output.fileno())\n     same(item,temporary)\n     try:os.link(temporary,dest)\n     except FileExistsError:same(item,dest)\n     syncdir(dest.parent)\n    finally:\n     with contextlib.suppress(FileNotFoundError):os.unlink(temporary)\n  after=os.fstat(held.fileno())\n  require((before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns,before.st_ctime_ns)==\n          (after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns,after.st_ctime_ns),\n          \"The held checkpoint source changed during restoration\")\n copy_exact(path,destination,selected)\n pubjson(ROOT/\"library-receipts\"/(destination.name+\".json\"),saved)\n if manifest[\"phase\"]==\"BROWSER_COMPLETE_VISUAL_PENDING\":\n  metadata={key:value for key,value in manifest.items() if key not in {\"schema\",\"operation\",\"files\"}}\n  checkpoint={\"schema\":\"commons.aviary.receiving-checkpoint.v1\",\"operation\":OP,\n              \"phase\":manifest[\"phase\"],\"snapshotSha256\":sha(encoded({\"metadata\":metadata,\"files\":manifest[\"files\"]})),\n              \"source\":record(destination),\"providerReceipt\":saved,\"pixelFilesSaved\":manifest[\"pixelsIncluded\"],\n              \"browserResult\":record(ROOT/\"browser-receiving\"/\"browser-receiving-result.json\")}\n  if manifest.get(\"checkpointRevision\",1)==2:\n   checkpoint.update(pixelPurpose=\"private-recovery-only\",customerPixelFilesSaved=False)\n  pubjson(ROOT/\"checkpoints\"/(destination.name+\".receipt.json\"),checkpoint)\n  pubjson(ROOT/\"checkpoints\"/\"browser-complete-checkpoint.json\",checkpoint)\n pubjson(ROOT/\"restore\"/(\"checkpoint-\"+selected[\"sha256\"]+\".json\"),\n         {\"schema\":\"commons.aviary.checkpoint-restoration.v1\",\"operation\":OP,\n          \"source\":record(path),\"restoredMembers\":len(declared),\n          \"originalSavedFileId\":selected[\"file_id\"],\"originalLibraryFileId\":selected[\"library_file_id\"],\n          \"saveReceipt\":saved,\"newProviderInvocations\":0,\"newCheckpointUploads\":0})\n emit(\"ORIGINAL_CHECKPOINT_RESTORED\",members=len(declared),sha256=selected[\"sha256\"],\n      library_file_id=selected[\"library_file_id\"],newCheckpointUploads=0)\n","aviary_official_checkpoint_receipt.py","exec"),n)


def install_aviary_library_tool_bridge(n):
 """Keep original receipts; run the original prepared uploader over this foreground."""
 import importlib.util
 base_finish=n["finish_saved_artifact"]
 base_save=n["save_artifact"]
 _install_aviary_official_local_bridge(n)
 official_finish=n["finish_saved_artifact"]
 selected=AVIARY_NEW_HOST_VALUE.get("preparedLibraryHelpers")
 n["require"](isinstance(selected,list) and len(selected)==3,"The complete maintained Library helper graph is required")
 expected={
  "library_upload.py":(44876,"5bc473dadefe1f68ee8797baaed19d6662642d0ea4bcba128fa12938faa0d767"),
  "library_hosted_apps.py":(12576,"97d029b097ace62b744c82dfde20ef6921ed543a33a771ecf6452bd655d11b59"),
  "library_file_transfer.py":(11084,"5e1557817be17db06e2375f8c34ed83e948d520242e5ee4cb50a30c7a4c83378")}
 n["require"]({x.get("path") for x in selected}==set(expected),"The maintained Library helper names differ")
 helper_root=n["ROOT"]/"producer-source"/"library-helpers-5bc473dadefe1f68ee8797baaed19d6662642d0ea4bcba128fa12938faa0d767"
 helper_root.mkdir(parents=True,exist_ok=True,mode=0o700)
 n["require"](not helper_root.is_symlink(),"The original helper directory is a symlink")
 for item in selected:
  raw=item["content"].encode("utf-8");size,digest=expected[item["path"]]
  n["require"](len(raw)==size and n["sha"](raw)==digest and item["bytes"]==size and item["sha256"]==digest,"The maintained Library helper bytes differ")
  n["publish"](helper_root/item["path"],raw)
  existing=sys.modules.get(Path(item["path"]).stem)
  if existing is not None:
   held=Path(existing.__file__).read_bytes()
   n["require"](len(held)==size and n["sha"](held)==digest,"An existing Library helper is a different source edition")
 spec=importlib.util.spec_from_file_location("aviary_original_library_upload_5bc473",helper_root/"library_upload.py")
 n["require"](spec is not None and spec.loader is not None,"The maintained uploader cannot be imported")
 module=importlib.util.module_from_spec(spec);sys.modules[spec.name]=module;spec.loader.exec_module(module)

 def finish(path,kept,reused):
  if kept.get("transferSourceKind")=="private-original":return base_finish(path,kept,reused)
  return official_finish(path,kept,reused)

 def read_command():
  data=bytearray()
  while not data.endswith(b"\n"):
   block=os.read(sys.stdin.fileno(),1)
   n["require"](block,"Prepared Library reply ended before its original result")
   data.extend(block);n["require"](len(data)<=4000000,"Prepared Library reply exceeds its bound")
  return json.loads(data)

 def save(path):
  path=Path(path);rec=n["record"](path);name=path.name
  n["require"](path.is_relative_to(n["ROOT"]) and path.parent in (n["ROOT"]/"checkpoints",n["ROOT"]/"deliverables"),"Prepared save left the original artifact roots")
  folder=n["ROOT"]/"library-receipts";folder.mkdir(parents=True,exist_ok=True,mode=0o700)
  journal=folder/(name+".json")
  if journal.exists():return finish(path,n["readjson"](journal),True)
  if (folder/(name+".attempt.json")).exists():
   # The unchanged original recovery checks its already-dispatched subprocess.
   return base_save(path)
  legacy=n["ROOT"]/"library-tool-receipts"/(name+".request.json")
  n["require"](not legacy.exists(),"An original direct-tool request needs its retained response before another save route")
  request={"uploads":[{"local_path":str(path),"purpose":"create_library_file","library_artifact_type":"other"}]}
  transport=n["ROOT"]/"library-prepared-transfers"/name
  transport.mkdir(parents=True,exist_ok=True,mode=0o700)
  attempt=transport/"request.json";completion=transport/"workflow-result.json"
  binding={"schema":"commons.aviary.private-prepared-save.v1","operation":n["OP"],"source":rec,"request":request,
           "helperSource":{"bytes":44876,"sha256":expected["library_upload.py"][1]}}
  recovered=attempt.exists()
  if recovered:n["require"](n["readjson"](attempt)==binding,"The retained prepared source/request differs")
  else:n["pubjson"](attempt,binding)

  class OriginalForegroundClient:
   def call_tool(self,connector_id,tool_name,arguments):
    n["require"](connector_id==module._LIBRARY_CONNECTOR_ID and tool_name in ("prepare_uploads","finalize_uploads"),"The prepared workflow requested another connector/action")
    n["require"](isinstance(arguments,dict) and set(arguments)=={"uploads"} and isinstance(arguments["uploads"],list) and len(arguments["uploads"])==1,"The original ordered upload count differs")
    rows=arguments["uploads"]
    if tool_name=="prepare_uploads":
     n["require"](rows[0].get("file_name")==name and rows[0].get("file_size_bytes")==rec["bytes"] and rows[0].get("purpose")=="create_library_file" and "workspace_path" not in rows[0],"The private preparation source differs")
    else:
     prepared_response=n["readjson"](transport/"prepare_uploads.response.json")
     prepared_rows=module.LibraryUploadWorkflow._result_array(prepared_response,"uploads")
     n["require"](rows==prepared_rows,"The original opaque prepared objects changed before finalization")
    payload={"schema":"commons.aviary.foreground-library-call.v1","operation":n["OP"],"source":rec,
             "connector":connector_id,"tool":tool_name,"arguments":arguments}
    request_sha=n["sha"](n["encoded"](payload))
    intent=transport/(tool_name+".request.json");response=transport/(tool_name+".response.json")
    prior=intent.exists()
    if prior:n["require"](n["readjson"](intent)==payload,"An original prepared call changed")
    else:n["pubjson"](intent,payload)
    if not response.exists():
     n["emit"]("LIBRARY_PREPARED_TOOL_REQUEST",requestSha256=request_sha,name=name,source=rec,
               connector=connector_id,tool=tool_name,arguments=arguments,recoverOnly=prior,requestEvidence=n["record"](intent))
     command=read_command()
     n["require"](command.get("action")=="library-prepared-tool-result" and command.get("requestSha256")==request_sha and command.get("tool")==tool_name,"Prepared Library reply belongs to another original call")
     n["pubjson"](response,command["result"])
    raw=n["readjson"](response)
    n["require"](isinstance(raw,dict),"Prepared Library returned a non-object")
    if raw.get("isError") is True:raise module.HostedAppsToolError(tool_name+" failed",raw)
    if tool_name=="finalize_uploads":
     final_rows=module.LibraryUploadWorkflow._result_array(raw,"results")
     n["require"](len(final_rows)==1,"Finalized Library result count differs")
     item=final_rows[0]
     if item.get("status")=="succeeded":
      n["require"](item.get("operation")=="create_library_file" and item.get("file_id")==rows[0]["file_id"] and library_name_matches(item.get("file_name"),name),"Finalized Library identity/name differs")
      if item.get("file_size_bytes") is not None:n["require"](item["file_size_bytes"]==rec["bytes"],"Finalized Library size differs")
    return raw

  class OriginalPrivateWorkflow(module.LibraryUploadWorkflow):
   def _prepare(self,requests):
    prepared=[]
    for batch in self._prepare_batches(requests):
     payloads=[]
     for item in batch:
      n["require"](item.purpose=="create_library_file" and not item.is_shared,"The original private save selected a replacement")
      payload=dict(item.prepare_payload);payload.pop("workspace_path",None);payloads.append(payload)
     response=self.apps_client.call_tool(module._LIBRARY_CONNECTOR_ID,"prepare_uploads",{"uploads":payloads})
     rows=self._result_array(response,"uploads")
     n["require"](len(rows)==len(batch),"The original preparation count differs")
     for item,value in zip(batch,rows,strict=True):
      parsed=module.PreparedUpload.parse(item,value)
      n["require"](parsed.transfer_mode=="upload_url","The original private source requires its returned upload URL")
      # Validate through the maintained parser and preserve every opaque returned field.
      prepared.append(module.PreparedUpload(request=parsed.request,payload=dict(value),transfer_mode=parsed.transfer_mode))
    return tuple(prepared),{},frozenset()

  class OriginalRetainedUploader(module.SignedUrlUploader):
   @staticmethod
   def _upload_one(executable,upload,state_directory,environment):
    return module.SignedUrlUploader._upload_one(executable,upload,state_directory,{**environment,"AZCOPY_CONCURRENCY_VALUE":"1"})
   def upload(self,uploads,state_directory):
    marker=transport/"transfer-completed.json"
    identity={"source":rec,"preparedSha256":n["sha"](n["encoded"]([x.payload for x in uploads]))}
    n["same"](rec,path)
    if marker.exists():
     n["require"](n["readjson"](marker)==identity,"The original completed transfer identity differs")
     return {x.request.index for x in uploads}
    n["require"](not (transport/"finalize_uploads.request.json").exists(),"A finalization request exists without its transfer observation")
    succeeded=super().upload(uploads,state_directory)
    if succeeded=={x.request.index for x in uploads}:
     n["same"](rec,path);n["pubjson"](marker,identity)
    return succeeded

  if completion.exists():
   value=n["readjson"](completion);n["save_result"](value,path);recovered=True
  else:
   state=n["ROOT"]/"library-state"/name;state.mkdir(parents=True,exist_ok=True,mode=0o700)
   workflow=OriginalPrivateWorkflow(apps_client=OriginalForegroundClient(),
     materializer=module.LibraryFileMaterializer(),uploader=OriginalRetainedUploader(),state_parent=state)
   value=workflow.run(request);n["save_result"](value,path);n["same"](rec,path);n["pubjson"](completion,value)
  item=n["save_result"](value,path)
  n["require"](library_name_matches(item.get("file_name"),name),"The original finalized name differs")
  n["same"](rec,path)
  kept={"source":rec,"staged":rec,"transferSourceKind":"private-original","providerReceipt":value,
        "result":{k:item.get(k) for k in ("local_path","purpose","status","file_id","library_file_id","file_name","current_version_number","local_metadata_applied")},
        "saved":n["now"](),"responseReconciled":recovered,"workflowCompleted":True,"processExitObserved":False,"observedExitCode":None,
        "helperSource":binding["helperSource"],"preparedWorkflowResult":n["record"](completion),
        "verification":"Unchanged maintained uploader, private original bytes, exact prepared/finalized responses and original metadata writeback"}
  n["pubjson"](journal,kept)
  return finish(path,kept,recovered)

 n["save_artifact"]=save;n["finish_saved_artifact"]=finish
 n["emit"]("ORIGINAL_PREPARED_LIBRARY_BRIDGE_INSTALLED",helperBytes=44876,helperSha256=expected["library_upload.py"][1],
           sourceCopies=0,retainedOfficialReceipts=True,operations=["prepare_uploads","finalize_uploads"])
