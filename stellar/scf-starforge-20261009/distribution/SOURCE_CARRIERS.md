# Complete Git source carriers

This workflow retains a complete original public Git source when a receiving environment can accept small HTTPS files but cannot fetch the whole repository. It uses the existing GitHub and Notion tool adapters to create source-only Git trees, expose their immutable ZIP URLs, attach the returned files to the original destination, and produce the exact index consumed by the maintained Git source receiver.

The original source commit, recursive tree, file bytes, modes, and paths remain the source authority. The receiver reconstructs those Git objects in its existing bare cache. The original distribution builder then selects and packages the product from that cache.

## Files and commands

| Source | Responsibility |
| --- | --- |
| source-carrier-producer.mjs | Pure preparation, exact v1 plans/manifests/index, existing provider calls, original receipt adoption, source/page publication |
| source-carrier-cli.mjs | Private operation directory, complete input retention, process-lifetime locking, atomic continuation, compact status |
| source-carrier-input.schema.json | Complete native preparation input |
| contributions/source-carriers.json | Source-owned source-carrier command and library export |
| git-object-receiving.py | Existing exact Git object receiving, cache continuation, optional materialization |
| GIT_OBJECT_RECEIVING.md | Maintained receiving contract and original donor-cache path |

Use the direct source command from an existing toolkit checkout:

~~~sh
node /ABS/TOOLKIT/stellar/scf-starforge-20261009/distribution/source-carrier-cli.mjs --help
~~~

An installed distribution that includes the source-carriers contribution also registers the same command as source-carrier. When the installation is private, invoke it through that installation's existing runtime launcher.

The producer uses Node built-ins. Node 22.16 or newer provides the native CLI's SQLite operation lock. The Python receiver continues to use its original Python/Git runtime. The CLI loads only the host's explicitly supplied existing tool adapter.

## 1. Prepare the original input

Select the exact original public repository and 40-character source commit. Reuse the original stable operation ID, branch names, filename prefix, and destination for every continuation. Keep the operation directory private because it contains full provider replies and temporary upload identities.

Create an input JSON file using this structure; replace each marked value with the actual original identity:

~~~json
{
  "schema": "stellar-forge.git-source-carrier-input.v1",
  "operationId": "ORIGINAL_OPERATION_ID",
  "repository": "OWNER/REPOSITORY",
  "commit": "ACTUAL_40_CHARACTER_COMMIT_SHA",
  "pageId": "ACTUAL_EXISTING_DESTINATION_PAGE_ID",
  "branchPrefix": "source/ORIGINAL_UNIQUE_SOURCE_ID-part-",
  "filenamePrefix": "Original_Source_UNIQUE_SOURCE_ID",
  "maxSourceBytes": 4000000,
  "commitFile": "SOURCE-COMMIT.json",
  "treeFile": "SOURCE-TREE.json",
  "attributeFiles": {}
}
~~~

The two authority files are the **complete original UTF-8 response bodies** from:

- GET /repos/OWNER/REPOSITORY/git/commits/COMMIT
- GET /repos/OWNER/REPOSITORY/git/trees/TREE?recursive=1

Preserve the response text exactly. Parsing and then serializing those files changes their authority-file hashes. The commit must name the returned tree; the tree response must include truncated:false and every original regular file. Source paths and Git modes are retained from that response.

For every original .gitattributes file, add its original Git path to attributeFiles with the path of its exact local UTF-8 content. Local paths resolve beside the input JSON file. The producer checks the content's Git blob ID against the original tree. An input without attribute files still retains an empty map.

Prepare from the captured local authorities:

~~~sh
node /ABS/TOOLKIT/stellar/scf-starforge-20261009/distribution/source-carrier-cli.mjs prepare \
  --directory /ABS/ORIGINAL_SOURCE_OPERATION \
  --input /ABS/ORIGINAL_INPUT.json
~~~

Alternatively, omit commitFile, treeFile, and attributeFiles, then let the existing Git adapter receive those same immutable source authorities:

~~~sh
node /ABS/TOOLKIT/stellar/scf-starforge-20261009/distribution/source-carrier-cli.mjs prepare \
  --directory /ABS/ORIGINAL_SOURCE_OPERATION \
  --input /ABS/ORIGINAL_INPUT.json \
  --adapter /ABS/EXISTING_CONNECTED_TOOLS.mjs
~~~

That preparation performs original source reads. It checks the repository's current public identity, reads the exact commit and complete tree, and fetches only the original archive-attribute blobs. Other original source files are represented by their existing Git blob IDs.

### Continue an existing accepted transfer

Add retainedStateFile to the preparation input when adopting an already completed or partly completed v1 producer state:

~~~json
{
  "retainedStateFile": "source-carrier-state.json"
}
~~~

This field belongs alongside the other input properties. The received state must name the exact same source, part manifests, branch names, filenames, and destination. Its original blob/tree/commit/upload/file references are preserved. The original state bytes are separately retained as received-state.json.

An already attached complete transfer can be reopened and indexed without provider calls. Keep its original index and carrier identities; do not create replacement parts merely to adopt this maintained tool.

### Archive representation and capacity

The producer preserves regular source files with Git modes 100644 and 100755. The existing receiver supports up to 2 MiB per original source file, 128 MiB of total original source, and 8 MiB per authority response. The default partition contains at most 4,000,000 uncompressed original source bytes.

The current attachment profile accepts actual ZIPs up to 5 MiB. Each upload receipt must return its actual byte count within that limit. Source bytes and final compressed ZIP bytes are separate measurements; filenames, manifests, directories, compression and ZIP metadata also affect the latter.

Git archive honors export-ignore and export-subst from .gitattributes; these can omit or change archived bytes. The producer detects those declarations before publication and directs that source through the existing direct Git/object receiving route. Source filtering cannot silently drop original files. See the [official Git archive attribute contract](https://git-scm.com/docs/git-archive#ATTRIBUTES).

SOURCE-PART.json is reserved as the root manifest name in every carrier. The original tree must not use that same root path. Original binary regular files are retained by Git blob identity and carried byte-for-byte; the producer does not decode them.

## 2. Bind the existing tool adapter

The native adapter module exports the existing tools object:

~~~js
// This module lives on the authorized original host.
// Import its already installed connected-tool router.
import { tools } from '/ABS/ORIGINAL_CONNECTED_TOOL_ROUTER.mjs';
export { tools };

// Optional: close this invocation's owned adapter connections.
export async function close() {}
~~~

Use the actual original router module and lifecycle. The producer does not install a gateway, create a listener, select a new account, or set credentials. The caller owns the authorized account and destination bindings.

Every tool method accepts one object and returns its **complete original MCP result**, including isError, structuredContent, content and returned asynchronous task or provider IDs. Preserve nested errors and original Git response text. The native CLI records the adapter's actual source path and SHA-256 in its private state.

| Existing adapter method | Exact operation and fields used |
| --- | --- |
| mcp__codex_apps__github_fetch | url; actual repository metadata, exact commit/tree/blob text, original branch readback |
| mcp__codex_apps__github_create_blob | repository_full_name, content, encoding:"utf-8" |
| mcp__codex_apps__github_create_tree | repository_full_name, tree_elements; no base tree for a source-only carrier |
| mcp__codex_apps__github_create_commit | repository_full_name, parent_sha, tree_sha, message |
| mcp__codex_apps__github_create_branch | repository_full_name, branch_name, sha; create-only original branch semantics |
| mcp__codex_apps__notion_fetch | id of the original existing page |
| mcp__codex_apps__notion_notion_create_attachment | source_url/filename/content_type for ZIPs; content/filename/content_type for the small complete JSON index |
| mcp__codex_apps__notion_notion_update_page | page_id, command:"insert_content", position:{type:"end"}, content, allow_async:false |

Git API JSON and decoded Git text blobs must be available in structuredContent.content as complete UTF-8 text. Blob/tree/commit creation must return the original sha; branch creation returns branch. An absent original branch is recognized only from the actual NOT_FOUND/404 response. Other permission or provider errors stay intact.

A ZIP attachment must return status:"uploaded", filename, content_length and markdown_source. Its original file-upload identity is retained privately until the page returns the stable notion-file-block reference. Notion fetch must return its full page text. The file block markup and update-page sequence use the same existing connector contract.

Git tree/commit objects are created in the **same public source repository**. The producer reads an existing branch before creation and preserves a different existing head. Carrier branches remain separate source-transport refs; they do not replace or merge into the product's main branch. Continue using the repository's existing zero-spend workflow configuration.

## 3. Publish, attach, and retain the complete index

Run the original source publication:

~~~sh
node /ABS/TOOLKIT/stellar/scf-starforge-20261009/distribution/source-carrier-cli.mjs publish \
  --directory /ABS/ORIGINAL_SOURCE_OPERATION \
  --adapter /ABS/EXISTING_CONNECTED_TOOLS.mjs
~~~

This checks the current original public repository and destination page, then continues the retained sequence:

1. Create/adopt the two exact authority JSON blobs.
2. Create/adopt each exact SOURCE-PART.json blob.
3. Create the source-only tree from original blob IDs and modes.
4. Create the carrier commit with the original source commit as its parent.
5. Create or read back its exact original branch.
6. Upload the ZIP from https://codeload.github.com/OWNER/REPOSITORY/zip/CARRIER_COMMIT.

No full original source blob download is needed for publication. The authority part carries the original commit/tree API bodies; each remaining part contains an ordered, non-overlapping part of the complete original file inventory.

Attach those original uploads promptly:

~~~sh
node /ABS/TOOLKIT/stellar/scf-starforge-20261009/distribution/source-carrier-cli.mjs attach \
  --directory /ABS/ORIGINAL_SOURCE_OPERATION \
  --adapter /ABS/EXISTING_CONNECTED_TOOLS.mjs
~~~

The connector's uploaded files have a temporary lifetime until attached. The operation reads the original page, appends only the selected missing files, preserves all existing page content, and reads every actual stable file reference back. Same-name files that predate this operation are treated as a receiving ambiguity rather than replaced.

The completed receiving index is written beside the original state as FILENAME_PREFIX_TRANSFER.json. It can also be written explicitly through the index command:

~~~sh
node /ABS/TOOLKIT/stellar/scf-starforge-20261009/distribution/source-carrier-cli.mjs index \
  --directory /ABS/ORIGINAL_SOURCE_OPERATION \
  --output /ABS/ORIGINAL_RECEIVING/SOURCE_TRANSFER.json
~~~

The output's parent directory must already exist. An existing byte-identical index is reused; a different existing file is preserved.

Retain the same complete small index on the original destination:

~~~sh
node /ABS/TOOLKIT/stellar/scf-starforge-20261009/distribution/source-carrier-cli.mjs publish-index \
  --directory /ABS/ORIGINAL_SOURCE_OPERATION \
  --adapter /ABS/EXISTING_CONNECTED_TOOLS.mjs
~~~

This records its own upload/page operations and stable file reference. The text adapter accepts up to 200 KiB; a larger complete index uses the existing full-file attachment route. Keep the index complete. A transfer can contain many source archives, but receiving still uses one exact index and one original Git source identity.

## 4. Continue the same operation after interruption

The operation directory contains:

| File | Retained meaning |
| --- | --- |
| input.json | Exact original preparation input |
| SOURCE-COMMIT.json / SOURCE-TREE.json | Exact original Git authority response bodies |
| archive-attributes.json | Original reviewed .gitattributes content |
| plan.json | Frozen complete part plan and exact manifest strings |
| received-state.json | Original adopted v1 state, when supplied |
| state.json | Current complete provider results, original IDs, pending operations and destination references |
| operation.json | Original immutable source/input/plan binding and first preparation time |
| operation-lock.sqlite3 | Native process-lifetime writer exclusion |
| FILENAME_PREFIX_TRANSFER.json | Complete receiving index once every source part is attached |

The native CLI takes a real SQLite write transaction for a mutation's lifetime. The kernel releases it when the process exits; recovery does not interpret another process's PID. JSON publication uses a unique same-directory temporary, fsync and directory sync. Immutable files are published through an exclusive hard link; if the destination already exists, its complete bytes must match, so a concurrent operation's different index remains intact. Mutable state uses atomic replacement. A reused PID cannot collide with an old temporary filename.

Preparation adopts the original retained authority/plan files and first operation descriptor after a partial write. Re-running the exact original prepare input completes that same preparation. Its input and source hashes must agree.

Inspect compact current progress:

~~~sh
node /ABS/TOOLKIT/stellar/scf-starforge-20261009/distribution/source-carrier-cli.mjs status \
  --directory /ABS/ORIGINAL_SOURCE_OPERATION
~~~

Before each provider mutation, state.json records its stable key, exact argument SHA-256 and DISPATCHING state. The full returned MCP result is retained before the workflow advances. A thrown transport error leaves UNCERTAIN. Returned provider errors remain returned errors.

After a lost response, obtain the **actual result of that original call** from the original connected-tool operation journal. Adopt it with its original key:

~~~sh
node /ABS/TOOLKIT/stellar/scf-starforge-20261009/distribution/source-carrier-cli.mjs adopt-outcome \
  --directory /ABS/ORIGINAL_SOURCE_OPERATION \
  --key 'commit:3' \
  --receipt /ABS/ORIGINAL_NATIVE_CALL_RESULT.json
~~~

The receipt is the complete original MCP result. Adoption changes neither the name nor the argument hash. An already returned result must match exactly. The next normal command validates its returned source/part identity and advances from that saved stage.

For an uncertain branch creation, a fresh original branch read can establish that it already points to the retained carrier commit. For an uncertain page write, the original page's new stable file references can complete the retained append. Neither path creates a replacement commit or upload.

If update-page returns an asynchronous task, use the existing adapter's task reader to follow that **same task**, then run attach or publish-index again. A fresh page read adopts the completed operation. Do not issue another page mutation while that original operation is pending.

A returned permission denial or automatic approval rejection is retained as such. The tool has no reset/force/recreate command that turns that response into a retry. Use the original authorization and provider recovery path for the exact action. Likewise, a confirmed expired temporary upload needs its original provider lifecycle handled explicitly; a file's age alone is not a new successful upload.

Keep the complete private state in the original authorized delivery surface. Publish reusable source code separately from operation state, temporary upload identities and host bindings.

## 5. Receive the exact source and build the product

The receiving index uses schema stellar-forge.git-source-transfer.v1. Its source contains the original repository, commit, tree, fileCount and sourceBytes. Each part names:

- Original part number/kind and relative ZIP filename.
- Actual uploaded archive byte count and immutable public codeload URL.
- Carrier commit/tree and manifest Git blob.
- Exact manifest byte count and SHA-256.
- Original source file/byte counts in that part.
- The actual stable destination-file reference.

An archive's SHA-256 is established from its actual downloaded bytes by the receiver/download operation. It is not inferred from the Git commit or guessed from a URL.

Receive each ZIP into the same directory as the complete index using the existing authorized file downloader, the original stable Notion file references, or the exact immutable public sourceUrl values. Fresh signed file URLs belong to the existing private transport and expire independently of the retained Git identities. Keep actual download receipts and use the same partial-file continuation.

Run the maintained receiver:

~~~sh
python3 /ABS/TOOLKIT/stellar/scf-starforge-20261009/distribution/git-object-receiving.py \
  --source-transfer /ABS/ORIGINAL_RECEIVING/SOURCE_TRANSFER.json \
  --commit ACTUAL_ORIGINAL_SOURCE_COMMIT \
  --directory /ABS/ORIGINAL_SOURCE_CACHE
~~~

Use its existing --materialize option only when the original receiving task needs a loose checkout. The receiver otherwise preserves a complete bare Git cache that the original builder can use directly.

The receiver validates the original signed commit payload, every original tree, every manifested carrier tree and blob, archive membership, raw file bytes, modes and complete original inventory. It records completed part hashes and reuses verified original objects on continuation. ZIP members are read as source objects, keeping archive paths out of arbitrary extraction operations.

Then use the original distribution build operation and the actual selected product recipe. Point the builder's existing sourceCache input to this received cache and retain its original repository/commit, output, operation and selection. The source-carrier producer adds transport; product selection, native dependencies, customer receiving and runtime installation stay in their original engines.

## Library API

The module is also exported as ./distribution/source-carriers.

| Export | Contract |
| --- | --- |
| prepareSourceCarrier(input) | Exact commit/tree text, source identity, original names, optional original attribute content → frozen v1 plan |
| createSourceCarrierState(plan, options) | Original operationId/pageId → initial v1 state |
| receiveSourceCarrierAuthorities(input) | Exact public repository/commit plus existing tools → original commit/tree text and attribute content |
| publishSourceCarrier(input) | Original plan/state/authorityText/tools/persist → retained Git and ZIP publication |
| attachSourceCarrier(input) | Original plan/state/pageId/tools/persist → exact complete index after page readback |
| finalizeSourceCarrierIndex(plan, state) | Pure complete v1 receiving-index projection |
| publishSourceCarrierIndex(input) | Retain the exact completed index on that same page |
| adoptSourceCarrierOutcome(input) | Actual original pending call result → retained same-key outcome |
| assertSourceCarrierPlan / assertSourceCarrierState | Validate the full original plan and receipt identity |
| sourceCarrierTextInfo / sourceCarrierGitText | UTF-8 byte/SHA-256 descriptor and untouched original Git text extraction |

The caller must durably save every persist(state) callback before it resolves and serialize mutations of the same operation. The native CLI supplies those properties. The direct library API can use an already established operation ledger and tool router without adding another runtime.
