# WorkSeal × Meteora — Crypto World's Fair submission packet

_Last source/evidence check: 2026-10-08. This file prepares public submission material; it does not represent a Colosseum or Superteam account action, submission receipt, award, deployment, or payment._

## One-line pitch

**WorkSeal turns a verified work-acceptance receipt into a deterministic Meteora Dynamic Bonding Curve launch plan, so a launch can commit its public metadata to the exact accepted work result instead of an unverifiable claim.**

## Why this fits the Meteora DBC track

Meteora DBC is not a decorative integration in this product path. The WorkSeal adapter generates the launch configuration that defines the curve, fee policy, quote asset, graduation into DAMM v2 liquidity, and post-graduation liquidity distribution. The current implementation binds the WorkSeal task/result/evidence/acceptance/settlement digests into the launch plan and requires a successful read-only WorkSeal verification before a plan can be produced.

Current implementation:

- `workseal/src/meteora_dbc.mjs` — deterministic DBC launch-plan builder.
- `workseal/src/meteora_cli.mjs` — file-to-plan CLI.
- `workseal/test/meteora_dbc.test.mjs` — focused fail-closed and configuration tests.
- `workseal/METEORA_DBC.md` — usage and authority boundary.
- Meteora source landed on repository main in commit `a1182112e3ee002a3fc1ed2499dc3ddc2c3a003a`.

The public Meteora sidetrack currently advertises a 20,000 USDC pool and evaluates depth of Meteora integration, technical execution, originality/taste, impact potential, and traction/volume. The listing explicitly says mainnet usage is preferred. This packet therefore separates what is already demonstrated in source from what still needs real-world evidence.

## Judge-facing summary

### Problem

Agent and contract work can produce artifacts quickly, but settlement and launch decisions often rely on weak statements such as “the work passed” or “this launch is backed by completed work.” Those statements are easy to detach from the exact task, result version, verifier, and acceptance event.

### Product

WorkSeal creates content-addressed task, result, evidence, acceptance, and settlement receipts. Its Meteora adapter adds a proof-to-launch path: only a WorkSeal bundle that verifies `PASS` can produce the DBC launch plan, and the plan commits the accepted result and acceptance digests into launch metadata.

### What Meteora enables

The DBC configuration is the actual launch primitive:

- configurable market-cap curve;
- 1% bonding-curve fee in the current preset;
- DAMM v2 graduation;
- 45/45/5/5 liquidity distribution, including 10% permanently locked liquidity;
- deterministic quote-mint, creator, fee-claimer, and leftover-receiver binding;
- a dry-run-first launch packet compatible with the documented Meteora Invent workflow.

A generic token-launch wrapper could not provide the same configurable curve/graduation path. Meteora is therefore central to the product concept rather than an interchangeable payment button.

## Evidence against the Meteora judging criteria

| Criterion | Current evidence | Honest gap / next proof |
| --- | --- | --- |
| **Depth of Meteora integration** | DBC config construction, curve and fee settings, DAMM v2 graduation, liquidity split, quote mint, program/SDK pinning, and Invent command sequence are represented in the generated plan. | A human owner should run the current official Invent dry run and capture provider-visible devnet evidence before claiming an executed launch. |
| **Technical execution** | Deterministic canonicalization/digests, strict public-key and URL validation, unknown-field rejection, fail-closed WorkSeal verification, immutable returned plans, and focused tests. | Re-check the SDK/template pins immediately before submission; provider interfaces can change. |
| **Originality / taste** | “Proof-to-launch”: launch metadata commits to a verified work result and acceptance receipt, linking verifiable delivery to asset creation rather than launching from an unsupported narrative. | Demonstrate one compelling real task/result story in the video instead of presenting only protocol plumbing. |
| **Impact potential** | The same primitive can support bounty work, procurement, research tasks, agent services, and other deliverables where a launch or liquidity event should be tied to evidence. | Tighten the first customer wedge and explain who pays, why now, and why a launch is better than a plain receipt for that segment. |
| **Traction / volume** | No mainnet usage or trading volume is claimed by this source packet. | This is the largest competitive gap. If the owner chooses to perform authorized live validation, show real users or a real devnet/mainnet launch and report only provider-confirmed activity. |

## 2–3 minute presentation outline

**0:00–0:20 — Hook**

“Work gets paid and projects launch on claims that are hard to verify. WorkSeal binds the exact task, result generation, verifier and signed acceptance into one deterministic receipt — then turns a verified acceptance into a Meteora DBC launch plan.”

**0:20–0:55 — Show the problem**

Show a WorkSeal task/result pair and the acceptance receipt. Point out that replaying an old receipt against a newer result is rejected and that settlement binds the signed acceptance envelope.

**0:55–1:40 — Show Meteora as the launch primitive**

Run the local verification and DBC-plan generation flow. Highlight:

1. the required `PASS` gate;
2. the bound result/acceptance digests;
3. the curve and fee configuration;
4. DAMM v2 graduation;
5. locked-liquidity distribution;
6. the explicit dry-run/devnet authority boundary.

**1:40–2:15 — Explain the wedge**

Lead with one concrete market: evidence-gated launches for agent work, bounty collectives, or project-specific funding where participants want to inspect what was actually accepted before liquidity is created.

**2:15–2:45 — Business / next step**

Explain the product path: reusable launch presets, proof-bound project pages, and eventually an onchain escrow/PDA path so settlement authority is enforced by chain state. If real provider usage exists by recording time, show it here; otherwise say plainly that the current carrier is a safe devnet/dry-run integration.

## Product-demo script

A demo should be reproducible from the public repository and should never imply a network write that did not happen.

1. Show a valid WorkSeal verified bundle.
2. Run:

   ```bash
   cd workseal
   node src/meteora_cli.mjs verified-workseal.json launch-input.json > meteora-plan.json
   ```

3. Inspect `meteora-plan.json`:
   - WorkSeal digests are present.
   - `provider.name` identifies Meteora DBC.
   - `studioConfig.dbcConfig` contains the curve/fee/migration/liquidity settings.
   - `execution.network` is `devnet`.
   - `execution.dryRunRequiredFirst` is `true`.
   - `execution.readyForExecution` and `writePerformed` are `false`.
4. Show the focused test command:

   ```bash
   node --test test/meteora_dbc.test.mjs
   ```

5. If an authorized owner later executes an official Invent devnet dry run, append that separate provider receipt to the demo. Do not edit the source packet to imply the dry run already happened.

## Paste-ready product description

**WorkSeal is evidence-gated settlement and proof-to-launch infrastructure for agent and contract work. It binds the exact task, delivered result generation, verifier policy and signed acceptance into deterministic receipts. For Meteora, WorkSeal converts a successfully verified acceptance into a Dynamic Bonding Curve launch plan whose public metadata commits to the accepted result. The current adapter configures a Meteora DBC curve, fee policy and DAMM v2 graduation path with permanently locked liquidity while remaining dry-run-first and fail-closed. The long-term product is a launch and settlement rail where participants can verify what work was actually accepted before funds or liquidity move.**

## Paste-ready “blockchains and tools” answer

- Solana
- Meteora Dynamic Bonding Curve
- Meteora DAMM v2 graduation path
- Meteora Invent workflow
- WorkSeal deterministic evidence/acceptance receipts
- Ed25519 verification in the existing WorkSeal receipt path

Only add wallet, RPC, mainnet, pool, swap, or volume claims if there is a separate provider-confirmed receipt for them.

## Go-to-market angle

Start with work markets where payment disputes and unverifiable completion are expensive: software bounties, agent freelancing, research/procurement micro-contracts, and communities funding a specific deliverable. WorkSeal gives buyers and participants a portable receipt for “what exactly passed.” The Meteora path extends that receipt into a launch primitive for projects that want liquidity or tokenized participation to be tied to accepted work rather than a bare promise.

A credible first distribution loop is:

1. issue a WorkSeal task with explicit acceptance policy;
2. publish the accepted result and receipt;
3. generate a proof-bound DBC launch plan;
4. let participants inspect the evidence before opting into the launch;
5. reuse successful DBC presets for later task/project launches.

Do not claim demand validation unless there are real users, interviews, wait-list entries, or transaction receipts to cite.

## Development-history disclosure

Colosseum requires disclosure of relevant pre-existing development. Repository history should make this easy to answer precisely instead of using a vague “built during the hackathon” statement.

Visible WorkSeal history in this repository:

- `2026-09-14T23:37:27Z` — first visible WorkSeal MVP commit: `99d3db4424c8212db33ef1dcc974253ae8543395`.
- `2026-09-14T23:53:00Z` — browser demo and GitHub evidence verifier.
- `2026-09-15T00:11:22Z` — Solana PDA/SPL escrow authority core.
- `2026-09-15T05:20:59Z` — Solana program-test escrow execution.
- `2026-09-16T12:29:44Z` — safer raw GitHub Actions evidence acquisition.
- `2026-10-08T10:41:40Z` — Meteora DBC proof-to-launch planner merged.

Suggested disclosure:

> WorkSeal's visible repository development begins on September 14, 2026. The core evidence-gated settlement MVP and Solana path were developed first; the Meteora DBC proof-to-launch integration was added on October 8, 2026. The repository history is public and should be treated as the authoritative development timeline.

If any WorkSeal work exists outside this repository or predates that first visible commit, disclose it too.

## Submission checklist

### Source/evidence that is ready

- [x] Public repository.
- [x] WorkSeal protocol/problem explanation.
- [x] Solana adapter and evidence-verification path.
- [x] Meteora DBC plan builder.
- [x] DAMM v2 graduation configuration.
- [x] Focused Meteora tests.
- [x] Public Meteora integration documentation.
- [x] Public commit history suitable for development-timeline disclosure.

### Human-owner / provider actions still required

- [ ] Confirm the current Colosseum account/team and that WorkSeal is the single product submission for that individual/team.
- [ ] Re-check current Colosseum and Superteam terms immediately before submitting.
- [ ] Fill the submission form and attach the correct repository.
- [ ] Record the 2–3 minute presentation video.
- [ ] Record the product demo video within the current portal limit.
- [ ] Supply team/background/location details and any required graphics.
- [ ] Provide truthful traction/demand evidence.
- [ ] If desired and authorized, run an official Meteora Invent devnet dry run and preserve its provider receipt.
- [ ] Submit separately to the Meteora Superteam sidetrack.
- [ ] Do not represent a Superteam application as a Colosseum submission, or vice versa.
- [ ] Do not claim mainnet usage, volume, award, or payment without provider-confirmed evidence.

## Current public references

- Meteora sidetrack: https://superteam.fun/earn/listing/meteora-dbc/
- Colosseum Crypto World's Fair: https://colosseum.com/worldsfair
- Colosseum hackathon FAQ: https://colosseum.com/hackathon
- Meteora DBC guide: https://docs.meteora.ag/developer-guides/dbc
- Meteora Invent: https://github.com/MeteoraAg/meteora-invent
- Meteora DBC SDK: https://github.com/MeteoraAg/dynamic-bonding-curve-sdk
