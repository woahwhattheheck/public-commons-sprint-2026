"""Source-only authority facade for RepoAtlas.

The mature source analyzer is retained in `_core_source_v1.py`; this module owns
the supported package API and the source-only authority boundary. Caller JSON
cannot self-attest IBM/lablab registration, Bob execution, track publication,
or submission evidence. Ordinary package initialization also retires the
legacy module's direct compile/verify entrypoints so a normal private-submodule
import cannot bypass this facade.

This is cooperative Python-runtime API hardening, not hostile-interpreter or
source-file tamper resistance. A later provider transition still requires a
separately source-bound and reviewed successor.
"""
from __future__ import annotations

from typing import Any

from . import _core_source_v1 as _source

RepoAtlasError = _source.RepoAtlasError

# Byte-mode callers are already bounded by `_source.MAX_TEXT`; direct object
# callers need an equivalent structural ceiling before any validator/analyzer
# loop executes. Keep these caps intrinsic to the supported facade so callers
# cannot bypass them by constructing a Python object instead of JSON bytes.
_MAX_DIRECT_ROWS = 5_000
_MAX_DIRECT_ROW_REFS = 500
_MAX_DIRECT_TOTAL_REFS = 20_000


def parse_json_bytes(data: bytes) -> Any:
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
        # can produce a JSONDecodeError (sys.set_int_max_str_digits). Keep that
        # runtime-specific parser guard inside RepoAtlas's stable fail-closed
        # error surface rather than letting a raw traceback escape the CLI.
        raise RepoAtlasError("invalid_json") from exc


def _validate_direct_object_bounds(raw: Any) -> None:
    """Reject oversized repeated collections before the source validator walks them.

    Type/shape errors remain owned by the canonical source validator. This
    helper only constrains lists that are already ordinary Python lists, so a
    malformed object still receives the existing stable validation error while
    a syntactically valid but huge direct object cannot force unbounded work.
    """
    if type(raw) is not dict:
        return

    for name in ("changes", "adrs", "runbooks"):
        rows = raw.get(name, [])
        if type(rows) is list and len(rows) > _MAX_DIRECT_ROWS:
            raise RepoAtlasError(f"{name}:cardinality")

    files = raw.get("files", [])
    if type(files) is list:
        total_tests = 0
        for i, row in enumerate(files):
            if type(row) is not dict:
                continue
            tests = row.get("tests", [])
            if type(tests) is not list:
                continue
            if len(tests) > _MAX_DIRECT_ROW_REFS:
                raise RepoAtlasError(f"files[{i}].tests:cardinality")
            total_tests += len(tests)
            if total_tests > _MAX_DIRECT_TOTAL_REFS:
                raise RepoAtlasError("files.tests:total_cardinality")

    for name in ("adrs", "runbooks"):
        rows = raw.get(name, [])
        if type(rows) is not list:
            continue
        total_covers = 0
        for i, row in enumerate(rows):
            if type(row) is not dict:
                continue
            covers = row.get("covers", [])
            if type(covers) is not list:
                continue
            if len(covers) > _MAX_DIRECT_ROW_REFS:
                raise RepoAtlasError(f"{name}[{i}].covers:cardinality")
            total_covers += len(covers)
            if total_covers > _MAX_DIRECT_TOTAL_REFS:
                raise RepoAtlasError(f"{name}.covers:total_cardinality")


def _validate_source_input(raw: Any) -> dict[str, Any]:
    _validate_direct_object_bounds(raw)
    try:
        normalized = _source._validate(raw)
    except UnicodeEncodeError as exc:
        raise RepoAtlasError("invalid_unicode_scalar") from exc
    except RecursionError as exc:
        raise RepoAtlasError("input_too_deep") from exc

    if any(normalized["provider"].values()):
        raise RepoAtlasError("provider:external_evidence_requires_bound_successor")

    # Bind the admitted file manifest to the change image it claims to
    # describe. Added/modified paths carry the post-image; deleted paths carry
    # the pre-image. Missing manifest rows remain analyzer findings, but a row
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
    # compiler/verifier names. Because importing a submodule initializes the
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
