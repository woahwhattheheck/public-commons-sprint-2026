# Native WordPress destination

The migration workspace sends an exact reviewed release to an explicitly selected WordPress installation. The destination creates ordinary Pages and news Posts, Projects, Documents and Notices. Staff continue editing through WordPress's native roles, block editor, Media Library and revisions. The original release, its source IDs, each approved revision and its destination operations remain in the same WordPress database.

## Install and connect

Copy `wordpress-plugin/` into the target's `wp-content/plugins/cskt-migration/` and activate **CSKT Reviewed Migration**. Use WordPress 6.8 or later and PHP 8.1 or later. The actual native operating journey uses its retained WordPress/PHP versions recorded beside the result. Production needs a transactional database and writable native upload storage. Use the original site's complete database and upload backup before a cutover.

Create a named WordPress migration administrator and a dedicated native Application Password in that account's profile. The destination endpoints require `manage_options`, `edit_pages` and `upload_files`; WordPress also checks the individual native post's edit capability. Revoke the application password when this deployment access ends. Ordinary staff edits use the existing Editor/Administrator roles and the registered custom content capabilities.

The private migration workspace's destination settings accept:

```json
{
  "baseUrl": "https://reviewed-wordpress.example.org",
  "username": "migration-operator",
  "credentialRef": "env:CSKT_WORDPRESS_APP_PASSWORD"
}
```

The actual URL must be supplied by the operator. A WordPress installation in a subdirectory uses that complete base path. The credential reference can instead be `file:/absolute/private/wordpress-app-password`; its contents stay server-side. The module reads the reference for each authenticated request, allowing the selected credential to rotate without rewriting release data. Exact loopback HTTP is available for the owned native local runtime. The server sends application-password authentication only to the selected destination and refuses an authenticated redirect.

For production, define `CSKT_MIGRATION_PRIVATE_DIR` in `wp-config.php` as a private absolute directory outside the public document root. It retains interrupted upload chunks. The default uses a site-specific directory inside the PHP system temporary directory. Preserve that staging directory until incomplete uploads have been resumed or deliberately retired. Completed files live in the native uploads directory under `cskt-retained/`.

## Review, apply and reopen

1. Select a completed reviewed release in the migration workspace and inspect the configured destination. Inspection returns the actual WordPress/PHP versions, authenticated account, supported native content types, source bindings and retained releases.
2. Preview the exact release bytes and SHA-256. The result includes every native target or proposed creation, occupied routes, existing post fingerprints, selected assets, original homepage settings and a `planSha256` identifying the observed plan.
3. Resolve any occupied native route by selecting a different reviewed route or explicitly binding its original source to the intended existing post. Apply the displayed plan with one stable operation ID.
4. Reopen **Readback** after the result returns or a browser/network interruption. Readback reports actual post IDs, public/native URLs, current post/metadata/term/file snapshots, original and current fingerprints, retained assets, routes and original operation results. The same apply operation is replayed from its retained result.

The adapter downloads selected source media sequentially. It records the exact reviewed URL, final response URL, actual response Content-Type, byte count and SHA-256. A supplied capture hash/size must match. It spools one original file at a time, transfers 2 MiB chunks, verifies the destination's retained prefix on resume, and commits the complete original file only after the destination verifies its full hash and size. Each selected file can be up to 1 GiB; request timeouts apply per request and can be configured through the module/CLI. Video and audio remain native attachments. An interrupted upload is resumed from the existing release/item/operation rather than acquiring a second native attachment.

PDF and image signatures are checked against the declared media type. Captured source metadata can be inconsistent: a PDF preview image is distinct from the PDF itself, and a CDN image can differ from the original upload. Select the actual observed original URL and response type in the reviewed document metadata. The original raw WordPress object remains the source identity. Two document records with the same exact file hash share one verified native attachment, while their separate document titles, families, descriptions and version labels remain on their native Document posts.

The native content transform uses WordPress's post HTML allowlist. It rewrites selected source links and media references to their actual native URLs and retains the original HTML inside the immutable manifest. Each result reports whether HTML was sanitized, the number of mapped links, and original/native HTML hashes. The complete reviewed GIS item URL and text equivalent render with an accessible iframe title, a separate map link and visible text. Documents show their actual version, type, size and download; notices show their reviewed type, time and location.

## Existing native targets

A source WordPress ID is never interpreted as an unrelated destination ID. First deployment creates new posts unless an original source has been explicitly bound to an existing destination. Use the CLI's `native` command to inspect an intended post, then `bind` with that actual fingerprint:

```sh
node destination/cli.mjs native --config destination.json --post-id 42 --out native-post.json
node destination/cli.mjs bind --config destination.json --source-origin https://csktwatercompact.com --source-kind page --source-id 13 --post-id 42 --fingerprint EXACT_NATIVE_FINGERPRINT --out binding.json
```

The binding retains the original site, original kind and numeric ID. Its fingerprint check protects a native edit between inspection and binding. Preview exposes an occupied native page's candidate ID so the operator can make this concrete selection. The WordPress **Tools → Reviewed migrations** page lists the same original release records and links to authenticated readback.

## Native behavior and rollback

|Reviewed content|WordPress behavior|
|---|---|
|Page|Ordinary native Page, with the exact reviewed route and native parent where provided.|
|Project|`cskt_project`, native block editor, revisions, topics and public archive.|
|Document|`cskt_document` with a verified attachment, retained family/version and download details.|
|News|Ordinary native Post.|
|Notice|`cskt_notice` with structured dates, type and location.|
|Media|Verified native attachment with a retained source identity and reviewed download route.|
|Retain / revise|Publish the reviewed revision.|
|Archive|Keep the historical content accessible with an Archived banner.|
|Remove / consolidate|Withdraw an already bound target to draft and publish its reviewed 410 / 301 route.|

The plugin supplies reusable Document library, Project directory, Notice board and News block patterns. Their native shortcodes support topics and pagination: `[cskt_documents]`, `[cskt_projects]`, `[cskt_notices]`, `[cskt_news]`, with optional `topic` and `per_page` attributes. The content render uses the site's existing theme with restrained, responsive styles for document metadata, tables and maps.

Applying uses a database transaction, an original migration journal mutex, native post and metadata/term row locks, and a fresh comparison to the reviewed preview. The native homepage can be served through its reviewed `/` route without rewriting WordPress's existing front-page option values. Existing content's complete prior post fields, metadata and taxonomy assignments are retained before application. WordPress native revisions are also saved.

Rollback compares every target with the release's applied state before restoring its prior content. Later staff edits become explicit conflicts and stay intact. New content is withdrawn to draft; original downloaded media remains in the native Media Library. Each route and source binding is restored only while it still matches the applied release. A partial rollback lists the exact unresolved post or mapping so an operator can review it. Reusing the original rollback ID returns its original result; a deliberate new rollback request can evaluate newly resolved conflicts. The original manifest and all prior operation outcomes remain retained.

Back up the complete WordPress database and uploads together: the release journal is in native options, content and revisions in native post tables, and original files in uploads. A database-only rollback cannot recover a file that was independently removed from storage. Readback checks the actual retained file bytes and reports that concrete difference.

## Module and command contracts

`wordpress.mjs` exports JSON-compatible provider results and typed `DestinationError` failures:

```js
await inspectDestination(config);
await previewRelease(config, {manifestBytes, sha256});
await applyRelease(config, {manifestBytes, sha256, operationId, planSha256});
await readbackRelease(config, {releaseId});
await rollbackRelease(config, {releaseId, operationId});
await snapshotDestinationPost(config, {postId});
await bindDestinationItem(config, {sourceOrigin, source:{kind,wpId}, postId, expectedFingerprint});
```

`manifestBytes` is a Buffer/Uint8Array of the original JSON file. `sha256` binds those exact bytes. `operationId` is the caller's retained stable request identity. `planSha256` is the displayed preview hash; direct module callers may omit it to use that release's retained latest preview. The main workspace binds the displayed value explicitly.

```sh
node destination/cli.mjs inspect --config destination.json --out destination-inspect.json
node destination/cli.mjs preview --config destination.json --manifest release.json --sha256 EXACT_FILE_SHA256 --out preview.json
node destination/cli.mjs apply --config destination.json --manifest release.json --sha256 EXACT_FILE_SHA256 --plan-sha256 DISPLAYED_PLAN_SHA256 --operation RETAINED_APPLY_ID --out apply.json
node destination/cli.mjs readback --config destination.json --release RELEASE_ID --out readback.json
node destination/cli.mjs rollback --config destination.json --release RELEASE_ID --operation RETAINED_ROLLBACK_ID --out rollback.json
```

`--out` creates a new private result file and refuses to overwrite an existing original result. A conflict result exits 2; a request failure exits 1. A lost apply response calls for readback of the retained original release before further action. Plugin routes use the normal WordPress REST API and its permission callback; no second application server is installed in WordPress.

## Primary implementation references

- [WordPress Application Password authentication](https://developer.wordpress.org/rest-api/using-the-rest-api/authentication/)
- [Custom REST route permission callbacks](https://developer.wordpress.org/reference/functions/register_rest_route/)
- [Native content types and REST support](https://developer.wordpress.org/reference/functions/register_post_type/)
- [Native post insertion and update](https://developer.wordpress.org/reference/functions/wp_insert_post/)
- [Registered native metadata and revisions](https://developer.wordpress.org/reference/functions/register_post_meta/)
- [Native attachment metadata](https://developer.wordpress.org/reference/functions/wp_generate_attachment_metadata/)
