# Release and submission checklist

The following gates are intentionally separate. Do not collapse a local pass into a live sponsor claim.

## 1. Local product gate

- `npm test` terminal PASS.
- `npm run demo` terminal PASS on synthetic fixtures.
- `npm run verify:ab` terminal PASS only means the **synthetic A/B harness** is internally consistent.
- `npm run release:gate` is expected to exit non-zero on the shipped placeholder fixture.
- source tree clean and exact head recorded.

## 2. Integration gate

- Lane A exact interface/head recorded.
- Lane B exact interface/head recorded.
- public config contains no secret values.
- exact tinybar price agrees with Lane A.
- Graph provider evidence uses a network where the selected Graph data source is actually deployed.
- service URL uses HTTPS.

## 3. Live evidence gate

Replace every placeholder with live evidence and run `node bin/release-gate.mjs <live-evidence.json> <trusted-as-of>`.

Required evidence:
- public GitHub repo + exact 40-character submission head;
- deployed service URL;
- exact public-offer digest;
- Bazantic account attribution + Recipe identifier + capture digest;
- live Graph provider/network/query evidence digest;
- Hedera testnet HBAR settlement tx + Lane A settlement-evidence digest;
- baseline and Recipe capture digests + A/B verification digest with meaningful improvement;
- video URL.

A zero exit / `READY_FOR_HUMAN_SUBMISSION_REVIEW` means only that the packet is complete and non-placeholder under this contract. It does **not** prove that external URLs are reachable, the chain transaction is canonical, the sponsor accepted the project, or a prize is owed.

## 4. Human submission review

Human reviewer reopens all external artifacts, verifies sponsor selections/attribution, checks the demo length/content, confirms no secrets are present, and performs the actual submission. Record the resulting ETHGlobal project URL separately after submission.
