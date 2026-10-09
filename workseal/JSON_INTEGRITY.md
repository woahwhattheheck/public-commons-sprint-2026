# Lossless JSON at the receipt boundary

WorkSeal's canonical form accepts JSON values with safe-integer numbers. It must
not discard a supplied field or silently invent a value before hashing/signing.

The server and browser now retain own data keys such as `__proto__`, including
nested occurrences. The strict retained-response parser creates ordinary own data
properties rather than invoking the legacy prototype setter. Required provider
fields are checked as own properties. Sparse arrays are rejected instead of being
silently converted into arrays containing `null`; dense arrays containing explicit
`null` remain valid.

The capture parser validates the exact decimal number before conversion to a
JavaScript Number. Thus `1e-400`, `0.99999999999999999`, and
`9007199254740990.9` are rejected instead of becoming 0, 1, and 9007199254740991.
Exact integral decimal/exponent forms such as `12.000`, `1.2e1`, and `100e-2`
remain supported. The integer's output length is bounded before zero-padding.

Ordinary dense JSON retains its existing canonical bytes. Values previously
accepted through field loss, sparse-array substitution, or numeric rounding must
not be treated as equivalent to the corrected representation. Retain the original
raw evidence; review and regenerate affected receipts rather than automatically
re-signing or accepting an old ambiguous signature. This change preserves the
shared Gregorian timestamp validation.

## Focused verification

Run from the repository root, with Node 22:

```sh
node --test workseal/test/json_integrity.test.mjs
```

The five focused tests cover node/browser parity, a real local Ed25519 signature
mutation rejection, sparse arrays, parser key/duplicate semantics, and exact
integer boundaries. All five passed in the cloud container against the changed
source. The untouched dependencies were checked against their upstream Git blob
IDs before running. No network request, chain transaction, live provider receipt,
competition submission, or full repository test run is implied.
