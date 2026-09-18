# Build, Ship, Shape — Alexa+ rule snapshot

Checked: **2026-09-17**. This file is a working source snapshot, not a substitute for re-reading the live rules immediately before submission.

Primary source: https://amazonappdev2026.devpost.com/rules
Overview: https://amazonappdev2026.devpost.com/
MCP version context: https://modelcontextprotocol.io/specification/2025-11-25

## Current controlling facts

- Submission period closes **2026-10-23 12:00 Pacific Time**.
- Alexa+ accepts a working Agent Skill or a **self-hosted MCP server implementing MCP 2025-11-25 or later over Streamable HTTP**.
- Public repositories must include an open-source license; the rules say the license should be detectable and visible at the top of the repository page.
- Alexa+/Bee/Ring repositories must demonstrate runtime use of the required technology in code, not merely mention it in documentation.
- Submission requires a project description, code repository, and a **public YouTube or Vimeo demo video under three minutes**; judges need not watch beyond three minutes.
- Product feedback is required for tools/APIs/SDKs used. Optional friction-log entries can add up to a 10% judging bonus.
- Stage-two judging criteria are equally weighted: **Tech Implementation, Design, Potential Impact, Quality of the Idea**.
- Alexa+ track prizes currently list **$25,000 / $15,000 / $4,000 cash** for 1st/2nd/3rd, with AWS credits and other benefits.
- Open Source mini-challenge currently lists **$5,000 cash + $5,000 AWS credits** and permits a new open-source project or contribution to an existing public repository during the hackathon window, alongside a primary-track submission.
- A project may win one track prize and one mini-challenge prize.

## How HomeOps Relay maps to the rules

| Rule / judging axis | Source implementation |
| --- | --- |
| MCP 2025-11-25+ | `mcp_server.py` pins `2025-11-25` |
| Streamable HTTP | `/mcp` HTTP POST transport with 2025-era initialize/session lifecycle |
| Runtime use | MCP is the executable server entrypoint, not a README-only mention |
| Tech implementation | strict JSON, lifecycle/version/session checks, origin guard, hostile HTTP tests |
| Design | evidence → plan → explicit human review → non-executing side-effect request |
| Potential impact | recurring household maintenance, quote comparison, repair decision continuity |
| Quality / creativity | durable state + evidence custody + bounded action orchestration rather than single-turn Q&A |
| Open source | parent repository is MIT licensed; recheck visible GitHub license presentation before entry |

## Hard submission gates left outside source work

- Devpost join / acceptance of rules by the authorized entrant;
- final entrant/representative eligibility confirmation;
- public <3 minute YouTube/Vimeo demo;
- final product-feedback/friction-log review;
- Devpost submission itself;
- any live Alexa account/provider integration the entrant elects to demonstrate beyond the self-hosted MCP path.

No prize, payment, acceptance, or revenue is established by this repository state.
