"""Dataset operations composed with the original semantic application and Store.

This module freezes selections into native jobs. Parsing, canonicalization and
calculation belong to dataset_engine; every artifact and revision uses the
original application machinery.
"""
from __future__ import annotations
import re
from .security import canonical, read_json

DATASET_FORMATS = {"turtle", "nt", "xml", "json-ld", "trig", "nquads"}
DATASET_JOB_SCHEMA = "commons-semantic-native-job/2"


def graph_selector(value, *, named_only=False, destination=False):
    if not isinstance(value, dict):
        raise ValueError("Select an explicit default or named graph.")
    kind = value.get("type")
    if kind == "default" and set(value) == {"type"} and not named_only:
        return {"type": "default"}
    if kind not in (("uri",) if destination else ("uri", "bnode")) or set(value) != {"type", "value"}:
        raise ValueError("A graph selector must be default, an absolute IRI, or its retained blank-node identifier.")
    name = value.get("value")
    if not isinstance(name, str) or not name or len(name) > 8000 or "\0" in name:
        raise ValueError("Keep the complete retained graph identifier.")
    if kind == "uri" and (not re.match(r"^[A-Za-z][A-Za-z0-9+.-]*:", name) or
                         any(c.isspace() or c in '<>"{}|^\x60\\' for c in name)):
        raise ValueError("A named graph destination must be an absolute RDF IRI.")
    if kind == "bnode" and (name.startswith("_:") or any(c.isspace() for c in name)):
        raise ValueError("Use the retained graph catalogue blank-node value without the _: prefix.")
    return {"type": kind, "value": name}


def graph_selection(value, *, named_only=False, allow_empty=False):
    if value == "all":
        return "all"
    if not isinstance(value, list) or (not value and not allow_empty):
        raise ValueError("Choose all graphs or a nonempty explicit graph selection.")
    result = [graph_selector(v, named_only=named_only) for v in value]
    if len({canonical(v) for v in result}) != len(result):
        raise ValueError("A graph selection must not repeat an identifier.")
    return result


class DatasetOperations:
    def _dataset_snapshot(self, ref):
        row = self._revision("snapshot", ref["id"], ref.get("revision"))
        return row["payload"].get("parameters", {}).get("data_model") == "dataset"

    def _dataset_inputs(self, ref, prefix=""):
        key = (prefix + "-") if prefix else ""
        result = []
        for role, name, fmt in (("dataset", "dataset", "nquads"),
                                ("graph_catalog", "catalog", "json")):
            item = self._snapshot_input(ref, key + name, role)
            item.update(format=fmt, role=role)
            result.append(item)
        return result

    def _source_catalog_input(self, ref, key):
        row = self._revision("source", ref["id"], ref.get("revision"))
        catalogue = row["payload"].get("dataset_catalog")
        if not catalogue:
            return None
        meta = self.store.artifact(catalogue["id"])
        if meta["sha256"] != catalogue["sha256"] or meta["bytes"] != catalogue["bytes"]:
            raise ValueError("The retained source graph catalogue identity changed.")
        return {"key": key, "artifact_id": meta["id"], "sha256": meta["sha256"],
                "bytes": meta["bytes"], "format": "json", "role": "graph_catalog",
                "source_id": row["id"], "revision": row["revision"],
                "title": catalogue["name"], "source_reference": row["payload"]["source_reference"]}

    def _dataset_inspect(self, p, op, actor):
        source = self._source_input(p["source"], "selected")
        if source["format"] not in DATASET_FORMATS:
            raise ValueError("Dataset inspection requires an original RDF source.")
        inputs = [source]
        catalog = self._source_catalog_input(p["source"], "selected-catalog")
        params = {"data_model": "dataset", "input_key": "selected", "source_catalogs": {}}
        if catalog:
            inputs.append(catalog)
            params["source_catalogs"]["selected"] = catalog["key"]
        return self._new_job("inspect", inputs, params, p, op, actor)

    def _dataset_build(self, p, op, actor):
        source_refs, mapping_refs = p.get("sources", []), p.get("mappings", [])
        if not isinstance(source_refs, list) or not isinstance(mapping_refs, list):
            raise ValueError("Select exact source and mapping revisions.")
        source_graphs = p.get("source_graphs", {})
        mapping_graphs = p.get("mapping_graphs", {})
        if not isinstance(source_graphs, dict) or not isinstance(mapping_graphs, dict):
            raise ValueError("Keep graph choices keyed by their original record ID and revision.")
        inputs, data_keys, mappings, selections, catalogs = [], [], [], {}, {}
        seen_sources, seen_mappings = set(), set()
        for index, ref in enumerate(source_refs):
            item = self._source_input(ref, "data-" + str(index))
            if item["format"] not in DATASET_FORMATS or item["role"] != "data":
                raise ValueError("Dataset snapshots use original RDF data sources.")
            identity = item["source_id"] + "@" + str(item["revision"])
            if identity in seen_sources:
                raise ValueError("Select an original source revision only once.")
            seen_sources.add(identity)
            inputs.append(item)
            data_keys.append(item["key"])
            catalog = self._source_catalog_input(ref, item["key"] + "-catalog")
            if catalog:
                inputs.append(catalog)
                catalogs[item["key"]] = catalog["key"]
            selections[item["key"]] = graph_selection(source_graphs.get(identity, "all"))
        for index, ref in enumerate(mapping_refs):
            row = self._revision("mapping", ref["id"], ref.get("revision"))
            identity = row["id"] + "@" + str(row["revision"])
            if identity in seen_mappings:
                raise ValueError("Select a mapping revision only once.")
            seen_mappings.add(identity)
            item = self._source_input(row["payload"]["source"], "table-" + str(index))
            if item["sha256"] != row["payload"]["source"]["sha256"]:
                raise ValueError("The mapping's original table identity changed.")
            destination = graph_selector(mapping_graphs.get(identity, {"type": "default"}), destination=True)
            inputs.append(item)
            mappings.append({**row["payload"]["definition"], "mapping_id": row["id"],
                             "revision": row["revision"], "input_key": item["key"],
                             "destination_graph": destination})
        if set(source_graphs) - seen_sources or set(mapping_graphs) - seen_mappings:
            raise ValueError("A graph choice refers to a source or mapping outside this snapshot.")
        if not inputs:
            raise ValueError("Choose at least one RDF source or CSV mapping.")
        return self._new_job("snapshot", inputs,
            {"data_model": "dataset", "data_keys": data_keys, "source_graphs": selections,
             "source_catalogs": catalogs, "mappings": mappings},
            p, op, actor)

    def _dataset_validate(self, p, op, actor):
        inputs = self._dataset_inputs(p["snapshot"])
        shapes, ontologies = [], []
        for role, refs, keys in (("shapes", p.get("shapes", []), shapes),
                                 ("ontology", p.get("ontologies", []), ontologies)):
            if not isinstance(refs, list):
                raise ValueError("Select exact shape and ontology revisions.")
            for index, ref in enumerate(refs):
                item = self._source_input(ref, role + "-" + str(index))
                if item["role"] != role or item["format"] not in ("turtle", "nt", "xml", "json-ld"):
                    raise ValueError("Validation shapes and ontologies must be explicit RDF graph sources.")
                inputs.append(item)
                keys.append(item["key"])
        if not shapes:
            raise ValueError("Select the original SHACL shapes for this validation.")
        inference = p.get("inference", "none")
        if inference not in ("none", "rdfs", "owlrl", "both"):
            raise ValueError("Choose an explicit inference mode.")
        for name in ("allow_infos", "allow_warnings"):
            if name in p and type(p[name]) is not bool:
                raise ValueError(name + " must be true or false.")
        scope = p.get("validation_scope")
        if not isinstance(scope, dict) or set(scope) != {"mode", "graphs"} or scope["mode"] not in ("per_graph", "union"):
            raise ValueError("Choose per-graph validation or an explicit selected union and retain its graph scope.")
        scope = {"mode": scope["mode"], "graphs": graph_selection(scope["graphs"])}
        return self._new_job("validate", inputs,
            {"data_model": "dataset", "dataset_key": "dataset", "catalog_key": "catalog",
             "shape_keys": shapes, "ontology_keys": ontologies, "inference": inference,
             "allow_infos": p.get("allow_infos", False), "allow_warnings": p.get("allow_warnings", False),
             "validation_scope": scope}, p, op, actor)

    def _dataset_query(self, p, op, actor):
        from .application import text, integer
        scope = p.get("query_scope")
        if (not isinstance(scope, dict) or set(scope) != {"default_graph", "named_graphs"} or
                scope["default_graph"] not in ("default", "union")):
            raise ValueError("Choose the SPARQL default graph and available named graphs explicitly.")
        scope = {"default_graph": scope["default_graph"],
                 "named_graphs": graph_selection(scope["named_graphs"], named_only=True, allow_empty=True)}
        return self._new_job("query", self._dataset_inputs(p["snapshot"]),
            {"data_model": "dataset", "dataset_key": "dataset", "catalog_key": "catalog",
             "query": text(p.get("query"), "SPARQL query", 100000),
             "row_limit": integer(p.get("row_limit", 10000), "Query row limit", 1, 100000),
             "query_scope": scope}, p, op, actor)

    def _dataset_compare(self, p, op, actor):
        from .application import iri, integer
        if not self._dataset_snapshot(p["before"]) or not self._dataset_snapshot(p["after"]):
            raise ValueError("Choose two dataset snapshots; graph and dataset snapshots have different identities.")
        inputs = self._dataset_inputs(p["before"], "before") + self._dataset_inputs(p["after"], "after")
        params = {"data_model": "dataset", "before_dataset_key": "before-dataset",
                  "before_catalog_key": "before-catalog", "after_dataset_key": "after-dataset",
                  "after_catalog_key": "after-catalog"}
        for side in ("before", "after"):
            item = self._snapshot_input(p[side], side + "-provenance", "provenance")
            inputs.append(item)
            params[side + "_provenance_key"] = item["key"]
        edges = p.get("edge_predicates", [])
        if not isinstance(edges, list):
            raise ValueError("Impact predicates must be an array of absolute IRIs.")
        for edge in edges:
            iri(edge, "Impact predicate")
        scope = p.get("comparison_scope")
        if (not isinstance(scope, dict) or set(scope) != {"graphs", "impact_mode"} or
                scope["impact_mode"] not in ("within_graph", "union")):
            raise ValueError("Choose a graph scope and whether impact traverses within graphs or across their union.")
        params.update(comparison_scope={"graphs": graph_selection(scope["graphs"]), "impact_mode": scope["impact_mode"]},
                      edge_predicates=edges, depth=integer(p.get("depth", 2), "Impact depth", 0, 8),
                      node_limit=integer(p.get("node_limit", 100000), "Impact node limit", 1, 100000))
        return self._new_job("compare", inputs, params, p, op, actor)
