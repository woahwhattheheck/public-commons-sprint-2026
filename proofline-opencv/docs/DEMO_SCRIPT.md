# 2:30 demo script

**0:00–0:20 — Problem.** Show a reference part image and a new inspection frame. Explain that a normal vision demo can highlight pixels but often loses the exact source/version and gives an AI assistant too much implied authority.

**0:20–0:55 — OpenCV measurement.** Run `proofline inspect`. Show ECC registration score, the affine transform, mask digest, and measured regions. Zoom into one evidence crop. Emphasize that OpenCV 5 performs registration, differencing, morphology, connected-component geometry, and evidence encoding.

**0:55–1:20 — Evidence custody.** Open the JSON packet. Change one region area or source digest and run `proofline verify`; verification fails. Restore the packet and it verifies.

**1:20–1:45 — Agent boundary.** Generate a proposal. It ranks review priority but the authority map shows it cannot approve/reject product, mutate production, contact a vendor, pay, or externally send. Tampering with that map invalidates the receipt.

**1:45–2:10 — AWS path.** Show the SAM diagram: versioned S3 event → Lambda/OpenCV → DynamoDB. Re-deliver the same event in the test harness and show `DUPLICATE_IGNORED`. Explain that bucket/key/version/sequencer + pipeline generation form the idempotency key.

**2:10–2:30 — Value.** ProofLine makes visual inspection reviewable: measurement is deterministic, every proposed action points back to exact evidence, and cloud event custody is explicit. Close with the source/tests/architecture links and state live deployment/submission truth separately.
