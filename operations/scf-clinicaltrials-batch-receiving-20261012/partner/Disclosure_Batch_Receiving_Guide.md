# Disclosure batch receiving
## Open the same reviewed work in a customer workspace

The delivery includes a batch register, an exception register, exact original and selected XML documents, original inspection and change/composition records, the retained schema edition and a portable workspace. The operation report records the example inputs and the actual receiving outcome.

### Start the original installed operator

Use the batch-enabled ClinicalTrials contribution and its selected Python runtime with the original PRS dependency. Initialize a new private workspace, restore the delivered portable file and open the console:

```sh
starforge clinicaltrials --workspace CUSTOMER_DIRECTORY init
starforge clinicaltrials --workspace CUSTOMER_DIRECTORY restore --file clinicaltrials-workspace.zip
starforge clinicaltrials --workspace CUSTOMER_DIRECTORY serve
```

The command returns the private console URL for that workspace. Open **Batch receiving** and choose the retained batch. Keep the console URL within the receiving team; its fragment authorizes the local session.

The equivalent direct command is the contribution’s `cli.mjs`, with an explicit selected Python when required:

```sh
node cli.mjs --python /path/to/python3 --workspace CUSTOMER_DIRECTORY status
```

### Review a client reference

The register preserves each client key. Select a row to see the original input, current selected document, original inspection and current disposition. Separate references to identical input bytes remain separate rows.

The current document can be an original XML file, an original-engine modernization candidate or a reviewed upload composition. The details retain the selected plan and preview context. Open the source or candidate XML directly when reviewing a finding.

### Resolve and retain exceptions

Review schema errors, source-reference findings, deprecated elements, partial-upload context and any explicit public-source reconciliation. A change plan records the occurrence, decision, reviewer and reason. Applying the plan keeps the input intact and creates a separate candidate.

For a composed update, select the prior/base document and the incoming document, then inspect the retained composition. Select that candidate with the review context attached. The export includes both inputs and the resulting candidate.

Choose ready, follow-up or exclude with a named reviewer and explanation. A subsequent source, link or candidate change requires a current review. Prior decisions remain in the row’s history.

### Read the handover files

| File or directory | Purpose |
|---|---|
| `batch-register.csv` | Client references, original/current document identities and selected dispositions |
| `exceptions.csv` | Retained findings, source detail, disposition and reviewer explanation |
| `batch.json` | Complete batch metadata and row history |
| `prs/` | Exact original/candidate XML and the inspection, plan, preview and reconciliation records used by the batch |
| `studies/` | Explicitly linked captured public-study bytes and their source metadata, when selected |
| `contracts/` | The selected original source/schema edition |
| `manifest.json` | Complete declared files with sizes and SHA256 values |
| `clinicaltrials-workspace.zip` | Portable original workspace for customer receiving |
| `HANDOVER.md` | Batch-specific receiving instructions |

**Export batch** prepares those files and the complete `disclosure-batch.zip`. All client references remain in the delivery, including follow-up and excluded rows.

### Continue safely after an interruption

The original operator saves action identity, current revision and resulting state. Reopen the workspace and inspect the retained operation before repeating an action whose response was interrupted. The browser keeps the pending request identity for recovery.

Receive a portable file into a fresh private workspace. Reimporting the same already-restored package returns the original receiving result; a different packet requires an empty destination. This protects an XML-only batch as well as a workspace containing captured registry data.

### Operate through the same agent interface

The Clinical MCP family borrows the authenticated console, so it observes the same original owner and review state. Batch and entry reads, the retained batch actions, and manifest-pinned downloads use the original controller. Tool names come from the installed advertised catalog. Browser and agent access share the same workspace revision and action identity.

### Published demonstration sources

The technical example operation uses `1234.xml`, `study_file.xml` and `ct_safety_upload.xml` from eudract 1.1.1, retained at source commit `8c5412f28a316a5e26f7bdc013f24e24f9000633`. Their original provenance, license and source bytes accompany the delivery under **Original_Example_Provenance**. The original source is [shug0131/eudract_pkg](https://github.com/shug0131/eudract_pkg/tree/8c5412f28a316a5e26f7bdc013f24e24f9000633).

The example register includes two client references to the same input, a whole-study XML and a partial safety upload. The operation report names the actual selected candidates and dispositions. The customer adaptation uses the agreed ClaritiDox input contract and named review team.
