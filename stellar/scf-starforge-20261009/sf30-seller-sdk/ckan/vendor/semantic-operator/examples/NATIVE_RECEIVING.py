"""One restartable native source-to-receiver semantic workflow.

Run with the pinned native dependencies on PYTHONPATH. Every source is read from
the delivered reference closure; no provider, customer endpoint or remote import
is called. Completed jobs are read back with their original file hashes.
"""
from __future__ import annotations

import argparse
import csv
import fcntl
import hashlib
import io
import json
import os
import shutil
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

WORKFLOW_REVISION = 2
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from semantic_operator.rdf_engine import execute, parse_graph, native_scope, SemanticError, ENGINE_SOURCE


def digest(data):
    return hashlib.sha256(data).hexdigest()


def save(path, value):
    body = (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + "\n").encode()
    temporary = path.with_name(path.name + ".writing")
    with temporary.open("wb") as stream:
        stream.write(body)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)


def now():
    return datetime.now(timezone.utc).isoformat()


class Journey:
    def __init__(self, operation, references):
        self.operation = operation.resolve()
        self.references = references.resolve()
        self.reference_receipts = {item["path"]: item for item in json.loads(
            (ROOT / "examples" / "REFERENCE_INPUTS.json").read_text())["files"]}
        self.operation.mkdir(parents=True, exist_ok=True)
        self.lock = (self.operation / "native.lock").open("a+b")
        fcntl.flock(self.lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        self.state_path = self.operation / "NATIVE-STATE.json"
        if self.state_path.exists():
            self.state = json.loads(self.state_path.read_text())
            if self.state["references"] != str(self.references):
                raise RuntimeError("This original operation is bound to its original source reference directory")
        else:
            self.state = {"schema": "commons-semantic-native-receiving/1",
                          "run_id": str(uuid.uuid4()), "references": str(self.references),
                          "created_at": now(), "status": "running", "jobs": {}, "inputs": {}}
            save(self.state_path, self.state)

    def input(self, key, relative, fmt, role, title):
        original = self.references / relative
        data = original.read_bytes()
        receipt = self.reference_receipts[relative]
        if len(data) != receipt["bytes"]:
            raise RuntimeError("Original published input byte count changed: " + relative)
        if receipt.get("git_blob_sha"):
            actual_blob = hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()
            if actual_blob != receipt["git_blob_sha"]:
                raise RuntimeError("Original published Git source blob changed: " + relative)
        entry = {"key": key, "sha256": digest(data), "bytes": len(data), "format": fmt,
                 "role": role, "source_id": relative, "revision": receipt.get("git_blob_sha") or "delivered-original",
                 "title": title, "source_reference": receipt.get("git_blob_url") or "urn:commons:reference:" + relative}
        # The adjacent upstream receipt/license in the reference closure remains
        # authoritative. The original file is copied byte for byte once.
        return self.retain(key, data, entry)

    def retain(self, key, data, entry, path=None):
        path = Path(path) if path is not None else self.operation / "inputs" / (key + ".source")
        path.parent.mkdir(exist_ok=True)
        if key in self.state["inputs"]:
            prior = self.state["inputs"][key]
            if prior["entry"] != entry or prior["path"] != str(path) or not path.exists() or digest(path.read_bytes()) != entry["sha256"]:
                raise RuntimeError("An original retained input changed: " + key)
        else:
            if path.exists() and path.read_bytes() != data:
                raise RuntimeError("An unrecorded input path contains different original bytes")
            if not path.exists():
                with path.open("xb") as stream:
                    stream.write(data)
                    stream.flush()
                    os.fsync(stream.fileno())
            self.state["inputs"][key] = {"entry": entry, "path": str(path)}
            save(self.state_path, self.state)
        return key

    def generated(self, key, data, fmt, role, title, reference):
        return self.retain(key, data, {"key": key, "sha256": digest(data), "bytes": len(data),
                                      "format": fmt, "role": role, "source_id": key,
                                      "revision": 1, "title": title, "source_reference": reference})

    def read_job(self, record):
        result_path = Path(record["directory"]) / "ENGINE-RESULT.json"
        if not result_path.exists():
            return None
        result = json.loads(result_path.read_text())
        for file in result["manifest"]:
            body = (result_path.parent / file["path"]).read_bytes()
            if len(body) != file["bytes"] or digest(body) != file["sha256"]:
                raise RuntimeError("A completed original native output changed: " + file["path"])
        return result

    def run(self, name, action, keys, parameters):
        inputs = [self.state["inputs"][key]["entry"] for key in keys]
        job = {"schema": "commons-semantic-native-job/1",
               "job_id": self.state["run_id"] + ":" + name, "action": action,
               "inputs": inputs, "parameters": parameters}
        request_sha = digest(json.dumps(job, sort_keys=True, separators=(",", ":")).encode())
        prior = self.state["jobs"].get(name)
        if prior:
            if prior["request_sha256"] != request_sha:
                raise RuntimeError("The original job request changed: " + name)
            completed = self.read_job(prior)
            if completed is not None:
                if prior["status"] != "complete":
                    prior.update(status="complete", completed_at=now())
                    save(self.state_path, self.state)
                return completed
        generation = prior.get("generation", 0) + 1 if prior else 1
        directory = self.operation / "jobs" / name / ("generation-" + str(generation))
        directory.mkdir(parents=True, exist_ok=False)
        record = {"request_sha256": request_sha, "job_id": job["job_id"],
                  "generation": generation, "directory": str(directory), "status": "running",
                  "engine_source_sha256": ENGINE_SOURCE["sha256"], "engine_source": dict(ENGINE_SOURCE)}
        self.state["jobs"][name] = record
        self.state["status"] = "running"
        save(self.state_path, self.state)
        save(directory.parent / ("request-" + str(generation) + ".json"), job)
        result = execute(job, {key: Path(self.state["inputs"][key]["path"]) for key in keys}, directory)
        manifest = []
        for file in result["files"]:
            body = (directory / file["path"]).read_bytes()
            manifest.append({**file, "sha256": digest(body), "bytes": len(body)})
        result = {**result, "job_id": job["job_id"], "directory": str(directory), "manifest": manifest,
                  "engine_source_sha256": record["engine_source_sha256"]}
        save(directory / "ENGINE-RESULT.json", result)
        record.update(status="complete", completed_at=now())
        save(self.state_path, self.state)
        print(json.dumps({"phase": name, "status": "complete", "action": action,
                          "native_outcome": result["summary"].get("native_outcome"),
                          "triples": result["summary"].get("triples"),
                          "rows_returned": result["summary"].get("rows_returned"),
                          "shapes_valid": result["summary"].get("shapes_valid")}), flush=True)
        return result

    def output_input(self, key, result, name, fmt, role, title):
        data = (Path(result["directory"]) / name).read_bytes()
        return self.generated(key, data, fmt, role, title,
                              "urn:commons:native-job:" + result["job_id"] + ":" + name)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--operation", required=True, type=Path)
    parser.add_argument("--references", type=Path, default=ROOT / "reference")
    args = parser.parse_args()
    journey = Journey(args.operation, args.references)
    result_path = journey.operation / "NATIVE-RESULT.json"
    if (journey.state.get("status") == "complete" and result_path.exists()
            and journey.state.get("workflow_revision") == WORKFLOW_REVISION):
        for record in journey.state["jobs"].values():
            if journey.read_job(record) is None:
                raise RuntimeError("An original completed native result is missing")
        print(json.dumps({"status": "PASS", "result": str(result_path), "sha256": digest(result_path.read_bytes()), "reopened": True}))
        fcntl.flock(journey.lock.fileno(), fcntl.LOCK_UN)
        journey.lock.close()
        return
    if result_path.exists() and journey.state.get("status") == "complete":
        original_result = result_path.read_bytes()
        prior_path = journey.operation / ("NATIVE-RESULT." + digest(original_result) + ".json")
        if not prior_path.exists():
            prior_path.write_bytes(original_result)
        prior_result = {"path": str(prior_path), "sha256": digest(original_result),
                        "workflow_revision": journey.state.get("workflow_revision", 1)}
        if prior_result not in journey.state.setdefault("prior_results", []):
            journey.state["prior_results"].append(prior_result)
        journey.state["status"] = "continuing"
        save(journey.state_path, journey.state)
    try:
        basic = journey.input("basic", "w3c/examples/basic-example.ttl", "turtle", "data",
                              "W3C published DCAT basic example — original Turtle")
        basic_json = journey.input("basic-json", "w3c/examples/basic-example.jsonld", "json-ld", "data",
                                   "W3C published DCAT basic example — original JSON-LD")
        csiro = journey.input("csiro", "w3c/examples/csiro-dap-examples.ttl", "turtle", "data",
                              "W3C published CSIRO metadata example")
        genoa = journey.input("genoa", "w3c/examples/genoa-busstop.ttl", "turtle", "data",
                              "W3C published Genoa bus-stop metadata example")
        shapes = journey.input("dcat-shapes", "dcat-ap/3.0.1/dcat-ap-SHACL.ttl", "turtle", "shapes",
                               "Original DCAT-AP 3.0.1 SHACL")
        ranges = journey.input("dcat-ranges", "dcat-ap/3.0.1/ranges.ttl", "turtle", "ontology",
                               "Original DCAT-AP 3.0.1 ranges")
        vocabulary = journey.input("dcat-vocabulary", "w3c/dcat3.ttl", "turtle", "ontology",
                                   "Original W3C DCAT 3 vocabulary")
        inspected = journey.run("inspect-original", "inspect", [basic], {"input_key": basic})
        original = journey.run("snapshot-turtle", "snapshot", [basic], {"data_keys": [basic], "mappings": []})
        original_graph = journey.output_input("original-graph", original, "graph.nt", "nt", "snapshot",
                                              "Original Turtle snapshot")
        original_prov = journey.output_input("original-provenance", original, "provenance.json", "json",
                                             "provenance", "Original Turtle provenance")
        json_snapshot = journey.run("snapshot-jsonld", "snapshot", [basic_json],
                                    {"data_keys": [basic_json], "mappings": []})
        json_graph = journey.output_input("json-graph", json_snapshot, "graph.nt", "nt", "snapshot",
                                         "Original JSON-LD snapshot")
        json_prov = journey.output_input("json-provenance", json_snapshot, "provenance.json", "json",
                                        "provenance", "Original JSON-LD provenance")
        format_comparison = journey.run("compare-original-formats", "compare",
                                         [original_graph, original_prov, json_graph, json_prov], {
            "before_graph_key": original_graph, "after_graph_key": json_graph,
            "before_provenance_key": original_prov, "after_provenance_key": json_prov,
            "edge_predicates": [], "depth": 1, "node_limit": 100000})
        # The published files are compared as they actually parse. This carrier
        # intentionally does not assume that two upstream examples are equivalent.
        source_query_text = ("SELECT DISTINCT ?subject ?type WHERE { ?subject a ?type . "
                             "FILTER(isIRI(?subject) && isIRI(?type)) } ORDER BY ?subject ?type")
        source_query = journey.run("query-original-table", "query", [original_graph],
                                    {"graph_key": original_graph, "query": source_query_text, "row_limit": 100000})
        if not source_query["summary"]["result_complete"]:
            raise RuntimeError("The source-derived Practice table must be complete")
        bindings = json.loads((Path(source_query["directory"]) / "query-result.srj").read_text())["results"]["bindings"]
        table = io.StringIO(newline="")
        writer = csv.writer(table, lineterminator="\n")
        writer.writerow(["row_id", "original_subject", "original_type"])
        for index, binding in enumerate(bindings, 1):
            writer.writerow([str(index), binding["subject"]["value"], binding["type"]["value"]])
        csv_key = journey.generated("source-derived-table", table.getvalue().encode("utf-8"), "csv", "table",
                                    "Practice table derived by the complete original source query",
                                    "urn:commons:native-job:" + source_query["job_id"])
        journey.run("inspect-derived-table", "inspect", [csv_key], {"input_key": csv_key})
        mapping = {"mapping_id": "published-metadata-rows", "revision": 1, "input_key": csv_key,
                   "subject_template": "https://practice.commons.invalid/metadata-row/{row_id}",
                   "classes": ["http://www.w3.org/ns/prov#Entity"], "delimiter": ",", "null_values": [],
                   "fields": [
                       {"column": "original_subject", "predicate": "http://www.w3.org/ns/prov#wasDerivedFrom",
                        "kind": "iri", "datatype": None, "language": None, "iri_template": None},
                       {"column": "original_type", "predicate": "http://purl.org/dc/terms/type",
                        "kind": "iri", "datatype": None, "language": None, "iri_template": None}]}
        before = journey.run("snapshot-metadata-and-table", "snapshot", [basic, csiro, csv_key],
                             {"data_keys": [basic, csiro], "mappings": [mapping]})
        before_graph = journey.output_input("before-graph", before, "graph.nt", "nt", "snapshot",
                                            "Original selected metadata and reviewed source-derived table")
        before_prov = journey.output_input("before-provenance", before, "provenance.json", "json", "provenance",
                                           "Complete original metadata/table provenance")
        after = journey.run("snapshot-expanded-selection", "snapshot", [basic, csiro, genoa, csv_key],
                            {"data_keys": [basic, csiro, genoa], "mappings": [mapping]})
        after_graph = journey.output_input("after-graph", after, "graph.nt", "nt", "snapshot",
                                           "Operator selection expanded with the original Genoa example")
        after_prov = journey.output_input("after-provenance", after, "provenance.json", "json", "provenance",
                                          "Complete expanded-selection provenance")
        validation = journey.run("validate-original-dcat-ap", "validate",
                                 [after_graph, shapes, ranges, vocabulary], {
            "graph_key": after_graph, "shape_keys": [shapes], "ontology_keys": [ranges, vocabulary],
            "inference": "none", "allow_infos": False, "allow_warnings": False})
        # This is an actual published-example-to-profile assessment, not a claim
        # that the upstream teaching examples satisfy every DCAT-AP obligation.
        # Retain the native diagnosis of the generated pair independently.
        # The separate official executable module family is selected explicitly
        # from the exact delivered source manifest. Neither original is edited.
        range_shapes = journey.input("dcat-range-shapes", "dcat-ap/3.0.1/ranges.ttl", "turtle", "shapes",
                                     "Original DCAT-AP companion ranges selected as shapes")
        pair_validation = journey.run("validate-generated-main-and-ranges", "validate",
                                      [after_graph, shapes, range_shapes, vocabulary], {
            "graph_key": after_graph, "shape_keys": [shapes, range_shapes],
            "ontology_keys": [vocabulary], "inference": "none",
            "allow_infos": False, "allow_warnings": False})
        reference_manifest = json.loads((ROOT / "examples/REFERENCE_INPUTS.json").read_text())
        profile = reference_manifest["validation_profiles"]["dcat-ap-3.0.1-official"]
        profile_shapes = [
            journey.input("official-profile-" + str(index), relative, "turtle", "shapes",
                          "Unchanged official DCAT-AP 3.0.1 module: " + Path(relative).name)
            for index, relative in enumerate(profile["shape_files"], 1)
        ]
        full_validation = journey.run("validate-official-modular-profile", "validate",
                                      [after_graph] + profile_shapes + [vocabulary], {
            "graph_key": after_graph, "shape_keys": profile_shapes,
            "ontology_keys": [vocabulary], "inference": "none",
            "allow_infos": False, "allow_warnings": False})
        if not full_validation["summary"].get("shapes_valid") or not full_validation["summary"].get("data_validation_performed"):
            raise RuntimeError("The selected official module family did not reach native data validation")

        query_results = {}
        queries = {
            "select": "SELECT ?subject ?predicate ?object WHERE { ?subject ?predicate ?object } ORDER BY ?subject ?predicate ?object",
            "ask": "ASK { ?subject a <http://www.w3.org/ns/dcat#Dataset> }",
            "construct": "CONSTRUCT { ?subject a <http://www.w3.org/ns/dcat#Dataset> } WHERE { ?subject a <http://www.w3.org/ns/dcat#Dataset> }",
            "describe": "DESCRIBE ?subject WHERE { ?subject a <http://www.w3.org/ns/dcat#Dataset> }",
        }
        for name, text in queries.items():
            query_results[name] = journey.run("query-" + name, "query", [after_graph],
                                               {"graph_key": after_graph, "query": text, "row_limit": 17})
        impact = journey.run("source-selection-impact", "compare",
                             [before_graph, before_prov, after_graph, after_prov], {
            "before_graph_key": before_graph, "after_graph_key": after_graph,
            "before_provenance_key": before_prov, "after_provenance_key": after_prov,
            "edge_predicates": [], "depth": 2, "node_limit": 100000})
        limited_impact = journey.run("reviewed-impact-limit", "compare",
                                     [before_graph, before_prov, after_graph, after_prov], {
            "before_graph_key": before_graph, "after_graph_key": after_graph,
            "before_provenance_key": before_prov, "after_provenance_key": after_prov,
            "edge_predicates": [], "depth": 2, "node_limit": 2})
        # Independent receiver owns copied inputs, without original source paths.
        receiver = journey.operation / "receiver"
        receiver.mkdir(exist_ok=True)
        received_keys = []
        for source_key, received_key in ((after_graph, "received-graph"), (after_prov, "received-provenance")):
            source_record = journey.state["inputs"][source_key]
            original_bytes = Path(source_record["path"]).read_bytes()
            receiving_path = receiver / (received_key + ".source")
            if receiving_path.exists():
                if receiving_path.read_bytes() != original_bytes:
                    raise RuntimeError("Original receiver input differs")
            else:
                with receiving_path.open("xb") as stream:
                    stream.write(original_bytes)
                    stream.flush()
                    os.fsync(stream.fileno())
            received_entry = {**source_record["entry"], "key": received_key,
                              "source_id": received_key, "revision": 1, "title": "Independent received original",
                              "source_reference": "urn:commons:received:" + source_key}
            received_keys.append(journey.retain(received_key, original_bytes, received_entry, path=receiving_path))
        received = journey.run("independent-receiver-compare", "compare",
                               [after_graph, after_prov] + received_keys, {
            "before_graph_key": after_graph, "after_graph_key": received_keys[0],
            "before_provenance_key": after_prov, "after_provenance_key": received_keys[1],
            "edge_predicates": [], "depth": 2, "node_limit": 100000})
        if not received["summary"]["equivalent"]:
            raise RuntimeError("Independently received snapshot changed its RDF graph")
        # Cross-format receiving uses the real original graph, serialized by
        # RDFLib, rather than an invented external RDF/XML source.
        xml_source = "source-derived-xml"
        if xml_source in journey.state["inputs"]:
            retained_xml = journey.state["inputs"][xml_source]
            original_xml = Path(retained_xml["path"]).read_bytes()
            if (len(original_xml) != retained_xml["entry"]["bytes"]
                    or digest(original_xml) != retained_xml["entry"]["sha256"]):
                raise RuntimeError("The original generated RDF/XML receiving source changed")
        else:
            with native_scope():
                original_native = parse_graph(Path(journey.state["inputs"][original_graph]["path"]).read_bytes(),
                                              "nt", "urn:commons:original-published-graph")
                xml_bytes = original_native.serialize(format="xml", encoding="utf-8")
            xml_source = journey.generated("source-derived-xml", xml_bytes, "xml", "data",
                                           "RDFLib RDF/XML representation of the original published graph",
                                           "urn:commons:native-job:" + original["job_id"])
        xml_snapshot = journey.run("snapshot-original-rdfxml", "snapshot", [xml_source],
                                   {"data_keys": [xml_source], "mappings": []})
        xml_graph = journey.output_input("xml-graph", xml_snapshot, "graph.nt", "nt", "snapshot",
                                        "Native RDF/XML round-trip of original graph")
        xml_prov = journey.output_input("xml-provenance", xml_snapshot, "provenance.json", "json", "provenance",
                                       "Original graph RDF/XML receiving provenance")
        xml_comparison = journey.run("compare-original-rdfxml", "compare",
                                     [original_graph, original_prov, xml_graph, xml_prov], {
            "before_graph_key": original_graph, "after_graph_key": xml_graph,
            "before_provenance_key": original_prov, "after_provenance_key": xml_prov,
            "edge_predicates": [], "depth": 1, "node_limit": 100000})
        if not xml_comparison["summary"]["equivalent"]:
            raise RuntimeError("Native RDF/XML receiving changed the original graph")
        empty_json = journey.generated("empty-default-jsonld", b'{"@context":{},"@graph":[]}', "json-ld", "data",
                                       "Explicit empty default-graph Practice input", "urn:commons:practice:empty-jsonld")
        empty_snapshot = journey.run("snapshot-empty-default-jsonld", "snapshot", [empty_json],
                                     {"data_keys": [empty_json], "mappings": []})
        if empty_snapshot["summary"]["triples"] != 0:
            raise RuntimeError("An empty default JSON-LD graph gained statements")
        lexical_body = (
            '@prefix x: <https://practice.commons.invalid/> .\n'
            '@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\n'
            'x:item x:integer +001 ; x:decimal +01.20 ; x:boolean "1"^^xsd:boolean ;\n'
            ' x:token "  alpha   beta  "^^xsd:token ; x:normalized "a\\tb"^^xsd:normalizedString .\n')
        lexical = journey.generated("lexical-practice", lexical_body.encode(), "turtle", "data",
                                    "Explicit parser lexical-preservation Practice source",
                                    "urn:commons:practice:lexical-terms")
        lexical_result = journey.run("native-lexical-preservation", "snapshot", [lexical],
                                     {"data_keys": [lexical], "mappings": []})
        with native_scope():
            retained = parse_graph((Path(lexical_result["directory"]) / "graph.nt").read_bytes(),
                                   "nt", "urn:commons:practice:lexical-terms")
            actual = {str(predicate).rsplit("/", 1)[-1]: str(obj) for _, predicate, obj in retained}
            expected = {"integer": "+001", "decimal": "+01.20", "boolean": "1",
                        "token": "  alpha   beta  ", "normalized": "a\tb"}
            if actual != expected:
                raise RuntimeError("A retained native lexical term changed: " + json.dumps(actual))
            turtle = parse_graph((Path(lexical_result["directory"]) / "graph.ttl").read_bytes(),
                                 "turtle", "urn:commons:practice:lexical-terms")
            if set(retained) != set(turtle):
                raise RuntimeError("The Turtle representation changed a retained lexical RDF term")
        result = {"schema": "commons-semantic-native-receiving-result/1", "status": "PASS",
                  "run_id": journey.state["run_id"], "workflow_revision": WORKFLOW_REVISION,
                  "prior_results": journey.state.get("prior_results", []), "operation": str(journey.operation),
                  "references": str(journey.references), "completed_at": now(),
                  "customer_calls": 0, "network_queries": 0, "native_versions": after["summary"]["engine_versions"],
                  "continuation_engine_source": dict(ENGINE_SOURCE),
                  "engine_generations": {key: {"sha256": record["engine_source_sha256"],
                                                "generation": record["generation"]}
                                         for key, record in journey.state["jobs"].items()},
                  "jobs": len(journey.state["jobs"]), "published_format_comparison": format_comparison["summary"],
                  "snapshot": after["summary"], "partial_profile_validation": validation["summary"],
                  "generated_pair_validation": pair_validation["summary"],
                  "native_dcat_ap_validation": full_validation["summary"], "selected_profile": profile,
                  "rdfxml_comparison": xml_comparison["summary"],
                  "empty_default_graph": empty_snapshot["summary"],
                  "query_forms": {key: value["summary"] for key, value in query_results.items()},
                  "source_selection_impact": impact["summary"], "limited_impact": limited_impact["summary"],
                  "receiver": received["summary"], "lexical_terms_preserved": expected,
                  "note": "Original published W3C/DCAT-AP sources plus explicitly derived Practice mapping; no private customer ontology."}
        save(result_path, result)
        journey.state.update(status="complete", workflow_revision=WORKFLOW_REVISION,
                             completed_at=result["completed_at"], result_sha256=digest(result_path.read_bytes()))
        save(journey.state_path, journey.state)
        print(json.dumps({"status": "PASS", "run_id": result["run_id"], "result": str(result_path),
                          "sha256": digest(result_path.read_bytes()), "jobs": result["jobs"],
                          "completed_at": result["completed_at"]}), flush=True)
    except BaseException as exc:
        journey.state.update(status="continuation_required", error=type(exc).__name__ + ": " + str(exc),
                             interrupted_at=now())
        save(journey.state_path, journey.state)
        raise
    finally:
        fcntl.flock(journey.lock.fileno(), fcntl.LOCK_UN)
        journey.lock.close()


if __name__ == "__main__":
    main()
