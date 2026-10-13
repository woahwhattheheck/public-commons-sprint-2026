# Original foundation source and complete receiving example

The source was acquired on October 12, 2026 through native source URL attachment
imports. The exact LEI response contains the foundation. The complete legal-name
query contains the foundation and its Singapore branch: two records, one terminal
page. The API source edition is 2026-10-12T08:00:00Z.

The complete original source strings, source URL, observation interval, acquisition
method and original uploaded receipt are in import-exact.json and import-name.json.
Their original HTTP status and headers remain null because the acquisition service
returns its own uploaded receipt. Each source body is checked against its retained
SHA-256 and complete byte count.

| Original response | Bytes | SHA-256 |
| --- | ---: | --- |
| Exact foundation LEI | 3194 | e899f2cc0c931eeccf2b5eddbcfb73f0bba5e89b7a0907b2e14c017b2c1ecfef |
| Complete name query | 6150 | 6c92c2bf372969992d1bea2188f476ace62d778d3c07b63a3940840a02348e36 |

The report and company files here were rendered from these actual records using
the maintained shared report model. They contain both complete resources and the
authored source-research decisions. The installed project receives the same inputs
and writes its own native operation and workspace identities.

## Source meaning

The foundation is LEI 506700GE1G29325QX363. Its original direct-parent and
ultimate-parent links select reporting-exception resources.

The Singapore branch is LEI 875500ELOZEL05BVXV37. Its original jurisdiction is CH,
legal address country SG, and headquarters country CH. Its head-office links select
a LEI record and a relationship record. All three country meanings and every
original relationship reference remain distinct in the company output.

## Continue in the installed application

Set these two paths to your initialized private project and the exact selected
source directory. Keep the original source request IDs when resuming.

~~~sh
starforge gleif import-source --workspace /absolute/private/company-research \
  --id foundation-exact-20261012 --file /absolute/observed-source/import-exact.json

starforge gleif import-source --workspace /absolute/private/company-research \
  --id foundation-name-20261012 --file /absolute/observed-source/import-name.json

starforge gleif run --workspace /absolute/private/company-research \
  --request /absolute/observed-source/review-foundation.json
starforge gleif run --workspace /absolute/private/company-research \
  --request /absolute/observed-source/review-branch.json
starforge gleif run --workspace /absolute/private/company-research \
  --request /absolute/observed-source/prepare-report.json
starforge gleif run --workspace /absolute/private/company-research \
  --request /absolute/observed-source/prepare-dataset.json

starforge gleif dataset-query --workspace /absolute/private/company-research \
  --id foundation-dataset-20261012 --query 'limit=50'

starforge gleif export --workspace /absolute/private/company-research \
  --out /absolute/private/foundation-project.json
starforge gleif receive --workspace /absolute/private/received-foundation-research \
  --file /absolute/private/foundation-project.json
starforge gleif serve --workspace /absolute/private/received-foundation-research
~~~

If the project is already open in Applications, use its original private
--connection file for the project actions. A reviewed company that already exists
continues its existing review ID and current version.

Open both company records in the received project, inspect the original page,
download the full report and query the native dataset. The original project
keeps the two source captures, each source-specific research review, the prepared
customer files and the full operation history.
