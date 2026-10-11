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
3. Open a press moment. Each source event links to its exact retained event
   prefix. **Replay this outcome** opens the first frame where that outcome was
   known. Expired windows show the later event that actually closed the window;
   the next observed event is available only if it is within the chosen cutoff.
4. Write coach notes and save them, or save a moment. Both update the original
   match review with its existing revision guard. A saved moment points to the
   closing event so reopening it shows the classified outcome. Notes, native
   bookmarks and the player's saved position stay in the original archive.
5. Name and save a comparison to reopen its match selection, cutoffs, team,
   language and half in this browser. **Save and download complete review** saves
   pending notes for those matches and downloads the original match packages
   together with the comparison selection. Import that file in another browser
   to recreate editable matches and the same comparison.

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
- Counts and means describe the selected event prefixes. Different event cutoffs
  do not imply equal observation time. Each column displays its exact count and
  observed-through time.
- Source details include the original saved-match ID and SHA-256 of its
  normalized retained match object. The bundle keeps original event values,
  order, scenario, seed, notes, bookmarks and saved player state.

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
  "title": "Pressing review",
  "export": true
}
```

The response `counterpress.coach-comparison.v1` contains source-linked moments,
native statistics, baseline deltas and original archive reviews. With
`export: true`, its `bundle` is a `counterpress.coach-review.v1` containing two to
four unchanged `counterpress.match.v1` packages plus comparison cutoffs and view.
Individual original match packages can also be imported from the workspace.

The existing archive limits and access behavior apply: 64 matches per browser,
64 moments per match, 512KB per original package, 6000 characters per match note,
and shared-ID reads with owner-only writes. Comparison plans retain at most 24
named selections in browser storage. Complete reviews remain portable through
their JSON export; retain the existing `COUNTERPRESS_ARCHIVE_DIR` across server
restarts to keep the original collection available.
