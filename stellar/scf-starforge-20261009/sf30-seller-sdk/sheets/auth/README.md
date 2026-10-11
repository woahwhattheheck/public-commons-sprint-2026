# Renewable Google Sheets connections

Connect a merchant's Google account once, then let the existing Sheets publisher
renew read access for later extractions and scheduled publications. The
connection window reviews the registered client, requested permissions and
Google-returned account before saving it. All existing capture, typed projection,
candidate, review, version, seller and buyer behavior stays in the original
publisher.

This module uses Node 22.16 or later and Linux util-linux `flock`, as does the
publisher. It adds no npm dependency. The system browser handles Google sign-in;
the local window never asks for a Google password.

## Connect the registered desktop client

Use the existing Google Cloud project's **Desktop app** OAuth client JSON
download. Enable the Sheets API for that project and configure its intended
consent audience and test users through the project's normal administration.
The imported file must be a private regular file, mode 0600. The connection
directory must be an absolute path, mode 0700, with no symlink components.

The program imports only the client identifier and optional desktop-client
secret. It rejects a Web client and alternate authorization/token endpoints.
The downloaded client identifies the operator's project; no client or provider
account is created by this command.

From an installed toolkit:

```sh
starforge sheets-source auth connect \
  --client /private/google/desktop-client.json \
  --directory /private/google/merchant-connection
```

From a source checkout:

```sh
node sf30-seller-sdk/sheets/auth/cli.mjs connect \
  --client /private/google/desktop-client.json \
  --directory /private/google/merchant-connection
```

Open the printed local URL in the system browser on the host running the
command. Keep the command running. The listener binds only 127.0.0.1, selects an
available port, and uses a private session URL. A remote deployment can use an
explicit `--port` and a corresponding private SSH loopback forward; both
the local review URL and Google's callback must reach this same listener. A
browser in a different container's network namespace cannot reach it merely
because its URL also says localhost.

1. Review the client and permissions. Optionally enter the expected account
   email; the returned verified email must match when supplied.
2. Select **Connect with Google**. Google performs account selection and consent
   in the browser, using authorization code + PKCE S256 and a fresh random state.
3. After Google returns, review the verified account email and select
   **Use this Google account**. Until this local review is accepted, the prior
   saved connection remains the publisher's connection.
4. Close the connection window. The listener and its kernel lock close; the
   publisher can read and renew the saved grant without this window running.

Discarding a pending account retires that authorization flow, including an
exchange or approval waiting behind another refresh. A response that arrives
later cannot restore it. Once an approved account's atomic save has begun,
Discard reports that saving is in progress; read the current connection status
before disconnecting or reconnecting.

Reconnect by running `connect --directory ...` again. The original registered
client is already saved; omit `--client`. A changed client requires a distinct
connection directory. A concurrent connection window receives an existing
operation/busy outcome instead of taking over its callback.

### Permissions

The flow requests these exact scopes:

- `https://www.googleapis.com/auth/spreadsheets.readonly`
- `openid`
- `email`

The requested read-only scope covers spreadsheets the selected Google account
can access. This OAuth grant cannot be narrowed to one workbook, tab or A1
rectangle. The merchant's reviewed source separately
pins the workbook ID, stable tab ID/title, rectangle, headers and public columns.
The flow requests no spreadsheet writes or general Drive-file access. The
returned scope list is checked before account approval. Account identity comes
from Google's authenticated HTTPS UserInfo response; the module does not treat
an unverified decoded ID token as an identity.

Reference: [Google desktop OAuth](https://developers.google.com/identity/protocols/oauth2/native-app),
[Sheets scopes](https://developers.google.com/workspace/sheets/api/scopes), and
[Google OpenID Connect UserInfo](https://developers.google.com/identity/openid-connect/openid-connect#obtaininguserprofileinformation).

## Bind the connection to the reviewed source

Start with the source already prepared from your reviewed original CellData
capture, or an existing live source. This command writes a new source file:

```sh
starforge sheets-source use-connection \
  --source /private/merchant/reviewed-source.json \
  --connection /private/google/merchant-connection \
  --out /private/merchant/live-source.json
```

The workbook, queries, tab/range and public projection are preserved. The new
connection field is:

```json
{
  "kind": "google",
  "oauthDirectory": "/private/google/merchant-connection"
}
```

Choose exactly one `oauthDirectory` or `accessTokenEnv` in a live Google
connection. `oauthDirectory` is an absolute stable private reference.
`maxResponseBytes` and `timeoutMs` remain supported. Existing environment
tokens and immutable capture sources continue to work.

Use the original publication commands:

```sh
starforge sheets-source plan \
  --source /private/merchant/live-source.json \
  --query catalog --out /private/merchant/review-plan.json

starforge sheets-publisher serve \
  --workspace /private/merchant/publisher \
  --create --source /private/merchant/live-source.json \
  --state /private/merchant/dataset
```

Save and extract the reviewed plan in the original publisher. Review and publish
its candidate through the existing interface. Continuous publication uses the
existing saved plan, schedule controls, row-change rules, run history and
last-good dataset behavior.

The publisher copies its source declaration into an immutable plan directory.
That declaration contains only the absolute connection reference; it never
copies client secrets, tokens or account-profile files into the plan or
candidate. Renewing or reconnecting that directory therefore serves the same
saved plan after restart. Keep the connection directory separate from source
exports and customer packages. Source observations retain their original exact
bytes and one-response Google range semantics.

## Refresh, inspect and reconnect

```sh
starforge sheets-source auth status --directory /private/google/merchant-connection
starforge sheets-source auth refresh --directory /private/google/merchant-connection
```

Status returns client ID, verified account, scopes, expiry, reconnect state,
retry timing and recent operation names. Neither command prints token values.
The library's token-returning function is for the trusted source driver only.

The publisher resolves a credential immediately before a range request. It
reuses a valid token or refreshes under the connection's kernel lock. Multiple
publisher processes sharing this directory re-read the saved credential after
acquiring the lock, so the usual concurrent expiry case performs one refresh.
The response and any rotated refresh token are saved together by a durable
atomic replacement.

Each call sends one refresh request. Temporary endpoint failures preserve the
grant and save a retry time, preventing a fast scheduler error loop. A process
interrupted during refresh releases its kernel lock; a later call observes the
retained operation and can refresh again with the retained grant. It does not
claim that a response lost before persistence was saved. Google may require
reconnection if a refresh credential is no longer valid.

A Sheets 401 may renew and repeat that read once. A second 401 stays
`SHEETS_AUTH_EXPIRED`. A 403 remains access denied; a 429 remains Sheets rate
limited. Those responses do not initiate token refresh. Cancellation and the
original extraction deadline propagate into authorization and range reads.
Failed authorization cannot promote a candidate or erase the current dataset.

When Google reports an invalid/expired/revoked refresh grant, the directory
enters `reconnect_required`. Open the connection window and approve the account
again. Existing published data and source observations stay available. Google
can expire grants or impose project/account restrictions; a project whose
external consent screen remains in Testing can issue refresh tokens that
expire after seven days for these scopes. The connection records a provider
time-limited expiry when supplied.

Reference: [Google refresh and revocation](https://developers.google.com/identity/protocols/oauth2/native-app#refresh),
[OAuth grant expiration](https://developers.google.com/identity/protocols/oauth2#expiration), and
[credential handling](https://developers.google.com/identity/protocols/oauth2/resources/best-practices).

## Disconnect

```sh
starforge sheets-source auth disconnect --directory /private/google/merchant-connection
starforge sheets-source auth disconnect --directory /private/google/merchant-connection --revoke
```

The first command durably removes saved access and refresh tokens and prevents
future reads through this connection. Existing published data remains.

`--revoke` also asks Google to revoke the grant. Google revocation can affect
other connections for the same project/account. The status reports
`confirmed` only after a successful provider response. Local disconnection is
retained if the remote request fails; the returned `unconfirmed` outcome points
the operator to [Google account connections](https://myaccount.google.com/permissions).
A pending account-review window cannot later resurrect a disconnected grant.

The directory uses private files and atomic writes, not a public archive or
browser storage. Protect its host/backup like other unattended service
credentials. No token is placed in a query URL, command-line argument, activity
event, source declaration or provider error message.

## Native API

```js
import {
  initializeGoogleConnection,
  googleConnectionStatus,
  getGoogleAccessToken,
  refreshGoogleConnection,
  disconnectGoogleConnection,
  beginGoogleAuthorization,
} from './auth/oauth.mjs';
import { serveGoogleConnection } from './auth/server.mjs';

await initializeGoogleConnection('/private/google/merchant', '/private/google/client.json');
const window = await serveGoogleConnection({ directory: '/private/google/merchant', port: 0 });
console.log(window.url); // Local review URL, not an access token.
await window.done;
const status = await googleConnectionStatus('/private/google/merchant');
```

`getGoogleAccessToken(directory,{signal})` is the existing source driver's
private credential provider. The optional `rejectedAccessToken` + `force`
arguments coordinate a 401 replay against concurrent refresh. The lower-level
authorization object exposes `authorizationUrl`, `complete(URLSearchParams)`,
`view()`, `approve()` and `discard()`; token values remain inside its
closure until explicit account approval persists them.

A trusted native caller can inject `fetchImpl` for a transport exercise.
Endpoint addresses are fixed in production code and cannot be replaced through
a source or client configuration. Exercise responses must be described as such;
actual Google authorization requires the operator's registered client and
browser consent.

## Native integration exercised

The implementation was exercised through its real local HTTP listener, PKCE
code exchange, account review and private kernel-locked store against a local
OAuth protocol peer, using both exact original connected Google CellData
observations for the existing publisher. Three concurrent readers performed one
renewal. Discard retired both a delayed account response and an approval waiting
for the refresh lock. One immutable source plan reopened and published both
four-row observations, preserved the original cursor, and excluded the private
column. The original seller returned its 402 challenge.

The same exercise preserved 403/429 outcomes, renewed one rejected 401 once,
and killed a native refresh process after the peer accepted a rotated grant but
before its response was retained. The next operation required reconnect while
the published data remained available. Explicit reconnect, fresh CLI status and
local disconnect/revocation completed. This covers the native client and
publisher contract; it is not a claim of a live Google authorization session.
