from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
VOICE = ROOT / "voiceover"
VOICE.mkdir(exist_ok=True)
text = (ROOT / "script.md").read_text(encoding="utf-8")
parts = re.split(r"\n## \d+\. [^\n]+\n", text)[1:]
heads = re.findall(r"\n## (\d+)\. ([^\n]+)\n", text)
for old in VOICE.glob("*"):
    old.unlink()
for (num, title), body in zip(heads, parts):
    clean = re.sub(r"`([^`]+)`", r"\1", body).strip()
    clean = clean.replace("→", " to ").replace("RTC", "R T C").replace("RIP-302", "RIP three oh two")
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
    wav = VOICE / f"{num.zfill(2)}-{slug}.wav"
    mp3 = VOICE / f"{num.zfill(2)}-{slug}.mp3"
    subprocess.run(["espeak", "-s", "145", "-p", "42", "-w", str(wav), clean], check=True)
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(wav), "-ar", "16000", "-ac", "1", "-codec:a", "libmp3lame", "-b:a", "16k", str(mp3)], check=True)
    wav.unlink()
