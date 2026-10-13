# Authenticated HTTPS origin for the original workbench

Owner operation: ES26-HTTPS-SERVER-20261013, complementing the existing edge, native connector and API client. Apply CURRENT_OWNER_DIRECTION.md version 2026-10-13.4.

The operator still binds only 127.0.0.1. Explicit configuration adds exactly one canonical HTTPS DNS origin for its existing authenticated transport; it neither starts that transport nor publishes credentials.

## Open through the maintained launcher

Use the existing source_tools/open_received_study.py entry with its original application, Workspace, native Python and private operator-state selections. Add:

    --advertised-origin https://YOUR-EXACT-HOST.workers.dev

The value must be the exact lower-case ASCII DNS HTTPS origin on implicit port443. No trailing slash, explicit port, wildcard, credentials, path, query or fragment is accepted. Save it with the existing --save-profile option if a portable launch selection is wanted. A profile contains the address only. Existing profiles with no advertised_origin keep their exact prior selection representation. A running operator is reused only when its authenticated /api/whoami declares the same selected origin. Configuration changes require closing that operator from its existing owning terminal; never kill a peer's process.

Direct operator/server.py and start_server(..., advertised_origin=...) support the same option. The private local startup receipt retains its original local operator_url. Its new advertised_origin field is an address without any native capability. Never publish the whole local receipt or transplant its fragment token into an HTTPS URL. Recipient configuration comes from the existing transport's separate scoped recipient credentials.

## Shared transport contract

The connector connects only to the original operator's local address. For a remote request it supplies Host equal to the configured public hostname and forwards an existing Origin unchanged. A browser Origin must exactly equal the configured HTTPS origin. Non-browser authenticated requests may omit Origin. The operator accepts local Host with local Origin, or configured public Host with the matching public Origin; it rejects crossed pairs, duplicate Host/Origin fields, null/foreign origins, absolute-form targets and control characters. Forwarded and X-Forwarded-* never select an accepted origin.

Authentication and TeamAccess remain unchanged. The connector must authenticate its recipient and use the intended existing workspace/person capability, never promote every recipient to the native owner. The edge must authenticate static pages as well as API traffic and redact private local startup material. This module is not an edge authentication or workspace-authorization layer.

HTTPS session and logout cookies include Secure, HttpOnly, SameSite=Strict and the original /api/ path. Local-only cookies keep their existing behavior. Team invitations generated on an authenticated public request use that checked public origin; local requests retain the local address. Preserve separate transport and native cookie names and Set-Cookie handling.

Request bodies, uploads, file tickets, Range/Content-Range, SHA identities, scientific operations and retained TaskRequests are unchanged. Existing transport owners handle their streaming/chunk protocol and reconcile lost mutation outcomes using the original operation IDs.

## Receiving on advancing source

The full source bank retains complete server and launcher predecessors and literal before/after joins. Compose those joins against the current source, preserving newer Windows, worksheet, lifecycle, startup, API and Community changes. For a CRLF predecessor, retain its complete bytes, normalize only in the join operation, then restore its original line endings. Never replace a newer full server with this bank's earlier public predecessor. An already-present exact after-anchor needs no second application.

Include origin_policy.py with the actual server and declare the workbench-advertised-origin component. If the cumulative installer has a pinned source admission list, its original owner must admit this complete declared family in that same installer; no second installer or controller is needed.

## Actual receiving operation

The existing qualified native owner opens the same received application/Workspace with its original runtime, first through local access and then the existing authenticated HTTPS transport. Use actual session creation/logout, original saved source inspection, a retained download with its bytes/range and native API workspaces. Check that the public cookie is Secure and that local/default openings still reuse correctly. Wrong/duplicate/crossed origins must return the existing403 before authentication or action processing.

Before presenting the outgoing product, actually open and view the original populated workbench at desktop and390px, operate its important controls, and open its downloaded attachments. Repair real defects in the authorized source. Source review does not replace this normal recipient operation; no broad suite, paid Actions, science rerun or parallel approval apparatus is required.
