# Swiss Voices — human-reviewed localization evaluation for Apertus

**Hack Apertus 2026, Track 1B / Swiss Voices** · Original experimental source, October 9, 2026.

Purpose: measure whether one specific Apertus model answers practical, culturally sensitive Swiss-localized requests faithfully in **de-CH, fr-CH and it-CH**, rather than collapsing dialect/format assumptions into generic Germany/France/Italy conventions. The corpus is *original, synthetic and low-stakes*. Every question has a matching scenario in three language variants and an **independent human-review rubric**; there is no claim of native-speaker validation or ground-truth accuracy until reviewed.

## Run

Requires Python 3.10+ standard library; no package installation, paid compute, or shell scripts.

```bash
python swissvoices.py cases --show
export APERTUS_API_KEY='...'  # set privately; never place token in repository or logs
python swissvoices.py run --endpoint https://YOUR_PROVIDER/v1/chat/completions --model YOUR_EXACT_APERTUS_MODEL --output out/apertus-8b-20261009.jsonl
python swissvoices.py review --results out/apertus-8b-20261009.jsonl --case-id de_ch_receipt --verdict uncertain --reviewer reviewer-alias --notes 'Needs Swiss locale and language review'
python swissvoices.py report --results out/apertus-8b-20261009.jsonl --reviews out/reviews.jsonl > out/report.json
```

`--ids`/`--limit` bound network calls; no automatic retries, no implicit model requests, and no fallback from Apertus to some other model. Local-only development inference requires `--allow-local-http --endpoint http://localhost:PORT/v1/chat/completions`; HTTP to any other host is rejected. The API key is read only from the named environment variable and never added to output. Only the specific host, exact model name, prompt hash, response, latency, UTC time and SHA-256 evidence are recorded. No raw HTTP error response bodies are persisted.

## Product: what it measures

- **Cross-language matched cases:** same task in Swiss Standard German, Swiss French and Swiss Italian; reviewers can isolate variations under comparable situations.
- **Locale grounding:** Swiss currency/number formats, canton attribution, postcodes, dates and transit terminology, without treating any official matter as legal advice.
- **Calibrated uncertainty:** ambiguous Swiss regional customs and hypothetical service information must not prompt invented official facts.
- **No hidden truth oracle:** case rubrics are criteria for human reviewers, not automatic string-match scoring; `uncertain` is a first-class verdict.
- **Fail-closed integrity:** per-case checksums, append-only result/review records, rejection of stale case hashes or tampered evidence, and explicit denominators distinguishing attempts, usable responses and human-scored outputs.

## Reviewer protocol

At least two qualified human reviewers should independently assess each completed sample (native proficiency recommended); resolve disagreements in a signed review artifact before using scores in a submission. This first version enforces at most one review per case/evidence in a single output file. Create separate reviewer files for independent scoring, then reconcile externally; don't overwrite prior evidence. Do not publish private answers/identifiers. The corpus has no private personal data or copyrighted excerpts.

## Known limits and contest readiness

- This is a working, reproducible evaluator and authored sample corpus, **not a completed model benchmark or Devpost entry**. No live Apertus calls, native-speaker review, score or submission are claimed at source publication time.
- Verify the organizer's [current rules](https://hackapertus.devpost.com/rules) and track-specific Getting Started Guide before submission. The guide linked by Devpost was inaccessible when this artifact was authored; its minimum dataset/format/model requirements may differ.
- A qualifying submission needs real Apertus 1.5 inference, human review, the organizer's requested technical report/dataset format, and an authorized entrant/team account. Adapt the corpus under those rules rather than asserting eligibility by default.
- This dataset uses de-CH/fr-CH/it-CH; Swiss German dialects and Romansh are meaningful expansion work requiring qualified native-language authors/reviewers, not fabricated translations.

Code and sample prompts are original and shared under the repository's existing license. No training dataset is redistributed and no provider keys are included.

## Interactive comparison UI

```bash
cd /path/to/hackapertus_swissvoices
python -m http.server 8765
# open http://127.0.0.1:8765/viewer.html
```

The static responsive reviewer desk compares the three languages per scenario, permits prompt copying and accepts a *local* model-result JSONL for side-by-side inspection. It makes no API calls and never uploads files; the CLI independently verifies source hashes and reviewer evidence. Importing a file into the viewer is **not** a verified benchmark result.
