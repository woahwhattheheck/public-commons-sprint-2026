"""Offline human review of canonical traces; replay is not source authentication."""
from __future__ import annotations

import argparse
import base64
import hashlib
import html
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import sys
import tempfile
from typing import Any

from .agent import canonical, verify_trace
from .vision import MAX_IMAGE_BYTES, VisionError

MANIFEST_SCHEMA = "visualledger-review-manifest/v1"
MAX_DOCUMENTS = 16
MAX_JSON_BYTES = 256 * 1024
MAX_BATCH_BYTES = 80 * 1024 * 1024
MAX_HTML_BYTES = 32 * 1024 * 1024
ROUTES = {
    "REQUEST_RECAPTURE": "Request a new capture",
    "REQUEST_HUMAN_CROP": "Ask a person to identify the document",
    "QUARANTINE_DUPLICATE_REVIEW": "Review a visual-similarity candidate",
    "REQUEST_FIELD_EXTRACTION": "Request field extraction and human verification",
}
CSS = """
:root{font-family:system-ui,sans-serif;line-height:1.5;color:#17232b;background:#f2f4f5}
*{box-sizing:border-box}body{margin:0}main{max-width:1180px;margin:auto;padding:24px}
h1{font-size:2.2rem;line-height:1.15}h2{font-size:1.5rem}h3{font-size:1.05rem}
p{max-width:85ch}header,.document{background:white;border:1px solid #ccd5d9;border-radius:12px;padding:24px;margin-bottom:20px}
.notice{border-left:5px solid #9b5515;background:#fff5e9;padding:12px 16px}
.layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:24px}
figure{margin:0}img{display:block;width:100%;height:auto;max-height:660px;object-fit:contain;background:#edf0f2}
figcaption{font-size:.9rem;margin-top:8px}.tag{font-weight:650}.route{font-size:1.1rem;font-weight:700}
code,pre{overflow-wrap:anywhere;white-space:pre-wrap;font-size:.85rem}pre{padding:12px;background:#f2f4f5}
table{border-collapse:collapse;width:100%;table-layout:fixed;font-size:.9rem}th,td{border-bottom:1px solid #d6dfe2;padding:8px;text-align:left;vertical-align:top;overflow-wrap:anywhere}
summary{cursor:pointer;font-weight:650;padding:12px 0}dt{font-weight:650}dd{margin:0 0 10px;overflow-wrap:anywhere}
footer{font-size:.9rem;margin:20px 0}@media(max-width:760px){main{padding:12px}.layout{grid-template-columns:1fr}header,.document{padding:16px}h1{font-size:1.75rem}}
@media print{body{background:white}main{max-width:none;padding:0}.document{break-inside:avoid}details{display:block}}
""".strip()


class ReviewError(ValueError):
    """The input cannot produce a complete, replay-matched review."""


def _pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ReviewError("duplicate JSON object key")
        result[key] = value
    return result


def _constant(value: str) -> None:
    raise ReviewError("non-finite JSON number")


def _json(raw: bytes) -> Any:
    if type(raw) is not bytes or not raw or len(raw) > MAX_JSON_BYTES:
        raise ReviewError("JSON input is empty or exceeds the size bound")
    try:
        return json.loads(raw.decode("utf-8"), object_pairs_hook=_pairs,
                          parse_constant=_constant)
    except (UnicodeError, ValueError, RecursionError) as exc:
        raise ReviewError("invalid bounded JSON input") from exc


def _snapshot(value: Any) -> Any:
    try:
        return _json(canonical(value))
    except (TypeError, ValueError, OverflowError, RecursionError) as exc:
        raise ReviewError("input is not bounded canonical JSON") from exc


def _escape(value: Any) -> str:
    return html.escape(str(value), quote=True)


def _preview(raw: bytes) -> bytes:
    # Called only AFTER canonical replay validates the same immutable raw bytes.
    # Re-encoding strips the original container, metadata and trailing payloads.
    import cv2
    import numpy as np
    image = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise ReviewError("preview decode failed")
    height, width = image.shape[:2]
    scale = min(1.0, 1024 / max(width, height))
    if scale < 1:
        image = cv2.resize(image, (max(1, round(width * scale)),
                                  max(1, round(height * scale))), interpolation=cv2.INTER_AREA)
    ok, encoded = cv2.imencode(".png", image, [cv2.IMWRITE_PNG_COMPRESSION, 9])
    if not ok:
        raise ReviewError("preview encode failed")
    return encoded.tobytes()


def _document(trace: dict[str, Any], prior: list[Any], png: bytes, index: int) -> str:
    p, d = trace["perception"], trace["decision"]
    fields = [
        ("Document candidates", p["document_candidate_count"], "one for extraction"),
        ("Blur variance (milli)", p["laplacian_variance_milli"],
         "minimum " + str(p["policy"]["min_laplacian_variance_milli"])),
        ("Contrast (milli)", p["contrast_milli"], "minimum " + str(p["policy"]["min_contrast_milli"])),
        ("Glare (parts per million)", p["glare_ppm"], "maximum " + str(p["policy"]["max_glare_ppm"])),
        ("Edge density (parts per million)", p["edge_ppm"], "minimum " + str(p["policy"]["min_edge_ppm"])),
        ("Text-line structure count", p["text_line_count"], "minimum " + str(p["policy"]["min_text_line_count"])),
    ]
    rows = "".join("<tr>" + "".join("<td>" + _escape(cell) + "</td>" for cell in row) + "</tr>" for row in fields)
    reasons = "".join("<li><code>" + _escape(reason) + "</code></li>" for reason in d["reasons"])
    nearest = p["nearest_prior"]
    match = ("No supplied prior is available." if nearest is None else
             "Nearest supplied prior: " + _escape(nearest["evidence_id"]) +
             "; dHash distance " + str(nearest["hamming"]) + ". Similarity is not duplicate-payment or fraud proof.")
    runtime = ("OpenCV runtime reports competition compatibility; this does not establish competition eligibility or submission."
               if p["competition_opencv5_runtime"] else
               "DEVELOPMENT COMPATIBILITY ONLY — not OpenCV-5 competition-runtime evidence.")
    identity = {
        "Source image SHA-256": p["source_sha256"],
        "Canonical normalized PNG SHA-256 (not the preview)": p["normalized_png_sha256"],
        "Trace receipt SHA-256": trace["receipt_sha256"],
        "Supplied prior-context SHA-256": hashlib.sha256(canonical(prior)).hexdigest(),
        "Display preview PNG SHA-256": hashlib.sha256(png).hexdigest(),
    }
    ids = "".join("<dt>" + _escape(k) + "</dt><dd><code>" + _escape(v) + "</code></dd>" for k, v in identity.items())
    return f"""<section class="document" aria-labelledby="doc-{index}">
<h2 id="doc-{index}">{index}. {_escape(trace['evidence_id'])}</h2>
<p class="tag">REPLAY MATCHED · HUMAN REVIEW REQUIRED</p>
<p class="route">{_escape(ROUTES[d['action']])}</p><p><code>{_escape(d['action'])}</code></p>
<div class="layout"><figure><img alt="Source document preview {_escape(trace['evidence_id'])}" width="1024" src="data:image/png;base64,{base64.b64encode(png).decode('ascii')}">
<figcaption>Re-encoded, possibly resized source preview. Not the perspective-normalized evidence image. Source dimensions: {p['width']} × {p['height']}.</figcaption></figure>
<div><h3>Why this next step?</h3><ul>{reasons}</ul><p>{match}</p>
<table><caption>Canonical measurements and declared policy</caption><thead><tr><th scope="col">Measurement</th><th scope="col">Observed</th><th scope="col">Policy</th></tr></thead><tbody>{rows}</tbody></table>
<p><strong>Runtime:</strong> OpenCV {_escape(p['opencv_version'])}. {_escape(runtime)}</p>
<p>Canonical normalized dimensions: {p['normalized_width']} × {p['normalized_height']}. Supplied prior records: {len(prior)}.</p></div></div>
<details><summary>Evidence identifiers and complete replayed trace</summary><dl>{ids}</dl>
<pre>{_escape(json.dumps(trace, sort_keys=True, indent=2, ensure_ascii=True, allow_nan=False))}</pre></details></section>"""


def render_review(documents: list[dict[str, Any]], *, allow_opencv4_dev: bool = False) -> str:
    """Replay every image/trace/context before rendering a single complete page.

    Each document has exactly ``raw`` (bytes), ``trace`` (dict) and
    ``prior_fingerprints`` (list). The caller supplies the same prior context used
    to compile the trace. This function neither fetches nor authenticates priors.
    """
    if type(allow_opencv4_dev) is not bool:
        raise ReviewError("development compatibility must be an explicit boolean")
    if type(documents) is not list or not 1 <= len(documents) <= MAX_DOCUMENTS:
        raise ReviewError("review requires between 1 and 16 documents")
    sections: list[str] = []
    seen: set[str] = set()
    total = 0
    output_size = 0
    for index, entry in enumerate(documents, 1):
        if type(entry) is not dict or set(entry) != {"raw", "trace", "prior_fingerprints"}:
            raise ReviewError("invalid review document fields")
        raw = entry["raw"]
        if type(raw) is not bytes or not raw or len(raw) > MAX_IMAGE_BYTES:
            raise ReviewError("source must be bounded nonempty bytes")
        total += len(raw)
        if total > MAX_BATCH_BYTES:
            raise ReviewError("batch source-byte limit exceeded")
        if type(entry["trace"]) is not dict or type(entry["prior_fingerprints"]) is not list:
            raise ReviewError("trace must be an object and prior context must be a list")
        trace, prior = _snapshot(entry["trace"]), _snapshot(entry["prior_fingerprints"])
        try:
            verified = verify_trace(trace, raw, prior_fingerprints=prior,
                                    allow_opencv4_dev=allow_opencv4_dev)
        except (VisionError, KeyError, TypeError, OverflowError) as exc:
            raise ReviewError("canonical image/trace/context replay rejected") from exc
        evidence_id = verified["evidence_id"]
        if evidence_id in seen:
            raise ReviewError("duplicate evidence identifier in review")
        seen.add(evidence_id)
        section = _document(verified, prior, _preview(raw), index)
        output_size += len(section.encode("utf-8"))
        if output_size > MAX_HTML_BYTES - 8192:
            raise ReviewError("review output size limit exceeded")
        sections.append(section)
    style_hash = base64.b64encode(hashlib.sha256(CSS.encode("utf-8")).digest()).decode("ascii")
    csp = "default-src 'none'; img-src data:; style-src 'sha256-" + style_hash + "'; base-uri 'none'; form-action 'none'"
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="{_escape(csp)}">
<title>VisualLedger · Human review</title><style>{CSS}</style></head><body><main>
<header><p class="tag">VISUALLEDGER / OFFLINE REVIEW</p><h1>See the evidence. Keep the decision human.</h1>
<p>{len(documents)} document(s) replayed against their exact source bytes, declared policy, supplied prior context and current runtime.</p>
<p class="notice"><strong>Replay is not authentication.</strong> This page checks computational consistency, not document truth, ownership, supplier identity, external provenance or the DynamoDB HMAC seal. Anyone able to replace all inputs can create a new consistent review. This HTML is a presentation, not a signed receipt. Preserve the original inputs and regenerate it to check a received copy.</p>
<p>No expense or invoice is approved or rejected. No accounting entry, payment, external message, tax conclusion, revenue, customer use, AWS deployment or competition submission is established. A visual-similarity candidate needs human investigation.</p></header>
{''.join(sections)}
<footer>Generated locally with no JavaScript, external fonts, network resources, tracking or send controls. Treat this page as confidential: it embeds document pixels and trace identifiers. Do not publish customer evidence publicly.</footer>
</main></body></html>"""


def _relative(value: Any) -> tuple[str, ...]:
    if type(value) is not str or len(value) > 240:
        raise ReviewError("input path must be a bounded relative path")
    parts = value.split("/")
    if not parts or any(not re.fullmatch(r"[A-Za-z0-9_][A-Za-z0-9_.-]{0,95}", part) or part in (".", "..") for part in parts):
        raise ReviewError("unsafe relative input path")
    if str(PurePosixPath(value)) != value:
        raise ReviewError("non-canonical input path")
    return tuple(parts)


def _read_at(root_fd: int, value: Any, maximum: int) -> bytes:
    parts = _relative(value)
    fd = os.dup(root_fd)
    try:
        for part in parts[:-1]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = child
        file_fd = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
        with os.fdopen(file_fd, "rb") as stream:
            info = os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode) or not 0 < info.st_size <= maximum:
                raise ReviewError("input is not a bounded regular file")
            raw = stream.read(maximum + 1)
            if not raw or len(raw) > maximum:
                raise ReviewError("input changed beyond size bound")
            return raw
    finally:
        os.close(fd)


def load_manifest(path: Path) -> list[dict[str, Any]]:
    """Read regular no-symlink inputs under the explicitly selected parent."""
    if not hasattr(os, "O_NOFOLLOW") or not hasattr(os, "O_DIRECTORY"):
        raise ReviewError("secure manifest input requires a POSIX host")
    parent = path.parent.resolve(strict=True)
    root_fd = os.open(parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        manifest = _json(_read_at(root_fd, path.name, MAX_JSON_BYTES))
        if type(manifest) is not dict or set(manifest) != {"schema", "documents"} or manifest["schema"] != MANIFEST_SCHEMA:
            raise ReviewError("invalid review manifest schema")
        rows = manifest["documents"]
        if type(rows) is not list or not 1 <= len(rows) <= MAX_DOCUMENTS:
            raise ReviewError("manifest requires between 1 and 16 documents")
        documents = []
        total = 0
        for row in rows:
            if type(row) is not dict or set(row) != {"image", "trace", "prior_fingerprints"}:
                raise ReviewError("invalid manifest document fields")
            if type(row["prior_fingerprints"]) is not list:
                raise ReviewError("explicit prior context must be a list")
            raw = _read_at(root_fd, row["image"], MAX_IMAGE_BYTES)
            total += len(raw)
            if total > MAX_BATCH_BYTES:
                raise ReviewError("batch source-byte limit exceeded")
            documents.append({"raw": raw, "trace": _json(_read_at(root_fd, row["trace"], MAX_JSON_BYTES)),
                              "prior_fingerprints": row["prior_fingerprints"]})
        return documents
    finally:
        os.close(root_fd)


def write_review(path: Path, content: str) -> None:
    """Atomically publish a new file, refusing an existing file or symlink."""
    data = content.encode("utf-8")
    if not data or len(data) > MAX_HTML_BYTES:
        raise ReviewError("invalid output size")
    parent = path.parent.resolve(strict=True)
    temporary: str | None = None
    try:
        with tempfile.NamedTemporaryFile(dir=parent, prefix=".visualledger-review-", delete=False) as out:
            temporary = out.name
            out.write(data)
            out.flush()
            os.fsync(out.fileno())
        os.link(temporary, parent / path.name, follow_symlinks=False)
    finally:
        if temporary is not None:
            os.unlink(temporary)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--allow-opencv4-dev", action="store_true")
    args = parser.parse_args(argv)
    try:
        documents = load_manifest(args.manifest)
        content = render_review(documents, allow_opencv4_dev=args.allow_opencv4_dev)
        write_review(args.output, content)
    except (ReviewError, OSError, ValueError) as exc:
        print("review rejected: " + type(exc).__name__, file=sys.stderr)
        return 2
    print(json.dumps({"schema": "visualledger-review-export/v1", "documents": len(documents),
                      "html_sha256": hashlib.sha256(content.encode("utf-8")).hexdigest(),
                      "source_authentication": False, "human_review_required": True}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
