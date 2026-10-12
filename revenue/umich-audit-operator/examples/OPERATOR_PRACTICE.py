"""One restartable whole audit operator journey using explicit Practice records.

The issuer questionnaire and optional original attachments retain their real
source bytes. Practice observations are not an institutional audit or response.
No browser, external provider, mail, or production receiving system is contacted.
"""
from __future__ import annotations
import argparse
import base64
import copy
import csv
import hashlib
import io
import json
import os
from pathlib import Path
import secrets
import sys
import time
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from EXCHANGE_PRACTICE import practice_inputs, practice_native_contract
from audit_operator import exchange, reporting
from audit_operator.service import AuditService
from audit_operator.store import Forbidden, atomic_write, digest, encoded, fingerprint

CATALOG_SHA256 = "819a01647a939e867e344abc94e24db04df290687463cb43771944ec13099bac"

def json_bytes(value):
    return encoded(value).encode("utf-8")

def zip_bytes(files):
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for name, body in sorted(files.items()):
            info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100600 << 16
            z.writestr(info, body)
    return out.getvalue()

def csv_bytes(headers, rows):
    out = io.StringIO(newline="")
    writer = csv.writer(out, lineterminator="\r\n")
    writer.writerow(headers)
    writer.writerows(rows)
    return out.getvalue().encode("utf-8-sig")

def semantic_snapshot(snapshot):
    return {"workspace_id": snapshot["workspace_id"],
            "records": sorted(snapshot["records"], key=lambda r: (r["kind"], r["id"])),
            "revisions": sorted(snapshot.get("revisions", []), key=lambda r: (r["kind"], r["id"], r["revision"])),
            "sources": sorted(snapshot["sources"], key=lambda s: s["id"])}

class Journey:
    def __init__(self, directory):
        self.root = Path(directory).expanduser().absolute()
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        if self.root.is_symlink() or self.root.resolve() != self.root:
            raise ValueError("Use a real private operation directory.")
        os.chmod(self.root, 0o700)
        self.path = self.root / "operator-journey.json"
        if self.path.exists():
            self.state = json.loads(self.path.read_text())
            if self.state.get("format") != "commons-audit-operator-practice/1":
                raise ValueError("This directory belongs to another operation.")
        else:
            self.state = {"format": "commons-audit-operator-practice/1", "run_id": secrets.token_hex(16),
                          "calls": {}, "phases": {}, "artifacts": {}, "status": "RUNNING"}
            self.save()
        key = self.root / "private-recovery.key"
        if not key.exists():
            atomic_write(key, secrets.token_urlsafe(36).encode())
        self.passphrase = key.read_text()
        self.services = {}

    def save(self):
        atomic_write(self.path, json_bytes(self.state))

    def service(self, label):
        if label not in self.services:
            svc = AuditService(self.root / label)
            token = (svc.store.root / "operator.key").read_text().strip()
            actor = svc.store.authenticate_token(token)
            if not actor or actor["role"] != "auditor" or not actor.get("admin"):
                raise ValueError("The original private operator key did not authenticate.")
            self.services[label] = (svc, actor)
        return self.services[label]

    def close_all(self):
        for svc, _ in self.services.values():
            svc.close()
        self.services.clear()

    def call(self, label, svc, actor, action, payload):
        calls = self.state["calls"]
        if label in calls and calls[label].get("status") == "complete":
            retained = calls[label]
            if action == "create_grant":
                # The app re-derives this same private token; no token enters the journal.
                return svc.dispatch(actor, action, retained["request"], retained["operation_id"])
            return copy.deepcopy(retained["result"])
        if label in calls:
            retained = calls[label]
            request = copy.deepcopy(retained["request"])
            if retained.get("private_recovery_key"):
                request["passphrase"] = self.passphrase
        else:
            request = payload() if callable(payload) else copy.deepcopy(payload)
            operation_id = "practice-" + fingerprint([self.state["run_id"], label])[:40]
            saved_request = copy.deepcopy(request)
            private_key = "passphrase" in saved_request
            if private_key:
                saved_request.pop("passphrase")
                saved_request["passphrase_digest"] = digest(self.passphrase.encode())
            retained = {"status": "pending", "action": action, "operation_id": operation_id,
                        "request": saved_request, "request_sha256": fingerprint(request),
                        "private_recovery_key": private_key}
            calls[label] = retained
            self.save()
        if retained["action"] != action:
            raise ValueError("A retained step cannot change its original action.")
        if retained.get("private_recovery_key"):
            if request.pop("passphrase_digest", digest(self.passphrase.encode())) != digest(self.passphrase.encode()):
                raise ValueError("The original recovery key changed.")
            request["passphrase"] = self.passphrase
        if fingerprint(request) != retained["request_sha256"]:
            raise ValueError("The exact retained step request changed.")
        result = svc.dispatch(actor, action, request, retained["operation_id"])
        saved_result = copy.deepcopy(result)
        saved_result.pop("token", None)
        retained.update(status="complete", result=saved_result)
        self.save()
        return result

    def phase(self, name, work):
        if self.state["phases"].get(name, {}).get("status") == "complete":
            return copy.deepcopy(self.state["phases"][name]["result"])
        self.state["active_phase"] = name
        self.save()
        result = work()
        self.state["phases"][name] = {"status": "complete", "result": result}
        self.save()
        print(json.dumps({"phase": name, "status": "COMPLETE"}), flush=True)
        return result

    def upload(self, label, svc, actor, body, name, media_type, role="original", namespace="practice-um-audit", locator=None):
        return self.call(label, svc, actor, "upload_source",
            lambda: {"data_base64": base64.b64encode(body).decode(), "sha256": digest(body),
                     "name": name, "media_type": media_type, "role": role, "namespace": namespace,
                     "locator": locator})["source"]

    def artifact(self, label, svc, actor, record):
        body, meta = svc.artifact_bytes(actor, record["id"])
        assert digest(body) == meta["sha256"] and len(body) == meta["bytes"]
        folder = self.root / "artifacts" / label
        folder.mkdir(mode=0o700, parents=True, exist_ok=True)
        path = folder / meta["name"]
        if path.exists():
            if path.read_bytes() != body:
                raise ValueError("A retained output differs from the original artifact.")
        else:
            atomic_write(path, body)
        self.state["artifacts"][label] = {"artifact_id": record["id"], **meta,
                                          "path": str(path.relative_to(self.root))}
        self.save()
        return body, meta

def run(directory, original_files=()):
    j = Journey(directory)
    if j.state.get("status") == "COMPLETE":
        print(json.dumps(j.state["result"], sort_keys=True))
        return j.state["result"]
    fixture = practice_inputs()
    namespace = fixture["namespace"]
    sid = lambda kind, original_id: exchange.stable_record_id(kind, namespace, original_id)
    svc, actor = j.service("source-workspace")
    try:
        def intake():
            assert svc.catalog_sha == CATALOG_SHA256 and len(svc.catalog["questions"]) == 109
            assert len({q["id"] for q in svc.catalog["questions"]}) == 109
            originals = []
            for index, original in enumerate(original_files):
                path = Path(original).expanduser().absolute()
                body = path.read_bytes()
                media = "application/pdf" if path.suffix.lower() == ".pdf" else "application/json" if path.suffix.lower() == ".json" else "text/plain"
                source = j.upload("original-source-" + str(index), svc, actor, body, path.name, media, "reference",
                                  "retained-issuer-source", {"filename": path.name, "sha256": digest(body)})
                stored, metadata = svc.source_bytes(actor, source["id"])
                assert stored == body and metadata["sha256"] == digest(body)
                originals.append({"id": source["id"], "name": path.name, "bytes": len(body), "sha256": digest(body)})
            raw_source = j.upload("practice-original-csv", svc, actor, fixture["raw"], "practice-original.csv", "text/csv")
            evidence = j.upload("practice-evidence", svc, actor, fixture["evidence"], "practice-workpaper.txt", "text/plain", "evidence")
            rows = copy.deepcopy(fixture["rows"])
            rows.pop("source_mapping")
            rows.pop("questionnaire_response")
            for row in rows["engagement"]:
                row["normalized_stage"] = "Planning"
            for row in rows["management_action"]:
                row["responsible_party_reference"] = "Practice unit implementation team"
            rows["risk"][0].update(unit_id="unit-a", likelihood="3", impact="4", control_effectiveness="0.5")
            rows["evidence"][0]["source_id"] = evidence["id"]
            structured = json_bytes({"rows_by_kind": rows, "classification": "explicit Practice records"})
            original = j.upload("structured-practice-source", svc, actor, structured, "practice-records.json", "application/json")
            inspected = svc.inspect_source(actor, original["id"])
            assert inspected["format"] == "json" and sum(inspected["counts"].values()) == 19
            preview = j.call("initial-import-preview", svc, actor, "prepare_import",
                {"source_id": original["id"], "source_namespace": namespace, "mappings": []})
            assert preview["valid"], preview["diagnostics"]
            adopted = j.call("initial-import-adopt", svc, actor, "adopt_import", {"preview_id": preview["preview"]["id"]})
            assert len(adopted["imported"]) == 19
            unchanged = svc.record(actor, "sub_activity", sid("sub_activity", "sub-ok"))
            assert unchanged["payload"]["normalized_result"] == "no_observation"
            risk = svc.record(actor, "risk", sid("risk", "risk-unassigned"))
            assert not risk["payload"].get("engagement_id")
            return {"records": len(adopted["imported"]), "evidence_source_id": evidence["id"],
                    "raw_source_id": raw_source["id"], "structured_source_id": original["id"],
                    "native_originals": originals, "catalog_sha256": svc.catalog_sha, "issuer_questions": 109}
        entered = j.phase("original-source-and-record-intake", intake)

        def mapped_correction():
            headers = ["ID", "Engagement", "Control", "Title", "Priority", "Priority", "", "Unit", "Detail", "Include"]
            fields = [
                {"source_field_or_ordinal": 0, "target_field": "record_source_id", "transform": "string"},
                {"source_field_or_ordinal": 1, "target_field": "engagement_id", "relationship_key": {"kind": "engagement"}},
                {"source_field_or_ordinal": 2, "target_field": "sub_activity_id", "relationship_key": {"kind": "sub_activity"}},
                {"source_field_or_ordinal": 3, "target_field": "title"},
                {"source_field_or_ordinal": 4, "target_field": "priority_raw"},
                {"source_field_or_ordinal": 5, "target_field": "priority_normalized", "transform": "value_map",
                 "value_map": {"High": "high", "Medium": "medium", "Low": "low"}},
                {"source_field_or_ordinal": 6, "target_field": "report_summary"},
                {"source_field_or_ordinal": 7, "target_field": "owner_unit"},
                {"source_field_or_ordinal": 8, "target_field": "details"},
                {"source_field_or_ordinal": 9, "target_field": "report_inclusion", "transform": "boolean"}]
            mapping = j.call("save-original-ordinal-mapping", svc, actor, "save_record",
                {"kind": "source_mapping", "source_namespace": namespace, "source_id": "reviewed-ordinal-correction",
                 "payload": {"label": "Practice complete observation CSV", "source_namespace": namespace,
                             "record_kind": "observation", "mappings": fields,
                             "native_contract_reference": "Authored Practice ordinal contract; no selected vendor claim"}})["record"]
            row = ["obs-h", "eng-a", "sub-a", "Practice reviewed high", "High", "HIG",
                   "Reviewed high-priority summary.", "unit-a", "A_PRIVATE_DETAIL", "true"]
            bad = j.upload("original-invalid-mapped-csv", svc, actor, csv_bytes(headers, [row]),
                           "practice-observation-original.csv", "text/csv")
            preview = j.call("invalid-mapping-preview", svc, actor, "prepare_import",
                {"source_id": bad["id"], "kind": "observation", "source_namespace": namespace, "mapping_id": mapping["id"]})
            assert not preview["valid"] and any(d["code"] == "mapping_value_invalid" for d in preview["diagnostics"])
            row[5] = "High"
            corrected = j.upload("corrected-mapped-csv", svc, actor, csv_bytes(headers, [row]),
                                 "practice-observation-corrected.csv", "text/csv")
            inspected = svc.inspect_source(actor, corrected["id"])
            assert [h["name"] for h in inspected["headers"]] == headers
            fixed = j.call("corrected-mapping-preview", svc, actor, "prepare_import",
                {"source_id": corrected["id"], "kind": "observation", "source_namespace": namespace, "mapping_id": mapping["id"]})
            assert fixed["valid"], fixed["diagnostics"]
            changed = next(c for c in fixed["choices"] if c["status"] == "changed")
            accepted = j.call("corrected-mapping-adopt", svc, actor, "adopt_import",
                {"preview_id": fixed["preview"]["id"], "decisions": {changed["id"]: {
                    "choice": "accept_incoming", "expected_revision": changed["expected_revision"],
                    "expected_sha256": changed["expected_sha256"]}}})
            assert accepted["imported"] == [sid("observation", "obs-h")]
            return {"mapping_id": mapping["id"], "original_source_id": bad["id"], "corrected_source_id": corrected["id"],
                    "invalid_source_retained": True, "duplicate_and_blank_headers": True, "corrected_records": 1}
        corrected = j.phase("saved-mapping-and-complete-correction", mapped_correction)

        def reviews_and_questionnaire():
            def edit_observation():
                old = svc.record(actor, "observation", sid("observation", "obs-h"))
                payload = copy.deepcopy(old["payload"])
                payload["details"] += " Operator's private correction retained."
                return {"kind": "observation", "id": old["id"], "expected_revision": old["revision"], "payload": payload}
            observation = j.call("private-observation-edit", svc, actor, "save_record", edit_observation)["record"]
            assert observation["revision"] == 3
            old_wp = svc.record(actor, "workpaper", sid("workpaper", "wp-a"))
            first_review = j.call("workpaper-first-review", svc, actor, "review",
                lambda: {"kind": old_wp["kind"], "id": old_wp["id"], "expected_revision": old_wp["revision"],
                         "input_hash": fingerprint(old_wp), "decision": "approved", "reason": "Practice prepared evidence reviewed."})
            def revise_workpaper():
                old = svc.record(actor, "workpaper", sid("workpaper", "wp-a"))
                return {"kind": old["kind"], "id": old["id"], "expected_revision": old["revision"],
                        "payload": {**old["payload"], "conclusion": "Practice corrected conclusion from retained evidence.", "status": "Reviewed"}}
            revised_wp = j.call("workpaper-corrected-revision", svc, actor, "save_record", revise_workpaper)["record"]
            assert first_review["review"]["payload"]["input_hash"] != fingerprint(revised_wp)
            reviewed = j.call("workpaper-current-review", svc, actor, "review",
                {"kind": revised_wp["kind"], "id": revised_wp["id"], "expected_revision": revised_wp["revision"],
                 "input_hash": fingerprint(revised_wp), "decision": "approved", "reason": "Reviewed the exact corrected workpaper revision."})
            initial_queue = j.state["phases"].get("review-follow-up-and-issuer-questionnaire", {}).get("initial_queue")
            if initial_queue is None:
                initial_queue = svc.follow_up(actor, "2027-03-01")
            high = next(q for q in initial_queue if q["id"] == sid("management_action", "act-h"))
            assert high["reference_target_date"] == "2027-02-28" and high["explicit_target_date"] == "2027-04-15"
            # Only the explicit verification action changes the auditor's completion status.
            verified = j.call("auditor-verification", svc, actor, "verify_action",
                lambda: {"id": sid("management_action", "act-h"),
                         "expected_revision": svc.record(actor, "management_action", sid("management_action", "act-h"))["revision"],
                         "evidence_ids": [sid("evidence", "ev-a")], "assessment": "Practice auditor examined the exact retained implementation evidence.",
                         "review_date": "2026-10-11", "completed": True})
            assert verified["action"]["payload"]["verification_reference"] == verified["review"]["id"]
            question_id = svc.catalog["questions"][0]["id"]
            question = j.call("original-issuer-question-response", svc, actor, "save_record",
                {"kind": "questionnaire_response", "payload": {"question_id": question_id,
                 "catalog_sha256": svc.catalog_sha, "response": "Practice receiving/recovery demonstration only; not a submitted supplier response.",
                 "status": "Draft", "owner_reference": "Practice audit response owner", "evidence_ids": [sid("evidence", "ev-a")]}})["record"]
            exported = j.call("complete-original-questionnaire-export", svc, actor, "export_questionnaire", {})
            body, _ = j.artifact("issuer-questionnaire", svc, actor, exported["artifact"])
            with zipfile.ZipFile(io.BytesIO(body)) as archive:
                all_responses = json.loads(archive.read("responses.json"))
                original = archive.read("original-event-catalog.json")
            assert digest(original) == CATALOG_SHA256 and all_responses["question_count"] == 109
            response = next(r for r in all_responses["responses"] if r["question_id"] == question_id)
            assert response.get("evidence_ids", response.get("evidence_references")) == [sid("evidence", "ev-a")]
            assert response.get("owner_reference", response.get("responder_reference")) == "Practice audit response owner"
            return {"observation_revision": observation["revision"], "workpaper_revision": revised_wp["revision"],
                    "reviewed_hash": reviewed["review"]["payload"]["input_hash"], "verification_id": verified["review"]["id"],
                    "reference_target_date": high["reference_target_date"], "explicit_target_date": high["explicit_target_date"],
                    "question_id": question_id, "questionnaire_records": 109, "questionnaire_artifact_id": exported["artifact"]["id"]}
        reviewed = j.phase("review-follow-up-and-issuer-questionnaire", reviews_and_questionnaire)

        def scoped_reports():
            definitions = [
                {"role": "auditor", "unit_ids": []},
                {"role": "unit_leadership", "unit_ids": ["unit-a"]},
                {"role": "executive", "unit_ids": []},
                {"role": "it_leadership", "unit_ids": ["unit-a"]},
                {"role": "medicine_it_leadership", "unit_ids": ["unit-a"]},
                {"role": "board_regents", "unit_ids": []},
                {"role": "faic", "unit_ids": []},
                {"role": "advisory", "unit_ids": ["unit-b"], "recipient_unit_ids": ["unit-b"],
                 "selected_record_ids": [sid("advisory_memo", "memo-b")]}]
            outcomes = {}
            for scope in definitions:
                role = scope["role"]
                current_actor = actor
                if role != "auditor":
                    grant = j.call("grant-" + role, svc, actor, "create_grant",
                        {**scope, "label": "Practice " + role, "expires_days": 1})
                    current_actor = svc.store.authenticate_token(grant["token"])
                    assert current_actor and not current_actor["admin"]
                    try:
                        svc.sources(current_actor)
                        raise AssertionError("Scoped viewer exposed original source bytes.")
                    except Forbidden:
                        pass
                    try:
                        svc.dispatch(current_actor, "save_record", {}, "deny-" + fingerprint([j.state["run_id"], role])[:32])
                        raise AssertionError("Scoped viewer mutated records.")
                    except Forbidden:
                        pass
                views = svc.records(current_actor, limit=500)["items"]
                allowed = [x["record"]["id"] for x in views if x["record"]["kind"] == "engagement"]
                preview = j.call("report-" + role, svc, current_actor, "prepare_report",
                    {"selected_engagement_ids": allowed, "review_note": "Practice reviewed audience and engagement selection.",
                     **({"audience": scope} if role == "auditor" else {})})
                built = j.call("handoff-" + role, svc, current_actor, "build_handoff", {"preview_id": preview["preview_id"]})
                body, meta = j.artifact("handoff-" + role, svc, current_actor, built["artifact"])
                received = exchange.read_handoff(body)
                text = b"\n".join(received["files"].values())
                if role != "auditor":
                    assert not received["blobs"] and not received["snapshot"]["sources"]
                    assert b"B_PRIVATE_DETAIL" not in text and b"A_WORKPAPER_PRIVATE" not in text
                    if role != "unit_leadership":
                        assert b"A_PRIVATE_DETAIL" not in text and b"A_PRIVATE_PLAN" not in text
                if role == "advisory":
                    assert {r["kind"] for r in received["snapshot"]["records"]} == {"engagement", "advisory_memo"}
                if role == "medicine_it_leadership":
                    assert {r["id"] for r in received["snapshot"]["records"] if r["kind"] == "engagement"} == {sid("engagement", "eng-c")}
                outcomes[role] = {"records": len(received["snapshot"]["records"]), "artifact_id": built["artifact"]["id"],
                                  "sha256": meta["sha256"], "bytes": meta["bytes"]}
            return outcomes
        audiences = j.phase("authenticated-audience-projections", scoped_reports)

        def native_returns():
            contract = practice_native_contract()
            contract_source = j.upload("native-contract-original", svc, actor, json_bytes(contract),
                                       "practice-native-contract.json", "application/json", "target_contract")
            preview = j.call("native-report-selection", svc, actor, "prepare_report",
                {"selected_engagement_ids": [sid("engagement", x) for x in ("eng-a", "eng-b", "eng-c")],
                 "audience": {"role": "auditor", "unit_ids": []}, "review_note": "Practice declared native target tables."})
            native = j.call("native-export", svc, actor, "prepare_native",
                {"preview_id": preview["preview_id"], "target_contract_source_id": contract_source["id"]})
            body, _ = j.artifact("native-original", svc, actor, native["artifact"])
            with zipfile.ZipFile(io.BytesIO(body)) as archive:
                files = {table["file"]: archive.read(table["file"]) for table in contract["tables"]}
            original = zip_bytes(files)
            source = j.upload("native-original-return", svc, actor, original, "native-return-original.zip", "application/zip")
            comparison = j.call("native-original-comparison", svc, actor, "compare_native",
                {"native_id": native["native_id"], "return_source_id": source["id"], "source_namespace": namespace})
            assert comparison["comparison"]["status"] == "match" and comparison["comparison"]["matched"] == 7
            changed = dict(files)
            changed["observations.csv"] = changed["observations.csv"].replace(b"Reviewed high-priority summary.", b"Practice returned summary changed.")
            assert changed["observations.csv"] != files["observations.csv"]
            changed_source = j.upload("native-changed-return", svc, actor, zip_bytes(changed),
                                     "native-return-changed.zip", "application/zip")
            mismatch = j.call("native-changed-comparison", svc, actor, "compare_native",
                {"native_id": native["native_id"], "return_source_id": changed_source["id"], "source_namespace": namespace})
            assert mismatch["comparison"]["status"] == "different" and len(mismatch["comparison"]["changed"]) == 1
            corrected_source = j.upload("native-corrected-return", svc, actor, original,
                                       "native-return-corrected.zip", "application/zip")
            correction = j.call("native-corrected-comparison", svc, actor, "compare_native",
                {"native_id": native["native_id"], "return_source_id": corrected_source["id"], "source_namespace": namespace})
            assert correction["comparison"]["status"] == "match" and correction["comparison"]["matched"] == 7
            return {"native_id": native["native_id"], "matched": 7, "changed": 1, "corrected": 7,
                    "comparison_ids": [x["comparison_id"] for x in (comparison, mismatch, correction)]}
        native = j.phase("complete-native-return-and-correction", native_returns)

        receiver, recipient = j.service("receiver-workspace")
        def receive_and_resolve():
            full, _ = svc.artifact_bytes(actor, audiences["auditor"]["artifact_id"])
            source = j.upload("receiving-original-bundle", receiver, recipient, full,
                              "original-audit-handoff.zip", "application/zip")
            preview = j.call("receiving-original-preview", receiver, recipient, "prepare_receipt", {"source_id": source["id"]})
            assert preview["plan"]["status"] == "ready", preview["plan"]["conflicted"]
            accepted = j.call("receiving-original-adopt", receiver, recipient, "adopt_receipt", {"preview_id": preview["preview_id"]})
            assert accepted["status"] == "accepted" and accepted["imported"]
            replay = j.call("receiving-replay-preview", receiver, recipient, "prepare_receipt", {"source_id": source["id"]})
            assert replay["plan"]["status"] == "replayed"
            replayed = j.call("receiving-replay-adopt", receiver, recipient, "adopt_receipt", {"preview_id": replay["preview_id"]})
            assert replayed["replayed_bundle"]
            def edit(service, suffix):
                previous = service.record(actor if service is svc else recipient, "observation", sid("observation", "obs-h"))
                return {"kind": "observation", "id": previous["id"], "expected_revision": previous["revision"],
                        "payload": {**previous["payload"], "details": previous["payload"]["details"] + suffix}}
            local = j.call("receiver-local-edit", receiver, recipient, "save_record",
                           lambda: edit(receiver, " Separate receiving-team revision."))["record"]
            incoming = j.call("sender-new-revision", svc, actor, "save_record",
                              lambda: edit(svc, " Separate originating-team revision."))["record"]
            assert local["revision"] == incoming["revision"]
            current = j.call("receiving-updated-report", svc, actor, "prepare_report",
                {"selected_engagement_ids": [sid("engagement", x) for x in ("eng-a", "eng-b", "eng-c")],
                 "audience": {"role": "auditor", "unit_ids": []}, "review_note": "Practice original revised source handoff."})
            built = j.call("receiving-updated-handoff", svc, actor, "build_handoff", {"preview_id": current["preview_id"]})
            revised, _ = j.artifact("revised-source-handoff", svc, actor, built["artifact"])
            received_source = j.upload("receiving-updated-original", receiver, recipient, revised,
                                       "updated-audit-handoff.zip", "application/zip")
            conflict = j.call("receiving-conflict-preview", receiver, recipient, "prepare_receipt",
                              {"source_id": received_source["id"]})
            assert conflict["plan"]["status"] == "conflicted"
            named = [c for c in conflict["plan"]["conflicted"] if c.get("id") == incoming["id"] and c.get("current_sha256")]
            assert named, conflict["plan"]["conflicted"]
            item = named[0]
            decisions = [{"id": item["id"], "choice": "accept_incoming_as_next",
                          "current_sha256": item["current_sha256"], "incoming_sha256": item["incoming_sha256"],
                          "reason": "Practice receiving auditor reviewed both retained revisions."}]
            resolved = j.call("receiving-reviewed-resolution", receiver, recipient, "adopt_receipt",
                             {"preview_id": conflict["preview_id"], "resolutions": decisions})
            adopted = receiver.record(recipient, "observation", incoming["id"])
            assert adopted["revision"] == local["revision"] + 1
            assert adopted["payload"]["details"] == incoming["payload"]["details"]
            history = receiver.history(recipient, "observation", incoming["id"])["records"]
            assert any(fingerprint(r) == fingerprint(local) for r in history)
            assert adopted["receiving_lineage"]["original_record_sha256"] == fingerprint(incoming)
            assert receiver.store.bytes(entered["catalog_sha256"]) == svc.catalog_bytes
            original_evidence = receiver.store.source_for_evidence(entered["evidence_source_id"], digest(fixture["evidence"]))
            assert receiver.store.bytes(original_evidence["sha256"]) == fixture["evidence"]
            return {"accepted_records": len(accepted["imported"]), "same_bundle_replayed": True,
                    "resolved_revision": adopted["revision"], "local_revision_preserved": True,
                    "incoming_original_preserved": True, "receipt_id": resolved["saved_receipt_id"],
                    "receiver_workspace_id": receiver.store.setting("workspace_id")}
        received = j.phase("second-workspace-receiving-replay-and-resolution", receive_and_resolve)

        def recovery():
            before = semantic_snapshot(svc.store.snapshot(include_history=True))
            before_hash = fingerprint(before)
            atomic_write(j.root / "before-recovery-snapshot.json", json_bytes(before))
            backup = j.call("whole-encrypted-backup", svc, actor, "backup",
                           {"passphrase": j.passphrase, "label": "Practice complete original audit workspace"})
            backup_body, backup_meta = j.artifact("encrypted-backup", svc, actor, backup["artifact"])
            workspace_id = before["workspace_id"]
            # Close original application connections before opening a new receiving console.
            j.close_all()
            console, console_actor = j.service("recovery-console")
            restored = j.call("new-folder-restore", console, console_actor, "restore",
                {"data_base64": base64.b64encode(backup_body).decode(), "passphrase": j.passphrase,
                 "destination_name": "restored-source"})
            assert restored["workspace_id"] == workspace_id and restored["access_renewed"]
            recovered, new_actor = j.service("restored-source")
            actual = semantic_snapshot(recovered.store.snapshot(include_history=True))
            assert fingerprint(actual) == before_hash
            for source in before["sources"]:
                assert recovered.store.bytes(source["sha256"]) == (j.root / "source-workspace" / "objects" / source["sha256"]).read_bytes()
            workpapers = recovered.records(new_actor, "workpaper")["items"]
            assert workpapers and any(item["current_review"] for item in workpapers)
            assert recovered.catalog_sha == CATALOG_SHA256 and len(recovered.catalog_view(new_actor)["questions"]) == 109
            original_token = (j.root / "source-workspace" / "operator.key").read_text().strip()
            assert recovered.store.authenticate_token(original_token) is None
            for comparison_id in native["comparison_ids"]:
                retained = recovered.store.get("native_comparison", comparison_id)
                assert retained["payload"]["source_id"]
            return {"workspace_id": workspace_id, "domain_records": len(actual["records"]),
                    "revisions": len(actual["revisions"]), "source_files": len(actual["sources"]),
                    "exact_snapshot_sha256": before_hash, "backup_sha256": backup_meta["sha256"],
                    "backup_bytes": backup_meta["bytes"], "restored_directory": "restored-source",
                    "renewed_access": True, "original_ids_and_bytes_equal": True}
        restored = j.phase("encrypted-new-folder-restoration", recovery)
        result = {"format": "commons-audit-operator-practice-result/1", "status": "COMPLETE",
                  "classification": "Practice workflow with original issuer-source contracts; no institutional audit submission",
                  "run_id": j.state["run_id"], "intake": entered, "mapping": corrected, "reviews": reviewed,
                  "audiences": audiences, "native": native, "receiving": received, "recovery": restored,
                  "provider_calls": 0, "browser_launched": False}
        j.state.update(status="COMPLETE", result=result, active_phase=None)
        j.save()
        atomic_write(j.root / "result.json", json_bytes(result))
        print(json.dumps(result, sort_keys=True), flush=True)
        return result
    except BaseException as exc:
        j.state["status"] = "CONTINUATION_REQUIRED"
        j.state["last_error"] = {"type": type(exc).__name__, "message": str(exc)}
        j.save()
        raise
    finally:
        j.close_all()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", help="New private operation directory, or this same retained operation to continue")
    parser.add_argument("--original-file", action="append", default=[], help="Existing exact original issuer/public-process source; retained without network retrieval")
    args = parser.parse_args()
    run(args.directory, args.original_file)
