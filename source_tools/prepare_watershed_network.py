"""Prepare the retained original WBD topology for regional watershed context.

The source directory is the existing DBC61 upstream-domain delivery. Original
topology, feature bindings and summary bytes are copied unchanged; the network
view joins their explicit reporting/upstream roles to the native attributes.
"""
from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path


def digest(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


def prepare(domain_root: Path, source_context: Path, out_dir: Path) -> dict:
    originals = {}
    source_paths = {
        "topology": "original-wbd/topology-records.json",
        "bindings": "feature-bindings.json",
        "domain_summary": "domain-summary.json",
    }
    for key, member in source_paths.items():
        body = (domain_root / member).read_bytes()
        originals[key] = (member, body, json.loads(body))
    context = json.loads(source_context.read_bytes())
    domain = set(context["model_domain_huc12s"])
    bindings_doc = originals["bindings"][2]
    bindings = {row["huc12"]: row for row in bindings_doc["features"]}
    if len(bindings) != len(bindings_doc["features"]) or set(bindings) != domain:
        raise ValueError("Original feature bindings must cover the exact context domain.")
    records = originals["topology"][2]["records"]
    native = {}
    for record in records:
        attrs = record["attributes"]
        huc = attrs["huc12"]
        if huc in native:
            raise ValueError("Duplicate original native HUC12: " + huc)
        native[huc] = attrs
    if not domain <= native.keys():
        raise ValueError("Native topology omits a model-domain HUC12.")
    roles = {}
    for huc, binding in bindings.items():
        attrs = native[huc]
        if attrs["objectid"] != binding["object_id"] or attrs["tohuc"] != binding["tohuc"]:
            raise ValueError("Original ID/ToHUC join mismatch for " + huc)
        reporting = binding["intersects_reporting_area"]
        upstream = binding["upstream_ancestor"]
        if not isinstance(reporting, bool) or not isinstance(upstream, bool) or reporting == upstream:
            raise ValueError("Original reporting/upstream role is ambiguous for " + huc)
        roles[huc] = "reporting" if reporting else "upstream"
    declared = originals["domain_summary"][2]
    counts = Counter(roles.values())
    if declared["feature_count"] != len(domain) or declared["reporting_intersections"] != counts["reporting"] or declared["upstream_ancestors"] != counts["upstream"]:
        raise ValueError("Original domain summary disagrees with retained role bindings.")
    out_dir.mkdir(parents=True, exist_ok=True)
    preserved = {}
    for key, (member, body, _) in originals.items():
        target = out_dir / "original-wbd" / Path(member).name
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists() and target.read_bytes() != body:
            raise ValueError("A different original source already occupies " + str(target))
        target.write_bytes(body)
        preserved[key] = {"path": str(target.relative_to(out_dir)), "original_member": member,
                          "bytes": len(body), "sha256": digest(body)}
    rows = []
    for huc in sorted(native):
        row = dict(native[huc])
        if huc in roles:
            row["role"] = roles[huc]
        rows.append(row)
    reference = {
        "uri": "https://tokenjunkielabs.slack.com/archives/C0BTTA66TK3/p1791850636130089",
        "source_id": declared["source_id"],
        "source_capture_sha256": declared["source_capture_sha256"],
        "originals": preserved,
        "context_domain_canonical_sha256": digest(json.dumps(sorted(domain), separators=(",", ":")).encode()),
        "method": "Copy all original WBD topology attribute objects. Add reporting/upstream role only from the original feature binding flags. Keep complete native topology records beyond the selected model domain for downstream paths.",
    }
    network = {"schema": "upstate.watershed-native-network/v1",
               "source_reference": reference, "model_domain_huc12s": sorted(domain),
               "model_domain_huc_count": len(domain), "native_record_count": len(rows),
               "role_counts": dict(sorted(counts.items())), "rows": rows}
    body = (json.dumps(network, ensure_ascii=False, indent=2) + "\n").encode()
    path = out_dir / "native-network.json"
    path.write_bytes(body)
    return {"path": str(path), "bytes": len(body), "sha256": digest(body),
            "domain_hucs": len(domain), "native_records": len(rows),
            "role_counts": dict(counts), "originals": preserved}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--domain-root", type=Path, required=True)
    parser.add_argument("--source-context", type=Path, required=True)
    parser.add_argument("--out-dir", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(prepare(args.domain_root, args.source_context, args.out_dir), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
