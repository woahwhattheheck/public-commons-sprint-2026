# Highway Field Operations SDK and agent tools

The SDK borrows one managed Highway HTTP service. Its selected identity includes the portable workspace UUID and the absolute physical workspace directory. A received workspace preserves the UUID and has a different directory; create a separate client and Applications entry for that branch. No SDK method starts a server, changes a selected branch, edits ArcGIS, or retries an uncertain write.

## Open the real managed application

Create/save/start an Application of kind highway-field-operations using the installed Runtime. Keep its private connection path, original workspace UUID and physical directory. The service checks the exact selected Python executable (including its virtual-environment spelling and pyvenv.cfg), Node executable, native application source and optional existing paired warehouse identity. Python 3.11 or later is required; the paired engine additionally requires the original duckdb 1.5.6.

    import {createHighwayFieldClient} from './products/highway-field-operations/client.mjs';

    const client = createHighwayFieldClient({
      connectionFile: '/absolute/private/workspace/highway-field-operations-connection.json',
      workspaceId: actualWorkspaceId,
      workspaceDirectory: '/absolute/private/workspace'
    });
    try {
      const current = await client.state();
      for await (const page of client.pages('history', {}, {limit: 100})) {
        await retainOriginalPage(page);
      }
    } finally {
      await client.close();
    }

retainOriginalPage is the caller's storage function, not an SDK export. The example operates the real selected service. Connection capabilities are read from its private file and authenticated only to that exact loopback owner. Public status does not disclose the token.

## Complete API

| Method | Original operation and result |
| --- | --- |
| state() | Current revision, state hash, full state, domain/dispatch views, source selection, paired availability and physical directory. |
| history({offset,limit}) | Full items of original envelope/result/history records, total, offset, nextOffset; limit at most 100. |
| request(requestId) | {request: ...} for the original UUID, or null when absent. |
| records(captureId,layerId,{offset,limit}) | Complete captured records, coverage, metadata and observations; limit at most 250. |
| inspection(inspectionId) | Actual inspection, saved form/version/source assessment and associated proposals. |
| pages('history',{},options) | Async generator of complete original history pages. |
| pages('records',{captureId,layerId},options) | Async generator of complete original source pages. |
| command(envelope,expectedRevision) | Original {reused,requestId,revision,sha256,outcome} result. |
| prepareDataset(operationId,selection) | Original projection, CSV, genuine SF30 pages, SF100 finalized scan and report path. |
| native(operationId,operation,body) | Full original paired-engine result, files and explicit staff association command body. |
| nativeRequest(operationId) | Read the original native intent/returned/ready state without replaying it. |
| restoreNative(recordId,operationId) | Restore the complete package already retained in the staff reconciliation record. |
| exportWorkspace(publicationId,revision) | Freeze exact staff revision, complete source/history/blobs and ZIP identity. |
| receive({operationId,sha256,bytes}) | Receive a previously uploaded whole archive into a separate directory. |
| uploadBytes(kind,buffer,identity) | Receive complete source bytes or archive, checking both request and acknowledgement. |
| uploadFile(kind,absolutePath,identity) | Stream an already selected local regular file with fixed size/hash. |
| download(selection,onChunk) | Stream every original byte of source blob, staff ZIP or frozen dispatch HTML. |
| close() | Drain this borrowed client's pending call; leave the managed application owner running. |

client.d.mts describes the actual HTTP envelopes. Domain commands and native bodies remain the original maintained schemas in app/DOMAIN_GUIDE.md, app/DISPATCH_OPERATING.md and app/PAIRED_REVIEW.md. Complete native row/group grids retain their original columns, values, totals and next_offset; they are not flattened into an approximate comparison.

## Source pages and local proposals

A captured feature contains actual attributes and geometry, its ObjectID/GlobalID and all retained source attachment descriptors. Coverage and source-change observations travel with each page. Follow nextOffset until null. Traversal snapshots caller options, checks the branch and stops if source/total identity changes.

The local proposal remains distinct from the County source. A source refresh/rebase follows the original form/assignment lineage and renewed review. Approval does not assert that a GIS service accepted an edit.

A dataset selection is:

    {
      captureId: actualCaptureId,
      layerId: actualLayerId,
      formId: actualFormId,
      objectIdColumn: 'object_id',
      fieldMap: [
        {captureField: actualObjectIdField, deliveryField: 'object_id', encoding: 'native'},
        {captureField: '@feature', deliveryField: 'feature_json', encoding: 'json-text'},
        {captureField: '@geometry', deliveryField: 'geometry_json', encoding: 'json-text'}
      ],
      sourceKind: 'captured'
    }

For an approved-proposal selection include its actual proposalId and proposalSha256 and choose sourceKind:'approved-proposal'. Names above are explicit output aliases; actualObjectIdField must be the captured source's real declaration. The original full-row verifier checks every selected row against captured values or the saved approved proposal. The original producer handles null versus empty text, complete feature/geometry JSON and supported numeric ranges.

## Writes, original requests and uncertainty

Retain {requestId,kind,actor:{id,name},at,body} and expectedRevision before a command. The server records and returns its first result for the exact original request, including its original expected revision. A UUID reused with altered input is rejected. Public SDK inputs are snapshotted before asynchronous dispatch.

A transport/error result may have uncertain:true and the original operation identity. Read the staff request, native nativeRequest, original publication or receiving receipt before continuing. Keep the original UUID and complete bytes. Do not turn a timeout into another command or edit the preserved request to fit a newer revision.

Native operations run outside the staff SQLite business transaction. The adapter returns:

    {operationId, result, recordBody, recordRequestId}

Retain the complete return, then submit the original reconciliation.record command using recordRequestId, recordBody, a named actor/time and a reviewed staff revision. A concurrent staff edit changes the association revision; it does not require repeating the already completed native engine operation.

The supported native operations are status, inspect-delivery, review-import, import, review-pair, save-pair, run, decision, report, request, resume, read, page, row, export, and receive. Read the full body contracts in the paired guide. Native request IDs and native workspace IDs retain their original formats; the staff adapter maps only the outer UUID where documented.

## Full downloads and receiving

Archive download requires exact expected bytes and SHA returned by the original export. Provide a chunk consumer that writes all bytes, fsyncs and atomically publishes its file. A dispatch report is HTML; a source blob is arbitrary original bytes. download returns the observed whole-file byte count, SHA and media type after every chunk is consumed.

Upload the complete archive, then call receive with the same hash/size and a fixed receiving UUID. The native receiver imports every command, result, state, blob, source file and publication. Repeating the same receiving operation verifies its original prefix and preserves legitimate later edits. The receiving directory is returned by that operation; configure another Application/client with that exact directory and the preserved logical UUID.

## Agent attachment

The host writes a private JSON configuration:

    {
      "schema": "stellar-forge.highway-field-operations-workspaces.v1",
      "storageDirectory": "/absolute/private/file-reads",
      "workspaces": {
        "original": {
          "connectionFile": "/absolute/private/workspace/highway-field-operations-connection.json",
          "workspaceId": "<actual UUID>",
          "workspaceDirectory": "/absolute/private/workspace"
        }
      },
      "files": {
        "selected-source": {
          "path": "/absolute/selected/original-source.bin",
          "bytes": 123,
          "sha256": "<actual 64-hex SHA>"
        }
      }
    }

The numbers/placeholders illustrate the schema; replace them with the measured existing file. The service configuration input is highwayFieldConnection, family highwayField, provider highway-field-workspaces. Host-selected file aliases preserve actual bytes and paths; the agent cannot choose arbitrary files through an upload request.

Every scoped tool takes workspace alias, workspaceId and workspaceDirectory. All tools use the merchant_highway_ prefix. The nineteen suffixes are workspaces, state, history, request, records, inspection, command, upload, prepare_dataset, native, native_request, restore_native, export, receive, file_read, file_release, field_issue, field_compare, and field_document.

file_read uses the existing retained reader: retain readId and file identity, consume base64 bytes through nextOffset:null, then release. It supports exact source blobs, complete exports and dispatch HTML. The owner drains calls and readers on close, without stopping Applications or closing a separately owned workspace.

## Delivery state

The standalone selection includes the full original application, original Python paired engine, original two-file SF30/SF100 producer, all guides, managed lifecycle, SDK, agent tools and the following managed course. The original Geocove operation's 20 completed phases remain on source 16b651c6. This integration's successor source is recorded independently in ADOPTION.json and app/source-selection.json.

Source publication is not an executed native result. MANAGED_RECEIVING.md describes the complete same-operation following course, actual browser operation and customer archive. Review the returned images before stating pixel QA passed.

## Named field exchange API

The methods below use the same original connection, logical workspace ID and exact physical directory. They add no owner or database. Each input is frozen before asynchronous dispatch.

| Method | Complete contract |
| --- | --- |
| fieldIssue(request, expectedRevision) | Original preparation request {id,recipient,inspectionIds,workspaceRevision,stateSha256,note,actor,at}; id is both issue and request UUID. Returns the original command result plus issue document/html descriptors. |
| fieldComparison(returnId, editionId?, adoptionId?) | Full current issued/current/returned comparison, current source/assignment, actual selected edition and review SHA. Omit editionId only to use the return's actual selected edition. |
| fieldDocument('issues' or 'returns', recordId) | Complete retained record and parsed original document; exact original bytes are downloaded separately. |
| uploadBytes('field-file', buffer, identity) | Validate the complete original return and retain all original source/addition bytes before any field.receive command. Returns exact file identity, issue ID, editions and draft availability. |
| uploadFile('field-file', path, identity) | Same intake over the caller's exact bounded original local file, streamed to the borrowed owner. |
| command(fieldReceiveCommand, expectedRevision) | Original field.receive envelope binds returned file SHA/bytes and original issue. |
| command(fieldAdoptCommand, expectedRevision) | Original field.adopt envelope binds complete current comparison SHA and each explicit inspection decision. |
| download({kind:'field-issue-json' or 'field-issue-html' or 'field-return',id,expectedSha256,expectedBytes}, onChunk) | Every exact byte of the original issued/returned file, with required expected descriptor verified after full streaming. |

A parsed document is useful for inspection. It is not a substitute for the complete original HTML/JSON bytes. Preserve the actual descriptor and use download for onward copies. All field files use the original 64 MiB allowance. Issue JSON and editable HTML and every new return member are capacity-checked as a whole before original blob retention.

A typical caller retains an original request, calls fieldIssue once and saves the complete result. It downloads each returned descriptor, then delivers the original file through the agreed human workflow. Later it retains the colleague's file and its full descriptor, uploads it with kind field-file, and saves a fixed field.receive command before sending that command. Only after an explicit actual comparison does it save a field.adopt command with that comparison's SHA and reviewed choices. See app/FIELD_EXCHANGE.md for complete commands, timestamps and unfinished-draft behavior.

The additive merchant tools are merchant_highway_field_issue, merchant_highway_field_compare and merchant_highway_field_document. Existing merchant_highway_upload accepts field-file; merchant_highway_command handles exact field.receive and field.adopt envelopes; merchant_highway_file_read accepts all three field download kinds and the mandatory expected descriptor. Follow its original readId/offset sequence through every byte and release the reader. Host file aliases remain explicit original file selections.

The file reader names a returned JSON or HTML according to the actual native content type. Both original issued formats and complete returned files remain downloadable after whole-workspace receiving. A local field draft, request or file reader never follows another selected physical directory automatically.

Pass the original adoptionId as fieldComparison's third argument to reopen the exact comparison behind a saved adoption. The result carries readOnly:true, historicalAdoption and the original workspaceRevision. It is recomputed from the retained original state and checked against the saved review SHA; it cannot replace the current comparison used for a new adoption.
