#!/usr/bin/env python3
"""One focused, synthetic, CLI-output custody check; no vision/AWS/organizer I/O."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile

HERE = Path(__file__).resolve().parent
# Minimal deterministic write-only engine double: these cases verify CLI evidence
# custody, not orchard image processing, OpenCV accuracy or official contest rules.
STUB_ENGINE = '''import hashlib
import json

def save_review(raw, output, *, marker_side_mm):
    output.mkdir(exist_ok=True, parents=True)
    report = {"decision": {"action": "HUMAN_REVIEW_REQUIRED", "reason_codes": ["SYNTHETIC"], "human_confirmation_required": True},
              "candidate_count": 1, "ambiguous_regions": 0, "input_sha256": hashlib.sha256(raw).hexdigest()}
    (output / "report.json").write_text(json.dumps(report), encoding="utf-8")
    (output / "overlay.png").write_bytes(b"PNG-STUB:" + raw)
    return report
'''


def invoke(image, output, *opts):
    return subprocess.run([sys.executable, str(image.parent / 'cli.py'), str(image), '--output', str(output), *opts],
                          capture_output=True, text=True, timeout=10)


def check():
    with tempfile.TemporaryDirectory(prefix='orchardcue-cli-focus-') as td:
        root = Path(td)
        (root / 'cli.py').write_bytes((HERE / 'cli.py').read_bytes())
        (root / 'engine.py').write_text(STUB_ENGINE, encoding='utf-8')
        image_a, image_b = root / 'a.png', root / 'b.png'
        image_a.write_bytes(b'synthetic-image-one')
        image_b.write_bytes(b'synthetic-image-two')
        out = root / 'review'
        first = invoke(image_a, out)
        assert first.returncode == 0, first.stderr
        paths = ['report.json', 'overlay.png', 'index.html', 'cli-run.json']
        baseline = {p: (out / p).read_bytes() for p in paths}
        manifest = json.loads(baseline['cli-run.json'])
        assert manifest['input_sha256'] == hashlib.sha256(image_a.read_bytes()).hexdigest()
        assert all(manifest['artifact_sha256'][p] == hashlib.sha256(baseline[p]).hexdigest()
                   for p in ('report.json', 'overlay.png', 'index.html'))
        same = invoke(image_a, out)
        assert same.returncode == 0, same.stderr
        assert all((out / p).read_bytes() == baseline[p] for p in paths)
        different = invoke(image_b, out)
        assert different.returncode != 0 and 'another image' in different.stderr
        changed_config = invoke(image_a, out, '--marker-mm', '75')
        assert changed_config.returncode != 0 and 'marker size' in changed_config.stderr
        assert all((out / p).read_bytes() == baseline[p] for p in paths)
        (out / 'overlay.png').write_bytes(b'tampered')
        tampered = invoke(image_a, out)
        assert tampered.returncode != 0 and 'evidence mismatch' in tampered.stderr
        (out / 'overlay.png').write_bytes(baseline['overlay.png'])
        replaced = invoke(image_b, out, '--marker-mm', '75', '--replace')
        assert replaced.returncode == 0, replaced.stderr
        assert json.loads((out / 'cli-run.json').read_text())['input_sha256'] == hashlib.sha256(image_b.read_bytes()).hexdigest()
        (out / 'cli-run.json').unlink()
        incomplete = invoke(image_b, out)
        assert incomplete.returncode != 0 and 'incomplete review evidence' in incomplete.stderr
        huge = root / 'large.png'
        with huge.open('wb') as handle:
            handle.truncate(8_000_001)
        too_large = invoke(huge, root / 'huge-out')
        assert too_large.returncode != 0 and '8,000,000-byte' in too_large.stderr
        assert not (root / 'huge-out').exists()
        invalid = invoke(image_a, root / 'invalid', '--marker-mm', 'nan')
        assert invalid.returncode != 0 and 'must be finite' in invalid.stderr
    print('PASS: first/same image, different capture/config blocked, tamper, explicit replace, incomplete, oversized, NaN (8 cases)')


if __name__ == '__main__':
    check()
