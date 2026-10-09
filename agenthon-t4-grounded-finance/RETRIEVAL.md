# Exact-span retrieval: coverage and throughput

The existing candidate now addresses three retrieval defects together:

- Long sentences are covered by overlapping passages of at most 900 characters,
  rather than silently discarding everything after their first 900 characters.
  Offsets remain Python character offsets into the exact original document text.
- Whitespace-equivalent duplicate passages and mostly overlapping tails cannot
  consume the three evidence slots repeatedly. Ranking still uses the previous
  score weights and deterministic document/offset tie-breaks.
- Each roster phase prepares sentence passages, tokens, dates and score constants
  once. `build_answer` and House `plan` each reuse their own invocation-local
  index. There is no persistent cache, cross-task cache or change to the CLI.
  The House and answer phases still construct separate indexes. Every query
  reapplies its task cutoff before ranking.

The standalone `retrieve(task, entity, docs)` API remains available. Its caller
gets an index for that call; multi-entity callers should share `RetrievalIndex`.
The House network request, token handling and model-output contract are unchanged.

## Focused validation

From `agenthon-t4-grounded-finance`:

```sh
python -m unittest -v tests.test_retrieval_index
```

Four regressions cover Unicode source offsets and late evidence, repeated and
strongly overlapping passages, changing cutoffs, and one-time per-roster tokenization
with identical House/offline evidence. The House test uses an injected transport;
no provider request or credential is required.

## Measurement on 2026-10-09

An offline Python 3.13.5 cloud-container comparison used 80 synthetic documents,
eight distinct sub-900-character sentences per document and 20 roster entities.
The original `agent.py` was verified against Git blob
`e4d3b9b8ff27849b77ea13bdc17b241700e24bf6` before comparison.

| Observation | Before | After |
| --- | ---: | ---: |
| Tokenizer calls per complete answer | 12,840 | 680 |
| Single measured answer-build time | 0.194691 s | 0.018611 s |
| Exact JSON answer equality on distinct short passages | Baseline | Identical |
| Relevant suffix beyond character 900 in a long sentence | Not retrieved | Retrieved |

That timing is one synthetic run (about 10.46x), not a general speed guarantee.
The separate deterministic tokenizer count establishes the avoided repeated work.
The complete original and updated implementations produced byte-equivalent JSON
on the synthetic compatibility fixture.

The organizer's complete public `t4-EXAMPLE-eps-beat` exemplar also passed a local
smoke: one entity, both corpus documents, three exact-source claims, correct date
cutoff, and byte-identical answer files before and after. Input copies were verified
against these organizer Git blobs:

- task: `2b3e0789f5fe40826a712993de3318cd9241203c`;
- 10-Q excerpt: `c31980e4222a0aa21abbb67c3756a121b47c4058`;
- 8-K excerpt: `55d916fb9cbe871c7861663e746eed534287a87e`.

Source: [organizer public exemplar](https://github.com/Agenthon-2026/track4-analysis-public/tree/main/units/t4-EXAMPLE-eps-beat).
These are organizer-provided example excerpts, not independent financial research.

## Limitations

This change improves evidence availability and avoids redundant computation; it
has not established better forecasting, NLI faithfulness, leaderboard score or
competition admissibility. Long windows can still split a word at their left edge,
although overlap preserves coverage. Tokenization remains the existing ASCII-oriented
rule. Whitespace-equivalent duplicate text is intentionally collapsed even across
documents; content from distinct dates can therefore have one retained representative.
The index trades memory for repeated parsing work and remains subject to existing
corpus size limits. No hidden labels, model inference, official scoring, registration,
submission, award or payout is represented by these results.
