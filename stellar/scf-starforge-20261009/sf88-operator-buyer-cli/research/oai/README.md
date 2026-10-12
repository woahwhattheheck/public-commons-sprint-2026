# Retained scholarly metadata → OAI-PMH source feed

This module publishes a completed, saved OpenAlex works edition as an OAI-PMH 2.0 repository. It gives a collection-management or discovery-system integrator a concrete source interface with stable identifiers, Dublin Core metadata, source provenance, incremental dates, explicit withdrawals and resumable harvests.

Knowledge Integration’s documented CIIM architecture includes OAI harvesting and preserves source material before processing, enrichment, validation and delivery. This feed supplies that documented input contract. The receiving team chooses its CIIM processing profile, authority mapping, access rules and target index.

## Start with the included source example

Requirements: Python 3.11 or later with its standard library. The optional Node launcher uses the installed Python executable; PYTHON can select another executable. Run from this directory.

~~~sh
python3 -m base64 -d example/OpenAlex_CIIM_Source_Example_20261012.zip.b64.txt > ./source-example.zip

python3 oai_feed.py prepare \
  --source ./source-example.zip \
  --prefix source-export \
  --out ./prepared.json

python3 oai_feed.py init \
  --workspace ./feed \
  --base-url http://127.0.0.1:8471/oai \
  --name "Scholarly metadata source" \
  --admin-email operator@example.org \
  --page-size 50

python3 oai_feed.py publish \
  --workspace ./feed \
  --prepared ./prepared.json \
  --expected-revision 0

python3 oai_feed.py serve --workspace ./feed --port 8471
~~~

Open http://127.0.0.1:8471/ for the compact operator page. Configure the harvester with endpoint http://127.0.0.1:8471/oai, metadata prefix oai_dc and set openalex. The Node source entry point accepts the same arguments:

~~~sh
node cli.mjs status --workspace ./feed
~~~

For an installed distribution, the same directory is retained under source/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research/oai/. The Python program, guide and exact base64-encoded source example are included by the existing package. The standard-library decode command above restores the original145,901-byte ZIP (SHA-256948c5c85a3ec88cf26ab9bae2ebcda284ea429dfa3c8240ac2565e30b278f77b). The direct ZIP is also available in the source checkout.

The included ZIP is a **source-only example**: the original query, edition, coverage, manifest and two exact response/request/page sets, plus the prepared metadata and one captured OAI record. It contains 169 distinct works from the completed “Directory of Open Access Journals” title search. Its original source was retrieved on 11 October 2026. Intake uses these retained bytes.

## Use an existing native research export

The same prepare command accepts an original research export directory or ZIP. Give the directory containing manifest.json as the source, or use --prefix for that directory’s path inside an archive.

~~~sh
python3 oai_feed.py prepare \
  --source /path/to/research-export.zip \
  --prefix selected-edition \
  --out ./next-prepared.json

python3 oai_feed.py status --workspace ./feed
python3 oai_feed.py publish \
  --workspace ./feed \
  --prepared ./next-prepared.json \
  --expected-revision 1
~~~

A publication is an operator action with an expected revision. The SQLite transaction writes the entire new publication together. If another operator has published first, reopen status and review the current revision before retrying.

Prepare verifies the original export member lengths and SHA-256 values, query and edition identity, query revision, request parameters, request digest, exact cursor chain, response counts and terminal coverage. A page from another filter or query cannot acquire this edition’s provenance. The finite native query-key ordering matches the original JavaScript canonicalizer, including combinations of search.title.exact and the underscore search fields.

The source must be a completed works edition. Unknown query fields, provider credentials, changed source bytes, conflicting versions of the same work identifier, missing required titles and invalid XML characters stop preparation with a specific error. The source-member size limit is 64 MiB. The preparation result retains per-record missing-field observations.

## Metadata and provenance

| Original field | OAI Dublin Core output |
| --- | --- |
| Canonical OpenAlex work URI | Header identifier and dc:identifier |
| Title or display_name | dc:title |
| DOI and primary landing-page URL | Additional dc:identifier values |
| Ordered author display names | dc:creator |
| Affiliated institution display names | dc:contributor |
| Source keyword names | dc:subject |
| Publication date, type and language | dc:date, dc:type and dc:language |
| Primary source display name | dc:source |
| Canonical author and institution URIs | dc:relation |
| Primary location’s reported license | dc:rights |

Each active record also carries a schema-backed OAI about element. It binds the original edition, query digest, native manifest digest, page number, page and request digests, mapped record digest, source URL and retrieval time. The endpoint serves its provenance schema at /provenance.xsd.

OpenAlex publishes its metadata under CC0. That metadata license is recorded separately from the rights reported for an article or other resource copy. The included sample preserves the provider’s factual metadata and location rights; it does not include article text, abstracts, media or the original researcher’s private review notes.

An absent creator, publication date, language or resource license appears in the preparation issue list. The mapper preserves a provider retraction flag as a source observation. Retraction and publication withdrawal are different operator decisions.

## Harvesting and incremental updates

All six OAI-PMH 2.0 verbs are implemented: Identify, ListMetadataFormats, ListSets, GetRecord, ListIdentifiers and ListRecords. GET query arguments and form-encoded POST requests use the same protocol implementation.

~~~sh
curl 'http://127.0.0.1:8471/oai?verb=Identify'
curl 'http://127.0.0.1:8471/oai?verb=ListRecords&metadataPrefix=oai_dc&set=openalex'
curl --data-urlencode verb=GetRecord \
  --data-urlencode metadataPrefix=oai_dc \
  --data-urlencode identifier=https://openalex.org/W2941881663 \
  http://127.0.0.1:8471/oai
~~~

The GetRecord identifier above is present in the included source edition. Choose an actual identifier from your prepared edition or the returned list when using another source.

The repository advertises second-level UTC granularity and persistent deleted records. from and until accept matching day or second granularity and include both boundaries. Dates describe publication or explicit withdrawal in this repository; article publication dates remain in dc:date.

A resumption token freezes the publication revision, selection, next offset and expiration for 24 hours. Continue with only the verb and resumptionToken arguments. Later publications and withdrawals do not change an already-started harvest. The same original token works after reopening the same database. The final continuation returns an empty token.

Repeated, missing or invalid verbs produce badVerb. Duplicate or incompatible arguments, invalid dates and invalid metadata-prefix/set syntax produce badArgument. Valid unknown metadata formats, sets, identifiers and invalid tokens use the corresponding OAI error codes. Error responses retain the protocol’s request-echo rules.

## Withdrawal, restoration and source absence

A saved query’s changing membership does not automatically withdraw a record from the repository. Publishing reports source identifiers that are absent in the new edition so an operator can review the reason.

To withdraw a particular original work, retain an explicit reason:

~~~sh
python3 oai_feed.py withdraw \
  --workspace ./feed \
  --identifier https://openalex.org/W2941881663 \
  --reason "Operator-reviewed withdrawal" \
  --expected-revision 1
~~~

The new publication retains a persistent deleted header. It has no metadata or about element. Reimporting the same source leaves that withdrawal intact. Restoration is another explicit operator selection:

~~~sh
python3 oai_feed.py publish \
  --workspace ./feed \
  --prepared ./prepared.json \
  --restore https://openalex.org/W2941881663 \
  --expected-revision 2
~~~

Use the current revision from status for each operation. Existing record history and previously issued tokens remain available.

## Operate and reopen the feed

The server binds to loopback by default and serves read-only HTTP. Publishing, withdrawal and backup use local CLI access. For a shared CIIM receiving environment, set the correct stable base URL at initialization and put the service behind the operator’s existing HTTPS and access controls. Keep that configured public base URL stable across ordinary restarts.

Use the SQLite backup API while the service is live:

~~~sh
python3 oai_feed.py backup \
  --workspace ./feed \
  --out ./backup/feed.sqlite3

python3 oai_feed.py status --workspace ./backup
python3 oai_feed.py serve --workspace ./backup --port 8471
~~~

The backup contains publication history, original record mappings and the token-signing key needed to continue a prior harvest. Treat it as an operator workspace and keep it with the receiving deployment. Its parent directory becomes the reopened workspace.

A practical CIIM handover includes the canonical endpoint, metadata prefix and set; one prepared record and full source sample; the Dublin Core/authority crosswalk; incremental schedule and overlap policy; original identifier and withdrawal handling; the selected processing profile; and the operator’s backup/reopen path.

## Completed native receiving example

The retained two-page provider export was prepared and published as 169 records. An actual HTTP harvester received four pages of 50, 50, 50 and 19 records. During that harvest, one later-page source identifier was explicitly withdrawn. The original continuation still returned its original records and repeated bytes. A new GetRecord returned the persistent tombstone.

The same run exercised all six verbs, form POST, inclusive date selection, protocol errors, same-source replay preserving the withdrawal, reopening and continuation, and a SQLite backup that reopened with 168 active records plus one withdrawal. The factual run summary is included in example/NATIVE_JOURNEY.json. The canonical-order compatibility exercise subsequently matched the native Node query and request digests and reproduced the identical prepared 169-record object.

## Primary references

- CIIM architecture and documented source harvesting: https://docs.ciim.k-int.com/technical/how-ciim-works/
- CIIM current documentation: https://docs.ciim.k-int.com/
- CIIM Core: https://docs.ciim.k-int.com/software/ciim-core/
- Proteus processing framework: https://docs.ciim.k-int.com/software/proteus/
- OAI-PMH 2.0 protocol: https://www.openarchives.org/OAI/openarchivesprotocol.html
- OpenAlex data provenance and CC0: https://help.openalex.org/data/how-its-built/
- OpenAlex per-location licenses: https://help.openalex.org/data/licenses/

The module is MIT-licensed under the repository license; the example’s source metadata retains OpenAlex’s CC0 designation.
