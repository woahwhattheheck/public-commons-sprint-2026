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


def parse_json_bytes(data: bytes) -> Any:
    try:
        return _source.parse_json_bytes(data)
    except RecursionError as exc:
        raise RepoAtlasError("json_too_deep") from exc
    except UnicodeEncodeError as exc:
        raise RepoAtlasError("invalid_unicode_scalar") from exc


def _validate_source_input(raw: Any) -> dict[str, Any]:
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
