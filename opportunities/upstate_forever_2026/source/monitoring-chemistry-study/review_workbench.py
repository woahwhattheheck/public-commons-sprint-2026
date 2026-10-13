"""Add a portable analyst review to the existing completed Chemistry workbench."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
import tempfile
from pathlib import Path
import re

VERSION = "chemistry-review-20261013-v2"
CSS = """
#chemistry-review-ui .controls input{border:1px solid #888;padding:9px;min-width:0;max-width:100%}
.cr-table{min-width:780px}.cr-table td{overflow-wrap:anywhere}.cr-note-preview{white-space:pre-wrap;max-width:260px}
.cr-dialog-body{padding:20px}#chemistry-review-dialog{width:min(900px,95vw);height:auto;max-height:92vh}
.cr-note-label{display:flex;flex-direction:column;gap:8px;font-weight:600}
#cr-edit-note{font:inherit;padding:10px;box-sizing:border-box;width:100%;resize:vertical}
#cr-raw-record,.cr-conflict pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.5 monospace;background:#f4f4f4;padding:12px}
.cr-conflict{border-top:1px solid #bbb;padding:14px 0}.cr-conflict h4{margin:8px 0}
#cr-status-message{overflow-wrap:anywhere}#cr-binding{word-break:break-word}
@media(max-width:800px){#chemistry-review-ui .controls{align-items:stretch}#chemistry-review-ui .controls label{width:100%}.cr-dialog-body{padding:14px}#chemistry-review-dialog .dialog-head{align-items:start;gap:10px}#cr-record-title{overflow-wrap:anywhere}}
"""


def augment(html: str) -> str:
    """Preserve all original results/downloads and attach a separate review workspace."""
    current_script = Path(__file__).with_name("chemistry_review.js").read_text(encoding="utf-8")
    existing = re.search(r'(<script\b[^>]*\bid="chemistry-review-extension"[^>]*>)(.*?)(</script\s*>)', html, re.S | re.I)
    if existing:
        previous = existing.group(2)
        if previous == current_script:
            return html
        if hashlib.sha256(previous.encode("utf-8")).hexdigest() != "41e2b57c5bbf008e9657404c669f9f38d49712c0c2c2d9c51de2862d41a86f52":
            raise ValueError("The current review controller differs from the retained complete predecessor.")
        return html[:existing.start(2)] + current_script + html[existing.end(2):]
    match = re.search(r'<script\b[^>]*\bid="study-data"[^>]*>(.*?)</script\s*>', html, re.S | re.I)
    if not match:
        raise ValueError("Choose the existing populated Monitoring + Chemistry workbench.")
    body = match.group(1)
    data = json.loads(body)
    chemistry = data["chemistry"]
    required = {"calibration", "sensitivity", "uncertainty", "monitoring"}
    if set(chemistry["results"]) != required or not data.get("files"):
        raise ValueError("The completed four analyses and original downloads are required.")
    for selector in ('id="chemistry"', 'id="analysis"', 'id="reach"', 'id="operator"'):
        if selector not in html:
            raise ValueError("The original workbench is missing " + selector)
    binding = {
        "schema": "upstate.chemistry-review-binding/v1",
        "case_id": chemistry["case_id"], "engine_version": chemistry["engine_version"],
        "project_id": data["budget"]["comparison"]["project_id"],
        "study_data_sha256": hashlib.sha256(body.encode("utf-8")).hexdigest(),
    }
    script = current_script
    encoded = json.dumps(binding, separators=(",", ":"), ensure_ascii=False).replace("<", "\\u003c")
    insert = ('<style id="chemistry-review-style">' + CSS + '</style>\n'
              '<script id="chemistry-review-binding" type="application/json">' + encoded + '</script>\n'
              '<script id="chemistry-review-hydration">'
              'for(const id of ["reach","operator"]){const seen=new Set();'
              'for(const option of [...document.getElementById(id).options]){'
              'if(seen.has(option.value))option.remove();else seen.add(option.value);}}'
              '</script>\n'
              '<script id="chemistry-review-extension">' + script + '</script>\n')
    if not re.search(r'</body\s*>', html, re.I):
        raise ValueError("The original workbench has no closing body.")
    return re.sub(r'</body\s*>', lambda _: insert + '</body>', html, count=1, flags=re.I)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.input.resolve() == args.output.resolve():
        raise ValueError("Keep the original HTML; choose a distinct output path.")
    result = augment(args.input.read_bytes().decode("utf-8"))
    body = result.encode("utf-8")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    if args.output.exists():
        if args.output.read_bytes() != body:
            raise ValueError("The output already contains different complete bytes.")
    else:
        descriptor, temporary_name = tempfile.mkstemp(prefix="."+args.output.name+".review-", dir=str(args.output.parent))
        temporary = Path(temporary_name)
        try:
            with os.fdopen(descriptor, "wb") as output:
                output.write(body); output.flush(); os.fsync(output.fileno())
            try:
                os.link(temporary, args.output)
            except FileExistsError:
                if args.output.read_bytes() != body:
                    raise ValueError("A different output was published concurrently.")
            directory = os.open(str(args.output.parent), os.O_RDONLY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
        finally:
            temporary.unlink(missing_ok=True)
    print(json.dumps({"path": str(args.output), "bytes": args.output.stat().st_size,
                      "sha256": hashlib.sha256(args.output.read_bytes()).hexdigest(), "version": VERSION}))


if __name__ == "__main__":
    main()
