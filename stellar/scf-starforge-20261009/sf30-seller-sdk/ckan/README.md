# CKAN data products

Create a retained data product from an existing CKAN DataStore, choose the fields
and customer query policy, publish the dataset, and deliver its merchant package
and buyer request through the original Stellar Forge engines.

The local interface covers catalogue discovery, capture and resume, edition
comparison, field selection, candidate preview, review, version publication,
merchant packaging, release staging and buyer preparation. It uses a restrained
industrial layout with explicit forms and the real retained project state.

## Start a project

Use Linux with Node 24 or newer and util-linux `flock`. Archive downloads use the
system `tar` command. Run these commands from the SCF source directory:

```sh
mkdir -m 700 ./ckan-work

node sf30-seller-sdk/ckan/cli.mjs init \
  --project ./ckan-work/library \
  --origin https://ckan0.cf.opendata.inter.prod-toronto.ca

node sf30-seller-sdk/ckan/cli.mjs serve \
  --project ./ckan-work/library --port 8457
```

Open the printed project link. The server binds to 127.0.0.1 and the link carries
the project capability in its fragment. The browser removes the fragment from its
address bar and retains the capability for this session. Project API requests use
an authorization header and verify the local host and origin.

The installed distribution exposes `starforge ckan` and the original
publisher adapter as `starforge ckan-publisher`. Invoke the installed command
using the same options. `ckan help` lists each native action.

For a catalogue that requires an existing API token, pass its environment variable
name with `init --auth-token-env CKAN_TOKEN`. The project records that reference.
Provide its value in the serving/capture process environment.

## Operator workflow

1. **Find and retain an edition.** Search the catalogue and open an advertised
   DataStore resource. Choose source filters, query, pagination and capacity.
   Capture saves the original package/resource responses and every accepted page.
   After a process interruption, open the same project and resume the edition.
2. **Review the source fields.** Open a complete edition to see the actual rows,
   provider types, null/empty counts and suggested aliases. Select the fields,
   scalar types and explicit conversion for the product. Compare an earlier
   edition of the same resource by a unique source key when available.
3. **Prepare the queryable product.** Select equality filters, range fields,
   sort fields, extraction ordering and customer page sizes. The original
   durable publisher creates the typed CSV, dataset configuration and candidate.
   Preview actual customer queries through the original dataset engine.
4. **Record the review and publish.** The review binds the displayed candidate
   digest and original version target. Publish initializes the dataset version.
   Recovery reads the original publication outcome after an interrupted response.
5. **Package and stage the merchant.** Enter public payment terms and the
   intended resource address. Download the complete portable package or stage it
   in the project's original SF82 release store. The original seller console owns
   activation, process start/stop, comparison and rollback.
6. **Prepare the buyer request.** Read the running seller's actual offer for the
   selected edition and query. Choose its payment alternative and intent ID,
   then download the original SF88 configuration.

Each mutation records its result in the project. A project has one active
operation at a time and one kernel-owned workspace lock. Close the serving process
before using another process to mutate the same project.

## Capture and import from the CLI

The original Toronto source selection is included in
[examples/toronto-library-selection.json](examples/toronto-library-selection.json).

```sh
node sf30-seller-sdk/ckan/cli.mjs capture \
  --selection sf30-seller-sdk/ckan/examples/toronto-library-selection.json \
  --out ./ckan-work/toronto-capture

node sf30-seller-sdk/ckan/cli.mjs import \
  --project ./ckan-work/library \
  --capture ./ckan-work/toronto-capture/capture.json
```

Re-running `capture` with the same selection and directory resumes the retained
pages. A complete capture is reused only when its original selection matches.
Use a new directory to acquire a fresh edition. `import` copies and verifies the
complete retained edition; an already imported manifest resolves to its existing
project entry.

`captureSelection()` accepts the canonical HTTPS catalogue origin, package and
resource IDs, explicit filters, optional full-text query, page size and pagination.
Offset pagination is the default. CKAN 2.12 keyset pagination uses the returned
`next_page` filter; selections with an existing `_id` filter use offset mode.

The capture follows the provider's returned `limit`, checks exact totals, and
retains estimated-total status. Duplicate record IDs, changed field declarations
and inconsistent terminal pages produce a retained error with the edition still
available for inspection. Provider HTTP 429 retains its response receipt and
retry guidance for a later resume.

Successful capture metadata includes the observation interval, original source
selection, page requests and digests, original license fields, and resource
metadata before and after paging. Its observation kind is
`sequential-datastore-pages`. This makes the acquisition method and any
resource metadata change visible when an edition is reviewed.

## Field types and exact values

A saved source uses `stellar-forge.ckan-source.v1` and named projection queries.
Each customer alias selects one original CKAN field and an explicit type:

| Setting | Behavior |
| --- | --- |
| `native` | Retain a compatible string, safe integer, finite number or boolean. |
| `text` | Convert a reviewed scalar into text; exact numeric tokens retain their original value. |
| `json` | Retain structured values, scalar JSON types and exact numeric tokens as JSON text. |
| `nullable` | Permit source null for the selected scalar column. |

Aliases use the original dataset identifier rules. Suggested names are
deterministic and avoid collisions. The source field remains in the declaration,
so labels such as `Service Tier` can be exposed as `service_tier` without losing
their original field identity.

The original CSV engine represents an empty nullable cell as null. Use JSON text
when one field contains both actual empty strings and nulls. Exact numbers that
JavaScript would round, overflow or underflow are retained using the original JSON
token and require text or JSON projection. Ordinary compatible numbers remain
typed. Browser samples display exact values as text to preserve what the operator
reviews.

The [Toronto projection example](examples/toronto-library-projection.json)
shows seven useful fields and their actual nullability. The corresponding
customer policy can expose equality filters on `physical_branch` and
`service_tier`, and sorting on `branch`. Original query syntax includes
`where_physical_branch=1&sort=branch&limit=50`.

## Portable merchant and original engines

The adapter composes these existing components:

| Component | Responsibility |
| --- | --- |
| `postgres/publisher/model.mjs` | Retained plans, extraction, candidates, review, version publication and recovery. |
| `dataset-handler.mjs` | Typed CSV admission, filters/ranges, ordering, cursors, limits and dataset snapshots. |
| SF61 importer | OpenAPI, explicit payment selections and original route compilation. |
| SF82 release manager | Retained releases, activation, rollback and seller process lifetime. |
| SF88 buyer preparation | Actual offer review and the exact edition/query buyer configuration. |

The complete export carries the raw provider payloads, source declaration,
reviewed plan/candidate, typed dataset, original runtime, route definitions and
manifest. Its handler imports only relative package files. Staging first copies
the whole checked package into the release store. Saved publications, merchant
packages and staged releases continue to work after the acquisition's original
directory is archived.

The [publisher and release guide](publisher/README.md) includes the direct
programmatic APIs, package contents, exact command paths, and customer handoff.

## Project API

`openCkanWorkbench()` opens the same project used by the interface and CLI.
Operations return `{ id, completion }`; await `completion` and read its state
and retained result. `status()` exposes current operation progress and project
items. IDs returned by the project identify editions, source selections,
publications, exports and buyer requests.

The loopback server offers the same actions under `/api/`, with the capability
as a bearer header. Read-only routes include status, catalogue search, edition,
comparison and publication preview. Mutation routes use JSON POST bodies.
Download routes resolve known project item IDs to complete exports or saved
configuration files. Provider credentials stay in the process environment.

## Source references and acquisition used in development

The real source is Toronto Public Library's
[Branch General Information dataset](https://open.toronto.ca/dataset/library-branch-general-information/).
The publisher's [open-data page](https://tpl.ca/about-the-library/open-data/)
lists this dataset on the City portal. Its
[Open Data Policy](https://tpl.ca/policies-and-terms-of-use/open-data/), effective
October 28, 2024, identifies the Open Government Licence of Toronto Public
Library for its portal data. The captured CKAN API license fields are retained
as returned; these publisher policy links provide the accompanying provenance.

The retained October 11, 2026 edition has 112 records over three original provider
pages (50, 50 and 12), exact reported total 112, and unchanged resource metadata
across capture. Its seven-field projection contains 100 rows with
`PhysicalBranch=1` and 12 with value 0. The capture manifest digest is
`cd035b97e42e71a41f2499298a528bcdbfb7288676b5a5511d8983336a84e3ca`.

API behavior follows the primary
[CKAN Action API guide](https://docs.ckan.org/en/2.11/api/) and
[CKAN 2.12 DataStore documentation](https://docs.ckan.org/en/2.12/maintaining/datastore.html).

