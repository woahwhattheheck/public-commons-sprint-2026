# EvidenceForge — real repair demonstration

**Target duration: 2 minutes 50 seconds.** The published video must remain under
three minutes. See the [current competition contract](COMPETITION_CONTRACT.md)
and [submission description](SUBMISSION.md).

This is a recording and editing script. The final footage comes from the
actual native application, selected provider operation, and its retained
artifacts. The test build can be demonstrated locally; a separate public
server is not a prerequisite for capturing it.

## Story

Show a developer taking one flawed invoice importer through a scoped model
change, actual checks, review, and retained handover. Keep the original source
and result visible enough to understand the repair. The demonstration should
spend its time on this useful workflow.

| Time | Native application footage | Narration intent |
| --- | --- | --- |
| 0:00–0:15 | Open the invoice-import task and show its goal and original source. | Introduce the concrete importer problem and the reviewer who needs a usable fix. |
| 0:15–0:35 | Show the original failures and the allowed source file, named check, and write budget. | Explain what a successful change must handle and what the model may change. |
| 0:35–1:00 | Dispatch the actual Nebius operation or show its continuous recorded dispatch. Show the real selected NVIDIA model and resulting operation ID. | Explain where the model contributes. Leave credentials outside the recording. |
| 1:00–1:40 | Open the returned patch and actual named-check outcome. Inspect the relevant source change and case results. | Explain what the model changed, and report exactly what the checker observed. |
| 1:40–2:05 | Open the corrected control for the same original task and compare its source and results. | Show that the comparison uses identical task inputs and checks; identify the control as authored code. |
| 2:05–2:35 | Reload or reopen the original retained operation, then open its patch/result download. | Show that the work remains usable after leaving the page and that reopening does not generate another model request. |
| 2:35–2:50 | End on the result and a short project card with the actual public source and build destinations. | State the delivered scope and the practical value of keeping source, change, and result together. |

## Suggested spoken text

Adapt result-dependent sentences to the operation actually captured. The
script is deliberately short enough to leave time to read the code and UI.

> This invoice importer has a small but consequential job: read a CSV, keep
> invoice identifiers unique, and handle amounts exactly. The task includes a
> byte-order mark in the header, duplicate identifiers after normalization,
> and decimal edge cases.
>
> EvidenceForge starts with that original source and its executable checks. I
> can see the file the model may change, the checks it must run, and the write
> budget before asking for a repair.
>
> This operation sends the source and observed failures to the NVIDIA model
> shown here through Nebius Token Factory. The returned plan is checked against
> the task's scope before it changes the disposable task copy.
>
> Here is the actual patch. These are the original checks running against the
> resulting source. [Explain the observed change and result in one sentence.]
>
> The corrected control uses the same task and the same checker. It gives us a
> concrete reference while we review what the model produced.
>
> I can reopen the original operation after leaving the page. Its source
> change, check results, and downloads stay together. Reopening reads that
> saved work; it does not make another model call.
>
> EvidenceForge supports these small Python repair tasks today. It gives a
> reviewer a usable change and an inspectable record of what ran, ready for a
> human decision about the next integration.

## Capture once and retain the useful footage

Use the same native workflow already being run to exercise the delivered
product. Keep an uncut recording of its important transitions and the original
operation artifacts. There is no need to spend another inference request just
to improve the edit.

Before capturing the provider step, frame the browser so account menus,
credentials, internal coordination, and unrelated work are outside the shot.
Show the actual model and response metadata in the result view. The curated
invoice task is suitable public material; do not replace it with private
customer data for visual interest.

If a provider wait is shortened in the final edit, label the cut as elapsed
waiting time. If footage opens an already completed operation, label it as a
retained run. Keep failures visible when they explain the actual result. Do
not join an unsuccessful model patch to a successful authored control and
present them as one operation.

The browser recording should make the changed source and check outcomes
legible at ordinary playback size. Use simple cuts and concise captions. No
music or third-party visual material is needed.

## Edit and publication record

Retain the submitted commit, operation ID, actual response model, and source
video filename with the edit. Record the final file's measured duration and
SHA-256. Inspect the start, each cut, the patch/result view, and the end card
from the encoded file before publishing it through the existing account.

Use the real public build and source URLs on the final end card. After upload,
open the YouTube watch page without relying on private access and confirm the
final video plays. Copy that exact URL into the existing Devpost entry and
record it in [SUBMISSION.md](SUBMISSION.md). The publication record belongs to
the uploaded video, not to this storyboard.
