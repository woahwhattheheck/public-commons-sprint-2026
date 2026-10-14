"""Focused platform-layout/ABI/loader checks; no simulated model calculations."""
from __future__ import annotations

import io
import errno
import json
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from source_tools.native_runtime import capsule, platform_runtime as native


def windows_pack(path, wrapper="", extra=()):
    with tarfile.open(path, "w:gz") as archive:
        for name in ("python.exe", "Scripts/conda-unpack-script.py", "Library/share/proj/proj.db", *extra):
            name = wrapper + "/" + name if wrapper else name
            body = b"archive layout fixture, never executed\n"
            entry = tarfile.TarInfo(name)
            entry.size = len(body)
            archive.addfile(entry, io.BytesIO(body))


class PlatformLayouts(unittest.TestCase):
    def test_capsule_publish_without_hardlinks(self):
        from source_tools.native_runtime import probe
        with tempfile.TemporaryDirectory(prefix="native capsule no links ") as tmp:
            root = Path(tmp)
            pack = root / "windows.tgz"
            windows_pack(pack)
            selection = {"version": "layout-course", "source": {}}
            target = {**probe.identity(), "system": "Windows", "machine": "AMD64"}
            sealed = capsule.seal(pack, root / "capsule.zip", selection, target, kind="conda-pack")
            with patch("model.portable_fs.os.link", side_effect=OSError(errno.EOPNOTSUPP, "No hardlinks")):
                # Both original capsule publication and received payload use the
                # actual shared verified-copy/create-only path, not a stub.
                copied = capsule.seal(pack, root / "copy.zip", selection, target, kind="conda-pack")
                capsule.extract_payload(root / "copy.zip", root / "received", copied["manifest"])
            payload = root / "received/payload/runtime.tar.gz"
            self.assertEqual(payload.read_bytes(), pack.read_bytes())
            self.assertEqual(capsule.inspect_capsule(root / "copy.zip")["state"], "verified")
            with self.assertRaises(FileExistsError):
                capsule.seal(pack, root / "copy.zip", selection, target, kind="conda-pack")

    def test_windows_layout_receive_and_wrong_target_rejection(self):
        with tempfile.TemporaryDirectory(prefix="native Windows layout ") as tmp:
            root = Path(tmp)
            for wrapper in ("", "runtime"):
                pack = root / ((wrapper or "flat") + ".tgz")
                windows_pack(pack, wrapper)
                info = capsule.extract_conda(pack, root / ((wrapper or "flat") + " Ω"))
                self.assertEqual(info["layout"]["python"], "python.exe")
                self.assertEqual(info["layout"]["relocation"], "Scripts/conda-unpack-script.py")
                self.assertEqual(info.get("archive_prefix", ""), wrapper)
            with self.assertRaises(ValueError):
                native.require_layout(["python.exe", "Scripts/conda-unpack-script.py"], "Darwin")
            for extra in ("PYTHON.EXE", "Library/AUX.txt", "Library/bad:stream", "Library/end. "):
                bad = root / "bad.tgz"
                windows_pack(bad, extra=(extra,))
                with self.assertRaises(ValueError):
                    capsule.scan_conda(bad)

    def test_native_prefix_paths_gis_and_dll_handle_lifetime(self):
        with tempfile.TemporaryDirectory(prefix="native prefix Ω ") as tmp:
            p = Path(tmp)
            for directory in ("Library/bin", "Library/share/gdal", "Library/share/proj", "Scripts", "DLLs"):
                (p / directory).mkdir(parents=True, exist_ok=True)
            (p / "Library/share/proj/proj.db").write_bytes(b"layout only")
            env = native.prefix_environment(p, True, system="Windows", base={
                "Path": "C:\\Windows\\System32", "pythonpath": "unrelated", "PROJ_LIB": "unrelated",
                "SSL_CERT_FILE": "explicit-user-trust.pem"})
            self.assertEqual(env["PROJ_DATA"], str(p / "Library/share/proj"))
            self.assertEqual(env["GDAL_DATA"], str(p / "Library/share/gdal"))
            self.assertNotIn("pythonpath", env)
            self.assertEqual(env["SSL_CERT_FILE"], "explicit-user-trust.pem")
            self.assertTrue(env["PATH"].endswith("C:\\Windows\\System32"))
            self.assertEqual(native.interpreter(p, system="Windows"), p / "python.exe")
            self.assertEqual(native.interpreter(p, kind="wheelhouse", system="Windows"), p / "Scripts/python.exe")
            mac = native.prefix_environment(p, system="Darwin", base={
                "PATH": "/usr/bin", "DYLD_LIBRARY_PATH": "/unrelated",
                "DYLD_INSERT_LIBRARIES": "/unrelated/libinject.dylib",
                "SSL_CERT_FILE": "explicit-user-trust.pem"})
            self.assertFalse(any(key.startswith("DYLD_") for key in mac))
            self.assertEqual(mac["SSL_CERT_FILE"], "explicit-user-trust.pem")
            # The real Win32 add_dll_directory executes in the Windows receiver.
            # Here verify its application lifetime and target containment contract.
            with patch.object(native, "os") as os_mock, patch.object(native, "_DLL_HANDLES", {}):
                os_mock.name = "nt"
                os_mock.path.normcase.side_effect = lambda v: v.lower()
                os_mock.add_dll_directory.side_effect = lambda v: object()
                retained = native.activate_libraries(p)
                self.assertEqual(len(retained), 3)
                self.assertEqual(native.activate_libraries(p), retained)
                self.assertEqual(os_mock.add_dll_directory.call_count, 3)

    def test_windows_extension_abi_and_architecture_aliases(self):
        target = {"system": "Windows", "machine": "AMD64", "implementation": "CPython",
                  "python": "3.12.7", "cache_tag": "cpython-312", "soabi": None,
                  "extension_suffix": ".cp312-win_amd64.pyd", "libc": ["", ""]}
        host = {**target, "machine": "x86_64"}
        manifest = {"kind": "wheelhouse", "target": target}
        self.assertTrue(capsule.compatible(manifest, host)["compatible"])
        self.assertFalse(capsule.compatible(manifest, {**host, "extension_suffix": "_d.cp312-win_amd64.pyd"})["compatible"])
        self.assertFalse(capsule.compatible(manifest, {**host, "machine": "arm64"})["compatible"])
        actual = capsule.python_identity(sys.executable)
        self.assertTrue(actual["soabi"])
        self.assertTrue(actual["extension_suffix"])


if __name__ == "__main__":
    unittest.main()
