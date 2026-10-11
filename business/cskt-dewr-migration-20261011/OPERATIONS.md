# DEWR migration operations

This workspace connects the original CSKT Water Compact content to a reviewed WordPress migration. Staff work from complete native source records, prepare the content and destination paths, approve named revisions, and deliver an immutable release through the included WordPress destination plugin. The original source, editorial history and destination outcomes remain available throughout the process.

## 1. Prepare the private workspace

Use Node.js 24 or later. The operating application uses Node's HTTP, cryptography, compression and SQLite libraries and has no package installation step. Run it under an operating-system account that owns its private data directory.

Create a password file readable by that account, containing a password of at least 14 characters. Configure each staff member with a stable user ID, display name and editorial role:

```bash
node cli.mjs user --database /private/dewr/workspace.sqlite --id migration-admin --name "Migration Administrator" --role admin --password-file /private/dewr/admin-password
node cli.mjs user --database /private/dewr/workspace.sqlite --id content-editor --name "Content Editor" --role editor --password-file /private/dewr/editor-password
node cli.mjs user --database /private/dewr/workspace.sqlite --id content-reviewer --name "Content Reviewer" --role reviewer --password-file /private/dewr/reviewer-password
```

The command derives a salted password hash. Reconfiguring an existing user replaces its password and role, enables the account and ends its earlier sessions. Disable a departed staff member with:

```bash
node cli.mjs disable-user --database /private/dewr/workspace.sqlite --id content-editor
```

An editor can read sources, write drafts and submit them. A reviewer also approves content, requests changes and creates releases. An administrator additionally imports source captures, configures the destination, runs native delivery and downloads the complete database backup. WordPress retains its own native account and permission system at the destination.

Start the private operator service:

```bash
node cli.mjs serve --database /private/dewr/workspace.sqlite --host 127.0.0.1 --port 33219 --sources /private/dewr-source
```

Open the reported local URL and sign in. The `--sources` directory contains the retained original GIS files associated with the imported corpus. A host serving a shared staff workspace should put the service behind its HTTPS reverse proxy and pass the browser-facing origin explicitly:

```bash
node cli.mjs serve --database /private/dewr/workspace.sqlite --host 127.0.0.1 --port 33219 --origin https://migration.example.org --sources /private/dewr-source
```

Forward the original `Host` header unchanged. The service checks it against the configured origin. Browser changes also require the same origin, JSON content type, the signed-in session and its CSRF token. HTTPS deployments use a secure session cookie. Keep the database, password files and destination credential files in the private server directory; the application serves only its three public UI assets and authenticated API routes.

## 2. Capture and import the original source

Use the maintained capture command and contract in `source/CONTRACT.md`. It collects the original WordPress Pages, Posts and Media collections with their pagination records, plus the linked ArcGIS item and application records. Preserve the source directory together with its corpus and source index.

Import its `corpus.json` from **Overview → Original source intake**, or use the same operation from the local CLI:

```bash
node cli.mjs import --database /private/dewr/workspace.sqlite --actor migration-admin --input /private/dewr-source/corpus.json
node cli.mjs status --database /private/dewr/workspace.sqlite
```

The first import creates one source item per original WordPress identity. Reimporting identical corpus bytes returns the original capture identity. A new capture retains the earlier native records and compares source content and availability. It leaves editorial drafts intact so staff can review upstream changes deliberately.

The October 11 working capture contains 33 public pages, no posts and 353 unique public media records. The media collection reports 359 in its header; both ascending ID-only paging and descending full-record paging returned the same 353 IDs. The original reported and observed totals are retained separately in the capture. Public source records can include CDN file URLs; the original download URL remains attached to the asset while local redirect paths come from an observed same-origin route or native upload path.

Use the source history when a public record disappears. The saved content remains available, the item displays its missing-source state, and staff can choose the appropriate retain, revise, archive, consolidate or remove disposition. A new editorial revision records the review of that source absence. A later return or content change produces a fresh source state to review.

## 3. Prepare the content and documents

Open **Content review** and filter by content kind, category, review state, title or original URL. Each record opens with its original WordPress identity, source timestamps and hashes. The editor places the current draft alongside the original published content and keeps earlier drafts and source captures available below.

Set the destination content kind and category, then choose its migration disposition:

| Disposition | Intended destination behavior |
| --- | --- |
| Retain | Publish the reviewed retained content at its chosen route. |
| Revise | Publish the staff-edited revision at its chosen route. |
| Archive | Keep the historical content accessible with archival presentation and metadata. |
| Consolidate | Direct the original route to another included, reviewed content item. |
| Remove | Withdraw the bound destination item and return the reviewed HTTP 410 route. |

A consolidation names the stable source item ID of its destination. Include that destination in the same release. Parent item IDs preserve page hierarchy. The release builder detects duplicate destination paths, consolidation cycles, redirects that shadow retained content and redirect cycles before a release is created.

Edit the HTML and summary, refresh the draft preview, and save a new revision with an editorial note. The original and draft previews use sandboxed frames; original markup is available in the retained source record. **Use current source content** copies the currently captured content into the editor so staff can prepare a deliberate updated revision.

For document and media items, keep the original file URL, WordPress media ID, MIME type and download filename. Supply a useful description, image alternative text and version label. A common document-family ID connects related reviewed document versions in the library. Exact captured file size and SHA-256 values, when present, stay associated with the original selected asset and can be checked during native delivery.

The **Document library** presents the original file link, version label, family, category and review state. The retained revision history records metadata and content changes. Document accessibility work should follow the agreed acceptance specification and the separately priced remediation scope in `commercial/ACCEPTANCE.md`; use the actual original document as the starting material.

For meeting or emergency notices, select the notice kind and supply timestamps with `Z` or an explicit UTC offset. End times follow start times. The selected WordPress destination implements the public notice and announcement behavior while preserving the schedule in native metadata.

## 4. Review GIS resources

Open **GIS sources** to inspect the original ArcGIS item and application data. The retained catalog links each resource to the published source page that references it. It shows the provider's actual item outcome, including an error response from a retired or inaccessible original app.

Add a published resource to the relevant content revision from the GIS catalog. Preserve its exact item ID and original app URL. Write a text equivalent that communicates the relevant map information and links to its supporting original project or document sources. The approval operation checks that each attached GIS resource has a text equivalent.

For a broken original embed, inspect its retained provider response and the other published resources. Staff can select an appropriate published replacement, revise the surrounding content and record the decision in the editorial note. The original captured record and prior draft remain in the history. Use the retained native WebMap and FeatureServer information to describe the actual layers and project phases.

## 5. Submit and approve exact revisions

Save the draft, then use **Current revision review** to submit it with a review note. A reviewer can approve that revision or request changes. A changed source or an unreviewed absence requires an updated draft against the current source state before the review can proceed.

For a prepared group of documents or pages, select the items in the inventory and submit or approve them together. The batch action records an individual review for every exact item revision and commits the group atomically. Use a note that describes the actual content and migration decisions covered by the review. If one selected item is in the wrong state, the group remains unchanged and the response identifies the required correction.

Every staff change includes the workspace revision and a stable request identity. If another staff member has changed the workspace, refresh it and review the newer state before saving. If the browser loses a response, **Recover saved action** retries the original request body and identity. The original committed result is returned for an exact retry.

## 6. Build and deliver a release

Select the approved items and choose **Create release**. Give it a useful label and delivery note. The release binds the exact source identities, approved editorial revisions, reviewer notes, document metadata, GIS references and redirect map. Later edits create new revisions and releases; earlier release bytes remain available for download.

Configure the target under **Releases → Selected WordPress destination**. Use its exact base URL, WordPress username and server-side application-password reference:

- `env:WP_APP_PASSWORD` reads the named environment variable in the service process.
- `file:/absolute/private/wordpress-password` reads the private password file.

The destination module uses the included WordPress plugin. Follow `destination/DEPLOYMENT.md` to install it on the selected WordPress environment, configure native permissions and bind any original target content being adopted.

Inspect the destination, then open the release's **Destination plan**. It comes from the actual native WordPress state and identifies the selected target records, changes and routes. Review that plan before applying. The apply action supplies its exact plan identity together with the immutable release. The native journal retains source bindings, before/applied snapshots and per-item outcomes.

Read back the original destination after delivery. Inspect native IDs, destination URLs, content identities, media results and the reviewed routes. **Native delivery history** retains each operation’s exact release, action, destination configuration and reviewed plan identity before contacting WordPress. Its readback and recovery use that saved destination even if an administrator later changes the selected target. A retried request must match its original route, action and input; concurrent retries share the same running operation.

For a rollback, open the operation in **Native delivery history**, choose **Read back original destination**, then review the original-target restoration. The new rollback operation links to that original operation and uses its saved destination and release. The destination compares each item with this release's applied state. Matching content, routes and bindings can return to their preceding values. Later staff edits remain in place and appear in the native outcome. Downloaded original media remain available in the WordPress library.

## 7. Preserve and reopen the operating workspace

Download the operating export from **Operations** for source, draft, review, release and destination history. An administrator can also download a complete SQLite backup. The backup preserves local account and session configuration, so keep it in the same private storage class as the live database.

A local backup uses SQLite's native backup operation:

```bash
node cli.mjs backup --database /private/dewr/workspace.sqlite --output /private/dewr-backup.sqlite
```

Restore into a new path. The restore command checks the supplied database using a read-only connection and preserves the original backup bytes:

```bash
node cli.mjs restore --input /private/dewr-backup.sqlite --database /private/dewr-restored/workspace.sqlite
node cli.mjs serve --database /private/dewr-restored/workspace.sqlite --sources /private/dewr-source --port 33220
```

Reopen the retained release, original source and review history. Keep the corresponding source directory so original ArcGIS item details and captured page material remain inspectable. A migration workspace restore and a WordPress release rollback are separate operations with their own retained identities.

## 8. Hand over the completed migration

Use the acceptance sequence in `commercial/ACCEPTANCE.md` with the actual selected source cohort and destination. Deliver the maintained source package, exact releases, native readback, source catalog, editorial history and operating backup. Walk through a content correction, document version, GIS text equivalent, notice, source refresh and a controlled rollback with the receiving staff.

Record the receiving CMS, hosting, domain and analytics administrators, the applicable service accounts, backup location, update responsibility and ongoing third-party costs. DEWR's ownership and independent administration are part of the original RFP requirements. The commercial workshare identifies the implementation fee, correction cycles, warranty, optional care and separately priced content work so the prime can integrate this migration arm into its complete engagement.
