# Move an original dataset session to another machine

The original SF88 buyer can export its complete retained session, receive it under
a different private directory, inspect its original pages and build the original
SF100 data room. This is the session handover for callers such as Superset that
need the acquisition and its history alongside a portable merchant workspace.

The immutable session, source configuration, per-page configuration, attempt,
checkout evidence, response and wire files keep their original bytes. Their
original path strings continue to name the acquisition. A separate local storage
selection resolves those names to the receiving directory. The original request
and configuration hashes therefore stay unchanged.

## Export and receive

Use the same installed buyer distribution, Node 22+, and Python 3.10+ on Linux.
The Python standard-library helper handles the ZIP and atomic local publication.
It adds no package dependency. The existing installed command is
`starforge buyer-dataset`; a source checkout uses
`node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/dataset-cli.mjs`.

Choose an export ID once and keep it with the original operation:

~~~sh
starforge buyer-dataset export-session \
  --session /private/original-acquisition \
  --out /private/transfers/original-acquisition.zip \
  --operation original-acquisition-export-01
~~~

Both the source root and the transfer directory must already be private
directories. The output must be outside the source tree. Export holds the
original dataset run lock throughout inspection and capture, and holds each
original inactive wire lock while reading the source. An active source writer
must finish its current operation first. An interrupted exporter keeps its
selected manifest and private ZIP stage beside the requested output; repeat the
same command to finish that same export.

The result provides `archiveSha256`, `archiveBytes`, `manifestSha256`,
`configurationSha256`, `sessionSha256`, the original native inspection, and the
complete file/directory counts. Use that returned archive digest when receiving.

~~~sh
starforge buyer-dataset inspect-session-archive \
  --archive /private/transfers/original-acquisition.zip \
  --expect-sha ORIGINAL_ARCHIVE_SHA256

starforge buyer-dataset receive-session \
  --archive /private/transfers/original-acquisition.zip \
  --expect-sha ORIGINAL_ARCHIVE_SHA256 \
  --session /private/customer/acquisition \
  --operation original-acquisition-customer-01
~~~

Archive inspection reads and hashes every declared member. Receiving first
validates the complete archive, extracts the exact selection into its recorded
private stage, and invokes the original SF88 session inspector there. It then
publishes the complete directory with `renameat2(RENAME_NOREPLACE)` and reopens
the published session. An existing unrelated target is preserved.

Repeat the same receive command after interruption. Each already materialized
file must still match its original bytes, mode and digest; only missing files
are written. Partial member writes remain in the operation's separate control
directory. A completed receive reopens current native state and preserves later
customer changes. The original operation and archive digest must still match. If native inspection
was interrupted, receiving uses the original host/PID/nonce check to recover its
dead same-host run lease, then removes that lease through the original normal
release before final publication.

## Inspect, deliver and reopen

Use the receiving directory with the existing commands:

~~~sh
starforge buyer-dataset status \
  --session /private/customer/acquisition

starforge buyer-dataset deliver \
  --session /private/customer/acquisition \
  --out /private/customer/original-data-room

starforge buyer-dataset export \
  --session /private/customer/acquisition \
  --out /private/customer/original-page-manifest.json
~~~

The native inspector validates the original definition, page configurations,
attempts, native response/evidence bindings, complete cursor chain and semantic
response headers. Its `directory` and retained page paths preserve the source
identity. A relocated result also supplies `storageDirectory`, `sourceDirectory`
and `storageLocation`. The page-manifest command supplies actual receiving paths
in `pageFiles`, with the original names retained in `originalPageFiles`.

Delivery feeds those actual retained files into the existing SF100 exporter.
Its native source hashes, typed dataset output, semantic dictionary, provenance,
review HTML and saved-prefix recovery remain the original implementation.
Reopening a completed session uses its saved acquisition; it does not purchase
its pages again.

## An unfinished acquisition keeps its original state

Export also preserves unstarted, failed, interrupted and unresolved acquisitions.
Receiving keeps the same native status, completed prefix, cursor, caps, current
attempt and unpaid/expired history. It does not convert an unresolved request
into a new page or an approval.

For a session whose original inspector reports `READY`, the existing explicit
run command can continue with the same compatible original buyer:

~~~sh
starforge buyer-dataset run \
  --session /private/customer/acquisition \
  --workspace /private/original-compatible-buyer
~~~

The configured original signer, payer, policy, ledger, approval channel,
workspace and externally selected capabilities retain their original selection.
The receiving package moves session storage; it does not remap or create those
authorities. A saved workspace binding continues to require that original
workspace. A session selected from a configuration may attach a compatible
existing workspace through the existing `--workspace` contract.

Each new page goes through the original preflight, quote review, durable attempt
marker, approval, ledger reservation and buyer. The storage selection routes
its response, checkout evidence and wire files into the receiving session while
its immutable page configuration still carries the original names.

For `RECONCILIATION_REQUIRED`, use the existing accounting and explicitly
selected unpaid/expired/lost-output recovery operations described in
[DATASETS.md](DATASETS.md). Those operations continue to enforce their original
source, process, inode, ledger, generation and proof checks. The archive retains
that original history and its physical source observations. Relocation does not
turn those observations into a new authorization. Finalization uses the
original compatible workspace and existing SF36 worker.

## Node integration

~~~js
import {
  exportDatasetSessionArchive,
  inspectDatasetSessionArchive,
  receiveDatasetSessionArchive,
} from '@tokenjunkielabs/starforge-merchant/buyer/dataset-session-portable';
import {
  inspectDatasetSession,
  deliverDatasetSession,
} from '@tokenjunkielabs/starforge-merchant/buyer/dataset-acquisition';
import {
  resolveDatasetSessionPath,
} from '@tokenjunkielabs/starforge-merchant/buyer/dataset-session-location';

const exported = await exportDatasetSessionArchive({
  directory: originalSession,
  archive: archivePath,
  operation: originalExportId,
});
await inspectDatasetSessionArchive({
  archive: archivePath,
  expectedSha256: exported.archiveSha256,
});
const received = await receiveDatasetSessionArchive({
  archive: archivePath,
  directory: customerSession,
  expectedSha256: exported.archiveSha256,
  operation: originalReceivingId,
});
const state = await inspectDatasetSession(customerSession);
const firstResponse = await resolveDatasetSessionPath(
  customerSession, state.pages[0].responsePath,
);
const delivery = await deliverDatasetSession(customerSession, customerDataRoom);
~~~

The three archive methods also accept `python`, `signal` and `maxBytes`.
`python` selects an existing Python executable; it defaults to `python3`.
`maxBytes` bounds the sum of original uncompressed files, defaults to 2 GiB and
may be explicitly raised through 16 GiB. A single member is limited to 256 MiB;
the complete file/directory count is limited to 250,000, with a 32 MiB manifest.
The original dataset acquisition and SF100 limits continue to apply separately.

`resolveDatasetSessionPath` resolves only a member of this exact selected
session. The storage mapping is async-local to the original operation. It does
not patch Node's filesystem, rewrite source documents, substitute inode values
or change unrelated concurrent buyers.

## Archive and receiving records

The ZIP contains `SF88_SESSION.json` and the complete original `session/` tree.
The manifest records each directory's original mode and each regular file's
relative path, bytes, SHA-256 and mode. Original failed attempts, unpublished
file fragments, wire checkpoints and page-history directories are included.
The root `run.lock` names a live process lifetime and is excluded; a prior local
storage marker is replaced by the new receiver's separate location selection.

The receiving root retains `.sf88-location.json` and the exact imported manifest
under `.sf88-portable-history/<archive-sha256>.json`. A later export carries that
history forward. Original session files remain the inputs to the existing
native inspector, buyer and data-room delivery. The archive contains the same
private HTTP and signing checkpoints as the acquisition, so use the original
private artifact channel for the complete handover.

The adjacent `.sf88-export-*` and `.sf88-receive-*` operation directories retain
the selected source, staging identity and interrupted publication state. Their
stable operation IDs and original archive digests make a repeated command a
continuation of the same handover.
