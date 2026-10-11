# Academic Evidence Studio — Track 2A technical report

**Event:** HackApertus 2026 Online Hackathon, OST Track 2A

**Task:** Multilingual NLI over Swiss official voting booklets
**Primary metric:** held-out macro-F1 over entailment, neutral, and contradiction

## 1. Scope and lineage

This package carries the existing Academic Evidence Studio source into the organizer's exact prediction API. The original Node research UI and review workspace remain byte-preserved in `src/`; the additive Python entrypoint is the competition solution. Original authorship from public PRs #214, #251, and carrier PR #428 is retained. A source merge is not an organizer submission or score.

## 2. Task contract

Each JSONL case contains exactly one source:

- **Task A:** a PDF booklet path and source language;
- **Task B:** reference text and source language.

Both include a vote/topic and a claim with its language. The prediction contains the original ID, integer label (`0` entailment, `1` neutral, `2` contradiction), matching label name, evidence, input/output token counts, and inference time. Task A non-neutral results require at least one verbatim source quote with a 1-based PDF page. Neutral evidence is empty. Task B evidence is optional and uses a null page.

## 3. Architecture

1. Validate JSONL and confine Task A paths to `/data`.
2. Extract ordered PDF text with PyMuPDF, or accept the provided Task B reference.
3. Choose either the full document or locally selected chunks. Selected mode ranks chunks using the vote name and cross-lingual claim terms while preserving original page identity.
4. Ask only an Apertus v1.5 model for the final three-way NLI decision at temperature zero.
5. Parse JSON, reject unsupported labels, and verify every emitted evidence quote against source text.
6. Atomically write organizer-schema JSONL under `/output`.

The source is untrusted evidence, not an instruction. The prompt explicitly forbids general-truth classification and asks for the smallest decisive verbatim quote. Invalid provider output fails instead of silently emitting a proxy label or invented evidence.

## 4. Runtime and security

The Linux/amd64 CPU orchestration image uses Python 3.12 and PyMuPDF 1.26.6. It reads `BASE_URL` and `API_KEY` at runtime; secrets are not stored. `MODEL_NAME` must begin `swiss-ai/Apertus-v1.5-`, with public `swiss-ai/Apertus-v1.5-8B` as the default. Every remote call is made to the normalized `${BASE_URL}/chat/completions` URL. No model, dataset, or PDF is downloaded at prediction time.

## 5. Genuine development data

The official public benchmark is `OSTswiss/MNLIoverSwissVotingBooklets`, v1.1. The recovered exact file contains 1,488 human-annotated rows, balanced across the three labels (495 entailment, 498 neutral, 495 contradiction), all nine German/French/Italian source-claim pairs, 60 booklets, and 177 votes. The locally recovered bytes have SHA-256 `87ee4afd9c0ee8861106c50f05884481402ca668aecf927df68fc52d915b02fd`. No public labels are embedded in the prediction container.

`prepare_dev.py` makes Task B cases and a separate gold file. `evaluate_dev.py` reports honest denominators, confusion matrices, accuracy, macro-F1, abstentions, mean tokens, and latency overall and for all nine language pairs. The same 1,488 cases should be run in `full` and `selected` modes through the same authenticated Apertus v1.5 endpoint. Public-development metrics must not be represented as official held-out scores.

## 6. Current measured state

| Evidence | Current state |
| --- | --- |
| Official guide/API reconciliation | Completed against Track 2A and Solution API guides |
| Genuine v1.1 dataset acquisition | 1,488 rows; SHA-256 above |
| Focused local checks | Run with `python -m unittest discover -s tests -p 'test_*.py'` |
| Docker build/run | Pending a Docker-capable executor |
| Real Apertus v1.5 full-document run | Pending existing authenticated allocation |
| Real Apertus v1.5 selected-context run | Pending existing authenticated allocation |
| Held-out organizer score | Not available; only organizer evaluation can establish it |
| Official submission | Pending original eligible entrant and portal receipt |

No model score is invented in this report.

## 7. Known limitations and next experiments

- Lexical selection can miss paraphrases across languages; full-document Apertus is the required matched control.
- PDF extraction quality depends on embedded text. A future bounded improvement may add OCR only if the official runtime permits it and actual Task A failures justify it.
- Evidence is exact-substring verified after whitespace normalization, which intentionally rejects model paraphrases.
- Sequential requests favor reproducibility and rate safety over throughput. Concurrency should be measured against the actual provider quota before adoption.

The next decision must use real matched results: compare full versus selected context on all 1,488 public cases, stratify by language pair and class, inspect selection errors, then preserve the strongest source-pinned configuration. After a clean container run, the original eligible entrant can submit before 16 October 2026 at 10:00 UTC and retain the provider receipt. Submission, acceptance, score, award, and payment remain distinct states.

## 8. Reproduction

```sh
make test
make build

python prepare_dev.py --dataset /path/to/v1.1.jsonl \
  --cases data/dev_cases.jsonl --gold data/dev_gold.jsonl

CONTEXT_STRATEGY=full python main.py \
  --input data/dev_cases.jsonl --output output/full.jsonl
CONTEXT_STRATEGY=selected python main.py \
  --input data/dev_cases.jsonl --output output/selected.jsonl

python evaluate_dev.py --gold data/dev_gold.jsonl \
  --predictions full=output/full.jsonl \
  --predictions selected=output/selected.jsonl \
  --output output/comparison.json
```

## Licensing

The original Academic Evidence Studio MIT notice remains in `src/LICENSE.original`. Additive competition code and documentation follow the repository's declared HackApertus submission terms. Dataset and federal booklet rights remain with their publishers and are not relicensed here.
