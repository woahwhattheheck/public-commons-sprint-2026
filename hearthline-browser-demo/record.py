#!/usr/bin/env python3
"""Record one genuine browser journey against the unchanged local MCP runtime.

Requires Playwright and its Chromium/ffmpeg binaries. No mocked browser requests,
DOM state injection, real weather query, credential, or paid provider is used.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import time
from urllib.request import urlopen
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parent

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, default=Path('hearthline-recording'))
    parser.add_argument('--dwell', type=float, default=5.0, help='Readable seconds after each real action.')
    args = parser.parse_args()
    if not 0 <= args.dwell <= 10:
        parser.error('--dwell must be between 0 and 10 seconds')
    out = args.output.resolve()
    out.mkdir(parents=True, exist_ok=False)
    timeline: list[dict] = []
    errors: list[str] = []
    server_log = (out / 'server.log').open('w')
    server = subprocess.Popen(['node', str(ROOT / 'server.mjs')], env={**os.environ, 'PORT': '8790'}, stdout=server_log, stderr=subprocess.STDOUT)
    try:
        for _ in range(100):
            if server.poll() is not None:
                raise RuntimeError('Demo server exited; inspect server.log')
            try:
                with urlopen('http://127.0.0.1:8790/demo/status', timeout=1) as response:
                    if response.status == 200:
                        break
            except OSError:
                time.sleep(0.1)
        else:
            raise RuntimeError('Demo server did not become ready')
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            context = browser.new_context(viewport={'width': 1440, 'height': 1080}, record_video_dir=str(out / 'raw'), record_video_size={'width': 1440, 'height': 1080}, locale='en-US')
            page = context.new_page()
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto('http://127.0.0.1:8790/')
            expect(page.locator('#connection')).to_contain_text('7 tools')
            clock = time.monotonic()
            def chapter(label: str) -> None:
                timeline.append({'seconds': round(time.monotonic() - clock, 3), 'label': label})
                page.wait_for_timeout(args.dwell * 1000)
            def click(selector: str, expected: str) -> None:
                page.locator(selector).hover()
                page.wait_for_timeout(400)
                page.locator(selector).click()
                expect(page.locator(selector)).to_be_enabled()
                expect(page.locator('#verdict')).to_contain_text(expected)
            chapter('Live local MCP connection; fixture/weather and no-provider boundaries')
            click('#prepare', 'Plan prepared.')
            chapter('Create a durable household mission from inventory')
            click('#probe', 'Correctly blocked:')
            chapter('An unapproved action is rejected by the real MCP server')
            click('#approve', 'Approved, not executed.')
            chapter('Approve the exact current plan and action')
            click('#execute', 'One reminder stored')
            chapter('Execute once into the local demo outbox; no delivered message')
            click('#restart', 'New process, same durable mission.')
            chapter('Restart the actual server process and reconnect to the same store')
            click('#replay', 'PASS: same receipt after restart.')
            chapter('Replay returns the exact receipt without adding an outbox item')
            page.locator('#receipt-details').click()
            chapter('Inspect the actual receipt and explicit authority ceiling')
            page.locator('#receipt-details').click()
            page.locator('#action').select_option(label='Shopping handoff — no purchase')
            click('#approve', 'Approved, not executed.')
            chapter('A separate shopping action needs its own approval')
            click('#execute', 'Shopping handoff prepared — no purchase placed.')
            chapter('Prepare shopping handoff without placing an order')
            click('#restart', 'New process, same durable mission.')
            click('#replay', 'PASS: same receipt after restart.')
            chapter('Both local actions remain durable; no duplicate effects')
            with page.expect_download() as downloaded:
                page.locator('#export').click()
            downloaded.value.save_as(out / 'browser-evidence.json')
            packet = json.loads((out / 'browser-evidence.json').read_text())
            assert not errors, errors
            assert packet['runtime']['localOutboxItems'] == 1
            assert packet['runtime']['receipts'] == 2
            assert packet['runtime']['generation'] == 3
            replays = [event for event in packet['events'] if event['label'] == 'Exact receipt replayed; zero duplicate effects']
            assert len(replays) == 2 and all(event['sameReceipt'] for event in replays)
            assert packet['lastExecution']['receipt']['semantics'] == 'prepared_not_purchased'
            page.screenshot(path=str(out / 'final-browser.png'), full_page=True)
            video = page.video
            context.close()
            video.save_as(str(out / 'hearthline-browser-demo.webm'))
            browser.close()
        if shutil.which('ffmpeg'):
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(out / 'hearthline-browser-demo.webm'), '-c:v', 'libx264', '-crf', '24', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', str(out / 'hearthline-browser-demo.mp4')], check=True)
        duration = None
        if shutil.which('ffprobe'):
            duration = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', str(out / 'hearthline-browser-demo.webm')], text=True).strip())
            if duration >= 180:
                raise RuntimeError('Recording exceeds the competition video limit')
        shutil.rmtree(out / 'raw')
        manifest = {'schema': 'hearthline.browser-capture/v1', 'source_commit': os.environ.get('GITHUB_SHA', 'local-unversioned'), 'runner': os.environ.get('GITHUB_RUN_ID', 'local'), 'duration_seconds': duration, 'focused_journey': 'passed', 'video': 'genuine Chromium recording; pointer/controls driven by Playwright', 'weather': 'synthetic fixture', 'mcp': 'unchanged production server over real loopback HTTP', 'alexa_device': False, 'language_model': False, 'purchases': False, 'messages_delivered': False, 'official_submission': False, 'chapters': timeline, 'page_errors': errors, 'files': []}
        for path in sorted(out.iterdir()):
            if path.is_file():
                manifest['files'].append({'name': path.name, 'bytes': path.stat().st_size, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
        (out / 'CAPTURE_RECEIPT.json').write_text(json.dumps(manifest, indent=2) + '\n')
        print(json.dumps({'focused_browser_journey': 'PASS', 'duration_seconds': duration, 'outbox_items': 1, 'receipts': 2, 'server_generations': 3, 'output': str(out)}))
    finally:
        server.terminate()
        try:
            server.wait(timeout=8)
        except subprocess.TimeoutExpired:
            server.kill(); server.wait()
        server_log.close()

if __name__ == '__main__':
    main()
