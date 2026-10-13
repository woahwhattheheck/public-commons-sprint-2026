"""Combine original source packets and prepared raster entries for one Workspace intake."""
from __future__ import annotations
import argparse
from pathlib import Path
from model.common import atomic_json, describe_file, digest, file_digest, read_json, relative_file

def compose(output, *, manifests=(), entries=(), title="Upper Savannah complete model sources", scope=None):
    """Rewrite declared relative paths; original native source bytes stay in place."""
    output = Path(output).absolute()
    output.parent.mkdir(parents=True, exist_ok=True)
    root = output.parent.resolve()
    output = root / output.name
    if not manifests and not entries:
        raise ValueError("Select at least one original source manifest or prepared source entry")
    rows, origins, seen = [], [], set()
    scopes, notes, captured = [], [], []
    selected_documents = set()

    def inside(path):
        path = Path(path).resolve(strict=True)
        if not path.is_relative_to(root) or path == output:
            raise ValueError("Place the composed manifest above all selected source files")
        return path.relative_to(root).as_posix()

    def record(parent, item):
        item = dict(item)
        path = relative_file(parent, item["path"])
        actual = describe_file(root, path)
        if item.get("sha256") and item["sha256"] != actual["sha256"]:
            raise ValueError("Original source differs from its declared SHA256: " + str(path))
        if "bytes" in item and item["bytes"] != actual["bytes"]:
            raise ValueError("Original source differs from its declared byte count: " + str(path))
        return {**item, **actual}

    def add(parent, supplied, origin):
        item = dict(supplied)
        key = item.get("id")
        if not isinstance(key, str) or not key or key in seen:
            raise ValueError("Every selected source edition needs its original unique ID: " + str(key))
        if item.get("kind") not in ("raster", "vector", "table", "document"):
            raise ValueError("Select an original raster, vector, table or document source")
        if not all(item.get(name) for name in ("title", "uri", "vintage")):
            raise ValueError("Every source needs its retained title, URI and vintage")
        companions = item.pop("companions", [])
        item = record(parent, item)
        item["companions"] = [record(parent, companion) for companion in companions]
        item["origin_manifest_sha256"] = origin["sha256"]
        paths = [item["path"]] + [companion["path"] for companion in item["companions"]]
        if len(set(paths)) != len(paths):
            raise ValueError("A source repeats a native body or companion path")
        seen.add(key)
        rows.append(item)

    def retain_manifest(path, value, category):
        path = Path(path).resolve(strict=True)
        origin = {**describe_file(root, path), "category": category,
                  "title": value.get("title", path.name),
                  "captured_at": value.get("captured_at"), "scope": value.get("scope", {})}
        inside(path)
        origins.append(origin)
        if value.get("captured_at"):
            captured.append({"sha256": origin["sha256"], "captured_at": value["captured_at"]})
        if value.get("scope"):
            scopes.append({"sha256": origin["sha256"], "scope": value["scope"]})
        if value.get("notes"):
            notes.append({"sha256": origin["sha256"], "notes": value["notes"]})
        if origin["sha256"] not in selected_documents:
            key = "source-manifest-" + origin["sha256"][:24]
            if key in seen:
                raise ValueError("Original source ID collides with its retained manifest identity")
            seen.add(key)
            selected_documents.add(origin["sha256"])
            rows.append({"id": key, "title": "Original source manifest: " + str(origin["title"]),
                         "uri": "urn:sha256:" + origin["sha256"],
                         "vintage": value.get("captured_at") or "Retained original source definition",
                         "kind": "document", "role": "SOURCE_MANIFEST",
                         **describe_file(root, path), "companions": []})
        return path, origin

    for selected in manifests:
        path = Path(selected).resolve(strict=True)
        value = read_json(path)
        if value.get("schema") != "upstate.sources/v1" or not isinstance(value.get("entries"), list):
            raise ValueError("Select an original upstate.sources/v1 manifest")
        path, origin = retain_manifest(path, value, "source_manifest")
        for item in value["entries"]:
            add(path.parent, item, origin)

    for selected in entries:
        path = Path(selected).resolve(strict=True)
        value = read_json(path)
        path, origin = retain_manifest(path, value, "prepared_source_entry")
        item = dict(value)
        original_companions = list(item.get("companions", []))
        if not any(relative_file(path.parent, child["path"]) == path for child in original_companions):
            original_companions.append({"path": path.name, "bytes": origin["bytes"],
                                        "sha256": origin["sha256"], "role": "PREPARATION_MANIFEST"})
        item["companions"] = original_companions
        add(path.parent, item, origin)

    if not any(row["kind"] != "document" for row in rows):
        raise ValueError("The selected packets contain no native scientific inputs")
    semantic = {"schema": "upstate.sources/v1", "title": title, "captured_at": None,
                "entries": rows, "scope": dict(scope) if scope is not None else {"source_scopes": scopes},
                "notes": [{"source_observations": captured}, {"source_notes": notes},
                          "Native source bytes and their original definitions are retained separately."],
                "composition": {"schema": "upstate.source-composition/v1", "inputs": origins,
                                "path_rule": "Relative paths within this manifest's original source directory"}}
    semantic["composition_sha256"] = digest(semantic)
    atomic_json(output, semantic, immutable=True)
    return {"manifest": str(output), "sha256": file_digest(output),
            "composition_sha256": semantic["composition_sha256"],
            "entries": len(rows), "native_entries": sum(row["kind"] != "document" for row in rows)}

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", action="append", default=[])
    parser.add_argument("--entry", action="append", default=[])
    parser.add_argument("--output", required=True)
    parser.add_argument("--title", default="Upper Savannah complete model sources")
    parser.add_argument("--scope-json", help="Retain this explicit reporting/model-domain selection")
    args = parser.parse_args(argv)
    import json
    result = compose(args.output, manifests=args.manifest, entries=args.entry, title=args.title,
                     scope=read_json(args.scope_json) if args.scope_json else None)
    print(json.dumps(result, sort_keys=True, indent=2))

if __name__ == "__main__":
    main()
