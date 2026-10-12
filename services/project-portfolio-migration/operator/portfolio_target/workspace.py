"""Saved portfolio target operations, native recovery, acceptance and handover.

The source engine is PortfolioWorkspace. This component owns only the target
operation and its original call records; it does not parse or rewrite schedules.
"""
from __future__ import annotations

import base64
import copy
import datetime as dt
from email.utils import parsedate_to_datetime
import hashlib
import html
import json
from pathlib import Path
import re
import threading
from urllib.parse import urlencode
import uuid

from portfolio import PortfolioWorkspace

from .adjustments import prepare_adjustment, verify_native_before
from .capture import NativeReaderTransport, native_capture_identity
from .planner import (
    check_edition, metadata_from_probe, prepare_schedule, review_schedule,
    target_identity, verify_plan,
)
from .storage import Store, checked_id, write_bytes
from .target import (
    NativeTarget, TargetError, canonical, digest, guid,
    operation_response, public_profile, read_profiles, utcnow,
)

TERMINAL_REQUESTS = {"COMPLETE", "FAILED"}
NATIVE_PENDING = {"INVOKING", "UNKNOWN"}
ACTIONS = {
    "intake", "source_review", "source_apply", "mspdi_export", "probe",
    "prepare", "prepare_adjustment", "review", "continue", "adopt_detail", "capture_target",
    "receive_target_file", "accept", "handover", "archive", "abandon_set",
    "archive_save", "archive_review", "archive_publish", "archive_query_export", "archive_inspect", "archive_receive",
}


def error_value(exc):
    return {"code": getattr(exc, "code", type(exc).__name__), "message": str(exc),
            "dispatched": bool(getattr(exc, "dispatched", False)),
            **({"details": exc.details} if getattr(exc, "details", None) is not None else {})}


class TargetWorkspace:
    def __init__(self, root, *, profile_config=None, native=None):
        self.portfolio = PortfolioWorkspace(root, native=native)
        self.root = self.portfolio.root
        self.store = Store(self.root)
        self.profiles = read_profiles(profile_config, self.root)
        self.closing = threading.Event()
        from archive import ArchiveWorkspace
        self.archives = ArchiveWorkspace(self.portfolio, self.store, stopped=self.closing.is_set)

    def profile(self, identity):
        try:
            return self.profiles[identity]
        except KeyError as exc:
            raise TargetError("TARGET_PROFILE_NOT_FOUND", "Select a configured local target profile.") from exc

    def state(self, *, cursor="", limit=25):
        deployments = self.store.list("deployments", cursor=cursor, limit=limit)
        summaries = []
        for item in deployments["items"]:
            summaries.append({k: item.get(k) for k in (
                "id", "revision", "created_at", "updated_at", "state", "profile_id",
                "source_edition_id", "project_id", "project_name", "plan_sha256",
                "review_sha256", "capture_edition_id", "acceptance_sha256", "error",
            )})
        return {"schema": "portfolio.target-workspace.v1",
                "profiles": [public_profile(p) for p in self.profiles.values()],
                "deployments": {**deployments, "items": summaries},
                "requests": self.store.list("requests", limit=25),
                "editions": self.portfolio.list_editions(limit=25),
                "cohorts": self.archives.list(limit=25)}

    def deployment(self, identity):
        value = self.store.index("deployments", checked_id(identity))
        value["plan"] = self.store.read(value["plan_sha256"])
        value["review"] = self.store.read(value["review_sha256"]) if value.get("review_sha256") else None
        value["acceptance"] = self.store.read(value["acceptance_sha256"]) if value.get("acceptance_sha256") else None
        return value

    def request(self, request_id, kind, arguments, *, retry_failed=False):
        if kind not in ACTIONS or not isinstance(arguments, dict):
            raise TargetError("OPERATOR_ACTION", "Select an original target workspace action.")
        with self.store.locked():
            request = self.store.request(request_id, kind, arguments)
            if retry_failed and request["state"] == "FAILED":
                request.setdefault("prior_attempts", []).append({key: request.get(key) for key in (
                    "state", "started_at", "finished_at", "error", "result_sha256")})
                request["state"] = "QUEUED"
                request["resumed_at"] = utcnow()
                request.pop("started_at", None)
                request.pop("finished_at", None)
                request.pop("error", None)
                request = self.store.save("requests", request, expected_revision=request["revision"])
            return request

    def run(self, request_id):
        """One original local action; interrupted reads resume through the same request."""
        with self.store.locked():
            request = self.store.index("requests", checked_id(request_id))
            if request["state"] in TERMINAL_REQUESTS:
                return request
            request["state"] = "RUNNING"
            request["started_at"] = request.get("started_at") or utcnow()
            request = self.store.save("requests", request, expected_revision=request["revision"])
            try:
                result = self._run(request["kind"], request["arguments"], request_id)
                request["result_sha256"] = self.store.put(result)["sha256"]
                request["state"] = "COMPLETE"
                request.pop("error", None)
            except Exception as exc:
                request["state"] = "FAILED"
                request["error"] = error_value(exc)
                if getattr(exc, "evidence", None) is not None:
                    request["error"]["evidence_sha256"] = self.store.put(exc.evidence)["sha256"]
            request["finished_at"] = utcnow()
            return self.store.save("requests", request, expected_revision=request["revision"])

    def request_result(self, identity):
        request = self.store.index("requests", checked_id(identity))
        return {**request, "result": self.store.read(request["result_sha256"])
                if request.get("result_sha256") else None}

    def _run(self, kind, args, request_id):
        if kind.startswith("archive_"):
            return self.archives._run_locked(request_id, kind, args)
        if kind == "intake":
            source = self.store.selected_upload(args["source"])
            companions = []
            selected_companions = args.get("companions", [])
            if not isinstance(selected_companions, list):
                raise TargetError("COMPANION_UPLOADS", "Choose the original uploaded companion list.")
            profile_fields = {"format", "role", "encoding", "delimiter", "json_pointer"}
            for selected in selected_companions:
                if not isinstance(selected, dict):
                    raise TargetError("COMPANION_UPLOAD", "Keep each selected companion and its reader profile.")
                if "source" in selected:
                    if set(selected) - {"source", "label", "profile"}:
                        raise TargetError("COMPANION_OPTIONS", "Use source, label and the original companion profile.")
                    uploaded = selected["source"]
                    profile = selected.get("profile", {})
                    if not isinstance(profile, dict) or set(profile) - profile_fields:
                        raise TargetError("COMPANION_PROFILE", "Choose format, role, encoding, delimiter and json_pointer.")
                    label = selected.get("label")
                else:
                    # Original saved browser requests contain the upload object itself.
                    uploaded, profile, label = selected, {}, None
                path = self.store.selected_upload(uploaded)
                companions.append({"path": str(path), "label": label if label is not None else path.name,
                                   **profile})
            return self.portfolio.intake(request_id, source, label=args.get("label") or source.name,
                                         profile=args.get("profile"), companions=companions or None)
        if kind == "source_review":
            return self.portfolio.review(args["edition_id"], target_profile=args["target_profile"],
                                         mappings=args.get("mappings"), decisions=args.get("decisions"),
                                         corrections=args.get("corrections"))
        if kind == "source_apply":
            return self.portfolio.apply_review(request_id, args["review_id"])
        if kind == "mspdi_export":
            profile = args.get("profile") or {
                "write_timephased": True, "microsoft_compatible": True, "save_version": "Project2016"}
            return self._retain_export(self.portfolio.export_mspdi(request_id, args["edition_id"], profile=profile))
        if kind == "probe":
            return self.probe(args["profile_id"])
        if kind == "prepare":
            return self.prepare(request_id, args)
        if kind == "prepare_adjustment":
            return self.prepare_adjustment(request_id, args)
        if kind == "review":
            return self.review(args, request_id)
        if kind == "continue":
            return self.continue_deployment(args["deployment_id"], args["review_sha256"],
                                            retry_rejected=bool(args.get("retry_rejected", False)))
        if kind == "abandon_set":
            return self.abandon_set(args, request_id)
        if kind == "adopt_detail":
            return self.adopt_detail(args, request_id)
        if kind == "capture_target":
            return self.capture_target(request_id, args["deployment_id"], expected_revision=args.get("expected_revision"))
        if kind == "receive_target_file":
            return self.receive_target_file(request_id, args)
        if kind == "accept":
            return self.accept(args, request_id)
        if kind == "handover":
            return self.handover(args["deployment_id"])
        if kind == "archive":
            # The original PortfolioWorkspace exporter takes its native source lock.
            # This method already holds the B mutation lock; no target write can race it.
            output = self.root.parent / (self.root.name + "-operator-deliveries") / (request_id + ".portfolio.zip")
            output.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            result = self.portfolio.export_workspace(output)
            hasher, count = hashlib.sha256(), 0
            with open(output, "rb") as original:
                for chunk in iter(lambda: original.read(1024 * 1024), b""):
                    hasher.update(chunk)
                    count += len(chunk)
            return {"schema": "portfolio.operator-archive.v1", "filename": output.name,
                    "archive": {"sha256": hasher.hexdigest(), "bytes": count, "path": str(output),
                                "request_id": request_id, "kind": "workspace_archive"},
                    "native_result": result}
        raise TargetError("OPERATOR_ACTION", "Unknown target action.")

    def _retain_export(self, result):
        path = Path(result["path"]).resolve(strict=True)
        if path != self.root and self.root not in path.parents:
            raise TargetError("SOURCE_EXPORT_PATH", "The original native export is outside this workspace.")
        ref = self.store.retain_file(path, result["sha256"], result["bytes"])
        return {**result, "download": {**ref, "filename": "project-" + result["edition_id"][:12] + ".xml"}}

    def _save(self, value):
        return self.store.save("deployments", value, expected_revision=value["revision"])

    def _observed_target(self, profile, deployment=None):
        def observe(value):
            ref = self.store.put(value)
            if deployment is not None:
                deployment.setdefault("observations", []).append({
                    "sha256": ref["sha256"], "at": value.get("finished_at", utcnow()),
                    "method": value.get("method"), "url": value.get("url"),
                    "status": value.get("status"), "complete": value.get("complete", False),
                })
                saved = self._save(deployment)
                deployment.clear()
                deployment.update(saved)
        return NativeTarget(profile, observe=observe)

    def probe(self, profile_id):
        profile = self.profile(profile_id)
        if profile["kind"] == "mspdi":
            return {"schema": "portfolio.file-target.v1", "profile": public_profile(profile),
                    "native": self.portfolio.native.ensure()}
        client = self._observed_target(profile)
        result = client.probe()
        ref = self.store.put(result)
        return {"probe": result, "object_sha256": ref["sha256"]}

    def prepare(self, request_id, args):
        if self.store._index("deployments", request_id).exists():
            return self.store.index("deployments", request_id)
        edition = self.portfolio.read_edition(args["edition_id"])
        check_edition(edition)
        profile = self.profile(args["profile_id"])
        if profile["kind"] == "mspdi":
            export_profile = args.get("export_profile") or {
                "write_timephased": True, "microsoft_compatible": True, "save_version": "Project2016"}
            review = self.portfolio.review(edition["id"],
                target_profile={"kind": "mspdi", **export_profile},
                mappings=args.get("mappings"), decisions=args.get("decisions"),
                corrections=args.get("corrections"))
            plan = {"schema": "portfolio.file-target-plan.v1", "deployment_id": request_id,
                    "source_edition_id": edition["id"], "source_edition_sha256": edition["sha256"],
                    "profile": public_profile(profile), "export_profile": export_profile,
                    "source_review": review, "mappings": args.get("mappings", {})}
            plan["sha256"] = digest(plan)
        else:
            probe = self.store.read(args["probe_sha256"])
            plan = prepare_schedule(edition, profile, probe, request_id, args.get("mappings"))
        ref = self.store.put(plan)
        value = {"schema": "portfolio.target-deployment.v1", "id": request_id, "revision": 0,
                 "created_at": utcnow(), "state": "PREPARED", "profile_id": profile["id"],
                 "source_edition_id": edition["id"], "plan_sha256": ref["sha256"],
                 "plan_digest": plan["sha256"], "project_id": plan.get("project_id"),
                 "project_name": plan.get("project_name"), "calls": {}, "batches": [],
                 "observations": []}
        return self.store.save("deployments", value, expected_revision=0)

    def prepare_adjustment(self, request_id, args):
        if self.store._index("deployments", request_id).exists():
            return self.store.index("deployments", request_id)
        parent = self.store.index("deployments", args["deployment_id"])
        if args.get("expected_revision") != parent["revision"]:
            raise TargetError("STALE_REVISION", "Reopen the original target before preparing its correction.")
        profile = self.profile(parent["profile_id"])
        if profile["kind"] != "project_operations":
            raise TargetError("ADJUSTMENT_TARGET", "Prepare a new reviewed file edition for an MSPDI correction.")
        original_plan = self.store.read(parent["plan_sha256"])
        original_edition = self.portfolio.read_edition(parent["source_edition_id"])
        edition = self.portfolio.read_edition(args["edition_id"])
        target = self._observed_target(profile)
        probe = target.probe()
        if target_identity(profile, probe) != original_plan["target_identity"]:
            raise TargetError("TARGET_CHANGED", "The original native target or metadata changed.")
        target.probe_result = probe
        plan = prepare_adjustment(edition, original_edition, profile, probe, request_id,
                                  parent, original_plan, target.record, mappings=args.get("mappings"))
        ref = self.store.put(plan)
        value = {"schema": "portfolio.target-deployment.v1", "id": request_id, "revision": 0,
                 "created_at": utcnow(), "state": "PREPARED", "profile_id": profile["id"],
                 "source_edition_id": edition["id"], "plan_sha256": ref["sha256"],
                 "plan_digest": plan["sha256"], "project_id": plan["project_id"],
                 "project_name": plan["project_name"], "parent_deployment_id": parent["id"],
                 "calls": {}, "batches": [], "observations": [],
                 "last_probe_sha256": self.store.put(probe)["sha256"]}
        return self.store.save("deployments", value, expected_revision=0)

    def review(self, args, request_id):
        value = self.store.index("deployments", args["deployment_id"])
        if value.get("review_request_id") == request_id:
            return value
        if args.get("expected_revision") != value["revision"]:
            raise TargetError("STALE_REVISION", "Reopen the current prepared migration before reviewing it.")
        if value["state"] not in ("PREPARED", "REVIEWED"):
            raise TargetError("TARGET_ALREADY_STARTED", "Keep the original reviewed operation; make a new source edition for changes.")
        plan = self.store.read(value["plan_sha256"])
        if plan["schema"] == "portfolio.file-target-plan.v1":
            if not plan["source_review"].get("ready"):
                raise TargetError("SOURCE_REVIEW_REQUIRED", "Resolve the original source review findings before target acceptance.")
            if not str(args.get("reviewer", "")).strip() or not str(args.get("note", "")).strip():
                raise TargetError("TARGET_REVIEWER", "Record the receiving operator and the file handover decision.")
            review = {"schema": "portfolio.file-target-review.v1", "plan_sha256": plan["sha256"],
                      "deployment_id": value["id"], "source_edition_id": value["source_edition_id"],
                      "reviewer": args["reviewer"], "note": args["note"]}
            review["sha256"] = digest(review)
        else:
            review = review_schedule(plan, reviewer=args.get("reviewer"), note=args.get("note"),
                                     accepted_findings=args.get("accepted_findings", []))
        value["review_request_id"] = request_id
        value["review_sha256"] = self.store.put(review)["sha256"]
        value["review_digest"] = review["sha256"]
        value["state"] = "REVIEWED"
        return self._save(value)

    def _reviewed(self, identity, review_sha256):
        value = self.store.index("deployments", identity)
        if not value.get("review_sha256") or value["review_sha256"] != review_sha256:
            raise TargetError("TARGET_REVIEW_CHANGED", "Select the exact saved review before continuing.")
        review = self.store.read(review_sha256)
        plan = self.store.read(value["plan_sha256"])
        if review["plan_sha256"] != plan["sha256"] or review["deployment_id"] != identity:
            raise TargetError("TARGET_REVIEW_BINDING", "The original review names another migration.")
        edition = self.portfolio.read_edition(value["source_edition_id"])
        if edition["sha256"] != plan["source_edition_sha256"]:
            raise TargetError("SOURCE_EDITION_CHANGED", "The reviewed source edition changed.")
        return value, plan, review

    def _call(self, value, target, key, action, parameters, *, retry_rejected=False, verify=None):
        """Persist before native dispatch; an uncertain write is never automatically repeated."""
        request = {"action": action, "parameters": parameters,
                   "target_identity": target_identity(target.profile, target.probe_result)}
        request_sha = self.store.put(request)["sha256"]
        previous = value["calls"].get(key)
        if previous:
            if previous["request_sha256"] != request_sha:
                raise TargetError("NATIVE_CALL_CHANGED", "The original native call has different input.")
            if previous["state"] in ("RETURNED", "RECOVERED"):
                return self.store.read(previous["result_sha256"])
            if previous["state"] in NATIVE_PENDING:
                raise TargetError("NATIVE_RECONCILE_REQUIRED", "Read the original accepted operation before another write.")
            if previous.get("provider_not_before"):
                floor = dt.datetime.fromisoformat(previous["provider_not_before"])
                if dt.datetime.now(dt.timezone.utc) < floor:
                    raise TargetError("TARGET_PROVIDER_DEFERRED", "The original provider Retry-After permits the next attempt at " +
                                      previous["provider_not_before"] + ".")
            if previous["state"] == "REJECTED" and not retry_rejected:
                raise TargetError("NATIVE_REJECTED", "The native service rejected this call; review it before explicit retry.")
        record = {"id": key, "request_sha256": request_sha, "state": "PREPARED",
                  "created_at": previous.get("created_at", utcnow()) if previous else utcnow(),
                  "attempts": list(previous.get("attempts", [])) if previous else []}
        value["calls"][key] = record
        value.update(self._save(value))
        started_observations = len(value.get("observations", []))
        dispatch_admitted = False

        def dispatched():
            nonlocal dispatch_admitted
            if self.closing.is_set() or self.store.paused(value["id"]):
                raise TargetError("OPERATION_PAUSED", "The operator paused this migration before the next native call.")
            record = value["calls"][key]
            record["state"] = "INVOKING"
            record["invoked_at"] = utcnow()
            record["attempts"].append({"at": record["invoked_at"], "request_sha256": request_sha})
            value.update(self._save(value))
            dispatch_admitted = True
        try:
            result = target.action(action, parameters, before_dispatch=dispatched)
            verified = verify(result) if verify is not None else None
            if isinstance(verified, dict) and verified.get("operationSetDetailId"):
                detail_id = guid(verified["operationSetDetailId"])
                if any(other_key != key and other.get("native_detail_id") == detail_id
                       for other_key, other in value["calls"].items()):
                    raise TargetError("NATIVE_DETAIL_REUSED", "A native detail already belongs to another row call.",
                                      dispatched=True)
                value["calls"][key]["native_detail_id"] = detail_id
            value["calls"][key].update({
                "state": "RETURNED", "result_sha256": self.store.put(result)["sha256"],
                "returned_at": utcnow(),
                "observation_sha256s": [x["sha256"] for x in value["observations"][started_observations:]],
            })
            value.update(self._save(value))
            return result
        except Exception as exc:
            record = value["calls"][key]
            evidence = getattr(exc, "evidence", None)
            if not dispatch_admitted:
                record["state"] = "NOT_SENT"
            elif evidence and evidence.get("complete") and evidence.get("status") in (
                    400, 401, 403, 404, 405, 406, 411, 413, 415, 422, 429):
                record["state"] = "REJECTED"
            else:
                record["state"] = "UNKNOWN"
            record["error"] = error_value(exc)
            retry_after = (evidence or {}).get("headers", {}).get("retry-after")
            if retry_after is not None:
                try:
                    floor = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(seconds=max(0, int(retry_after)))
                             if str(retry_after).strip().isdigit() else parsedate_to_datetime(str(retry_after)))
                    if floor.tzinfo is None:
                        floor = floor.replace(tzinfo=dt.timezone.utc)
                    record["provider_not_before"] = floor.astimezone(dt.timezone.utc).isoformat()
                except (ValueError, OverflowError, TypeError):
                    record["unparsed_retry_after"] = str(retry_after)
            record["observation_sha256s"] = [x["sha256"] for x in value["observations"][started_observations:]]
            value.update(self._save(value))
            raise

    def _recover_call(self, value, key, result, evidence, *, reviewer=None):
        record = value["calls"][key]
        if record["state"] not in NATIVE_PENDING:
            return
        detail_id = result.get("detail_id") if isinstance(result, dict) else None
        if detail_id is not None:
            detail_id = guid(detail_id)
            if any(other_key != key and other.get("native_detail_id") == detail_id
                   for other_key, other in value["calls"].items()):
                raise TargetError("NATIVE_DETAIL_REUSED", "This native detail already acknowledges another row call.")
            record["native_detail_id"] = detail_id
        record.update({"state": "RECOVERED", "result_sha256": self.store.put(result)["sha256"],
                       "recovered_at": utcnow(), "recovery_sha256": self.store.put(evidence)["sha256"]})
        if reviewer is not None:
            record["reviewer"] = reviewer
        value.update(self._save(value))

    def _payload_matches(self, target, entity, expected, actual):
        if not isinstance(actual, dict):
            return False
        m = target.metadata
        for name, original in expected.items():
            if name == "@odata.type":
                continue
            if name.endswith("@odata.bind"):
                wanted_id = original.rsplit("(", 1)[-1].rstrip(")")
                column = m.lookup(entity, name[:-11])
                try:
                    if guid(actual.get(column)) != guid(wanted_id):
                        return False
                except TargetError:
                    return False
            elif isinstance(original, str) and re.fullmatch(r"[0-9a-f-]{36}", original):
                try:
                    if guid(actual.get(name)) != guid(original):
                        return False
                except TargetError:
                    return False
            elif actual.get(name) != original:
                return False
        return True

    def _existing_record(self, value, target, key, operation):
        record = value["calls"].get(key)
        if not record or record["state"] not in NATIVE_PENDING:
            return
        actual = target.record(operation["entity"], operation["record_id"])
        payload = next(iter(operation["parameters"].values()))
        if not self._payload_matches(target, operation["entity"], payload, actual):
            raise TargetError("NATIVE_RECORD_UNRESOLVED",
                              "The original native record is absent or differs; retain this invocation for review.")
        response_name = "ProjectId" if operation["action"] == "msdyn_CreateProjectV1" else "TeamMemberId"
        self._recover_call(value, key, {response_name: operation["record_id"]},
                           {"schema": "portfolio.native-record-recovery.v1", "record": actual,
                            "request_sha256": record["request_sha256"]})

    def _set_identity(self, value, target, key, batch, plan):
        record = value["calls"].get(key)
        if not record or record["state"] not in NATIVE_PENDING:
            return
        result = target.operation_sets(plan["project_id"], description=batch["description"])
        m = target.metadata
        candidates = result["value"]
        aad = target.probe_result["user"].get("azureactivedirectoryobjectid")
        owner_field = m.field("msdyn_operationset", "msdyn_useraadid")
        if aad:
            candidates = [row for row in candidates if str(row.get(owner_field, "")).lower() == str(aad).lower()]
        if len(candidates) != 1:
            raise TargetError("OPERATION_SET_UNRESOLVED",
                              "The original OperationSet is not uniquely present in the current native result.")
        selected = candidates[0]
        native_id = guid(selected[m.entity("msdyn_operationset")["key"]])
        self._recover_call(value, key, {"OperationSetId": native_id},
                           {"schema": "portfolio.operation-set-recovery.v1", "native": selected,
                            "pages": result["pages"], "request_sha256": record["request_sha256"]})

    def _retain_native_details(self, target, result):
        metadata = target.metadata
        entity = metadata.entity("msdyn_operationsetdetail")
        rows = []
        for row in result["value"]:
            rows.append({"detail_id": guid(row[entity["key"]]),
                         "record_id": row.get(metadata.field("msdyn_operationsetdetail", "msdyn_recordid")),
                         "entity": row.get(metadata.field("msdyn_operationsetdetail", "msdyn_entityname")),
                         "sha256": digest(row), "native": row})
        return self.store.put({"schema": "portfolio.native-detail-review-source.v1",
                               "native_collection": result, "review_rows": rows})["sha256"]

    def _native_status(self, value, target, set_id):
        native = target.record("msdyn_operationset", set_id)
        if native is None:
            raise TargetError("OPERATION_SET_MISSING", "The original native OperationSet cannot be read.")
        status_field = target.metadata.field("msdyn_operationset", "msdyn_status")
        numeric = native.get(status_field)
        semantics = target.probe_result["status_semantics"]
        classification = next((name for name, number in semantics.items() if number == numeric), "pending")
        return {"id": set_id, "classification": classification, "status": numeric,
                "label": native.get(status_field + "@OData.Community.Display.V1.FormattedValue"),
                "native": native, "sha256": self.store.put(native)["sha256"]}

    def continue_deployment(self, identity, review_sha256, *, retry_rejected=False):
        value, plan, review = self._reviewed(identity, review_sha256)
        if value["state"] in ("ACCEPTED", "CAPTURED", "EXPORTED", "NATIVE_COMPLETE"):
            return value
        profile = self.profile(value["profile_id"])
        self.store.control(value["id"], digest({"continue": identity, "review": review_sha256}), pause=False)
        if profile["kind"] == "mspdi":
            applied = self.portfolio.apply_review(digest({"deployment": identity, "action": "apply-source-review"}),
                                                   plan["source_review"]["id"])
            value["intended_edition_id"] = applied["edition_id"]
            value["source_review_application_sha256"] = self.store.put(applied)["sha256"]
            result = self._retain_export(self.portfolio.export_mspdi(
                digest({"deployment": identity, "action": "export"}),
                applied["edition_id"], profile=plan["export_profile"]))
            value["export_result_sha256"] = self.store.put(result)["sha256"]
            value["state"] = "EXPORTED"
            return self._save(value)
        verify_plan(plan)
        target = self._observed_target(profile, value)
        try:
            probe = target.probe()
            if target_identity(profile, probe) != plan["target_identity"]:
                raise TargetError("TARGET_CHANGED", "Native identity or metadata changed since this target review.")
            target.probe_result = probe
            value["last_probe_sha256"] = self.store.put(probe)["sha256"]
            value["state"] = "APPLYING"
            value.update(self._save(value))
            if plan["existing_project"]:
                if target.record("msdyn_project", plan["project_id"]) is None:
                    raise TargetError("TARGET_PROJECT_MISSING", "The selected existing project is absent.")
            for selection in plan["team_selections"]:
                if selection["existing"]:
                    row = target.record("msdyn_projectteam", selection["team_member_id"])
                    project_column = target.metadata.lookup("msdyn_projectteam", "msdyn_project")
                    if not row or guid(row.get(project_column)) != plan["project_id"]:
                        raise TargetError("TARGET_TEAM_PROJECT", "The selected team member belongs to another project.")
            for immediate in plan["immediate"]:
                key = "immediate:" + immediate["id"]
                self._existing_record(value, target, key, immediate)
                expected_name = "ProjectId" if immediate["action"] == "msdyn_CreateProjectV1" else "TeamMemberId"
                def validate(result, field=expected_name, expected=immediate["record_id"]):
                    if guid(result.get(field)) != expected:
                        raise TargetError("NATIVE_CREATED_ID", "The service returned another prepared native record ID.", dispatched=True)
                self._call(value, target, key, immediate["action"], immediate["parameters"],
                           retry_rejected=retry_rejected, verify=validate)
            for batch in plan["batches"]:
                number = batch["number"]
                key = "set:" + str(number) + ":create"
                self._set_identity(value, target, key, batch, plan)
                set_result = self._call(value, target, key, "msdyn_CreateOperationSetV1",
                    {"ProjectId": plan["project_id"], "Description": batch["description"]},
                    retry_rejected=retry_rejected, verify=lambda result: guid(result.get("OperationSetId")))
                set_id = guid(set_result["OperationSetId"])
                retained_batch = next((x for x in value["batches"] if x["number"] == number), None)
                if retained_batch is None:
                    retained_batch = {"number": number, "operation_set_id": set_id,
                                      "operations_sha256": batch["sha256"], "state": "OPEN"}
                    value["batches"].append(retained_batch)
                    value.update(self._save(value))
                elif retained_batch["operation_set_id"] != set_id:
                    raise TargetError("OPERATION_SET_CHANGED", "The original native OperationSet ID changed.")
                current = self._native_status(value, target, set_id)
                if current["classification"] == "completed":
                    unresolved = ["set:" + str(number) + ":row:" + operation["id"]
                                  for operation in batch["operations"] if value["calls"].get(
                                      "set:" + str(number) + ":row:" + operation["id"], {}).get("state")
                                  not in ("RETURNED", "RECOVERED")]
                    if unresolved:
                        value["pending_completed_set_calls"] = unresolved
                        value["pending_detail_observation_sha256"] = self._retain_native_details(target, target.operation_details(set_id))
                        value["state"] = "NATIVE_REVIEW_REQUIRED"
                        value["error"] = {"code": "COMPLETED_SET_PARTIAL_HISTORY",
                                          "message": "The native set completed while selected row receipts remain unresolved; review its actual details."}
                        return self._save(value)
                    execute_key = "set:" + str(number) + ":execute"
                    if value["calls"].get(execute_key, {}).get("state") in NATIVE_PENDING:
                        self._recover_call(value, execute_key,
                            {"schema": "portfolio.native-execution-recovered.v1",
                             "operation_set_id": set_id, "native_status_sha256": current["sha256"]},
                            {"native": current["native"], "classification": "completed"})
                    retained_batch.update({"state": "COMPLETE", "native_status": current})
                    value.update(self._save(value))
                    continue
                if current["classification"] in ("failed", "abandoned"):
                    retained_batch.update({"state": current["classification"].upper(), "native_status": current})
                    value["state"] = "NATIVE_" + current["classification"].upper()
                    try:
                        value["native_errors_sha256"] = self.store.put(target.project_errors(plan["project_id"]))["sha256"]
                    except TargetError as exc:
                        value["native_error_read"] = error_value(exc)
                    return self._save(value)
                for operation in batch["operations"]:
                    call_key = "set:" + str(number) + ":row:" + operation["id"]
                    old = value["calls"].get(call_key)
                    if old and old["state"] in NATIVE_PENDING:
                        details = target.operation_details(set_id)
                        value["pending_detail_observation_sha256"] = self._retain_native_details(target, details)
                        value["pending_call_key"] = call_key
                        value["state"] = "NATIVE_REVIEW_REQUIRED"
                        return self._save(value)
                    if not old or old["state"] not in ("RETURNED", "RECOVERED"):
                        condition = verify_native_before(operation, target)
                        if condition is not None:
                            value["last_before_check_sha256"] = self.store.put(condition)["sha256"]
                            value.update(self._save(value))
                    self._call(value, target, call_key, operation["action"],
                        {"Entity": operation["payload"], "OperationSetId": set_id},
                        retry_rejected=retry_rejected,
                        verify=lambda result, record=operation["record_id"]: operation_response(result, set_id, record))
                execute_key = "set:" + str(number) + ":execute"
                old_execute = value["calls"].get(execute_key)
                if old_execute and old_execute["state"] in NATIVE_PENDING:
                    current = self._native_status(value, target, set_id)
                    retained_batch.update({"state": "AWAITING_NATIVE_RESULT", "native_status": current})
                    value["state"] = "AWAITING_NATIVE_RESULT"
                    return self._save(value)
                for operation in batch["operations"]:
                    condition = verify_native_before(operation, target)
                    if condition is not None:
                        value["last_before_check_sha256"] = self.store.put(condition)["sha256"]
                        value.update(self._save(value))
                self._call(value, target, execute_key, "msdyn_ExecuteOperationSetV1",
                           {"OperationSetId": set_id}, retry_rejected=retry_rejected)
                current = self._native_status(value, target, set_id)
                retained_batch.update({"state": "COMPLETE" if current["classification"] == "completed"
                                      else "AWAITING_NATIVE_RESULT", "native_status": current})
                value.update(self._save(value))
                if current["classification"] != "completed":
                    value["state"] = "AWAITING_NATIVE_RESULT"
                    return self._save(value)
            value["state"] = "NATIVE_COMPLETE"
            value["native_completed_at"] = utcnow()
            value.pop("error", None)
            return self._save(value)
        except Exception as exc:
            value["error"] = error_value(exc)
            value["state"] = "PAUSED" if getattr(exc, "code", "") == "OPERATION_PAUSED" else ("NATIVE_RECONCILE_REQUIRED" if any(
                call["state"] in NATIVE_PENDING for call in value["calls"].values()) else "NATIVE_REVIEW_REQUIRED")
            return self._save(value)
        finally:
            # No bearer token is held in this retained projection.
            pass

    def abandon_set(self, args, request_id):
        value, plan, review = self._reviewed(args["deployment_id"], args["review_sha256"])
        if value.get("abandon_request_id") == request_id:
            return value
        if args.get("expected_revision") != value["revision"]:
            raise TargetError("STALE_REVISION", "Reopen the current original OperationSet before abandoning it.")
        if not str(args.get("reviewer", "")).strip() or not str(args.get("note", "")).strip():
            raise TargetError("ABANDON_REVIEW", "Record the operator and why the unexecuted native set is being abandoned.")
        self.store.control(value["id"], request_id, pause=False)
        selected_id = guid(args["operation_set_id"])
        selected = [batch for batch in value["batches"] if batch["operation_set_id"] == selected_id]
        if len(selected) != 1:
            raise TargetError("ABANDON_SET", "Select one retained native OperationSet from this migration.")
        batch = selected[0]
        target = self._observed_target(self.profile(value["profile_id"]), value)
        probe = target.probe()
        if target_identity(target.profile, probe) != plan["target_identity"]:
            raise TargetError("TARGET_CHANGED", "The actual native target changed.")
        target.probe_result = probe
        current = self._native_status(value, target, selected_id)
        key = "set:" + str(batch["number"]) + ":abandon"
        previous = value["calls"].get(key)
        if current["classification"] == "abandoned":
            if previous and previous["state"] in NATIVE_PENDING:
                self._recover_call(value, key,
                    {"schema": "portfolio.native-abandon-recovered.v1", "operation_set_id": selected_id},
                    {"native": current["native"], "classification": "abandoned"})
        else:
            execution = value["calls"].get("set:" + str(batch["number"]) + ":execute")
            if current["classification"] in ("completed", "failed") or (execution and execution["state"] in (
                    "INVOKING", "UNKNOWN", "RETURNED", "RECOVERED")):
                raise TargetError("ABANDON_EXECUTION", "Read the original submitted execution to its native terminal state.")
            self._call(value, target, key, "msdyn_AbandonOperationSetV1",
                       {"OperationSetId": selected_id}, retry_rejected=bool(args.get("retry_rejected", False)))
            current = self._native_status(value, target, selected_id)
        batch["native_status"] = current
        batch["state"] = "ABANDONED" if current["classification"] == "abandoned" else "ABANDON_REQUESTED"
        value["state"] = "NATIVE_ABANDONED" if current["classification"] == "abandoned" else "NATIVE_RECONCILE_REQUIRED"
        value["abandon_review_sha256"] = self.store.put({
            "schema": "portfolio.native-abandon-review.v1", "operation_set_id": selected_id,
            "reviewer": args["reviewer"], "note": args["note"], "request_id": request_id,
            "native_status": current, "at": utcnow()})["sha256"]
        if current["classification"] == "abandoned":
            value["abandon_request_id"] = request_id
        return self._save(value)

    def adopt_detail(self, args, request_id):
        value, plan, review = self._reviewed(args["deployment_id"], args["review_sha256"])
        if value.get("detail_review_request_id") == request_id:
            return value
        call_key = args["call_key"]
        call = value["calls"].get(call_key)
        if not call or call["state"] not in NATIVE_PENDING:
            raise TargetError("NATIVE_DETAIL_STATE", "Choose the original unresolved row invocation.")
        if not str(args.get("reviewer", "")).strip() or not str(args.get("note", "")).strip():
            raise TargetError("NATIVE_DETAIL_REVIEWER", "Record who reviewed the original request and native payload.")
        request = self.store.read(call["request_sha256"])
        set_id = guid(request["parameters"]["OperationSetId"])
        expected = request["parameters"]["Entity"]
        entity = expected["@odata.type"].removeprefix("Microsoft.Dynamics.CRM.")
        target = self._observed_target(self.profile(value["profile_id"]), value)
        probe = target.probe()
        if target_identity(target.profile, probe) != plan["target_identity"]:
            raise TargetError("TARGET_CHANGED", "The original target identity changed.")
        target.probe_result = probe
        value["last_probe_sha256"] = self.store.put(probe)["sha256"]
        result = target.operation_details(set_id)
        m = target.metadata
        matches = [row for row in result["value"] if
            str(row.get(m.entity("msdyn_operationsetdetail")["key"], "")).lower() == guid(args["detail_id"])]
        if len(matches) != 1:
            raise TargetError("NATIVE_DETAIL_ABSENT", "The selected original native detail is absent or ambiguous.")
        row = matches[0]
        if digest(row) != args["detail_sha256"]:
            raise TargetError("NATIVE_DETAIL_CHANGED", "Reopen the native payload; it changed after review.")
        record_id = guid(expected[m.entity(entity)["key"]])
        if guid(row.get(m.field("msdyn_operationsetdetail", "msdyn_recordid"))) != record_id or (
            row.get(m.field("msdyn_operationsetdetail", "msdyn_entityname")) != entity):
            raise TargetError("NATIVE_DETAIL_BINDING", "The native detail names another original record.")
        reply = {"schema": "portfolio.native-detail-recovered.v1", "operation_set_id": set_id,
                 "detail_id": guid(args["detail_id"]), "record_id": record_id,
                 "native_detail_sha256": digest(row)}
        self._recover_call(value, call_key, reply, {
            "schema": "portfolio.reviewed-native-detail.v1", "native": row,
            "request_sha256": call["request_sha256"], "reviewer": args["reviewer"], "note": args["note"],
            "reviewed_at": utcnow(), "pages": result["pages"],
        }, reviewer=args["reviewer"])
        value["detail_review_request_id"] = request_id
        value.pop("pending_call_key", None)
        value["state"] = "REVIEWED"
        return self._save(value)

    def capture_identity_map(self, plan, capture, transport, metadata):
        return native_capture_identity(plan, capture, transport, metadata)

    def _capture_start(self, request_id, identity, expected_revision):
        value = self.store.index("deployments", identity)
        previous = value.get("capture_results", {}).get(request_id)
        if previous:
            return value, self.store.read(previous)
        active = value.get("capture_in_progress", {})
        if active.get("request_id") != request_id:
            if expected_revision != value["revision"]:
                raise TargetError("CAPTURE_REVISION", "Reopen the current target before receiving another capture.")
            value["capture_in_progress"] = {"request_id": request_id, "started_at": utcnow(),
                                            "previous_capture_edition_id": value.get("capture_edition_id")}
            value = self._save(value)
        return value, None

    def _capture_finish(self, value, request_id, capture_id, comparison, *, identity_map=None, findings=None,
                        transport_sha256=None, identity_evidence=None):
        result = {"schema": "portfolio.target-capture-result.v1", "request_id": request_id,
                  "deployment_id": value["id"], "source_edition_id": value["source_edition_id"],
                  "intended_edition_id": value.get("intended_edition_id", value["source_edition_id"]),
                  "capture_edition_id": capture_id, "comparison_sha256": self.store.put(comparison)["sha256"],
                  "identity_map": identity_map or {}, "identity_findings": findings or [], "captured_at": utcnow()}
        result["read_transport_sha256"] = transport_sha256
        result["identity_evidence_sha256"] = self.store.put(identity_evidence)["sha256"] if identity_evidence else None
        value.setdefault("capture_results", {})[request_id] = self.store.put(result)["sha256"]
        value["capture_request_id"] = request_id
        value["capture_edition_id"] = capture_id
        value["comparison_sha256"] = result["comparison_sha256"]
        value["capture_identity_findings"] = result["identity_findings"]
        value["capture_identity_map"] = result["identity_map"]
        value["capture_read_transport_sha256"] = result["read_transport_sha256"]
        value["capture_identity_evidence_sha256"] = result["identity_evidence_sha256"]
        value["state"] = "CAPTURED"
        value.pop("capture_in_progress", None)
        value.pop("acceptance_sha256", None)
        return self._save(value)

    def capture_target(self, request_id, identity, *, expected_revision=None):
        value, previous = self._capture_start(request_id, identity, expected_revision)
        if previous is not None:
            return {**value, "original_capture": previous}
        plan = self.store.read(value["plan_sha256"])
        if value["state"] not in ("NATIVE_COMPLETE", "CAPTURED", "ACCEPTED"):
            raise TargetError("TARGET_NOT_COMPLETE", "Read the original OperationSets to completion before final target capture.")
        progress = value["capture_in_progress"]
        previous_transport = self.store.read(progress["reader_transport_sha256"]) if progress.get("reader_transport_sha256") else None
        if previous_transport and previous_transport.get("complete"):
            # Original completed pages and their probe are sufficient for a local
            # receipt continuation, including after a portable workspace restore.
            profile = {**plan["target_identity"]["profile"],
                       "max_response_bytes": previous_transport["binding"]["max_response_bytes"]}
            target = NativeTarget(profile)
            probe = self.store.read(progress["capture_probe_sha256"])
            target.metadata = metadata_from_probe(probe)
        else:
            profile = self.profile(value["profile_id"])
            if profile["kind"] != "project_operations":
                raise TargetError("TARGET_FILE_RECEIVING", "Upload the actual returned target project file for this handover.")
            target = self._observed_target(profile, value)
            current_probe = target.probe()
            if target_identity(profile, current_probe) != plan["target_identity"]:
                raise TargetError("TARGET_CHANGED", "The actual target identity or metadata changed.")
            progress = value["capture_in_progress"]
            if progress.get("capture_probe_sha256"):
                probe = self.store.read(progress["capture_probe_sha256"])
            else:
                probe = current_probe
                progress["capture_probe_sha256"] = self.store.put(probe)["sha256"]
                saved = self._save(value)
                value.clear()
                value.update(saved)
        if target_identity(profile, probe) != plan["target_identity"]:
            raise TargetError("TARGET_CAPTURE_PROBE", "The retained original capture probe names another target.")

        def keep_transport(state):
            value["capture_in_progress"]["reader_transport_sha256"] = self.store.put(state)["sha256"]
            saved = self._save(value)
            value.clear()
            value.update(saved)

        transport = NativeReaderTransport(target, self.store, request_id=request_id,
            project_id=plan["project_id"], target_identity=plan["target_identity"],
            previous=previous_transport, persist=keep_transport, closing=self.closing)
        progress = value["capture_in_progress"]
        if progress.get("capture_edition_id"):
            if not transport.state.get("complete"):
                raise TargetError("TARGET_CAPTURE_SOURCE", "The received edition lacks its complete original read transport.")
            capture = self.portfolio.read_edition(progress["capture_edition_id"])
            transport_ref = transport.finish()
        else:
            native = self.portfolio.native
            with native.locked():
                reader_class = native.jclass("org.mpxj.msplanner.MsPlannerReader")
                uuid_class = native.jclass("java.util.UUID")
                with transport:
                    reader = reader_class(transport.origin, transport.token)
                    try:
                        project = reader.readProject(uuid_class.fromString(plan["project_id"]))
                    except Exception:
                        transport.raise_if_failed()
                        raise
                transport_ref = transport.finish()
                capture = self.portfolio.capture_native(request_id, project, provenance={
                    "kind": "project_operations", "api_origin": profile["api_origin"],
                    "api_version": profile["api_version"], "project_id": plan["project_id"],
                    "user_id": profile["user_id"], "organization_id": profile["organization_id"],
                    "deployment_id": identity, "probe_sha256": probe["sha256"],
                    "probe_object_sha256": value["capture_in_progress"]["capture_probe_sha256"],
                    "native_reader": "org.mpxj.msplanner.MsPlannerReader",
                    "read_transport_sha256": transport_ref["sha256"],
                })
            value["capture_in_progress"]["capture_edition_id"] = capture["id"]
            saved = self._save(value)
            value.clear()
            value.update(saved)
        identity_map, identity_findings, identity_evidence = self.capture_identity_map(
            plan, capture, transport, target.metadata)
        comparison = self.portfolio.compare(value["source_edition_id"], capture["id"],
                                            identity_map=identity_map, strict_identity=True)
        return self._capture_finish(value, request_id, capture["id"], comparison,
            identity_map=identity_map, findings=identity_findings,
            transport_sha256=transport_ref["sha256"], identity_evidence=identity_evidence)

    def receive_target_file(self, request_id, args):
        value, previous = self._capture_start(request_id, args["deployment_id"], args.get("expected_revision"))
        if previous is not None:
            return {**value, "original_capture": previous}
        if self.profile(value["profile_id"])["kind"] != "mspdi" or value["state"] not in ("EXPORTED", "CAPTURED", "ACCEPTED"):
            raise TargetError("TARGET_FILE_STATE", "Choose the original exported file handover.")
        source = self.store.selected_upload(args["source"])
        captured = self.portfolio.intake(request_id, source,
            label=args.get("label") or "Received target " + source.name, profile=args.get("profile"),
            companions=None)
        comparison = self.portfolio.compare(value.get("intended_edition_id", value["source_edition_id"]), captured["id"],
                                             identity_map=args.get("identity_map"))
        return self._capture_finish(value, request_id, captured["id"], comparison,
                                    identity_map=args.get("identity_map"))

    def accept(self, args, request_id):
        value = self.store.index("deployments", args["deployment_id"])
        previous = value.get("acceptance_results", {}).get(request_id)
        if previous:
            return {**value, "original_acceptance": self.store.read(previous)}
        if args.get("expected_revision") != value["revision"] or value["state"] not in ("CAPTURED", "ACCEPTED"):
            raise TargetError("ACCEPTANCE_REVISION", "Reopen the actual target comparison before accepting it.")
        if args.get("comparison_sha256") != value.get("comparison_sha256"):
            raise TargetError("ACCEPTANCE_COMPARISON", "The selected comparison is not the current native target capture.")
        if not str(args.get("reviewer", "")).strip() or not str(args.get("note", "")).strip():
            raise TargetError("ACCEPTANCE_REVIEWER", "Record the accepting operator and the resolved or retained differences.")
        exceptions = args.get("exceptions", [])
        if not isinstance(exceptions, list) or any(not isinstance(item, str) or not item.strip() for item in exceptions):
            raise TargetError("ACCEPTANCE_EXCEPTIONS", "Retained differences must be readable text entries.")
        result = {"schema": "portfolio.target-acceptance.v1", "deployment_id": value["id"],
                  "source_edition_id": value["source_edition_id"], "intended_edition_id": value.get("intended_edition_id", value["source_edition_id"]), "capture_edition_id": value["capture_edition_id"],
                  "comparison_sha256": value["comparison_sha256"], "review_sha256": value["review_sha256"],
                  "reviewer": args["reviewer"], "note": args["note"], "exceptions": exceptions,
                  "accepted_at": utcnow()}
        value["acceptance_request_id"] = request_id
        value["acceptance_sha256"] = self.store.put(result)["sha256"]
        value.setdefault("acceptance_results", {})[request_id] = value["acceptance_sha256"]
        value["state"] = "ACCEPTED"
        return self._save(value)

    def handover(self, identity):
        value = self.deployment(identity)
        if value["state"] != "ACCEPTED":
            raise TargetError("HANDOVER_ACCEPTANCE", "Finish the retained target comparison and acceptance.")
        comparison = self.store.read(value["comparison_sha256"])
        original = self.portfolio.read_edition(value["source_edition_id"])
        intended_id = value.get("intended_edition_id", value["source_edition_id"])
        intended = original if intended_id == original["id"] else self.portfolio.read_edition(intended_id)
        captured = self.portfolio.read_edition(value["capture_edition_id"])
        acceptance, plan = value["acceptance"], value["plan"]
        families = ("tasks", "resources", "assignments", "dependencies", "calendars")

        def visible(item):
            if item is None:
                return "—"
            if isinstance(item, (dict, list)):
                return json.dumps(item, ensure_ascii=False, sort_keys=True, indent=2)
            return str(item)

        def text(item):
            return html.escape(visible(item))

        def table(headings, rows):
            result = ["<div class=table-scroll><table><thead><tr>"]
            result.extend("<th scope=col>" + text(heading) + "</th>" for heading in headings)
            result.append("</tr></thead><tbody>")
            empty = True
            for row in rows:
                empty = False
                result.append("<tr>" + "".join("<td>" + text(cell) + "</td>" for cell in row) + "</tr>")
            if empty:
                result.append("<tr><td colspan=" + str(len(headings)) + ">No entries in this retained result.</td></tr>")
            result.append("</tbody></table></div>")
            return "".join(result)

        project = intended.get("model", {}).get("project", {})
        title = value.get("project_name") or (project.get("fields", {}).get("NAME") or {}).get("value") or "Portfolio migration"
        receiving = ("Original Project Operations project capture" if plan.get("schema") == "portfolio.target-plan.v1"
                     else "Returned project file, captured by the original MPXJ reader")
        body = [
            "<!doctype html><html lang=en><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>",
            "<title>" + text(title) + " — migration handover</title>",
            "<style>body{font:15px system-ui;color:#171717;max-width:1200px;margin:40px auto;padding:0 24px;line-height:1.5}"
            "h1,h2{font-weight:600}h1{line-height:1.2}section{border-top:1px solid #aaa;margin-top:28px;padding-top:12px}"
            "table{border-collapse:collapse;width:100%;font-size:13px}th,td{border:1px solid #bbb;padding:9px;vertical-align:top;"
            "text-align:left;white-space:pre-wrap;overflow-wrap:anywhere}th{background:#eee}pre{white-space:pre-wrap;overflow-wrap:anywhere;"
            "font:12px ui-monospace;background:#f5f5f5;padding:16px}.table-scroll{overflow:auto}.subtle{color:#555}"
            "@media(max-width:600px){body{padding:0 14px;margin:22px auto}th,td{min-width:110px}}"
            "@media print{body{margin:0;padding:0;max-width:none}.table-scroll{overflow:visible}tr{break-inside:avoid}h2{break-after:avoid}}</style>",
            "</head><body><header><p class=subtle>PROJECT DELIVERY · RETAINED TARGET ACCEPTANCE</p><h1>" + text(title) + "</h1>",
            "<p>" + text(receiving) + "</p></header>",
            "<section><h2>Acceptance</h2>",
            table(("Item", "Retained value"), (
                ("Accepted by", acceptance["reviewer"]), ("Accepted at", acceptance["accepted_at"]),
                ("Decision", acceptance["note"]), ("Retained differences", acceptance.get("exceptions", [])),
                ("Migration", value["id"]), ("Profile", value["profile_id"]),
                ("Native project", value.get("project_id")), ("Previous migration", value.get("parent_deployment_id")),
                ("Current state", value["state"]), ("Acceptance SHA-256", value["acceptance_sha256"]),
            )), "</section><section><h2>Schedule delivered</h2>",
            table(("Original family", "Source rows", "Intended rows", "Received rows"), (
                (family, len(original["model"].get(family, [])), len(intended["model"].get(family, [])),
                 len(captured["model"].get(family, []))) for family in families
            )), "<p>The source edition retains the complete original fields and native exports. The intended edition includes the saved source corrections.</p>",
            "</section><section><h2>Source, target and comparison identities</h2>",
            table(("Item", "Original identity"), (
                ("Source edition", original["id"]), ("Intended edition", intended["id"]),
                ("Received edition", captured["id"]), ("Original source files", original.get("source_ids", [])),
                ("Received source files", captured.get("source_ids", [])),
                ("Plan SHA-256", value["plan_sha256"]), ("Review SHA-256", value["review_sha256"]),
                ("Comparison", comparison.get("id")), ("Comparison SHA-256", value["comparison_sha256"]),
                ("Strict cross-system identity", comparison.get("strict_identity", False)),
                ("Explicit source-to-target mapping", comparison.get("identity_map", {})),
            )), "</section><section><h2>Observed source and target differences</h2>",
            table(("Summary item", "Value"), sorted((comparison.get("summary") or {}).items())
                  if isinstance(comparison.get("summary"), dict) else (("Summary", comparison.get("summary")),)),
            table(("Family", "Source row", "Received row", "Field / path", "Change", "Before", "After"), (
                (change.get("family"), change.get("left_key"), change.get("right_key"), change.get("path"),
                 change.get("kind"), change.get("before"), change.get("after"))
                for change in comparison.get("changes", [])
            )), "</section><section><h2>Native field and collection definitions</h2>",
            ("<p>The retained comparison includes the complete field catalogue and native collection definitions. "
             "Paths identify their original source location.</p>"
             if isinstance(comparison.get("definition_changes"), list) and comparison.get("definition_sources")
             else "<p>This saved comparison has no native definition coverage.</p>"),
            table(("Compared edition", "Field catalogue SHA-256", "Native JSON identity", "Retained collections SHA-256"), (
                (label, source.get("field_catalogue_sha256"), source.get("native_json_identity"),
                 source.get("retained_collections_sha256"))
                for side, label in (("left", "Original / intended"), ("right", "Received"))
                for source in [(comparison.get("definition_sources") or {}).get(side, {})]
            )),
            table(("Scope", "Original path", "Change", "Before", "After"), (
                (change.get("scope"), change.get("path"), change.get("kind"),
                 change.get("before"), change.get("after"))
                for change in comparison.get("definition_changes", [])
            )), "</section><section><h2>Identity and receiving findings</h2>",
            table(("Source", "Finding"), (
                [("Capture identity", item) for item in value.get("capture_identity_findings", [])] +
                [("Comparison", item) for item in comparison.get("findings", [])] +
                [("Received native model", item) for item in captured.get("findings", [])]
            )), "</section><section><h2>Native transaction history</h2>",
            table(("Batch", "Original OperationSet", "Retained state", "Native status"), (
                (batch.get("number"), batch.get("operation_set_id"), batch.get("state"), batch.get("native_status"))
                for batch in value.get("batches", [])
            )),
            table(("Original call", "State", "Attempts", "Native detail", "Request SHA-256", "Result SHA-256"), (
                (key, call.get("state"), len(call.get("attempts", [])), call.get("native_detail_id"),
                 call.get("request_sha256"), call.get("result_sha256"))
                for key, call in sorted(value.get("calls", {}).items())
            )), "</section><section><h2>Receiving and continued operation</h2>",
            "<p>Keep this report with portfolio-migration-handover.json and the portable workspace. Reopen that same workspace to inspect the original source, "
            "review, native requests and replies, returned project, and acceptance. Select private target credentials separately on the receiving host.</p>",
            "<p>A following task correction starts from a new source edition and the saved original migration. An uncertain native call is reconciled through its "
            "original project, OperationSet or detail before any further write. Keep the original target comparison and the accepting operator's stated differences.</p>",
            "<details><summary>Exact retained acceptance</summary><pre>" + text(acceptance) + "</pre></details>",
            "</section></body></html>",
        ]
        report = self.store.put_bytes("\n".join(body).encode("utf-8"))
        exact = self.store.put({"schema": "portfolio.target-handover.v1", "deployment": value,
                               "comparison": comparison})
        return {"schema": "portfolio.target-handover-files.v1",
                "html": {**report, "filename": "portfolio-migration-handover.html"},
                "json": {**exact, "filename": "portfolio-migration-handover.json"},
                "deployment_id": identity, "source_edition_id": value["source_edition_id"],
                "capture_edition_id": value["capture_edition_id"],
                "acceptance_sha256": value["acceptance_sha256"]}
