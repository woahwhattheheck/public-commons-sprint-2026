# WQX concentrations through the merchant MCP operator

Use the existing WQX workspace connection to standardize a complete receiving cohort and its reported limits. The operator calls the same concentration workflow used by the private browser and native review-sheet CLI. It returns complete retained documents and reports that the existing file client can download, resume, preview, save and receive in another project.

The provider exposes 37 WQX operations, including three concentration methods. The original project, capture, scientific review, receiving plan, decision review, file store and managed Applications lifecycle remain the source of each operation.

Start with the existing setup in [WQX_WORKSPACE.md](WQX_WORKSPACE.md) and the connection and transfer commands in [WQX_WORKSPACE_CLIENT.md](WQX_WORKSPACE_CLIENT.md). A workspace alias selects one configured managed project. A caller supplies the exact saved plan and decision document; filesystem paths remain with the operator or local client.

## Complete workflow

1. Read the saved source plan and its concentration catalogue. Keep its full plan SHA-256.
2. Create or reopen a decision document bound to that plan. Upload a large document once through the original input API.
3. Prepare each selected source group with the preceding response's documentRef. A proposal carries every paired result/unit choice, every independently converted reported limit and every associated native limit field.
4. Inspect the complete JSON and CSV reports. Export the full editable table when a receiving choice needs adjustment.
5. Preview the complete document under a new receiving plan ID. Save the same document with that exact preview hash and a stable decision-review ID.
6. Export the complete receiving bundle, receive it into the other configured project, and reopen its saved JSON/CSV concentration report.

Blank measured values and unspecified result units stay blank. A supported reported limit can be standardized independently of those blanks. Qualifiers, detection conditions, source result IDs, source pointers and all original limit records remain attached. The workflow never inserts a detection threshold as a measured observation.

The concentration profile supports exact mass-per-volume factors. It does not turn pH, optical turbidity, conductivity, recovery percentage or another dimension into a concentration. Use the source catalogue's support flags and preserve an explicit Keep decision for a receiver-specific exception. Each reported limit uses its own original unit; a row can carry more than one method-specific limit.

## Three native methods

| MCP tool | Typed client method | Input and complete result |
| --- | --- | --- |
| merchant_wqx_concentration_units | concentrationUnits | workspace, planId and optional expectedPlanSha256. Inline group counts plus the full native catalogue in file. |
| merchant_wqx_concentration_prepare | concentrationPrepare | One document or documentRef, one exact source selection, targetUnit and reason. Full proposal in file; a prepared document in documentFile/documentRef; complete CSV in reportCsvFile. |
| merchant_wqx_concentration_report | concentrationReport | workspace, saved reviewId and optional format json or csv. Reconstructs and validates the saved original choices against the actual native receiving plan. |

A source selection is exactly one of:

- fromUnit: the exact source label from the immutable plan's catalogue, such as mg/L.
- resultIds: a nonempty array of distinct original wqx-record identifiers.
- reportedLimitsOnly: true: all supported original blank-result records with reported limits.

The first two choices are intentionally explicit. A source group describes the immutable source cohort; the native workflow applies the new receiving unit to the selected document's current representation. All other decisions in that document survive. The complete catalogue file includes every group result ID, every supported limit-only ID and the preserved unsupported records.

For prepare, expectedPlanSha256 must agree with document.sourcePlanSha256 when supplied. A successful PREPARED proposal includes a complete normalized document. REVIEW_REQUIRED retains the whole proposed report and CSV with documentRef set to null. Resolve those exact reported rows through the original decision workflow before preparing a replacement.

## CLI example

The following commands use an already running original HTTP MCP endpoint. WQX_MCP_URL and the existing MCP_ACCESS_TOKEN environment variable identify that connection. Set WQX_CLIENT to this repository's wqx-workspace-cli.mjs and WQX_WORKSPACE to the configured alias.

    wqx() {
      node "$WQX_CLIENT" "$@" --url "$WQX_MCP_URL" \
        --token-env MCP_ACCESS_TOKEN --workspace "$WQX_WORKSPACE"
    }

Use a private working directory and retain each original result file. --save-json reserves a new private file before dispatch. If an operation is interrupted, inspect that same file and the native saved state before selecting its continuation.

    wqx concentration-units --plan-id "$SOURCE_PLAN_ID" \
      --plan-sha "$SOURCE_PLAN_SHA256" --save-json units-result.json

    wqx download --descriptor units-result.json --directory units-download

Prepare the original draft as a complete JSON document. Its sourcePlanId and sourcePlanSha256 come from the saved native plan. Retain existing unrelated decisions, including Keep reasons.

    wqx upload --input-id concentration-draft --file draft.json \
      --content-type application/json --save-json draft-upload.json

    DRAFT_REF="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync("draft-upload.json","utf8")).inputRef)')"

    wqx concentration-prepare --document-ref "$DRAFT_REF" \
      --from-unit mg/L --target-unit ug/L \
      --reason "Use the receiving project's micrograms-per-litre concentration unit." \
      --plan-sha "$SOURCE_PLAN_SHA256" --save-json first-proposal.json

    NEXT_REF="$(node -e 'const r=JSON.parse(require("fs").readFileSync("first-proposal.json","utf8"));if(r.error||!r.documentRef)process.exit(2);process.stdout.write(r.documentRef)')"

    wqx concentration-prepare --document-ref "$NEXT_REF" \
      --reported-limits-only true --target-unit ug/L \
      --reason "Use the same receiving concentration unit for each reported limit, preserving blank measured values." \
      --plan-sha "$SOURCE_PLAN_SHA256" --save-json limit-proposal.json

The returned file is the complete proposal JSON. Extract reportCsvFile or documentFile into an ordinary descriptor JSON when selecting one of those downloads:

    node -e 'const f=require("fs"),r=JSON.parse(f.readFileSync("limit-proposal.json","utf8"));if(!r.reportCsvFile)process.exit(2);f.writeFileSync("limit-csv-descriptor.json",JSON.stringify(r.reportCsvFile),{flag:"wx",mode:0o600})'
    wqx download --descriptor limit-csv-descriptor.json --directory complete-limit-report

Pass the final documentRef to the existing complete-table and preview commands:

    FINAL_REF="$(node -e 'const r=JSON.parse(require("fs").readFileSync("limit-proposal.json","utf8"));if(r.error||!r.documentRef)process.exit(2);process.stdout.write(r.documentRef)')"

    wqx table-export --document-ref "$FINAL_REF" --format csv \
      --save-json complete-table-descriptor.json
    wqx decisions-preview --document-ref "$FINAL_REF" --new-plan-id "$NEW_PLAN_ID" \
      --save-json preview-result.json
    wqx download --descriptor preview-result.json --directory complete-preview

Read previewSha256 from the complete downloaded native preview. Save the same original document and IDs with that hash:

    wqx decisions-save --document-ref "$FINAL_REF" --new-plan-id "$NEW_PLAN_ID" \
      --review-id "$DECISION_REVIEW_ID" --preview-sha "$PREVIEW_SHA256" \
      --save-json saved-review-result.json

    wqx concentration-report --review-id "$DECISION_REVIEW_ID" --format csv \
      --save-json saved-report-descriptor.json
    wqx download --descriptor saved-report-descriptor.json --directory saved-concentration-report

All downloads use the original retained file ID, byte length and SHA-256. Repeating download with the same descriptor and directory resumes its verified prefix. The existing reopen command reads the complete local download without a connection.

For explicit IDs, put resultIds and the complete source selection in an --args-file object. An explicit flag must agree with the same property in that file. Neither the CLI nor provider silently truncates the selected array.

## Typed client

The existing client configuration and bearer-token handling are unchanged:

    const units = await client.concentrationUnits({
      planId: sourcePlanId,
      expectedPlanSha256: sourcePlanSha256,
    });

    const first = await client.concentrationPrepare({
      documentRef: uploaded.inputRef,
      fromUnit: 'mg/L',
      targetUnit: 'ug/L',
      reason: 'Use the selected receiving concentration unit.',
      expectedPlanSha256: sourcePlanSha256,
    });

    if (first.error || !first.documentRef) {
      // Retain first.file and first.reportCsvFile for the complete native explanation.
      return first;
    }

    const preview = await client.decisionsPreview({
      documentRef: first.documentRef,
      newPlanId,
    });

Use downloadWqxFile for the complete units, proposal and preview files; the inline view is a summary. Read the preview's exact previewSha256 and pass it unchanged to decisionsSave. concentrationReport reopens the saved report after either the original or independently received project is restarted. The published .d.mts declarations cover each exclusive selection and retained-file result.

## Error and interruption recovery

Native JSON HTTP errors retain their full original response file and actual httpStatus. Their error field keeps the CLI's original nonzero exit behavior. Inspect that native file before changing source, choices or identifiers. Other existing connection.json callers preserve their ordinary throwing behavior.

If proposal creation succeeds but the later CSV exporter returns an HTTP error, the response still carries the original proposalFile and prepared documentFile/documentRef. The failed CSV response remains its own exact native file. Reopen the original prepared document and its native explanation; do not rebuild a different cohort to get past that response.

A saved decision review is immutable. After a lost save response, use record with family decision and the same review ID. Resume the same original request and expected preview hash. A completed receiving bundle carries both source and decisions, so the independent receiver can reconstruct the same report from its native saved plan.

## Complete Potomac receiving

The maintained wqx-concentrations-receiving.mjs entrypoint composes this MCP path with the existing native concentration source phase. It reads the same pinned original configuration, capture graph, review and corrected receiving plan. It writes a dedicated child receipt under that original operation directory; the previously frozen 3d9d8fef operator snapshot remains separately reproducible.

The original cohort contains 1,035 results and 1,112 retained limit records. The selected conversion groups are 220 mg/L results, 40 ug/L results, 38 ng/L results and 451 supported limit-only results. One additional Turbidity record keeps its original NTRU limits and explicit Keep reason. All 452 blank result/unit pairs remain blank. The complete operation checks 749 selected results and 1,089 independent reported-limit conversions against the native CLI document and report.

The receiving program prepares the four source groups through the original typed MCP client, retains every complete proposal/document/CSV, imports the original reviewed table with its final optical Keep reason, round-trips the full CSV and TSV, saves the exact native preview, transfers all eleven exports into a second project, restarts the operator and both managed projects, and reopens saved JSON/CSV reports through the typed client and original CLI.

    node --expose-gc --max-old-space-size=768 \
      stellar-forge/mcp-merchant-operator/wqx-concentrations-receiving.mjs \
      --config /private/original-potomac-concentrations.json \
      --expected-config-sha256 EXACT_ORIGINAL_CONFIG_SHA256

Use --phase prepare or --phase receive to continue the same retained child after reconciling its original phase output. prepare reuses the original source-ready receipt and derives the complete MCP configuration from its native hashes. receive uses that exact immutable configuration. Receiving is a source-native local operation and uses the retained original source bytes.

The operation retains mcp-receiving/selection.json, mcp-receiving/operator.json and mcp-receiving/operator/receiving-result.json. The last file includes source/document/plan/report identities, all full-file descriptors, actual byte lengths, group counts, native request count and restart results. Use its actual completion and file records when reporting a native run.
