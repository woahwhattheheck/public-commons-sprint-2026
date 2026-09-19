"""Offline-review integration tests on real canonical OpenCV perception."""
import base64
import copy
import hashlib
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import cv2
import numpy as np

from visualledger.agent import canonical, compile_trace
from visualledger.review import (CSS, MANIFEST_SCHEMA, ReviewError, _json,
                                 load_manifest, main, render_review, write_review)
from visualledger.synth import make_case


class Page(HTMLParser):
    def __init__(self, text):
        super().__init__()
        self.tags = []
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        self.tags.append((tag, dict(attrs)))


def remint(trace):
    trace = copy.deepcopy(trace)
    trace.pop('receipt_sha256', None)
    trace['receipt_sha256'] = hashlib.sha256(canonical(trace)).hexdigest()
    return trace


class ReviewTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cv2.setNumThreads(1)
        cls.raw = make_case('clear')
        cls.trace = compile_trace(cls.raw, evidence_id='invoice-01', allow_opencv4_dev=True)
        cls.entry = {'raw': cls.raw, 'trace': cls.trace, 'prior_fingerprints': []}

    def render(self, entries=None):
        return render_review(entries or [self.entry], allow_opencv4_dev=True)

    def fixture(self, root):
        root = Path(root)
        (root / 'source.png').write_bytes(self.raw)
        (root / 'trace.json').write_bytes(canonical(self.trace))
        manifest = {'schema': MANIFEST_SCHEMA, 'documents': [
            {'image': 'source.png', 'trace': 'trace.json', 'prior_fingerprints': []}]}
        (root / 'manifest.json').write_bytes(canonical(manifest))
        return root / 'manifest.json', manifest

    def test_clear_route_has_exact_receipts_and_human_limitations(self):
        text = self.render()
        for value in ['REQUEST_FIELD_EXTRACTION', self.trace['receipt_sha256'],
                      self.trace['perception']['source_sha256'],
                      self.trace['perception']['normalized_png_sha256'],
                      'Replay is not authentication', 'HUMAN REVIEW REQUIRED',
                      'not a signed receipt', 'DynamoDB HMAC seal']:
            self.assertIn(value, text)

    def test_all_canonical_synthetic_routes(self):
        entries = []
        for kind in ['clear', 'blur', 'glare', 'two_docs', 'sparse']:
            raw = make_case(kind)
            entries.append({'raw': raw, 'trace': compile_trace(raw, evidence_id=kind,
                            allow_opencv4_dev=True), 'prior_fingerprints': []})
        text = self.render(entries)
        for entry in entries:
            self.assertIn(entry['trace']['decision']['action'], text)
        self.assertEqual(len([x for x in Page(text).tags if x[0] == 'img']), 5)

    def test_duplicate_context_replays_but_does_not_establish_fraud(self):
        prior = [{'evidence_id': 'older-image',
                  'fingerprint': self.trace['perception']['fingerprint_dhash64']}]
        trace = compile_trace(self.raw, evidence_id='candidate', prior_fingerprints=prior,
                              allow_opencv4_dev=True)
        text = self.render([{'raw': self.raw, 'trace': trace, 'prior_fingerprints': prior}])
        self.assertIn('QUARANTINE_DUPLICATE_REVIEW', text)
        self.assertIn('not duplicate-payment or fraud proof', text)
        self.assertIn(hashlib.sha256(canonical(prior)).hexdigest(), text)
        with self.assertRaises(ReviewError):
            self.render([{'raw': self.raw, 'trace': trace, 'prior_fingerprints': []}])

    def test_html_is_deterministic(self):
        self.assertEqual(self.render(), self.render())

    def test_html_is_static_and_has_exact_style_csp(self):
        page = Page(self.render())
        self.assertFalse({'script', 'form', 'iframe', 'object', 'embed', 'link', 'a'} &
                         {tag for tag, _ in page.tags})
        for tag, attrs in page.tags:
            self.assertFalse(any(k.lower().startswith('on') for k in attrs))
            for key in ('src', 'href', 'action'):
                if key in attrs:
                    self.assertEqual(tag, 'img')
                    self.assertTrue(attrs[key].startswith('data:image/png;base64,'))
        csp = next(attrs['content'] for tag, attrs in page.tags
                   if tag == 'meta' and attrs.get('http-equiv') == 'Content-Security-Policy')
        self.assertIn("default-src 'none'", csp)
        self.assertNotIn('unsafe-inline', csp)
        self.assertIn(base64.b64encode(hashlib.sha256(CSS.encode()).digest()).decode(), csp)

    def test_embedded_pixels_are_real_bounded_png(self):
        page = Page(self.render())
        src = next(attrs['src'] for tag, attrs in page.tags if tag == 'img')
        png = base64.b64decode(src.split(',', 1)[1], validate=True)
        self.assertTrue(png.startswith(b'\x89PNG\r\n\x1a\n'))
        image = cv2.imdecode(np.frombuffer(png, np.uint8), cv2.IMREAD_COLOR)
        self.assertLessEqual(max(image.shape[:2]), 1024)
        self.assertIn(hashlib.sha256(png).hexdigest(), self.render())

    def test_evidence_label_is_escaped_in_text_and_attributes(self):
        label = '<script>alert(1)</script>" onerror="x'
        trace = compile_trace(self.raw, evidence_id=label, allow_opencv4_dev=True)
        text = self.render([{'raw': self.raw, 'trace': trace, 'prior_fingerprints': []}])
        page = Page(text)
        self.assertNotIn('<script>', text)
        self.assertIn('&lt;script&gt;', text)
        self.assertFalse(any('onerror' in attrs for _, attrs in page.tags))

    def test_trace_receipt_tamper_rejected(self):
        entry = copy.deepcopy(self.entry)
        entry['trace']['receipt_sha256'] = '0' * 64
        with self.assertRaises(ReviewError):
            self.render([entry])

    def test_semantic_remint_rejected(self):
        for field in ['action', 'human_review_required']:
            with self.subTest(field=field):
                entry = copy.deepcopy(self.entry)
                entry['trace']['decision'][field] = 'PAY_NOW' if field == 'action' else False
                entry['trace'] = remint(entry['trace'])
                with self.assertRaises(ReviewError):
                    self.render([entry])

    def test_authority_remint_rejected(self):
        entry = copy.deepcopy(self.entry)
        entry['trace']['authority']['pay_or_move_funds'] = True
        entry['trace'] = remint(entry['trace'])
        with self.assertRaises(ReviewError):
            self.render([entry])

    def test_source_substitution_rejected(self):
        with self.assertRaises(ReviewError):
            self.render([dict(self.entry, raw=make_case('glare'))])

    def test_missing_and_malformed_trace_rejected(self):
        for trace in [{}, {'schema': 'old-donor-format'}, [], None]:
            with self.subTest(trace=trace), self.assertRaises(ReviewError):
                self.render([dict(self.entry, trace=trace)])

    def test_unknown_fields_and_nonboolean_mode_rejected(self):
        with self.assertRaises(ReviewError):
            self.render([dict(self.entry, approved=True)])
        with self.assertRaises(ReviewError):
            render_review([self.entry], allow_opencv4_dev=1)

    def test_explicit_list_prior_required(self):
        for prior in [None, (), {}, False]:
            with self.subTest(prior=prior), self.assertRaises(ReviewError):
                self.render([dict(self.entry, prior_fingerprints=prior)])

    def test_missing_same_document_context_is_not_inferred_from_previous_card(self):
        # Rendering is not a mutable fingerprint store and cannot silently change decisions.
        second = dict(self.entry, trace=compile_trace(self.raw, evidence_id='second',
                                                     allow_opencv4_dev=True))
        text = self.render([self.entry, second])
        self.assertEqual(text.count('Request field extraction and human verification'), 2)

    def test_duplicate_ids_rejected(self):
        with self.assertRaises(ReviewError):
            self.render([self.entry, self.entry])

    def test_empty_and_oversize_batch_rejected(self):
        for docs in [[], [self.entry] * 17, ()]:
            with self.subTest(length=len(docs)), self.assertRaises(ReviewError):
                render_review(docs, allow_opencv4_dev=True)

    def test_source_byte_bounds_rejected(self):
        for raw in [b'', bytearray(self.raw), 'not bytes']:
            with self.subTest(kind=type(raw)), self.assertRaises(ReviewError):
                self.render([dict(self.entry, raw=raw)])
        with patch('visualledger.review.MAX_BATCH_BYTES', 1), self.assertRaises(ReviewError):
            self.render()

    def test_json_duplicates_nonfinite_and_invalid_encoding_rejected(self):
        for raw in [b'{"a":1,"a":2}', b'{"x":NaN}', b'{"x":Infinity}', b'\xff', b'']:
            with self.subTest(raw=raw), self.assertRaises(ReviewError):
                _json(raw)

    def test_default_refuses_cv4_and_dev_mode_is_labelled(self):
        if int(cv2.__version__.split('.')[0]) < 5:
            with self.assertRaises(ReviewError):
                render_review([self.entry])
            self.assertIn('DEVELOPMENT COMPATIBILITY ONLY', self.render())
        else:
            self.assertIn('runtime reports competition compatibility', render_review([self.entry]))

    def test_manifest_cli_complete_export(self):
        with tempfile.TemporaryDirectory() as d:
            manifest, _ = self.fixture(d)
            out = Path(d) / 'review.html'
            self.assertEqual(main(['--manifest', str(manifest), '--output', str(out),
                                   '--allow-opencv4-dev']), 0)
            self.assertEqual(out.read_text(), self.render())

    def test_manifest_path_traversal_and_urls_rejected(self):
        for path in ['../escape.png', '/tmp/a.png', 'https://example.com/image.png',
                     'a//b.png', 'a/./b.png', 'a\\b.png']:
            with self.subTest(path=path), tempfile.TemporaryDirectory() as d:
                manifest, data = self.fixture(d)
                data['documents'][0]['image'] = path
                manifest.write_bytes(canonical(data))
                with self.assertRaises(ReviewError):
                    load_manifest(manifest)

    def test_symlink_file_and_directory_rejected(self):
        for folder in [False, True]:
            with self.subTest(folder=folder), tempfile.TemporaryDirectory() as d:
                manifest, data = self.fixture(d)
                root = Path(d)
                if folder:
                    (root / 'alias').symlink_to(root, target_is_directory=True)
                    data['documents'][0]['image'] = 'alias/source.png'
                else:
                    (root / 'alias.png').symlink_to(root / 'source.png')
                    data['documents'][0]['image'] = 'alias.png'
                manifest.write_bytes(canonical(data))
                with self.assertRaises(OSError):
                    load_manifest(manifest)

    def test_manifest_symlink_and_fifo_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            manifest, data = self.fixture(d)
            alias = Path(d) / 'alias.json'
            alias.symlink_to(manifest)
            with self.assertRaises(OSError):
                load_manifest(alias)
            os.mkfifo(Path(d) / 'fifo.png')
            data['documents'][0]['image'] = 'fifo.png'
            manifest.write_bytes(canonical(data))
            with self.assertRaises(ReviewError):
                load_manifest(manifest)

    def test_invalid_last_entry_creates_no_output(self):
        with tempfile.TemporaryDirectory() as d:
            manifest, data = self.fixture(d)
            data['documents'].append(dict(data['documents'][0], trace='bad.json'))
            (Path(d) / 'bad.json').write_text('{}')
            manifest.write_bytes(canonical(data))
            out = Path(d) / 'review.html'
            self.assertEqual(main(['--manifest', str(manifest), '--output', str(out),
                                   '--allow-opencv4-dev']), 2)
            self.assertFalse(out.exists())

    def test_existing_output_and_output_symlink_preserved(self):
        with tempfile.TemporaryDirectory() as d:
            target = Path(d) / 'existing.html'
            target.write_text('foreign work')
            for out in [target, Path(d) / 'alias.html']:
                if out != target:
                    out.symlink_to(target)
                with self.assertRaises(FileExistsError):
                    write_review(out, 'replacement')
                self.assertEqual(target.read_text(), 'foreign work')
            self.assertFalse(list(Path(d).glob('.visualledger-review-*')))

    def test_optimized_cli_is_byte_identical(self):
        with tempfile.TemporaryDirectory() as d:
            manifest, _ = self.fixture(d)
            base = [sys.executable, '-m', 'visualledger.review', '--manifest', str(manifest),
                    '--allow-opencv4-dev']
            normal = subprocess.run(base + ['--output', str(Path(d) / 'normal.html')],
                                    capture_output=True, timeout=30)
            optimized = subprocess.run([base[0], '-O'] + base[1:] +
                                       ['--output', str(Path(d) / 'optimized.html')],
                                       capture_output=True, timeout=30)
            self.assertEqual(normal.returncode, 0, normal.stderr)
            self.assertEqual(optimized.returncode, 0, optimized.stderr)
            self.assertEqual(normal.stdout, optimized.stdout)
            self.assertEqual((Path(d) / 'normal.html').read_bytes(),
                             (Path(d) / 'optimized.html').read_bytes())


if __name__ == '__main__':
    unittest.main()
