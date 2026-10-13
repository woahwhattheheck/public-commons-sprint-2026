"""Build the self-contained implementation field workbench from installed sources."""
from __future__ import annotations

import argparse
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


def build(application: Path, output: Path | None = None) -> dict:
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
    script += "\nconst catalog = " + json.dumps(catalog, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c") + ";\n"
    script += "window.implementationWorkbench = IMPLEMENTATION_UI.mountPortableImplementation(document.getElementById('implementation-root'), catalog);\n"
    script = re.sub(r"</script", r"<\\/script", script, flags=re.I)
    css = sources["css"].replace("</style", "<\\/style")
    html = (
        '<!doctype html>\n<html lang="en"><head><meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width,initial-scale=1">\n'
        '<meta name="color-scheme" content="light">\n'
        '<title>Upper Savannah implementation and field monitoring</title>\n'
        '<style>html{background:#eceef0}body{margin:20px auto;max-width:1500px;padding:0 12px}'
        '#implementation-root{border:1px solid #cbd0d5;background:white}'
        '@media(max-width:800px){body{margin:0;padding:0}#implementation-root{border:0}}'
        + css + '</style></head><body>\n'
        '<div id="implementation-root"></div>'
        '<noscript>This field workbench uses JavaScript for local plan editing and exports.</noscript>\n'
        '<script>' + script + '</script>\n</body></html>\n'
    )
    encoded = html.encode("utf-8")
    output = output or application / "operator/web/implementation_workbench.html"
    output = output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(prefix=output.name + ".", suffix=".tmp", dir=output.parent, delete=False) as handle:
        temporary = Path(handle.name)
        handle.write(encoded)
        handle.flush()
        os.fsync(handle.fileno())
    try:
        os.replace(temporary, output)
    finally:
        temporary.unlink(missing_ok=True)
    return {
        "schema": "upstate.implementation-offline-build/v1",
        "path": str(output),
        "bytes": len(encoded),
        "sha256": hashlib.sha256(encoded).hexdigest(),
        "inputs": {
            relative: {"bytes": len(sources[key].encode("utf-8")), "sha256": hashlib.sha256(sources[key].encode("utf-8")).hexdigest()}
            for key, relative in PARTS.items()
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", type=Path, default=Path(__file__).resolve().parent)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    print(json.dumps(build(args.application, args.output), indent=2))


if __name__ == "__main__":
    main()
