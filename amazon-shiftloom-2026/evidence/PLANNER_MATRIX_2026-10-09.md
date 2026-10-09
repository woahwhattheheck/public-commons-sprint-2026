# ShiftLoom planner: broad reproducible competition-domain replay (2026-10-09)

## Provenance

- Original Amazon Alexa+ simulated-experience source: `woahwhattheheck/public-commons-sprint-2026`, original source recovery merge `4140effebc83dbf26345191edfe2e3bb62a1759f`.
- Actual planner module Git blob: `c7cfc52d029b88b83981cedf2bffd518d828d55b`; seed module `d8f8ccb7595607eb6ab7177b7874755054ca6aac`.
- Exact original 10-file source ZIP SHA-256: `c2efdcf773fb4a07b3c634ebfadbfd54ffc7469fb9607d42d6d32c24d167e7a8`; all ten public Git blobs matched.
- Cloud runtime: Node v22.16.0. Executed original modules directly, without mocking planner logic, internet calls or an alternate scheduler.
- Reproducer: `cd amazon-shiftloom-2026 && node evidence/planner_matrix.mjs`. It exits with an assertion error on a failed invariant and prints a full JSON summary otherwise.
- Deterministic PRNG seed: 20261009, case increment 7919. Exactly 2,048 scenario evaluations across the product's four real shifts.

## Observed program outcomes

| Shift | Real planner evaluations | Complete proposals | Holds |
|---|---:|---:|---:|
| Welcome desk | 512 | 490 | 22 |
| Workshop | 512 | 415 | 97 |
| Cleanup | 512 | 471 | 41 |
| Setup | 512 | 187 | 325 |
| **All** | **2,048** | **1,563** | **485** |

- Of the 1,563 complete proposals, **415** applied a real source-level absence-removal/replacement path.
- **485** held without publishing a partial change: 309 already fully covered and 176 cases without enough eligible volunteers.
- **0 invariant assertion failures** during this run. For every approved-capable proposal the harness checked uniqueness, required skills, individual availability and unavailability, booking overlap, weekly limit, exact shift capacity after the *actual* `applyProposal` method, no in-place mutation of the original state, monotonic revision and refusal of replay at a newer revision.
- These are observed behaviors on varied fictional event-domain panels; they are **not** an Amazon/Devpost score, judge verdict, statistical estimate of real volunteer availability, or proof of exhaustive correctness.

## 1:1 relation to the entrant's submitted-track technology

Amazon's October 2026 rules §4 explicitly permit a *simulated Alexa+ experience* implemented as a web app with developer-chosen agentic tools in place of an actual Alexa device or MCP runtime. This replay exercises **the entrant's real deterministic agent tool** on the same fictional volunteer/shift/approval domain as the runnable product, rather than a substituted scheduling oracle: https://amazonappdev2026.devpost.com/rules .

For each case the harness starts from the original `seedEvent()` and varies availability, shift capacity, new fictional applicants, required-skill qualifications, preferences, weekly limit and assigned-volunteer absence in a seeded way. The application's actual `parseIntent`, `proposeCoverage`, `overlaps` and `applyProposal` drive every outcome and are independently checked against the source state. Re-run the script to see counts or the exact first failing case if code changes.

This replay is intentionally **separate** from the original owner's five focused HTTP/UX acceptance checks and the independently requested Muse full browser/HTTP judge journey. Human-facing demo/video, privacy, a live hosted application and official contest entry are separate deliverables. No AWS spend, Alexa hardware, live personal information, real volunteers or Devpost submission were used here.
