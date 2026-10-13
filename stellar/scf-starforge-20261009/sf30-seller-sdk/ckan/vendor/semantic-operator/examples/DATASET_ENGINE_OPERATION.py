#!/usr/bin/env python3
"""One retained source operation for the original dataset engine; no service or Store."""
from __future__ import annotations
import argparse
import copy
import hashlib
import json
import os
import sys
import traceback
import uuid
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from semantic_operator import dataset_engine as engine
from semantic_operator import rdf_engine as native
from rdflib import BNode, Literal, URIRef

def now():
    return datetime.now(timezone.utc).isoformat()

def digest(raw):
    return hashlib.sha256(raw).hexdigest()

def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))

def save_json(path, value):
    path = Path(path)
    temporary = path.with_name(path.name + ".owned-tmp." + uuid.uuid4().hex)
    raw = native.json_bytes(value)
    try:
        with temporary.open("xb") as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()

def check(condition, message):
    if not condition:
        raise AssertionError(message)

class Operation:
    def __init__(self, output, manifest_path, resume):
        self.output, self.manifest_path = output, manifest_path
        self.manifest = read_json(manifest_path)
        check(self.manifest["schema"] == "commons-semantic-dataset-receiving-inputs/1", "Wrong input manifest")
        if output.exists():
            check(resume, "An existing operation requires --resume")
        else:
            output.mkdir(parents=True)
        self.journal_path = output / "operation.json"
        self.inputs = {}
        for item in self.manifest["files"]:
            path = (manifest_path.parent / item["path"]).resolve()
            raw = path.read_bytes()
            check(len(raw) == item["bytes"] and digest(raw) == item["sha256"],
                  "Retained input changed: " + item["id"])
            self.inputs[item["id"]] = self.input(item["id"], path, item["format"])
        manifest_sha = digest(manifest_path.read_bytes())
        if self.journal_path.exists():
            self.journal = read_json(self.journal_path)
            check(self.journal["manifest_sha256"] == manifest_sha, "Cannot change an operation's original inputs")
        else:
            self.journal = {"schema": "commons-semantic-dataset-source-operation/1", "started_at": now(),
                            "manifest_sha256": manifest_sha, "manifest": str(manifest_path),
                            "source_inputs": self.manifest["files"], "jobs": {}, "checks": {}, "status": "in_progress"}
        self.flush()

    @staticmethod
    def input(key, path, fmt):
        path = Path(path).resolve()
        raw = path.read_bytes()
        return {"entry": {"key": key, "source_id": key, "revision": 1, "format": fmt,
                          "bytes": len(raw), "sha256": digest(raw), "role": "retained source"},
                "path": str(path)}

    def flush(self):
        self.journal["updated_at"] = now()
        save_json(self.journal_path, self.journal)

    def verified(self, name, value=True):
        self.journal["checks"][name] = value
        self.flush()

    def run(self, name, action, parameters, inputs):
        job = {"schema": "commons-semantic-native-job/2", "job_id": "dataset-source-operation:" + name,
               "action": action, "parameters": {"data_model": "dataset", **parameters},
               "inputs": [item["entry"] for item in inputs]}
        source_identity = {"engine": engine.ENGINE_SOURCE["sha256"], "supporting_engine": native.ENGINE_SOURCE["sha256"]}
        request_sha = digest(native.json_bytes({"job": job, "source": source_identity}))
        previous = self.journal["jobs"].get(name)
        if previous and previous.get("status") == "complete" and previous.get("request_sha256") == request_sha:
            for item in previous["files"]:
                raw = (Path(previous["directory"]) / item["path"]).read_bytes()
                check(digest(raw) == item["sha256"] and len(raw) == item["bytes"],
                      "Retained operation output changed: " + name + "/" + item["path"])
            return previous
        if previous:
            self.journal.setdefault("earlier_job_attempts", []).append(previous)
        parent = self.output / "jobs"
        parent.mkdir(exist_ok=True)
        number = 1
        directory = parent / (name + "-" + str(number))
        while directory.exists():
            number += 1
            directory = parent / (name + "-" + str(number))
        item = {"name": name, "action": action, "request_sha256": request_sha,
                "source": source_identity, "directory": str(directory), "status": "running", "started_at": now()}
        self.journal["jobs"][name] = item
        self.flush()
        try:
            result = engine.execute(job, {i["entry"]["key"]: i["path"] for i in inputs}, directory)
            files = []
            for file in result["files"]:
                raw = (directory / file["path"]).read_bytes()
                files.append({**file, "bytes": len(raw), "sha256": digest(raw)})
            save_json(directory / "engine-result.json", result)
            result_raw = (directory / "engine-result.json").read_bytes()
            files.append({"path": "engine-result.json", "media_type": "application/json",
                          "role": "operation_result", "title": "Exact native engine result",
                          "bytes": len(result_raw), "sha256": digest(result_raw)})
            item.update({"status": "complete", "completed_at": now(), "result": result, "files": files})
            self.flush()
            print(json.dumps({"step": name, "outcome": result["summary"].get("native_outcome"),
                              "quads": result["summary"].get("quad_count"),
                              "graphs": result["summary"].get("graph_count")}), flush=True)
            return item
        except Exception as exc:
            item.update({"status": "failed", "failed_at": now(), "error": str(exc), "error_type": type(exc).__name__})
            self.flush()
            raise

def artifact(job, filename):
    return Path(job["directory"]) / filename

def snapshot_inputs(job, prefix=""):
    return [Operation.input(prefix + "dataset", artifact(job, "dataset.nq"), "nquads"),
            Operation.input(prefix + "catalog", artifact(job, "graph-catalog.json"), "json")]

def dataset_value(job):
    raw = artifact(job, "dataset.nq").read_bytes()
    catalogue = read_json(artifact(job, "graph-catalog.json"))
    with native.native_scope():
        parsed = engine.parse_dataset(raw, "nquads", "https://retained.invalid/operation/")
        value, canonical = engine.attach_catalog(parsed, raw, catalogue)
    return value, canonical, catalogue

def rejected(operation, name, callback):
    try:
        callback()
    except native.SemanticError as exc:
        operation.verified(name, {"rejected": True, "reason": str(exc)})
    else:
        raise AssertionError(name + " was not refused")

def perform(op):
    m, source = op.manifest, op.inputs
    expected = m["expected"]
    original = op.run("original-w3c-inspection", "inspect",
                      {"input_key": "w3c-conformance-standards"}, [source["w3c-conformance-standards"]])
    original_catalog = read_json(artifact(original, "graph-catalog.json"))
    original_named = [row for row in original_catalog["graphs"]
                      if row["graph"] == {"type": "uri", "value": "https://dcat.example.org/testResult"}]
    check(len(original_named) == 1 and original_named[0]["quad_count"] == 2,
          "Original W3C named graph membership was lost")
    check(all(row["origins"] for row in original_catalog["graphs"]), "Inspection lost original graph origins")
    op.verified("unchanged_w3c_named_graph", {"quad_count": 2, "catalogue": original_catalog})

    baseline = op.run("baseline", "snapshot", {"data_keys": [m["baseline"]]}, [source[m["baseline"]]])
    corrected = op.run("corrected", "snapshot", {"data_keys": [m["corrected"]]}, [source[m["corrected"]]])
    before, before_raw, before_catalog = dataset_value(baseline)
    after, after_raw, after_catalog = dataset_value(corrected)
    for label, value, catalogue in (("baseline", before, before_catalog), ("corrected", after, after_catalog)):
        check(len(value.quads) == expected[label + "_quads"], label + " quad count differs")
        check(len(value.graphs) == expected[label + "_graphs"], label + " graph count differs")
        check(sum(row["empty"] for row in catalogue["graphs"]) == expected["empty_graphs"],
              label + " empty graph inventory differs")
        check(catalogue["canonicalization"]["profile"] == "commons-semantic-dataset-inventory/1",
              "Inventory labeling profile is not recorded")
    predicate = URIRef("http://www.w3.org/ns/dqv#value")
    check({str(q[2]) for q in before.quads if q[1] == predicate} == {"050.0"}, "Baseline decimal lexeme changed")
    check({str(q[2]) for q in after.quads if q[1] == predicate} == {"075.0"}, "Corrected decimal lexeme changed")
    op.verified("authored_snapshot_counts_and_lexemes", {"baseline": baseline["result"]["summary"],
                                                       "corrected": corrected["result"]["summary"]})

    paired = snapshot_inputs(baseline)
    reused = op.run("catalogue-reuse", "snapshot",
                    {"data_keys": ["dataset"], "source_catalogs": {"dataset": "catalog"}}, paired)
    check(reused["result"]["summary"]["dataset_sha256"] == before_catalog["dataset_sha256"],
          "N-Quads plus catalogue changed the semantic dataset on reuse")
    with native.native_scope():
        trig = engine.parse_dataset(artifact(baseline, "dataset.trig").read_bytes(), "trig",
                                    "https://retained.invalid/operation/")
        trig_value, _, trig_raw = engine.canonical_dataset(trig)
    check(engine.dataset_identity(trig_value, trig_raw) == before_catalog["dataset_sha256"],
          "TriG roundtrip lost graph or literal identity")
    check(b"urn:commons:semantic:empty-graph-inventory:" not in before_raw,
          "Auxiliary inventory statements leaked into emitted RDF")
    op.verified("dataset_catalogue_and_trig_roundtrip")

    with native.native_scope():
        symmetric = []
        for key in ("symmetric-empty", "symmetric-empty-relabelled"):
            value = engine.parse_dataset(Path(source[key]["path"]).read_bytes(), "trig",
                                         "https://retained.invalid/operation/")
            value, _, raw = engine.canonical_dataset(value)
            symmetric.append({"digest": engine.dataset_identity(value, raw),
                              "nquads": raw.decode("utf-8"), "catalogue": engine.graph_catalog(value, raw)})
        check(symmetric[0]["digest"] == symmetric[1]["digest"], "Empty-graph symmetry changed dataset identity")
    op.verified("connected_symmetric_empty_graph_relabeling", symmetric)

    local = op.run("local-jsonld", "inspect", {"input_key": "local-dataset"}, [source["local-dataset"]])
    local_catalog = read_json(artifact(local, "graph-catalog.json"))
    check(local_catalog["quad_count"] == 2 and len(local_catalog["graphs"]) == 4,
          "Inline JSON-LD lost shared nodes or empty named graphs")
    op.verified("local_jsonld_dataset", local_catalog)

    documents = op.run("document-scopes", "snapshot", {"data_keys": ["document-a", "document-b"]},
                       [source["document-a"], source["document-b"]])
    document_value, _, _ = dataset_value(documents)
    check(len(document_value.quads) == 4
          and len({q[0] for q in document_value.quads if isinstance(q[0], BNode)}) == 2,
          "Blank nodes from different original documents were merged")
    mapped = op.run("reviewed-csv-destination", "snapshot",
                    {"data_keys": [m["baseline"]], "mappings": [m["mapping"]]},
                    [source[m["baseline"]], source["mapped-rows"]])
    mapped_catalogue = read_json(artifact(mapped, "graph-catalog.json"))
    row = next(row for row in mapped_catalogue["graphs"] if row["graph"] == m["mapping"]["destination_graph"])
    check(row["quad_count"] == 2 and mapped["result"]["summary"]["mapped_rows"] == 1,
          "Reviewed CSV destination or source-row count changed")
    op.verified("separate_documents_and_reviewed_csv_destination")

    query_parameters = {"dataset_key": "dataset", "catalog_key": "catalog", "query": m["query"],
                        "row_limit": 20, "query_scope": m["query_scope"]}
    crossing = op.run("cross-graph-query", "query", query_parameters, paired)
    bindings = read_json(artifact(crossing, "query-result.srj"))["results"]["bindings"]
    check(len(bindings) == 1 and bindings[0]["value"]["value"] == "050.0"
          and bindings[0]["g"]["value"] == expected["baseline_query_graph"],
          "Cross-GRAPH identity query did not retain the expected measurement")
    target = {"type": "uri", "value": "https://dcat.example.org/testResult"}
    for name, scope, answer in (
        ("retained-default", {"default_graph": "default", "named_graphs": "all"}, False),
        ("explicit-selected-union", {"default_graph": "union", "named_graphs":
            m["validation_scopes"]["union"]["graphs"]}, True)):
        query = ("ASK { <https://dcat.example.org/Dataset> "
                 "<http://www.w3.org/ns/dqv#hasQualityMeasurement> ?m . "
                 "?m <http://www.w3.org/ns/dqv#computedOn> <https://dcat.example.org/Dataset> }")
        result = op.run(name, "query", {**query_parameters, "query": query, "query_scope": scope}, paired)
        check(result["result"]["summary"]["answer"] is answer, "Default/union scope was not honored")
    membership_query = (
        "SELECT ?g WHERE { VALUES ?g { <urn:excluded> <urn:x-rdflib:default> "
        "<https://dcat.example.org/testResult> } GRAPH ?g {} }")
    membership = op.run("bound-named-membership", "query",
                         {**query_parameters, "query": membership_query,
                          "query_scope": {"default_graph": "union", "named_graphs": [target]}}, paired)
    rows = read_json(artifact(membership, "query-result.srj"))["results"]["bindings"]
    check(rows == [{"g": target}], "A bound excluded graph or the default sentinel escaped query scope")
    empty = {"type": "uri", "value": "https://dcat.example.org/empty"}
    empty_query = op.run("selected-empty-graph", "query",
                         {**query_parameters, "query": "SELECT ?g WHERE { GRAPH ?g {} }",
                          "query_scope": {"default_graph": "default", "named_graphs": [empty]}}, paired)
    check(read_json(artifact(empty_query, "query-result.srj"))["results"]["bindings"] == [{"g": empty}],
          "Registered selected empty graph is invisible")
    op.verified("native_query_scope_and_bound_membership", {"cross_graph_bindings": bindings})

    shape_inputs = [*paired, source[m["shapes"]]]
    vp = {"dataset_key": "dataset", "catalog_key": "catalog", "shape_keys": [m["shapes"]],
          "ontology_keys": [], "inference": "none", "allow_infos": False, "allow_warnings": False}
    for name in ("per_graph", "union"):
        result = op.run("shacl-" + name, "validate",
                        {**vp, "validation_scope": m["validation_scopes"][name]}, shape_inputs)
        check(result["result"]["summary"]["conforms"] is expected[name + "_conforms"],
              "Explicit SHACL scope produced a different outcome: " + name)
    fixed = op.run("shacl-corrected", "validate",
                   {**vp, "validation_scope": m["validation_scopes"]["per_graph"]},
                   [*snapshot_inputs(corrected), source[m["shapes"]]])
    check(fixed["result"]["summary"]["conforms"] is True, "Corrected single graph is not conforming")
    op.verified("actual_graph_and_union_shacl_outcomes")

    comparison_inputs = [
        *snapshot_inputs(baseline, "before-"), *snapshot_inputs(corrected, "after-"),
        Operation.input("before-provenance", artifact(baseline, "provenance.json"), "json"),
        Operation.input("after-provenance", artifact(corrected, "provenance.json"), "json")]
    cp = {"before_dataset_key": "before-dataset", "before_catalog_key": "before-catalog",
          "after_dataset_key": "after-dataset", "after_catalog_key": "after-catalog",
          "before_provenance_key": "before-provenance", "after_provenance_key": "after-provenance",
          "edge_predicates": [], "depth": 2, "node_limit": 1000}
    for mode in ("within_graph", "union"):
        result = op.run("compare-" + mode, "compare",
                        {**cp, "comparison_scope": {"graphs": "all", "impact_mode": mode}}, comparison_inputs)
        impact = read_json(artifact(result, "impact.json"))
        check(impact["quad_difference_complete"] and impact["graph_inventory_difference_complete"]
              and impact["provenance_complete"], "Complete source-linked differences were not retained")
        check(impact["ground_membership_changes"] == 1, "Ground triple graph move was hidden")
        empty_changes = {(r["change"], r["graph"].get("value")) for r in impact["graph_inventory_changes"]}
        check(("removed_graph", expected["removed_empty_graph"]) in empty_changes
              and ("added_graph", expected["added_empty_graph"]) in empty_changes, "Empty IRI graph correction was lost")
        if mode == "within_graph":
            check(all(len(n["graphs"]) == 1 for n in impact["nodes"]), "Within-graph impact crossed a boundary")
        else:
            check(any(len(n["graphs"]) > 1 for n in impact["nodes"]), "Explicit union failed to retain cross-graph nodes")
    op.verified("quad_membership_empty_graph_and_scoped_impact")

    altered = copy.deepcopy(before_catalog)
    altered["dataset_sha256"] = "0" * 64
    with native.native_scope():
        rejected(op, "tampered_catalogue_refused", lambda: engine.attach_catalog(
            engine.parse_dataset(before_raw, "nquads", "https://retained.invalid/"), before_raw, altered))
        for fmt, text in (
            ("trig", "<urn:x-rdflib:default> {}"),
            ("nquads", "<urn:a> <urn:p> <urn:o> <urn:x-rdflib:default> .\n"),
            ("json-ld", '{"@id":"urn:x-rdflib:default","@graph":[]}')):
            rejected(op, "reserved_graph_refused_" + fmt,
                     lambda f=fmt, t=text: engine.parse_dataset(t.encode(), f, "https://retained.invalid/"))
        rejected(op, "remote_jsonld_context_refused", lambda: engine.parse_dataset(
            b'{"@context":"https://example.invalid/remote-context","@id":"urn:source"}',
            "json-ld", "https://retained.invalid/"))
    op.journal["status"] = "complete"
    op.journal["completed_at"] = now()
    op.journal["observed"] = {"baseline": baseline["result"]["summary"], "corrected": corrected["result"]["summary"],
                              "jobs_complete": sum(j.get("status") == "complete" for j in op.journal["jobs"].values()),
                              "checks_complete": len(op.journal["checks"]), "provider_calls": 0,
                              "browser_runs": 0, "stores_created": 0}
    op.flush()
    print(json.dumps({"status": "complete", "operation": str(op.journal_path), **op.journal["observed"]}), flush=True)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--manifest", type=Path, default=ROOT / "examples/dataset-inputs/receiving-inputs.json")
    parser.add_argument("--resume", action="store_true")
    args = parser.parse_args()
    op = Operation(args.output.resolve(), args.manifest.resolve(), args.resume)
    try:
        perform(op)
    except Exception as exc:
        op.journal.update({"status": "interrupted", "error": str(exc), "error_type": type(exc).__name__})
        op.flush()
        traceback.print_exc()
        return 1
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
