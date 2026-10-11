# Academic Evidence Studio — OST Track 2A solution

This is the existing Academic Evidence Studio carrier upgraded to the official HackApertus 2026 Track 2A OST prediction contract. It performs document-grounded three-way NLI over Swiss voting booklets with Apertus v1.5:

- `0` — entailment
- `1` — neutral
- `2` — contradiction

The solution supports Task A PDF booklets and Task B reference text, all German/French/Italian source-claim language combinations, including cross-lingual cases. It returns source-verifiable evidence, token counts, and inference latency. It does not classify general political truth and does not use benchmark labels at prediction time.

Official references:

- [OST Track 2A guide](https://hackapertus.notion.site/track-2a-ost)
- [Solution API guide](https://hackapertus.notion.site/solution-api-guide-ef5b4fec112a834da43101ede56300f5)
- [MNLIoverSwissVotingBooklets](https://huggingface.co/datasets/OSTswiss/MNLIoverSwissVotingBooklets)
- [Federal Chancellery voting booklets](https://www.bk.admin.ch/de/sammlung-der-abstimmungsbuechlein-seit-1978)

## Official prediction interface

The image entrypoint accepts the exact organizer CLI:

```sh
python main.py --input /data/cases.jsonl --output /output/predictions.jsonl
```

Runtime environment:

```sh
BASE_URL=https://api.inference.cscs.ch/v1
API_KEY=...                       # injected at runtime; never stored
MODEL_NAME=swiss-ai/Apertus-v1.5-8B
CONTEXT_STRATEGY=selected         # selected or full
```

`BASE_URL` and `API_KEY` are read only at runtime. `MODEL_NAME` is restricted to `swiss-ai/Apertus-v1.5-*`; the public 8B model is the default. Every remote request uses `BASE_URL`. Inputs remain under the read-only `/data` mount, outputs under `/output`, and no model or data are downloaded during evaluation.

Build and run from this directory:

```sh
make build
BASE_URL=https://api.inference.cscs.ch/v1 \
API_KEY="$API_KEY" \
DATA_DIR="$PWD/data" OUTPUT_DIR="$PWD/output" \
make run
```

The Docker image targets Linux/amd64 CPU inference orchestration. PyMuPDF is installed at build time for Task A extraction. The historical Studio UI remains in `src/` with its original MIT notice, but is not the prediction container entrypoint.

## Full-document versus selected-context evaluation

The genuine public v1.1 dataset can be converted without altering labels:

```sh
python prepare_dev.py \
  --dataset /path/to/MNLIoverSwissVotingBooklets/v1.1.jsonl \
  --cases data/dev_cases.jsonl \
  --gold data/dev_gold.jsonl
```

Run the same cases twice with a real Apertus v1.5 endpoint:

```sh
CONTEXT_STRATEGY=full python main.py \
  --input data/dev_cases.jsonl --output output/full.jsonl

CONTEXT_STRATEGY=selected python main.py \
  --input data/dev_cases.jsonl --output output/selected.jsonl

python evaluate_dev.py --gold data/dev_gold.jsonl \
  --predictions full=output/full.jsonl \
  --predictions selected=output/selected.jsonl \
  --output output/comparison.json
```

The report includes overall and all nine language-pair denominators, confusion matrices, accuracy, macro-F1, abstentions, mean input/output tokens, and latency. These are development metrics only; held-out organizer macro-F1 remains private. Never describe a local or public-set score as an official held-out result.

## Focused checks

```sh
make test
```

The focused suite covers vote-anchored retrieval, source-quote verification, neutral evidence behavior, JSON response parsing, and `/data` path confinement. It makes no network or model calls.

## Evidence and failure behavior

For Task A labels 0 and 2, evidence must be a verbatim quote from the reported 1-based PDF page. Up to five items are emitted and each is capped at 5,000 characters. An unverifiable quote fails the case instead of fabricating evidence. Neutral Task A predictions emit an empty list. Task B evidence is optional and uses `page: null`.

The output file is written atomically. Missing credentials, non-v1.5 model identifiers, invalid case schemas, path traversal, malformed provider JSON, unsupported labels, and unverifiable required evidence fail with a nonzero exit rather than silently generating a proxy prediction.

## Authorship and licensing

This additive evaluator preserves the original Academic Evidence Studio source and authorship from public PRs #214, #251, and the Track 2A carrier PR #428. Original MIT terms remain in `src/LICENSE.original`; the submission wrapper and documentation use the repository's declared competition terms. See [`docs/DELIVERY.md`](docs/DELIVERY.md) for lineage. A merged source package is not an organizer submission, score, award, or payment receipt.
