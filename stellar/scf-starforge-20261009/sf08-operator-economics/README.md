# SF-08 · Stellar Bazaar and x402 facilitator operating economics

**Status: source-backed, offline illustrative decision tool — not a running service, grant application, quoted production budget, observed transaction fee, observed demand, real FX quote, or revenue.** Checked against vendor/public RFP documentation on **2026-10-09**. Owner holds all SCF forms/submissions, purchases, external contact and mainnet spending.

This work covers only *economics and service-capacity planning*, independently of the fleet's x402 wire conformance, SF-03 traceability, and Bazaar implementation. The SCF [x402 Stellar/Bazaar RFP](https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/rfp-track) explicitly calls for fee sponsorship, a self-hostable path, off-chain discovery, configurable mainnet pricing, availability and a credible business model (§§3.1–3.6). Its x402 RFP is listed with a Q3/#45 heading; **SCF #46 applicability must be confirmed by the separately owned eligibility workstream**. None of these costs establishes an award or an eligible round.

## Run and edit

Requires Node 20+ only; no npm install, API keys, external calls or GitHub Actions:

```sh
node model.mjs inputs.json > scenarios.json
```

The generated `scenarios.json` is the reproducible default calculation. Change the input file locally for real pricing quotes, different volume assumptions, retry rates, FX scenarios, paid discovery vs free read mix, or an operating-fee scenario, then rerun. The program validates nonnegative finite inputs and keeps unknown costs **null**, not quietly priced at zero. Both architectures use the same merchant behavior assumptions, but *neither has been capacity tested*.

## First-party price inputs (USD; retrieved Oct 9, 2026)

| Modeled component | Source-backed posted price | Interpretation / important omissions |
|---|---:|---|
| Cloudflare Workers paid plan | $5 per month base; 10M requests and 30M CPU milliseconds included; excess $0.30/M requests and $0.02/M CPU milliseconds | [Cloudflare official pricing](https://developers.cloudflare.com/workers/platform/pricing/), Oct 2, 2026. Paid Worker request billing and CPU apply; DB, search index and upstream RPC separate. Static assets and caching have different billing mechanics. |
| DigitalOcean managed PostgreSQL HA | $30/mo primary + at least one $30/mo standby = **$60/mo** minimum | [DigitalOcean official DB pricing](https://docs.digitalocean.com/products/databases/postgresql/details/pricing/), verified Sep 30, 2026. Tiny HA plan; **new-plan/standby restrictions change Oct 15 and Nov 30 2026**, confirm service availability at procurement. This is not proof of actual scale or 99% end-to-end uptime. |
| DigitalOcean Basic VM, 2 GiB / 1 vCPU | $12/mo each | [DigitalOcean Droplets official pricing](https://www.digitalocean.com/pricing/droplets). `vm_db` assumes **two VMs for $24/mo** plus $60/mo DB, but omits a load balancer, failover orchestration and proof of sufficient CPU/memory. |
| Sponsored Soroban settlement | **~0.0023 XLM** per settle, per [SCF RFP background §2](https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/rfp-track) | It is a broad RFP approximation, **not a current ledger quote, invariant fee or guaranteed cost**. Actual footprint, simulation, congestion, inclusion and failure patterns can vary. Model assumes one on-chain attempt per successful paid call; change as evidence warrants. |
| XLM/USD for sponsor conversion | **$0.20/XLM assumed** | Arbitrary **sensitivity input**, explicitly **not** today's exchange rate or purchase quote. Replace only with a dated price available at budgeting time. |
| Operator fee | **$0.001 per successful paid call assumed** | Pure hypothetical revenue design, not a merchant price, Stellar protocol fee, approved commercial policy, collected payment, or market evidence. Default subscribers = 0. |
| RPC, catalog/search compute & storage, observability/security/support, other ops | **unpriced/null** | Provider quote, performance measurement and a maintenance plan required. They are **excluded from the shown optimistic contribution** until non-null inputs are supplied. External audit, compliance, incident response and staffed operation are not funded by $0. |

The official RFP requires mainnet fee sponsorship and says the on-chain index is only an optional stretch because each extra transaction brings network fees/rent. This model keeps search indexing *off-chain*. Hosting assumptions are sketches, not an architecture endorsement; RPC response times, `upto` resource use, retries and timeouts must be benchmarked against the *actual* stack and chain simulation.

## Default 30-day scenarios

All rows use **five free discovery queries + two additional Worker HTTP interactions per successful paid call**, an illustrative **5 ms Worker CPU** per request, **3 RPC calls** per successful payment, a 20× burst multiplier, one included on-chain settlement attempt, one $0.001 operator fee, assumed $0.20/XLM, and no subscribers. All throughput figures are *demand projections*, **not measured capacity**.

| Paid calls/mo | HTTP req/mo | Edge + HA DB quoted floor | Two VMs + HA DB quoted floor | Fee sponsorship (hypothetical USD) | Edge optimistic monthly contribution | VM optimistic monthly contribution |
|---:|---:|---:|---:|---:|---:|---:|
| 1,000 | 7,000 | $65.00 | $84.00 | $0.46 | −$64.46 | −$83.46 |
| 100,000 | 700,000 | $65.00 | $84.00 | $46.00 | −$11.00 | −$30.00 |
| 1,000,000 | 7,000,000 | $65.10 | $84.00 | $460.00 | $474.90 | $456.00 |
| 10,000,000 | 70,000,000 | $89.40 | $84.00 | $4,600.00 | $5,310.60 | $5,316.00 |

**Interpretation:** each table contribution is an **optimistic ceiling conditional on an unverified fee/business model and excluding four unknown cost categories**. It is *not profit*. At the stated assumptions, the model's optimistic monthly break-even threshold is **120,362 successful calls (edge)** or **155,547 (VM)**. Any nonzero omitted spending increases these thresholds; any observed extra chain attempts or FX increase may remove contribution entirely. A hypothetical operator fee must be justified by seller willingness and competitive pricing; no revenue exists here.

At 1M paid calls/month, the 7M HTTP requests represent only ~2.70 **average** HTTP RPS, but ~54.01 RPS with a **modeled 20× burst**. At 10M, modeled burst is ~540 RPS. Neither vendor resource tier has been shown capable of serving this burst with required latency and 99% availability. For a 30-day month, a 99% availability objective equates to a **432-minute maximum downtime** and requires measurement of the *whole discover/verify/settle chain*, not just the healthcheck process.

## Pricing sensitivity and operator tradeoffs

The model assumes 0.0023 XLM/settle and 1 on-chain attempt per paid call. At 100,000 successful monthly settlements, sponsorship equals 230 XLM. At **hypothetical** XLM/USD `0.10`, `0.20`, `0.50`, its dollar equivalent would be `$23`, `$46`, `$115`, before exchange and treasury costs. With a hypothetical $0.001/call operator fee ($100 gross) and the $65/month edge+DB posted-price floor, the corresponding optimistic contributions would be **+$12, −$11, −$80** before the unpriced services. A provider cannot responsibly choose a revenue policy by treating projected merchant payment volume as its own revenue.

To evaluate managed vs self-host in a grant/business plan, publish:

1. Observed full-chain request fanout (catalog query, LLM ranking, `verify`, `settle`, sponsored XLM), success/retry fraction, and measured Worker CPU/RPC consumption on the **real implementation**.
2. First-party RPC, search/vector hosting, paid observability, bandwidth/LB, encrypted backups, audit, support and legal/compliance vendor quotes; set the four null fields. Separately budget audit as an implementation milestone, not a per-call expense.
3. 30-day/quarterly burst/concurrency and 99% uptime measurements from an owner-approved network environment. Dual-network testnet/mainnet conformance is another team's scope; do not substitute these operating cost projections for actual protocol acceptance.
4. A transparent fee-and-access policy (e.g., testnet remains free, optional hosted operator cost recovery, no hard-coded fee for self-hosters) and measured demand/pilot proof, then recompute *net* contribution and downside under 10× lower adoption, XLM price movement, chain retries and abuse.
5. Validate the **October/November 2026 managed DB plan change** against actual provisioning before any quotation or deployment decision. Do not purchase anything without authorization.

## Source provenance and exclusions

- Primary functional/reliability scope: [Stellar SCF RFP Track / X402](https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/rfp-track), especially §§2, 3.1, 3.2, 3.5–3.6, and §5. The RFP does not say current quarter #46 automatically qualifies.
- Provider prices: [Cloudflare Workers](https://developers.cloudflare.com/workers/platform/pricing/), [DigitalOcean managed PostgreSQL](https://docs.digitalocean.com/products/databases/postgresql/details/pricing/), [DigitalOcean Droplets](https://www.digitalocean.com/pricing/droplets).
- Stellar fee calculation beyond the approximate RFP value: [official network fee/resource documentation](https://developers.stellar.org/docs/learn/fundamentals/fees-resource-limits-metering). The eventual sponsor must simulate the **actual signed and submitted** Soroban invocation and characterize fees on both networks.
- Actual customer/partner commitments, live funding, mainnet deployments, grant eligibility, legal applicant status, and application submission are **not evidenced by this artifact** and are not asserted.

**No GitHub Actions, hosted tests, deployment, chain transaction, purchases, third-party API requests, or outbound communications are necessary to use this tool.**