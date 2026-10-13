import re

def library_name_matches(actual,requested):
 """Accept the original basename or Library's observed numbered collision name."""
 if not isinstance(actual,str) or Path(actual).name!=actual:return False
 if actual==requested:return True
 stem,suffix=os.path.splitext(requested)
 return re.fullmatch(re.escape(stem)+r"\([1-9][0-9]*\)"+re.escape(suffix),actual) is not None

def install_aviary_library_tool_bridge(n):
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
  n["pubjson"](n["SHARED"]/"receipts"/(Path(path).name+".json"),kept)
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
