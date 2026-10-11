# Application admission before native payment

The SF30 seller service supports an optional trusted application callback before
`nativeServer.processHTTPRequest()`. Use it to reject missing query fields,
invalid JSON values, unavailable datasets or other application-level conditions
before native verification or any SDK before-handler settlement. It reuses the
existing seller listener, handler module and native payment lifecycle.

## Bind an existing validator

In an existing `stellar-forge.seller-service.v1` configuration, set a route's
`"admit": "admitCityQuery"`. Load that export through the same `--handlers` module
as the protected application handler. `examples/admission.mjs` provides a
side-effect-free city-query example and an explicitly illustrative data handler.

```js
export function admitCityQuery({ query, body, pathParams, signal }) {
  // Call your application's actual validator here; do not use a Bazaar example
  // or its metadata schema as a substitute for an API request contract.
  if (typeof query.city !== 'string' || !query.city.trim()) {
    return { status: 422, body: { error: 'CITY_REQUIRED', fields: ['city'] } };
  }
  return true;
}
```

The callback receives `{method, url, query, body, pathParams, headers, signal}`.
The URL and data are isolated copies: mutating them does not transform the
request subsequently sent to the native SDK or application handler. Repeated
query parameters remain arrays. The merged dynamic-route binding and decoded
path parameters are retained. Admission is application validation, not a signer,
authorization grant, payment verification result or resource response.

For embedded usage, supply `admit` beside `handler` in `compileSellerRoutes()`.
The existing `createSellerResourceHandler()` accepts `admissionTimeoutMs`;
`startSellerService()` reads the same optional field from its config. The default
is 2,000 ms, with integer values from 1 through 60,000. Missing/noncallable exports
and invalid timeout values are rejected at startup.

## Validate live inputs from an imported API contract

Set `"validateInput": true` on an imported route in `seller-service.json`, or on
its original SF61 `--service-bindings` entry before export:

```json
{"method":"GET","path":"/forecast/{city}","id":"forecast","handler":"forecast","validateInput":true,"admit":"checkAvailability"}
```

The importer preserves this explicit choice. Start the exported configuration
with the same `serve.mjs --config FILE --handlers FILE` command and the existing
native facilitator option; no hand-written schema adapter is needed. `admit`
is optional: omit it to use schema admission alone. Static `response` and bundled
`responseFile` routes work the same way. `validateInput` must be a boolean;
`true` requires the original imported `offer`, not a plain `definition` or an
inferred contract made from examples. Missing/false preserves prior behavior.

This calls the **existing SF89 live-request admission** and SF25 schema validator,
not a second OpenAPI validator. It removes advertised examples before evaluating
actual query parameters, decoded path parameters and JSON body against the
retained supported schema. Declared scalar query values are interpreted for
validation only; business admission and the protected handler still receive the
original request data. Unsupported or duplicate query values are rejected.
The source OpenAPI importer and SF89 supported-schema limits still apply.

Order is **schema admission → optional business admission → native payment →
protected application → original settlement**. A schema failure returns a public
422 before business admission or native verification. The composed callback
shares the existing single timeout, cancellation signal and request-copy boundary.
Startup resolves and validates this composition before opening the listener.
It never imports application code during SF61 export.

`GET /_seller/health` now reports `inputValidation` per route alongside `admission`.
These are configuration flags; read `mode` as well. In `CHALLENGE_ONLY`, both
admissions remain unexecuted and the original unpaid 402 metadata remains available.

## Decision and execution order

Return exactly `true` to continue. Return `false` for the generic HTTP 422
`REQUEST_NOT_ADMITTED`, or a response object with an explicit HTTP 400–499 status
other than 402. Rejections use the existing response encoder and size ceiling;
payment headers are reserved, redirects and success statuses are not accepted.
Return only public validation errors, never protected data or raw exceptions.

A rejected request does not invoke the native verification, cancellation,
settlement or protected application callbacks. An accepted request follows the
unchanged original native verification → handler → settlement flow. Successful
admission alone does not release protected content.

Exceptions, malformed decisions, invalid rejection headers, oversized rejection
bodies and timeouts return generic HTTP 503 `REQUEST_ADMISSION_UNAVAILABLE`.
Client disconnection aborts the provided signal; a late successful callback never
resumes payment processing. Callbacks must be trusted, side-effect-free and honor
cancellation when doing asynchronous work. Cancellation cannot undo external
side effects, and JavaScript timers do not preempt a synchronously blocked event
loop. Run CPU-intensive validation outside the request event loop when needed.

Routes without `admit` or enabled `validateInput` keep their original native behavior.
**CHALLENGE_ONLY mode is unchanged:** it advertises the original 402 offer without
executing admission or protected handlers. Actual admission runs when the service
is configured with its native payment server. Health route metadata reports whether
a callback is configured; that flag alone is not proof that native payment mode is enabled.

## Focused acceptance

From a full source checkout on Node.js 22 or newer:

```sh
node --test stellar/scf-starforge-20261009/sf30-seller-sdk/test/admission.test.mjs
node --test stellar/scf-starforge-20261009/sf61-openapi-seller-import/admission-acceptance.mjs
```

These existing checks run the original service through real loopback HTTP with a
controlled native-server collaborator. They cover decision ordering, unchanged
request data, status/header restrictions, timeout and real disconnect, startup
bindings, original CLI export and challenge-only compatibility. They perform no
wallet/provider request and are not a chain-settlement demonstration. No optional
SDK installation or hosted CI is required for these focused checks.
