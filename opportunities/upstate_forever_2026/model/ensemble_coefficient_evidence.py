"""Carry explicitly selected coefficient sources with existing ensemble reports.

Native run selections and the original evidence/range registries own all values.
This adapter reads their saved lineage, retains originals and uses the ordinary
coefficient report blocks. It never materializes a profile or executes a model.
"""
from __future__ import annotations

from copy import deepcopy
import csv
import io
from pathlib import Path

from .common import (atomic_json, canonical, describe_file, digest, file_digest,
                     identifier, relative_file, selected_models)
from . import biophysical_evidence as evidence
from . import client_biophysical_evidence as reports

SCHEMA = "upstate.ensemble-coefficient-evidence/v1"
MANIFEST = reports.PREFIX + "/ensemble-coefficient-evidence.json"
CELLS = reports.PREFIX + "/member-coefficient-applicability.csv"
METHODS = {
    "lineage": "Selected evidence retains its original profile and source identity. "
               "It is compared only with that actual profile or its explicitly saved parent/derivation lineage.",
    "cells": "A documented cell supports an inherited input only when its land-cover code, "
             "parameter, numeric value, units and nutrient load_type all match. Changed or "
             "unattributed cells remain explicit. Matching values alone do not establish lineage.",
    "ranges": "A member is an exact saved central/lower/upper endpoint only when its profile ID "
              "equals that saved endpoint. Other members retain the cited range as reference "
              "context; no endpoint role or confidence interval is inferred.",
    "coverage": "Counts describe coefficient cells for each actual profile and each separate "
                "evidence edition. They are not added across sources, geographic coverage, "
                "native model validation or a probability distribution.",
}


def _ancestors(get_profile, profile_id, parent_id):
    """Follow only retained native parent/derivation IDs, never value similarity."""
    found = set()
    def walk(key, trail):
        key = identifier(key)
        if key in trail:
            raise ValueError("The original coefficient profile ancestry contains a cycle")
        value = get_profile(key)
        if key != profile_id:
            found.add(key)
        source = value.get("experiment_derivation") or {}
        base = source.get("base_profile_id")
        if base:
            walk(base, trail | {key})
    walk(profile_id, set())
    if parent_id and parent_id != profile_id:
        walk(parent_id, {profile_id})
    return sorted(found)


def context(workspace, ensemble_id, *, run_ids=None):
    plan = workspace._get("ensembles", identifier(ensemble_id))
    wanted = None if run_ids is None else set(reports._ids(list(run_ids), "Original candidate runs"))
    found, members = set(), []
    for member in plan["members"]:
        runs = [item["run_id"] for item in member["runs"]
                if wanted is None or item["run_id"] in wanted]
        if not runs:
            continue
        for key in runs:
            run = workspace.inspect_run(key)
            if (run["selection"]["profile_id"] != member["profile_id"]
                    or run["selection"]["grid_id"] != plan["grid_id"]):
                raise ValueError("Coefficient lineage differs from the original native member")
        found.update(runs)
        members.append({"label": member["label"], "profile_id": member["profile_id"],
                        "parent_profile_id": member.get("parent_profile_id"),
                        "ancestor_profile_ids": _ancestors(
                            lambda key: workspace._get("profiles", key),
                            member["profile_id"], member.get("parent_profile_id")),
                        "run_ids": sorted(runs)})
    if not members or (wanted is not None and found != wanted):
        raise ValueError("Select original runs from this saved ensemble for coefficient sources")
    body = {"ensemble_id": plan["id"], "ensemble_sha256": digest(plan),
            "members": members, "selected_run_ids": sorted(found),
            "profile_ids": sorted({row["profile_id"] for row in members}),
            "reference_profile_ids": sorted({key for row in members for key in
                [row["profile_id"], *row["ancestor_profile_ids"]]})}
    return body


def consumer_context(workspace, consumer_id):
    from . import ensemble_consumers
    plan = workspace._get(ensemble_consumers.KIND, identifier(consumer_id))
    if plan["mode"] != "calibration":
        raise ValueError("Select a saved calibration for its candidate coefficient sources")
    basis = workspace._get("calibration-plans", plan["calibration_plan_id"])
    result = context(workspace, plan["ensemble_id"],
                     run_ids=[row["run_id"] for row in basis["candidates"]])
    result["consumer_id"] = plan["id"]
    result["calibration_plan_id"] = basis["id"]
    for row in basis["candidates"]:
        if workspace.inspect_run(row["run_id"])["selection"] != row["selection"]:
            raise ValueError("An original calibration candidate changed its native selection")
    return result


def _profile_context(workspace, lineage):
    return {key: evidence.catalog(workspace, key) for key in lineage["profile_ids"]}


def _applicability(contexts, lineage, records):
    summaries, cells = [], []
    for key in lineage["profile_ids"]:
        native = contexts[key]
        members = [row for row in lineage["members"] if row["profile_id"] == key]
        parents = {row["parent_profile_id"] for row in members if row.get("parent_profile_id")}
        ancestors = {item for row in members for item in row["ancestor_profile_ids"]}
        for record in records:
            relationship = ("original-profile" if record["profile_id"] == key else
                            "saved-parent" if record["profile_id"] in parents else
                            "saved-ancestor" if record["profile_id"] in ancestors else "outside-lineage")
            original = {(row["lucode"], row["parameter"]): row for row in record["cells"]}
            counts = {"supported": 0, "undocumented": 0, "changed": 0,
                      "absent": 0, "outside-lineage": 0}
            for actual in native["cells"]:
                source = original.get((actual["lucode"], actual["parameter"]))
                if relationship == "outside-lineage":
                    status = "outside-lineage"
                elif source is None:
                    status = "absent"
                elif any(actual.get(field) != source.get(field)
                         for field in ("value", "units", "load_type")):
                    status = "changed"
                elif source["source_status"] != "documented":
                    status = "undocumented"
                else:
                    status = "supported"
                counts[status] += 1
                cells.append({
                    "profile_id": key, "profile_title": native["profile"]["title"],
                    "member_labels": "; ".join(row["label"] for row in members),
                    "evidence_id": record["id"], "evidence_profile_id": record["profile_id"],
                    "relationship": relationship, "lucode": actual["lucode"],
                    "parameter": actual["parameter"], "actual_value": actual["table_value_text"],
                    "evidence_value": source["table_value_text"] if source else "",
                    "units": actual["units"], "load_type": actual.get("load_type") or "",
                    "evidence_load_type": (source.get("load_type") or "") if source else "",
                    "status": status,
                })
            summaries.append({"profile_id": key, "profile_title": native["profile"]["title"],
                "member_labels": [row["label"] for row in members],
                "evidence_id": record["id"], "evidence_profile_id": record["profile_id"],
                "relationship": relationship, "table_sha256": native["table"]["sha256"],
                "evidence_table_sha256": record["table"]["sha256"],
                "total": len(native["cells"]), **counts})
    return summaries, cells


def catalog(workspace, lineage):
    result = reports.catalog(workspace, lineage["reference_profile_ids"])
    contexts = _profile_context(workspace, lineage)
    for row in result["evidence"]:
        record = evidence.inspect_evidence(workspace, row["id"])
        row["member_coverage"] = _applicability(contexts, lineage, [record])[0]
    for row in result["ranges"]:
        row["actual_matches"] = [match for match in row["matched_profiles"]
                                 if match["profile_id"] in lineage["profile_ids"]]
        row["reference_only_matches"] = [match for match in row["matched_profiles"]
                                         if match["profile_id"] not in lineage["profile_ids"]]
    return {**result, "schema": SCHEMA + "/catalog", "context": lineage, "methods": METHODS}


def bind(workspace, requested, lineage):
    """Called before the producer operation key; omitted selection stays compatible."""
    if requested is None:
        return None
    original = reports.bind(workspace, {"coefficient_evidence": requested},
                            lineage["reference_profile_ids"])
    records = [evidence.inspect_evidence(workspace, row["id"]) for row in original["evidence"]]
    applicability, unused_cells = _applicability(_profile_context(workspace, lineage), lineage, records)
    body = {"schema": SCHEMA, "workspace_id": workspace.project["id"],
            "context": deepcopy(lineage), "reference_binding": original,
            "applicability": applicability, "methods": METHODS,
            "implementation_sha256": file_digest(Path(__file__))}
    return {**body, "sha256": digest(body)}


def _identity(binding):
    if (not isinstance(binding, dict) or binding.get("schema") != SCHEMA
            or digest({k: v for k, v in binding.items() if k != "sha256"}) != binding.get("sha256")):
        raise ValueError("The selected ensemble coefficient binding changed")
    original = binding["reference_binding"]
    if (original.get("schema") != reports.VERSION
            or digest({k: v for k, v in original.items() if k != "sha256"}) != original.get("sha256")
            or original["workspace_id"] != binding["workspace_id"]):
        raise ValueError("The original coefficient report binding changed")
    return original


def current(workspace, binding):
    if binding is None:
        return True
    original = _identity(binding)
    lineage = binding["context"]
    observed = (consumer_context(workspace, lineage["consumer_id"])
                if lineage.get("consumer_id") else context(workspace, lineage["ensemble_id"]))
    try:
        return canonical(bind(workspace, original["selection"], observed)) == canonical(binding)
    except (ValueError, KeyError, OSError):
        return False


def _csv(rows):
    fields = ["profile_id", "profile_title", "member_labels", "evidence_id", "evidence_profile_id",
              "relationship", "lucode", "parameter", "actual_value", "evidence_value",
              "units", "load_type", "evidence_load_type", "status"]
    buffer = io.StringIO(newline="")
    writer = csv.DictWriter(buffer, fields, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    return buffer.getvalue().encode("utf-8")


def _recipe_sections(product, lineage, summaries, csv_path):
    # Use the ordinary report helper while adapting links to the typed source
    # recipe's existing "links" representation.
    original = reports.scientific_sections(product)
    converted = []
    for title, blocks in original:
        normalized = []
        for block in blocks:
            if isinstance(block, dict) and block.get("kind") == "link":
                normalized.append({"kind": "links", "items": [
                    {"title": block["label"], "path": block["href"]}]})
            else:
                normalized.append(deepcopy(block))
        converted.append([title, normalized])
    rows = [[row["profile_title"], "; ".join(row["member_labels"]), row["evidence_id"][:12],
             row["relationship"].replace("-", " "), str(row["supported"]) + " / " + str(row["total"]),
             str(row["changed"]), str(row["undocumented"] + row["absent"] + row["outside-lineage"])]
            for row in summaries]
    blocks = [METHODS["lineage"], METHODS["cells"], METHODS["coverage"]]
    if rows:
        # Every member/evidence summary remains readable and complete. The table
        # renderer already repeats headings across pages.
        blocks.append({"kind": "table",
            "columns": ["Actual profile", "Native members", "Evidence", "Relationship",
                        "Supported cells", "Changed cells", "Unsupported cells"], "rows": rows})
    else:
        blocks.append("No coefficient evidence edition was selected. The original tables and "
                      "actual native profiles remain retained; citation coverage is unassessed.")
    blocks.append(METHODS["ranges"])
    for item in product["ranges"]:
        actual = [row for row in item["matched_profiles"] if row["profile_id"] in lineage["profile_ids"]]
        blocks.append("Selected range: " + item["title"] + ". "
                      + ("Actual member matches: " + "; ".join(
                          row["profile_id"][:12] + " (" + ", ".join(row["positions"]) + ")"
                          for row in actual) if actual else
                         "No actual member has an exact saved endpoint profile; this is selected reference context."))
    blocks.append({"kind": "links", "items": [
        {"title": "Every actual member coefficient and its evidence applicability", "path": csv_path},
        {"title": "Exact ensemble coefficient selection and source lineage", "path": MANIFEST}]})
    # The ordinary table includes reference profiles. Identify them before the
    # original block so its central-profile coverage is never read as all-member coverage.
    converted.insert(0, ["Coefficient evidence for the actual native members", blocks])
    converted[1][1].insert(0, "The following original-profile records include explicitly saved "
        "parents and selected range reference profiles. Their own evidence counts describe "
        "those original tables. The preceding actual-member table gives applicability to this report.")
    return converted


def collect(workspace, directory, binding):
    if binding is None:
        return {"sections": [], "source_records": [], "files": {}}
    if not current(workspace, binding):
        raise ValueError("The ensemble coefficient sources or implementation changed; prepare the selected edition again")
    directory = Path(directory)
    state = {"files": {}}
    product = reports.collect(workspace, directory, state, binding["reference_binding"])
    original = binding["reference_binding"]
    records = [evidence.inspect_evidence(workspace, row["id"]) for row in original["evidence"]]
    ranges = [evidence.inspect_ranges(workspace, row["id"]) for row in original["ranges"]]
    profiles = {row["id"] for row in original["profiles"]}
    profiles.update(record["profile_id"] for record in records)
    profiles.update(item["profile_id"] for record in ranges for item in record["profiles"].values())
    source_refs = {(row["table"]["source_collection_id"], row["table"]["source_id"])
                   for row in original["profiles"]}
    source_refs.update((record["source"]["source_collection_id"], record["source"]["source_id"]) for record in records)
    registry, sources = [], []
    def saved(kind, key):
        descriptor = reports._saved_record(workspace, directory, kind, key)
        registry.append({"kind": kind, "id": key, "file": descriptor})
    for key in sorted(profiles):
        profile = workspace._get("profiles", key)
        saved("profiles", key)
        source_refs.add((profile["source_collection_id"], profile["biophysical_source_id"]))
    for record in records:
        saved(evidence.EVIDENCE_KIND, record["id"])
    for record in ranges:
        saved(evidence.RANGES_KIND, record["id"])
    saved("ensembles", binding["context"]["ensemble_id"])
    for collection_id in sorted({row[0] for row in source_refs}):
        saved("sources", collection_id)
    for collection_id, source_id in sorted(source_refs):
        path, entry = workspace.source_file(collection_id, source_id)
        descriptor = reports._source(workspace, directory, collection_id, source_id)
        sources.append({"source_collection_id": collection_id, "source_id": source_id,
                        "file": descriptor})
    summaries, cells = _applicability(_profile_context(workspace, binding["context"]),
                                      binding["context"], records)
    if summaries != binding["applicability"]:
        raise ValueError("Actual member coefficient applicability changed during capture")
    cell_file = reports._retain_bytes(directory, CELLS, _csv(cells),
                                     title="Actual member coefficient applicability")
    implementation = reports._retain_bytes(directory, reports.PREFIX + "/implementation/ensemble_coefficient_evidence.py",
                                           Path(__file__).read_bytes(), title="Ensemble coefficient source adapter")
    if implementation["sha256"] != binding["implementation_sha256"]:
        raise ValueError("The coefficient adapter changed during capture")
    value = {"schema": SCHEMA, "binding": binding, "registry": registry,
             "sources": sources, "applicability": summaries, "cell_file": cell_file,
             "implementation": implementation, "original_manifest": product["manifest_path"]}
    atomic_json(directory / MANIFEST, value, immutable=True)
    files = {**state["files"], "ensemble_coefficient_manifest":
             describe_file(directory, directory / MANIFEST), "ensemble_coefficient_cells": cell_file}
    source_records = []
    for row in original["evidence"]:
        record = evidence.inspect_evidence(workspace, row["id"])
        source_records.append({"id": "coefficient-evidence-" + row["id"],
            "source_collection_id": record["source"]["source_collection_id"],
            "source_id": record["source"]["source_id"], "title": record["source"]["title"],
            "uri": record["source"]["uri"], "vintage": record["source"]["vintage"],
            "body_sha256": record["source"]["sha256"]})
    return {"sections": _recipe_sections(product, binding["context"], summaries, CELLS),
            "source_records": source_records, "files": files}


def include_source(closure, collection_id, entry, *, retain_editable=True):
    """Retain selected original evidence and range records in editable Studies."""
    metadata = entry.get("metadata") or {}
    if metadata.get("source_basis") not in {"saved_native_ensemble", "saved_native_calibration"}:
        return False
    recipe = closure.read(entry["body"]["object"])
    basis = recipe.get("basis") or {}
    binding = basis.get("coefficient_evidence")
    if binding is None:
        return False
    original = _identity(binding)
    if basis.get("workspace_id") != binding["workspace_id"]:
        raise ValueError("The report and coefficient sources belong to different original projects")
    context_value = binding["context"]
    if (metadata["source_basis"] == "saved_native_ensemble"
            and basis.get("ensemble_id") != context_value["ensemble_id"]):
        raise ValueError("The selected coefficient source names another native design")
    if (metadata["source_basis"] == "saved_native_calibration"
            and basis.get("consumer_id") != context_value.get("consumer_id")):
        raise ValueError("The coefficient source names another calibration cohort")
    members = {item.get("view_path", item["filename"]): item for item in entry.get("companions", [])}
    inputs = {item["path"]: item for item in recipe["inputs"]}
    def retained(descriptor):
        path = descriptor["path"]
        item = members.get(path)
        if (item is None or path not in inputs
                or any(descriptor.get(k) != item.get(k) or inputs[path].get(k) != item.get(k)
                       for k in ("bytes", "sha256"))):
            raise ValueError("The coefficient report lost its exact original member: " + path)
        closure.add_file(item["object"], item)
        return item
    manifest_item = members.get(MANIFEST)
    if manifest_item is None:
        raise ValueError("The selected report lost its original coefficient manifest")
    manifest = closure.read(retained({"path": MANIFEST, **{
        k: manifest_item[k] for k in ("bytes", "sha256")}})["object"])
    if manifest.get("schema") != SCHEMA or manifest.get("binding") != binding:
        raise ValueError("The report coefficient manifest changed its original selection")
    ordinary_path = manifest["original_manifest"]
    ordinary_member = members.get(ordinary_path)
    if ordinary_member is None:
        raise ValueError("The original coefficient report inventory is absent")
    ordinary = closure.read(retained({"path": ordinary_path, **{
        k: ordinary_member[k] for k in ("bytes", "sha256")}})["object"])
    if ordinary.get("binding") != original:
        raise ValueError("The original coefficient report changed its selected sources")
    for name, expected_sha in original["implementation"].items():
        path = reports.PREFIX + "/implementation/" + name + ".py"
        descriptor = members.get(path)
        if descriptor is None or descriptor["sha256"] != expected_sha:
            raise ValueError("The original coefficient report implementation differs: " + name)
        retained({"path": path, **{k: descriptor[k] for k in ("bytes", "sha256")}})
    raw_records, captured_sources = {}, {}
    for row in manifest["registry"]:
        kind, key = row["kind"], identifier(row["id"])
        if kind not in {"profiles", "sources", "ensembles", evidence.EVIDENCE_KIND, evidence.RANGES_KIND}:
            raise ValueError("Unsupported coefficient source registry")
        raw = closure.read(retained(row["file"])["object"])
        if raw.get("schema") != "upstate." + kind + "/v1" or digest(raw) != key:
            raise ValueError("Captured coefficient record changed its identity: " + kind)
        if (kind, key) in raw_records:
            raise ValueError("Captured coefficient record is repeated")
        raw_records[(kind, key)] = raw
    for row in manifest["sources"]:
        token = (row["source_collection_id"], row["source_id"])
        if token in captured_sources:
            raise ValueError("Captured coefficient source is repeated")
        collection = raw_records.get(("sources", token[0]))
        entries = [] if collection is None else [item for item in collection["entries"] if item["id"] == token[1]]
        if len(entries) != 1 or any(row["file"][k] != entries[0]["body"][k] for k in ("bytes", "sha256")):
            raise ValueError("Captured coefficient body differs from its original source collection")
        captured_sources[token] = retained(row["file"])
    captured_plan = raw_records.get(("ensembles", context_value["ensemble_id"]))
    if captured_plan is None or digest({**captured_plan, "id": context_value["ensemble_id"]}) != context_value["ensemble_sha256"]:
        raise ValueError("The coefficient source lost its original ensemble lineage")
    expected_members = []
    wanted = set(context_value["selected_run_ids"])
    for row in captured_plan["members"]:
        runs = sorted(item["run_id"] for item in row["runs"] if item["run_id"] in wanted)
        if runs:
            expected_members.append({"label": row["label"], "profile_id": row["profile_id"],
                "parent_profile_id": row.get("parent_profile_id"),
                "ancestor_profile_ids": _ancestors(
                    lambda key: {**raw_records[("profiles", key)], "id": key},
                    row["profile_id"], row.get("parent_profile_id")), "run_ids": runs})
    if (expected_members != context_value["members"]
            or {key for row in expected_members for key in row["run_ids"]} != wanted
            or sorted({row["profile_id"] for row in expected_members}) != context_value["profile_ids"]
            or sorted({key for row in expected_members for key in
                       [row["profile_id"], *row["ancestor_profile_ids"]]}) != context_value["reference_profile_ids"]):
        raise ValueError("The coefficient report changed its actual native member lineage")

    class Captured:
        root = closure.root
        project = {"id": binding["workspace_id"]}
        def _get(self, kind, key):
            raw = deepcopy(raw_records[(kind, identifier(key))])
            if kind == "sources":
                for item in raw["entries"]:
                    supplied = captured_sources.get((key, item["id"]))
                    if supplied:
                        item["body"]["object"] = supplied["object"]
            return {**raw, "id": key}
        def source_file(self, collection_id, source_id):
            collection = self._get("sources", collection_id)
            entries = [item for item in collection["entries"] if item["id"] == source_id]
            if len(entries) != 1 or (collection_id, source_id) not in captured_sources:
                raise ValueError("Missing original coefficient source body")
            return relative_file(self.root, entries[0]["body"]["object"]), entries[0]
        def _list(self, kind):
            return [self._get(kind, key) for saved_kind, key in raw_records if saved_kind == kind]
    captured = Captured()
    if metadata["source_basis"] == "saved_native_ensemble":
        if wanted != {item["run_id"] for row in captured_plan["members"] for item in row["runs"]}:
            raise ValueError("Native study coefficient coverage lost an original member")
    else:
        plan_id = identifier(context_value.get("calibration_plan_id"))
        name = "original/calibration-plans/" + plan_id + ".json"
        if name not in members:
            raise ValueError("The coefficient source lost its selected calibration plan")
        item = retained({"path": name, **{k: members[name][k] for k in ("bytes", "sha256")}})
        calibration_plan = closure.read(item["object"])
        if (digest(calibration_plan) != plan_id
                or calibration_plan.get("schema") != "upstate.calibration-plans/v1"
                or {row["run_id"] for row in calibration_plan["candidates"]} != wanted):
            raise ValueError("The coefficient source changed its original calibration candidates")
        for candidate in calibration_plan["candidates"]:
            matching = [row for row in expected_members if candidate["run_id"] in row["run_ids"]]
            if len(matching) != 1 or candidate["selection"]["profile_id"] != matching[0]["profile_id"]:
                raise ValueError("The selected candidate differs from its retained ensemble coefficient profile")
    for row in original["profiles"]:
        actual = reports._profile(captured, row["id"])
        if actual != row:
            raise ValueError("The captured original profile/table changed its coefficient report identity")
    records = [evidence.inspect_evidence(captured, row["id"]) for row in original["evidence"]]
    for selected, record in zip(original["evidence"], records):
        if digest(record) != selected["record_sha256"]:
            raise ValueError("Original selected coefficient evidence changed")
    for selected in original["ranges"]:
        record = evidence.inspect_ranges(captured, selected["id"])
        if digest(record) != selected["record_sha256"]:
            raise ValueError("Original selected coefficient endpoints changed")
    summaries, cells = _applicability(_profile_context(captured, context_value), context_value, records)
    if summaries != binding["applicability"] or summaries != manifest["applicability"]:
        raise ValueError("Captured native-member coefficient coverage changed")
    cell_item = retained(manifest["cell_file"])
    if relative_file(closure.root, cell_item["object"]).read_bytes() != _csv(cells):
        raise ValueError("Captured native-member coefficient values changed")
    if retained(manifest["implementation"])["sha256"] != binding["implementation_sha256"]:
        raise ValueError("Captured coefficient adapter differs from its bound implementation")
    # A local editable study receives the ORIGINAL raw registries and their
    # existing dependency traversal. Foreign reports retain the complete captured
    # records in source CAS; original project IDs are never rewritten.
    if retain_editable and binding["workspace_id"] == closure.workspace.project["id"]:
        for (kind, key), raw in raw_records.items():
            # The original design is retained as source context. Its complete
            # editable run/state closure remains owned by ensemble_study_transfer.
            if kind == "ensembles":
                continue
            path = kind + "/" + key + ".json"
            if closure.read(path) != raw:
                raise ValueError("Editable coefficient source differs from its captured original")
            closure.add_file(path)
            if kind in {"profiles", "sources"}:
                closure.need(kind, key, "Original selected ensemble coefficient source")
    return True
