# Managed Curriculum Migration SDK and customer-agent tools

This SDK operates the original Curriculum Migration Workbench through its already running Runtime Application. The managed client owns no additional store, HTTP server or browser. The application retains the original model, curriculum coverage engine, occurrence planner and source-derived SDK generator.

Two interfaces serve different work. **CurriculumMigrationClient** reads and changes the saved engineering workspace. **client.ts**, generated from a selected retained contract edition, makes the original 32 Oak API requests. Generating that client does not acquire an actual response or bulk dataset. See app/SDK_GUIDE.md for its complete operation table, authentication, request parameters, error bodies and 302 behavior.

The public source selection is 0d327292684c56e52b45913e9acb5bb2efc6d7feb2a19f4ece489706fb432579. The exact original 20 files remain in app/. The source baseline retains 25 published response examples, the bulk schema, the 110 relation-like GraphQL names/descriptions without field definitions, and the exact original view constants. Supplied SQL, Hasura metadata, Drizzle modules and full introspection remain separate retained source assets.

## Connect to the existing Application

Use the private connection file emitted by Applications kind curriculum-migration-workbench. Keep the actual physical store UUID and canonical directory from its creation/identity receipt. A physical branch ID selects a working copy; its portable workspace ID is deliberately preserved when the workspace is received elsewhere.

    import {createCurriculumMigrationClient}
      from './products/curriculum-migration-workbench/client.mjs';

    const client = createCurriculumMigrationClient({
      connectionFile: selectedConnectionFile,
      storeId: selectedPhysicalStoreId,
      storeDirectory: selectedPhysicalStoreDirectory
    });
    try {
      const identity = await client.state();
      const branches = await client.branches();
      const current = await client.branch(selectedPhysicalBranchId);
      // current.snapshot is the complete flat original Workspace.
    } finally {
      await client.close();
    }

In an installed package, use its exported subpath curriculum-migration-workbench/client. client.d.mts describes the complete original workspace, response, comparison, curriculum plan, command and returned envelopes.

The client verifies the private connection, original process identity, physical store, loopback origin and source selection. Each request carries both store headers and the private bearer capability. It never redirects that capability. Await each call before using the same client again; a concurrent call receives CLIENT_BUSY. close() rejects new calls and drains every accepted call. It does not stop the Application.

## Select one exact working revision

A branch response contains id, storeId, workspaceId, revision, snapshotSha256, label, origin, timestamps and snapshot. Selected calls use:

    const selected = {
      id: branch.id,
      expected: {
        workspaceId: branch.workspaceId,
        revision: branch.revision,
        snapshotSha256: branch.snapshotSha256
      }
    };

Use these three values together. A later edit in that physical branch makes a new selected read or mutation stale. Preserve the old request rather than silently substituting current values during a retry. After an exact request replay, read branch(id) again: the replay correctly returns its first original result, which may precede later edits.

## Original commands and complete results

command({requestId,id,expected,command}) invokes the original Model or Curriculum function. command is {kind,actor,at,body}; actor is the operating engineer's string, and at is the selected actual ISO timestamp. Retain the complete envelope and request UUID before dispatch.

| kind | body |
| --- | --- |
| addEdition | {edition} with the complete retained source edition |
| addCase | {case:{id,name,operationKey,sourceEditionId,targetEditionId,request?}} |
| updateCase | {caseId,patch}; patch may select name, request, mappings, arrayKeys or targetEditionId |
| saveResponse | {caseId,lane,response}; lane is original or candidate |
| compareCase | {caseId} |
| decide | {caseId,decision:{runId,outcome,note}} |
| addAsset | {asset:{id,name,kind,content,...}} |
| planCurriculumCase | {caseId,options:{namespaces:{original,candidate},mappings}} |
| decideCurriculumPlan | {caseId,decision:{planId,outcome,note}} |

A retained response contains actual status, full JSON body, provenance {kind,label,...}, and supplied headers/contentType. Preserve published-example, operator-file and captured-http meaning. The model retains parsed JSON; separately retain raw source files and their receipts where lexical bytes matter.

The result is {branch,result,replayed:false}. result contains kind, revision and the applicable caseId, editionId, assetId, runId or planId. An exact retry returns this same original envelope, including replayed:false. It does not execute the business action again. A changed body with the same UUID is rejected.

Field transformations are explicit copy/move/omit/constant mappings with JSON Pointers and reasons. Array ordering remains significant unless a selected collection has an explicit stable key. Occurrence mappings use exact unit/lesson pointers and distinct namespaces. Recording accepted is an engineering decision attached to a current run or plan; it does not remove differences or prove that a migration was deployed.

## File-backed source and response intake

All file methods read a caller-selected absolute regular file, verify its complete byte count and SHA-256, decode UTF-8 strictly, then invoke the original model route with the supplied request identity. No implicit external API fetch occurs.

- importAssetFile(input,path,descriptor) requires an addAsset command with id/name/kind metadata. Exact decoded text becomes asset.content.
- importResponseFile(input,path,descriptor) requires saveResponse with caseId, lane and response status/provenance/headers. Parsed file JSON becomes response.body.
- importEditionFile(input,path,descriptor) requires addEdition context; the complete parsed edition becomes its body.
- receiveFile({requestId,id,label,origin?},path,descriptor) receives an original workspace or its portable packet into the supplied new physical branch.

descriptor is {bytes,sha256}. A retained source/response/edition input or complete receiving file is bounded at 128 MiB; the actual resulting whole workspace must also fit 128 MiB. Importing a large file into an already large workspace can therefore reject while preserving the previous complete state. Fixed published application source files use the separate 16 MiB bound.

Here is the real request sequence using an already retained operation file. The operation file owns the UUID and exact expected revision; this script does not generate replacement request identities on restart.

    import {readFile} from 'node:fs/promises';
    import {createCurriculumMigrationClient}
      from './products/curriculum-migration-workbench/client.mjs';

    const operation = JSON.parse(await readFile(process.argv[2], 'utf8'));
    const client = createCurriculumMigrationClient(operation.connection);
    try {
      const original = await client.request(operation.input.requestId);
      // Repeating the exact file-backed command also checks the original input.
      const result = await client.importResponseFile(
        operation.input, operation.file.path,
        {bytes: operation.file.bytes, sha256: operation.file.sha256}
      );
      const current = await client.branch(result.branch.id);
      console.log(JSON.stringify({original, result, current}));
    } finally {
      await client.close();
    }

operation.input is the full CommandInput described above; operation.file points to the original returned response. Create the later compareCase and decision operations from the returned current branch and preserve those complete inputs separately before their effects. Do not substitute a published example while labeling it as a customer response.

## Reports, history and full downloads

report({id,expected,kind,options}) returns {branch,kind,result}. branch is its complete summary at the selected revision.

| Report | options and full result |
| --- | --- |
| portfolio | no options; original case state/decision rows |
| curriculumPortfolio | no options; complete BULK planning state |
| case | {caseId}; complete case, responses, mappings, runs and decisions |
| sourceInventory | {editionId}; original operations, relation names/known fields, view constants and original source |
| curriculumPlan | {caseId,planId}; full saved plan |
| curriculumReviewRows | {caseId,planId}; every original coverage/change/ambiguity/schema/HTTP finding |
| sdk | {editionId}; original files/client/types/inventory/diagnostics plus editionId and descriptors |

sdk.descriptors lists {path,bytes,sha256} for client.ts, types.ts and inventory.json. Use these descriptors to download exactly the generated files for that selected edition:

    const sdk = await client.report({
      ...selected, kind: 'sdk', options: {editionId}
    });
    for (const descriptor of sdk.result.descriptors) {
      await client.download({
        ...selected, kind: 'sdkFile',
        options: {editionId, path: descriptor.path}
      }, chunk => outputFor(descriptor.path).write(chunk), descriptor);
    }

outputFor is the delivery owner's retained output writer. It must await complete writes, close and preserve the final file only after the returned bytes/hash match. The client verifies the complete response itself; the callback receives original byte chunks. Its own partial file remains the caller's responsibility on an interrupted transfer.

download returns {bytes,sha256,mediaType} after checking the original binary headers, selected branch identity, complete length and final hash. Every byte is delivered to the callback. Supported kinds are:

| kind | options |
| --- | --- |
| workspace | none; full original portable packet |
| report | {kind,options}; complete raw report value |
| sdkFile | {editionId,path} |
| sourceEdition | {editionId}; complete retained edition |
| response | {caseId,lane}; full retained response metadata and body |
| case | {caseId}; complete case |

downloadAsset({...selected,assetId},onChunk,descriptor?) returns exact retained UTF-8 source asset bytes. downloadApplicationSource(path,onChunk,descriptor?) returns one fixed original application file by its source-selected relative path. The latter never exports live browser DOM or service credentials.

exportBranch(selected) returns the complete portable JSON value directly. Its SHA is over the canonical original flat workspace, which contains source editions, cases, assets and full history. Receiving verifies this value through the original enhanced receiver, including recomputation of every retained curriculum plan.

historyPage({...selected,offset,limit}) returns id, workspaceId, revision, snapshotSha256, total, offset, nextOffset and full items. limit is at most 200. history({...selected,limit}) walks all original pages, holding the exact expectation and checking stable totals and contiguous offsets:

    const history = [];
    for await (const page of client.history({...selected, limit: 100})) {
      history.push(...page.items);
    }

Complete case/asset/edition records are already in branch.snapshot. The agent exposes bounded pages for those collections so a large returned tool envelope need not truncate them.

## Original request recovery

A transport error or an incomplete response can occur after the server committed the original operation. CurriculumMigrationError exposes code, status, result, uncertain and requestId. A server-confirmed notCommitted:true means the serialized owner verified that this request is absent; other failures leave the original outcome unresolved.

Read request(originalUuid). A returned receipt includes the full normalized input, its byte/hash descriptor, sequence and full original result. Re-dispatching the exact original body performs the server's input comparison and returns that result. A null read is an observation of absence at that moment, not permission to change the original input and reuse its UUID.

Input objects, expected descriptors and paging selections are copied synchronously at each public SDK boundary, before asynchronous connection reads. Mutating a caller object after invoking the method cannot select another upload or mislabel an uncertain request.

## Customer-agent configuration

Use the maintained merchant provider family curriculumMigration with input curriculumMigrationConnection. The input is a private JSON configuration file:

    {
      "schema": "stellar-forge.curriculum-migration-workspaces.v1",
      "storageDirectory": "/absolute/private/curriculum-agent-files",
      "stores": {
        "selected": {
          "label": "Selected curriculum workbench",
          "connectionFile": "/absolute/private/store/connection.json",
          "storeId": "actual-store-uuid",
          "storeDirectory": "/absolute/private/store",
          "timeoutMs": 300000
        }
      },
      "files": {
        "candidate": {
          "path": "/absolute/retained/candidate.json",
          "bytes": 1234,
          "sha256": "actual-complete-sha256",
          "label": "Original authorized candidate response"
        }
      }
    }

Replace illustrative identities, byte counts and hashes with actual saved receipts. Configuration-relative file/directory paths resolve against the configuration file's parent. The configured transfer directory must already be private. The file aliases permit complete file input without disclosing an arbitrary filesystem reader to the agent.

MerchantCurriculumMigration receives {curriculumMigration: await readCurriculumMigrationConfiguration(path)}. Its tools use the configured alias plus actual storeId and storeDirectory. Selected operations additionally require branchId and the full expected triple.

| Tool suffix after merchant_curriculum_migration_ | Behavior |
| --- | --- |
| stores | configured stores and original source file descriptors |
| state | authenticated identity and current branch summaries |
| branch | selected full identity/counts and source descriptors |
| records | complete paged editions/cases/assets/history; or caseId-scoped runs/decisions/curriculumPlans/curriculumDecisions |
| history | original complete model-history pages |
| request | original full request input and first result |
| command | an exact original model/curriculum operation |
| report | the full selected original report |
| receive | host-file receiving into a new physical branch |
| import_file | complete host-file addAsset/saveResponse/addEdition |
| file_read | workspace/report/SDK/source edition/response/case/asset/history/applicationSource bytes |
| file_release | release that branch's retained file reader |

For file_read, selection is {kind,options?,assetId?,path?,bytes?,sha256?}. Portable files use kind workspace. The first call returns the maintained reader's readId and complete file descriptor with the chunk; follow its original nextOffset until completion. Preserve readId, physical scope, exact selection and original expected SHA between chunks. Release the reader afterward. The provider owns a read-only file handle for the complete original bytes, so another tool call cannot substitute a moving file underneath that reader.

The agent provider snapshots public arguments, independently drains outstanding calls and closes its retained file readers. It borrows the running Application and does not acquire another lifetime store lease.

## Delivery and operational limits

Use OPERATING.md for managed creation/start/stop and the Installation workorder. MANAGED_RECEIVING.md describes the one complete managed course; its source carries the original operation, complete reports/files, physical branch receiving and browser ownership. Existing actual native outputs remain separate from later source-only changes.

The default public case exercises the published example as explicitly labeled verification reuse. A true bulk receiving run requires actual complete original and candidate data and reviewed choices. PENDING_INPUT remains meaningful when those inputs have not arrived. Rendered normal/narrow views, operated controls, downloaded outputs and independent reopen are recorded only when an actual host completes them.

Neither this workspace SDK nor the customer-agent tools deploy a migration, publish curriculum content, acquire privileged source automatically, or send customer messages. Their durable output is the complete source-backed engineering case and its usable independent receiving.
