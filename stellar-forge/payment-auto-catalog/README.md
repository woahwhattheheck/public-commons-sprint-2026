# SF-25 PaymentPayload auto-catalog adapter

This module implements the x402 Bazaar zero-registration path: after a trusted
facilitator hook reports an authenticated settlement, it extracts the v2
`PaymentPayload.resource`, `accepted`, and `extensions.bazaar` fields, validates
`info` against the supplied Draft 2020-12 schema, binds the echoed terms to the
settlement facts, and calls the merged SF-46 atomic catalog coordinator.

Source pins:

- `x402-foundation/x402@7f2b2f1f77fa5317615735e3378a6fad41cccb4e`
- `specs/extensions/bazaar.md` blob `442708e76d5a129e0c1393471d8ed71e3604c94e`
- TypeScript facilitator extractor blob `083013ee19544e182c2e3185d7853309c34b9d9c`

Run the focused checks:

```sh
node --test stellar-forge/payment-auto-catalog/auto-catalog.test.mjs \
  stellar-forge/product-integration/atomic-catalog.test.mjs
```

The validator supports the bounded structural subset used by
the canonical HTTP/MCP examples: local JSON Pointer `$ref`, `$defs`, object and
array structure, required/properties/additionalProperties, primitive types,
const/enum, allOf/anyOf/oneOf, basic length/range limits, and string `pattern`.
External refs and
unknown assertion keywords fail closed rather than causing network or file
resolution. This remains a declared subset of Draft 2020-12; unsupported schemas
are soft-dropped. No second validator is invoked or assumed.

## String patterns and source annotations

Install the exact maintained pattern engine for source checkout use:

```sh
npm ci --prefix stellar-forge/payment-auto-catalog --ignore-scripts
```

`schema-pattern.mjs` uses **re2js 2.8.6**, pinned in this directory's manifest and
lockfile. It loads the engine only for a schema containing `pattern`; existing
non-pattern workflows need no new dependency. A missing engine produces
`SCHEMA_PATTERN_ENGINE_UNAVAILABLE`, never a successful unvalidated assertion.
The distribution records this manifest under its `schema` runtime feature.

Patterns first receive a bounded ECMAScript Unicode syntax check, then execute
using [RE2JS's linear-time matcher](https://github.com/le0pard/re2js). Matching is
unanchored unless the source includes anchors. Dot, whitespace and backspace
escapes are translated to retain ECMAScript character semantics. Character
classes, literals, groups, alternatives, anchors and RE2-supported repetition
are supported. Backreferences, lookarounds, named groups, Unicode property
escapes, surrogate escapes and `\S` inside a character class are explicitly
unsupported. Unsupported syntax never becomes an absent constraint. Patterns
are limited to 4,096 UTF-16 units and 8,192 compiled instructions; the shared
LRU retains at most 128 patterns and 32,768 instructions. Existing schema byte,
node and depth limits also apply.

The Draft 2020-12 base vocabulary treats `format` as an annotation. This adapter
retains string-valued `format`, including provider-defined names, and validates
the annotation types of `readOnly`, `writeOnly`, `deprecated` and `$comment`.
It does not claim format-assertion support; custom assertion vocabularies remain
unsupported. See [JSON Schema Validation sections 7 and 9](https://json-schema.org/draft/2020-12/json-schema-validation).

The original OpenAPI 3.0 resolver separately applies request/response direction to
`required` when a resolved property declares `readOnly` or `writeOnly`, retaining
the property and every value assertion. These annotations do not themselves
prohibit supplying a value. Its OAS 3.0 adapter normalizes literal punctuation
identity escapes to their Unicode-compatible spelling without dropping the
pattern. OpenAPI 3.1 keeps JSON Schema `required` semantics and retains these
annotations without introducing directional assertions. See
[OpenAPI 3.0 Schema Object](https://spec.openapis.org/oas/v3.0.4.html#schema-object)
and [OpenAPI 3.1 annotation behavior](https://spec.openapis.org/oas/v3.1.1.html#validating-readonly-and-writeonly).

Local `$ref` targets and their adjacent assertions are both enforced, as required
by [Draft 2020-12 Core section 8.2.3.1](https://json-schema.org/draft/2020-12/json-schema-core#section-8.2.3.1).
A reference to a permissive schema cannot bypass an adjacent required field,
enum, range, or object-property constraint. Cycles remain rejected. The OpenAPI
3.0 importer resolves its Reference Objects before this validator is invoked,
so its separate rule for ignored Reference Object siblings is unchanged.

String `minLength`/`maxLength` count Unicode code points, as specified by
[Draft 2020-12 Validation section 6.3](https://json-schema.org/draft/2020-12/json-schema-validation#section-6.3),
so an astral character counts once and a combining sequence keeps its original
code points. The focused `schema-unicode.test.mjs` check includes an actual
OpenAPI import to dynamic HTTP 402 path with a one-character Unicode parameter.

## Trust boundary

The adapter does not verify signatures, Soroban authorization, transaction
finality, or the receipt hash itself. `settlement` is a typed handoff from the
canonical facilitator after those checks. A test fixture saying `settled` is
software behavior evidence only—not a real payment or network receipt. No
unauthenticated registration endpoint is exposed.
