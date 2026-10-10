# SF46 post-merge source snapshot — frozen October 10, 2026

**Purpose.** The original PR523 SF46 facade shipped with eight immutable initial source pins. Since then independent original protocol owners have shipped repairs. Its original `pins.json` is a historical release record; **do not overwrite it or treat pin drift as a successful integration**. This additive review records the eight first-party Git blob identifiers observed at *one specific public `main` commit* and makes that point reproducible.

**Pinned public source:** `woahwhattheheck/public-commons-sprint-2026@a84c561967056682eef810455227b7db18d1461b` (native authenticated GitHub ref read). Each file was separately fetched by that exact commit ref and its provider-reported Git blob SHA was recorded. The original source path and facade export lists are unchanged.

| Facade module | Initial source blob | Frozen source blob | Snapshot state |
| --- | --- | --- | --- |
| catalog | `bcb87cb3439a` | `f671580fc249` | changed; review merged upstream fixes |
| mcp_broker | `94c89eabd871` | `eb9bca441ecc` | changed; review broker behavior |
| buyer | `78aca43bfd17` | `7fe5cf4f8000` | changed; review buyer transport |
| recovery | `08724453a7d7` | same | unchanged |
| metering | `7be2be721e2b` | same | unchanged |
| conformance | `cc69a6c492c4` | same | unchanged |
| receipt | `03fc89a93052` | same | unchanged at frozen commit |
| seller_proof | `d8a38b4be830` | `323794bfb1f6` | changed; review seller proof bounds |

## Reproduce from first-party source, not a miniature simulator

At the repository root, use an actual Git checkout at the **frozen commit** (for example a separate `git worktree`, without moving a working contributor's branch). No network, signer, settlement, registration or hosted CI is performed by the check.

```sh
node stellar/scf-starforge-20261009/sf46-release/snapshot-preflight.mjs
node --test stellar/scf-starforge-20261009/sf46-release/test/source-snapshot.test.mjs
```

The CLI calls the original `assessRelease()` with `strictPins: true` and the new versioned snapshot; it checks actual local source Git blobs, facade exports, original imports and empty/denied constructors. Run it against the frozen source checkout, not arbitrary moving `main`. It **fails** if the installed source differs, any import/contract fails, or a module is missing. `--root /path/to/frozen/source` permits checks from a different checkout. Run the old `preflight.mjs --strict-pins` for historical PR523 comparison.

The manifest comparator rejects any unreviewed source-path, ID or API-list change; it does not assert semantic equivalence from matching export names. After source owners review the four changed implementations, run the actual cross-module runtime acceptance and existing Muse first-party protocol corpus. Current modules may move again, and require another deliberate versioned snapshot rather than silently advancing this one.

**Grant-evidence boundary.** This proves a reproducible public source point, not a provider-accepted testnet payment, authorized seller onboarding, production readiness, qualified SCF #46 invitation, application, customer interest, award or collected revenue. Preserve existing seller/buyer/SCF operator custody. No paid Actions or wallet activity.
