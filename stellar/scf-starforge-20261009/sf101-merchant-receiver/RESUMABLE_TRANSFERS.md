# Resume an entitled private-file download

The existing SF101 purchase handoff names the order, delivery URL, exact size and
SHA-256 of the merchant's file. The buyer now retains an interrupted transfer and
requests only its missing suffix. Its original SF31 writer still verifies the
complete promised file before publishing the selected final path.

## Use the existing command

On Linux, resumable delivery is the default:

~~~sh
node stellar/scf-starforge-20261009/sf101-merchant-receiver/purchase.mjs retrieve \
  --handoff /private/buyer/order-482.json \
  --out /private/buyer/downloads/report-482.csv
~~~

The same command starts, resumes or recovers the same download. The separately
provisioned claim token remains in SF101_CLAIM_TOKEN, or the environment variable
selected with --claim-env. An already completed matching final file, or a fully
retained matching partial, can be recovered locally.

The response retains the existing status, file, receipt and httpRequests fields.
A newly completed transfer also reports:

~~~json
{
  "transfer": {
    "mode": "RESUMED",
    "resumedBytes": 262144,
    "receivedBytes": 786432,
    "statePath": "/private/buyer/downloads/report-482.csv.sf101-transfer.json"
  }
}
~~~

Mode is FULL for a first complete response, RESUMED for an exact HTTP 206 suffix,
RESTARTED_FULL_RESPONSE when a server answers a resume request with the full
HTTP 200 representation, and LOCAL_PARTIAL when all correct bytes were already
retained. Counts describe the completed attempt.

Use --timeout-ms to select a total transfer deadline between 1 and 300000 ms
(default 30000). SIGINT and SIGTERM cancel gracefully and retain the written
prefix. A later invocation resumes using its newly supplied current claim token.
On other operating systems the original one-request delivery remains the default.
--resume false explicitly selects that original path; --resume true requires
Linux and the flock utility used by the toolkit's existing private workspaces.

## Inspect or restart the retained transfer

Inspect the original state without requesting the file:

~~~sh
node stellar/scf-starforge-20261009/sf101-merchant-receiver/purchase.mjs transfer \
  --handoff /private/buyer/order-482.json \
  --out /private/buyer/downloads/report-482.csv
~~~

The result contains the state, retainedBytes, expectedBytes, attempts,
resumable and the original partialPath when present. A failed retrieve reports
that same state path and retained byte count. Typical states are:

| State | Operator action |
| --- | --- |
| NEW | Run retrieve with the original handoff and current claim token. |
| INTERRUPTED | Run the same retrieve command to continue. |
| REJECTED | Review the original file/handoff; explicitly reset if a fresh transfer is needed. |
| COMPLETE | Use the selected final file and adjacent .sf101.json receipt. |

A concurrently running owner produces FILE_TRANSFER_ACTIVE. Let that owner
finish or stop it before continuing. Every operation uses the same persistent
file-description lease; process IDs and another namespace's process table do not
decide whether an owner is active.

An explicit reset removes only the recorded partial belonging to this transfer:

~~~sh
node stellar/scf-starforge-20261009/sf101-merchant-receiver/purchase.mjs reset-transfer \
  --handoff /private/buyer/order-482.json \
  --out /private/buyer/downloads/report-482.csv
~~~

Then run retrieve for a fresh request to the existing entitlement. Reset refuses
an existing final output. The handoff, merchant order and completed buyer receipt
retain their identities.

## Recovery and file ownership

The original writer creates its 0600 partial in the chosen output directory. A
0600 adjacent transfer record binds that path to the exact handoff, final path,
expected bytes and expected SHA-256. A normal interruption records the actual
partial's byte count, digest and file identity. A resumed attempt checks those
bytes again, then feeds the retained prefix and returned suffix through the
original writer into a new private partial. The older checkpoint remains available
until the replacement is durably recorded.

A file-description flock releases automatically when the transfer process ends.
After process loss during delivery, the next invocation can recover the original
writer reservation only when its exact recorded generation, destination and
partial path match. An unrelated or unrecognizable reservation returns
TRANSFER_RESERVATION_UNRECOGNIZED and is preserved for the owning workflow.
Retain the transfer sidecar and original partial together.

Final publication uses the original writer's create-only hard link after EOF,
complete size and complete SHA-256 verification. If the final path was already
published before a process ended, retrieve verifies and recovers that completed
file first. Private files are opened without following a final symlink, and
changed partial identities or bytes are rejected.

The existing product limit remains 32 MiB. During a resumed write, allow space for
the old prefix and one complete replacement partial. The receiver hashes a
private spool and serves the requested slice in chunks; it spills to its private
state directory above 1 MiB of in-memory source data. Its original enrolled file
and entitlement remain the source of the transfer.

## Merchant and reverse-proxy deployment

Install matching receiver and buyer source. Restart the existing receiver against
the same private state, enrolled orders and access configuration. Keep the
existing public /deliver/ORDER route mapped to that receiver.

Preserve Range, If-Range and If-Match request headers and ETag, Content-Range,
Accept-Ranges and Content-Length response headers. Keep delivery content encoding
as identity. Preserve original claim-token authorization and private-cache policy.

The receiver checks the current claim token, entitlement and access policy before
returning file metadata or content. A suspended or expired order is checked again
on every resumed request. Repair that existing order or token, then continue the
same transfer. The buyer keeps its partial through a denied request.

The receiver's strong ETag is the approved SHA-256 in the form
"sha256-<hex digest>". For a saved prefix of N bytes, the buyer sends:

~~~http
Range: bytes=N-
If-Match: "sha256-<approved digest>"
If-Range: "sha256-<approved digest>"
~~~

The buyer combines a suffix only when status 206, strong ETag, exact Content-Range,
total size and any Content-Length all match. A full 200 response starts the
replacement file from byte zero. A changed tag, wrong range, compression or wrong
final digest leaves the final path unpublished.

See [the receiver protocol](TRANSFER_SERVER.md) for HEAD, suffix/closed ranges,
conditional requests and error responses. The HTTP behavior follows
[RFC 9110 sections 13 and 14](https://www.rfc-editor.org/rfc/rfc9110.html#section-14).

## Embed the existing buyer

~~~js
import {
  retrieveFile, inspectFileTransfer, resetFileTransfer,
} from './purchase.mjs';

const input = {
  handoff,
  destination: '/private/buyer/downloads/report-482.csv',
};
const saved = await retrieveFile({
  ...input,
  token: process.env.SF101_CLAIM_TOKEN,
  signal: controller.signal,
  timeoutMs: 60000,
});
const state = await inspectFileTransfer(input);
~~~

retrieveFile retains its existing argument and result contracts. resume and
timeoutMs are optional. Applications own signal handling; the CLI installs its own
graceful handlers. The existing fetchImpl seam remains a trusted embedding route
for the exact merchant delivery request. The ordinary command uses the maintained
public HTTPS transport and its exact-path claim-token binding.

