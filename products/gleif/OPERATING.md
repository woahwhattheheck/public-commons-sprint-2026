# Company research from official GLEIF records

This installed workspace carries a company research task from official legal-name
or LEI search through full source capture, reviewed shortlist, source refresh,
customer report, native dataset and independently editable project receiving.

Open **Applications → GLEIF company research**, or use the installed
**starforge gleif** command. The browser, CLI, typed Node client and merchant
tools operate the same saved project and original operation records.

## Select and install the product

Build the maintained source at the exact revision being delivered:

~~~sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/merchant-checkout \
  --ref ORIGINAL_FULL_COMMIT \
  --selection gleif-research \
  --out /absolute/gleif-release
~~~

The gleif-research contribution includes the command, original source and
workspace APIs, typed client, browser assets, Applications provider and merchant
provider. The selected product keeps the existing native seller, buyer, dataset,
runtime installer and receiving components.

For a Node-only local research installation, use the source-only installed
archive with Node 22.16 or later, Linux and util-linux flock. The workspace uses
the product's original private-file and kernel-lock functions. Store working
projects outside the source checkout in a private directory.

For a native payment-enabled merchant installation, select the existing runtime
profile and native dependencies using the source archive returned by the builder:

~~~sh
starforge runtime-install prepare \
  --dir /absolute/gleif-runtime \
  --archive /absolute/gleif-release/ORIGINAL_PACKAGE.tgz \
  --sha256 ORIGINAL_ARCHIVE_SHA256 \
  --native --feature schema --feature openapi --feature mcp --operator

starforge runtime-install install --dir /absolute/gleif-runtime
starforge runtime-install inspect --dir /absolute/gleif-runtime --load --source
~~~

The [maintained runtime guide](../../stellar/scf-starforge-20261009/distribution/RUNTIME_INSTALL.md)
describes original installation, dependency selection and recovery. The GLEIF
capture itself uses Node's built-in HTTPS fetch.

## Create the customer's saved project

~~~sh
starforge gleif init \
  --workspace /absolute/private/company-research \
  --title "Company research"
starforge gleif serve \
  --workspace /absolute/private/company-research --port 0
~~~

Open the printed private URL. The server binds to 127.0.0.1 and writes a private
connection.json in the project directory. Managed Applications reviews the
same project identity and installed source before Start; Open, Stop and reopen
continue that original project.

A command operating a stopped project uses --workspace. For the running browser
application, replace --workspace with --connection and its actual private file:

~~~sh
starforge gleif status \
  --connection /absolute/private/company-research/connection.json
~~~

The Node client and merchant tools bind to the original instance. A new server
instance requires reconnecting through its current connection file.

## Search, capture and retain the original response

The browser offers legal-name search and exact LEI lookup. Country and source
status choices apply to name searches. **Capture all returned pages** retains
the entire result selected by that query. Each later capture has a new ID and
becomes a separate source edition.

The included examples are executable query plans:

- **gleif-foundation-plan.json** selects GLEIF's own published LEI,
  506700GE1G29325QX363.
- **name-plan.json** uses the complete foundation name as an official name query.

They specify requests. The provider response acquired at execution supplies the
actual source records.

~~~sh
starforge gleif capture \
  --workspace /absolute/private/company-research \
  --id foundation-original \
  --plan /absolute/installed-source/stellar/scf-starforge-20261009/sf30-seller-sdk/gleif/examples/gleif-foundation-plan.json
~~~

Keep the returned operation ID. A capture with an uncertain or interrupted
response resumes using the same ID and unchanged plan:

~~~sh
starforge gleif operation \
  --workspace /absolute/private/company-research --id foundation-original

starforge gleif capture \
  --workspace /absolute/private/company-research \
  --id foundation-original \
  --plan /absolute/private/foundation-plan.json
~~~

The second command uses the original plan content. Completed operations reopen
their saved result without a new GLEIF request. An interrupted capture retains
all completed original pages and resumes its next selected page.

The UI displays the complete request while it runs. **Pause source capture**
keeps the retained pages. Its saved request uses IndexedDB, so a lost HTTP
response or a browser refresh can continue the same operation. A provider
Retry-After is retained in the source state and respected on resume. A stopped
process reopens its saved running requests as interrupted and makes their exact
input available through the operation history. To correct an invalid request,
choose **Keep history and start another request**. The old request remains in
browser history and any admitted project operation; the corrected form creates
a new request.

## Receive a capture already acquired elsewhere

The source importer accepts the original full response envelope. For example,
a connected research session can assemble:

~~~json
{
  "plan": {
    "kind": "lei",
    "query": "506700GE1G29325QX363"
  },
  "pages": [{
    "url": "https://api.gleif.org/api/v1/lei-records/506700GE1G29325QX363",
    "startedAt": "ORIGINAL_REQUEST_START_TIME",
    "observedAt": "ORIGINAL_RESPONSE_TIME",
    "status": 200,
    "headers": {
      "content-type": "application/vnd.api+json"
    },
    "body": "COMPLETE_ORIGINAL_UTF8_JSON_RESPONSE"
  }]
}
~~~

The importer also accepts complete original JSON acquired by an attachment service
using a source URL. Retain status and headers as null when that service does not
expose origin HTTP fields, and provide acquisition.kind SOURCE_URL_ATTACHMENT,
its original sourceUrl, the body sha256 and the complete uploaded receipt
(file_upload_id, content_length and content_type). The original acquisition receipt
stays with the source page. The included observed-foundation source uses this path.

Replace the time and body entries with the original observed values. The importer
retains those values as source observations and records its own import time
separately. A name query includes all original pages in the actual source order.

Use the browser's **Import already acquired responses** file control, or:

~~~sh
starforge gleif import-source \
  --workspace /absolute/private/company-research \
  --id original-provider-import \
  --file /absolute/private/original-responses.json
~~~

An imported source with an unfinished next link is retained as incomplete. Use
**Continue original pages** or a capture.resume request whose input.captureId
selects that original capture. It continues the retained next URL without
repeating completed pages. The merchant_gleif_resume_capture tool supplies the
same action. Reports and native datasets select complete source editions.

## Build a useful company shortlist

Select a source edition and open a company row. The detail panel presents the
legal name, LEI, separate entity and registration statuses, legal jurisdiction,
postal addresses and next renewal date. Country names accompany their original
jurisdiction codes; source observation times remain attached to each edition.
Open **Registration and relationship references** for the registered identifiers
and original source links to issuer, parent, branch and other related records.
**Complete original resource** retains every exact source field, including address
components and date/time values. **Download original source page** retrieves the
exact retained response bytes.

Record a reviewer, research rationale, intended customer use case and next work.
Choose **Include in shortlist**, **Research** or **Exclude from shortlist**.
The same review keeps its LEI through all source editions and revision history.
Select several companies across the source table and use **Review selected
companies** to save their whole review set together.

A current review can be supplied through the shared request API:

~~~json
{
  "id": "review-foundation-original",
  "action": "review.save",
  "input": {
    "id": "lei-506700GE1G29325QX363",
    "title": "GLEIF reference-data source",
    "captureId": "foundation-original",
    "lei": "506700GE1G29325QX363",
    "expectedVersion": 0,
    "decision": "include",
    "reviewer": "RESEARCH_OPERATOR",
    "rationale": "Retain the exact official entity record for the selected source research.",
    "useCase": "Company reference-data and onboarding integration",
    "nextWork": "Review the source identity with the receiving operator."
  }
}
~~~

Use the original returned capture ID. A changed review supplies the current
expectedVersion and a new operation ID. An interrupted request reuses its
existing operation ID and full original body.

~~~sh
starforge gleif run \
  --workspace /absolute/private/company-research \
  --request /absolute/private/review-foundation.json
~~~

The review.batch action accepts an input.items array containing these same full
review bodies. Every selected review is validated before the batch is committed.

The browser retains each draft with its selected source edition and the company
review version opened for editing. Selecting companies for a batch retains those
same source and review versions. Refreshing saved work updates the displayed
project without replacing an editor's original version or draft text.

If another review is saved while you are editing, the company panel displays the
current saved decision beside your retained edits. **Load the saved review** opens
that saved text. **Keep my edits with this revision** keeps your text and explicitly
uses the displayed version for the next save. The same correction is available
for a selected batch. Earlier requests remain in browser and project history;
a corrected save uses a new request. An earlier browser draft can be restored
explicitly in the selected company panel.

## Refresh the source and compare the complete records

Capture the same query with a new ID after the source period has changed. The
original query and responses stay intact. The browser's comparison selects an
earlier and later complete edition:

~~~sh
starforge gleif compare \
  --workspace /absolute/private/company-research \
  --before foundation-original \
  --after foundation-next
~~~

The comparison includes every changed attribute and relationship, presence flags,
complete before/after resources, and added/missing/unchanged records. It requires
the same original query, country, statuses and page size. Missing records are
described as absent from the later selected search.

When a company's complete source resource differs from its saved review, the
browser asks for another research review against that edition. An earlier
accepted source stays available in its reports and in the complete project
history.

## Deliver complete customer files

Choose the complete source editions and either the included shortlist or all
selected source records. **Prepare full report and data** creates five complete
customer files:

| File | Contents |
| --- | --- |
| report.html | Printable company report, selected source context and complete resource details |
| report.json | Original report model, complete resources, source captures and reviews |
| entities.csv | Full original projected machine strings |
| entities.spreadsheet.csv | Separate spreadsheet-safe cells |
| entities.jsonl | Complete projected rows and original resource for each selected entity |

A report request uses the same original API:

~~~json
{
  "id": "company-report-original",
  "action": "report.prepare",
  "input": {
    "title": "Reviewed company source research",
    "captureIds": ["foundation-original"],
    "selection": "included"
  }
}
~~~

To include a full source comparison, add input.compare with the original before
and after capture IDs. The report freezes the selected complete records and
source-specific review editions before creating customer files. An interrupted
report or dataset resumes those original selections even if later company review
has continued. Subsequent work creates a new report or dataset.

The HTML customer report uses the same readable company facts, postal addresses,
renewal dates and source-reference links as the application. Each source edition
shows the original response observation time, with its saved-project time and
exact reference available separately. Research rationale, customer use case and
next work appear together beside the reviewed company. The report retains the
complete original resource, while its accompanying CSV, JSON and JSONL carry the
full source fields for downstream use.

## Prepare and operate a native merchant dataset

**Prepare native dataset** receives the same selected source records into the
original SF30 CSV dataset. The dataset contains all declared columns as strings,
with explicit legal-name, LEI, status, jurisdiction and capture filters.

~~~json
{
  "id": "company-dataset-original",
  "action": "dataset.prepare",
  "input": {
    "name": "Reviewed company reference data",
    "captureIds": ["foundation-original"],
    "selection": "included"
  }
}
~~~

The result retains the actual original dataset description, snapshot and files
under datasets/company-dataset-original/. **Query native dataset** uses the
maintained admission, filters, sort and page-cursor behavior. The same CLI is:

~~~sh
starforge gleif dataset-query \
  --workspace /absolute/private/company-research \
  --id company-dataset-original \
  --query 'limit=50'
~~~

For native publication, use the dataset files with the existing source product:

~~~sh
starforge dataset \
  --dataset /absolute/private/company-research/datasets/company-dataset-original/dataset.json

starforge dataset \
  --dataset /absolute/private/company-research/datasets/company-dataset-original/dataset.json \
  --payment /absolute/private/original-public-payment.json \
  --origin https://YOUR_CONFIGURED_MERCHANT \
  --path /companies \
  --out /absolute/private/company-seller.json
~~~

The original dataset command validates the selected payment terms and generates
the native seller definition. Its own help describes the unchanged seller
startup: serve.mjs --config seller.json --handlers examples/dataset-application.mjs
with SF30_DATASET_CONFIG set to the same absolute dataset configuration. The
original merchant host, buyer, spending approval, dataset delivery and receiving
workflows retain their native operation IDs. Source research and company review
are completed before that separately configured service is operated.

## Typed Node and merchant operation

The product exports the typed client at ./seller/gleif/client:

~~~js
import { GleifClient } from './source/stellar/scf-starforge-20261009/sf30-seller-sdk/gleif/client.mjs';

const client = await GleifClient.connect(
  '/absolute/private/company-research/connection.json'
);
try {
  const status = await client.status();
  const page = await client.rows('foundation-original', { offset: 0, limit: 50 });
  const operation = await client.run({
    id: 'company-report-original',
    action: 'report.prepare',
    input: {
      title: 'Reviewed company source research',
      captureIds: ['foundation-original'],
      selection: 'included'
    }
  });
} finally {
  client.close();
}
~~~

Use the package's actual installed name from its source manifest, or import the
same client.mjs from the retained source tree. The declared types describe plans,
source pages, reviews, records, project state, operations and complete files.

The merchant provider ID is gleif-research. Its private configuration is:

~~~json
{
  "schema": "stellar-forge.gleif-research.v1.operator",
  "workspaces": {
    "company": {
      "connectionFile": "/absolute/private/company-research/connection.json",
      "workspaceId": "ORIGINAL_WORKSPACE_UUID",
      "workspaceIdentity": "ORIGINAL_WORKSPACE_IDENTITY_SHA256",
      "label": "Company research"
    }
  }
}
~~~

Read those identities from the current startup/connection file. Initialize the
existing merchant provider with its host's original configuration path. The
merchant_gleif_connect result supplies the current instanceId for subsequent
tools. Nineteen registered tools cover workspace discovery/connection, status,
paged records, comparisons, operation recovery, source capture/import, individual
and batch review, reports, native datasets/query, project files and exact chunked
file reading. Disconnect closes that client; Applications retains its listener.

Complete JSON project delivery has a 256 MiB limit, including base64 expansion,
project state and retained histories. Every source response page can contain up
to 16 MiB. The original CLI export and receiving path can carry larger complete
JSON files when every retained object remains within its declared limit; browser
and client responses retain the 256 MiB limit. Use the source archive and the
original full CLI receiving path when a complete JSON exceeds browser delivery.

For large project delivery, merchant_gleif_project_file returns one immutable
file identity. Read it with merchant_gleif_file, retaining sha256 and nextOffset
until all bytes arrive. This keeps the complete original package out of a single
oversized tool response.

## Export and independently reopen the project

**Export complete project** downloads the original private project package.
The CLI supplies the same complete file:

~~~sh
starforge gleif export \
  --workspace /absolute/private/company-research \
  --out /absolute/private/company-research.json

starforge gleif receive \
  --workspace /absolute/private/received-company-research \
  --file /absolute/private/company-research.json

starforge gleif serve \
  --workspace /absolute/private/received-company-research --port 0
~~~

Receiving restores the same original workspace identity, complete captures and
HTTP observations, all review revisions, frozen reports, native datasets and
operation history. It checks every object identity and original source sequence.
A source edition containing repeated LEIs is retained in full with a source-review
issue; the receiving project keeps those original rows while company decisions,
comparisons and customer datasets use a new complete edition without duplicates.
The original dataset files are recreated from their retained exact bytes. New
immutable files are staged and flushed before their completed filename appears,
so interrupted object or dataset writes resume from the original input. The
complete saved project state is checked against its 256 MiB reopening limit before
replacing the previous readable state.

A receiver interrupted before completion uses the same package and destination.
An existing working project is opened normally rather than overwritten. Source
software is supplied separately through the selected original archive and its
manifest.

The receiving engineer should open the selected company detail, download an
original source page and report, query the retained native dataset, then save
the next agreed review or source edition. That completes the useful research
handover in the same application.

## Original source and ready receiving example

The [observed foundation and Singapore branch example](../../stellar/scf-starforge-20261009/sf30-seller-sdk/gleif/examples/observed-foundation-20261012/README.md)
contains the complete original API bodies, actual acquisition receipts, full rendered
company reports and ready source/review/report/dataset requests. Its source fields
exercise legal jurisdiction, distinct legal and headquarters countries, reporting
exceptions and branch relationship references using actual provider records.

## Source references

- [Official API and search capabilities](https://www.gleif.org/en/lei-data/gleif-api/)
- [Official API documentation](https://documenter.getpostman.com/view/7679680/SVYrrxuU)
- [GLEIF data dictionary](https://www.gleif.org/en/lei-data/access-and-use-lei-data/gleif-data-dictionary)
- [Repeating successors, event groups and relationship field changes](https://www.gleif.org/content/4_lei-data/1_access-and-use-lei-data/6_supporting-documents/GLEIF-API-Changes-Documentation.html)
- [Source data terms](https://www.gleif.org/en/meta/lei-data-terms-of-use)
- [Complete implementation source contract](../../stellar/scf-starforge-20261009/sf30-seller-sdk/gleif/SOURCE_CONTRACT.md)
