# Local artifact-manifest evidence

WorkSeal can now verify actual delivered file bytes against an expected manifest pinned in the buyer's task. This complements GitHub Actions evidence: a successful workflow alone is not proof that the delivered files match the agreed artifacts.

## Run the complete local path

Requires Node 20+ on Linux, with no third-party packages. Run from `workseal/`.

```sh
# Buyer/verifier: capture an independently trusted reference, selecting files explicitly.
node src/artifact_manifest_cli.mjs manifest ./reference dist/package.bin report.json > expected.json
node src/artifact_manifest_cli.mjs policy expected.json

# Put the returned requirement in task.json acceptancePolicy.requirements BEFORE funding.
# Retain the expected manifest independently; do not replace it with worker-supplied hashes.

# Worker/verifier: prepare an unsigned result only after reading the delivered files.
node src/artifact_manifest_cli.mjs prepare ./delivery expected.json task.json 1 > result.json

# Independent verifier: re-read the delivered bytes and bind its check to that result.
node src/artifact_manifest_cli.mjs verify ./delivery expected.json task.json result.json > verification.json
```

`manifest` emits the manifest itself. `policy` emits its digest and the exact requirement. `prepare` emits a `workseal-result/v1` record; it does not commit it to state, sign anything, or approve all task requirements. `verify` emits a `workseal-artifact-verification/v1` record with the standard `{id, ok, evidenceDigest}` check accepted by the existing `makeAcceptanceReceipt` API. Failures exit nonzero and print an error to stderr, not a successful result to stdout.

For tasks that also require GitHub Actions or other checks, retain all required evidence in the result and evaluate every requirement independently before signing acceptance. The existing receipt builder requires every policy requirement; this adapter does not weaken that rule. The existing browser demo remains GitHub-Actions-only and is not extended to claim support for this policy.

## Data contract

```json
{
  "schema": "workseal-artifact-manifest/v1",
  "files": [
    {"path": "empty.bin", "bytes": 0, "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}
  ]
}
```

The normalized manifest contains only `schema` and `files`; entries contain only `path`, `bytes`, and `sha256`. Files are sorted by ASCII path before the existing WorkSeal canonical-JSON SHA-256 is calculated. Array order does not change the manifest digest. Byte counts are nonnegative safe integers. Empty files are valid. Unknown fields, duplicate paths and case aliases fail.

The buyer's requirement is exactly:

```text
id: artifact-manifest
description: workseal-artifact-manifest/v1:sha256:<normalized-manifest-digest>
```

The evidence declaration binds that manifest digest to the normalized task digest, worker id, result generation, file count, and total bytes. Verification requires the result's `artifactDigest` and retained evidence digest to match, then hashes the actual selected files and compares their normalized manifest. An old declaration cannot be reused simply by incrementing the result generation. A substituted expected manifest cannot be used under the original task policy.

`artifactEvidence()` only constructs a deterministic declaration; it does **not** read files or establish delivery. A trusted verifier must run `verifyArtifactDelivery()` itself before using the returned check. The existing receipt-signing and state-transition APIs remain responsible for signed acceptance and generation/state authority.

## Filesystem and resource boundary

The root must be an immutable, verifier-controlled directory or snapshot. Do not verify a live directory concurrently writable by an untrusted worker. Node's pathname APIs do not provide a directory-descriptor-relative, race-free sandbox: no-follow opens, component checks, and file identity checks are defense in depth, not a substitute for an isolated snapshot.

Only explicitly selected regular files are read. There is no recursive scan, execution, network request, upload, or credential discovery. Unlisted files are outside the manifest and are not verified. Use a dedicated delivery directory; its contents must remain unchanged through verification and acceptance.

Paths use portable ASCII segments, each starting with a letter or digit, followed by letters, digits, underscores, hyphens or dots. Traversal, absolute paths, backslashes, spaces, hidden dot-prefixed names, trailing dots, Windows device aliases, symbolic links and hard-linked files are rejected. If a delivery uses unsupported names, package it into a regular archive and verify the archive bytes; this adapter does not extract or execute it.

Acquisition uses Linux `O_NOFOLLOW` and nonblocking read-only opens, validates regular-file descriptors, streams through a 64 KiB buffer, and compares file identity, size and modification metadata around each read. Handles close on errors and cancellation. Limits are 256 files, 256 MiB per file, and 1 GiB total; API callers may lower them. JSON CLI inputs are capped at 2 MiB. These limits describe inputs, not test counts.

A passing artifact check proves equality with the pinned expected bytes under the snapshot assumption. It does not establish the reference's semantic correctness, provenance, lack of malware, successful execution, payment eligibility, or an externally trusted verifier identity. No keys, signatures, wallet instructions, provider registration, or financial writes are produced. Normal filesystem access-time updates may still occur. Outputs explicitly retain `writePerformed: false` and `externalAuthorityGranted: false` for external state/financial authority.

## Focused executable evidence

```sh
node --test test/artifact_manifest.test.mjs
```

Three focused cases cover actual bytes through the existing signed-acceptance/settlement-intent path, changed bytes and stale/swap bindings, and real CLI execution plus path/link/limit boundaries. They run without network access or third-party dependencies. No hosted CI, Solana deployment, contest submission, or award is asserted by these local checks.
