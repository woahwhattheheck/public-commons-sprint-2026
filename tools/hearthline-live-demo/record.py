#!/usr/bin/env python3
"""Record actual local MCP interactions; do not synthesize server results."""
from __future__ import annotations
import argparse
import asyncio
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import time
from playwright.async_api import async_playwright

async def record(destination: Path, port: int, browser_path: str | None) -> None:
    destination.mkdir(parents=True, exist_ok=False)
    frames = destination / 'frames'
    frames.mkdir()
    source = Path(__file__).resolve().parent
    log = (destination / 'server.log').open('w', encoding='utf-8')
    env = {**os.environ, 'DEMO_PORT': str(port)}
    backend = await asyncio.create_subprocess_exec('node', str(source / 'server.mjs'),
        env=env, stdout=asyncio.subprocess.PIPE, stderr=log)
    capturing = False
    capture_task = None
    observations = []
    try:
        ready = await asyncio.wait_for(backend.stdout.readline(), 12)
        if not ready.startswith(b'HEARTHLINE_DEMO_READY '):
            raise RuntimeError('The real MCP demo host failed to start')
        url = ready.decode().strip().split(' ', 1)[1]
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(executable_path=browser_path,
                headless=True, args=['--no-sandbox', '--disable-dev-shm-usage'])
            context = await browser.new_context(viewport={'width': 1440, 'height': 900},
                device_scale_factor=1, color_scheme='light', reduced_motion='reduce')
            page = await context.new_page()
            await page.goto(url)
            capturing = True
            start = time.monotonic()
            async def capture() -> None:
                while capturing:
                    target = frames / f'{len(observations):05d}.png'
                    await page.screenshot(path=str(target))
                    observations.append((target, time.monotonic() - start))
                    await asyncio.sleep(0.20)
            capture_task = asyncio.create_task(capture())
            await asyncio.sleep(3)
            for step in ['connect', 'prepare', 'blocked', 'approve', 'execute', 'restart', 'shopping']:
                await page.locator('#' + step).click()
                await page.wait_for_function("s => document.getElementById('stage').textContent === 'Completed: ' + s || document.getElementById('stage').textContent === 'Failed: ' + s", arg=step, timeout=15000)
                if await page.locator('#stage').inner_text() != 'Completed: ' + step:
                    raise RuntimeError(await page.locator('#status').inner_text())
                print(f'Completed real MCP step: {step}', flush=True)
                await asyncio.sleep(5)
            await asyncio.sleep(3)
            evidence = await page.evaluate('window.demoEvidence')
            required = {'unapprovedExecutionRejected', 'realProcessRestart', 'sameReceiptAfterRestart', 'noDuplicateOutbox', 'shoppingNotPurchased'}
            if not all(evidence['assertions'].get(key) is True for key in required):
                raise RuntimeError('The recording did not establish every advertised outcome')
            (destination / 'evidence.json').write_text(json.dumps(evidence, indent=2) + '\n', encoding='utf-8')
            await page.screenshot(path=str(destination / 'final-frame.png'))
            capturing = False
            await capture_task
            await browser.close()
        # Preserve observed real-time intervals between actual browser captures.
        concat = destination / 'frames.txt'
        with concat.open('w', encoding='utf-8') as stream:
            for index, (path, timestamp) in enumerate(observations):
                duration = (observations[index + 1][1] - timestamp) if index + 1 < len(observations) else 0.25
                stream.write(f"file 'frames/{path.name}'\nduration {max(duration, 0.01):.6f}\n")
            stream.write(f"file 'frames/{observations[-1][0].name}'\n")
        video = destination / 'hearthline-live-demo.mp4'
        subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0',
            '-i', str(concat), '-vf', 'fps=24', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
            '-pix_fmt', 'yuv420p', '-movflags', '+faststart', str(video)], check=True, timeout=90)
        probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries',
            'format=duration,size:stream=codec_name,width,height', '-of', 'json', str(video)]))
        if float(probe['format']['duration']) >= 180:
            raise RuntimeError('Recorded video exceeds three minutes')
        receipt = {'source_commit': env.get('SOURCE_COMMIT'), 'video_sha256': hashlib.sha256(video.read_bytes()).hexdigest(),
            'evidence_sha256': hashlib.sha256((destination / 'evidence.json').read_bytes()).hexdigest(),
            'actual_browser_frames': len(observations), 'media': probe, 'assertions': evidence['assertions'],
            'synthetic_inputs': ['weather alert', 'household inventory', 'household location'],
            'external_provider_calls': False, 'audio': 'none; visible captions', 'official_submission': False}
        (destination / 'RECORDING_RECEIPT.json').write_text(json.dumps(receipt, indent=2) + '\n', encoding='utf-8')
        shutil.rmtree(frames)
        concat.unlink()
        print(json.dumps(receipt, indent=2), flush=True)
    finally:
        capturing = False
        if capture_task and not capture_task.done():
            await capture_task
        if backend.returncode is None:
            backend.terminate()
            try:
                await asyncio.wait_for(backend.wait(), 8)
            except asyncio.TimeoutError:
                backend.kill()
                await backend.wait()
        log.close()

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--port', type=int, default=8790)
    parser.add_argument('--browser', default=os.environ.get('CHROME_PATH') or shutil.which('chromium') or shutil.which('google-chrome'))
    args = parser.parse_args()
    asyncio.run(record(args.output.resolve(), args.port, args.browser))
