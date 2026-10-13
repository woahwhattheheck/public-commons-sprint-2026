#!/usr/bin/env python3
"""Join the complete original Nord acquisition to the maintained BDNB importer.

This prepares source descriptors and, when supplied, the unchanged complete
producer/customer receiving plan. The original Analysis APIs execute the plan.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import itertools
import importlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import sys

SCHEMA = "commons.bdnb-acquisition-receiving-join.v1"
ACQUISITION = "BDNB-NORD-SOURCES-2769-20261013"
ANALYSIS = "stellar/scf-starforge-20261009/sf30-seller-sdk/datasette-analysis"
NATIVE = "stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python"
ID = re.compile(r"[0-9a-f]{32}")
SHA = re.compile(r"[0-9a-f]{64}")
LIMIT = 16 * 1024 * 1024
EDITIONS = {"2025-07-a": ("2025-07.a", "v0.7.10"),
            "2026-02-a": ("2026-02.a", "v0.7.11")}


def need(value, message):
    if not value:
        raise ValueError(message)


def unique(pairs):
    value = {}
    for key, item in pairs:
        need(key not in value, "Duplicate JSON key: " + key)
        value[key] = item
    return value


def parse(raw):
    return json.loads(raw, object_pairs_hook=unique,
                      parse_constant=lambda value: (_ for _ in ()).throw(
                          ValueError("Non-finite JSON value: " + value)))


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, allow_nan=False,
                       sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")


def absolute(value):
    need(isinstance(value, str) and value and Path(value).is_absolute(),
         "Select an actual absolute path")
    path = Path(value)
    need(path.resolve(strict=True) == path, "Select a canonical existing path: " + value)
    return path


def member(root, relative):
    need(isinstance(relative, str) and relative and "\\" not in relative,
         "Select an original relative member")
    name = PurePosixPath(relative)
    need(not name.is_absolute() and str(name) == relative
         and all(part not in ("", ".", "..") for part in name.parts),
         "Original relative member is not canonical")
    path = root.joinpath(*name.parts)
    need(path.resolve(strict=True) == path and path.is_relative_to(root),
         "Original member escaped or traversed a symlink")
    return path


def signature(info):
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def read_file(path, maximum=None):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as stream:
        before = os.fstat(stream.fileno())
        need(stat.S_ISREG(before.st_mode), "Original input is not a regular file")
        if maximum is not None:
            need(before.st_size <= maximum, "Input exceeds its complete JSON capacity")
        chunks, digest, count = [], hashlib.sha256(), 0
        while block := stream.read(1024 * 1024):
            count += len(block)
            digest.update(block)
            if maximum is not None:
                chunks.append(block)
        need(signature(before) == signature(os.fstat(stream.fileno())) ==
             signature(os.stat(path, follow_symlinks=False)) and count == before.st_size,
             "Original input changed while reading: " + str(path))
    return (b"".join(chunks) if maximum is not None else None,
            {"bytes": count, "sha256": digest.hexdigest()})


def compatible_csv(path, observed):
    """Keep every original cell identical under the maintained importer's parser."""
    need(isinstance(observed, dict) and observed.get("encoding") == "utf-8-sig",
         "Keep the actual original UTF-8 CSV observation")
    handles = []
    old_limit = csv.field_size_limit()
    try:
        for _ in range(2):
            fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            stream = os.fdopen(fd, "rb")
            info = os.fstat(stream.fileno())
            need(stat.S_ISREG(info.st_mode), "Original CSV is not a regular file")
            handles.append((stream, info))
        need(signature(handles[0][1]) == signature(handles[1][1]),
             "CSV parser views selected different originals")
        original = io.TextIOWrapper(handles[0][0], encoding="utf-8-sig", newline="")
        native = io.TextIOWrapper(handles[1][0], encoding="utf-8-sig", newline="")
        try:
            sample = original.read(128 * 1024)
            original.seek(0)
            dialect = csv.Sniffer().sniff(sample, delimiters=",;\t|")
            for field in ("delimiter", "quotechar", "doublequote", "escapechar"):
                need(getattr(dialect, field) == observed[field],
                     "Original CSV dialect changed: " + field)
            # Same field bound as bdnb_source.csv_rows. The complete native
            # importer still applies its logical-record and projection bounds.
            csv.field_size_limit(2 * 1024 * 1024)
            left = csv.reader(original, dialect=dialect, strict=True)
            right = csv.reader(native, delimiter=observed["delimiter"], strict=True)
            missing, count = object(), 0
            for index, (before, after) in enumerate(itertools.zip_longest(left, right, fillvalue=missing)):
                need(before is not missing and after is not missing and before == after,
                     "Native CSV parsing changes original cells at record " + str(index) +
                     ": " + str(path))
                if index == 0:
                    need(before == observed["header"], "Original CSV header changed")
                else:
                    count += 1
                    need(len(before) == len(observed["header"]), "Original CSV row width changed")
            need(count == observed["row_count"], "Original CSV record count changed")
            named = os.stat(path, follow_symlinks=False)
            need(all(signature(info) == signature(os.fstat(stream.fileno())) == signature(named)
                     for stream, info in handles), "Original CSV changed during parser receiving")
            return {"state": "IDENTICAL_ORIGINAL_CELLS", "rows": count,
                    "delimiter": dialect.delimiter, "quotechar": dialect.quotechar,
                    "doublequote": dialect.doublequote, "escapechar": dialect.escapechar,
                    "skipinitialspace": dialect.skipinitialspace}
        finally:
            original.detach()
            native.detach()
    finally:
        csv.field_size_limit(old_limit)
        for stream, _ in handles:
            stream.close()


def identity(value):
    need(isinstance(value, dict) and type(value.get("bytes")) is int
         and value["bytes"] >= 0 and isinstance(value.get("sha256"), str)
         and SHA.fullmatch(value["sha256"]), "Select a complete original file identity")
    return {"bytes": value["bytes"], "sha256": value["sha256"]}


class Join:
    def __init__(self, input_path):
        self.input_path = absolute(input_path)
        raw, self.input_identity = read_file(self.input_path, LIMIT)
        self.input = parse(raw)
        need(isinstance(self.input, dict) and set(self.input) == {
            "schema", "acquisition_complete", "checkout", "source_files", "editions", "receiving"},
            "Use the complete acquisition/receiving join input")
        need(self.input["schema"] == SCHEMA + "/input", "Wrong join schema")
        self.checkout = absolute(self.input["checkout"])
        need(self.checkout.is_dir(), "Select the complete original checkout")
        self.files = {}

    def verify_file(self, path, expected, *, json_file=False):
        expected = identity(expected)
        raw, actual = read_file(path, LIMIT if json_file else None)
        need(actual == expected, "Complete original file differs: " + str(path))
        key = str(path)
        previous = self.files.get(key)
        need(previous is None or previous == actual, "One original path changed during preparation")
        self.files[key] = actual
        if json_file:
            return parse(raw)
        return actual

    def own_json(self, path):
        raw, actual = read_file(path, LIMIT)
        self.files[str(path)] = actual
        return parse(raw), actual

    def modules(self):
        roster = self.input["source_files"]
        need(isinstance(roster, list) and roster, "Select the complete installed source roster")
        seen = set()
        for entry in roster:
            need(isinstance(entry, dict) and set(entry) == {"path", "bytes", "sha256"},
                 "Invalid original source roster row")
            need(entry["path"] not in seen, "Duplicate selected source member")
            seen.add(entry["path"])
            self.verify_file(member(self.checkout, entry["path"]), entry)
        required = [ANALYSIS + "/" + name for name in (
            "bdnb_source.py", "bdnb_dictionary.json", "bdnb_adapter.py",
            "bdnb_products.py", "bdnb_receiving.py", "operator_server.py",
            "operator_client.py", "model.py")]
        required += ["products/ntico/bdnb-territory/prepare_receiving.py"]
        required += [NATIVE + "/stellar_forge_buyer/" + name for name in (
            "analysis_exports.py", "analysis_workspace.py", "workspace_archive_receive.py")]
        need(set(required) <= seen, "Keep the complete original importer/native receiving source cohort")
        need(Path(__file__).resolve() == self.checkout / "products/ntico/bdnb-territory/prepare_receiving.py",
             "Run this join from the same complete selected checkout")
        for directory in (self.checkout / NATIVE, self.checkout / ANALYSIS):
            sys.path.insert(0, str(directory))
        source = importlib.import_module("bdnb_source")
        receiving = importlib.import_module("bdnb_receiving")
        for module, name in ((source, "bdnb_source.py"), (receiving, "bdnb_receiving.py")):
            need(Path(module.__file__).resolve() == self.checkout / ANALYSIS / name,
                 "Imported another checkout's original API")
        # Receive the actual imported local closure against the already verified
        # complete roster, including original package __init__ and support code.
        for module in list(sys.modules.values()):
            origin = getattr(module, "__file__", None)
            if not origin:
                continue
            location = Path(origin).resolve()
            if location.is_relative_to(self.checkout):
                need(str(location.relative_to(self.checkout)) in seen,
                     "Imported original dependency is absent from selected source roster: " + str(location))
        return source, receiving

    def acquisition(self):
        path = absolute(self.input["acquisition_complete"])
        complete, pin = self.own_json(path)
        root = path.parent
        need(isinstance(complete, dict) and path.name == "complete.json" and complete.get("schema") ==
             "commons.bdnb-nord-sources-complete.v1"
             and complete.get("operation_id") == ACQUISITION
             and complete.get("state") == "COMPLETE_SOURCE_RECEIVING"
             and complete.get("department") == "59",
             "Select the original completed Nord acquisition")
        # Relative source members make a complete retained root relocatable.
        # The old root string stays in custody and is never rewritten.
        need(isinstance(complete.get("root"), str) and complete["root"],
             "Keep the acquisition's original root identity")
        dataset = complete["publisher_metadata"]
        dataset_body = self.verify_file(member(root, dataset["path"]), dataset["identity"], json_file=True)
        need(complete.get("license") == dataset_body.get("license"),
             "The original publisher license differs from its full retained metadata")
        need(isinstance(complete.get("editions"), list) and len(complete["editions"]) == 2,
             "Keep both complete selected Nord editions")
        need(isinstance(complete.get("saved_files"), list),
             "Keep the original source saving/retention receipts")
        self.saved_files = complete["saved_files"]
        selected = {}
        for edition in complete["editions"]:
            chosen = edition["selected"]
            key = chosen["directory"]
            need(key in EDITIONS and key not in selected
                 and (chosen["millesime"], chosen["version"]) == EDITIONS[key],
                 "The original release pair differs")
            selected[key] = edition
        need(set(selected) == set(EDITIONS), "The complete original release pair is missing")
        return root, complete, pin, selected

    def saved_original(self, root, path, pin):
        relative = str(path.relative_to(root))
        matches = [item for item in self.saved_files
                   if item.get("path") == relative and identity(item) == pin
                   and (item.get("status") == "retained_local" or
                        (item.get("status") == "succeeded" and item.get("file_id")
                         and item.get("library_file_id")))]
        need(matches, "Original complete source receipt differs: " + relative)
        return matches

    def prepare(self):
        source, receiving = self.modules()
        root, complete, acquisition_pin, acquired = self.acquisition()
        selections = self.input["editions"]
        need(isinstance(selections, list) and len(selections) == 2,
             "Select both actual edition dictionary/format bindings")
        descriptors, imports, custody = {}, [], []
        identifiers = {"request_id": set(), "edition_id": set()}
        directories = set()
        for selected in selections:
            need(isinstance(selected, dict) and set(selected) == {
                "directory", "request_id", "edition_id", "dictionary", "table_semantics"},
                "Invalid complete edition binding")
            key = selected["directory"]
            need(key in acquired and key not in directories, "Duplicate or unselected edition binding")
            directories.add(key)
            for field in ("request_id", "edition_id"):
                value = selected[field]
                need(isinstance(value, str) and ID.fullmatch(value) and value not in identifiers[field],
                     "Keep unique original UUID32 import and edition IDs")
                identifiers[field].add(value)
            original = acquired[key]
            chosen = original["selected"]
            for field in ("archive", "metadata", "dictionary"):
                download = original[field]
                need(download["state"] == "COMPLETE", "An original edition file is incomplete")
                self.verify_file(member(root, download["path"]), download["identity"])
            workbook = original["dictionary"]
            dictionary_index_path = member(root, original["dictionary_index"])
            dictionary_index, dictionary_index_pin = self.own_json(dictionary_index_path)
            dictionary_receipts = self.saved_original(root, dictionary_index_path, dictionary_index_pin)
            need(dictionary_index["original"] == {
                "path": workbook["path"], **identity(workbook["identity"])},
                "The whole dictionary index belongs to another original workbook")
            need(isinstance(dictionary_index.get("worksheets"), list)
                 and dictionary_index["worksheets"], "Keep the complete workbook worksheet index")
            dictionary_binding = selected["dictionary"]
            need(isinstance(dictionary_binding, dict) and set(dictionary_binding) == {
                "path", "bytes", "sha256", "workbook_sha256", "provenance"},
                "Select the complete edition-specific normalized dictionary and its original workbook")
            need(dictionary_binding["workbook_sha256"] == workbook["identity"]["sha256"]
                 and isinstance(dictionary_binding["provenance"], dict)
                 and dictionary_binding["provenance"],
                 "Keep the actual matching-workbook mapping provenance")
            dictionary_path = absolute(dictionary_binding["path"])
            dictionary = self.verify_file(dictionary_path, dictionary_binding, json_file=True)
            inventory = original["inventory"]
            need(inventory.get("schema") == "commons.bdnb-source-archive.v1"
                 and inventory.get("operation_id") == ACQUISITION
                 and inventory["archive"] == {
                     "path": original["archive"]["path"], **identity(original["archive"]["identity"])},
                 "Original inventory/archive binding differs")
            inventory_path = member(root, key + "/archive-members.json")
            stored_inventory, inventory_pin = self.own_json(inventory_path)
            need(stored_inventory == inventory, "Complete acquisition inventory changed")
            inventory_receipts = self.saved_original(root, inventory_path, inventory_pin)
            if "publisher_archive_assertion" in original:
                assertion = original["publisher_archive_assertion"]
                need(identity(assertion) == identity(original["archive"]["identity"])
                     and assertion["archive_url"] == chosen["archive_url"]
                     and assertion["metadata_url"] == chosen["metadata_url"],
                     "Original publisher archive assertion differs")
            semantics = selected["table_semantics"]
            tables = inventory["selected_tables"]
            need(isinstance(semantics, dict) and set(semantics) == {table["table"] for table in tables},
                 "Select format semantics for every actually received table")
            output_tables = []
            for table in tables:
                name = table["table"]
                path = member(root, table["path"])
                self.verify_file(path, table)
                profile_path = member(root, key + "/" + name + ".profile.json")
                profile, profile_pin = self.own_json(profile_path)
                profile_receipts = self.saved_original(root, profile_path, profile_pin)
                need(profile == table, "Full source table/profile binding changed")
                observed = table["observed_csv"]
                parser_receiving = compatible_csv(path, observed)
                settings = semantics[name]
                need(isinstance(settings, dict) and set(settings) == {
                    "null_values", "geometry_encoding", "extra_fields", "provenance"}
                    and isinstance(settings["provenance"], dict) and settings["provenance"],
                    "Retain the selected table semantics and source provenance")
                entry = {"table": name, "path": str(path), **identity(table),
                         "format": "csv", "delimiter": observed["delimiter"], "encoding": "utf-8",
                         "null_values": settings["null_values"],
                         "geometry_encoding": settings["geometry_encoding"],
                         "extra_fields": settings["extra_fields"]}
                output_tables.append(entry)
                custody.append({"edition": key, "table": name, "path": str(path),
                                "profile": profile_pin, "archive_member": table["archive_member"],
                                "observed_csv": observed, "parser_receiving": parser_receiving,
                                "semantics": settings, "saved_profile": profile_receipts})
            descriptor = {"schema": "stellar-forge.bdnb-source.v1",
                "title": "BDNB Nord 59 — " + chosen["millesime"], "publisher": "CSTB",
                "source_url": chosen["archive_url"], "license": complete["license"],
                "captured_at": complete["completed_at"], "millesime": chosen["millesime"],
                "structure_version": chosen["version"],
                "scope": {"kind": "department", "codes": ["59"], "description": "Nord (59), complete original department"},
                "tables": output_tables, "dictionary": dictionary}
            descriptor = source.normalize_descriptor(descriptor)
            descriptors[key] = descriptor
            imports.append({"request_id": selected["request_id"], "action": "bdnb.import",
                            "body": {"edition_id": selected["edition_id"], "descriptor": descriptor}})
            custody.append({"edition": key, "whole_dictionary": workbook,
                "dictionary_index": dictionary_index_pin, "saved_dictionary_index": dictionary_receipts,
                "normalized_dictionary": dictionary_binding, "saved_inventory": inventory_receipts,
                "inventory": inventory_pin, "absent_core_tables": inventory["absent_core_tables"],
                "original_selection": chosen})
        compiled = None
        if self.input["receiving"] is not None:
            compiled = parse(encoded(self.input["receiving"]))
            need(isinstance(compiled, dict) and "source_files" not in compiled and "checkout" not in compiled,
                 "Source checkout/roster are bound once by this join")
            compiled["checkout"] = str(self.checkout)
            compiled["source_files"] = self.input["source_files"]
            seen = set()
            by_request = {item["request_id"]: item for item in imports}
            for side in ("producer_actions", "customer_actions"):
                need(isinstance(compiled.get(side), list), "Keep the complete actual receiving actions")
                for index, action in enumerate(compiled[side]):
                    need(isinstance(action, dict), "Invalid original receiving action")
                    if action.get("action") != "bdnb.import":
                        continue
                    expected = by_request.get(action.get("request_id"))
                    need(expected is not None and action["request_id"] not in seen
                         and action.get("body") == {"edition_id": expected["body"]["edition_id"]},
                         "Select each original import by its exact retained request/edition ID")
                    seen.add(action["request_id"])
                    compiled[side][index] = expected
            need(seen == set(by_request), "The complete receiving course must select both original imports")
            compiled = receiving.validate_input(compiled)
        manifest = {"schema": SCHEMA + "/prepared", "operation_id": ACQUISITION,
            "input": {"path": str(self.input_path), **self.input_identity},
            "acquisition": {"path": self.input["acquisition_complete"], **acquisition_pin,
                            "original_root": complete["root"], "receiving_root": str(root)},
            "source_files": self.input["source_files"], "custody": custody,
            "verified_original_files": [{"path": path, **pin} for path, pin in sorted(self.files.items())],
            "state": "COMPLETE_INPUT_PREPARATION",
            "receiving_input_included": compiled is not None}
        return source, {"join-input.json": self.input, "descriptors.json": descriptors,
                        "import-actions.json": imports,
                        **({"receiving-input.json": compiled} if compiled is not None else {}),
                        "source-custody.json": manifest}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args(argv)
    source, outputs = Join(args.input).prepare()
    output = Path(args.output).expanduser()
    need(output.is_absolute() and output.resolve() == output,
         "Select a canonical absolute private output directory")
    source.folder(output)
    received = []
    for name, value in outputs.items():
        path = output / name
        pin = source.publish(path, encoded(value))
        received.append({"path": str(path), **pin})
    print(json.dumps({"schema": SCHEMA + "/result", "state": "COMPLETE_INPUT_PREPARATION",
                      "operation_id": ACQUISITION, "files": received}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
