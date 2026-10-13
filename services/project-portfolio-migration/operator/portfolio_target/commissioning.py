"""Existing imported-plan commissioning inside the maintained TargetWorkspace.

All actions use the original request/index/object stores and original portfolio
source editions. Adoption and rebind perform native GETs only. Corrections are
prepared here and executed solely by the maintained reviewed OperationSet path.
"""
from __future__ import annotations

import base64
import copy
import hashlib
import html
import json
from urllib.parse import urlencode

from .capture import NativeReaderTransport
from .commissioning_plan import (
    FAMILIES, MAPPED_FAMILIES, build_inventory, checked_mapping, compare_projection,
    exception_review, field_projection, finding, observed_correction_plan,
    verify_inventory,
)
from .planner import check_edition, metadata_from_probe, review_schedule, target_identity, verify_plan
from .storage import checked_id
from .target import NativeTarget, TargetError, digest, guid, public_profile, utcnow

ACTIONS = frozenset({"adopt_existing", "prepare_adoption_review", "review_adoption",
                     "prepare_observed_correction", "rebind_imported_target",
                     "commissioning_handover"})
ADOPTION_MODE = "external_import_adoption"


def is_commissioned(value):
    return value.get("commissioning_origin") == "external_import"


def _check_keys(args, allowed, required=()):
    if not isinstance(args, dict) or set(args) - set(allowed) or set(required) - set(args):
        raise TargetError("COMMISSIONING_ARGUMENTS", "Use the exact saved commissioning action fields.")


def _readable(value, label):
    if not isinstance(value, str) or not value.strip():
        raise TargetError("COMMISSIONING_REVIEW_TEXT", "Record " + label + ".")
    return value


def _exact_ids(values, expected, code):
    if (not isinstance(values, list) or any(not isinstance(item, str) for item in values) or
            len(values) != len(set(values)) or set(values) != set(expected)):
        raise TargetError(code, "Acknowledge exactly the findings in this selected retained result.")


def acceptance_context(workspace, value, args):
    """Add the exact new evidence to the original acceptance before its one save."""
    if not is_commissioned(value):
        return None
    plan = verify_plan(workspace.store.read(value["plan_sha256"]))
    review = workspace.store.read(value.get("adoption_review_sha256", ""))
    if review.get("origin") != "external_import" or review.get("project_id") != value["project_id"]:
        raise TargetError("COMMISSIONING_ACCEPTANCE_REVIEW", "Select the original existing-plan identity and exception review.")
    if plan.get("mode") == ADOPTION_MODE and review.get("capture_edition_id") != value.get("capture_edition_id"):
        raise TargetError("COMMISSIONING_REVIEW_RECAPTURE", "Review the current capture before accepting the adopted plan.")
    if args.get("commissioning_comparison_sha256") != value.get("commissioning_comparison_sha256"):
        raise TargetError("COMMISSIONING_ACCEPTANCE_BASIS", "Select the exact current intended-versus-observed comparison.")
    basis = workspace.store.read(value["commissioning_comparison_sha256"])
    _exact_ids(args.get("accepted_commissioning_fields", []),
               [item["id"] for item in basis["fields"] if item["status"] != "equal"],
               "COMMISSIONING_ACCEPTANCE_FIELDS")
    _exact_ids(args.get("accepted_identity_findings", []),
               [item["id"] for item in value.get("commissioning_identity_findings", [])],
               "COMMISSIONING_ACCEPTANCE_IDENTITIES")
    return {"schema": "portfolio.imported-plan-acceptance.v1",
            "origin": "external_import", "adoption_review_sha256": value["adoption_review_sha256"],
            "inventory_sha256": value["commissioning_inventory_sha256"],
            "intended_observed_sha256": value["commissioning_comparison_sha256"],
            "accepted_field_ids": list(args.get("accepted_commissioning_fields", [])),
            "accepted_identity_finding_ids": list(args.get("accepted_identity_findings", [])),
            "original_import_sha256": value["import_intake_sha256"],
            "rebind_sha256": value.get("rebind_sha256")}


class ImportCommissioning:
    def __init__(self, workspace):
        self.w = workspace
        self.store = workspace.store
        self.portfolio = workspace.portfolio

    def run(self, kind, args, request_id):
        if kind not in ACTIONS:
            raise TargetError("COMMISSIONING_ACTION", "Select a supported commissioning action.")
        checked_id(request_id)
        return getattr(self, kind)(request_id, args)

    def _stopped(self):
        if self.w.closing.is_set():
            raise TargetError("OPERATION_PAUSED", "The owner is closing; retain the same original request.")

    def _save(self, value):
        saved = self.w._save(value)
        value.clear()
        value.update(saved)
        return value

    def _existing(self, identity):
        try:
            return self.store.index("deployments", checked_id(identity))
        except TargetError as exc:
            if exc.code == "OPERATOR_NOT_FOUND":
                return None
            raise

    def _current(self, args, *, reviewed=False):
        value = self.store.index("deployments", checked_id(args["deployment_id"]))
        if not is_commissioned(value) or value["revision"] != args.get("expected_revision"):
            raise TargetError("COMMISSIONING_REVISION", "Reopen this exact existing-plan deployment revision.")
        if value.get("capture_in_progress"):
            raise TargetError("COMMISSIONING_CAPTURE_ACTIVE", "Continue the original capture before revising its selections.")
        if value["state"] not in ("CAPTURED", "ACCEPTED"):
            raise TargetError("COMMISSIONING_CAPTURE_REQUIRED", "Retain a complete native capture first.")
        if reviewed and not value.get("adoption_review_sha256"):
            raise TargetError("COMMISSIONING_REVIEW_REQUIRED", "Review the existing-plan identities and original import exceptions.")
        return value

    def _intake(self, args):
        _check_keys(args, {"edition_id", "profile_id", "project_id", "evidence",
                          "import_exceptions", "import_settings", "import_time", "project_url", "label"},
                    {"edition_id", "profile_id", "project_id", "evidence"})
        edition = self.portfolio.read_edition(checked_id(args["edition_id"]))
        check_edition(edition)
        profile = self.w.profile(args["profile_id"])
        if profile["kind"] != "project_operations":
            raise TargetError("COMMISSIONING_PROFILE", "Select the supported native Project Operations profile.")
        evidence = args["evidence"]
        if not isinstance(evidence, list) or not evidence:
            raise TargetError("COMMISSIONING_IMPORT_EVIDENCE", "Select retained import evidence and its actual evidence class.")
        originals, seen = [], set()
        for item in evidence:
            _check_keys(item, {"source", "class", "title", "format"}, {"source", "class"})
            if item["class"] not in {"native_receipt", "original_export", "original_screenshot", "operator_statement"}:
                raise TargetError("COMMISSIONING_EVIDENCE_CLASS", "Distinguish native receipts, original exports/screenshots and operator statements.")
            path = self.store.selected_upload(item["source"])
            source = item["source"]
            raw = self.store.read_bytes(source["sha256"])
            if len(raw) != path.stat().st_size or ("bytes" in source and source["bytes"] != len(raw)):
                raise TargetError("COMMISSIONING_EVIDENCE_BYTES", "The selected original import evidence changed.")
            descriptor = {"sha256": source["sha256"], "bytes": len(raw), "filename": source["filename"],
                          "class": item["class"], "title": item.get("title", source["filename"]),
                          "format": item.get("format")}
            identity = digest(descriptor)
            if identity in seen:
                raise TargetError("COMMISSIONING_EVIDENCE_DUPLICATE", "The same evidence selection is repeated.")
            seen.add(identity)
            originals.append({"id": identity, **descriptor})
        supplied = args.get("import_exceptions", [])
        if not isinstance(supplied, list):
            raise TargetError("COMMISSIONING_IMPORT_EXCEPTIONS", "Retain the original exception rows as a list.")
        exceptions, exception_ids = [], set()
        known = {item["sha256"] for item in originals}
        for item in supplied:
            _check_keys(item, {"evidence_sha256", "coordinate", "original"},
                        {"evidence_sha256", "coordinate", "original"})
            if item["evidence_sha256"] not in known:
                raise TargetError("COMMISSIONING_EXCEPTION_SOURCE", "An original exception must name selected retained evidence.")
            saved = copy.deepcopy(item)
            saved["id"] = digest(item)
            if saved["id"] in exception_ids:
                raise TargetError("COMMISSIONING_EXCEPTION_DUPLICATE", "Keep each original exception coordinate once.")
            exception_ids.add(saved["id"])
            exceptions.append(saved)
        settings = args.get("import_settings", {})
        if not isinstance(settings, dict):
            raise TargetError("COMMISSIONING_IMPORT_SETTINGS", "Keep original import settings as explicitly supplied values.")
        body = {"schema": "portfolio.imported-plan-intake.v1", "source_edition_id": edition["id"],
                "source_edition_sha256": edition["sha256"], "source_ids": edition.get("source_ids", []),
                "profile": public_profile(profile), "project_id": guid(args["project_id"]),
                "evidence": originals, "import_exceptions": exceptions,
                "import_settings": copy.deepcopy(settings), "import_time": copy.deepcopy(args.get("import_time")),
                "project_url": args.get("project_url"), "label": args.get("label"),
                "settings_evidence_kind": "supplied_original_context; not a new native observation"}
        return body, edition, profile

    def _new_adoption(self, request_id, request_args, intake, edition, *, rebind=None):
        intake_ref = self.store.put(intake)["sha256"]
        selection = {"schema": "portfolio.import-adoption-selection.v1",
                     "deployment_id": request_id, "source_edition_id": edition["id"],
                     "source_edition_sha256": edition["sha256"], "project_id": intake["project_id"],
                     "profile": intake["profile"], "import_intake_sha256": intake_ref,
                     "immediate": [], "batches": [], "provider_writes": 0}
        value = {"schema": "portfolio.target-deployment.v1", "id": request_id, "revision": 0,
                 "created_at": utcnow(), "state": "ADOPTION_AWAITING_CAPTURE",
                 "profile_id": intake["profile"]["id"], "source_edition_id": edition["id"],
                 "project_id": intake["project_id"], "project_name": intake.get("label") or "Existing imported plan",
                 "commissioning_origin": "external_import", "commissioning_root_id": request_id,
                 "commissioning_request_sha256": digest(request_args),
                 "import_intake_sha256": intake_ref, "plan_sha256": self.store.put(selection)["sha256"],
                 "calls": {}, "batches": [], "observations": [], "adoption_history": []}
        if rebind is not None:
            value["rebind_sha256"] = self.store.put(rebind)["sha256"]
            value["parent_deployment_id"] = rebind["parent_deployment_id"]
            value["parent_snapshot_sha256"] = rebind["parent_snapshot_sha256"]
            value["commissioning_root_id"] = rebind["commissioning_root_id"]
            value["expected_organization_id"] = rebind["original_target_identity"]["organization_id"]
        return self.store.save("deployments", value, expected_revision=0)

    def adopt_existing(self, request_id, args):
        existing = self._existing(request_id)
        if existing is None:
            intake, edition, _ = self._intake(args)
            value = self._new_adoption(request_id, args, intake, edition)
        else:
            value = existing
            if not is_commissioned(value) or value.get("commissioning_request_sha256") != digest(args):
                raise TargetError("COMMISSIONING_REQUEST_REUSED", "This original adoption request names another selection.")
        capture_request = digest({"adoption": request_id, "phase": "original-native-capture"})
        return self.capture(capture_request, value["id"], expected_revision=value["revision"])

    def _base_plan(self, value, edition, probe, inventory):
        project = inventory["project"]
        plan = {"schema": "portfolio.target-plan.v1", "deployment_id": value["id"],
                "mode": ADOPTION_MODE, "origin": "external_import",
                "source_edition_id": edition["id"], "source_edition_sha256": edition["sha256"],
                "source_ids": edition.get("source_ids", []), "target_identity": value["native_target_identity"],
                "probe_sha256": probe["sha256"], "project_id": value["project_id"],
                "project_name": project.get("msdyn_subject") or value["project_name"],
                "existing_project": True, "bucket_id": None,
                "bucket_observations": inventory["bucket_observations"],
                "row_ids": {family: {} for family in FAMILIES}, "team_selections": [],
                "mappings": {}, "projection": [], "immediate": [], "batches": [], "findings": [],
                "import_intake_sha256": value["import_intake_sha256"],
                "rebind_sha256": value.get("rebind_sha256"),
                "counts": {"source": {family: len(edition["model"][family]) for family in FAMILIES},
                           "immediate_actions": 0, "queued_operations": 0, "operation_sets": 0}}
        plan["sha256"] = digest(plan)
        return plan

    def _team_capture(self, value, target, request_id):
        progress = value["capture_in_progress"]
        m = target.metadata
        project_column = m.lookup("msdyn_projectteam", "msdyn_project")
        relative = m.entity("msdyn_projectteam")["set"] + "?" + urlencode({
            "$filter": project_column + " eq " + value["project_id"]})
        binding = {"request_id": request_id, "project_id": value["project_id"],
                   "target_identity": value["native_target_identity"], "initial_path": relative}
        state = progress.get("team_capture")
        if state is None:
            state = {"schema": "portfolio.project-team-read.v1", "binding": binding,
                     "pages": [], "next": relative, "complete": False, "rows": 0}
            progress["team_capture"] = state
            self._save(value)
        elif state.get("schema") != "portfolio.project-team-read.v1" or state.get("binding") != binding:
            raise TargetError("COMMISSIONING_TEAM_BINDING", "Retain the original selected project's team pages.")
        seen = {item["request"] for item in state["pages"]}
        while not state["complete"]:
            self._stopped()
            relative = state["next"]
            if not isinstance(relative, str) or not relative or relative in seen or len(seen) >= 10000:
                raise TargetError("COMMISSIONING_TEAM_PAGING", "The original team continuation is absent, repeated or beyond the retained page limit.")
            page, response = target.request("GET", relative)
            if not isinstance(page, dict) or not isinstance(page.get("value"), list):
                raise TargetError("COMMISSIONING_TEAM_PAGE", "Keep the complete original native project-team page.")
            next_path = page.get("@odata.nextLink")
            if next_path is not None and (not isinstance(next_path, str) or not next_path):
                raise TargetError("COMMISSIONING_TEAM_NEXT", "The native project-team continuation is invalid.")
            state["rows"] += len(page["value"])
            if state["rows"] > 250000:
                raise TargetError("COMMISSIONING_TEAM_LIMIT", "The complete project-team capture exceeds the retained row limit.")
            state["pages"].append({"request": relative, "url": response["url"],
                "page_sha256": self.store.put(page)["sha256"],
                "response_sha256": self.store.put(response)["sha256"],
                "body_sha256": response["sha256"], "count": len(page["value"])})
            seen.add(relative)
            state["next"], state["complete"] = next_path, next_path is None
            self._save(value)
        rows = []
        for item in state["pages"]:
            page = self.store.read(item["page_sha256"])
            response = self.store.read(item["response_sha256"])
            try:
                raw = base64.b64decode(response["body_base64"], validate=True)
                original_page = json.loads(raw.decode("utf-8-sig"))
            except (KeyError, ValueError, UnicodeError) as exc:
                raise TargetError("COMMISSIONING_TEAM_EVIDENCE", "Keep the original complete native project-team response.") from exc
            if (response.get("sha256") != item["body_sha256"] or
                    hashlib.sha256(raw).hexdigest() != item["body_sha256"] or
                    len(raw) != response.get("bytes") or digest(original_page) != item["page_sha256"] or
                    not response.get("complete") or not 200 <= response.get("status", 0) < 300 or
                    len(page["value"]) != item["count"]):
                raise TargetError("COMMISSIONING_TEAM_EVIDENCE", "The original complete project-team page evidence changed.")
            rows.extend(page["value"])
        return rows, self.store.put(state)["sha256"]

    def capture(self, request_id, identity, *, expected_revision=None):
        selected = self.store.index("deployments", identity)
        if not is_commissioned(selected):
            raise TargetError("COMMISSIONING_CAPTURE_ORIGIN", "Keep the original target capture path for a created deployment.")
        previous_ref = selected.get("capture_results", {}).get(request_id)
        if previous_ref:
            return {**selected, "original_capture": self.store.read(previous_ref)}
        active = selected.get("capture_in_progress")
        if active is not None and (
                not isinstance(active, dict) or active.get("request_id") != request_id):
            raise TargetError("COMMISSIONING_CAPTURE_ACTIVE",
                              "Continue the original active capture request; a new request cannot replace its retained pages.")
        plan = self.store.read(selected["plan_sha256"])
        adopting = plan.get("mode") == ADOPTION_MODE or plan.get("schema") == "portfolio.import-adoption-selection.v1"
        allowed = {"ADOPTION_AWAITING_CAPTURE", "CAPTURED", "ACCEPTED"} if adopting else {"NATIVE_COMPLETE", "CAPTURED", "ACCEPTED"}
        if selected["state"] not in allowed:
            raise TargetError("COMMISSIONING_CAPTURE_STATE", "Complete the original correction sets before target recapture.")
        value, previous = self.w._capture_start(request_id, identity, expected_revision)
        if previous is not None:
            return {**value, "original_capture": previous}
        self._stopped()
        progress = value["capture_in_progress"]
        old_transport = self.store.read(progress["reader_transport_sha256"]) if progress.get("reader_transport_sha256") else None
        offline = bool(old_transport and old_transport.get("complete") and progress.get("team_capture", {}).get("complete"))
        if offline:
            profile = {**value["native_target_identity"]["profile"],
                       "max_response_bytes": old_transport["binding"]["max_response_bytes"]}
            target = NativeTarget(profile)
            probe = self.store.read(progress["capture_probe_sha256"])
            target.metadata = metadata_from_probe(probe)
        else:
            profile = self.w.profile(value["profile_id"])
            intake = self.store.read(value["import_intake_sha256"])
            if public_profile(profile) != intake["profile"]:
                raise TargetError("COMMISSIONING_PROFILE_CHANGED", "Retain the original profile edition or explicitly rebind the imported target.")
            target = self.w._observed_target(profile, value)
            current_probe = target.probe()
            native_identity = target_identity(profile, current_probe)
            if value.get("expected_organization_id") and native_identity["organization_id"] != value["expected_organization_id"]:
                raise TargetError("COMMISSIONING_REBIND_ORGANIZATION", "An explicit principal rebind must still observe the original organization and project.")
            if value.get("native_target_identity") and value["native_target_identity"] != native_identity:
                raise TargetError("COMMISSIONING_TARGET_CHANGED", "The selected native principal, organization or CSDL changed.")
            if not value.get("native_target_identity"):
                value["native_target_identity"] = native_identity
            progress = value["capture_in_progress"]
            if not progress.get("capture_probe_sha256"):
                progress["capture_probe_sha256"] = self.store.put(current_probe)["sha256"]
                self._save(value)
            probe = self.store.read(value["capture_in_progress"]["capture_probe_sha256"])
        if target_identity(profile, probe) != value["native_target_identity"]:
            raise TargetError("COMMISSIONING_CAPTURE_PROBE", "The original capture probe belongs to another target.")

        def keep_transport(state):
            value["capture_in_progress"]["reader_transport_sha256"] = self.store.put(state)["sha256"]
            self._save(value)

        transport = NativeReaderTransport(target, self.store, request_id=request_id,
            project_id=value["project_id"], target_identity=value["native_target_identity"],
            previous=old_transport, persist=keep_transport, closing=self.w.closing)
        progress = value["capture_in_progress"]
        if progress.get("capture_edition_id"):
            if not transport.state.get("complete"):
                raise TargetError("COMMISSIONING_CAPTURE_SOURCE", "The retained native edition requires its complete original pages.")
            capture = self.portfolio.read_edition(progress["capture_edition_id"])
            transport_ref = transport.finish()
        else:
            native = self.portfolio.native
            with native.locked():
                self._stopped()
                reader_type = native.jclass("org.mpxj.msplanner.MsPlannerReader")
                uuid_type = native.jclass("java.util.UUID")
                with transport:
                    reader = reader_type(transport.origin, transport.token)
                    try:
                        project_file = reader.readProject(uuid_type.fromString(value["project_id"]))
                    except Exception:
                        transport.raise_if_failed()
                        raise
                transport_ref = transport.finish()
                capture = self.portfolio.capture_native(request_id, project_file, provenance={
                    "kind": "project_operations", "origin": "external_import",
                    "api_origin": profile["api_origin"], "api_version": profile["api_version"],
                    "project_id": value["project_id"], "user_id": profile["user_id"],
                    "organization_id": profile["organization_id"], "deployment_id": value["id"],
                    "probe_sha256": probe["sha256"],
                    "probe_object_sha256": value["capture_in_progress"]["capture_probe_sha256"],
                    "native_reader": "org.mpxj.msplanner.MsPlannerReader",
                    "read_transport_sha256": transport_ref["sha256"]})
            value["capture_in_progress"]["capture_edition_id"] = capture["id"]
            self._save(value)
        self._stopped()
        teams, team_ref = self._team_capture(value, target, request_id)
        project, receipt = transport.project()
        inventory = build_inventory(capture, project, receipt, teams, target.metadata, value["project_id"],
            transport_sha256=transport_ref["sha256"], team_capture_sha256=team_ref)
        inventory_ref = self.store.put(inventory)["sha256"]
        source = self.portfolio.read_edition(value["source_edition_id"])
        if plan.get("schema") == "portfolio.import-adoption-selection.v1":
            plan = self._base_plan(value, source, probe, inventory)
            value["plan_sha256"] = self.store.put(plan)["sha256"]
            value["plan_digest"] = plan["sha256"]
            value["project_name"] = plan["project_name"]
        else:
            verify_plan(plan)
        row_ids, identity_map, findings, identity_evidence = checked_mapping(
            source, capture, inventory, target.metadata,
            {family: plan["row_ids"].get(family, {}) for family in MAPPED_FAMILIES})
        basis = compare_projection(source, inventory, row_ids, plan["projection"])
        basis_ref = self.store.put(basis)["sha256"]
        comparison = self.portfolio.compare(source["id"], capture["id"],
            identity_map=identity_map, strict_identity=True)
        value["commissioning_inventory_sha256"] = inventory_ref
        value["commissioning_comparison_sha256"] = basis_ref
        value["commissioning_identity_findings"] = findings
        value["commissioning_probe_sha256"] = value["capture_in_progress"]["capture_probe_sha256"]
        value.setdefault("commissioning_captures", {})[request_id] = {
            "inventory_sha256": inventory_ref, "comparison_sha256": basis_ref,
            "probe_sha256": value["commissioning_probe_sha256"], "team_capture_sha256": team_ref,
            "read_transport_sha256": transport_ref["sha256"], "capture_edition_id": capture["id"]}
        return self.w._capture_finish(value, request_id, capture["id"], comparison,
            identity_map=identity_map, findings=findings, transport_sha256=transport_ref["sha256"],
            identity_evidence=identity_evidence)

    def prepare_adoption_review(self, request_id, args):
        _check_keys(args, {"deployment_id", "expected_revision", "row_ids", "mappings", "exception_decisions"},
                    {"deployment_id", "expected_revision", "row_ids", "exception_decisions"})
        value = self._current(args)
        original_plan = self.store.read(value["plan_sha256"])
        if original_plan.get("mode") != ADOPTION_MODE:
            raise TargetError("COMMISSIONING_REVIEW_MODE", "Preserve an executed correction plan; rebind/adopt a new reviewed entry for identity changes.")
        source = self.portfolio.read_edition(value["source_edition_id"])
        capture = self.portfolio.read_edition(value["capture_edition_id"])
        inventory = self.store.read(value["commissioning_inventory_sha256"])
        probe = self.store.read(value["commissioning_probe_sha256"])
        metadata = metadata_from_probe(probe)
        row_ids, identity_map, findings, identity_evidence = checked_mapping(
            source, capture, inventory, metadata, args["row_ids"])
        projection, retained_findings, mappings = field_projection(
            source, value["native_target_identity"]["profile"], metadata, args.get("mappings", {}))
        findings.extend(retained_findings)
        intake = self.store.read(value["import_intake_sha256"])
        evidence = {item["sha256"] for item in intake["evidence"]}
        evidence.update({value["commissioning_inventory_sha256"], value["commissioning_probe_sha256"],
                         value["capture_read_transport_sha256"]})
        decisions = exception_review(intake["import_exceptions"], args["exception_decisions"], evidence)
        findings.append(finding("COMMISSIONING_EXTERNAL_IMPORT_REVIEW",
            "This receipt adopts observed existing native content. It does not attest that this operator created the imported project or completed an OperationSet."))
        if value.get("rebind_sha256"):
            findings.append(finding("COMMISSIONING_PRINCIPAL_REBIND",
                "This is a separately reviewed observation by a newly selected principal; the old jobs and credentials were not rewritten.",
                evidence={"rebind_sha256": value["rebind_sha256"]}))
        plan = self._base_plan(value, source, probe, inventory)
        plan.update({"row_ids": row_ids, "mappings": mappings, "projection": projection,
                     "findings": findings, "identity_evidence": identity_evidence,
                     "import_exception_review": decisions,
                     "inventory_sha256": value["commissioning_inventory_sha256"]})
        plan.pop("sha256", None)
        plan["sha256"] = digest(plan)
        basis = compare_projection(source, inventory, row_ids, projection)
        comparison = self.portfolio.compare(source["id"], capture["id"], identity_map=identity_map, strict_identity=True)
        proposal = {"schema": "portfolio.import-adoption-review-proposal.v1", "request_id": request_id,
                    "deployment_id": value["id"], "deployment_revision": value["revision"],
                    "deployment_snapshot_sha256": value["snapshot_sha256"],
                    "source_edition_id": source["id"], "capture_edition_id": capture["id"],
                    "plan_sha256": self.store.put(plan)["sha256"],
                    "inventory_sha256": value["commissioning_inventory_sha256"],
                    "basis_sha256": self.store.put(basis)["sha256"],
                    "comparison_sha256": self.store.put(comparison)["sha256"],
                    "identity_evidence_sha256": self.store.put(identity_evidence)["sha256"],
                    "identity_findings": [f for f in findings if f not in retained_findings],
                    "required_finding_ids": [f["id"] for f in findings]}
        return {**proposal, "proposal_sha256": self.store.put(proposal)["sha256"],
                "plan": plan, "intended_observed": basis, "import_exception_review": decisions}

    def review_adoption(self, request_id, args):
        _check_keys(args, {"deployment_id", "expected_revision", "proposal_sha256",
                          "reviewer", "note", "accepted_findings"},
                    {"deployment_id", "expected_revision", "proposal_sha256", "reviewer", "note", "accepted_findings"})
        current = self.store.index("deployments", args["deployment_id"])
        previous = current.get("adoption_review_results", {}).get(request_id)
        if previous:
            return {**current, "original_adoption_review": self.store.read(previous)}
        value = self._current(args)
        proposal = self.store.read(checked_id(args["proposal_sha256"]))
        if (proposal.get("schema") != "portfolio.import-adoption-review-proposal.v1" or
                proposal["deployment_id"] != value["id"] or
                proposal["deployment_revision"] != value["revision"] or
                proposal["deployment_snapshot_sha256"] != value["snapshot_sha256"] or
                proposal["inventory_sha256"] != value["commissioning_inventory_sha256"]):
            raise TargetError("COMMISSIONING_REVIEW_PROPOSAL", "Reopen the exact proposed identity/exception review for this capture.")
        plan = verify_plan(self.store.read(proposal["plan_sha256"]))
        review = review_schedule(plan, reviewer=args["reviewer"], note=args["note"],
                                 accepted_findings=args["accepted_findings"])
        review.update({"origin": "external_import", "project_id": value["project_id"],
                       "proposal_sha256": args["proposal_sha256"], "capture_edition_id": value["capture_edition_id"],
                       "inventory_sha256": proposal["inventory_sha256"], "basis_sha256": proposal["basis_sha256"],
                       "import_intake_sha256": value["import_intake_sha256"],
                       "import_exception_review": plan["import_exception_review"],
                       "rebind_sha256": value.get("rebind_sha256")})
        review.pop("sha256", None)
        review["sha256"] = digest(review)
        ref = self.store.put(review)["sha256"]
        value.setdefault("adoption_history", []).append({
            "request_id": request_id, "previous_plan_sha256": value["plan_sha256"],
            "previous_review_sha256": value.get("adoption_review_sha256"),
            "proposal_sha256": args["proposal_sha256"], "plan_sha256": proposal["plan_sha256"],
            "review_sha256": ref, "capture_edition_id": value["capture_edition_id"]})
        value["plan_sha256"] = proposal["plan_sha256"]
        value["plan_digest"] = plan["sha256"]
        value["review_sha256"] = value["adoption_review_sha256"] = ref
        value["review_digest"] = review["sha256"]
        value["comparison_sha256"] = proposal["comparison_sha256"]
        value["commissioning_comparison_sha256"] = proposal["basis_sha256"]
        value["commissioning_identity_findings"] = proposal["identity_findings"]
        value["capture_identity_evidence_sha256"] = proposal["identity_evidence_sha256"]
        value["capture_identity_map"] = plan["identity_evidence"]["identity_map"]
        value["capture_identity_findings"] = proposal["identity_findings"]
        value.setdefault("adoption_review_results", {})[request_id] = ref
        value["state"] = "CAPTURED"
        value.pop("acceptance_sha256", None)
        return self._save(value)

    def prepare_observed_correction(self, request_id, args):
        _check_keys(args, {"deployment_id", "expected_revision", "basis_sha256", "edition_id", "mappings", "selected_fields"},
                    {"deployment_id", "expected_revision", "basis_sha256"})
        value = self._existing(request_id)
        if value is not None:
            if value.get("commissioning_request_sha256") != digest(args):
                raise TargetError("COMMISSIONING_REQUEST_REUSED", "Retain the original correction preparation selection.")
            if value.get("state") != "CORRECTION_PREPARING":
                return value
            preparation = self.store.read(value["preparation_sha256"])
            parent = preparation["parent"]
            edition = self.portfolio.read_edition(preparation["edition_id"])
        else:
            parent = self._current(args, reviewed=True)
            if args["basis_sha256"] != parent["commissioning_comparison_sha256"]:
                raise TargetError("COMMISSIONING_CORRECTION_BASIS", "Select the current intended-versus-observed result.")
            # Adoption reviews must cover their exact latest capture. A correction's
            # existing native review and inherited adoption lineage remain immutable.
            parent_plan = self.store.read(parent["plan_sha256"])
            if parent_plan.get("mode") == ADOPTION_MODE:
                review = self.store.read(parent["adoption_review_sha256"])
                if review["capture_edition_id"] != parent["capture_edition_id"]:
                    raise TargetError("COMMISSIONING_REVIEW_RECAPTURE", "Review the current adopted-plan capture first.")
            edition = self.portfolio.read_edition(checked_id(args.get("edition_id", parent["source_edition_id"])))
            preparation = {"schema": "portfolio.observed-correction-preparation.v1",
                           "parent": copy.deepcopy(parent), "edition_id": edition["id"],
                           "edition_sha256": edition["sha256"], "arguments": copy.deepcopy(args)}
            value = {"schema": "portfolio.target-deployment.v1", "id": request_id, "revision": 0,
                "created_at": utcnow(), "state": "CORRECTION_PREPARING", "profile_id": parent["profile_id"],
                "source_edition_id": edition["id"], "project_id": parent["project_id"],
                "project_name": parent["project_name"], "parent_deployment_id": parent["id"],
                "parent_snapshot_sha256": self.store.put(parent)["sha256"],
                "commissioning_origin": "external_import", "commissioning_root_id": parent["commissioning_root_id"],
                "commissioning_request_sha256": digest(args), "import_intake_sha256": parent["import_intake_sha256"],
                "adoption_review_sha256": parent["adoption_review_sha256"], "rebind_sha256": parent.get("rebind_sha256"),
                "native_target_identity": copy.deepcopy(parent["native_target_identity"]),
                "plan_sha256": parent["plan_sha256"], "preparation_sha256": self.store.put(preparation)["sha256"],
                "preparation_records": {}, "calls": {}, "batches": [], "observations": []}
            value = self.store.save("deployments", value, expected_revision=0)
        if edition["sha256"] != preparation["edition_sha256"]:
            raise TargetError("COMMISSIONING_SOURCE_CHANGED", "The pinned original source edition changed.")
        original = self.portfolio.read_edition(parent["source_edition_id"])
        parent_plan = self.store.read(parent["plan_sha256"])
        inventory = self.store.read(parent["commissioning_inventory_sha256"])
        profile = self.w.profile(value["profile_id"])
        if public_profile(profile) != value["native_target_identity"]["profile"]:
            raise TargetError("COMMISSIONING_PROFILE_CHANGED", "Keep the pinned native profile, or use explicit principal rebind.")
        target = self.w._observed_target(profile, value)
        self._stopped()
        current_probe = target.probe()
        if target_identity(profile, current_probe) != value["native_target_identity"]:
            raise TargetError("COMMISSIONING_TARGET_CHANGED", "The selected target identity or native CSDL changed.")
        if not value.get("preparation_probe_sha256"):
            value["preparation_probe_sha256"] = self.store.put(current_probe)["sha256"]
            self._save(value)
        probe = self.store.read(value["preparation_probe_sha256"])
        records = {}
        # Retain each first complete original GET before proceeding. Reentry reuses
        # those records; the maintained queue/execute checks detect later changes.
        for identity in sorted(set(parent_plan["row_ids"].get("tasks", {}).values())):
            self._stopped()
            identity = guid(identity)
            prior = value["preparation_records"].get(identity)
            if prior:
                row = self.store.read(prior)
            else:
                row = target.record("msdyn_projecttask", identity)
                value["preparation_records"][identity] = self.store.put(row)["sha256"]
                self._save(value)
            records[identity] = row
        plan = observed_correction_plan(edition, original, profile, probe, request_id,
            parent, parent_plan, inventory, records, mappings=args.get("mappings"),
            selected_fields=args.get("selected_fields"))
        value["plan_sha256"] = self.store.put(plan)["sha256"]
        value["plan_digest"] = plan["sha256"]
        value["last_probe_sha256"] = value["preparation_probe_sha256"]
        value["state"] = "PREPARED"
        return self._save(value)

    def rebind_imported_target(self, request_id, args):
        _check_keys(args, {"deployment_id", "expected_revision", "profile_id", "reviewer", "note"},
                    {"deployment_id", "expected_revision", "profile_id", "reviewer", "note"})
        value = self._existing(request_id)
        if value is None:
            parent = self._current(args, reviewed=True)
            _readable(args["reviewer"], "the operator reviewing this principal rebind")
            _readable(args["note"], "the reason for selecting another authenticated principal")
            profile = self.w.profile(args["profile_id"])
            if profile["kind"] != "project_operations":
                raise TargetError("COMMISSIONING_REBIND_PROFILE", "Select the supported native environment profile.")
            intake = copy.deepcopy(self.store.read(parent["import_intake_sha256"]))
            intake["profile"] = public_profile(profile)
            edition = self.portfolio.read_edition(parent["source_edition_id"])
            intake["source_edition_id"] = edition["id"]
            intake["source_edition_sha256"] = edition["sha256"]
            intake["source_ids"] = edition.get("source_ids", [])
            rebind = {"schema": "portfolio.imported-plan-principal-rebind.v1",
                      "parent_deployment_id": parent["id"], "parent_revision": parent["revision"],
                      "parent_snapshot_sha256": self.store.put(parent)["sha256"],
                      "commissioning_root_id": parent["commissioning_root_id"],
                      "original_target_identity": parent["native_target_identity"],
                      "selected_new_profile": public_profile(profile), "project_id": parent["project_id"],
                      "original_import_intake_sha256": parent["import_intake_sha256"],
                      "reviewer": args["reviewer"], "note": args["note"]}
            value = self._new_adoption(request_id, args, intake, edition, rebind=rebind)
        elif value.get("commissioning_request_sha256") != digest(args) or not value.get("rebind_sha256"):
            raise TargetError("COMMISSIONING_REBIND_REQUEST", "Keep the original reviewed principal-rebind request.")
        return self.capture(digest({"rebind": request_id, "phase": "native-capture"}),
                            value["id"], expected_revision=value["revision"])

    def commissioning_handover(self, request_id, args):
        _check_keys(args, {"deployment_id"}, {"deployment_id"})
        value = self.w.deployment(args["deployment_id"])
        if not is_commissioned(value):
            raise TargetError("COMMISSIONING_HANDOVER", "Select an original commissioned deployment.")
        original = self.w.handover(value["id"])
        lineage, seen, cursor = [], set(), value
        while cursor is not None:
            if cursor["id"] in seen:
                raise TargetError("COMMISSIONING_LINEAGE_CYCLE", "Preserve the original lineage; a parent cycle is invalid.")
            seen.add(cursor["id"])
            item = copy.deepcopy(cursor)
            item["original_import"] = self.store.read(item["import_intake_sha256"])
            item["plan"] = self.store.read(item["plan_sha256"])
            if item.get("adoption_review_sha256"):
                item["adoption_review"] = self.store.read(item["adoption_review_sha256"])
            if item.get("commissioning_inventory_sha256"):
                item["inventory"] = self.store.read(item["commissioning_inventory_sha256"])
                item["intended_observed"] = self.store.read(item["commissioning_comparison_sha256"])
            if item.get("rebind_sha256"):
                item["principal_rebind"] = self.store.read(item["rebind_sha256"])
            lineage.append(item)
            parent = item.get("parent_deployment_id")
            if parent:
                if not item.get("parent_snapshot_sha256"):
                    raise TargetError("COMMISSIONING_PARENT_SNAPSHOT", "Keep the exact parent edition selected by this original operation.")
                cursor = self.store.read(item["parent_snapshot_sha256"])
                if cursor.get("id") != parent:
                    raise TargetError("COMMISSIONING_PARENT_ID", "The retained parent snapshot names another deployment.")
            else:
                cursor = None
        body = {"schema": "portfolio.imported-plan-handover.v1", "deployment_id": value["id"],
                "source_edition_id": value["source_edition_id"], "capture_edition_id": value["capture_edition_id"],
                "acceptance_sha256": value["acceptance_sha256"], "lineage": lineage,
                "original_handover": original, "credential_transfer": False,
                "complete_bytes": "The original portable workspace retains every referenced source, page, response, review and object.",
                "following_correction": "Compare retained source intent with observed native values; source changes are not required."}
        json_ref = self.store.put(body)
        def show(data):
            return html.escape(json.dumps(data, ensure_ascii=False, sort_keys=True, indent=2))
        sections = ["<!doctype html><html lang=en><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>",
            "<title>Imported plan commissioning handover</title><style>body{font:16px system-ui;max-width:80rem;margin:2rem auto;padding:0 1rem;color:#172b37}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f3f6f8;padding:1rem}h2{margin-top:2rem}details{margin:1rem 0}</style>",
            "<h1>Imported plan commissioning handover</h1><p>This receipt separates retained source, intended values and actual target observations. Adoption created no native project or bucket. Any correction uses its recorded existing task IDs and original native set history.</p>"]
        for entry in lineage:
            sections.extend(["<h2>" + html.escape(entry.get("project_name", entry["id"])) + "</h2>",
                "<p>Deployment " + html.escape(entry["id"]) + " · " + html.escape(entry["state"]) + "</p>"])
            for title, item in (("Original import evidence and settings", entry["original_import"]),
                                ("Source, intended and observed task values", entry.get("intended_observed")),
                                ("Reviewed identities and import exceptions", entry.get("adoption_review")),
                                ("Native correction calls and sets", {"calls": entry.get("calls"), "batches": entry.get("batches")}),
                                ("Principal rebind", entry.get("principal_rebind"))):
                if item is not None:
                    sections.append("<details><summary>" + html.escape(title) + "</summary><pre>" + show(item) + "</pre></details>")
        sections.append("<p>Keep this report with the original acceptance and complete portable workspace. Credentials are selected privately on the receiving host. A new principal requires a separately reviewed rebind; existing jobs retain their original identity.</p></html>")
        html_ref = self.store.put_bytes("\n".join(sections).encode("utf-8"))
        return {**original, "commissioning_json": {**json_ref, "filename": "imported-plan-commissioning.json"},
                "commissioning_html": {**html_ref, "filename": "imported-plan-commissioning.html"},
                "lineage_deployment_ids": [entry["id"] for entry in lineage]}
