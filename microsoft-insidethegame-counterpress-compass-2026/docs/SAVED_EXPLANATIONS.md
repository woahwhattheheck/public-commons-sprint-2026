# Saved explanation review

The player can open a retained Agent Framework explanation in a dedicated review
at **/insight-review**. This view reads the original saved match package and uses
the existing event engine to display the exact prefix that supported the answer.
The complete explanation remains unchanged. It is useful after reopening a match,
sharing a saved-match link, or importing the complete portable match JSON.

## Open and use the review

At the explanation's original event position, choose **Inspect saved explanation**
under the player's saved tool-assisted result. A result that has not yet been
retained shows **Save match and inspect**. If the original archive is shared or
the current review has a revision conflict, the existing copy flow is labelled
**Save a copy and inspect**.

The save uses the same archive UI, revision checks and collection as the player.
Navigation occurs only after the exact selected insight exists in the returned
saved review. A match switched during the write cannot receive the old
navigation. An unsuccessful save leaves the current review in the player.
Already saved explanations can be opened in another tab through their ordinary
link without changing the current draft.

The **Saved matches** section also links to the review's landing page. Paste a
saved-player link, a saved-explanation link, or an archive ID. The page can list
the current browser's existing collection; it does not create a collection key.
Read-capability links work without membership in that collection.

The main view contains:

- The original saved caption and explanation, with its recorded event count,
  focus club, language and match clock.
- The detected sequence's original loss, pressure actions and closing event.
  Each play links back to the existing player at that exact event count.
- The actual executed tool calls, followed by the saved answer. The separate
  provider-turn count comes from the retained turn trace.
- The two tools available to the original cp-agent-insight-v1 workflow:
  get_match_state and get_latest_moment. Each is marked with its actual retained
  call count. An available tool is not presented as an executed tool.
- Context reconstructed from the original event prefix using makeSnapshot:
  recorded statistics, the latest sequence, and the last 30 recorded plays.
  Later match events do not enter this reconstruction.
- Expandable original source, SDK, operation and provider-turn identities.
  Full provider response files are not included in the match archive; the view
  does not describe reconstructed context as a literal tool-response file.

**Open this match position** restores the player at the answer's exact count and
view. **Open at the loss** and the individual play links restore that same saved
match at the requested source event. These are the existing paused ArchiveLink
replays. Their playback, stream recovery, player recap selection and stop-at
behavior remain with the original player.

Copying an explanation link preserves both the archive ID and the selected
insight ID. The complete match download uses the exact export response that was
read by the view. The smaller explanation JSON download includes the complete
selected retained-insight record.

## Source and HTTP contract

The only new server entries are three static routes:

| Route | Source |
| --- | --- |
| /insight-review | web/insight-review.html |
| /insight-review.js | web/insight-review.js |
| /insight-review.css | web/insight-review.css |

The page imports the existing /engine.mjs and /archive.js modules. It does not
add a server session, archive store, model endpoint or request journal.

A selected URL has a fragment of this form:

    #archive=<original archive ID>&insight=<retained insight ID>

The insight selection is optional when opening a match for the first time. The
view chooses its latest retained tool-assisted result, or latest retained
explanation if no tool-assisted result exists. A specifically requested missing
insight produces a visible unavailable result and an explicit choice to open
other saved explanations; it does not silently substitute another answer.

GET /api/archives/:id/export returns the existing
counterpress.match.v1 package with immutable match events and review.insights.
The original archive implementation validates the retained-insight source
binding. The view additionally checks the recorded scenario, seed, prefix count,
last event ID, frame time and detected moment against that selected package
before displaying the answer. It uses only the original prefix for its context.

GET /api/archives is used only when this browser already has its original
counterpress.library.v1 key. The existing X-Counterpress-Library header remains
inside that same-origin request. The page never calls /api/opus-agent-insight,
/api/opus-insight, archive creation, or match-session creation. Loading, changing
an explanation, downloading and following source plays do not issue a new model
request.

All incoming text is inserted with textContent. Static script/style imports
respect the original self-only CSP. Match and insight identities remain in the
URL fragment. The page rejects other origins, malformed IDs and duplicate URL
parameters. An explicit new read cancels an older read and cannot show its
response under a newer selection.

## Receiving in the existing full programme

Use the existing complete match with its actual accepted insight. The original
accepted example has two provider turns and one get_match_state call; it did not
execute get_latest_moment. Do not prefill the interface with a second tool call
or an invented answer. Its five source plays are taken from the retained match,
not generated for this view.

The root integrated player/coach/broadcast recorder owns browser receiving.
Useful DOM contracts for that one operation are:

| Element | Purpose |
| --- | --- |
| [data-insight-review="<insight ID>"] in the player | Open or save the selected actual result |
| #matchAddress and #openMatch | Open a retained package through its saved link |
| #insightSelect | Select another retained explanation in the same package |
| #answerCaption and #answerText | Exact saved answer text |
| #answerReplay and #sequenceReplay | Exact player source-position links |
| #sourcePlays [data-event-id] | Ordered original sequence evidence |
| #executedActions [data-tool] | Executed tools only |
| #toolCapabilities [data-tool][data-executions] | Available tools with actual counts |
| #providerTurns | Original retained provider-turn trace |
| #contextDetails | Original-prefix statistics and recent plays |
| #sourceDetails and #recordJson | Complete optional identity and record detail |
| #copyExplanation, #downloadMatch, #downloadExplanation | Existing-source sharing and receiving |
| #inspectionStatus | Read, source-selection and copy outcome |
