# eLTSS Care Plans

A complete private workspace for receiving original FHIR care-plan sources,
reviewing all 56 published eLTSS dataset fields, correcting selected editions,
building native datasets, and delivering complete editable work.

The operator brings the original source files, resource graph, field selections,
assessment cells, authored decisions, correction history, dataset queries and
receiving records into one industrial interface. Its saved records and complete
files are also available through the installed CLI and private HTTP API.

## Open the operator

Use Node 22 or newer and Python 3.11 or newer. The Python modules use the standard
library and the maintained native source/workspace engines in this SDK. The
Node launcher selects the configured Python runtime and passes the existing
Node executable to the native dataset engine.

From this source directory:

```sh
node cli.mjs init --workspace /absolute/private/careplans
node cli.mjs source-add \
  --workspace /absolute/private/careplans \
  --input /absolute/original/Bundle.json \
  --label "Original care-plan source"
node cli.mjs serve --workspace /absolute/private/careplans --port 0
```

Open the private address printed by `serve`. The browser reads the original
workspace UUID, complete typed catalogue and saved work. An existing workspace
can also be opened from the maintained **Applications** library by choosing
**eLTSS Care Plans**. See [APPLICATIONS.md](APPLICATIONS.md) for installation,
original workspace selection, start, stop and reopen.

For a complete operational catalogue:

```sh
node cli.mjs --help
node cli.mjs catalogue --workspace /absolute/private/careplans
node cli.mjs profile --workspace /absolute/private/careplans
```

Each native command accepts `--expected-workspace-id` to bind the operation to
the selected saved UUID. `--credentials-file` selects an existing private FHIR
authentication-profile file. The launcher supports `SF30_ELTSS_PYTHON`, followed
by the existing FHIR/XML and primary-runtime Python selections.

## Published field source

The installed field profile is **eLTSS 2.0.0, STU2**, for **FHIR R4 4.0.1** and
**US Core 6.1.0**:

- [Published implementation guide](https://hl7.org/fhir/us/eltss/STU2/)
- [Original HL7 source at the selected commit](https://github.com/HL7/eLTSS/tree/2d9df1050811f551f6f6dfad180906869e989d20)
- [Installed complete field profile](field-profile.json)
- [Original source notices and licences](SOURCE_NOTICE.md)

All 56 dataset fields retain their original labels, definitions, source
cardinalities, FHIR mapping text, guidance and exact source references. The
profile also retains all 52 accessory requirements. Its selector drafts provide
a complete starting point for the selected care-plan source. Review decisions
and any conversion are saved in a separate complete field review.

## Work through a complete care-plan edition

### Receive and inspect the source

**Sources** accepts a complete original resource, Bundle, or source archive.
It retains the original bytes, member names, resource locations and version
identities. The resource index opens exact lexical JSON and points back to the
original member and Bundle entry. Download the complete input or any original
member from the same screen.

**Acquisition** provides three actual source routes:

| Route | Selected input and operation |
|---|---|
| Bundle URL | Read the exact selected URL and follow returned Bundle next links. |
| All eLTSS CarePlan | Use the selected server's observed CarePlan operation and explicit CarePlan IDs. |
| REST graph | Use observed server read/search/include capabilities, explicit search parameters and selected CarePlans. |

The connection retains the chosen FHIR base and authentication-profile name.
Discovery retains the actual CapabilityStatement returned by that server.
A saved acquisition keeps its request ID, original operation ID, HTTP originals,
returned next/status URLs, queue, retry time and completion state. **Run complete
acquisition**, **Pause after current response**, and **Resume original
operation** continue that saved operation.

### Select the CarePlans and review references

**Care plans** builds the reference view with the selected resolution policy.
Original `fullUrl` values, resource IDs, versions, contained-resource ownership
and selected FHIR base determine reference resolution. The graph shows resolved,
unresolved, external, logical and ambiguous references, together with actual
observed candidates.

Select the exact CarePlan record IDs and save an edition with its owner, actor
and note. The edition retains its source, graph policy and explicit decisions.
A source's later correction creates a successor edition with its predecessor
link intact.

### Review all 56 fields

**Field review** adopts the whole published profile and preserves one row per
field. Work through the field list to inspect source guidance and set
applicability, review status, absence policy and exact selectors.

Selectors use ordered graph steps. An outgoing step follows references at an
exact path; an incoming step follows original references from the selected
resource type; a value step selects original values. Array wildcards iterate
the actual arrays. Predicates compare the complete selected JSON value.
An explicit value-map conversion carries both the original and chosen value.

The form retains unsaved edits while switching between saved reviews. Saving
the complete review creates a retained successor with the original review ID.

### Assess, decide and correct

**Assessment** evaluates every selected CarePlan against every field in the
saved review. Each cell retains the original record, JSON pointer, lexical value,
review decision and reference findings. Results distinguish present, absent,
unresolved, not applicable and review pending.

Inspect the complete paginated cells or download their complete JSONL file.
Save explicit reference, field or receiving decisions with their original
source references.

**Corrections** previews authored JSON patches against exact original resource
records. The preview retains the original request and its SHA-256. Applying
that preview uses its exact saved identity and produces a complete successor
source, patch manifest and edition. Compare two editions to inspect the
retained resource identities, changed paths, and exact before/after values;
download the full changes file from the comparison.

### Build and query native datasets

**Datasets** prepares a mapping for the selected original resource type. Review
the complete mapping, preview actual projected rows, save the plan, and build
through the maintained SF30 dataset engine.

Queries use the saved native filter/range columns, declared fields, sort and
actual cursor. Complete dataset exports contain the original data, dataset
definition and eLTSS lineage. The merchant source family follows the original
endpoint/seed/traversal scope and mapping, or the original raw source identity,
across authored correction successors.

Merchant and buyer operations use the maintained SF30 version store, seller,
buyer and SF88 customer engines:

```sh
node cli.mjs merchant --help
node cli.mjs customer --help
```

Installed exports are `./seller/eltss-careplans` and
`./buyer/eltss-careplans`. Merchant functions are
`prepareEltssMerchant`, `readEltssMerchant`, `startEltssMerchant` and
`publishEltssMerchant`. Buyer functions are `reviewEltssBuyer` and
`prepareEltssBuyer`.

## Deliver complete editable work

**Delivery** freezes a selected edition, full review, assessment, decisions and
receiver into a complete handoff. Choose the CarePlan scope explicitly:

| Scope | Included graph selection |
|---|---|
| Forward | Selected CarePlans and their original outgoing reference context. |
| Connected | The selected CarePlans' connected original resource context. |
| Edition | All resources selected by the retained edition. |

A handoff includes complete original source members, a collection Bundle,
the selected graph, all 56 field rows and cells, decisions, a human-readable
entry point, and a complete file manifest. Receiving that packet reopens the
original selected work in the destination workspace.

Attach the actual downstream result and record its receiver, destination object,
original operation, time and any correction predecessor. The full result bytes
remain downloadable from its receiving record.

| Complete output | CLI |
|---|---|
| Care-plan handoff ZIP | `handoff-export --handoff-id ID --out /absolute/new-handoff.zip` |
| Native dataset directory | `dataset-export --build-id ID --out /absolute/new-dataset` |
| Original native customer packet | `packet-export --build-id ID --out /absolute/new-packet.zip` |
| All assessment cells | `assessment-file --assessment-id ID --out /absolute/new-cells.jsonl` |
| All edition changes | `edition-changes-file --comparison-id ID --out /absolute/new-changes.jsonl` |
| Whole editable workspace | `workspace-export --out /absolute/new-workspace.zip` |

Each command also takes the original `--workspace`. Use `handoff-receive`,
`packet-receive` or `workspace-receive` with `--input` to receive the corresponding
complete file. Whole-workspace restoration opens a fresh managed workspace and
retains the archive's original UUID, full native state and operation history.

## Run the published source through the complete product

[NATIVE_RECEIVING.md](NATIVE_RECEIVING.md) provides the original complete command
for the included 39-resource, two-CarePlan HL7 example. Its operation retains the
full graph, all 112 field cells, an authored correction, two native datasets,
the original seller/buyer flow, complete CarePlan receiving and editable restore.
[BROWSER_RECEIVING.md](BROWSER_RECEIVING.md) continues that same native result
through all nine operator screens, complete downloads and browser reopen.

## Source and integration

The HTTP API and installed CLI call the same native workspace methods.
[HTTP_API.md](HTTP_API.md) describes exact request and response bodies.
[catalogue.json](catalogue.json) supplies the full typed operator forms,
enumerations and current limits.

The workspace supports complete sources up to 256 MiB, individual resources up
to 16 MiB, 5,000 resources and 100 CarePlans. Bundle parsing is incremental and
reference indexes are disk based. Interactive pages use a 4 MiB byte budget and
return actual next offsets. Complete editable transfers support 512 MiB.

The original server uses a private loopback address and the maintained workspace
lease. Its local connection is `eltss/operator-connection.json`, schema
`stellar-forge.eltss-operator-connection.v1`. Startup is
`stellar-forge.eltss-startup.v1`. The installed Applications provider verifies the
selected workspace UUID and the authenticated native state before opening it.

The source contribution is
`distribution/contributions/eltss-careplans.json`. It installs the command,
merchant/buyer exports, native support files and Applications provider through
the existing cumulative distribution.
