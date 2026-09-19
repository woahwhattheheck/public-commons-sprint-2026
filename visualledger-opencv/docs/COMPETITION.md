# OpenCV AI Competition 2026 alignment

Public competition page checked 2026-09-18:
- final projects due October 26, 2026 at 11:59 p.m. Pacific;
- every entry must use OpenCV 5 for substantive image/video analysis and run a meaningful AWS component;
- Agentic Vision requires image/video results to influence a later plan, tool call, action, or human-approval request;
- final submission calls for a technical report, judge-accessible code/archive, pinned dependencies and build/deploy/test instructions, architecture diagram, working endpoint or live screen-share, <=5 minute video, and evaluation including failure cases/limitations.

Sources:
- https://opencv26.devpost.com/
- https://opencv26.devpost.com/rules

## VisualLedger fit

**OpenCV depth:** document geometry, perspective normalization, quality measurements, structure measurement, and perceptual duplicate fingerprint all use OpenCV operations.

**Agentic behavior:** the visual outputs are causal inputs to four different next actions; the agent is not merely describing a fixed image result.

**AWS:** versioned S3 -> container Lambda/OpenCV -> DynamoDB idempotent evidence record. Live deployment remains unproven until separately executed.

**Human control:** every route requires human review; `REQUEST_FIELD_EXTRACTION` is not approval and confers no payment/accounting authority.

## Evidence still required before a final competition submission

1. Real OpenCV 5.x normal + optimized/unit/evaluation run on the exact submitted source.
2. Real AWS deployment receipt proving the OpenCV 5 container path and versioned S3 event processing.
3. Bounded DynamoDB prior-fingerprint query if cross-object duplicate detection is claimed in the demo.
4. Latency/cost/reliability measurements from that deployment.
5. Judge-facing <=5 minute demo video and architecture/report package.
6. Human owner registration/submission on Devpost.

No prize or grant is treated as earned revenue before organizer award/payment evidence.
