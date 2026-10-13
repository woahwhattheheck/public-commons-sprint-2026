"""Use and retain complete results from the selected private PMRS caller."""
from __future__ import annotations
import argparse
import base64
import hashlib
import http.client
import json
import os
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from pmrs_cloud_gateway import CallerError, need, private_file, NoRedirect, MAX_BODY, decode
from pmrs_cloud_deploy import body, save, locked, now, parse

def request(origin, credentials, method, path, payload, ca_file=None):
    value = urllib.parse.urlsplit(origin)
    need(value.scheme == "https" and value.hostname and not value.username and not value.password
         and value.path in {"", "/"} and not value.query and not value.fragment,
         "CALLER_ORIGIN", "Use the selected private HTTPS caller origin.")
    need(set(credentials) == {"username", "password"}, "CREDENTIAL", "Select one original caller credential.")
    pair = (credentials["username"] + ":" + credentials["password"]).encode("utf-8")
    headers = {"Authorization": "Basic " + base64.b64encode(pair).decode("ascii"),
               "Accept": "application/json"}
    raw = body(payload) if payload is not None else None
    if raw is not None:
        need(len(raw) <= MAX_BODY, "BODY_LIMIT", "The original connector envelope exceeds 2 MiB.")
        headers["Content-Type"] = "application/json"
    context = ssl.create_default_context(cafile=ca_file)
    opener = urllib.request.build_opener(NoRedirect(), urllib.request.HTTPSHandler(context=context))
    req = urllib.request.Request(origin.rstrip("/") + path, headers=headers, data=raw, method=method)
    try:
        try: response = opener.open(req, timeout=65)
        except urllib.error.HTTPError as error: response = error
        with response:
            received = response.read(MAX_BODY + 1)
            need(len(received) <= MAX_BODY, "RESPONSE_LIMIT", "The complete caller response exceeds its 2 MiB budget.", 502)
            expected = response.headers.get("Content-Length")
            need(expected is None or (expected.isdigit() and int(expected) == len(received)),
                 "RESPONSE_INCOMPLETE", "The caller response ended early.", 502)
            return int(response.status), received
    except CallerError: raise
    except (OSError, urllib.error.URLError, http.client.HTTPException):
        raise CallerError("CALLER_OUTCOME_UNRESOLVED",
            "Keep the original command and result directory. Read the same command or resume this same call.", 502)

def run(args):
    directory = Path(args.output).absolute()
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    need(directory.is_dir() and not directory.is_symlink(), "OUTPUT", "Select the owned original result directory.")
    if os.name == "posix": need(directory.stat().st_mode & 0o077 == 0, "OUTPUT_MODE", "Keep the complete receiving directory owner-only.")
    credentials = parse(private_file(Path(args.credentials).absolute()))
    need(args.principal in credentials, "PRINCIPAL", "Select an existing caller principal.")
    with locked(directory / ".client.lock"):
        raw_command = Path(args.command_file).read_bytes() if args.command_file else None
        if raw_command is not None:
            need(len(raw_command) <= MAX_BODY, "COMMAND_LIMIT", "The original command exceeds 2 MiB.")
            original = decode(raw_command)
            identifier = original.get("id") if isinstance(original, dict) else None
            need(isinstance(identifier, str), "COMMAND", "Select the complete original command file.")
            selected = {"kind": "command", "id": identifier, "principal": args.principal,
                        "origin": args.origin.rstrip("/"), "command_sha256": hashlib.sha256(raw_command).hexdigest(),
                        "group": args.group}
        else:
            selected = {"kind": args.resource, "id": args.identifier, "principal": args.principal,
                        "origin": args.origin.rstrip("/")}
        journal_path = directory / "client.json"
        journal = parse(journal_path.read_bytes()) if journal_path.exists() else {
            "schema": "commons.pmrs-caller-receiving.v1", "selected": selected, "attempts": []}
        need(journal["selected"] == selected, "RECEIVING_CHANGED", "This receiving directory belongs to another original command or view.")
        if raw_command is not None:
            original_path = directory / "original-command.json"
            if original_path.exists():
                need(original_path.read_bytes() == raw_command, "COMMAND_CHANGED", "Original command bytes changed.")
            else: save(original_path, raw_command)
        path = ("/v1/" + args.group if raw_command is not None else
                "/v1/" + {"command": "commands", "delivery": "deliveries", "record": "records"}[args.resource]
                + "/" + urllib.parse.quote(args.identifier, safe=""))
        payload = {"command_json": raw_command.decode("utf-8"), "resume_interrupted": args.resume_interrupted} if raw_command is not None else None
        method = "POST" if payload is not None else "GET"
        deadline = time.monotonic() + args.wait_seconds
        while True:
            number = len(journal["attempts"]) + 1
            attempt = {"number": number, "method": method, "path": path, "started_at": now(),
                       "state": "DISPATCHING", "resume_interrupted": args.resume_interrupted if payload else False}
            journal["attempts"].append(attempt); save(journal_path, body(journal))
            try: status, raw = request(args.origin, credentials[args.principal], method, path, payload, args.ca_file)
            except CallerError:
                attempt.update(state="UNRESOLVED", completed_at=now()); save(journal_path, body(journal)); raise
            response_name = "response-" + str(number).zfill(6) + ".json"
            save(directory / response_name, raw)
            attempt.update(state="RECEIVED", completed_at=now(), status=status, file=response_name,
                           sha256=hashlib.sha256(raw).hexdigest(), bytes=len(raw))
            journal["latest"] = attempt.copy()
            save(journal_path, body(journal))
            result = parse(raw)
            if status == 200 and isinstance(result, dict) and isinstance(result.get("native_json"), str):
                native = result["native_json"].encode("utf-8")
                need(hashlib.sha256(native).hexdigest() == result.get("native_sha256"),
                     "NATIVE_DIGEST", "The exact native response digest differs.")
                native_name = "native-" + str(number).zfill(6) + ".json"
                save(directory / native_name, native)
                attempt["native_file"] = native_name
                attempt["native_sha256"] = result["native_sha256"]
                journal["workspace_id"] = result.get("workspace_id")
                journal["original_state"] = result.get("state")
                journal["delivery_state"] = result.get("delivery_state", "")
            save(journal_path, body(journal))
            need(status == 200, "CALLER_REFUSED", "The selected caller returned an original refusal; inspect the saved complete response.", status,
                 response_file=str(directory / response_name))
            if result.get("stop_polling") is not False or args.wait_seconds == 0 or time.monotonic() >= deadline:
                return {"result_directory": str(directory), "state": result.get("state"),
                        "delivery_state": result.get("delivery_state"), "command_id": result.get("command_id"),
                        "record_id": result.get("record_id"), "delivery_id": result.get("delivery_id"),
                        "recovery": result.get("recovery"), "response": str(directory / response_name)}
            # Only read polling is automatic. Explicit recovery uses the same retained command file.
            time.sleep(min(10, max(0, deadline - time.monotonic())))
            method, payload = "GET", None
            path = "/v1/commands/" + result["command_id"]

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--origin", required=True); p.add_argument("--credentials", required=True)
    p.add_argument("--principal", choices=["capture", "prepare", "delivery"], required=True)
    p.add_argument("--output", required=True); p.add_argument("--ca-file")
    p.add_argument("--command-file"); p.add_argument("--group", choices=["capture", "prepare", "delivery"])
    p.add_argument("--resource", choices=["command", "record", "delivery"])
    p.add_argument("--identifier")
    p.add_argument("--resume-interrupted", action="store_true")
    p.add_argument("--wait-seconds", type=int, default=0)
    args = p.parse_args()
    try:
        need(0 <= args.wait_seconds <= 3600, "WAIT", "Select a polling window from zero to 3600 seconds.")
        need((bool(args.command_file) and bool(args.group) and not args.resource and not args.identifier)
             or (not args.command_file and not args.group and bool(args.resource) and bool(args.identifier)
                 and not args.resume_interrupted), "SELECTION", "Select one original command file/group, or one exact existing resource/identifier.")
        result = run(args)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 3 if result.get("state") in {"FAILED", "CANCELLED", "INTERRUPTED"} else 0
    except CallerError as error:
        print(json.dumps(error.value(), ensure_ascii=False, indent=2)); return 2

if __name__ == "__main__": raise SystemExit(main())
