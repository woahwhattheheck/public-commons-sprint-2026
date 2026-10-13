"""Focused receiving coverage for original wrapped conda payloads."""
import io
import os
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from source_tools.native_runtime import capsule


def write_pack(path, wrapper, extra=()):
    def name(value):
        return wrapper + "/" + value if wrapper else value
    with tarfile.open(path, "w:gz") as archive:
        if wrapper:
            root = tarfile.TarInfo(wrapper); root.type = tarfile.DIRTYPE
            archive.addfile(root)
        # Forward hard link exercises TarFile's name-based source lookup.
        link = tarfile.TarInfo(name("bin/copy")); link.type = tarfile.LNKTYPE
        link.mode = 0o755
        link.linkname = name("bin/python"); archive.addfile(link)
        for value in ("bin/python", "bin/conda-unpack"):
            member = tarfile.TarInfo(name(value)); member.mode = 0o755
            body = b"complete transport fixture, not a scientific runtime\n"
            member.size = len(body); archive.addfile(member, io.BytesIO(body))
        link = tarfile.TarInfo(name("bin/python-alias")); link.type = tarfile.SYMTYPE
        link.linkname = "python"; archive.addfile(link)
        for member in extra:
            archive.addfile(member)


class CondaLayout(unittest.TestCase):
    def test_flat_and_wrapped_payloads_receive_with_links_and_modes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for wrapper in ("", "runtime"):
                with self.subTest(wrapper=wrapper):
                    pack = root / ((wrapper or "flat") + ".tar.gz")
                    write_pack(pack, wrapper)
                    original = pack.read_bytes()
                    prefix = root / ((wrapper or "flat") + "-received")
                    info = capsule.extract_conda(pack, prefix)
                    self.assertEqual(info.get("archive_prefix", ""), wrapper)
                    self.assertTrue(os.access(prefix / "bin/python", os.X_OK))
                    self.assertEqual((prefix / "bin/python-alias").read_bytes(),
                                     (prefix / "bin/python").read_bytes())
                    self.assertEqual((prefix / "bin/copy").stat().st_ino,
                                     (prefix / "bin/python").stat().st_ino)
                    self.assertEqual(pack.read_bytes(), original)
                    self.assertFalse((prefix / "runtime").exists())

    def test_escapes_siblings_and_duplicate_wrappers_fail_before_writes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            bad = []
            symlink = tarfile.TarInfo("runtime/bin/escape")
            symlink.type = tarfile.SYMTYPE; symlink.linkname = "../../outside"
            bad.append(symlink)
            hardlink = tarfile.TarInfo("runtime/bin/escape")
            hardlink.type = tarfile.LNKTYPE; hardlink.linkname = "outside"
            bad.append(hardlink)
            sibling = tarfile.TarInfo("sibling"); sibling.type = tarfile.DIRTYPE
            bad.append(sibling)
            duplicate = tarfile.TarInfo("runtime"); duplicate.type = tarfile.DIRTYPE
            bad.append(duplicate)
            for number, member in enumerate(bad):
                with self.subTest(case=number):
                    pack = root / (str(number) + ".tar.gz")
                    write_pack(pack, "runtime", [member])
                    prefix = root / (str(number) + "-received")
                    with self.assertRaises(ValueError):
                        capsule.extract_conda(pack, prefix)
                    self.assertFalse(prefix.exists())
                    self.assertFalse((root / "outside").exists())


if __name__ == "__main__":
    unittest.main()
