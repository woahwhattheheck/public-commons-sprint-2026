# Grant purchase reviewer

The workbench carries the original public SCF demonstration from exact packet
review through native Buyer result consumption, closed export and another
receiving operator. It reuses the original packet, quote store, retained-result
store, Buyer server, browser MCP client and grant receiving functions.

## Open from Applications

Select **Grant purchase reviewer** in the maintained runtime workspace.

1. Select the reviewed runtime and a private reviewer workbench directory.
2. Optionally select an exported packet and its exact SHA-256. Leave those two
   fields empty to choose the bundled public purchase in the workbench.
3. Review and save the application, connect it to the selected merchant home,
   start the original operation, and choose Open.
4. Applications verifies the current private connection record, workbench ID,
   process/lease and listening instance before opening this workbench.
5. Stop through the same managed operation. Reopen the same saved application;
   its retained selections, original quote IDs and action history remain.

The source-owned contribution is distribution/contributions/grant-reviewer.json.
It extends the existing grant-demo command; it does not replace the separate
grant-workspace finance application or the shared Applications catalog.

For an existing source installation:

    node stellar/scf_2026/presentation/reviewer/cli.mjs workbench --dir /private/review/purchase --port 0

For the maintained installed package:

    starforge grant-demo workbench --dir /private/review/purchase --port 0

The parent directory must already be private and owned by the operator. The
command retains the workbench as a private directory. Noninteractive startup
prints only the listener and original instance identity. Use Applications or
read workbench-connection.json locally for its access code. The browser clears
the fragment and password field immediately; the code remains in memory for
this connection. Disconnect clears it.

## Review and consume the original purchase

Choose **Packet intake → Review bundled purchase**, or select a complete exported
JSON packet. Uploaded bytes remain unchanged; the browser SHA-256, packet
identity, original document hashes and native MCP result representation are
checked before the selection becomes REVIEWED.

**Source and query** displays the exact retained query, source identity, original
terms and all document downloads. Choose **Receive this packet** to let the
original receiving function restore the two native quote records and complete
result files in this selection's private directory.

Choose **Open original Buyer**, then **Buyer results**. The unchanged
BuyerConsoleClient reads actual native quote history, status and saved-result
ranges through the running original Buyer. **Read complete saved result** joins
the native ranges, checks byte length and SHA-256 and exposes structured rows,
content and complete JSON. Download preserves the original bytes.

The bundled primary quote is c2a5d4c5-e2c3-4d50-abe2-3edb4c8fa36e, with retained
CONFIRMED_BY_SERVER status and TRANSFER_MATCHED observation. Its original complete
MCP result contains 53,468 bytes, 100 rows and 14 columns; its truncated flag is
still true. The earlier indeterminate quote remains separate, with its original
FAILED observation and complete 4,733-byte error result. Neither outcome is
recast by this receiving workflow.

The public NYC HPD source describes building-in-project events. The recorded
query and September 30, 2026 source vintage are retained; these rows do not
represent current vacancies or distinct physical buildings. The original film
and packet retain their source links.

The workbench's native MCP forwarding surface permits retained history, status
and saved-result reads. Its separate **Open original console** control obtains
the current instance's code through authenticated local access; copy that code
into the original Buyer's existing form. No Buyer code is printed in structured
startup output, put in a packet or included in the workbench's shared metadata.

## Closed export and another receiving operator

Choose **Handover → Close Buyer and export packet**. This action awaits the
complete original startGrantDemo().close() lifecycle, including HTTP/broker
drain and release of the quote-store writer lease. It then calls the original
exportGrantDemo() on that closed native view. Complete per-quote transitions
are retained. A live writer is never treated as a stale lock.

The export keeps the original packet's quote IDs, attempts, seller statuses,
observations, source documents and complete result bytes. Its new receiving
history is a distinct stage. The original action UUID and creation time bind
that history and its create-only output. If response publication is interrupted,
the same action can recognize its exact already-written file; it does not append
another stage or replace different bytes.

Download the receiving packet and retain the displayed SHA-256. Another operator
can select it in a new Applications review:

    starforge grant-demo workbench --dir /private/receiver/purchase \
      --packet /private/receiver/original-export.json --sha256 EXPORTED_SHA256 --port 0

The selected file is reviewed and pinned before launch. Its new workbench uses a
fresh local access code and separate native receiving directory, while the
original quote IDs and results remain identical.

For a local walkthrough, **Review receiving copy** adds the exact export as
another reviewed selection. Choose Receive to obtain its separate native store,
then Open. That local selection is labelled as a receiving copy; it is not an
independent merchant adoption or an additional purchase.

**Reopen this received packet** explicitly starts the original Buyer again after
export. The controller remains available throughout close/export/reopen.

## Interruption and retained state

A single kernel lease owns each workbench. Source packet bytes are retained once
by SHA-256 under inputs/. Each selection has an immutable packet identity and
a revisioned receiving decision. Each action records the original UUID, selected
input hash, attempt count and either COMPLETED or CONTINUATION_REQUIRED.

The browser retains only action UUIDs and input digests in its tab. A failed
response can retry the same input with its original UUID. A completed action
returns its existing result; changed input under the same UUID is rejected.
Receiving itself uses the original resumable native grant function.

On process loss, reopen the same workbench. Completed actions and files remain.
A Buyer is started only by the explicit Open action. Stopping the workbench
prevents later queued actions, drains its current original Buyer and releases
the workbench lease. It deactivates only its own private connection instance.

The full original command/API receiving guide remains RECEIVING.md. This
workbench adds no signer, facilitator, RPC observation, provider refresh or
payment dispatch to the original public receiving exercise.
