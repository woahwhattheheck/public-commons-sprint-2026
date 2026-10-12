#!/usr/bin/env python3
"""Invoke the original official Library workflow in this project's private state directory."""
from pathlib import Path
import hashlib,importlib.util,json,os,stat,sys
ROOT=Path(__file__).resolve().parents[1]
HELPERS=Path("/workspace/scratch/7de2cd02ad5f/newton-corpus-continuation/library-native-20261012")
PINS={"library_upload.py":"5bc473dadefe1f68ee8797baaed19d6662642d0ea4bcba128fa12938faa0d767",
 "library_hosted_apps.py":"97d029b097ace62b744c82dfde20ef6921ed543a33a771ecf6452bd655d11b59",
 "library_file_transfer.py":"5e1557817be17db06e2375f8c34ed83e948d520242e5ee4cb50a30c7a4c83378"}
os.umask(0o077)
for name,sha in PINS.items():
 path=HELPERS/name
 if path.resolve()!=path or not stat.S_ISREG(path.lstat().st_mode):
  raise ValueError("Keep the original official upload source")
 if hashlib.sha256(path.read_bytes()).hexdigest()!=sha:
  raise ValueError("The original official upload source changed")
sys.path.insert(0,str(HELPERS))
spec=importlib.util.spec_from_file_location("_analysis_original_library_upload",HELPERS/"library_upload.py")
module=importlib.util.module_from_spec(spec)
sys.modules[spec.name]=module
spec.loader.exec_module(module)
state=ROOT/"library-state"
state.mkdir(mode=0o700,exist_ok=True)
info=state.lstat()
if state.resolve()!=state or not stat.S_ISDIR(info.st_mode) or info.st_mode&0o077 or info.st_uid!=os.geteuid():
 raise ValueError("Keep the private original uploader state")
for path in (state,state.parent):
 descriptor=os.open(path,os.O_RDONLY|os.O_DIRECTORY)
 try:os.fsync(descriptor)
 finally:os.close(descriptor)
request=json.load(sys.stdin)
workflow=module.LibraryUploadWorkflow(apps_client=module.HostedAppsClient(),
 materializer=module.LibraryFileMaterializer(),uploader=module.SignedUrlUploader(),state_parent=state)
result=workflow.run(request)
print(json.dumps(result),flush=True)
