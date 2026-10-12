# GeoCat catalogue receiving

Operate complete STAC collection deliveries in the existing TokenJunkieLabs
imagery application, publish them through GeoNetwork's installed native STAC
harvester, review the resulting records, and hand the complete saved operation
to another operator.

The installed product keeps the original STAC workspace, completed customer
delivery, collection IDs, native UUID mapping, GeoNetwork installation,
harvester ownership and action history together. The catalogue panel is part
of the existing Satellite imagery and processing application.

## What the selected package contains

The geocat-catalogue selection uses the maintained distribution builder and
installer. Its manifest identifies every included file by original path, Git
blob, complete SHA-256, byte count and mode. The selected source includes:

- The complete STAC workspace, merchant/customer delivery, processing and
  portable GIS source, including the GeoNetwork catalogue controller and UI.
- The original native Buyer, file delivery, accounting, source transport and
  recovery modules that the STAC customer imports.
- The original Applications provider, private session host, managed launcher,
  runtime installer and complete browser asset mappings.
- The source-owned STAC typed client and merchant-agent registrations.
- Original runtime dependency declarations, operator requirements, source
  selection, operating guides and applicable licenses.

The builder resolves the complete static import graph and declared dynamic
runtime inputs. The package does not depend on a separately copied set of
changed files. Unrelated contribution registrations are outside this selected
product.

A customer handover may also include the separately supplied
GeoCat_Catalogue_Workshare.md and GeoCat_Catalogue_Intake.json. The editable
intake records the actual installation, original delivery and publication
location agreed for the engagement. Keep the selected archive, its original
manifest and those customer documents together.

## Prepare the receiving installation

Use an existing Linux host with Node.js 22.16 or later, Python 3.11 or later,
Git and util-linux flock. Keep saved application data on a local filesystem
that supports file locks, atomic rename and fsync. The native GeoNetwork
service is a separate existing installation selected by its real URL and
version; installing this package does not create or provision that service.

The complete source repository is:

https://github.com/woahwhattheheck/tjlabs-stellar-merchant-workspace

For a source build, select one actual full Git commit containing this recipe
and the complete catalogue application:

~~~sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/stellar-merchant-source \
  --ref ACTUAL_FULL_SOURCE_COMMIT \
  --selection geocat-catalogue \
  --out /absolute/new-geocat-release
~~~

Use the exact archive path and SHA-256 returned by that command or by the
supplied completed release. The archive filename contains the original source
commit and selection. The release's distribution.json and package/manifest.json
retain the whole selection and source inventory.

Install the source archive in a fresh private directory:

~~~sh
npm install --ignore-scripts --offline --omit=optional \
  /absolute/downloads/ACTUAL_GEOCAT_SOURCE_ARCHIVE.tgz
~~~

From that directory, the original npx --no-install starforge command operates
the installed source. Prepare its native runtime with the declared dependencies:

~~~sh
npx --no-install starforge runtime-install prepare \
  --dir /absolute/runtimes/geocat \
  --archive /absolute/downloads/ACTUAL_GEOCAT_SOURCE_ARCHIVE.tgz \
  --sha256 ACTUAL_COMPLETE_ARCHIVE_SHA256 \
  --native --feature schema --feature openapi --feature mcp --operator

npx --no-install starforge runtime-install install \
  --dir /absolute/runtimes/geocat

npx --no-install starforge runtime-install inspect \
  --dir /absolute/runtimes/geocat --load --source
~~~

Use --offline --cache /absolute/existing-npm-cache on the install command when
the selected dependency closure is already available there. The installer
preserves its exact profile and lock, verifies the source archive and selected
dependency versions, and records READY only after its own receiving checks.

Run the original command through that selected runtime:

~~~sh
npx --no-install starforge runtime-install run \
  --dir /absolute/runtimes/geocat -- stac help
~~~

The commands below use starforge as the installed command. When operating
through the selected runtime, put the same arguments after runtime-install run
--dir /absolute/runtimes/geocat --. Before installation, the corresponding
source entry is node stellar/scf-starforge-20261009/distribution/cli.mjs.

## Select the original imagery and customer data

Start from the existing initialized STAC workspace and an actual completed
customer delivery. The receiving directory must contain its original
stellar-forge.stac-customer-delivery.v1 manifest and all recorded files.

An analyst export, a list of collection URLs or a portable explorer alone is
not a completed customer delivery. Use the original customer-open command to
read the supplied delivery. It reopens saved bytes:

~~~sh
starforge stac customer-open \
  --directory /absolute/completed-stac-delivery
~~~

Opening a completed delivery for catalogue receiving does not run a purchase,
assemble another object or request the source again. The saved delivery
identity remains the source of the complete collection metadata.

If a private STAC workspace has not yet been initialized for the receiving
operator, use its original initializer with the actual original catalogue
endpoint:

~~~sh
starforge stac init \
  --workspace /absolute/private/imagery \
  --title 'Catalogue receiving' \
  --endpoint https://ACTUAL_ORIGINAL_STAC_HOST/ACTUAL_STAC_PATH
~~~

Use the original workspace's supported receive/import workflow when a saved
imagery workspace has been supplied. Keep workspaces and deliveries outside
the installed source/runtime directory.

## Open the existing application

~~~sh
starforge stac serve \
  --workspace /absolute/private/imagery \
  --catalogue-workspace /absolute/private/catalogue \
  --port 0
~~~

Open the private session URL printed by the original server. In the imagery
application, choose Catalogue receiving. This uses the same host, authenticated
session and request protection as the existing imagery interface.

An operator may instead use the installed Applications workspace. Select the
existing Satellite imagery and processing card, supply the original imagery
workspace, and set Catalogue receiving workspace. Review and save those exact
paths, then Start and Open. Stop and a fresh Start retain the same source,
workspace identity and original native catalogue state.

The optional --catalogue-config /absolute/private/catalogue-host.json selects
a private host configuration. For example:

~~~json
{
  "title": "Catalogue receiving",
  "handoverDirectory": "/absolute/private/catalogue-handovers",
  "sourcePublication": {
    "directory": "/absolute/existing-served-directory/geocat",
    "baseUrl": "https://ACTUAL_PUBLICATION_HOST/geocat/"
  }
}
~~~

The publication directory and base URL must already correspond to an existing
operator-controlled service. It is separate from private catalogue state.
Omit sourcePublication to download the complete source JSON and place it in
an existing publication location manually.

## Connect to the actual native catalogue

In Installation, enter the GeoNetwork context URL, portal, language and expected
installed version. Use environment-variable names for the credentials that
already exist on this host. A connection has this structure:

~~~json
{
  "baseUrl": "https://ACTUAL_CATALOGUE_HOST/geonetwork",
  "portal": "srv",
  "language": "eng",
  "expectedVersion": "ACTUAL_INSTALLED_VERSION",
  "auth": {
    "usernameEnv": "GEOCAT_CATALOGUE_USERNAME",
    "passwordEnv": "GEOCAT_CATALOGUE_PASSWORD"
  },
  "timeoutMs": 30000,
  "maxResponseBytes": 8388608,
  "maxMefBytes": 67108864
}
~~~

The base URL ends at the installed context; portal and language remain separate
fields. A selected existing Cookie/CSRF authentication may use cookieEnv and
csrfEnv instead. Credential values stay in the local environment. An explicitly
chosen HTTP installation requires allowHttp: true; select the actual network
and installation before enabling that option.

Save the connection, then Connect to read the actual installed version,
current actor, group permissions, transform capabilities and native options.
A version mismatch remains visible. A connection repair preserves the same
installation and original pending operations.

The native client contract is pinned to GeoNetwork 4.4.12 upstream source
45f1bcb4ec72f17d5990ffa55469b66a79dcbfc4. Compatibility with a particular GeoCat
deployment is established by its actual identify and capability responses.
The full source-backed API and recovery contract is retained in
sf30-seller-sdk/stac/geonetwork/NATIVE_CONTRACT.md.

## Receive and review the complete collection source

1. In Collection source, inspect the completed customer delivery directory.
   Review its actual delivery/edition identity and complete collection rows.
   Editing the directory invalidates the prior inspection and selection.
2. Select the full collection set intended for this harvester and receive it.
   Each source row retains its original collection ID, full metadata and exact
   native UUID mapping. Mapping collisions are rejected.
3. Preserve absolute original public links. If a retained link is relative,
   supply the actual original collection document URL as its source context;
   the portable filesystem path is not a public URL.
4. Download the complete content-addressed collection JSON, or Publish it
   through the configured existing served directory. The controller reads
   the actual reachable URL and compares the full bytes and SHA before it
   can be used by the native plan.
5. In Harvest plan, select the actual native owner and group, sharing choices
   and installed transform. Review every removal from the previous complete
   source before saving the plan.

The native SimpleURL STAC harvester receives one complete collections document.
Its own transform creates collection-level series metadata. It does not use a
per-item ISO converter or a partial client-side cursor page. Import validation
is selected from NOVALIDATION, XSDVALIDATION and SCHEMATRONVALIDATION. Available
privilege names come from the actual native capability response.

The saved plan fixes oneRunOnly, an inactive schedule between explicit runs,
the original UUID policy, no pagination and no source authentication. Native
harvester configuration, source bytes, owner/group and selected record
inventories are checked again at the mutation boundary.

## Run, inspect and continue native work

Run the selected saved plan. The operation first reviews current native
ownership and records. Before a refresh can alter or remove owned records,
it retains and inspects the complete native MEF metadata/attachment archives.
Every record listed in the reviewed inventory must have a readable current
snapshot. Complete collection inventories and MEF requests are divided into
the native endpoint's bounded UUID requests while preserving the full union.

The original native history, complete record count, transformation/import
counters, current metadata and ownership determine the outcome. A local HTTP
job finishing is not a statement that the harvester completed successfully.
Inspect the original operation's RUNNING, PARTIAL or RECONCILE state and its
saved files.

Use Continue on that exact retained request. The original operation ID and
immutable input are reused. An uncertain add/update/run/record mutation is
reconciled against native state before another mutation can be considered.
The application does not replace a lost response with a new purchase or a new
harvester.

For terminal operation, keep the reviewed JSON input file and original ID:

~~~sh
starforge stac catalogue-state \
  --workspace /absolute/private/imagery \
  --catalogue-workspace /absolute/private/catalogue

starforge stac catalogue-action \
  --workspace /absolute/private/imagery \
  --catalogue-workspace /absolute/private/catalogue \
  --action harvest \
  --input /absolute/private/reviewed-harvest.json \
  --operation-id ACTUAL_ORIGINAL_OPERATION_ID
~~~

The harvest input contains only the actual saved plan selection:

~~~json
{
  "planSha256": "ACTUAL_REVIEWED_PLAN_SHA256"
}
~~~

After interruption, reuse that same file and operation ID. Reopening the
browser on a different local port recovers the native request from the saved
catalogue operation. Browser-local pending requests are bound to both the
original imagery owner and the catalogue workspace identity.

## Review native records and publication

Record review retains current metadata XML, approved and draft hashes, sharing,
workflow, validation and the installation's publication options. Open the
actual saved XML before a decision.

Validation explicitly selects the approved or draft version and retains the
native processing report. Submission and approval bind the reviewed draft
content and workflow state. Sharing and publication bind approved metadata
and the current sharing hash. A changed record requires a fresh review.

The supported actions are validate, sharing, submit, approve and publish.
Their exact request fields are listed in geonetwork/APPLICATION.md. Native
sharing clear=false retains unspecified operations and applies explicitly
false operations as removals; clear=true selects a complete replacement.

A lost publication acknowledgement can establish observed privileges while
leaving configured metadata processing unconfirmed. A persisted validation
state does not invent an execution ID. Those partial outcomes remain in the
original operation for the operator's review.

## Save a complete handover and reopen it

In Handover, export to a new private directory. The original bundle retains the
completed STAC delivery, full collection sources, reviewed plans, native
operation requests/replies, saved XML and MEF files, and the complete catalogue
state. Its per-file identities are verified while receiving.

Use receive-handover with the saved source directory and a new private
destination. It creates that selected workspace without switching the current
host. Review the receiving directory in the existing Applications card and
Start that same application with the new binding.

The original command can also receive it:

~~~sh
starforge stac catalogue-action \
  --workspace /absolute/private/imagery \
  --catalogue-workspace /absolute/private/catalogue \
  --action receive-handover \
  --input /absolute/private/receive-catalogue.json \
  --operation-id ACTUAL_RECEIVING_OPERATION_ID
~~~

~~~json
{
  "sourceDirectory": "/absolute/saved-complete-catalogue-handover",
  "directory": "/absolute/new-private-catalogue"
}
~~~

Keep the complete directory together. Saved native files can be downloaded
through Record review and Operations, or with catalogue-file --path
SAVED_RELATIVE_PATH --out NEW_FILE. The original client verifies and streams
the selected bytes.

Full MEF archives cover native metadata and actual uploaded attachments.
External STAC links remain external references. Importing MEF into another
installation does not recreate a native harvester association or its workflow
history. The application retains the original ownership, inventory and raw
native reports so the receiving operator can see that exact recovery boundary.

## Recover the original build, installation and application

- An interrupted source build continues in its original output directory with
  build.mjs --out ORIGINAL_OUTPUT --repo ORIGINAL_REPOSITORY --resume.
  Its saved source pin and geocat-catalogue selection remain fixed.
- An interrupted dependency installation uses runtime-install resume --dir
  ORIGINAL_RUNTIME. Its original source archive, lock and profile are retained.
- An interrupted catalogue operation uses its original action, exact JSON input
  and operation ID. Read the current saved state before continuing.
- Stop uses the existing application process lifetime. Closing its host aborts
  owned catalogue exchanges and drains the same native work and file streams.
- A runtime upgrade uses a new runtime directory. Reattach the existing private
  workspaces through the supported Applications review after the new runtime
  is READY.

The release manifest establishes package identity. Actual customer execution
is reported separately with its original installation, input, native operation
and completed receiving results; source installation alone is not a native
catalogue acceptance result.

## Included operating references

The package preserves these original source-relative guides under source/:

- sf30-seller-sdk/stac/geonetwork/APPLICATION.md: browser, CLI and action fields.
- sf30-seller-sdk/stac/geonetwork/NATIVE_CONTRACT.md: exact native endpoints,
  XML, workflow, attachment and uncertain-response semantics.
- sf30-seller-sdk/stac/receiving/PORTABLE_GIS.md: original completed delivery and
  offline GIS receiving.
- distribution/RUNTIME_INSTALL.md: preparation, dependency selection,
  installation, READY, upgrades and same-directory continuation.
- distribution/BUILDING.md: complete Git source acquisition and retained builds.
- distribution/runtime-workspace/STAC_APPLICATIONS.md: the original managed
  imagery application.

Within the installed source tree these paths begin with
stellar/scf-starforge-20261009/. Original STAC typed-client and merchant-agent
guides remain under stellar-forge/mcp-merchant-operator/.

Copyright TokenJunkieLabs. Preserve the package's original MIT license and
applicable third-party notices.
