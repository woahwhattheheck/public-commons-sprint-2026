"""Saved portfolio reporting cohorts on the original A/B source and request stores."""
from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
import re
import shutil
import sqlite3

from portfolio.storage import canonical, checked_id, digest, file_identity, now, require
from portfolio_target.target import TargetError

from .closure import SourceClosure, restore_sources
from .dataset import RowSummary, RelationalWriter, all_headers, export_query, query_page, quoted
from .delivery import ReceivedPackage, Sink, azure_sql, html_report, power_query, readme
from .measures import currency_context, measure_profile, project_measures
from .projection import FAMILIES, Projection, available_fields, data_dictionary, selected_fields
from .timephased_contract import MAX_FACTS, PROJECTION as TIMEPHASED_PROJECTION, normalize_profile as timephased_profile
from .timephased_native import capture as capture_timephased
from .timephased import project_rows as project_timephased

ACTIONS = frozenset({
    "archive_save", "archive_review", "archive_publish", "archive_query_export",
    "archive_inspect", "archive_receive",
})
PROJECT_KEY = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}\Z")


class ArchiveWorkspace:
    """A cohort index and immutable reports inside the existing operator workspace."""
    def __init__(self, portfolio, operator_store, *, stopped=None):
        self.portfolio, self.store = portfolio, operator_store
        self.root = portfolio.root
        self.stopped = stopped
        self._verified = {}

    def _put(self, value):
        return self.store.put_bytes(canonical(value))

    def _check_running(self):
        if self.stopped is not None and self.stopped():
            raise TargetError("ARCHIVE_CLOSING", "Reopen this saved archive request when the original desk is running.")

    def _index(self, identity):
        return self.store.index("cohorts", checked_id(identity))

    def list(self, *, cursor="", limit=25):
        page = self.store.list("cohorts", cursor=cursor, limit=limit)
        return {**page, "items": [{key: row.get(key) for key in (
            "id", "revision", "created_at", "updated_at", "name", "description", "definition_sha256",
            "review_sha256", "latest_publication", "member_count")} for row in page["items"]]}

    def read(self, identity):
        cohort = self._index(identity)
        definition = self.store.read(cohort["definition_sha256"])
        review = self.store.read(cohort["review_sha256"]) if cohort.get("review_sha256") else None
        return {"cohort": cohort, "definition": definition,
                "review": None if review is None else {"sha256": cohort["review_sha256"], "value": review},
                "publications": [self.store.read(item["sha256"]) for item in cohort.get("publications", [])],
                "query_exports": [self.store.read(item["sha256"]) for item in cohort.get("query_exports", [])]}

    def fields(self, edition_ids):
        require(isinstance(edition_ids, list) and 1 <= len(edition_ids) <= 500
                and len(set(edition_ids)) == len(edition_ids),
                "archive_edition_selection", "Select distinct exact source editions.")
        return available_fields(self.portfolio.read_edition(checked_id(identity)) for identity in edition_ids)

    def _definition(self, value):
        require(isinstance(value, dict) and set(value) <= {"name", "description", "members", "profile"},
                "archive_cohort", "Use the cohort name, original members and reporting profile.")
        name, description = value.get("name"), value.get("description", "")
        require(isinstance(name, str) and name.strip() and len(name) <= 240
                and isinstance(description, str) and len(description) <= 8000,
                "archive_name", "Name this reporting cohort and its business purpose.")
        requested = value.get("members")
        require(isinstance(requested, list) and 1 <= len(requested) <= 500,
                "archive_members", "Select 1 to 500 original project editions for this cohort.")
        keys, edition_ids, members = set(), set(), []
        for item in requested:
            require(isinstance(item, dict) and set(item) <= {"project_key", "label", "edition_id", "currency"},
                    "archive_member", "Keep each project's key, label, exact edition and optional currency declaration.")
            key, label = item.get("project_key"), item.get("label")
            require(isinstance(key, str) and PROJECT_KEY.fullmatch(key) and key not in keys,
                    "archive_project_key", "Give each business project one distinct reporting key.")
            require(isinstance(label, str) and label.strip() and len(label) <= 240,
                    "archive_project_label", "Name each selected business project.")
            eid = checked_id(item.get("edition_id"))
            require(eid not in edition_ids, "archive_duplicate_edition",
                    "Select the original edition once in this cohort; one snapshot cannot represent two projects.")
            edition = self.portfolio.read_edition(eid)
            model = edition["model"]
            require(model.get("schema") == "project-portfolio-model.v1",
                    "archive_model", "Select a complete original native portfolio edition.")
            member = {"project_key": key, "label": label, "edition_id": eid,
                      "model_sha256": edition["sha256"], "kind": edition["kind"],
                      "source_ids": edition["source_ids"]}
            if "currency" in item:
                member["currency"] = copy.deepcopy(item["currency"])
            currency_context(member, model)
            members.append(member)
            keys.add(key)
            edition_ids.add(eid)
        coverage = available_fields(self.portfolio.read_edition(member["edition_id"]) for member in members)
        profile = value.get("profile") or {}
        require(isinstance(profile, dict) and set(profile) <= {"columns", "metrics", "timephased"},
                "archive_profile", "Select original report columns and exact-grain metrics.")
        columns = selected_fields({"columns": profile["columns"]} if "columns" in profile else {}, coverage)
        normalized = {**columns, "metrics": measure_profile(profile.get("metrics"), coverage)}
        if profile.get("timephased") is not None:
            normalized["timephased"] = timephased_profile(profile["timephased"], coverage)
        return {"schema": "portfolio.archive-definition.v1", "name": name, "description": description,
                "members": members, "profile": normalized}

    def _selected(self, definition):
        seen = set()
        for member in definition["members"]:
            self._check_running()
            require(member["edition_id"] not in seen, "archive_duplicate_edition", "The original cohort contains repeated editions.")
            seen.add(member["edition_id"])
            edition = self.portfolio.read_edition(member["edition_id"])
            require(edition["sha256"] == member["model_sha256"] and edition["source_ids"] == member["source_ids"],
                    "archive_edition_changed", "The selected original edition differs from the saved cohort.")
            yield member, edition

    def _existing(self, identity):
        try:
            return self._index(identity)
        except TargetError as error:
            if error.code != "OPERATOR_NOT_FOUND":
                raise
            return None

    def _replay(self, cohort, request_id, kind, arguments):
        selected = cohort.get("mutations", {}).get(request_id)
        if selected is None:
            return None
        result = self.store.read(selected)
        require(result.get("request_id") == request_id and result.get("kind") == kind
                and result.get("input_sha256") == digest(arguments),
                "archive_request_reused", "The original saved cohort mutation has different input.")
        return result

    def _commit(self, cohort, request_id, kind, arguments, details):
        previous = self._replay(cohort, request_id, kind, arguments)
        if previous is not None:
            return previous
        result = {"schema": "portfolio.archive-action.v1", "request_id": request_id, "kind": kind,
                  "input_sha256": digest(arguments), "cohort_id": cohort["id"],
                  "cohort_revision": cohort.get("revision", 0) + 1, **details}
        ref = self._put(result)
        cohort.setdefault("mutations", {})[request_id] = ref["sha256"]
        self.store.save("cohorts", cohort, expected_revision=cohort.get("revision", 0))
        return result

    def run(self, request_id, kind, arguments):
        with self.store.locked():
            return self._run_locked(request_id, kind, arguments)

    def _run_locked(self, request_id, kind, arguments):
        """B owns this action; acquire native before A only for missing calculations."""
        checked_id(request_id)
        require(kind in ACTIONS and isinstance(arguments, dict),
                "archive_action", "Select an original archive action and its saved arguments.")
        # Completed requests, publication and receiving use retained source only.
        # Release the initial A lock before taking the process-wide native lock:
        # original intake/export/capture use native -> A in this same process.
        with self.portfolio.store.operation(request_id, kind, arguments) as operation:
            completed = operation.result()
            if completed is not None:
                return completed
            self._check_running()
            if kind != "archive_review" or not self._needs_native(arguments, operation):
                return operation.complete(self._dispatch(request_id, kind, arguments, operation))
        with self.portfolio.native.locked():
            with self.portfolio.store.operation(request_id, kind, arguments) as operation:
                completed = operation.result()
                if completed is not None:
                    return completed
                self._check_running()
                return operation.complete(self._dispatch(request_id, kind, arguments, operation))

    def _dispatch(self, request_id, kind, arguments, operation):
        if kind == "archive_save":
            return self._save(request_id, arguments)
        if kind == "archive_review":
            return self._review(request_id, arguments, operation)
        if kind == "archive_publish":
            return self._publish(request_id, arguments, operation)
        if kind == "archive_query_export":
            return self._query_export(request_id, arguments, operation)
        if kind == "archive_inspect":
            return self._inspect(arguments)
        return self._receive(request_id, arguments, operation)

    def _timephased_limit(self, definition):
        profile = definition["profile"].get("timephased")
        if profile is None:
            return
        assignments = sum(len(edition["model"]["assignments"]) for _, edition in self._selected(definition))
        facts = assignments * len(profile["periods"]) * len(profile["series"])
        require(facts <= MAX_FACTS, "timephased_fact_limit",
                "Keep this complete cohort calculation within two million assignment-period facts.",
                {"facts": facts, "assignments": assignments, "periods": len(profile["periods"]),
                 "series": len(profile["series"])})

    def _needs_native(self, args, operation):
        require(set(args) == {"cohort_id", "expected_revision"}, "archive_review",
                "Review the current saved cohort revision.")
        cohort = self._index(args["cohort_id"])
        if self._replay(cohort, operation.request_id, "archive_review", args) is not None:
            return False
        if args["expected_revision"] != cohort["revision"]:
            raise TargetError("STALE_REVISION", "Reopen the selected cohort before reviewing its reporting projection.")
        if operation.phase("review") is not None:
            return False
        definition = self.store.read(cohort["definition_sha256"])
        if definition["profile"].get("timephased") is None:
            return False
        self._timephased_limit(definition)
        if operation.phase("timephased-inputs") is not None:
            return False
        return any(operation.phase("timephased-" + row["edition_id"]) is None
                   for row in definition["members"])

    def _capture_inputs(self, definition, operation):
        profile = definition["profile"].get("timephased")
        if profile is None:
            return None
        self._timephased_limit(definition)
        retained = operation.phase("timephased-inputs")
        if retained is None:
            retained = {}
            for member, edition in self._selected(definition):
                self._check_running()
                phase = "timephased-" + edition["id"]
                selected = operation.phase(phase)
                if selected is None:
                    selected = capture_timephased(self.portfolio, self.store, edition, profile,
                        operation.path / "timephased" / (edition["id"] + ".jsonl"), stopped=self.stopped)
                    operation.checkpoint(phase, selected)
                retained[edition["id"]] = selected
            operation.checkpoint("timephased-inputs", retained)
        require(isinstance(retained, dict) and set(retained) == {row["edition_id"] for row in definition["members"]},
                "timephased_original_inputs", "Retain one exact native calculation for every selected project edition.")
        return retained

    def _save(self, request_id, args):
        require(set(args) <= {"cohort_id", "expected_revision", "name", "description", "members", "profile"},
                "archive_save", "Save the original cohort fields and expected revision.")
        identity = checked_id(args.get("cohort_id", request_id))
        cohort = self._existing(identity)
        if cohort is not None:
            replay = self._replay(cohort, request_id, "archive_save", args)
            if replay is not None:
                return replay
        else:
            require(identity == request_id, "archive_new_identity", "Create the cohort with its original request identity.")
            cohort = {"schema": "portfolio.archive-cohort.v1", "id": identity, "revision": 0,
                      "created_at": now(), "publications": [], "query_exports": [], "mutations": {}}
        if args.get("expected_revision", 0) != cohort["revision"]:
            raise TargetError("STALE_REVISION", "Reopen the saved cohort before replacing its selected project editions.")
        definition = self._definition({key: args[key] for key in ("name", "description", "members", "profile") if key in args})
        ref = self._put(definition)
        cohort.update(name=definition["name"], description=definition["description"],
                      member_count=len(definition["members"]), definition_sha256=ref["sha256"])
        cohort.pop("review_sha256", None)
        return self._commit(cohort, request_id, "archive_save", args, {"definition_sha256": ref["sha256"]})

    def _emit_projection(self, definition, emit, *, timephased_inputs=None, directory=None, closure=None):
        profile = definition["profile"]
        projection = Projection(profile, emit)
        findings, totals = [], []
        selected_time = profile.get("timephased")
        phase_result = {"captures": [], "totals_count": 0, "totals_preview": []}
        if selected_time is not None:
            self._timephased_limit(definition)
            require(isinstance(timephased_inputs, dict)
                    and set(timephased_inputs) == {row["edition_id"] for row in definition["members"]},
                    "timephased_original_inputs", "Use every exact retained native calculation in this cohort.")
            require(directory is not None, "timephased_scratch", "Select this original action's scratch directory.")
            Path(directory).mkdir(parents=True, exist_ok=True, mode=0o700)
        else:
            require(timephased_inputs is None, "timephased_unselected",
                    "This original reporting profile has no native period calculation.")
        for member, edition in self._selected(definition):
            if closure is not None:
                closure.edition(edition["id"])
            projection.member(member, edition)
            current, _, errors = project_measures(member, edition, profile["metrics"],
                                                  emit=lambda row: emit("measure_contributions", row))
            for row in current:
                emit("measure_totals", row)
            totals.extend(current)
            common = {"project_key": member["project_key"], "edition_id": edition["id"]}
            for finding in errors:
                projection.finding(common, finding, "reporting")
            findings.extend({**common, **row} for row in edition.get("findings", []))
            findings.extend({**common, **row} for row in errors)
            if selected_time is not None:
                original = timephased_inputs[edition["id"]]
                result = project_timephased(member, edition, selected_time, original, self.store, emit,
                                           directory, stopped=self.stopped)
                if closure is not None:
                    closure.operator_file(original["sha256"], original["bytes"])
                phase_result["captures"].append(result["capture"])
                phase_result["totals_count"] += result["totals_count"]
                available = 200 - len(phase_result["totals_preview"])
                phase_result["totals_preview"].extend(result["totals_preview"][:available])
                for finding in result["findings"]:
                    projection.finding(common, finding, "timephased")
                findings.extend({**common, **row} for row in result["findings"])
        findings.extend(projection.relationship_findings)
        coverage = available_fields(edition for _, edition in self._selected(definition))
        selected = {family: set(profile["columns"].get(family, [])) for family in FAMILIES}
        metric_family = "tasks" if profile["metrics"]["grain"] == "leaf_tasks" else profile["metrics"]["grain"]
        selected[metric_family].update(item["field"] for item in profile["metrics"]["measures"])
        if selected_time is not None:
            selected["assignments"].update(item["field"] for item in selected_time["series"])
        for family, fields in coverage.items():
            for info in fields:
                if info["field"] in selected[family] and len(info["definitions"]) > 1:
                    finding = {"code": "archive_definition_variation", "severity": "review",
                               "message": "This selected native field has different definitions in the cohort.",
                               "details": {"family": family, "field": info["field"],
                                           "editions": info["editions"], "definitions": info["definitions"]}}
                    selected_finding = {"id": digest(finding), **finding}
                    findings.append(selected_finding)
                    projection.finding({"project_key": None, "edition_id": None}, selected_finding, "reporting")
        return {"findings": findings, "measure_totals": totals, "field_coverage": coverage,
                **({"timephased": phase_result} if selected_time is not None else {})}

    def _summary(self, definition, *, timephased_inputs=None, directory=None):
        summary = RowSummary(all_headers(definition["profile"]))
        metadata = self._emit_projection(definition, summary.emit, timephased_inputs=timephased_inputs,
                                         directory=directory)
        return {**summary.value(), **metadata}

    def _review(self, request_id, args, operation):
        require(set(args) == {"cohort_id", "expected_revision"}, "archive_review", "Review the current saved cohort revision.")
        cohort = self._index(args["cohort_id"])
        replay = self._replay(cohort, request_id, "archive_review", args)
        if replay is not None:
            return replay
        if args["expected_revision"] != cohort["revision"]:
            raise TargetError("STALE_REVISION", "Reopen the selected cohort before reviewing its reporting projection.")
        selected = operation.phase("review")
        if selected is None:
            definition = self.store.read(cohort["definition_sha256"])
            timephased_inputs = self._capture_inputs(definition, operation)
            review = {"schema": "portfolio.archive-review.v1", "cohort_id": cohort["id"],
                      "cohort_revision": cohort["revision"] + 1, "definition_sha256": cohort["definition_sha256"],
                      "name": definition["name"], "description": definition["description"],
                      "members": definition["members"], "profile": definition["profile"],
                      "projection": TIMEPHASED_PROJECTION if timephased_inputs is not None else "portfolio.archive-projection.v1",
                      "created_at": now(),
                      **({"timephased_inputs": timephased_inputs} if timephased_inputs is not None else {}),
                      **self._summary(definition, timephased_inputs=timephased_inputs, directory=self._stage(request_id))}
            ref = self._put(review)
            selected = operation.checkpoint("review", {"sha256": ref["sha256"]})
        review = self.store.read(selected["sha256"])
        require(review["definition_sha256"] == cohort["definition_sha256"]
                and review["cohort_revision"] == cohort["revision"] + 1,
                "archive_review_changed", "Retain the exact original cohort revision for this review.")
        cohort["review_sha256"] = selected["sha256"]
        return self._commit(cohort, request_id, "archive_review", args, {"review_sha256": selected["sha256"]})

    def _stage(self, request_id):
        path = self.root.parent / (self.root.name + "-operator-deliveries") / "archive-builds" / checked_id(request_id)
        path.mkdir(parents=True, exist_ok=True, mode=0o700)
        return path

    def _retain(self, path, filename, **metadata):
        actual = file_identity(path)
        self.store.retain_file(path, actual["sha256"], actual["bytes"])
        return {**actual, "filename": filename, **metadata}

    def _publish(self, request_id, args, operation):
        require(set(args) == {"cohort_id", "expected_revision", "review_sha256", "reviewer", "note"},
                "archive_publish", "Publish the exact saved review with its named operator and decision.")
        cohort = self._index(args["cohort_id"])
        replay = self._replay(cohort, request_id, "archive_publish", args)
        if replay is not None:
            return replay
        saved = operation.phase("publication")
        if saved is None:
            if args["expected_revision"] != cohort["revision"]:
                raise TargetError("STALE_REVISION", "Reopen the current reviewed archive before publishing it.")
            require(cohort.get("review_sha256") == args["review_sha256"],
                    "archive_review_changed", "Choose the exact saved reporting review.")
            review = self.store.read(checked_id(args["review_sha256"]))
            require(review["cohort_id"] == cohort["id"] and review["definition_sha256"] == cohort["definition_sha256"]
                    and review["cohort_revision"] == cohort["revision"],
                    "archive_review_binding", "The selected review belongs to another cohort revision.")
            require(isinstance(args["reviewer"], str) and args["reviewer"].strip()
                    and isinstance(args["note"], str) and args["note"].strip(),
                    "archive_reviewer", "Record the archive operator and the concrete delivery decision.")
            approval = operation.phase("approval")
            if approval is None:
                approval = operation.checkpoint("approval", {"request_id": request_id, "reviewer": args["reviewer"],
                                                             "note": args["note"], "at": now(),
                                                             "review_sha256": args["review_sha256"]})
            stage, definition = self._stage(request_id), self.store.read(cohort["definition_sha256"])
            sink = Sink(stage / "payload")
            closure = SourceClosure(self.portfolio, self.store, sink)
            writer = RelationalWriter(stage / "derived", definition["profile"])
            try:
                metadata = self._emit_projection(definition, writer.emit,
                    timephased_inputs=review.get("timephased_inputs"), directory=stage / "period-totals", closure=closure)
                dataset = writer.finish(sink)
            finally:
                writer.close()
            totals = metadata["measure_totals"]
            require(dataset["tables"] == review["tables"] and dataset["table_sha256"] == review["table_sha256"]
                    and dataset["columns"] == review["columns"] and totals == review["measure_totals"]
                    and metadata.get("timephased") == review.get("timephased"),
                    "archive_projection_changed", "The current projection differs from the operator's exact saved review.")
            sink.add_bytes("cohort.json", canonical(definition), role="cohort_definition")
            sink.add_bytes("data-dictionary.json", canonical(data_dictionary(definition["profile"], dataset["columns"])), role="data_dictionary")
            sink.add_bytes("power-query.m", power_query(dataset["columns"]).encode("utf-8"), role="power_query")
            sink.add_bytes("azure-sql.sql", azure_sql(dataset["columns"]).encode("utf-8"), role="azure_sql")
            sink.add_bytes("README.md", readme(review).encode("utf-8"), role="operating_guide")
            sink.add_bytes("report.html", html_report(review, approval, dataset["tables"], totals).encode("utf-8"), role="report")
            package = sink.package(review, args["review_sha256"], approval, stage / "portfolio-archive.zip")
            artifacts = []
            for item in sorted(sink.files.values(), key=lambda value: value["path"]):
                if item["role"] in {"relational_database", "table_csv", "data_dictionary", "power_query",
                                    "azure_sql", "operating_guide", "report", "manifest"}:
                    artifacts.append(self._retain(sink.destination(item["path"]), Path(item["path"]).name,
                                                  role=item["role"], package_path=item["path"],
                                                  **{key: item[key] for key in ("table", "rows") if key in item}))
            archive = self._retain(package["path"], "portfolio-archive-" + cohort["id"][:12] + ".zip", role="archive")
            publication = {"schema": "portfolio.archive-publication.v1", "id": request_id,
                           "cohort_id": cohort["id"], "definition_sha256": cohort["definition_sha256"],
                           "review_sha256": args["review_sha256"], "approval": approval,
                           "created_at": approval["at"], "dataset": dataset, "source_closure": closure.summary(),
                           "manifest_sha256": package["manifest_sha256"], "file_count": package["file_count"],
                           "artifacts": artifacts, "archive": archive}
            ref = self._put(publication)
            saved = operation.checkpoint("publication", {"sha256": ref["sha256"], "id": request_id})
        publication = self.store.read(saved["sha256"])
        cohort.setdefault("publications", []).append({"id": request_id, "sha256": saved["sha256"], "created_at": publication["created_at"]})
        if cohort["definition_sha256"] == publication["definition_sha256"]:
            cohort["latest_publication"] = request_id
        result = self._commit(cohort, request_id, "archive_publish", args,
                              {"publication_id": request_id, "publication_sha256": saved["sha256"],
                               "archive": publication["archive"], "artifacts": publication["artifacts"]})
        # Exact completed artifact objects are retained in the original workspace;
        # their disposable hardlinked construction tree is no longer needed.
        shutil.rmtree(self._stage(request_id), ignore_errors=True)
        return result

    def publication(self, cohort_id, publication_id):
        cohort = self._index(cohort_id)
        selected = [item for item in cohort.get("publications", []) if item["id"] == checked_id(publication_id)]
        require(len(selected) == 1, "archive_publication", "Select one retained publication from this original cohort.")
        publication = self.store.read(selected[0]["sha256"])
        require(publication["id"] == publication_id, "archive_publication_identity", "The original publication identity changed.")
        return publication

    def _artifact_path(self, artifact):
        path = self.store.root / "objects" / checked_id(artifact["sha256"])
        before = path.stat()
        identity = (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns)
        if self._verified.get(artifact["sha256"]) != identity:
            require(file_identity(path) == {"sha256": artifact["sha256"], "bytes": artifact["bytes"]},
                    "archive_artifact_changed", "A retained complete reporting artifact changed.")
            self._verified[artifact["sha256"]] = identity
        return path

    def _database(self, publication):
        selected = [item for item in publication["artifacts"] if item["role"] == "relational_database"]
        require(len(selected) == 1, "archive_database", "Retain the one original reporting database.")
        return self._artifact_path(selected[0])

    def table(self, cohort_id, publication_id, table, *, offset=0, limit=50, filter_column=None, filter_text=""):
        publication = self.publication(cohort_id, publication_id)
        headers, counts = publication["dataset"]["columns"], publication["dataset"]["tables"]
        require(table in headers and type(offset) is int and offset >= 0 and type(limit) is int and 1 <= limit <= 250,
                "archive_table_page", "Select an original table and a page of 1 to 250 rows.")
        require(filter_column is None or filter_column in headers[table],
                "archive_table_filter", "Filter a column from this exact original table.")
        require(isinstance(filter_text, str) and len(filter_text) <= 2000,
                "archive_filter_text", "Use a text filter up to 2,000 characters.")
        where = "" if filter_column is None or not filter_text else " WHERE instr(" + quoted(filter_column) + ", ?) > 0"
        params = [] if not where else [filter_text]
        sql = "SELECT * FROM " + quoted(table) + where + " ORDER BY rowid LIMIT ? OFFSET ?"
        result = query_page(self._database(publication), headers, sql, params + [str(limit + 1), str(offset)],
                            limit=limit, stopped=self.stopped)
        return {**result, "table": table, "offset": offset, "unfiltered_rows": counts[table],
                "next_offset": offset + len(result["rows"]) if result["has_more"] else None}

    def query(self, cohort_id, publication_id, sql, parameters=None, *, limit=100):
        publication = self.publication(cohort_id, publication_id)
        return query_page(self._database(publication), publication["dataset"]["columns"], sql, parameters,
                          limit=limit, stopped=self.stopped)

    def _query_export(self, request_id, args, operation):
        require(set(args) == {"cohort_id", "publication_id", "sql", "parameters"},
                "archive_query_export", "Save the selected publication, complete SQL and exact text parameters.")
        cohort = self._index(args["cohort_id"])
        replay = self._replay(cohort, request_id, "archive_query_export", args)
        if replay is not None:
            return replay
        saved = operation.phase("query_export")
        if saved is None:
            publication = self.publication(cohort["id"], args["publication_id"])
            result = export_query(self._database(publication), publication["dataset"]["columns"],
                                  args["sql"], args["parameters"], self._stage(request_id) / "query.csv", stopped=self.stopped)
            artifact = self._retain(result["path"], "portfolio-query-" + request_id[:12] + ".csv", role="query_csv")
            value = {"schema": "portfolio.archive-query.v1", "id": request_id, "cohort_id": cohort["id"],
                     "publication_id": publication["id"], "database_sha256": next(
                         item["sha256"] for item in publication["artifacts"] if item["role"] == "relational_database"),
                     "sql": args["sql"], "parameters": args["parameters"], "rows": result["rows"],
                     "columns": result["columns"], "created_at": now(), "artifact": artifact}
            ref = self._put(value)
            saved = operation.checkpoint("query_export", {"sha256": ref["sha256"]})
        value = self.store.read(saved["sha256"])
        cohort.setdefault("query_exports", []).append({"id": request_id, "sha256": saved["sha256"], "created_at": value["created_at"]})
        result = self._commit(cohort, request_id, "archive_query_export", args,
                              {"query_sha256": saved["sha256"], "artifact": value["artifact"], "rows": value["rows"]})
        shutil.rmtree(self._stage(request_id), ignore_errors=True)
        return result

    def _inspect(self, args):
        require(set(args) == {"source"}, "archive_inspect", "Inspect the original complete uploaded archive.")
        source = self.store.selected_upload(args["source"])
        with ReceivedPackage(source) as received:
            manifest = received.manifest
            return {"schema": "portfolio.archive-inspection.v1", "source": args["source"],
                    "archive": received.identity, "manifest_sha256": received.manifest_sha256,
                    "review_sha256": manifest["review_sha256"], "review": manifest["review"],
                    "approval": manifest["approval"], "file_count": len(manifest["files"]) + 1}

    def _check_database(self, path, review):
        require(review["columns"] == all_headers(review["profile"]), "archive_database_profile",
                "The original database columns differ from the selected reporting profile.")
        summary = RowSummary(review["columns"])
        connection = sqlite3.connect(Path(path).resolve().as_uri() + "?mode=ro&immutable=1", uri=True)
        try:
            require(connection.execute("PRAGMA integrity_check").fetchall() == [("ok",)],
                    "archive_database_integrity", "The received original reporting database failed its integrity check.")
            tables = connection.execute("SELECT name,type FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").fetchall()
            require({name for name, kind in tables if kind == "table"} == set(review["columns"])
                    and all(kind in {"table", "index"} for _, kind in tables),
                    "archive_database_schema", "The archive database has different report tables or executable schema.")
            for table, columns in review["columns"].items():
                actual = connection.execute("PRAGMA table_info(" + quoted(table) + ")").fetchall()
                require([item[1] for item in actual] == columns and all(item[2].upper() == "TEXT" for item in actual),
                        "archive_database_columns", "The original report column schema changed.", table)
                require(connection.execute("SELECT count(*) FROM " + quoted(table)).fetchone()[0] == review["tables"][table],
                        "archive_database_rows", "The original report table row count changed.", table)
                cursor = connection.execute("SELECT * FROM " + quoted(table) + " ORDER BY rowid")
                for row in cursor:
                    summary.emit(table, dict(zip(columns, row)))
            require(summary.value()["table_sha256"] == review["table_sha256"], "archive_database_projection",
                    "The received complete relational rows differ from the exact reviewed projection.")
        finally:
            connection.close()

    def _receive(self, request_id, args, operation):
        require(set(args) == {"source", "manifest_sha256", "reviewer", "note"},
                "archive_receive", "Receive the exact inspected archive with its reviewing operator and note.")
        current = self._existing(request_id)
        if current is not None:
            replay = self._replay(current, request_id, "archive_receive", args)
            if replay is not None:
                return replay
        require(isinstance(args["reviewer"], str) and args["reviewer"].strip()
                and isinstance(args["note"], str) and args["note"].strip(),
                "archive_receiving_operator", "Name the receiving operator and the original delivery decision.")
        source = self.store.selected_upload(args["source"])
        stage = self._stage(request_id)
        with ReceivedPackage(source) as received:
            manifest, review = received.manifest, received.manifest["review"]
            require(received.manifest_sha256 == checked_id(args["manifest_sha256"]),
                    "archive_receiving_review", "Receive the original exact inspected manifest.")
            database_member = [item for item in manifest["files"] if item.get("role") == "relational_database"]
            require(len(database_member) == 1, "archive_database", "Receive the one original reporting database.")
            database_path = received.materialize(database_member[0]["path"], stage / "portfolio.sqlite")
            self._check_database(database_path, review)
            restored = restore_sources(self.portfolio, self.store, manifest, received.bytes,
                                       lambda name: received.staged_member(name, stage / "source-objects" / name))
            requested = {"name": review["name"], "description": review["description"],
                         "members": [{key: member[key] for key in ("project_key", "label", "edition_id", "currency") if key in member}
                                     for member in review["members"]], "profile": review["profile"]}
            definition = self._definition(requested)
            require(definition["members"] == review["members"] and definition["profile"] == review["profile"],
                    "archive_received_definition", "The received original projects or reporting definitions differ.")
            definition_ref = self._put(definition)
            require(definition_ref["sha256"] == review["definition_sha256"],
                    "archive_received_definition_hash", "The restored source cohort differs from its original reviewed definition.")
            recalculated = self._summary(definition, timephased_inputs=review.get("timephased_inputs"),
                                           directory=stage / "period-totals")
            require(all(recalculated[key] == review[key] for key in
                        ("tables", "table_sha256", "columns", "measure_totals"))
                    and recalculated.get("timephased") == review.get("timephased"),
                    "archive_received_source_projection", "The reporting database differs from the complete restored native source projection.")
            self._put(review)
            artifacts = []
            for item in manifest["files"]:
                if item["role"] in {"relational_database", "table_csv", "data_dictionary", "power_query",
                                    "azure_sql", "operating_guide", "report"}:
                    path = received.materialize(item["path"], stage / "artifacts" / item["path"])
                    artifacts.append(self._retain(path, Path(item["path"]).name, role=item["role"], package_path=item["path"],
                                                  **{key: item[key] for key in ("table", "rows") if key in item}))
            manifest_ref = self.store.put_bytes(canonical(manifest))
            artifacts.append({**manifest_ref, "filename": "manifest.json", "role": "manifest", "package_path": "manifest.json"})
            archive_ref = self._retain(source, "portfolio-archive-" + request_id[:12] + ".zip", role="archive")
            original_id = checked_id(manifest["approval"]["request_id"])
            saved_at = operation.phase("received_at") or operation.checkpoint("received_at", {"at": now()})
            publication = {"schema": "portfolio.archive-publication.v1", "id": original_id,
                           "cohort_id": request_id, "source_cohort_id": review["cohort_id"],
                           "definition_sha256": definition_ref["sha256"], "review_sha256": manifest["review_sha256"],
                           "approval": manifest["approval"], "created_at": manifest["approval"]["at"],
                           "dataset": {key: review[key] for key in ("tables", "table_sha256", "columns")},
                           "source_closure": restored, "manifest_sha256": received.manifest_sha256,
                           "file_count": len(manifest["files"]) + 1, "artifacts": artifacts, "archive": archive_ref,
                           "receiving": {"request_id": request_id, "reviewer": args["reviewer"], "note": args["note"], "at": saved_at["at"]}}
            publication_ref = self._put(publication)
        cohort = {"schema": "portfolio.archive-cohort.v1", "id": request_id, "revision": 0, "created_at": saved_at["at"],
                  "name": definition["name"], "description": definition["description"], "member_count": len(definition["members"]),
                  "definition_sha256": definition_ref["sha256"], "mutations": {}, "query_exports": [],
                  "latest_publication": original_id,
                  "publications": [{"id": original_id, "sha256": publication_ref["sha256"], "created_at": publication["created_at"]}],
                  "received_from": {"cohort_id": review["cohort_id"], "archive_sha256": archive_ref["sha256"],
                                    "manifest_sha256": args["manifest_sha256"]}}
        result = self._commit(cohort, request_id, "archive_receive", args,
                              {"publication_id": original_id, "publication_sha256": publication_ref["sha256"],
                               "restored": restored, "archive": archive_ref})
        shutil.rmtree(stage, ignore_errors=True)
        return result
