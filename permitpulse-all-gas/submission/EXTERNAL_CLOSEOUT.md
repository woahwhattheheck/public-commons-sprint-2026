# PermitPulse — external submission closeout

This packet is execution guidance for the **Convex All Gas** external edges. It does not itself create a provider receipt or widen `submission/READINESS.json`.

## Pinned source generation

- Staging repo: `woahwhattheheck/public-commons-sprint-2026`
- Directory to transport as standalone-repo root: `permitpulse-all-gas/`
- Canonical source generation: `ba2fcb00726f2679579d3c13c85cade6ef8f6721306f0cbe14d972d001361da4`
- Current main at packet creation: `1288164e2800131abd3efddf678bddc4a7165197`
- Required standalone repo name: `woahwhattheheck/permitpulse-all-gas`
- Official judging submit URL: `https://vibeapps.dev/judging/convex-all-gas-hackathon-openai/submit`
- Registration URL: `https://luma.com/convex-allgas-hackathon`
- Deadline: **2026-09-22 12:00 PM PT**
- All 11 readiness receipts are required. Do not mark one VERIFIED without a provider URL bound to the exact source generation.

## Execution order

1. **Luma registration** — at least one eligible team member registers. Do not infer registration from page access.
2. **Standalone public GitHub repo** — create `woahwhattheheck/permitpulse-all-gas`; import the contents of `permitpulse-all-gas/` to repository root with no semantic edits. Root `hackathon.md` must exist.
3. Run `npm install` and `npm run verify` in the standalone generation. Record exact commit and verification output.
4. **Convex deploy** — deploy the exact imported generation; record deployment/project and judge-open `convex.site` or `chatgpt.site` URL.
5. **Real sponsor work** — capture one real Firecrawl refresh, one real AgentMail inbox event, and one real OpenAI checklist-generation receipt. Fixtures do not count. Preserve requested/provider source identity and owner-review boundary.
6. Verify the public UI against the exact source generation.
7. Record the demo under 180 seconds using the existing demo plan; no fake provider screens.
8. Publish exactly one coordinated X or LinkedIn build post tagging Convex, OpenAI, Firecrawl, and AgentMail. Do not duplicate a peer's post.
9. Submit through the exact Vibe Apps judging URL using the verified repo/live/video URLs.
10. Only after a real submission receipt exists, update the `vibeapps_submission` receipt.

## Vibe Apps payload

**Title:** PermitPulse

**Tagline (128 chars):**
> Evidence-first permit and inspection change monitoring for small operators, powered by Convex, Firecrawl, AgentMail, and OpenAI.

**Description:**
PermitPulse helps small contractors and hospitality operators notice changes in official permit and inspection guidance without turning an AI summary into legal advice. Convex is the live state spine for jurisdictions, source snapshots, inbound notices, evidence-bound changes, and owner-review checklists. Firecrawl refreshes admitted public sources, AgentMail routes real inbound notices, and OpenAI turns a documented source change into bounded operational review steps. Every change remains tied to source identity and before/after digests, duplicates fail closed, and generated steps remain owner-review-required.

**Required challenge tags:** `convex`, `AllGasHackathon`, `OpenAI`, `Firecrawl`, `AgentMail`

**Website:** fill only with the verified public `convex.site` or `chatgpt.site` URL.

**GitHub:** fill only with the verified public standalone repo URL.

**Video:** fill only with the public <180-second demo URL.

**Submitter/team identity:** human/account field; do not infer or fabricate.

## Screenshot plan

Primary image: live change-review screen showing jurisdiction/source identity, before/after evidence, and owner-review status.

Additional images, in priority order:
1. Convex live jurisdiction/source snapshot state.
2. Real Firecrawl refresh evidence with requested URL, provider source identity, and digest.
3. Real AgentMail inbound notice with event/message/thread dedupe identity.
4. OpenAI-generated bounded review checklist with source linkage and owner-review-required state.
5. Fail-closed example (source mismatch or duplicate notice rejected).

Screenshots containing fixture-only data must be labeled fixture and must not be used to satisfy a live-provider receipt.

## Demo proof sequence

Use `submission/DEMO_SCRIPT.md` / `DEMO_PLAN.json` and keep the final recording under 180 seconds:
- product problem;
- Convex state/live update;
- real Firecrawl change capture;
- real AgentMail inbound notice;
- real OpenAI review checklist;
- fail-closed rejection;
- public URL + repo + root `hackathon.md`.

## Stop conditions

Do not proceed past the relevant edge if any of these occurs:
- CAPTCHA or account recovery;
- eligibility/residency/sponsor-employment attestation not already answered by the participant;
- identity, tax, prize-payment, or binding legal acceptance;
- missing provider credential or required paid plan;
- provider asks for new spend;
- public repo/live URL points to a different source generation;
- any required receipt remains OPEN.

The correct response is a precise owner-action receipt, not a fabricated success.
