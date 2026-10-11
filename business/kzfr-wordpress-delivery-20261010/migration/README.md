# Operator-approved station export -> existing WordPress reviewed drafts

This is a production-minded *offline* adapter for the original KZFR WordPress delivery candidate, not another radio CMS, provider crawler, or data source. The existing WordPress plugin already implements Tools -> Station content import with CSV preview, non-overwriting stable source IDs, and administrator-selected **drafts only**. Its documented missing step is how an approved old-site/station/partner inventory becomes that CSV. This adapter fills exactly that step.

## Deliver in the actual buyer workflow

1. Ask the station/prime's authorized data owner for an export of program/event/underwriter content, column dictionary, canonical stable IDs, and which Creek Studio links may be carried forward. Obtain a real export; do not claim this code understands a Creek API, downloads audio, or has customer credentials.
2. Inventory its UTF-8 header and write a small explicit mapping JSON. No column guessing or AI-assigned IDs. Create a separate mapping per data export if its schema differs.
3. On a local trusted machine with Node.js 22+, run:

        node business/kzfr-wordpress-delivery-20261010/migration/prepare-approved-inventory.mjs \
          --input /private/station-approved-export.csv \
          --map /private/station-approved-mapping.json \
          --out-dir /private/kzfr-review-20261011

   The output directory must **not already exist**. The CLI never accesses the network, WordPress, Stripe, Creek, a live station, or the file system outside its caller-selected source, mapping and new output directory.
4. Inspect new manifest.json and rejections.json. A nonzero exit 3 means some rows are rejected and require operator attention. Rerun into a **different fresh directory** after correcting original export or mapping. Never quietly discard the rejected set.
5. In authorized disposable/staging WordPress, activate the existing companion plugin, visit **Tools -> Station content import**, upload approved-import-001.csv, preview each row, select approved rows and create **drafts**. Repeat each additional chunk. Editors review/publish in ordinary WordPress separately. Source IDs make retry non-destructive even for trashed previously imported rows.
6. Prime/station acceptance checks remain real Creek destinations, 2027 radio schedules, WCAG 2.1 AA, mobile/performance/SEO, owner-confirmed migration and backup. No source data or a CSV alone proves those requirements.

## Mapping schema (explicit, no implied provider columns)

Example of an **illustrative** source export with header

    Station Program ID,Public Title,Public Description,Summary,Genre,Approved Creek URL

and an operator-authored mapping.json:

    {
      "version": 1,
      "type": "program",
      "columns": {
        "source_id": "Station Program ID",
        "title": "Public Title",
        "content": "Public Description",
        "excerpt": "Summary",
        "genre": "Genre",
        "creek_url": "Approved Creek URL"
      }
    }

This header is a suggested inventory format, **not an assertion about KZFR/Creek exports**. A program Creek URL is optional but, when populated, must use HTTPS on exactly kzfr.studio.creek.org. The existing plugin makes only outbound **links** to Creek and does not ingest/host audio.

For an event export, set "type":"event" and map "event_date" to a real YYYY-MM-DD date column. For underwriters, set "type":"underwriter" and optionally map "website" to HTTPS. Fields not mapped become blank. The exporter rejects fields belonging to the wrong type, invalid IDs, invalid dates/URLs, duplicate source IDs, titles above 250 bytes and header/value mismatches. It never changes source contents beyond the same field trimming performed by the original WordPress importer.

If a source file legitimately includes *mixed* record types, omit fixed "type" and instead supply "columns.type" and optionally a direct "type_values" dictionary, such as:

    {
      "version": 1,
      "columns": {
        "source_id": "Station ID",
        "type": "Record class",
        "title": "Page title",
        "content": "HTML",
        "event_date": "Event date",
        "creek_url": "Creek link",
        "website": "Underwriter site"
      },
      "type_values": {
        "radio_show": "program",
        "community_event": "event",
        "station_sponsor": "underwriter"
      }
    }

Unknown source types reject; the mapper never silently classifies a contact as a program or guesses an event date.

## Actual existing WordPress contract

Native import header in **this exact order**:

    source_id,type,title,content,excerpt,genre,creek_url,event_date,website

The original plugin implementation is business/kzfr-wordpress-delivery-20261010/plugin/kzfr-editorial-bridge/editorial-workbench.php on public main (existing merged PR #637). Output chunks honor its 500-row and 1,048,576-byte UTF-8 limits including the header. Every generated CSV uses normal RFC 4180 quotes for commas, quotes and multiline HTML. Only approved program, event and underwriter records are represented; no broadcast-date / schedule inference or event publication occurs.

The create-only output directory has private owner permissions; all files use mode 0600. manifest.json records exact **original input** and mapping SHA-256 digests, counts, and each chunk's bytes/rows/SHA-256 so a reviewer can reconcile exactly which bytes created an editorial draft batch. rejections.json lists logical source record numbers and rejected-field reasons only, without copying rejected raw content. The actual accepted content still appears in the private CSV files and must not be committed to GitHub or pasted into Slack.

A malformed CSV, unclosed quote, duplicate/unknown source header or unrecognized mapping fails without writing output. Valid rows can be separated from invalid rows into a private review directory; **exit 3 explicitly reports partial acceptance**, rather than pretending the whole inventory passed.

This is an independent engineering candidate and does not represent a commissioned deployment, prime subcontract, Creek authorization, customer production access, external KZFR bid, security/a11y certification, or completed paid work. There is no GitHub Actions configuration or workflow.
