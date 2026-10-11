# Saved matches and coach reviews

Save a selected synthetic match once, then keep its tactical review with the original events. Reopening creates an independent native player session from the retained event rows. The original frame engine, counterpress timing and view controls remain the replay path.

## Use the complete workflow

Run `node src/server.mjs` and choose a scenario, seed and club. Use the timeline or playback to locate a counterpress moment. **Save this moment** in the press-sequence panel saves the match and bookmarks the original event prefix that establishes the outcome. An expired window points to the first observed event strictly beyond the eight-second boundary. **Save current event** records the currently displayed play.

The **Saved matches** area supports:

- A titled collection belonging to the current browser.
- Coach notes for the whole match and a separate title/note for each saved moment.
- Automatic saving of edits, the confirmed replay cursor, club, audience, language and film-room filters.
- A direct jump from a saved moment to its native frame.
- A separate editable copy of a shared review.
- Portable download/import of the complete retained match and review.
- Explicit removal of a saved match, with a second confirmation click. Removing the archive leaves its currently open ephemeral replay available until that session ends.

The player waits for pending review saves before switching matches. If another tab already changed the same review, the original tab retains its local edits and offers **Save a copy**. Download also includes the current local notes and view, so that conflict does not erase the work.

## Replay links and browser collections

The existing **Copy match link** control automatically uses a saved-match link once a match has been saved. It records the archive read ID, selected event, club, audience and language. A recipient with access to the same app opens an independent paused replay. The link includes the saved review notes; it contains no edit key.

The saving browser retains a random collection key in its own local storage and sends it in the `X-Counterpress-Library` header. The server stores only its SHA-256 digest. Other browser keys cannot list or edit that collection. A shared read ID allows its holder to view, open or download that one match; **Save a copy** gives that recipient a new editable collection entry. This is capability access for the local/demo service, not an account or identity system.

Clearing browser storage loses that browser's edit key. Retain a downloaded package to move the review to another browser or server. Import creates a new archive ID; links to the old server continue to refer to the old server's stored copy. A local host link works only where the app is reachable.

## Original events survive a restart

`COUNTERPRESS_ARCHIVE_DIR` selects the persistent private directory. The default is the current user's `.local/share/counterpress-compass/matches` directory. New directories use mode 0700 and files use 0600. The Linux service writes a new private temporary file, flushes it, atomically renames it into place and flushes the directory before acknowledging the write. An acknowledged save survives an ordinary process restart; a killed partial write does not replace the prior complete archive.

Use one original Node server for each archive directory. Mutations are serialized within that server and require the current review revision. The file store is not a multi-process or distributed database. Persist the directory across container replacement and include it in the operator's normal backup process.

Default capacity is 64 saved matches per browser key and 256 per server directory. A match contains at most 1,000 validated native event rows and 64 bookmarks. Match packages have a 512KiB request limit; reviews have a 96KiB aggregate limit. Titles, notes and event identifiers have their own field limits. Normal session and commentary requests retain the original 8KiB limit.

## Portable format

A download has `format: "counterpress.match.v1"`, a `match` object and a `review` object. The match carries its known scenario, seed, explicit `data: "synthetic"` label and the complete original event array. Each event uses the existing engine fields: `id`, `second`, `type`, `team`, `player` and `zone`.

The review contains its title, notes, cursor, club/audience/language, selected counterpress moment, film-room filters and bookmarks. Each bookmark pairs an original event ID with its exact prefix count. Imported values are checked against the original fixture schema and those event IDs; arbitrary extra properties do not enter the native runtime. Server IDs, browser keys and ownership metadata are excluded from the portable package.

Restoration copies and freezes the retained event array before allocating a new native session. The integrated MS15 timeline initializes lazily from that array. It never substitutes a newly generated array for the saved input. Normal generated sessions continue to use the original generator and shared immutable timeline cache.

## HTTP interface

| Method and path | Operation |
| --- | --- |
| `GET /api/archives` | List the calling browser's collection and limits |
| `POST /api/archives` | Save `{sessionId, review}` using that native session's complete events |
| `POST /api/archives/import` | Save a validated portable match package as a new collection entry |
| `GET /api/archives/:id` | Read metadata/review and whether the calling browser may edit |
| `PUT /api/archives/:id` | Replace `{revision, review}` when both ownership and revision match |
| `DELETE /api/archives/:id` | Remove the owned archive at the supplied `{revision}` |
| `POST /api/archives/:id/open` | Open a fresh native session from the retained events; send `{}` |
| `GET /api/archives/:id/export` | Download the portable original match and review |

Collection and mutation requests require the browser key header. Read/open/export of a shared ID do not require that key. A different browser's edit returns 403; a stale review revision returns 409. The original session frame and stream contracts are unchanged.

## Actual integrated run

The 2026-10-11 cloud run launched the original Node server and a real headless Chromium together. It used the original high-press, seed-2026 match, saved its selected counterpress moment and coach notes, changed to Spanish, killed/restarted the Node process and reloaded the saved link. The new native session restored event 180 and the same notes. All 941 original event rows matched the original native full-frame response before and after restart and portable import. The imported bookmark opened its native closing frame at event 177.

The same journey exercised ownership and revision handling (403 and 409), produced no browser exceptions and retained a 390px layout without horizontal overflow. The existing MS15 numerical campaign and the separate running-demo recording are reused through their merged source; this feature adds no provider call, hosted Actions job or test suite.
