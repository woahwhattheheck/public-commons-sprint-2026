#!/usr/bin/env python3
"""Continue one supplied supplier-statement operation through the original HTTP owner."""
from __future__ import annotations
import argparse
import base64
from contextlib import contextmanager
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zipfile

LIMIT = 64 * 1024 * 1024

def encoded(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False) + "\n").encode()

def sha(raw):
    return hashlib.sha256(raw).hexdigest()

def read(path, maximum=LIMIT):
    path = Path(path)
    if path.is_symlink() or not path.is_file() or path.stat().st_size > maximum:
        raise ValueError("Keep the bounded original ordinary file: " + str(path))
    return path.read_bytes()

def document(path):
    return json.loads(read(path))

def publish(path, raw):
    path = Path(path); path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if path.exists():
        if read(path) != raw: raise ValueError("The retained original file differs: " + str(path))
        return
    temporary = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
    try:
        with temporary.open("xb") as stream:
            os.chmod(temporary, 0o600); stream.write(raw); stream.flush(); os.fsync(stream.fileno())
        try: os.link(temporary, path)
        except FileExistsError:
            if read(path) != raw: raise ValueError("A concurrent original file differs.")
        fd = os.open(path.parent, os.O_RDONLY)
        try: os.fsync(fd)
        finally: os.close(fd)
    finally:
        temporary.unlink(missing_ok=True)

class Client:
    def __init__(self, url, token_file):
        parsed = urllib.parse.urlsplit(url)
        if parsed.scheme != "http" or parsed.hostname not in ("127.0.0.1", "localhost", "::1") or parsed.query or parsed.fragment or parsed.username:
            raise ValueError("Use the actual original local service URL.")
        self.url = url.rstrip("/")
        self.token = read(token_file, 65536).decode().strip()
        if not self.token or "\n" in self.token: raise ValueError("Select the original private workspace access key.")
    def call(self, path, body=None, raw=False, binary=None, extra_headers=None):
        request = urllib.request.Request(self.url + path, data=binary if binary is not None else None if body is None else encoded(body),
            headers={"Authorization": "Bearer " + self.token, "Content-Type": "application/zip" if binary is not None else "application/json", **(extra_headers or {})}, method="POST" if binary is not None or body is not None else "GET")
        with urllib.request.urlopen(request, timeout=120) as response:
            content = response.read(LIMIT + 1)
        if len(content) > LIMIT: raise ValueError("The original service response exceeds its complete bound.")
        return content if raw else json.loads(content)

@contextmanager
def operation(directory):
    root = Path(directory).resolve(); root.mkdir(parents=True, exist_ok=True, mode=0o700)
    lock = root / "supplier-statement-operation.lock"
    if lock.is_symlink(): raise ValueError("Keep the original operation lock.")
    with lock.open("a+b") as stream:
        fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield root, stream

def request_id(operation_id, stage):
    return str(uuid.uuid5(uuid.NAMESPACE_URL, "scf-supplier-statements:" + operation_id + ":" + stage))

def validate_plan(value):
    if not isinstance(value, dict) or set(value) - {"schema","operationId","caseId","expectedVersion","actor","note","document","followingDocument","followingNote","followingPreviousReview"}:
        raise ValueError("Use the complete supplied supplier statement plan.")
    if value.get("schema") != "stellar-forge.sf47-supplier-statements-receiving.v1":
        raise ValueError("Select the original supplier receiving schema.")
    for key in ("operationId","caseId","actor","note"):
        if not isinstance(value.get(key), str) or not value[key].strip(): raise ValueError("Complete " + key + " before freezing the operation.")
    if type(value.get("expectedVersion")) is not int or value["expectedVersion"] < 1:
        raise ValueError("Retain the original reviewed case version.")
    if not isinstance(value.get("document"), dict):
        raise ValueError("Supply the actual complete mapped statement document.")
    if value.get("followingDocument") is not None and (not isinstance(value["followingDocument"],dict) or not value.get("followingNote","").strip()):
        raise ValueError("Supply the complete following document and its review note.")
    if value.get("followingPreviousReview") is not None:
        if value["followingPreviousReview"] != "first-accepted-review" or not isinstance(value.get("followingDocument"), dict):
            raise ValueError("Select the original first accepted review for the planned following edition.")
        if (value["followingDocument"].get("previousReviewId") is not None
                or value["followingDocument"].get("statementId") != value["document"].get("statementId")):
            raise ValueError("The planned following document must retain this statement and leave its generated predecessor unassigned.")
    return value

def saved_step(client, root, plan, stage, entered, expected, note):
    request_path = root / (stage + "-request.json")
    base = "/api/operations/" + plan["caseId"]
    if request_path.exists():
        command = document(request_path)
        if (command.get("requestId") != request_id(plan["operationId"], stage) or command.get("action") != "supplier-statement.save"
                or command.get("expectedVersion") != expected or command.get("actor") != plan["actor"] or command.get("note") != note
                or command.get("data",{}).get("document") != entered):
            raise ValueError("The retained request differs from the complete original plan.")
    else:
        preview = client.call(base + "/supplier-statements/preview", {"expectedVersion":expected,"document":entered})
        if not preview.get("ready"): raise ValueError("Correct every original source row before the first native save.")
        if preview["document"] != entered:
            raise ValueError("Use the complete normalized native preview document in the reviewed plan.")
        command = {"requestId":request_id(plan["operationId"],stage),"expectedVersion":expected,
                   "actor":plan["actor"],"note":note,"action":"supplier-statement.save",
                   "data":{"document":entered,"expectedPreviewSha256":preview["previewSha256"]}}
        publish(root / (stage + "-preview.json"), encoded(preview))
        publish(request_path, encoded(command))
    found = client.call(base + "/supplier-statements/request", {"command":command})
    result = found["result"] if found["found"] else client.call(base + "/command", command)
    if result.get("id") != plan["caseId"] or result.get("action") != command["action"] or result.get("version") != expected + 1:
        raise ValueError("The saved native result differs from its original request.")
    publish(root / (stage + "-result.json"), encoded(result))
    saved = client.call(base + "/supplier-statements/" + result["recordId"])
    if saved["review"]["supplierStatement"]["document"] != entered:
        raise ValueError("The saved native statement differs from its original document.")
    # Save immutable selected review only; currentAccount may legitimately advance.
    publish(root / (stage + "-review.json"), encoded(saved["review"]))
    return result, saved["review"]

def check_bundle(raw, review):
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        names = z.namelist()
        if len(names) != len(set(names)) or sum(r.file_size for r in z.infolist()) > 32*1024*1024: raise ValueError("Invalid complete statement archive.")
        manifest = json.loads(z.read("MANIFEST.json"))
        if set(names) != {r["path"] for r in manifest["files"]} | {"MANIFEST.json"}: raise ValueError("The complete statement archive membership differs.")
        for row in manifest["files"]:
            content=z.read(row["path"])
            if len(content)!=row["bytes"] or sha(content)!=row["sha256"]: raise ValueError("A statement member changed.")
        if json.loads(z.read("supplier-statement.json")) != review: raise ValueError("The selected statement differs from its saved review.")
        native = z.read("operations-case.zip")
        with zipfile.ZipFile(io.BytesIO(native)) as original:
            value = json.loads(original.read("operations.json"))
            if review not in value["reviews"]: raise ValueError("The selected review is absent from the whole original case.")
        return manifest

def receiving(client, root, plan, raw, review):
    name = "Supplier statement receiving — " + plan["operationId"]
    receipt_path = root / "receiving-result.json"
    request = {"requestId":request_id(plan["operationId"],"receive"),"name":name,"actor":plan["actor"],"contentBase64":base64.b64encode(raw).decode()}
    publish(root / "receiving-request.json", encoded(request))
    result = client.call("/api/operations/import?name="+urllib.parse.quote(name), binary=raw,
        extra_headers={"X-Request-ID":request["requestId"],"X-Recorded-By":urllib.parse.quote(plan["actor"])})
    publish(receipt_path, encoded(result))
    case_id=result["id"]
    saved=client.call("/api/operations/"+case_id+"/supplier-statements/"+review["id"])
    if saved["review"] != review: raise ValueError("The received original review changed.")
    publish(root / "received-review.json",encoded(saved["review"]))
    second_path=root/"received-supplier-statement.zip"
    second=read(second_path) if second_path.exists() else client.call("/api/operations/"+case_id+"/supplier-statements/"+review["id"]+"/export.zip",raw=True)
    check_bundle(second,review);publish(second_path,second)
    # A second original receive proves historical author identity survives remapping.
    request2={"requestId":request_id(plan["operationId"],"receive-again"),"name":name+" — reopened","actor":plan["actor"],"contentBase64":base64.b64encode(second).decode()}
    publish(root / "receiving-again-request.json",encoded(request2))
    again=client.call("/api/operations/import?name="+urllib.parse.quote(request2["name"]), binary=second,
        extra_headers={"X-Request-ID":request2["requestId"],"X-Recorded-By":urllib.parse.quote(plan["actor"])});publish(root/"receiving-again-result.json",encoded(again))
    reopened=client.call("/api/operations/"+again["id"]+"/supplier-statements/"+review["id"])
    if reopened["review"]!=review:raise ValueError("The second receiver lost original author custody.")
    return {"receivedCaseId":case_id,"reopenedCaseId":again["id"],"reviewId":review["id"],"reviewSha256":review["sha256"]}

def browser(command, lock, root):
    stop=[None]; child=None
    previous={}
    def interrupted(number, frame):
        stop[0]=number
        if child is not None and child.poll() is None:
            try:os.killpg(child.pid,signal.SIGTERM)
            except ProcessLookupError:pass
    for sig in (signal.SIGINT,signal.SIGTERM):previous[sig]=signal.signal(sig,interrupted)
    try:
        with (root/"browser.stdout").open("ab") as out,(root/"browser.stderr").open("ab") as err:
            blocked=signal.pthread_sigmask(signal.SIG_BLOCK,{signal.SIGINT,signal.SIGTERM})
            try:
                environment={**os.environ,"SCF_SUPPLIER_RECEIVING_LOCK_FD":str(lock.fileno()),
                    "SCF_SUPPLIER_RECEIVING_LOCK_PATH":str(root/"supplier-statement-operation.lock")}
                # The short exec wrapper restores the inherited signal mask in the
                # child, then replaces itself without changing PID, group or lock FD.
                wrapper="import json,os,signal,sys; signal.pthread_sigmask(signal.SIG_SETMASK,set(json.loads(sys.argv[1]))); os.execvpe(sys.argv[2],sys.argv[2:],os.environ)"
                launched=[sys.executable,"-c",wrapper,json.dumps(sorted(int(sig) for sig in blocked)),*command]
                child=subprocess.Popen(launched,stdout=out,stderr=err,start_new_session=True,pass_fds=(lock.fileno(),),env=environment)
            finally:signal.pthread_sigmask(signal.SIG_SETMASK,blocked)
            deadline=time.monotonic()+600
            while child.poll() is None:
                if stop[0] or time.monotonic()>deadline:
                    try:os.killpg(child.pid,signal.SIGTERM)
                    except ProcessLookupError:pass
                    try:child.wait(timeout=20)
                    except subprocess.TimeoutExpired:
                        try:os.killpg(child.pid,signal.SIGKILL)
                        except ProcessLookupError:pass
                        child.wait()
                    break
                time.sleep(.2)
            if stop[0]:raise InterruptedError("The original browser operation was interrupted after drain.")
            if child.returncode:raise RuntimeError("The original browser course stopped; retain its exact log and profile.")
    finally:
        if child is not None and child.poll() is None:
            try:os.killpg(child.pid,signal.SIGTERM)
            except ProcessLookupError:pass
            child.wait()
        for sig,handler in previous.items():signal.signal(sig,handler)

def run(args):
    plan=validate_plan(document(args.plan))
    with operation(args.output) as (root,lock):
        publish(root/"PLAN.json",encoded(plan))
        client=Client(args.url,args.token_file)
        if (root/"RESULT.json").exists():
            result=document(root/"RESULT.json")
            for name,identity in result["files"].items():
                raw=read(root/name)
                if len(raw)!=identity["bytes"] or sha(raw)!=identity["sha256"]:raise ValueError("An original completed output differs.")
            return result
        first,review=saved_step(client,root,plan,"first",plan["document"],plan["expectedVersion"],plan["note"])
        if plan.get("followingDocument") is not None:
            entered=json.loads(json.dumps(plan["followingDocument"],ensure_ascii=False,allow_nan=False))
            if plan.get("followingPreviousReview") == "first-accepted-review":
                entered["previousReviewId"]=review["id"]
                publish(root/"FOLLOWING_SELECTION.json",encoded({"firstResult":first,
                    "firstReviewId":review["id"],"firstReviewSha256":review["sha256"],"document":entered}))
            if entered.get("statementId")!=review["supplierStatement"]["document"]["statementId"] or entered.get("previousReviewId")!=review["id"]:
                raise ValueError("Select the exact retained previous statement edition for the following review.")
            _,review=saved_step(client,root,plan,"following",entered,first["version"],plan["followingNote"])
        raw_path=root/"supplier-statement.zip"
        raw=read(raw_path) if raw_path.exists() else client.call("/api/operations/"+plan["caseId"]+"/supplier-statements/"+review["id"]+"/export.zip",raw=True)
        check_bundle(raw,review);publish(raw_path,raw)
        target=Client(args.receiving_url,args.receiving_token_file)
        received=receiving(target,root,plan,raw,review)
        publish(root/"RECEIVED.json",encoded(received))
        if args.playwright and args.chromium:
            if not args.browser_url_file: raise ValueError("Select the original browser access URL file.")
            with zipfile.ZipFile(io.BytesIO(raw)) as archive:
                for name in archive.namelist():
                    if "/" in name or name in (".",".."): raise ValueError("Keep the complete original flat handover.")
                    publish(root/"outgoing"/name,archive.read(name))
            selection={"schema":"stellar-forge.sf47-supplier-statements-browser.v1","caseId":plan["caseId"],"reviewId":review["id"],
                "reviewSha256":review["sha256"],"url":args.url,"browserUrlFile":str(Path(args.browser_url_file).resolve()),
                "playwright":str(Path(args.playwright).resolve()),"chromium":str(Path(args.chromium).resolve()),"output":str(root/"browser"),
                "bundle":str(raw_path),"expectedSourceSha256":review["supplierStatement"]["source"]["sha256"]}
            publish(root/"BROWSER_SELECTION.json",encoded(selection))
            browser([args.node,str(Path(__file__).with_name("supplier_statements_browser.mjs")),"--selection",str(root/"BROWSER_SELECTION.json")],lock,root)
            check_bundle(read(root/"browser"/"downloaded-supplier-statement.zip"),review)
        files={}
        for path in sorted(root.rglob("*")):
            if not path.is_file() or path.is_symlink() or "profile" in path.relative_to(root).parts or path.name.endswith(".lock"):continue
            body=read(path);files[path.relative_to(root).as_posix()]={"bytes":len(body),"sha256":sha(body)}
        result={"schema":"stellar-forge.sf47-supplier-statements-result.v1","operationId":plan["operationId"],"caseId":plan["caseId"],
                "reviewId":review["id"],"reviewSha256":review["sha256"],"receiving":received,
                "browser":document(root/"browser"/"RESULT.json") if (root/"browser"/"RESULT.json").exists() else None,"files":files}
        publish(root/"RESULT.json",encoded(result));return result

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ("plan","output","url","token-file","receiving-url","receiving-token-file"):parser.add_argument("--"+name,required=True)
    parser.add_argument("--browser-url-file");parser.add_argument("--node",default="node");parser.add_argument("--playwright");parser.add_argument("--chromium")
    args=parser.parse_args()
    if bool(args.playwright)!=bool(args.chromium):parser.error("Select both original Playwright and Chromium paths.")
    print(json.dumps(run(args),ensure_ascii=False))

if __name__=="__main__":main()
