"""Source-only authority facade for RepoAtlas.

The mature source analyzer is retained in `_core_source_v1.py`; this module owns
the supported package API and the source-only authority boundary.  Caller JSON
cannot self-attest IBM/lablab registration, Bob execution, track publication,
or submission evidence.  Ordinary package initialization also retires the
legacy module's direct compile/verify entrypoints so a normal private-submodule
import cannot bypass this facade.

This is cooperative Python-runtime API hardening, not hostile-interpreter or
source-file tamper resistance.  A later provider transition still requires a
separately source-bound and reviewed successor.
"""
from __future__ import annotations

from typing import Any

from . import _core_source_v1 as _source

RepoAtlasError = _source.RepoAtlasError

# Object-mode compilation is a supported public ingress and therefore needs
# explicit code-owned cardinality ceilings independent of the byte parser.
# Keep these aligned with the analyzer's existing maximum admitted file set:
# one change per path, at most one document row per admitted path in the
# conservative envelope, and no per-row reference list larger than the entire
# admitted file universe.
MAX_CHANGES = _source.MAX_FILES
MAX_DOC_ROWS = _source.MAX_FILES
MAX_ROW_REFS = _source.MAX_FILES

# JSON nesting is a product contract, not an interpreter-recursion accident.
# Scan the bounded byte ingress before json.loads so supported Python versions
# reject the same excessive nesting depth even when their C decoder stack
# tolerances differ.
MAX_JSON_DEPTH = 256


def _preflight_json_depth(data: Any) -> None:
    if type(data) is not bytes:
        return
    depth = 0
    in_string = False
    escaped = False
    for byte in data:
        if in_string:
            if escaped:
                escaped = False
            elif byte == 0x5C:  # backslash
                escaped = True
            elif byte == 0x22:  # quote
                in_string = False
            continue
        if byte == 0x22:
            in_string = True
        elif byte in (0x5B, 0x7B):  # [ {
            depth += 1
            if depth > MAX_JSON_DEPTH:
                raise RepoAtlasError("json_too_deep")
        elif byte in (0x5D, 0x7D) and depth:
            # Syntax/matching remains the JSON decoder's job.  This preflight
            # owns only the deterministic upper bound on open nesting.
            depth -= 1


def parse_json_bytes(data: bytes) -> Any:
    _preflight_json_depth(data)
    try:
        return _source.parse_json_bytes(data)
    except RepoAtlasError:
        raise
    except RecursionError as exc:
        raise RepoAtlasError("json_too_deep") from exc
    except UnicodeEncodeError as exc:
        raise RepoAtlasError("invalid_unicode_scalar") from exc
    except ValueError as exc:
        # CPython can reject extremely long integer literals before json.loads
        # can produce a JSONDecodeError (sys.set_int_max_str_digits).  Keep that
        # runtime-specific parser guard inside RepoAtlas's stable fail-closed
        # error surface rather than letting a raw traceback escape the CLI.
        raise RepoAtlasError("invalid_json") from exc


def _preflight_mapping(value: Any, name: str, maximum_fields: int) -> None:
    """Bound direct-object mapping work before `_source._only()` allocates."""
    if type(value) is not dict:
        return
    if len(value) > maximum_fields:
        raise RepoAtlasError(f"{name}:field_cardinality")
    for key in value:
        # json.loads can only produce string object keys, but escaped lone
        # surrogates are still Python ``str`` values and object-mode callers
        # bypass the parser entirely.  Reject non-JSON/pathological/UTF-8-invalid
        # field names before `_source._only()` can embed them in an error string
        # that the UTF-8 CLI would then fail to print.
        if type(key) is not str or len(key) > 256:
            raise RepoAtlasError(f"{name}:field_name")
        try:
            key.encode("utf-8", "strict")
        except UnicodeEncodeError as exc:
            raise RepoAtlasError(f"{name}:field_name") from exc


def _preflight_cardinality(raw: Any) -> None:
    """Bound every repeated object-mode structure before expensive traversal."""
    if type(raw) is not dict:
        return

    _preflight_mapping(raw, "root", 9)

    for name, limit in (
        ("changes", MAX_CHANGES),
        ("adrs", MAX_DOC_ROWS),
        ("runbooks", MAX_DOC_ROWS),
    ):
        rows = raw.get(name, [])
        if type(rows) is list and len(rows) > limit:
            raise RepoAtlasError(f"{name}:cardinality")

    # `_source._validate` already bounds the top-level files list before
    # iterating it.  Only inspect nested refs when that outer list is itself
    # within the retained bound, so this preflight cannot be turned into a new
    # unbounded traversal.
    files = raw.get("files", [])
    if type(files) is list and len(files) <= _source.MAX_FILES:
        for i, row in enumerate(files):
            _preflight_mapping(row, f"files[{i}]", 7)
            if type(row) is not dict:
                continue
            tests = row.get("tests", [])
            if type(tests) is list and len(tests) > MAX_ROW_REFS:
                raise RepoAtlasError(f"files[{i}].tests:cardinality")

    # Dependency count is already source-bounded before row traversal.  Mirror
    # that outer condition only so direct-object row maps are bounded before
    # `_source._only()` constructs an attacker-sized unknown-key set.
    dependencies = raw.get("dependencies", [])
    if type(dependencies) is list and len(dependencies) <= _source.MAX_EDGES:
        for i, row in enumerate(dependencies):
            _preflight_mapping(row, f"dependencies[{i}]", 3)

    changes = raw.get("changes", [])
    if type(changes) is list and len(changes) <= MAX_CHANGES:
        for i, row in enumerate(changes):
            _preflight_mapping(row, f"changes[{i}]", 4)

    for name in ("adrs", "runbooks"):
        rows = raw.get(name, [])
        if type(rows) is not list or len(rows) > MAX_DOC_ROWS:
            continue
        for i, row in enumerate(rows):
            _preflight_mapping(row, f"{name}[{i}]", 3)
            if type(row) is not dict:
                continue
            covers = row.get("covers", [])
            if type(covers) is list and len(covers) > MAX_ROW_REFS:
                raise RepoAtlasError(f"{name}[{i}].covers:cardinality")

    _preflight_mapping(raw.get("provider"), "provider", 4)


def _validate_source_input(raw: Any) -> dict[str, Any]:
    _preflight_cardinality(raw)
    try:
        normalized = _source._validate(raw)
    except UnicodeEncodeError as exc:
        raise RepoAtlasError("invalid_unicode_scalar") from exc
    except RecursionError as exc:
        raise RepoAtlasError("input_too_deep") from exc

    if any(normalized["provider"].values()):
        raise RepoAtlasError("provider:external_evidence_requires_bound_successor")

    # Bind the admitted file manifest to the change image it claims to
    # describe.  Added/modified paths carry the post-image; deleted paths carry
    # the pre-image.  Missing manifest rows remain analyzer findings, but a row
    # that exists may not contradict the corresponding change digest.
    files_by_path = {row["path"]: row for row in normalized["files"]}
    for change in normalized["changes"]:
        manifest_row = files_by_path.get(change["path"])
        if manifest_row is None:
            continue
        expected_sha = (
            change["before_sha256"]
            if change["change"] == "deleted"
            else change["after_sha256"]
        )
        if manifest_row["sha256"] != expected_sha:
            raise RepoAtlasError(
                f"changes:file_manifest_sha_mismatch:{change['path']}"
            )
    return normalized


def _build_source_only_api():
    # Capture the reviewed analyzer once, then retire its ordinary module-level
    # compiler/verifier names.  Because importing a submodule initializes the
    # parent package first, `import repoatlas._core_source_v1` cannot recover a
    # second normal compiler surface after this package has initialized.
    source_compile = _source.compile_packet
    for name in ("compile_packet", "verify_bundle"):
        if hasattr(_source, name):
            delattr(_source, name)

    def compile_packet(raw: Any) -> tuple[dict[str, Any], dict[str, Any]]:
        _validate_source_input(raw)
        try:
            return source_compile(raw)
        except UnicodeEncodeError as exc:
            raise RepoAtlasError("invalid_unicode_scalar") from exc
        except RecursionError as exc:
            raise RepoAtlasError("input_too_deep") from exc

    def verify_bundle(raw: Any, packet: Any, receipt: Any) -> bool:
        _validate_source_input(raw)
        expected_packet, expected_receipt = compile_packet(raw)
        if packet != expected_packet:
            raise RepoAtlasError("verify:packet_mismatch")
        if receipt != expected_receipt:
            raise RepoAtlasError("verify:receipt_mismatch")
        return True

    return compile_packet, verify_bundle


compile_packet, verify_bundle = _build_source_only_api()
del _build_source_only_api
