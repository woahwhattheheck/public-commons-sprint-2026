# Player recap and observed evidence playlist

The player recap projects the existing engine's loss windows into a player and
half-by-half review. It uses the exact already-observed event prefix selected by
the original player. The underlying engine and its eight-second rule remain the
source of completed outcomes.

## Model and selection

Import **buildPlayerRecap**, **playerRecapJson** and **playerRecapHtml** from
src/player_recap.mjs.

The model accepts the original event array and:

| Option | Selection |
| --- | --- |
| team | Harbor FC or Metro Rovers, using the engine's TEAMS. |
| player | An observed original player label, or null for the whole team. |
| period | all, first or second. |
| locale | en or es. |

The result uses format **counterpress.player-recap.v1**. Its players list comes
from named actions throughout the provided prefix, keeping the selector stable
when the period changes. A saved selection without an observed action remains
explicit through selection.playerObserved and an empty selected result.

## Separate the two denominators

**Press frequency** is the number of observed loss windows with at least one
qualifying pressure divided by all observed loss windows. It includes a
still-open loss and any pressure already observed in that window. The numerator,
denominator and basis are explicit fields.

**Resolved regain efficiency** is successful recoveries after pressure divided
by successful and expired windows. Interrupted observations, open windows and
windows without a qualifying press are counted separately. A zero denominator
produces null.

The top-level teamStats supplies this team context. When a player is selected,
selectedStats uses only distinct windows containing that player's original
evidence actions; its scope is player_involved_windows. A sequence recovery
belongs to the team. successfulRegainActions counts only the selected player's
actual recovery action in a successful sequence.

Personal actions count original event rows, including losses, pressure actions,
regains, passes and shots. Sequence role totals count distinct windows. A player
may press twice in one window: that is two pressure actions and one sequence
with a pressure role. A new loss can interrupt an earlier window and begin its
own window; those are two distinct sequence roles attached to the one original
loss event.

## Preserve the half and observed-clock meanings

The existing coach convention assigns a loss before 2700 seconds to the first
half and a loss at or after 2700 to the second. Every completed sequence remains
in its loss's half, including evidence crossing the boundary. Raw action counts
use each action's own observed timestamp.

The first and second summaries retain both team and selected-player statistics.
comparison reports team frequency and regain-efficiency changes separately in
percentage points, with the underlying denominators in English or Spanish.

coverage retains the complete observed event count, action count excluding
clock markers, first and last action times, current event-log time, period and
selected action counts, and the trailing time between the last action and the
latest event. A terminal 90-minute clock marker preserves the event stream's
clock; it does not extend the observed action coverage.

## Replay the exact sequence

Each sequence retains the canonical loss ID, status, original evidence IDs,
pressure count and observed recovery time.

| Field | Original playback meaning |
| --- | --- |
| startCount | Number of events before the loss; the clip begins at this prefix. |
| lossCount | Prefix including the original loss. |
| endCount | Prefix showing the actual closing event, or the latest observed prefix for an open window. |
| endEventId | Actual event ending that prefix. |
| closureEventId | Actual closing event, or null for an open observation. |
| evidence | Original canonical event rows, their exact counts and roles. |
| watermark | First actual event strictly after an expired window's endpoint. |
| nextObserved | The next event already present in the supplied source, when available. |

Success and interruption end on the final original evidence ID. Unattempted
windows closed by a regain or new loss use that original final evidence;
unattempted expiry uses the first strictly later event. At the inclusive
eight-second boundary, the window stays open until the engine sees its actual
closing event or a strictly later watermark.

Pending records represent observed losses the canonical engine has not yet
closed. Their evidence includes the original loss and qualifying observed
pressure actions. They retain the explicit deadline, observed-through time,
current endEventId and null closureEventId.

## Portable outputs

The JSON export retains the complete recap, exact provided source prefix,
selected original action rows and full sequence evidence. It is deterministic
for the same event source and selection. The HTML export is a standalone
English or Spanish report with team context, player actions and roles,
half-by-half denominators, every selected sequence and the complete original
event log. Optional title, scenario and seed arguments label the report without
changing the model.

The original saved-match package remains the native replay and archive format.
Recap preferences and source-prefix selection travel through that existing
player and archive workflow.

## Open the included player review

Use **Import match** with
[demo/player-recap-high-press-2026.json](demo/player-recap-high-press-2026.json).
This complete saved review contains the original 941-event high-press match,
H10's 18 successful-sequence bookmarks, the H10 selection and the success
filter. It opens just before the selected 52:44.6 loss.

Choose **Play sequence** on that selected item. The original player replays
events e632 through e636 and pauses at H10's 52:49.6 regain. The recap preserves
the already-observed complete match while the replay is at an earlier frame.
Save and reopen, or download and reimport the match, to keep the same player,
filter, selected sequence, observed source range and exact bookmarks.
