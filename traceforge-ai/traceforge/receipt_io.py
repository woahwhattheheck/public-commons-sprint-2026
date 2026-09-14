from __future__ import annotations

import json
from typing import Any

from .core import (
    MAX_EVIDENCE_BYTES,
    MAX_EVIDENCE_LINES,
    MAX_MODEL_OUTPUT_BYTES,
    TraceForgeError,
)

# JSON must escape each accepted C0 control byte as six ASCII bytes (for
# example, U+0001 becomes ``\u0001``).  The remaining terms cover one object
# per accepted evidence line, one investigator output plus a skeptic reason
# that may appear both in its verdict and in ``verification_reason``, and a
# fixed margin for schema/receipt metadata and pretty-print indentation.
_JSON_ESCAPE_EXPANSION = 6
_RECEIPT_LINE_OVERHEAD_BYTES = 64
_RECEIPT_FIXED_OVERHEAD_BYTES = 256_000
MAX_RECEIPT_BYTES = (
    MAX_EVIDENCE_BYTES * _JSON_ESCAPE_EXPANSION
    + MAX_EVIDENCE_LINES * _RECEIPT_LINE_OVERHEAD_BYTES
    + MAX_MODEL_OUTPUT_BYTES * 3
    + _RECEIPT_FIXED_OVERHEAD_BYTES
)


def render_analysis_packet(value: Any, *, pretty: bool = False) -> str:
    """Serialize one analysis packet under the verifier's exact byte ceiling.

    The derived ceiling is intentionally paired with an actual-output check.
    If a future schema or model identity grows beyond the bound, TraceForge
    fails before writing or serving a packet that its own verifier would reject.
    """

    try:
        if pretty:
            rendered = json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False) + "\n"
        else:
            rendered = json.dumps(
                value,
                ensure_ascii=False,
                allow_nan=False,
                separators=(",", ":"),
            )
    except (TypeError, ValueError, OverflowError, RecursionError) as exc:
        raise TraceForgeError("analysis packet is not valid bounded JSON") from exc

    size = len(rendered.encode("utf-8"))
    if size > MAX_RECEIPT_BYTES:
        raise TraceForgeError(
            f"analysis packet exceeds verifier ceiling ({size} > {MAX_RECEIPT_BYTES} bytes)"
        )
    return rendered
