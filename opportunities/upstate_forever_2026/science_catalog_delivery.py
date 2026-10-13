#!/usr/bin/env python3
"""Create and receive a portable collection of original scientific sources.

The installed host supplies the authorized repository. The utility retains its
identifiers, scientific metadata and original file bytes without starting jobs.
"""
from __future__ import annotations
import argparse
import copy
import csv
import hashlib
import html
import json
import math
import os
import re
from datetime import datetime, timezone
from contextlib import contextmanager
import errno
from pathlib import Path, PurePosixPath
from urllib.parse import urlsplit, urlunsplit

FORMAT = "eco-intelligence-catalog-v1"
DELIVERY_FORMAT = "eco-science-delivery-v1"
TABLES = {"dataset": "datasets", "job": "jobs", "aoi": "aois", "ensemble": "ensembles"}

class CatalogDeliveryError(ValueError):
    pass

def _json(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":"), allow_nan=False)

def _digest(value):
    return hashlib.sha256(_json(value).encode("utf-8")).hexdigest()

def _load(path):
    with Path(path).open(encoding="utf-8-sig") as source:
        return json.load(source)

def _safe(value):
    if isinstance(value, dict):
        return {str(k): _safe(v) for k, v in value.items()
                if not any(p in str(k).lower() for p in
                           ("password", "secret", "token", "api_key", "authorization", "cookie"))
                and str(k).lower() not in {"path", "output_dir", "workspace_dir"}
                and not str(k).lower().endswith(("_path", "_dir"))}
    if isinstance(value, (list, tuple)):
        return [_safe(v) for v in value]
    if isinstance(value, Path):
        return value.name
    if isinstance(value, float) and not math.isfinite(value):
        return {"nonfinite_value": str(value)}
    if isinstance(value, str) and value.startswith(("https://", "http://")):
        try:
            u = urlsplit(value)
            host = u.hostname or ""
            if ":" in host:
                host = "[" + host + "]"
            if u.port:
                host += ":" + str(u.port)
            return urlunsplit((u.scheme, host, u.path, "", ""))
        except ValueError:
            return "[source URL unavailable]"
    return value

def _file_hash(path):
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()

def _write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".partial")
    with temporary.open("w", encoding="utf-8", newline="\n") as output:
        output.write(_json(value) + "\n")
        output.flush()
        os.fsync(output.fileno())
    os.replace(temporary, path)

def _identity(row, tenant, kind):
    if not isinstance(row, dict) or row.get("tenant_id") != tenant:
        raise CatalogDeliveryError(f"{kind} has an invalid workspace binding.")
    if not isinstance(row.get("id"), str) or not row["id"]:
        raise CatalogDeliveryError(f"{kind} has no original string identifier.")
    return row["id"]

def _member(value):
    if not isinstance(value, str) or not value or "\\" in value:
        raise CatalogDeliveryError("An artifact requires its registered member name.")
    path = PurePosixPath(value)
    if path.is_absolute() or ".." in path.parts or not path.parts:
        raise CatalogDeliveryError("Artifact member leaves its registered job.")
    return path.as_posix()

def _resolve(path, root):
    if not isinstance(path, (str, Path)) or not str(path):
        raise CatalogDeliveryError("A registered file has no retained path.")
    p = Path(path)
    p = (p if p.is_absolute() else root / p).resolve()
    if not p.is_relative_to(root):
        raise CatalogDeliveryError("A registered file leaves its workspace root.")
    if not p.is_file():
        raise CatalogDeliveryError(f"Registered file is unavailable: {p.name}")
    return p

def _companions(path, root):
    candidates = [Path(str(path) + s) for s in (".aux.xml", ".msk", "-wal")]
    if path.suffix.lower() == ".shp":
        candidates += [path.with_suffix(s) for s in (".shx", ".dbf", ".prj", ".cpg", ".qix")]
    found = []
    for p in sorted(set(candidates)):
        if p.is_file():
            p = p.resolve()
            if not p.is_relative_to(root):
                raise CatalogDeliveryError("A companion file leaves its workspace root.")
            found.append(p)
    return found


def _source_companions(datasets):
    """Index native declared members without reading or materializing any file."""
    indexed = {}
    for row in datasets:
        if not isinstance(row, dict):
            continue
        metadata = row.get("metadata") or {}
        if not isinstance(metadata, dict) or metadata.get("native_kind") != "retained_source":
            continue
        binding = metadata.get("source_binding") or {}
        if not isinstance(binding, dict) or binding.get("role") != "companion":
            continue
        key = tuple(binding.get(name) for name in ("collection_id", "source_id", "member"))
        if all(isinstance(value, str) and value for value in key):
            indexed.setdefault(key, []).append(row)
    return indexed

def _declared_companions(row, indexed):
    """Expand only the selected native primary's original declared members."""
    metadata = row.get("metadata") or {}
    if not isinstance(metadata, dict) or metadata.get("native_kind") != "retained_source":
        return []
    binding = metadata.get("source_binding") or {}
    if not isinstance(binding, dict) or binding.get("role") != "primary":
        return []
    source = metadata.get("source")
    if not isinstance(source, dict) or not isinstance(source.get("companions", []), list):
        raise CatalogDeliveryError("The retained source has invalid companion declarations.")
    members = metadata.get("declared_companion_members")
    if members is not None and (not isinstance(members, list)
                               or len(members) != len(source.get("companions", []))):
        raise CatalogDeliveryError("The retained companion member order differs from its source.")
    result, seen = [], set()
    for position, body in enumerate(source.get("companions", [])):
        if not isinstance(body, dict):
            raise CatalogDeliveryError("A declared source companion has no original descriptor.")
        member = _member(body.get("view_path", members[position] if members is not None
                                   else body.get("filename")))
        if members is not None and member != _member(members[position]):
            raise CatalogDeliveryError("The retained companion member differs from its original view.")
        if member in seen:
            raise CatalogDeliveryError("A retained source declares a companion more than once.")
        seen.add(member)
        expected, size = body.get("sha256"), body.get("bytes")
        if (not isinstance(expected, str) or re.fullmatch(r"[0-9a-fA-F]{64}", expected) is None
                or isinstance(size, bool) or not isinstance(size, int) or size < 0):
            raise CatalogDeliveryError("A declared source companion has no original hash and byte count.")
        key = (binding.get("collection_id"), binding.get("source_id"), member)
        matches = indexed.get(key, [])
        if len(matches) > 1:
            raise CatalogDeliveryError("A declared source companion has multiple original datasets: " + member)
        if matches:
            companion = matches[0]
            peer = companion.get("metadata") or {}
            declared = {"path": companion.get("path"), "bytes": companion.get("bytes"),
                        "sha256": companion.get("sha256"), "source_dataset_id": companion["id"],
                        "source_binding": peer["source_binding"]}
            if peer.get("source_record_sha256") != metadata.get("source_record_sha256"):
                raise CatalogDeliveryError("A declared companion belongs to another retained edition: " + member)
        else:
            # A received collection keeps required files separately from the user's
            # selected dataset records, so its exact retained binding reopens here.
            retained = []
            for item in metadata.get("retained_companions", []):
                if not isinstance(item, dict):
                    continue
                peer = item.get("source_binding") or {}
                if (isinstance(peer, dict) and peer.get("role") == "companion"
                        and tuple(peer.get(name) for name in
                                  ("collection_id", "source_id", "member")) == key):
                    retained.append(item)
            if len(retained) != 1:
                raise CatalogDeliveryError("A declared source companion is unavailable: " + member)
            declared = retained[0]
        actual = declared.get("sha256")
        if (not isinstance(actual, str) or actual.lower() != expected.lower()
                or isinstance(declared.get("bytes"), bool) or declared.get("bytes") != size
                or not isinstance(declared.get("source_dataset_id"), str)
                or not declared["source_dataset_id"]):
            raise CatalogDeliveryError("A declared companion differs from its original hash and bytes: " + member)
        result.append({"path": declared.get("path"), "bytes": size, "sha256": expected.lower(),
                       "source_dataset_id": declared["source_dataset_id"],
                       "source_binding": copy.deepcopy(declared["source_binding"])})
    return result

def project_repository(repository, tenants):
    """Capture the exact StoreBackedRepository callbacks, without analyzing files."""
    if not all(callable(getattr(repository, name, None))
               for name in ("read_records", "read_artifacts", "tenant_root")):
        raise CatalogDeliveryError("Use the original StoreBackedRepository callback interface.")
    result = {"format": FORMAT, "tenants": {}}
    for tenant in dict.fromkeys(tenants):
        if not isinstance(tenant, str) or not tenant:
            raise CatalogDeliveryError("Workspace identifier must be a nonempty string.")
        entry = {"root": str(Path(repository.tenant_root(tenant)).resolve())}
        for kind, table in TABLES.items():
            rows, seen = [], set()
            for original in repository.read_records(tenant, kind):
                row = copy.deepcopy(dict(original))
                identifier = _identity(row, tenant, kind)
                if identifier in seen:
                    raise CatalogDeliveryError(f"Duplicate original {kind} identifier.")
                seen.add(identifier)
                if kind == "job":
                    row["artifacts"] = [copy.deepcopy(dict(item))
                                        for item in repository.read_artifacts(tenant, identifier)]
                rows.append(row)
            entry[table] = rows
        result["tenants"][tenant] = entry
    return result

def _selection(refs):
    if refs is None:
        return None
    chosen = set()
    for ref in refs:
        if not isinstance(ref, dict):
            raise CatalogDeliveryError("Selections must be structured original references.")
        tenant, kind, identifier = ref.get("tenant_id"), ref.get("kind"), ref.get("id")
        if not isinstance(tenant, str) or not isinstance(identifier, str) or not identifier:
            raise CatalogDeliveryError("Each selection needs tenant_id and original id.")
        if kind not in {"dataset", "artifact"}:
            raise CatalogDeliveryError("Select datasets or individual registered job artifacts.")
        member = _member(ref.get("member")) if kind == "artifact" else None
        chosen.add((tenant, kind, identifier, member))
    if not chosen:
        raise CatalogDeliveryError("The selected scientific collection is empty.")
    return chosen

def prepare(catalog, allowed_root, refs=None):
    """Resolve selected descriptors without reading model raster cells or table rows."""
    if not isinstance(catalog, dict) or catalog.get("format") != FORMAT:
        raise CatalogDeliveryError("Unrecognized scientific catalog format.")
    allowed_root = Path(allowed_root).resolve()
    chosen, matched = _selection(refs), set()
    output = {"format": FORMAT, "tenants": {}}
    files, index = {}, []
    for tenant, original in catalog.get("tenants", {}).items():
        if not isinstance(tenant, str) or not tenant or not isinstance(original, dict):
            raise CatalogDeliveryError("Invalid workspace catalog record.")
        root = Path(original["root"])
        root = (root if root.is_absolute() else allowed_root / root).resolve()
        if not root.is_relative_to(allowed_root):
            raise CatalogDeliveryError("Workspace root leaves the configured allowed root.")
        slot = hashlib.sha256(tenant.encode("utf-8")).hexdigest()[:24]
        row_out = {"root": "data/" + slot, "datasets": [], "jobs": [], "aois": [], "ensembles": []}
        companion_index = _source_companions(original.get("datasets", []))

        def retain_file(row, kind, identifier, member=None):
            source = _resolve(row.get("path"), root)
            relative = source.relative_to(root).as_posix()
            expected = row.get("sha256")
            if expected is not None and (not isinstance(expected, str) or
                    re.fullmatch(r"[0-9a-fA-F]{64}", expected) is None):
                raise CatalogDeliveryError(f"Invalid retained digest for {source.name}.")
            expected = expected.lower() if expected else None
            dest = row_out["root"] + "/" + relative
            stat = source.stat()
            declared_bytes = row.get("bytes")
            if declared_bytes is not None and (isinstance(declared_bytes, bool) or
                    not isinstance(declared_bytes, int) or declared_bytes != stat.st_size):
                raise CatalogDeliveryError(f"Registered byte count changed: {source.name}")
            descriptor = {"path": dest, "bytes": stat.st_size,
                          "mtime_ns": stat.st_mtime_ns, "sha256": expected}
            prior = files.get(dest)
            if prior and prior["descriptor"]["sha256"] and expected and prior["descriptor"]["sha256"] != expected:
                raise CatalogDeliveryError("Two records bind different hashes to one retained file.")
            if not prior or expected:
                files[dest] = {"source": source, "descriptor": descriptor}
            clean = _safe(row)
            clean["path"] = relative
            if expected:
                clean["sha256"] = expected
            if not isinstance(clean.get("metadata"), dict):
                if clean.get("metadata") is not None:
                    raise CatalogDeliveryError("Scientific metadata must be an object.")
                clean["metadata"] = {}
            companions = {}
            required = [{"path": path} for path in _companions(source, root)]
            declared_members = _declared_companions(row, companion_index)
            required.extend(declared_members)
            if declared_members:
                clean["metadata"]["declared_companion_members"] = [
                    item["source_binding"]["member"] for item in declared_members]
            for declared in required:
                companion = _resolve(declared["path"], root)
                comp_relative = companion.relative_to(root).as_posix()
                comp_dest = row_out["root"] + "/" + comp_relative
                comp_stat, comp_sha = companion.stat(), declared.get("sha256")
                if "bytes" in declared and declared["bytes"] != comp_stat.st_size:
                    raise CatalogDeliveryError("Declared companion byte count changed: " + companion.name)
                prior = files.get(comp_dest)
                if (prior and prior["descriptor"]["sha256"] and comp_sha
                        and prior["descriptor"]["sha256"] != comp_sha):
                    raise CatalogDeliveryError("Original records bind different hashes to one companion.")
                if not prior or comp_sha:
                    files[comp_dest] = {"source": companion, "descriptor": {
                        "path": comp_dest, "bytes": comp_stat.st_size,
                        "mtime_ns": comp_stat.st_mtime_ns, "sha256": comp_sha}}
                retained = {"path": comp_relative, "bytes": comp_stat.st_size}
                if comp_sha:
                    retained["sha256"] = comp_sha
                for key in ("source_dataset_id", "source_binding"):
                    if key in declared:
                        retained[key] = copy.deepcopy(declared[key])
                companions[comp_relative] = {**companions.get(comp_relative, {}), **retained}
            clean["metadata"]["retained_companions"] = [
                companions[key] for key in sorted(companions)]
            index.append({"tenant_id": tenant, "kind": kind, "id": identifier,
                          "member": member, "filename": source.name, "path": dest,
                          "bytes": stat.st_size, "sha256": expected,
                          "metadata": _safe(row.get("metadata") or {})})
            return clean

        for kind, table in TABLES.items():
            seen = set()
            for row in original.get(table, []):
                identifier = _identity(row, tenant, kind)
                if identifier in seen:
                    raise CatalogDeliveryError(f"Duplicate original {kind} identifier.")
                seen.add(identifier)
                if kind == "dataset":
                    key = (tenant, kind, identifier, None)
                    if chosen is not None and key not in chosen:
                        continue
                    matched.add(key)
                    row_out[table].append(retain_file(row, kind, identifier))
                elif kind == "job":
                    artifacts, artifact_seen = [], set()
                    for artifact in row.get("artifacts", []):
                        member = _member(artifact.get("member"))
                        if member in artifact_seen:
                            raise CatalogDeliveryError("Duplicate artifact member in original job.")
                        artifact_seen.add(member)
                        key = (tenant, "artifact", identifier, member)
                        if chosen is not None and key not in chosen:
                            continue
                        matched.add(key)
                        item = retain_file(artifact, "artifact", identifier, member)
                        item["member"] = member
                        artifacts.append(item)
                    if artifacts or chosen is None:
                        kept = _safe(row)
                        kept["artifacts"] = artifacts
                        row_out[table].append(kept)
                else:
                    row_out[table].append(_safe(row))
        if row_out["datasets"] or row_out["jobs"] or chosen is None:
            output["tenants"][tenant] = row_out
    if chosen is not None and chosen != matched:
        missing = [{"tenant_id": t, "kind": k, "id": i, "member": m}
                   for t, k, i, m in sorted(chosen - matched)]
        raise CatalogDeliveryError("Selected original references are absent: " + _json(missing))
    signature = _digest({"catalog": output,
                         "files": [files[k]["descriptor"] for k in sorted(files)]})
    return {"catalog": output, "files": files, "index": index, "input_signature": signature}

def _units(metadata):
    for key in ("units", "unit"):
        if metadata.get(key) is not None:
            return str(metadata[key])
    scientific = metadata.get("scientific")
    if isinstance(scientific, dict):
        for key in ("units", "unit"):
            if scientific.get(key) is not None:
                return str(scientific[key])
    return "Not declared"

def write_reports(directory, catalog, index, *, copied):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    columns = ["tenant_id", "kind", "id", "member", "filename", "bytes", "sha256", "units"]
    with (directory / "inventory.csv").open("w", encoding="utf-8", newline="") as output:
        writer = csv.DictWriter(output, fieldnames=columns)
        writer.writeheader()
        for item in index:
            row = {key: item.get(key) for key in columns}
            row["units"] = _units(item["metadata"])
            row = {k: ("'" + str(v) if isinstance(v, str) and v.startswith(("=", "+", "-", "@"))
                       else v) for k, v in row.items()}
            writer.writerow(row)
    sections = []
    for item in index:
        label = item["metadata"].get("label") or item["filename"]
        provenance = {"workspace": item["tenant_id"], "original_id": item["id"],
                      "member": item.get("member"), "sha256": item.get("sha256"),
                      "source_and_method": _safe(item["metadata"])}
        fields = html.escape(json.dumps({k: v for k, v in provenance.items() if v is not None},
                                        ensure_ascii=False, indent=2, allow_nan=False))
        subtitle = "Input dataset" if item["kind"] == "dataset" else "Registered output"
        sections.append("<article><h2>" + html.escape(str(label)) +
                        "</h2><p class='quiet'>" + subtitle +
                        "</p><dl><dt>Declared units</dt><dd>" +
                        html.escape(_units(item["metadata"])) +
                        "</dd><dt>Original file</dt><dd>" + html.escape(item["filename"]) +
                        "</dd><dt>Bytes</dt><dd>" + format(item["bytes"], ",") +
                        "</dd></dl><details><summary>Source and method details</summary><pre>" +
                        fields + "</pre></details></article>")
    status = ("The selected original files and their companions are included under data/. "
              "Open catalog.json with the delivered directory as the allowed data root."
              if copied else
              "This inventory describes the selected original files. Use the bundle command "
              "to transfer the collection with its original file bytes.")
    page = """<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Scientific source collection</title><style>
:root{color-scheme:light;font:16px/1.55 system-ui,sans-serif;color:#242424;background:#f6f6f6}
body{max-width:1040px;margin:auto;padding:28px}h1{font-size:1.8rem;margin-bottom:8px}
h2{font-size:1.1rem;overflow-wrap:anywhere}article{background:white;border:1px solid #c9c9c9;
padding:20px;margin:16px 0}.quiet{color:#575757;overflow-wrap:anywhere}
dl{display:grid;grid-template-columns:150px 1fr;gap:8px}dt{font-weight:600}
dd{margin:0;overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:.85rem}
summary{cursor:pointer}header{border-bottom:2px solid #333;padding-bottom:20px}
.hash{font:.8rem/1.5 ui-monospace,monospace}@media(max-width:560px){
body{padding:16px}dl{grid-template-columns:1fr;gap:2px}dd{margin-bottom:10px}article{padding:16px}}
</style><header><p class="quiet">TokenJunkie Labs · Science Investigations</p>
<h1>Scientific source collection</h1><p>""" + html.escape(status) + "</p><p>" + \
        str(len(index)) + " registered selections across " + \
        str(len(catalog["tenants"])) + " workspaces.</p></header><main>" + \
        "".join(sections) + "</main><footer><p>" \
        "Units, masks, periods and selected model outputs follow each retained source. " \
        "Model output rasters, observations and planning indices retain their separate meanings." \
        "</p></footer></html>"
    (directory / "OPEN.html").write_text(page, encoding="utf-8")

@contextmanager
def _delivery_lock(destination):
    destination.parent.mkdir(parents=True, exist_ok=True)
    lock = destination.with_name(destination.name + ".transfer-lock")
    with lock.open("a+b") as stream:
        if os.name == "nt":
            import msvcrt
            if lock.stat().st_size == 0:
                stream.write(b"0")
                stream.flush()
            stream.seek(0)
            acquire = lambda: msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
            release = lambda: (stream.seek(0), msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1))
        else:
            import fcntl
            acquire = lambda: fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            release = lambda: fcntl.flock(stream.fileno(), fcntl.LOCK_UN)
        try:
            acquire()
        except OSError as exc:
            if exc.errno in (errno.EACCES, errno.EAGAIN, errno.EDEADLK):
                raise CatalogDeliveryError("This collection transfer is already active.") from exc
            raise
        try:
            yield
        finally:
            release()

def bundle(catalog, allowed_root, destination, refs=None):
    destination = Path(destination).resolve()
    with _delivery_lock(destination):
        return _bundle(catalog, allowed_root, destination, refs)

def _bundle(catalog, allowed_root, destination, refs=None):
    """Resume a partial byte transfer of the same original selected edition."""
    prepared = prepare(catalog, allowed_root, refs)
    destination = Path(destination).resolve()
    signature = prepared["input_signature"]
    stage = destination.with_name(destination.name + ".partial-" + signature[:16])
    if destination.exists():
        receipt_path = destination / "delivery.json"
        if receipt_path.is_file():
            receipt = _load(receipt_path)
            if receipt.get("input_signature") == signature and receipt.get("status") == "complete":
                return receipt
        raise CatalogDeliveryError("The destination already contains a different delivery.")
    stage.mkdir(parents=True, exist_ok=True)
    state_file = stage / "transfer.json"
    state = _load(state_file) if state_file.is_file() else {
        "format": DELIVERY_FORMAT, "input_signature": signature, "files": {}}
    if state.get("input_signature") != signature:
        raise CatalogDeliveryError("The retained transfer belongs to a different selection.")
    for relative, item in prepared["files"].items():
        source, descriptor = item["source"], item["descriptor"]
        target = stage / relative
        previous = state["files"].get(relative)
        if previous and target.is_file() and target.stat().st_size == previous["bytes"]:
            if _file_hash(target) == previous["sha256"] and _file_hash(source) == previous["sha256"]:
                continue
        target.parent.mkdir(parents=True, exist_ok=True)
        partial = target.with_name(target.name + ".receiving")
        before, digest, count = source.stat(), hashlib.sha256(), 0
        if (before.st_size, before.st_mtime_ns) != (descriptor["bytes"], descriptor["mtime_ns"]):
            raise CatalogDeliveryError("The selected source edition changed before transfer.")
        with source.open("rb") as reader, partial.open("wb") as writer:
            for block in iter(lambda: reader.read(1024 * 1024), b""):
                writer.write(block)
                digest.update(block)
                count += len(block)
            writer.flush()
            os.fsync(writer.fileno())
        after = source.stat()
        if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
            partial.unlink(missing_ok=True)
            raise CatalogDeliveryError("An original changed during transfer; select its current edition.")
        actual = digest.hexdigest()
        if descriptor["sha256"] and actual != descriptor["sha256"]:
            partial.unlink(missing_ok=True)
            raise CatalogDeliveryError(f"Original source hash changed: {source.name}")
        os.replace(partial, target)
        state["files"][relative] = {"bytes": count, "sha256": actual}
        _write_json(state_file, state)
    for item in prepared["files"].values():
        current, planned = item["source"].stat(), item["descriptor"]
        if (current.st_size, current.st_mtime_ns) != (planned["bytes"], planned["mtime_ns"]):
            raise CatalogDeliveryError("A selected source edition changed before transfer completed.")
    copied, index = prepared["catalog"], prepared["index"]
    for tenant, row in copied["tenants"].items():
        retained = list(row["datasets"]) + [
            artifact for job in row["jobs"] for artifact in job["artifacts"]]
        for record in retained:
            record["sha256"] = state["files"][row["root"] + "/" + record["path"]]["sha256"]
            for companion in record["metadata"].get("retained_companions", []):
                actual = state["files"][row["root"] + "/" + companion["path"]]
                companion.update(actual)
    for item in index:
        item["sha256"] = state["files"][item["path"]]["sha256"]
    _write_json(stage / "catalog.json", copied)
    _write_json(stage / "inventory.json", index)
    write_reports(stage, copied, index, copied=True)
    receipt = {"format": DELIVERY_FORMAT, "status": "complete",
               "input_signature": signature, "catalog_sha256": _digest(copied),
               "files": state["files"], "selected_records": len(index),
               "copied_files": len(state["files"]),
               "copied_bytes": sum(item["bytes"] for item in state["files"].values()),
               "completed_at": datetime.now(timezone.utc).isoformat()}
    _write_json(stage / "delivery.json", receipt)
    (stage / "RECEIVE.md").write_text(
        "# Open the scientific collection\n\n"
        "1. Open OPEN.html for the complete selected-source inventory.\n"
        "2. Keep catalog.json and data/ together.\n"
        "3. In the installed application, construct CatalogRepository(Path('catalog.json'), "
        "Path('.')) from this directory.\n"
        "4. Select the original workspace and dataset or job artifact.\n"
        "5. Profile a selected file or compare compatible outputs, then save and reopen "
        "the investigation through the application's existing controls.\n\n"
        "The application source includes science_catalog_delivery.py. Run its verify "
        "command against this delivery directory for the complete file-byte receiving check.\n",
        encoding="utf-8")
    state_file.unlink()
    os.replace(stage, destination)
    return receipt

def verify_delivery(directory):
    root = Path(directory).resolve()
    receipt = _load(root / "delivery.json")
    if receipt.get("format") != DELIVERY_FORMAT or receipt.get("status") != "complete":
        raise CatalogDeliveryError("No completed scientific delivery is registered here.")
    catalog = _load(root / "catalog.json")
    if _digest(catalog) != receipt.get("catalog_sha256"):
        raise CatalogDeliveryError("The received catalog changed after delivery.")
    for relative, expected in receipt["files"].items():
        path = _resolve(relative, root)
        if path.stat().st_size != expected["bytes"] or _file_hash(path) != expected["sha256"]:
            raise CatalogDeliveryError(f"Received file differs: {path.name}")
    return {"status": "verified", "files": len(receipt["files"]),
            "bytes": sum(item["bytes"] for item in receipt["files"].values()),
            "catalog_sha256": receipt["catalog_sha256"]}

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    for command in ("inspect", "bundle"):
        sub = commands.add_parser(command)
        sub.add_argument("catalog", type=Path)
        sub.add_argument("--allowed-root", type=Path, required=True)
        sub.add_argument("--select", type=Path,
                         help="JSON list of exact tenant_id/kind/id/member selections")
        sub.add_argument("--output" if command == "inspect" else "--destination",
                         type=Path, required=True)
    receiving = commands.add_parser("verify")
    receiving.add_argument("directory", type=Path)
    args = parser.parse_args(argv)
    try:
        if args.command == "verify":
            result = verify_delivery(args.directory)
        else:
            catalog = _load(args.catalog)
            refs = _load(args.select) if args.select else None
            if args.command == "bundle":
                result = bundle(catalog, args.allowed_root, args.destination, refs)
            else:
                prepared = prepare(catalog, args.allowed_root, refs)
                _write_json(args.output / "inventory.json", prepared["index"])
                write_reports(args.output, prepared["catalog"], prepared["index"], copied=False)
                result = {"status": "prepared", "selected_records": len(prepared["index"]),
                          "files": len(prepared["files"]),
                          "bytes": sum(item["descriptor"]["bytes"]
                                       for item in prepared["files"].values())}
        print(json.dumps(result, ensure_ascii=False, sort_keys=True))
        return 0
    except (OSError, ValueError, KeyError, TypeError) as error:
        parser.exit(1, str(error) + "\n")

if __name__ == "__main__":
    raise SystemExit(main())
