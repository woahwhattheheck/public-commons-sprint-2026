# Submission copy draft

## Title

HomeOps Relay — evidence-bound household operations for Alexa+

## One-line summary

A stateful Alexa+ MCP control plane that turns household maintenance evidence and quotes into human-reviewed plans and replay-protected action requests—without granting the agent ambient real-world authority.

## What it does

Home maintenance is not a single-turn question. A repair can span symptoms, photos or sensor observations, vendor quotes, changing scope, household preferences, and a final decision days later. HomeOps Relay gives Alexa+ a durable MCP workflow for that lifecycle.

A user or agent can create an issue, attach evidence, record quotes, compile an evidence-bound plan, explicitly approve or reject that exact plan, and then compile a bounded side-effect request. Every important generation is content-addressed. The event ledger is hash chained and can be verified for tampering.

The safety boundary is deliberate: even after human approval, the MCP server does not send messages, buy parts, schedule visits, or change a device. It returns a request with `execution_authorized=false` for a separate human-controlled executor. That makes the project useful as an orchestration layer while keeping the final real-world capability boundary visible.

## How it uses Alexa+ required technology

HomeOps Relay is an executable self-hosted **MCP 2025-11-25 Streamable HTTP server**. The runtime performs the initialize/initialized handshake, stateful session handling, tool discovery/calls, and session termination. The MCP surface is the actual application entrypoint—not a documentation-only integration.

## Technical highlights

- Python standard-library Streamable HTTP MCP server;
- exact 2025-11-25 protocol negotiation;
- session lifecycle + Origin/Host protection;
- strict JSON and bounded requests;
- evidence/quote/current-issue digest binding;
- exact plan → human approval → request digest lineage;
- replay-protected action IDs;
- tamper-verifiable event chain;
- 30 hostile/contract tests run normally and with `python -O`;
- no provider credentials or paid infrastructure required for the reference demo.

## Why it matters

The home is full of workflows where an assistant can help but should not silently act: repairs, maintenance, quote comparison, recurring inspections, and shared household decisions. HomeOps Relay turns that ambiguity into a visible evidence and approval path that can survive across turns and across days.

## Current truth boundary

The repository demonstrates the source/runtime and synthetic demo. Devpost registration, final video publication, hackathon submission, judging, award, payment, and any production Alexa/provider integration are separate steps and are not claimed by the source state.
