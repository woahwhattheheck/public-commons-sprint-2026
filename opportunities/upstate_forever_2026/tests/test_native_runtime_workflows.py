"""Four complete offline transport/runtime-management workflows; no model-result fixtures."""
from __future__ import annotations

import base64
import csv
import hashlib
import io
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tarfile
import tempfile
import textwrap
import time
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from source_tools.native_runtime import capsule, probe, transport


# Literal selection fixture copied from the maintained model/common.py. This is
# solely a source-pin parsing fixture, not a substitute scientific application.
COMMON = '''INVEST_VERSION = "3.20.0"
INVEST_SOURCE = {
    "repository": "https://github.com/natcap/invest", "ref": "3.20.0",
    "ndr_blob": "f518b2867d4a327675fcb1c9b4ba56f29b12188d",
    "sdr_blob": "0cac27add172011df367ff8026427dbbdbcda5b2",
}
'''


def child_env():
    env = os.environ.copy()
    env["PYTHONPATH"] = str(ROOT)
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    return env


def fixture_application(root):
    app = root / "application-pin-fixture"
    (app / "model").mkdir(parents=True)
    (app / "model" / "common.py").write_text(COMMON)
    return app


def fixture_wheel(root):
    """Build a real pure-Python wheel without network/build dependencies."""
    wheel = root / "runtime_transport_fixture-1.0.0-py3-none-any.whl"
    info = "runtime_transport_fixture-1.0.0.dist-info/"
    members = {
        "runtime_transport_fixture/__init__.py": b"def calculate(value):\n    return value * 3\n",
        info + "METADATA": b"Metadata-Version: 2.1\nName: runtime-transport-fixture\nVersion: 1.0.0\nRequires-Python: >=3.10\n\nTransport fixture; not an InVEST implementation.\n",
        info + "WHEEL": b"Wheel-Version: 1.0\nGenerator: native-runtime-workflow\nRoot-Is-Purelib: true\nTag: py3-none-any\n",
    }
    rows = io.StringIO()
    writer = csv.writer(rows, lineterminator="\n")
    for name, body in members.items():
        digest = base64.urlsafe_b64encode(hashlib.sha256(body).digest()).decode().rstrip("=")
        writer.writerow([name, "sha256=" + digest, len(body)])
    writer.writerow([info + "RECORD", "", ""])
    members[info + "RECORD"] = rows.getvalue().encode()
    with zipfile.ZipFile(wheel, "x", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, body in members.items():
            archive.writestr(name, body)
    return wheel


class RuntimeWorkflows(unittest.TestCase):
    def test_streaming_transfer_actual_process_death_and_resume(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            original = root / "full original.zip"
            block = bytes(range(256)) * 4096
            with original.open("wb") as stream:
                for _ in range(24):
                    stream.write(block)
                stream.write(b"retained-complete-tail" * 37)
            parts = root / "parts"
            manifest = transport.split(original, parts)
            self.assertEqual(len(manifest["parts"]), 4)
            self.assertEqual(transport.split(original, parts), manifest)
            output = root / "receiving" / original.name
            cut = 8 * transport.BLOCK + 317
            # Kill the real receiving process during its actual second-part write.
            program = textwrap.dedent('''
                import os,sys
                from pathlib import Path
                from source_tools.native_runtime import transport
                target=Path(sys.argv[2]);cut=int(sys.argv[3]);original=Path.open
                partial='.'+target.name+'.partial'
                class InterruptedFile:
                    def __init__(self,stream): self.stream=stream
                    def __getattr__(self,name): return getattr(self.stream,name)
                    def __enter__(self): return self
                    def __exit__(self,*args): self.stream.close()
                    def write(self,data):
                        left=cut-self.stream.tell()
                        if 0 <= left < len(data):
                            self.stream.write(data[:left]);self.stream.flush();os.fsync(self.stream.fileno())
                            os._exit(17)
                        return self.stream.write(data)
                def opened(path,*args,**kwargs):
                    stream=original(path,*args,**kwargs)
                    return InterruptedFile(stream) if path.name==partial and args and args[0]=='a+b' else stream
                Path.open=opened
                transport.join(sys.argv[1],target)
            ''')
            result = subprocess.run([sys.executable, "-B", "-c", program,
                                     str(parts / "transfer.json"), str(output), str(cut)], env=child_env())
            self.assertEqual(result.returncode, 17)
            self.assertEqual(output.with_name("." + output.name + ".partial").stat().st_size, cut)
            received = transport.join(parts / "transfer.json", output)
            self.assertEqual(received["sha256"], transport.file_hash(original))
            self.assertEqual(output.stat().st_size, original.stat().st_size)
            self.assertTrue(transport.join(parts / "transfer.json", output)["reused"])
            source = parts / manifest["parts"][1]["path"]
            with source.open("r+b") as stream:
                stream.write(b"changed")
            with self.assertRaisesRegex(ValueError, "Changed transfer member"):
                transport.join(parts / "transfer.json", root / "different.zip")
            self.assertFalse((root / "different.zip").exists())

    def test_actual_offline_wheel_install_and_original_failure_recovery(self):
        with tempfile.TemporaryDirectory(prefix="runtime workflow ") as temporary:
            root = Path(temporary)
            app = fixture_application(root)
            original_common = (app / "model" / "common.py").read_bytes()
            wheels = root / "wheels"; wheels.mkdir()
            fixture_wheel(wheels)
            selected = probe.selected_source(app)
            target = capsule.python_identity(sys.executable)
            with self.assertRaisesRegex(ValueError, "Incomplete native wheelhouse"):
                capsule.seal(wheels, root / "not-native.zip", selected, target, kind="wheelhouse")
            # Internal-only transport fixture mode is deliberately absent from the CLI.
            package = root / "transport-fixture.zip"
            capsule.seal(wheels, package, selected, target, kind="wheelhouse", require_native=False)
            self.assertEqual(capsule.inspect_capsule(package)["state"], "verified")
            prefix = root / "new isolated runtime"
            with self.assertRaisesRegex(RuntimeError, "Receiving native probe failed"):
                capsule.install(package, prefix, app)
            state_file = root / ("." + prefix.name + ".native-runtime") / "receiving.json"
            state = transport.read_json(state_file)
            self.assertEqual(state["state"], "failed")
            self.assertEqual(state["stages"]["dependency_check"]["state"], "complete")
            self.assertEqual(state["probe"]["state"], "unavailable")
            self.assertIsNone(state["probe"]["packages"]["natcap.invest"])
            actual = subprocess.check_output([str(prefix / "bin" / "python"), "-I", "-c",
                       "from runtime_transport_fixture import calculate; print(calculate(24))"], text=True)
            self.assertEqual(actual.strip(), "72")
            self.assertEqual(capsule.python_identity(prefix / "bin" / "python")["prefix"], str(prefix))
            with self.assertRaisesRegex(RuntimeError, "Receiving native probe failed"):
                capsule.install(package, prefix, app, resume=True)
            self.assertTrue((state_file.parent / "probe" / "previous-runtime-probe.json").exists())
            with self.assertRaisesRegex(ValueError, "select --resume"):
                capsule.install(package, prefix, app)
            occupied = root / "existing environment"; occupied.mkdir()
            (occupied / "original.txt").write_text("preserved")
            with self.assertRaisesRegex(ValueError, "existing environments are preserved"):
                capsule.install(package, occupied, app)
            self.assertEqual((occupied / "original.txt").read_text(), "preserved")
            self.assertEqual((app / "model" / "common.py").read_bytes(), original_common)

    def test_archive_complete_members_links_modes_and_escape_rejection(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            original = root / "archive-inspection-fixture.tar.gz"
            with tarfile.open(original, "w:gz") as archive:
                for name, body in (("bin/python", b"archive fixture; not executable Python"),
                                   ("bin/conda-unpack", b"archive fixture; not conda-pack"),
                                   ("lib/full-data", b"full original bytes\0\xff")):
                    info = tarfile.TarInfo(name); info.size = len(body); info.mode = 0o755
                    archive.addfile(info, io.BytesIO(body))
                link = tarfile.TarInfo("lib/retained-link"); link.type = tarfile.SYMTYPE
                link.linkname = "full-data"; archive.addfile(link)
            result = capsule.scan_conda(original)
            self.assertEqual(result["members"], 4)
            selected = probe.selected_source(fixture_application(root))
            sealed = root / "archive-fixture.zip"
            capsule.seal(original, sealed, selected, probe.identity(), kind="conda-pack")
            manifest = capsule.read_capsule(sealed)
            destination = root / "received"
            capsule.extract_payload(sealed, destination, manifest)
            self.assertEqual(transport.file_hash(destination / "payload/runtime.tar.gz"), transport.file_hash(original))
            extracted = root / "extracted"; extracted.mkdir()
            with tarfile.open(destination / "payload/runtime.tar.gz") as archive:
                archive.extractall(extracted, filter="data")
            self.assertEqual((extracted / "lib/retained-link").read_bytes(), b"full original bytes\0\xff")
            self.assertTrue(os.access(extracted / "bin/python", os.X_OK))
            unsafe = root / "escaping.tar.gz"
            with tarfile.open(unsafe, "w:gz") as archive:
                link = tarfile.TarInfo("escape"); link.type = tarfile.SYMTYPE
                link.linkname = "../outside"; archive.addfile(link)
            with self.assertRaisesRegex(ValueError, "escapes prefix"):
                capsule.scan_conda(unsafe)
            self.assertFalse((root / "outside").exists())

    def test_live_child_keeps_installer_lease_after_parent_is_killed(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            programme = textwrap.dedent('''
                import sys
                from pathlib import Path
                from source_tools.native_runtime import transport,capsule
                root=Path(sys.argv[1])
                with transport.lock(root/'operation.lock') as lease:
                    capsule.command([sys.executable,'-c',
                      "import time,pathlib;time.sleep(2);pathlib.Path(__import__('sys').argv[1]).write_text('finished')",
                      root/'finished'], root/'child.log',lease_fd=lease)
            ''')
            parent = subprocess.Popen([sys.executable, "-B", "-c", programme, str(root)],
                                      stderr=subprocess.PIPE, text=True, env=child_env())
            event = json.loads(parent.stderr.readline())
            self.assertGreater(event["pid"], 0)
            parent.kill(); parent.wait()
            with self.assertRaises(BlockingIOError):
                with transport.lock(root / "operation.lock"):
                    pass
            deadline = time.monotonic() + 10
            while not (root / "finished").exists() and time.monotonic() < deadline:
                time.sleep(.03)
            self.assertEqual((root / "finished").read_text(), "finished")
            while True:
                try:
                    with transport.lock(root / "operation.lock"):
                        break
                except BlockingIOError:
                    if time.monotonic() > deadline:
                        raise
                    time.sleep(.03)
            parent.stderr.close()


if __name__ == "__main__":
    unittest.main(verbosity=2)
