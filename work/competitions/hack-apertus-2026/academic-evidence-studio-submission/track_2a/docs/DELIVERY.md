# Source and operator lineage

This is a packaging of an already-published, source-preserved project, not a separately authored replacement model.

- Original Academic Evidence Studio published in `woahwhattheheck/public-commons-sprint-2026` PR #214, merge `14f0c854636d62e7f8a06622228ce4ddb88c3a15`, original `app.mjs` Git blob `354e66b8206c65255c16ccee35deb220d2bdb998`.
- Original multi-claim review workspace published in the same repo PR #251, merge `96102cb6b42893ca62de1ddab387baca5b358ca8`, original `workspace-server.mjs` blob `1db56a3a52812a7e9b2ecd19dd211b3625e46b28`.
- Organizer's public template `HackApertus/project-template` main at `7f2382275461baf3fa6c8855d157d86abffe9f0e` supplies the official `track_2a/` layout, Docker-backed `make run` requirement and canonical `LLM_*` configuration. The source copy here must retain original blob identity for every original source file.

The only new runtime module is `src/run.mjs`, mapping the organizer's base URL to the pre-existing OpenAI-compatible Apertus adapter and binding the two original HTTP apps inside Docker. No new model inference/accuracy is claimed. The source model adapter remains the original implementation.
