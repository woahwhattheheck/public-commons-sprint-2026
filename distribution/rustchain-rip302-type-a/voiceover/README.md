# Narration assets

Use the five `section-*.mp3` files as the default assembly tracks. Their combined reference runtime is 318.17 seconds (~5:18), matching the chapter map in `../metadata.md`.

`clips/` contains the same narration split at sentence boundaries. These clips are optional edit handles for tightening pauses, replacing individual sentences, or aligning a visual beat without regenerating an entire section.

Both representations are generated from `../script.md` by `../scripts/generate_voiceover.py`; they are not separate scripts.
