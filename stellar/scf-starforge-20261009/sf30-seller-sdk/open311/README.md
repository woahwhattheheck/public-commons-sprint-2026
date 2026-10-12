# Open311 municipal service operations

Connect a public service-request endpoint, retain its original responses, review changing cases, assign internal work, and deliver a complete customer workspace. The same application provides a local browser desk, an operating CLI, a typed source client, original-file export, and receiving into another workspace.

Use **Node 22.13 or newer**. The workspace uses built-in SQLite; the protocol client and domain functions use only Node built-ins.

## Open the desk

From the seller SDK directory:

~~~sh
node open311/cli.mjs serve --workspace /private/municipal-desk --port 0
~~~

The command prints one compact startup JSON line containing the local URL, workspace ID and launch binding. The Applications launcher can pass --expected-workspace-id and --expected-binding-sha256 to reopen that exact workspace. Keep one persistent workspace directory so the connection records, captures, reviews and operation history reopen together. The browser interface and CLI use that same workspace.

A connection has a stable ID, endpoint and optional jurisdiction. Its endpoint and jurisdiction remain bound to that ID after source capture. Add another connection ID for a different source.

## Connect an actual provider

Save this Helsinki connection as a local JSON file:

~~~json
{
  "id": "helsinki",
  "name": "Helsinki public service requests",
  "baseUrl": "https://palautteet.hel.fi/public-api/open311-public-service/v1",
  "responseLimit": 200,
  "pagination": false,
  "extendedAttributes": true,
  "statusValues": ["READY", "PROCESSING"],
  "queryExtensions": ["locale", "updated_after", "updated_before", "lat", "long", "radius"],
  "attribution": {
    "publisher": "Helsingin kaupunginkanslia",
    "title": "The Issue Reporting API of the City of Helsinki",
    "license": "CC BY 4.0",
    "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
    "sourceUrl": "https://hri.fi/data/en_GB/dataset/helsingin-kaupungin-palauterajapinta"
  }
}
~~~

~~~sh
node open311/cli.mjs connection-put \
  --workspace /private/municipal-desk \
  --file helsinki-connection.json --request-id helsinki-connect-01
~~~

Provider references:

- [City of Helsinki API description, October 2025](https://www.hel.fi/static/avoindata/kanslia/Open311_API_description_011025.pdf)
- [Helsinki Region Infoshare catalog and source license](https://hri.fi/data/en_GB/dataset/helsingin-kaupungin-palauterajapinta)
- [FixMyStreet provider documentation](https://www.fixmystreet.com/open311)

The Helsinki profile retains its native status names and declared 200-record response limit. Public results are the provider's published subset. Attribution travels with the connection and customer export. Provider settings remain editable as documentation changes, while the source connection identity remains stable.

For a credentialed endpoint, set apiKeyEnv to the environment-variable name on the operator host. The client resolves it when opening the connection and redacts its credential parameter in URL receipts. A direct apiKey is also available for private programmatic use. Additional settings include timeoutMs, maxResponseBytes, discoveryUrl, jurisdictionId, and allowHttp.

## Capture the catalog and requests

~~~sh
node open311/cli.mjs capture \
  --workspace /private/municipal-desk \
  --connection helsinki --kind services --request-id helsinki-services-01

node open311/cli.mjs services \
  --workspace /private/municipal-desk --connection helsinki
~~~

A declared provider parameter such as locale can be supplied in a JSON file with --query. For an entry declaring metadata, read its service definition with --kind service --resource-id SERVICE_CODE. The complete definition and arbitrary provider fields stay in the saved response.

Capture an explicit request window:

~~~sh
node open311/cli.mjs capture \
  --workspace /private/municipal-desk \
  --connection helsinki --kind requests \
  --start 2026-09-01T00:00:00Z --end 2026-09-02T00:00:00Z \
  --extensions true --request-id helsinki-september-01

node open311/cli.mjs capture-info \
  --workspace /private/municipal-desk --id CAPTURE_ID
~~~

Use the actual capture ID returned by the first command. Complete captures include original response bytes, byte length and SHA-256, parsed values, normalized rows, selected query, source connection, HTTP status and observation time. Base64 retains the original body in portable JSON. capture.query records the parameters actually sent; requestedQuery preserves the original operator selection when the protocol overrides filters.

The GeoReport v2 core uses timezone-qualified date filters, a maximum 90-day interval, and a default cap of 1,000 requests. ID selection overrides other filters. JSON availability is provider-specific; paging and extended attributes are separate extensions. References: [core](https://wiki.open311.org/GeoReport_v2/), [discovery](https://wiki.open311.org/Service_Discovery/), [extensions](https://wiki.open311.org/GeoReport_v2/Extensions/).

queryExtensions explicitly names additional provider parameters. A JSON query file carries those fields; inline CLI filters override matching file fields. Identifiers preserve case, including providers where differently capitalized category codes identify different services.

Each capture makes one selected endpoint request. A provider declaring pagination accepts --page and --page-size. Coverage metadata shows the declared limit and whether the returned count reaches it. Select a narrower source window or another supported page when needed, retaining each response as a separate capture.

## Review cases and source changes

~~~sh
node open311/cli.mjs requests \
  --workspace /private/municipal-desk \
  --capture CAPTURE_ID --status PROCESSING --q street --offset 0 --limit 100

node open311/cli.mjs request \
  --workspace /private/municipal-desk \
  --capture CAPTURE_ID --id SERVICE_REQUEST_ID

node open311/cli.mjs diff \
  --workspace /private/municipal-desk \
  --before EARLIER_CAPTURE_ID --after LATER_CAPTURE_ID
~~~

Rows expose the source service, status, description, agency, address, dates and coordinates. Each retains the entire provider object and a deterministic source hash. Null fields, attachments, nested agencies and additional attributes remain in that object. Source status keeps the provider's own value.

Identity combines the saved jurisdiction connection with the exact request ID. Local service-code filters are case-sensitive. Malformed or duplicate identities surface as normalization errors while the original response remains available.

To capture a current individual case, use --kind request --resource-id SERVICE_REQUEST_ID. To resolve a provider token, use --kind token --resource-id TOKEN.

Comparisons identify additions, changes to original provider fields and unchanged records. Absence is reported only for matching explicit IDs or fixed source windows. Rolling windows do not establish comparable absence. The missingFromCapture field means that a record was absent from the later response; completion requires an actual provider status change.

## Assign internal work

Save a local review file:

~~~json
{
  "status": "assigned",
  "assignee": "Operations",
  "note": "Review source photos and route maintenance follow-through.",
  "dueDate": "2026-10-16"
}
~~~

~~~sh
node open311/cli.mjs review-put \
  --workspace /private/municipal-desk \
  --connection helsinki --id SERVICE_REQUEST_ID \
  --file review.json --request-id case-review-01
~~~

Local status is new, assigned, in_progress or done. Reviews retain their source capture/hash association and history. Their operating status remains separate from the civic provider's original status.

The browser and CLI mutations carry requestId and expectedRevision. The CLI prints both before submitting. Preserve the same values and inputs to resume an operation:

~~~sh
node open311/cli.mjs operation \
  --workspace /private/municipal-desk --id case-review-01
~~~

For an exact retry, pass --request-id case-review-01 --expected-revision ORIGINAL_REVISION to the original command. An overlapping edit returns a revision conflict. Review intervening work before submitting a new intended update with a new operation ID. An admitted capture keeps its source selection while concurrent local reviews retain their own changes.

## Deliver and reopen

~~~sh
node open311/cli.mjs export \
  --workspace /private/municipal-desk \
  --kind workspace --out municipal-workspace.json

node open311/cli.mjs receive \
  --workspace /private/municipal-received \
  --file municipal-workspace.json --request-id municipal-receive-01
~~~

The receiving operation preserves source captures and review context. Open the receiving directory with serve or inspect it with state.

| Export kind | Complete output |
| --- | --- |
| source | Original response bytes |
| json | Capture, normalized rows and local reviews |
| csv | Tabular case handoff |
| report | Printable HTML operating report |
| workspace | Complete portable workspace |

For a selected capture:

~~~sh
node open311/cli.mjs export \
  --workspace /private/municipal-desk \
  --kind source --capture CAPTURE_ID --out original-response.json

node open311/cli.mjs export \
  --workspace /private/municipal-desk \
  --kind report --capture CAPTURE_ID --out municipal-report.html
~~~

CLI output files use new paths and contain the complete result. Omit --out to write the full body to standard output. capture-info exposes the saved value, rows, raw body and receipt beyond state's summary.

## Programmatic client

index.mjs exports the lightweight client and pure domain functions, with matching index.d.mts declarations.

~~~js
import { createClient, normalizeRequests, queryRequests } from './open311/index.mjs';

const client = createClient(connection);
const source = await client.requests({
  start_date: '2026-09-01T00:00:00Z',
  end_date: '2026-09-02T00:00:00Z',
  extensions: true,
});
const rows = normalizeRequests(source.value, { connectionId: connection.id });
const page = queryRequests(rows, { status: 'PROCESSING', limit: 100 });
~~~

Methods are services, service, requests, request, token and discovery. Discovery uses a separately supplied discoveryUrl. Request options accept a cancellation signal. HTTP errors, invalid JSON, interrupted bodies and response-size failures carry Open311Error.result with the retained response and receipt. Partial bodies are marked complete: false. Redirect responses produce an HTTP error so an endpoint move can be selected explicitly.

The durable workspace module serves the CLI and local operator server. [Merchant setup, tools and typed SDK](MCP.md) expose that same workspace through the maintained merchant contract. [The browser operating guide](workspace/WORKSPACE.md) follows the complete customer desk. Source definitions are in index.d.mts; workspace.d.mts, server.d.mts and mcp-client.d.mts describe the original operating interfaces.
