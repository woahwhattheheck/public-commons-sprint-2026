# Primary sources

Read October13,2026.

1. [DDAI-COMPLY public API overview](https://ddaicomply.com/api-docs): published descriptions of the synthetic sandbox, asynchronous events, idempotency and cursor pagination. Exact operation schemas, event verification, key scope/lifetime and pagination guarantees must come from the maintained selected release before executable examples use them.
2. [RFC9110: HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110.html): section9.2.2 on automatic retries and idempotent semantics; section15.3.3 on202Accepted.
3. [OpenAPI3.0.3 Callback Object](https://spec.openapis.org/oas/v3.0.3.html#callback-object): describing provider-initiated callback requests associated with an operation. It does not establish a particular provider's delivery semantics.
4. [OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html): useful event context and exclusion or controlled handling of sensitive data.

The technical design, client record and operator decision table are original illustrative recommendations. They are not claimed observations of an executed provider integration.
