#!/usr/bin/env python3
"""Open the existing received study with the maintained local operator."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import queue
import subprocess
import sys
import threading
import time
import urllib.parse
import webbrowser

APPLICATION = Path(__file__).resolve().parents[1]

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workspace', type=Path, default=APPLICATION.parent / 'workspace')
    parser.add_argument('--python', dest='python_path', default=os.environ.get('ECOSYSTEMS_PYTHON', sys.executable))
    parser.add_argument('--operator-state', type=Path, help='Existing or new private operator state directory.')
    parser.add_argument('--no-browser', action='store_true', help='Print the local session URL instead of opening a browser.')
    parser.add_argument('--port', type=int, default=0, help='Local port; 0 selects a free port.')
    args = parser.parse_args()
    workspace = args.workspace.expanduser().resolve()
    if not workspace.is_dir():
        parser.error('Extract the complete study archive first, or select its existing workspace directory.')
    if not 0 <= args.port <= 65535:
        parser.error('Use a port from 0 through 65535.')
    identity = hashlib.sha256(str(workspace).encode()).hexdigest()[:20]
    base = Path(os.environ.get('LOCALAPPDATA') or os.environ.get('XDG_STATE_HOME') or (Path.home()/'.local/state'))
    state = (args.operator_state or base/'ecosystem-workbench'/identity).expanduser().resolve()
    if state == workspace or workspace in state.parents:
        parser.error('Keep private operator state outside the scientific workspace.')
    state.mkdir(parents=True, exist_ok=True)
    if os.name != 'nt':
        state.chmod(0o700)
    command = [args.python_path, '-B', str(APPLICATION/'operator/server.py'),
               '--workspace', str(workspace), '--operator-state', str(state), '--port', str(args.port)]
    environment = dict(os.environ)
    selected = Path(args.python_path).expanduser()
    runtime = selected.parent.parent
    if (runtime/'share/proj').is_dir():
        environment.setdefault('PROJ_DATA', str(runtime/'share/proj'))
    if (runtime/'share/gdal').is_dir():
        environment.setdefault('GDAL_DATA', str(runtime/'share/gdal'))
    process = None
    lines: queue.Queue[str | None] = queue.Queue()
    try:
        process = subprocess.Popen(command, cwd=APPLICATION, env=environment, stdout=subprocess.PIPE,
                                   stderr=subprocess.STDOUT, text=True, encoding='utf-8', errors='replace', bufsize=1)
        def collect() -> None:
            assert process is not None and process.stdout is not None
            for line in process.stdout:
                lines.put(line)
            lines.put(None)
        threading.Thread(target=collect, daemon=True).start()
        deadline = time.monotonic()+60
        receipt = None
        errors: list[str] = []
        while time.monotonic() < deadline:
            try:
                line = lines.get(timeout=.5)
            except queue.Empty:
                if process.poll() is not None:
                    break
                continue
            if line is None:
                break
            try:
                data = json.loads(line)
            except ValueError:
                errors.append(line.rstrip())
                continue
            candidate = (data.get('operator_url') or data.get('url')) if isinstance(data, dict) else None
            if candidate:
                parts = urllib.parse.urlsplit(candidate)
                if parts.scheme != 'http' or parts.hostname not in ('127.0.0.1','localhost','::1'):
                    raise RuntimeError('The operator returned an unexpected non-local browser address.')
                receipt = {**data, 'url': candidate}
                break
        if receipt is None:
            diagnostic = '\n'.join(errors[-12:])
            raise RuntimeError('The selected Python environment could not start the workbench. '
                               'Use its compatible GIS interpreter via --python or ECOSYSTEMS_PYTHON.\n'+diagnostic)
        print('Upper Savannah workbench is running. Keep this terminal open; press Ctrl+C to stop.', flush=True)
        if args.no_browser or not webbrowser.open(receipt['url']):
            print('Open this local session address in your browser:\n'+receipt['url'], flush=True)
        while process.poll() is None:
            try:
                line = lines.get(timeout=.5)
                if line is None:
                    break
                # Session access is local; subsequent operational errors remain visible.
                if line.strip():
                    print(line.rstrip(), flush=True)
            except queue.Empty:
                pass
        return int(process.wait())
    except KeyboardInterrupt:
        print('\nClosing this local workbench session.', flush=True)
        return 0
    except (OSError, RuntimeError) as error:
        print(str(error), file=sys.stderr)
        return 1
    finally:
        if process is not None and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()

if __name__ == '__main__':
    raise SystemExit(main())
