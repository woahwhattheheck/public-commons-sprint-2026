# Catalogue Delivery Workbench

Operate a complete CSV edition through its existing CKAN FileStore destination, native approval history and independently reopened customer implementation. This public package installs the generic preparation, Applications, customer-agent and receiving integration. The authorized original application and customer records enter through the separately selected private source authority.

## Build and install the selected product

Use the maintained public repository checkout and Node 24:

```sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo . --ref HEAD --selection catalogue-delivery-workbench \
  --out /absolute/private/packages/catalogue-delivery-workbench
```

Retain the actual archive, manifest and immutable source commit returned by the builder. Resume an interrupted build in its same output directory with the original source/selection and `--resume`. Install the returned archive in the intended receiving directory:

```sh
npm install --ignore-scripts --offline --omit=optional /absolute/returned-package.tgz
npx --no-install starforge source
npx --no-install starforge registrations --source catalogue-delivery-workbench
```

The generic product runtime manifest requires Node 24 and declares no additional product-specific npm dependency. The shared runtime profile retains its own selected dependencies. The private Python application uses CPython 3.11 or later on Linux; preparation observes the actual interpreter and standard-library imports. The separately operated CKAN and approval backend retain their original runtime and deployment requirements.

## Open the installed operating guides

These links are relative to the package-root README produced by the builder.

| Work | Installed source |
| --- | --- |
| Configure and operate catalogue, implementation and approval | [Complete operating guide](source/products/catalogue-delivery-workbench/OPERATING.md) |
| Prepare two complete private source copies and export/receive them | [Private source preparation](source/products/catalogue-delivery-workbench/PREPARING.md) |
| Adopt the existing native results and independently receive complete history | [Receiving course](source/products/catalogue-delivery-workbench/RECEIVING.md) |
| Inspect the external source-authority contract | [Authority schema](source/products/catalogue-delivery-workbench/source-manifest.schema.json) |
| Review public source origin and composition | [Public source provenance](source/products/catalogue-delivery-workbench/PUBLIC_SOURCE.json) |
| Review, save, connect, start and stop the installed application | [Applications guide](source/stellar/scf-starforge-20261009/distribution/runtime-workspace/APPLICATIONS.md) |
| Record original customer scope, responsibilities, commercial selections and acceptance | [Installation work order](source/stellar/scf_2026/sf49_data_commissioning/installation-workorders/catalogue-delivery-workbench.json) |
| Select shared runtime capabilities and installation | [Runtime installation](source/stellar/scf-starforge-20261009/distribution/RUNTIME_INSTALL.md) |
| Read the product scope and original-source attribution | [Grant product chapter](source/stellar-forge/developer-site/GRANT_CATALOGUE_DELIVERY_WORKBENCH.md) |
| Apply the complete producer inspection and custody rules | [Product instructions](source/products/catalogue-delivery-workbench/AGENTS.md) |

The public contribution is discovered by the existing distribution, Applications and Merchant provider registries. No separate loader or catalogue is needed.

## Prepare the authorized private application

Supply the complete original source folder and its literal authority JSON, schema `stellar-forge.catalogue-delivery-workbench-source.v1`, containing every original `{path,bytes,sha256}` member. Select the authority's exact SHA-256 separately. Preserve the original private source and customer-operation owners.

```sh
starforge catalogue-delivery-workbench-prepare prepare \
  --directory /absolute/private/catalogue-preparation \
  --python /absolute/selected/python3 \
  --source /absolute/private/original-catalogue \
  --source-manifest /absolute/private/intake/catalogue-source.json \
  --source-manifest-sha256 ACTUAL_AUTHORITY_SHA256
```

Keep source, source authority, preparation, business workspaces, host controls, credentials and transfer destinations separate. Use actual normalized absolute paths and retain the selected Python invocation, including an original virtual-environment invocation when relevant.

The preparer checks the complete source inventory, copies it into independent primary and receiving application directories and observes the actual imports without constructing a Store, starting a worker or contacting the provider. Read the returned `.preparation/PREPARED.json` and use each binding's actual `applicationDirectory`, `sourceManifestFile`, `sourceManifestSha256` and `python`. Preserve full stdout, stderr and closed outcomes.

The original implementation export is an operating artifact with its own source suffix selection. It cannot substitute for the full application folder: backend YAML, shell, TOML and Docker source must remain available through the complete external authority. The current original private source has 38 members; the generic preparer validates the selected authority rather than assuming a count or embedding a private source pin.

For another equipped host:

```sh
starforge catalogue-delivery-workbench-prepare export \
  --directory /absolute/private/catalogue-preparation \
  --python /absolute/selected/python3 \
  --output /absolute/private/Catalogue_Private_Source.zip

starforge catalogue-delivery-workbench-prepare receive \
  --directory /absolute/private/catalogue-received-source \
  --python /absolute/receiving/python3 \
  --archive /absolute/private/Catalogue_Private_Source.zip \
  --archive-sha256 ACTUAL_ARCHIVE_SHA256
```

The receiver observes its own interpreter and imports, preserving the complete source archive and original manifest. It does not relocate a virtual environment or turn source preparation into native customer delivery.

## Review, start and operate

Choose **Catalogue Delivery Workbench** in Runtime Workspace Applications. Review and save the private launch configuration from the operating guide, complete the actual connection and start the original managed application. The public receiving adapter requires both the selected release and `connectionReady === true` before Start.

Open the original catalogue, implementation and approval screens. Their original Store, ApprovalStore, source editions, review revisions, provider principals and operation identities remain authoritative.

| Installed command | Purpose |
| --- | --- |
| `starforge catalogue-delivery-workbench` | Run the original catalogue, approval or implementation CLI through the reviewed private selection |
| `starforge catalogue-delivery-workbench-prepare` | Prepare, inspect, export or independently receive the complete private application source |
| `starforge catalogue-delivery-workbench-managed` | Own the selected original listener and explicitly selected recurring worker |
| `starforge catalogue-delivery-workbench-receive` | Adopt the existing complete native results and perform the installed receiving course |

Host credentials are exact private-file descriptors; token values do not belong in agent arguments or package source. Host aliases declare immutable inputs, deliberately mutable producer paths, existing destination package/resource IDs, credential references and fresh receiving destinations. Each target retains its original endpoint and permitted origins.

Start with `worker:false` when adopting completed history or reviewing source without advancing enabled feeds. Worker activation is an explicit choice. Applications Stop drains the owned listener, handlers, worker and accepted local work. It does not establish that a remote request had no effect.

## Customer-agent and useful delivery

The `catalogueDelivery` provider is initialized through the maintained Merchant configuration key `catalogueDeliveryConnection`. Its 49 distinct tools retain 34 original native operations and add 15 attachment, full-file and implementation operations. The operating guide contains every complete tool contract.

A complete customer delivery follows the original chain:

1. Retain the original Workshare/Installation selection, full producer source and period, existing CKAN resource, responsible operator, reviewer and receiver.
2. Import all selected CSV rows and exact cells through the original parser. Preserve leading zeroes, long identifiers, empty strings and supplied metadata.
3. Read the actual destination and retain the original plan. Approve and advance its durable job using the selected provider identity.
4. Read complete upload/readback and native approval outcomes. Keep rejection and approval editions separately inspectable, with distinct principals and original requests/events.
5. Retain complete implementation mappings, source comparisons, profiles, notes and resource bindings.
6. Export complete implementation and separate approval archives, independently receive each through its original reader, operate a deliberate local note and cold reopen the editable history.

A queued activity, local row comparison or managed listener does not prove an authentic CKAN delivery or approval. The original native operation remains the authority for those effects.

## Recover the same operation

The installed `requestId` binds the complete host intent; the original approval `request_id` and native operation keys keep their own meanings. Requests are retained before dispatch and full responses are retained before conclusions about outcomes.

After uncertain acknowledgement, inspect the saved request, original job/review and native provider journal. Use the explicit original reconciliation action. Retry and “request finished” actions require an actual observation that the previous provider request ended; a timeout does not establish that fact. Never replace an unknown original request with a newly labeled write.

An in-progress installed receiving directory binds its exact distribution source manifest and selected receiver/browser modules. Resume that exact installed edition; do not swap this public distribution into a bound predecessor. The public adoption continues the same selected provider operation and consumes its actual donor outputs through a deliberately selected installed course. The unchanged private preparer preserves its original source/runtime/import selection.

Source preparation, managed ownership and whole-course cleanup retain their complete outcome records. Diagnostic or file-close failure must not abandon an owned child. Keep the same output and selected request for replay; a different source, runtime, input or native result needs a deliberate new selection.

The installed receiving course accepts the original completed implementation archive, initial rejected approval archive, corrected approved approval archive and both literal native phase results. It validates their full source/job/review/principal/event graph. It disables the managed worker and supplies no service-token environment; it consumes the actual prior provider results without redispatching the original native approval.

Continue the selected existing native operation through its original equipped owner. Preserve its current private-source custody and actual result state. If that native course is incomplete, source preparation can proceed while the existing owner completes it; a second backend or replacement native job is not part of this package adoption.

## Deliver each complete part

| Delivery | Complete contents and handling |
| --- | --- |
| Selected public distribution archive | Generic adapters, Installation, Runtime Workspace, Applications, Merchant tools, Grant workspace, product guides and exact source manifest |
| Authorized private source transfer | Complete original application and external authority, independent source copies and actual interpreter/import observations |
| Customer operating artifacts | Full implementation ZIP, separate rejected/approved native approval ZIPs, literal native results and independently reopened editable history |

Retain actual filenames and byte/SHA descriptors for every output. Private application bodies, customer data, commercial inputs, source authority, native results and credentials remain in authorized private custody. The public source provenance inventories only the 27 previously public generic product files and their additive package composition.

Source capacity is 32 MiB for the complete private source. The original CSV/readback capacity is 2 GiB; archive readers preserve their declared complete capacities and overhead. Full retained-file reads are 196,608-byte chunks, while JSON inspection is bounded at 32 MiB. Follow all original cursors/chunks until complete; do not relabel a truncated view as a full artifact.

## Source composition and rendered use

The original generic integration is Merchant merge `e5411594e51029256cfeffcc56f5c04c61ff37f2`: 27 files, 446,311 bytes. Public adapter maintenance is recorded in the provenance: current connection-readiness admission and independent owned file/log/lifecycle cleanup. The final built manifest identifies the selected complete edition.

The package reuses the current source-selection builder and provider registrations. Its full Grant component retains `workspace/cli.py`, the default `sf10_current_candidate.json` and its declared browser/source dependencies. Shared loaders and unrelated products are unchanged.

Before presenting the exact outgoing application or attachments, the producing worker must run/open/render it, personally look at actual pixels or screenshots and operate meaningful controls at desktop/screenshare and relevant narrow widths. Inspect applicable loaded, empty, loading and error states, full downloads and cold reopening. Open every attachment in its normal viewer and inspect usable archive/project contents; play audiovisual media. Fix actual clipping, contrast, overflow, broken controls or unreadable output.

Source validation, HTTP success, screenshots that nobody viewed and peer approval do not substitute for actual use. Keep inspection focused on delivering the product; no broad suites or new approval process. Pass the full product instructions to delegated workers.

The October 13 local-browser reservation ended under its original meeting-over-or-release condition when Bryce explicitly reported the meeting over at 16:18:37 UTC. Preserve current browser owners, private tabs and active work.
