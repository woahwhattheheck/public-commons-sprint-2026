# ERDDAP Provider Intake

ERDDAP Provider Intake prepares a complete station-data handoff from a retained ERDDAP tabledap capture. It gives the provider and receiving engineer one editable review, a two-header-row observation CSV, station definitions, a variable mapping and the original source responses.

The application uses the existing ERDDAP acquisition and source engine. Its browser, command line and MCP tools share the same reviewed profile and retained workspace.

## What the recipient receives

| File | Purpose |
| --- | --- |
| README.md | Dataset, provider, contacts, licensing, processing and review findings. |
| station-list.csv | Exact source station IDs, names, coordinates, depth convention, platform, expected coverage and deployment notes. |
| variable-mapping.csv | Every selected source column, output alias, source type and units, standard name, description and quality associations. |
| data/observations.csv | One observation per record, timestamp first, names in row one and units in row two. |
| data/missing-values.json | One-based observation row ordinals distinguishing source nulls from empty strings. |
| time-context.json | The reviewed representation, source attributes, original timezone/calendar disclosure and observed UTC range. |
| quality-control.json | Existing flag definitions, associated observations, disclosed upstream checks and any requested future quality work. |
| provider-review.json | The complete editable review profile and its immutable revision. |
| original/capture.erddap.zip | The original six-member capture, including both provider data responses and the source metadata. |
| manifest.json | The exact identities of the delivered members. |

A review bundle can be exported while metadata decisions remain open. It includes the complete source and the reported questions. The observation CSV is included when its source columns and time representation can be rendered accurately. A ready bundle requires the intake review to pass its reported checks.

## Operator workflow

1. Acquire or import the complete tabledap selection in the existing ERDDAP workspace.
2. Open Provider handoff for that retained source. The draft takes names, declared units and available metadata directly from that capture. Every scientific or operational decision remains visible for review.
3. Review every variable. Keep each source column exactly once, choose distinct output names, and assign its role. The selected timestamp output is named time. Physical units are read from the response; the handoff does not convert them.
4. Select the original station identifier column, or explicitly define one fixed station for a capture without a station column. Review station names, position, depth convention, platform and expected coverage. Use ongoing as the expected end when that is the documented context. A fixed position that differs from observations is reported.
5. Select the documented time representation. ISO timestamps must carry an explicit offset. Numeric time must be declared seconds since the Unix epoch. UTC conversion preserves the fractional value and does not use binary floating point. Unknown source offsets, unsupported calendars and unsupported numeric time units are reported for review.
6. Document licensing, attribution, contacts, access and refresh context. State what the original provider supplies and identify remaining unknown context plainly.
7. Document upstream quality checks and map existing flags to the observations they describe. A request for QARTOD or another evaluation is carried into the handoff as requested work. It does not create new flag values.
8. Preview the findings, then save the complete revision. Saving a revision includes its expected preceding revision, so concurrent edits are surfaced for reconciliation.
9. Export the working review or the completed intake bundle. Existing identical exports are reused. A transfer interrupted after the ZIP was written resumes from that same ZIP.
10. Open the bundle in a receiving workspace. The receiving function checks the delivered files against the original capture and reviewed transformation, retains the complete ZIP and exposes its profile, source metadata, findings and exact re-download.

## Source values and scientific context

The original JSON response is the canonical data edition declared by the ERDDAP source format. Its numeric tokens remain text until their reviewed use; decimal values do not pass through a binary floating-point conversion. The original CSV remains in the retained capture.

When the provider's JSON and CSV editions differ, the default profile reports that difference. The reviewer can inspect both originals and explicitly select canonical-json. This choice is recorded in the profile and exported review.

The handoff changes column order and explicitly selected column names. It renders the selected time column in UTC under the reviewed representation. It preserves station IDs, observation values, existing quality flags and every selected row. Blank output cells are accompanied by the missing-values sidecar so a source null can be distinguished from an empty string.

No scale factor, offset, calibration, interpolation, row filtering or new scientific quality evaluation is applied by the exporter. Units and source attributes remain available in both the mapping and original capture.

For quality columns, the reviewer records the associated source variables, the original definitions and the declared convention. A QARTOD-labelled intake column must use its associated observation's output name followed by _qc, and its existing numeric or character values must use the declared 1, 2, 3, 4 or 9 codes. Other provider flag conventions remain provider conventions.

## Review profile

The profile schema is stellar-forge.erddap-provider-handoff.v1. Its sourceId identifies the complete original capture. The main sections are:

| Section | Review content |
| --- | --- |
| title, organization, reviewedBy | The dataset handoff and the person preparing its review. |
| dataEdition | require-equivalent by default, or explicit canonical-json after reviewing differing source editions. |
| contacts | Named technical and scientific contacts, email, organization and explanatory notes. |
| license | Original licensing/access text, attribution and its review decision. |
| access | Original access URL, refresh, processing and supporting documentation. |
| time | Exact source column, representation, calendar, timezone, daylight-saving context and notes. |
| stationColumn, stations | Original station IDs or one explicitly defined station, with position and deployment context. |
| variables | Every source field, its output alias and role, descriptive metadata and quality associations. |
| quality | Upstream processing/checks, requested future work and explanatory notes. |
| notes | Additional receiving context. |

An unchanged source and profile with the same preceding revision produce the same review identity. A retry of an already saved revision returns that revision. A changed current head returns a conflict, allowing the operator to compare both versions before saving a reconciled edit.

The source parser continues to own original provider response validation. The provider handoff is an additional workflow over that source engine.

## Command line

The installed erddap-provider-handoff entrypoint and the provider-handoff subcommand of the existing ERDDAP CLI invoke provider_handoff_cli.py. All interfaces use the same Python source and workspace classes.

The following commands run from the seller SDK directory. Substitute the actual capture path and source/revision identities returned by the preceding command.

### Review a capture directly

    python3 erddap/provider_handoff_cli.py source-draft capture.erddap.zip --output provider-profile.json
    python3 erddap/provider_handoff_cli.py source-review capture.erddap.zip provider-profile.json --output intake-review.json
    python3 erddap/provider_handoff_cli.py source-export capture.erddap.zip provider-profile.json --mode review --output provider-review.zip
    python3 erddap/provider_handoff_cli.py receive provider-review.zip

Edit the complete generated provider-profile.json before reviewing it. source-review returns the normalized profile and the complete findings. Add --require-ready to make a remaining intake error return exit status 3. Parsing, source, file and command errors return status 2.

A direct source-export creates an immutable revision from its source, normalized profile and optional --parent identity. It does not add that revision to a retained workspace. Use the workspace commands when a continuing review history is required.

### Retain revisions in an existing ERDDAP workspace

First add the original capture through the ERDDAP source import workflow and retain its returned source identity. The provider commands use that exact workspace and source.

    python3 erddap/provider_handoff_cli.py --workspace ./intake-workspace draft SOURCE_SHA256 --output provider-profile.json
    python3 erddap/provider_handoff_cli.py --workspace ./intake-workspace preview SOURCE_SHA256 provider-profile.json
    python3 erddap/provider_handoff_cli.py --workspace ./intake-workspace save SOURCE_SHA256 provider-profile.json
    python3 erddap/provider_handoff_cli.py --workspace ./intake-workspace history SOURCE_SHA256
    python3 erddap/provider_handoff_cli.py --workspace ./intake-workspace show REVISION_SHA256
    python3 erddap/provider_handoff_cli.py --workspace ./intake-workspace export REVISION_SHA256 --mode review --output provider-review.zip

For the first saved revision, omit --expected-head. For an update, supply --expected-head CURRENT_REVISION_SHA256. Repeating the same save with the same parent returns the original saved revision. A conflicting current revision must be reconciled explicitly; the CLI does not overwrite it.

history returns nextOffset when another page exists. Continue with --offset NEXT_OFFSET; --limit accepts 1 through 250.

When the profile is complete, select --mode ready to produce the completed intake bundle. Exporting a working review remains available for resolving the reported questions.

### Receive and inspect a delivered bundle

    python3 erddap/provider_handoff_cli.py --workspace ./receiving-workspace init
    python3 erddap/provider_handoff_cli.py --workspace ./receiving-workspace receive provider-review.zip
    python3 erddap/provider_handoff_cli.py --workspace ./receiving-workspace state
    python3 erddap/provider_handoff_cli.py --workspace ./receiving-workspace received BUNDLE_SHA256
    python3 erddap/provider_handoff_cli.py --workspace ./receiving-workspace received-export BUNDLE_SHA256 --output received-provider-review.zip

The receiving identity is the SHA-256 of the complete incoming ZIP. The received command returns the retained receipt, complete profile, findings and source summary. received-export copies the retained original ZIP. It does not reconstruct a different archive.

Output commands reuse an existing file only when its bytes already match. Use --replace to explicitly replace a different output file. A receiving-only import retains its complete profile and source inside the received bundle; it does not silently create a new editable source or review head.

## Local HTTP integration

The existing ERDDAP operator remains a private local process bound to 127.0.0.1. Open the process's launch URL to use its browser. Programmatic requests use the original process bearer credential and host/origin checks. The startup response identifies the process and retained workspace.

| Method and path | Request or result |
| --- | --- |
| GET /api/handoffs | Current review heads, received bundles and intake limits. |
| GET /api/handoffs/draft?source=SOURCE | Complete existing or initial profile, findings, source summary and history. |
| GET /api/handoffs/history?source=SOURCE&offset=0&limit=100 | Paginated immutable review history. |
| POST /api/handoffs/previews | JSON with source and profile; returns normalized profile and findings. |
| POST /api/handoffs/reviews | JSON with source, profile and expectedHead; returns the saved immutable revision. |
| GET /api/handoffs/reviews/REVISION | Complete saved revision. |
| POST /api/handoffs/exports | JSON with revision and mode; returns the retained export identity and findings. |
| GET /api/handoffs/exports/REVISION/MODE | Download the corresponding exact review or ready ZIP. |
| POST /api/handoffs/receive | Complete application/zip body; returns the retained receiving receipt. |
| GET /api/handoffs/received/BUNDLE | Received receipt, profile, findings and source summary. |
| GET /api/handoffs/received/BUNDLE/bundle | Download the exact incoming ZIP again. |

The first save uses expectedHead: null. Updated saves name the revision being replaced. A current-head conflict returns HTTP 409 with currentRevision, including null when appropriate. The operator can then compare the newer saved revision with the local edit and prepare a reconciled profile.

Profiles are limited to 2 MiB of serialized JSON. The HTTP JSON wrapper allows a small amount of additional envelope space. ZIP uploads retain the source engine's size budget and the provider bundle's expanded-size checks. The retained store permits at most 10,000 station definitions per profile.

The browser keeps unfinished large drafts in its native IndexedDB under the existing workspace identity. A process restart refreshes its private connection while retaining the same workspace review history. A newer local draft remains available when the server also has a more recent saved revision.

## MCP and JavaScript integration

The existing ERDDAP MCP server includes the provider handoff tools in its original catalog. Its client keeps the existing configured connection, host-pinned input files and download policy. The provider JavaScript entrypoint exports ErddapProviderHandoffClient over that client.

Provider operations cover current state, draft, preview, save, history, review retrieval, export, receiving, received detail and exact file transfer. A save must explicitly select null or an existing revision as its expected parent. The file client checks the advertised export identity and also checks an existing local destination before reusing it.

Use the complete installed SDK or distribution archive so its original ERDDAP and XML dependencies are present. The provider adapter is part of that application and uses its acquisition, parsing, workspace locking and source storage.

## Receiving and recovery behavior

A provider bundle includes the exact original capture and normalized review profile. Receiving validates the source through the original ERDDAP parser, recalculates the reviewed outputs and compares the complete expected file set with the delivered manifest. Missing, added, changed or duplicate ZIP members produce an explicit intake error.

A review revision contains its source, parent, normalized profile and findings. The revision identity is independent of its storage timestamp. The SQLite review record, current head, retained export and receiving records remain in the original workspace. Existing exports are matched to their recorded identity before reuse.

This supports ordinary interrupted operations:

- Reopen the workspace and retry the same profile and parent after an uncertain save.
- Retrieve the already saved revision from history when a save completed before the response was received.
- Retry the same export revision and mode after an interrupted download.
- Receive the same exact ZIP again; the store retains and returns the same incoming identity.
- Inspect and re-download the complete received ZIP after reopening the receiving workspace.

The original capture is preserved throughout. Correcting a mapping or disclosure creates a successor review. It does not rewrite an earlier delivered review.

## Scope of a completed intake review

A ready result means that this selected station-data handoff passes the documented intake checks. Those checks cover complete column mapping, output names, explicit time representation, station definitions and coverage, metadata review, contacts, licensing and disclosed quality conventions. Fixed station coordinates and declared coverage are compared with the actual selected observations.

Existing numeric and character QARTOD flag values are preserved. Scientific checks, calibrations and new flag generation are separate operations with their own source rules and decisions. Requested quality work is carried into the bundle so the receiving engineer can implement it against the appropriate source and procedure.

The standalone scientific source retains its own data license. The application source retains its included software license. Provider-specific deployment configuration, private feed credentials and responsibility for ongoing source updates are selected during commissioning.

## References

These primary sources informed the intake format and reviewed context. The executable behavior is defined by the included provider_handoff.py, provider_handoff_workspace.py and original erddap_source.py.

- [Axiom sensor-data submission guidance](https://www.axiomdatascience.com/best-practices/SubmitDataSensors.html): station and dataset handoff structure, names/units rows, time context, contacts and existing quality disclosures.
- [NOAA IOOS QARTOD data-flags manual, version 1.1](https://cdn.ioos.noaa.gov/media/2017/12/QARTOD-Data-Flags-Manual_Final_version1.1.pdf), tables 1–2 and implementation section: flag meanings and their retained representations.
- [CF Metadata Conventions 1.12](https://cfconventions.org/Data/cf-conventions/cf-conventions-1.12/cf-conventions.html), time-coordinate/calendar sections: source calendar and time-unit interpretation.
