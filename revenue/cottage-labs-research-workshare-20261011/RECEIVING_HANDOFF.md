# Research implementation and receiving handover

## The customer outcome

The proposed Cottage Labs implementation turns two agreed OpenAlex research questions into a retained review workflow, a useful service or research output and a complete handover. It uses the existing OpenAlex merchant, researcher application and original full-edition receiver.

The [workshare](WORKSHARE.md) contains the complete USD 6,400 / ten-business-day implementation, acceptance, customer inputs, payment milestones, support and optional care. Its machine-readable customer scope is [quote.json](quote.json). Source fields, access and account budgets are agreed with the named customer owner.

## Maintained application

All original product source is in the [Stellar Forge repository](https://github.com/woahwhattheheck/public-commons-sprint-2026/tree/0ca82b649c3a04cdaca32c9ccaa9859b66df844c/stellar/scf-starforge-20261009). The complete source and receiving integration are composed in [the original OpenAlex product change](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/1341).

| Operating surface | Complete guide |
| --- | --- |
| Provider account, budget, products, generated client and source acquisition | [OpenAlex operator](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/0ca82b649c3a04cdaca32c9ccaa9859b66df844c/stellar/scf-starforge-20261009/sf30-seller-sdk/openalex/README.md) |
| Queries, complete editions, researcher review, comparisons and outputs | [Research workspace](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/0ca82b649c3a04cdaca32c9ccaa9859b66df844c/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research/README.md) |
| Exact full-edition import, all supplied query revisions and private reopen | [Complete receiving](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/0ca82b649c3a04cdaca32c9ccaa9859b66df844c/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research/RECEIVING.md) |

Use the complete repository checkout or the original maintained distribution that includes this product. Run from `stellar/scf-starforge-20261009` with its documented Node dependencies. Complete receiving also requires Linux, Python 3 and util-linux flock. Keep the source checkout separate from the customer's private runtime data.

## Complete operating sequence

1. **Agree source and output.** The owner and researcher identify two questions, selected fields and dates, a record envelope, the receiving interface, account budget and publication permissions. Save the agreed query revisions.
2. **Acquire and retain.** Run the existing direct operator or original native buyer against those selected queries. Every request, provider page, timestamp, exact cursor and original result is retained. Continue the same saved edition after an interrupted acquisition.
3. **Review useful records.** Select records by their actual OpenAlex ID, save include/exclude/undecided decisions and source-linked notes, inspect supplied fields and cohort groups, then agree useful research or service outputs.
4. **Retain a later capture.** Save the later edition against its exact query revision. Compare membership and before/after supplied fields. Carry earlier decisions into the receiving edition for the researcher's current review.
5. **Export the complete handover.** Produce the readable report and the full original edition export, including original pages and native results where supplied. Export both comparison editions when their joint history is part of delivery.
6. **Receive and reopen.** Inspect all original manifests, import the complete collection into a new private workspace, then open the original researcher application against that path. Preserve original review history and any later receiving decisions.
7. **Accept and operate.** The named customer confirms the agreed output and receiving flow. The engineer/operator session repeats refresh, review, export and recovery on the customer's configured environment.

### Original export and receiving commands

These commands use paths selected by the customer, with complete source exports kept together.

~~~bash
node sf88-operator-buyer-cli/research/cli.mjs export \
  --workspace /private/research \
  --edition-id initial-edition \
  --out /private/delivery/initial-edition

node sf88-operator-buyer-cli/research/cli.mjs export \
  --workspace /private/research \
  --edition-id comparison-edition \
  --out /private/delivery/comparison-edition

node sf88-operator-buyer-cli/research/receive-cli.mjs inspect \
  --source /private/delivery/initial-edition \
  --source /private/delivery/comparison-edition

node sf88-operator-buyer-cli/research/receive-cli.mjs receive \
  --source /private/delivery/initial-edition \
  --source /private/delivery/comparison-edition \
  --workspace /private/received-research

node sf88-operator-buyer-cli/research/cli.mjs serve \
  --workspace /private/received-research \
  --port 0
~~~

Use edition IDs actually present in the customer's saved workspace. The original reader validates the source chain after receiving. The receiving path is published with Linux atomic no-replace directory creation. Repeating the same collection recognizes its existing delivery and preserves later reviewer edits and retained source progress. It does not merge a different delivery into an unrelated workspace.

The default total source-export ceiling is 512 MiB, with up to 128 distinct editions, 50,000 declared files and 64 MiB per file. The CLI's `--max-bytes` selects a reviewed total ceiling. Actual page size and selected fields are assessed at intake; the proposed cohort is two queries with up to 2,500 identified records each and two captures per query.

## Actual receiving operation

On 11 October 2026, two original public OpenAlex HTTP 200 responses supplied 169 distinct works matching the retained query's reported count. The exact query is `search.title.exact=Directory of Open Access Journals`, with the original selected fields, page size 100, initial cursor and next cursor retained in its request files.

| Original page | Records | Bytes | SHA-256 |
| --- | ---: | ---: | --- |
| First | 100 | 418,591 | `238d07499ddf2f3fcad2abfae44fc19ac6a593f7882bdc0d40b934813213ac23` |
| Terminal | 69 | 366,245 | `7a9f57bc9d1d8d42504fd60f7184c1f1d18712d8f7d55fcdfcdb2710412f6194` |

The provider's exact final response contains 69 records and a null next cursor. The maintained workspace keeps every final record and records COMPLETE / TERMINAL_CURSOR. It also retains the original reported counts, response times and query translation.

The completed receiving operation at 23:02:31 UTC restored two review editions of that same original capture into one new workspace, preserving query revisions 1 and 2, all original page hashes and the review decisions. A new receiving review survived repeating the same delivery with the export arguments reversed. The two full exports contained 72 files and 11,089,334 bytes before compression. The original source comprises two provider requests and 784,836 response bytes; the two review editions use that same capture. The customer implementation configures its own later live capture.

## Source rights and operating ownership

OpenAlex metadata is available under [CC0](https://help.openalex.org/access/pricing/). Linked full texts and repository content retain their [own licenses](https://help.openalex.org/access/fulltext/). The original sources, research interpretation, approved account and customer service remain with their designated owners.

Cottage Labs' own [NGLP work](https://cottagelabs.com/projects/nglp/), [repository services](https://cottagelabs.com/data-repositories/) and [open-access infrastructure](https://cottagelabs.com/open-access-infrastructure/) supply the first-party partner context for this proposed implementation.
