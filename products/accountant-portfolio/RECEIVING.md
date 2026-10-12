# Receive the complete client close and portfolio

A usable handover contains the selected source package and runtime profile, the exact portable business packets, and the identities needed to continue the work. A period packet carries one original client's procedures, source, work and review history. A portfolio packet carries the firm and client commissioning histories, calendar editions, prepared client requests and the complete selected native client packets.

Use the same original receiving operations in the browser, CLI or typed client. Retain each packet's complete bytes, size and SHA256.

## Deliver a reviewed client period

From the actual client period, retain all three outputs:

| Output | Use |
| --- | --- |
| Printable handover | Full human-readable procedure, source, work, review and responsibility history. |
| Task CSV | Operational task handover, including the saved Runbook/Edition/Period/Task identity tuple. |
| Portable JSON packet | The full frozen edition, selected source, work, submitted/reviewed rounds, handovers and original supporting files. |

The CLI downloads the original files:

~~~sh
starforge client-close runbooks download \
  --url http://127.0.0.1:8446 --client client-a --id PERIOD_UUID \
  --format packet --out /private/delivery/client-a-period.json

starforge client-close runbooks download \
  --url http://127.0.0.1:8446 --client client-a --id PERIOD_UUID \
  --format print --out /private/delivery/client-a-period.html

starforge client-close runbooks download \
  --url http://127.0.0.1:8446 --client client-a --id PERIOD_UUID \
  --format tasks --out /private/delivery/client-a-tasks.csv
~~~

Use a standalone client's running URL without `--client`, or its stopped `--workspace` selector. Download destinations must be new or already hold the same complete bytes.

## Receive the selected procedure set

A named-set period's packet keeps the complete original catalog and all its named set definitions, together with only that period's selected work and review history. The printable handover names the set; its task CSV includes the selected procedures and the set ID/name alongside the stable Runbook/Edition/Period/Task identity.

Use the complete profile-capable selected runtime at the receiver. Native receiving verifies the frozen choice against the original edition and creation record, each selected work entry and the assignment/review history. An existing all-procedure period retains its original digest and CSV shape.

After receiving the reviewed period, start the next local weekly or monthly period from the carried edition and the receiver's actual new files. Review the named set in that new draft before creating it. The full catalog remains available for choosing another saved set; receiving a weekly period does not turn the entire catalog into completed work.

## Capture the firm portfolio

Select the actual clients and the original period IDs to deliver. Include a period using each client's commissioned procedure edition. Read and retain each current client workspace identity/revision before capture.

The native capture freezes:

- Complete firm editions and named staff capacity.
- Original client identities and commissioning history.
- Saved calendars, allocation decisions and capacity handling notes.
- Prepared client commands, their native request identities and correction history.
- Each complete selected original native client packet, with its own source and byte identity.

Download the resulting capture:

~~~sh
starforge client-close portfolio packet \
  --url http://127.0.0.1:8446 --id CAPTURE_UUID \
  --out /private/delivery/firm-portfolio.json
~~~

A portfolio can select up to 15 clients and 100 periods per client. The complete JSON packet is limited to 64 MiB; its native client packets may expand to at most 256 MiB in aggregate, with the original 64 MiB per-period limit. Large histories can be handed over as separate complete captures with their actual scopes.

## Receive into the selected destination

Initialize the destination coordinator and its distinct client workspaces through the original installation/setup path. Review their current configuration and original source bindings.

1. **Receive the complete portfolio.** In the receiving portfolio desk, select the original packet and save its exact request. Native validation checks the complete source metadata, command digests, compressed/original bytes, selected editions and client packets.
2. **Retain the received identity.** Read its received UUID, complete original packet SHA and client-period identities. The received view can download that same whole portfolio again after reopening.
3. **Receive each native client period.** Download the selected original client packets and receive them in the correct destination client's Runbooks. Imported periods keep their original workspace/source and history and remain read-only.
4. **Adopt the local clients.** Map each source client to an explicitly selected destination alias, a new local client identity and the destination's current workspace/revision. Adopt the firm edition or map its lead/backup/reviewer to the receiving firm's declared people.
5. **Open the next local period.** Select the received runbook/edition, its prior received period and the receiver's actual new files or accountant handoff. The new period gets its own original local identity and fresh work.

Adoption verifies that the expected complete native periods were actually received into the selected local clients. An incoming packet alone does not create a destination writer or redirect an existing client.

The corresponding prepared CLI request is:

~~~sh
starforge client-close portfolio prepare \
  --url http://127.0.0.1:8447 --action receive \
  --input /private/receiving-actor.json \
  --file /private/delivery/firm-portfolio.json \
  --out /private/receive-portfolio-request.json

starforge client-close portfolio execute \
  --url http://127.0.0.1:8447 --prepared /private/receive-portfolio-request.json
~~~

The input contains the actual operator's `actor` field. The prepared request adds the receiving workspace ID, current revision, native UUID and the complete packet bytes. Keep that same file if the response is uncertain.

Read and download the retained received source:

~~~sh
starforge client-close portfolio received \
  --url http://127.0.0.1:8447 --id RECEIVED_UUID

starforge client-close portfolio received-packet \
  --url http://127.0.0.1:8447 --id RECEIVED_UUID \
  --out /private/receiving/original-portfolio.json

starforge client-close portfolio client-packet \
  --url http://127.0.0.1:8447 --id RECEIVED_UUID \
  --client ORIGINAL_SOURCE_CLIENT_UUID --cycle ORIGINAL_PERIOD_UUID \
  --out /private/receiving/original-client-period.json
~~~

Receive that period through its actual destination client:

~~~sh
starforge client-close runbooks prepare \
  --url http://127.0.0.1:8447 --client client-a --action receive \
  --input /private/receiving-actor.json \
  --file /private/receiving/original-client-period.json \
  --out /private/receive-client-period-request.json

starforge client-close runbooks execute \
  --url http://127.0.0.1:8447 --client client-a \
  --prepared /private/receive-client-period-request.json
~~~

Repeat for the intended complete set, then use the portfolio's native **Adopt** action with the actual source-to-local bindings. The [native guide](../../stellar/scf-starforge-20261009/merchant-settlement-accounting/workspace/PORTFOLIO_GUIDE.md) describes the full adoption input and source constraints.

## Receive complete files through the installed client

MCP file selection uses the existing native accounting file reader. Runbooks selects its original period/file UUID; Portfolio selects a capture, received portfolio, calendar or original received client packet. The complete bytes use the original reader's SHA-bound chunks.

~~~js
const selection = {kind: 'portfolio', captureId, file: 'packet'};
const identity = await portfolio.fileInfo(selection);
await portfolio.download(selection, {
  expectedSha256: identity.sha256,
  output: '/private/delivery/firm-portfolio.json'
});
~~~

Use `receivedId` to select a complete already received portfolio, or add its original `clientId` and `cycleId` for a separate client packet. Keep the file selection and digest unchanged across a resumed read.

A prepared receive reads its declared input alias once and retains the complete source bytes in the original request. Reconciliation checks the saved native request before reopening a changed or absent alias. Preserve the same complete prepared request after a lost reply.

## Continue on an upgraded selected installation

The selected `accountant-portfolio` product uses the original Runbooks and Portfolio native engines. Existing merchant accounting workspace identities and source bindings remain compatible with that foundation. Install its new source package in a separate runtime and select the same stopped original workspace configuration.

A complete installed continuation should retain the following original outcomes:

| Stage | Complete receiving result |
| --- | --- |
| Package | Actual source commit and `accountant-portfolio` recipe; complete archive/manifest and exact source inventory. |
| Runtime | Original native + MCP + operator profile, complete dependency graph/lock, ready runtime and installed source check. |
| Commands | `client-close` and original workspace forwarding; typed Runbooks/Portfolio exports; complete named-set paging and original prepared create requests. |
| Client observations | The same original workspace IDs, periods, frozen procedure sets, commissions, plans and incoming packet identities. |
| File receiving | Complete existing period/portfolio bytes through the installed native reader, with matching size and SHA256. |
| Managed application | Reviewed original source configuration, complete coordinator/client resource set, saved start, client desk and normal stop. |
| Reopen | The same stopped-owner CLI and client records, without rebuilding the original merchant source or repeating committed work. |

A following installation is a continuation of those retained workspaces and original IDs. Native source, browser and SDK receiving can share the same original operation; retain separate source/runtime identities for the old and new installed editions.

Use the generated package and receiving receipts for actual completed outcomes. [SOURCE_LINEAGE.json](SOURCE_LINEAGE.json) describes this repository's code adoption; it is not an execution result.

## Practical handover acceptance

The receiving operator should be able to open the selected firm and each client, inspect the actual two-period history, follow a backup handover and returned correction, download the complete original bytes, and start a fresh local period using the intended new source. Keep the actual staff assignments, source gaps and unresolved work visible.

For the practice's external systems, retain the task CSV's stable identity mapping, agreed recording/transcript references, and any explicitly completed import/setup steps. The original native packet supplies the complete reviewable work even when a partner uses a separate task-management application.

Complete the original workspace shutdown before moving ownership to another process or device. Preserve the exact source package, ready runtime identity, host configuration, file digests, native request files and receiving destinations so the next operator can reopen the same work.
