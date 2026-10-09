# Swap.io price-comparison evidence auditor

**Status:** offline research/evidence deliverable for the **October 14, 2026** [Superteam Swap.io bounty](https://superteam.fun/earn/listing/write-a-thread-or-long-post-price-comparison/). Total competitive pool **500 USDC**, with first–fifth conditional placements **200 / 125 / 80 / 60 / 35 USDC**. This source is **not an entry**, X post, trade, referral, submission, award or payment.

## Why this exists

The sponsor requires comparing the **same token pair, input size and time window** on Swap.io and at least two other Solana venues, **actual screenshots**, a human-original X post of five or more tweets (or long post), X tags, one genuine Swap.io wallet trade, entrant-owned referral link and an actual Superteam link submission. The sponsor will prefer multiple pairs/sizes and honest findings, **including examples where Swap.io loses**.

This Node 22 zero-dependency auditor reviews human-supplied, screenshot-backed quote captures without fetching prices, connecting a wallet or creating misleading market evidence. It requires comparable mint/input/slippage terms, validates independent timestamp windows, hashes exact PNG/JPEG images and the source JSON, calculates differences using `BigInt` base units (never floating-point quote arithmetic), produces a reproducible Markdown ledger, and explicitly holds the external participation gates. The screenshot contents and human transcription must still be inspected by the original entrant; a hash proves the image file identity, not the correctness of its values.

## Capture workflow

1. Create a new working directory containing the capture JSON and an `evidence/` subfolder. The template [capture-template.json](capture-template.json) uses placeholder amounts and image paths: **it is not live data and will not pass production admission**. Never replace it with invented numbers.
2. On the *actual live* Swap.io interface and at least **two other real Solana venues**, capture the exact pair/mints, input atomic quantity, compatible slippage, observed quote output, route and timestamp. Keep screenshots. Capture the three venue screens within **90 seconds**, preferably much closer. Synchronize the computer clock. Run more than one size/pair.
3. Write one observation per venue for each case; enter quoted token outputs as **decimal integer base units**, not decimals or formatted currencies. Use exact token decimals and mint addresses. Include **real independent PNG/JPEG file** under `evidence/` for every observation. Do not reuse screenshots.
4. Run `node audit.mjs /path/to/capture.json --output /path/to/audit.md` from Node 22. Output is written exclusively and cannot silently replace an earlier receipt. A failed validation exits nonzero and does not create an output.
5. Inspect and reconcile each screenshot yourself; account for route execution fees, token-account rent, gas/priority fees and differences in quote semantics. If a venue says `indicative`, do not call the quote executable. Include losing comparisons and why routes differ. Produce original human editorial content and genuine public X/entrant submission, not an automated-only entry.
6. Save wallet trade transaction, entrant-owned referral dashboard link, published X link and official Superteam acknowledgment **outside this code and separately from the quote ledger**; wallet and account status are not independently verified by this tool.

## Capture schema

- JSON object keys: `synthetic: false`, `cases: [...]`.
- Every case: `id`, `inputMint`, `outputMint` (base58 strings), `inputSymbol`, `outputSymbol`, `inputDecimals`, `outputDecimals`, `inputAtoms` (positive integer string), `slippageBps` (shared across its observations) and `observations`.
- Each observation: `venue` (must include `Swap.io` and at least two **distinct** others), `capturedAt` (explicit `...Z` UTC seconds), `quotedOutputAtoms` (positive integer string), `screenshot` (relative path inside capture directory), `route` (from the actual route UI), `quoteKind` (`indicative` or `executable`), optionally `feeNote`.
- Synthetic fixture work is only allowed under `--synthetic-preview` and is prominently marked **not valid competition evidence**. No network requests or live provider calls are made. The capture tool never places trades.

## Source caveat: sponsor fee disclosure needs checking

First-party pages currently disagree: [Swap.io welcome](https://docs.swap.io/welcome.md) says a small platform fee **is** added; [Swap.io swapping guide](https://docs.swap.io/swapping/swaps.md) says **no** platform fee. Neither statement should be treated as dispositive for any live quote without checking the contemporaneous UI/transaction. Only compare like-for-like final output, and disclose unresolved fee incidence; avoid blanket marketing claims about saved money.

## External eligibility and schedule

The sponsor [listing](https://superteam.fun/earn/listing/write-a-thread-or-long-post-price-comparison/) sets **October 14** deadline and **October 28, 2026** winner announcement; source says one entry per person, at least one actual swap, 5+ tweet thread or long post, original work only, two venue comparisons with screenshots, and a referral link/tag requirements. A runnable local audit is not contest acceptance or payment. Original author/entrant/X account and wallet remain unchanged.

No external posting/registration/trading or real quote read took place in preparing this source. Synthetic data is excluded from payable evidence.