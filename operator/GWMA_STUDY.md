# GWMA study-data operator

This desk joins the existing authenticated scientific workspace. It carries an original laboratory or agency source through column mapping, observation review, an explicit analytical contract, a programme workplan, and a complete retained handover. Every saved study, mapping, batch, review, contract, plan and handover is immutable. The existing operator queue performs the seven supported actions and retains their original request identities.

## Open the study

Select the existing workspace and open **Pathogen study workspace**. The current study selector is independent of the workspace selector. Selecting a saved study restores that study's unfinished forms and review draft. Selecting the empty study option opens a new study draft. **Load study into draft** copies the complete selected saved study's editable fields; saving creates a new retained study record.

Name the study and enter each watershed on a separate line. Record the laboratory, risk and study owners and the scope notes. The installed workplan supplies the published nine watershed names. A programme can cover all nine while its demonstration uses a selected watershed.

Save the study. The native task runs in the original workspace queue. The desk receives its compact result identity and catalogue, durably retains the complete original operation under **Saved operations**, and automatically makes the next action available. An uncertain request remains pending until its actual outcome is received.

## Receive the complete original source

Open **Sources & mapping**. There are three source routes:

1. Upload an original CSV of at most 4 MiB. The browser retains its exact bytes, filename and original header names. It reads the header for mapping; the source engine receives and parses the complete file.
2. Remap a retained original observation by its observation ID. This reuses the original bytes already held in the workspace.
3. Select an original registered source by its source collection and source ID. This uses the existing source registry and is suitable for a larger file already received there.

Enter an intake title and its original source URI or retained source reference. A local filename alone does not document the public or organizational origin.

Choose an installed source profile or the explicit mapped-CSV profile. **Apply selected profile fields** loads its published source columns and constants into the editable mapping. Review every required mapping. Empty source mappings can explicitly remove a profile mapping. A constant and a mapped source field are both visible, so the operator can see the selected interpretation. The complete original columns remain in the underlying source whether or not they are mapped into the canonical study fields.

Save the mapping, receive its native task, then select that exact saved mapping for intake. **Receive original source** creates the retained batch. Remapping the same original source produces another batch edition with the original observation/source identities preserved.

The canonical fields are:

- Identity and context: result_id, sample_id, station_id, watershed, event_id, collected_at, timezone, weather.
- Measurement: matrix, parameter, method, fraction, value, unit, qualifier, detected, mdl, rl.
- Laboratory and quality: laboratory, batch_id, sample_type, replicate_id, qa_code, qa_note.
- Location: latitude and longitude.

Original laboratory result_id is a source value. Internal row_id identifies each original occurrence; legitimate repeated laboratory identifiers remain separate rows.

### Preserve scientific source meaning

Keep the exact original result text, including trailing zeros, qualifiers, units and detection/reporting limits. Profiles document interpretation without fabricating an observation. In particular:

- CEDEN 2.0 uses its documented collection format and detection flag. A nondetect may have a blank original Result. A bacterial MDL sentinel is retained as a source sentinel.
- A legacy publisher's ResultSub or geometric mean is separate from its original Result. The original Result remains the measurement selected by the supplied Safe-to-Swim map.
- WQP preserves its separate date, time, timezone and detection-limit metadata. A date-only value is not a known collection instant.
- A culture duplicate and a molecular assay have different laboratory quality considerations. The source guide retains the relevant laboratory versus field QC decisions.

The complete source-contract and scientific mapping guide is **GWMA_SOURCE_MAPPING.md** in this application. Named scientific reviewers resolve collection metadata, source qualifiers, method-specific limits and analytical choices through saved decisions.

## Review observations and ambiguities

Select the original batch and, when continuing work, its exact prior saved review. Enter the named reviewer and choose **Load observation page**.

The desk displays 25, 50 or 100 original occurrences per page, with source line and internal row identity. The result cell shows parameter, original value and unit, method, fraction, matrix, qualifier, detection flag and original MDL/RL. The findings cell displays the engine's actual issue codes, fields and messages. **Full source & review** opens the complete current row and its retained review in a read-only dialog with a full JSON download.

Choose one disposition per changed row:

| Disposition | Meaning |
| --- | --- |
| Pending | The observation remains available while a scientific or source decision is unresolved. |
| Accepted | The named reviewer accepts that occurrence, with a required reason. |
| Excluded | The named reviewer excludes that occurrence from analytical use, with a required reason. The original source and exclusion remain in the handover. |

**Edit explicit overrides** lets the reviewer select each canonical field to replace. Its Apply checkbox is separate from the replacement value, so an explicit empty string can be recorded. Unchecked fields remain unchanged. Saving overrides retains them in the current browser review draft; **Save review edition** sends the complete changed decisions through the original queue. It carries forward the selected prior review on the server.

Review drafts are retained separately for each exact batch and prior-review pair. Moving to another batch or prior review does not apply the previous batch's decisions to it. Saving an edition preserves the earlier reviewer history.

The engine's current disposition is shown when no local edit exists. An observation with no recorded parsing issue can have an engine disposition of accepted; the interface does not invent a named human review for that state.

## Record the analytical contract

Open **Analytical contract** and name its title, technical reviewer, model name and model version. Input and output schemas are explicit strings: use the selected schema or its versioned reference.

Add a rule for every approved measurement input. A rule identifies parameter, method, sample fraction, matrix, original unit, output unit and exact decimal conversion factor. The engine matches those source strings exactly and validates the factor against its supported explicit units. An empty fraction remains distinct from a named filtered or unfiltered fraction.

Every rule preserves censor bounds. This desk does not replace a nondetect with zero, half a limit or a publisher-derived result, and it does not calculate a risk estimate. The scientific model contract specifies how the receiving analysis uses the retained observations. Notes capture assumptions and named decisions. Save the contract through the same task flow.

A handover can retain accepted observations that are not matched to a contract. Its complete analytical status counts distinguish ready, needs_review, excluded and contract_unmapped rows.

## Build the workplan and scenarios

Open **Workplan & scenarios**. **Load complete source-linked workplan** fills the installed programme template, including the scientific decisions, original task dependencies, implementation authorization milestone and documented monitoring durations. It remains an editable draft until saved.

Assign the study, laboratory and risk owners. The template's additional owner fields remain retained when the three visible owners are edited. The complete source references, template schema and programme context also accompany the saved workplan.

For each programme decision, retain a stable ID, title, status, owner and note. States are open, resolved or deferred. A resolved decision requires its named owner and recorded decision.

For each task, retain its stable ID, title, owner, duration in months, duration status and basis, and dependency IDs, one per line. Leave the duration blank when it remains to be agreed; the saved value is null, with its explicit status and basis. A blank duration is not converted to zero. The domain engine validates that dependencies name this plan's tasks and that they do not form a cycle. Extra source-linked fields carried by a loaded template, such as phase and duration basis, remain in the saved task object.

For each scenario, record its stable ID, title, control measure, model version, source-strength description, cost and cost unit, uncertainty and notes. Keep cost denominators explicit. The browser retains decimal values as strings and does not perform currency conversion, scientific calculation or procurement ranking.

Save the workplan edition. **Open complete workplan** shows the exact immutable record. **Load workplan into draft** reopens all its original tasks, decisions and scenarios for a new edition.

## Produce and receive the handover

Open **Handover** and select every original batch that belongs in the study delivery. Select an explicit saved review for each batch, or choose the original dispositions. Optionally select an exact analytical contract and workplan. Give the handover its title and choose **Build complete handover**.

The server checks same-study identity and every original source reference. Select one mapping edition for each original source file; the engine rejects selecting two batches that map the same original CSV in one handover. This prevents the same source occurrences from being counted twice.

The completed original task provides the verified archive download. The Handover and Saved operations screens show its original ticket, byte count and SHA-256. Open its native task from **Saved operations** to receive the file. The archive retains original CSVs, study and mapping records, complete review history, selected analytical contract and workplan, analytical rows, source identities and issue/status counts. The full manifest remains available through **Open handover manifest**.

The desk opens whole JSON detail only on explicit inspection. Routine catalogue refreshes and completed task receiving use compact identities, and observation screens page the complete source. Closing a detail dialog clears its large rendered JSON while the immutable source stays in the workspace.

## Interruption and draft recovery

The browser retains the complete editable draft and pending request in workspace-scoped browser storage. Each operation includes the original action, payload, operation UUID and content hash. A returned native task is accepted only after its workspace, action and complete payload identity match that saved request. If the original queue coalesces an identical active request, the desk also records that actual native task and operation identity.

After an interrupted response, open **Saved operations** and choose **Receive saved outcome**. The desk reads the original task, or searches the current workspace state by the original operation ID. It does not generate a replacement operation.

Completion selects a returned record only when the relevant submitted selection is still current. A review completed after a batch switch or later decision edit retains its receipt without clearing or rebinding the newer draft. File reads and row-page reads are likewise bound to their original selected context.

If the authoritative workspace state returns no original task, the desk shows **Retry original request**. That explicit retry submits the same saved UUID and body to the existing queue. A completed task remains complete if a later catalogue read fails; receiving continues its saved outcome and catalogue without rebuilding its operands. When the catalogue and original result identity have been received and the complete receipt has been durably saved, success clears the pending request automatically. If receipt storage fails, the original operation remains pending for recovery.

A failed, cancelled or interrupted native task can be acknowledged only after its original outcome has been received. The complete receipt and request remain in Saved operations. Corrections then form a new explicit draft/action, while the earlier operation stays available.

Use **Save recovery draft** before moving browsers or when browser storage reports an error. The downloaded JSON includes original uploaded bytes, unfinished forms, per-study and per-review drafts, pending request and retained task receipts. Reopen it through **Saved operations** in the same workspace. An existing unresolved request cannot be replaced with a different imported request. Imported original request content is rehashed before it can be replayed.

Treat draft downloads like the source data they contain. Browser storage belongs to this browser profile; the original authenticated workspace, retained native task records and complete handover are the shared receiving surface.

## Integration and source boundary

The client exports:

    attachGWMAStudyWorkbench({getState, api, endpoint, toast, showTask})
        -> {mount(container), update(), detach()}

It is mounted by the existing extension host. Current workspace identity comes from getState().workspace_key. Workspace switch detaches the prior view after retaining its draft. Normal host updates observe task progress without remounting or replacing typed forms.

Read routes are /api/gwma/catalog, /api/gwma/item and /api/gwma/rows. Mutations use the existing /api/actions envelope with workspace, action, payload and operation_id. The seven action names are gwma.study.save, gwma.mapping.save, gwma.intake, gwma.review.save, gwma.contract.save, gwma.plan.save and gwma.handover.build. No browser field asserts a provider result or changes a scientific source record directly.

The interface lives in web/gwma_study.mjs and web/gwma_study.css. Source and task execution remain in the original model, operator adapter, extension registry, authentication and workspace queue.
