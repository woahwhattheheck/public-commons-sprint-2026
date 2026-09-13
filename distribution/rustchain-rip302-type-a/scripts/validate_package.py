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

section_tracks = sorted((ROOT / "voiceover").glob("section-*.mp3"))
clips = sorted((ROOT / "voiceover" / "clips").glob("*.mp3"))
assert len(section_tracks) == 5, [p.name for p in section_tracks]
assert {p.name[8:10] for p in section_tracks} == {"01", "02", "03", "04", "05"}
assert len(clips) >= 5, len(clips)
assert {p.name[:2] for p in clips} == {"01", "02", "03", "04", "05"}


def duration(path: Path) -> float:
    out = subprocess.check_output([
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=nw=1:nk=1", str(path),
    ], text=True).strip()
    return float(out)

section_seconds = 0.0
for p in section_tracks:
    dur = duration(p)
    assert dur > 20, (p.name, dur)
    section_seconds += dur
assert 180 <= section_seconds <= 480, section_seconds

clip_seconds = 0.0
for p in clips:
    dur = duration(p)
    assert dur > 1, (p.name, dur)
    clip_seconds += dur

src = (ROOT / "SOURCES.md").read_text(encoding="utf-8")
assert "8c79fba7561283ff8c880258152cd15e2610c312" in src
print(
    f"validated package: section_tracks={len(section_tracks)} section_seconds={section_seconds:.2f} "
    f"editor_clips={len(clips)} clip_seconds={clip_seconds:.2f} visuals={len(svgs)} thumbnails=3"
)
