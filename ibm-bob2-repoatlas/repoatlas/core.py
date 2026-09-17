"""Source-only authority facade for RepoAtlas.

The original product generation is retained byte-for-byte in `_core_source_v1.py`.
This facade closes one authority seam: repository JSON cannot self-attest IBM/lablab
registration, Bob execution, track publication, or submission evidence.  This
source/demo generation remains provider-gated until a future independently
source-bound provider-evidence successor is reviewed.
"""
from __future__ import annotations

from typing import Any

from . import _core_source_v1 as _source

# Preserve the public source API without regenerating the mature analyzer.
RepoAtlasError = _source.RepoAtlasError
parse_json_bytes = _source.parse_json_bytes


def _require_source_only_provider(raw: Any) -> None:
    normalized = _source._validate(raw)
    if any(normalized["provider"].values()):
        raise RepoAtlasError("provider:external_evidence_requires_bound_successor")


def compile_packet(raw: Any) -> tuple[dict[str, Any], dict[str, Any]]:
    _require_source_only_provider(raw)
    return _source.compile_packet(raw)


def verify_bundle(raw: Any, packet: Any, receipt: Any) -> bool:
    _require_source_only_provider(raw)
    expected_packet, expected_receipt = compile_packet(raw)
    if packet != expected_packet:
        raise RepoAtlasError("verify:packet_mismatch")
    if receipt != expected_receipt:
        raise RepoAtlasError("verify:receipt_mismatch")
    return True
