"""Compose the Mac backend into an advancing original Windows/Linux worker.

Run from the source package: python source_tools/apply_macos_worker_port.py
/path/to/selected/application. Only the named exact source joins are changed.
The complete original scientific worker, Windows branches and job queue stay.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import stat
import tempfile


def _join(text, before, after, label):
    if text.count(after) == 1:
        return text
    if text.count(before) != 1:
        raise ValueError("Compose the current source for " + label + "; its exact join changed")
    return text.replace(before, after, 1)


def compose(application):
    application = Path(application).resolve(strict=True)
    source = Path(__file__).resolve().parents[1] / "model" / "macos_process.py"
    payload = source.read_bytes()
    destinations = {}
    for name in ("model/native_worker.py", "operator/native_jobs.py"):
        path = application / name
        if path.is_symlink() or not path.is_file():
            raise ValueError("Use an original ordinary source file: " + name)
        before = path.read_bytes()
        text = before.decode("utf-8")
        newline = "\r\n" if "\r\n" in text else "\n"
        text = text.replace("\r\n", "\n")
        if name == "model/native_worker.py":
            text = _join(text,
                '    """Identity survives reconnect and rejects a recycled PID or namespace."""\n',
                '    """Identity survives reconnect and rejects a recycled PID or namespace."""\n'
                '    if sys.platform == "darwin":\n'
                '        from .macos_process import process_identity as macos_identity\n'
                '        return macos_identity(pid)\n', name + ":process_identity")
            text = _join(text, 'def identity_matches(expected):\n',
                'def identity_matches(expected):\n'
                '    if sys.platform == "darwin":\n'
                '        from .macos_process import identity_matches as macos_matches\n'
                '        return macos_matches(expected)\n', name + ":identity_matches")
            text = text.replace('recoverable Linux process.', 'recoverable owned process.')
            text = text.replace('its own Linux process group', 'its own process group')
        else:
            anchor = '        source = {name: file_digest(APPLICATION / name) for name in source_paths}\n'
            text = _join(text, anchor,
                '        if sys.platform == "darwin":\n'
                '            source_paths += ("model/macos_process.py",)\n' + anchor,
                name + ":application_source")
            text = _join(text, '    def _resources(identity):\n',
                '    def _resources(identity):\n'
                '        if sys.platform == "darwin":\n'
                '            from model.macos_process import process_resources\n'
                '            return process_resources(identity)\n', name + ":resources")
            text = text.replace('the same owned Linux worker.', 'the same owned native worker.')
        destinations[name] = (before, text.replace("\n", newline).encode("utf-8"))
    module = application / "model/macos_process.py"
    if module.is_symlink():
        raise ValueError("Use an ordinary macOS backend source path")
    original_module = module.read_bytes() if module.exists() else None
    if original_module is not None and original_module != payload:
        raise ValueError("Preserve the advancing macOS backend and compose its changes first")
    destinations['model/macos_process.py'] = (original_module, payload)
    # Prepare every file before changing any selected source. Check the exact
    # observed preimages immediately before publication, never force a stale
    # whole-file replacement over another contributor's Windows implementation.
    staged = []
    try:
        for name, (before, after) in destinations.items():
            if before == after:
                continue
            path = application / name
            descriptor, pending = tempfile.mkstemp(prefix='.' + path.name + '.', dir=path.parent)
            staged.append((name, Path(pending)))
            with os.fdopen(descriptor, 'wb') as output:
                output.write(after)
                output.flush()
                os.fsync(output.fileno())
            if path.exists():
                os.chmod(pending, stat.S_IMODE(path.stat().st_mode))
        for name, (before, after) in destinations.items():
            path = application / name
            actual = path.read_bytes() if path.exists() else None
            if path.is_symlink() or actual != before:
                raise ValueError("Source advanced during composition: " + name)
        for name, pending in staged:
            os.replace(pending, application / name)
    finally:
        for _, pending in staged:
            pending.unlink(missing_ok=True)
    return {name: {"before_sha256": hashlib.sha256(before).hexdigest() if before is not None else None,
                   "after_sha256": hashlib.sha256(after).hexdigest(), "bytes": len(after)}
            for name, (before, after) in destinations.items()}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("application", type=Path)
    args = parser.parse_args(argv)
    print(json.dumps(compose(args.application), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
