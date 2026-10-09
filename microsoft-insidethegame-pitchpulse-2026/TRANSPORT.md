# Foundry transport bounds

The optional adapter still runs only when explicitly requested. It sends the same
Azure v1 chat-completions request and returns an unverified `model-draft`, never a
verified match fact. No real Azure credential or inference was used to verify this
change.

Credential-bearing requests now use `redirect: 'manual'`. Every HTTP 3xx response
is rejected; the adapter never follows its Location with the API key. Only an
HTTPS Azure resource origin is accepted, with no path, query, fragment, user info
or non-default port. Configure the resource origin, not a full API endpoint URL.

Request JSON is bounded to 64 KiB of UTF-8 before sending. Response data is bounded
to 64 KiB, checked both against a numeric Content-Length and actual streamed bytes.
A response that grows beyond the limit is cancelled without parsing its content.
Malformed JSON is reported generically; response bodies and credentials are not
included in errors or successful draft metadata. Large evidence snapshots are
rejected instead of silently truncating facts; present a shorter selected replay
view or design an explicit compact-evidence projection when that limit is reached.

A six-second deadline covers request headers and the entire response body. The
request is aborted and reader cancelled at timeout. A caller may set `timeoutMs`
from 1 to 60000; the default is unchanged. Resource cleanup does not await an
uncooperative stream cancellation promise. This is per-call resource control,
not a replacement for the server's separate session, authentication and global
inference-budget controls.

Run the three focused offline transport checks:

```sh
node --test tests/foundry.transport.test.mjs
```

They use an injected fetch implementation with unmistakably fake credentials,
verify the outgoing redirect policy and request shape, reject oversized requests
and declared/streamed responses, and exercise a stalled-body deadline. These are
local transport-contract checks, not proof of a successful Azure response or a
hosted judge demonstration.
