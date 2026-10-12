# Counterpress Compass

Counterpress Compass turns a live stream of synthetic football events into match review and broadcast stories. Follow possession changes, inspect pressing sequences, build a player recap, compare club performance and prepare an editable caption rundown from the same original match.

The original Node/HTTP/SSE application runs locally with no package installation or provider call. It supports casual and analyst views in English and Spanish, independent viewer sessions, saved match collections, exact event bookmarks, and portable match packages. Player-focused recaps keep observed actions, half-by-half club context and a replay playlist in the same saved review. The broadcast workspace builds personalized story drafts, retains authored captions and recording times, and exports an independent HTML handover, editable match and WebVTT captions. The Microsoft Inside the Game competition specifies football-realistic synthetic events; Harbor FC, Metro Rovers and their players are invented.

## Run the application

Requires Node.js 22 or newer.

```sh
node src/server.mjs
# Open http://127.0.0.1:3167
```

Choose a match situation and seed, select your club, then use **Play**, **Next play**, or the timeline. The scenario generator produces the same event sequence for the same scenario and seed within that application version. Each browser controls its own session.

The default listener is `127.0.0.1:3167`; `HOST` and `PORT` select an operator's existing service interface. Saved matches use a private directory under the current user's data directory. Set `COUNTERPRESS_ARCHIVE_DIR` to an absolute persistent directory when running a container or service:

```sh
COUNTERPRESS_ARCHIVE_DIR=/absolute/private/counterpress-matches node src/server.mjs
```

The directory is created with mode 0700. Keep it on a persistent volume across server replacements. One original Node server owns each archive directory.

## Watch, understand, save and return

1. **Choose the situation.** High press, low block, end-to-end transitions and a second-half push provide different generated match patterns. Both clubs use the same underlying events.
2. **Find the moment.** Filter key moments by outcome or half. Select one to see the observed loss, pressure and closing play in the **Press sequence** panel.
3. **Replay its outcome.** The replay button requests the exact original event prefix from the server. Successful recovery, elapsed windows and interrupted observations keep their separate meanings.
4. **Save the review.** Use **Save this moment** in the sequence panel, or **Save match** in the saved-match area. Give the match a title, add coach notes and annotate the saved moments. Edits and the confirmed replay position save automatically.
5. **Return or share.** Open the match from your collection after a server restart, or use **Copy match link** to open an independent paused replay. A saved-match link includes its saved notes. A recipient can save a separate editable copy.
6. **Take the match with you.** **Download match** preserves the complete original event array, notes, bookmarks and viewing preferences. **Import match** opens that package in the same native player, with a new collection entry.

Saved replays retain the actual event rows, so they continue to use the saved input when the scenario generator changes. Existing unsaved scenario/seed links continue to reconstruct their generated match. See [Saved matches and reviews](SAVED_MATCHES.md), [Tactical film room](TACTICAL-FILMROOM.md) and [Match links](MATCH-LINKS.md).

The interface uses native keyboard controls and a neutral industrial layout. Space or K toggles playback and Right Arrow advances a play when focus is outside a control. Every saved moment opens its precise original frame.

## Follow a player and build a replay playlist

The **Player recap and replay playlist** section uses the plays already observed in the current match. Choose a player from your club, a half and an outcome. It separates the player's actual loss, pressure, regain, pass and shot actions from involvement in distinct club sequences.

Each sequence opens its original outcome or plays from immediately before the loss through the actual closing event. The playlist stays available while the match is rewound. **Save playlist moments** stores the selected sequence endpoints through the existing saved-match controls; player, half, outcome and the observed position return when the review is reopened or imported.

The half comparison shows press frequency against observed losses and regain efficiency against resolved attempts. The clock and last recorded action are displayed separately. Download a complete source-linked JSON recap or a printable standalone HTML report; the ordinary match download continues to provide the full portable replay. See [Player recaps](PLAYER_RECAP.md).

## Coach a player across saved matches

Open **Compare saved matches** from the player, or visit **/coach-review**. Choose two to four saved matches and set each observed event cutoff. The first selected match is the comparison baseline. Team, half, player and outcome controls use the same retained events as the match player.

The comparison separates a player's performed actions from participation in distinct club sequences. Its summary pools the original counts across matches. The outcome filter selects the replay playlist; the player and half summary remains visible with each match's observed clock. Open any sequence at its original start or closing event to inspect what was known at that point.

Write match notes, save playlist moments and name the comparison. Notes and bookmarks save in the original match archive; named comparison selections return in the same browser. **Save and download complete review** includes all selected original match packages, their cutoffs and the comparison choices. Import it into another installation to continue with separately editable matches.

**Save and download coaching brief** produces a standalone HTML report with the selected original event prefixes and an offline sequence player. The brief keeps player totals, half context, match notes and source details together for coaching discussion or printing.

For a complete working example, import [the four-match H10 review](demo/player-coaching-four-matches-2026.json). It includes 3,726 original events from high press, low block, end-to-end transitions and a second-half push. Choose H10, change the half or outcome, replay an original sequence, save notes and playlist moments, then export the editable review and readable brief. See [Coach review](COACH_REVIEW.md) for the full workflow and API.

## Inspect a saved explanation

Open **Inspect saved explanations** from the saved-match section or the result in the player. The dedicated review shows the exact retained answer, its original source plays, the executed tools and the recorded provider turns. Each source link reopens that saved match at the selected event. See [Saved explanations](docs/SAVED_EXPLANATIONS.md).

## Prepare a broadcast story

Open **Broadcast handover** from the saved-match controls, or visit **/broadcast-handover**. Choose a saved match or import its complete package. The handover starts at the saved replay cutoff; **Use full match** explicitly makes the entire retained match available.

**Build a personalized rundown** prepares a short story for the selected team and player. Choose the observed match or a half, **Match story** or **Recovery highlights**, and the number of plays. The draft uses the existing recap's original sequence outcomes, player roles and closing events. It presents the chosen plays in match order, with a caption, a selection reason and links to the original start and outcome.

Review the suggestions and use **Add selected plays** to insert them together. Existing caption text, order and recording times stay editable. **Use story title and summary** applies the suggested title and adds the source-period context to the production notes. You can also add individual pressing sequences, player actions or saved moments. Each cue keeps its original team, including mixed-team selections and windows closed by a later opposing play.

Open your local recording, then set each caption's video in and out points. The video plays on your device; the saved handover retains its filename, duration and your timing choices. Video time and the original match clock remain separate so the rundown can follow an edited highlight reel.

| Delivery | What the recipient gets |
| --- | --- |
| Editable match · JSON | Complete original events, review, saved tool explanations, player recap and authored broadcast cues |
| Readable handover · HTML | An independent document with captions, original evidence, team context, event replay and editable-match download |
| Timed captions · WebVTT | Captions placed at the in and out points you selected in the recording |

**Save handover** retains the rundown with the existing match. **Save a copy** creates a separately editable match in your collection. Reopen a saved handover or import its downloaded JSON to continue production. Saving a rundown also preserves newer player recaps, bookmarks, coach notes and retained explanations. If another viewer edits the same broadcast draft, the editor keeps your local changes available to reconcile. See [Broadcast handover](BROADCAST_HANDOVER.md) for the complete editor and API guide.

### Try the included H10 story

Import [the retained high-press match](demo/player-recap-high-press-2026.json) in the match player. It contains all 941 original events, the H10 replay selection and its saved playlist. The player opens immediately before the loss at 52:44.6. Replay the sequence to the original H10 recovery at 52:49.6.

Open that saved match in **Broadcast handover**, select **Use full match**, then build five **Recovery highlights** for **H10** over the **Whole observed match**. The generated story includes plays across both halves, including the same 52:44.6–52:49.6 recovery. Preview its original evidence, add the selected captions and edit them for your recording. The complete walkthrough and five original sequence intervals are in the [operator guide](BROADCAST_HANDOVER.md#existing-h10-example).

## What the match model means

The engine observes an eight-second window after a club loses possession. A same-team pressure action followed by a same-team regain at or before the deadline is a successful counterpress. The deadline is inclusive: another event at exactly eight seconds may still contain a valid regain.

A later timestamp strictly beyond the deadline establishes expiry. A new same-team loss before resolution interrupts the earlier window; its outcome remains unknown. Missing events and incomplete streams do not establish a failed press. The resolved-window rate uses only successful and expired windows, with interrupted attempts counted separately.

Each explanation retains its original event IDs and observed time. A following pass or shot supplies context; it does not establish that the press caused the next action. The feed records pitch thirds rather than exact player coordinates, and shots rather than a goal scoreline.

The runtime shares incremental accounting and bounded replay checkpoints across views of an immutable event array. It uses the same original snapshot contract for playback, backward seeking and restored matches. [Playback runtime](PLAYBACK_RUNTIME.md) documents the integrated MS15 implementation.

## Recover playback

A temporary SSE drop keeps the last confirmed event and shows **Reconnecting**. **Resume match** refreshes that exact prefix and resumes the ordered stream. Malformed, out-of-order or different-session frames stop before changing the current match.

When an ephemeral session has expired, saved matches restore their retained event array into a new native session. An unsaved generated match recovers its original scenario and seed. Changing sessions or opening another saved match flushes pending review edits first. A failed save leaves those edits available for retry, a separate copy or a portable download.

## Optional Microsoft Foundry and Opus commentary

The original server includes an optional Microsoft Foundry Azure OpenAI REST adapter. Configure an existing authorized deployment through server environment variables:

```sh
AZURE_OPENAI_ENDPOINT='https://YOUR-RESOURCE.openai.azure.com' \
AZURE_OPENAI_DEPLOYMENT='YOUR-DEPLOYMENT-NAME' \
AZURE_OPENAI_API_KEY='SERVER_SIDE_KEY' \
node src/server.mjs
```

The browser never receives the provider credential. Foundry drafts run only from the explicit commentary action and use the existing per-process admission controls. The separate optional Opus route keeps its original configuration and budget behavior. Generated commentary stays separate from the canonical event-derived captions and outcomes. Replay, archival, bookmarks, imports and exports make no provider requests.

For an operator's public judge service, use its existing HTTPS hosting and appropriate access and cost controls. The default launch is a local application. The optional services' configured state is available in `GET /health`; the actual demo capture records which services were configured during that run.

Relevant implementation guides: [Foundry admission](FOUNDRY_ADMISSION.md), [Foundry grounding](FOUNDRY_GROUNDING.md), and [Microsoft's REST specification](https://learn.microsoft.com/en-us/rest/api/microsoft-foundry/azureopenai/chat?view=rest-microsoft-foundry-v1).

## Microsoft Agent Framework tool explanations

The optional **Explain with tools** action uses the pinned Microsoft Agent Framework 1.21.0 worker to explain the exact observed match. Its two local tools expose the current match state and counterpress moment to the operator's existing guarded model runner. The player retains the completed caption, explanation and original tool/provider records with that match.

Follow [Microsoft Agent Framework setup and operation](AGENT_FRAMEWORK.md) to configure the equipped worker, request an explanation and retain its original job. The same guide includes a command for receiving an already completed worker result as an ordinary portable match. [Retained match insights](RETAINED_INSIGHTS.md) covers saved-frame reopening, coach comparisons, archive restart and delivery to another installation.

Coaches use the existing **Saved matches**, **Coach review**, export and import controls for the complete event log, notes, bookmarks and explanations. A recipient can reopen the saved explanation in the Node application from the retained package.

## Competition and running-product demo

Microsoft's [official Inside the Game rules](https://github.com/microsoft/insidethegamehackathon/blob/main/OFFICIAL%20RULES.md) require registration by **October 20, 2026 at noon Pacific** and submission by **October 27, 2026 at 11:59 PM Pacific**. Delivery includes public source, a public video under two minutes demonstrating actual functionality, and free functioning access or a test build for judges. The solution must use permitted Microsoft technology and fit the entered category.

The [complete recorder](demo/README.md) follows player → saved explanation → H10 recap/replay → coach comparison → automatic story draft → broadcaster editing → standalone delivery. It records the actual browser, closes it before encoding, restarts the persistent application, attaches the actual encoded clip and receives the complete editable review in an independent browser collection. Include the configured Microsoft tool workflow in the running-product demonstration.

## Source map

| Source | Responsibility |
| --- | --- |
| `src/scenarios.mjs` | Seeded football-realistic synthetic event generation |
| `src/engine.mjs` | Event-time accounting, explanations and incremental replay timeline |
| `src/live_sessions.mjs` | Independent session lifecycle, retained-event restoration and native frames |
| `src/server.mjs` | HTTP/SSE player, archive APIs and optional commentary routes |
| `src/match_archive.mjs` | Durable original matches, review revisions and portable packages |
| `src/player_recap.mjs`, `web/player-recap.js` | Original player roles, half context and replay playlist |
| `src/coach_review.mjs`, `src/player_coaching.mjs`, `web/coach-review.js` | Match comparisons, pooled player outcomes, saved plans and portable coaching briefs |
| `src/broadcast_rundown.mjs`, `web/rundown-builder.js` | Personalized story selection, source preview and bulk caption insertion |
| `src/broadcast_handover.mjs` | Source-bound captions, saved review normalization and HTML/WebVTT delivery |
| `web/broadcast-handover.html`, `.js`, `.css` | Bilingual broadcast editor, local recording and portable handover |
| `src/retained_insight.mjs` | Original insight continuity and saved source binding |
| `web/insight-review.html`, `.js`, `.css` | Saved answers, executed tools, provider turns and links to original plays |
| `src/opus_agent_bridge.mjs`, `counterpress/microsoft_agent_worker.py` | Microsoft Agent Framework tool workflow and original guarded runner |
| `src/receive_agent_insight.mjs` | Complete original worker-output receiving into a portable match |
| `web/app.js` | Pitch, play-by-play, frame controls, personalization and sequence review |
| `web/archive.js` | Saved collections, autosaved notes, bookmarks and shared replay workflow |
| `web/index.html`, `web/style.css` | Responsive industrial interface |
| `demo/capture.mjs` | Actual running-product browser capture |
| `data/events.json` | Original handcrafted synthetic fixture retained for compatibility |

The stateless `/api/analyze` and historical `/api/evidence-export` routes remain available for the bundled handcrafted fixture. The current player uses session frames; portable saved matches use `/api/archives/:id/export`.

## Attribution

Developed by TokenJunkieLabs Commons contributors. The source is MIT licensed; contributor attribution is retained in the repository history. Teams, players, events and presentation artwork are original synthetic material.
