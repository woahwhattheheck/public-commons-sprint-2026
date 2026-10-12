#!/usr/bin/env python3
"""MIT. Open the complete retained Zenodo 2026-10-11 source case in the OAI console."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import sys
import sqlite3
import tempfile
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from workspace import Workspace
from harvest import InputError

ARCHIVE_SHA256 = "a924e1ecbe4452615a913270615d5de9d93756effa196ee051ea6279dd67a1bb"
BASE_URL = "https://zenodo.org/oai2d"
IDS = {
    "Identify": "adc6-oai-zenodo-identify",
    "ListMetadataFormats": "adc6-oai-zenodo-formats",
    "ListSets": "adc6-oai-zenodo-sets",
    "ListRecords": "adc6-oai-zenodo-records-20261011-00",
}
SELECTION = {
    "metadataPrefix": "oai_datacite",
    "from": "2026-10-11T00:00:00Z",
    "until": "2026-10-11T01:00:00Z",
}
EDITION = "94a107419b4165ad17b97990ed92020ca4b59eda0a8f7d316c747b283150736e"
BUILD = "9955715deb003041798248eb47fb8835cc24803c50176385eb0cf17b0cc8fd11"
SNAPSHOT = "603af5405806a295a068856478c86612c237e7137770cc3514cc4009ed95dd0c"
NOTE = ("Reviewed the complete original Zenodo oai_datacite population for "
        "2026-10-11T00:00:00Z through 2026-10-11T01:00:00Z: five original pages, "
        "231 active records and no deleted headers. Original repository identifiers, "
        "datestamps and metadata remain unchanged.")

def digest(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as source:
        while block := source.read(65536):
            h.update(block)
    return h.hexdigest()

def open_case(archive_path, directory, export=None, backup=None):
    archive_path = Path(archive_path)
    if not archive_path.is_file() or archive_path.is_symlink() or digest(archive_path) != ARCHIVE_SHA256:
        raise InputError("Use the unchanged adc6-oai-records-20261011.zip source archive")
    directory = Path(directory)
    with zipfile.ZipFile(archive_path) as archive:
        if len(archive.namelist()) != len(set(archive.namelist())):
            raise InputError("The capture archive has duplicate members")
        manifest = json.loads(archive.read("manifest.json"))
        if manifest["baseURL"] != BASE_URL:
            raise InputError("The retained repository differs from this worked case")
        entries = manifest["entries"]
        for entry in entries:
            body = archive.read(entry["file"])
            if len(body) != entry["bytes"] or hashlib.sha256(body).hexdigest() != entry["sha256"]:
                raise InputError("An original response differs from its capture manifest")
        ws = Workspace(directory, create=not (directory / "workspace.json").exists())
        try:
            repository = ws.add_repository(BASE_URL, "Zenodo repository metadata", 2.1)
            selections = {}
            for entry in entries:
                verb = entry["params"]["verb"]
                if verb not in IDS:
                    raise InputError("The capture contains an unexpected operation")
                arguments = {k: v for k, v in entry["params"].items() if k != "verb"}
                if "resumptionToken" not in arguments:
                    selections[verb] = arguments
                if verb not in selections:
                    raise InputError("A continuation has no original selection")
                if verb == "ListRecords" and selections[verb] != SELECTION:
                    raise InputError("The original selected population changed")
                operation = ws.start(repository["id"], verb, selections[verb], IDS[verb])
                requests = ws.requests(operation["id"], 0, 200)["items"]
                existing = [r for r in requests if r.get("state") == "PARSED"
                            and r.get("response", {}).get("sha256") == entry["sha256"]
                            and r["url"] == entry["url"]]
                if existing:
                    continue
                headers = entry["headers"]
                pairs = list(headers.items()) if isinstance(headers, dict) else headers
                with tempfile.NamedTemporaryFile(dir=ws.area / "tmp") as response:
                    response.write(archive.read(entry["file"]))
                    response.flush()
                    operation = ws.ingest(operation["id"], response.name, entry["url"],
                        entry["status"], pairs, entry.get("finalURL"), entry["utc"])
                if operation["status"] not in {"COMPLETE", "READY"}:
                    raise InputError(operation.get("lastError") or "Review the captured operation")
            operation = ws.operation(IDS["ListRecords"])
            if operation["status"] != "COMPLETE" or operation["pageCount"] != 5:
                raise InputError("The five original record pages are not complete")
            retained = ws.db.execute("SELECT id FROM oai_editions WHERE id=?", (EDITION,)).fetchone()
            if retained:
                edition = ws.edition(EDITION)
                mapping = ws.xml.plan("7b0d103be71b603af218b1dee55628d450e52550c09723a2d84308b1b8d5af19")
            else:
                preview = ws.preview(operation["id"])
                if not preview["ready"] or preview["activeRecords"] != 231 or preview["deletedRecords"] != 0:
                    raise InputError("The completed edition differs from the original population")
                edition = ws.review(preview["id"], preview["id"], "ADC6", NOTE)
                mapping = ws.save_mapping(ws.metadata_mapping(edition["id"], "zenodo_datacite_records"))
            build = ws.build(edition["id"], mapping["id"])
            if edition["id"] != EDITION or build["id"] != BUILD or build["datasetSnapshot"] != SNAPSHOT:
                raise InputError("The reopened edition, mapping or native dataset changed")
            result = {
                "workspace": str(directory.resolve()), "repositoryId": repository["id"],
                "operationId": operation["id"], "editionId": edition["id"],
                "mappingId": mapping["id"], "buildId": build["id"],
                "rows": build["rowCount"], "datasetSnapshot": build["datasetSnapshot"],
            }
            if export:
                result["export"] = ws.export_source(build["id"], export)
            if backup:
                result["backup"] = ws.backup(backup)
            return result
        finally:
            ws.close()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", required=True)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--export", help="New directory for the complete portable publisher source")
    parser.add_argument("--backup", help="New filename for the complete private workspace backup")
    parser.add_argument("--serve", action="store_true")
    parser.add_argument("--port", type=int, default=0)
    args = parser.parse_args()
    result = open_case(args.archive, args.workspace, args.export, args.backup)
    print(json.dumps(result), flush=True)
    if args.serve:
        from server import serve
        serve(args.workspace, args.port)

if __name__ == "__main__":
    try:
        main()
    except (InputError, OSError, ValueError, KeyError, sqlite3.Error, zipfile.BadZipFile) as error:
        print(json.dumps({"error": str(error)}), file=sys.stderr)
        raise SystemExit(2)
