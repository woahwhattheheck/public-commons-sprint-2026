# MIT. Two focused end-to-end groups; no repository-wide test runner.
import base64
import json
from pathlib import Path
import stat
import tempfile
import unittest
import zlib
from source_bundle import BundleError, END, START, canonical, decode, digest, pack, unpack


def wire(manifest):
    raw = canonical(manifest)
    sha = digest(raw)
    return f'{START} {sha} {len(raw)}\n' + base64.b64encode(zlib.compress(raw)).decode() + f'\n{END}', sha


class SourceBundleCheck(unittest.TestCase):
    def test_round_trip_bytes_modes_and_new_destination(self):
        with tempfile.TemporaryDirectory() as home:
            root = Path(home)
            files = {'demo.py': b'def demo():\n    literal = "two  spaces"\n\n\n    return literal\n',
                     'nested/encoding.txt': 'literal\u00a0NBSP\r\n\tTabbed\r\n\r\n'.encode(),
                     'empty.txt': b'', 'all-bytes.bin': bytes(range(256))}
            for name, data in files.items():
                p = root / name
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_bytes(data)
            (root / 'demo.py').chmod(0o755)
            text, meta = pack(root, list(files), 'exact-source-ref')
            again, _ = pack(root, list(reversed(files)), 'exact-source-ref')
            self.assertEqual(text, again)
            canvas = '# Prose\n```text\n' + text.replace(' ', '\u00a0').replace('\n', '\r\n\u00a0\u00a0') + '\n```\n'
            output = unpack(canvas, meta['sha256'], root)
            other = unpack(canvas, meta['sha256'], root)
            self.assertNotEqual(output, other)
            self.assertEqual(stat.S_IMODE(output.stat().st_mode), 0o700)
            self.assertEqual(stat.S_IMODE((output / 'demo.py').stat().st_mode), 0o755)
            for name, data in files.items():
                self.assertEqual((output / name).read_bytes(), data)
            manifest = json.loads((output / '.tjl-source-manifest.json').read_text())
            self.assertEqual(manifest['sha256'], meta['sha256'])

    def test_tampering_paths_and_incomplete_data_never_extract(self):
        with tempfile.TemporaryDirectory() as home:
            root = Path(home)
            (root / 'a').write_bytes(b'A')
            text, meta = pack(root, ['a'])
            with self.assertRaises(BundleError):
                unpack(text, '0' * 64, root)
            with self.assertRaises(BundleError):
                unpack(text.replace(END, ''), meta['sha256'], root)
            with self.assertRaises(BundleError):
                unpack(text + text, meta['sha256'], root)
            manifest, _ = decode(text, meta['sha256'])
            for bad in ['../escape', '/tmp/escape', 'C:/escape', 'x\\y', 'a//b', 'NUL', 'x/.git/config']:
                manifest['files'][0]['path'] = bad
                envelope, sha = wire(manifest)
                with self.assertRaises(BundleError, msg=bad):
                    unpack(envelope, sha, root)
            manifest['files'][0]['path'] = 'a'
            manifest['files'].append(dict(manifest['files'][0], path='A'))
            envelope, sha = wire(manifest)
            with self.assertRaises(BundleError):
                unpack(envelope, sha, root)
            (root / 'link').symlink_to(root / 'a')
            with self.assertRaises(BundleError):
                pack(root, ['link'])
            self.assertEqual(sorted(p.name for p in root.iterdir()), ['a', 'link'])


if __name__ == '__main__':
    unittest.main()
