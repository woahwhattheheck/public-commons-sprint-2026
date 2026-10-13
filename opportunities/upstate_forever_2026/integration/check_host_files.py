"""Focused host-file receiving and cross-process lock regression checks."""
from __future__ import annotations
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from model.common import atomic_bytes, held, retain_file, verify_file
from model.host_files import open_regular, sync_directory
from model.verified_files import verified_files


def run():
    outcomes = {}
    with tempfile.TemporaryDirectory(prefix="host-files-", dir=ROOT) as temporary:
        root = Path(temporary)
        saved = root / "saved.json"
        atomic_bytes(saved, b'{"value":1}\n')
        atomic_bytes(saved, b'{"value":2}\n')
        assert saved.read_bytes() == b'{"value":2}\n'
        atomic_bytes(root / "immutable", b"retained", immutable=True)
        try:
            atomic_bytes(root / "immutable", b"changed", immutable=True)
        except ValueError:
            pass
        else:
            raise AssertionError("Immutable content was replaced")
        assert not list(root.glob(".write-*"))
        outcomes["atomic_and_immutable"] = "PASS"

        source = root / "original.csv"
        source.write_bytes(b"station,value\nA,2.5\n")
        item = retain_file(root / "project", source)
        again = retain_file(root / "project", source, item["sha256"])
        assert item == again
        original_hash = hashlib.sha256(source.read_bytes()).hexdigest()
        assert item["sha256"] == original_hash
        verify_file(root / "project", {"path": item["object"], "bytes": item["bytes"], "sha256": original_hash})
        assert not list((root / "project" / "objects").glob("*.partial"))
        outcomes["retained_input_reopen"] = "PASS"

        retained = root / "project" / item["object"]
        expected = {"path": item["object"], "bytes": item["bytes"], "sha256": original_hash}
        with verified_files():
            verify_file(root / "project", expected)
            prior = retained.stat()
            changed = retained.read_bytes().replace(b"2.5", b"9.5")
            retained.write_bytes(changed)
            os.utime(retained, ns=(prior.st_atime_ns, prior.st_mtime_ns))
            try:
                verify_file(root / "project", expected)
            except ValueError:
                pass
            else:
                raise AssertionError("A same-length changed body reused a verification")
        outcomes["changed_body_with_restored_mtime"] = "PASS"

        lock = root / "workspace.lock"
        environment = os.environ.copy()
        environment["PYTHONPATH"] = str(ROOT)
        environment["PYTHONDONTWRITEBYTECODE"] = "1"
        busy = "from model.common import held\nimport sys\ntry:\n with held(sys.argv[1],blocking=False): pass\nexcept BlockingIOError:\n print('busy')\nelse:\n raise RuntimeError('Concurrent lock admitted')\n"
        waiting = "from model.common import held\nimport sys\nprint('attempting',flush=True)\nwith held(sys.argv[1]):\n print('acquired',flush=True)\n"
        with held(lock):
            result = subprocess.run([sys.executable, "-B", "-c", busy, str(lock)], env=environment,
                                    capture_output=True, text=True, timeout=25)
            assert result.returncode == 0 and result.stdout.strip() == "busy", result.stderr
            child = subprocess.Popen([sys.executable, "-B", "-c", waiting, str(lock)], env=environment,
                                     stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            assert child.stdout.readline().strip() == "attempting"
            assert child.poll() is None
        stdout, stderr = child.communicate(timeout=25)
        assert child.returncode == 0 and stdout.strip() == "acquired", stderr
        assert lock.read_bytes() == b""
        try:
            with held(lock):
                raise RuntimeError("interrupted operation")
        except RuntimeError:
            pass
        with held(lock, blocking=False):
            pass
        outcomes["cross_process_contention_and_release"] = "PASS"

        link = root / "alias.csv"
        try:
            link.symlink_to(source)
        except OSError as error:
            outcomes["no_follow_symlink"] = {"state": "UNAVAILABLE", "errno": error.errno, "winerror": getattr(error, "winerror", None)}
        else:
            try:
                descriptor = open_regular(link, os.O_RDONLY)
            except OSError:
                outcomes["no_follow_symlink"] = "PASS"
            else:
                os.close(descriptor)
                raise AssertionError("A retained leaf followed a symlink")
        assert sync_directory(root) is (os.name != "nt")
        outcomes["directory_flush_capability"] = os.name != "nt"
    return outcomes


if __name__ == "__main__":
    print(json.dumps(run(), indent=2))
