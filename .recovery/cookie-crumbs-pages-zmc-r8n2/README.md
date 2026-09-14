# Cookie Crumbs verified Pages carrier — recovery capsule

This directory preserves the exact completed but previously unpublished carrier patch from `Z-MengerCitadel-0140-R8N2` / `ZMC-R8N2` without applying stale hunks to current `main`.

## Exact artifact identity

- Original patch: `0001-cookie-crumbs-verified-pages.patch`
- Raw bytes: `27510`
- SHA-256: `b1a396c1686d6c93c1136f7fdae07a82fd9eb60341f5d464d817903c428112f0`
- Git blob SHA-1 of raw patch bytes: `c76e9948b941904122d78f13f75d2659ed4fbe71`
- Base64 bytes after concatenating parts: `36680`
- Original audited repository snapshot: `fda05581d4277ecce03d2addbabee86991599919`
- Original Cookie Crumbs source commit: `446b66260e35535b35b3d68becf4c7f3462e60b0`
- Local carrier commit: `3ebd0648aa0eff795cce0a0e82c91e0a2a255860`
- Reported donor proof: `11/11` tests plus independent apply/tree/YAML/whitespace verification.

## Provider-hosted part manifest

Concatenate in this exact order:

| part | bytes | Git blob SHA-1 |
|---|---:|---|
| `patch.b64.part00` | 7000 | `ce0bc7427481a94bd0ba69157627a63129c8bee7` |
| `patch.b64.part01a` | 3500 | `f1048273def3fb8157c53fb83ec8d726bb1c651f` |
| `patch.b64.part01b` | 3500 | `145ebc2c41a4b04dadc45bfdfaa845f26c2c3f9d` |
| `patch.b64.part02` | 7000 | `90a3fa5930f58299c12b4d4dbdb100982695eed1` |
| `patch.b64.part03` | 7000 | `737ae5294d32c36f2b873340ba71ef4a9eacd7b9` |
| `patch.b64.part04` | 7000 | `eadcfb72a996dc992e639eaff3477c0b1ce2071e` |
| `patch.b64.part05` | 1680 | `ea0def10a92b19d5241e4672646da75ba72eb4f6` |

## Lossless reassembly

```bash
cat patch.b64.part00 patch.b64.part01a patch.b64.part01b patch.b64.part02 patch.b64.part03 patch.b64.part04 patch.b64.part05 \
  | base64 --decode > 0001-cookie-crumbs-verified-pages.patch
sha256sum 0001-cookie-crumbs-verified-pages.patch
# must print b1a396c1686d6c93c1136f7fdae07a82fd9eb60341f5d464d817903c428112f0
```

## Truth / merge gate

This is a **recovery artifact**, not a claim that the old patch applies cleanly to today’s `main`, not a Pages deployment receipt, and not a live-URL verification. The historical carrier added a least-authority Pages workflow, post-publication verifier, retained deployment receipt, and Node 24 action upgrades. Before any merge of reconstructed source, rebase/apply the patch against current `main`, review conflicts, rerun the repository tests on the exact resulting bytes, deploy through the intended Pages workflow, and require the live verifier/receipt to pass.

Do not infer a successful live Cookie Crumbs deployment merely from this recovery capsule.