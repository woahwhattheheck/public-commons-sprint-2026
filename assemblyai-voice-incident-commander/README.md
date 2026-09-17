# Voice Incident Commander

A submission-oriented **AssemblyAI Voice Agent Hackathon** foundation: streaming speech becomes a deterministic, evidence-linked incident ledger without letting spoken words silently become production authority.

## Why this build

Incident calls are a hard voice-agent environment: multiple speakers, partial hypotheses, urgent action language, and high cost for a fabricated or prematurely executed command. Voice Incident Commander separates **what was said** from **what is authorized**:

1. AssemblyAI Streaming v3 supplies speaker-aware transcript turns.
2. Only final `Turn` messages enter the durable evidence ledger.
3. Explicit speech prefixes (`OBS:`, `HYP:`, `CHECK:`, `ACTION:`, `DECISION:`) classify evidence deterministically; everything else is retained as a note.
4. `ACTION:` is always an **action proposal**. The packet's production/deploy/page/submission/payment/revenue authority flags remain hard-false.
5. Every final turn and derived event is content-addressed; the complete packet has a deterministic SHA-256 receipt and a verifier that replays from source turns rather than trusting caller-authored state.

This is useful as both a hackathon demo and a reusable safety boundary for real-time technical voice agents.

## Current provider contract

The live adapter is written against AssemblyAI Streaming v3:

- WebSocket: `wss://streaming.assemblyai.com/v3/ws`
- speech model: `universal-3-5-pro` (current model ID)
- optional diarization: `speaker_labels=true`
- final message admission: `type == "Turn" && end_of_turn == true`
- live WAV streaming uses mono PCM16 and 100 ms chunks.

First-party references:

- Streaming API: https://www.assemblyai.com/docs/api-reference/streaming-api/streaming-api
- Streaming transcription guide: https://www.assemblyai.com/docs/guides/real-time-streaming-transcription
- Speaker diarization: https://www.assemblyai.com/docs/speech-to-text/speaker-diarization
- Hackathon: https://lablab.ai/ai-hackathons/assemblyai-voice-agent-hackathon

**Provider truth:** this repository build has not used a live AssemblyAI credential and does not claim live-provider execution. The offline reducer, message contract, replay path, and hostile tests are executable without secrets.

## Quick offline demo

```bash
cd assemblyai-voice-incident-commander
python replay.py compile fixtures/synthetic_incident.json /tmp/incident.packet.json
python replay.py verify /tmp/incident.packet.json
```

Expected verifier output:

```text
VERIFIED
```

Run the full proof in normal and optimized mode:

```bash
python -m unittest discover -s tests -v
python -O -m unittest discover -s tests -v
python -m py_compile incident_core.py assemblyai_stream.py replay.py
```

## Live WAV mode

Live mode intentionally keeps the API key in the environment and never writes it to a packet:

```bash
python -m pip install websocket-client
export ASSEMBLYAI_API_KEY='...'
python assemblyai_stream.py incident-call.wav /tmp/incident.packet.json
python replay.py verify /tmp/incident.packet.json
```

The WAV must be mono 16-bit PCM. The adapter sends 100 ms chunks and terminates the session explicitly after audio EOF.

## Packet semantics

A packet contains:

- the stable final-turn projection (order, speaker, transcript, confidence, transcript digest);
- evidence events split into observations, hypotheses, diagnostic proposals, decisions, action proposals, and notes;
- event SHA-256 receipts;
- hard-false authority for production mutation, commands, deploys, paging, competition submission, award, payment, and revenue;
- a packet receipt SHA-256 that is verified by deterministic replay.

The reducer is gap-intolerant and replay-safe: an exact duplicate turn is idempotent, while a conflicting duplicate or missing turn order is a controlled failure. NaN/Infinity, bool-as-int, lone surrogates, control-character speaker labels, duplicate JSON keys, tampered state, and tampered authority all fail closed. Provider metadata outside the explicit projection is ignored rather than persisted, so newly added benign Turn fields do not break the adapter or widen the evidence schema.

## Demo story

The included synthetic call shows a useful safety distinction:

- SRE reports a post-release checkout error spike.
- The team forms a provider-latency hypothesis.
- A diagnostic comparison is proposed.
- Someone says `ACTION: roll back ...`.
- The incident commander records a decision to hold until evidence is reviewed.

The voice system captures the action request, but the packet still says `production_mutation=false`. A later product layer can require explicit authenticated human approval before mapping a proposal to a real tool.

## Hackathon submission path

The event is currently advertised as live through **September 30, 2026**, with **$5,000 cash + $5,000 AssemblyAI credits** in the overall pool. Those are advertised event economics, not earned revenue.

Before a provider submission, the remaining owner/account gates are:

1. fresh exact-title Slack/GitHub/provider census;
2. Muse single-writer SELECT for the one-person LabLab registration/submission action;
3. register/join the intended LabLab identity once;
4. run a live AssemblyAI demo using a legitimately held key and preserve a non-secret execution receipt;
5. add a short demo UI/video and judge-facing architecture diagram;
6. verify the live prize split, judging criteria, rules, and required submission fields immediately before submit;
7. submit exactly once and record provider receipt; never call a placement or prize “revenue” before settlement.

## Scope boundary

This carrier does **not** send pages, roll back services, contact organizers, register for LabLab, spend paid API credits, submit to the competition, or assert an award/payment. It builds the substantial internal technical foundation so those later actions can be narrow, reviewable, and collision-safe.
