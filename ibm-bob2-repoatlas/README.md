# RepoAtlas — IBM Bob 2.0 public build foundation

RepoAtlas turns a bounded repository evidence snapshot into a deterministic **human review packet** for onboarding and architecture-drift review. It helps a developer understand *what changed, what owns it, what tests reach it, which architectural/runbook evidence covers it, and what evidence is still missing* before the human decides what to do.

This subtree is an internal/public build foundation for the **IBM Bob 2.0 Hackathon (Sep 25–27, 2026)**. Current public event truth at build time: IBM Developer lists the digital Bob 2.0 event for Sep 25; the official event host lists a 48-hour online build, registration/kickoff Sep 25 15:00 UTC, submissions closing Sep 27 15:00 UTC, and a $10,000 prize pool. Tracks were still TBA, so the checked-in provider fixture intentionally sets `tracks_published=false`.

Sources:
- https://developer.ibm.com/hackathons/
- https://lablab.ai/ai-hackathons/ibm-bob-2-hackathon/live

## Product surface

Input is a source-controlled evidence manifest: repository + baseline digest, admitted files, dependency edges, bounded changes, ADR/runbook coverage and explicit provider state. RepoAtlas then:

- validates strict JSON, duplicate keys, UTF-8/Unicode scalar safety, bounded nesting, hashes, paths and field sets;
- binds every present changed-file manifest digest to the claimed image (`after_sha256` for added/modified, `before_sha256` for deleted), rejecting contradictory custody rather than analyzing two incompatible versions;
- computes module/owner/test/dependency topology;
- flags changed public APIs without ADR coverage, unowned changes, missing/indirect test evidence, operational changes lacking runbook coverage, deletions with live dependents and high-fanout changes;
- emits deterministic recommendations and content-addressed packet/receipt;
- recompiles the entire result during verification rather than trusting a self-authored receipt;
- mechanically keeps competition/provider truth separate from product-source readiness.

## Authority ceiling

RepoAtlas **never** merges, deploys, contacts anyone, accepts terms, registers an account, submits a competition entry, spends money, or claims an award/payment. This source-only generation also rejects caller-supplied `true` provider flags: Bob execution, registration, submission, or published-track evidence must arrive through a separately source-bound successor rather than being self-attested in the input JSON. Output is `READY_FOR_HUMAN_REVIEW` or `HOLD_EVIDENCE_GAPS`, not an operational authorization.

The supported package API seals the retained legacy implementation's ordinary module-level compiler/verifier names during parent-package initialization, so `import repoatlas._core_source_v1` does not expose a second normal compiler that can bypass the source-only provider gate. This is a **cooperative Python-runtime boundary**, not a claim of resistance to code that can rewrite/reload package source, replace import machinery, or mutate live interpreter internals. Hostile same-interpreter integrity requires a separate isolated/source-verified runner that this carrier does not provide.

`BOB_EXECUTION_REQUIRED` stays present until a real IBM Bob execution receipt is admitted by a later authorized provider lane. This source build does not claim that Bob was used, that the team is registered, or that a submission exists.

## Demo

```bash
cd ibm-bob2-repoatlas
python -m repoatlas.cli compile \
  --input fixtures/synthetic-repo.json \
  --packet /tmp/repoatlas.packet.json \
  --receipt /tmp/repoatlas.receipt.json
python -m repoatlas.cli verify \
  --input fixtures/synthetic-repo.json \
  --packet /tmp/repoatlas.packet.json \
  --receipt /tmp/repoatlas.receipt.json
```

The synthetic fixture intentionally has an unowned/untested worker change, so the demo lands in `HOLD_EVIDENCE_GAPS` while still producing a deterministic onboarding/drift report.

## Test

```bash
python -m py_compile repoatlas/*.py tests/*.py
python -m unittest discover -s tests -v
python -O -m unittest discover -s tests -v
```
