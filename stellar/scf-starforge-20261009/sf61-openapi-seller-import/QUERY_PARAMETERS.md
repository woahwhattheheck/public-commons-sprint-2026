# Native merchant query parameters

The original OpenAPI importer, merchant workspace, live admission and route acceptance now share one query codec. It supports scalar strings, booleans, finite numbers and safe integers, including a schema with one such type plus null, and arrays of scalar items. The original schema validator still checks enum, bounds, length, uniqueness and all other retained assertions.

## Review the actual wire encoding

OpenAPI query parameters default to form style. Form defaults to `explode: true`, so an array is represented by repeated keys. With `explode: false`, it is represented by one comma-delimited value. Explicit source settings are retained.

When a provider's parameter description and omitted/default serialization differ, record the deliberate choice in the original merchant operation:

```json
{
  "querySerialization": {
    "selections": {"style": "form", "explode": false}
  },
  "requestExample": {
    "query": {
      "page": 1,
      "pageSize": 5,
      "acceptFormat": "json",
      "selections": ["id", "name"]
    }
  }
}
```

This example describes the selected Blockworks list operations. Confirm the selected fields against that operation's original enum. Every override must name an actual query parameter; it changes only the explicitly prepared public facade. The provider source bytes, source hash and schema assertions remain intact.

For an existing source-refresh review, put the same `querySerialization` object in that mapping's `settings`. It becomes part of the saved plan, preview and review identity. Changing the source, selection, settings or generated offer requires the current original review identity when saving a package.

## Original offer and customer request

The imported Bazaar extension carries `querySerialization` beside its existing `info` and `schema`:

```json
{
  "schema": "stellar-forge.http-query.v1",
  "parameters": {
    "selections": {"style": "form", "explode": false}
  }
}
```

It is serialization metadata, not an extra JSON Schema assertion. Existing scalar offers without this metadata retain ordinary form encoding.

Use the same exported helper when authoring an actual customer URL:

```js
import {encodeQueryParameters} from '../sf30-seller-sdk/query-parameters.mjs';

const bazaar = offer.extensions.bazaar;
const url = new URL(offer.resource.url);
url.search = encodeQueryParameters(
  {page: 1, pageSize: 5, acceptFormat: 'json', selections: ['id', 'name']},
  bazaar.schema.properties.input.properties.queryParams,
  bazaar.querySerialization
);
```

Pass that concrete URL through the existing reviewed buyer workflow. The native upstream retains repeated query pairs. The original admission callback reconstructs typed arrays and then applies the original schema validator before the existing payment path.

| Selection | Declared form | Encoded query |
| --- | --- | --- |
| `['id', 'name']` | explode true | `selections=id&selections=name` |
| `['id', 'name']` | explode false | `selections=id%2Cname` |
| Boolean false | scalar | `hasDiligence=false` |
| String `''` | scalar | `name=` |

## Null, empty and duplicate values

Nullable validation does not define a universal null query token. Null does not bypass an enum that excludes it. An explicit null or empty-array request case is rejected because this native wire path cannot distinguish every nullable/empty interpretation. Select a concrete value or omit an optional filter deliberately. The automatic acceptance planner may omit optional null/empty discovery examples; it never edits an explicit operator case.

An empty string remains a string. A string array containing one empty item is distinct from an empty array and follows the original item constraints. Repeated scalar keys and repeated comma-list keys are rejected. Repeated keys for an exploded array retain order and all values.

Comma-delimited items cannot themselves contain commas. The original URLSearchParams forwarding path cannot recover the difference between a delimiter and an escaped comma after decoding; the codec does not double-decode or invent an escaping rule. Choose a representable provider value or another declared encoding.

Arrays are limited to 1,024 actual wire items and encoded query text to 8 KiB; the existing route acceptance target and upstream URL limits still apply. Object/deep-object, non-form array styles and custom content encodings continue to need their own explicit native integration.

## Source contract

- [OpenAPI3.1.1 Parameter Object](https://spec.openapis.org/oas/v3.1.1.html#parameter-object) defines style/explode behavior.
- [OpenAPI3.1.1 query serialization appendix](https://spec.openapis.org/oas/v3.1.1.html#appendix-c-using-rfc6570-based-serialization) describes URI expansion and delimiter concerns.
- [OpenAPI3.0.3 Schema Object](https://spec.openapis.org/oas/v3.0.3.html#schema-object) preserves constraints on nullable values.

This addition composes the original merchant, admission and buyer interfaces. It does not replace the payment, upstream transport or retained customer workflow.
