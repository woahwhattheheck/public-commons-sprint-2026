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

Routes without `admit` keep their original native behavior. **CHALLENGE_ONLY mode
is unchanged:** it advertises the original 402 offer without executing admission
or protected handlers. Actual admission runs when the service is configured with
its native payment server. Health route metadata reports whether a callback is
configured; that flag alone is not proof that native payment mode is enabled.

## Focused acceptance

From a full source checkout on Node.js 22 or newer:

```sh
node --test stellar/scf-starforge-20261009/sf30-seller-sdk/test/admission.test.mjs
```

This check runs the original service through real loopback HTTP with a controlled
native-server collaborator. It covers decision ordering, unchanged request data,
status/header restrictions, timeout and real disconnect, startup bindings and
challenge-only compatibility. It performs no wallet/provider request and is not
a chain-settlement demonstration. No optional SDK installation or hosted CI is
required for this focused check.
