# ETHOnline demo runbook — Agent Revenue Rail

Target: one 2–4 minute recording that proves a coherent agent-to-agent revenue loop and supplies Bazantic A/B evidence.

## Recording sequence

**0:00–0:25 — Problem and service**  
Show the fresh public repository and priced report endpoint. State the buyer agent should not buy every report blindly.

**0:25–0:55 — Baseline**  
Run the exact prompt/model/settings/API-access configuration **without** the Bazantic Recipe. Save raw input/output and hashes into baseline evidence. Do not edit the prompt between takes.

**0:55–1:30 — Recipe + live Graph decision**  
Enable only the Bazantic Recipe. Show live The Graph/Agent0 evidence used by Lane B. Demonstrate one `REFUSE` or `DEFER` outcome where the paid report service is not called.

**1:30–2:20 — BUY + x402/Hedera settlement**  
With the same Recipe, show a live `BUY` policy, first priced request/HTTP 402, exact provider-advertised requirement, real Hedera testnet x402 settlement performed by Lane A, and successful report response. Show an explorer transaction hash only after Lane A verifies it.

**2:20–2:50 — Result depends on both services**  
Show the final Lane C result containing Graph decision/evidence digest and paid report recommendation/digest. Explain the counterfactual: `REFUSE`/`DEFER` means no purchase; `BUY` without verified settlement means no usable report.

**2:50–3:20 — A/B proof**  
Run `npm run verify:ab` against the two captured experiment records. State exactly what improved while model/settings/API access remain identical.

**3:20–3:40 — Submission proof**  
Show public repo, deployed URL, Bazantic Gateway/Recipe identifier, and exact sponsor-prize selections. Do not claim acceptance or prize eligibility beyond visible artifacts.

## Evidence capture checklist

- public repository URL + exact submission head
- deployed service URL
- Bazantic username used for attribution
- Bazantic Gateway identifier/URL
- Bazantic Recipe identifier/URL
- exact Graph provider endpoint/product and evidence digest
- Hedera testnet transaction hash from Lane A
- baseline and Recipe raw captures
- `verify:ab` result/evidence digest
- 2–4 minute video URL
- ETHGlobal project URL after submission
