"""Capture the actual local synthetic workflow; Playwright is optional tooling."""
from pathlib import Path
import json
import argparse
import hashlib
from importlib.metadata import version
import subprocess
import sys

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--out", type=Path, required=True)
parser.add_argument("--allow-opencv4-dev", action="store_true")
args = parser.parse_args()
OUT = args.out.resolve()
OUT.mkdir(parents=True, exist_ok=True)
if any(OUT.iterdir()):
    raise ValueError("Use an empty output directory; stale proof must not survive a failed run.")
DEV = ["--allow-opencv4-dev"] if args.allow_opencv4_dev else []
server = subprocess.Popen([sys.executable, "-m", "visualledger.workspace", "--port", "0"] + DEV, cwd=ROOT, stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE, text=True)
errors = []
try:
    line = server.stdout.readline().strip()
    if not line.startswith("VisualLedger local workspace: "):
        raise RuntimeError(line or server.stderr.read())
    url = line.split(": ", 1)[1]
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        browser_version = browser.version
        context = browser.new_context(viewport={"width":1440,"height":1100},
                                      record_video_dir=str(OUT / "recordings"),
                                      record_video_size={"width":1440,"height":1100},
                                      accept_downloads=True)
        context.route("**/*", lambda route: route.continue_() if route.request.url.startswith(url + "/") else route.abort())
        page = context.new_page()
        page.set_default_timeout(15000)
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(url)
        expect(page.locator("#demo")).to_be_enabled(timeout=15000)
        runtime = page.evaluate("""async () => { const c = await (await fetch('/api/config')).json();
          return {opencv_version: c.opencv_version, competition_opencv5_runtime: c.competition_opencv5_runtime}; }""")
        page.get_by_role("button", name="Load example").click()
        expect(page.locator("#source-action")).to_have_text("REQUEST_HUMAN_CROP", timeout=15000)
        page.screenshot(path=str(OUT / "workspace-before.png"), full_page=True)
        page.wait_for_timeout(1200)
        canvas = page.locator("#canvas")
        canvas.scroll_into_view_if_needed()
        box = canvas.bounding_box()
        if box is None:
            raise RuntimeError("Source crop canvas is not visible")
        # Select original-pixel rectangle [40,90,800,1140] on the resized preview.
        page.mouse.move(box["x"]+box["width"]*40/1600, box["y"]+box["height"]*90/1200)
        page.mouse.down()
        page.mouse.move(box["x"]+box["width"]*800/1600, box["y"]+box["height"]*1140/1200, steps=24)
        page.mouse.up()
        dragged = {key: int(page.locator("#" + key).input_value()) for key in ["left", "top", "right", "bottom"]}
        expected = {"left":40,"top":90,"right":800,"bottom":1140}
        if any(abs(dragged[key] - expected[key]) > 2 for key in expected):
            raise RuntimeError(f"Pointer selection did not map to original source pixels: {dragged}")
        # Exercise the accessible exact-pixel alternative too.
        for key, value in {"left":40,"top":90,"right":800,"bottom":1140}.items():
            page.locator("#"+key).fill(str(value))
        page.locator("#reason").fill("Select the complete left synthetic document with its border.")
        page.locator("#confirm").check()
        page.wait_for_timeout(1200)
        page.locator("#crop").click()
        expect(page.locator("#child-action")).to_have_text("REQUEST_FIELD_EXTRACTION", timeout=15000)
        page.locator("#result-title").scroll_into_view_if_needed()
        page.wait_for_timeout(1800)
        with page.expect_download() as transfer:
            page.locator("#export").click()
        transfer.value.save_as(str(OUT / "browser-export.zip"))
        page.locator("#receipts").evaluate("node => node.parentElement.open = true")
        page.screenshot(path=str(OUT / "workspace-after.png"), full_page=True)
        page.wait_for_timeout(1500)
        # Demonstrate failure handling using the same actual runtime.
        page.locator("#kind").select_option("blur")
        page.get_by_role("button", name="Load example").click()
        expect(page.locator("#source-action")).to_have_text("REQUEST_RECAPTURE", timeout=15000)
        if not page.locator("#crop").is_disabled() or not page.locator("#export").is_disabled():
            raise RuntimeError("Recapture must disable crop and stale export")
        page.screenshot(path=str(OUT / "workspace-recapture.png"), full_page=True)
        page.wait_for_timeout(1500)
        # Final state: the full source-to-crop transition remains visible.
        page.locator("#kind").select_option("two_docs")
        page.get_by_role("button", name="Load example").click()
        expect(page.locator("#source-action")).to_have_text("REQUEST_HUMAN_CROP", timeout=15000)
        for key, value in {"left":40,"top":90,"right":800,"bottom":1140}.items():
            page.locator("#"+key).fill(str(value))
        page.locator("#reason").fill("Select the complete left synthetic document with its border.")
        page.locator("#confirm").check(); page.locator("#crop").click()
        expect(page.locator("#child-action")).to_have_text("REQUEST_FIELD_EXTRACTION", timeout=15000)
        page.evaluate("window.scrollTo(0,400)")
        page.wait_for_timeout(1500)
        video = page.video
        context.close()
        video_path = Path(video.path())
        video_path.rename(OUT / "workspace-demo.webm")
        browser.close()
    if errors:
        raise RuntimeError(f"Browser JavaScript errors: {errors}")
    completed = subprocess.run([sys.executable,"-m","visualledger.crop",str(OUT/"browser-export.zip")] + DEV,cwd=ROOT,text=True,capture_output=True,check=True)
    source_commit = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True, capture_output=True, check=True).stdout.strip()
    assets = ["workspace-before.png", "workspace-after.png", "workspace-recapture.png", "workspace-demo.webm", "browser-export.zip"]
    artifact_hashes = {}
    for name in assets:
        data = (OUT / name).read_bytes()
        if not data:
            raise RuntimeError(f"Empty output artifact: {name}")
        artifact_hashes[name] = {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
    summary = {"status":"PASS", "source_commit":source_commit,
               "browser":"Chromium via Playwright", "browser_version":browser_version,
               "playwright_version":version("playwright"), "runtime":runtime,
               "artifacts":artifact_hashes, "source":"existing synthetic two_docs/blur fixtures",
               "actions":["load two documents","drag crop","edit exact pixel edges","confirm crop reason",
                          "canonical re-evaluation","download ZIP","independent ZIP replay",
                          "blur recapture keeps crop/export disabled"],
               "javascript_errors":errors,"crop_replay":json.loads(completed.stdout),
               "opencv5_execution":runtime["competition_opencv5_runtime"],"aws_deployed":False,"competition_submitted":False}
    (OUT/"browser-proof.json").write_text(json.dumps(summary,indent=2)+"\n")
    print(json.dumps(summary,indent=2))
finally:
    server.terminate()
    try: server.wait(timeout=5)
    except subprocess.TimeoutExpired: server.kill();server.wait()
