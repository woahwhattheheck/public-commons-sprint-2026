# Meteora DBC Preset Studio

A working **unsigned** launch-configuration workbench with the official Meteora Dynamic Bonding Curve SDK (package pinned to version 1.5.13). This is a complementary developer-tooling candidate to the existing WorkSeal → DBC proof-to-launch bridge, which has a different focus on verified work receipts.

The sponsor's Crypto World's Fair sidetrack explicitly names curve/fee experimentation, reusable presets and tooling as desired outcomes, with **20,000 USDC total advertised conditional prizes**. It also values depth of live Meteora integration and mainnet traction, neither of which is claimed here.

## Launch locally

Node.js 22+ is required. Official SDK must be installed first:

    npm install
    npm start

Visit http://127.0.0.1:4179. To inspect an SDK build without the browser:

    npm run inspect -- community-launch
    npm run compare

For one focused dependency-free input-validation check:

    npm run test:focused

No broad test suite is required or launched automatically. The focused check only validates the workbench editor/economic input boundary; it does not establish a successful SDK installation, real on-chain behavior, hosted deployment or prize entry.

## What is implemented

- Three editable launch examples with USDC quote (6 decimals), SPL token (6 decimals), immutable mint authority, no leftover supply and no vesting.
- Genuine first-party buildCurveWithMarketCap(config) math and typed fee, distribution, activation and migration enums. We do not reconstruct or approximate Meteora's pricing formulas.
- DAMM v2 graduation, 100-bps fixed migration fee option, linear/static base-fee scheduling and dynamically balanced LP share allocation.
- Local browser configuration controls, input bounds, economic tradeoff messages, actual SDK ConfigParameters in readable JSON, migration quote threshold in atomic USDC, and a deterministic SHA-256 digest.
- Unsigned JSON export; the program binds by default to 127.0.0.1 and accepts no wallet secret or trading instruction. No chain RPC, wallet signing, mint creation, liquidity mutation, network probing, submission or payment calls exist.

## Limitations and authority

This app is a source-stage developer tool, not production financial advice. A config is **not** a trade instruction or an on-chain created pool. The numerical examples are not promises of price, valuation, profits, cash proceeds, token rights or legal eligibility. A real launch requires compliance/issuer/custody checks where applicable, actual SDK/validator dry-runs, independent security review and explicit operator/signer approvals.

Historical WorkSeal launch plan is already in this repository; Preset Studio is an independent economic inspection surface and does not replace or alter WorkSeal evidence invariants.

Mainnet adoption, judge approval, an official Superteam submission/Colosseum registration, eligibility, awards and payment are all **unverified** by this source release.

Sources (inspected October 9, 2026):
- https://superteam.fun/earn/listing/meteora-dbc
- https://docs.meteora.ag/core-products/dbc/what-is-dbc
- https://github.com/MeteoraAg/dynamic-bonding-curve-sdk
