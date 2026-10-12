"""Original native schedule editions, corrections, delivery and cold receiving."""
from __future__ import annotations

from collections import Counter
from contextlib import contextmanager
import hashlib
import json
from pathlib import Path
import tempfile

from . import companions as companion_source
from .comparison import compare_models, target_findings
from .native import NativeMPXJ, FAMILY_TYPES, IDENTITY_FIELDS, input_profile, output_profile
from .storage import (PortfolioError, Store, canonical, checked_id, checked_request, digest,
                      file_identity, file_lock, now, require)

DECISION_ACTIONS = {"retain_source", "mapped", "accept_target_behavior", "exclude_from_target", "resolve"}
EDITION_SCHEMA = "project-portfolio-edition.v1"


class PortfolioWorkspace:
    def __init__(self, root, native=None):
        self.store = Store(root)
        self.root = self.store.root
        self.native = native if native is not None else NativeMPXJ()

    def _record(self, table, value):
        """Immutable content identity excludes only the record creation timestamp."""
        content = {k: v for k, v in value.items() if k not in {"id", "created_at"}}
        record_id = digest(content)
        try:
            existing = self.store.record(table, record_id)
        except PortfolioError as error:
            if error.code != "record_missing":
                raise
        else:
            require({k: v for k, v in existing.items() if k not in {"id", "created_at"}} == content,
                    "record_identity", "The selected original record has changed.", record_id)
            return existing
        return self.store.put_record(table, {"id": record_id, **content, "created_at": now()})

    def _edition(self, model, *, kind, sources, recipe, label, parent_id=None, review_id=None):
        source_ids = list(dict.fromkeys(row["sha256"] for row in sources))
        retained = self.store.put_json(model)
        value = {"schema": EDITION_SCHEMA, "kind": kind, "sha256": retained["sha256"],
                 "model_bytes": retained["bytes"], "source_ids": source_ids, "sources": sources,
                 "recipe": recipe, "label": label, "parent_id": parent_id, "review_id": review_id,
                 "findings": model.get("findings", []), "counts": model.get("counts", {})}
        return self._record("editions", value)

    def read_edition(self, edition_id):
        record = self.store.record("editions", edition_id)
        require(record["schema"] == EDITION_SCHEMA, "edition_schema", "Open the selected edition with its original application version.")
        model = self.store.object_json(record["sha256"])
        return {**record, "model": model,
                "companion_captures": companion_source.capture_selections(model.get("companions", []))}

    def list_editions(self, cursor="", limit=25):
        return self.store.records("editions", cursor=cursor, limit=limit)

    def _input_sources(self, operation, source_path, label, selected, companions):
        prior = operation.phase("sources")
        if prior is not None:
            for row in prior["sources"]:
                require(file_identity(self.store.object_path(row["sha256"])) ==
                        {"sha256": row["sha256"], "bytes": row["bytes"]},
                        "retained_source_changed", "An original selected source artifact changed.", row["sha256"])
            return prior
        source = self.store.put_file(source_path)
        originals = [{"kind": "project", "label": label, "filename": Path(source_path).name,
                      "input_profile": selected, **source}]
        captured = []
        for entry in companions:
            retained = self.store.put_file(entry["path"])
            item = {"kind": "companion", "label": entry["label"], "filename": Path(entry["path"]).name,
                    "companion_profile": {k: v for k, v in entry.items() if k != "path"}, **retained}
            originals.append(item)
            raw = self.store.object_path(retained["sha256"]).read_bytes()
            capture = companion_source.capture(raw, entry, retained["sha256"])
            captured.append(capture)
        return operation.checkpoint("sources", {"sources": originals, "companions": captured})

    def intake(self, request_id, source_path, *, label, profile=None, companions=None):
        checked_request(request_id)
        require(isinstance(label, str) and label.strip(), "source_label", "Name the original project edition.")
        source_path = str(Path(source_path).absolute())
        selected = input_profile(profile)
        companions = [companion_source.descriptor(value) for value in (companions or [])]
        payload = {"path": source_path, "label": label, "profile": selected, "companions": companions}
        with self.native.locked(), self.store.operation(request_id, "intake", payload) as operation:
            result = operation.result()
            if result is not None:
                return self.read_edition(result["edition_id"])
            selected_sources = self._input_sources(operation, source_path, label, selected, companions)
            original = selected_sources["sources"][0]
            project, resolved = self.native.read(self.store.object_path(original["sha256"]), selected)
            model = self.native.capture(project, {"kind": "original-file", "source_id": original["sha256"],
                                                 "filename": original["filename"], "input_profile": resolved})
            model["companions"] = selected_sources["companions"]
            model["findings"].extend(f for item in model["companions"] for f in item["findings"])
            edition = self._edition(model, kind="source", sources=selected_sources["sources"],
                                    recipe={"kind": "file", "source_id": original["sha256"], "profile": resolved},
                                    label=label)
            operation.complete({"request_id": request_id, "edition_id": edition["id"]})
            return self.read_edition(edition["id"])

    def _project(self, edition):
        recipe = edition["recipe"]
        if recipe["kind"] == "file":
            return self.native.read(self.store.object_path(recipe["source_id"]), recipe["profile"])[0]
        require(recipe["kind"] == "correction", "edition_recipe", "Open the original retained source recipe.")
        original = self.read_edition(edition["parent_id"])
        project = self._project(original)
        return self.native.apply_corrections(project, recipe["corrections"])

    @contextmanager
    def native_project(self, edition_id):
        """Reopen this immutable edition's original native file/correction recipe.

        The caller receives the maintained MPXJ object only while its original
        processwide native lock is held. This read leaves the saved model and
        edition identities unchanged.
        """
        with self.native.locked():
            edition = self.read_edition(checked_id(edition_id))
            yield self._project(edition)

    def review(self, edition_id, *, target_profile, mappings=None, decisions=None, corrections=None):
        edition = self.read_edition(edition_id)
        mappings = {} if mappings is None else mappings
        decisions = {} if decisions is None else decisions
        corrections = [] if corrections is None else corrections
        require(isinstance(mappings, dict) and isinstance(decisions, dict) and isinstance(corrections, list),
                "review_shape", "Supply the selected mappings, finding decisions and native corrections.")
        compiled = companion_source.compile_mappings(edition["model"], edition["model"].get("companions", []),
                                                    mappings.get("companions", []))
        combined = compiled["corrections"] + corrections
        seen = set()
        for correction in combined:
            require(isinstance(correction, dict) and set(correction) == {"family", "key", "field", "before", "after"},
                    "correction_shape", "Supply the full native correction and its original typed preimage.")
            family, key, field = correction["family"], correction["key"], correction["field"]
            require(family in FAMILY_TYPES and isinstance(field, str) and field not in IDENTITY_FIELDS,
                    "correction_identity", "Keep original identities and review a supported native field.")
            native_rows = [edition["model"]["project"]] if family == "project" else edition["model"][family]
            matching = [row for row in native_rows if row["key"] == key]
            require(len(matching) == 1 and matching[0]["fields"].get(field) == correction["before"],
                    "correction_preimage", "This correction must match its exact original native field.", correction)
            require(field in edition["model"]["field_catalogue"].get(family, {}),
                    "correction_field", "Choose a declared native field from this edition.", correction)
            target = (family, key, field)
            require(target not in seen, "duplicate_correction", "Resolve two corrections targeting the same native field.", target)
            seen.add(target)
        findings = list(edition["findings"]) + target_findings(edition["model"], target_profile)
        findings += [{**row, "requires_decision": True} for row in compiled["findings"]]
        by_id = {row["id"]: row for row in findings}
        require(set(decisions) <= set(by_id), "review_decision", "Decide only findings from this original source/target review.")
        for finding_id, decision in decisions.items():
            require(isinstance(decision, dict) and decision.get("action") in DECISION_ACTIONS
                    and isinstance(decision.get("note"), str) and decision["note"].strip(),
                    "review_decision", "Keep a named handling decision and its concrete explanation.", finding_id)
            by_id[finding_id] = {**by_id[finding_id], "decision": decision}
        unresolved = [row["id"] for row in by_id.values() if row.get("requires_decision") and row["id"] not in decisions]
        value = {"schema": "project-portfolio-review.v1", "edition_id": edition_id,
                 "target_profile": target_profile, "mappings": mappings, "decisions": decisions,
                 "corrections": combined, "companion_links": compiled["links"],
                 "findings": list(by_id.values()), "unresolved": unresolved, "ready": not unresolved}
        with file_lock(self.store.directory / "workspace.lock"):
            return self._record("reviews", value)

    def read_review(self, review_id):
        return self.store.record("reviews", review_id)

    def _compare(self, left_id, right_id, *, identity_map=None, strict_identity=False):
        left, right = self.read_edition(left_id), self.read_edition(right_id)
        comparison = compare_models(left["model"], right["model"], identity_map=identity_map,
                                    strict_identity=strict_identity)
        return self._record("comparisons", {"left_id": left_id, "right_id": right_id, **comparison})

    def compare(self, left_id, right_id, *, identity_map=None, strict_identity=False):
        with file_lock(self.store.directory / "workspace.lock"):
            return self._compare(left_id, right_id, identity_map=identity_map, strict_identity=strict_identity)

    def apply_review(self, request_id, review_id):
        review = self.read_review(review_id)
        require(review["ready"], "review_incomplete", "Complete the selected target handling decisions.", review["unresolved"])
        with self.native.locked(), self.store.operation(request_id, "apply-review", {"review_id": review_id}) as operation:
            result = operation.result()
            if result is not None:
                return {**result, "edition": self.read_edition(result["edition_id"])}
            original = self.read_edition(review["edition_id"])
            checkpoint = operation.phase("edition")
            if checkpoint is None:
                project = self._project(original)
                project = self.native.apply_corrections(project, review["corrections"])
                model = self.native.capture(project, {"kind": "reviewed-native-correction", "review_id": review_id,
                                                     "parent_id": original["id"], "source_ids": original["source_ids"]})
                model["companions"] = original["model"].get("companions", [])
                model["companion_links"] = review["companion_links"]
                model["target_review"] = {"review_id": review_id, "target_profile": review["target_profile"],
                                          "mappings": review["mappings"], "decisions": review["decisions"]}
                edition = self._edition(model, kind="corrected", sources=original["sources"],
                                        recipe={"kind": "correction", "corrections": review["corrections"]},
                                        label=original["label"] + " — reviewed correction",
                                        parent_id=original["id"], review_id=review_id)
                checkpoint = operation.checkpoint("edition", {"edition_id": edition["id"]})
            comparison = self._compare(original["id"], checkpoint["edition_id"])
            result = operation.complete({"request_id": request_id, "review_id": review_id,
                                         "edition_id": checkpoint["edition_id"], "comparison_id": comparison["id"]})
            return {**result, "edition": self.read_edition(result["edition_id"])}

    def export_mspdi(self, request_id, edition_id, *, profile=None):
        selected = output_profile(profile)
        with self.native.locked(), self.store.operation(
                request_id, "export-mspdi", {"edition_id": edition_id, "profile": selected}) as operation:
            complete = operation.result()
            if complete is not None:
                return {**complete, "path": str(self.store.object_path(complete["source_id"]))}
            edition = self.read_edition(edition_id)
            output = operation.phase("native-output")
            if output is None:
                project = self._project(edition)
                destination = operation.path / ".pending-native-output.xml"
                try:
                    self.native.write_mspdi(project, destination, selected)
                    artifact = self.store.put_file(destination)
                    output = operation.checkpoint("native-output", {"source_id": artifact["sha256"], **artifact,
                                                                   "profile": selected})
                finally:
                    destination.unlink(missing_ok=True)
            readback = operation.phase("native-readback")
            if readback is None:
                actual_path = self.store.object_path(output["source_id"])
                project, read_profile = self.native.read(actual_path, {"format": "mspdi", "ignore_errors": False,
                                                                     "microsoft_compatible": selected["microsoft_compatible"]})
                model = self.native.capture(project, {"kind": "native-mspdi-readback", "source_id": output["source_id"],
                                                     "exported_edition_id": edition_id, "output_profile": selected,
                                                     "input_profile": read_profile})
                model["companions"] = edition["model"].get("companions", [])
                model["companion_links"] = edition["model"].get("companion_links", [])
                sources = edition["sources"] + [{"kind": "native-output", "label": edition["label"] + " MSPDI",
                                                 "filename": "project.xml", "sha256": output["sha256"],
                                                 "bytes": output["bytes"], "input_profile": read_profile}]
                native_edition = self._edition(model, kind="native-readback", sources=sources,
                                               recipe={"kind": "file", "source_id": output["source_id"], "profile": read_profile},
                                               label=edition["label"] + " — native MSPDI readback", parent_id=edition_id,
                                               review_id=edition.get("review_id"))
                readback = operation.checkpoint("native-readback", {"edition_id": native_edition["id"]})
            comparison = self._compare(edition_id, readback["edition_id"])
            record = self._record("exports", {"schema": "project-portfolio-native-export.v1",
                                              "request_id": request_id, "edition_id": edition_id,
                                              "source_id": output["source_id"], "sha256": output["sha256"],
                                              "bytes": output["bytes"], "profile": selected,
                                              "native_readback_edition_id": readback["edition_id"],
                                              "comparison_id": comparison["id"]})
            result = operation.complete(record)
            return {**result, "path": str(self.store.object_path(result["source_id"]))}

    def capture_native(self, request_id, project_file, *, provenance):
        require(isinstance(provenance, dict) and provenance, "native_provenance",
                "Keep the exact native target identity and selected reader provenance.")
        # The caller may already hold this same processwide reentrant native lock.
        with self.native.locked(), self.store.operation(request_id, "capture-native", {"provenance": provenance}) as operation:
            complete = operation.result()
            if complete is not None:
                return self.read_edition(complete["edition_id"])
            captured = operation.phase("captured-model")
            if captured is None:
                model = self.native.capture(project_file, provenance)
                model["companions"] = []
                artifact = self.store.put_json(model)
                captured = operation.checkpoint("captured-model", artifact)
            model = self.store.object_json(captured["sha256"])
            output = operation.phase("native-output")
            if output is None:
                current_model = self.native.capture(project_file, provenance)
                current_model["companions"] = []
                unchanged = compare_models(model, current_model)["summary"]
                require(not any(unchanged[name] for name in ("added", "removed", "changed_fields",
                                                                    "definition_changes", "companion_changes")),
                        "native_capture_changed",
                        "The native project changed before its original capture finished; retain this request and capture the new edition separately.",
                        unchanged)
                destination = operation.path / ".pending-native-capture.xml"
                try:
                    selected = self.native.write_mspdi(project_file, destination)
                    artifact = self.store.put_file(destination)
                    output = operation.checkpoint("native-output", {"source_id": artifact["sha256"], **artifact,
                                                                   "profile": selected})
                finally:
                    destination.unlink(missing_ok=True)
            reopened, selected = self.native.read(self.store.object_path(output["source_id"]), {"format": "mspdi"})
            reopen_model = self.native.capture(reopened, {"kind": "native-capture-reopen", "source_id": output["source_id"]})
            reopen_model["companions"] = []
            reopen_difference = compare_models(model, reopen_model)
            retained_difference = self.store.put_json(reopen_difference)
            model["native_reopen"] = {"source_id": output["source_id"], "profile": selected,
                                      "comparison_sha256": retained_difference["sha256"],
                                      "summary": reopen_difference["summary"]}
            source = {"kind": "native-capture", "filename": "native-capture.xml",
                      "label": str(provenance.get("label", provenance.get("project_id", "Native target project"))),
                      "input_profile": selected, "sha256": output["sha256"], "bytes": output["bytes"]}
            edition = self._edition(model, kind="native-capture", sources=[source],
                                    recipe={"kind": "file", "source_id": source["sha256"], "profile": selected},
                                    label=source["label"])
            operation.complete({"request_id": request_id, "edition_id": edition["id"]})
            return self.read_edition(edition["id"])

    def export_workspace(self, path):
        return self.store.export_workspace(path)

    @classmethod
    def receive_workspace(cls, archive_path, destination):
        receipt = Store.receive_workspace(archive_path, destination)
        reopened = cls(destination)
        return {**receipt, "editions": reopened.list_editions(limit=1)["total"]}

    def status(self, request_id):
        return self.store.operation_status(request_id)
