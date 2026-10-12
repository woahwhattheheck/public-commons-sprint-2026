# 360Giving publisher workspace

Operate an original 360Giving publisher from source intake through named review,
native grant queries, comparison, complete customer handover and continued work
in an independently received workspace.

The product provides a saved publisher console, connected Python command line,
typed Node SDK, merchant tools and typed MCP client. Applications starts, stops
and reopens the same saved publisher. Original sources, grant values, review
decisions and request IDs remain attached to that workspace.

## Choose the entry point

| Work | Entry point |
| --- | --- |
| Install the complete product | Source selection `publisher-360giving` |
| Prepare an individual publisher edition and review | `starforge dataset-360giving` |
| Operate saved editions, native datasets and handoffs | **Applications → 360Giving publisher workspace** or `starforge dataset-360giving-workspace` |
| Connect an agent to the saved publisher | Package export `./seller/360giving/client` |
| Declare publisher aliases and complete file handles | `starforge merchant-providers init publisher-360giving` |
| Operate those aliases and receive complete files | Package export `./merchant/360giving` and `merchant_360giving_*` tools |
| Complete source, agent and independent receiving | `starforge dataset-360giving-agent-receiving` |

The [complete operating guide](OPERATING.md) follows the original build and
installation, Python preparation, source/review workflow, merchant configuration,
customer delivery, both cold reopens and continuation of interrupted work.

The selection contains 12 commands and 19 named package exports at this product
edition. It includes the original publisher application and source-owned merchant
provider, both typed clients, the complete native source and official schemas,
the original retained SCVO examples and their acquisition records, browser
resources and receiving programs. The original builder records the actual file
and byte counts for the selected source commit.

## Build and install

Choose a complete immutable source commit containing this product and retain
the build output directory:

```sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/source/repository.git --ref FULL_SOURCE_COMMIT \
  --selection publisher-360giving --out /absolute/publisher-release --offline
```

Use the returned archive path and SHA-256 with the maintained runtime installer.
The full agent workflow uses its MCP feature and operator host. The publisher's
existing Python 3.11+ environment supplies `jsonschema>=4.23,<5` and
`referencing>=0.35,<1`; its original Node executable operates the native dataset.

The operating guide gives the exact profile and installation commands. Installed
source, publisher workspaces, merchant configuration and customer downloads each
have their own retained directory. A following software edition can adopt the
same customer workspace through the original Applications review.

## Review original grants

Retain the complete publisher package, its matching registry record and the
original acquisition details. Intake creates a content-addressed edition.
The review shows official schema findings, registry metadata questions and every
original grant. An operator saves a named decision document; a candidate is
derived from that exact edition and decision.

Original and candidate builds remain separately selectable. Queries preserve
their build, filters and cursor. A saved comparison names both complete builds;
its full changes file is available alongside paged review. The original package
and the native exact-number representation preserve monetary values and source
number spelling.

## Deliver usable work

A complete handoff includes publisher source, registry and capture, original
edition, selected review and candidate, available native build packets and
comparisons, and the portable publisher implementation. The receiver imports
that archive into its saved publisher and can continue reviewing and building.

The merchant retains complete handoff ZIPs and comparison JSON Lines files.
Its download client verifies the manifest, resumes the original partial file,
and checks the full byte count and SHA-256. Retained deliveries remain available
when the source publisher is stopped.

The installed receiving command uses the existing Applications manager to
operate source and receiver sequentially. It exercises both clients, every
saved edition/review/candidate selection, all native query and comparison pages,
a resumed complete download after a merchant restart, and both saved publisher
cold reopens.

## Source guides

- [Publisher domain and exact source review](../../stellar/scf-starforge-20261009/sf30-seller-sdk/ndjson/360giving/README.md)
- [Saved publisher console and command line](../../stellar/scf-starforge-20261009/sf30-seller-sdk/ndjson/360giving/operator/README.md)
- [Applications and managed receiving](../../stellar/scf-starforge-20261009/distribution/runtime-workspace/360GIVING_APPLICATIONS.md)
- [Complete typed SDK, merchant and agent receiving](../../stellar-forge/mcp-merchant-operator/360GIVING.md)
- [Original source attribution](../../stellar/scf-starforge-20261009/sf30-seller-sdk/ndjson/360giving/ATTRIBUTION.md)
