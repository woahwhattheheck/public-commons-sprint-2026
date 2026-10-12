# 2BA upload packages from reviewed xChange data

The supplier workspace creates a complete 2BA upload ZIP from an immutable
xChange review. The ZIP contains **parameters.xml** and the complete native
**ETIM_XCHANGE_<review-id>_<native-type>.json** file. The selected processing
settings are part of the saved submission and its recipient review.

The same workflow is available in the existing browser workspace, installed
catalog CLI, native MCP and typed client. It uses the original request journal,
read snapshot and retained export/download mechanism.

## Select the delivery and processing

In **Supplier delivery**, choose **2BA · ETIM xChange 2.0**. Map the complete
retained xChange product context, select the intended catalog edition and supply
the original 2BA status mapping and released modelling-class sources where the
selected records require them.

Open **2BA processing and upload package**, enable the processing selection and
record its reason. Save the submission and review it. The controls cover:

| Purpose | Original parameter |
| --- | --- |
| Identify the producing software and report | GeneratedBy, PackageDescription |
| Choose processing report recipients and language | SendReportToEmail, ReportLanguage |
| Omit loading particular sections | SkipLoadProducts, SkipLoadArticlesAndPrices, SkipLoadPrices, SkipLoadAttachments |
| Choose complete or mutation processing explicitly | OverrulePackageMutationCode, PackageMutationCode |
| Keep or remove omitted attachment references | InteractiveChecks |
| Retain original source URLs by native attachment code | KeepMimeURL |
| Request the recipient account's master GLN conversion | AutoConvertToMasterGLN |

The controls retain real booleans and exact strings. They do not shorten supplier
values. Report addresses are separated with semicolons; an explicit address
selection changes who receives the recipient's processing report.

The published parameter names and envelope are case-sensitive. The downloaded
[original 2BA example](https://www.2ba.nl/wp-content/uploads/parameters.zip)
contains the plural filename **parameters.xml**, root **UCProcessParameters** and
namespace **http://www.2ba.nl**. This package uses that actual example namespace.
The [English parameter documentation](https://www.2ba.nl/en/documentation/file-exchange/file-upload/process-parameters/)
and its [Dutch original](https://www.2ba.nl/documentatie/bestandsuitwisseling/upload-bestanden/process-parameters/)
confirm the plural filename and parameter spellings. Their inline HTTPS namespace
and the xChange format page's singular filename differ from the downloaded example;
these source differences are recorded in [the source decisions](./source/2BA_PROCESSING_RULES.json).

The exact publisher files are retained as
[2BA_parameters_example.xml](./source/2BA_parameters_example.xml) and
[2BA_parameters_example.zip](./source/2BA_parameters_example.zip), with their
[acquisition record](./source/2BA_PARAMETERS_ORIGINAL.json). The 387-byte archive
has SHA-256 `b7b7a88138ac29952a712af412d33de6010bb45bc414ad50c1dd2ad90a2a682f`.
Its sole 446-byte XML member has SHA-256
`a1e7a2e4d920126eecd45fa6cb603d9da2deeb508dc9ae0ab4de8b08f2db1d2e`.
The retained XML preserves the publisher's CRLF and absent final newline; generated
XML uses the same root, namespace and original case-sensitive element names.

## Interpret the reviewed effects

The native JSON keeps its selected header, product subtrees, original identifiers,
numeric lexemes and reasoned corrections. Processing parameters can change how
2BA is asked to apply that message.

For example, a native FULL message with these selections is reviewed as a
mutation:

    {
      "schema": "stellar-forge.2ba-processing.v1",
      "reason": "Apply this selected delivery to the previous reviewed recipient state.",
      "parameters": {
        "OverrulePackageMutationCode": true,
        "PackageMutationCode": "UpdateExistingCatalog"
      }
    }

The profile stores this object under **processing**. The review exposes the
native and effective types under **recipient.processing**. Its main
**recipient.catalogueType** is the effective processing type. The exported
native JSON and its member filename retain the native type.

Effective CHANGE requires the original previous recipient review from the same
catalog, tenant and recipient target. Existing native CHANGE header-reference
requirements also remain in force. A complete delivery's omission behavior is
shown against the selected previous recipient state.

The [2BA xChange rules](https://www.2ba.nl/en/documentation/file-exchange/etim-xchange-v2-0/)
distinguish complete and mutation handling, native status codes and the supplied
product/trade-item mapping. The review combines those rules with the selected
processing controls:

- Skipped products and trade items retain their prior records. A supplied new
  record that is skipped has no resulting recipient record. Both cases appear
  as **skipped**, with the originating parameter and full before/after values.
- Skipping prices retains the previous Pricing subtree and its exact numeric
  provenance for each loaded trade item.
- Skipping attachments retains the corresponding previous attachment subtree.
- Explicit attachment retention keeps omitted original references and applies
  the supplied references. Matching uses the original type, specification, URI
  and language; new supplied details take precedence for that reference.
- Explicit attachment removal uses the supplied attachment set for that record.

For an active FULL delivery, check 7000160 selects 106 to keep omitted references
or 108 to remove them. For CHANGE, check 7000161 selects 166 to keep them or 165
to remove them. Both checks may travel in one parameter file; the effective
dataset type selects the applicable check.

If a previous reference would be omitted and the selection leaves the
interactive choice unresolved, the review points to that exact control.
Choosing it and reviewing the next saved submission revision resolves the
ambiguity before creating the ZIP.

A master GLN conversion uses the recipient account's mapping. The reviewed
source identities stay visible alongside that requested conversion. The source
reference state does not contain the bytes or hash that 2BA later obtains when
it downloads an attachment.

## Preserve the native MDX selection

xChange uses its original MDX attachment specifications. The native format's
attachment section documents URL retention per MDX code. The general parameter
page illustrates BMEcat MD codes; they belong to a separate code list.

Enter original xChange MDX codes in the attachment field. The saved processing
selection carries the same semicolon-separated value in KeepMimeURL. The
normalizer rejects conflicting selections and checks the codes against the
pinned original xChange schema. Choosing * requests every recipient-eligible
code and displays that scope explicitly.

The native JSON is unchanged by URL-retention settings. The archive carries
references already present in the reviewed data; it does not need to stage the
referenced remote files.

## Browser delivery

After saving and reviewing the submission:

1. Inspect recipient counts and the complete record effects. Filter **Skipped by
   processing** to inspect ignored source rows and their retained prior state.
2. Resolve the reported delivery errors through the existing reasoned correction
   and submission workflow.
3. Download **2BA processing parameters (XML)** to inspect the exact selection.
4. Download **Complete 2BA upload package (ZIP)** from the same zero-error review.

Both links contain the original review ID and expected review SHA-256. Existing
review, issues, full product, recipient JSONL, impact CSV and native xChange JSON
exports remain available from that review.

## Installed CLI

Use the existing installed command and source workspace:

    starforge opensearch-catalog catalog-supplier-save \
      --source SOURCE.json --workspace PRIVATE_DIR --request submission.json

    starforge opensearch-catalog catalog-supplier-review \
      --source SOURCE.json --workspace PRIVATE_DIR --request review.json

The submission request contains the complete profile with its optional
processing object. The review request uses the current submission revision.
Read the actual returned review ID and SHA-256, then export:

    starforge opensearch-catalog catalog-supplier-export \
      --source SOURCE.json --workspace PRIVATE_DIR \
      --review REVIEW_ID --review-sha256 REVIEW_SHA256 \
      --format parameters.xml --output parameters.xml

    starforge opensearch-catalog catalog-supplier-export \
      --source SOURCE.json --workspace PRIVATE_DIR \
      --review REVIEW_ID --review-sha256 REVIEW_SHA256 \
      --format 2ba.zip --output upload.zip

The output receipt records the actual byte count and SHA-256. Existing complete
output files are adopted only when their bytes match the generated original
descriptor. Standard-output export remains supported through --output -.

## Native MCP and typed client

The original supplier export tool accepts **parameters.xml** and **2ba.zip** in
its formats array. A request can retain several selected files from the same
review under the existing retained manifest:

    {
      "workspace": "operator",
      "requestId": "original-2ba-package-request",
      "reviewId": "REVIEW_ID",
      "expectedReviewSha256": "REVIEW_SHA256",
      "formats": ["parameters.xml", "xchange.json", "2ba.zip"]
    }

Send that object to **merchant_opensearch_supplier_export**, or call
**supplierExport** on the existing workspace-scoped typed client. Resume and
download through its original retained export helper. The manifest, file read
and release tools preserve the export ID, selected SHA-256, original read offset
and private read lifetime.

The parser does not load the complete native dataset or ZIP into memory.
Two coalesced 64 KiB byte streams feed Node's raw Deflate compressor. The archive
stores each member's CRC-32, 64-bit sizes and offsets. Its flat members, ZIP64
directory and end records follow
[PKWARE APPNOTE 6.3.10](https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT).
The retained-file limit is 8 GiB per complete archive. Cancellation drains the
original source iterator and compressor before the enclosing snapshot closes.

## Resume and receive

Processing settings are part of the original immutable profile, review and
export source fingerprint. A request that already sealed its files reuses those
exact bytes after later supplier edits. An interrupted unsealed generation can
resume under the original unchanged source selection. The maintained exporter
rejects a changed source selection for that request.

The original catalog v2 bundle carries the whole supplier plan, reasoned
correction history, processing review, and complete recipient records. Receiving
recomputes the effects, including skipped rows and retained subtrees, before
accepting those records. Older profiles without processing retain their existing
normalized shape, sealed hashes and receiving behavior.

The [2BA upload introduction](https://www.2ba.nl/en/documentation/file-exchange/file-upload/introduction/)
documents the recipient's supported compressed delivery and available transports.
The recipient operator selects the appropriate existing upload account and route
for the resulting file size. Record its processing report against the saved
review identity and the ZIP receipt so the actual acceptance result remains
joined to the delivered package.

## Complete native receiving operation

The installed product also carries
`./clients/opensearch-material/receiving/twoba`. From the complete source root,
continue the original xChange delivery and merchant receiving directories with:

    node --preserve-symlinks \
      stellar-forge/mcp-merchant-operator/receiving/twoba-materials-native.mjs \
      --xchange-directory ORIGINAL_XCHANGE_DIRECTORY \
      --materials-directory ORIGINAL_MCP_RECEIVING_DIRECTORY \
      --directory PRIVATE_2BA_DIRECTORY \
      --operation twoba-materials-2769

The original `xchange-delivery-native.json` and
`xchange-materials-native.json` must describe their completed operations. Use
Node24 and the existing merchant dependencies. Python3's standard `zipfile`
and XML parser independently read the generated files. The default source
directory contains the exact original ETIM schema/sample and downloaded
2BA parameter XML, together with their source identities.

The receiver imports the complete original supplier and customer catalog bundles
into its own two workspaces. Their earlier source editions, plans, corrections,
reviews and recipient records are retained. Both original operation directories
remain the inputs to the continuation.

This original sample also supplies a concrete data-quality correction. It contains
MC000023 version5, while the current original ETIM Viewer explicitly labels that
version **Ready for publication**. The receiver first saves the original38-token
product on its2BA plan and retains the actual modelling-release finding and
complete diagnostic exports. Its next reasoned correction omits only the three
optional modelling-class fields identified in
[the current reference decision](./source/2BA_RECEIVING_REFERENCES.json).
The ordinary ETIM classification and all other original product/trade data remain
unchanged. The complete38-token original remains in source custody; the selected
delivery preserves all33 remaining numeric tokens exactly. The
[reference explanation](./source/ETIM_MC000023_V5_SOURCE.md) retains both acquired
publisher versions and the full correction rationale.

The same product then completes six processing selections:

1. Complete product and trade-item loading.
2. Omitted attachments and prices with explicit prior-state retention.
3. Trade-item loading with product loading skipped.
4. Product loading with trade items and attachments retained.
5. A native FULL message with explicit mutation processing and both data lanes
   skipped.
6. The complete final customer package with both data lanes enabled.

Each selection produces the complete parameters XML, native JSON and upload ZIP
from its immutable review. The final selection also includes all eight supplier
exports. The independent archive reader compares both ZIP members with their
separately exported originals, checks CRC/ZIP64, and parses every selected
case-sensitive parameter against the actual publisher XML envelope.

The final ZIP download is interrupted after a real nonfinal prefix, then resumes
after the original merchant closes and reopens at its retained endpoint. The
complete catalog bundle carries every original and new history edition into the
customer workspace. That customer saves its own reviewed processing description
and reasoned confirmation; replaying the older producer/customer packages preserves
this newer work. The typed MCP client, installed material CLI and original
catalog CLI all produce the same selected package bytes.

The operation returns `twoba-materials-native.json` and retains its complete
diagnostic and delivery files under the selected directory. Reuse the same
directories, original inputs and operation ID after interruption so the saved
requests, review IDs, download offsets and customer changes continue together.
