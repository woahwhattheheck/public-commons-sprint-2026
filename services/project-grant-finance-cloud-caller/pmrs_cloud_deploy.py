"""Prepare and install the original PMRS private caller and three solution-aware flows."""
from __future__ import annotations
import argparse
import base64
import contextlib
import datetime as dt
import email.utils
import hashlib
import http.client
import json
import os
import re
import secrets
import shutil
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path
from pmrs_cloud_gateway import CallerError, need, private_file, config_read, Native, NoRedirect

ROOT = Path(__file__).resolve().parent
GROUPS = {"capture": ["capture"], "prepare": ["mapping", "reconcile", "target-review", "export"],
          "delivery": ["deliver", "recover", "continue-delivery"]}
MAX = 16 * 1024 * 1024

def now():
    return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")

def body(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + "\n").encode("utf-8")

def sha(raw): return hashlib.sha256(raw).hexdigest()

def unique(pairs):
    out = {}
    for k, v in pairs:
        need(k not in out, "DUPLICATE_KEY", "The deployment JSON repeats a key.")
        out[k] = v
    return out

def parse(raw):
    try: return json.loads(raw, object_pairs_hook=unique, parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
    except (ValueError, UnicodeError): raise CallerError("JSON", "Use complete finite UTF-8 deployment JSON.")

def read(path):
    path = Path(path)
    need(path.is_file() and not path.is_symlink() and path.stat().st_size <= MAX,
         "SOURCE_FILE", "Select a complete regular source file within 16 MiB.")
    return path.read_bytes()

def save(path, raw):
    """Replace one journal atomically; retain private access on each new inode."""
    path = Path(path)
    fd, temp = tempfile.mkstemp(prefix="." + path.name + "-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(raw); stream.flush(); os.fsync(stream.fileno())
        os.replace(temp, path)
        if os.name == "posix":
            d = os.open(path.parent, os.O_RDONLY)
            try: os.fsync(d)
            finally: os.close(d)
    finally:
        if os.path.exists(temp): os.unlink(temp)

@contextlib.contextmanager
def locked(path):
    path = Path(path)
    with path.open("a+b") as stream:
        os.chmod(path, 0o600)
        if os.name == "posix":
            import fcntl
            fcntl.flock(stream.fileno(), fcntl.LOCK_EX)
        else:
            import msvcrt
            if stream.seek(0, os.SEEK_END) == 0: stream.write(b"0"); stream.flush()
            stream.seek(0); msvcrt.locking(stream.fileno(), msvcrt.LK_LOCK, 1)
        try: yield
        finally:
            if os.name == "posix": fcntl.flock(stream.fileno(), fcntl.LOCK_UN)
            else:
                stream.seek(0); msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)

def publish_directory(destination, writer):
    destination = Path(destination).absolute()
    need(not destination.exists() and not destination.is_symlink(), "DESTINATION_EXISTS",
         "Select a new private destination; retain the existing deployment for resumption.")
    destination.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix="." + destination.name + "-", dir=destination.parent))
    try:
        writer(stage)
        # The destination must remain absent; a concurrent publication is never overwritten.
        with locked(destination.parent / ("." + destination.name + ".publish.lock")):
            need(not destination.exists() and not destination.is_symlink(), "DESTINATION_EXISTS", "Another operation published this destination.")
            os.rename(stage, destination)
    finally:
        if stage.exists(): shutil.rmtree(stage)

def configure(args):
    entry = parse(private_file(Path(args.operator_entry).absolute(), 32768))
    need(entry.get("schema") == "commons.pmrs-local-entry.v1", "OPERATOR_ENTRY", "Use the actual original operator entry file.")
    config = {"schema": "commons.pmrs-cloud-caller.v1", "workspace_id": entry["workspace_id"],
              "operator_entry_file": str(Path(args.operator_entry).absolute()),
              "host": args.listen, "port": args.port, "public_host": args.public_host,
              "certificate_file": str(Path(args.certificate).absolute()),
              "private_key_file": str(Path(args.private_key).absolute()), "principals": {}}
    credentials = {}
    for group, kinds in GROUPS.items():
        password, salt = secrets.token_urlsafe(48), secrets.token_bytes(32)
        config["principals"][group] = {"salt": salt.hex(),
            "password_hash": hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 600000).hex(),
            "iterations": 600000, "kinds": kinds, "enabled": True}
        credentials[group] = {"username": group, "password": password}
    def write(stage):
        save(stage / "caller.json", body(config))
        save(stage / "connection-credentials.json", body(credentials))
        actual = config_read(stage / "caller.json")
        Native(actual).state()
        private_file(actual["private_key_file"], 1024 * 1024)
    publish_directory(args.output, write)
    return {"state": "CONFIGURED", "workspace_id": config["workspace_id"],
            "configuration": str(Path(args.output).absolute() / "caller.json"),
            "credential_file": str(Path(args.output).absolute() / "connection-credentials.json")}

def validate_bindings(value):
    need(isinstance(value, dict) and set(value) == {
        "schema", "organization_url", "environment_id", "solution_unique_name",
        "connector_api_name", "public_host", "workspace_id", "connections"},
        "BINDINGS", "Use the complete deployment binding file.")
    need(value["schema"] == "commons.pmrs-flow-bindings.v1", "BINDINGS", "Unsupported deployment binding format.")
    u = urllib.parse.urlsplit(value["organization_url"])
    need(u.scheme == "https" and not u.username and not u.password and not u.query
         and not u.fragment and u.path in {"", "/"} and u.port in {None, 443}
         and u.hostname and any(u.hostname.endswith("." + suffix)
         for suffix in ("dynamics.com", "microsoftdynamics.us", "dynamics.cn")),
         "ORGANIZATION", "Use the actual Dataverse organization HTTPS origin from Developer resources.")
    value["organization_url"] = value["organization_url"].rstrip("/")
    host = urllib.parse.urlsplit("https://" + value["public_host"])
    need(host.netloc == value["public_host"] and host.hostname and not host.username
         and not host.password and not host.path and not host.query and not host.fragment,
         "HOST", "Select the actual private TLS certificate host.")
    for key in ("environment_id", "workspace_id"):
        identity = value[key]
        if key == "environment_id" and isinstance(identity, str) and identity.startswith("Default-"): identity = identity[8:]
        try: need(str(uuid.UUID(identity)) == identity, "IDENTITY", "Use the actual canonical " + key + ".")
        except (ValueError, TypeError): raise CallerError("IDENTITY", "Use the actual canonical " + key + ".")
    need(re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,99}", value["solution_unique_name"]),
         "SOLUTION", "Use the actual existing unmanaged solution unique name.")
    need(re.fullmatch(r"[A-Za-z0-9_-]{1,200}", value["connector_api_name"]),
         "CONNECTOR", "Use the exact connector API name returned by its actual installation.")
    need(isinstance(value["connections"], dict) and set(value["connections"]) == set(GROUPS),
         "CONNECTIONS", "Bind each role to its actual gateway connection/reference.")
    for group, item in value["connections"].items():
        need(isinstance(item, dict) and set(item) == {"connection_id", "connection_reference_logical_name"},
             "CONNECTION", "Retain both existing connection identities for " + group + ".")
        need(re.fullmatch(r"[A-Za-z0-9_-]{1,250}", item["connection_id"]) and
             re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,127}", item["connection_reference_logical_name"]),
             "CONNECTION", "Use the exact installed connection/reference names.")
    return value

def bindings_read(path):
    return validate_bindings(parse(read(path)))

def prepare_connector(args):
    value = parse(read(ROOT / "connector/apiDefinition.swagger.json"))
    u = urllib.parse.urlsplit("https://" + args.public_host)
    need(u.netloc == args.public_host and u.hostname and not u.username and not u.password
         and not u.path and not u.query and not u.fragment, "HOST", "Select the actual private TLS certificate host.")
    value["host"] = args.public_host
    def write(stage):
        save(stage / "apiDefinition.swagger.json", body(value))
        save(stage / "apiProperties.json", read(ROOT / "connector/apiProperties.json"))
    publish_directory(args.output, write)
    return {"state": "CONNECTOR_PREPARED", "directory": str(Path(args.output).absolute())}

def prepare_flows(args):
    bindings = bindings_read(args.bindings)
    def write(stage):
        files, flows = {}, []
        for group in GROUPS:
            source = parse(read(ROOT / ("flows/" + group + ".clientdata.json")))
            text = json.dumps(source, ensure_ascii=False)
            selected = bindings["connections"][group]
            for key, value in {"__CONNECTOR_API_NAME__": bindings["connector_api_name"],
                "__CONNECTION_ID__": selected["connection_id"],
                "__CONNECTION_REFERENCE_LOGICAL_NAME__": selected["connection_reference_logical_name"],
                "__WORKSPACE_ID__": bindings["workspace_id"]}.items():
                text = text.replace(key, value)
            clientdata = parse(text)
            workflow_id = str(uuid.uuid4())
            flow = {"workflowid": workflow_id, "category": 5, "type": 1, "primaryentity": "none",
                    "name": "PMRS original " + group,
                    "description": "Retains original workspace command and conditional delivery identities.",
                    "clientdata": json.dumps(clientdata, ensure_ascii=False, separators=(",", ":"))}
            name = group + ".workflow.json"; raw = body(flow)
            save(stage / name, raw)
            files[name] = {"bytes": len(raw), "sha256": sha(raw)}
            flows.append({"group": group, "workflow_id": workflow_id, "file": name})
        manifest = {"schema": "commons.pmrs-flow-deployment.v1", "deployment_id": str(uuid.uuid4()),
                    "created_at": now(), "bindings": bindings, "flows": flows, "files": files}
        save(stage / "deployment.json", body(manifest))
    publish_directory(args.output, write)
    return {"state": "FLOWS_PREPARED", "directory": str(Path(args.output).absolute()),
            "next": "Retain this exact directory and its three generated workflow IDs for install/resume."}

class Dataverse:
    def __init__(self, manifest, journal, journal_path):
        self.binding, self.journal, self.path = manifest["bindings"], journal, journal_path
        self.origin = self.binding["organization_url"] + "/api/data/v9.2/"
        token = os.environ.get("PMRS_DATAVERSE_ACCESS_TOKEN", "")
        need(token and not any(c.isspace() for c in token), "ACCESS_TOKEN",
             "Set the current tenant-approved Dataverse token in PMRS_DATAVERSE_ACCESS_TOKEN.")
        self.token = token
    def request(self, method, path, payload=None, headers=None):
        need(not path.startswith(("/", "http")) and "#" not in path and "\\" not in path,
             "DATAVERSE_PATH", "Use the selected original Dataverse resource.")
        floor = self.journal.get("not_before")
        if floor:
            eligible = dt.datetime.fromisoformat(floor.replace("Z", "+00:00"))
            need(dt.datetime.now(dt.timezone.utc) >= eligible, "PROVIDER_RETRY_AFTER",
                 "Resume this deployment after the actual provider retry time.", 429, eligible_at=floor)
        sent = now()
        record = {"method": method, "path": path, "started_at": sent,
                  "request_sha256": sha(body(payload)) if payload is not None else None, "state": "DISPATCHING"}
        self.journal["attempts"].append(record); save(self.path, body(self.journal))
        h = {"Authorization": "Bearer " + self.token, "Accept": "application/json",
             "OData-MaxVersion": "4.0", "OData-Version": "4.0"}
        if payload is not None: h["Content-Type"] = "application/json; charset=utf-8"
        h.update(headers or {})
        request = urllib.request.Request(self.origin + path, data=body(payload) if payload is not None else None,
                                         headers=h, method=method)
        opener = urllib.request.build_opener(NoRedirect())
        try:
            try: response = opener.open(request, timeout=60)
            except urllib.error.HTTPError as error: response = error
            with response:
                raw = response.read(MAX + 1)
                need(len(raw) <= MAX, "PROVIDER_SIZE", "The provider response exceeds 16 MiB.", 502)
                expected = response.headers.get("Content-Length")
                need(expected is None or (expected.isdigit() and int(expected) == len(raw)),
                     "PROVIDER_INCOMPLETE", "The provider response ended early.", 502)
                status, rh = int(response.status), dict(response.headers.items())
        except (OSError, urllib.error.URLError, http.client.HTTPException, CallerError):
            record.update(state="UNRESOLVED", completed_at=now()); save(self.path, body(self.journal))
            raise CallerError("PROVIDER_OUTCOME_UNRESOLVED",
                "Re-run the same deployment; it reads the retained workflow IDs before any continuation.", 502)
        response_dir = self.path.parent / "provider-responses"
        response_dir.mkdir(exist_ok=True, mode=0o700)
        response_name = str(len(self.journal["attempts"])).zfill(6) + ".body"
        save(response_dir / response_name, raw)
        record.update(state="RECEIVED", status=status, completed_at=now(), response_file="provider-responses/" + response_name,
                      response_sha256=sha(raw), response_bytes=len(raw),
                      request_id=rh.get("x-ms-service-request-id") or rh.get("REQ_ID"))
        retry = next((v for k, v in rh.items() if k.lower() == "retry-after"), None)
        if retry is not None:
            record["retry_after"] = retry
            try:
                deadline = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(seconds=int(retry))
                    if str(retry).isdigit() else email.utils.parsedate_to_datetime(retry))
                if deadline.tzinfo is None: raise ValueError("Provider retry time has no timezone")
                self.journal["not_before"] = deadline.astimezone(dt.timezone.utc).isoformat().replace("+00:00", "Z")
            except (ValueError, TypeError, OverflowError):
                self.journal["retry_after_unparsed"] = retry
        save(self.path, body(self.journal))
        need("retry_after_unparsed" not in self.journal, "RETRY_AFTER",
             "Retain and resolve the provider's unparsed retry instruction before continuation.", 429)
        return status, rh, raw
    def get(self, path, absent=False):
        status, headers, raw = self.request("GET", path)
        if absent and status == 404: return None
        need(status == 200, "DATAVERSE_READ", "The selected Dataverse read was refused.", status,
             provider_status=status, response_sha256=sha(raw))
        return parse(raw)

def check_flow(value, expected):
    need(isinstance(value, dict), "FLOW_READBACK", "The original workflow read is missing.")
    for key in ("workflowid", "category", "type", "primaryentity", "name"):
        need(value.get(key) == expected[key], "FLOW_CONFLICT", "The retained workflow identity/content differs: " + key, 409)
    need(parse(value.get("clientdata", "")) == parse(expected["clientdata"]),
         "FLOW_CONFLICT", "The existing workflow definition or connection binding differs. Retain both editions for the original owner.", 409)
    return value

def verify_bindings(api, manifest):
    binding = manifest["bindings"]
    query = urllib.parse.urlencode({"$select": "solutionid,uniquename,ismanaged",
        "$filter": "uniquename eq '" + binding["solution_unique_name"] + "'"})
    solutions = api.get("solutions?" + query)
    need(len(solutions.get("value", [])) == 1 and solutions["value"][0].get("ismanaged") is False,
         "SOLUTION", "Select the existing original unmanaged deployment solution.")
    for group, selected in binding["connections"].items():
        query = urllib.parse.urlencode({"$select": "connectionreferencelogicalname,connectionid,connectorid",
            "$filter": "connectionreferencelogicalname eq '" + selected["connection_reference_logical_name"] + "'"})
        rows = api.get("connectionreferences?" + query).get("value", [])
        need(len(rows) == 1, "CONNECTION_REFERENCE", "The selected original connection reference is not unique: " + group)
        row = rows[0]
        need(row.get("connectionid") == selected["connection_id"] and
             str(row.get("connectorid", "")).rstrip("/").split("/")[-1] == binding["connector_api_name"],
             "CONNECTION_REFERENCE", "The installed reference differs from the selected original connector/connection: " + group)
    return solutions["value"][0]

def deployment_read(directory):
    directory = Path(directory).absolute()
    need(directory.is_dir() and not directory.is_symlink(), "DEPLOYMENT_DIRECTORY", "Select the original owned deployment directory.")
    raw = read(directory / "deployment.json")
    manifest = parse(raw)
    need(isinstance(manifest, dict) and set(manifest) == {
        "schema", "deployment_id", "created_at", "bindings", "flows", "files"} and
        manifest["schema"] == "commons.pmrs-flow-deployment.v1",
        "DEPLOYMENT", "Select the original complete prepared deployment.")
    def original_id(value):
        try: return isinstance(value, str) and str(uuid.UUID(value)) == value and uuid.UUID(value).version == 4
        except (ValueError, TypeError): return False
    need(original_id(manifest["deployment_id"]), "DEPLOYMENT_ID", "Retain the actual prepared deployment UUIDv4.")
    manifest["bindings"] = validate_bindings(manifest["bindings"])
    need(isinstance(manifest["flows"], list) and len(manifest["flows"]) == 3 and
         all(isinstance(x, dict) and set(x) == {"group", "workflow_id", "file"}
             and x["group"] in GROUPS and original_id(x["workflow_id"]) for x in manifest["flows"]),
         "DEPLOYMENT", "Select the original three complete workflow identities.")
    need(set(x["group"] for x in manifest["flows"]) == set(GROUPS) and
         len(set(x["workflow_id"] for x in manifest["flows"])) == 3 and
         isinstance(manifest["files"], dict) and set(manifest["files"]) ==
         {group + ".workflow.json" for group in GROUPS},
         "DEPLOYMENT", "The original workflow groups, IDs or complete source selection differ.")
    expected = {}
    for flow in manifest["flows"]:
        name = flow["file"]
        need(name == flow["group"] + ".workflow.json", "DEPLOYMENT_PATH", "Unexpected prepared workflow path.")
        selected = read(directory / name)
        need(manifest["files"][name] == {"bytes": len(selected), "sha256": sha(selected)},
             "DEPLOYMENT_SOURCE", "A prepared workflow changed; retain the original edition.")
        candidate = parse(selected)
        need(isinstance(candidate, dict) and set(candidate) == {
            "workflowid", "category", "type", "primaryentity", "name", "description", "clientdata"}
             and candidate["workflowid"] == flow["workflow_id"] and candidate["category"] == 5
             and candidate["type"] == 1 and candidate["primaryentity"] == "none",
             "DEPLOYMENT_ID", "The prepared original cloud-flow identity differs.")
        need(isinstance(candidate["clientdata"], str) and isinstance(parse(candidate["clientdata"]), dict),
             "FLOW_DEFINITION", "Retain the complete original flow clientdata.")
        expected[flow["group"]] = candidate
    return directory, manifest, sha(raw), expected

def install(args):
    directory, manifest, identity, expected = deployment_read(args.deployment)
    with locked(directory / ".install.lock"):
        path = directory / "installation.json"
        journal = parse(read(path)) if path.exists() else {
            "schema": "commons.pmrs-flow-installation.v1", "deployment_sha256": identity,
            "deployment_id": manifest["deployment_id"], "attempts": [], "flows": {}}
        need(journal["deployment_sha256"] == identity, "DEPLOYMENT_CHANGED", "The original deployment changed after installation began.")
        need("retry_after_unparsed" not in journal, "PROVIDER_RETRY_AFTER",
             "Resolve the retained provider retry instruction in the original deployment before continuing.", 429)
        api = Dataverse(manifest, journal, path)
        solution = verify_bindings(api, manifest)
        for flow in manifest["flows"]:
            selected = expected[flow["group"]]
            resource = "workflows(" + flow["workflow_id"] + ")"
            view = resource + "?$select=workflowid,workflowidunique,name,category,type,primaryentity,clientdata,statecode,ismanaged"
            current = api.get(view, absent=True)
            if current is None:
                # The explicit primary key was saved before the first provider call.
                # A lost POST response cannot create another workflow on resumption.
                status, _, raw = api.request("POST", "workflows", selected,
                    {"MSCRM.SolutionUniqueName": manifest["bindings"]["solution_unique_name"]})
                if not 200 <= status < 300:
                    # A racing same-ID create may already have succeeded; read it once.
                    current = api.get(view, absent=True)
                    need(current is not None, "FLOW_CREATE", "The provider refused the original workflow create.", status,
                         provider_status=status, response_sha256=sha(raw))
                else: current = api.get(view)
            check_flow(current, selected)
            need(current.get("ismanaged") is False, "MANAGED_FLOW", "The original flow is now managed; use its solution owner.")
            # Verify original solution membership independently of create response.
            q = urllib.parse.urlencode({"$select": "solutioncomponentid,objectid",
                "$filter": "_solutionid_value eq " + solution["solutionid"]
                    + " and componenttype eq 29 and objectid eq " + flow["workflow_id"]})
            membership = api.get("solutioncomponents?" + q).get("value", [])
            need(bool(membership), "SOLUTION_MEMBERSHIP", "The workflow is not in the selected original solution; use its original solution owner.")
            if args.activate and current.get("statecode") != 1:
                need(current.get("statecode") == 0, "FLOW_STATE", "The original flow is suspended; inspect it before activation.")
                etag = current.get("@odata.etag")
                need(isinstance(etag, str) and etag, "FLOW_ETAG", "The original workflow lacks its concurrency token.")
                status, _, raw = api.request("PATCH", resource, {"statecode": 1}, {"If-Match": etag})
                need(status in {200, 204}, "FLOW_ACTIVATION", "The selected original activation was refused.", status,
                     provider_status=status, response_sha256=sha(raw))
                current = check_flow(api.get(view), selected)
                need(current["statecode"] == 1, "FLOW_ACTIVATION", "The provider did not return an active original flow.")
            journal["flows"][flow["group"]] = {"workflow_id": flow["workflow_id"],
                "workflow_id_unique": current.get("workflowidunique"), "statecode": current["statecode"],
                "definition_sha256": sha(body(parse(current["clientdata"]))), "verified_at": now(),
                "solution_id": solution["solutionid"], "etag": current.get("@odata.etag")}
            save(path, body(journal))
        journal["state"] = "ACTIVE" if all(x["statecode"] == 1 for x in journal["flows"].values()) else "INSTALLED_OFF"
        journal["completed_at"] = now(); save(path, body(journal))
        return {"state": journal["state"], "deployment_id": manifest["deployment_id"],
                "journal": str(path), "flows": journal["flows"]}

def main():
    p = argparse.ArgumentParser(description=__doc__); sub = p.add_subparsers(dest="command", required=True)
    c = sub.add_parser("configure")
    for key in ("operator-entry", "listen", "public-host", "certificate", "private-key", "output"):
        c.add_argument("--" + key, required=True)
    c.add_argument("--port", type=int, default=9443)
    c = sub.add_parser("connector"); c.add_argument("--public-host", required=True); c.add_argument("--output", required=True)
    c = sub.add_parser("prepare"); c.add_argument("--bindings", required=True); c.add_argument("--output", required=True)
    c = sub.add_parser("install"); c.add_argument("--deployment", required=True)
    c.add_argument("--activate", action="store_true", help="After commissioning, activate the same verified original flows.")
    args = p.parse_args()
    try:
        result = {"configure": configure, "connector": prepare_connector, "prepare": prepare_flows, "install": install}[args.command](args)
        print(json.dumps(result, ensure_ascii=False, indent=2)); return 0
    except CallerError as error:
        print(json.dumps(error.value(), ensure_ascii=False, indent=2)); return 2

if __name__ == "__main__": raise SystemExit(main())
