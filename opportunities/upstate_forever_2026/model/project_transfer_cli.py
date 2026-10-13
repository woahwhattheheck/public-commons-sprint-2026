"""Command-line operating surface for whole-project incremental handover."""
from __future__ import annotations
import argparse
import csv
import html
import json
import sys
from pathlib import Path
from .project_transfer import (TransferStore, TransferError, Cancelled, canonical,
                              load_json, receive_directory, verify_directory)


def export_report(store, snapshot_id, directory):
    """Complete machine-readable and human-readable transfer inventory."""
    value = store.report(snapshot_id)
    out = Path(directory)
    out.mkdir(parents=True, exist_ok=True)
    from .project_transfer import _atomic
    _atomic(out / "transfer-report.json", canonical(value) + b"\n", replace=True)
    import io
    stream = io.StringIO(newline="")
    writer = csv.DictWriter(stream, fieldnames=["path", "bytes", "sha256", "blocks"])
    writer.writeheader()
    writer.writerows(value["files"])
    _atomic(out / "files.csv", stream.getvalue().encode(), replace=True)
    e = lambda x: html.escape(str(x))
    rows = "".join(f'<tr><td>{e(r["path"])}</td><td>{r["bytes"]:,}</td><td><code>{r["sha256"]}</code></td></tr>' for r in value["files"])
    request = value["request"]
    body = f'''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Project transfer inventory</title><style>body{{font:16px system-ui;margin:2rem;line-height:1.5;color:#171717;background:#fff}}
main{{max-width:1200px;margin:auto}}h1{{font-size:1.9rem}}code{{overflow-wrap:anywhere;font-size:.8rem}}
table{{border-collapse:collapse;width:100%}}td,th{{border-bottom:1px solid #aaa;text-align:left;padding:.65rem;vertical-align:top}}td:first-child{{overflow-wrap:anywhere}}.facts{{padding:1rem;border:1px solid #777}}a{{color:inherit}}
</style><main><p>TOKENJUNKIELABS / PROJECT HANDOVER</p><h1>{e(value['project'].get('title', 'Scientific project'))}</h1>
<div class="facts"><b>{'Ready to receive' if request['complete'] else 'Transfer in progress'}</b><p>{value['file_count']:,} original files · {value['logical_bytes']:,} retained bytes · {value['deduplicated_bytes']:,} duplicate bytes stored once.</p>
<p>{request['blocks_present']:,} / {request['blocks_total']:,} unique blocks present. {request['bytes_remaining']:,} bytes remain.</p><p>Snapshot <code>{snapshot_id}</code></p></div>
<p>This inventory describes the exact selected project edition. Transport preserves original data and results; it does not run a scientific calculation or change the meaning of an output.</p>
<p><a href="transfer-report.json">Complete JSON report</a> · <a href="files.csv">Complete file table</a></p>
<table><thead><tr><th>Retained file</th><th>Bytes</th><th>SHA-256</th></tr></thead><tbody>{rows}</tbody></table></main></html>'''
    _atomic(out / "index.html", body.encode(), replace=True)
    return {"snapshot_id": snapshot_id, "directory": str(out.absolute()), "files": ["index.html", "files.csv", "transfer-report.json"]}


def parser():
    p = argparse.ArgumentParser(description="Retain, transfer and reopen complete Upstate projects without repeating unchanged data.")
    p.add_argument("--store", required=True, type=Path, help="Owned transfer cache outside the live scientific workspace")
    p.add_argument("--quiet", action="store_true", help="Suppress progress on stderr")
    sub = p.add_subparsers(dest="command", required=True)
    x = sub.add_parser("capture", help="Index an original completed Workspace archive")
    x.add_argument("archive", type=Path); x.add_argument("--chunk-bytes", type=int, default=4*1024**2)
    x = sub.add_parser("capture-workspace", help="Freeze using original portable.backup, then index")
    x.add_argument("workspace", type=Path); x.add_argument("operation_id")
    x.add_argument("--omit-intermediates", action="store_true"); x.add_argument("--omit-deliveries", action="store_true")
    x = sub.add_parser("manifest"); x.add_argument("snapshot_id"); x.add_argument("--output", type=Path)
    x = sub.add_parser("accept"); x.add_argument("manifest", type=Path)
    x = sub.add_parser("needs"); x.add_argument("snapshot_id"); x.add_argument("--output", type=Path)
    x = sub.add_parser("pack"); x.add_argument("snapshot_id"); x.add_argument("output", type=Path); x.add_argument("--request", type=Path)
    x = sub.add_parser("parts"); x.add_argument("snapshot_id"); x.add_argument("directory", type=Path); x.add_argument("--request", type=Path)
    x.add_argument("--payload-bytes", type=int, default=64*1024**2, help="Payload only; ZIP and manifest metadata add overhead")
    x = sub.add_parser("receive"); x.add_argument("parts", nargs="+", type=Path)
    x = sub.add_parser("receive-range"); x.add_argument("snapshot_id"); x.add_argument("block_id"); x.add_argument("file", type=Path)
    x.add_argument("--offset", type=int, default=0)
    x = sub.add_parser("assemble"); x.add_argument("snapshot_id"); x.add_argument("output", type=Path)
    x = sub.add_parser("open-copy"); x.add_argument("snapshot_id"); x.add_argument("directory", type=Path)
    x = sub.add_parser("verify-copy"); x.add_argument("snapshot_id"); x.add_argument("directory", type=Path)
    x = sub.add_parser("restore-native"); x.add_argument("snapshot_id"); x.add_argument("directory", type=Path); x.add_argument("--workspace", type=Path, required=True)
    x = sub.add_parser("diff"); x.add_argument("before"); x.add_argument("after")
    x = sub.add_parser("report"); x.add_argument("snapshot_id"); x.add_argument("--directory", type=Path)
    sub.add_parser("list")
    x = sub.add_parser("serve", help="Open the loopback browser handover desk")
    x.add_argument("--port", type=int, default=8876); x.add_argument("--workspace", type=Path); x.add_argument("--receive-directory", type=Path)
    return p


def main(argv=None):
    args = parser().parse_args(argv)
    store = TransferStore(args.store)
    progress = None if args.quiet else lambda row: print(json.dumps(row, ensure_ascii=False), file=sys.stderr, flush=True)
    cmd = args.command
    try:
        if cmd == "serve":
            from .project_transfer_desk import serve
            serve(store.root, port=args.port, workspace=args.workspace, receive_directory=args.receive_directory)
            return 0
        if cmd == "capture":
            result = store.capture_archive(args.archive, chunk_bytes=args.chunk_bytes, progress=progress)
        elif cmd == "capture-workspace":
            from .workspace import Workspace
            from .project_transfer_workspace import NativeProjectTransfer
            result = NativeProjectTransfer(Workspace(args.workspace), store.root).capture(args.operation_id,
                include_intermediates=not args.omit_intermediates, include_deliveries=not args.omit_deliveries, progress=progress)
        elif cmd == "manifest": result = store.snapshot(args.snapshot_id)
        elif cmd == "accept":
            result = {"snapshot_id": store.accept_snapshot(load_json(args.manifest))}
        elif cmd == "needs": result = store.needs(args.snapshot_id)
        elif cmd in ("pack", "parts"):
            request = load_json(args.request) if args.request else None
            result = (store.write_pack(args.snapshot_id, args.output, request=request) if cmd == "pack" else
                      store.write_parts(args.snapshot_id, args.directory, request=request, payload_bytes=args.payload_bytes, progress=progress))
        elif cmd == "receive": result = [store.receive_pack(p, progress=progress) for p in args.parts]
        elif cmd == "receive-range":
            with args.file.open("rb") as source:
                result = store.receive_block(args.snapshot_id, args.block_id, source, offset=args.offset, length=args.file.stat().st_size, progress=progress)
        elif cmd == "assemble": result = store.materialize_archive(args.snapshot_id, args.output, progress=progress)
        elif cmd == "open-copy": result = receive_directory(store, args.snapshot_id, args.directory, progress=progress)
        elif cmd == "verify-copy": result = verify_directory(store, args.snapshot_id, args.directory)
        elif cmd == "restore-native":
            from .workspace import Workspace
            from .project_transfer_workspace import NativeProjectTransfer
            result = NativeProjectTransfer(Workspace(args.workspace), store.root).restore(args.snapshot_id, args.directory, progress=progress)
        elif cmd == "diff": result = store.difference(args.before, args.after)
        elif cmd == "report": result = export_report(store, args.snapshot_id, args.directory) if args.directory else store.report(args.snapshot_id)
        elif cmd == "list": result = store.list_snapshots()
        else: raise TransferError("Unknown command")
        if getattr(args, "output", None) and cmd in ("manifest", "needs"):
            from .project_transfer import _atomic
            _atomic(args.output, canonical(result) + b"\n")
        print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))
        return 0
    except (TransferError, OSError, KeyError, ImportError) as exc:
        print(json.dumps({"ok": False, "error": type(exc).__name__, "message": str(exc)}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
