#!/usr/bin/env python3
"""Own the complete browser continuation of the retained authored register programme."""
from __future__ import annotations
import argparse
import ctypes
import fcntl
import hashlib
import json
import os
from pathlib import Path
import signal
import socket
import stat
import subprocess
import sys
import time
import uuid

from migration_workspace import MigrationWorkspace
from migration_portable import APPLICATION_FILES, receive_delivery
HERE=Path(__file__).resolve().parent
SCHEMA="commons.register-migration-browser-receiving/v1"
MAX_FILE=192*1024*1024
CANCELLED=False
CHILDREN={}
WORKSPACES=[]
LEASE=None

def need(value, message):
    if not value:
        raise ValueError(message)


def emit(value):
    try:
        print(json.dumps(value, ensure_ascii=False, separators=(",", ":")), flush=True)
    except (BrokenPipeError, OSError):
        pass


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + "\n").encode()


def stable(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def value_sha(value):
    return sha(stable(value).encode())


def regular(path, maximum=MAX_FILE):
    path = Path(path).absolute()
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        need(stat.S_ISREG(before.st_mode) and before.st_size <= maximum, "Select one complete bounded regular file: " + str(path))
        out, size = [], 0
        while True:
            part = os.read(fd, min(262144, maximum - size + 1))
            if not part:
                break
            size += len(part)
            need(size <= maximum, "The complete original read exceeds its selected bound.")
            out.append(part)
        after, named = os.fstat(fd), os.lstat(path)
        need((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) ==
             (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns) and
             (named.st_dev, named.st_ino) == (before.st_dev, before.st_ino) and size == before.st_size,
             "The complete original file changed during its read.")
        return b"".join(out)
    finally:
        os.close(fd)


def file_receipt(path, maximum=MAX_FILE):
    path = Path(path).absolute()
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        need(stat.S_ISREG(before.st_mode) and before.st_size <= maximum, "Select the complete original regular file.")
        digest, size = hashlib.sha256(), 0
        while True:
            raw = os.read(fd, 262144)
            if not raw:
                break
            digest.update(raw); size += len(raw)
            need(size <= maximum, "The original selected file exceeds its bound.")
        after, named = os.fstat(fd), os.lstat(path)
        need((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) ==
             (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns) and
             (named.st_dev, named.st_ino) == (before.st_dev, before.st_ino) and size == before.st_size,
             "The selected complete file changed.")
        return {"path": str(path), "filename": path.name, "bytes": size, "sha256": digest.hexdigest()}
    finally:
        os.close(fd)


def directory(path, create=False):
    path = Path(path).expanduser().absolute()
    if create:
        path.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = os.lstat(path)
    need(stat.S_ISDIR(info.st_mode) and path.resolve() == path and info.st_uid == os.getuid(),
         "Keep the original canonical directory owned by the receiving operator.")
    return path


def sync(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def retain(path, raw):
    path = Path(path)
    try:
        need(regular(path) == raw, "The retained complete output differs: " + str(path))
        sync(path.parent)
        return file_receipt(path)
    except FileNotFoundError:
        pass
    temp = path.parent / ("." + path.name + "-" + uuid.uuid4().hex)
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        view = memoryview(raw)
        while view:
            count = os.write(fd, view)
            need(count > 0, "The complete output write did not advance.")
            view = view[count:]
        os.fsync(fd)
    finally:
        os.close(fd)
    try:
        try:
            os.link(temp, path, follow_symlinks=False)
        except FileExistsError:
            need(regular(path) == raw, "Keep the earlier complete output at its original path.")
        sync(path.parent)
    finally:
        os.unlink(temp); sync(path.parent)
    need(regular(path) == raw, "The published complete file did not reopen.")
    return file_receipt(path)


def replace_report(path, value):
    raw = encoded(value)
    temporary = path.parent / ("." + path.name + "-next-" + uuid.uuid4().hex)
    retain(temporary, raw)
    os.replace(temporary, path); sync(path.parent)
    need(regular(path) == raw, "The complete receiving report did not reopen.")


def object_file(path, maximum=MAX_FILE):
    value = json.loads(regular(path, maximum))
    need(isinstance(value, dict), "Keep the complete original JSON object.")
    return value


def stopped(_signum, _frame):
    global CANCELLED
    CANCELLED = True


def check_cancel():
    if CANCELLED:
        raise InterruptedError("The original receiving operation was stopped.")


def proc_status(path):
    result = {}
    for line in path.read_text().splitlines():
        if ":" in line:
            key, value = line.split(":", 1)
            result[key] = value.strip()
    return result


def child_identity(mounted_pid):
    text = (Path("/proc") / str(mounted_pid) / "stat").read_text()
    return text[text.rfind(")") + 2:].split()[19]


def tracked_popen(child):
    # Popen.pid is a syscall-namespace PID. Retain its actual Popen owner
    # before any procfs observation or optional pidfd acquisition can fail.
    need(child.pid not in CHILDREN, "Keep the original direct child identity.")
    owner = {"popen": child, "pidfd": None, "mountedPid": None, "identity": None}
    CHILDREN[child.pid] = owner
    if hasattr(os, "pidfd_open"):
        try:
            owner["pidfd"] = os.pidfd_open(child.pid)
        except ProcessLookupError:
            child.poll()
    return owner


def descendants():
    # The mounted procfs may use an outer PID namespace. Translate only our
    # actual direct children, then bind their mounted identity around pidfd_open.
    own = proc_status(Path("/proc/thread-self/status"))
    own_ids = [int(value) for value in own["NSpid"].split()]
    need(own_ids and own_ids[-1] == os.getpid(), "The original process namespace identity is unresolved.")
    depth, result = len(own_ids) - 1, []
    for value in Path("/proc/thread-self/children").read_text().split():
        mounted_pid = int(value)
        try:
            path = Path("/proc") / str(mounted_pid)
            entry = proc_status(path / "status")
            ids = [int(part) for part in entry["NSpid"].split()]
            need(int(entry["PPid"]) == own_ids[0] and len(ids) > depth and ids[0] == mounted_pid,
                 "The original direct-child namespace identity changed.")
            result.append({"pid": ids[depth], "mountedPid": mounted_pid,
                           "identity": child_identity(mounted_pid), "parent": own_ids[0], "ids": ids})
        except (FileNotFoundError, ProcessLookupError):
            # Exit is reconciled only by waitpid; an absent proc entry is not
            # evidence that all owned descendants have closed.
            continue
    return result


def tracked_descendant(selected):
    pid = selected["pid"]
    if pid in CHILDREN:
        return
    need(hasattr(os, "pidfd_open") and hasattr(signal, "pidfd_send_signal"),
         "Use the original Linux pidfd facility for adopted child ownership.")
    fd = None
    try:
        fd = os.pidfd_open(pid)
        current = proc_status(Path("/proc") / str(selected["mountedPid"]) / "status")
        need([int(part) for part in current["NSpid"].split()] == selected["ids"] and
             int(current["PPid"]) == selected["parent"] and
             child_identity(selected["mountedPid"]) == selected["identity"],
             "The translated original child changed during pidfd acquisition.")
        CHILDREN[pid] = {"popen": None, "pidfd": fd, "mountedPid": selected["mountedPid"],
                         "identity": selected["identity"]}
        fd = None
    except (FileNotFoundError, ProcessLookupError):
        pass
    finally:
        if fd is not None:
            os.close(fd)


def signal_child(pid, signum):
    owner = CHILDREN.get(pid)
    if owner is None:
        return
    try:
        if owner["pidfd"] is not None and hasattr(signal, "pidfd_send_signal"):
            signal.pidfd_send_signal(owner["pidfd"], signum)
        elif owner["popen"] is not None:
            # The original Popen polls/reaps its own syscall PID before sending.
            # No PID taken directly from a mounted procfs reaches os.kill.
            owner["popen"].send_signal(signum)
        else:
            raise RuntimeError("Retain the original adopted child until pidfd signaling is available.")
    except ProcessLookupError:
        pass


def release_child(pid, status=None):
    owner = CHILDREN.get(pid)
    if owner is None:
        return
    if status is not None and owner["popen"] is not None and owner["popen"].returncode is None:
        owner["popen"].returncode = os.waitstatus_to_exitcode(status)
    if owner["pidfd"] is not None:
        os.close(owner["pidfd"])
        owner["pidfd"] = None
    del CHILDREN[pid]


def drain_children():
    previous = {sig: signal.getsignal(sig) for sig in (signal.SIGINT, signal.SIGTERM)}
    for sig in previous:
        signal.signal(sig, signal.SIG_IGN)
    begun, reported = time.monotonic(), 0
    try:
        while True:
            failure = None
            empty = False
            try:
                while True:
                    try:
                        pid, status = os.waitpid(-1, os.WNOHANG)
                    except ChildProcessError:
                        empty = True
                        break
                    except InterruptedError:
                        continue
                    if not pid:
                        break
                    release_child(pid, status)
                if empty:
                    for pid in list(CHILDREN):
                        release_child(pid)
                    return
            except BaseException as error:
                failure = error
            # Direct Popen owners remain usable when procfs cannot be observed.
            try:
                for selected in descendants():
                    tracked_descendant(selected)
            except BaseException as error:
                failure = failure or error
            for pid in list(CHILDREN):
                try:
                    signal_child(pid, signal.SIGKILL if time.monotonic() - begun > 5 else signal.SIGTERM)
                except BaseException as error:
                    failure = failure or error
            if (failure or time.monotonic() - begun > 5) and time.monotonic() - reported > 2:
                emit({"state": "CLEANUP_PENDING", "ownedPids": list(CHILDREN),
                      "error": str(failure) if failure else None})
                reported = time.monotonic()
            time.sleep(0.1)
    finally:
        for sig, handler in previous.items():
            signal.signal(sig, handler)



def owned_workspace(path):
    value=MigrationWorkspace.__new__(MigrationWorkspace)
    WORKSPACES.append(value)
    value.__init__(path,create=False)
    return value

def close_workspace(value):
    value.close()
    WORKSPACES.remove(value)

def pin(path,maximum=MAX_FILE):
    receipt=file_receipt(path,maximum)
    return {key:receipt[key] for key in ("bytes","sha256")}

def verify_artifact(root,item):
    selected=root/item["path"]
    need(selected.resolve()==selected and selected.is_relative_to(root) and selected!=root,
         "Keep the complete browser artifact within its original directory.")
    need(pin(selected)=={key:item[key] for key in ("bytes","sha256")},"An original browser artifact differs.")

def launch(argv,log,environment):
    fd=os.open(log,os.O_RDWR|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    try:
        child=subprocess.Popen(argv,stdin=subprocess.DEVNULL,stdout=fd,stderr=subprocess.STDOUT,
                               cwd=HERE,env=environment,start_new_session=True,pass_fds=(LEASE,))
        tracked_popen(child)
        return child,fd
    except BaseException:
        os.fsync(fd);os.close(fd)
        raise

def wait_child(child,timeout):
    end=time.monotonic()+timeout
    while child.poll() is None:
        check_cancel()
        need(time.monotonic()<end,"The original browser command exceeded its selected timeout.")
        time.sleep(0.05)
    need(child.returncode==0,"The original command exited "+str(child.returncode))

def stop_server(child):
    if child is None:return
    if child.poll() is None:
        signal_child(child.pid,signal.SIGINT)
        try:child.wait(timeout=10)
        except subprocess.TimeoutExpired:
            signal_child(child.pid,signal.SIGTERM)
            try:child.wait(timeout=5)
            except subprocess.TimeoutExpired:signal_child(child.pid,signal.SIGKILL);child.wait()
    else:child.wait()

NATIVE_ORDER=("01-original-input","02-original-register-actions","03-complete-reports",
              "04-producer-delivery","05-customer-receive","06-customer-actions",
              "07-older-receiving-replay","08-customer-return","09-return-reopen","10-original-request-replay")
BROWSER_ORDER=("source-mapping-and-working-file","complete-plan-and-original-controls",
               "independent-rehearsal-and-compare","review-and-cutover",
               "full-exports-and-portable-delivery","wide-narrow-and-original-reopen")
BROWSER_ACTIONS={"dataset":"register.dataset.create","plan":"register.plan.create",
                 "rehearsal":"register.rehearsal.create","review":"register.review.create",
                 "cutover":"register.cutover.create","delivery":"delivery.prepare"}

def validate_native(reference,application):
    native_root=reference/"receiving"
    complete=object_file(native_root/"COMPLETE.json")
    original=object_file(reference/"receiving-input.json")
    need(regular(reference/"receiving-input.json")==regular(native_root/"original-input.json"),
         "Keep the complete original native input bytes.")
    source_sha=pin(reference/"receiving-input.json")["sha256"]
    need(complete.get("schema")=="commons.register-migration-receiving/v1" and
         complete.get("state")=="COMPLETE" and complete.get("operation_id")==original.get("operation_id") and
         complete.get("input_sha256")==source_sha and
         complete.get("lifetimes")=={"workspaces":"CLOSED","children":"NONE_CREATED"},
         "Select the complete original closed native programme.")
    selection=complete["selection"]
    need(selection==object_file(native_root/"selection.json") and
         selection.get("schema")=="commons.register-migration-receiving/v1/selection" and
         selection.get("operation_id")==complete["operation_id"] and
         selection.get("input_sha256")==source_sha and selection.get("application")==application and
         original.get("application")==application,
         "The original native input, whole application and selection differ.")
    phases=complete.get("phases",[])
    need([item.get("phase") for item in phases]==list(NATIVE_ORDER) and
         all(item.get("schema")=="commons.register-migration-receiving/v1/phase" and
             item.get("input_sha256")==source_sha for item in phases),
         "Retain all ten ordered original native phases.")
    for item in complete["artifacts"]:verify_artifact(native_root,item)
    for item in phases:
        need(object_file(native_root/"phases"/(item["phase"]+".json"))==item,
             "The original native phase receipt differs.")
    archive=reference/"receiving/deliveries/customer/complete.zip"
    selected=phases[7]["result"]
    wanted=next((item for item in complete["artifacts"] if item["path"]=="deliveries/customer/complete.zip"),None)
    need(wanted and pin(archive)=={key:wanted[key] for key in ("bytes","sha256")} and
         selected["archive"]==wanted and selected["record"]["archive_bytes"]==wanted["bytes"] and
         selected["record"]["archive_sha256"]==wanted["sha256"],
         "Bind the complete original customer archive to its actual native phase.")
    return complete,archive

def validate_browser(root,node_input,selection):
    report=object_file(root/"browser-report.json")
    need(report.get("schema")==SCHEMA and report.get("state")=="COMPLETE" and
         report.get("operation_id")==selection["operation_id"] and
         report.get("selection_sha256")==node_input["selection_sha256"] and
         report.get("context_closed") is True and report.get("page_errors")==[] and report.get("route_errors")==[],
         "Require the complete original selected browser and actual context closure.")
    phases=report.get("phases",[])
    need([phase.get("id") for phase in phases]==list(BROWSER_ORDER) and
         all(phase.get("status")=="COMPLETE" and phase.get("selection_sha256")==node_input["selection_sha256"]
             for phase in phases),"Require all six complete ordered browser phases.")
    artifacts={}
    for item in report["artifacts"]:
        verify_artifact(root,item)
        need(item["path"] not in artifacts,"The original browser artifact is repeated.")
        artifacts[item["path"]]=item
    def require_file(relative):
        need(relative in artifacts,"A required original browser file is absent: "+relative)
        return object_file(root/relative)
    for phase in phases:
        need(require_file("phases/"+phase["id"]+".json")==phase,"The complete browser phase body differs.")
        for item in phase["artifacts"]:
            need(artifacts.get(item["path"])==item,"The browser phase lost an original full artifact.")
    records=report.get("operations",[])
    need(len(records)==len(BROWSER_ACTIONS) and {record.get("key") for record in records}==set(BROWSER_ACTIONS),
         "Keep the exact six original browser operations.")
    operations={record["key"]:record for record in records}
    ids=set()
    for key,operation in BROWSER_ACTIONS.items():
        record=operations[key];request=record["request"];response=record["response"]
        need(request.get("operation")==operation and request["payload"].get("actor")==node_input["actor"] and
             isinstance(request["payload"].get("operation_id"),str) and request["payload"]["operation_id"] not in ids and
             isinstance(response.get("result"),dict) and not response.get("error"),
             "Keep each complete distinct original selected browser action.")
        ids.add(request["payload"]["operation_id"])
        need(require_file("operations/"+key+"/request.json")==request and
             require_file("operations/"+key+"/response.json")==response,
             "The complete original browser request or result differs.")
    for index,key,field in ((0,"dataset","dataset_id"),(1,"plan","plan_id"),(2,"rehearsal","rehearsal_id"),
                            (3,"review","review_id"),(3,"cutover","cutover_id"),(4,"delivery","delivery_id")):
        need(phases[index]["result"][field]==operations[key]["response"]["result"]["id"],
             "A browser phase selected another original operation result.")
    project=phases[5]["result"]["project"]
    delivery=operations["delivery"]["response"]["result"]
    archive=phases[4]["result"]["archive"]
    need(project.get("id")==node_input["workspace_id"] and
         phases[5]["result"]["delivery"]==delivery["id"] and delivery["workspace_id"]==project["id"] and
         project["revision"]>=delivery["revision"] and
         artifacts.get(archive["path"])=={key:archive[key] for key in ("path","bytes","sha256")} and
         archive["bytes"]==delivery["archive_bytes"] and archive["sha256"]==delivery["archive_sha256"],
         "Bind the full returned archive and final project to the original delivery.")
    for filename in ("final-wide.png","final-narrow.png","reopened-narrow-cutover.png"):
        need(any(Path(name).name==filename for name in artifacts),"Keep the actual full wide/narrow/reopen screenshot.")
    return report,operations,project,delivery,archive

def replay_browser(workspace,operations,project,returned=False):
    need(workspace.project["id"]==project["id"] and workspace.project["revision"]>=project["revision"],
         "The editable original workspace lost its retained identity or history.")
    before=workspace.project
    for key,record in operations.items():
        if returned and key=="delivery":continue
        request=record["request"];response=record["response"]
        original=workspace.dispatch("operation.get",{"id":request["payload"]["operation_id"]})
        need(original["found"] and original["operation"]["status"]=="SUCCEEDED" and
             original["operation"]["operation"]==request["operation"] and
             original["operation"]["request"]==request["payload"] and
             original["operation"]["result"]["result"]==response["result"],
             "The original complete successful operation is not retained.")
        value=workspace.dispatch(request["operation"],request["payload"])
        need(value["reused"] is True and value["result"]==response["result"],
             "The original accepted browser result changed on replay.")
    need(workspace.project==before,"Exact original request replay changed later customer history.")

def validate_return(root,operations,project,delivery,archive):
    observed=receive_delivery(root/archive["path"],root/"browser-return")
    receipt={key:value for key,value in observed.items() if key!="reopened"}
    need(receipt["complete"] is True and receipt["workspace_id"]==project["id"] and
         receipt["delivery_id"]==delivery["id"] and receipt["source_revision"]==delivery["revision"] and
         receipt["archive_sha256"]==archive["sha256"] and receipt["manifest_sha256"]==delivery["manifest_sha256"],
         "The complete independent return receipt differs from its original archive.")
    retain(root/"browser-return-receipt.json",encoded(receipt))
    ready=object_file(root/"browser-return/READY.json")
    need(all(ready.get(key)==receipt[key] for key in
             ("schema","delivery_id","archive_sha256","manifest_sha256","workspace_id","source_revision","complete")),
         "The independently reopened original return has another receipt.")
    workspace=owned_workspace(root/"browser-return/workspace")
    replay_browser(workspace,operations,{**project,"revision":delivery["revision"]},returned=True)
    close_workspace(workspace)
    return receipt

def validate_complete(root,result,selection,report,project,receipt):
    need(result.get("schema")==SCHEMA and result.get("state")=="COMPLETE" and
         result.get("selection")==selection and result.get("project")==project and
         result.get("browser_report")==pin(root/"browser-report.json") and result.get("returned")==receipt and
         result.get("lifetimes")=={"workspaces":"CLOSED","children":"CLOSED"},
         "Keep the exact complete original browser result and return.")
    artifacts={}
    for item in result["artifacts"]:
        verify_artifact(root,item);need(item["path"] not in artifacts,"A complete result artifact is repeated.")
        artifacts[item["path"]]=item
    required={item["path"]:{key:item[key] for key in ("bytes","sha256")} for item in report["artifacts"]}
    for relative in ("selection.json","browser-input.json","browser-report.json","original-receive.json",
                     "browser-return-receipt.json"):
        required[relative]=pin(root/relative)
    need(all(artifacts.get(name)=={"path":name,**identity} for name,identity in required.items()),
         "The complete result omits an original selection, report, return or browser artifact.")

def run(args):
    global LEASE,CANCELLED
    root=directory(args.out,create=True);need(not root.stat().st_mode&0o077,"Use a private browser operation directory.")
    reference=directory(args.reference)
    fd=os.open(root/"operation.lock",os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600);LEASE=fd
    info=os.fstat(fd)
    need(stat.S_ISREG(info.st_mode) and info.st_uid==os.getuid() and info.st_nlink==1 and not info.st_mode&0o077,"Keep the private original lease.")
    fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
    need(ctypes.CDLL(None).prctl(36,1,0,0,0)==0,"Original descendant ownership could not start.")
    previous={number:signal.getsignal(number) for number in (signal.SIGINT,signal.SIGTERM)}
    for number in previous:signal.signal(number,stopped)
    workspace=None;server=None;child=None;handles=[];failure=None;result=None
    attempt=None
    try:
        attempt=directory(root/("attempt-"+uuid.uuid4().hex),create=True)
        application=[{"path":name,**pin(HERE/name)} for name in APPLICATION_FILES]
        complete,archive=validate_native(reference,application)
        complete_path=reference/"receiving/COMPLETE.json"
        runtime={"python":{"path":str(Path(sys.executable).resolve()),"version":sys.version,**pin(Path(sys.executable).resolve())},
                 "node":{"path":str(Path(args.node).resolve()),**pin(Path(args.node).resolve())},
                 "playwright":{"path":str(Path(args.playwright).resolve()),**pin(Path(args.playwright).resolve())},
                 "browser":{"path":str(Path(args.chromium).resolve()),**pin(Path(args.chromium).resolve(),1024*1024*1024)}}
        selection={"schema":SCHEMA+"/selection","operation_id":args.operation_id,"reference":str(reference),"out":str(root),
                   "native_report":pin(complete_path),"native_input":pin(reference/"receiving-input.json"),"customer_archive":pin(archive),"application":application,"runtime":runtime}
        retain(root/"selection.json",encoded(selection))
        observed=receive_delivery(archive,root/"customer")
        receipt={key:value for key,value in observed.items() if key!="reopened"}
        retain(root/"original-receive.json",encoded(receipt))
        workspace=owned_workspace(root/"customer/workspace")
        need(workspace.project["id"]==complete["phases"][0]["result"]["project"]["id"],"Original workspace identity changed.")
        # These are exact original course results, retained before UI mutations.
        def accepted(name):
            return object_file(reference/("accepted-"+name+".json"))["result"]
        original=object_file(reference/"receiving-input.json")
        node_input={"schema":SCHEMA+"/input","operation_id":args.operation_id,"workspace_id":workspace.project["id"],
                    "application":application,"selection_sha256":pin(root/"selection.json")["sha256"],
                    "people":accepted("e2-source-people"),"plan":accepted("e2-plan"),
                    "first_rehearsal":accepted("e1-rehearsal"),"rehearsal":accepted("e2-rehearsal"),
                    "cutover":accepted("second-cutover"),
                    "target_dataset_ids":accepted("e2-rehearsal")["target_dataset_ids"],
                    "review":workspace.dispatch("register.review.get",{"id":
                       next(value["original_result"]["result"]["id"] for value in complete["actions"]
                            if value["lane"]=="customer" and value["key"]=="recipient-review")}),
                    "actor":"authored-browser-operator"}
        # Source and all original immutable editions remain unchanged on retry.
        retain(root/"browser-input.json",encoded(node_input))
        close_workspace(workspace);workspace=None
        completed=root/"COMPLETE.json"
        if not completed.exists():
            listener_path=root/"listener.json"
            if listener_path.exists():listener=object_file(listener_path)
            else:
                with socket.socket() as probe:
                    probe.bind(("127.0.0.1",0));port=probe.getsockname()[1]
                listener={"workspace_id":node_input["workspace_id"],"port":port,"url":"http://127.0.0.1:"+str(port)}
                retain(listener_path,encoded(listener))
            need(listener["workspace_id"]==node_input["workspace_id"] and isinstance(listener["port"],int),
                 "The selected original browser listener changed.")
            environment={**os.environ,"PYTHONDONTWRITEBYTECODE":"1","NODE_OPTIONS":"--max-old-space-size=192",
                         "TMPDIR":str(directory(root/"temporary",create=True))}
            server,serverfd=launch([runtime["python"]["path"],str(HERE/"migration_server.py"),"--workspace",str(root/"customer/workspace"),
                                   "--host","127.0.0.1","--port",str(listener["port"])],attempt/"server.log",environment)
            handles.append(serverfd)
            end=time.monotonic()+30;ready=False
            while time.monotonic()<end:
                check_cancel();need(server.poll() is None,"The original owned server stopped before readiness.")
                for line in os.pread(serverfd,1024*1024,0).decode("utf-8",errors="replace").splitlines():
                    try:value=json.loads(line)
                    except ValueError:continue
                    if value.get("event")=="migration_workbench_ready":
                        need(value.get("workspace_id")==listener["workspace_id"] and value.get("url")==listener["url"],"Original server readiness differs.")
                        ready=True;break
                if ready:break
                time.sleep(0.05)
            need(ready,"The original server did not acknowledge readiness.")
            child,childfd=launch([runtime["node"]["path"],str(HERE/"register_browser_receiving.mjs"),
                                  "--input",str(root/"browser-input.json"),"--out",str(root),"--url",listener["url"],
                                  "--playwright",runtime["playwright"]["path"],"--chromium",runtime["browser"]["path"]],
                                  attempt/"browser.log",environment)
            handles.append(childfd);wait_child(child,1800)
            validate_browser(root,node_input,selection)
            stop_server(server);need(server.returncode==0,"The original server did not close successfully.");server=None;drain_children()
        report,operations,project,delivery,archive_result=validate_browser(root,node_input,selection)
        workspace=owned_workspace(root/"customer/workspace")
        replay_browser(workspace,operations,project)
        close_workspace(workspace);workspace=None
        receipt=validate_return(root,operations,project,delivery,archive_result)
        if completed.exists():
            result=object_file(completed)
            validate_complete(root,result,selection,report,project,receipt)
        else:
            result={"schema":SCHEMA,"state":"COMPLETE","selection":selection,"project":project,
                    "browser_report":pin(root/"browser-report.json"),"returned":receipt,
                    "lifetimes":{"workspaces":"CLOSED","children":"CLOSED"}}
    except BaseException as error:
        failure=error
    finally:
        # Each owner is closed independently; a server error cannot skip ECHILD.
        if child is not None:
            try:
                if child.poll() is None:signal_child(child.pid,signal.SIGTERM)
            except BaseException as error:failure=failure or error
        try:stop_server(server)
        except BaseException as error:failure=failure or error
        while True:
            try:drain_children();break
            except BaseException as error:
                failure=failure or error
                emit({"state":"CLEANUP_PENDING","ownedPids":list(CHILDREN),"error":repr(error)})
                time.sleep(0.1)
        for owned in list(reversed(WORKSPACES)):
            try:close_workspace(owned)
            except BaseException as error:failure=failure or error
        for handle in handles:
            try:os.fsync(handle)
            except BaseException as error:failure=failure or error
            try:os.close(handle)
            except BaseException as error:failure=failure or error
        try:
            if failure is not None and attempt is not None:
                retain(attempt/"failure.json",encoded({"error":repr(failure),"operation_id":args.operation_id,
                                                     "children":list(CHILDREN),"workspaces":len(WORKSPACES)}))
            elif result is not None and not (root/"COMPLETE.json").exists():
                artifacts=[]
                for file in sorted(root.rglob("*")):
                    if (file.is_file() and not file.is_symlink() and
                        file.name not in ("operation.lock","COMPLETE.json") and
                        not any(part in ("profile","customer","browser-return","temporary") for part in file.relative_to(root).parts)):
                        artifacts.append({"path":file.relative_to(root).as_posix(),**pin(file)})
                result["artifacts"]=artifacts
                validate_complete(root,result,selection,report,project,receipt)
                retain(root/"COMPLETE.json",encoded(result))
        except BaseException as error:failure=failure or error
        finally:
            for number,handler in previous.items():signal.signal(number,handler)
            if not CHILDREN and not WORKSPACES:
                fcntl.flock(fd,fcntl.LOCK_UN);os.close(fd);LEASE=None
    if failure is not None:raise failure
    return result

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reference",required=True);parser.add_argument("--out",required=True)
    parser.add_argument("--operation-id",default="register-authored-browser")
    parser.add_argument("--node",required=True);parser.add_argument("--playwright",required=True);parser.add_argument("--chromium",required=True)
    args=parser.parse_args()
    result=run(args);emit({"state":result["state"],"operation_id":args.operation_id,"report":str(Path(args.out).absolute()/"COMPLETE.json")})

if __name__=="__main__":main()
