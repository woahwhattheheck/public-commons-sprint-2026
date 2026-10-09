# Swiss Voices: opt-in, redacted local evidence digest

**Only for local analysis of the original Hack Apertus 2026 Track 1B prototype.** Uses Python stdlib; makes no network, Apertus API or contest submission calls.

```
cd competitions/hack-apertus-2026/swiss-voices
python report.py ./workspace.json --out ./safe-report.json
```

Input is the private existing v1 `workspace.json`. Never commit/share that source file or unredacted `/api/export` data without explicit contributor permissions. Output is a NEW JSON document (refuses overwrite) containing only case/run/review counts, source-kind counts and limited locale counts, never raw prompts, references, results, notes, aliases or case IDs. Checks original source case fingerprint, approval fingerprint, model response hash/run ID, independent reviewer identity and each review hash; malformed evidence causes no output. Existing app/UI/source workspace is unchanged. The helper is conservative: older workspaces with multiple recorded answers from one approval/model are rejected.

Per-locale figures are suppressed for fewer than five cases; operators may raise (not lower) the threshold with `--min-locale-group`. Aggregate counts still reveal activity and are **not a guarantee of anonymity**. Verify permission and residual disclosure risk before publishing any result. `consented_person` and aliases are SELF-ATTESTED, not proof of identity, competence, consent or rights. A local fingerprint does not prove external-model execution, output truth or jury scoring. Every output explicitly states `official_submission_status: NOT_VERIFIED`; even a full synthetic or self-attested workspace is not a final contest entry.

Organizer public pages checked Oct 9, 2026: [Devpost rules](https://hackapertus.devpost.com/rules) and [official online programme](https://hackapertus.ch/online-hack) give the submission deadline **October 16, 2026 12:00 CEST / 10:00 UTC** and mention technical report, relevant dataset and code repository. The organizer Track 1B *Getting Started Guide* contains detailed entry/assessment requirements but was not accessible through this public read, so exact evidence expectations and entry fields remain unverified. The original entrant must check those before any official submission.

A single focused synthetic check is available with `python -m unittest -q test_report_focused.py`; this neither certifies the rubric nor creates native-speaker evidence.
