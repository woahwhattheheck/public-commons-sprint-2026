# ClinicalTrials cohorts in the original Research MCP workspace

The Research operator takes a complete saved ClinicalTrials packet through question selection, reviewed local receiving, full study inspection, cohort analysis, analyst findings and complete customer exports. Every step uses the existing authenticated Research listener and its original retained packet, operation and dossier stores.

The ClinicalTrials source operator prepares the packet. The Research application receives it under a question. The merchant MCP attachment exposes that same application to an agent and retains complete exports in its existing customer directory. The browser, Research client and agent read the same original records.

## Attach the existing application

Start or reopen the original Research application with its maintained CLI or managed Applications entry. Keep its private connection record and exact workspace directory. The existing guides describe that owner and its browser:

- [Original Research client, CLI and connection lifecycle](../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/RESEARCH_CLIENT.md)
- [Original ClinicalTrials receiving and source reader](../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/CLINICAL_TRIALS.md)
- [Native retained-cohort analysis and counting rules](../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/CLINICAL_TRIALS_ANALYSIS.md)

Add a packet to the host's Research connection configuration. This is a file handle chosen by the host; the tool call later uses only its alias.

~~~json
{
  "schema": "stellar-forge.research-workspaces.v1",
  "workspaces": {
    "portfolio": {
      "label": "Clinical portfolio research",
      "consoleUrlFile": "/srv/starforge/research-console.json",
      "directory": "/srv/starforge/research",
      "sources": {
        "original_portfolio": {
          "kind": "clinicaltrials-packet",
          "file": "/srv/starforge/inputs/ClinicalTrials_Customer_Checkpoint.zip",
          "sha256": "ed8eb65e0d4fce506390eb50a0e7cd5f91df1e5ce07f4eb83927d9b4538b9416"
        }
      }
    }
  }
}
~~~

The hash above identifies the retained customer checkpoint used by the original 165-study receiving workflow. For another packet, use its own exact file and SHA256. The configuration file uses the existing private-file permissions and stays alongside the merchant's host configuration.

The installed merchant command keeps the original initializer and server:

~~~sh
starforge merchant-mcp init-research-workspaces \
  --dir /srv/starforge/research-merchant \
  --connection /srv/starforge/research-workspaces.json

starforge merchant-mcp serve \
  --config /srv/starforge/research-merchant/merchant-mcp.json \
  --port 0 --token-env MCP_ACCESS_TOKEN
~~~

Use the host's existing token environment and the returned MCP address. Call `merchant_research_workspaces` to inspect configured aliases, then `merchant_research_attach` with `workspace: "portfolio"`. Retain the returned `attachmentId` and original `workspaceId`. The maintained client rereads the connection file, so a managed restart can publish its new listener through that same record.

## Work from a research question

Use the original `merchant_research_list`, `merchant_research_dossier` and `merchant_research_section` tools to choose the existing dossier and question. `merchant_research_create` and `merchant_research_question` create them when the work requires new research. Mutations retain the native integer dossier revision.

For a saved portfolio, a question might ask which phases, lead sponsors and registry reporting statuses occur in that particular retained cohort. Keep the question's scope aligned with the original capture query. The full packet preserves the source query, API version, source timestamps, page membership, exact raw studies and the source operator's reviews.

Read the dossier after creating or editing a question and use that revision to prepare receiving.

## Receive the original packet and cohort

| Stage | Original MCP tool | Selection retained by the native engine |
| --- | --- | --- |
| Saved packets | `merchant_research_clinicaltrials_inputs` | Original packet/source IDs, hash and capture coverage |
| Packet details | `merchant_research_clinicaltrials_input` | Complete selected packet and available captures |
| Import a host packet | `merchant_research_clinicaltrials_import_packet` | Host alias, exact file length and SHA256 |
| Prepare | `merchant_research_clinicaltrials_prepare` | Request ID, question, dossier revision, source ID and capture ID |
| Review | `merchant_research_clinicaltrials_review` | Plan SHA256, source binding, phase and cohort count |
| Start or resume | `merchant_research_clinicaltrials_start` | Same operation ID and reviewed plan SHA256 |
| Stop | `merchant_research_clinicaltrials_stop` | Same operation and completed receiving output |
| Receive into the question | `merchant_research_clinicaltrials_receive` | Plan SHA256, edition SHA256 and current dossier revision |

The import tool streams the host-selected packet through `ResearchWorkspaceClient.clinicalTrials().importPacket()`. It returns the original `ctsrc_…` source identifier. Read this source to choose a capture; a packet can contain multiple retained captures.

Prepare with these fields:

~~~json
{
  "workspace": "portfolio",
  "dossierId": "<original d_… ID>",
  "requestId": "portfolio-question-receiving-20261012",
  "questionId": "<original q_… ID>",
  "expectedRevision": 2,
  "sourceId": "<original ctsrc_… ID>",
  "captureId": "<original capture ID>",
  "label": "Reviewed retained portfolio",
  "allowPartial": false
}
~~~

The receiver preserves `requestId` as its original operation identity. Select `allowPartial` explicitly when the work calls for a partially captured source; the native plan records that choice and retains its coverage. A complete retained capture keeps its original configured scope and pagination.

Review the plan and page the study metadata before starting. A review uses `offset` and `limit` up to 200. The returned cohort count and source references describe the complete selected edition. Start and resume use the same `ct_…` operation and exact plan hash.

Once the native phase provides a complete edition, read the dossier's current revision and submit `merchant_research_clinicaltrials_receive` with the reviewed plan and edition hashes. The receiver links each study to the original question and records its packet, capture and operation references. It reconciles an already committed receive when its response was interrupted.

The response keeps the native operation and receive receipt, plus compact dossier metadata. Original section tools page the complete questions, editions, citations, source selections, analyst findings and history.

## Inspect complete original studies

`merchant_research_clinicaltrials_record` reads one zero-based original occurrence from a prepared edition. `merchant_research_clinicaltrials_retained_record` reads that record through an edition already received into a dossier.

These methods return the complete nested study, including retained protocol and results sections, its page and row, record hash and byte length. Use them when a cohort table needs deeper review. The original occurrence stays identified throughout the analysis.

`merchant_research_clinicaltrials_compare` compares two receiving operations under the same question. After receiving, `merchant_research_clinicaltrials_compare_retained` compares the saved dossier editions. Both preserve original source hashes and native comparison semantics.

## Analyze the saved cohort

The analysis tools work before and after receiving:

- `merchant_research_clinicaltrials_analysis` selects an original operation.
- `merchant_research_clinicaltrials_retained_analysis` selects an original dossier edition.

Both accept the native typed `criteria` object and a page of up to 200 occurrences. A useful selection is:

~~~json
{
  "statuses": ["COMPLETED"],
  "resultsFlags": [true],
  "hasResultsSections": true,
  "query": ""
}
~~~

Keep `true`, `false` and `null` as distinct source values. Exact status, sponsor and condition strings come from the saved cohort. `phaseKeys` uses the native group's serialized key, such as `["PHASE1","PHASE2"]`, as a string. The original analysis permits up to 200 values per list, three results-flag values and 2,000 query characters; the complete criteria serialization fits its 16 KiB limit.

The response preserves capture totals and separately reports selected distinct studies and selected source occurrences. Group counts use distinct NCT IDs, while every occurrence remains available. Repeated versions keep their own hashes and metadata. Exact enrollment stays as source text; missing, reported zero, ACTUAL and ESTIMATED remain visible at record level.

Registered protocol outcome measures and posted result sections remain separate fields. The native report explains its descriptive denominators and source coverage. Whole-study reads provide underlying content; original finding tools retain an analyst's cited interpretation.

## Export complete selected work

Output uses the existing `merchant_research_export` retainer, followed by `merchant_research_exports`, `merchant_research_file_read` and `merchant_research_file_release`. The complete output remains available after its temporary read closes.

| Export kind | Original selector | Complete native content |
| --- | --- | --- |
| `clinicaltrials-input-packet` | `sourceId` | Original saved ClinicalTrials ZIP |
| `clinicaltrials-edition` | `operationId` | Complete locally received Research edition |
| `clinicaltrials-retained-edition` | `editionId` | Original ClinicalTrials edition in the dossier |
| `clinicaltrials-retained-packet` | `editionId` | Source packet retained with the dossier edition |
| `clinicaltrials-analysis-csv` | Exactly one `operationId` or `editionId` | All selected original occurrence rows |
| `clinicaltrials-analysis-json` | Exactly one `operationId` or `editionId` | Complete selected analysis, groups and source references |
| `clinicaltrials-analysis-html` | Exactly one `operationId` or `editionId` | Standalone native report and full selected inventory |
| `clinicaltrials-analysis-markdown` | Exactly one `operationId` or `editionId` | Complete native Markdown report |

Analysis exports accept the same typed `criteria` and use the complete selection. The receipt retains exact filters, original operation or edition, dossier and native output hash. An optional `expectedSha256` verifies an already reviewed complete output.

Every retained export has its content SHA256, byte length, media type and source selection. Continue chunks with the same `kind`, `exportId`, `readId` and `nextOffset`. After a read expires or an attachment restarts, reopen the retained export with its kind/hash and saved offset. The original reader verifies complete bytes before serving a snapshot.

Existing `portable-json`, `portable-gzip`, `markdown`, `html` and revision `comparison` exports remain available for the whole dossier. A handoff can include complete portable research, source packet, selected cohort data, analyst report and reviewed source-linked findings.

## Reopen, corrections and interrupted work

Use `merchant_research_reopen` with a host-declared portable dossier or retained portable export. It restores the original dossier identity, questions, saved editions, references, selections, findings and history through the native portable reader.

After reopen, call `merchant_research_clinicaltrials_retained` and choose the original `e_…` edition. Its retained review, whole-study reader, analysis and packet export use the dossier's saved bytes independently of the earlier receiving operation's working directory.

Corrections use original dossier revision controls. Revisit a selected source, update question-specific evidence annotations, or edit a cited finding at the current revision. A later packet becomes another reviewed edition that can be compared with the earlier one; both source identities remain retained.

When a write response is interrupted, keep its request ID, operation ID and reviewed hashes. Read the same operation and dossier revision before continuing. Packet inventory, saved phases and export receipts expose the original result. The adapter carries the native uncertainty signal and the pending operation's identifiers.

Detach with the current `attachmentId`. The merchant attachment drains its in-flight work and temporary file reads. The original Research application keeps its listener, current operation and saved source custody. A later attach verifies that same workspace and reuses retained exports.

## Source architecture

The Research factory includes 17 ClinicalTrials tools alongside the original 27 controls. The additive lightweight catalog declares metadata. Its runtime helper receives the existing `ResearchWorkspaceClient` and invokes the maintained `clinicalTrials()` facade.

The original provider keeps configuration parsing, attachment identity, pending calls, errors, complete-file retention, chunk reads and detach behavior. The `clinicaltrials-packet` source handle and eight native export kinds join that same implementation. The existing browser, Research client and MCP attachment continue to share one original application.
