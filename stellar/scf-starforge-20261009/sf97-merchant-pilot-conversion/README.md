# SF97 · Private merchant pilot conversion room

A complete offline **commercial review handoff** built from the existing SCF seller: original SF30 observations → SF93 private evidence bundle → original SF87 rail economics → operator-approved terms → local acceptance desk → hashed decision packet. No second payment engine, seller server, traffic tracker, wallet, mailing system, or hosted UI. Designed for a real merchant operator and existing SF49 paid-pilot relationship owner, not for cold outreach.

## Real source-native operation

Use Node 22+, a normal checkout of the existing SCF repository, and private disk space. Run the original SF30 seller and its operations listener with `sf30-seller-sdk/operations/launch.mjs` (or original SF96 pilot once available). In a second terminal, capture its **real** observed runtime:

```sh
node stellar/scf-starforge-20261009/sf93-seller-support-bundle/bundle.mjs \
  --seller http://127.0.0.1:8423 --ops http://127.0.0.1:8424 \
  --out /private/merchant-001/source-bundle
```

Prepare a **real operator-supplied** SF87 scenario JSON using its existing guide and costs (unknowns should be `null`), and an operator-owned copy of `example-terms.json`. Do not put merchant terms, signed receipts, actual runtime captures or relationship records in this public repository. The example is not a customer.

```sh
node stellar/scf-starforge-20261009/sf97-merchant-pilot-conversion/room.mjs build \
  --bundle /private/merchant-001/source-bundle \
  --scenario /private/merchant-001/scenario.json \
  --terms /private/merchant-001/terms.json \
  --out /private/merchant-001/review-room
```

Open `review-room/index.html` in a local browser. This is an industrial, keyboard-accessible, source-bound offline acceptance workspace: original HTTP session counters, exact SF87 scenario comparison, quote approval state, named milestones, reviewer choices and evidence fields. **Export review** downloads a JSON record; **Load saved review** resumes it. Neither action reaches a network endpoint or mutates the seller. Reviewer decisions do not automatically turn into signoff/payment.

```sh
node stellar/scf-starforge-20261009/sf97-merchant-pilot-conversion/room.mjs finalize \
  --case /private/merchant-001/review-room \
  --review /private/merchant-001/EXAMPLE-PILOT-review.json \
  --out /private/merchant-001/final-decision
```

This writes create-only `decision.json` and `review.md`, with the **original case bytes SHA-256** and the operator review bytes digest. Finalized accepted milestones require specific original HTTPS receipts or `sha256:<64-hex>` file digests. Other review states are retained, not forced green. There is no invoice, outbound contact or settlement action. To revise a pilot, create a new case directory, preserving prior package custody.

## Commercial semantics

`commercial.approval` stays `NOT_APPROVED` until owner approval has an actual HTTPS receipt and exact six-place USD fee + delivery-cost values; only then set `OWNER_APPROVED_QUOTE`. The conditional quote contribution is separated from the SF87 **forecast** monthly transaction economics and original SF93 **observed** HTTP counts. HTTP 402 is an unpaid challenge; HTTP 2xx is not proof of payment. A fully accepted technical checklist is not automatically a signed contract or collected cash. The SF77 merchant remediation work-order remains the owner of unpaid browser-fix diagnosis; SF97 is a distinct buyer/merchant pilot conversion and relationship-room workflow.

The public source contains no customer bundle or terms. Runtime package folders are 0700 and files 0600, created once with exclusive writes. Input bundle SHA and original SF93 manifest/session must match; case and review source hashes are rebound on finalize. No arbitrary HTTP fetch occurs in SF97. The operator must protect local artifacts and verify independent seller/buyer receipts before commercial claims.

## Integration

The only executable financial calculation is imported from `../sf87-rail-unit-economics/compare.mjs` and uses its exact micro-USD arithmetic. The original SF93 `bundle.json` and `manifest.json` are consumed unmodified. The existing SF30/61/82/88/93/96 engines remain owned by their respective maintainers. A small standalone local review UI travels inside the private artifact folder to support no-server owner handoff. Use the existing SCF SF10 canonical application for source-backed grant narrative updates; do not create a second application or claim an award.
