# WorkSeal × Meteora DBC launch planner

This source-only adapter turns a **successfully verified WorkSeal acceptance** into a deterministic configuration packet for Meteora Invent's Dynamic Bonding Curve (DBC) workflow.

The product idea is proof-to-launch: a token launch can commit its public metadata to the exact accepted work result and receipt rather than relying on an unverified claim. Meteora DBC is central to the launch path: the packet selects a market-cap curve, 1% bonding-curve fee, DAMM v2 graduation, and a 45/45/5/5 post-graduation liquidity split with 10% permanently locked.

## Safety and authority boundary

The planner:

- accepts only the `PASS` result returned by WorkSeal's existing `verifyBrowserBundle()`;
- binds task, result, evidence, acceptance, and settlement-intent digests into the launch plan;
- emits the current Meteora Invent DBC config shape pinned to `@meteora-ag/dynamic-bonding-curve-sdk@1.5.11` and the official template blob used during implementation;
- hard-codes devnet, `dryRun: true`, an unset local keypair path, and `writePerformed: false`;
- performs no RPC request, wallet operation, transaction signing, pool/config creation, swap, migration, account registration, provider submission, social post, or funds action.

Source publication does **not** establish Colosseum registration/submission, Superteam side-track submission, eligibility, award, payment, or mainnet deployment. Those remain explicit human-owner actions. Colosseum permits one product submission per team/individual and requires pre-existing development disclosure; the existing WorkSeal owner retains that submission custody.

## Usage

1. Verify a real browser bundle with `verifyBrowserBundle()` from `web/core.mjs` and save its returned result as `verified-workseal.json`.
2. Prepare `launch-input.json` with public launch metadata and public Solana addresses:

```json
{
  "name": "WorkSeal Proof Launch",
  "symbol": "SEAL",
  "description": "A proof-bound launch whose metadata commits to an accepted WorkSeal result.",
  "website": "https://example.com/workseal",
  "creator": "<PUBLIC_SOLANA_ADDRESS>",
  "feeClaimer": "<PUBLIC_SOLANA_ADDRESS>",
  "leftoverReceiver": "<PUBLIC_SOLANA_ADDRESS>",
  "initialMarketCap": 20,
  "migrationMarketCap": 600
}
```

3. Generate the unsigned plan:

```bash
node src/meteora_cli.mjs verified-workseal.json launch-input.json > meteora-plan.json
```

4. A human owner must recheck current competition eligibility, disclose all pre-existing work, set a local keypair path outside source control, and inspect the official Meteora Invent dry run before separately approving any devnet transaction. Mainnet is outside this plan.

## Focused validation

```bash
node --test test/meteora_dbc.test.mjs
```

The tests cover deterministic output, WorkSeal fail-closed behavior, curve/input validation, DAMM v2 liquidity-lock rules, and absence of signing/payment claims.

## Current official references

- https://superteam.fun/earn/listing/meteora-dbc/
- https://docs.meteora.ag/developer-guides/dbc
- https://github.com/MeteoraAg/meteora-invent
- https://github.com/MeteoraAg/dynamic-bonding-curve-sdk
- https://colosseum.com/hackathon
