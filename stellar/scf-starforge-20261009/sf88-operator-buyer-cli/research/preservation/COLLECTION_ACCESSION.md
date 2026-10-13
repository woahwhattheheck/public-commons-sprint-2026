# Original file collection accession

This is the **Collections** workflow in the maintained preservation Workbench.
It retains ordinary institutional files and their exact original paths, lengths
and SHA-256 hashes, records a reasoned descriptive and selection review, and
builds a BagIt transfer. The original research-metadata and repository-client
workflows remain available in their existing tabs.

The collection transfer has its own explicit profile,
`original-file-collection-bagit-1`. It is a bounded local accession and
handover workflow. Its output is not an assertion of OAIS conformity,
repository acceptance, malware clearance, format identification, long-term
storage durability, a hosting service or an institution's permission to share
content. Those are receiving-project requirements and decisions.

## Install and open

Use Python 3.11 or later on a system with the original POSIX locking support.
No extra Python package is required for collection inventory, review or BagIt.
Use the complete selected preservation source, including the existing research
and RODA source closure and these five collection files:

- `research/preservation/collection_accession.py`
- `research/preservation/collection_accession.js`
- `research/preservation/COLLECTION_ACCESSION.md`
- `research/preservation/receiving/collection_accession_receive.py`
- `research/preservation/receiving/collection_accession_browser.mjs`

From the operator SDK root:

```sh
python3 -B research/preservation/workbench.py serve \
  --workspace /absolute/private/preservation-workspace --port 8785
```

Open the exact local address printed by that process. Choose **Collections**.
A new workspace can start with file collections only; it does not need an
OpenAlex edition. The original research directory can remain absent until a
research edition is deliberately received. The operator sibling directory
contains the retained collections and their histories.

An installed distribution uses the same Node-to-Python wrapper:

```sh
node research/preservation/cli.mjs --python /absolute/python3 \
  workbench serve --workspace /absolute/private/preservation-workspace --port 8785
```

Managed Applications continue using the original `preservation-workspace`
provider and its reviewed source/Python/workspace binding. The contribution
includes the complete collection source group.

## 1. Inspect an original directory

Enter an existing directory on the host. Use a directory whose ownership and
permitted use are already established. **Inspect original files** reads every
regular file, records the complete original directory inventory including
empty directories, and computes each file's length and SHA-256 hash.

Traversal errors fail visibly. An unreadable subtree is not treated as an
empty collection. Symlinks and nonregular members are refused. The local
profile allows 10,000 files, 10,000 directories, 64 MiB per file and 2 GiB of
original file content. The inventory and complete review each have a 4 MiB
metadata ceiling. These limits describe this delivered profile, not the
capacity of a bidder's hosted preservation platform.

Keep the inventory digest shown by the original operation. A later change to
any selected original file or directory requires a new inspection before
retention.

## 2. Retain the exact collection

Enter the accession ID, collection title, original source reference and
actual holding organization/contact. The source reference should identify
the original deposit or responsible source, rather than inventing a rights
assertion.

**Retain inspected original files** makes a private copy outside the source
tree. It verifies the complete source again, copies each original byte stream,
verifies the retained inventory, and publishes the completed accession
atomically. A matching retry reuses that same completed accession. A changed
source or another accession under the same ID is rejected.

The copied original files are immutable inputs for later review editions.
Neither a metadata edit nor an exclusion rewrites them. A failed or interrupted
private staging directory is preserved by the complete Workbench archive;
only published non-dot accession roots appear as completed Collections.

Do not manually alter files inside an accession. A transfer output must be
outside the entire retained accession tree. The Workbench's original packages
directory already supplies that separate destination.

## 3. Review the original files

Choose the retained accession. Search by original path, filter by inclusion or
missing rights, then **Review** an individual file.

The default description retains the original filename as title and original
relative path as identifier. Additional Dublin Core values are explicit
operator entries. Use field names with arrays of strings:

```json
{
  "title": ["North elevation photograph"],
  "creator": ["Original named photographer"],
  "rights": ["Institutional rights statement and permitted use"]
}
```

This example is a format illustration, not metadata asserted about a real file.
An empty override object retains the original defaults. The workflow does not
assign CC0, infer a file format from an extension, or manufacture authorship.

Choose whether the file is included in the transfer and record a reason for
every metadata change or exclusion. **Apply file decision to draft** retains
the entire decision in the current tab draft. **Save complete review** checks
the exact prior revision and saves an immutable new review edition.

The complete original path and SHA-256 binding remain visible. Excluded
originals stay in the private complete workspace, while the transfer carries
their inventory identity and exclusion reason without their file bytes.
Review this disclosure before distributing a transfer: filenames and inventory
identities for excluded originals are still present in its documentation.

## 4. Preserve and reconcile a review draft

The browser keeps a draft for the selected accession in this tab's session
storage when available. It warns before leaving with unsaved work.
**Download complete review JSON** gives an independent, complete draft.

Use **Review imported JSON** to reopen that file against the current saved
review. The import must bind the exact original inventory. It does not
replace a saved edition or write any source file. Every differing file
decision is shown as complete saved, local-draft and imported values, including the
distinction between an absent decision and an explicit record. A missing
decision means original defaults and inclusion.

Choose the saved, local-draft or imported value for each difference, or
deliberately apply one choice to all differences. Existing local decisions
are included in this comparison and cannot be silently discarded. **Apply reviewed choices to draft** creates the
combined draft against the current saved revision. **Save complete review**
then saves that exact draft with the normal revision check. If another
operator advances the review meanwhile, save refuses the stale base.

If an existing tab draft has become stale, **Reconcile this draft with saved
review** uses the same explicit comparison. The previous draft remains intact
until the operator applies the choices. Review editing is held while these
choices are open; Apply also checks the exact selected accession and original
local draft. Cancel keeps that original draft. The source does not splice the fields
of two conflicting decisions. It selects a complete file decision and its
original reason. A background saved-review read disables review editing until
it returns, preventing silent loss of a newly typed edit.

A tab draft is a convenience, not the authoritative archive. Keep the downloaded
review when moving to another browser or machine.

## 5. Build and independently verify a transfer

**Build verified BagIt transfer** operates on the current saved review. The
original Workbench records the queued job in Activity. Its complete ZIP is
available in **Delivery** after validation.

The bag contains:

| Member group | Meaning |
| --- | --- |
| `data/objects/<original relative path>` | Exact selected original file bytes |
| `data/metadata/metadata.csv` | Reviewed Dublin Core arrays, original file identities and reasons |
| `data/metadata/review.html` | Complete human-readable review report |
| `data/metadata/submissionDocumentation/` | Original inventory, complete saved review, mapping and profile |
| `manifest-sha256.txt` and `manifest-sha512.txt` | Complete payload checksums |
| `tagmanifest-sha256.txt` and `tagmanifest-sha512.txt` | Original tag-file checksums |
| `bagit.txt` and `bag-info.txt` | Bag declaration, exact selection identity and payload count/length |

Verification checks both digest algorithms, exact member names, all original
file identities, the complete selection and regenerated metadata documents.
The profile refuses a transfer whose original files plus documentation exceed
its complete package limit. ZIP publication is create-only and atomic; an
existing exact package is reused, while a different package at that path fails.

Independent CLI verification and comparison use the same original module:

```sh
python3 -B research/preservation/collection_accession.py verify \
  --source /absolute/Collection_original.zip
python3 -B research/preservation/collection_accession.py compare \
  --previous /absolute/Collection_original.zip \
  --current /absolute/Collection_reviewed.zip
```

The comparison retains complete before/after rows and distinguishes source
addition/absence, byte changes, selection, descriptive values and reasons.
Observed absence is not permission to delete a previously preserved object.

Existing RODA/Preservica/LIBNOVA/Archivematica destination operations retain
their original research-profile contracts. Do not submit this different
collection profile through a research-only provider adapter. A target's
documented generic BagIt workflow must be reviewed separately.

## 6. Export, receive and reopen the complete editable workspace

In **Delivery**, choose **Export complete workspace**. Save outstanding research
and collection drafts first. The original export includes full application
source, all retained original collection bytes, every review edition,
inventory/settings, original job history and generated packages. A
collection-only export records `collectionOnly: true` and the exact selected
accession bindings.

Receive using an installed copy of the same maintained receiver:

```sh
python3 -B research/preservation/workbench.py receive \
  --source /absolute/COMPLETE.zip --output /absolute/received
python3 -B /absolute/received/application/research/preservation/workbench.py serve \
  --workspace /absolute/received/workspace --port 8785
```

The receiver verifies every complete member, restores the original empty
directories, checks original bytes and selected review bindings, and preserves
interrupted intake stages as ordinary archived evidence. Received code is
retained as data during extraction; it is not imported while validating an
external archive. Start the verified received application explicitly.

The original receive receipt binds the source archive and manifest. Repeating
the same receive reuses that original received workspace. Its later locally
saved review editions remain intact. A changed original accession, mismatched
application or another archive for the same receiving path is rejected.

Original exports that predate Collections remain readable. A new complete
archive with collections must contain their complete source group and exact
binding list; it cannot omit the feature's source while claiming the data.

## Complete CLI path

```sh
python3 -B research/preservation/collection_accession.py inspect \
  --source /absolute/original-files
python3 -B research/preservation/collection_accession.py init \
  --source /absolute/original-files \
  --workspace /absolute/private/workspace.operator/accessions/collection-a \
  --settings /absolute/settings.json \
  --inventory-sha256 ORIGINAL_INSPECTED_SHA256
python3 -B research/preservation/collection_accession.py show \
  --workspace /absolute/private/workspace.operator/accessions/collection-a --verify
python3 -B research/preservation/collection_accession.py review-save \
  --workspace /absolute/private/workspace.operator/accessions/collection-a \
  --input /absolute/review.json --expected-revision 0
python3 -B research/preservation/collection_accession.py build \
  --workspace /absolute/private/workspace.operator/accessions/collection-a \
  --output /absolute/deliveries/Collection_reviewed.zip --expected-revision 1
```

Settings JSON has exactly `id`, `title`, `organization`,
`contact` and `sourceReference`. The inspect result provides the complete
inventory and digest. The review is the complete `show.review` object with
original inventory identity, decisions and note.

The Node wrapper exposes the same commands after `collection`; it delegates
to the original Python module, rather than implementing another package engine.

## Receiving and visual acceptance

The optional source-owned operating programme is
`receiving/collection_accession_receive.py`. It takes an explicit original
directory and reviewed metadata file, retains those selections, invokes the
maintained APIs, verifies two package editions, exports/receives the complete
Workbench, and reopens the actual installed received source. It does not
contact a provider or invent an institution's collection.

The browser companion uses that same retained case, exercises Collections at
desktop and narrow width, saves and downloads through actual controls and
reopens the complete received application. Its screenshots are review inputs.
The producing operator must LOOK at the actual rendered controls, tables,
metadata editor, differences, download and reopened case before calling the
customer delivery visually accepted. A source review alone is not that receipt.

## Source profile references

The bag's manifest and pathname rules reuse the maintained original
`preservation.py` implementation and [RFC 8493](https://www.rfc-editor.org/rfc/rfc8493).
Dublin Core field names refer to [DCMI Metadata Terms](https://www.dublincore.org/specifications/dublin-core/dcmi-terms/).
The complete original collection profile and review choices travel inside the bag.

### Run the original selected operating case

Supply real original source files and complete operator-authored settings/review JSON. Inspect the source first to bind the review’s exact inventory digest. The first review must differ from the opening empty review; it may record a responsible note without inventing file metadata. Keep the private operation directory outside both original source and Workbench trees.

```sh
python3 -B research/preservation/receiving/collection_accession_receive.py \
  --application /absolute/operator-sdk \
  --source /absolute/original-files \
  --workspace /absolute/private/collection-workspace \
  --settings /absolute/settings.json --review /absolute/review.json \
  --operation /absolute/private/collection-receiving
```

The same operation retains its full producing sources, original inputs, immutable selection, progress, two BagIt files, complete workspace ZIP and independently received application. Repeating the command reuses these identities and refuses changed inputs. A completed source-aware report does not imply a browser or provider result.

For the browser continuation, supply a further complete, explicitly authored review for the same inventory. Stop any earlier manually opened host for this selected workspace; the programme owns its two ordinary local servers under one inherited original receiving lock.

```sh
node research/preservation/receiving/collection_accession_browser.mjs \
  --application /absolute/operator-sdk \
  --operation /absolute/private/collection-receiving \
  --review /absolute/following-review.json \
  --browser /absolute/existing-chromium \
  --playwright-module /absolute/installed-playwright/index.mjs \
  --python /absolute/python3
```

The browser continues revision1→2 through the actual imported-review comparison and Save control, downloads complete review and BagIt files, exports the whole workspace, invokes the maintained receiver and opens the actual copied application at desktop and390px width. A resumed invocation recognizes its exact saved review and original queued jobs; it does not choose another case. An interrupted complete export uses the existing Activity recovery action. The maintained verifier also opens the downloaded BagIt ZIP, retains every exact metadata attachment and renders its actual complete HTML report at desktop and narrow widths. Eight per-attempt screenshots, process output and outcome remain in the same operation. Inspect the complete metadata CSV/JSON and selected original files with their normal recipient viewers as appropriate; no automated screenshot status claims those human checks. The report explicitly leaves producer visual inspection pending until someone examines those actual files.
