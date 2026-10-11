# Bologna urban-logistics assessment workspace

This offline operator turns the City of Bologna loading-bay snapshot into a
reviewable four-street baseline for NetZeroCities RfP `SGA3-MCCC-029`. It keeps
source observations, analyst decisions, qualitative scenarios, survey responses
and report publications in one revisioned private workspace.

It does **not** replace the Italian planning prime, calculate tariffs, operate a
logistics platform or infer current conditions from the June 2022 dataset. The
prime retains municipal engagement, on-site validation, professional judgments,
eligibility/disclosure review and the final bid.

## Start with the retained original source

Python 3.11+ is sufficient; there are no third-party packages.

```sh
python3 workspace/server.py init \
  --source /absolute/path/loading-bays-2022.original.json.gz \
  --source-receipt /absolute/path/loading-bays.source.json \
  --state /private/bologna-assessment

python3 workspace/server.py serve \
  --state /private/bologna-assessment --port 0
```

Open the printed loopback URL. The initial workspace contains the original 264
records, all 21 priority-street points, the reported 83 spaces on those streets,
three explicitly hypothetical scenario frames and an unresolved review item for
the dated `VIA LAME 37b` / `Via delle Lame 37/c` observations.

## Complete one review and publication

The browser supports:

- source and four-street baseline inspection;
- explicit relationship decisions for dated observations;
- assumptions with provenance and reviewer ownership;
- qualitative scenario criteria without invented numeric outcomes;
- consent-marked, non-identifying Italian/English survey response intake;
- immutable bilingual report publications and downloads.

Every mutation supplies the currently displayed revision. A stale browser is
rejected and must reload before applying a decision. Publications freeze the
current source digest, decisions, assumptions, scenarios and aggregate survey
summary.

Generate portable outputs or a recoverable backup:

```sh
python3 workspace/server.py export \
  --state /private/bologna-assessment --out /private/bologna-delivery

python3 workspace/server.py backup \
  --state /private/bologna-assessment --out /private/bologna-backup.zip

python3 workspace/server.py restore \
  --archive /private/bologna-backup.zip --state /private/bologna-restored
```

Exports include the four-street CSV, GeoJSON, bilingual HTML report, complete
report JSON and a manifest with exact byte counts and SHA-256 digests. Restore is
create-only and verifies the archived state digest before publishing it.

## Source contract

The municipal dataset is CC BY 4.0 and remains an external input. The original
RfP and URBANE deliverables remain linked evidence rather than republished files.
See [SOURCE_PROVENANCE.md](SOURCE_PROVENANCE.md) for dates, scope and the required
interpretation boundary.

