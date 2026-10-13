#!/usr/bin/env python3
"""Receive the complete existing Grant Operations installation and operate its copy."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import threading
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from uuid import uuid4

from model import HERE, Problem, Workspace
from staff_installation import (
    DATABASE, MANIFEST, SOURCE_PREFIX, APPLICATION, business_fingerprints,
    export_installation, inspect_installation, private_json, restore_installation,
    sha, staff_roster, write_private, launcher_boot_files,
)


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def _domain_tables(db):
    # The receiving owner intentionally issues new credentials and opens sessions.
    # Their new staff events must not be confused with a changed original case.
    return {name: value for name, value in business_fingerprints(db).items()
            if not name.startswith("staff_") and name != "sqlite_sequence"}


def _request(server, path, body=None, *, owner=False, cookie=None, csrf=None):
    headers = {}
    if owner:
        headers["Authorization"] = "Bearer " + server.token
    if cookie:
        headers["Cookie"] = cookie
    raw = None
    if body is not None:
        raw = json.dumps(body, ensure_ascii=False, allow_nan=False).encode()
        headers.update({"Content-Type": "application/json", "Origin": server.origin})
        if csrf:
            headers["X-CSRF-Token"] = csrf
    try:
        response = urlopen(Request(server.origin + path, data=raw, headers=headers), timeout=15)
    except HTTPError as error:
        response = error
    with response:
        data = response.read()
        media = response.headers.get("Content-Type", "")
        value = json.loads(data) if media.startswith("application/json") else data
        return response.status, value, dict(response.headers.items())


def _close(server, worker):
    server.shutdown()
    worker.join(timeout=10)
    server.server_close()
    server.workspace.close()
    require(not worker.is_alive(), "The receiving server did not finish its original shutdown.")


def _operate_received(request):
    from server import create_server
    from staff_access import SCHEMA as ACCESS_SCHEMA
    from managed_launch import selection as managed_selection

    root = Path(request["workspace"]).resolve()
    manifest = json.loads((root / MANIFEST).read_bytes())
    require(inspect_installation(request["archive"]) == manifest,
            "The receiving copy does not retain the selected complete backup.")
    require(not (root / "access.key").exists(), "The received copy reused an owner access key.")
    db = sqlite3.connect(root / DATABASE)
    try:
        require(business_fingerprints(db) == manifest["database"]["businessTables"],
                "Original business data changed before receiving startup.")
        original_roster = staff_roster(db)
        require(original_roster == manifest["staff"]["roster"], "Staff assignments changed during restore.")
        for name in ("staff_sessions", "staff_requests", "staff_login_attempts"):
            require(db.execute("SELECT COUNT(*) FROM " + name).fetchone()[0] == 0,
                    "The receiving copy retained " + name + ".")
        require(db.execute("SELECT COUNT(*) FROM staff_members WHERE credential_hash IS NOT NULL").fetchone()[0] == 0,
                "The receiving copy retained a previous login code.")
        require(db.execute("SELECT COUNT(*) FROM staff_metadata WHERE key='installation_id'").fetchone()[0] == 0,
                "The receiving copy retained the previous installation identity.")
        expected_domain = _domain_tables(db)
    finally:
        db.close()

    # Exercise the original Applications selection on the independently received
    # source. Every boot hash must refer to the exact member in this backup.
    selected, selected_sha = managed_selection(root, root / "scenario.json", HERE)
    boot_names = launcher_boot_files(HERE)
    require(set(selected["sourceSha256"]) == set(boot_names),
            "The received Applications launcher selected another source inventory.")
    source_repository = HERE.resolve().parents[3]
    source_members = {row["path"]: row for row in manifest["files"]
                      if row["path"].startswith(SOURCE_PREFIX)}
    for name in boot_names:
        relative = (HERE / name).resolve().relative_to(source_repository).as_posix()
        record = source_members.get(SOURCE_PREFIX + relative)
        require(record is not None and selected["sourceSha256"][name] == record["sha256"],
                "An Applications boot file differs from the received source manifest: " + name)
    node = shutil.which("node")
    require(node is not None, "The original Applications selector needs the installed Node runtime.")
    node_code = (
        "import {pathToFileURL} from 'node:url';"
        "const source=await import(pathToFileURL(process.argv[1]).href);"
        "const result=await source.inspectGrantWorkspaceSelection({"
        "workspaceDirectory:process.argv[2],scenarioFile:process.argv[3],"
        "pythonExecutable:process.argv[4]});"
        "process.stdout.write(JSON.stringify(result)+'\\n');"
    )
    node_command = [node, "--input-type=module", "-e", node_code,
                    str(HERE / "launch.mjs"), str(root), str(root / "scenario.json"),
                    selected["pythonExecutable"]]
    try:
        node_process = subprocess.run(node_command, capture_output=True, cwd=root,
                                      timeout=45, check=False)
    except subprocess.TimeoutExpired as error:
        write_private(root / "applications-selector.stdout", error.stdout or b"")
        write_private(root / "applications-selector.stderr", error.stderr or b"")
        write_private(root / "applications-selector-process.json", private_json(
            {"command": node_command, "state": "TIMED_OUT", "timeoutSeconds": error.timeout}))
        raise RuntimeError("The original Applications source selection exceeded its interval.") from error
    write_private(root / "applications-selector.stdout", node_process.stdout)
    write_private(root / "applications-selector.stderr", node_process.stderr)
    write_private(root / "applications-selector-process.json", private_json(
        {"command": node_command, "returncode": node_process.returncode}))
    require(node_process.returncode == 0, "The received Applications source selector failed.")
    node_selected = json.loads(node_process.stdout)
    require(node_selected["selection"] == selected
            and node_selected["selectionSha256"] == selected_sha,
            "The Python and Node Applications selectors disagree on the received installation.")
    require(node_selected["sourceFiles"] == [str((HERE / name).resolve()) for name in boot_names],
            "The received Python and Node Applications boot file selections differ.")
    write_private(root / "received-application-selection.json", private_json(
        {"selection": selected, "selectionSha256": selected_sha,
         "pythonAndNode": "IDENTICAL", "sourceFiles": node_selected["sourceFiles"]}))

    server = create_server(root, root / "scenario.json", port=0)
    worker = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True)
    worker.start()
    issued, sessions = {}, []
    try:
        require(server.staff.installation_id != request.get("previousInstallationId"),
                "The receiving copy reused the previous installation identity.")
        owner_hash = sha((root / "access.key").read_bytes())
        require(owner_hash != request.get("previousOwnerKeySha256"),
                "The receiving copy reused the previous owner access key.")
        status, profiles, _ = _request(server, "/api/staff/members", owner=True)
        require(status == 200, "The receiving owner could not open the retained staff roster.")
        members = profiles["members"]
        require(len(members) == len(original_roster), "A retained staff profile is missing.")
        require(all(not row["credentialReady"] and row["activeSessions"] == 0 for row in members),
                "The restored staff profiles retained usable old access.")

        for member in members:
            before = next(row for row in original_roster if row["id"] == member["id"])
            require(member["role"] == before["role"]
                    and member["state"] == before["state"]
                    and member["actor"] == before["actor"]
                    and member["caseIds"] == json.loads(before["case_ids_json"])
                    and member["contributorIds"] == json.loads(before["contributor_ids_json"]),
                    "The receiving profile differs from its original role or assignments.")
            if member["state"] != "ACTIVE":
                continue
            body = {"requestId": "staff-receiving-" + uuid4().hex, "id": member["id"],
                    "expectedRevision": member["revision"]}
            status, rotated, _ = _request(server, "/api/staff/members/rotate", body, owner=True)
            require(status == 200 and rotated.get("credentialIssued") and rotated.get("accessCode"),
                    "The receiving owner could not issue a fresh staff code.")
            code = rotated["accessCode"]
            issued[member["id"]] = code
            status, session, headers = _request(server, "/api/staff/login",
                                               {"staffId": member["id"], "accessCode": code})
            require(status == 200 and session.get("authenticated"), "A restored staff member could not sign in.")
            cookie = headers.get("Set-Cookie", "").split(";", 1)[0]
            require(cookie.startswith(server.staff.cookie_name + "="), "The new session cookie uses another installation.")
            require("HttpOnly" in headers.get("Set-Cookie", "") and "SameSite=Strict" in headers.get("Set-Cookie", ""),
                    "The receiving staff cookie lost its access attributes.")
            route = "/api/staff/workboard" if member["role"] == "contributor" else "/api/operations"
            status, view, _ = _request(server, route, cookie=cookie)
            require(status == 200, "A restored staff profile could not open its assigned operating desk.")
            selected = view["cases"]
            allowed = member["caseIds"]
            ids = [row["program"]["id"] if member["role"] == "contributor" else row["id"] for row in selected]
            require(allowed == ["*"] or all(value in allowed for value in ids),
                    "A restored staff profile received a case outside its original selection.")
            sessions.append({"id": member["id"], "role": member["role"], "caseIds": ids,
                             "signIn": "ACCEPTED", "deskStatus": status})

        status, owner_view, _ = _request(server, "/api/operations", owner=True)
        require(status == 200, "The receiving owner could not open the original operating cases.")
        with server.workspace.mutex:
            require(_domain_tables(server.workspace.db) == expected_domain,
                    "Staff reissue or sign-in changed an original business table.")
        first_identity = server.staff.installation_id
        first_key = owner_hash
        case_ids = [row["id"] for row in owner_view["cases"]]
    finally:
        _close(server, worker)

    # Use the same installed source and saved database again after the process-level close.
    reopened = create_server(root, root / "scenario.json", port=0)
    second = threading.Thread(target=reopened.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True)
    second.start()
    try:
        require(reopened.staff.installation_id == first_identity
                and sha((root / "access.key").read_bytes()) == first_key,
                "Cold reopen changed the receiving installation's access identity.")
        status, cases, _ = _request(reopened, "/api/operations", owner=True)
        require(status == 200 and [row["id"] for row in cases["cases"]] == case_ids,
                "Cold reopen lost the original operating cases.")
        for member_id, code in issued.items():
            status, session, _ = _request(reopened, "/api/staff/login",
                                         {"staffId": member_id, "accessCode": code})
            require(status == 200 and session.get("authenticated"), "A newly issued code failed after cold reopen.")
        with reopened.workspace.mutex:
            require(_domain_tables(reopened.workspace.db) == expected_domain,
                    "Cold reopen changed the original business data.")
    finally:
        _close(reopened, second)

    # The independent receiving account keeps these one-time credentials private.
    # They are never printed or included in the general result.
    write_private(root / "receiving-staff-codes.json", private_json(issued))
    result = {
        "schema": "stellar-forge.sf47-staff-installation-receiving.v1",
        "accessSchema": ACCESS_SCHEMA,
        "state": "COMPLETE",
        "completedAt": datetime.now(timezone.utc).isoformat(),
        "workspace": str(root),
        "sourceDirectory": str(HERE),
        "installationId": first_identity,
        "ownerKeySha256": first_key,
        "sourceManifestSha256": sha(private_json(manifest)),
        "staffProfiles": len(original_roster),
        "activeSignIns": len(sessions),
        "revokedProfiles": sum(row["state"] != "ACTIVE" for row in original_roster),
        "sessions": sessions,
        "caseIds": case_ids,
        "domainTables": expected_domain,
        "sourceFiles": manifest["application"]["sourceFiles"],
        "connections": manifest["connections"],
        "coldReopen": "COMPLETE",
        "applications": {"state": "SELECTED", "pythonAndNode": "IDENTICAL",
                         "selectionSha256": selected_sha,
                         "sourceFiles": len(boot_names),
                         "selectionFile": str(root / "received-application-selection.json")},
    }
    write_private(root / "RECEIVING.json", private_json(result))
    return result


def receive_archive(archive, directory, *, previous_installation_id=None, previous_owner_key_sha256=None):
    """Receive an existing complete online backup and operate only its separate copy."""
    output = Path(directory).expanduser().absolute()
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    raw = Path(archive).read_bytes() if isinstance(archive, (str, Path)) else bytes(archive)
    manifest = inspect_installation(raw)
    archive_path = output / "original-installation.zip"
    write_private(archive_path, raw)
    write_private(output / MANIFEST, private_json(manifest))
    received = restore_installation(raw, output / "received")
    entry = Path(received["sourceDirectory"]) / Path(__file__).name
    require(entry.is_file(), "The complete source archive is missing its receiving programme.")
    request = {"workspace": received["workspace"], "archive": str(archive_path),
               "previousInstallationId": previous_installation_id,
               "previousOwnerKeySha256": previous_owner_key_sha256}
    command = [sys.executable, str(entry), "--exercise-received"]
    try:
        process = subprocess.run(command, input=private_json(request), capture_output=True,
                                 cwd=received["workspace"], timeout=180, check=False)
    except subprocess.TimeoutExpired as error:
        write_private(output / "receiving.stdout", error.stdout or b"")
        write_private(output / "receiving.stderr", error.stderr or b"")
        write_private(output / "receiving-process.json", private_json(
            {"command": command, "state": "TIMED_OUT", "timeoutSeconds": error.timeout}))
        raise RuntimeError("The original receiving process exceeded its interval; its output is retained.") from error
    write_private(output / "receiving.stdout", process.stdout)
    write_private(output / "receiving.stderr", process.stderr)
    write_private(output / "receiving-process.json", private_json(
        {"command": command, "returncode": process.returncode}))
    require(process.returncode == 0, "The original receiving process failed; its complete output is retained.")
    native = json.loads(process.stdout)
    result = {"schema": "stellar-forge.sf47-staff-installation-receiving.v1", "state": "COMPLETE",
              "backup": {"path": str(archive_path), "bytes": len(raw), "sha256": sha(raw)},
              "restoration": received, "native": native}
    write_private(output / "result.json", private_json(result))
    return result


def receive_workspace(workspace, directory, *, source_directory=None):
    """Take an online snapshot of the already-operated original Workspace."""
    with workspace.mutex:
        row = workspace.db.execute("SELECT value FROM staff_metadata WHERE key='installation_id'").fetchone()
        previous_id = row[0] if row else None
        key = workspace.root / "access.key"
        previous_key = sha(key.read_bytes()) if key.exists() else None
    raw, _manifest = export_installation(workspace, source_directory=source_directory)
    return receive_archive(raw, directory, previous_installation_id=previous_id,
                           previous_owner_key_sha256=previous_key)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--exercise-received", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--workspace", type=Path)
    parser.add_argument("--archive", type=Path)
    parser.add_argument("--directory", type=Path)
    parser.add_argument("--source-directory", type=Path, default=HERE)
    args = parser.parse_args(argv)
    if args.exercise_received:
        result = _operate_received(json.load(sys.stdin))
    else:
        if args.directory is None or bool(args.workspace) == bool(args.archive):
            parser.error("Select --workspace or --archive and a new --directory.")
        if args.archive:
            result = receive_archive(args.archive, args.directory)
        else:
            require((args.workspace / DATABASE).is_file(), "Select the existing original planning workspace.")
            workspace = Workspace(args.workspace, args.source_directory.parent / "sf10_current_candidate.json")
            try:
                result = receive_workspace(workspace, args.directory, source_directory=args.source_directory)
            finally:
                workspace.close()
    print(json.dumps(result, ensure_ascii=False, sort_keys=True, allow_nan=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

