"""MIT. Complete original directory source exercise, reusable by the native directory journey.

Published HSDS inputs are unchanged. One explicitly authored service description
successor demonstrates exact comparison while preserving all original bytes.
No provider acquisition or remote write is performed by this local source leg.
"""
from __future__ import annotations
import argparse
import csv
import hashlib
import io
import json
import os
from pathlib import Path
import sys
import zipfile
from directory_runtime import InputError, atomic_json, private_directory, now, original_workspace, write_zip
from directory_source_schema import original_sources, standards, sha, jbytes, json_value, MAX_BYTES
from directory_source import retained_file_descriptors

OPERATION = "SCF-DIRECTORY-SOURCE-RECEIVING-450E-20261012"
SCHEMA = "stellar-forge.directory-source-operated.v1"


def _put(path, content):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if path.exists():
        if path.is_symlink() or path.read_bytes() != content:
            raise InputError("Retained original source exercise file changed: " + path.name)
        return path
    with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as out:
        out.write(content)
        out.flush()
        os.fsync(out.fileno())
    return path


def _packet(path, files):
    if not path.exists():
        write_zip(path, files)
    else:
        with zipfile.ZipFile(path) as archive:
            if set(archive.namelist()) != set(files):
                raise InputError("Retained original exercise packet member selection changed")
            for name, expected in files.items():
                raw = expected if isinstance(expected, bytes) else Path(expected).read_bytes()
                if archive.read(name) != raw:
                    raise InputError("Retained original exercise packet member changed")
    return path


def _identity(path):
    return {"file": str(path.resolve()), "bytes": path.stat().st_size,
            "sha256": original_workspace.file_digest(path, MAX_BYTES)}


def _input(path):
    value = _identity(path)
    return {"filename": Path(path).name, "bytes": value["bytes"], "sha256": value["sha256"]}


def _rows(ws, edition_id):
    offset = 0
    while True:
        page = ws.directory_edition_rows(edition_id, offset=offset, limit=250)
        for row in page["rows"]:
            if row.get("contentOmitted"):
                row = ws.directory_edition_row(edition_id, row["sourceId"], row["recordId"])
            yield row
        if page["nextOffset"] is None:
            break
        if page["nextOffset"] <= offset:
            raise InputError("Original directory row cursor did not advance")
        offset = page["nextOffset"]


def exercise_directory_sources(ws, output, hsd_examples=None):
    """Operate this source leg on the caller's sole original directory Workspace."""
    output = private_directory(Path(output).resolve())
    originals = private_directory(output / "originals")
    journal_path = output / "SOURCE_JOURNEY.json"
    if journal_path.exists():
        journal = json_value(journal_path.read_bytes())
        if journal.get("operation") != OPERATION or journal.get("workspaceId") != ws.workspace_id:
            raise InputError("Continue the source exercise with its original workspace UUID")
    else:
        journal = {"schema": SCHEMA, "operation": OPERATION, "workspaceId": ws.workspace_id,
            "workspace": str(ws.root.resolve()), "createdAt": now(), "steps": {}, "originalFiles": []}
        atomic_json(journal_path, journal)

    def record(name, kind, request, call):
        digest = sha(jbytes(request))
        old = journal["steps"].get(name)
        if old is not None and old["requestSha256"] != digest:
            raise InputError("The original source exercise step was rebound to another input")
        if old and old.get("state") == "complete":
            value = ws.directory_record(kind, old["id"])
            for file in retained_file_descriptors(value):
                ws._file_path(file)
            return value
        journal["steps"][name] = {"state": "prepared", "kind": kind, "request": request,
                                  "requestSha256": digest, "preparedAt": now()}
        atomic_json(journal_path, journal)
        value = call()
        journal["steps"][name].update({"state": "complete", "id": value["id"], "completedAt": now()})
        journal["updatedAt"] = now()
        atomic_json(journal_path, journal)
        return value

    original = original_sources()
    hsds = next(s for s in original["sources"] if s["id"] == "hsds-3.3.1")
    members = {f["path"]: f for f in hsds["files"]}
    selected = []
    packet_members = {}
    for resource in standards()["datapackage"]["resources"]:
        table = resource["name"]
        native_path = standards()["tables"][table]["schema"]["path"]
        path = "examples/csv/" + native_path
        member = members[path]
        raw = member["content"].encode("utf-8")
        if len(raw) != member["bytes"] or hashlib.sha1(
                b"blob " + str(len(raw)).encode() + b"\0" + raw).hexdigest() != member["git_blob_sha"]:
            raise InputError("Original complete HSDS CSV changed")
        packet_members[native_path] = raw
        selected.append({"name": native_path, "table": table})
        _put(originals / native_path, raw)
    for name in ("datapackage.json", "LICENSE"):
        if name in members:
            packet_members["publisher/" + name] = members[name]["content"].encode()
    packet_members["publisher/source.json"] = jbytes({
        k: hsds[k] for k in ("id", "repository", "ref", "release", "license")})
    csv_packet = _packet(output / "HSDS_original_CSV_examples.zip", packet_members)
    profile = {"label": "HSDS 3.3.1 unchanged complete published CSV examples",
        "format": "hsds-csv-zip", "filename": "HSDS_original_CSV_examples.zip",
        "members": selected, "origin": "published_reference",
        "scope": "subset", "publisher": hsds["repository"],
        "sourceUrl": "https://github.com/openreferral/specification/tree/" + hsds["ref"] + "/examples/csv",
        "note": "Every complete published CSV remains unchanged; this is a reference example selection, not a live provider directory."}
    base = record("original-csv", "sources", {"file": _input(csv_packet), "profile": profile},
                  lambda: ws.directory_import(csv_packet, profile))
    # Verify every original selected CSV member through the actual source accessor.
    for item in selected:
        received, descriptor = ws.directory_source_file(base["id"], item["name"])
        expected = packet_members[item["name"]]
        if descriptor["sha256"] != sha(expected) or received.read_bytes() != expected:
            raise InputError("Original CSV did not survive complete source receiving")

    nested = []
    for filename, table in (("organization_full.json", "organization"),
                            ("service_full.json", "service"),
                            ("service_at_location_full.json", "service_at_location"),
                            ("tabular.json", None)):
        member = members["examples/" + filename]
        path = _put(originals / filename, member["content"].encode())
        p = {"label": "Unchanged HSDS original " + filename, "format": "hsds-json", "filename": filename,
            "layout": "tables" if table is None else "entity", "origin": "published_reference",
            "scope": "subset", "publisher": hsds["repository"],
            "sourceUrl": "https://github.com/openreferral/specification/blob/" + hsds["ref"] + "/examples/" + filename}
        if table is not None:
            p["table"] = table
        current = record(filename, "sources", {"file": _input(path), "profile": p},
                         lambda path=path, p=p: ws.directory_import(path, p))
        nested.append(current)

    # One explicit authored successor: preserve every original CSV cell except
    # one service description, and retain the full predecessor archive as a member.
    service_name = standards()["tables"]["service"]["schema"]["path"]
    source_rows = list(csv.reader(io.StringIO(packet_members[service_name].decode("utf-8-sig"), newline="")))
    if not source_rows or source_rows[0].count("id") != 1 or source_rows[0].count("description") != 1:
        raise InputError("Original service example lacks an unambiguous reviewed id/description column")
    id_column, description_column = source_rows[0].index("id"), source_rows[0].index("description")
    chosen = next((n for n, row in enumerate(source_rows[1:], 1)
        if len(row) > max(id_column, description_column) and row[id_column]), None)
    if chosen is None:
        raise InputError("No complete original service row is available for the authored receiving example")
    chosen_id, before_description = source_rows[chosen][id_column], source_rows[chosen][description_column]
    source_rows[chosen][description_column] = before_description + " [Authored directory receiving exercise.]"
    csv_out = io.StringIO(newline="")
    writer = csv.writer(csv_out, lineterminator="\r\n")
    writer.writerows(source_rows)
    revised_members = dict(packet_members)
    revised_members[service_name] = csv_out.getvalue().encode()
    revised_members["predecessors/HSDS_original_CSV_examples.zip"] = csv_packet
    revised_members["authored-change.json"] = jbytes({"origin": "authored_example", "operation": OPERATION,
        "originalSourceId": base["id"], "table": "service", "nativeId": chosen_id,
        "logicalRowOrdinal": chosen, "column": "description",
        "before": before_description, "after": source_rows[chosen][description_column],
        "meaning": "Reference source receiving exercise only; no remote provider update or live availability claim"})
    revised_packet = _packet(output / "HSDS_authored_CSV_successor.zip", revised_members)
    revised_profile = {**profile, "label": "Authored successor of unchanged HSDS CSV example",
        "filename": "HSDS_authored_CSV_successor.zip",
        "origin": "authored_example", "note": "One reviewed description cell differs. Full original predecessor and all other original CSV members remain retained."}
    successor = record("authored-csv", "sources", {"file": _input(revised_packet), "profile": revised_profile},
                       lambda: ws.directory_import(revised_packet, revised_profile))

    def edition(name, label, sources, predecessor=None):
        p = {"label": label, "sourceIds": sources, "actor": "450e source receiving",
            "scope": "subset", "predecessorId": predecessor, "note": "Original publisher reference inputs and explicitly authored successor; no live directory completeness claim."}
        return record(name, "editions", p, lambda: ws.directory_edition(p))

    before = edition("base-edition", "Original published CSV source edition", [base["id"]])
    after = edition("successor-edition", "Authored description successor edition", [successor["id"]], before["id"])
    joined = edition("joined-originals", "Complete selected published CSV and nested JSON originals",
                     [base["id"], *[s["id"] for s in nested]])
    c = {"label": "Original versus explicitly authored description successor",
         "beforeEditionId": before["id"], "afterEditionId": after["id"],
         "actor": "450e source receiving", "reviewedLinks": [],
         "note": "Exact native identity comparison; all ambiguity stays visible."}
    comparison = record("successor-comparison", "comparisons", c, lambda: ws.directory_compare(c))
    self_request = {**c, "label": "Unchanged original edition receiving",
                    "afterEditionId": before["id"], "note": "Verify complete unchanged original identities; duplicates remain ambiguous."}
    repeated = record("same-original-comparison", "comparisons", self_request,
                      lambda: ws.directory_compare(self_request))
    change_rows, offset = [], 0
    while True:
        page = ws.directory_changes(comparison["id"], offset=offset, limit=250)
        change_rows.extend(page["rows"])
        if page["nextOffset"] is None:
            break
        offset = page["nextOffset"]
    changed = [row for row in change_rows if row["state"] == "changed"]
    if not any(row["before"]["table"] == "service" and row["before"]["nativeId"] == chosen_id for row in changed):
        raise InputError("The actual comparison did not retain the explicit authored service change")

    # Read all exact nested/FHIR candidates from the actual complete edition index.
    reference_states, reference_rows, target_count, offset = {}, 0, 0, 0
    while True:
        page = ws.directory_edition_links(joined["id"], offset=offset, limit=250)
        for link in page["rows"]:
            reference_rows += 1
            reference_states[link["state"]] = reference_states.get(link["state"], 0) + 1
            at, found = 0, 0
            while True:
                targets = ws.directory_link_targets(joined["id"], link["sourceId"], link["id"], offset=at, limit=250)
                for target in targets["rows"]:
                    ws.directory_edition_row(joined["id"], target["sourceId"], target["recordId"])
                found += len(targets["rows"])
                if targets["nextOffset"] is None:
                    break
                at = targets["nextOffset"]
            if found != link["candidateCount"]:
                raise InputError("Complete original reference receiving lost an ambiguous candidate")
            target_count += found
        if page["nextOffset"] is None:
            break
        offset = page["nextOffset"]

    hsd = None
    if hsd_examples is not None:
        path = Path(hsd_examples).resolve()
        with zipfile.ZipFile(path) as archive:
            names = [name for name in archive.namelist() if name.endswith(".json")]
        if not names:
            raise InputError("Published HSD archive has no complete JSON members")
        p = {"label": "Unchanged published HSD STU1 complete example archive",
            "format": "fhir-json-zip", "filename": "examples.json.zip",
            "members": [{"name": name} for name in names],
            "origin": "published_reference", "scope": "subset",
            "publisher": "HL7 International",
            "sourceUrl": "https://hl7.org/fhir/us/hsds/examples.json.zip"}
        hsd = record("published-hsd-examples", "sources", {"file": _input(path), "profile": p},
                     lambda: ws.directory_import(path, p))
        hsd_edition = edition("published-hsd-edition", "Original published HSD STU1 edition", [hsd["id"]])
    else:
        hsd_edition = None

    # Every original row citation and complete source value is returned from the
    # same frozen indices; no reimport or alternate mapping occurs on readback.
    total_rows = sum(1 for _ in _rows(ws, joined["id"]))
    complete_changes, changes_file = ws.directory_changes_file(comparison["id"])
    sources = [base, *nested, successor] + ([hsd] if hsd else [])
    editions = [before, after, joined] + ([hsd_edition] if hsd_edition else [])
    all_files = {}
    for row in [*sources, *editions, comparison, repeated]:
        for file in retained_file_descriptors(row):
            ws._file_path(file)
            all_files[file["sha256"]] = file
    ws.directory_sync_sources()
    result = {"schema": SCHEMA, "operation": OPERATION, "completedAt": now(),
        "workspace": str(ws.root.resolve()), "workspaceId": ws.workspace_id,
        "sourceRoot": str(Path(__file__).resolve().parent),
        "sourceIds": [s["id"] for s in sources], "editionIds": [e["id"] for e in editions],
        "comparisonIds": [comparison["id"], repeated["id"]],
        "connectionIds": [], "requestIds": [], "acquisitionOperationIds": [],
        "baseSourceId": base["id"], "successorSourceId": successor["id"],
        "baseEditionId": before["id"], "successorEditionId": after["id"],
        "joinedEditionId": joined["id"], "comparisonId": comparison["id"],
        "publishedSource": {k: hsds[k] for k in ("id", "repository", "ref", "release", "license")},
        "originalFiles": [_identity(csv_packet), *[_identity(originals / f) for f in
            ("organization_full.json", "service_full.json", "service_at_location_full.json", "tabular.json")]],
        "authoredSuccessor": {**_identity(revised_packet), "nativeId": chosen_id,
            "table": "service", "field": "description", "origin": "authored_example"},
        "counts": {"sources": len(sources), "editions": len(editions), "joinedRows": total_rows,
                   "references": reference_rows, "referenceTargets": target_count,
                   "referenceStates": reference_states, "retainedFiles": len(all_files)},
        "comparison": comparison["summary"], "unchangedComparison": repeated["summary"],
        "changesFile": {**changes_file, "file": str(complete_changes)},
        "retainedFiles": [all_files[k] for k in sorted(all_files)],
        "hsdExamples": _identity(Path(hsd_examples)) if hsd_examples else None,
        "providerAcquisition": "not-run-in-local-published-source-leg"}
    atomic_json(output / "OPERATED_DIRECTORY_SOURCES.json", result)
    journal["completedAt"], journal["result"] = result["completedAt"], "OPERATED_DIRECTORY_SOURCES.json"
    atomic_json(journal_path, journal)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--hsd-examples")
    args = parser.parse_args()
    from directory_workspace import Workspace
    path = Path(args.workspace).resolve()
    with Workspace(path, create=not path.exists()) as ws:
        result = exercise_directory_sources(ws, args.output, args.hsd_examples)
    print(json.dumps({"operation": result["operation"], "workspaceId": result["workspaceId"],
        "result": str(Path(args.output).resolve() / "OPERATED_DIRECTORY_SOURCES.json"),
        "counts": result["counts"]}), flush=True)


if __name__ == "__main__":
    main()
