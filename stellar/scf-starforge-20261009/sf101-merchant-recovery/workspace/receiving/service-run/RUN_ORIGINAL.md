# Original SCF managed-fleet recovery — complete receiving package

This package supplies the complete original application and both producing commands for **SCF-MANAGED-FLEET-RECOVERY-RECEIVING-7A2F-20261012**. Preserve one original case and its service account through native recovery and operator receiving. The existing SCF/Muse thread carries current execution custody.

## Source edition

| Component | Original selection |
| --- | --- |
| Repository | woahwhattheheck/public-commons-sprint-2026 |
| Complete application | 986bc2379e892ee721de30a0b88701461a0dffd6 |
| Source index | babfe5b88df02b9d1c36da3004305cc9140dbe2b |
| Index SHA-256 | 2e8b1db7664eb8064dca547c7e091decee7f985794c4538fa76317c343783010 |
| Complete source | 1,685 files, 24,937,462 UTF-8 bytes in 32 disjoint parts |
| Standalone recovery journey | 76e306e88e1654c66afb2ec225853badeb64c3cf |
| Journey SHA-256 | b4e019eaf76f914d88591940f12ba63c4955c485c76ba761bc8f422d4bb4a4e2 |
| Operator receiver | stellar/scf-starforge-20261009/sf101-merchant-recovery/workspace/receiving/fleet-operator.mjs |
| Operator Git blob | 290c8b668807de740913987abdd62fc86fd709d0 |

The index records each full repository-relative path, Git blob, byte length, SHA-256 and Git mode. Every returned part was independently read back. Their disjoint union matches all manifest members. The original ten engine pins and sixteen operator pins match this edition. The standalone journey is preserved separately because it was published outside that release tree.

The broader source set includes the original SDK, recovery, deploy, delivery and pilot components and their actual catalog/provider imports. The index records HTTP aliases and files produced by the original exporters.

The receiving index includes the developer portal's computed static asset set. Part 032 adds `stellar/scf-starforge-20261009/sf30-seller-sdk/developer/browser.mjs`, `stellar/scf-starforge-20261009/sf30-seller-sdk/developer/index.html`, `stellar/scf-starforge-20261009/sf30-seller-sdk/developer/style.css` from the same application commit. The earlier 31 parts, original engine/operator pins and standalone journey retain their original identities. These three files are required by the portal's module-level asset loader and browser entrypoint.

## Receive the full source

The full package is published at [the complete artifact branch](https://github.com/woahwhattheheck/public-commons-sprint-2026/tree/artifact/scf-original-recovery-07476-20261012/artifacts/scf-original-recovery-07476-20261012) on `artifact/scf-original-recovery-07476-20261012`. The package includes all 32 source parts, the index, the standalone journey and the operating programs. Check out that published artifact branch, then select its complete package directory. Choose a new source directory beside that checkout and a separate journey file:

~~~sh
python3 materialize-original-source.py \
  --package /ABSOLUTE/PACKAGE_DIRECTORY \
  --source /ABSOLUTE/ORIGINAL_SOURCE \
  --journey /ABSOLUTE/recovery-journey.mjs
~~~

The materializer reads all 32 local parts, checks their exact bodies and membership, verifies every original source file, preserves executable bits and atomically publishes the full source. It can finish its own interrupted materialization when the retained marker and published bodies still match. The original journey allocates its native case after its source and service requirements are met.

## Select the actual service host

Use Linux with an existing named, nonroot account whose actual UID and primary GID are both nonzero. Keep that identity through original preparation, recovery and operator receiving. Source, case and runtime paths must be absolute and canonical. Source and case are separate trees. The original program uses Linux flock and seven free loopback ports starting at 24840.

Provision the passphrase once through a private environment variable and retain it through both commands and any continuation. The original program requires at least sixteen characters. Keep this value with the private recovery material.

Use installed Node, Python, Chromium and Playwright runtimes. The original package declarations are:

| Package | Original requirement |
| --- | --- |
| @x402/core | 2.28.0 |
| @x402/stellar | 2.28.0 |
| @x402/extensions | 2.28.0 |
| @stellar/stellar-sdk | ^16.3.0 in distribution; the separate buyer package pins 16.3.0 |
| re2js | 2.8.6, in stellar-forge/payment-auto-catalog/package-lock.json |

Reuse a compatible existing node_modules tree where available. The original re2js lock carries its package integrity. Any required installation belongs to the selected runtime directory and retains that lock and its actual installed versions. The producing commands use the original local merchant/fleet runtime.

For the direct materializer route, provision the selected dependencies through the source directory's parent before running either native command. For example, when source is `/srv/scf-run/source`, an existing `/srv/scf-run/node_modules` directory or an explicit symlink there to the compatible installed runtime lets Node resolve packages from that ancestor. Every ancestor and the selected package files must be readable by the actual service account. Keep the existing target when the link already exists and confirm it resolves to the intended installed directory. The materializer finishes with source directories at mode 0555; its application tree is then read-only. The supervising controller instead prepares its own `source/node_modules` link before freezing that tree.

## Execute the entire original journey

Run under the existing service account, using the retained passphrase variable:

~~~sh
node /ABSOLUTE/recovery-journey.mjs \
  --source /ABSOLUTE/ORIGINAL_SOURCE \
  --directory /ABSOLUTE/ORIGINAL_CASE \
  --python /ABSOLUTE/CANONICAL_PYTHON \
  --pass-env EXISTING_PRIVATE_VARIABLE \
  --port-base 24840
~~~

The original flow starts two independent native Python merchants and observes their real HTTP 402 challenges. It stages and activates alpha-v2 while bravo remains unchanged, exports the original customer client, closes the runtime, captures and reopens encrypted recovery, retains the original stopped roots in the case's retired directory, restores their original paths, starts the received runtime, observes the v2 challenge and exported client, rolls back through the original revision history, cold-reopens and closes the original processes.

The resulting journey.json retains this operation, actual source pins, service identity, inputs, paths, stages, snapshot and receiving operation. A retained incomplete journey continues through its actual phase; its entrypoint refuses to replace a partial case with another complete replay.

## Receive the complete operator workflow

After the same journey is complete and its processes are closed:

~~~sh
node /ABSOLUTE/ORIGINAL_SOURCE/stellar/scf-starforge-20261009/sf101-merchant-recovery/workspace/receiving/fleet-operator.mjs \
  --source /ABSOLUTE/ORIGINAL_SOURCE \
  --case /ABSOLUTE/ORIGINAL_CASE \
  --python /ABSOLUTE/CANONICAL_PYTHON \
  --chromium /ABSOLUTE/CANONICAL_CHROMIUM \
  --playwright /ABSOLUTE/EXISTING_PLAYWRIGHT_ENTRYPOINT \
  --quiesced
~~~

Use the actual canonical Playwright entrypoint installed on that host. The receiver uses the explicit Chromium executable, including when the package's default browser installation is absent.

This receives the completed native operation, exercises all eleven CLI calls and the original merchant provider, then opens the actual browser operator. The browser reviews and starts the original operation, reads back state, recovers the same request after a deliberately withheld reply, and cold-reopens with a fresh session. The complete result is retained at operator-receiving/result.json in the same case.

## Retain and deliver the whole result

Save the complete source and original case, including original/restored merchant roots, databases, outboxes, exports, backups, encrypted recovery, native history, full command stdout/stderr and browser operating outputs. Keep the private passphrase and connection material with the private saved case. Return the complete journey.json, original recovery receiving.json and operator-receiving/result.json with the saved artifact identity and actual process/runtime observations to the existing SCF thread.

The supervising controller checks the actual service UID/GID before creating the root, binds its executing source and Library child, runs both original commands, reconciles actual child returns, preserves the current case generation and uses the maintained Library workflow to save the entire archive.

## Optional supervised run

Fill selection.example.json with the actual host paths and service user. The original application, journey, controller and Library child identities are already selected. On a persistent host choose a new root under the service user's writable parent; a volatile runtime uses its writable /dev root. The configured Git caller must be the retained github_ops.py edition identified in the controller. The Library helper comes from the current installed Library skill.

~~~sh
python3 launch-original-controller.py /ABSOLUTE/SELECTION.json
~~~

The launcher binds the executing controller and maintained Library child before dispatch. The controller runs directly as an existing nonzero service owner, or observes an actual credential switch from a capable privileged controller. It hydrates all original source, executes the journey and operator, prepares the complete archive and saves it.

A retained controller accepts these JSON actions: status, inspect, prepare, run-original, continue-operator, archive, save, reconcile-original-save and close-saved. A started partial journey remains attached to its actual phase. A definite process-start failure may resume the same empty original case. Every later operating command invalidates the prior archive generation, so closing requires the current case to be durably saved. An uncertain original save is reconciled from its returned finalization or an exact-byte readback of that same saved archive.

The engine and operator receiver remain the original producing source. This package supplies complete source receiving and the host/process/archive lifecycle around those programs.
