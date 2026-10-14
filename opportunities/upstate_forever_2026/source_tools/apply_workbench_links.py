"""Compose the report-link opening cohort into an existing application.

Preserve unrelated concurrent edits. Preflight every new source and exact join
before writing; repeated application or interruption is resumable. No workspace,
scientific result, token, runtime, source catalogue or launcher state is read.
"""
from __future__ import annotations
import argparse
import hashlib
import os
from pathlib import Path
import tempfile

SOURCE = Path(__file__).resolve().parents[1]
SOURCE_PATHS = ['operator/workbench_links.py', 'operator/web/workbench_links.mjs', 'operator/web/workbench_links.css', 'operator/web/workbench_recovery_sw.mjs', 'operator/web/workbench_reopen.html', 'WORKBENCH_LINKS.md', 'integration/component_fragments/workbench-links.json', 'source_tools/apply_workbench_links.py']
JOINS = {'operator/server.py': [['from programme_activity import ProgrammeActivity\nfrom origin_policy import OriginPolicy, OriginError, advertised_origin as validate_advertised_origin\n\nJSON_GZIP_MIN_BYTES = 32 * 1024\n', 'from programme_activity import ProgrammeActivity\nfrom origin_policy import OriginPolicy, OriginError, advertised_origin as validate_advertised_origin\nfrom workbench_links import serve as serve_workbench_links, navigation_failure as workbench_link_failure\n\nJSON_GZIP_MIN_BYTES = 32 * 1024\n'], ['            if url.path == "/health":\n                return self.send_json(200, {"ready": not self.app.closing})\n            if url.path.startswith("/api/file/review-desk/"):\n                self.authorized(file=True)\n', '            if url.path == "/health":\n                return self.send_json(200, {"ready": not self.app.closing})\n            if serve_workbench_links(self, self.path):\n                return\n            if url.path.startswith("/api/file/review-desk/"):\n                self.authorized(file=True)\n'], ['            pass\n        except BaseException as error:\n            self.fail(error)\n\n    def do_POST(self):\n', '            pass\n        except BaseException as error:\n            if not workbench_link_failure(self, error):\n                self.fail(error)\n\n    def do_POST(self):\n']], 'operator/web/app.mjs': [["// ES-SUPERVISION-20261012\nimport {operatorFetch} from './remote_transport.mjs';\nimport {attachNativeJobs} from './jobs.mjs';\nimport {attachStartupGuide} from './startup_guide.mjs';\n", "// ES-SUPERVISION-20261012\nimport {operatorFetch} from './remote_transport.mjs';\nimport {attachWorkbenchLinks,workbenchConnection,initialWorkbenchView,currentWorkbenchURL,requestedWorkbenchView} from './workbench_links.mjs';\nimport {attachNativeJobs} from './jobs.mjs';\nimport {attachStartupGuide} from './startup_guide.mjs';\n"], ["  if(body!==undefined)headers['Content-Type']='application/json';\n  if(filename)headers['X-Upload-Filename']=encodeURIComponent(filename);\n  const response=await operatorFetch(path,{method,headers,body:raw??(body===undefined?undefined:JSON.stringify(body)),credentials:'same-origin',signal},capability);\n  const text=await response.text();\n  if(epoch!==connectionEpoch)throw Error('The connection changed while this request was running.');\n", "  if(body!==undefined)headers['Content-Type']='application/json';\n  if(filename)headers['X-Upload-Filename']=encodeURIComponent(filename);\n  let response;\n  try{response=await operatorFetch(path,{method,headers,body:raw??(body===undefined?undefined:JSON.stringify(body)),credentials:'same-origin',signal},capability);}\n  catch(error){if(!signal?.aborted)workbenchConnection(false);throw error;}\n  const text=await response.text();\n  if(epoch!==connectionEpoch)throw Error('The connection changed while this request was running.');\n"], ["  }\n  if(!response.ok){const error=new Error(value.error?.message||'HTTP '+response.status);error.code=value.error?.code;error.status=response.status;throw error;}\n  return value;\n}\n", "  }\n  if(!response.ok){const error=new Error(value.error?.message||'HTTP '+response.status);error.code=value.error?.code;error.status=response.status;throw error;}\n  workbenchConnection(true);\n  return value;\n}\n"], ["detailDialog.addEventListener('close',()=>{if(detailDialog.open||itemRequest!==detailRequest)return;itemRequest++;deliveryInspection.detach();detailContext=null;});\n$('#workspace-select').addEventListener('change',event=>selectWorkspace(event.target.value).catch(globalError));\nwindow.addEventListener('hashchange',()=>{const incoming=new URLSearchParams(location.hash.slice(1)).get('token');if(incoming){sessionStorage.setItem(keyName,incoming);sessionStorage.removeItem('upstate-selected-workspace');history.replaceState(null,'','/');location.reload();return;}const requested=location.hash.slice(1);if(viewLabels[requested]||extensions.hasView(requested))navigate(requested).catch(globalError);});\nwindow.addEventListener('online',()=>refresh({force:true}));\nfunction showConnection(message='Open your private access link or paste it below.'){\n", "detailDialog.addEventListener('close',()=>{if(detailDialog.open||itemRequest!==detailRequest)return;itemRequest++;deliveryInspection.detach();detailContext=null;});\n$('#workspace-select').addEventListener('change',event=>selectWorkspace(event.target.value).catch(globalError));\nwindow.addEventListener('hashchange',()=>{const incoming=new URLSearchParams(location.hash.slice(1)).get('token');if(incoming){const requested=requestedWorkbenchView(location);sessionStorage.setItem(keyName,incoming);sessionStorage.removeItem('upstate-selected-workspace');history.replaceState(null,'','/'+(requested?'?view='+encodeURIComponent(requested):''));location.reload();return;}const requested=location.hash.slice(1);if(viewLabels[requested]||extensions.hasView(requested))navigate(requested).catch(globalError);});\nwindow.addEventListener('online',()=>refresh({force:true}));\nfunction showConnection(message='Open your private access link or paste it below.'){\n"], ['  return;\n }\n $(\'#content\').innerHTML=\'<div class="empty"><h1>Connect to the workbench</h1><p>\'+esc(message)+\'</p><form id="team-connect-form"><label for="team-access-link">Private access link</label><input id="team-access-link" type="password" required autocomplete="off"><button type="submit">Connect</button></form></div>\';\n $(\'#team-connect-form\').addEventListener(\'submit\',event=>{\n   event.preventDefault();const supplied=$(\'#team-access-link\').value.trim();let selected;\n   try{selected=new URL(supplied,location.origin).hash;selected=new URLSearchParams(selected.slice(1)).get(\'token\');}catch{}\n   if(!selected){globalError(Error(\'Paste the complete private access link supplied by your administrator.\'));return;}\n   sessionStorage.setItem(keyName,selected);location.replace(\'/\');location.reload();\n });\n}\n', '  return;\n }\n $(\'#content\').innerHTML=\'<div class="empty"><h1>Connect to the workbench</h1><p>\'+esc(message)+\'</p><p>Open the extracted workbench folder and double-click its Windows or Mac launcher for the current private link.</p><form id="team-connect-form"><label for="team-access-link">Private access link</label><input id="team-access-link" type="password" required autocomplete="off"><button type="submit">Connect</button></form></div>\';\n workbenchConnection(false);\n $(\'#team-connect-form\').addEventListener(\'submit\',event=>{\n   event.preventDefault();\n   try{\n    const destination=currentWorkbenchURL($(\'#team-access-link\').value,{currentOrigin:location.origin,view:initialWorkbenchView});\n    $(\'#team-access-link\').value=\'\';location.replace(destination);\n   }catch(error){globalError(error);}\n });\n}\n'], [" finally{showConnection(capability==='eco-edge-session'?'Signed out of the secure workbench.':'Signed out. Open a current private access link to reconnect.');}\n});\nif(capability){\n try{\n  const session=await api('/api/session',{method:'POST',body:{}});teamPerson=session.person;\n  if(!session.workspaces.some(row=>row.id===workspace))workspace=session.default_workspace;\n  try{await extensions.load();const requested=location.hash.slice(1);if(extensions.hasView(requested))view=requested;}catch(error){toast('Additional desks: '+error.message);}\n  await refresh({force:true});\n }catch(error){showConnection(error.message);}\n", " finally{showConnection(capability==='eco-edge-session'?'Signed out of the secure workbench.':'Signed out. Open a current private access link to reconnect.');}\n});\nattachWorkbenchLinks({onRetry:()=>refresh({force:true})});\nif(capability){\n try{\n  const session=await api('/api/session',{method:'POST',body:{}});teamPerson=session.person;\n  if(!session.workspaces.some(row=>row.id===workspace))workspace=session.default_workspace;\n  try{await extensions.load();const requested=initialWorkbenchView||location.hash.slice(1);if(viewLabels[requested]||extensions.hasView(requested))view=requested;}catch(error){toast('Additional desks: '+error.message);}\n  await refresh({force:true});\n }catch(error){showConnection(error.message);}\n"]], 'operator/web/index.html': [['<link rel="stylesheet" href="/web/reviews.css">\n<link rel="stylesheet" href="/web/programmes.css">\n<script type="module" src="/web/app.mjs"></script>\n<link rel="stylesheet" href="/web/experiments.css">\n', '<link rel="stylesheet" href="/web/reviews.css">\n<link rel="stylesheet" href="/web/programmes.css">\n<script type="module" src="/web/workbench_links.mjs"></script>\n<script type="module" src="/web/app.mjs"></script>\n<link rel="stylesheet" href="/web/experiments.css">\n']]}

def apply(application: Path) -> list[str]:
    application = application.resolve(strict=True)
    plan = []
    for name in SOURCE_PATHS:
        source = SOURCE / name
        destination = application / name
        if not source.is_file():
            raise ValueError("Complete source cohort is missing: " + name)
        body = source.read_bytes()
        previous = destination.read_bytes() if destination.is_file() else None
        if previous is not None and previous != body:
            raise ValueError("Preserve newer source before composing: " + name)
        if previous != body:
            plan.append((name, destination, previous, body))
    for name, edits in JOINS.items():
        destination = application / name
        original = destination.read_bytes()
        text = original.decode("utf-8")
        for before, after in edits:
            if text.count(after) == 1:
                continue
            if text.count(before) != 1:
                raise ValueError("Current source needs exact join reconciliation: " + name)
            text = text.replace(before, after, 1)
        body = text.encode("utf-8")
        if body != original:
            plan.append((name, destination, original, body))
    changed = []
    for name, destination, previous, body in plan:
        if not destination.resolve().is_relative_to(application):
            raise ValueError("Source destination leaves the application: " + name)
        observed = destination.read_bytes() if destination.is_file() else None
        if observed != previous:
            raise ValueError("Concurrent source changed during composition: " + name)
        destination.parent.mkdir(parents=True, exist_ok=True)
        descriptor, temp = tempfile.mkstemp(prefix="."+destination.name+"-", dir=destination.parent)
        try:
            with os.fdopen(descriptor,"wb") as stream:
                stream.write(body);stream.flush();os.fsync(stream.fileno())
            if destination.exists():
                os.chmod(temp, destination.stat().st_mode & 0o777)
            os.replace(temp,destination)
        finally:
            Path(temp).unlink(missing_ok=True)
        changed.append(name)
    return changed

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("application", type=Path)
    args = parser.parse_args()
    for path in apply(args.application):
        print(path)
