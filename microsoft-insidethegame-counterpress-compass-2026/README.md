# Counterpress Compass

Counterpress Compass turns a live stream of synthetic football events into a useful coach and fan review: follow possession changes, locate counterpress moments, inspect the original play sequence, compare the two clubs, and save the match with tactical notes for later replay.

The original Node/HTTP/SSE application runs locally with no package installation or provider call. It supports casual and analyst views in English and Spanish, independent viewer sessions, saved match collections, exact event bookmarks, and portable match packages. The Microsoft Inside the Game competition specifies football-realistic synthetic events; Harbor FC, Metro Rovers and their players are invented.

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

## Competition and running-product demo

Microsoft's [official Inside the Game rules](https://github.com/microsoft/insidethegamehackathon/blob/main/OFFICIAL%20RULES.md) require registration by **October 20, 2026 at noon Pacific** and submission by **October 27, 2026 at 11:59 PM Pacific**. Delivery includes public source, a public video under two minutes demonstrating actual functionality, and free functioning access or a test build for judges. The solution must use permitted Microsoft technology and fit the entered category.

The [original browser recorder](demo/README.md) launches the real application and captures its actual HTTP/SSE gameplay. Existing entrant and Microsoft integration owners retain their platform delivery and runtime work. Repository source, the captured local run and the provider's actual entry status are separate records.

## Source map

| Source | Responsibility |
| --- | --- |
| `src/scenarios.mjs` | Seeded football-realistic synthetic event generation |
| `src/engine.mjs` | Event-time accounting, explanations and incremental replay timeline |
| `src/live_sessions.mjs` | Independent session lifecycle, retained-event restoration and native frames |
| `src/server.mjs` | HTTP/SSE player, archive APIs and optional commentary routes |
| `src/match_archive.mjs` | Durable original matches, review revisions and portable packages |
| `web/app.js` | Pitch, play-by-play, frame controls, personalization and sequence review |
| `web/archive.js` | Saved collections, autosaved notes, bookmarks and shared replay workflow |
| `web/index.html`, `web/style.css` | Responsive industrial interface |
| `demo/capture.mjs` | Actual running-product browser capture |
| `data/events.json` | Original handcrafted synthetic fixture retained for compatibility |

The stateless `/api/analyze` and historical `/api/evidence-export` routes remain available for the bundled handcrafted fixture. The current player uses session frames; portable saved matches use `/api/archives/:id/export`.

## Attribution

Original 2026 source authored in the TokenJunkieLabs Commons swarm for the owner's competition exploration. Preserve the human entrant's actual legal ownership, rights and collaborator provenance when publishing or entering. The source is MIT licensed. Teams, players, events and presentation artwork are original synthetic material.
