# Broadcast handover

The broadcast workspace turns a saved Counterpress match into an editable caption rundown. It uses the existing match archive, original events and eight-second counterpress engine. Its deliverables are a complete editable match, an independently readable HTML handover with event replay, and WebVTT captions for an edited recording.

## Open a match

Run the existing application with:

    node src/server.mjs

Open **Broadcast handover** beside **Compare saved matches**, or visit /broadcast-handover.

Choose a saved match and select **Open match**. The workspace uses the same browser collection as the player and coach workspace. **Import match** accepts the original Counterpress JSON package, including packages with saved tool explanations and player recaps.

The handover initially uses the saved replay cutoff, club, audience and language. **Through event** selects the original event prefix available to the editor. **Use full match** explicitly includes the complete saved match. Update the source choices after changing a cutoff. If existing captions refer to later events, retain the original cutoff or remove those captions before shortening it.

## Write the caption rundown

Give the handover a title and add production notes. Choose the source view for new caption suggestions: team, fan or analyst, and English or Spanish.

**Source plays** offers completed press sequences, shots, regains, pressure actions, passes, possession losses and saved moments. The player filter uses the labels present in the original match. Each choice shows its match clock, original event ID and replay count. **Open original play** opens that exact match event in the existing player.

**Add caption** copies a source-derived suggestion into an editable rundown. Edit the text, reorder captions, or include the same source play again when the recording revisits it. Changing the source team, audience or language preserves already-authored captions. Every cue retains its own original team and event identity.

A press caption is bound to the exact original event that establishes the result:

- A regain or interrupted observation uses its original closing event.
- An expired press uses the first original event strictly after the eight-second deadline.
- A regain exactly at eight seconds retains the original engine's successful outcome.
- A source prefix that ends before a press closes does not offer that result yet.

The evidence drawer shows the loss, pressure actions and closing event, with an explicit later watermark when one is needed. Team metrics reuse the original engine. Regain rate uses successful plus expired attempts as the denominator; interrupted attempts retain their separate status.

## Place captions in a recording

Open a video using **Open local recording**. The browser plays the selected local file; the application receives its name, duration and the caption positions you save. Reopen that local recording after returning to a saved handover.

For each caption, enter **Video in** and **Video out** in seconds, or move the video playhead and use **Use playhead** beside each field. **Preview video position** seeks to the selected in point. The recording panel displays the captions scheduled at its current playback time.

Match clock and video time are separate values. A play at 52:49.6 in the match can appear at 38.250 seconds in a highlights recording. Caption times are never inferred from match seconds, replay speed, elapsed browser time or the event count.

Leave both timing fields empty to retain an unscheduled caption. Supply both when placing it. The out point must be later than the in point and fit the recording's saved duration when that duration is supplied. Times are retained to milliseconds. Overlapping captions preserve the editor's explicit timing and are supported by WebVTT.

## Save, reopen and work across tabs

**Save handover** stores captions and recording metadata in review.broadcast in the original match archive. It retains the match, notes, bookmarks, saved tool explanations and player recap. The original private archive directory and revision checks remain the persistence mechanism.

The editor retains unsaved drafts in its browser. It attempts to save before opening another match. A shared review supports **Save a copy**, which creates an editable archive in the current browser's collection.

If another tab changed unrelated notes or a player recap while the broadcast field stayed unchanged, the editor refreshes those fields and composes its caption change once. If the broadcast itself changed, both versions remain available: save the local work as a copy or download it before reloading the saved version.

Older player clients that omit the broadcast field when updating their own review retain the existing broadcast. Current player copies and downloads carry the complete review before projecting their controls. An explicit broadcast: null clears the saved field through the original revision-controlled API.

## Deliver the handover

### Editable match · JSON

This is the existing counterpress.match.v1 package. It contains the complete original event array, original review and insights, player recap when present, and the caption rundown. Import it through the player or broadcast workspace on another installation to continue editing.

A download uses the editor's current captions and the archive's current other review fields. Local caption edits remain downloadable while a conflicting saved caption revision is being reconciled.

### Readable handover · HTML

Open the exported HTML directly in a browser. It includes the handover title and notes, selected team metrics and observed coverage, caption rundown, video timings, original evidence and an event replay. The replay walks the complete original event array, with exact event clocks and selected captions at their bound events.

The page contains **Download editable match**, which extracts its embedded original package, and **Download timed captions**, when timing exists. The recipient can read the handover and review the event sequence without a running server. Importing the extracted package into Counterpress restores the complete original player and editable review.

### Timed captions · WebVTT

WebVTT includes the captions with both video positions supplied, sorted by those positions. Unscheduled captions remain in the JSON and HTML handovers. The exported text escapes markup while preserving authored wording and line breaks; event IDs remain attached in the full handover.

## HTTP and source integration

| Interface | Behavior |
| --- | --- |
| POST /api/broadcast-handover | Read an original saved match and project caption choices and a handover |
| {id} | Open the saved broadcast, or initialize it from the saved review |
| {id, broadcast} | Validate and preview current editorial choices against the immutable match |
| {id, broadcast, format: "match"} | Download the complete editable match package |
| {id, broadcast, format: "html"} | Download the standalone readable handover |
| {id, broadcast, format: "vtt"} | Download captions with explicit recording positions |
| Existing PUT /api/archives/:id | Save the whole review at its expected revision, including broadcast |
| Existing archive import/export | Carry the same field through the original portable workflow |

Read and export use the original shared archive capability. Saving uses the existing browser library key. The handover route projects the retained match and returns the requested format; the original archive remains the sole saved store.

review.broadcast has format counterpress.broadcast.v1. It contains title, notes, count, view, recording and cues. Each cue contains a stable id, exact eventId and count, optional momentId, authored caption, and nullable videoStart / videoEnd. The whole review retains the original 96 KiB request limit; the match package retains 512 KiB. Up to 64 captions are supported, with 500 characters of text each.

| Source | Responsibility |
| --- | --- |
| src/broadcast_handover.mjs | Original-source projection, caption normalization, HTML and WebVTT |
| src/match_archive.mjs | Saved-field normalization and older-client preservation |
| src/server.mjs | Existing-server route and asset integration |
| web/broadcast-handover.html / .js / .css | Bilingual editor, recording preview and delivery |
| web/archive.js | Preserve the full current review in player copies and exports |
| web/index.html | Entry from the existing saved-match workspace |

The source uses the competition's original synthetic match schema. Official project requirements and dates remain in [Microsoft's official rules](https://github.com/microsoft/insidethegamehackathon/blob/main/OFFICIAL%20RULES.md).
