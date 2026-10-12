# Set up OpenAPI provider connections

The **API merchant authoring** application can prepare its registered outbound OAuth connections from the original provider definition. Open **Applications**, choose the ready runtime and **API merchant authoring**, then open **Set up provider connections** below the application form.

The setup runs in the original receiving host. It retains the imported source, reviews the provider registration, initializes the original OAuth stores and produces an immutable host registry and private environment edition. The normal Applications controls then review, save, start, stop and reopen the application.

The receiving Applications console supplies the setup workflow. The selected runtime must include a compatible original managed OpenAPI launcher and OAuth profile/store engine. The host validates the prepared settings through that selected runtime's own inspector. The panel explains when a selected runtime lacks the required native capability.

## Prepare the application and registration

Choose the original ready runtime and give the application a display name. Set its **Private merchant projects directory** to the intended private authoring location. This remains separate from the provider grant stores.

If the application already uses an environment file or an OAuth host configuration, select those original files before opening setup. The host reads the current files and carries their entries into the registration review. An existing environment file is preserved value for value in a new private edition, with the reviewed connection directory references added. The complete process environment is not copied into that file.

A confidential client uses a named secret already available to the host. The name may resolve from the application's original private environment file or an inherited host environment variable allowed by the receiving host. The setup form lists names only. Choose the correct name for the registered client; keep the actual secret in the host's private environment configuration.

Select the **Application callback port**. The panel suggests 8787 when the application uses automatic port selection; change it to the fixed local port intended for this registration. The registration review shows every exact callback URI generated from the selected profile and port. Those addresses must match the provider's client registration.

The existing **Use a local development OAuth provider** application setting is for an explicitly local provider. Normal provider endpoints use the original public HTTPS transport. Changing that setting, the runtime, the environment input, the host registry or the listener invalidates the registration review.

## 1. Import the actual OpenAPI source

Choose the provider's original UTF-8 JSON or YAML file, or paste the complete source into the panel. Give it a recognizable source name and select **Import and inspect source**.

The browser preserves the file's UTF-8 bytes, including an existing byte-order mark, and the original importer decides whether the source is supported. A file cannot silently pass through an encoding conversion. The receiving limit is 4 MiB per source.

Import stores the original source by SHA-256 and returns its real inspection. The source selector lists retained definitions with their titles and hash prefixes. Importing a later definition creates another retained source identity; previous definitions stay available.

Setup derives its operation choices from the actual source's supported authorization-code flows. Each choice identifies the HTTP operation, selected server, security alternative, security scheme, authorization endpoint, token endpoint, resource origin and declared scopes. A source without a supported authorization-code operation displays that result in the panel. The existing API merchant authoring workflow remains available for its other supported authentication methods.

## 2. Configure each connection

For each connection, enter the following registration metadata:

| Field | Meaning |
| --- | --- |
| Connection alias | Stable name used in this host registry. It must be distinct within the edition. |
| Display name | Readable provider or account label for the operator. |
| Private directory environment name | Distinct environment reference for the original private connection store. Setup derives the actual directory inside the host's configured private grant root. |
| Imported original source | Exact retained provider definition used for this profile. |
| Operations | The source-declared operations this registered connection supports. |
| Registered client ID | The identifier from the provider's client registration. |
| Token endpoint authentication | Public client with PKCE, client-secret Basic authentication, or client secret in the token request body. |
| Client-secret environment name | Existing host reference for a confidential client's secret. |

Environment names retain their original case. Connection directory references and client-secret references serve different purposes and cannot substitute for each other.

Select operations that use the same security scheme, authorization endpoint and token endpoint. Operations sharing that flow may use more than one source-declared resource origin. Create separate connections for different authorization flows.

The panel displays the selected endpoints and resource origins. Scopes required by the selected operations are included and marked as required. Choose any additional source-declared scopes needed for the registration. The original profile normalizer verifies the final selection.

The optional settings section accepts the registered revocation endpoint, expected issuer, additional authorization parameters and resource parameters. Authorization parameters use a JSON object; resource parameters use a JSON array of URL strings. The original profile rules reject secret values and attempts to replace protocol-controlled parameters.

Select **Add connection to review**. This updates the proposed edition in the browser. Repeat for the other providers or registrations. An edition supports up to 64 connections and up to 64 operation selections per new connection.

## Preserve or replace existing registrations

Every connection from the application's selected original registry appears in the complete edition list. Leaving a connection as **Retain original connection** keeps its original profile and private store. Its current grant state is shown in the expanded details.

**Replace source or client** opens the existing alias for a new source-bound registration. Choose the actual retained definition, client and operations, then update the connection in the review list. The host requires the exact previous profile identity for a replacement. A changed profile gets its own private store; the earlier store and grant history remain available through the earlier edition.

Existing native provider profiles, including the original QuickBooks dialect, retain their original profile when carried forward. The complete registration review shows any replacement's resulting profile. Provider-specific registration and account operations continue through their maintained native setup and account controls.

**Remove from this edition** removes an alias from the proposed registry. The final review lists that removal explicitly. Removing an alias does not delete its private store or disconnect a grant.

The backend also supports an explicitly reviewed empty edition. This is useful when the application should carry no outbound OAuth aliases. All earlier stores and editions remain retained.

## 3. Review and create the whole edition

Select **Review connection edition**. This is a review of the entire resulting registry, including retained, new, replaced and removed aliases.

For each connection, check its original source SHA-256, scheme, authorization and token endpoints, client ID, authentication method, scope set, resource origins and exact callback URI. The review also shows the retained or added environment names and the fixed application listener.

Complete the corresponding registration in the provider's own console. Record the reviewer's name and a provider registration or internal reference, then confirm that the registrations contain the exact callback addresses and scopes shown.

Select **Create reviewed connection edition**. The original host rereads the reviewed source and environment bindings, initializes the selected original stores and writes the immutable registry/environment edition. An input changed after review requires a fresh review; a conflicting profile replacement cannot silently take over an alias.

The result shows the edition ID, exact private registry and environment paths, fixed port and file hashes. Select **Use these connections in this application** to put those reviewed settings into the existing application form. This preserves the other application settings and invalidates an older application review.

A connection edition prepares registrations. Provider authorization and grant approval remain explicit operations in the original API merchant workspace.

## Save, start and operate the application

Continue in the normal Applications form:

1. Select **Review application**. Review the selected runtime, private project location and registered provider connections.
2. Save the application through the existing save control.
3. Select the saved application and **Review start**. The original start review binds the actual registry, original source profiles, private directory identities and listener.
4. Start the reviewed original application, then use **Open application**.
5. In API merchant authoring, select the registered alias, perform the provider authorization and review the returned grant through the original OAuth controls.
6. Bind the approved original grant to the intended source operation and continue the normal merchant route, package and seller workflow.

The application launcher reads the reviewed private environment edition plus the existing inherited host environment. It does not return secret values to the setup browser. The normal managed startup record supplies the private application link.

Use **Stop application** for the original shutdown and drain. Reopening uses the same saved application configuration and original private connection stores. Ordinary grant renewal updates the existing grant history without replacing the source-bound connection edition.

The full managed lifecycle is described in [OpenAPI Applications](OPENAPI_APPLICATIONS.md). The original runtime console and command behavior are described in [Applications](APPLICATIONS.md).

## Recover an interrupted setup request

Source import, edition creation and edition activation retain their original request IDs. The browser stores only opaque request metadata in session storage. Source text, client registration fields, reviewer details and secret values are not stored there.

If a response is lost, the panel offers **Read retained request**. A completed original operation returns its exact retained result. The panel can display that imported source or prepared edition without issuing another creation request.

If the original operation is pending, select **Continue original request**. The host resumes the exact retained source or registration plan under the original private lock. It uses the original stored context even if the browser's visible environment or port fields reverted after a reload. It does not substitute a newly typed payload into the pending operation.

If the host confirms that the request never reached a durable operation record, the panel offers **Return to setup**. Supply the original file or registration input again. An absence of a durable record is distinct from a pending operation.

Return to the same original workspace and ready runtime when recovering a setup request. The receiving host verifies that runtime identity before opening its retained setup operations.

If another operator changed the saved configuration while a draft was open, **Reload saved configuration** returns to the actual current registry. The existing list and original source/profile identities are then used for a fresh review. Refreshing status does not silently discard a draft.

## Reopen an earlier edition and deliver the handover

Open **Reopen a previous connection edition**, choose the desired saved edition and select **Review saved edition**. Inspect its original registry, environment hashes and connection profiles.

**Select this saved edition** selects that setup edition and returns its original prepared settings. Select **Use these connections in this application**, then review and save the application and use the ordinary start controls. Selection does not modify a running application and does not roll a provider grant back in time. A disconnected or renewed grant remains in its current original state.

Each prepared or saved edition offers four complete text downloads:

- Registration review, including the source-bound profiles and callback registrations.
- Host registry, containing the selected aliases and directory references.
- Source manifest, identifying the retained definitions.
- Operator plan, recording the reviewed edition and receiving instructions.

The private environment edition and grant/token files are not download choices in this panel. A receiving host uses its own private configuration and the original store custody when moving or recovering an installation.

## Host integration

The additive browser module is `public/openapi-connection-setup.mjs`. It mounts outside the Applications configuration form and uses the existing authenticated runtime-workspace API.

The shared host resolves the selected runtime entry and supplies the original workspace root to `openApiConnectionSetupAction`. Default setup and grant roots are private children of that workspace. Optional root and secret-name policies come from host configuration, not browser-supplied write destinations.

The facade checks the selected installed runtime and original managed OAuth capability before calling the original `sf30-seller-sdk/oauth-connections/setup/` engine. Reviews bind the runtime identity, source selection, original environment file and complete desired registry. The ordinary merchant HTTP capability continues to operate its configured aliases.

All setup endpoints use the existing authenticated POST transport:

| Action | Purpose |
| --- | --- |
| `catalog` | Read retained sources, editions, current aliases, available secret names and limits. |
| `import-source` | Retain and inspect one original source using a stable request ID. |
| `inspect-source` | Inspect an already retained original source. |
| `review` | Prepare the entire desired registry and callback registration review. |
| `commit` | Create the exact reviewed edition and original stores. |
| `status` | Inspect an edition or reconcile the original request result. |
| `recover` | Continue the exact durable pending operation. |
| `activate` | Select an existing edition without changing a live application or grant history. |
| `download` | Retrieve a complete allowed edition handover file. |

The route prefix is `/api/applications/openapi-setup/`. Requests use `{runtimeId, context, input}`. The setup engine and facade define the full typed source, review, revision, idempotency and recovery contracts; browser changes cannot override the host's selected runtime or private roots.
