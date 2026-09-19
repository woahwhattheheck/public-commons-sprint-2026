# Submission readiness fence

This is a source checklist, **not proof of registration or submission**.

Before any Agenthon Development upload:

- [ ] Re-read current official Rules and Track 4 README/card; record their version/commit.
- [ ] Confirm the registered Agenthon team and captain; keep Team Key private.
- [ ] Confirm the current CodaBench Track 4 Development page is accepting submissions.
- [ ] Run organizer-published schema validation and Track 4 smoke tooling on the exact image.
- [ ] Run public-unit faithfulness checks without using resolved/private outcomes.
- [ ] Pin the exact container image digest; no floating tag.
- [ ] Use the current valid submission category (current Track 4 docs: `api`).
- [ ] Declare the organizer-required House model/version/cutoff exactly as published.
- [ ] Repack the descriptor only after the final image digest is known.
- [ ] Verify the image-access route (public anonymous pull or organizer-confirmed private mirror).
- [ ] Retain exact source commit, image digest, descriptor digest, local test receipt, and upload receipt.
- [ ] Do not infer a score from local interface smoke checks.
- [ ] Do not probe sealed/private evaluation material or adaptively infer hidden labels.

No prize amount is encoded here because current official rules say prizes will be announced through
an official channel before they apply to the Final Phase.
