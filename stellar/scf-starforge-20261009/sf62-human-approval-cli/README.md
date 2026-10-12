# SF62 | Human approval and budget reservation at the agent-to-wallet boundary

SF62 supplies the original operator review and durable budget reservation. Its
standalone console uses a controlling terminal. The
[SF81 browser approval broker](../sf81-buyer-operator-bridge/README.md) exposes the
same native review and explicit decision through a trusted operator host, as used
by the [commerce workspace](../sf66-demo-launcher/COMMERCE_CONSOLE.md). Both human
interfaces compose the same four first-party Python/Node contracts:

- **SF31:** caller-supplied immutable `approve(intent)` JSON for an actual x402 v2 HTTP 402 challenge, bound to the exact resource, HTTP method/body, selected payment requirement, and buyer cap.
- **SF54:** actual `buyer_intent_to_governor_request()` validates and maps the whole SF31 request into the canonical SF36 budget-intent shape.
- **SF36:** actual durable SQLite WAL governor estimates risk and atomically reserves full atomic exact-amount capacity, using the native issue-consent signer, budget caps, request digest, and replay journal.
- **SF59:** actual `reserve_for_approval()` grants a fresh approval only when a *new* correctly bound reservation succeeded, refusing an idempotent duplicate to prevent an accidental second payment-signature attempt.

## Run on an authenticated operator machine (Python 3.11+)

From the current **complete** public repo checkout:

```bash
# 1. Have the trusted, original SF31 callback write its one immutable exact intent
#    to an access-controlled JSON file. Do not create a stand-in quote in production.
python stellar/scf-starforge-20261009/sf62-human-approval-cli/console.py \
  --intent /private/one-actual-sf31-intent.json --actor owner-approved-agent \
  --service owner-approved-seller
```

Default is **preview-only**, without opening a ledger, prompting or minting consent. It displays original accepted terms, exact recipient/network/asset/atomic amount/resource/body hashes, and a request SHA-256. It does not approve spending. For the optional privileged **reserve** operation, use a local terminal attached to the actual operator (not an agent's tool invocation), preconfigure a separate owner-approved SF36 `policy.example.json`-format policy and an absolute ledger location in an access-controlled directory (`0700` recommended), and supply three *independently provisioned* base64 32-byte-or-longer keys by secure operator process environment:

`SF36_CONSENT_KEY_B64`, `SF36_AUDIT_KEY_B64`, `SF36_OPERATOR_KEY_B64`.

```bash
python stellar/scf-starforge-20261009/sf62-human-approval-cli/console.py \
  --intent /private/one-actual-sf31-intent.json --actor owner-approved-agent \
  --service owner-approved-seller --reserve \
  --policy /private/verified-governor-policy.json \
  --ledger /private/budget/approved-reservations.sqlite
```

The process imports the **actual** SF36 native budget engine, displays its current limits/estimate, and requires an operator to type `APPROVE <first-16-hex-digest>` into a controlling `/dev/tty`. A plain stdin pipe cannot satisfy this CLI. A process controlling a pseudo-terminal can emulate keystrokes, so this prompt is a local operator interaction, not hardware-backed human authentication. Keep the operator process, terminal and signing keys inaccessible to any untrusted agent or remote caller. An operator refusal or insufficient budget yields a nonzero exit and **no fresh approval**. A positive result means precisely **one newly reserved maximum**, not a signed wallet request, actual payment, Stellar transaction finality, seller identity verification, grant acceptance or release of reserved funds. An identical request ID cannot approve twice even after repeating the typed phrase. The independent signer and trustworthy finality watcher remain outside this program.

No tokens, HMAC keys or Stellar private keys are printed, logged or saved by this program. Keep its operator runtime outside any untrusted agent subprocess and its ledger/key custody outside repo, web roots and shared disks. On POSIX the tool refuses shared-writable ledger parent directories, symlinks at the destination and unprivileged file permissions. The provided keys must remain stable for the lifetime of the original SF36 journal; rotating arbitrarily strands reservations. A preview does **not** assert funds are available because live caps can change before a real atomic reservation.

## One genuine original-source integration check

With the same full current checkout, run **only**:

```bash
python stellar/scf-starforge-20261009/sf62-human-approval-cli/acceptance.py
```

This imports the original SF54+SF36+SF59 code and proves three outcomes on a temporary private WAL with randomly generated test-only keys: operator says NO (zero reservations); operator explicitly authorizes one exact intent (one durable reservation); operator tries to approve the same intent again (gate refuses a duplicate signature authorization). It does not use a fake governor, hosted CI, network call, secret custody, paid provider, wallet, or grant form. For further broad x402 real-source replay, **the existing Muse SCF runner** owns native corpus/provider work, not a second runner here.

MIT (repository root license). Claim: `SCF-SF62-HUMAN-OPERATOR-RESERVATION-CONSOLE-20261010`; original SCF founder and payment integration/submission owners retain all buyer/seller operations and funding decisions.
