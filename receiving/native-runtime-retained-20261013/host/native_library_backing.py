#!/usr/bin/env python3
"""Bind an original custody container to its verified, immutable Library file.

No read starts a download. The original helper request, plan, application result
and runtime consumer registry authorize each explicit cutover or cache eviction.
The original archive name remains as a protected, content-bound pointer.
"""
from __future__ import annotations

import argparse
from contextlib import ExitStack, contextmanager
import hashlib
import json
import os
from pathlib import Path
import stat

import native_library_custody as library
import swarm_cloud_cache as cache
from file_use_guard import FileUseError, selected_file

BINDING_SCHEMA = "commons.library-custody-binding/v1"
POINTER_SCHEMA = "commons.library-custody-pointer/v1"
EVENT_SCHEMA = "commons.library-custody-event/v1"
BINDING_FILE = "external-backing.json"


def require(ok, message):
    if not ok:
        raise library.LibraryCustodyError(message)


def _raw(path, expected_sha256=None):
    observed = library._file_identity(path)
    require(observed["bytes"] <= library.METADATA_LIMIT, "Keep native metadata within the original limit")
    data = Path(path).read_bytes()
    require(len(data) == observed["bytes"] and hashlib.sha256(data).hexdigest() == observed["sha256"]
            and library._file_identity(path) == observed, "Native metadata changed during its read")
    if expected_sha256 is not None:
        require(observed["sha256"] == expected_sha256, "The exact native result digest changed")
    return data, json.loads(data)


def _save_original(path, raw):
    path = Path(path)
    if path.exists() or path.is_symlink():
        saved, _ = _raw(path)
        require(saved == raw, "A retained original native result differs; both files are preserved")
    else:
        cache.atomic_bytes(path, raw, new=True)



CACHE_RECEIVING_SCHEMA = "commons.library-cache-receiving/v1"


def _validate_cache_receiving(result, request, plan):
    """Recognize the exact restored byte stream of a closed transfer cache."""
    require(isinstance(result, dict) and result.get("schema") == CACHE_RECEIVING_SCHEMA
            and result.get("ok") is True
            and result.get("purpose") == "closed-transfer-cache"
            and result.get("plan_id") == plan["plan_id"]
            and result.get("request_id") == request["request_id"]
            and result.get("request_sha256") == request["request_sha256"]
            and result.get("archive") == request["archive"]
            and result.get("library") == request["library"]
            and plan.get("strategy", "retire") == "retire",
            "Select the complete original closed-cache receiving result")
    expected = [row for row in plan["entries"]
                if row["id"] in request["plan"]["entry_ids"]]
    rows = result.get("entries")
    require(isinstance(rows, list) and len(rows) == len(expected)
            and [row.get("entry_id") for row in rows] == [row["id"] for row in expected]
            and len({row["id"] for row in expected}) == len(request["plan"]["entry_ids"]),
            "The receiving result must cover the original selected entries exactly")
    for row, entry in zip(rows, expected):
        require(entry["custody"]["kind"] == "file"
                and entry["custody"]["path"] == request["plan"]["original_archive_path"]
                and entry["match"] in ("complete", "prefix", "range")
                and row.get("path") == entry["path"]
                and row.get("match") == entry["match"]
                and row.get("offset") == entry.get("offset", 0)
                and row.get("custody") == entry["custody"]
                and row.get("restored") == {
                    "bytes": entry["original"]["size"],
                    "sha256": entry["original"]["sha256"]},
                "The actual restored cache bytes differ from the frozen selection")
    require(result.get("receiver") == "swarm_cloud_cache.Custody.check/output"
            and isinstance(result.get("helper_receipt_sha256"), str)
            and library.HEX.fullmatch(result["helper_receipt_sha256"]),
            "Retain the actual full-container helper receipt and native byte receiver")


def receive_cache(request_path, *, expected_request_sha256, output_path,
                  runtime_consumers_root=None):
    """Read every selected byte through the original cache restore implementation.

    The receiving sink hashes the actual emitted bytes incrementally. It avoids
    allocating another full prefix while the container and candidate coexist.
    """
    directory, request = library._request(request_path, expected_request_sha256)
    _, plan, _ = cache.resolved_plan(request["plan"]["path"], runtime_consumers_root)
    destination = Path(output_path).expanduser().absolute()
    require(destination.parent == directory,
            "Retain the complete original receiving result beside its request")
    if destination.exists() or destination.is_symlink():
        raw, saved = _raw(destination)
        _validate_cache_receiving(saved, request, plan)
        return {"ok": True, "action": "original_receiving_retained",
                "result_path": str(destination),
                "result_sha256": hashlib.sha256(raw).hexdigest(), "result": saved}

    class Receiver:
        def __init__(self):
            self.bytes = 0
            self.digest = hashlib.sha256()

        def write(self, content):
            self.digest.update(content)
            self.bytes += len(content)
            return len(content)

    with library.hold_receipt(request_path,
            expected_request_sha256=expected_request_sha256,
            expected_plan_id=plan["plan_id"]) as receipt, \
            cache.Custody(custody_files=receipt["custody_files"]) as verifier:
        rows = []
        for entry in plan["entries"]:
            if entry["id"] not in request["plan"]["entry_ids"]:
                continue
            require(entry["custody"]["kind"] == "file",
                    "This receiving operation selects original complete-file custody")
            receiving = Receiver()
            actual = verifier.check(entry, output=receiving)
            restored = {"bytes": receiving.bytes, "sha256": receiving.digest.hexdigest()}
            require(restored == {"bytes": actual["size"], "sha256": actual["sha256"]},
                    "The emitted original restore stream changed in the receiving sink")
            rows.append({"entry_id": entry["id"], "path": entry["path"],
                         "match": entry["match"], "offset": entry.get("offset", 0),
                         "custody": entry["custody"], "restored": restored})
        result = {"schema": CACHE_RECEIVING_SCHEMA, "ok": True,
                  "purpose": "closed-transfer-cache", "plan_id": plan["plan_id"],
                  "request_id": request["request_id"],
                  "request_sha256": request["request_sha256"],
                  "archive": request["archive"], "library": request["library"],
                  "helper_receipt_sha256": library._digest(receipt),
                  "receiver": "swarm_cloud_cache.Custody.check/output",
                  "entries": rows, "received_at": library._now()}
        _validate_cache_receiving(result, request, plan)
        raw = library._encoded(result)
        _save_original(destination, raw)
    return {"ok": True, "action": "original_bytes_received",
            "result_path": str(destination),
            "result_sha256": hashlib.sha256(raw).hexdigest(), "result": result}


ARCHIVE_RECEIVING_SCHEMA = "commons.library-archive-cache-receiving/v1"


def _validate_archive_receiving(result, request, plan):
    """Bind the actual original member bytes to every frozen sharing plan."""
    bindings = library.plan_bindings(request)
    require(isinstance(result, dict) and result.get("schema") == ARCHIVE_RECEIVING_SCHEMA
            and result.get("ok") is True
            and result.get("purpose") == "closed-archive-cache"
            and result.get("request_id") == request["request_id"]
            and result.get("request_sha256") == request["request_sha256"]
            and result.get("archive") == request["archive"]
            and result.get("library") == request["library"]
            and result.get("receiver") == "swarm_cloud_cache.Custody.check"
            and isinstance(result.get("helper_receipt_sha256"), str)
            and library.HEX.fullmatch(result["helper_receipt_sha256"])
            and plan.get("strategy", "retire") == "retire",
            "Select the complete original archive-member receiving result")
    groups = result.get("plans")
    require(isinstance(groups, list) and len(groups) == len(bindings)
            and [row.get("plan_id") for row in groups] == [row["plan_id"] for row in bindings],
            "The archive receiving must retain every original sharing plan")
    for group, bound in zip(groups, bindings):
        rows = group.get("entries")
        require(group.get("cache_root") == bound["cache_root"]
                and isinstance(rows, list)
                and sorted(row.get("entry_id", "") for row in rows) == bound["entry_ids"],
                "The archive receiving changed an original plan's selection")
    bound = library.plan_binding(request, plan["plan_id"])
    group = next(row for row in groups if row["plan_id"] == plan["plan_id"])
    expected = [row for row in plan["entries"] if row["id"] in bound["entry_ids"]]
    require([row.get("entry_id") for row in group["entries"]] == [row["id"] for row in expected],
            "Retain the exact original archive entry order")
    for row, entry in zip(group["entries"], expected):
        require(entry["custody"]["kind"] in ("file", "zip-member", "tar-member")
                and entry["custody"]["path"] == bound["original_archive_path"]
                and entry["custody"]["sha256"] == request["archive"]["sha256"]
                and entry["custody"]["size"] == request["archive"]["bytes"]
                and row == {"entry_id": entry["id"], "path": entry["path"],
                            "match": entry["match"], "offset": entry.get("offset", 0),
                            "custody": entry["custody"],
                            "restored": {"bytes": entry["original"]["size"],
                                         "sha256": entry["original"]["sha256"]}},
                "The restored archive member differs from its frozen original entry")


def _resolved_plans(request, runtime_consumers_root=None):
    selected = []
    for bound in library.plan_bindings(request):
        retained, plan, consumers = cache.resolved_plan(bound["path"], runtime_consumers_root)
        require(plan["plan_id"] == bound["plan_id"], "An original archive plan changed")
        selected.append((retained, plan, consumers))
    require(len({str(row[2].root) for row in selected}) == 1,
            "Shared archive plans require their same original consumer registry")
    return selected


@contextmanager
def _plan_journals(selected, *, custody_paths=None):
    """Acquire sharing writers in stable order while the original request is held."""
    with ExitStack() as stack:
        retained = {}
        for path, plan, consumers in sorted(selected, key=lambda row: row[1]["plan_id"]):
            retained[plan["plan_id"]] = stack.enter_context(
                consumers.plan_journal(path, plan, custody_paths=custody_paths))
        yield [(retained[plan["plan_id"]], plan, consumers)
               for _, plan, consumers in selected]


def receive_archive(request_path, *, expected_request_sha256, output_path,
                    runtime_consumers_root=None):
    """Read the saved original file/archive members without another expanded copy."""
    directory, request = library._request(request_path, expected_request_sha256)
    selected = _resolved_plans(request, runtime_consumers_root)
    destination = Path(output_path).expanduser().absolute()
    require(destination.parent == directory, "Retain receiving beside its original request")
    if destination.exists() or destination.is_symlink():
        raw, result = _raw(destination)
        for _, plan, _ in selected:
            _validate_archive_receiving(result, request, plan)
        return {"ok": True, "action": "original_receiving_retained",
                "result_path": str(destination), "result_sha256": hashlib.sha256(raw).hexdigest(),
                "result": result}
    with library.hold_receipt(request_path, expected_request_sha256=expected_request_sha256) as receipt, \
            cache.Custody(custody_files=receipt["custody_files"]) as verifier:
        groups = []
        for _, plan, _ in selected:
            bound = library.plan_binding(request, plan["plan_id"])
            rows = []
            for entry in plan["entries"]:
                if entry["id"] not in bound["entry_ids"]:
                    continue
                require(entry["custody"]["kind"] in ("file", "zip-member", "tar-member"),
                        "Use the original retained file or exact archive member")
                actual = verifier.check(entry)
                rows.append({"entry_id": entry["id"], "path": entry["path"],
                             "match": entry["match"], "offset": entry.get("offset", 0),
                             "custody": entry["custody"],
                             "restored": {"bytes": actual["size"], "sha256": actual["sha256"]}})
            groups.append({"plan_id": plan["plan_id"], "cache_root": plan["cache_root"],
                           "entries": rows})
        result = {"schema": ARCHIVE_RECEIVING_SCHEMA, "ok": True,
                  "purpose": "closed-archive-cache", "request_id": request["request_id"],
                  "request_sha256": request["request_sha256"], "archive": request["archive"],
                  "library": request["library"], "helper_receipt_sha256": library._digest(receipt),
                  "receiver": "swarm_cloud_cache.Custody.check", "plans": groups,
                  "received_at": library._now()}
        for _, plan, _ in selected:
            _validate_archive_receiving(result, request, plan)
        raw = library._encoded(result)
        _save_original(destination, raw)
    return {"ok": True, "action": "original_archive_members_received",
            "result_path": str(destination), "result_sha256": hashlib.sha256(raw).hexdigest(),
            "result": result}


def _validate_native(result, request, plan):
    if isinstance(result, dict) and result.get("schema") == ARCHIVE_RECEIVING_SCHEMA:
        return _validate_archive_receiving(result, request, plan)
    if isinstance(result, dict) and result.get("schema") == CACHE_RECEIVING_SCHEMA:
        return _validate_cache_receiving(result, request, plan)
    require(isinstance(result, dict) and result.get("schema") == "commons.vitality-library-reopen/v1"
            and result.get("ok") is True and result.get("application_reopened") is True
            and result.get("database_replaced") is False
            and result.get("plan_id") == plan["plan_id"]
            and result.get("library_request_id") == request["request_id"],
            "Select the completed original Vitality Library receiving result")
    # State/ID equality remains an observation: legitimate concurrent business
    # work does not invalidate a read that preserves the current database.
    for phase in ("before", "after"):
        require(result.get(phase, {}).get("reader_sql_changes") == 0,
                "The native receiving reader changed application rows")
    require(result.get("reopened_reader_sql_changes") == 0,
            "The original database reopen must retain its zero-write observation")
    for field in ("new_model_runs", "new_source_imports", "new_deliveries"):
        require(result.get(field) == 0, "The original receiving proof must not execute new application work")
    restored = result.get("restore", {})
    require(restored.get("schema") == "commons.native-library-reopen/v1"
            and restored.get("ok") is True and restored.get("plan_id") == plan["plan_id"],
            "The native result does not contain the completed original source restoration")
    anchor = restored.get("library_request", {})
    require(anchor.get("request_id") == request["request_id"]
            and anchor.get("request_sha256") == request["request_sha256"],
            "The native receiving result used another Library request")
    expected = {row["path"]: row for row in plan["entries"]}
    rows = restored.get("entries", [])
    require(isinstance(rows, list) and len(rows) == len(expected)
            and len({row.get("path") for row in rows}) == len(expected),
            "The original receiving result must cover every selected plan entry once")
    for row in rows:
        selected = expected.get(row.get("path"))
        require(selected is not None and row.get("state") == "original"
                and row.get("sha256") == selected["original"]["sha256"]
                and row.get("bytes") == selected["original"]["size"],
                "The native receiving result differs from the frozen original source")
    consumed = result.get("after", {}).get("consumed_source_files", [])
    require(isinstance(consumed, list), "The actual native source-read result is absent")
    actual = {(row.get("sha256"), row.get("bytes")) for row in consumed}
    require(all((row["original"]["sha256"], row["original"]["size"]) in actual
                for row in expected.values()), "The application did not read each original source")


def _request_for_plan(path, expected_sha256, plan):
    """Validate frozen metadata against an already loaded plan; never re-lock it."""
    directory, path = library._location(path)
    value = library._read(path)
    require(isinstance(value, dict) and value.get("schema") == library.REQUEST_SCHEMA
            and value.get("request_sha256") == library._digest(library._request_body(value))
            and value["request_sha256"] == expected_sha256,
            "The original Library request changed")
    require(value["request_id"] == library._digest({"operation_id": value["operation_id"]})
            and directory.name == value["request_id"]
            and library._selected(value["search_result"], value["selection"]) == value["library"]
            and value["download_destination"] == "download", "The original Library identity changed")
    bound = library.plan_binding(value, plan["plan_id"])
    selected = [row for row in plan["entries"]
                if row["custody"]["path"] == bound["original_archive_path"]]
    require(bound["plan_id"] == plan["plan_id"] and bound["cache_root"] == plan["cache_root"]
            and bound["runtime_consumers_root"] == plan.get("runtime_consumers_root")
            and selected and sorted(row["id"] for row in selected) == bound["entry_ids"],
            "The registered Library source differs from the original plan")
    for row in selected:
        spec = row["custody"]
        require(spec["kind"] in ("file", "zip-member", "tar-member")
                and spec["sha256"] == value["archive"]["sha256"]
                and spec["size"] == value["archive"]["bytes"],
                "The remote container differs from its original custody bytes")
    return directory, value


def registered_binding(record, plan):
    """Original registry validation, safe while its lock is held; no plan resolution."""
    require(isinstance(record, dict), "Select the original registered Library binding")
    directory, request = _request_for_plan(record["request_path"], record["request_sha256"], plan)
    binding = library._read(directory / BINDING_FILE)
    require(binding.get("schema") == BINDING_SCHEMA
            and library._digest(binding) == record.get("binding_sha256")
            and binding.get("request_id") == request["request_id"]
            and binding.get("request_sha256") == request["request_sha256"]
            and binding.get("request_path") == str(directory / "request.json")
            and binding.get("plan_id") == request["plan"]["plan_id"]
            and binding.get("plan_bindings") == (
                library.plan_bindings(request) if "additional_plans" in request else None)
            and binding.get("original_archive_path") == request["plan"]["original_archive_path"]
            and binding.get("archive") == request["archive"]
            and binding.get("library") == request["library"]
            and binding.get("entry_ids") == request["plan"]["entry_ids"]
            and binding.get("cache_path") == str(library._expected_file(directory, request)),
            "The immutable Library backing binding changed")
    proof_path = directory / ("native-reopen-" + binding["native_result_sha256"] + ".json")
    _, proof = _raw(proof_path, binding["native_result_sha256"])
    _validate_native(proof, request, plan)
    require(library._digest(_bound_receipt(directory, request)) == binding["helper_receipt_sha256"],
            "The bound original helper receipt changed")
    if proof.get("schema") in (CACHE_RECEIVING_SCHEMA, ARCHIVE_RECEIVING_SCHEMA):
        require(proof["helper_receipt_sha256"] == binding["helper_receipt_sha256"],
                "The original cache receiving used another full-container receipt")
    return directory, request, binding


def _record_for(directory, binding):
    return {"request_path": str(directory / "request.json"),
            "request_sha256": binding["request_sha256"],
            "binding_sha256": library._digest(binding)}


def _pointer(directory, binding):
    return {"commons_library_custody": 1, "schema": POINTER_SCHEMA,
            "plan_id": binding["plan_id"], "request_id": binding["request_id"],
            **_record_for(directory, binding),
            "archive": binding["archive"], "library": binding["library"],
            "native_result_sha256": binding["native_result_sha256"]}


def _small_pointer(path):
    path = Path(path)
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except FileNotFoundError:
        return None
    try:
        before = os.fstat(fd)
        require(stat.S_ISREG(before.st_mode), "The original container path changed type")
        if before.st_size > cache.MARKER_LIMIT:
            return None
        raw = os.read(fd, cache.MARKER_LIMIT + 1)
        require(cache.identity(before) == cache.identity(os.fstat(fd))
                == cache.identity(path.lstat()), "The original container pointer changed")
    finally:
        os.close(fd)
    try:
        value = json.loads(raw)
    except (ValueError, UnicodeError):
        return None
    return value if isinstance(value, dict) and value.get("commons_library_custody") else None


def _marker_matches(path, directory, binding):
    return _small_pointer(path) == _pointer(directory, binding)


def _events(directory, binding):
    root = directory / "backing-events"
    if not root.exists():
        return []
    library._private_directory(root)
    files, result, previous = sorted(root.glob("*.json")), [], None
    for number, path in enumerate(files, 1):
        value = library._read(path)
        require(path.name == f"{number:06d}.json"
                and value.get("schema") == EVENT_SCHEMA
                and value.get("sequence") == number and value.get("previous") == previous
                and value.get("binding_sha256") == library._digest(binding),
                "Preserve the original interrupted backing event history")
        result.append(value)
        previous = library._digest(value)
    return result


def _event(directory, binding, phase, **fields):
    """Append immutable events; incomplete wrapper saves never replay a release."""
    root = library._private_directory(directory / "backing-events", create=True)
    previous = _events(directory, binding)
    value = {"schema": EVENT_SCHEMA, "sequence": len(previous) + 1,
             "previous": library._digest(previous[-1]) if previous else None,
             "binding_sha256": library._digest(binding), "phase": phase,
             "recorded_at": library._now(), **fields}
    library._save(root / f"{len(previous) + 1:06d}.json", value, create_only=True)
    return value


def _bound_receipt(directory, request):
    saved = library._read(directory / "bound-materialization-receipt.json")
    require(isinstance(saved, dict) and saved.get("schema") == library.RECEIPT_SCHEMA
            and saved.get("state") == "complete"
            and saved.get("request_id") == request["request_id"]
            and saved.get("request_sha256") == request["request_sha256"]
            and saved.get("plan_id") == request["plan"]["plan_id"]
            and saved.get("library") == request["library"]
            and saved.get("archive") == {
                "path": str(library._expected_file(directory, request)), **request["archive"]}
            and saved.get("custody_files") == {
                request["plan"]["original_archive_path"]: str(library._expected_file(directory, request))},
            "The retained actual helper receipt differs from the original request")
    return saved


def _bind(directory, request, receipt, plan, proof_path, expected_proof_sha256):
    raw, proof = _raw(proof_path, expected_proof_sha256)
    _validate_native(proof, request, plan)
    target = directory / ("native-reopen-" + expected_proof_sha256 + ".json")
    _save_original(target, raw)
    path = directory / BINDING_FILE
    if path.exists():
        saved = library._read(path)
        registered_binding(_record_for(directory, saved), plan)
        return saved
    if not (directory / "bound-materialization-receipt.json").exists():
        library._save(directory / "bound-materialization-receipt.json", receipt, create_only=True)
    original_receipt = _bound_receipt(directory, request)
    if proof.get("schema") in (CACHE_RECEIVING_SCHEMA, ARCHIVE_RECEIVING_SCHEMA):
        require(proof["helper_receipt_sha256"] == library._digest(original_receipt),
                "Bind the actual original helper receipt used for cache receiving")
    binding = {"schema": BINDING_SCHEMA, "request_id": request["request_id"],
               "request_sha256": request["request_sha256"],
               "request_path": str(directory / "request.json"), "plan_id": plan["plan_id"],
               "original_archive_path": request["plan"]["original_archive_path"],
               "archive": request["archive"], "library": request["library"],
               "entry_ids": request["plan"]["entry_ids"], "cache_path": receipt["archive"]["path"],
               "native_result_sha256": expected_proof_sha256,
               "helper_receipt_sha256": library._digest(original_receipt), "bound_at": library._now()}
    if "additional_plans" in request:
        binding["plan_bindings"] = library.plan_bindings(request)
    library._save(path, binding, create_only=True)
    return binding


@contextmanager
def _file_use_events(directory, binding):
    """Keep an actual failed exclusion with the same original backing journal."""
    try:
        yield
    except (OSError, ValueError, cache.CacheError) as error:
        if not getattr(error, "file_use", None):
            raise
        try:
            _event(directory, binding, "file_use_preserved", file_use=error.file_use)
        except OSError as journal_error:
            error.file_use["journal_error"] = str(journal_error)
        raise


def _file_use_observer(directory, binding):
    return lambda observation: _event(directory, binding, "file_use_observed",
                                     file_use=observation)


def cutover(request_path, *, expected_request_sha256, native_result_path,
            expected_native_result_sha256, runtime_consumers_root=None, file_use=False):
    """After actual native receiving, replace only the original archive with its durable pointer."""
    directory, request = library._request(request_path, expected_request_sha256)
    selected_plans = _resolved_plans(request, runtime_consumers_root)
    retained, plan, consumers = selected_plans[0]
    other_plan_ids = [row[1]["plan_id"] for row in selected_plans[1:]]
    original = Path(request["plan"]["original_archive_path"])
    require(original.resolve(strict=True) == original, "Keep the exact ordinary original archive path")
    with library._lock(directory) as request_lock_fd:
        receipt = library.read_receipt(request_path, expected_request_sha256=expected_request_sha256,
                                       expected_plan_id=plan["plan_id"])
        require(Path(receipt["archive"]["path"]) != original,
                "Verify an independent original-helper materialization before archive release")
        binding = _bind(directory, request, receipt, plan, native_result_path,
                        expected_native_result_sha256)
        selected = _record_for(directory, binding)
        # The unchanged private metadata, helpers and original archive name are
        # lifetime dependencies. A small pointer continues to occupy that name.
        protected = [str(original), str(directory), request["helper_directory"]]
        with _file_use_events(directory, binding), \
                _plan_journals(selected_plans, custody_paths=protected) as journals:
            for path, sharing_plan, owner in journals:
                owner.bind_library_backing(path, sharing_plan, selected, request_lock_fd=request_lock_fd)
            with consumers.hold_library_backing(original, plan_id=plan["plan_id"],
                                                binding=selected, request_lock_fd=request_lock_fd,
                                                additional_plan_ids=other_plan_ids) as usage:
                if usage["consumers"]:
                    return {"ok": False, "state": "in_use", "consumers": usage["consumers"],
                            "plan_id": plan["plan_id"]}
                stage = original.parent / (".library-cutover-" + request["request_id"])
                expected_marker = _pointer(directory, binding)
                released = None
                already = _marker_matches(original, directory, binding)
                if already:
                    if stage.exists() or stage.is_symlink():
                        require(library._file_identity(stage) == request["archive"],
                                "Unexpected interrupted archive bytes remain preserved")
                        _event(directory, binding, "original_unlink_pending", stage=str(stage))
                        released = cache.remove_verified(stage, {
                            "sha256": request["archive"]["sha256"], "size": request["archive"]["bytes"]},
                            file_use=file_use,
                            on_file_use=_file_use_observer(directory, binding) if file_use else None)
                else:
                    require(library._file_identity(original) == request["archive"],
                            "The original archive changed; it is preserved")
                    if stage.exists() or stage.is_symlink():
                        require(not stage.is_symlink()
                                and _small_pointer(stage) == expected_marker,
                                "Preserve the original interrupted cutover stage before another exchange")
                    else:
                        library._save(stage, expected_marker, create_only=True)
                    with selected_file(original, require_unused=file_use) as held:
                        old = cache.inspect_fd(held.fd)
                        require(old["size"] == request["archive"]["bytes"]
                                and old["sha256"] == request["archive"]["sha256"],
                                "The original archive changed before its guarded cutover")
                        marker = cache.snapshot(stage)
                        _event(directory, binding, "pointer_exchange_pending",
                               original_identity=old["identity"], stage=str(stage),
                               **({"file_use": held.observation()} if file_use else {}))
                        with cache.parent_fd(original.parent, original.name) as (parent, name):
                            require(cache.identity(os.stat(name, dir_fd=parent, follow_symlinks=False))
                                    == tuple(old["identity"])
                                    == cache.identity(os.fstat(held.fd)),
                                    "The original archive path changed before its cutover")
                            held.change("exchange_original_for_pointer",
                                        lambda: cache.exchange_file_names(stage, parent, name))
                            os.fsync(parent)
                            cache.sync_dir(stage.parent)
                            # Read through the lease's original descriptor. Reopening
                            # the same leased inode would request our own lease break.
                            moved = stage.lstat()
                            displaced = (cache.inspect_fd(held.fd)
                                if (moved.st_dev, moved.st_ino) == tuple(old["identity"][:2])
                                else cache.snapshot(stage))
                            installed = cache.snapshot(original)
                            if (not cache.same_bytes(displaced, old)
                                    or tuple(displaced["identity"][:2]) != tuple(old["identity"][:2])):
                                if tuple(installed["identity"][:2]) == tuple(marker["identity"][:2]):
                                    cache.exchange_file(stage, parent, name)
                                raise library.LibraryCustodyError(
                                    "An outside archive writer changed the source; its bytes were preserved")
                            require(_marker_matches(original, directory, binding)
                                    and tuple(installed["identity"][:2]) == tuple(marker["identity"][:2]),
                                    "The installed Library pointer changed; original stage remains preserved")
                        _event(directory, binding, "pointer_installed", stage=str(stage),
                               **({"file_use": held.observation()} if file_use else {}))
                    released = cache.remove_verified(stage, {
                        "sha256": request["archive"]["sha256"], "size": request["archive"]["bytes"]},
                            file_use=file_use,
                            on_file_use=_file_use_observer(directory, binding) if file_use else None)
                marker_info = original.lstat()
                prior = [row["result"] for row in _events(directory, binding)
                         if row["phase"] == "cutover_complete"
                         and isinstance(row.get("result"), dict)
                         and row["result"].get("physical_release_this_call") is not None]
                result = {"ok": True, "state": "library_backed", "plan_id": plan["plan_id"],
                          "original_archive_path": str(original), "request": selected,
                          "library": request["library"], "archive": request["archive"],
                          "action": "already_library_backed" if already else "original_archive_released",
                          "physical_release_this_call": released,
                          "pointer_allocated_bytes": marker_info.st_blocks * 512,
                          "previously_recorded_release": prior[-1]["physical_release_this_call"] if prior else None,
                          "unrecorded_prior_release": already and released is None and not prior,
                          "native_result_sha256": expected_native_result_sha256,
                          "meaning": "Only observed last-link allocation is reported; the original plan and history remain."}
                _event(directory, binding, "cutover_complete", result=result)
                return result


def evict(request_path, *, expected_request_sha256, runtime_consumers_root=None, file_use=False):
    """Release the owned hydrated copy after original source retirement and consumer closure."""
    directory, request = library._request(request_path, expected_request_sha256)
    selected_plans = _resolved_plans(request, runtime_consumers_root)
    retained, plan, consumers = selected_plans[0]
    other_plan_ids = [row[1]["plan_id"] for row in selected_plans[1:]]
    with library._lock(directory) as request_lock_fd:
        binding = library._read(directory / BINDING_FILE)
        selected = _record_for(directory, binding)
        registered_binding(selected, plan)
        require(_marker_matches(request["plan"]["original_archive_path"], directory, binding),
                "The durable original Library pointer must be installed before cache eviction")
        with _file_use_events(directory, binding), _plan_journals(selected_plans) as journals:
            archive = library._expected_file(directory, request)
            with consumers.hold_library_backing(archive, plan_id=plan["plan_id"], binding=selected,
                                                request_lock_fd=request_lock_fd,
                                                additional_plan_ids=other_plan_ids) as usage:
                if usage["consumers"]:
                    return {"ok": False, "state": "in_use", "consumers": usage["consumers"]}
                for path, sharing_plan, owner in journals:
                    registered_binding(selected, sharing_plan)
                    state = cache.load_state(path, sharing_plan)
                    bound = library.plan_binding(request, sharing_plan["plan_id"])
                    for entry in sharing_plan["entries"]:
                        if entry["id"] not in bound["entry_ids"]:
                            continue
                        require(cache.inspect_target(sharing_plan, entry)["state"] == "retired"
                                and state["items"].get(entry["id"], {}).get("phase") == "complete",
                                "Finish original source retirement before evicting the warm backing")
                current = library._state(directory, request)
                attempt = len(current["attempts"])
                if not archive.exists() and not archive.is_symlink():
                    prior = [row["result"] for row in _events(directory, binding)
                             if row["phase"] in ("cache_evicted", "cache_eviction_reconciled")
                             and isinstance(row.get("result"), dict)
                             and row["result"].get("materialization_attempt") == attempt]
                    result = {"ok": True, "state": "cold", "action": "already_absent",
                              "request_id": request["request_id"], "physical_release_this_call": None,
                              "materialization_attempt": attempt, "library": request["library"],
                              "previously_recorded_release": (
                                  prior[-1].get("physical_release_this_call")
                                  or prior[-1].get("previously_recorded_release")) if prior else None,
                              "unrecorded_prior_release": prior[-1].get("unrecorded_prior_release", False) if prior else True}
                    if current["state"] != "cold":
                        current["state"] = "cold"
                        library._save(directory / "state.json", current)
                    if not prior:
                        _event(directory, binding, "cache_eviction_reconciled", result=result)
                    return result
                require(library._file_identity(archive) == request["archive"],
                        "The cached container changed; its bytes are preserved")
                _event(directory, binding, "cache_unlink_pending", path=str(archive),
                       materialization_attempt=attempt)
                released = cache.remove_verified(archive, {
                    "sha256": request["archive"]["sha256"], "size": request["archive"]["bytes"]},
                            file_use=file_use,
                            on_file_use=_file_use_observer(directory, binding) if file_use else None)
                current["state"] = "cold"
                library._save(directory / "state.json", current)
                result = {"ok": True, "state": "cold", "request_id": request["request_id"],
                          "materialization_attempt": attempt,
                          "physical_release_this_call": released, "library": request["library"],
                          "next": "Explicit original materialize, then restore/reopen with the same request"}
                _event(directory, binding, "cache_evicted", result=result)
                return result


def _plan_pointers(plan, entries=None):
    selected = set(entries) if entries is not None else {row["path"] for row in plan["entries"]}
    known = {row["path"] for row in plan["entries"]}
    require(selected <= known, "Select only original plan entries")
    specs = {row["custody"]["path"]: row["custody"] for row in plan["entries"]
             if row["path"] in selected and row["custody"]["kind"] != "git-blob"}
    pointers = []
    for original, spec in sorted(specs.items()):
        pointer = _small_pointer(original)
        if pointer is None:
            continue
        directory, request, binding = registered_binding(pointer, plan)
        require(pointer == _pointer(directory, binding)
                and binding["original_archive_path"] == original
                and binding["archive"] == {"sha256": spec["sha256"], "bytes": spec["size"]},
                "The Library pointer differs from this exact original container")
        pointers.append((original, directory, request, binding))
    return pointers


def backing_status(plan_path, *, entries=None, runtime_consumers_root=None):
    """Read original durable identity and local availability; do not download or mutate."""
    _, plan, _ = cache.resolved_plan(plan_path, runtime_consumers_root)
    result = {}
    for original, directory, request, binding in _plan_pointers(plan, entries):
        path = library._expected_file(directory, request)
        try:
            info = path.lstat()
            present = stat.S_ISREG(info.st_mode) and not path.is_symlink()
        except FileNotFoundError:
            present = False
        result[original] = {"state": "present_unverified" if present else "materialization_required",
                            "library": request["library"], "archive": request["archive"],
                            "request_path": str(directory / "request.json"),
                            "request_sha256": request["request_sha256"],
                            "cache_path": str(path), "network_performed": False}
    return result


@contextmanager
def hold_plan_custody(plan_path, *, entries=None, custody_files=None, require_warm=True,
                      runtime_consumers_root=None):
    """Keep already hydrated Library containers alive for the original cache reader."""
    _, plan, _ = cache.resolved_plan(plan_path, runtime_consumers_root)
    supplied = dict(custody_files.items() if isinstance(custody_files, dict) else (custody_files or []))
    pointers = _plan_pointers(plan, entries)
    result, details = dict(supplied), {}
    with ExitStack() as stack:
        held = {}
        for original, directory, request, binding in sorted(pointers,
                key=lambda row: (str(row[1]), row[0])):
            if original in supplied:
                # The existing explicit relocation API verifies the full frozen
                # container/member. Its caller, such as restore_original, owns
                # the already-held receipt. Do not take that same lock twice.
                continue
            key = str(directory)
            if key not in held:
                if not library._expected_file(directory, request).exists():
                    if require_warm:
                        raise library.LibraryCustodyError(
                            "Library custody is cold; explicitly materialize the original request: "
                            + str(directory / "request.json"))
                    held[key] = None
                else:
                    held[key] = stack.enter_context(library.hold_receipt(
                        directory / "request.json", expected_request_sha256=request["request_sha256"],
                        expected_plan_id=plan["plan_id"]))
            receipt = held[key]
            details[original] = {"state": "verified" if receipt else "materialization_required",
                                 "library": request["library"],
                                 "request_path": str(directory / "request.json"),
                                 "request_sha256": request["request_sha256"], "network_performed": False}
            if receipt is not None:
                require(_marker_matches(original, directory, binding),
                        "The original backing pointer changed before its read")
                result[original] = receipt["archive"]["path"]
        yield {"custody_files": result, "library_custody": details}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("cutover", "evict", "receive-cache"):
        sub = commands.add_parser(name)
        sub.add_argument("--request", required=True)
        sub.add_argument("--expected-request-sha256", required=True)
        sub.add_argument("--runtime-consumers-root")
        if name in ("cutover", "evict"):
            sub.add_argument("--require-unused", action="store_true",
                             help="Require an original Linux file-use lease at each mutation")
        if name == "receive-cache":
            sub.add_argument("--output", required=True)
        if name == "cutover":
            sub.add_argument("--native-result", required=True)
            sub.add_argument("--expected-native-result-sha256", required=True)
    status = commands.add_parser("status")
    status.add_argument("--plan", required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == "status":
            result = {"ok": True, "library_custody": backing_status(args.plan)}
        elif args.command == "receive-cache":
            result = receive_cache(args.request, expected_request_sha256=args.expected_request_sha256,
                                   output_path=args.output,
                                   runtime_consumers_root=args.runtime_consumers_root)
        elif args.command == "cutover":
            result = cutover(args.request, expected_request_sha256=args.expected_request_sha256,
                             native_result_path=args.native_result,
                             expected_native_result_sha256=args.expected_native_result_sha256,
                             runtime_consumers_root=args.runtime_consumers_root,
                             file_use=args.require_unused)
        else:
            result = evict(args.request, expected_request_sha256=args.expected_request_sha256,
                           runtime_consumers_root=args.runtime_consumers_root,
                           file_use=args.require_unused)
        print(json.dumps(result, ensure_ascii=False, sort_keys=True))
        return 0 if result["ok"] else 2
    except (OSError, ValueError, cache.CacheError, KeyError, TypeError) as exc:
        print(json.dumps({"ok": False, "error_type": type(exc).__name__, "error": str(exc),
                          **({"file_use": exc.file_use} if getattr(exc, "file_use", None) else {})}))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
