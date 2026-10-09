# Swiss Voices — local-language evidence workspace

New public-source **Hack Apertus 2026 / Track 1B** research prototype, started October 9, 2026. The organizer's deadline is **2026-10-16 at 12:00 CEST**. Track 1B concerns Swiss languages, local knowledge and values. This is an engineering candidate, **not a submitted entry or a claim of having native-speaker ground truth**.

## Run locally

Requires Python 3.10+ and no dependencies.

```sh
cd competitions/hack-apertus-2026/swiss-voices
python3 app.py
# Visit http://127.0.0.1:8768
```

The UI works without network access for case creation, human reference approval, reviews and export. **Actual Apertus model inference** is opt-in via server-side credentials:

```sh
APERTUS_API_KEY="<your provider key>" python3 app.py
```

Defaults to `https://api.publicai.co/v1/chat/completions`, model `swiss-ai/apertus-v1.5-8b`, 400 completion tokens, 22 s request timeout. Optional `APERTUS_API_BASE`, `APERTUS_MODEL`, `SWISS_VOICES_DB`. Never enter credentials in a browser form. Actual provider quota/access must be supplied by the entrant; **no provider call has been executed in this delivery**.

## End-to-end workflow

1. Create a locale-specific case (`de-CH`, `fr-CH`, `it-CH`, `rm-CH`) with attribution and provenance. Synthetic prompts remain tagged synthetic and do not purport to reflect a native speaker. For contributed human data, record informed consent **before** uploading a prompt. Public-domain cases require citation.
2. A human approves a reference answer and assigns an approver alias. This freezes the source/expected-answer fingerprint.
3. Run Apertus 1.5 once for that approved case (never silently fabricate a response). Save model name, response SHA-256 and reference approval SHA-256. Identical calls are deduplicated.
4. A *different* evaluator submits 1–5 scores for language fidelity, Swiss context and respectful localization, with a written rationale. A reviewer may not vote twice.
5. Export a complete JSON evidence ledger for manual peer verification or technical report; source consent receipts remain offline/private.

Source references are not transmitted to the inference provider; only locale, context and prompt are. Prompts and results remain local in `workspace.json`; do not commit this file or raw participant details. Browser binds **localhost only**; do not forward to untrusted users. The provider key stays in an environment variable.

## Auditable validity and limitations

- `synthetic`, `public_domain`, and `consented_person` are distinct; the source kind is immutable after creation.
- Uses canonical JSON SHA-256 for source-approval and response receipts and atomic durable updates, so a generated answer is linked to its prompt. Hashes establish integrity, not factual accuracy or authorship.
- Prevents a model run before human reference approval, rejects missing consent on human-source input, and blocks a source approver from reviewing their own case.
- Model output is **not** automatically graded; expert adjudication is required. The interface cannot establish the biological identity, fluency, competence, or consent authenticity of a claimed contributor.
- No benchmark, human review, native-speaker endorsement, or contest submission has been run, collected or claimed here.
- Prototype is single-user local, not multi-user SaaS. It does not collect identity documents, log provider secrets, or ship paid infrastructure.

## Submission completion gates

Actual Track 1B challenge brief/official getting-started-guide must be checked before entering. Recruit consenting Swiss locale speakers, collect genuine references and independent assessments, run real Apertus inference, publish consent-safe reproducible dataset/report, and prepare presentation. Then register and submit the real entry on Devpost before the deadline. Attribution and eligible payment belong to the original entrant; awards are competitive and unverified.

License: MIT. Source may be reused, but contributor-submitted content requires its own separate permission.
