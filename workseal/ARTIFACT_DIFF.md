# WorkSeal artifact change report (read-only)

When a reviewer sees `ARTIFACT_CONTENT_MISMATCH`, the official WorkSeal verifier deliberately refuses acceptance, but does not explain *which* file changed. This independent report helps an operator compare the buyer's expected selected-file manifest with a separately captured observed manifest. It never creates an acceptance receipt or settlement plan.

## Compare captured manifests

From `workseal/` with Node 20+:

```bash
node src/artifact_manifest_cli.mjs manifest ./buyer-pinned-root README.md src/index.js > expected.json
node src/artifact_manifest_cli.mjs manifest ./verifier-controlled-delivery README.md src/index.js > observed.json
node src/artifact_diff_cli.mjs expected.json observed.json --markdown
```

The `manifest` command itself is Linux-only and refuses symlinks, hardlinks, swapped files, and out-of-bounds data. Both roots in this example must be immutable, verifier-controlled snapshots rather than a worker-writable checkout. Paths are examples; use the actual buyer-pinned selection. The diff command is pure offline manifest comparison and also works on previously retained JSON manifests. It returns exit 0 only for identical declarations, exit 1 when they differ, and exit 2 for malformed inputs. Compare includes missing and unexpected files **only if they are present/absent in separately captured manifest selections**: automatic extra-file discovery is intentionally not performed, and a missing required path makes the manifest-acquisition CLI fail closed rather than producing a misleading partial snapshot.

The output includes file path, expected/observed byte counts, SHA-256 values, exact sorted difference kinds, two manifest digests, and aggregate counts. JSON is the default; `--markdown` produces a reviewer-friendly offline report. Reports intentionally carry no file bytes, wallet keys, RPC calls or privileged provider requests.

## Authority boundary

Manifest JSON may be forged. A `SAME_DECLARATION` result is only a structural comparison, not proof of independently read bytes, authentic GitHub provider receipts, policy satisfaction, signed acceptance or actual payment. To establish the byte integrity needed by WorkSeal, the verifier must still call `verifyArtifactDelivery` with the buyer-pinned task/result and a trustworthy file root and then evaluate **every** task policy requirement. An opaque mismatch is never overridden by this diff.

This additive artifact does not change existing `artifact_manifest.mjs`, browser demo, escrow, SOL/SPL adapters, or Colosseum entry status.
