"""Build the self-contained implementation field workbench from installed sources."""
from __future__ import annotations

import argparse
import base64
from copy import deepcopy
import hashlib
import json
import os
import re
import tempfile
from pathlib import Path

PARTS = {
    "core": "operator/web/implementation_core.mjs",
    "forms": "operator/web/implementation_forms.mjs",
    "evidence": "operator/web/implementation_evidence.mjs",
    "evidence_ui": "operator/web/implementation_evidence_ui.mjs",
    "results": "operator/web/implementation_results.mjs",
    "briefing": "operator/web/implementation_briefing.mjs",
    "site_visit_csv": "operator/web/implementation_site_visit_csv.mjs",
    "site_visit": "operator/web/implementation_site_visit.mjs",
    "field_start": "operator/web/implementation_field_start.mjs",
    "ui": "operator/web/implementation.mjs",
    "css": "operator/web/implementation.css",
    "catalog": "operator/web/implementation_catalog.json",
}


def _module(source: str, name: str, bindings: dict[str, str]) -> str:
    exports = re.findall(r"^export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)", source, re.M)
    if not exports:
        raise ValueError(f"{name}: no public module exports")
    def replace_import(match: re.Match) -> str:
        imported, path = match.group(1), match.group(2)
        if path not in bindings:
            raise ValueError(f"{name}: unexpected module dependency {path!r}")
        if not re.fullmatch(r"[\w\s,$]+", imported):
            raise ValueError(f"{name}: unsupported import binding")
        return "const {" + imported + "} = " + bindings[path] + ";"
    source = re.sub(r"^import\s*\{([^}]+)\}\s*from\s*['\"]([^'\"]+)['\"];?\s*$", replace_import, source, flags=re.M)
    if re.search(r"^\s*import\b", source, re.M):
        raise ValueError(f"{name}: unresolved module import")
    source = re.sub(r"^export\s+", "", source, flags=re.M)
    return "const " + name + " = (() => {\n" + source + "\nreturn {" + ",".join(exports) + "};\n})();\n"


def build(application: Path, output: Path | None = None, *, field_packet=None, field_files=()) -> dict:
    application = application.resolve()
    sources = {key: (application / relative).read_text(encoding="utf-8") for key, relative in PARTS.items()}
    catalog = json.loads(sources["catalog"])
    if catalog.get("schema") != "upstate.implementation-methods/v1":
        raise ValueError("The installed implementation catalog has an unexpected schema.")
    script = _module(sources["core"], "IMPLEMENTATION_CORE", {})
    script += _module(sources["forms"], "IMPLEMENTATION_FORMS", {"./implementation_core.mjs": "IMPLEMENTATION_CORE"})
    script += _module(sources["results"], "IMPLEMENTATION_RESULTS", {"./implementation_core.mjs": "IMPLEMENTATION_CORE"})
    script += _module(sources["briefing"], "IMPLEMENTATION_BRIEFING", {"./implementation_core.mjs": "IMPLEMENTATION_CORE"})
    script += _module(sources["evidence"], "IMPLEMENTATION_EVIDENCE", {})
    script += _module(sources["evidence_ui"], "IMPLEMENTATION_EVIDENCE_UI", {
        "./implementation_core.mjs": "IMPLEMENTATION_CORE",
        "./implementation_evidence.mjs": "IMPLEMENTATION_EVIDENCE",
    })
    script += _module(sources["site_visit_csv"], "IMPLEMENTATION_SITE_VISIT_CSV", {
        "./implementation_core.mjs": "IMPLEMENTATION_CORE",
        "./implementation_evidence.mjs": "IMPLEMENTATION_EVIDENCE",
    })
    script += _module(sources["site_visit"], "IMPLEMENTATION_SITE_VISIT", {
        "./implementation_core.mjs": "IMPLEMENTATION_CORE",
        "./implementation_evidence.mjs": "IMPLEMENTATION_EVIDENCE",
        "./implementation_site_visit_csv.mjs": "IMPLEMENTATION_SITE_VISIT_CSV",
    })
    script += _module(sources["ui"], "IMPLEMENTATION_UI", {
        "./implementation_core.mjs": "IMPLEMENTATION_CORE",
        "./implementation_forms.mjs": "IMPLEMENTATION_FORMS",
        "./implementation_results.mjs": "IMPLEMENTATION_RESULTS",
        "./implementation_briefing.mjs": "IMPLEMENTATION_BRIEFING",
        "./implementation_evidence_ui.mjs": "IMPLEMENTATION_EVIDENCE_UI",
        "./implementation_site_visit.mjs": "IMPLEMENTATION_SITE_VISIT",
    })
    script += _module(sources["field_start"], "IMPLEMENTATION_FIELD_START", {
        "./implementation_core.mjs": "IMPLEMENTATION_CORE",
    })
    packet, originals = None, []
    if field_packet is not None:
        from model.implementation_schema import validate_plan, document_digest
        if (not isinstance(field_packet, dict)
                or field_packet.get("schema") != "upstate.offline-field-packet/v1"
                or not isinstance(field_packet.get("workspace_id"), str)
                or not field_packet["workspace_id"]
                or not re.fullmatch(r"[0-9a-f]{64}", str(field_packet.get("deployment_id", "")))):
            raise ValueError("Choose the original prepared field-packet identity")
        packet = deepcopy(field_packet)
        plan = validate_plan(packet["plan"])
        if plan["revision"] < 1:
            raise ValueError("The field packet needs an original saved native revision")
        ids = packet.get("visit_ids")
        available = {row["id"] for row in plan["visits"]}
        if (not isinstance(ids, list) or not ids or any(not isinstance(key, str) for key in ids)
                or len(set(ids)) != len(ids) or set(ids) - available):
            raise ValueError("Select distinct original saved visits for the field packet")
        local = {(row["sha256"], row["size_bytes"]) for row in plan["source_links"]
                 if row.get("kind") == "local_file"}
        packet["plan"], packet["files"] = plan, []
        seen = set()
        for source_path, descriptor in field_files:
            source = Path(source_path)
            key = (descriptor.get("sha256"), descriptor.get("bytes"))
            if (key not in local or source.is_symlink() or not source.is_file()
                    or source.stat().st_size != key[1]):
                raise ValueError("The embedded original attachment differs from the saved plan")
            if key in seen:
                continue
            seen.add(key)
            item = {"element_id": "field-original-" + str(len(originals)),
                    "sha256": key[0], "bytes": key[1]}
            originals.append((source, item))
            packet["files"].append(item)
        packet["document_digest"] = document_digest(plan)
    elif field_files:
        raise ValueError("Original file embedding requires its original field-packet selection")
    script += "\nconst catalog = " + json.dumps(catalog, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c") + ";\n"
    if packet is None:
        script += "window.implementationWorkbench = IMPLEMENTATION_UI.mountPortableImplementation(document.getElementById('implementation-root'), catalog);\n"
    else:
        script += (
            "const packet = JSON.parse(document.getElementById('field-packet').textContent);\n"
            "const context = IMPLEMENTATION_FIELD_START.fieldPacketContext(packet);\n"
            "const workbench = new IMPLEMENTATION_UI.ImplementationWorkbench(document.getElementById('implementation-root'), "
            "{getState:()=>({workspace_key:context.storage_key})}, catalog);\n"
            "window.implementationWorkbench = workbench;\n"
            "window.implementationReady = IMPLEMENTATION_FIELD_START.startFieldPacket(workbench, "
            "document.getElementById('field-start'), packet);\n"
            "window.implementationReady.catch(error=>{document.getElementById('field-start').textContent=error.message||String(error);workbench.fail(error);});\n"
        )
    script = re.sub(r"</script", r"<\\/script", script, flags=re.I)
    css = sources["css"].replace("</style", "<\\/style")
    before = (
        '<!doctype html>\n<html lang="en"><head><meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width,initial-scale=1">\n'
        '<meta name="color-scheme" content="light">\n'
        '<title>Upper Savannah implementation and field monitoring</title>\n'
        '<style>html{background:#eceef0}body{margin:20px auto;max-width:1500px;padding:0 12px}'
        '#implementation-root{border:1px solid #cbd0d5;background:white}'
        '.field-start{padding:20px;background:#fff;border:1px solid #bbb;margin-bottom:12px;font:15px/1.5 system-ui;color:#202020}'
        '.field-start h1{font-size:1.35rem;margin:0}.field-start label{display:block;font-weight:600}'
        '.field-start select{display:block;width:100%;max-width:54rem;min-height:40px;margin-top:5px;color:inherit;background:white}'
        '.field-start-actions{display:flex;flex-wrap:wrap;gap:8px}.field-start button{font:inherit;min-height:40px;padding:6px 12px;'
        'border:1px solid #999;border-radius:2px;background:#f5f5f5;color:inherit;cursor:pointer}'
        '@media(max-width:800px){body{margin:0;padding:0}#implementation-root{border:0}.field-start{border-width:0 0 1px;padding:16px}}'
        + css + '</style></head><body>\n'
        + ('<div id="field-start" aria-live="polite"></div>' if packet is not None else '')
        + '<div id="implementation-root"></div>'
        '<noscript>This field workbench uses JavaScript for local plan editing and exports.</noscript>\n'
    )
    after = '<script>' + script + '</script>\n</body></html>\n'
    output = output or application / "operator/web/implementation_workbench.html"
    output = output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    checksum, size, temporary = hashlib.sha256(), 0, None
    try:
        with tempfile.NamedTemporaryFile(prefix=output.name + ".", suffix=".tmp", dir=output.parent, delete=False) as handle:
            temporary = Path(handle.name)
            def write(body):
                nonlocal size
                if isinstance(body, str):
                    body = body.encode("utf-8")
                handle.write(body)
                checksum.update(body)
                size += len(body)
            write(before)
            if packet is not None:
                write('<script type="application/json" id="field-packet">')
                write(json.dumps(packet, ensure_ascii=False, separators=(",", ":"), allow_nan=False).replace("<", "\\u003c"))
                write('</script>\n')
                for source, descriptor in originals:
                    write('<script type="application/octet-stream" id="' + descriptor["element_id"] + '">')
                    original_hash, count = hashlib.sha256(), 0
                    with source.open("rb") as incoming:
                        first = os.fstat(incoming.fileno())
                        for chunk in iter(lambda: incoming.read(192 * 1024), b""):
                            original_hash.update(chunk)
                            count += len(chunk)
                            write(base64.b64encode(chunk))
                        last = os.fstat(incoming.fileno())
                    if (count != descriptor["bytes"] or original_hash.hexdigest() != descriptor["sha256"]
                            or any(getattr(first, name) != getattr(last, name) for name in
                                   ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns"))):
                        raise ValueError("An original field attachment changed while the workbench was prepared")
                    write('</script>\n')
            write(after)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, output)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    return {
        "schema": "upstate.implementation-offline-build/v1",
        "path": str(output),
        "bytes": size,
        "sha256": checksum.hexdigest(),
        "inputs": {
            relative: {"bytes": len(sources[key].encode("utf-8")), "sha256": hashlib.sha256(sources[key].encode("utf-8")).hexdigest()}
            for key, relative in PARTS.items()
        },
        **({"field_packet": {**{name: packet[name] for name in
            ("schema", "workspace_id", "deployment_id", "visit_ids", "document_digest", "files")},
            "plan_id": packet["plan"]["id"], "revision": packet["plan"]["revision"]}}
           if packet is not None else {}),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", type=Path, default=Path(__file__).resolve().parent)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    print(json.dumps(build(args.application, args.output), indent=2))


if __name__ == "__main__":
    main()
