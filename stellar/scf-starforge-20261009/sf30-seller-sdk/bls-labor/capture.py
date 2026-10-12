#!/usr/bin/env python3
"""Retain original BLS captures and atomically select a verified local source.

Only capture performs network I/O. Import preserves original data and receipt
bytes. A completed capture is immutable; resume reuses complete verified files.
"""
from __future__ import annotations

import argparse
import contextlib
import copy
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import sys
import tempfile
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
import zipfile

SCHEMA = "stellar-forge.bls-labor-capture.v1"
SOURCE_SCHEMA = "stellar-forge.bls-labor-source.v1"
MANIFEST = "_bls/capture-manifest.json"
HEX = re.compile(r"^[0-9a-f]{64}$")
LAUS_ROLES = {
    "la.area": "laus-area", "la.series": "laus-series",
    "la.measure": "laus-measure", "la.footnote": "laus-footnote",
}


class BlsError(Exception):
    pass


def require(condition, message):
    if not condition:
        raise BlsError(message)


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True,
                       separators=(",", ":"), allow_nan=False) + "\n").encode("utf-8")


def utc_now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def relative_path(value):
    require(isinstance(value, str) and 0 < len(value) <= 600
            and not re.search(r"[\\\\:\x00-\x1f\x7f]", value),
            "Inventory path must be a relative POSIX path")
    path = PurePosixPath(value)
    require(not path.is_absolute() and value == path.as_posix()
            and all(p not in ("", ".", "..") for p in value.split("/")),
            "Inventory path is not normalized: " + value)
    return value


def checked_path(value, exists=True):
    path = Path(os.path.abspath(os.fspath(value)))
    for part in (path, *path.parents):
        try:
            mode = part.lstat().st_mode
        except FileNotFoundError:
            require(not exists or part != path, "Missing file or directory: " + str(path))
            continue
        require(not stat.S_ISLNK(mode), "Symlink is not a retained source: " + str(part))
    if exists:
        require(path.exists(), "Missing file or directory: " + str(path))
    return path


def member(directory, value):
    return checked_path(Path(directory) / relative_path(value))


def open_regular(path):
    path = checked_path(path)
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    try:
        require(stat.S_ISREG(os.fstat(fd).st_mode), "Source is not a regular file: " + str(path))
        return os.fdopen(fd, "rb")
    except BaseException:
        os.close(fd)
        raise


def file_identity(path, limit):
    with open_regular(path) as stream:
        before = os.fstat(stream.fileno())
        require(before.st_size <= limit, "Source exceeds the declared byte limit: " + str(path))
        digest = hashlib.sha256()
        count = 0
        while True:
            block = stream.read(1024 * 1024)
            if not block:
                break
            count += len(block)
            require(count <= limit, "Source grew beyond the declared byte limit")
            digest.update(block)
        after = os.fstat(stream.fileno())
    require((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns)
            == (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns)
            and count == before.st_size, "Source changed while being read: " + str(path))
    return {"bytes": count, "sha256": digest.hexdigest()}


def read_bytes(path, limit):
    with open_regular(path) as stream:
        data = stream.read(limit + 1)
    require(len(data) <= limit, "JSON/source member exceeds its declared byte limit")
    return data


def parse_json(data, description):
    try:
        value = json.loads(data.decode("utf-8"))
    except (UnicodeError, ValueError) as exc:
        raise BlsError("Invalid " + description + ": " + str(exc)) from exc
    require(isinstance(value, dict), description + " must be an object")
    return value


def load_contract():
    return parse_json(read_bytes(Path(__file__).with_name("contract.json"), 1024 * 1024),
                      "BLS contract")


def selection_from(contract, path=None):
    value = copy.deepcopy(contract["selection"]) if path is None else parse_json(
        read_bytes(path, contract["limits"]["max_manifest_bytes"]), "selection")
    require(isinstance(value, dict) and set(value) == {"counties", "laus", "qcew"}
            and isinstance(value["laus"], dict) and isinstance(value["qcew"], dict),
            "Selection needs counties, laus and qcew")
    require(set(value["laus"]) == {"years", "periods", "measures", "seasonal"},
            "LAUS selection fields do not match the contract")
    require(set(value["qcew"]) == {"periods", "ownership_codes", "industry_codes",
                                  "size_codes", "metrics"},
            "QCEW selection fields do not match the contract")
    arrays = [value["counties"], *value["laus"].values(), *value["qcew"].values()]
    for values in arrays:
        require(isinstance(values, list) and 0 < len(values) <= 10000,
                "Every selection dimension must be a nonempty array")
        require(len({json.dumps(v, sort_keys=True) for v in values}) == len(values),
                "Selection dimension contains duplicate values")
    require(all(isinstance(v, str) and re.fullmatch(r"\d{5}", v) for v in value["counties"]),
            "Counties must be five-character FIPS strings")
    require(all(type(v) is int and 1900 <= v <= 2200 for v in value["laus"]["years"]),
            "LAUS years must be integers from 1900 through 2200")
    require(all(isinstance(v, str) and re.fullmatch(r"M(?:0[1-9]|1[0-3])", v)
                for v in value["laus"]["periods"]), "Invalid LAUS period")
    require(all(v in ("03", "04", "05", "06") for v in value["laus"]["measures"]),
            "County LAUS projections support measures 03, 04, 05 and 06")
    require(all(v in ("S", "U") for v in value["laus"]["seasonal"]), "Invalid seasonal code")
    for period in value["qcew"]["periods"]:
        require(isinstance(period, dict) and set(period) == {"year", "quarter"}
                and type(period["year"]) is int and 1975 <= period["year"] <= 2200
                and type(period["quarter"]) is int and 1 <= period["quarter"] <= 4,
                "QCEW periods need a supported integer year and quarter 1 through 4")
    for key in ("ownership_codes", "industry_codes", "size_codes"):
        pattern = r"[A-Za-z0-9-]+" if key == "industry_codes" else r"\d+"
        require(all(isinstance(v, str) and re.fullmatch(pattern, v)
                    for v in value["qcew"][key]), "Invalid QCEW " + key)
    require(all(v in contract["selection"]["qcew"]["metrics"] for v in value["qcew"]["metrics"]),
            "QCEW metrics must be declared by the current quarterly contract")
    return value


def url_role(url):
    require(isinstance(url, str), "Source receipt is missing its official URL")
    parsed = urlsplit(url)
    require(parsed.scheme == "https" and not parsed.username and not parsed.password
            and parsed.port in (None, 443) and not parsed.query and not parsed.fragment,
            "BLS source requires a direct official HTTPS URL")
    if parsed.hostname == "download.bls.gov" and parsed.path.startswith("/pub/time.series/la/"):
        name = parsed.path.removeprefix("/pub/time.series/la/")
        if name in LAUS_ROLES:
            return {"role": LAUS_ROLES[name]}
        if re.fullmatch(r"la\.data\.\d+\.[A-Za-z][A-Za-z0-9._-]*", name):
            return {"role": "laus-data"}
    match = re.fullmatch(r"/cew/data/api/(\d{4})/([1-4]|a)/area/([A-Za-z0-9_-]+)\.csv",
                         parsed.path)
    if parsed.hostname == "data.bls.gov" and match:
        return {"role": "qcew-data", "year": int(match[1]),
                "quarter": 0 if match[2] == "a" else int(match[2]),
                "area_fips": match[3]}
    raise BlsError("URL is not a supported official LAUS or QCEW source: " + url)


def source_entry(receipt, path, receipt_path):
    require(receipt.get("status") == 200, "Capture receipt must record HTTP 200")
    require(isinstance(receipt.get("sha256"), str) and HEX.fullmatch(receipt["sha256"]),
            "Capture receipt must retain its SHA256")
    require(type(receipt.get("bytes")) is int and receipt["bytes"] >= 0,
            "Capture receipt must retain its byte length")
    url = receipt.get("url")
    identity = url_role(url)
    require(receipt.get("final_url", url) == url,
            "Captured receipt must bind the exact requested official URL")
    require(isinstance(receipt.get("retrieved_at"), str) and receipt["retrieved_at"],
            "Capture receipt must retain its retrieval timestamp")
    if receipt.get("file") is not None:
        require(receipt["file"] == PurePosixPath(path).name,
                "Receipt filename differs from its adjacent raw source")
    return {**identity, "path": relative_path(path), "receipt_path": relative_path(receipt_path),
            "url": url, "retrieved_at": receipt["retrieved_at"],
            "release_vintage": receipt.get("release_vintage") or receipt.get("last_modified") or ""}


def validate_source_set(sources, selection):
    roles = [item["role"] for item in sources]
    for role in LAUS_ROLES.values():
        require(roles.count(role) == 1, "Capture needs exactly one original " + role + " definition")
    require("laus-data" in roles, "Capture needs at least one original LAUS state data file")
    periods = {(s.get("year"), s.get("quarter"), s.get("area_fips"))
               for s in sources if s["role"] == "qcew-data"}
    wanted = {(p["year"], p["quarter"], area) for p in selection["qcew"]["periods"]
              for area in selection["counties"]}
    require(wanted.issubset(periods),
            "Capture is missing selected QCEW year/quarter/area sources: "
            + json.dumps(sorted(wanted - periods)))
    require(len({s["path"] for s in sources}) == len(sources), "Duplicate source paths")


def verify_capture(directory, contract=None):
    contract = contract or load_contract()
    directory = checked_path(directory)
    limits = contract["limits"]
    raw = read_bytes(member(directory, MANIFEST), limits["max_manifest_bytes"])
    manifest = parse_json(raw, "capture manifest")
    require(manifest.get("schema") == SCHEMA, "Unsupported capture manifest schema")
    prefix = manifest.get("source_prefix")
    require(prefix == "" or isinstance(prefix, str) and prefix.endswith("/")
            and relative_path(prefix[:-1]) + "/" == prefix, "Invalid source_prefix")
    # Validate custom values using the same schema without creating a side file.
    selection = validate_selection_value(manifest.get("selection"), contract)
    files = manifest.get("files")
    require(isinstance(files, list) and 0 < len(files) <= limits["max_files"],
            "Capture manifest file inventory is missing or too large")
    inventory = {}
    total = 0
    for entry in files:
        require(isinstance(entry, dict) and set(entry) == {"path", "bytes", "sha256"},
                "Inventory members require exactly path, bytes and sha256")
        path = relative_path(entry["path"])
        require(path != MANIFEST and path not in inventory, "Duplicate or self-inventoried manifest path")
        require(type(entry["bytes"]) is int and entry["bytes"] >= 0
                and isinstance(entry["sha256"], str) and HEX.fullmatch(entry["sha256"]),
                "Invalid inventory file identity")
        actual = file_identity(member(directory, path), limits["max_source_file_bytes"])
        require(actual == {"bytes": entry["bytes"], "sha256": entry["sha256"]},
                "Retained source identity mismatch: " + path)
        total += actual["bytes"]
        require(total <= limits["max_capture_bytes"], "Capture exceeds total byte limit")
        inventory[path] = entry
    sources = manifest.get("sources")
    require(isinstance(sources, list), "Capture source list is missing")
    for source in sources:
        require(isinstance(source, dict) and source.get("path") in inventory
                and source.get("receipt_path") in inventory,
                "Every source must have retained raw bytes and its original receipt")
        receipt = parse_json(read_bytes(member(directory, source["receipt_path"]),
                                        limits["max_manifest_bytes"]), "capture receipt")
        require(source_entry(receipt, source["path"], source["receipt_path"]) == source,
                "Manifest source differs from its retained receipt")
        require(receipt["bytes"] == inventory[source["path"]]["bytes"]
                and receipt["sha256"] == inventory[source["path"]]["sha256"],
                "Original receipt does not bind the retained raw source")
    validate_source_set(sources, selection)
    return {"directory": directory, "manifest": manifest, "manifest_bytes": raw,
            "capture_sha256": hashlib.sha256(raw).hexdigest(), "inventory": inventory,
            "contract": contract}


def validate_selection_value(value, contract):
    # selection_from applies one contract for CLI input and retained manifests.
    candidate = dict(contract)
    candidate["selection"] = value
    validated = selection_from(candidate)
    require(all(v in contract["selection"]["qcew"]["metrics"] for v in validated["qcew"]["metrics"]),
            "Retained metrics are not supported by the current quarterly contract")
    return validated


def load_source(path, contract=None):
    contract = contract or load_contract()
    path = checked_path(path)
    require(path.is_absolute(), "Source JSON path must be absolute")
    raw = read_bytes(path, contract["limits"]["max_manifest_bytes"])
    source = parse_json(raw, "source JSON")
    require(set(source) == {"schema", "capture", "captureSha256"}
            and source["schema"] == SOURCE_SCHEMA, "Unsupported source JSON contract")
    capture_path = relative_path(source["capture"])
    require(capture_path == MANIFEST or capture_path.endswith("/" + MANIFEST),
            "Source capture must point to an original _bls/capture-manifest.json")
    manifest_path = member(path.parent, capture_path)
    context = verify_capture(manifest_path.parent.parent, contract)
    require(source["captureSha256"] == context["capture_sha256"],
            "Source JSON captureSha256 differs from the retained manifest")
    context.update({"source": source, "source_bytes": raw, "source_path": path,
                    "source_hash": hashlib.sha256(raw).hexdigest()})
    return context


@contextlib.contextmanager
def capture_lock(directory):
    directory = checked_path(directory, exists=False)
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    metadata = directory / "_bls"
    checked_path(metadata, exists=False)
    metadata.mkdir(mode=0o700, exist_ok=True)
    fd = os.open(metadata / "capture.lock", os.O_RDWR | os.O_CREAT
                 | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        require(stat.S_ISREG(os.fstat(fd).st_mode), "Capture lock is not a regular file")
        fcntl.flock(fd, fcntl.LOCK_EX)
        yield directory
    finally:
        os.close(fd)


def write_member(directory, path, stream, limit, expected=None):
    destination = Path(directory) / relative_path(path)
    checked_path(destination, exists=False)
    destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    if destination.exists() and expected:
        actual = file_identity(destination, limit)
        require(actual == expected, "Resume found different retained bytes: " + path)
        return {"path": path, **actual}
    descriptor, temporary = tempfile.mkstemp(prefix=".bls-part-", dir=destination.parent)
    digest = hashlib.sha256()
    count = 0
    try:
        with os.fdopen(descriptor, "wb") as output:
            while True:
                block = stream.read(min(1024 * 1024, limit - count + 1))
                if not block:
                    break
                count += len(block)
                require(count <= limit, "Incoming source exceeds its byte limit: " + path)
                output.write(block)
                digest.update(block)
            output.flush()
            os.fsync(output.fileno())
        actual = {"bytes": count, "sha256": digest.hexdigest()}
        require(expected is None or actual == expected, "Incoming source differs from its original receipt: " + path)
        if destination.exists():
            require(file_identity(destination, limit) == actual,
                    "Completed source cannot be overwritten: " + path)
        else:
            os.link(temporary, destination)
        return {"path": path, **actual}
    finally:
        Path(temporary).unlink(missing_ok=True)


def write_bytes(directory, path, data, limit):
    import io
    identity = {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
    return write_member(directory, path, io.BytesIO(data), limit, identity)


def begin_request(directory, request, contract):
    path = "_bls/capture-request.json"
    existing = directory / path
    if existing.exists():
        old = parse_json(read_bytes(existing, contract["limits"]["max_manifest_bytes"]),
                         "capture resume request")
        require(old["request"] == request, "Capture directory already belongs to another import/request")
        return old["created_at"]
    created_at = utc_now()
    write_bytes(directory, path, json_bytes({"request": request, "created_at": created_at}),
                contract["limits"]["max_manifest_bytes"])
    return created_at


def finish_capture(directory, sources, inventory, selection, provenance, contract, catalog_keys=None):
    validate_source_set(sources, selection)
    manifest = {"schema": SCHEMA, "source_prefix": "", "selection": selection,
                "sources": sorted(sources, key=lambda s: s["path"]),
                "files": sorted(inventory, key=lambda f: f["path"]), "provenance": provenance}
    if catalog_keys:
        manifest["catalog_keys"] = catalog_keys
    require(len(manifest["files"]) <= contract["limits"]["max_files"],
            "Too many retained capture files")
    require(sum(f["bytes"] for f in manifest["files"]) <= contract["limits"]["max_capture_bytes"],
            "Capture exceeds total byte limit")
    write_bytes(directory, MANIFEST, json_bytes(manifest), contract["limits"]["max_manifest_bytes"])
    return verify_capture(directory, contract)


def context_result(context, resumed=False):
    return {"schema": SCHEMA, "directory": str(context["directory"]),
            "manifest": str(context["directory"] / MANIFEST),
            "captureSha256": context["capture_sha256"], "resumed": resumed,
            "sourceCount": len(context["manifest"]["sources"]),
            "files": context["manifest"]["files"], "selection": context["manifest"]["selection"]}


def import_capture(input_path, directory, selection, contract, expected_archive_sha256=None):
    input_path = checked_path(input_path)
    limits = contract["limits"]
    archive = None
    try:
        if input_path.is_dir():
            require(expected_archive_sha256 is None, "--expected-archive-sha256 applies only to a ZIP")
            names = []
            for parent, directories, files in os.walk(input_path, followlinks=False):
                directories[:] = [d for d in directories if d != "_bls"
                                  and not (Path(parent) / d).is_symlink()]
                for filename in files:
                    names.append((Path(parent) / filename).relative_to(input_path).as_posix())
                    require(len(names) <= limits["max_files"], "Input tree contains too many files")
            def read_input(name, limit):
                return read_bytes(member(input_path, name), limit)
            def open_input(name):
                return open_regular(member(input_path, name))
            origin = {"kind": "directory", "name": input_path.name}
        else:
            identity = file_identity(input_path, limits["max_capture_bytes"])
            if expected_archive_sha256 is not None:
                require(HEX.fullmatch(expected_archive_sha256) and identity["sha256"] == expected_archive_sha256,
                        "Original archive SHA256 differs from the requested pin")
            archive = zipfile.ZipFile(input_path)
            infos = archive.infolist()
            require(len(infos) <= limits["max_files"], "Input ZIP contains too many members")
            names = [i.filename for i in infos if not i.is_dir()]
            require(len(names) == len(set(names)), "Input ZIP contains duplicate member names")
            for info in infos:
                if info.is_dir():
                    continue
                relative_path(info.filename)
                require(not stat.S_ISLNK(info.external_attr >> 16), "ZIP source member is a symlink")
                require(info.file_size <= limits["max_source_file_bytes"], "ZIP member exceeds byte limit")
            def read_input(name, limit):
                require(archive.getinfo(name).file_size <= limit, "ZIP JSON member exceeds byte limit")
                with archive.open(name) as stream:
                    return stream.read(limit + 1)
            def open_input(name):
                return archive.open(name)
            origin = {"kind": "zip", "name": input_path.name, **identity}
        candidates = []
        indexes = []
        for name in sorted(names):
            if PurePosixPath(name).name in ("SOURCE_CATALOG.json", "BUNDLE_MANIFEST.json"):
                indexes.append(name)
            if not name.endswith(".capture.json"):
                continue
            raw = read_input(name, limits["max_manifest_bytes"])
            receipt = parse_json(raw, "original capture receipt")
            try:
                url_role(receipt.get("url"))
            except (BlsError, ValueError):
                continue
            source_name = name.removesuffix(".capture.json")
            require(source_name in names, "Original receipt has no adjacent raw source: " + name)
            raw_path = "data/" + PurePosixPath(source_name).name
            receipt_path = raw_path + ".capture.json"
            source = source_entry(receipt, raw_path, receipt_path)
            candidates.append((source, source_name, raw, receipt))
        require(candidates, "Input contains no supported original BLS capture receipts")
        require(len({c[0]["path"] for c in candidates}) == len(candidates),
                "Original input contains colliding source filenames")
        request = {"method": "import", "selection": selection, "input": origin,
                   "receipts": [{"path": c[0]["receipt_path"],
                                 "sha256": hashlib.sha256(c[2]).hexdigest()} for c in candidates]}
        with capture_lock(directory) as destination:
            created_at = begin_request(destination, request, contract)
            if (destination / MANIFEST).exists():
                context = verify_capture(destination, contract)
                return context_result(context, True)
            inventory = []
            for source, name, raw, receipt in candidates:
                with open_input(name) as stream:
                    inventory.append(write_member(destination, source["path"], stream,
                                                  limits["max_source_file_bytes"],
                                                  {"bytes": receipt["bytes"], "sha256": receipt["sha256"]}))
                inventory.append(write_bytes(destination, source["receipt_path"], raw,
                                             limits["max_manifest_bytes"]))
            for name in indexes:
                target = "originals/" + PurePosixPath(name).name
                raw = read_input(name, limits["max_manifest_bytes"])
                inventory.append(write_bytes(destination, target, raw, limits["max_manifest_bytes"]))
            context = finish_capture(destination, [c[0] for c in candidates], inventory, selection,
                                     {"method": "import", "input": origin, "created_at": created_at},
                                     contract)
            return context_result(context)
    finally:
        if archive is not None:
            archive.close()


class OfficialRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, newurl):
        url_role(newurl)
        require(newurl == request.full_url,
                "BLS redirect changed the requested official URL")
        return super().redirect_request(request, response, code, message, headers, newurl)


def network_capture(directory, laus_urls, selection, contract):
    require(laus_urls, "Capture requires at least one explicit --laus-url")
    urls = []
    for url in laus_urls:
        require(url_role(url)["role"] == "laus-data", "--laus-url must select original LAUS state data")
        state = urlsplit(url).path.rsplit(".", 1)[-1].lower()
        urls.append((url, "data/bls-la-" + state + ".tsv"))
    urls.extend(("https://download.bls.gov/pub/time.series/la/" + name,
                 "data/bls-" + name.replace(".", "-") + ".tsv") for name in LAUS_ROLES)
    for period in selection["qcew"]["periods"]:
        quarter = "a" if period["quarter"] == 0 else str(period["quarter"])
        for county in selection["counties"]:
            urls.append((f"https://data.bls.gov/cew/data/api/{period['year']}/{quarter}/area/{county}.csv",
                         f"data/bls-qcew-{period['year']}-q{period['quarter']}-{county}.csv"))
    require(len({path for _, path in urls}) == len(urls), "Requested state URLs collide")
    request = {"method": "capture", "urls": urls, "selection": selection}
    limits = contract["limits"]
    opener = build_opener(OfficialRedirect())
    with capture_lock(directory) as destination:
        # JSON normalizes URL tuples for the retained resume identity.
        created_at = begin_request(destination, json.loads(json.dumps(request)), contract)
        if (destination / MANIFEST).exists():
            return context_result(verify_capture(destination, contract), True)
        sources, inventory = [], []
        for url, path in urls:
            receipt_path = path + ".capture.json"
            if (destination / receipt_path).exists():
                raw = read_bytes(member(destination, receipt_path), limits["max_manifest_bytes"])
                receipt = parse_json(raw, "retained capture receipt")
                source = source_entry(receipt, path, receipt_path)
                require(source["url"] == url, "Resume URL differs from retained receipt")
                identity = file_identity(member(destination, path), limits["max_source_file_bytes"])
                require(identity == {"bytes": receipt["bytes"], "sha256": receipt["sha256"]},
                        "Resume source bytes differ from retained receipt")
                inventory.append({"path": path, **identity})
            else:
                # A raw file without a completed receipt belongs to this interrupted
                # request. Preserve it until a complete response can be compared.
                with opener.open(Request(url, headers={"User-Agent": "Starforge-BLS-Source/1.0",
                                                       "Accept": "text/csv,text/plain,*/*"}), timeout=60) as response:
                    require(response.status == 200, "BLS returned HTTP " + str(response.status))
                    require(response.geturl() == url, "BLS response changed the requested official URL")
                    identity = write_member(destination, path, response, limits["max_source_file_bytes"])
                    inventory.append(identity)
                    receipt = {"file": PurePosixPath(path).name, "url": url,
                               "final_url": response.geturl(), "status": response.status,
                               "content_type": response.headers.get("Content-Type", ""),
                               "last_modified": response.headers.get("Last-Modified", ""),
                               "etag": response.headers.get("ETag", ""),
                               "retrieved_at": utc_now(), "bytes": identity["bytes"],
                               "sha256": identity["sha256"]}
                raw = json_bytes(receipt)
                write_bytes(destination, receipt_path, raw, limits["max_manifest_bytes"])
                source = source_entry(receipt, path, receipt_path)
            inventory.append({"path": receipt_path, "bytes": len(raw),
                              "sha256": hashlib.sha256(raw).hexdigest()})
            sources.append(source)
            require(sum(item["bytes"] for item in inventory) <= limits["max_capture_bytes"],
                    "Capture exceeds total byte limit")
        return context_result(finish_capture(destination, sources, inventory, selection,
                                             {"method": "capture", "created_at": created_at}, contract))


def activate_capture(directory, source_path, expected_source_sha256, contract):
    require(expected_source_sha256 == "absent"
            or isinstance(expected_source_sha256, str) and HEX.fullmatch(expected_source_sha256),
            "Activation requires --expected-source-sha256 HASH or absent")
    context = verify_capture(directory, contract)
    source_path = checked_path(source_path, exists=False)
    require(source_path != context["directory"] / MANIFEST
            and not source_path.is_relative_to(context["directory"] / "_bls")
            and all(source_path != context["directory"] / name for name in context["inventory"]),
            "Source activation cannot replace a retained capture member")
    source_path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    capture_relative = os.path.relpath(context["directory"] / MANIFEST, source_path.parent)
    relative_path(capture_relative)
    payload = {"schema": SOURCE_SCHEMA, "capture": capture_relative,
               "captureSha256": context["capture_sha256"]}
    raw = json_bytes(payload)
    fd = os.open(str(source_path) + ".lock", os.O_RDWR | os.O_CREAT
                 | getattr(os, "O_NOFOLLOW", 0), 0o600)
    temporary = None
    try:
        require(stat.S_ISREG(os.fstat(fd).st_mode), "Source activation lock is not a regular file")
        fcntl.flock(fd, fcntl.LOCK_EX)
        exists = source_path.exists()
        current = hashlib.sha256(read_bytes(source_path, contract["limits"]["max_manifest_bytes"])).hexdigest() if exists else "absent"
        target_hash = hashlib.sha256(raw).hexdigest()
        if current == target_hash:
            return {"source": str(source_path), "sourceSha256": current,
                    "captureSha256": context["capture_sha256"], "resumed": True}
        require(current == expected_source_sha256,
                "Source activation conflict; expected " + expected_source_sha256 + ", found " + current)
        descriptor, temporary = tempfile.mkstemp(prefix=".bls-source-", dir=source_path.parent)
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, source_path)
        temporary = None
        directory_fd = os.open(source_path.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
        return {"source": str(source_path), "sourceSha256": target_hash,
                "captureSha256": context["capture_sha256"], "resumed": False}
    finally:
        if temporary:
            Path(temporary).unlink(missing_ok=True)
        os.close(fd)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    imported = commands.add_parser("import", help="Import original public BLS receipts and adjacent source bytes")
    imported.add_argument("--input", required=True)
    imported.add_argument("--directory", required=True)
    imported.add_argument("--selection")
    imported.add_argument("--expected-archive-sha256")
    captured = commands.add_parser("capture", help="Capture official LAUS definitions/state data and selected QCEW slices")
    captured.add_argument("--directory", required=True)
    captured.add_argument("--laus-url", action="append", required=True)
    captured.add_argument("--selection")
    activate = commands.add_parser("activate", help="Atomically select a verified immutable capture")
    activate.add_argument("--directory", required=True)
    activate.add_argument("--source", required=True)
    activate.add_argument("--expected-source-sha256", required=True)
    inspect = commands.add_parser("inspect", help="Read and verify every member of a retained capture")
    inspect.add_argument("--directory", required=True)
    args = parser.parse_args()
    contract = load_contract()
    if args.command == "import":
        result = import_capture(args.input, args.directory, selection_from(contract, args.selection),
                                contract, args.expected_archive_sha256)
    elif args.command == "capture":
        result = network_capture(args.directory, args.laus_url,
                                 selection_from(contract, args.selection), contract)
    elif args.command == "activate":
        result = activate_capture(args.directory, args.source, args.expected_source_sha256, contract)
    else:
        result = context_result(verify_capture(args.directory, contract))
    sys.stdout.buffer.write(json_bytes(result))


if __name__ == "__main__":
    try:
        main()
    except (BlsError, OSError, ValueError, zipfile.BadZipFile) as exc:
        print(json.dumps({"error": "BLS_CAPTURE_FAILED", "message": str(exc)}), file=sys.stderr)
        sys.exit(1)
