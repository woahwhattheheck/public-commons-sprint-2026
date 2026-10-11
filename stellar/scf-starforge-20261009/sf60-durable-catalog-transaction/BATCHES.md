# Signed batches in the original catalog workspace

The **Signed batch** tab completes bulk catalog operation in the same workspace described in [WORKSPACE.md](WORKSPACE.md). It calls the original `preview-batch` and `apply-batch` commands, uses the existing operation store, and reuses [native effect recovery](RECOVERY.md). There is no second importer, catalog writer, signing key store, or payment engine.

## Open and receive

Run the original catalog operator with its actual seller policy, then launch `workspace.mjs` with the catalog directory and a separate private workspace state directory. Open the private launch URL locally. Existing individual offer, withdrawal, comparison, and recovery functions remain available.

In **Signed batch**, select one of the original signed-batch JSON documents, a retained native `apply-batch` command, or the original CLI `stellar-forge.catalog-signed-batch-files/v1` manifest. A manifest contains the same six fields per admission used by `operator-cli.mjs`: `sellerId`, `sequence`, `sourceURL`, `observedAt`, `entry`, and `proofs`.

For a file manifest, also select the referenced declaration/proof files or their containing folder. Only referenced files are read and uploaded; the rest of a selected folder is ignored. Relative references must resolve uniquely within the selection. Absolute paths, parent traversal and ambiguous filenames cannot be resolved by the browser; use the original CLI or an already prepared signed-batch JSON for those cases. No local filesystem path is sent to the server. The original declaration bytes, observation time, admission order, and ordered public proofs are retained unchanged. Never select private keys.

The original limit is 1–1,000 admissions within an 8 MiB native command. Each declaration is at most 64 KiB and each proofs file at most 384 KiB. The browser is not a signer and does not refresh expired proofs.

## Review, then apply

**Verify and review batch** calls the running original operator's proof-verifying preview. Its native seller policy, origin ownership, original source, sequence and signature checks apply to every member. A preview failure leaves the catalog unchanged. A successful review saves the original batch, exact native plan, catalog-head binding, policy digest and proof expiry in the existing private operation record.

The review shows the original ordered before/after projections, exact atomic amount strings and replay/change counts. Same-key revisions remain in their original order. Filter or page through groups of 20 members; expand original declarations and proofs only where needed. The command bar stays above the member list. Full command export retains every member regardless of the current filter.

**Submit reviewed operation** enters the workspace's existing durable send path once. The original writer rechecks every proof and its expiry, policy, batch digest, plan and journal head before applying the original atomic transaction. A concurrent write can make the plan stale. **Prepare fresh batch review** explicitly creates a new native preview from the same received inputs; it does not submit and does not renew proofs. Supply fresh seller material when the original proofs have expired.

## Recover and export

Reopening an operation or pressing Submit on an already-sent record never resends it. **Reconcile & save observation** reads the original lifecycle and preserves the recorded command phase and original receipt. It distinguishes current or superseded exact effects, conflicts, absent effects and unavailable reads for every batch member. Same-key reads are shared. The result reports whether the reads observed one coherent catalog head.

Matching all members does not attribute them to a particular socket request or prove an atomic commit boundary. The retained original native receipt is authoritative for that distinction. An absent match does not automatically mean an in-flight command failed. No recovery action retries, signs, pays, or silently promotes the recorded outcome.

**Export original command** downloads a document accepted by the maintained CLI:

```sh
node operator-cli.mjs recover --directory /private/catalog \
  --command /private/downloaded-command.json \
  --out /private/recovery.json --html /private/recovery.html
```

**Export native batch review** and **Export batch recovery** download self-contained inert HTML from saved native results. They do not run another catalog command. Browser downloads follow the browser/OS download permissions; move them to private storage. The CLI's create-only outputs and workspace records use mode0600. A workspace restart reloads the original inputs, plans, outcomes and saved recovery without a new catalog mutation.

## Execution exercised

The composed original workspace and writer completed a cloud-Linux journey with 1,000 signed members across two independently pinned seller origins, ordered revisions of the same key, invalid-signature rejection, stale-head rejection, original atomic apply, exact lifecycle recovery, export and full writer/workspace restart. The journal contained 1,002 catalog operations including the two preceding admissions; recovery did not increase it. Existing individual reconciliation remained working. No ledger payment or hosted Actions job was involved.

Production browser file intake, filtering, pagination, exact amount/declaration display, command and HTML downloads, and desktop/mobile layouts were exercised separately against those captured native results. Managed Chromium blocked loopback navigation, so this was an offline browser check, not a claim of browser-to-daemon execution.
