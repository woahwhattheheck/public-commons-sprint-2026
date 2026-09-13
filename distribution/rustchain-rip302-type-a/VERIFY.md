# Verification record

Generation environment used for the submitted artifacts:

- eSpeak 1.48.15
- FFmpeg 7.1.5
- Python 3 / Pillow 12.3.0

Run from `distribution/rustchain-rip302-type-a/`:

```bash
python3 scripts/build_assets.py
python3 scripts/generate_voiceover.py
python3 scripts/validate_package.py
```

The validator checks:

- required package files are present;
- three thumbnail PNGs are 1280×720;
- seven SVG visuals declare a 1920×1080 canvas;
- exactly five final per-section narration MP3 tracks are present and each exceeds 20 seconds;
- sentence-level edit clips cover all five script sections and each has nonzero duration;
- combined final-section runtime stays within the bounty's 3–8 minute script window;
- `script.md`, `SOURCES.md`, `assembly.md`, and `metadata.md` are non-empty;
- the source map includes the pinned RustChain commit.

The repository narration profile is 8 kHz mono MP3 at 8 kbps. The generator emits five final per-section tracks plus 45 sentence-level edit clips. The reference build totals 318.17 seconds (approximately 5:18) in both representations. The generated section tracks remain the timing authority for final assembly.

The package uses no production mutation, no token transfer, and no third-party stock footage. The voiceover is synthetic narration generated locally from the script.
