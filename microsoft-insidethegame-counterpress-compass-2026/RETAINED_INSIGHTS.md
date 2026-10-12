# Retained match insights

Counterpress carries a completed model explanation with the original saved match. A coach can return to the same event, compare it with another saved match, or hand the complete match package to a colleague. The explanation stays attached to the observed events and the chosen club, audience and language.

## Use the existing player

1. Start or reopen a match and pause at a counterpress moment.
2. Choose the club, fan or analyst view, and language before requesting the optional insight.
3. Select the existing insight button. Match playback, the deterministic caption and the press sequence remain usable while the original provider completes its work.
4. Save the match. If the match is already saved and editable, the existing review autosave includes the completed insight.
5. Return to that exact frame and view. The same button opens the saved explanation.
6. Open the existing coach review and choose two to four saved matches. Explanations whose original moment is in the selected observed prefix and half appear beside that match's source events and notes.
7. Export the match or coach review through the existing controls. The original events, notes, bookmarks and retained explanations travel in the same package. Import that package in a fresh receiver and open its original frame.

A change of club, audience, language or observed event is a different view. Counterpress shows an explanation at the exact view for which it was produced. It never projects a later explanation onto an earlier match prefix.

## Storage and restart

Keep `COUNTERPRESS_ARCHIVE_DIR` on a private persistent volume and run one application server per directory, following the original saved-match deployment. Saved matches stay in the existing archive. The `insights/` subdirectory carries the original commentary operation identity and completed response across application restarts.

Before the server asks its provider to do work, it saves the original provider session ID under a key derived from the provider edition and the complete observed-prefix identity. A newly opened player session reuses that provider identity. The provider remains responsible for its model request, tools, admission and completed job records.

Back up the complete archive directory with its private permissions. Retain the provider's original job directory alongside it according to the provider's operator guide. A completed exported match can reopen its saved explanation without a configured provider. The recipient continues to use the original replay and coach controls.

If the commentary store cannot save the original operation identity, the request returns a storage error before provider dispatch. If storage fills after the provider finishes, the ready response remains available in the current server and can be saved into the original match package; the response marks `durable: false` until its continuity record is written. Preserve the completed provider job and free or move owned storage before restarting.

## Source binding

A retained explanation records:

- Match scenario and seed.
- Observed event count and latest event ID.
- Frame time and original counterpress moment ID.
- Club, audience and language.
- SHA-256 of the ordered original observed event values.
- Original provider operation, session, prompt edition and reported model.
- The completed caption, explanation and capture time.

Package import recomputes the original engine snapshot from the retained event prefix and verifies these bindings before the explanation joins the saved review. Unrecognized properties are discarded. The archive retains at most 24 explanations per match and keeps its existing package and review size limits.

Imported explanations belong to that imported review. They do not populate the shared provider completion cache or create a new model job.

## Existing interfaces

The existing saved-match format `counterpress.match.v1` gains the optional `review.insights` list. Existing packages without that list reopen with an empty list.

Each element has format `counterpress.retained-insight.v1`, a content-derived `id`, `source`, `response` and `capturedAt`. The original archive normalizes the record before saving or importing it. The complete original match package continues to be the portable customer artifact.

The existing coach comparison and export include the same retained records. A selected comparison exposes explanations only for matching club, audience and language and original moments within its selected observed prefix and half.

The continuity module's provider seam is `configured()` plus `request({sessionId, count, snapshot, events})`. Only the observed prefix is forwarded. The provider's ready response identifies the exact original request and supplies the original operation, edition, provider/model and completed text. The server rebinds only the visible player session ID when presenting the retained explanation to a reopened player.

## Native receiving record

The delivery record accompanies the joined Microsoft worker and application source. It identifies the actual original generated match, provider job, source editions and the completed player-to-archive-to-coach-to-restart operation.
