# Discuss a complete saved scientific report and continue its follow-up

The existing Source reports desk composes retained scientific studies in reading order. A saved edition can now become an offline discussion package: the original report, complete source data and figures, a presentation, its report model and historical page index. Actual meeting notes return through the existing Implementation & fieldwork follow-up receiver.

## Operator journey

1. In Source reports, choose saved scientific studies in their intended reading order. Preview and prepare the original PDF, HTML and data.
2. Open that saved scientific report and choose **Preview discussion package**. Review the original study, section, figure and briefing-page counts.
3. Choose **Prepare briefing and complete ZIP**. The original task queue retains the selection and supplies the completed package. Refresh the saved report to reopen any retained briefing.
4. Download and extract the complete discussion package. Open scientific-briefing.html. Every original table remains in order and long tables continue across pages. Original SVG figures retain their captions, alt text and numeric specifications. Complete report links open the corresponding original section.
5. Use Agenda, Present and Meeting notes. Record the actual meeting date, participants, questions, decisions, assigned actions, statuses and source deadlines. Export the meeting JSON before sharing or closing.
6. Open Implementation & fieldwork → Source selections → Receive briefing follow-up. Choose the saved scientific briefing and upload the original meeting file. For a copied package, select its scientific-briefing-model.json and scientific-briefing-index.json instead.
7. Preview the selected follow-up against the actual saved plan revision. Receive the chosen entries; continue durations, dependencies, progress and costs through the ordinary Work plan. Original report/index/notes remain attached to the plan.
8. The complete Workspace backup retains both the scientific source edition and its discussion package. Reopen the restored project and saved briefing to continue the same edition.

The saved report and its original report-files.zip remain intact. Each discussion package has its own retained identity and complete ZIP.

## Scientific and source meaning

The adapter reads the completed report-data.json and its exact saved edition. It carries the original ordered blocks, scalar/link cells, all table rows, figure SVG identities, figure numeric specifications, original contact and source records. Each presentation block points to the original report section; meeting entries retain their exact historical page index.

The briefing model uses upstate.scientific-briefing-report/v1 and retains the complete original report data. Its binding names the original scientific edition, original data-file length/SHA256, canonical data identity, ordered sources and project. It preserves the source report's own measurements, model quantities, methods, periods, support and interpretations.

The maintained client briefing renderer paginates this explicit scientific report kind. Existing modeled client reports and utility source briefings continue using their original bindings. Displayed scientific SVGs embed the verified original bytes so they remain visible in the native sandbox and in a downloaded briefing HTML. The complete ZIP also carries the original SVG/data files at their original paths.

## Retained edition and portability

A discussion edition lives at scientific-report-briefings/BRIEFING_ID within its original Workspace. Its identity includes the original saved scientific edition, exact report-data descriptor, project ID and both adapter/renderer source hashes. Updating presentation code creates a separate edition; previously exported meeting pages remain valid.

The folder retains scientific-briefing-model.json, scientific-briefing.html, scientific-briefing-index.json and briefing.json. The file transport serves these generated files and the exact existing source report members through one path-preserving briefing view. It checks original sources and complete file identities before use.

scientific-briefing.zip contains every file of the original scientific report, its original operation/edition records, all three briefing files and the briefing record. Original files are streamed in 1 MiB chunks, verified while read and retained with deterministic member metadata. The complete archive is synchronized before its immutable descriptor is published. The original scientific report directory and export receipt remain unchanged.

Selected study-transfer owners should include every matching scientific-report-briefings/BRIEFING_ID subtree alongside its source_edition_id in scientific-report-editions. Full Workspace capture already includes these ordinary retained files.

## Native command

Preview the actual saved report:

    python -B source_tools/prepare_scientific_briefing.py \
      --workspace ACTUAL_WORKSPACE --edition-id ORIGINAL_SCIENTIFIC_EDITION_ID \
      --output NEW_PREVIEW.json

Prepare that exact reviewed edition:

    python -B source_tools/prepare_scientific_briefing.py \
      --workspace ACTUAL_WORKSPACE --edition-id ORIGINAL_SCIENTIFIC_EDITION_ID \
      --apply --expected-id ORIGINAL_BRIEFING_PREVIEW_ID \
      --output NEW_PREPARED.json

The result supplies the original briefing ID, retained directory and complete archive path. Repeating the exact operation reopens its retained files.

Receive actual exported meeting notes into an existing saved work plan:

    python -B source_tools/receive_briefing_followup.py \
      --workspace ACTUAL_WORKSPACE --plan-id ORIGINAL_PLAN_ID --revision ORIGINAL_REVISION \
      --scientific-briefing-id ORIGINAL_BRIEFING_ID --notes ORIGINAL_MEETING_NOTES.json \
      --output NEW_FOLLOWUP_PREVIEW.json

Repeated --entry ORIGINAL_ENTRY_ID selects explicit entries; --apply receives that selection. The original briefing follow-up receiver preserves local task edits and deletions, source deadlines, exact original attachments and repeat/retry semantics.

## Native integration

The read operations are scientific-briefing-preview and scientific-briefing on the original SourceReports provider. The mutation is source-reports.briefing through the ordinary action queue. Complete task downloads include the discussion ZIP and original briefing/model/index. The authenticated scientific-briefings file route keeps every original relative source path available.

**For the review:** open the original saved scientific report, present its exact tables and figures, record the discussion, and carry selected actions directly into the working project.
