# Install the standards workbench 0.2.0

Version 0.2.0 adds the complete bilingual consultation exchange to the existing local standards application: a frozen recipient packet, an offline reviewer, original returned comments, corrected-return history, explicit adoption of unchanged decisions, paired-language amendments, and replies tied to a frozen successor edition.

## Download and open the review example

Download [scc_standards_workbench-0.2.0-source.zip](./scc_standards_workbench-0.2.0-source.zip). Python 3.10 or newer is required.

```sh
python -m pip install ./scc_standards_workbench-0.2.0-source.zip
standards-workbench --workspace ./review-workspace --review-demo
```

Open the local address printed by the command, normally `http://127.0.0.1:8773`. Keep the command running while you work. Stop it with Ctrl+C and use the same workspace path to resume.

The source package includes the Python application, browser assets, public sources, full operating guides, and portable receiving controller. Its declared document dependencies are `python-docx==1.2.0` and `reportlab==4.4.9`; pip installs them with the application. It does not include a Python runtime. A controlled offline installation can supply the source and dependency wheels through pip's ordinary `--no-index --find-links` options.

## Complete the consultation exchange

The review example has a stable project identity. Its ten paired clauses and eight cases use the retained public Statistics Canada materials; the packet contains explicit English/French review instructions. Reopening it preserves the working project and actual subsequent decisions.

1. Download a frozen consultation packet and open its standalone reviewer page. Read either language or both, inspect original source rows, save local drafts, and export packet-bound JSON comments.
2. In **Consultation receiving**, preview and receive the original returned file. The workspace retains its bytes and source identity with the resulting comments.
3. For proposed wording, save an explicit amendment against the current bilingual clause. Freeze the successor edition before recording its final resolution.
4. Receive a corrected response with its actual predecessor. Adopt prior decisions only for explicitly selected unchanged entries. Changed entries retain their own work.
5. Export one respondent's reply or explicitly selected publication dispositions. Keep the complete private continuation for restoration.

Respondent contact fields, raw returned files and private receipt notes do not enter the selected reply or publication appendix. Exact duplicate response content preserves decisions. Repeated saved requests recover their original result; ambiguous server replies retain the same pending request in the editor.

Read the [consultation operating guide](../CONSULTATION.md), [complete workbench guide](../README.md), [API contract](../API.md), and [publication format](../PUBLICATION.md). The [portable receiving guide](../delivery/CONSULTATION-RECEIVING.md) and controller cover the complete original-return, correction, amendment, selected export and same-project restore journey. They require explicit local paths and keep private configuration outside published source.

## Execution status of this source release

The first feature cut completed Python imports and JavaScript syntax checks. Focused source review subsequently covered corrected-response lineage, immutable decision adoption and transaction/replay behavior. Its immutable adoption-ID overwrite was fixed before any batch record changes.

The final 0.2.0 corrected-return browser and installed-reopen journey is authored and included, and has **not yet executed**. Its controller records the actual source identity and resumes its own retained project after a documented source correction. Source publication does not represent that pending journey as completed. The earlier installed workbench continuation remains a separate original operation.

The unchanged 0.1.1 publisher has completed generation and visual inspection of all eighty-one Word/PDF pages. Its original source and outputs underpin this release's publication engine; no new publication result is inferred from the consultation source change.

## Upgrade and retain a project

Stop the running application and retain a complete private export before installing an upgrade. Restart with the same `--workspace` path. Earlier project histories and frozen records are preserved; the additional consultation collections are empty-compatible with earlier state.

```sh
standards-workbench --workspace ./review-workspace --list
standards-workbench --workspace ./review-workspace --export PROJECT_ID --output project-private.zip
standards-workbench --workspace ./restored-workspace --restore project-private.zip --list
```

Use the actual project ID printed by `--list`. A complete private archive includes the original files, full state, event history and retained request results. A recipient packet and selected reply are different projections; choose the export appropriate to the intended use.

## Exact source package

| File | Bytes | Git blob identity |
| --- | ---: | --- |
| `scc_standards_workbench-0.2.0-source.zip` | 1,336,289 | `1c32d10186228adf0f56097a44f265334bde20f5` |

The ZIP has forty-six members: forty-five selected source, guide, receiver and public-input files plus `SOURCE_RELEASE.json`. Each selected file's byte count and Git blob identity is retained in that manifest. Both original cp1252 CSVs match their original Git objects; the separately labeled lossless UTF-8 derivatives remain unchanged. The archive directory, stored-member CRC values, and every extracted member were compared to the selected source bytes during packaging. These identities detect byte differences; they are not an external signature or a substitute for the pending native receiving run.

## Previous immutable 0.1.1 release

The original [0.1.1 wheel](./scc_standards_workbench-0.1.1-py3-none-any.whl), [source archive](./scc_standards_workbench-0.1.1-source.zip), and [completed installation record](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/c58b2b78a0becfb2d7cc182a94d9423ac66b66d0/scc-standards-workbench-2026/releases/INSTALL.md) are preserved. On 12 October 2026 at 03:21 UTC, that wheel was built and freshly installed; its packaged source bytes and runtime versions matched. Its publisher's final eighty-one pages were visually reviewed, including independent French review.

| Previous file | Bytes | SHA-256 |
| --- | ---: | --- |
| `scc_standards_workbench-0.1.1-py3-none-any.whl` | 277,220 | `8dc0fb9ecca6dfe4cd2699953e5dfecbae1b123b4e6f02d12a6872bd60bf901e` |
| `scc_standards_workbench-0.1.1-source.zip` | 274,907 | `3e5e100c47e9cbb7dd8302485a8e34f5bc4e812e1f8040363a9457068a70d101` |
