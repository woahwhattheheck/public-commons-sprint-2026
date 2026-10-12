
import importlib.util,json,os,pathlib,sys,tempfile,traceback,hashlib
helper=pathlib.Path(sys.argv[1]);state=pathlib.Path(sys.argv[2]);state.mkdir(parents=True,exist_ok=True,mode=0o700)
spec=importlib.util.spec_from_file_location("murrieta_current_library_upload",helper)
module=importlib.util.module_from_spec(spec);sys.modules[spec.name]=module;spec.loader.exec_module(module)
def write(path,value):
 raw=(json.dumps(value,ensure_ascii=False,sort_keys=True,indent=2)+"\n").encode()
 fd,name=tempfile.mkstemp(prefix="."+path.name+"-",dir=path.parent)
 try:
  with os.fdopen(fd,"wb") as stream:os.fchmod(stream.fileno(),0o600);stream.write(raw);stream.flush();os.fsync(stream.fileno())
  os.replace(name,path)
  fd=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY)
  try:os.fsync(fd)
  finally:os.close(fd)
 finally:
  if os.path.exists(name):os.unlink(name)
request=json.load(sys.stdin)
events=[]
class ObservedApps:
 def __init__(self):self.client=module.HostedAppsClient()
 def call_tool(self,connector,name,payload):
  row={"tool":name,"state":"STARTED","request_sha256":hashlib.sha256(json.dumps(payload,sort_keys=True,separators=(",",":")).encode()).hexdigest()}
  events.append(row);write(state/"calls.json",events)
  try:result=self.client.call_tool(connector,name,payload)
  except BaseException as error:
   row.update(state="RETURN_UNAVAILABLE",error_type=type(error).__name__,error=str(error));write(state/"calls.json",events);raise
  row.update(state="RETURNED",response_sha256=hashlib.sha256(json.dumps(result,sort_keys=True,separators=(",",":")).encode()).hexdigest())
  if name=="finalize_uploads":
   row["response"]=result
  write(state/"calls.json",events)
  return result
try:
 workflow=module.LibraryUploadWorkflow(apps_client=ObservedApps(),materializer=module.LibraryFileMaterializer(),uploader=module.SignedUrlUploader(),state_parent=state)
 result=workflow.run(request);write(state/"helper-result.json",result);print(json.dumps(result,separators=(",",":")),flush=True)
except BaseException as error:
 write(state/"helper-error.json",{"type":type(error).__name__,"error":str(error),"traceback":traceback.format_exc()})
 raise
