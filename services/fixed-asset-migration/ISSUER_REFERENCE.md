# Issuer accounting reference in the original financial workspace

This is the complete source-selection and policy-field companion to the existing six-domain financial migration application. It uses the original supporting-file writer, complete workspace, transactional browser save, CLI lock, financial schedules and Exit package. engine.mjs and every existing financial domain remain unchanged.

## Operator journey

1. Open the current complete Fixed_Asset_Finance_Workspace.html. Retain the current project through Save working HTML before selecting a later application/source edition.
2. Under **Exit files**, receive the actual original accounts PDF, policy documents, native workbooks, field dictionaries and authorized exports. Each complete original retains filename, purpose, bytes and SHA-256. Import explicitly prepared CSV companions separately under Source files.
3. Under **Issuer reference**, choose the complete source-carrier JSON or the full saved Canvas text (.md/.txt). The current EA source contains fifteen complete leaves. The browser decodes a raw-DEFLATE Canvas locally; every leaf must match its declared bytes and SHA-256. The decoded original carrier is retained in the original writer. If a Canvas was supplied, its exact original text is retained separately.
4. Select the intended retained issuer edition. Select the complete original PDF/workbooks that support this scope, name the source owner or reviewer, and explain the actual period, source edition and intended population. **Save selected reference and scope** records a complete new selection; it does not create tenant assets or automatically apply an accounting policy.
5. Import and explicitly map actual source and returned-target CSVs through the existing six-domain controls. Every mapping names a role, domain, original source ID, actual header occurrence/index and explicit financial amount multiplier. Preserve unsupported original columns and dictionaries.
6. In **Issuer reference → Policy and field choices**, open each original policy. Read its source section, printed pages, effective period, original values and required owner decision. Record the actual decision and reviewer. Review the current mapping context, then choose each source and target disposition: bind the exact current mapped column, leave pending, or explicitly mark not used with a reason.
7. For each additional original accounting field, select its actual retained complete supporting document and an exact sheet/header occurrence/record/page locator, or record why it is not used. Unavailable information remains pending. The complete unfinished decision is available as JSON and inside Save working HTML.
8. Confirm and save the attributed policy decision. It retains the selected issuer file and SHA, original source/target mapping snapshot, corrections, additional originals, reviewer, reason and time. A subsequent mapping/source correction makes the old decision **STALE_MAPPING**; it remains in full history. Reopen the current source context and explicitly review the replacement choices before saving another edition.
9. Finish the existing **Financial basis** review last. Its unchanged engine binds all supporting-file identities, so receiving an annex, selection or policy review makes an earlier financial declaration stale. Actual cutover dates, complete event/population declarations, source-defined measures, carrying equations and signs remain explicit original finance operations.
10. Reconcile, review source/target differences and the full financial schedules, then prepare **Handover**. The full ZIP now includes the original financial output, every complete issuer leaf, a complete issuer assessment/readable report and a working standalone application. Reopen that application or workspace JSON independently and continue the same original histories.

A policy may be resolved as not applicable only with a recorded scope decision and every required field/evidence disposition. Pending fields remain pending. The issuer assessment has its own selected/ready status; it does not replace the native financial ready result or a source owner's business acceptance.

## Original source semantics

The current EA annex contains 54 printed rows, 142 separately normalized cells, 52 arithmetic checks and 20 policy selections. Three arithmetic checks retain differences. Printed commas, parentheses, dashes, date labels and section names remain in the original token JSON/CSV. Normalized integers never replace those files. A dash has null numeric value and a separate zero interpretation solely for displayed-table arithmetic.

The source tables are aggregate public class references. They provide no actual private company, book, asset, journal or event IDs. Annual movement rows without a transaction date stay undated. Currency, actual cutover, amount scale, source measures, control population and carrying equations must be selected for the actual authorized exports.

The published policy edition includes controlled estates/meals and maintained meals accommodation ownership, the distinct VG/GMI estate exclusion, and ordinary peppercorn versus IFRS16 transition accounting. Those facts remain linked to their exact original source policy. The consumer records the owner's application to the selected scope without deriving accounting treatment from labels.

The full arithmetic includes the three original £000 differences and the report's rounding context; this does not assign a cause to any individual difference. Lease asset and liability measures stay separate.

## Complete record and recovery contract

The companion adds no workspace arrays or new accounting controller. Its complete JSON records are ordinary original supporting files with these purpose-bound schemas:

- tjlabs.complete-source-carrier.v1: one full original issuer package, including every complete member and declared identity.
- tjlabs.fixed-asset-issuer-selection.v1: selected original package ID/SHA, edition/revision, supporting-original identities, attributed scope and time.
- tjlabs.fixed-asset-issuer-review.v1: exact original selection, policy, all source/target field choices, additional original locators, attributed decision, full selected-mapping/correction snapshot and its digest.

Every call uses the existing operationId/expectedRevision. Replaying a completed review resolves its original full supporting record before consulting later mappings, validates that the explicit original selection/review/time is unchanged, and returns the original engine receipt. Later work remains. Changed content under an existing operation ID fails.

The browser prepares a complete new workspace before the existing single IndexedDB compare-and-swap save. Its awaited action disables the application. Source plus original Canvas transport are saved together, and submitted policy drafts are cleared only with that same workspace save. Competing local editions retain both complete branches through the existing recovery controls. Save working HTML preserves raw unfinished issuer drafts.

The source package and each review use the existing 32 MiB per-supporting-file, 128-supporting-file and 128 MiB complete-workspace limits. A complete Exit remains create-only. Repeated policy editions consume original supporting-file capacity; preserve full histories and explicitly scope another workspace when the actual ceiling is reached.

## Node CLI

Use existing Node, absolute paths and a private retained working directory. No package installation is required. The CLI uses node:zlib for the original Canvas and the same pure issuer module for validation, choices, assessment and full Exit.

~~~sh
node cli.mjs issuer-import --workspace /absolute/original/workspace.json --request /absolute/requests/issuer-import.json --file /absolute/originals/complete-issuer-canvas.md
node cli.mjs issuer-select --workspace /absolute/original/workspace.json --request /absolute/requests/issuer-selection.json
node cli.mjs issuer-review --workspace /absolute/original/workspace.json --request /absolute/requests/policy-review.json
node cli.mjs issuer-inspect --workspace /absolute/original/workspace.json
node cli.mjs handover --workspace /absolute/original/workspace.json --out /absolute/outputs/exit-revision-N
node cli.mjs receive --workspace /absolute/independent/workspace.json --input /absolute/outputs/exit-revision-N/workspace.json
~~~

Each saved request needs operationId, expectedRevision and an actual at timestamp. Import also accepts filename for the decoded source. A Canvas import retains the exact transport in a second original supporting operation, derived from the first operation ID, and publishes the complete resulting workspace atomically.

Selection request adds packageFileId, originalFileIds, actor and note. Obtain exact retained IDs from inspect; do not construct them from a filename.

Review request adds selectionFileId and review:
~~~json
{
  "policyId": "POL-01",
  "status": "pending",
  "decision": "Actual source-owner decision and reason",
  "actor": "Actual reviewer",
  "bindings": [
    {
      "role": "source",
      "field": "assets.company_id",
      "state": "pending",
      "reason": "",
      "binding": null
    }
  ],
  "additional": [
    {
      "name": "capitalisation_basis",
      "state": "pending",
      "fileId": null,
      "locator": "",
      "reason": ""
    }
  ],
  "supportingFileIds": []
}
~~~
This abbreviated shape illustrates one row; a valid request must include every source/target field and every additional field defined by its exact original policy. Use createIssuerAnnex(engine,hash).draft(ws,selectionId,policyId) or the actual browser draft download for the complete initial shape. bindingOptions(ws,field,role) returns the exact actual selected mapping record to bind. The CLI does not guess policy dispositions.

## Full Exit

The original engine's workspace.json, reconciliation.json, review history, complete source/target originals, corrected/canonical CSVs and binary supporting files remain intact. The companion adds:

- issuer/assessment.json with current status and all original selection/review editions;
- issuer/Issuer_Source_and_Policy_Report.html with original source context, every policy/field decision, all printed rows, separate normalized cells and every arithmetic check;
- issuer/originals/<supporting-package-id>/<original filename> for every complete received member;
- Fixed_Asset_Finance_Workspace.html with full reusable source and reopening state;
- the browser's Complete_Financial_Report.html;
- the complete manifest with every actual output identity.

The browser's independent working HTML includes raw unfinished drafts. The engine workspace JSON contains all saved records and operations. Original PDF/workbook bytes are ordinary supporting members and require their native viewer for actual inspection.

## Original native receiving and actual producer use

The maintained runFinanceReceiving callback now accepts issuerSourcePath in addition to page, context, outputDirectory and applicationPath. Supply the exact retained original source carrier (JSON or complete saved Canvas). Preserve the original programme and explicitly select a new application/source edition in its retained version directory; the shared receiving helper correctly rejects silently substituting a changed application into an old frozen run.

The existing authored six-domain course continues through its same original controls. The issuer extension uses actual UI controls to retain the source, select supporting originals, record all twenty policies, keep production choices pending, exercise one explicitly not-applicable authored example, inspect all original tables/arithmetic, then continue the original correction, financial re-review, complete Exit and independent continuation. Every received original issuer leaf is compared byte-for-byte after Exit; a later original correction preserves and stales its prior policy decisions. This is an authored software operating course, not a claim about a client's private asset data.

An already equipped cloud browser must run that exact complete application and open the issuer reader, original accounts PDF pages, full reports, JSON/working HTML and usable ZIP contents. Return actual desktop1440 and narrow390 screenshots for the producing peers to LOOK at. The browser callback opens both readable issuer reports and captures meaningful sections; the actual original PDF is opened in its normal viewer at printed136 and138–140, plus the selected policy pages. The producer operates important states and downloads/reopens the delivered files, repairs concrete visible defects and records the exact inspected edition.

Bryce's local Codex in-app browser is exclusively his from16:00UTC on13October2026 until his explicit meeting-end release. Use an existing isolated cloud receiver during that interval. Keep the original EA programme and source owner; create no second controller.

All attachments require actual open/look/use, including relevant PDF pages and usable archive/project contents. A schema, passing test, HTTP response, screenshot capture without viewing, or another peer's approval does not establish rendered product quality. Keep industrial plain layout. If media is produced, use available natural high-quality generative voice/media and personally watch/listen to the final export. Preserve every existing exact-message approval requirement for warm correspondence.

The existing four FMIS draft attachments stay on their original frozen edition until the complete new application and attachments are deliberately selected by the existing publisher following actual use of the changed product.
