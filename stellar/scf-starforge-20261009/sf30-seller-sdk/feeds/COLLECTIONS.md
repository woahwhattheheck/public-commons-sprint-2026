# Subscription collections

A subscription collection turns an original OPML export into a selected group of retained feeds and one native dataset edition. It uses the same feed workspace, SQLite writer, original HTTP/XML acquisition, conflict review, dataset engine and merchant/customer commands as the single-feed product.

## Open the complete workflow

From `sf30-seller-sdk`:

~~~sh
node dataset-cli.mjs feeds --workspace /private/feed-library init
node dataset-cli.mjs feeds --workspace /private/feed-library serve
~~~

Open the printed private URL and choose **Subscription collections**. The installed equivalent starts with `stellar-forge dataset-feeds`. The same Python 3.11+ and Node 22+ requirements apply.

1. Retain the complete original OPML file. The library displays its original title, source identity and subscription count.
2. Add its entries to a collection. Review folders, labels, exact feed URLs and feed IDs. Enable the wanted entries, revise their mappings, or add an already registered feed.
3. Save the collection. The displayed new configurations enter the original feed registry; existing feed configurations keep their current values. Saving a later selection creates another immutable collection revision.
4. Acquire the saved collection. Each distinct enabled feed receives one original capture operation. An interrupted feed retains its completed pages; the other selected feeds can finish. Resume the original collection acquisition to continue incomplete work.
5. Review each acquired feed. Open its original capture to inspect source versions and choose conflicts or a changed Atom identity. The collection also exposes an explicit apply action when the original review has a single unambiguous outcome.
6. Create the combined edition from those exact applied revisions. Query and export it through the original dataset workspace, prepare its merchant release through the existing feed merchant command, or download the complete collection for another operator.
7. Receive the collection project into a new workspace. The selected original OPML, collection revision, acquisition, feed project, native edition and notes reopen together.

The original feed screen has a return link to the selected collection and acquisition. Its query screen opens the exact selected edition.

## Original OPML semantics

The parser follows the [OPML 2.0 specification](https://2005.opml.org/spec2.html). It accepts versions 1.0, 1.1 and 2.0, treating 1.1 according to the 1.0 convention. Core elements are unnamespaced; the original bytes retain extensions and attributes.

Every outline needs its `text` attribute. A subscription has a case-insensitive `type="rss"` and an absolute HTTP(S) `xmlUrl`. That subscription may point to an RSS or Atom feed. Labels remain operator-editable labels rather than identifiers. The actual feed parser determines the received feed format.

Folder order, hierarchy, category text, comments and source attributes remain attached to each original entry. Commented outlines inherit their parent comment and begin disabled; an operator can explicitly select them. Duplicate URLs can appear in several folders and map to one registered feed, producing one acquisition and one set of native rows.

Include/link outlines stay in the original document and its structural view. Acquisition follows the explicitly selected RSS subscription entries. Original source URLs are compared as exact strings with registered feed URLs; mapping preserves path, case and query distinctions.

The workspace supports original OPML up to 16 MiB and 10,000 outlines, and a collection can enable up to 250 distinct feeds. These are product capacity choices. Original XML parsing rejects DTDs and external entities.

| Download | Contents |
|---|---|
| **Original OPML** | Exact complete bytes supplied to intake, with their source SHA-256. |
| **Saved OPML** | OPML 2.0 generated from the saved enabled selection, preserving its selected folder hierarchy and entry attributes. Multiple original documents retain separate top-level groups. |

A public source suitable for importing a real folder tree is [Ben Werdmuller's published NewsBlur subscriptions](https://github.com/benwerd/OPML/blob/HEAD/subscriptions.opml). The source read for this implementation was Git blob `0559a621448206c1b531130a487768aae26ac021`. Choose the feeds relevant to your own collection before acquisition.

## Complete CLI

~~~sh
node dataset-cli.mjs feeds --workspace /private/feed-library subscriptions import \
  --file /private/subscriptions.opml --operation import-library-20261012

node dataset-cli.mjs feeds --workspace /private/feed-library subscriptions state

node dataset-cli.mjs feeds --workspace /private/feed-library subscriptions plan \
  --source SOURCE_SHA256
~~~

The plan shows each entry ID, original URL and folder path, matching registered feed IDs, a deterministic suggested ID and its initial selection. Write the reviewed selection as an action:

~~~json
{
  "action": "collection-save",
  "collectionId": "publisher-notices",
  "title": "Publisher notices",
  "expectedRevision": 0,
  "operationId": "save-notices-20261012",
  "members": [
    {
      "sourceId": "SOURCE_SHA256",
      "entryId": "1.1",
      "feedId": "publisher-notices",
      "enabled": true
    }
  ],
  "newFeeds": {
    "publisher-notices": {
      "url": "https://publisher.example/feed.atom",
      "label": "Publisher notices",
      "rssIdentity": "guid-or-link",
      "allowedOrigins": ["https://publisher.example"]
    }
  }
}
~~~

Replace the source hash, entry ID and URL with the displayed original values. For an existing feed, map its current ID and omit its `newFeeds` entry. A manual member uses `sourceId: null` and `entryId: null` with its registered feed ID.

~~~sh
node dataset-cli.mjs feeds --workspace /private/feed-library subscriptions save \
  --file /private/selection.json

node dataset-cli.mjs feeds --workspace /private/feed-library subscriptions show \
  --collection publisher-notices
~~~

The saved view includes current enabled feed revisions, complete retained registration configurations, missing registrations, acquisition history and native edition bindings. Copy the displayed current revisions into a JSON object such as `{"publisher-notices":1}`.

~~~sh
node dataset-cli.mjs feeds --workspace /private/feed-library subscriptions capture \
  --collection publisher-notices --revision 1 \
  --revisions /private/feed-revisions.json --operation acquire-notices-20261012 --pages 100

node dataset-cli.mjs feeds --workspace /private/feed-library subscriptions review \
  --run RUN_SHA256

node dataset-cli.mjs feeds --workspace /private/feed-library subscriptions resume \
  --run RUN_SHA256
~~~

The run displays each original capture ID. Review and apply through the existing single-feed commands:

~~~sh
node dataset-cli.mjs feeds --workspace /private/feed-library review --capture CAPTURE_SHA256

node dataset-cli.mjs feeds --workspace /private/feed-library apply \
  --capture CAPTURE_SHA256 --revision CURRENT_FEED_REVISION \
  --decisions /private/retained-choices.json --operation apply-notices-20261012
~~~

Use the resulting applied feed revisions for the combined edition:

~~~sh
node dataset-cli.mjs feeds --workspace /private/feed-library subscriptions edition \
  --run RUN_SHA256 --name "Publisher notices — reviewed edition" \
  --fields key,id,title,link,published,updated,summary,feed_id,source_sha256 \
  --revisions /private/applied-revisions.json --operation edition-notices-20261012
~~~

A feed that has advanced after the selected capture was applied requires a current acquisition. This keeps the collection edition tied to its displayed review.

## Receiving and continued operation

~~~sh
node dataset-cli.mjs feeds --workspace /private/feed-library subscriptions export \
  --binding BINDING_SHA256 --out /private/feed-collection.zip

node dataset-cli.mjs feeds --workspace /private/receiving-library init
node dataset-cli.mjs feeds --workspace /private/receiving-library subscriptions receive \
  --file /private/feed-collection.zip --operation receive-notices-20261012

node dataset-cli.mjs feeds --workspace /private/receiving-library subscriptions show \
  --collection publisher-notices
~~~

The complete packet includes:

- Exact original OPML documents used by the selected collection and its saved selection history.
- The selected immutable collection revision, prior selection revisions, original completed acquisition and native edition binding.
- A generated OPML list for the selected enabled entries.
- The original feed-project ZIP: complete selected-feed HTTP/XML history, current records, private notes and the selected original XML/SF30 native build.
- A manifest giving the exact hash and length of every outer member.

Receiving streams the archive, checks complete membership and original bytes, reconstructs OPML metadata, validates the acquisition's per-feed URL/configuration and original operation IDs, and delegates native dataset receiving to the original feed workspace. Existing collection or feed state must agree with the incoming identity; use a new workspace for a different branch of history.

Disabled subscriptions retain their exact original URLs and full saved registration configurations. Their feed histories belong to the original selected feed-project scope when that feed is enabled in the carried edition. The receiving editor identifies any missing disabled registrations and explicitly restores their retained complete configuration when saving. CLI callers can copy `missingRegistrations` from the view into `newFeeds` before saving a changed selection.

A completed collection acquisition reopens with its original run and capture IDs. A new acquisition uses a new operation ID and the receiving workspace's displayed feed revisions. Original validators, conflict decisions and current records remain the basis of that next operation.

## Merchant and buyer handoff

A collection edition is an ordinary original feed edition. Use its `editionId` with the existing dataset export and merchant workflow:

~~~sh
node dataset-cli.mjs feeds --workspace /private/feed-library export \
  --edition EDITION_SHA256 --out /private/feed-dataset

node dataset-cli.mjs feeds merchant prepare \
  --dataset-export /private/feed-dataset --state /private/feed-version-store \
  --payment /private/public-payment-terms.json --origin https://merchant.example \
  --path /notices --out /private/feed-merchant-package --release /private/feed-release
~~~

Continue with the original merchant start, actual-offer buyer review/preparation, version refresh and SF88 customer commands in [the feed operating guide](README.md).

Use the dataset export for merchant publication. The complete collection project is the private operator handover and includes retained subscription originals and notes.

## Interruption behavior

Registration uses deterministic child operation IDs in the original feed registry. If it stops partway through, replaying the same saved action reuses completed children before committing the collection revision. A changed action body requires a new operation ID.

Acquisition saves each feed's result before continuing to the next feed. Source failures remain attached to the feed; cancellation stops the group after the active original capture observes cancellation. Resuming keeps successful captures and continues incomplete ones with the original page policy.

Native edition creation, complete receiving and browser action recovery retain exact operation identities. The browser keeps a selection draft and pending action separately. A lost upload response asks for the same original file and preserves its original operation ID. Drafts keep the revision they were based on, so saving them still checks for a newer collection revision.
