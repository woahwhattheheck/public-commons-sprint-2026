# Academic Evidence Studio — Track 2A technical report

**Event:** Hack Apertus 2026 Online Hackathon (1–16 October 2026)

**Proposed challenge:** OST — Multilingual Natural Language Inference over Swiss Official Voting Booklets. This is a source-preserved prototype for claim-to-official-document evidence review. Challenge-specific acceptance and eventual submission are pending the original organizer entrant.

**Original authorship:** Existing owner-contributed `Academic Evidence Studio` (PR #214) and `Multi-claim review workspace` (PR #251) in `woahwhattheheck/public-commons-sprint-2026`. The packaging adds only a Docker/Make runtime mapping official model variables, bundled source copies and a technical submission packet. Team identity and entrant account are to be supplied via the original organizer portal; not inferred from a GitHub username.

## 1. Research question and prototype

Can official booklet sentences be used to support, contradict or leave unresolved a research claim without hiding the exact source spans from a multilingual reviewer? The Studio captures a claim, up to eight original source excerpts, and original quotation offsets/hashes. It can ask Apertus to make an evidence-linked NLI suggestion, but only a reviewer can record the accepted assessment. Multiclaim batch review provides a resumable, citation-preserving workflow rather than a generic chat answer. The goal aligns with the *type* of task in OST NLI; alignment to the organizer's detailed scenario, required languages, gold labels, scoring, and deliverables must still be checked from the OST challenge page before submission.

## 2. Architecture and flow

```
Original source document excerpts (licensed, pasted by reviewer)
         |
         v
 src/app.mjs: UTF-16 source-aware sentence extraction + SHA-256 + lexical match
         |
         +--> offline exact quotation suggestions --> reviewer
         |
         +--> (opt-in) real Apertus chat completions over chosen excerpts
              JSON verdict with evidence_ids validated against existing quotations
         |
         v
 Human-reviewed decision + selected source IDs + original offsets
         |
         v
 src/workspace.mjs / workspace-server.mjs: save, restore, cross-check, export
```

`src/run.mjs` is the Docker entry point, exposing the original single-claim app at port 8787 and the original offline batch workspace at port 8788. Existing source modules are copied byte-for-byte from original public main (the source record is in `docs/DELIVERY.md`). No third-party NPM packages. The reviewer UI escapes untrusted text, never executes it, and the live adapter only references retrieved quote IDs. Source documents are not uploaded in this repository.

## 3. Apertus model integration

**Required model family:** Apertus 1.5 (8B or 70B), via an actual OpenAI-compatible serving endpoint. The template's `LLM_NAME`, `LLM_BASE_URL` and `LLM_API_KEY` are passed by Docker environment only. `run.mjs` normalizes the base URL to a chat-completions endpoint, without changing the original app's request semantics. The source uses temperature 0 and a maximum of 350 returned tokens, with a system instruction to treat source text as untrusted data, only supplied citation IDs and a preference for `insufficient` when evidence is inadequate. Provider response is rejected if citation IDs do not exist.

**Runtime:** Node.js 22 in the organizer's standard Docker pathway. Requires Docker to build a Node 22 Alpine image. No local model weights bundled. Judges running hosted inference must provide a real Apertus API endpoint/key and exact model name (and connectivity to that endpoint). Offline source review works without the model but **does not satisfy a claim of live model inference or full Track 2A model use on its own**.

## 4. Data and licensing

Official Swiss voting booklets, their versions, and any organizer-provided bilingual/multilingual NLI evaluation cases must be acquired from the relevant public original source. None are embedded in this packet. At upload time, record original URLs, language, download timestamps, licensing, and stable content digests. Model inputs may include only material whose processing and redistribution are permitted. No personally identifiable records, private materials or unverified fabricated gold labels are used. `data/` currently contains only source-handling instructions; limit remains under organizer's 100MB cap.

## 5. Evaluation plan and actual results

| Evidence / setting | Metric or observation | Measured result |
| --- | --- | --- |
| Original PR #251 prior focused source acceptance | Node 22 `workspace.test.mjs` assertions + loopback HTTP round-trip | 3 passed, 0 failed (original PR authors' record) |
| Packaging wrapper in this cloud seat, 2026-10-09 | `src/test_runtime.mjs` for LLM URL/credentials mapping | 2 passed, 0 failed |
| Docker `make run` full clean-checkout test | service start + both UI endpoint health and live API configuration | Not yet executed by this seat (Docker engine unavailable) |
| OST official multilingual NLI | Per-language accuracy, macro-F1, class confusion, abstention rate on **all official released test cases** | Not yet measured: no organizer gold data and no live provider call in this seat |
| Human evidence integrity | Unknown citation IDs rejected, original-source offsets/checksums preserved | Source-level behavior covered by original owner tests; not an official NLI accuracy metric |

For a first official evaluation: run `make run` on a Docker-capable machine; choose a working Apertus model key; import the original organizer evaluation sources preserving every booklet/version/language; execute the complete real partner task set and compare actual three-class decisions with originals (both human and model), record denominators and per-language metrics plus latency. Do not select a best candidate based on mismatched test cases or synthetic placeholders. Re-run full challenge coverage after any model/source change.

## 6. Limitations and safety

- The source passage extractor is lexical, not a learned multilingual retriever; low word overlap or paraphrase may omit relevant spans.
- A model verdict remains a non-authoritative suggestion. Prompt injection in source text is treated as untrusted, but no claim of comprehensive red-team safety is made.
- Reviewer labels are entered manually; saved JSON checksums are integrity hints, not cryptographic user signatures.
- OpenAI-compatible Apertus endpoint and key must be actually provided; absent credentials mean **offline** mode. A configured endpoint is not proof a provider ran successfully.
- This prototype alone does not prove that the OST academic challenge deliverables, coverage requirements or organizer judge Docker acceptance are satisfied. It needs a real booklet corpus, actual original challenge evaluation and a signed-in organizer submission.
- Docker image `node:22-alpine` itself is a network-fetched dependency at build time; no Docker build occurred in this cloud container.

## 7. Reproducibility and exact source

```
cd track_2a
make run
# http://127.0.0.1:8787 single-claim live-capable
# http://127.0.0.1:8788 multi-claim offline review
```

The bundled original `app.mjs` must match Git blob `354e66b8206c65255c16ccee35deb220d2bdb998`; original `workspace-server.mjs` must match `1db56a3a52812a7e9b2ecd19dd211b3625e46b28`. The 5 source files added by original workspace PR #251 and other original source files are copied, not rewritten. `docs/DELIVERY.md` records original source/organizer commit positions. Tests are focused to the actual wrapper and original source modules; no unrelated repo-wide validation.

## 8. Next practical experiment and submission

Prepare the original official Swiss booklet corpus in the supported source-excerpt format, run the complete original OST multilingual NLI evaluation with real Apertus endpoint, report per-language and pooled confusion matrices, fix model/retrieval errors, and record a Docker startup pass. Then select only this existing original entrant's Track 2A project for organizer portal submission by **2026-10-16 12:00 CEST (10:00Z)** at `https://hackapertus.ch/online-hack/submissions`. Capture the final provider submission ID/state. Do not create fake competing entrant identities or attribute acceptance to GitHub merge.

## Licensing and citations

New source packaging and runner: Apache License, Version 2.0. Submission text/docs: Creative Commons Attribution 4.0. Original Academic Evidence Studio source: MIT notice retained in `src/LICENSE.original`. Project-template guidance: `HackApertus/project-template` @ `7f2382275461baf3fa6c8855d157d86abffe9f0e`.
