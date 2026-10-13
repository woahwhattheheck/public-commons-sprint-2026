# Complete files in operating procedures

An Operating Plan can carry the complete files needed to perform or receive its steps. A saved file contains its original bytes, filename, media type, stable step-local ID and operator note. The original plan history retains those values in the revision in which they were saved.

Use **Operating procedures** in the existing Runtime workspace for the complete browser, private record, command and source-capture workflow. [Runtime operating procedures](../runtime-workspace/RUNTIME_PROCEDURES.md) explains that installed host. [Review returned operating procedures](./OPERATING_PLAN_RETURNS.md) explains the shared comparison model and actual receiving controls.

## Attach and retain the original

Open the intended procedure and step, select the complete file, and save the next original revision. The step editor can download an original file or remove it from the current draft. Removing a file from a new revision preserves every earlier revision containing it.

The file's name is a single filename, without directory separators or control characters. Its ID is unique within its step. The content is canonical Base64 with an exact byte count; validation rejects a truncated body, incorrect padding or length mismatch. Binary files are carried as bytes rather than decoded and rewritten as text.

Ordinary carried files may have later editions under the same stable file ID. Changing their bytes or note in a later saved revision preserves the original earlier edition. Runtime's generated source-capture files additionally belong to retained source captures: its receiving layer checks those original captured bytes and their associations. Use the Runtime record to retain that complete provenance.

Files supplied through this plan belong to its complete customer handover. Read the source before sharing it. A local path, remote URL or filename in an instruction remains an instruction; it does not embed the referenced external file.

## Limits and complete receiving

| Item | Maintained limit or behavior |
| --- | --- |
| One carried file | 24 MiB of original bytes |
| Files on one step | At most 1,000, with distinct step-local IDs |
| Steps in one plan | At most 1,000 stable step IDs |
| Complete plan input for returned-work review and Runtime receiving | 32 MiB of encoded JSON |
| Complete returned-work review | 128 MiB of encoded JSON |
| Complete Runtime procedure record | 256 MiB, with a 257 MiB request envelope |
| Existing saved history | Retained in full, including original file contents |

Base64 and repeated saved revisions increase encoded size. A file below its individual limit can therefore produce a complete plan above the receiving limit. The pure plan model validates its files; the receiving application also enforces its complete-document limit. Keep the complete saved plan within the intended receiver's limit before transferring it. Runtime source archives remain available through their native archive/download controls; their selected identities in a capture do not copy an entire external archive into the plan.

The plan schema remains `stellar-forge.operating-plan.v1`. Older steps with no `files` property retain their original shape. The updated reader accepts those original histories without rewriting their bytes into a different saved revision.

## Download and continue

The original Operating Plan JSON retains every saved revision and carried file. Its readable HTML presents the selected revision and original-file downloads. Keep the JSON or complete Runtime record as the editable receiving source; Markdown is a readable projection.

The Runtime export formats are:

~~~sh
starforge runtime-workspace procedure-export \
  --workspace /absolute/private/runtime-workspace \
  --procedure-id ORIGINAL_PROCEDURE_ID \
  --format plan-json \
  --output /absolute/private/operating-plan.json

starforge runtime-workspace procedure-export \
  --workspace /absolute/private/runtime-workspace \
  --procedure-id ORIGINAL_PROCEDURE_ID \
  --format html \
  --output /absolute/private/runtime-procedure.html
~~~

Use `json` for the complete Runtime record, `html` for its readable handover, `plan-json` for the original plan alone, or `plan-html` for the original plan's readable export. Output paths are created through the installed command's complete file writer. Retain the complete Runtime JSON when the recipient needs source captures, request history and returned-work reviews as well as the plan.

## Returned files and recorded results

New returned-work reviews use `reportingVersion: 2`. They compare a step's recorded status, recorded result and complete files together. A file sent with a reported result remains part of that reported work.

If one operator changes the work while the other changes its result or files, the comparison asks for an explicit complete-step choice. If both change their reporting differently, it presents the full reporting group. A custom group includes the displayed status, recorded result and files together, including each complete encoded body. Use the actual displayed source shape; do not substitute a summary for its files.

The review's readable HTML includes downloads for the complete original files retained by its current and returned histories. Its summaries can distinguish added, removed, changed and reordered files. Complete editable source remains in the review.

Previously saved unversioned reviews retain their original comparison interpretation, including completed results. The reader recomputes those results under the original rules; receiving them does not silently reclassify their recorded decisions into version 2.

## Typed application API

The `operator-discovery` contribution exposes both complete engines:

~~~js
import {
  createOperatingPlan, createOperatingStep, operatingPlanDraft,
  addOperatingStep, createOperatingFile, addOperatingFile,
  saveOperatingPlanRevision, operatingPlanRevision,
  operatingFileBytes, compareOperatingFiles,
} from '@tokenjunkielabs/starforge-merchant/operator/operating-plans';

let plan = createOperatingPlan({
  id: 'customer-monthly-operations',
  title: 'Monthly customer receiving',
});
let draft = operatingPlanDraft(plan);
draft = addOperatingStep(draft, createOperatingStep({
  id: 'receive-original-report',
  title: 'Receive the complete original report',
  instruction: 'Read the report and record the receiving outcome.',
}));
draft = addOperatingFile(draft, 'receive-original-report',
  createOperatingFile({
    id: 'original-report',
    name: 'monthly-report.csv',
    mediaType: 'text/csv',
    bytes: new TextEncoder().encode('period,total\n2026-10,120\n'),
    note: 'Complete original report supplied for this step.',
  }));
plan = saveOperatingPlanRevision(plan, draft);
const original = operatingPlanRevision(plan).steps[0].files[0];
const bytes = operatingFileBytes(original);
const changed = compareOperatingFiles([], [original]);
~~~

Use the package name recorded by the installed distribution when it differs from this example. API functions return independent JSON values; the host owns its original storage transaction and request identity. File creation accepts a complete `Uint8Array`. `inspectOperatingFile` validates an imported original; `operatingFileSummary` omits only encoded content from its index, while the saved plan continues to retain it.

The public implementation imports only its original `catalog.mjs` dependency. The Return engine imports this Plan engine. Their `.d.mts` declarations and source-owned guides travel with the same discovery component; the Runtime browser explicitly serves both engines and the catalog through its existing asset map.
