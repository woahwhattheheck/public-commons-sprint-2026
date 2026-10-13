#!/usr/bin/env python3
"""Receive the authored adapter course with an installed Node 22+ runtime."""
import os, sys, pathlib, zipfile, subprocess, shutil
source = pathlib.Path(__file__).resolve().parent
root = pathlib.Path(sys.argv[1]).resolve()
root.mkdir(mode=0o700, parents=False, exist_ok=False)
with zipfile.ZipFile(root / "authored.xlsx", "w", compression=zipfile.ZIP_DEFLATED) as z:
    z.writestr("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>')
    z.writestr("xl/workbook.xml", '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets/></workbook>')
node = os.environ.get("CODEX_PRIMARY_RUNTIME_NODE") or shutil.which("node")
if not node:
    raise SystemExit("An installed Node 22+ executable is required.")
result = subprocess.run([node, str(source / "adapter-authored-receiving.mjs"), str(root)], cwd=source)
raise SystemExit(result.returncode)
