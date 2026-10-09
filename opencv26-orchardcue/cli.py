#!/usr/bin/env python3
"""Local offline CLI: python cli.py IMAGE [--output DIR]."""
import argparse
import html
import json
from pathlib import Path
from engine import save_review


def render_page(report: dict) -> str:
    decision = report['decision']
    action = html.escape(decision['action'])
    reasons = ', '.join(html.escape(r) for r in decision['reason_codes']) or 'No immediate capture issue'
    count = report['candidate_count']
    return f'''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>OrchardCue operator review</title>
<style>body{{font:16px system-ui;background:#10231b;color:#f3f5f1;margin:0;max-width:1000px;padding:24px;margin:auto}}
section{{background:#1c362b;padding:20px;border-radius:16px;margin:20px 0}}
img{{width:100%;height:auto;border-radius:12px}} a{{color:#b5f5c1}}
header{{font-size:30px;font-weight:750}} p{{line-height:1.5}} b{{font-size:23px}}</style>
<header>OrchardCue <small style="font-size:16px">/ operator review</small></header>
<section><b>{action}</b><p>{count} red fruit-like candidates; {report['ambiguous_regions']} ambiguous red regions.</p>
<p>Reason codes: {reasons}</p><p>These are image observations only. Operator confirmation is required before taking action.</p></section>
<section><img src="overlay.png" alt="Annotated image with red candidates outlined and review status"></section>
<section><h2>Evidence</h2><p>SHA256 input: <code>{html.escape(report['input_sha256'])}</code></p>
<p><a href="report.json">Machine-readable evidence JSON</a> · <a href="overlay.png">Download overlay</a></p>
<p>Generated on synthetic demonstration inputs unless separately field-verified. No crop-yield claim.</p></section></html>'''


def main():
    ap = argparse.ArgumentParser(description='Offline fruit imaging operator review')
    ap.add_argument('image', type=Path)
    ap.add_argument('--output', type=Path, default=Path('review-output'))
    ap.add_argument('--marker-mm', type=float, default=50.0)
    args = ap.parse_args()
    report = save_review(args.image.read_bytes(), args.output, marker_side_mm=args.marker_mm)
    (args.output / 'index.html').write_text(render_page(report), encoding='utf-8')
    print(json.dumps({'action':report['decision']['action'],'red_candidates':report['candidate_count'],
                      'review':str(args.output / 'index.html'), 'reasons':report['decision']['reason_codes']}))


if __name__ == '__main__':
    main()
