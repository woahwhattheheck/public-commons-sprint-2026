# Receive complete research editions

The receiver opens one or more original OpenAlex research edition exports in a new private workspace. It uses the existing research reader, review engine and browser. Query revisions, edition IDs, received page bytes, original native buyer-result records and decisions retain their original identities.

This is the receiving half of the [research export workflow](README.md). A delivery can contain both captures of two queries, so the recipient can reopen the original comparison and review selections together.

## Prepare the source delivery

In the originating research workspace, export each selected edition with its full default contents:

~~~bash
node sf88-operator-buyer-cli/research/cli.mjs export \
  --workspace /private/original-research \
  --edition-id first-edition \
  --out /private/delivery/first-edition

node sf88-operator-buyer-cli/research/cli.mjs export \
  --workspace /private/original-research \
  --edition-id comparison-edition \
  --out /private/delivery/comparison-edition
~~~

Keep each whole exported directory together. The receiver consumes its original manifest, query, edition, coverage, review decisions, page index and original page files. Native buyer results are required wherever the original page records one. Reports and bibliographies are also checked against the supplied manifest.

The source package retains an exact selected query revision. When multiple editions include different revisions of the same query, those revisions are restored together; the highest supplied revision becomes the current query. Other revisions remain with their original source workspace or their own exported editions.

## Inspect the delivery

Run in the maintained source tree with its existing Node dependencies:

~~~bash
node sf88-operator-buyer-cli/research/receive-cli.mjs inspect \
  --source /private/delivery/first-edition \
  --source /private/delivery/comparison-edition
~~~

Inspection reads every declared file, checks its byte count and SHA-256, and returns the selected edition/query identities, source coverage, total size and stable delivery hash. It checks the complete page/native-result inventory and rejects conflicting exports of the same edition or query revision.

Use the reported source coverage when selecting a delivery. A valid partial edition retains the same partial cursor history for research review; completeness is recomputed by the original reader during receiving. Original pending provider calls, signer state and a provider-account ledger are separate operator state. Configure subsequent acquisition through the original operator and its saved runtime; the receiver itself starts no acquisition.

## Receive into a new workspace

The receiving command uses Python 3's standard library to call the Linux atomic create-only directory rename. The rest of the workflow uses the existing Node runtime and util-linux flock requirement.

~~~bash
node sf88-operator-buyer-cli/research/receive-cli.mjs receive \
  --source /private/delivery/first-edition \
  --source /private/delivery/comparison-edition \
  --workspace /private/received-research
~~~

The destination must be new, or the completed destination of the same receiving operation. The command constructs its candidate in a private sibling directory, reads the original edition through the maintained research engine, and publishes the complete workspace atomically. An existing unrelated directory is preserved.

The receiver preserves:

| Retained material | Native destination |
|---|---|
| Each exact query snapshot | Original query revision file and edition query snapshot |
| Highest supplied revision per query | Current query file |
| Original edition identity and label | Original edition record |
| Source responses, requests and page metadata | Original numbered page directories |
| Existing buyer-result records | Their original page identity |
| Review status, notes, tags and revision | Original edition decisions |
| Original export manifests | Received-manifests directory |
| Delivery identity and receiving result | received-edition.json |

The receiving record lists which query revisions and source manifests were included. Original reader validation checks the complete cursor chain, page hashes, source metadata, native-result relationship and review records. The source directory stays intact.

## Reopen in the original researcher interface

~~~bash
node sf88-operator-buyer-cli/research/cli.mjs serve \
  --workspace /private/received-research \
  --port 8469
~~~

Open the printed local URL. Select the original edition, inspect its source pages and coverage, reopen included/excluded records and their notes, compare the supplied editions, and export the current research report or bibliography.

A recipient may save additional reviews and query revisions through the same application. Repeating the identical receive checks the original source and reopens the current destination; later review edits and acquired pages are preserved. A changed delivery uses a new destination so the earlier workspace remains available.

## Recover a stopped receiving command

If publication completed before the terminal response was received, repeat the same command. The existing receiving record identifies that exact delivery and the original reader returns its current state.

If the native atomic rename could not complete, the error includes the private prepared directory. The complete candidate remains there for inspection. Resolve the reported filesystem/runtime condition and run the same source delivery into a new selected workspace. Original source files and the already completed recipient remain available throughout recovery.

The CLI's --python option selects the trusted local Python 3 executable. It is passed as an executable argument without a shell. The receiving command requires Linux renameat2 support for atomic publication.

## Capacity and file handling

The default total source-data ceiling is 512 MiB across the selected exports; a source file can be at most 64 MiB, matching the original research page ceiling. Up to 128 distinct editions and 50,000 declared files can be selected. --max-bytes sets a lower or higher total ceiling for a reviewed delivery; the per-file and file-count ceilings remain explicit.

The receiver reads and writes one file at a time. It validates real directory paths, excludes symlink traversal and materializes only the original native state inputs. It checks the supplied report/export bytes while the exact originating export remains the complete report delivery. The original research application regenerates reports from the received edition.

## Programmatic use

~~~javascript
import {
  inspectResearchExports,
  receiveResearchExports
} from './sf88-operator-buyer-cli/research/receive-export.mjs';

const plan = await inspectResearchExports([
  '/private/delivery/first-edition',
  '/private/delivery/comparison-edition'
]);
const received = await receiveResearchExports({
  sourceDirectories: [
    '/private/delivery/first-edition',
    '/private/delivery/comparison-edition'
  ],
  destination: '/private/received-research',
  maxBytes: 64 * 1024 * 1024
});
~~~

The singular inspectResearchExport(sourceDirectory) and receiveResearchExport({sourceDirectory,destination}) forms use the same implementation. The returned bundleSha256 identifies the selected edition/manifest pairs independent of argument order.

## Original provider paging observation

On 11 October 2026, the public OpenAlex directory-research query returned 169 distinct works over two actual response pages: 100 records and 69 records. The last page returned null next_cursor with a nonempty results array. The original reader's terminal correction preserves that final data and records TERMINAL_CURSOR; an empty terminal result retains TERMINAL_EMPTY_PAGE. Repeated cursors remain interrupted.

The saved provider request, its translated query metadata and both response files preserve the actual selection. This behavior is tied to the observed source rather than creating an extra empty page. The report carries the actual 169-member cohort and original source period.
