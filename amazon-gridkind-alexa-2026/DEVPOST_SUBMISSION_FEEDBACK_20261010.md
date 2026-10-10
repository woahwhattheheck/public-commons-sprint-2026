# GridKind | Devpost Feedback and Judging Packet (October 10, 2026)

**Staged internally, NOT SUBMITTED.** This packet complements the original GridKind source and the independently claimed genuine Chromium video. The entrant owns all Devpost, eligibility and account actions.

## Official rules verified

[Amazon Build, Ship, Shape 2026](https://amazonappdev2026.devpost.com/rules) ends **October 23, 2026, noon PDT**. Section 4 permits an Alexa+ **simulated agentic web experience** in place of a live Agent Skill or Streamable HTTP MCP server. The source and actual working video must demonstrate the simulation. Five product-feedback prompts are mandatory, and a genuine optional developer friction log can earn a discretionary bonus of up to 10%. The [organizer's answer](https://amazonappdev2026.devpost.com/forum_topics/45430-inquiry-about-submission-mechanics) says a description link to a repository friction log is acceptable.

[Original public GridKind source](https://github.com/woahwhattheheck/public-commons-sprint-2026/tree/main/amazon-gridkind-alexa-2026) includes [MIT license](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/main/amazon-gridkind-alexa-2026/LICENSE), original Node agent, scheduler, browser and loopback HTTP server. GridKind is an alternate **simulated Alexa+** experience and does NOT call Alexa, AWS, physical devices, real meters, utility providers, or a real LLM.

## Proposed entry description (unsent)

**GridKind: approve a smarter energy plan before acting.** A browser-based simulated Alexa+ planning agent translates a conversational affordability intent into a 24-hour hypothetical energy schedule. The original scheduler jointly optimizes flexible tasks while observing deadlines, quiet hours and a 3-kW shared circuit limit. A user sees the earliest-feasible baseline and cost-minimized alternative, chooses to approve the exact proposal ID, and then explicitly runs only simulated commands. Revising a plan invalidates prior approval. Execution is repeat-safe and produces an explicit simulated:true, liveDeviceCalls:0 receipt. Rates and displayed savings are fictional scenario inputs, not verified energy-bill savings.

**Run locally:** Node.js 22+, from amazon-gridkind-alexa-2026 run node server.mjs and visit http://127.0.0.1:4181; Ask -> inspect proposed schedule -> Approve -> Execute simulation -> Reset. The existing browser owner must capture these actual clicks in genuine footage, not an HTTP response reenactment.

**Source for judges:** [agent.mjs](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/main/amazon-gridkind-alexa-2026/agent.mjs), [engine.mjs](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/main/amazon-gridkind-alexa-2026/engine.mjs), [server.mjs](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/main/amazon-gridkind-alexa-2026/server.mjs) and [index.html](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/main/amazon-gridkind-alexa-2026/index.html). Published optimization examples [PR383](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/383), [PR447](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/447) and [PR624](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/624); verify exact contributor attribution before claiming these.

## Five required developer feedback answers

1. **What was used?** Original JavaScript/Node 22+ agent, deterministic scheduling, session-local HTTP actions and HTML/CSS controls. This version does not use Amazon SDKs, AWS services or physical Alexa devices. Chosen contest path is the rules' simulated agentic web alternative.
2. **What worked well?** A complete source-visible user journey without cloud sign-in: conversational goal, actual local planner, itemized options, exact-plan human consent and labeled simulated execution, all demonstrable without network credentials.
3. **What needs work?** A canonical official simulated Alexa+ sample showing clear agent-to-tool calls and consent boundaries would help participants and judges distinguish actual agent workflow from a passive website. This is a suggested documentation/example improvement, not a measured Amazon SDK failure.
4. **Onboarding?** The September 16 revised rules identify separate native MCP/Skill and simulated web routes. We chose the latter and used a package-free local Node server. The original entrant should supply real measured onboarding time if available; no Alexa device onboarding was attempted.
5. **Would we build again?** Yes for an early simulated agentic interaction, because it helps iterate on transparent safety and approval. A production Alexa integration remains a separate unimplemented project.

**Optional feature request:** Important: official short simulated Alexa+ walkthrough featuring tool calls, proposal IDs, explicit human approval and read-only receipt playback.

## Original developer-friction bonus evidence

The 10% is discretionary, **not guaranteed**. The original runner may append real Amazon developer-tool/onboarding friction in this exact format: timestamp+version+source link, specific task, reproducible steps, expected and actual original log/status, severity and frequency, successful workaround, and actionable docs/platform correction. Do not fabricate entries to fill the section. The known cloud Chromium localhost ERR_BLOCKED_BY_ADMINISTRATOR was caused by our managed cloud browser, NOT Amazon developer tooling, and must not be submitted as Amazon SDK friction.

## Entrant finalization

The rules require public source with license, demonstration video **under 3 minutes** publicly on YouTube/Vimeo, actual working functionality consistent with source, testing instructions, five product feedback answers, entrant/track selection and any mini-challenge fields. Open Source mini-challenge might fit this MIT public source, subject to confirmed original authorship, contribution link and GitHub username. AWS Builder is NOT supported by this runtime. Official rules say AWS promotional credits ran out October 7. Owner retains final entry, video and screenshot proof and stores actual provider accepted submission receipt. This document is not a Devpost submission or awarded prize.
