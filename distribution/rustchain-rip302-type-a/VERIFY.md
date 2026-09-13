# Verification record

Generation environment used for the submitted artifacts:

- eSpeak 1.48.15
- FFmpeg 7.1.5
- Python 3 / Pillow 12.3.0

Run:

```bash
python scripts/build_assets.py
python scripts/validate_package.py
```

The validator checks:

- required package files are present;
- three thumbnail PNGs are 1280×720;
- seven SVG visuals declare a 1920×1080 canvas;
- five per-section narration MP3 files exist and have nonzero duration;
- `script.md`, `SOURCES.md`, `assembly.md`, and `metadata.md` are non-empty;
- the source map includes the pinned RustChain commit.

The package uses no production mutation, no token transfer, and no third-party stock footage. The voiceover is synthetic narration generated locally from the script.
