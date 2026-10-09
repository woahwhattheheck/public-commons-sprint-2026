# ShiftLoom — Simulated Alexa+ volunteer shift coordinator

**Working source / functional local demo, not a Devpost submission or a real Alexa integration.**

ShiftLoom is a browser-hosted **simulated Alexa+ experience** that receives natural-language volunteer-shift requests, runs a transparent series of real local planning tools, proposes a full-coverage assignment, then waits for human approval before changing anything. The product is designed for neighborhood event organizers facing last-minute absences. All displayed people and schedules are invented.

## Run the complete application

```sh
node --version  # Node 20+ required, no npm install required
node server.mjs
# Open http://127.0.0.1:8787
```

The server deliberately binds to loopback and holds only in-memory fictional event state. `PORT=8788 node server.mjs` changes the port. This is **not** a public production server: it has no authentication, persistence, real voice or volunteer contacts. Browser text-to-speech is optional and is not an Amazon Alexa service. Don't expose it on the public internet without adding authentication, storage and deployment controls.

## Fast 75-second demo

1. Show the fictional Neighborhood Science Day shift board: the 9–11 a.m. welcome desk is 1/2 staffed.
2. Click **Cover welcome desk**. The assistant proposes Iris, not Leo; inspect the tool trace: Leo is *already on overlapping equipment setup from 8–9:30 a.m.*
3. Click **Approve change**; the shift board becomes 2/2, and revision advances. No proposal modifies state before approval.
4. Click **Undo last approval** and show the revision move again. (Undo increments the monotonic revision rather than making old proposals valid.)
5. Click **Maya is absent**. The planner removes Maya and backfills *both* vacancies without selecting the absent worker.
6. Click **Reset demo**. Select **Cover workshop**; the mentor role requirement is enforced. Try entering `Cover the shift` or an unrecognized absence name to see an explicit clarification instead of invented commitments.

## Real functional components

- `seed.mjs`: 8 fictional volunteers, four overlapping/independent shifts, required role certifications, availability and weekly limits.
- `planner.mjs`: conversational intent routing, committed-assignment lookup, unavailability and skill filters, time-overlap checks, weekly-shift capacity, fairness/prior-preference scoring, complete-coverage-only proposal, explicit human-approval pause.
- `server.mjs`: local JSON interface with 16KiB input bound, optimistic revision/one-time proposal IDs, separate plan/dismiss/approve/undo/reset and non-persistent session.
- `public/`: complete responsive web application, runnable event board, visible tool trace, manual human approval, reversible changes, optional browser speech output.
- `test/shiftloom.test.mjs`: five focused checks for overlapping shifts, absences, under-qualified candidates, ambiguities, and the real HTTP approval/undo flow. `node --test test/shiftloom.test.mjs` runs only these relevant checks, no other suites.

## Competition mapping and restrictions

Official rules: https://amazonappdev2026.devpost.com/rules (October 2026). Deadline is **October 23, 2026, noon PDT**. The Alexa+ category (§4) accepts **an Alexa+ simulated experience built with the entrant's own tools**, as an alternative to an MCP endpoint or actual Alexa device; this exception is not a live-Alexa certification. Judges must be shown functioning source and a **public YouTube or Vimeo video under 3 minutes**, plus a code repository with visible OSI-style license, project description, required product feedback and all fields in the actual Devpost form. The code is already MIT-licensed. Optional frustration logs earn at most a judging bonus only when grounded in actual product use; no fabricated tool friction is included.

No Devpost registration, AWS grant, paid cloud service, device authentication, actual volunteer messaging, real guest data, marketplace claim, contest submission, cash award or payout was made by this source package. An authorized entrant must decide which candidate to submit, publish/host and show this exact working demo, and submit through their own official Devpost workflow. The official rules also make entrant/organization eligibility and representative authority requirements binding; a software contribution alone does not establish eligibility.

## Limitations, transparency and next high-value work

This is a **deterministic agentic-tool simulator**, not an LLM or a real Alexa+ skill. It parses known shift descriptions and names. It does not schedule every date or understand arbitrary voice. Its suggestion heuristic minimizes current assignments and prefers volunteered shifts; it is not a global integer optimizer. Infeasible plans fail closed. Local in-memory state is reset on server restart; an operator cannot accidentally treat the synthetic schedule as an external staffing system.

Before an official contest entry, prioritize independent accessibility review and publish a real HTTPS demo with isolated per-user state and authentication or read-only synthetic hosting. Capture an accurate short video, including explicit plan → skill/overlap trace → human approval → undo. Never submit a synthetic demo as if it is production-integrated Amazon Alexa.
