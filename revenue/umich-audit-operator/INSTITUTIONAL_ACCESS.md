# Institutional access and delegated administration

The audit operator now carries institutional sign-in, named account assignments, delegated unit administration, session closure, and access reviews in the original audit workspace. The existing audit records, report projections, audience roles, receiving history, encrypted backup, and private owner recovery remain the operating foundation.

Use **Institutional access** in the application to configure and operate this workflow. The owner sees provider, mapping, delegation, and review administration. An authorized delegate sees the accounts within the roles and units that the owner delegated. Every authenticated person can inspect and close their own recorded sessions.

## Source and implementation scope

The original event notice's questions **3.3.38 and 3.3.39** ask about centralized authentication integration and its description. The implementation uses OpenID Connect authorization code flow with PKCE. The University's current integration guidance identifies Okta as its institutional single-sign-on platform and supports OIDC and SAML registrations. The selected protocol, explicit local account mappings, and scoped administration described here are the implementation's design.

The source edition is retained in [reference/institutional-identity-contract.json](reference/institutional-identity-contract.json). It includes the original application pin, question references, official URLs, protocol references, and the distinction between institutional registration requirements and application choices. Its SHA-256 is also attached to the original workspace's reference-source records.

Relevant original guidance:

- [U-M Single Sign-On](https://its.umich.edu/accounts-access/identity-access-management/single-sign-on): current platform, registration route, attribute release, and operational timing.
- [Integration Requirements and Responsibilities](https://its.umich.edu/accounts-access/identity-access-management/single-sign-on/integration-requirements-responsibilities): accountable integration owners, application authorization responsibilities, and recurring review.
- [SSO Configuration](https://its.umich.edu/accounts-access/shibboleth/sso-configuration): institution and Michigan Medicine registration paths.
- [OpenID Connect Core](https://openid.net/specs/openid-connect-core-1_0.html), [Discovery](https://openid.net/specs/openid-connect-discovery-1_0.html), [PKCE](https://www.rfc-editor.org/rfc/rfc7636), and [OAuth Security Best Current Practice](https://www.rfc-editor.org/rfc/rfc9700): the protocol behavior used by the implementation.

Use the issuer, client registration, scopes, and actually released claims assigned to this application. An administrator records two distinct accountable integration owners and the actual registration or practice reference. A provider label or an email address does not establish a person's application privileges.

## Deployment and receiving inputs

Keep the application source separate from its private operating workspace. Use Python 3.11 or later with the declared dependencies in requirements.txt. The existing shared continuation environment has PyJWT 2.15.1 and cryptography 50.0.1; an ordinary receiver installs the declared versions into its own isolated Python environment.

The application needs one local SQLite workspace and a Python process. Node, Playwright, and Chromium are used by the optional receiving journey, not by the hosted application.

| Input | Where the operator records or provisions it |
| --- | --- |
| Private workspace | The original --workspace directory; preserve its complete database and retained objects. |
| Application HTTPS origin | --public-origin, including a non-default port when one is used. |
| Server certificate and key | --tls-cert and --tls-key for direct TLS; keep the key in an owned private file. |
| Issuer and client ID | Provider form, copied exactly from the application's registration. |
| Client secret | Private process environment, referenced in the form by its environment variable name. |
| Optional private CA bundle | A process environment variable whose value is the owned PEM bundle path; the form stores that variable's name. |
| Allowed endpoint origins | Explicit additional HTTPS origins when discovery uses endpoints outside its issuer origin. |
| Registered callback | The exact callback shown for this provider and workspace. Register the complete value, including its workspace/provider query. |
| Released claims and scopes | Explicit lists in the provider form, matching the actual registration. |
| Authentication context | Optional required ACR values agreed with the identity provider. |
| Ownership and enrollment | Two distinct named owners with individual email/affiliation, technical contact, and registration reference. |
| Account authority | Manual issuer/subject assignment or exactly one applicable reviewed claim mapping. |
| Receiving recovery | The original encrypted backup, its separately held recovery passphrase, a fresh destination, and the receiving owner. |

Secret values and TLS private keys are provisioned through the receiving team's existing private configuration route. They do not belong in a provider form, source commit, access review export, or operational screenshot. The provider form retains the names needed to locate the process configuration; it does not return those secret values to the browser.

### Local owner access

The original local access path remains available:

~~~sh
python3 run.py serve \
  --workspace /absolute/private/audit-workspace \
  --port 0
~~~

This binds to 127.0.0.1. The ready output identifies the URL and private operator.key location. Use that key to open the owner session. A plain HTTP loopback instance can operate the original audit workflow; institutional sign-in becomes available at its configured HTTPS address.

### Direct HTTPS

Choose a stable hostname and port with the correct certificate. Configure the provider using the same origin:

~~~sh
python3 run.py serve \
  --workspace /absolute/private/audit-workspace \
  --listen 127.0.0.1 \
  --port 8443 \
  --public-origin https://audit.example.org:8443 \
  --tls-cert /absolute/private/tls/fullchain.pem \
  --tls-key /absolute/private/tls/key.pem \
  --ready-file /absolute/private/audit-ready.json
~~~

A deliberate network listener can use --listen 0.0.0.0 with that registered HTTPS origin and direct TLS certificate/key. The application requires both direct TLS and an explicit public origin before allowing a non-loopback listener. Use the receiving team's established network exposure and certificate lifecycle.

### Existing HTTPS reverse proxy

A proxy may terminate HTTPS and forward to a fixed loopback listener:

~~~sh
python3 run.py serve \
  --workspace /absolute/private/audit-workspace \
  --listen 127.0.0.1 \
  --port 8080 \
  --public-origin https://audit.example.org
~~~

The proxy must preserve the exact registered Host and the original path/query. Forwarded and X-Forwarded-* headers do not select an application origin. The application's origin and callback come from its explicit deployment configuration. Keep the upstream listener on loopback. Apply the receiving team's per-client rate controls at the proxy if needed: the application sees the actual socket peer, which is the proxy in this arrangement.

The host admits its configured Host and rejects mismatched origins for ordinary requests. The OIDC callback is the deliberate cross-site GET entry. Mutations use the existing same-origin JSON boundary with X-Audit-Request. Workspace selection remains explicit; one provider's callback does not select another workspace or registration.

## Commission a provider

1. Open the owner session and choose **Institutional access → Providers → Add provider**.
2. Record a stable provider ID, descriptive label, literal issuer, registered client ID, and private environment variable names. Choose the actual scopes, released claim names, optional ACR requirement, allowed endpoint origins, and session settings.
3. Enter the two distinct accountable owners, technical contact, registration reference, and operating notes. Save with a meaningful change note.
4. Copy the exact displayed callback into the identity-provider registration. It contains this saved workspace identity and provider ID. If the receiving URL changes, save the provider again against that host and update its registration.
5. Choose **Inspect metadata**. The application retrieves discovery metadata through its configured TLS trust and retains the accepted content, hash, time, and provider edition.
6. Review the retained metadata and client registration. Choose **Activate** with a recorded reason.
7. Prepare at least one manual account or one explicitly reviewed claim mapping before handing sign-in to the intended users.

An activation requires a matching current callback, the inspected metadata hash, two distinct owner identities, and an enrollment or private-practice reference. Activation makes the configured provider available on the sign-in screen.

Provider configuration changes create a new immutable edition. Protocol-setting changes close its active configuration until the new metadata and registration are reviewed. Changes to a provider edition, activation, or mappings close affected institutional sessions so the next request cannot retain old authority. The original owner recovery path remains available.

### Session settings

The provider form records an absolute session duration between 5 and 480 minutes, idle expiry between 1 and 60 minutes, and maximum authentication age between 0 and 3,600 seconds. Idle expiry cannot exceed the absolute duration. Account, mapping, and grant expiry can shorten a session further.

A maximum age of zero requests and checks authentication bound to this sign-in start. A required ACR list is an explicit institutional registration choice; the returned verified context must satisfy it. The application does not infer multi-factor authentication from an arbitrary provider label.

## Choose account authority

An account's stable identity is its **literal issuer plus subject**. Its display label and email are descriptive information. The same subject under a different issuer is a different identity. The application does not join accounts by an email address or by display-name similarity.

### Manual assignment

The owner can create the expected issuer/subject before the first sign-in. Choose **Accounts → Add account**, select the saved provider, and record the exact original subject. Set the mode to Manual, the lifecycle state, role, required scope, optional expiry, and a change note.

A successful institutional sign-in supplies the verified identity; the manual assignment supplies the local authorization. Unknown or pending accounts remain on the access-review desk until the owner records the appropriate assignment. Disabled or expired accounts cannot enter.

An owner can switch a known account between Manual and Rules. A delegate can manage only Manual accounts within the delegation. The owner first reviews a Rules account before transferring it to manual delegated administration.

### Reviewed claim mappings

A mapping selects one provider and one local access assignment. Its conditions are an explicit AND list:

- **equals** compares an exact scalar string;
- **contains** looks for an exact value in a verified string-list claim.

Every additional claim used in a condition must appear in the provider's released-claim allowlist. The verified subject may also be used. Scope names request protocol claims; adding a claim name to the form does not cause an institutional provider to release it.

Exactly **one** enabled, unexpired mapping must match a Rules account's verified claims. Zero matches or overlapping matches leave access pending with a retained reason. Mapping order does not resolve overlap. Review the conditions and correct the intended mappings, then have the person sign in again.

Mapping changes create new editions and invalidate affected institutional access. The application records the verified identity attributes actually used by its account workflow, along with authentication time and the selected access basis.

## Preserve the original audit roles

The same role and scope fields are used by access links and institutional accounts. Identity administration does not create a second report-permission model.

| Role | Existing audit behavior | Delegatable account administration |
| --- | --- | --- |
| Auditor | Full audit records, original sources, editing, receiving, and encrypted backup. The owner performs new-folder restoration. | Owner assigns this role. |
| Unit leadership | Detailed observations and actions for the explicitly selected units. | Explicit role plus delegated units. |
| Executive | Reviewed senior summary projection. | Owner assigns this role. |
| IT leadership | IT-engagement projection intersected with the selected units. | Explicit role plus delegated units. |
| Medicine IT leadership | IT projection additionally requiring the engagement's Medicine flag and selected units. | Explicit role plus delegated units. |
| Board of Regents | Original periodic summary projection. | Owner assigns this role. |
| FAIC | Original activity/follow-up summary projection. | Owner assigns this role. |
| Advisory | Selected advisory memos, recipient units, and their minimal engagement references. | Explicit role, recipient units, and selected advisory IDs within delegated scope. |

The private owner is the existing administrative authority. An institutional Auditor account can perform the original auditor's business operations and full encrypted backup; it does not become the owner and cannot configure providers, grant privileged roles, or inspect other people's identity records through a generic record/history endpoint.

The original full auditor backup privilege includes the complete private workspace. Restrict that role to the people who are meant to receive its original data and recovery capability. A scoped report release uses the existing projected handoff and excludes identity administration records.

## Delegate unit administration

The owner chooses **Delegation → Add delegation** and selects an existing named account or original access-link holder. Record the permitted role or roles, explicit unit IDs, expiry, activity state, and review note.

Delegation expires within 366 days. Roles and units remain associated within each delegation. Separate delegation rows do not combine one row's role with another row's unrelated units.

A delegate can:

- see the manual accounts whose current assignment is wholly within the delegated role/unit authority;
- create an exact-subject manual account for an authorized role and scope;
- correct, expire, suspend, or restore an authorized manual account;
- inspect and close sessions belonging to those visible accounts.

A delegate cannot grant owner authority, assign privileged roles, expand beyond delegated units, change providers or mappings, or view another person's retained verified claims. Changing or expiring a delegation takes effect through the original current-actor check on subsequent requests.

Account corrections use the displayed revision. A concurrent change requires a fresh current edition before adoption. The interface retains entered values after a save error so the administrator can compare and resolve the actual change.

## Operate sign-in and sessions

The sign-in screen lists the active providers for the selected workspace. Choosing one starts a retained, short-lived browser transaction bound to this provider, callback, browser cookie, nonce, PKCE verifier, provider edition, and workspace recovery epoch.

The callback consumes that transaction before code exchange. The protocol verifies the issuer, authorization response, TLS endpoints, signing key, signature, audience, nonce, time conditions, and configured claims. The application retains its local identity/session result. Provider tokens are not exposed as browser session credentials.

The browser returns to a fixed application route with one of four operating results: opened, access review, provider declined, or sign-in failed. Detailed provider tokens, authorization codes, and untrusted provider error text are not rendered as application messages.

Open **Sessions** to inspect the sessions you are entitled to manage. The table shows the named account, entry method, start, last activity, expiry, authentication time where present, and retained device description. Close one session by its displayed stable session ID and reason. The current session is marked.

Provider or mapping changes, account suspension, account assignment changes, explicit session closure, expiry, and idle expiry are applied against current original grant/account state. Closing one device does not silently close a different person. Disabling an account closes its active sessions and requires a new sign-in after it is deliberately restored.

The owner can still use the private operator.key when institutional configuration or an institution account needs correction. Preserve that existing recovery route through the team's private credential handling.

## Review and retain access configuration

Choose **Access reviews** and select a provider. Load the current review basis. It includes:

- the exact provider edition and hash;
- the original mapping editions;
- each account's current authorization and lifecycle basis;
- the applicable delegation editions.

Record the named reviewer, review reference, date, outcome, next review date, findings, and assigned exceptions. Saving a review binds it to that exact basis. A configuration change during review requires a fresh basis before saving. A later access change marks the saved review as applying to its earlier configuration; it does not silently approve the new one.

The University's integration guidance calls for recurring review and review after material changes. The operator records the actual next review and disposition. A normal sign-in that only updates authentication metadata does not itself change the authorization-review basis.

Each provider, rule, account, delegation, and attestation retains immutable editions in the same original record/history store. The UI compares selected editions and exports the visible history. The owner can download the complete **Institutional_Access_Review.json** from the Source view.

That review export is an inspectable configuration/history record. The encrypted original workspace backup is the receiving and recovery artifact.

## Restore and reopen the complete workspace

Use the original **Recovery** interface to produce a passphrase-protected backup of the current workspace. It includes the native SQLite snapshot and all retained original objects. Existing backup download bodies are kept separately rather than recursively embedded.

Restore into a new private directory:

~~~sh
python3 run.py restore /absolute/retained/Audit-backup.cab \
  --destination /absolute/new/private/audit-restored
~~~

For an existing private automation route, --passphrase-file can name an owned private file. Otherwise the command prompts for the passphrase. The destination must be new.

The original restoration retains audit IDs, source bytes, revisions, reports, receiving decisions, and all institutional configuration/account/review editions. It renews access authority:

1. The restored workspace has a new private owner key. Previous access-link grants and sessions are removed.
2. In-flight institutional sign-ins, session details, and transient rate records are removed.
3. A new receiving epoch makes retained provider activations and delegations inactive until the receiving owner reviews them.
4. The receiving owner opens the restored workspace using its new key.
5. The owner verifies the actual deployed HTTPS origin and updates the provider/callback registration when necessary.
6. The owner checks the private client secret and CA configuration, inspects current metadata, and deliberately reactivates the appropriate provider.
7. The owner reviews the retained account/mapping assignments and reissues the necessary delegations for the receiving epoch.
8. Intended people sign in again. Their original issuer/subject account identity and retained history remain available.

Run one intended live sender for a transferred operating workspace. The receiving procedure preserves records while renewing session authority; it does not coordinate changes between two independently running copies.

## Recover ordinary operating interruptions

A provider discovery or sign-in failure can be corrected from the private owner session. Check the exact registered issuer/client, endpoint origins, configured trust, process environment reference, retained metadata, callback, and released claim names. Preserve the provider's previous edition when saving a correction.

For a pending account, inspect its recorded access message and current mapping conditions. Review zero-match and overlap cases directly. Correct the account or mappings and request a new sign-in.

For an expired or closed session, open a new authorized session. A session cannot extend a disabled account, old provider edition, expired delegation, or old receiving epoch.

For a concurrent save, compare the current edition with the entered values. Save against the actual current revision after resolving the difference. The original request ledger retains operation IDs so an uncertain network reply can be checked or replayed with the same action and input.

For a restored workspace, start with its newly generated owner key and the receiving sequence above. An old browser cookie or access key does not reactivate a transferred institutional registration.

## API integration

The UI uses the original host and one Store. All mutation requests retain the original shape:

~~~json
{
  "action": "identity.account.save",
  "inputs": {
    "provider_id": "saved-provider-id",
    "subject": "literal-issued-subject",
    "label": "Named account",
    "email": "descriptive-address@example.org",
    "mode": "manual",
    "status": "active",
    "access": {
      "role": "unit_leadership",
      "unit_ids": ["actual-unit-id"],
      "recipient_unit_ids": [],
      "selected_record_ids": []
    },
    "expires_at": null,
    "note": "Recorded access assignment",
    "expected_revision": 0
  },
  "operation_id": "caller-retained-unique-request-id"
}
~~~

POST this to /api/action?workspace=KEY with the authenticated session, Content-Type application/json, and X-Audit-Request: 1. Use the same operation ID and exact action/inputs when reconciling an uncertain reply. The institutional account ID is derived from issuer and subject; clients should use the returned original ID.

| Route or action | Purpose |
| --- | --- |
| GET /api/identity/providers | Available providers for the selected HTTPS workspace. |
| POST /api/identity/login | Start one browser-bound flow for provider_id. |
| GET /api/identity/callback | Registered protocol callback. |
| GET /api/identity/state | Current authorized administration desk and capabilities. |
| GET /api/identity/history?kind=…&id=… | Authorized immutable editions. |
| GET /api/identity/sessions?account=… | Own or authorized account sessions. |
| GET /api/identity/attestation-preview?provider=… | Owner's exact current review basis. |
| GET /api/identity/contract | Retained source and implementation contract. |
| GET /api/identity/export | Owner's complete inspectable identity review export. |
| identity.provider.save / inspect / activate | Original provider lifecycle and retained metadata. |
| identity.rule.save | Explicit provider claim mapping edition. |
| identity.account.save | Manual or rules account lifecycle edition. |
| identity.delegation.save | Role-and-unit-specific administration authority. |
| identity.attestation.save | Immutable review bound to current configuration. |
| identity.session.revoke | Authorized session closure. |

Every API URL also includes the selected workspace parameter. The generic record, history, and operation receipt routes apply the same identity visibility rules. Existing business snapshots, reports, and native audit exports keep their original domain selection.

## Complete delivery and receiving demonstration

The source release includes the full original audit application and this institutional workflow. Its enumerated source manifest identifies complete file bytes, SHA-256 values, and Git-blob identities. Private workspaces, operator keys, client secrets, browser cookies, TLS keys, recovery passphrases, and runtime dependencies stay outside that public source archive.

The institutional receiving continuation starts from the original completed audit practice workspace. It adds an operated private OIDC registration, uses an actual local HTTPS discovery/authorization/token/JWKS service, performs browser code flow and scoped administration, and restores the same complete workspace. Its operation record identifies the actual source pins, original case, identities used for practice, resulting revisions, exports, screenshots, and new receiving directory.

The supplied complete continuation has one entry point. Receive the original completed case's encrypted backup and its private passphrase file, and use the existing maintained HTTPS provider source with SHA-256 1cde024aebaf92050d35a8d20f015755ecb587bfbf79728689fec1da5f998b37. SOURCE_MANIFEST.json comes from the complete source release.

~~~sh
python3 -B examples/INSTITUTIONAL_RECEIVING.py \
  --operation /absolute/new/private/institutional-receiving \
  --original-backup /absolute/retained/original-audit-backup.cab \
  --original-sha256 ORIGINAL_BACKUP_SHA256 \
  --passphrase-file /absolute/private/original-case-recovery-key \
  --source-pins /absolute/received/SOURCE_MANIFEST.json \
  --provider-file /absolute/existing/maintained/identity_provider.py \
  --dependencies /absolute/existing/python-dependencies \
  --node /absolute/existing/node \
  --playwright /absolute/existing/playwright \
  --chromium /absolute/existing/chromium
~~~

Reuse the same private operation directory to continue an interrupted operation. The caller's maintained resource controller owns its admission and termination. The launcher verifies the selected source and provider, restores the original case once, and retains original request/phase state. Its browser child uses the existing host and provider in the same network namespace. A complete operation returns UMICH_Institutional_Receiving_Result.json and the saved browser result; both identify the source edition of each completed phase.

The final operated package is assembled from those exact outputs:

~~~sh
python3 -B tools/package_institutional_delivery.py \
  --operation /absolute/private/institutional-receiving \
  --source-reference EXACT_SOURCE_COMMIT \
  --provider-file /absolute/existing/maintained/identity_provider.py \
  --output /absolute/new/Audit_Institutional_Complete_Workspace.zip
~~~

The package joins the enumerated source, the complete practice backup and its receiving key, the original and receiving access-review exports, actual screenshots, and both completed operation records. The original case's source and audit history remain inside the saved encrypted workspace. The provider's generated live credentials remain in its original private operation directory.

Consult the completed operation's own result before attributing a native outcome to a source edition. Use the supplied existing provider fixture and dependency closure through the receiving environment; a production institutional registration uses its own actually issued client and attributes.

For commercial handover, connect this source and its completed operating artifacts to the original audit delivery in the existing project thread. The institutional access work addresses the original centralized-authentication questions and the practical account-administration burden inside the same audit product.
