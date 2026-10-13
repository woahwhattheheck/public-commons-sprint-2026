"""Operate the complete Delivery risks workflow through the installed SF47 HTTP API.

Use one private output directory per original operation and reuse it to resume.
The original server, plan calculator, case lifecycle, permissions and importer
perform every operation. This command does not start a server.
"""
from __future__ import annotations

import argparse
import base64
from copy import deepcopy
from datetime import date, timedelta, datetime, timezone
from http.cookies import SimpleCookie
import http.client
import io
import json
import os
from pathlib import Path
import uuid
from urllib.parse import quote, urlsplit
import zipfile

from operations_walkthrough import Receiving, atomic, encoded, sha

SCHEMA = "stellar-forge.sf47-delivery-risks-course.v1"
ACTOR = "Delivery risks operator exercise"
RISK_ID = "delivery-capacity"
ISSUE_ID = "handover-detail"
ACTION_ID = "confirm-capacity"
PURPOSE = "DELIVERY_RISK_REGISTER"


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def verified_archive(raw):
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        names = archive.namelist()
        require(len(names) == len(set(names)), "The native handover contains duplicate members.")
        files = {name: archive.read(name) for name in names}
    manifest = json.loads(files["MANIFEST.json"])
    selected = set()
    for entry in manifest["files"]:
        name = entry["path"]
        require(name in files and len(files[name]) == entry["bytes"]
                and sha(files[name]) == entry["sha256"], "A complete native handover member changed: " + name)
        selected.add(name)
    require(selected == set(files) - {"MANIFEST.json"}, "The complete native handover inventory differs.")
    return files


def reordered_archive(raw):
    """Same valid case, with review array order independent of saved versions."""
    files = verified_archive(raw)
    document = json.loads(files["operations.json"])
    document["reviews"].sort(key=lambda row: row["version"], reverse=True)
    files["operations.json"] = encoded(document)
    manifest = json.loads(files["MANIFEST.json"])
    for entry in manifest["files"]:
        if entry["path"] == "operations.json":
            entry.update(bytes=len(files["operations.json"]), sha256=sha(files["operations.json"]))
    files["MANIFEST.json"] = encoded(manifest)
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name in sorted(files):
            archive.writestr(name, files[name])
    return output.getvalue()


class Course(Receiving):
    def __init__(self, url, key_file, output, plan_id, source_manifest):
        address = urlsplit(url)
        if (address.scheme != "http" or address.hostname not in ("localhost", "127.0.0.1", "::1")
                or address.username or address.password or address.path not in ("", "/")
                or address.query or address.fragment):
            raise ValueError("Use the installed original loopback server origin.")
        self.origin, self.address = url.rstrip("/"), address
        self.token = Path(key_file).read_text().strip()
        require(bool(self.token), "The original private access key is empty.")
        self.output = Path(output).expanduser().resolve()
        self.output.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(self.output, 0o700)
        self.private = self.output / ".private"
        self.private.mkdir(exist_ok=True, mode=0o700)
        os.chmod(self.private, 0o700)
        self.checkpoint = self.output / "risk-course-checkpoint.json"
        self.secret_path = self.private / "risk-staff-codes.json"
        raw_selection = Path(source_manifest).read_bytes()
        selected = json.loads(raw_selection)
        require(isinstance(selected, dict), "Use the complete selected source manifest.")
        self.source = {"bytes": len(raw_selection), "sha256": sha(raw_selection),
                       "filename": Path(source_manifest).name}
        self.source_bytes = raw_selection
        members = selected.get("files")
        require(isinstance(members, list) and bool(members), "Use the complete original source member selection.")
        root = Path(__file__).resolve().parents[4]
        self.installed_source = []
        seen = set()
        for member in members:
            name = member.get("path")
            require(isinstance(name, str) and name not in seen, "Source members need distinct repository paths.")
            relative = Path(name)
            require(not relative.is_absolute() and ".." not in relative.parts,
                    "Source members must remain within the selected repository.")
            target = (root / relative).resolve()
            require(target.is_relative_to(root), "A selected source member resolves outside the original checkout.")
            raw = target.read_bytes()
            require(len(raw) == member["bytes"] and sha(raw) == member["sha256"],
                    "Installed source differs from the selected full member: " + name)
            self.installed_source.append({"path": name, "bytes": len(raw), "sha256": sha(raw)})
            seen.add(name)
        if self.checkpoint.exists():
            self.state = json.loads(self.checkpoint.read_bytes())
            require(self.state.get("schema") == SCHEMA and self.state["planId"] == plan_id
                    and self.state["source"] == self.source, "Resume the same plan and complete original source selection.")
            require(self.state["origin"] == self.origin, "Resume through this operation's original server origin.")
        else:
            self.state = {"schema": SCHEMA, "planId": plan_id, "source": self.source,
                          "origin": self.origin, "prefix": "risks-" + uuid.uuid4().hex,
                          "asOfDate": date.today().isoformat(), "steps": {}, "checks": {}, "staff": {}}
            atomic(self.output / "risk-course-source-selection.json", raw_selection)
            self.save()
        self.prefix = self.state["prefix"]
        self.secrets = json.loads(self.secret_path.read_bytes()) if self.secret_path.exists() else {}
        session = self.read("/api/staff/session")
        require(session.get("authenticated") and session["principal"]["role"] == "owner",
                "The original private key must select the installation owner.")
        installation_id = session["installationId"]
        if "installationId" in self.state:
            require(self.state["installationId"] == installation_id, "This course belongs to its original installation.")
        else:
            self.state["installationId"] = installation_id
            self.save()

    def check(self, name, action):
        if name in self.state["checks"]:
            return self.state["checks"][name]
        result = action()
        self.state["checks"][name] = result
        self.save()
        return result

    def version(self, case_id):
        return self.read("/api/operations/" + case_id)["program"]["version"]

    def command(self, key, case_id, action, data, note="Internal delivery risk operator exercise"):
        def build():
            return {"expectedVersion": self.version(case_id), "requestId": self.prefix + "-" + key,
                    "actor": ACTOR, "note": note, "action": action,
                    "data": data() if callable(data) else data}
        return self.step(key, "/api/operations/" + case_id + "/command", build)

    def seed(self, case_id):
        status, result = self.request("/api/operations/" + case_id + "/risk-register-seed",
                                     {"expectedVersion": self.version(case_id)})
        require(status == 200, "The original risk seed failed.")
        return result

    def edition(self, key, case_id, change):
        endpoint = "/api/operations/" + case_id
        if key not in self.state["steps"]:
            seed = self.seed(case_id)
            document = change(deepcopy(seed["document"]))
            version = self.version(case_id)
            status, preview = self.request(endpoint + "/risk-register-preview",
                {"expectedVersion": version, "document": document})
            require(status == 200, "The original risk preview failed: " + str(preview.get("message", status)))
            self.state["steps"][key] = {"path": endpoint + "/command", "expected": 200,
                "headers": {}, "binary": False, "body": {"expectedVersion": version,
                "requestId": self.prefix + "-" + key, "actor": ACTOR,
                "note": "Internal exercise: " + key, "action": "risk-register.save",
                "data": {"document": preview["document"], "expectedPreviewSha256": preview["previewSha256"]}}}
            self.save()
        retained = self.state["steps"][key]
        if "result" not in retained:
            status, lookup = self.request(endpoint + "/risk-register-request", {"command": retained["body"]})
            require(status == 200, "The original retained risk request could not be reconciled.")
            if lookup["found"]:
                retained["result"] = lookup["result"]
                self.save()
        return self.step(key, endpoint + "/command", lambda: retained["body"])

    def archive(self, key, case_id, review_id=None):
        name = key + ".zip"
        path = self.output / name
        if key not in self.state:
            route = "/api/operations/" + case_id
            route += "/risk-register/" + review_id + "/export.zip" if review_id else "/export.zip"
            raw = self.read(route)
            require(isinstance(raw, bytes), "Expected the original native ZIP bytes.")
            verified_archive(raw)
            atomic(path, raw)
            self.state[key] = {"path": name, "bytes": len(raw), "sha256": sha(raw)}
            self.save()
        raw = path.read_bytes()
        require(len(raw) == self.state[key]["bytes"] and sha(raw) == self.state[key]["sha256"],
                "The retained original ZIP changed.")
        return raw

    def staff_profile(self, role, case_id, contributor_id):
        member_id = self.prefix + "-" + role
        if role not in self.state["staff"]:
            self.state["staff"][role] = {"id": member_id, "create": {
                "id": member_id, "requestId": member_id + "-create",
                "displayName": "Risk course " + role, "role": role, "caseIds": [case_id],
                "contributorIds": {case_id: contributor_id} if role == "contributor" else {},
                "administrator": False}}
            self.save()
        row = self.state["staff"][role]
        if "member" not in row:
            status, result = self.request("/api/staff/members/create", row["create"])
            require(status == 200, "The original course staff enrollment failed.")
            if result.get("accessCode"):
                self.secrets[role] = {"staffId": member_id, "accessCode": result["accessCode"]}
                atomic(self.secret_path, encoded(self.secrets))
            row["member"] = result["member"]
            self.save()
        # Each accepted enrollment/rotation retains its original request.
        # A response lost before local code publication is reconciled first;
        # a confirmed replay without a code requires one NEW rotation request.
        for _ in range(2):
            if role in self.secrets:
                break
            rotations = row.setdefault("rotations", [])
            pending = rotations[-1] if rotations and "result" not in rotations[-1] else None
            if pending is None:
                actual = next(m for m in self.read("/api/staff/members")["members"] if m["id"] == member_id)
                pending = {"request": {"id": member_id, "expectedRevision": actual["revision"],
                    "requestId": member_id + "-recover-code-" + uuid.uuid4().hex}}
                rotations.append(pending)
                self.save()
            status, result = self.request("/api/staff/members/rotate", pending["request"])
            require(status == 200, "The original staff code rotation could not be reconciled.")
            if result.get("accessCode"):
                self.secrets[role] = {"staffId": member_id, "accessCode": result["accessCode"]}
                atomic(self.secret_path, encoded(self.secrets))
            pending["result"] = {key: value for key, value in result.items() if key != "accessCode"}
            row["member"] = result["member"]
            self.save()
        require(role in self.secrets, "Resume the retained staff recovery to receive the next original one-time code.")
        return self.secrets[role]

    def staff_request(self, path, body=None, *, cookie=None, csrf=None):
        headers = {"Origin": self.origin}
        if cookie:
            headers["Cookie"] = cookie
        if csrf:
            headers["X-CSRF-Token"] = csrf
        raw = encoded(body) if body is not None else None
        if body is not None:
            headers["Content-Type"] = "application/json"
        connection = http.client.HTTPConnection(self.address.hostname, self.address.port or 80, timeout=30)
        try:
            connection.request("POST" if body is not None else "GET", path, body=raw, headers=headers)
            response = connection.getresponse()
            result = response.read()
            result = json.loads(result) if "application/json" in response.getheader("Content-Type", "") else result
            return response.status, result, response.getheader("Set-Cookie")
        finally:
            connection.close()

    def staff_course(self, role, case_id, other_case_id, contributor_id, original_command):
        credentials = self.staff_profile(role, case_id, contributor_id)
        status, session, raw_cookie = self.staff_request("/api/staff/login", credentials)
        require(status == 200 and session.get("authenticated") and raw_cookie, "Original staff sign-in failed.")
        parsed_cookie = SimpleCookie(); parsed_cookie.load(raw_cookie)
        cookie = "; ".join(m.key + "=" + m.value for m in parsed_cookie.values())
        csrf = session["csrfToken"]
        expected = 403 if role == "contributor" else 200
        try:
            status, _, _ = self.staff_request("/api/operations/" + case_id + "/risk-register", cookie=cookie)
            require(status == expected, "The risk register read differs from the original staff role.")
            status, _, _ = self.staff_request("/api/operations/" + other_case_id + "/risk-register", cookie=cookie)
            require(status == 403, "A case-scoped staff profile reached another case.")
            if role != "contributor":
                seed = self.seed(case_id)
                status, _, _ = self.staff_request("/api/operations/" + case_id + "/risk-register-preview",
                    {"expectedVersion": self.version(case_id), "document": seed["document"]}, cookie=cookie, csrf=csrf)
                require(status == 200, "The assigned reader cannot inspect a current risk preview.")
                status, lookup, _ = self.staff_request("/api/operations/" + case_id + "/risk-register-request",
                    {"command": original_command}, cookie=cookie, csrf=csrf)
                require(status == 200 and lookup.get("found"), "The assigned reader cannot reconcile the retained risk save.")
            if role in ("finance", "reviewer", "contributor"):
                before = self.version(case_id)
                denied = deepcopy(original_command)
                denied.update(requestId=self.prefix + "-denied-" + role, expectedVersion=before)
                status, _, _ = self.staff_request("/api/operations/" + case_id + "/command",
                                                   denied, cookie=cookie, csrf=csrf)
                require(status == 403 and self.version(case_id) == before,
                        "A staff role outside delivery leads changed the risk register.")
            return {"memberId": credentials["staffId"], "role": role, "readStatus": expected,
                    "outsideCaseStatus": 403, "saveStatus": "browser lead exercise" if role == "lead" else 403}
        finally:
            self.staff_request("/api/staff/logout", {}, cookie=cookie, csrf=csrf)


def same_received(client, case_id, original, first_id, second_id, source_id, source_raw):
    view = client.read("/api/operations/" + case_id)
    require(view["program"]["mode"] == "WALKTHROUGH", "Receiving changed the original operating mode.")
    current = client.read("/api/operations/" + case_id + "/risk-register")
    require(current["current"]["id"] == second_id, "The received current edition is not the highest saved version.")
    expected = {r["id"]: r for r in original["reviews"] if r.get("purpose") == PURPOSE}
    for review_id in (first_id, second_id):
        edition = client.read("/api/operations/" + case_id + "/risk-register/" + review_id)
        require(edition["review"] == expected[review_id], "Receiving changed an immutable risk edition.")
        require(edition["current"]["retainedOriginalProgramId"] == original["program"]["id"],
                "Receiving lost the original programme identity.")
    history = client.read("/api/operations/" + case_id + "/risk-register-history/" + RISK_ID)
    require([row["edition"]["id"] for row in history["entries"]] == [second_id, first_id],
            "Receiving changed the original risk history order.")
    require(client.read("/api/operations/" + case_id + "/sources/" + source_id) == source_raw,
            "Receiving changed the original attachment bytes.")
    return {"caseId": case_id, "currentReviewId": second_id,
            "reviewIds": [first_id, second_id], "sourceSha256": sha(source_raw)}


def run(client):
    if client.state.get("result"):
        return verify(client)
    original = client.read("/api/plans/" + client.state["planId"])
    if "originalPlan" not in client.state:
        client.state["originalPlan"] = {key: original[key] for key in ("id", "revision", "contentSha256")}
        client.save()
    selected = client.state["originalPlan"]
    original = client.read("/api/plans/" + selected["id"] + "/revision/" + str(selected["revision"]))
    require(original["contentSha256"] == selected["contentSha256"], "The selected original plan changed.")
    copied = client.step("clone-plan", "/api/plans/" + original["id"] + "/clone", lambda: {
        "expectedRevision": selected["revision"],
        "name": "Delivery risks operator exercise", "requestId": client.prefix + "-clone-plan"})
    require(copied["contentSha256"] == selected["contentSha256"],
            "The cloned plan differs from the selected original immutable revision.")
    require(bool(copied["scenario"]["future_costs"]), "Select an original plan with a delivery package.")
    case = client.step("create-case", "/api/operations", lambda: {
        "planId": copied["id"], "selectedRevision": copied["revision"],
        "expectedContentSha256": copied["contentSha256"], "name": "Delivery risks operator exercise",
        "mode": "WALKTHROUGH", "calendarStart": client.state["asOfDate"],
        "actor": ACTOR, "requestId": client.prefix + "-create-case"})
    case_id = case["id"]
    day = client.state["asOfDate"]
    next_day = (date.fromisoformat(day) + timedelta(days=1)).isoformat()
    source_raw = encoded({"kind": "INTERNAL_OPERATOR_EXERCISE", "asOfDate": day,
        "observations": ["Delivery capacity review and handover detail are authored exercise inputs."],
        "sourceSelection": client.source})
    attached = client.command("attach-source", case_id, "source.add", {
        "filename": "delivery-risk-exercise.json", "mediaType": "application/json", "kind": "other",
        "contentBase64": base64.b64encode(source_raw).decode(), "observedAt": day + "T12:00:00Z", "sourceUrl": ""})
    provenance = {"sourceIds": [attached["recordId"]], "sourceNote": "Internal operator exercise inputs."}
    contributor = client.command("add-contributor", case_id, "contributor.save", {
        "name": "Exercise delivery lead", "kind": "PERSON", "contact": "", **provenance})
    owner_id, cost_id = contributor["recordId"], copied["scenario"]["future_costs"][0]["id"]

    def first_document(document):
        document.update(name="Delivery risk and action operator exercise", asOfDate=day,
                        note="Authored inputs exercising the installed original product.")
        common = {"description": "Internal workflow exercise", "identifiedOn": day, "ownerId": owner_id,
            "ownerNote": "Original case contributor", "impact": "MODERATE", "priority": "MEDIUM",
            "assessmentNote": "Entered exercise judgment", "trigger": "Named operator review",
            "nextReviewOn": day, "costIds": [cost_id],
            "review": {"on": day, "by": ACTOR, "note": "Initial operator assessment"},
            "resolution": {"on": None, "note": ""}, **provenance}
        action = {"id": ACTION_ID, "title": "Confirm delivery capacity", "description": "Exercise action",
            "ownerId": owner_id, "ownerNote": "", "status": "IN_PROGRESS", "dueOn": day,
            "completedOn": None, "progress": "Initial review underway", **provenance}
        document["risks"] = [
            {**deepcopy(common), "id": RISK_ID, "kind": "RISK", "title": "Delivery capacity review",
             "category": "STAFFING", "status": "MITIGATING", "likelihood": "POSSIBLE", "actions": [action]},
            {**deepcopy(common), "id": ISSUE_ID, "kind": "ISSUE", "title": "Handover detail to resolve",
             "category": "DELIVERY", "status": "OPEN", "likelihood": "NOT_APPLICABLE", "actions": []}]
        return document

    first = client.edition("first-edition", case_id, first_document)
    def first_check():
        shown = client.read("/api/operations/" + case_id + "/risk-register/" + first["recordId"])
        require(not shown["current"]["sourceChanged"], "Saving an edition incorrectly changes its linked source.")
        require(shown["report"]["counts"]["total"] == 2 and shown["report"]["counts"]["issues"] == 1,
                "The entered risk and issue were not reported.")
        original_command = client.state["steps"]["first-edition"]["body"]
        before = client.version(case_id)
        status, replay = client.request("/api/operations/" + case_id + "/command", original_command)
        require(status == 200 and replay == first and client.version(case_id) == before,
                "The original exact save replay duplicated the edition.")
        status, lookup = client.request("/api/operations/" + case_id + "/risk-register-request",
                                       {"command": original_command})
        require(status == 200 and lookup.get("found") and lookup["result"] == first,
                "The original request cannot recover its exact accepted edition.")
        altered = deepcopy(original_command); altered["note"] += " changed"
        status, _ = client.request("/api/operations/" + case_id + "/risk-register-request", {"command": altered})
        require(status == 409 and client.version(case_id) == before,
                "A different retained command was accepted under the original request identity.")
        return {"reviewId": first["recordId"], "originalVersion": before, "exactReplay": True}
    client.check("first-edition-and-recovery", first_check)

    def owner_change():
        current = client.read("/api/operations/" + case_id)
        row = next(x for x in current["records"]["contributors"] if x["id"] == owner_id)
        return {**row, "name": "Exercise delivery lead — reviewed"}
    client.command("update-linked-contributor", case_id, "contributor.save", owner_change)
    def changed_check():
        shown = client.read("/api/operations/" + case_id + "/risk-register/" + first["recordId"])
        require(shown["current"]["sourceChanged"] and shown["current"]["reason"],
                "The retained edition did not explain its changed linked contributor.")
        require(shown["review"]["sha256"] == first["reviewSha256"], "The retained first edition was rewritten.")
        return {"reviewId": first["recordId"], "sourceChanged": True}
    client.check("linked-source-change", changed_check)

    def second_document(document):
        document["asOfDate"] = next_day
        risk, issue = document["risks"]
        risk.update(status="MONITORING", nextReviewOn=next_day,
                    review={"on": next_day, "by": ACTOR, "note": "Capacity confirmed; continue monitoring."})
        risk["actions"][0].update(status="DONE", completedOn=next_day, progress="Named operator completed capacity review.")
        issue.update(status="RESOLVED", nextReviewOn=None,
                     review={"on": next_day, "by": ACTOR, "note": "Handover detail reviewed."},
                     resolution={"on": next_day, "note": "Handover detail recorded in this exercise."})
        return document
    second = client.edition("second-edition", case_id, second_document)
    def second_check():
        shown = client.read("/api/operations/" + case_id + "/risk-register/" + second["recordId"])
        require(not shown["current"]["sourceChanged"] and shown["report"]["counts"]["resolved"] == 1,
                "The successor did not bind its current source and resolved issue.")
        history = client.read("/api/operations/" + case_id + "/risk-register-history/" + RISK_ID)
        require([x["edition"]["id"] for x in history["entries"]] == [second["recordId"], first["recordId"]],
                "The original risk history does not preserve both editions in version order.")
        require(history["current"]["actions"][0]["id"] == ACTION_ID
                and history["current"]["actions"][0]["status"] == "DONE", "The original mitigation action was lost.")
        stale = client.state["steps"]["first-edition"]["body"]["data"]["document"]
        status, _ = client.request("/api/operations/" + case_id + "/risk-register-preview",
                                   {"expectedVersion": client.version(case_id), "document": stale})
        require(status == 409, "An old register replaced the current edition without its successor reference.")
        return {"reviewId": second["recordId"], "history": [second["recordId"], first["recordId"]]}
    client.check("successor-history", second_check)

    raw = client.archive("risk-course-original", case_id, second["recordId"])
    members = verified_archive(raw)
    original_case = json.loads(members["operations.json"])
    selection = json.loads(members["risk-register-selection.json"])
    require(selection["reviewId"] == second["recordId"], "The ZIP selected another risk edition.")
    for name in ("risk-register.json", "risk-register.csv", "risk-actions.csv", "risk-register.html"):
        require(name in members and bool(members[name]), "The risk handover is missing " + name)
    received = client.step("receive-original", "/api/operations/import?name=" + quote("Received risk operator exercise"),
        lambda: raw, headers={"Content-Type": "application/zip", "X-Request-ID": client.prefix + "-receive-original",
                             "X-Recorded-By": ACTOR})
    client.check("complete-original-receiving", lambda: same_received(client, received["id"], original_case,
        first["recordId"], second["recordId"], attached["recordId"], source_raw))
    reordered_path = client.output / "risk-course-reordered.zip"
    if "reorderedArchive" not in client.state:
        # Reuse already-journalled dispatch bytes if a process stopped between
        # the original request checkpoint and publishing this derived archive.
        step = client.state["steps"].get("receive-reordered")
        changed_raw = base64.b64decode(step["body"]) if step else reordered_archive(raw)
        atomic(reordered_path, changed_raw)
        client.state["reorderedArchive"] = {"path": reordered_path.name, "bytes": len(changed_raw),
                                           "sha256": sha(changed_raw)}
        client.save()
    changed_raw = reordered_path.read_bytes()
    require(len(changed_raw) == client.state["reorderedArchive"]["bytes"]
            and sha(changed_raw) == client.state["reorderedArchive"]["sha256"],
            "The retained reordered-review archive changed.")
    reordered = client.step("receive-reordered", "/api/operations/import?name=" + quote("Received risk editions in array order"),
        lambda: changed_raw, headers={"Content-Type": "application/zip", "X-Request-ID": client.prefix + "-receive-reordered",
                                     "X-Recorded-By": ACTOR})
    client.check("version-ordered-receiving", lambda: same_received(client, reordered["id"], original_case,
        first["recordId"], second["recordId"], attached["recordId"], source_raw))
    original_command = client.state["steps"]["second-edition"]["body"]
    for role in ("lead", "finance", "reviewer", "contributor"):
        client.check("staff-" + role, lambda role=role: client.staff_course(
            role, case_id, received["id"], owner_id, original_command))
    onward_raw = client.archive("risk-course-received", received["id"], second["recordId"])
    onward = verified_archive(onward_raw)
    onward_doc = json.loads(onward["operations.json"])
    before_reviews = {row["id"]: row for row in original_case["reviews"]}
    after_reviews = {row["id"]: row for row in onward_doc["reviews"]}
    require(before_reviews == after_reviews, "Onward handover changed a retained review.")
    result = {"schema": SCHEMA + ".result", "status": "PASS", "operationId": client.prefix,
        "originalCaseId": case_id, "receivedCaseId": received["id"], "reorderedReceivedCaseId": reordered["id"],
        "planId": copied["id"], "originalPlan": selected,
        "firstReviewId": first["recordId"], "secondReviewId": second["recordId"],
        "riskId": RISK_ID, "issueId": ISSUE_ID, "actionId": ACTION_ID, "sourceId": attached["recordId"],
        "sourceSha256": sha(source_raw), "sourceSelection": client.source,
        "installedSource": client.installed_source, "installationId": client.state["installationId"],
        "staff": {role: row["id"] for role, row in client.state["staff"].items()},
        "archive": client.state["risk-course-original"], "onwardArchive": client.state["risk-course-received"],
        "reorderedArchive": client.state["reorderedArchive"],
        "checks": deepcopy(client.state["checks"]), "completedSteps": len(client.state["steps"])}
    client.state["result"] = result
    client.save()
    publish_result(client)
    return result


def publish_result(client):
    """Repair complete output publication from the same accepted native journal."""
    result = client.state["result"]
    case_id = result["originalCaseId"]
    if "browserHandover" not in client.state:
        command_descriptors = {}
        for name in ("first-edition", "second-edition"):
            step = client.state["steps"][name]
            shown = client.read("/api/operations/" + case_id + "/risk-register/" + step["result"]["recordId"])
            command_file = name + "-command.json"
            command_descriptors[name] = {"path": command_file, "command": step["body"],
                "sha256": sha(encoded(step["body"])), "receipt": step["result"],
                "previewSha256": shown["previewSha256"], "source": shown["source"]}
        client.state["browserHandover"] = {**result, "origin": client.origin,
            "originalCaseVersion": client.version(case_id), "privateStaffCodes": ".private/risk-staff-codes.json",
            "originalCommands": command_descriptors,
            "asOfDate": client.state["steps"]["second-edition"]["body"]["data"]["document"]["asOfDate"],
            "hostContract": {"owner": "original managed-launch execution",
                "runnerStartsHost": False, "runnerStopsHost": False,
                "readBinding": {"origin": client.origin, "installationId": client.state["installationId"],
                                "principalId": "owner"},
                "close": "Use the original managed-launch handle and verified process identity retained by the execution owner."}}
        client.save()
    handover = client.state["browserHandover"]
    require(handover["operationId"] == result["operationId"]
            and handover["originalCaseId"] == result["originalCaseId"],
            "The retained browser handover belongs to another native course.")
    atomic(client.output / "risk-course-result.json", encoded(result))
    for name, descriptor in handover["originalCommands"].items():
        raw = encoded(descriptor["command"])
        require(sha(raw) == descriptor["sha256"], "A retained original command changed before publication.")
        atomic(client.output / descriptor["path"], raw)
    atomic(client.output / "risk-course-browser.json", encoded(handover))


def verify(client):
    require("result" in client.state, "Complete the original operator course before verification.")
    publish_result(client)
    result = client.state["result"]
    raw = (client.output / result["archive"]["path"]).read_bytes()
    require(sha(raw) == result["archive"]["sha256"], "The retained original handover changed.")
    original_case = json.loads(verified_archive(raw)["operations.json"])
    source_raw = client.read("/api/operations/" + result["originalCaseId"] + "/sources/" + result["sourceId"])
    require(sha(source_raw) == result["sourceSha256"], "The original attachment changed on reopen.")
    for case_id in (result["receivedCaseId"], result["reorderedReceivedCaseId"]):
        same_received(client, case_id, original_case, result["firstReviewId"], result["secondReviewId"],
                      result["sourceId"], source_raw)
    original_reviews = {row["id"]: row for row in original_case["reviews"]}
    for rid in (result["firstReviewId"], result["secondReviewId"]):
        shown = client.read("/api/operations/" + result["originalCaseId"] + "/risk-register/" + rid)
        require(shown["review"] == original_reviews[rid], "An original edition changed on reopen.")
    history = client.read("/api/operations/" + result["originalCaseId"] + "/risk-register-history/" + RISK_ID)
    retained = [row["edition"]["id"] for row in history["entries"]]
    require(result["firstReviewId"] in retained and result["secondReviewId"] in retained,
            "The original history no longer contains both editions.")
    outcome = {"schema": SCHEMA + ".reopen", "status": "PASS", "operationId": client.prefix,
               "processId": os.getpid(), "observedAt": datetime.now(timezone.utc).isoformat(),
               "installationId": client.state["installationId"], "originalCaseId": result["originalCaseId"],
               "currentReviewId": history["entries"][0]["edition"]["id"],
               "receivedCaseIds": [result["receivedCaseId"], result["reorderedReceivedCaseId"]],
               "archive": result["archive"], "sourceSelection": result["sourceSelection"]}
    atomic(client.output / "risk-course-reopen.json", encoded(outcome))
    return outcome


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True)
    parser.add_argument("--access-key-file", required=True)
    parser.add_argument("--plan", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--source-manifest", required=True, help="Complete actual installed source selection")
    parser.add_argument("--verify", action="store_true", help="Read the completed course in a fresh process")
    args = parser.parse_args()
    client = Course(args.url, args.access_key_file, args.output, args.plan, args.source_manifest)
    result = verify(client) if args.verify else run(client)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
