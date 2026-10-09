# WorkSeal real-byte artifact judge demonstration

This offline judge demonstration uses the already merged artifact-manifest verifier. It reads actual files in separate buyer-reference and delivery directories, pins the buyer's expected digest, and signs an existing WorkSeal acceptance for precisely one delivered result generation.

## Run

Requires Node 20+ on Linux and no additional dependencies. From the workseal directory, run:

    node src/artifact_judge_demo.mjs > artifact-judge-report.json

The command creates disposable synthetic buyer-reference and delivery directories, writes two deliberately synthetic selected files, reads buyer bytes through buildArtifactManifest, and makes the buyer task require that exact manifest. It then calls verifyArtifactDelivery on the actual delivery bytes and retains the returned check in a generation-1 result.

Existing WorkSeal APIs create, Ed25519-sign, and validate an ACCEPT receipt covering that result. They derive an unsigned settlement intent bound to the signed acceptance. No real money or external authority is involved.

The program then changes the delivered dist/package.bin on disk and invokes the SAME verifier with the ORIGINAL expected manifest, task, result, generation and signing authority. The required response is ARTIFACT_CONTENT_MISMATCH; an unexpected successful tamper verification causes the CLI to exit nonzero.

The resulting JSON includes the buyer-pinned manifest, both sets of synthetic file bytes encoded in base64, the actual successful verifier result, the public Ed25519 key, signed receipt, unsigned intent, typed tamper rejection and canonical digests. The original temporary filesystem is removed at exit, so reproduce the CLI to independently observe file reads.

## Limitations

The existing browser presenter is GitHub-Actions-only and must not be interpreted as byte-verification proof. A richer browser import/display integration was attempted, but the publication action was blocked before GitHub; it is not included in this source delivery.

The funding reference, addresses and amount are simulation inputs. A signed offline receipt does not establish real funding, payment, a trusted independent external buyer, deployed escrow, artifact semantic correctness, contest entry or award. The program performs no provider calls, wallet writes or external uploads.

Files: src/artifact_judge_demo.mjs, src/artifact_manifest.mjs, src/protocol.mjs and ARTIFACT_MANIFEST.md.