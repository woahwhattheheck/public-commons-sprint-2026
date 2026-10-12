# OData provider contract

The workspace reads the service's own entity catalog and CSDL, compiles a
reviewed selection, and commits original page bytes before following the next
provider URL. All provider operations in this module are HTTP GET requests.

## Service discovery

~~~js
const catalog = await discoverService({
  url: 'https://services.odata.org/V4/Northwind/Northwind.svc/',
  authEnv: undefined,
  signal,
});
~~~

discoverService reads the JSON service document and $metadata. It supports
OData 4.0 and 4.01 CSDL XML and CSDL JSON, namespace aliases, inherited entity and
complex properties, inherited keys, composite keys, complex key paths, enums,
type definitions and container inheritance. It joins advertised entity sets to
their actual CSDL definitions. The catalog includes declared singletons and
navigation properties for inspection. Entity sets provide normalized structural
fields with name, path, type, nullable, collection and key.

The returned receipts.service and receipts.metadata each contain rawBase64,
sha256, requestedUrl, url, status, headers and receivedAt. Persist these together
with the reviewed catalog. CSDL references and aliases are retained; a required
structural type missing from returned metadata produces ODATA_CSDL_REFERENCE
with the exact unresolved type.

## Reviewed query

~~~js
const query = compileQuery(catalog, {
  entitySet: 'Orders',
  select: ['OrderID', 'CustomerID', 'OrderDate', 'Freight'],
  filters: [{ field: 'Freight', op: 'ge', value: '10.00' }],
  filterMode: 'and',
  orderBy: [{ field: 'OrderDate', direction: 'asc' }],
  count: true,
  pageSize: 200,
});
~~~

Paths must identify declared structural properties. Comparisons use the CSDL
type: eq, ne, gt, ge, lt, le, and the text functions contains, startswith and
endswith. Conditions join with the chosen and or or. String quotes are escaped
as OData literals before URL encoding. Boolean, integer range, enum member,
date, time, duration and GUID values are checked before a request. Enter Int64
values outside JavaScript's exact integer range as strings. Complete entity keys
are added to selection and ordering so captured rows keep their native identity.
Sort order appends any missing key fields after the reviewed sorts.

The returned query contains url, entitySet, entityType, fields, keyFields,
normalized plan, prefer and a fingerprint bound to the metadata hash. The
optional top is a service-side limit. pageSize becomes the standard
Prefer: odata.maxpagesize=... request header. Providers may apply a different page
size; their returned next link determines continuation.

## Original pages and continuation

~~~js
const page = await fetchPage({ catalog, query, signal });
// Commit page.raw and the complete response record atomically in the workspace.
const next = page.nextLink;
// A resumed workspace supplies its last committed next URL unchanged:
const following = next && await fetchPage({ catalog, query, url: next, signal });
~~~

Each page contains rows, nextLink, exact textual count or null, original raw
bytes, status, selected response headers and source. Source metadata includes
requested/final URLs, SHA-256, reception time, ETag, context, the original relative
or absolute next-link text, and an optional delta link.

The workspace owns its operation ID, raw page files, row/page totals,
continuation URL, cycle detection, maximum rows/pages/bytes and cancellation
state. parsePage uses identical schema handling on already retained bytes, so
reopening a saved capture needs no provider request. A missing next link
completes a normal collection page chain. The module does not manufacture skip
tokens, infer completion from a short page, or re-request a committed prefix.
An interrupted request leaves the workspace's previous committed URL available
for the same operation's resume.

Requests negotiate application/json;IEEE754Compatible=true without an
overriding $format=json. Decimal and Int64 values remain exact strings in
normalized rows even if the server sends JSON numbers. Parsing retains each
original numeric token before typed conversion and requires Node.js 24 or
later. Other integer primitives become exact JavaScript integers; floating-point
primitives retain their declared floating-point meaning. Original bytes always
remain available. Missing properties, explicit nulls, derived-type annotations
and entity ETags remain distinct in normalized data.

## Authentication and controls

authEnv names an environment variable containing the complete Authorization
header, such as a bearer header supplied by the existing connection workflow.
The catalog stores the reference name in its surrounding workspace settings;
provider receipts contain no Authorization value or cookies. Redirects and
continuation links remain in the selected service origin and root path.
Explicit allowLoopback supports a local HTTP service during development.

maxBytes defaults to 16 MiB per response and timeoutMs to 30 seconds; both are
configurable. Abort signals cancel discovery or a page request. Provider HTTP
errors retain actual status and selected response headers, including Retry-After.
The module performs no automatic retry, login, write, batch action or paid
service activation.

## Primary protocol sources

- [OASIS OData CSDL XML 4.01](https://docs.oasis-open.org/odata/odata-csdl-xml/v4.01/odata-csdl-xml-v4.01.html)
- [OASIS OData CSDL JSON 4.01](https://docs.oasis-open.org/odata/odata-csdl-json/v4.01/odata-csdl-json-v4.01.html)
- [OASIS OData JSON Format 4.01](https://docs.oasis-open.org/odata/odata-json-format/v4.01/odata-json-format-v4.01.html)
- [OASIS OData Protocol 4.01](https://docs.oasis-open.org/odata/odata/v4.01/odata-v4.01-part1-protocol.html)
- [Official OData example services](https://www.odata.org/odata-services/)
