# Event collection desk

TJLabs' event collection desk receives original public metadata, retains editorial changes, compares subsequent source editions, and prepares portable or calendar publishing files. It runs as one self-contained HTML application or through the same file-based JavaScript model.

The included worked collection contains the **54 event-detail URLs observed on America250 Washington's public upcoming-events page on 13 October 2026**. Fifty-three detail pages were received; the City of Pacific record retains the public index and its detail retrieval exception. Individual provider cache ages remain attached to the original factual records. This is a **partial public metadata capture**; absent records cannot establish publisher deletion or historical catalogue completeness.

Original sources:

- [America250 Washington events](https://america250wa.org/events/)
- [Digital Native Consultants' Washington State Historical Society case](https://digitalnativeconsultants.com/washington-state-historical-society/)

Descriptions and third-party images remain publisher links. The normalized source retains factual titles, literal dates, published venues, organizers and categories. It does not infer native CMS IDs, time zones, recurrence or all-day status from a date alone.

## Open and work

Open the generated `event-collection.html` in a current Chromium browser. The application contains its complete model, original source, current collection and export adapter. All editing is local to that browser. A standard HTTPS or localhost origin supports persistent IndexedDB; a downloaded file can also be opened, subject to the browser's local-file storage behavior.

**Collection** searches current values and original identities, filters active/withdrawn records, and exposes all records through pages of twenty. Open a record to inspect the exact source and current version.

**Entry editor** retains the original values and per-field source snapshot. Edit the title and complete structured values. A schedule is one atomic value, so a source update cannot accidentally mix an old start with a new end. Use null for unresolved metadata. An editor name is recorded on every change. Withdrawing is an explicit editorial disposition; source records remain in the archive.

**Receive update** accepts `tjlabs.public-events-source/v1` JSON. Every supplied normalized value must appear exactly once in `observed_fields`. Fields omitted from an incoming record are unobserved and preserve their earlier source baseline. For each source change, compare the previous source, current editor value and incoming value. A conflict requires choosing the editor or source value. A complete capture with exactly the same scope and selection may identify absence, but still requires an explicit Keep or Withdraw choice. A partial capture never withdraws an absent record.

Use **Save review progress** to preserve the complete input, choices and note. Apply uses a comparison bound to the whole current collection. A changed collection requires a fresh comparison.

**Publishing** stores a named target and field mapping, then prepares the saved active records. Read the complete exported/omitted record list and every issue before using an attachment. Calendar exports require resolved occurrence dates and time zones; the application preserves unresolved source dates in the complete JSON instead of inventing an occurrence. The Events Calendar transfer uses its supported headings and explicit target associations. A title/time change cannot be treated as an idempotent stable-ID update by the stock CSV importer. The export guide details this boundary and the selected-target mapping.

**Editions** saves a complete immutable working version. Reopening preserves the previous current version as another named edition. A downloaded complete JSON archive contains sources, original/current values, unfinished receiving work, target mappings and all retained editions. A portable HTML download carries the same complete working collection and application.

## Concurrent tabs and recovery

Every persistent write atomically compares the complete value read by that tab. If another tab changed it, both attempted local and current shared values are retained before a choice. Recovery shows and downloads both complete versions. Continuing either compares the shared value again, so an intervening save produces a new visible conflict.

If stored JSON cannot be interpreted, normal saves have no authority to replace it. Download the exact original saved value, then receive a validated repaired archive with the same collection identity. The original raw value remains in the recovery store. A storage read failure does not imply an empty collection. If the hosting sandbox denies browser storage entirely, explicitly choose **Work in a temporary copy**. This uses the embedded collection in memory and writes nothing to the unavailable store. Download the complete archive or working HTML to retain the changes. An actually received malformed saved value continues to require raw preservation and explicit recovery.

The complete working archive covers the collection model. Browser storage recovery pairs are separately downloadable with **Download all preserved originals**; keep that file with an incident handoff when concurrent or malformed drafts matter.

## Source contract

A source has a stable `key`, original collection URL, representation, actual retrieval time, explicit scope, coverage and original selection. Each record uses its observed native identifier when available, otherwise its literal original detail URL. Renaming a title does not change record identity. Different URLs are not silently joined.

Normalized fields: title; schedule; venue; organizers; categories; event_url; status; links; media. Unknown source properties remain in `original`. Source snapshots retain all original metadata, and baseline fields point to the exact snapshot that supplied each value.

A public projection removes private routing/provider result IDs while preserving factual records, public URLs and date evidence. Its descriptor records the original capture hash and exact projection changes.

## File-based operation

Node 22 or newer uses the same source model; no package installation is needed.

```sh
node revenue/event_collection/cli.cjs create source.json working.json collection-id "Collection title"
node revenue/event_collection/cli.cjs inspect working.json
node revenue/event_collection/cli.cjs compare working.json later-source.json review.json
node revenue/event_collection/cli.cjs apply working.json review.json choices.json updated.json
node revenue/event_collection/cli.cjs edit updated.json ENTRY_ID patch.json edited.json
node revenue/event_collection/cli.cjs edition edited.json "Editorial release" named.json
node revenue/event_collection/cli.cjs export named.json portable-json exports
node revenue/event_collection/cli.cjs html named.json event-collection.html
```

Set `EVENT_COLLECTION_ACTOR` to the editor's name. Outputs are written atomically; preserve each selected input alongside its successor. Comparisons cannot apply to a different collection seal. Use explicit selected-target JSON as the final export argument when needed.

## Deployment and recurring operation

Before enabling a scheduled source fetch or CMS transfer, select the authorized source/export route, actual target schema, staging site, timezone policy, responsible editor and publishing permissions. Record the stable target association for each event and the full source snapshot. The provided portable workflow prepares and reviews complete files; it has no network publication writer.

For each recurring cycle, retain the original source response and scope, receive it as a new snapshot, resolve explicit changes, save a named editorial edition, prepare the selected export, and use the target's supported staging/import operation. Save its actual result and target IDs alongside the selected edition. Repeating a prepared CSV import is subject to the target's title/time identity rules, so inspect the prior target result first.

## Producing and receiving the actual application

The complete browser receiving course uses the exact outgoing HTML and actual source collection. Operate the collection search, entry editor, authored source-conflict demonstration, unfinished review, target exceptions, downloads, named editions, concurrent tabs and independent archive/HTML reopening. Inspect populated, empty, loading and error states at desktop and narrow widths.

Open the actual generated JSON, CSV and calendar files and the complete archive as a recipient would. View the actual screenshots personally and repair clipping, unreadable controls or incorrect behavior before presenting the product. Source checks and captured-but-unseen screenshots do not establish rendered acceptance.

The public-source update demonstration is explicitly authored as an operating example. It does not claim the publisher made those changes. Keep the original 54-record source and original named edition unchanged.

Copyright 2026 TokenJunkieLabs. The bundled SHA-256 and source-bytes implementations retain their existing upstream notices and licenses.
