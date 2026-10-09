"""Render a narrated VisualLedger judge walkthrough from the original synthetic Actions artifact.

Requires Pillow, espeak, ffmpeg, ffprobe, and the original unmodified Actions ZIP.
The capture is development OpenCV 4.13; a *separate* GitHub Actions run proves Linux
x86-64 OpenCV 5.0.0. No AWS/arm64 deployment or contest entry is claimed.
"""
from __future__ import annotations
import hashlib
import json
import subprocess
import zipfile
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parent
ARCHIVE = ROOT / "visualledger-browser-evidence-run37894218628.zip"
EXPECTED_SHA = "c33016ec8c73f51cd21d67bc1321dd5df425bb10f3aa4fadb3c0a07c6bdfb88d"
SRC = ROOT / "extracted"
OUT = ROOT / "judge-video-build"
SRC.mkdir(exist_ok=True)
OUT.mkdir(exist_ok=True)
W, H = 1280, 720
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
head = ImageFont.truetype(BOLD, 38)
body = ImageFont.truetype(FONT, 23)
small = ImageFont.truetype(FONT, 18)

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

if sha(ARCHIVE) != EXPECTED_SHA:
    raise ValueError("Source evidence archive differs from the original verified Actions artifact")
needed = {
    "workspace-demo.webm", "workspace-before.png", "workspace-after.png",
    "workspace-recapture.png", "browser-proof.json", "browser-export.zip",
}
with zipfile.ZipFile(ARCHIVE) as z:
    if set(z.namelist()) != needed or z.testzip() is not None:
        raise ValueError("Unexpected or corrupted source evidence members")
    for filename in needed:
        (SRC / filename).write_bytes(z.read(filename))
proof = json.loads((SRC / "browser-proof.json").read_text())
if proof.get("status") != "PASS" or proof.get("runtime", {}).get("competition_opencv5_runtime") is not False:
    raise ValueError("Original browser development proof did not match expected verified state")

def call(args):
    subprocess.run(args, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

def duration(path):
    output = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
        text=True, capture_output=True, check=True,
    )
    return float(output.stdout.strip())

def wrap(draw, line, font, limit):
    lines, current = [], ""
    for word in line.split():
        candidate = (current + " " + word).strip()
        if current and draw.textbbox((0, 0), candidate, font=font)[2] > limit:
            lines.append(current)
            current = word
        else:
            current = candidate
    return lines + ([current] if current else [])

def poster(index, title, screenshot, caption):
    image = Image.new("RGB", (W, H), "#0d1728")
    d = ImageDraw.Draw(image)
    d.rectangle((0, 0, W, 9), fill="#27c2c7")
    d.text((54, 34), title, font=head, fill="#e9f3ff")
    d.text((57, 91), "VISUALLEDGER  /  SYNTHETIC DEVELOPMENT DEMONSTRATION", font=small, fill="#7bc3ce")
    d.rounded_rectangle((40, 130, 1240, 625), radius=16, fill="#15243a", outline="#34465f", width=2)
    if screenshot:
        sample = Image.open(SRC / screenshot).convert("RGB")
        fitted = ImageOps.contain(sample, (1140, 475), Image.Resampling.LANCZOS)
        image.paste(fitted, ((W - fitted.width) // 2, 137 + (475 - fitted.height) // 2))
    else:
        d = ImageDraw.Draw(image)
        for index2, (label, status) in enumerate([
            ("Versioned S3 input", "Not observed live"),
            ("OpenCV 5 on AWS Lambda", "Not verified"),
            ("DynamoDB evidence ledger", "Not verified"),
        ]):
            y = 162 + index2 * 142
            d.rounded_rectangle((280, y, 1000, y + 90), radius=15, fill="#203451", outline="#58738c", width=2)
            d.text((330, y + 16), label, font=ImageFont.truetype(BOLD, 28), fill="#e6f8ff")
            d.text((331, y + 56), status, font=small, fill="#ffc28a")
            if index2 < 2:
                d.text((627, y + 94), "↓", font=head, fill="#77dbe0")
    d = ImageDraw.Draw(image)
    d.rectangle((0, 640, W, H), fill="#0a1220")
    for j, line in enumerate(wrap(d, caption, body, 1160)[:2]):
        d.text((54, 649 + j * 30), line, font=body, fill="#e2ebf6")
    d.text((1217, 46), f"{index:02}", font=small, fill="#79b3c8", anchor="ra")
    path = OUT / f"frame-{index:02}.png"
    image.save(path)
    return path

scenes = [
    ("The problem", "workspace-before.png",
     "Evidence quality changes the next action, not financial approval.",
     "Receipts and invoices can be blurry, repeated, or photographed together. VisualLedger measures what the camera captured before another workflow handles the document. The screenshots in this video come from a genuine synthetic browser run. No customer records are shown."),
    ("Perception is causal", "workspace-before.png",
     "Contours, geometry and quality checks feed an explicit four-way decision.",
     "The code uses OpenCV for document boundaries, perspective normalization, blur, contrast, glare, structural edges, and an image similarity fingerprint. Those measurements route work to recapture, human crop, possible duplicate review, or controlled field extraction. Every route still requires a person."),
    ("Ambiguous source image", "workspace-before.png",
     "Two synthetic documents lead to REQUEST_HUMAN_CROP.",
     "Here the original synthetic image contains two documents. The engine requests a crop rather than pretending the whole photograph is a single receipt. The operator supplies original-pixel coordinates, a reason, and confirmation before a new analysis is allowed."),
    ("Actual browser interaction", None,
     "Original browser capture • 12.48 seconds • no recreated UI.",
     "This is the real captured browser interaction, including the document selection and a new evaluation. It was not generated from a mock success response."),
    ("Crop changes the route", "workspace-after.png",
     "Actual fixture transition: REQUEST_HUMAN_CROP → REQUEST_FIELD_EXTRACTION.",
     "The confirmed rectangle is forty to eight hundred pixels across and ninety to eleven forty vertically. The engine reanalyzes that crop and asks for downstream field extraction. This is not an invoice approval. The export contains original bytes and receipts that were independently replayed."),
    ("Failure is useful evidence", "workspace-recapture.png",
     "Blur triggers REQUEST_RECAPTURE; crop and stale export are disabled.",
     "The same browser run then loads a blurred synthetic image. Visual quality no longer passes, so the engine requests recapture and disables stale crop or export controls. A failure is not hidden by the interface. It changes what the operator can do next."),
    ("AWS delivery boundary", None,
     "OpenCV 5.0.0 is verified on separate Linux x86-64 runner; AWS/arm64 remains unverified.",
     "A separate real GitHub hosted Linux source run, number thirty seven eight nine four two one eight eight three six, verified OpenCV five point zero point zero and two existing synthetic evaluation modes. This browser footage separately uses OpenCV four point thirteen development mode. The designed cloud path uses S three, Lambda and DynamoDB, but an ARM sixty four image and a real AWS transaction remain unverified."),
    ("What judges can verify", "workspace-after.png",
     "Genuine separate OpenCV 5 Linux source receipt plus browser proof; AWS/arm64, entrant and prize unverified.",
     "Judges can inspect the public source, the real synthetic workflow recording, the original browser proof and replay receipts. The next gate is OpenCV five on actual ARM sixty four AWS, plus an authorized contest submission. This demonstration makes no deployment, prize, payment, or customer-impact claim."),
]

parts, manifest = [], []
for i, (title, screenshot, caption, spoken) in enumerate(scenes, 1):
    wav = OUT / f"voice-{i:02}.wav"
    call(["espeak", "-v", "en-us", "-s", "153", "-a", "165", "-w", str(wav), spoken])
    voice_length = duration(wav)
    if i == 4:
        clip = SRC / "workspace-demo.webm"
        scene_length = duration(clip)
        if voice_length > scene_length - 0.1:
            call(["espeak", "-v", "en-us", "-s", "190", "-a", "165", "-w", str(wav), spoken])
            voice_length = duration(wav)
        if voice_length > scene_length:
            raise ValueError("Narration would overflow original unmodified capture")
        inputs = ["-i", str(clip)]
        vf = ("scale=1160:558:force_original_aspect_ratio=decrease,"
              "pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=0x0d1728,"
              "drawbox=x=0:y=0:w=iw:h=68:color=0x0a1220@0.92:t=fill,"
              f"drawtext=fontfile={BOLD}:text='ACTUAL SYNTHETIC BROWSER FOOTAGE  •  OpenCV 4.13 DEV':"
              "x=36:y=23:fontsize=26:fontcolor=white,"
              "drawbox=x=0:y=638:w=iw:h=82:color=0x0a1220@0.92:t=fill,"
              f"drawtext=fontfile={FONT}:text='Captured behavior; no AWS deployment shown':"
              "x=36:y=662:fontsize=24:fontcolor=white")
    else:
        card = poster(i, title, screenshot, caption)
        scene_length = voice_length + 1.2
        inputs = ["-loop", "1", "-framerate", "20", "-i", str(card)]
        vf = "format=yuv420p"
    segment = OUT / f"segment-{i:02}.mp4"
    call(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", *inputs,
          "-i", str(wav), "-filter_complex", "[1:a]apad[a]",
          "-map", "0:v", "-map", "[a]", "-vf", vf,
          "-t", f"{scene_length:.3f}", "-c:v", "libx264", "-preset", "veryfast",
          "-crf", "25", "-pix_fmt", "yuv420p", "-r", "20", "-c:a", "aac",
          "-b:a", "96k", "-ar", "44100", "-ac", "1",
          "-movflags", "+faststart", str(segment)])
    parts.append(segment)
    manifest.append({"scene": i, "title": title, "spoken": spoken,
                     "caption": caption, "duration_seconds": round(scene_length, 2),
                     "audio_seconds": round(voice_length, 2),
                     "visual": "ORIGINAL BROWSER FOOTAGE" if i == 4 else screenshot or "architecture explicitly unverified"})

playlist = OUT / "concat.txt"
playlist.write_text("".join(f"file '{part.resolve()}'\n" for part in parts))
final = ROOT / "visualledger-opencv26-narrated-synthetic-demo.mp4"
call(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-f", "concat",
      "-safe", "0", "-i", str(playlist), "-c", "copy", "-movflags",
      "+faststart", str(final)])
length = duration(final)
if length > 300:
    raise ValueError("Demonstration exceeds five-minute contest video limit")
receipt = {
    "status": "VIDEO_RENDERED_FROM_RETAINED_ORIGINAL_SYNTHETIC_EVIDENCE",
    "video_sha256": sha(final),
    "video_bytes": final.stat().st_size,
    "duration_seconds": round(length, 2),
    "original_artifact_sha256": sha(ARCHIVE),
    "original_footage_sha256": sha(SRC / "workspace-demo.webm"),
    "source_commit_from_original_browser_proof": proof["source_commit"],
    "browser_development_opencv_version": proof["runtime"]["opencv_version"],
    "separate_opencv5_linux_source_proof_run": "37894218836",
    "actual_aws_arm64_deployment": False,
    "official_submission": False,
    "scene_manifest": manifest,
}
(ROOT / "visualledger-opencv26-video-manifest.json").write_text(json.dumps(receipt, indent=2) + "\n")
print(json.dumps({key: receipt[key] for key in ("status", "video_sha256", "video_bytes", "duration_seconds")}, indent=2))
