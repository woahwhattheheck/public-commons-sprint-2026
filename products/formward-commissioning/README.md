# Formward commissioning

A complete local workbench for preparing a website form, keeping unfinished field edits, generating deployment source, and receiving the actual provider and mailbox results. It uses the existing website and the operator’s own Formward account.

Open [index.html](index.html) in a browser for the blank one-form starter. Its endpoint, website origin, notification recipient, source date and source URL are empty. Enter the actual values in **Owned form settings**, edit the fields, and use **Save settings and refresh preview**. The local preview is inert. The explicit live sample action is available only from the configured website origin after its original request has been saved.

For several forms or a named customer workspace, generate a complete standalone edition from a configuration file. The HTML contains all its code, configuration, working state and receiving history. Keep filled configurations and completed working files with their owner.

## Install and generate

Use Node.js 20 or newer for the CLI. The browser application has no package or network dependencies. Keep this product directory together; no package installation or build service is required.

Create a private working directory before running these commands. Replace the paths and workspace identifier with your actual choices.

~~~sh
node cli.cjs init --id site-contact --out /private/configuration.json --forms 2
node cli.cjs inspect --config /private/configuration.json
node cli.cjs build --config /private/configuration.json --out /private/commissioning.html
~~~

The commands write a complete staged file with mode 0600, sync it, then publish it with an atomic create-only link. An existing complete identical private output is reused; different work is never overwritten. Interrupted staging leaves the final destination untouched. They make no provider request. Inspection prints readiness, pending status and observation counts without dumping endpoint, recipient or entered message values.

Open the generated HTML directly for preparation. For a live sample, serve that same complete file through the owner’s existing website on its configured HTTPS origin, or deploy the generated form there and receive the actual result into the offline workbench. Do not expose a completed operator workbench at a public website path: it contains submitted data, source context and receiving records. Use the owner’s authenticated operating area. Publish only the generated visitor form and success page.

### Reopen complete work

**Download complete working kit** creates another standalone HTML file with the current selected form, saved settings, unfinished field text, original source context, observations, operator name and most recent actual return. Open it to continue.

**Download complete JSON record** exports the full state. **Open complete JSON record** receives it into the matching edition; source identity and plans must match. To regenerate a standalone file from a saved record:

~~~sh
node cli.cjs build --config /private/configuration.json --state /private/record.json --out /private/reopened.html --operator "Actual operator"
~~~

If storage failed after the actual request returned, preserve **Download complete actual return** before closing the tab. It can be retained in a regenerated kit:

~~~sh
node cli.cjs build --config /private/configuration.json --state /private/record.json --actual-return /private/actual-return.json --out /private/reopened-with-return.html
~~~

The JSON record is state; the configuration is its original source and plan. Keep both. The complete working HTML already includes both. The CLI’s operator argument supplies display identity; recorded observations retain their actual original operator.

## Complete configuration contract

Start with the generated configuration or [configuration.template.json](configuration.template.json). Give independently operated workspaces distinct stable IDs with init --id. Reusing an edition ID intentionally reuses its browser-storage namespace. Preserve identifiers when continuing existing work.

| Field | Purpose |
|---|---|
| schema | tjlabs.formward-commissioning-configuration/v1 |
| pack_id, edition_id | Stable workspace and edition identities |
| title | Display title |
| customer.name, customer.domain | Actual customer identity; empty during preparation if unknown |
| cases[].id | Unique form identity within the edition |
| cases[].source | Original context; unknown URL, budget and observation time stay empty |
| cases[].plan | Complete commissioning steps, ownership, scope and source URLs |
| cases[].settings | Owned endpoint and recipient, website origin, visible text and fields |

Source references are optional HTTPS URLs. observed_at is empty until an actual observation is available, then uses complete UTC ISO format. A label or generated timestamp does not become a source observation. The validator preserves supplied context; the saved record binds to the same source and plan.

A plan has title, preserved, route, steps, demonstration, scope, qualification, privacy_map and contract_urls. Write the actual work and handover scope in these fields. The starter contains general operating instructions, with no buyer or completed activity.

Settings contain:

- language, title, introduction and button_label.
- endpoint: the actual owned Formward form URL.
- site_origin: the actual HTTPS origin without a path or trailing slash.
- success_path: the actual same-site path.
- recipient: the actual notification recipient configured in the dashboard.
- subject, success_text, failure_text and uncertain_text.
- privacy_text and optional HTTPS privacy_url.
- require_consent and consent_text, matching the actual provider requirement and displayed notice.
- fields: complete ordered field definitions.

Each field has name, label, type, required, value and options. Supported types are text, email, tel, url, number, textarea, select, checkbox and hidden. Names are unique; a normal reply route retains an email field named email. Hidden fields use the configured fixed value. Select options contain value and label.

**Save unfinished work** retains incomplete edits, including temporarily invalid choice JSON. **Save settings and refresh preview** validates the complete saved settings. The preview follows saved settings while unfinished text remains available for editing.

Valid drafts may have empty account fields. Deployment source requires the actual endpoint, recipient, origin and success path. No generated account, fictional recipient or substitute source date is inserted.

## Commission the existing website

1. Retain the current website source and rollback route. Confirm which form or handler is being replaced. Keep the existing CMS and owner’s editing workflow.
2. Create or select the form in the owner’s Formward account. Copy its actual endpoint and configure allowed origins. Set the notification recipient and complete any recipient confirmation required by Formward.
3. Enter those values in the workbench. The recipient field documents the dashboard setting; public form HTML does not configure it. Administration credentials are not part of this configuration or generated source.
4. Map required fields and visible labels. Match consent behavior to the account’s requirement. Keep optional marketing preferences separate. Record purpose, handling, retention and the actual privacy notice.
5. Save settings. Inspect the preview; download the CMS fragment, complete contact page and success page. Install the selected visitor source in the existing website and place the success page at the configured path.
6. Open the deployed form. Check keyboard use, required inputs, error messages, desktop and narrow layout. Use the owner’s authorized sample values and one unique marker for a deliberate submission.
7. Retain its actual response and submission ID. Inspect the corresponding provider record and destination mailbox. Keep these observations with their original settings and input.
8. Hand over editable source, complete working HTML and JSON, original configuration, actual receiving results, website placement and rollback procedure.

Formward’s [quickstart](https://formward.eu/docs) explains dashboard setup and recipient confirmation. Its dashboard test-notification action is distinct from a website submission. Successful delivery of that notification alone does not establish the website’s receiving route.

## Field and HTTP behavior

The [ingest contract](https://formward.eu/docs/ingest) accepts form-encoded, multipart and JSON submissions. This application generates ordinary form source and uses form-encoded requests for its explicit sample. It does not add attachment inputs or an administrative API key. Add a separate reviewed integration for requirements outside these field types.

Generated controls use _subject, _redirect, an empty off-screen _gotcha, and _consent when configured. Formward normally uses the field named email for notification replies. See the [field contract](https://formward.eu/docs/fields).

The visitor form has a normal HTML POST action. Its progressive handler requests JSON, validates the configured success destination before sending, and navigates to that same-origin page after a confirmed returned submission ID. The [AJAX contract](https://formward.eu/docs/ajax) distinguishes JSON responses from classic redirects. Entered values are preserved on failure.

| Actual return | Behavior |
|---|---|
| Successful HTTP response with ok true and a nonempty id | Retain confirmation; navigate the visitor to the configured success page |
| Transport loss, status 0, HTTP 500 or higher | Preserve possible delivery; do not automatically send again |
| Successful HTTP response without a confirmed ID | Preserve uncertainty and inspect the provider record |
| Other unsuccessful HTTP status | Keep the returned error and entered values; correct the cause before a deliberate new attempt |

A navigation failure after a confirmed submission does not erase confirmation.

Formward documents that [HTTP 500 may occur after storage](https://formward.eu/docs/responses). Retrying can create another submission. The workbench retains the original request identity for live and imported uncertain returns. The provider’s honeypot/block behavior can also return success-shaped content without an ID; that alone does not confirm an ordinary submission.

## Real request and receiving workflow

**Send one real sample and retain its actual return** requires:

- The actual operator name and explicit single-submission confirmation.
- Complete saved settings.
- The browser on the configured website origin.
- No unresolved original request for this form.
- Successful durable storage of its exact identity, fields, endpoint, dispatched settings and start time before the POST.

The response retains full returned text and actual status. Edits typed while the request runs do not change its dispatched settings. Failed storage before dispatch prevents the POST.

If storage changes in another tab, the workbench stops that tab’s mutations. Reopen the saved copy before continuing. A returned response remains separately downloadable when a conflict prevents recording it.

### Receive a result obtained elsewhere

Use **Receive an existing endpoint result** with the actual endpoint, full submitted field mapping, HTTP status, observation time and complete return. If a request is pending, endpoint and submitted mapping must match its saved input. Status 0, server errors and unconfirmed successful responses preserve the original pending request.

If the provider inbox contains the original submission, receive its actual confirmed result. If an actual inspection establishes that it was not stored, retain the exact query/marker/time range, full observed result and explicit absence confirmation under **Reconcile an uncertain original request in the provider inbox**. This retained observation resolves the original request. Elapsed time or a missing browser response does not resolve it.

After confirmation, retain the matching mailbox message ID, recipient, subject, full observed body and submission ID. The application links this mailbox observation to the exact endpoint result. It does not send a mailbox message or inspect the provider inbox itself.

## Files and embedding API

| File | Role |
|---|---|
| formward_commissioning.cjs | Original field, state, rendering and receiving model |
| formward_commissioning_browser.js | Complete editor, preview, exports and receiving controls |
| configuration.cjs | Generic configuration creation and validation |
| generator.cjs | Pure standalone HTML generation |
| cli.cjs | Local init, inspect and build |
| style.css | Plain responsive industrial layout |
| configuration.template.json | Blank one-form configuration |
| index.html | Complete prebuilt blank workbench |
| RENDERED_RECEIVING.md | Operating the exact outgoing build and exports |

The configuration module exports createConfiguration({id,title,caseCount}) and validateConfiguration(value). Validation accepts an object or JSON text and returns a complete copy.

The generator exports renderKit({configuration,state,coreSource,browserSource,css,operator,actualReturn}), returning standalone HTML. Omit state for initial preparation. Supply source strings from this installed version; the CLI does this automatically. Embedded JSON escapes the less-than character and JavaScript line separators so input text cannot close an HTML script element. Core source is a JSON string parsed by this browser loader.

The original CJS core exports state creation/readiness/reopening, saved settings, unfinished work, case selection, observation receiving, submitted-field mapping, visitor HTML, success HTML, handover and full JSON export. Mutations carry operation ID, actual time, actor and expected revision. Repeating an operation identity with changed content is rejected.

## Render and operate the outgoing files

Before presenting a configured application or customer export, open the exact outgoing version, look at its real rendered result and operate its controls. Use normal presentation width and a narrow/mobile viewport. Download and reopen the working HTML, JSON, visitor page, success page and handover. Fix concrete layout or control defects in the same source.

The [rendered receiving guide](RENDERED_RECEIVING.md) describes this product’s operating course. Source checks establish source behavior; rendered operation establishes the displayed workflow. Keep these distinct in delivery notes.

## License and ownership

MIT; see [LICENSE](LICENSE). TokenJunkieLabs maintains this reusable application. Formward provides the external service under its own [terms](https://formward.eu/terms), [privacy policy](https://formward.eu/privacy) and [DPA](https://formward.eu/dpa). Account billing, origins, recipient configuration and retention remain with the account owner.

Official contracts were reviewed on 13 October 2026. Recheck them when changing transport or account behavior.
