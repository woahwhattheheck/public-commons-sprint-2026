# Connect a reviewed QuickBooks company to merchant accounting

This integration uses the original OAuth connection controller to authorize and renew a QuickBooks grant, captures the company's native settings and account chart, and opens the original merchant accounting workspace with that reviewed company. The existing journal, native request, response, and accountant-return records continue through the same QuickBooks controller.

The company choice records the connection alias, profile hash, reviewed grant ID, realm, environment, operation-source hash, complete company snapshot, reviewer, and optional native minor version. Token rotation keeps that choice usable. Replacing the authorization or choosing another company requires another explicit selection.

## Installed entry points

Use Node 22 or later and the existing merchant installation. The OAuth/controller and company-selection additions use Node's standard library; the original accounting workspace uses its existing dependencies. The commands below run from the source directory **stellar/scf-starforge-20261009**.

| Entry point | Purpose |
| --- | --- |
| sf30-seller-sdk/oauth-connections/cli.mjs quickbooks | Initialize the provider profile, list connections, review/select a company, and start connected accounting |
| sf30-seller-sdk/oauth-connections/cli.mjs connect | Original consent, callback, and attributed grant approval |
| sf61-openapi-seller-import/workspace/server.mjs | Existing browser connection manager and original API merchant workspace |
| @tokenjunkielabs/starforge-merchant/seller/oauth-connections/quickbooks | Typed SDK entry point for company selection and the connected accounting owner |
| quickbooks.openapi.json | Shipped operation descriptor whose exact bytes bind this provider profile |

The descriptor is maintained with this adapter and links to Intuit's native operation references. Its security scheme is **quickbooksAccounting**, with scope **com.intuit.quickbooks.accounting**.

## 1. Initialize the registered application

Obtain the client ID and client secret for the selected environment from the existing Intuit application. Provision the secret in the receiving process's private environment. The profile stores the environment-variable name; it never stores that variable's value.

For sandbox development, choose a fixed local listener port and register the exact localhost callback. Intuit's official SDK README uses this localhost pattern. For production, choose a registered public HTTPS callback origin and route its exact callback path to the original local listener.

~~~sh
node sf30-seller-sdk/oauth-connections/cli.mjs quickbooks init \
  --directory /srv/merchant-private/qbo-connection \
  --client-id YOUR_REGISTERED_PUBLIC_CLIENT_ID \
  --client-secret-env QBO_CLIENT_SECRET \
  --environment sandbox \
  --callback-origin http://localhost:8000 \
  --label "Merchant QuickBooks sandbox"
~~~

Initialization returns the original public connection status, including **profile.callbackOrigin**, **profileSha256**, and **callbackPath**. Register **profile.callbackOrigin + callbackPath** under the application's Keys & OAuth configuration. The path is derived from the normalized profile hash; use the complete returned path, including its hash.

For production, initialize a separate profile and private connection directory with **--environment production --callback-origin https://accounts.example.com**. Supply the exact origin belonging to the configured application. Changing the client, environment, callback origin, or shipped operation source changes the profile identity.

The supported Intuit dialect follows its official confidential-client SDK: authorization code, state validation, client_secret_basic, and the accounting scope. Generic OpenAPI profiles retain their original PKCE S256 flow. Provider identity makes this distinction explicit in both the stored profile and the consent review.

### Registered callback routing

The original operator listeners remain bound to 127.0.0.1. A sandbox localhost callback must use the same port as that listener. Start the browser manager or terminal connection flow at the fixed registered port.

A production HTTPS ingress must forward the exact registered **/oauth/callback/HASH** route and its query to that listener. It may also forward **/oauth-return** and the returned page's **/style.css**. Keep the operator API, project workspace, and other paths on the private listener. Preserve the original callback query; its state must match the active authorization and its path must match the profile.

The browser adapter admits a registered callback Host only for the active state/path and the returned page. The existing administrator Host, Origin, and workspace-token checks remain on the original API. Its registration help displays the profile's actual localhost or HTTPS URL.

## 2. Connect and review the company grant

Use the existing terminal flow:

~~~sh
node sf30-seller-sdk/oauth-connections/cli.mjs connect \
  --directory /srv/merchant-private/qbo-connection \
  --port 8000 \
  --actor "Accounting operator" \
  --reference "Connect the merchant company for settlement journals"
~~~

Open the displayed authorization URL in the operator's browser, sign in, select the intended QuickBooks company, and return to the terminal. The original controller validates state before accepting **realmId** from the callback. The token response supplies the token lifecycle; the returned callback supplies the realm.

Review the displayed provider, environment, company realm, granted scopes, and expiration before approving. The browser connection manager presents the same explicit company review. A successful provider redirect alone does not select a company for an accounting workspace.

### Use the existing browser manager

Configure one original host alias for the initialized private connection. Provision **QBO_CONNECTION_DIRECTORY=/srv/merchant-private/qbo-connection** and **QBO_CLIENT_SECRET** in the process environment. The connection directory is private, real, and mode 0700.

Save this original host configuration as **/srv/merchant-config/oauth-connections.json**, with no group or world write access:

~~~json
{
  "schema": "stellar-forge.oauth-host-connections.v1",
  "connections": [
    {
      "alias": "merchant-qbo",
      "directoryEnv": "QBO_CONNECTION_DIRECTORY"
    }
  ]
}
~~~

Start the existing browser workspace at the registered port:

~~~sh
node sf61-openapi-seller-import/workspace/server.mjs \
  --out-parent /srv/merchant-private/api-projects \
  --port 8000 \
  --oauth-connections /srv/merchant-config/oauth-connections.json
~~~

Create the private project parent beforehand as required by the original workspace. Open its printed local URL, choose the configured connection, begin consent, and review the returned company. The original manager also owns reconnect, disconnect, and retained remote revocation.

## 3. Read the actual company and account chart

List the original reviewed connections:

~~~sh
node sf30-seller-sdk/oauth-connections/cli.mjs quickbooks list \
  --connections /srv/merchant-config/oauth-connections.json
~~~

Each choice reports alias, profileSha256, grantId, realmId, environment, grant state, sourceMatches, and ready. Use the exact identity fields of the reviewed company for its native preview:

~~~sh
node sf30-seller-sdk/oauth-connections/cli.mjs quickbooks preview \
  --connections /srv/merchant-config/oauth-connections.json \
  --alias merchant-qbo \
  --profile THE_CURRENT_PROFILE_SHA256 \
  --grant THE_REVIEWED_GRANT_ID \
  --realm THE_CALLBACK_REALM_ID \
  --environment sandbox \
  --actor "Accounting operator" \
  --reference "Settlement journals for the reviewed merchant company" \
  --out /srv/merchant-private/qbo-company-preview.json
~~~

The output file is created exclusively with private permissions. Use an existing private parent directory and a new filename for a new preview.

Preview reads the actual native CompanyInfo, Preferences, and all Account pages through the reviewed grant. The account query includes active and inactive accounts and retains the original page bodies. The original company parser establishes home currency, account identity, and selectable account reasons from those documents. Its supported journal home currencies are USD, CAD, EUR, GBP, AUD, and NZD.

The console summary includes the company name, realm, environment, home currency, account counts, source snapshot hash, reviewer, and **integrity.sha256**. Inspect the complete retained preview when reviewing individual account eligibility or source documents. An optional **--minor-version N** becomes part of this selection and the native client configuration.

## 4. Save the reviewed company choice

After reviewing the returned company, persist exactly that preview:

~~~sh
node sf30-seller-sdk/oauth-connections/cli.mjs quickbooks select \
  --connections /srv/merchant-config/oauth-connections.json \
  --selection-directory /srv/merchant-private/qbo-company \
  --preview /srv/merchant-private/qbo-company-preview.json \
  --preview-sha THE_PREVIEW_INTEGRITY_SHA256
~~~

The private selection uses the original file lock and atomic-save helpers. An identical request can be retried and returns the same choice. Reusing a selection ID with changed input is rejected.

Read its saved identity with:

~~~sh
node sf30-seller-sdk/oauth-connections/cli.mjs quickbooks status \
  --selection-directory /srv/merchant-private/qbo-company
~~~

To replace a saved choice, create and review another native preview and pass the current saved hash as **--previous-sha**. If another operator has already changed the selection, read the current record before preparing a replacement.

One running accounting owner retains one saved choice. Replacing the selection file affects a later launcher open; it does not redirect an existing owner's in-flight journals to another company. Continue existing native operations with the company and environment recorded in their original requests.

## 5. Open connected merchant accounting

~~~sh
node sf30-seller-sdk/oauth-connections/cli.mjs quickbooks serve \
  --connections /srv/merchant-config/oauth-connections.json \
  --selection-directory /srv/merchant-private/qbo-company \
  --workspace /srv/merchant-private/accounting \
  --port 8010
~~~

Pass the existing outbox, proof, terms, RPC, recovery, and other accounting options needed by that workspace. The printed URL opens **/qbo.html** on the original accounting server.

The connection panel displays the saved alias, reviewed grant, company, realm, and environment. **Load company and accounts** refreshes the native company source through that selected authorization. Follow the original [QuickBooks operating journey](../../merchant-settlement-accounting/workspace/QBO_WORKFLOW.md):

1. Choose the original frozen accountant handoff, including its period and adjustment context.
2. Explicitly value each selected source event in the company's home currency and choose its debit and credit accounts.
3. Preview and retain the balanced native journal, then record its review.
4. Review the native posting preview and send the retained journal through the original durable operation.
5. Read the native result and its original accountant return. Reopen or resume the same operation when necessary.

The native controller retains its request UUID, endpoint, minor version, exact request bytes, response receipts, and accountant-return linkage. The selected grant supplies authorization to that controller. The original source, review, request, and return remain inspectable in the existing page and downloads.

## Renewal, reconnect, and recovery

The original provider owns token renewal and rotating-refresh persistence. Independent consumers share the same connection lock, so they use the retained current generation. The QuickBooks selection binds the reviewed grant rather than one transient access-token generation.

For Intuit, token lifetimes are measured from the token response's received time. The implementation reads **x_refresh_token_expires_in** and, when supplied, **x_refresh_token_hard_expires_in**. A previously observed hard deadline survives later responses that omit it. The effective refresh deadline remains bounded by that observed hard limit. Intuit documents a maximum refresh lifetime; plan for reauthorization when it ends.

| Event | Existing operation behavior |
| --- | --- |
| Access token is near expiry | Original provider renews and persists the new token generation before use |
| Native company read returns HTTP 401 | The exact rejected bearer is invalidated; the complete read-only company capture renews and restarts once |
| Native journal operation returns HTTP 401 | Its actual response remains in the original native intent; the next explicit resume obtains the current grant |
| Response was saved before local bookkeeping finished | The original native/accountant controller completes the retained return on resume or recovery |
| Refresh token is revoked or reaches its deadline | Reconnect and approve a new grant in the original connection manager, then review a new company selection |
| Alias, profile, source, grant, realm, or environment changes | Selection admission fails with a specific company/source error; choose the current reviewed identity |
| Selection save outcome is uncertain | Read the saved selection and retry the same preview hash and expected prior identity |

Journal retries continue through the original controller. It retains the same native requestid and payload, queries the exact document number, checks the full journal identity, and reads an observed journal before deciding whether the original request may be resumed. Company setup and accounting writes keep their respective original recovery behavior.

Use the original **disconnect --revoke** command or browser action to disconnect and request remote revocation. Revocation uses Intuit's JSON **{token}** request with confidential client authentication and accepts a successful empty response. Retained cleanup receipts remain with the original controller. A disconnected or replaced grant prevents another native request under the old saved selection.

## Embed the original workspace

The typed package export uses the existing host registry and accounting server:

~~~js
import {
  startQuickBooksAccountingWorkspace,
} from '@tokenjunkielabs/starforge-merchant/seller/oauth-connections/quickbooks';

const connected = await startQuickBooksAccountingWorkspace({
  connectionsFile: '/srv/merchant-config/oauth-connections.json',
  selectionDirectory: '/srv/merchant-private/qbo-company',
  directory: '/srv/merchant-private/accounting',
  port: 8010,
  env: process.env,
});

console.log(connected.accounting.url + '/qbo.html');
const originalAccounting = connected.accounting;
const publicSelection = connected.selection;
const currentConnection = await connected.connectionStatus();
const currentProvider = connected.providerStatus();

// On this host's shutdown:
await connected.close();
~~~

The returned **accounting** object is the actual original runtime, including its workspace and bookkeeping controllers. The wrapper closes accounting first so native operations abort and drain, then closes its token provider, then its original OAuth registry.

For a host that already owns a registry, use **listQuickBooksConnections**, **previewQuickBooksSelection**, and **saveQuickBooksSelection** with that registry. **openQuickBooksOAuthClient({registry,selection,...runtime})** returns **{client,snapshot,close}**. Inject **client** through the original **startAccountingWorkspace({...,qboClient:client})** seam. Close accounting before the client owner; close a shared registry only when its own host lifecycle ends.

The SDK also exports **createQuickBooksProfile**, **quickbooksSource**, **readQuickBooksSelection**, **validateQuickBooksSelection**, and **quickBooksSelectionSummary**. Preview returns the full selection; its **integrity.sha256** is the review value accepted by save. Browser code receives public status and company documents through the original server routes.

## Primary provider references

- [Official Intuit OAuth SDK](https://github.com/intuit/oauth-jsclient/blob/master/src/OAuthClient.js): confidential authorization-code request, token refresh, JSON revocation, and the optional hard-expiry response header.
- [Official token lifecycle implementation](https://github.com/intuit/oauth-jsclient/blob/master/src/access-token/Token.js): callback realm and token-lifetime fields.
- [Official SDK setup and exact localhost redirect registration](https://github.com/intuit/oauth-jsclient/blob/master/README.md).
- [Intuit's production HTTPS redirect requirement](https://help.developer.intuit.com/s/question/0D5TR00001Xm1qG0AR/customer-unable-to-loginintegrate-to-our-app-in-production-but-it-works-fine-with-our-sandbox-theyre-using-quickbooks-online-and-integrating-via-an-auth-link-we-send-them-on-a-remote-desktop-connection-they-can-log-in-fine-on-their-pcs).
- [Refresh-token lifetime policy](https://blogs.intuit.com/2025/11/12/important-changes-to-refresh-token-policy).
- [Native QuickBooks journal reference](https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/journalentry).
- [Native provider limits and throttles](https://static.developer.intuit.com/output_html/qbo/docs/learn/limits-and-throttles.html).
- [Intuit sample explaining persisted request identity and payload reuse](https://github.com/IntuitDeveloper/SampleApp-Batch-Java/blob/main/docs/building-smarter-batch.md).
