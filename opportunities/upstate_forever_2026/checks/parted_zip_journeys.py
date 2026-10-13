"""Three focused receiving journeys; authored archive fixtures, no model execution."""
from __future__ import annotations
import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import random
import shutil
import sqlite3
import struct
import sys
import tempfile
import unittest
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'source_tools'))
import parted_zip as pz


def bundle(root: Path, raw: bytes, part_size: int = 65536):
    donor = root / 'donor'; donor.mkdir()
    receiver = root / 'parts'; receiver.mkdir()
    parts = []
    for i, start in enumerate(range(0, len(raw), part_size), 1):
        block = raw[start:start + part_size]
        name = f'original.zip.part{i:03d}'
        (donor / name).write_bytes(block)
        parts.append({'part': i, 'filename': name, 'bytes': len(block), 'sha256': pz.digest(block),
                      'file_id': f'file_fixture_{i}', 'upload_url': 'https://example.invalid/secret?token=do-not-echo'})
    manifest = root / 'manifest.json'
    manifest.write_text(json.dumps({'schema': 'ecosystems.archive-parts/v1', 'archive': {
        'filename': 'original.zip', 'bytes': len(raw), 'sha256': pz.digest(raw)}, 'parts': parts}))
    return pz.Manifest(manifest), donor, receiver


def receive(manifest, donor, receiver, pieces):
    for item in pieces:
        part = item if isinstance(item, pz.Part) else manifest.parts[item['part'] - 1]
        pz.adopt_part(manifest, receiver, part.number, donor / part.filename)


def zip_bytes(files, *, descriptor=False, zip64=False):
    class Stream(io.BytesIO):
        def seek(self, *args):
            if descriptor: raise OSError('non-seekable fixture')
            return super().seek(*args)
    output = Stream()
    prior = zipfile.ZIP_FILECOUNT_LIMIT
    try:
        if zip64: zipfile.ZIP_FILECOUNT_LIMIT = 1
        with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED) as z:
            for name, raw in files:
                with z.open(name, 'w', force_zip64=zip64) as f: f.write(raw)
        return output.getvalue()
    finally:
        zipfile.ZIP_FILECOUNT_LIMIT = prior


class ReceivingJourneys(unittest.TestCase):
    def test_selective_complete_tree_resume_and_full_join(self):
        rng = random.Random(89)
        original = {'application/README.md': b'complete retained source\n',
                    'application/data.bin': rng.randbytes(120001),
                    'application/nested/module.py': b'ANSWER = 42\n'}
        raw = zip_bytes([('history/unneeded.bin', rng.randbytes(900000)), *original.items(),
                         ('reports/original.txt', b'Original retained report.\n' * 500)])
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); m, donor, parts = bundle(root, raw)
            receive(m, donor, parts, m.bootstrap())
            with pz.archive_session(m, parts) as (r, z, index):
                ids = pz.select(index, ['application'])
                plan = pz.make_plan(m, index, ids, parts, r)
                self.assertLess(plan['required_part_bytes'], len(raw) / 2)
                self.assertNotIn('upload_url', json.dumps(plan))
                with self.assertRaises(pz.NeedParts):
                    pz.extract(m, parts, root / 'out', index, ids, r, z)
                self.assertFalse((root / 'out').exists())
                receive(m, donor, parts, plan['missing_parts'])
            with pz.archive_session(m, parts) as (r, z, index):
                result = pz.extract(m, parts, root / 'out', index, ids, r, z)
                self.assertEqual(result['members_written_this_run'], len(original))
                for name, data in original.items(): self.assertEqual((root / 'out' / name).read_bytes(), data)
                self.assertFalse((root / 'out/history').exists())
                selection = pz.selection_document(index, ids)
                saved = root / 'selection.json'; saved.write_bytes(pz.canonical(selection))
                self.assertEqual(pz.load_selection(saved, index), ids)
            # A process died after final-file publication but before its journal commit.
            with contextlib.closing(sqlite3.connect(root / 'out/.parted-zip/members.sqlite3')) as db:
                db.execute('DELETE FROM members WHERE ordinal=?', (ids[-1],))
                db.commit()
            with pz.archive_session(m, parts) as (r, z, index):
                result = pz.extract(m, parts, root / 'out', index, ids, r, z)
                self.assertEqual(result['members_reused_this_run'], len(original))
            modified = root / 'out/application/README.md'; modified.write_bytes(b'User edit preserved')
            with pz.archive_session(m, parts) as (r, z, index):
                with self.assertRaises(pz.ArchiveError): pz.extract(m, parts, root / 'out', index, ids, r, z)
            self.assertEqual(modified.read_bytes(), b'User edit preserved')
            receive(m, donor, parts, m.parts)
            joined = root / 'complete.zip'; pz.join_archive(m, parts, joined)
            self.assertEqual(joined.read_bytes(), raw)
            self.assertEqual(pz.hash_file(joined), (m.archive_sha, m.size))

    def test_duplicate_entry_layout_paths_and_corruption(self):
        # Duplicate file names remain addressable by ordinal; tree extraction refuses overwrite.
        raw = zip_bytes([('same.txt', b'first'), ('same.txt', b'second'), ('safe/a.txt', b'a')])
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); m, donor, parts = bundle(root, raw)
            receive(m, donor, parts, m.parts)
            with pz.archive_session(m, parts) as (r, z, index):
                ids = pz.select(index, all_members=True)
                with self.assertRaises(pz.ArchiveError): pz.output_paths(index, ids, 'tree')
                pz.extract(m, parts, root / 'entries', index, ids, r, z, 'entries')
                self.assertEqual((root/'entries/entries/00000000/same.txt').read_bytes(), b'first')
                self.assertEqual((root/'entries/entries/00000001/same.txt').read_bytes(), b'second')
            with pz.PartsIO(m, parts) as r:
                r.read(1)
                part = parts / m.parts[0].filename
                with part.open('r+b') as f: f.seek(10); f.write(b'corrupt')
                with self.assertRaises(pz.ArchiveError): r.seek(0); r.read(1)
        for unsafe in ('../escape.txt', '/rooted.txt', 'a/../escape', 'C:drive.txt', 'a\\escape', 'NUL.txt', 'a/CON/x', 'a./x'):
            with self.assertRaises(pz.ArchiveError): pz.safe_name(unsafe)
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            # Original ZIP declares a wrong CRC even though part digests match the received bytes.
            broken = bytearray(zip_bytes([('source.txt', b'complete but deliberately bad CRC')]))
            central = broken.find(b'PK\x01\x02'); broken[central+16:central+20] = struct.pack('<I', 0)
            m, donor, parts = bundle(root, bytes(broken)); receive(m, donor, parts, m.parts)
            with pz.archive_session(m, parts) as (r, z, index):
                with self.assertRaises(zipfile.BadZipFile):
                    pz.extract(m, parts, root/'out', index, [0], r, z)
            self.assertFalse((root/'out/source.txt').exists())
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); m, donor, parts = bundle(root, raw)
            doc = json.loads(m.raw); doc['parts'][0]['bytes'] += 1
            m.path.write_text(json.dumps(doc))
            with self.assertRaises(pz.ArchiveError): pz.Manifest(m.path)

    def test_zip64_descriptor_cross_part_headers_and_empty_zip(self):
        files = [('source/naïve.txt', b'UTF-8 source\n' * 100), ('source/other.bin', random.Random(2).randbytes(25000))]
        for descriptor in (False, True):
            for zip64 in (False, True):
                with self.subTest(descriptor=descriptor, zip64=zip64), tempfile.TemporaryDirectory() as tmp:
                    root = Path(tmp); raw = zip_bytes(files, descriptor=descriptor, zip64=zip64)
                    if zip64: self.assertIn(b'PK\x06\x06', raw)
                    m, donor, parts = bundle(root, raw, part_size=4093)
                    receive(m, donor, parts, m.parts)
                    with pz.archive_session(m, parts) as (r, z, index):
                        ids = pz.select(index, prefixes=['source'])
                        plan = pz.make_plan(m, index, ids, parts, r)
                        self.assertEqual(plan['exact_local_header_ranges'], 2)
                        pz.extract(m, parts, root/'out', index, ids, r, z)
                    for name, data in files: self.assertEqual((root/'out'/name).read_bytes(), data)
        # A tiny final record does not imply that the EOCD search only reads
        # its own part. The saved plan must also work on a fresh sparse intake.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            buffer = io.BytesIO(zip_bytes([('source/chapter.txt', b'original chapter'),
                                         ('history.bin', random.Random(71).randbytes(240000))]))
            with zipfile.ZipFile(buffer, 'a') as writer:
                writer.comment = b'Original long archive comment.' * 1700
            m, donor, parts = bundle(root, buffer.getvalue(), part_size=8191)
            receive(m, donor, parts, m.parts)
            with pz.archive_session(m, parts) as (r, z, index):
                ids = pz.select(index, prefixes=['source'])
                plan = pz.make_plan(m, index, ids, parts, r)
            fresh = root/'fresh'; fresh.mkdir()
            receive(m, donor, fresh, plan['required_parts'])
            with pz.archive_session(m, fresh) as (r, z, index):
                pz.extract(m, fresh, root/'fresh-output', index, ids, r, z)
            self.assertEqual((root/'fresh-output/source/chapter.txt').read_bytes(), b'original chapter')
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); m, donor, parts = bundle(root, zip_bytes([]))
            receive(m, donor, parts, m.parts)
            with pz.archive_session(m, parts) as (_, _, index): self.assertEqual(index['members'], [])


if __name__ == '__main__':
    unittest.main(verbosity=2)
