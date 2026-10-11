#!/usr/bin/env python3
"""Local offline CLI: python cli.py IMAGE [--output DIR]."""
import argparse
import hashlib
import json
import math
from pathlib import Path
from engine import save_review
from review_page import render_page as render_review_page

EVIDENCE_FILES = ('report.json', 'overlay.png', 'index.html', 'review.js')
MANIFEST_NAME = 'cli-run.json'
MAX_INPUT_BYTES = 8_000_000  # Match engine.decode_image before allocating raw input bytes.


def _read_image_bounded(image: Path) -> bytes:
    """Bound allocation even when a file grows after the optional stat preflight."""
    with image.open('rb') as stream:
        raw = stream.read(MAX_INPUT_BYTES + 1)
    if len(raw) > MAX_INPUT_BYTES:
        raise ValueError('image exceeds 8,000,000-byte limit')
    return raw


def render_page(report: dict, report_sha256: str | None = None) -> str:
    """Keep the original callable while binding new pages to report-file bytes."""
    if report_sha256 is None:
        raw = (json.dumps(report, indent=2) + "\n").encode("utf-8")
        report_sha256 = hashlib.sha256(raw).hexdigest()
    return render_review_page(report, report_sha256)



def _digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _existing_review(output: Path, image_sha: str, marker_mm: float, *, replace: bool) -> dict | None:
    """Reuse only intact, identically configured evidence; never silently mix captures."""
    if output.exists() and not output.is_dir():
        raise ValueError(f'output is not a directory: {output}')
    if replace:
        return None
    artifacts = [output / name for name in (*EVIDENCE_FILES, MANIFEST_NAME)]
    existing = [p for p in artifacts if p.exists() or p.is_symlink()]
    if not existing:
        return None
    if len(existing) != len(artifacts):
        raise ValueError('output has incomplete or older review assets; choose a new --output or use --replace')
    try:
        manifest = json.loads((output / MANIFEST_NAME).read_text(encoding='utf-8'))
        if manifest['schema'] != 'orchardcue-cli-run/1':
            raise ValueError('unknown CLI evidence schema')
        if manifest['input_sha256'] != image_sha or manifest['marker_side_mm'] != marker_mm:
            raise ValueError('output belongs to another image or marker size')
        for name in EVIDENCE_FILES:
            if not (output / name).is_file() or manifest['artifact_sha256'][name] != _digest(output / name):
                raise ValueError(f'output evidence mismatch: {name}')
        report = json.loads((output / 'report.json').read_text(encoding='utf-8'))
        if report['input_sha256'] != image_sha:
            raise ValueError('report input does not match supplied image')
        return report
    except (KeyError, TypeError, json.JSONDecodeError, UnicodeError, OSError) as exc:
        raise ValueError('output has unreadable or untrusted review evidence') from exc

def main():
    ap = argparse.ArgumentParser(description='Offline fruit imaging operator review')
    ap.add_argument('image', type=Path)
    ap.add_argument('--output', type=Path, default=Path('review-output'))
    ap.add_argument('--marker-mm', type=float, default=50.0)
    ap.add_argument('--replace', action='store_true', help='explicitly replace existing review evidence')
    args = ap.parse_args()
    try:
        if not math.isfinite(args.marker_mm) or not 10 <= args.marker_mm <= 300:
            raise ValueError('--marker-mm must be finite and between 10 and 300')
        if args.image.stat().st_size > MAX_INPUT_BYTES:
            raise ValueError('image exceeds 8,000,000-byte limit')
        raw = _read_image_bounded(args.image)
        image_sha = hashlib.sha256(raw).hexdigest()
        report = _existing_review(args.output, image_sha, args.marker_mm, replace=args.replace)
        if report is None:
            report = save_review(raw, args.output, marker_side_mm=args.marker_mm)
            script = Path(__file__).with_name('review.js').read_bytes()
            (args.output / 'review.js').write_bytes(script)
            report_sha256 = _digest(args.output / 'report.json')
            (args.output / 'index.html').write_text(render_page(report, report_sha256), encoding='utf-8')
            manifest = {'schema': 'orchardcue-cli-run/1', 'input_sha256': image_sha,
                        'marker_side_mm': args.marker_mm,
                        'artifact_sha256': {name: _digest(args.output / name) for name in EVIDENCE_FILES}}
            (args.output / MANIFEST_NAME).write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    except (ValueError, OSError) as exc:
        ap.error(str(exc))
    print(json.dumps({'action':report['decision']['action'],'red_candidates':report['candidate_count'],
                      'review':str(args.output / 'index.html'), 'reasons':report['decision']['reason_codes']}))


if __name__ == '__main__':
    main()
