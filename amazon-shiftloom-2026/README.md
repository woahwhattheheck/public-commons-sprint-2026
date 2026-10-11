# ShiftLoom — Simulated Alexa+ volunteer shift coordinator

**Working source / functional local demo, not a Devpost submission or a real Alexa integration.**

ShiftLoom is a browser-hosted **simulated Alexa+ experience** that receives natural-language volunteer-shift requests, runs a transparent series of real local planning tools, proposes a full-coverage assignment, then waits for human approval before changing anything. The product is designed for neighborhood event organizers facing last-minute absences. All displayed people and schedules are invented.

## Retained volunteer coverage workspace

The [retained workspace](workspace/README.md) carries the original planning engine into a complete operating workflow: source-native Get Connected capture and CSV/JSON import, explicit coordinator mappings, persistent roster versions, exact candidate source review, named approval and undo, corrected-source reruns, complete handoffs and SQLite backup/reopen.

Run its Python standard-library server with Node 22.16 or later available for the original planner:

```sh
cd workspace
python3 -B app.py --db /absolute/private/path/coverage.sqlite --port 8802
```

The [operator guide](workspace/WORKFLOW.md), [actual source contract](workspace/SOURCE_CONTRACT.md), [API](workspace/API.md) and [worked input recipe](workspace/examples/recipe.json) travel with the application. The commands and narrative below continue to describe the original simulated Alexa demonstration.

## Run the complete application

```sh
node --version  # Node 20+ required, no npm install required
node server.mjs
# Open http://127.0.0.1:8787
```

The server deliberately binds to loopback and holds only in-memory fictional event state. `PORT=8788 node server.mjs` changes the port. This is **not** a public production server: it has no authentication, persistence, real voice or volunteer contacts. Browser text-to-speech is optional and is not an Amazon Alexa service. Don't expose it on the public internet without adding authentication, storage and deployment controls.

Each browser cookie receives its own event, pending proposal and undo history. Tabs in the same browser share that event; another browser or private window receives a separate event. The HttpOnly, SameSite=Strict cookie is local demo isolation, **not authentication**. Sessions expire after one hour without an API request. There are at most 100 active sessions: a new visitor receives HTTP 503 when full, while existing visitors retain access. Idle sessions are removed on the next API request, with no background job. Unknown, missing or expired cookies cannot mutate any event (HTTP 409). The browser explains expiration and opens a fresh sample event; **Refresh event** retries an unavailable event and synchronizes other tabs' changes. A server restart loses every event.

Approval still requires that session's exact pending proposal ID and revision. Undo and reset advance the revision; reset also requires the current revision, so a stale tab cannot silently erase a newer approval. Reset restores the sample assignments and clears only that session's proposal and undo history. Planning and mutation controls stay disabled until the event is ready.

## Fast 75-second demo

1. Show the fictional shift board and three open places. Open **Volunteer roster** to inspect qualifications, availability and existing assignments.
2. Click **Fill openings** on the welcome desk. The proposal comes into view. Open **Why this plan**: Iris is proposed, while Leo is blocked by overlapping equipment setup from 8–9:30 a.m.
3. Click **Approve change**; the welcome desk becomes 2/2 and the roster updates. No proposal modifies state before approval.
4. Click **Replace Maya** on that shift. Inspect the explicit removal and replacement, then approve. The roster records Maya's absence only after approval.
5. Click **Undo last approval**. Maya's assignment and availability return, and the revision advances instead of making the old proposal valid.
6. Click **Reset demo**, then **Replace Omar** on cleanup. Only one replacement is eligible for two places, so the assistant explains the gap and offers no approval. A separate private window can review a different event independently.

## Real functional components

- `seed.mjs`: 8 fictional volunteers, four overlapping/independent shifts, required role certifications, availability and weekly limits.
- `planner.mjs`: conversational intent routing, committed-assignment lookup, unavailability and skill filters, time-overlap checks, weekly-shift capacity, fairness/prior-preference scoring, complete-coverage-only proposal, explicit human-approval pause.
- `server.mjs`: local JSON interface with 16KiB input bound, optimistic revision/one-time proposal IDs, separate plan/dismiss/approve/undo/reset and isolated non-persistent visitor sessions.
- `public/`: complete responsive web application, runnable event board, visible tool trace, manual human approval, reversible changes, optional browser speech output.
- `test/shiftloom.test.mjs`: five focused checks for overlapping shifts, absences, under-qualified candidates, ambiguities, and the real HTTP approval/undo flow. `node --test test/shiftloom.test.mjs` runs only these relevant checks, no other suites.

- `test/session-isolation.focused.test.mjs`: real loopback HTTP checks for independent reviewers, exact approval ownership, stale reset, unknown/expired cookies and the 100-session limit. Run `node --test test/session-isolation.focused.test.mjs`; run the adapted original HTTP workflow alone with `node --test --test-name-pattern='HTTP workflow' test/shiftloom.test.mjs`.

## Coordinator review workspace

The shift board shows outstanding places. **Fill openings** drafts coverage for that exact shift; **Replace [name]** reports an absence on that person's current shift and drafts full replacement coverage. Both use the same original natural-language planner and pause for approval. The schedule stays unchanged until **Approve change**.

Open **Volunteer roster** to inspect the original fictional volunteers' qualifications, availability, preferences, assignments and reported absences. Open **Why this plan** after planning to see the actual filter's decision for every volunteer. The first applicable constraint is shown; eligible people retain the original ranking by workload, preference and name. Infeasible plans show eligible alternatives but cannot be approved. No separate explanation heuristic or new ranking is introduced.

`node --test test/reviewer-workspace.focused.test.mjs` exercises the shipped browser script against the real local HTTP server through fill, approval, replacement, undo, reset and incomplete coverage. Its small DOM harness does not claim rendered-browser validation.

## Competition mapping and restrictions

Official rules: https://amazonappdev2026.devpost.com/rules (October 2026). Deadline is **October 23, 2026, noon PDT**. The Alexa+ category (§4) accepts **an Alexa+ simulated experience built with the entrant's own tools**, as an alternative to an MCP endpoint or actual Alexa device; this exception is not a live-Alexa certification. Judges must be shown functioning source and a **public YouTube or Vimeo video under 3 minutes**, plus a code repository with visible OSI-style license, project description, required product feedback and all fields in the actual Devpost form. The code is already MIT-licensed. Optional frustration logs earn at most a judging bonus only when grounded in actual product use; no fabricated tool friction is included.

No Devpost registration, AWS grant, paid cloud service, device authentication, actual volunteer messaging, real guest data, marketplace claim, contest submission, cash award or payout was made by this source package. An authorized entrant must decide which candidate to submit, publish/host and show this exact working demo, and submit through their own official Devpost workflow. The official rules also make entrant/organization eligibility and representative authority requirements binding; a software contribution alone does not establish eligibility.

## Limitations, transparency and next high-value work

This is a **deterministic agentic-tool simulator**, not an LLM or a real Alexa+ skill. It parses known shift descriptions and names. It does not schedule every date or understand arbitrary voice. Its suggestion heuristic minimizes current assignments and prefers volunteered shifts; it is not a global integer optimizer. Infeasible plans fail closed. Local in-memory state is reset on server restart; an operator cannot accidentally treat the synthetic schedule as an external staffing system.

Before an official contest entry, prioritize independent accessibility review and publish a real HTTPS demo with authentication or read-only synthetic hosting. Local cookie isolation does not provide authenticated users or durable storage. Capture an accurate short video, including explicit plan → skill/overlap trace → human approval → undo. Never submit a synthetic demo as if it is production-integrated Amazon Alexa.
