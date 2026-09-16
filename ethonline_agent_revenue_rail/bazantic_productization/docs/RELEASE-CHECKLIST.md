# Release and submission checklist

The donor's standalone release reducer cannot return READY. Completion requires a provider-integrated host plus human account actions.

## Source and CI

- [ ] Repair commit is based on literal current `main`.
- [ ] Hosted package suite passes, including actual landed Lane B producer integration.
- [ ] A/B verifier passes with comparable configuration.
- [ ] Demo emits authority HOLD rather than a fabricated happy path.
- [ ] Release reducer emits HOLD and exits `3` without provider integrations.
- [ ] Independent exact-head review is green.

## Provider evidence

- [ ] GitHub source head exists and equals the release source.
- [ ] Deployment is live and independently bound to that source head.
- [ ] Bazantic account and recipe exist under the intended participant account.
- [ ] Graph capture is from the intended deployed subgraph/network and retained by digest.
- [ ] Hedera testnet transaction is independently read back and settlement-bound.
- [ ] Report response bytes are retained and digest-bound to the settlement response.
- [ ] Baseline and recipe A/B runs use the same prompt, model, settings, APIs, and input fixture.
- [ ] Demo video exists and is accessible.

## Human/account gates

- [ ] Participant eligibility and competition rules reviewed by the participant.
- [ ] Account terms accepted by the participant.
- [ ] Team identity is real; no invented member data.
- [ ] Submission fields and media reviewed.
- [ ] Human performs the final submit action.

Until every applicable item is independently proven, status remains `HOLD` / not submitted / no prize or payment claim.
