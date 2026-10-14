"""Installer access to the original Windows operator's file primitives.

Windows source is executed from the exact bytes already verified by the selected
installation inventory. POSIX publication stays in each original installer.
Both installers hold the existing extension-install.lock for their whole change,
including backups and any rollback.
"""
from __future__ import annotations
import contextlib
import os
from pathlib import Path
import stat
import sys
import tempfile
import types


class InstallerFiles:
    def __init__(self, verified, source_root):
        self.windows = None
        if os.name == "nt":
            relative = "model/windows_fs.py"
            if relative not in verified:
                raise ValueError("Retain the complete original Windows file source: " + relative)
            module = types.ModuleType("_upstate_measurements_windows_fs")
            module.__file__ = str(Path(source_root) / relative)
            exec(compile(verified[relative], module.__file__, "exec"), module.__dict__)
            for name in ("no_follow_open", "flock", "replace", "sync_directory"):
                if not callable(getattr(module, name, None)):
                    raise ValueError("Original Windows file source is incomplete: " + name)
            self.windows = module

    @contextlib.contextmanager
    def held(self, path):
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        if self.windows is None:
            import fcntl
            with path.open("a+") as handle:
                fcntl.flock(handle, fcntl.LOCK_EX)
                yield
            return
        descriptor = self.windows.no_follow_open(path, os.O_CREAT | os.O_RDWR, 0o600)
        try:
            self.windows.flock(descriptor, self.windows.LOCK_EX)
            yield
        finally:
            os.close(descriptor)

    def replace_windows(self, path, data):
        """Flush an owned new file and publish through original write-through rename."""
        if self.windows is None:
            raise RuntimeError("Use the original POSIX installer publication function")
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        pending = None
        try:
            with tempfile.NamedTemporaryFile(
                    dir=path.parent, prefix=".measurement-install-", delete=False) as stream:
                pending = Path(stream.name)
                mode = stat.S_IMODE(path.stat().st_mode) if path.exists() else 0o644
                # Windows exposes the read-only attribute through chmod; fchmod
                # is POSIX-only. The owned open handle retains write permission.
                os.chmod(pending, mode)
                stream.write(data)
                stream.flush()
                os.fsync(stream.fileno())
            self.windows.replace(pending, path)
            pending = None
            self.windows.sync_directory(path.parent)
        finally:
            if pending is not None:
                failure = sys.exc_info()[1]
                try:
                    os.chmod(pending, stat.S_IMODE(pending.stat().st_mode) | stat.S_IWUSR)
                    pending.unlink(missing_ok=True)
                except FileNotFoundError:
                    pass
                except OSError as cleanup_error:
                    if failure is None:
                        raise
                    if hasattr(failure, "add_note"):
                        failure.add_note("Could not remove the owned installer stage: " + str(cleanup_error))
