# Original SF101 recovery workspace receiving continuation

This packet continues the original public-source recovery operation `SF101-WORKSPACE-PUBLIC-SOURCE-34A4-20261011`. Its native continuation is `SF101-WORKSPACE-PUBLIC-SOURCE-34A4-CONTINUE-20261012`. The source MinIO transfer has already completed. The remaining operation opens the original merchant workspace, adopts that completed upload, lists the retained remote snapshot, downloads and cold-restores it, compares the four original file hashes, and reopens the completed workspace.

## Source and retained state

The public `source-manifest.json` lists the exact 17 Git blob selections, their bytes and SHA256 values. It preserves source commit `999edce11e44f11c7b0855cb300438080175ae90`, whose workspace source was merged through PR1346. Materialize those files beneath:

```text
/dev/shm/scf-recovery-workspace-34a4/source/
```

The original source directory is the root for the manifest's repository-relative paths. Do not substitute a current main checkout for this original operation.

The private `scf101-original-public-source-state.zip` retained on the original host has 39 files, 230844 bytes and SHA256 `9c7fafdebe595aba77c3ea70720d2a70504c701873400ef76f86cb332ee60b8c`. It contains the complete original public source data, encrypted bundle, prior successful download/restore, original transfer journals, workspace state and the credentials required to continue the same owned store. The current source host retains custody of this private state. A transfer to a separate recipient requires authorization for that private payload. If an authorized receiving copy is provided, keep it in the receiving host's private operational directory. Public result messages use the redacted operation result.

Inspect its manifest and verify every declared member before materialization. Preserve the original absolute application paths represented by `fs/`, private files at 0600 and private directories at 0700. Create files exclusively, or compare exact existing bytes before reuse. Keep `history/` as history: the previous cloud supervisor, process namespace and lock identities are not receiving-host locks. Retain all empty directories declared by the manifest. The two application roots are:

```text
/dev/shm/scf-recovery-workspace-34a4/
/dev/shm/scf-remote-recovery-34a4/public-source-operation/
```

The original private S3 configuration also occupies `/dev/shm/scf101-minio-public-config-34a4.json`. The driver derives its passphrase and existing service credentials from these original private files; no manual secret transcription is required.

## Single receiving owner

The source record is:

```text
/dev/shm/scf-recovery-workspace-34a4/native-jobs/c678326d0fcce128d86f7c17f6e01b66cc29542b0b94a2b59712cabb87af30ac
```

The packet was produced while that original request was undispatched. Before starting any authorized receiving application, the named worker acknowledges its equipped runtime and authorized retained packet path in the original request. The source owner then reconciles the actual process/output/result records and closes the source controller using the maintained native runtime. Its final handoff records whether the original application dispatched. Receiving execution follows the resulting explicit custody receipt. If the source application has started, reconcile its result before transferring the remaining work.

The packet's native request is historical context. Use the receiving host's maintained native envelope for this same continuation; retain the original application IDs, journals, remote store and snapshot.

## Existing dependency selection

Use the receiver's existing supported Node executable, Playwright/Chromium closure and AWS SDK `@aws-sdk/client-s3@3.1149.0`. The original production proxy transport needs Node 22.21+ within 22.x or 24.5+ within 24.x; the known Hatch Node 24.20 is suitable. The source driver inherits the selected `process.execPath` into the original workspace CLI/server.

The receiving driver differs from `original-operate-workspace.mjs` only by the explicit Playwright module-directory binding. Set `SCF_RECOVERY_PLAYWRIGHT_MODULES` to the existing directory containing `playwright/package.json`; choose the complete Chromium executable as argv2. Record the actual selected versions and paths.

Materialize the original `sf30-seller-sdk/s3/package.json` from the source manifest. Its `node_modules` can point to the verified existing SDK dependency closure. The production adapter resolves the SDK from that package ancestry, including the SDK's own Smithy HTTP-handler dependency. Confirm the selected existing SDK version before using it. Preserve the host's ordinary outbound proxy environment so the original private configuration chooses its normal production transport.

Copy the receiving `operate-workspace.mjs` into the original application directory. Preserve the original driver separately. An existing equipped Hatch selection has used:

```text
Node: /usr/bin/node
Playwright modules: /home/hatch/workspace/sim-work/rsd400-cf0907/nm/node_modules
Chromium: /home/hatch/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome
```

The receiving worker verifies those paths remain present; its actual current closure is recorded in the handoff. The command, after custody transfer, is:

```sh
SCF_RECOVERY_PLAYWRIGHT_MODULES=/home/hatch/workspace/sim-work/rsd400-cf0907/nm/node_modules \
  /usr/bin/node --max-old-space-size=128 \
  /dev/shm/scf-recovery-workspace-34a4/operate-workspace.mjs \
  /home/hatch/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome
```

Declare the whole original driver, server and Chromium closure through the maintained receiving runtime. The source request retained 768 MiB peak plus 128 MiB reserve, and 32 MiB growth plus 64 MiB disk reserve. These are declared capacity estimates. The browser uses its owned `tmp/`, one page, a single screenshot and the original small payload.

## Completion and continuation

The existing remote snapshot is `879c9f10c2f8dc3a4a543bd3a5ad6ed31eb7b34a408b1a0fe27243d3f4245996`. The original immutable upload is `public-source-push`. The browser continues `workspace-public-source-pull` and `workspace-public-source-restore`, retaining their same IDs when interrupted. The original Stop control is exercised if the download is still running when selected; a transfer that has already completed retains its actual completion.

The four plaintext payloads total 77317 bytes. The driver reads each restored file and compares its SHA256 with the original successful source operation. It then closes the browser and server and uses the same original `workspace show` command to read back three complete retained operations.

Preserve and return:

- `operation-result.json`, including source selection, original IDs, actual steps and restored file hashes.
- `workspace.png`, captured by the actual application browser.
- The receiving native request, result, output and resource observations.
- The exact receiving source/dependency selections and the source-controller handoff receipt.

On a concrete application failure, preserve the original result and private state, repair the cause, and continue the original IDs. A completed result is read back directly on re-entry. Keep source/runtime custody in the original request so another worker can finish the same operation.
