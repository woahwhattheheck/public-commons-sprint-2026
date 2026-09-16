# WorkSeal raw GitHub Actions evidence acquisition

This layer closes the gap between a retained GitHub Actions API capture and WorkSeal's existing normalized `workseal-github-actions-evidence/v1` verifier. It is deliberately **offline**: it reads retained bytes and never accepts a token, performs an API request, changes a GitHub resource, signs anything, or moves funds.

## Authority ceiling

A successful bundle means only:

- `RAW_CAPTURE_INTEGRITY`: the emitted receipt is content-addressed to the exact retained workflow-run JSON bytes, every retained jobs-page JSON byte sequence, the exact workflow file bytes, and the independent expectation pin; and
- `PROVIDER_AUTHENTICITY_NOT_ESTABLISHED`: caller-supplied bytes are not promoted into proof that GitHub actually served them.

The compiler cannot emit `GITHUB_AUTHENTIC` or any equivalent provider-authenticity claim. Authentic transport would require a separate trusted acquisition/attestation boundary.

## Inputs

`compileGitHubActionsAcquisition()` receives:

1. `runBytes`: exact retained workflow-run API response bytes.
2. `jobsPages`: `{page, rawBytes}` for every retained jobs API page.
3. `workflowBytes`: the exact `.github/workflows/*.yml|yaml` bytes pinned by the expectation.
4. `expected`: an independent `workseal-github-actions-acquisition-expectation/v1` object containing repository, workflow path and digest, head SHA, event, run id/attempt, complete required-job set, capture pagination metadata, and observation time.

The jobs capture is complete only when `pageCount == ceil(totalCount/perPage)`, every numbered page is present exactly once, every non-final page contains `perPage` jobs, the final page contains the exact remainder, every page agrees on `total_count`, job identities are unique, and the complete retained job set exactly equals the pinned `requiredJobs` set.

## Fail-closed properties

The raw JSON decoder rejects duplicate object keys before ordinary JavaScript parsing could overwrite them, rejects invalid UTF-8, unsafe JSON numbers, trailing tokens, excessive nesting, and oversized structures. Provider fields are type-checked and cross-bound across run/jobs data. Successful run/job/step conclusions, timestamps, repository, run id, attempt, head, event, workflow path, API locators, workflow digest, and complete job universe are all pinned before the existing WorkSeal verifier is invoked.

The acquisition manifest separately records SHA-256 digests for the run bytes, each jobs page, the workflow bytes, the normalized evidence packet, and the normalized expectation. Its receipt is the digest of that manifest. `verifyGitHubActionsAcquisitionBundle()` recompiles from the retained inputs, so semantic packet transplants or even whitespace-only raw-byte changes invalidate an old bundle.

## CLI

```bash
cd workseal
node src/github_evidence_acquire_cli.mjs \
  --run capture/run.json \
  --jobs capture/jobs-1.json \
  --jobs capture/jobs-2.json \
  --workflow ../.github/workflows/ci.yml \
  --expect capture/expected.json \
  --out capture/acquisition-bundle.json
```

Jobs pages are supplied in page-number order to the CLI. The output path is create-exclusive (`wx`, mode `0600`) so an existing receipt is not silently overwritten. Omit `--out` to write canonical JSON to stdout.

## Threat model

The compiler is designed to defeat malformed/ambiguous retained inputs, partial-pagination false greens, run/job identity mixing, workflow-source drift, stale-receipt reuse, and normalized-evidence transplantation. It **does not** defend against a host that fabricates a self-consistent entire capture plus matching expectation; the mechanical authority label makes that limitation explicit. A trusted transport or signed provider attestation can be layered above this receipt later without changing the raw-capture contract.
