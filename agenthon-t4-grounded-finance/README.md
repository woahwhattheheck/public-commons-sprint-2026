# Agenthon 2026 Track 4 — Grounded Finance Candidate

Public competition build for **Agenthon 2026 / NeurIPS 2026 Track 4 (Explainability)**.

This package is optimized around **verifiability before fluency**. It never accepts citation
identity or source spans from a model. Corpus eligibility, exact character spans, roster coverage,
ordering, finite numbers, and output serialization are deterministic code paths.

## Current competition contract captured by this build

- Track: T4 Explainability / stable verb `analyze`.
- Development and registration close **2026-10-12 23:59 AoE** under the rules amended 2026-09-17.
- Final + Verification runs **2026-10-13 through 2026-10-25**.
- In evaluation there is no general internet. Supported T4 submissions may use only the
  organizer-hosted House model through the restricted route.
- Frozen-corpus citations must respect the unit cutoff/embargo.
- Current rules say prize categories and amounts will be announced separately; this repository
  therefore makes **no prize, score, rank, revenue, or cash claim**.

Official references:

- <https://www.agenthon.net/rules/>
- <https://www.agenthon.net/guides/submission-format/>
- <https://github.com/Agenthon-2026/track4-analysis-public>

Always re-read the organizer's current rules, track README, card, and logged-in submission
surface before packaging. Competition rules can change.

## What this candidate does

1. Strict JSON ingestion rejects duplicate keys, malformed dates, non-finite numerics, duplicate
   roster IDs, duplicate corpus IDs, symlinked corpus files, and unbounded inputs.
2. `corpus/manifest.json` is treated as an index, never as a citable document; citation IDs come
   from the authoritative corpus filename stem.
3. Corpus documents newer than the task cutoff are excluded **before retrieval**.
4. Document text follows the organizer resolver: use flat `text` when present, otherwise join
   `spans[].text` with one space, and compute citation offsets against that exact resolved string.
5. Retrieval ranks exact sentences from the frozen corpus and preserves source character offsets.
6. If `MODEL_ENDPOINT`, `MODEL_TOKEN`, and `MODEL_NAME` are all present, one bounded HTTPS House request
   plans labels/numeric predictions for the complete roster. Redirects are refused, response bytes are capped,
   and both the provider envelope and model content use strict duplicate/non-finite JSON parsing. The model never controls citations.
7. If House access is missing, errors, or emits contract-invalid output, the agent falls back
   deterministically and still produces a reproducible candidate answer.
8. Every output claim is copied from the exact cited source span.
9. The output uses the task's exact interval level and deterministic roster order.
10. If a synthetic unit contains only post-cutoff evidence, the agent writes a schema-shaped
    unresolved marker rather than citing future evidence or crashing; that unit is not claimed
    admissible.
11. Writes are atomic and refuse an existing output symlink.

The deterministic fallback is an **availability floor, not a quality claim**. A real leaderboard
candidate still needs public-unit evaluation, faithfulness checks, scoring experiments, and
competition-provided runtime evidence.

## CLI

```bash
python -m agenthon_t4.cli analyze \
  --task /input/task.json \
  --corpus /input/corpus \
  --out /output/answer.json
```

Force deterministic offline mode:

```bash
python -m agenthon_t4.cli analyze --offline \
  --task /input/task.json --corpus /input/corpus --out /output/answer.json
```

The official evaluation environment provides House-route values. Do **not** add vendor API keys or
external retrieval. This source does not contain registration credentials or a Team Key.

## Test

From this directory:

```bash
python -m unittest -v tests.test_agenthon_t4 tests.test_agenthon_boundaries
python -O -m unittest -v tests.test_agenthon_t4 tests.test_agenthon_boundaries
python -m py_compile agenthon_t4/*.py tests/test_agenthon_t4.py tests/test_agenthon_boundaries.py
```

Tests are synthetic and contain no hidden Agenthon material.

## Docker

```bash
docker build -t agenthon-t4-grounded-finance:dev .
docker run --rm --network=none \
  -v "$UNIT/task.json:/input/task.json:ro" \
  -v "$UNIT/corpus:/input/corpus:ro" \
  -v "$OUT:/output" \
  agenthon-t4-grounded-finance:dev \
  analyze --offline --task /input/task.json --corpus /input/corpus --out /output/answer.json
```

The image declares the required `qfbench2.interface_version="2.0"` label and uses Python 3.13.

## Provider actions intentionally not performed here

This source lane does not register a team, accept competition/platform terms, link CodaBench,
publish a registry image, upload a submission, spend cloud money, or claim a score. Those actions
require the actual account/provider state and the current organizer instructions.
