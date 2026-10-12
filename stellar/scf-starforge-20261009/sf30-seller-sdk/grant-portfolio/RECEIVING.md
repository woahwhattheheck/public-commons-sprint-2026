# Complete portfolio handover

A grant portfolio handoff is one complete ZIP with schema
`stellar-forge.grant-portfolio-packet.v1`. It carries the selected portfolio revision
and every preceding revision, original source packet, complete record table, review
decision and original operation needed to reopen that work.

## File contents

| Path | Complete content |
| --- | --- |
| `manifest.json` | Source workspace UUID, portfolio UUID, selected revision/snapshot, and every file's SHA-256 and length. |
| `history.json` | Every original portfolio revision through the selected revision. |
| `requests.json` | Original portfolio/source operations, each retained with its source workspace identity. |
| `sources/SOURCE_ID/descriptor.json` | Exact native source edition, original packet, coverage, selection and complete projection identities. |
| `sources/SOURCE_ID/source-packet.zip` | Unchanged complete original IATI or 360Giving handoff. |
| `rows/REVISION/TABLE.jsonl` | Every row of all seven tables for each included revision. |
| `runtime/sf30-seller-sdk/` | The complete selected application and native source closure. |
| `README.md` | Handover entry point. |

Tables are entities, financial, links, decisions, candidates, changes and sources.
Original requests from another receiving workspace remain attached to their source
workspace ID. Later local edits add their own original operations. Re-export preserves
both histories.

## Export the selected revision

From the console, select the portfolio and revision, then choose **Export complete
portfolio**. The server builds and verifies the complete packet. The browser downloads
the original finished file.

The same operation is available from the original CLI:

~~~sh
starforge grant-portfolio --workspace /absolute/private/grant-review export \
  --portfolio-id ORIGINAL_PORTFOLIO_UUID --revision ORIGINAL_REVISION \
  --operation-id original-grant-handover-001 \
  --out /absolute/private/grant-portfolio-complete.zip
~~~

Retain the original operation ID for retries. Read it using the saved request command:

~~~sh
starforge grant-portfolio --workspace /absolute/private/grant-review \
  request --id original-grant-handover-001
~~~

A completed export result contains the full ZIP descriptor directly:

~~~json
{
  "sha256": "COMPLETE_ZIP_SHA256",
  "bytes": 12345,
  "filename": "Grant_Portfolio_ORIGINAL_UUID_r1.zip",
  "portfolioId": "ORIGINAL_PORTFOLIO_UUID",
  "revision": 1,
  "snapshot": "ORIGINAL_REVISION_SHA256"
}
~~~

The values above illustrate the descriptor structure; use the actual returned values
for the selected handoff.

## Receive through the original application

Create a new private workspace using the installed complete application:

~~~sh
starforge grant-portfolio --workspace /absolute/private/grant-received init
~~~

Start its original console and open **Source editions → Receive a complete portfolio**.
Choose the original ZIP and receive it. The receiving operation reports the original
portfolio ID, revision, snapshot, source count and complete history count.

For CLI operation, upload the unchanged file:

~~~sh
starforge grant-portfolio --workspace /absolute/private/grant-received \
  upload --file /absolute/private/grant-portfolio-complete.zip
~~~

Put the actual returned SHA in a saved action file:

~~~json
{
  "operationId": "original-grant-receiving-001",
  "action": "portfolio.receive",
  "payload": {
    "object": "ACTUAL_UPLOADED_ZIP_SHA256"
  }
}
~~~

Run that saved input through the original action command:

~~~sh
starforge grant-portfolio --workspace /absolute/private/grant-received \
  action --file /absolute/private/receive-grant-portfolio.json
~~~

If the process stops, resume the original operation:

~~~sh
starforge grant-portfolio --workspace /absolute/private/grant-received \
  resume --id original-grant-receiving-001
~~~

The action ledger coalesces the same ID and input. Native source preparation is retained
for continuation. A completed domain import, its workspace revision and its complete
operation result are committed together.

## What receiving reconstructs

The receiver checks every ZIP member, declared length and SHA before using its content.
Member names must be unique ordinary relative paths. Encrypted files, symbolic links,
path traversal and undeclared members are rejected.

It then:

1. Retains each unchanged original source packet by full SHA.
2. Receives that packet through the installed original IATI or 360Giving engine.
3. Reads every native page and verifies the original build's complete row count.
4. Rebuilds each original portfolio revision, decision state, exact financial group,
   relationship proposal and change table.
5. Compares every complete table and immutable portfolio snapshot.
6. Publishes all received sources, revision history and original request custody in one
   domain transaction.

Code carried in the ZIP is preserved as source. The receiving operation executes the
installed original application and source engines.

Source byte custody and full record projections remain identical across receiving.
Machine-specific native workspace/index details can differ. Every complete semantic
record table, financial value, source selection and saved portfolio snapshot must
reconstruct.

## Reopen and continue

Close the receiving console and reopen its original workspace. Select the received
portfolio and inspect its earliest and latest saved revisions. Every included original
source packet is available for download. Records and original financial rows are
available through the console, CLI, typed client and merchant tools.

New local reviews or following editions extend the same portfolio history. A later
complete export includes the received original operation history and the new local
operations.

For large or remote merchant handoffs, use the original retained-file reader described
in [CLIENTS.md](CLIENTS.md). Its resumable download preserves the original complete
manifest and received byte prefix, then invokes this same original target receiving
action.

## Source closure and limits

The source-owned [manifest](source-files.json) lists the application files and original
native dependencies used by the receiver. The installed distribution contribution retains
the companion Applications and merchant interfaces together with that closure.

The complete packet limit is 4 GiB. The original native 360Giving handoff remains limited
to 1 GiB. Original native source limits still apply inside each packet. The receiver
checks the full file set and expanded lengths before reconstruction. The browser pages
record tables; full record and history exports retain all rows.

The [Comic Relief operating recipe](examples/comic-relief/SOURCE_INPUTS.md) provides
the full authoritative-source conversion and native packet journey. Its product consumer
continues into the same console/client/merchant workflow and independently reopens the
complete received history.
