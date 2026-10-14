# Complete lead cohort preparation

Prepare a researched customer cohort, its readable customer files, a complete source handover and a useful source-bound sales message from one maintained toolkit.

This directory is the runnable portable preparation closure. Its `runtime/` retains the full promotional/courtesy lead engine used by the complete-source distribution. The engine supports the explicit free quantity and historical complimentary editions. Adjacent canonical modules expose the same engine for an existing host integration. The native commands below run directly from this directory without a separate workspace server. The value-message composer in this toolkit is byte-identical to the maintained adjacent `lead_value_message_core.cjs` at publication.

## Prepare a whole cohort

Start with reviewed source and the existing company case. Supply one JSON request with `cohort`, `config` and `guides`. Keep research and customer output in the authorized company workspace.

From this directory:

```sh
node native/prepare-cohort.mjs /absolute/preparation-input.json /absolute/Prepared-Cohort
node /absolute/Prepared-Cohort/native/reopen.mjs /absolute/Reopened-Cohort
```

`sample-only` prepares the initial complete free cohort; `free-and-paid` prepares both actual cohorts. Omitting the mode retains the original two-cohort behavior. The free and paid companies must be distinct across the supplied input.

| Request field | Meaning |
| --- | --- |
| `cohort.customer`, `cohort.prepared_by` | Original buyer name and actual preparing organization. |
| `cohort.free`, optional `cohort.paid` | Complete reviewed profile arrays. Sample-only rejects nonempty paid inventory. |
| Each profile | `company`, `person` (person or business role), `area`, `current_workflow`, `product_fit`, `demonstration`, `qualification`, complete `opening`, `contact_page`, ordered `sources`; actual published `email` and/or international `phone` when available. |
| `config.cohort_mode` | `sample-only` or `free-and-paid`. |
| `config.prepared_at` | Actual UTC ISO preparation timestamp, retained for deterministic reproduction. |
| `config.operation_prefix`, `config.lead_ids`, `config.editions` | Stable operation prefix, one distinct lead ID per profile, and selected `sample` / `paid` edition IDs. |
| `config.pack` | Stable `id`, original `customer`, complete `brief` and internal `operator_note`. Customer fields include `name`, `company_domain`, `contact_url`, `case_id` and `prospect_id`. |
| `config.pack.brief` | `title`, `description`, `geography`, `skills`, `lead_kind`, `sample_quantity`, paid `quantity`, `currency`, `price_minor`, `max_age_days`, `excluded_domains`, `excluded_sources`, `exclusions`. Existing omitted sample quantity retains one. |
| `config.status_note`, `config.lead_operator_note` | Complete source-status qualification and internal lead note. |
| `config.customer_filename_stems` | Optional safe `sample` / `paid` names for the ordinary ZIPs and their members. |
| `guides.sample`, `guides.paid` | Complete reader guidance for every selected edition. |

Use five for the initial promotional `sample_quantity`. The recorded follow-on price is per full paid cohort; sample-only retains that brief without creating paid inventory. Complete details and optional contact coverage/tags are in [PREPARE_COHORT.md](source/PREPARE_COHORT.md) and the small [compiler](source/cohort-builder.cjs).

The generated directory includes `customer/sample.html`, `.csv`, `.json`, `.md`, and the paid equivalents when selected. Open these ordinary files directly. Each ZIP contains the selected friendly filename stem plus its guide. The directory's `customer/START_HERE.md` combines the supplied guides. Research, original operations, working record and full source remain under `internal/`, `native/`, `runtime/` and `source/`; `complete-source.json` retains the complete delivery.

## Select the direct evidence URL

Keep the company homepage first in `profile.sources`. It defines company-domain deduplication and the exported company homepage. A profile may separately select the exact URL supporting its observed workflow:

```json
{
  "sources": [
    "https://company.example/",
    "https://company.example/changelog/release"
  ],
  "signal_source_url": "https://company.example/changelog/release"
}
```

This is an input-shape illustration. Use the actual retained public sources for each company.

The selected URL must exactly equal a member of `sources`; case, query parameters and trailing slash are not silently rewritten. An unretained or malformed URL fails before publication. The selected source may be an original founder article, event page or other appropriate publisher, while company identity stays with the first source. Omitting `signal_source_url` preserves the original first-source behavior and complete compiler output.

The exact selected source travels through the original engine to customer JSON, HTML, CSV and Markdown, and into both message layouts. Every original URL remains in the contact/source detail.

For a `company_fit` lead with a verified `company_domain`, the source URL is scoped to that company for duplicate detection. Distinct companies may therefore share an authoritative investment announcement without inventing URL aliases. Existing company, buyer and email duplicate checks still apply. Actual requests and leads without a company domain retain the original source-URL duplicate guard.

## Compose the complete message

After reviewing the generated edition, supply the complete recipe documented in [VALUE_IN_MESSAGE.md](source/VALUE_IN_MESSAGE.md):

```sh
node native/compose-message.mjs /absolute/Prepared-Cohort/customer/sample.json /absolute/message-recipe.json /absolute/Prepared-Message
```

The recipe binds the exact selected JSON file bytes and every selected editorial card. It retains buyer/product qualification, the chosen economics and complete original openings. The current layouts put useful account details before the offer.

For a single coherent preparation, add `message: {edition: "sample", recipe: ...}` to the original request after deriving the exact edition binding. Use a new output directory for the augmented request. The customer files and ZIP retain their original bytes; the message is added under `message/`. The composer independently receives its result before publication.

## Continue, reopen and record delivery

The prepare, compose and delivery entrypoints use the same create-only [source publisher](source/source-publication.cjs). An exact interrupted retry at the same input/output resumes the original plan. Changed input or source requires a new named output. Recovery state remains beside each output.

```sh
python3 native/materialize-source.py /absolute/complete-source.json /absolute/Recovered-Source
node /absolute/Recovered-Source/native/reopen-cohort.mjs /absolute/Reopened-Customer-Files
```

Customer reopening replays the original core operations, receives the complete working record independently and regenerates all selected customer formats. Existing actual delivery records are handled by [RECORD_DELIVERY.md](source/RECORD_DELIVERY.md), including complete Gmail FULL/RAW originals and attachment byte correspondence. The receiver admits the connector's omitted text-charset default and normalizes only outer header space/tab after RFC 2047 decoding when comparing FULL with RAW. Keep the original sender and company relationship history.

Before presenting a customer artifact, use the existing receiving course to open the actual HTML at desktop and narrow width, inspect every ordinary output and archive, and read the full message. Retain corrections in the same company case.

## Source maintenance

[SOURCE_PROVENANCE.json](SOURCE_PROVENANCE.json) identifies each current source member by byte count and SHA-256. The portable runtime and adjacent canonical modules share the same complete engine. The toolkit is distributed under [Apache-2.0](LICENSE).

The focused publication exercise executed the actual prepare, reopen and compose entrypoint bodies with explicit filesystem, Buffer and crypto adapters. A current complete five-profile input reproduced all four customer formats, its original ZIP and both prepared bodies. The entire old compile result matched when the new field was absent, and an unretained selected URL was rejected. Follow the native commands above on the receiving host for native filesystem/browser operation.

## Pack complete history for transfer

The [lossless source archive](source/SOURCE_ARCHIVES.md) stores repeated original text once while reconstructing the exact original bank and every historical file. Run `node native/pack-source.mjs ORIGINAL_COMPLETE_SOURCE_JSON NEW_ARCHIVE_DIRECTORY`, then use the supplied standalone Python opener on its raw archive or gzip carrier. The archive adds a transport choice; original customer files, paths and complete-source identities are retained after opening. Preparation, message composition and delivery successors include the full archive tool closure for continued use.
