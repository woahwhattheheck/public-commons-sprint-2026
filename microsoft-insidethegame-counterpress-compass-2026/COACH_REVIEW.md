# Coach review

Open **Compare saved matches** in the player's Saved matches section, or visit
`/coach-review` on the same running app. The workspace compares two to four
retained original matches and follows their press outcomes back into the player.

## Use the workspace

1. Select saved matches in the left column. The first selected match is the
   baseline. Set each observed event cutoff, or choose **All events**. A new
   collection can use **Save two demonstration matches**, which saves the
   original high-press and low-block scenarios at seed 2026 into the same archive.
2. Choose team, whole observed match or half, coach/fan view, and English/Spanish.
   Compare to see original engine totals and differences from the baseline.
   Choose an observed player to add their actions, distinct sequence involvements,
   pooled results and match-by-match half context. The outcome filter selects
   the playlist while the summary continues to describe that player and half.
3. Open a press moment. Each source event links to its exact retained event
   prefix. **Replay this outcome** opens the first frame where that outcome was
   known. Expired windows show the later event that actually closed the window;
   the next observed event is available only if it is within the chosen cutoff.
4. Write coach notes and save them, or save a moment. Both update the original
   match review with its existing revision guard. A saved moment points to the
   closing event so reopening it shows the classified outcome. Notes, native
   bookmarks and the player's saved position stay in the original archive.
5. Name and save a comparison to reopen its match selection, cutoffs, team,
   language, half, player and outcome in this browser. **Save and download complete review** saves
   pending notes for those matches and downloads the original match packages
   together with the comparison selection. Import that file in another browser
   to recreate editable matches and the same comparison. **Save and download
   coaching brief** saves pending notes and downloads a standalone HTML review
   with the original selected event prefixes and an offline playlist player.

## Coach an individual player

Choose a player from the selected club's observed events. Each row reports the
actions that player actually performed and their participation in distinct team
loss windows. A player can help in several ways in the same window; the window
still counts once. A successful team window involving a player and an event
where that player regains the ball have separate labels and counts.

The summary pools original counts across the selected matches. For example,
a resolved-sequence rate is the sum of successful involved windows divided by
the sum of successful plus expired involved windows. It does not average the
displayed match percentages. Club press frequency and regain efficiency remain
available as context, alongside the player's involved windows. Selecting an
outcome changes the playlist, leaving the player-and-half summary intact.

Open the first observed frame of a sequence or its last observed frame in the
original player. For an open window, the latter is the current observation
cutoff. Expired sequences keep both the eight-second deadline and the later
source event that establishes expiry. The source-case high-press loss at
`e632` illustrates partial observation: H6 is involved before closure; H10
enters the sequence only when their regain is observed at prefix 636.

**Save player playlist moments** retains the selected playlist's original
closing-event bookmarks in that match's existing review. Existing bookmarks,
coach notes, insights, broadcast data and revision checks continue through the
original archive. The player's recap selection is saved with the review.
Repeated closing events are saved once; the original 64-bookmark capacity
applies to the combined saved selection.

Saved comparison plans retain the player and outcome. A complete review export
carries the same choices together with all original match packages, including
events beyond the selected comparison cutoff so the editable source remains
complete. Importing an individual match package restores its saved recap
player, half and outcome. Older comparison files open with the whole-team
selection.

The HTML coaching brief works offline. It includes the selected prefixes,
player summary, each match's observed clock, coach notes, half context and the
exact sequence playlist. Its player steps through those original events and
shows the actual event count and match clock. Printing produces a compact
coaching document. When downloaded from a running workspace, it also retains
links back to those saved matches on that app.

Draft notes survive a page reload in this browser. If another viewer changes a
saved review, the archive returns its normal revision conflict and keeps the
local draft. Download the draft, or reload the newer saved notes and reconcile
the changes. An interrupted multi-match import remembers completed matches;
select **Import** again to resume. Before repeating an unanswered write, the
client checks newly saved matches for the exact exported match and review.
Reimporting the same completed file reopens its retained copies. If a retained
copy was removed, importing the file restores that match.

## What the comparison means

`src/coach_review.mjs` reads saved matches through `match_archive.mjs` and passes
their selected prefixes to the original `derive()` and `makeSnapshot()` exports.
The whole-match statistics are the native snapshot's statistics. Half views
group the native completed records by the **loss event's** half; an attempt that
starts before 45:00 and finishes after 45:00 belongs to the first half. The
engine still processes the full observed prefix, including the closing event.

- The regain rate is successful attempts divided by successful plus expired
  attempts, with the same rounding as the native player. Interrupted attempts
  and unsettled loss windows stay separate.
- A regain at the inclusive eight-second boundary remains eligible. Expiration
  requires a real event with a later timestamp; silence never closes a window.
- Unsettled losses are observed loss events without a completed native record
  in that half. They contribute to neither the resolved denominator nor the
  success rate.
- Individual action totals use each action's own event time. Sequence totals
  use the loss event's half. A loss before halftime and a regain after halftime
  therefore belong to different halves in those two measures.
- Counts and means describe the selected event prefixes. Different event cutoffs
  do not imply equal observation time. Each column displays its exact count and
  observed-through time.
- Source details include the original saved-match ID and SHA-256 of its
  normalized retained match object. The bundle keeps original event values,
  order, scenario, seed, notes, bookmarks and saved player state. Playlist
  identity includes the saved-match ID, source digest and sequence ID because
  the same event ID can occur in several matches with different outcomes.
  Copies of the same event source are identified in the coaching summary.

The synthetic match model follows the official
[Inside the Game rules](https://github.com/microsoft/insidethegamehackathon/blob/main/OFFICIAL%20RULES.md),
including the synthetic football-event requirement. The comparison needs no
provider calls and runs on the existing Node server.

## Integration

`POST /api/coach-review` accepts the existing browser's
`X-Counterpress-Library` header and a JSON body:

```json
{
  "matches": [{"id": "saved-match-id-a", "count": 941}, {"id": "saved-match-id-b", "count": 916}],
  "view": {"team": "Harbor FC", "audience": "analyst", "locale": "en"},
  "period": "all",
  "focus": {"player": "H10", "outcome": "success"},
  "title": "Pressing review",
  "export": true
}
```

The response `counterpress.coach-comparison.v1` contains source-linked moments,
native statistics, baseline deltas and original archive reviews. With
`export: true`, its `bundle` is a `counterpress.coach-review.v1` containing two to
four unchanged `counterpress.match.v1` packages plus comparison cutoffs, view
and optional `focus`. The response also includes `coaching`, a
`counterpress.player-coaching.v1` projection from the original recap module.
Its summary pools the original numerators and denominators; `playlist` holds
match-scoped exact event intervals. Original prefix arrays are included only
when `export: true`; ordinary comparisons use `sourceIncluded: false`.

`src/player_coaching.mjs` exports the projection, focus parser and standalone
HTML/JSON formatters. The HTML formatter requires complete selected source
prefixes. It uses no provider call, library or network request.
Individual original match packages can also be imported from the workspace.

## Four-match working example

Import `demo/player-coaching-four-matches-2026.json` in the existing workspace
to open H10 across high-press, low-block, end-to-end and late-siege at seed 2026.
The file contains all 3,726 original generated events in their normalized match
packages. Import creates ordinary editable saved matches.

From this project directory, regenerate the four individual packages, the
complete coach workspace, an offline brief and source observations:

```sh
node demo/export-player-coaching-case.mjs /tmp/counterpress-player-coaching
```

The exporter checks the recorded engine, generator and recap source identities,
then invokes the same package normalizers and comparison function as the app.
It reopens every exported package through the original normalizers. Its output
includes H10 and H6 in both halves and around prefixes 631–637 of high-press.
The JSON observations support local review; the brief and complete workspace
are the user-facing files. Generated timestamps vary; original seeded events
and the event accounting remain reproducible.

In this source case, H10 has 11 recorded regain actions and participates in
47 successful team sequences among 67 resolved involved windows: 70.1%.
H6 has seven regain actions and 28 successful team sequences among 54 resolved
involved windows: 51.9%. Both reports preserve the original event-time evidence.
Use the high-press halftime sequence `e529` to inspect the distinct action
and window time bases, and `e569` in low-block and end-to-end to inspect two
different match outcomes that share an event label.

The existing archive limits and access behavior apply: 64 matches per browser,
64 moments per match, 512KB per original package, 6000 characters per match note,
and shared-ID reads with owner-only writes. Comparison plans retain at most 24
named selections in browser storage. Complete reviews remain portable through
their JSON export; retain the existing `COUNTERPRESS_ARCHIVE_DIR` across server
restarts to keep the original collection available.
