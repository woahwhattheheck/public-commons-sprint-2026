#!/usr/bin/env python3
"""Read-only complete source for portable collection reviews."""
from __future__ import annotations
import argparse
from pathlib import Path
import collection_accession as collection
import preservation as p

SCHEMA = "stellar-forge.collection-review-source.v1"
MAX_WORKING = 64 * 1024 * 1024

def source(root, revision=None, expected_review_sha256=None):
    """Retain the entire original inventory and every complete saved review."""
    with p.project_lock(root):
        record, inventory = collection.project(root)
        history = collection.history(root, inventory)
        if revision is not None:
            collection.need(type(revision) is int and 0 <= revision < len(history),
                            "Select an existing original saved review.")
            collection.need(history[revision]["reviewSha256"] == expected_review_sha256,
                            "The selected saved review identity changed.")
            history = history[:revision + 1]
        else:
            collection.need(expected_review_sha256 is None, "Supply both original review selection fields.")
        value = {"schema": SCHEMA,
                 "accession": {"id": record["settings"]["id"], "settings": record["settings"],
                               "createdAt": record["createdAt"]},
                 "inventory": inventory, "history": history}
        raw = p.canonical(value)
        collection.need(len(raw) <= MAX_WORKING, "The complete review source exceeds the 64 MiB working-file profile. Export the complete workspace; no history was omitted.")
        return {**value, "sha256": p.digest(raw)}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--accession", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    root, output = Path(args.accession).absolute(), Path(args.output).absolute()
    collection.need(not output.resolve().is_relative_to(root.resolve()),
                    "Save review source outside the retained accession tree.")
    raw = p.canonical(source(root))
    if output.exists():
        collection.need(output.is_file() and not output.is_symlink()
                        and output.read_bytes() == raw, "An existing review source has different bytes.")
    else:
        p.write_new(output, raw)
    print(raw.decode("utf-8"))

if __name__ == "__main__":
    main()
