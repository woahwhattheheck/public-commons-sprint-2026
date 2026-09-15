# Hearthline AWS Builder runtime

This directory is the Role-D AWS runtime seam for the Amazon Build, Ship, Shape / Alexa+ Hearthline experiment. It is executable product code, not a cloud-use claim.

## What it adds

- dependency-free AWS Signature Version 4 request signing;
- a DynamoDB-backed implementation of Hearthline's existing `load / snapshot / mutate` store contract;
- optimistic `revision` conditions so a stale process fails closed instead of silently overwriting another mission/action/idempotency receipt;
- a dedicated MCP server entry point using the DynamoDB store;
- a read-only live AWS probe that records the provider request ID without recording credentials;
- a fail-closed evidence gate. Unit tests or a mock endpoint **cannot** satisfy the AWS Builder runtime-evidence state.

## Table contract

Create a DynamoDB table with a string partition key named `pk`. Hearthline stores one bounded aggregate item (`pk=hearthline` by default) with `revision` and `state` attributes. The aggregate JSON is capped at 300 KiB, leaving margin below DynamoDB's 400 KiB item limit.

The application identity needs only `dynamodb:GetItem` and `dynamodb:PutItem` on that table for this adapter. Prefer short-lived workload credentials. Do not put AWS keys in the repository, command line, evidence JSON, Slack, or demo output.

## Run

```bash
export AWS_REGION=us-east-1
export HEARTHLINE_DDB_TABLE=HearthlineState
export AWS_ACCESS_KEY_ID=...
export AWS_SECRET_ACCESS_KEY=...
# export AWS_SESSION_TOKEN=...    # for temporary credentials
node aws/server.mjs
```

The existing MCP transport and authority semantics stay unchanged; only persistence moves from a local JSON file to DynamoDB.

## Reproducible offline contract gate

```bash
node --test test/aws-*.test.mjs
```

This validates signing shape, credential redaction, initialization, state persistence, optimistic conflict rejection, and the evidence boundary without contacting AWS.

## Live evidence — separate operator action

A real AWS account/table is required to claim AWS Builder runtime use. Once an authorized operator has that environment, run the read-only probe:

```bash
HEARTHLINE_AWS_EVIDENCE=/secure/out/hearthline-aws-evidence.json node aws/smoke.mjs
node aws/evidence-gate.mjs /secure/out/hearthline-aws-evidence.json us-east-1 HearthlineState
```

The probe performs `GetItem`, records the canonical regional endpoint, DynamoDB target, HTTP status, observation time, and AWS request ID, and omits authorization/session credentials. The gate returns `LIVE_AWS_EVIDENCE_VERIFIED` only for that bounded live receipt. A mock/local test remains `BLOCKED` for submission claims.

## Truth boundary

Checked-in code + offline tests establish **AWS-compatible integration readiness**, not deployment. Until a live probe receipt exists and passes the gate, do not claim that Hearthline ran on AWS, qualified for the AWS Builder mini-prize, incurred cloud spend, or was submitted to Amazon/Devpost.
