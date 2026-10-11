# SF96 | Real merchant 402 to reviewed Stellar buyer intent

For a complete private direct-provider operation, use the [operator workflow](OPERATOR.md).
It carries this same source-bound handoff into the existing SF88 workspace and
durable inbox, with native terminal approval, returned output, restart recovery
and an operator report. No manual rebuilding of the execution configuration is needed.

**End-to-end gap closed:** SF85 can already acquire a consenting merchant's real unpaid HTTP 402 response, and SF84 classifies its original x402 v2 and Stellar MPP payment challenges. SF88 can already produce an offline operator-review configuration *from a facilitator catalog*. This product adds the missing source-native path for a merchant who has a directly observed original x402 challenge **but is not yet in that catalog**: capture → original decode → explicit one-option selection → hard atomic spend ceiling → source-bound review → separately owned SF88 human approval if the merchant actually proceeds.

This is an integration of the [SF85 original capture](../sf85-live-402-capture/README.md), [SF84 original dual-rail inspector](../sf84-mpp-market-intake/README.md) and [SF88 original approved buyer](../sf88-operator-buyer-cli/README.md). It never creates a competing HTTP client, 402 decoder, buyer signer, facilitator, wallet, catalog, monitoring service or payment flow. Node 22+, standard library only, no server and no GitHub Actions.

## Operator journey using the *original* merchant response

1. Obtain an original seller-approved capture, or reuse one your team has already taken. Preserve the first-party evidence and merchant authorization privately:

```sh
mkdir -m 700 -p /private/scf-pilots/captures /private/scf-pilots/handoffs
node stellar/scf-starforge-20261009/sf85-live-402-capture/capture.mjs \
  --url 'https://YOUR_REAL_APPROVED_SELLER/PATH' \
  --allow-origin 'https://YOUR_REAL_APPROVED_SELLER' \
  --method GET --out /private/scf-pilots/captures/seller.json
```

Only replace the illustrative seller URL with an *actual*, approved HTTPS endpoint. The SF85 original sends a single header-only request, without a wallet, with verified TLS and its own address policy. For a previously captured original, omit this step and point `--capture` at its exact path.

2. Inspect the *actual* source to see the original offer indices. Use the original inspector, **not hand-retyped terms**:

```sh
node stellar/scf-starforge-20261009/sf84-mpp-market-intake/inspect.mjs \
  /private/scf-pilots/captures/seller.json
```

3. Explicitly select **one indivisible original exact Stellar x402 option** and set a decimal-string maximum authorized for subsequent *review*, never an auto-payment. `--max-atomic` is in **atomic units**, not display dollars. It must be no smaller than the quote. Do not select an MPP option, a non-Stellar option or a fabricated index:

```sh
node stellar/scf-starforge-20261009/sf96-merchant-challenge-handoff/handoff.mjs \
  --capture /private/scf-pilots/captures/seller.json \
  --offer-index 0 --intent-id merchant-pilot-20261011-001 \
  --max-atomic 1000 --out /private/scf-pilots/handoffs/review-001
```

The values above illustrate command *shape*, not a current merchant quote. For a live operator run choose the actual `offerIndex` and an explicit cap from the real capture. The new output directory must not exist. The tool uses 0700 for its directory and 0600 for each file.

4. Check the original source binding, then run the **unmodified existing** SF88 offline review:

```sh
node stellar/scf-starforge-20261009/sf96-merchant-challenge-handoff/handoff.mjs \
  --verify /private/scf-pilots/handoffs/review-001
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/cli.mjs \
  --review --config /private/scf-pilots/handoffs/review-001/buyer-review.json
```

### Use the original operator-header acquisition path

The original [SF85 header importer](../sf85-live-402-capture/HEADER_IMPORT.md)
is supported directly. Pass the **same original header file** with
`--headers-file`; the handoff parses it again through SF85, verifies its exact
hash, byte count, prelude count, HTTP status and challenge headers against the
imported capture, then retains both files unchanged in the private bundle.

For an authorized public endpoint reached through the operator's configured
HTTPS proxy, curl's `--suppress-connect-headers` records only the origin response
headers. This matters for proxies whose successful CONNECT response is `200 OK`
rather than `200 Connection established`. TLS verification remains enabled;
there is no redirect following or signing. Keep the actual URL and method with
the acquisition record.

```sh
curl --globoff --silent --show-error --suppress-connect-headers --max-time 8 \
  --request GET --dump-header /private/scf-pilots/captures/merchant.headers \
  --output /dev/null 'https://YOUR_REAL_APPROVED_SELLER/PATH'
node stellar/scf-starforge-20261009/sf85-live-402-capture/import-headers.mjs \
  --url 'https://YOUR_REAL_APPROVED_SELLER/PATH' \
  --allow-origin 'https://YOUR_REAL_APPROVED_SELLER' --method GET \
  --headers-file /private/scf-pilots/captures/merchant.headers \
  --out /private/scf-pilots/captures/imported.json
node stellar/scf-starforge-20261009/sf96-merchant-challenge-handoff/handoff.mjs \
  --capture /private/scf-pilots/captures/imported.json \
  --headers-file /private/scf-pilots/captures/merchant.headers \
  --offer-index 0 --intent-id merchant-import-review-001 \
  --max-atomic 1000 --out /private/scf-pilots/handoffs/import-review-001
```

Choose the actual option and review ceiling from the original inspected offer;
the values above describe the command shape. Continue with the same `--verify`
and SF88 `--review` commands. Imports require their original headers. A direct
SF85 capture retains its existing command and bundle format and does not take
`--headers-file`.

For imported sources, `originalCaptureAtUtc` stays `null`. The selection and
human review separately show the recorded import time, original header hash,
and operator-declared request method. No HTTP capture time or TLS result is
inferred from an imported file. Verification re-parses the retained headers and
re-derives their original selected offer; retaining a hash alone is insufficient.

## Source-bound deliverables

| Private file | Purpose |
| --- | --- |
| `original-capture.json` | **Exact bytes**, unmodified, of original SF85 operator capture. |
| `original-response.headers` | For imported captures: **exact original header-file bytes**, required and checked through the original SF85 parser. |
| `buyer-review.json` | Original SF88-compatible operator review draft with chosen intent, URL, method and complete selected exact Stellar terms. No operator, signer or authorization. |
| `selection.json` | Original capture SHA-256, raw encoded challenge SHA-256, original accepted-offer SHA-256, quote/cap, exact resource URL and selected alternative. |
| `review.txt` | Human-readable handoff card, including instructions for the unchanged SF88 reviewer. |
| `manifest.json` | SHA-256 and byte counts for every retained file. |

`--verify` re-reads the persisted original capture, reruns the **real SF84 inspector**, checks every retained file and derives the same **real SF88 validated** operation. It never trusts the manifest alone and will reject changes to the capture, selected index, terms, budget, config or handoff card. The hashes are locally computed change detection, **not source authentication or signatures**. Compare the printed source SHA to your independently retained operator original if custody matters.

The source must be an SF85-shaped, actual 402 GET or HEAD capture; a non-402, missing/duplicate/ambiguous x402 challenge or malformed MPP companion is refused. The selected option must be native `exact` on `stellar:testnet` or `stellar:pubnet`, with source-provided asset, recipient, integer amount and timeout. The captured merchant URL must match the advertised HTTPS resource origin and path (and any declared query). A payment flow other than supported `authorization` is rejected; nothing is silently coerced. Source classification cannot prove merchant identity, customer consent or onchain settlement.

## Transition to an authorized paid pilot

The generated **review** config is unsigned. The [operator workflow](OPERATOR.md)
can import this exact verified handoff into a new private original SF88 workspace
and durable inbox, supplying the operator's own identities, budget and public
payer. It invokes the existing workspace initializer and native approval path;
the importer supplies no wallet key or approval. Experienced operators can still
compose their own trusted SF88 execution config. A seller may change its quote
between capture and execution, so the original buyer obtains fresh terms and
asks for current native approval. HTTP 200 or 402 alone does not establish finality
or a sale.

Run the one focused source-native wiring acceptance from the complete actual checkout with:

```sh
node stellar/scf-starforge-20261009/sf96-merchant-challenge-handoff/acceptance.mjs
```

It uses original SF84 and SF88 modules, a single ephemeral original-shaped local 402 header capture, a real private output directory, and verifies positive generation plus essential refusal behavior. It does not contact public merchants, send a payment, or run hosted CI. MIT.
