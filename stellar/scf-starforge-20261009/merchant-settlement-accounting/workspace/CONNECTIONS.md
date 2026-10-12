# Managed accounting connections

The Accounting application combines the original settlement workspace, original
OAuth connection registry, and native QuickBooks and Xero company selection.
Registration lives in Applications. Consent and native company review live at
the accounting application's **Connections** page. Journal plans, provider
responses, accountant returns, customer statements and recovery keep their
original accounting owners.

## Register the accounting provider

Choose a compatible installed runtime in Applications and select the merchant
accounting application. Use the existing connection setup panel to import the
native QuickBooks or Xero definition. Its catalog reports whether the selected
runtime supplies that provider and shows the exact shipped source identity.

Enter the registration's alias, public client ID, private client-secret
environment reference and registered callback origin. QuickBooks additionally
requires the explicit sandbox or production environment. The original provider
factory supplies the authorization endpoints, accounting scopes, client
authentication and PKCE dialect from that runtime's native source.

Review the complete desired registry, including retained entries. Register each
callback URI shown by the original review at the provider, then commit the exact
review with its reviewer, reference and callback confirmation. The original
setup journal supports status, exact retry, recovery and immutable editions.
Apply its prepared registry, private environment file, fixed callback port and
loopback option to the accounting application form.

For a local QuickBooks sandbox, the original profile supports the registered
`http://localhost:PORT` callback origin. For a production registration, route
the exact registered HTTPS callback to the original local listener. The active
OAuth adapter checks the declared origin, source-derived callback path and
state; the rest of the accounting operator interface remains on its printed
local address. Use the provider's registered port consistently when creating
the Applications start.

The original detailed provider guides are
[QuickBooks](../../sf30-seller-sdk/oauth-connections/QUICKBOOKS.md) and
[Xero](../../sf30-seller-sdk/oauth-connections/XERO.md). The original registry
publisher is documented in
[Applications connection setup](../../distribution/runtime-workspace/OPENAPI_CONNECTION_SETUP.md).

## Start and authorize

Choose the accounting workspace directory and its original source inputs.
Existing accounting workspaces reopen their retained data. A new workspace
uses the same outbox, proof and terms inputs as the original accounting
launcher. Applications reviews and creates the necessary private output
directories before starting the command.

The optional selection directory defaults to a sibling named
`<accounting-directory-name>-connections`. This keeps company sources and
grant references independent of the accounting recovery directory. The private
OAuth stores stay at the original registration's declared locations.

Review the start. It shows the original workspace, source input identities,
registry and profile digests, registered callbacks, saved selection digests and
the requested port. Starting uses this exact reviewed identity and the original
`merchant-accounting-workspace` command. The managed startup record identifies
the original process, local URL and Connections URL.

Open **Connections**, choose a registered provider, and begin authorization.
Complete the provider's normal consent in the opened tab. Return to the same
workspace, refresh authorization, inspect the actual returned grant and approve
it with its reviewer and reference. The original OAuth controller retains
codes, state, verifier, access tokens, rotations and revocation records privately.
The browser retains public operation IDs for exact continuation.

## Review the actual accounting target

Choose the reviewed grant in **Review a native company or tenant**.

For QuickBooks, the company ID comes from the state-validated Intuit callback
and remains bound to that grant's environment. Capture reads the native company,
preferences and complete paginated chart of accounts through the original
QuickBooks client. An optional API minor version becomes part of the retained
selection and later native journal request.

For Xero, read the native connected-tenant list, search it if necessary, and
explicitly choose the organization connection and tenant ID. Full capture
reads that connection again, its organization, and original chart of accounts.
The selected authorization event remains bound to the company source.

Inspect the company name, base currency, account counts, active-account
restrictions, reviewer and exact source digest. Account pages and filtering
operate on the retained original source. Download the complete selection to
inspect the original responses and provider metadata. The page keeps the
original request and selection as separate downloads.

Confirm the reviewed target and save it. The original selection writer checks
the current alias, source, profile, grant and expected previous selection under
its existing lock. Replaying the same saved selection returns its original
completion. A competing replacement requires a new review against the current
saved digest.

## Activate the saved selection

**Active now** shows the company and tenant frozen when this accounting process
opened. **Saved for the next start** shows a newly reviewed replacement. Saving
a new choice leaves the current native clients with their original target.

Return to Applications, stop the accounting application, review its updated
saved selections and start it again. Open Connections and confirm the active
target. QuickBooks and Xero journal pages use the corresponding original
managed client and retain the established draft, review, request, response and
accountant-return flow.

Enter each accounting valuation and debit/credit mapping explicitly in the
original journal interface. The native company selection supplies the
company's home currency and account source; it does not infer fiat value from
a settlement asset or atomic amount.

Historical accounting remains readable when its grant is disconnected. The
managed launcher opens local retained state before acquiring a provider for a
new native request. The original accounting controllers keep each plan and
operation bound to its saved company or tenant. Reconnecting a changed grant
requires a current native selection review before future provider work.

## Continue an interrupted operation

| Retained state | Continue the original work |
| --- | --- |
| Provider consent or grant command | Use the original authorization panel's status and exact retained request. |
| Company request without completed source | Open its PENDING review and continue the same source capture. |
| Source captured, response lost in the browser | Inspect the retained review; its native selection and digest are already saved. |
| Selection save response lost | Retry the same review and preview digest. The original selection writer reconciles its saved identity. |
| Another operator replaced the selected target | Read the current saved selection and make a new review against that digest. |
| Saved target differs from the active target | Stop, review and reopen the same Applications entry. |
| Original native journal request needs reconciliation | Use its existing QuickBooks or Xero resume/read operation in the journal screen. |

The review directory is initialized before the first native company read. If a
process stops before retaining its first request, that uninitialized directory
does not suppress other history. Once a request is retained, its UUID identifies
the exact captured input. Malformed or changed retained requests remain visible
as source errors.

Shutdown stops new connection admission, aborts native source captures, drains
the original accounting clients and admitted selection work, then closes the
borrowed OAuth adapter and its original registry. An injected TLS Agent remains
with its caller. Embedded hosts should keep the same ownership order.

## Keep recovery with its original workspace

The Connections page binds its browser draft, native source request and OAuth
controls to the original private selection directory, registered native profiles
and private grant-store identities. Restarting that same application and renewing
a grant retain this scope. A different private directory or registered profile
has a different scope, even if it uses the same loopback port.

The original HTTP owner returns `scope` from
`GET /api/accounting-connections`. API clients send that exact value as
`X-Accounting-Connection-Scope` on every connection or OAuth POST. The page also
sends it on subsequent reads. Original selection download links carry the same
public digest in their `scope` query parameter. A mismatch returns
`ACCOUNTING_CONNECTION_SCOPE_CHANGED` before dispatching a command or returning
the scoped download. Native provider callbacks keep their original state checks.

A page that observes a different owner preserves its request and stops dispatch.
Open the original Applications entry to continue that work. Reloading opens the
current workspace with its own saved browser state. Earlier browser requests
that predate this binding remain preserved and are listed by their original IDs;
use their original application's retained review history to continue them. They
are never automatically assigned to another workspace.

The installed connection owner exposes the same readonly `scope` and
`assertScope(value)`. A host using `handleAccountingConnections` passes the
HTTP header as `request.scope`; POST dispatch requires it. This binds the HTTP
request to the existing owner without changing native review, selection or
OAuth command payloads. Direct native owner methods keep their original inputs.

## Embed the existing managed launcher

The installed source exports `./merchant/accounting-managed` and
`./merchant/accounting-connections`. A native host can inspect and open the
same original launcher:

```js
import {
  inspectAccountingLaunch,
  startManagedAccountingWorkspace,
} from '@tokenjunkielabs/starforge-merchant/merchant/accounting-managed';
import { startAccountingWorkspace } from
  '@tokenjunkielabs/starforge-merchant/merchant/accounting-workspace';

const settings = {
  directory: '/private/merchant-accounting',
  connectionsFile: '/private/registered-connections.json',
  selectionDirectory: '/private/merchant-accounting-connections',
  port: 8446,
};
const inspection = await inspectAccountingLaunch(settings);
const application = await startManagedAccountingWorkspace(settings, {
  expectedSha256: inspection.bindingSha256,
  startWorkspace: startAccountingWorkspace,
});
try {
  // Serve the original accounting URL and its Connections page.
  console.log(application.url);
} finally {
  await application.close();
}
```

The example assumes the declared private directories and original registry
already exist. An embedding host performs the user's launch review before
passing the retained digest. Applications supplies that review and directory
creation through its existing command owner.

Other maintained native transports can reuse
`openQuickBooksCompanyAuthorization({registry, selection, ...runtime})`.
It returns the same source/grant/company-bound authorization owner with
`headers({realmId, environment, signal})`, bearer-specific `invalidate`,
a public status projection and `close()`. The transport keeps its own
company-scoped endpoint/body policy and original response custody. Drain its
requests before closing that owner, then close an owned registry. This is the
same authority used by the original QuickBooks journal client.

## Source layout

The connection workspace owns company review requests, source capture and
selection pages. The managed launcher owns the frozen startup binding.
Applications owns the process and reviewed command. The original OAuth store
owns grants. Original QuickBooks and Xero helpers own native company identity,
refresh and saved selection. Original accounting controllers own journal
operations, responses, returns and recovery.

The server and distribution builder share the original accounting
`browser-assets.json` contract, including the original OAuth browser module.
The source-owned `accounting-connections` contribution adds the two typed
exports and that asset contract to the installed archive.
