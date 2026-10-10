# SF57 — Portable SCF reviewer packet

This is an **offline export** of the real, original [SF53 local proof workbench](../sf53-local-proof-workbench/README.md), for a reviewer who does not run the repository's Node modules. No new commerce engine, transaction mock, wallet, paid origin request, hosted workflow, automatic refresh or network service is introduced. The canonical SCF founder packet remains separately owned and unsent.

## Generate from first-party code

From a full current checkout of `woahwhattheheck/public-commons-sprint-2026` with Node 22+:

```sh
node stellar/scf-starforge-20261009/sf57-portable-reviewer-packet/packet.mjs --out /tmp/stellar-review-20261010
node stellar/scf-starforge-20261009/sf57-portable-reviewer-packet/packet.mjs --verify /tmp/stellar-review-20261010
```

The first command **runs the already-published original SF53 `readOriginalEvidence()` once**. That in turn runs SF51 real local HTTP/MCP smoke, SF46 source preflight and SF52 original seller-to-buyer HTTP decision probes. It writes a self-contained `review.html`, canonical `report.json`, and `manifest.json` with SHA-256 of both artifacts, within an output directory that must not exist. Open `review.html` locally without a server: no scripts, remote fonts, remote images, payments, browser fetches or authenticated browser needed. Do not move/relabel the packet as a testnet-settlement certificate or SDF endorsement.

The verifier checks file bytes against a fresh deterministic rendering of the included source report and manifest. **Checksums are not signatures**: they do not establish who ran the original source, the correctness of upstream modules, consent, chain finality, a customer, funding or a submitted grant. Preserve and cite the original Git commit/source SHA and share only under the founder's authorized review workflow.

## Review gate

`SOURCE_CONTRACTS_PASS_ONLY` appears **only** if original SF51, SF46, and SF52 report their expected source-bound statuses; all reported paid/signed/chain counts remain zero; source pins have no changes or missing files; no release-preflight failures occur; and the SF53 safety restriction flags remain false. Unexpected outcomes become `REVIEW_REQUIRED`, not a green demo. Any changed restriction contract, malformed observation timestamp, invalid/oversized JSON, or nonfinite number blocks generation. Source warnings remain visible. The output never claims funded Stellar settlement, customer adoption, grant submission or award.

Focused independent artifact-integrity check:

```sh
node --test stellar/scf-starforge-20261009/sf57-portable-reviewer-packet/test/packet.test.mjs
```

This checks original-report **presentation and transport packaging**, not an ARC/SCF simulation nor chain conformance. Use the original SF51/SF52/SF53 and Muse source-corpus owners for acceptance of their respective live technical evidence. No GitHub Actions execution is needed.
