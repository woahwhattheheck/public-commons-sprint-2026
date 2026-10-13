# Read-only Strata commissioning receiver

## Purpose and source boundary

This is a complete additive receiver for BootNodeDev/strata-vault-kit at 400754230a3fecaa69385687ba8457f1c2250d13. It receives the operator's explicit public selection, observes the native network and produces a full portable review. It changes no vault, token, oracle, identity, compliance, wallet, signer, account or transaction. It does not call a deploy, restore, grant, sign, send, or funding method. The original collector/model/history UI and upstream contract/admin/multisig writers remain the owners of those products.

The issuer's exact SCF45 page is https://communityfund.stellar.org/submissions/recjET3bFTLREmGE4 . This receiver supports a reproducible outside-engineer handover. Its output is not a declaration that a tranche, audit, deployment, grant acceptance or payment has occurred.

## Installation in the maintained source

Copy the complete scripts/commissioning directory into the original full maintained repository, retaining the original source and license. Run the already-selected repository's normal dependency installation: it pins @stellar/stellar-sdk 16.1.0. The receiver checks that actual installed SDK version, and verifies all60 unchanged contract/crate/Cargo/harness dependency source members in SOURCE_ANCHORS.json before capture. It does not need generated app-lib client files; it uses the actual native contract specs through the original SDK Client.from API. The frozen receiver resolves the selected repository through createRequire and consumes the SDK16.1.0 declared require exports directly; it does not depend on synthesized named exports from dynamically importing CommonJS.

Use the original operator's POSIX Node environment (Node22 or later), including the same selected Linux/WSL environment if the host is Windows. Receiving output requires private0700 directories and0600 files. No hosted service, new account, controller, wallet or system daemon is introduced. Do not publish original scripts/harness/deployed.*.json: the actual Deployment includes account.secret.

All original source files are preserved. No root package script or native signing flow is replaced. One original producer owns any real receiving run.

## Explicit public selection

Start with selection.example.json. Its six contract addresses and testnet network are sourced from the immutable environments.toml staging declaration; it is labeled as a source example, not a received deployment. The separate development oracle constructor defaults are not selected as staging expectations. The example therefore leaves expected empty until the original operator supplies its actual intended policy. Network URLs, network passphrase, operation ID, six contract addresses and all intended settings are explicit.

- expected maps fixed getter keys to exact expected values. Native wide integers use decimal strings. Null is a real expected null; absence means NOT_SPECIFIED.
- roles states the complete intended membership for any of the seven supported native enumerable roles: vault manager/treasury/guardian, oracle attester/guardian and share-token manager/compliance. Unspecified role policies remain NOT_SPECIFIED.
- accounts states complete classic-account signer policies and low/medium/high thresholds. Every signer type is retained. Do not invent a quorum policy. The receiver never converts a failed read into signs-alone.
- bootstrapAccounts lists only actual known bootstrap keys to inspect. An absent key proves absence only from the explicitly observed native surface; unknown contract accounts, unrepresented roles and other delegation are not inferred.
- executables maps a selected contract to an actual expected WASM SHA256, or stellar-asset for a built-in asset. Empty means the expected executable is unknown. The native before/after instance XDR and executable identities are retained. Observing a code hash does not prove correspondence with source without an actual reproducible-build artifact.
- evidence contains actual source/approval/audit/deployment/transaction references and optional real SHA256 values. It is descriptive evidence, not fetched or asserted as verified by this receiver.

Current identity-verifier and compliance internal admins are unexposed by their public traits; those authority/enforcement gaps remain explicit UNKNOWN rows, not intended-key substitutions.

The receiver validates both RPC getNetwork.passphrase and Horizon root.network_passphrase before any contract/account reads. The two URLs cannot include credentials, query tokens or fragments. Authenticated private provider endpoints are outside this public-source receiver; use the original approved transport integration rather than embedding credentials in a report.

## Secret-free original Deployment projection

This explicit command reads an already-existing original Deployment privately and emits only its defined public fields. It does not derive or change intended authority settings.

    node scripts/commissioning/cli.mjs project \
      --deployment scripts/harness/deployed.testnet.json \
      --output /private/strata-receiving/public-deployment.json

The output parent must already exist as a private directory. Only network, deployedAt, ledger, asset identifiers, contract IDs and accounts.*.public are copied. Original secret values, extra fields and unknown nested objects are omitted. Review and use those real public identifiers in the selection; never paste the whole Deployment.

## Original receiving operation

Use a fresh explicit operation ID for a new observation course. The output parent must exist. The same operation and selection resume the same directory.

For the maintained complete296 servicing application at public merge fc47a578a02a50abfd9543f66c006983d8dd6376, these files join under application/scripts/commissioning. All six example addresses, the RPC URL and network passphrase match its scripts/servicing/staging-binding.json. The same original STRATA-SERVICING-2769-20261013 receiving operator adds this read-only step inside its existing operation directory, for example --operation STRATA-SERVICING-2769-20261013.commissioning and --output /original/course/commissioning. Preserve the existing servicing archive/course unchanged and use the same selected repository and installed SDK. A commissioning result is a separate observation interval inside that original course; it does not rewrite its servicing input or claim an atomic joint snapshot.

    node scripts/commissioning/cli.mjs capture \
      --selection /private/strata-receiving/selection.json \
      --operation strata-original-commissioning-20261013 \
      --repo-root /original/strata-vault-kit \
      --output /private/strata-receiving/strata-original-commissioning-20261013

Before the first request or native invocation, all five actual executable/source-anchor bodies are frozen together in .receiver-source.json, then materialized under .receiver with complete hash checks. Every later capture, render or verify routes into that retained original receiver, even when the installed product advances. An interrupted materialization recovers from the complete retained envelope. Different following implementations use a separate receiving operation. The private request is then retained. Each attempted read gets its own retained invocation. Every returned observation is published atomically without replacing an accepted different body. If the process dies before an observation is accepted, the next run may repeat that read and records a fresh attempt/time. It is read-only; no transaction is replayed. Accepted observations are reused exactly. The resulting capture explicitly spans their full ledger/time range and is not an atomic snapshot.

Role enumeration retains count-before, every member, count-after and exact errors. Missing/oversized/changed/duplicate membership remains incomplete. The bound is256 members per selected role and1024 discovered classic accounts; exceeding a bound stops or yields an explicit incomplete record rather than truncating a successful result.

Concurrent invocations cannot overwrite accepted request/observation/output bytes. A different accepted postimage causes a precise conflict. Resume the original operation to receive the already-accepted evidence; do not delete it or silently choose a later observation. To intentionally observe changed network state, use a new operation directory and retain the predecessor.

Native SDK simulation restore/error/unreadable outcomes retain their native evidence. No automatic restore or submission is issued. All wide native integers and XDR retain precision. The complete record bound is16MiB and full capture/report member bound64MiB. An oversized result is refused before it is accepted as a successful file; the original inputs and completed observations remain available.

## Reopen without new network activity

A complete result is retained before report publication. These commands never construct an RPC/Horizon client or repeat native observations:

    node scripts/commissioning/cli.mjs render --output /private/strata-receiving/strata-original-commissioning-20261013
    node scripts/commissioning/cli.mjs verify --output /private/strata-receiving/strata-original-commissioning-20261013

render restores missing exact report artifacts from complete.json using the retained original renderer. It does not depend on the current source checkout or an installed SDK. ARTIFACTS.json is frozen before member publication. Existing different bytes are preserved and cause a conflict. The completion time is the original last accepted observation time, unchanged by export retries. verify recomputes all four complete members and their full manifest from the retained original renderer, then compares the actual bytes; changing a manifest together with a report cannot satisfy it.

The report directory contains:

1. capture.json: the whole request, native observations, role collections, source anchors, receiver source hashes, network/ledger bounds and limitations.
2. assessment.json: every selected comparison, UNKNOWN/NOT_SPECIFIED/DIFFERENT result and evidence reference.
3. report.html: complete offline review with search, status filtering, full original-observation inspectors and exact JSON download.
4. settings.csv: every assessment row. Leading formula markers are escaped for spreadsheet opening; capture.json remains the exact data.
5. ARTIFACTS.json: identities of the four deliverables.

No source rows, errors, signer types or members are intentionally omitted from the portable capture.

## Interpretation and current protocol differences

MATCH only means the selected observed value matched its explicit expected value. SELECTED_OBSERVATIONS_MATCH is not a grant acceptance. The current oracle uses direct18-decimal per-share pricing and no proof-reference field. Redemptions use epoch fulfillment pricing, not the issuer's historical claim-time/FIFO wording. The source's identity/compliance contracts are testnet stubs, and production/audit/SEP40/monitoring evidence remains separately owned. Do not use this report to erase those distinctions or to claim production readiness.

The native executable read comes from the current endpoint and may differ from the reviewed source. Both identities remain visible. Even equal before/after code or role counts do not make observations atomic.

## Producing-seat receiving and rendered inspection

The original equipped operator runs this exact selected source and original receiving operation. Before presenting the outgoing report as ready, the producer must personally open and VIEW the actual report at screenshare and narrow widths; operate search/status controls, expanded evidence and the complete JSON download; inspect populated, empty and error/incomplete examples; reopen all generated attachments normally and run the actual artifact verification. Fix observed presentation defects in the same source. Source/V8 exercises are separately recorded and do not substitute for native or rendered evidence.

There was no native run, signer operation, customer data import, actual rendered inspection or customer contact in this source delivery. Retain the actual producing-seat receipt when available.
