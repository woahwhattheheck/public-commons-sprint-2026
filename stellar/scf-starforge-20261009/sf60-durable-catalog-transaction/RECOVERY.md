# Recover a catalog effect without resubmitting it

The existing SF60 operator records admissions, revisions and signed withdrawals in its original append-only lifecycle. A local tool can lose its response after the writer commits. `workspace-recovery.mjs` joins a retained **original operator command** to that native history. It does not create a second catalog, operation store, signer, browser service, retry loop or payment engine.

## Native command to inspect

Retain the exact `operation` and `input` passed to `requestCatalogOperator`. The command may contain the original `schema` and `requestId`, but neither is needed to match a catalog effect. Supported operations are `admit`, `apply-withdrawal`, and the original signed `apply-batch` added in PR922.

An admission command has `operation: "admit"` and the unchanged original input fields: `sellerId`, `sequence`, `sourceURL`, `observedAt`, `sourceBase64`, and ordered `proofs`. A withdrawal command has `operation: "apply-withdrawal"` and `input: {envelope}`. For a signed batch retain the original `input.batch` and the original plan-binding fields. Do not reconstruct source bytes from a displayed, sanitized catalog row, refresh observation times, edit the received proofs, or replace the command with the returned receipt. Those are different inputs.

The current operator must already be running. On Linux/POSIX with Node22+, from this existing SF60 directory:

```sh
node recover-cli.mjs \
  --directory /private/catalog \
  --command /private/retained-original-command.json \
  --out /private/catalog-recovery.json \
  --html /private/catalog-recovery.html
```

The command resolves the original owned Unix socket or owned loopback descriptor through `requestCatalogOperator`. It never accepts a control credential from the command file, prints one, exports one, or changes the writer's permissions. The JSON and optional self-contained neutral HTML report are create-only mode0600 files. Existing output files are not overwritten. The original source file is read once with a size-checked fixed allocation. No external network, dependencies, browser process, hosted Actions or signing call is required.

## What a result establishes

`observed-current` means the exact expected catalog effect is present and is the current lifecycle event. `observed-superseded` means it is present in history, but a later revision or withdrawal is now current. These observations survive the original seller proof's expiry: recovery inspects already committed history instead of trying to admit an expired proof again.

`sequence-conflict` means the sequence exists with different native content, provenance or operation type. `identity-conflict` means the seller or signer is different. `not-observed` means the effect was not present in the returned snapshot; it does **not** prove that an in-flight request failed or cannot finish. `unavailable` preserves a native read failure without inventing an outcome.

Admission matching uses the original parser's catalog key, native seller and signer, exact sequence, **original source-byte SHA256**, source URL, signed-export provenance and original observation time. Withdrawal matching uses the original SF95 normalized signed-envelope digest, seller/signer, sequence, source URL, reason and the native `retiredBy` event. Current metadata alone is insufficient. A matching effect is not a new verification of a seller key, proof of a wallet payment, or attribution to a particular socket request.

A batch deduplicates resource-key reads while preserving every input row and its sequence. It reports whether all, some or none of the individual effects are observed. Seeing all members does not establish which request wrote them or prove an atomic batch boundary; they could have been admitted individually. Original saved native receipts and the journal remain authoritative for that distinction.

The engine reads status, the relevant lookup/history pairs, and final status once. `coherentSnapshot` is true only if all of those reads report the same journal head. A change during the read is reported rather than hidden by polling. Read concurrency defaults to four and can be set from one to eight. A single key with multiple batch revisions is fetched once. Native read count, effect count and zero mutation/signature/payment counts are included in the result.

## Existing browser and worker integration

```js
import { reconcileCatalogOperation } from './workspace-recovery.mjs';

const recovery = await reconcileCatalogOperation({
  directory: catalogDirectory,
  operation: retainedCommand.operation,
  input: retainedCommand.input,
  expectedPolicySha256: retainedReview.policySha256 ?? null,
});
// Store/display recovery alongside the original local response/unknown state.
// Do not replace the original command, submit it here, or invent a response.
```

A workspace that already performs the exact native lookup/history reads can avoid repeating them:

```js
import { catalogOperationIntents, matchCatalogEffect } from './workspace-recovery.mjs';

const intents = catalogOperationIntents(retainedCommand);
const effects = intents.map(intent => matchCatalogEffect(intent, {
  lookup: nativeLookups.get(intent.catalogKey),
  history: nativeHistories.get(intent.catalogKey),
}));
```

Only pass observations fetched from the original private operator, not browser-supplied state or copied claims. The pure matcher is a projection of those inputs, not an independent storage or authenticity verifier. Native `history` is the whole response `{journalHead,history:[...]}`, not just its inner array. Keep mutation requests and recovery reads on separate routes/actions; neither this helper nor the CLI automatically changes a local operation state.

`renderRecoveryReport` is exported from `recover-cli.mjs` for the chosen workspace's existing download route. It renders retained native evidence as inert, escaped HTML with no script, remote images or remote styles. The JSON companion retains every member result, including conflicts and unavailable reads.

## Executed integration

A focused cloud-Linux journey used the actual original SF50 signing/verifying functions, SF73 admission, SF60 writer/HTTP control/discovery, SF95 signed withdrawal and original native lifecycle. It committed one offer, revised it, withdrew it, then recovered exact current and superseded effects, a batch's individual members, conflicting sequence/provenance, and an absent effect. The recovery reads did not increase the native journal's three committed operations. Local development asset/recipient strings were deliberately unspendable; no ledger payment was attempted.

The separate candidate browser was exercised offline against recorded native responses because managed Chromium rejected loopback navigation. That browser is not introduced by this change; the existing workspace owners retain the one browser product. This module is its complementary recovery implementation.
