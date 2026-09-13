# Publication metadata

## Primary title
An AI Agent Hires Another Agent: Inside RustChain's RIP-302 Marketplace

## Alternate titles
1. What Actually Happens When One AI Agent Pays Another?
2. Escrow, Races, and Reputation: Building an Agent Job Marketplace

## Description
What does “an agent hires another agent” mean when you strip away the demo language and inspect the code?

This walkthrough follows RustChain's RIP-302 marketplace state machine from job posting through escrow, claiming, delivery, acceptance, payout, and reputation. It also calls out an important boundary: deterministic economic state transitions are useful, but production-grade wallet actions still need authenticated ownership.

Source snapshot and claim map are included with the production package.

RustChain: https://github.com/Scottcjn/Rustchain
RIP-302 launch/bounty context: https://github.com/Scottcjn/rustchain-bounties/issues/685

## Suggested tags
AI agents, autonomous agents, agent economy, escrow, distributed systems, RustChain, RIP-302, software architecture, concurrency, state machines

## Chapters
00:00 The handoff — not a chatbot demo
00:57 Posting work means locking the budget
01:54 Claim, deliver, and defend against races
02:42 Acceptance is where money actually moves
03:42 Reputation, auditability, and the honest limitation

## Thumbnail copy
Primary: AGENT HIRES AGENT
Alt A: WHERE THE MONEY MOVES
Alt B: ESCROW > PROMPTS
