# Academic Evidence Studio — OST voting-booklet NLI candidate

**Hack Apertus 2026 · Track 2A, Academia Challenges · proposed OST challenge:** Multilingual Natural Language Inference over Swiss Official Voting Booklets. This submission package follows the organizer's original [`HackApertus/project-template`](https://github.com/HackApertus/project-template) `track_2a/` layout and preserves the source originally published in [`woahwhattheheck/public-commons-sprint-2026`](https://github.com/woahwhattheheck/public-commons-sprint-2026/tree/main/work/competitions/hack-apertus-2026/academic-evidence-studio), PRs #214 and #251. **Track-specific eligibility, required challenge evaluation data and official submission have not yet been completed.**

## What the project does

Academic Evidence Studio supports the OST fact-checking workflow: provide a proposition and passages from official source booklets; compute source-exact, checksum-bound candidate excerpts; optionally ask a *real Apertus 1.5* OpenAI-compatible chat-completions endpoint for a `supported` / `contradicted` / `insufficient` proposal with IDs of the excerpts actually supplied; require a human assessor to review and accept or reject that proposal. The separate research review workspace allows batches of up to 20 claims, human citation selection, explicit decisions, save/resume, and Markdown report export with source checksums and original UTF-16 character offsets. It is intentionally not an automatic verdict oracle. The model interface fails if no endpoint/key is present; it does not substitute fabricated inference.

## Run from a clean checkout

From `track_2a/` with Docker and GNU Make:

```sh
make run
```

The command builds `node:22-alpine` and launches the *existing* original Studio app at **http://127.0.0.1:8787**, plus the review workspace at **http://127.0.0.1:8788**. The source is copied inside the Docker build context; the judge needs no host Node install, package manager or pre-installed dependencies. Without model credentials, the Studio defaults to offline excerpt matching while the batch workspace remains usable. The Docker container runs as a non-root user; both host ports bind only to host loopback.

For real Apertus 1.5 inference, provide the standard organizer environment variables before `make run`:

```sh
export LLM_NAME='swiss-ai/Apertus-v1.5-8B'   # replace with exact model identifier on your endpoint
export LLM_BASE_URL='https://YOUR-APERTUS-PROVIDER/v1'
export LLM_API_KEY='YOUR-ACCOUNT-SUPPLIED-KEY'
make run
```

The package converts `LLM_BASE_URL` into the required `/chat/completions` URL and maps `LLM_NAME`, `LLM_API_KEY` to the existing, original Apertus adapter (`APERTUS_*`). The workspace on 8788 deliberately makes **zero provider requests**. The single-claim UI on 8787 can invoke actual live inference when its *Live Apertus* mode is chosen. No credentials are stored in the repository or Docker image. Never paste personal voting-booth details, confidential records or unlicensed documents.

## Focused reproducibility

```sh
make test
# Runs: node --test src/test_runtime.mjs src/test.mjs src/workspace.test.mjs
```

The new wrapper's two focused validation cases passed on Node v22.16.0 in a cloud container on 9 October 2026. The original source owners previously checked their focused app and workspace behavior when they merged PRs #214 and #251. **Docker build, live Apertus inference, challenge NLI accuracy and official submission have not been executed by this packaging seat.** Run the Docker service on the signed-in local/Muse machine, with real original-booklet/organizer cases and the actual provider credentials, before entering competition claims or numerical results.

## Submission workflow and references

The current official `track_2a/README.md` says to submit on the **organizer website, not Devpost**: https://hackapertus.ch/online-hack/submissions . The hard deadline is **16 October 2026, 12:00 CEST = 10:00 UTC**. The organizer template requires this unchanged `track_2a/` directory layout, `technical_report.md`, `src/`, `data/` (maximum 100 MB), `docs/`, and a Docker-based `make run` from the project root. The signed-in human entrant must supply their real team account, satisfy the **specific OST challenge deliverables**, and obtain the organizer's acceptance/submission receipt. A GitHub pull request is not an entry receipt. The organizer's current challenge-specific guide is at https://hackapertus.notion.site/getting-started-guide-onlinehack ; compare that challenge text against this candidate before selecting Track 2A. If the official challenge requires a fully automated multilingual evaluation rather than research-review tooling, use these components as a prototype, not as evidence of complete challenge coverage.

For architecture, evaluation status and risk, see [`technical_report.md`](technical_report.md). For exact original source attribution see [`docs/DELIVERY.md`](docs/DELIVERY.md). No datasets or example evaluation results are presented as real official voting-booklet data.

## Open-source license

Organizers require code under Apache-2.0 and documentation under CC-BY-4.0 for submissions. New packaging is provided under those terms. The separately authored original Academic Evidence Studio was published with an MIT license; original authorship and the permissive source notice remain preserved in `src/LICENSE.original` and [`docs/DELIVERY.md`](docs/DELIVERY.md). Check the event's current terms before submitting.
