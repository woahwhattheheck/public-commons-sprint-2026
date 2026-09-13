from pathlib import Path
from PIL import Image
import subprocess

ROOT = Path(__file__).resolve().parents[1]
required = ["README.md", "script.md", "assembly.md", "metadata.md", "SOURCES.md", "VERIFY.md"]
for name in required:
    p = ROOT / name
    assert p.exists() and p.stat().st_size > 100, f"missing/empty: {name}"

for name in ["thumbnail.png", "thumbnail-alt-a.png", "thumbnail-alt-b.png"]:
    with Image.open(ROOT / name) as im:
        assert im.size == (1280, 720), (name, im.size)

svgs = sorted((ROOT / "visuals").glob("*.svg"))
assert len(svgs) == 7, len(svgs)
for p in svgs:
    text = p.read_text(encoding="utf-8")
    assert 'width="1920"' in text and 'height="1080"' in text

mp3s = sorted((ROOT / "voiceover").glob("*.mp3"))
assert len(mp3s) >= 5, len(mp3s)
assert {p.name[:2] for p in mp3s} == {"01", "02", "03", "04", "05"}
total = 0.0
for p in mp3s:
    out = subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(p)], text=True).strip()
    dur = float(out)
    assert dur > 1, (p.name, dur)
    total += dur

src = (ROOT / "SOURCES.md").read_text(encoding="utf-8")
assert "8c79fba7561283ff8c880258152cd15e2610c312" in src
print(f"validated package: voiceover_clips={len(mp3s)} voiceover_seconds={total:.2f} visuals={len(svgs)} thumbnails=3")
