# Reopen a match at the same moment

The viewer keeps the current synthetic match and event in the page address.
Refresh or bookmark it to return to that event. **Copy match link** shares the
same scenario, random seed, event, club, language and audience view. Opening it
creates an independent local replay session and leaves the match paused, so
the recipient sees the selected moment before playback advances.

The link contains no live session ID, provider identifier, credentials, AI
commentary or event export. It reconstructs the match from the existing seeded
generator. Exact replay assumes the same application version. If an event is
beyond the current version's match length, the viewer opens its final event
and explains the change; malformed or unsupported links open a fresh match
with a notice.

When browser clipboard access is unavailable, the same button reveals and
selects a normal text field for manual copying. A localhost link works only
where that local app is running; the link does not publish or host the app.
Optional AI commentary stays opt-in and is never requested by opening a link.

Start the existing app with `npm start` or `node src/server.mjs` from this
directory. The package metadata uses standard JSON whitespace so both startup
commands work with Node's package reader; the app has no new dependencies.
