# Agent Revenue Rail capability matrix

| Capability | Source of truth | Lane C behavior | Authority explicitly not granted |
| --- | --- | --- | --- |
| Provider identity / reputation | Lane B live The Graph / Agent0 evidence | consumes Lane B `BUY` / `SKIP` / `HOLD` receipts; verifies canonical receipt + zero-payment authority + trusted transport/declaration consistency; maps to buy/stop/defer and applies an additional Graph-block freshness fence | no provider endorsement or identity certification |
| Paid-service endpoint | Lane B offer/registration binding | preserves the exact canonical `serviceUrl`; Lane A evidence must use that same endpoint, and B's derived service origin must agree | no endpoint substitution after BUY |
| Priced report offer | Lane A price + Lane C public offer contract | exact canonical decimal-string tinybar + BigInt-derived HBAR display, `hedera:testnet`, HBAR `0.0.0` | no charge/payment authority |
| HTTP 402 requirement | Lane A service response | remains `PAYMENT_REQUIRED`; preserves requirement digest | never treated as settlement |
| Hedera settlement | Lane A verifier | accepts `SETTLED` only when A marks `upstreamVerified=true`, 2xx response, tx hash | Lane C does not verify chain state |
| Report usability | Lane A report + B policy + C recipe | report usable only after fresh BUY and verified settlement | no business-decision correctness claim |
| Bazantic Recipe | live Bazantic product | portable semantic recipe spec + deterministic normalization | local JSON is not claimed to be Bazantic import schema |
| A/B evidence | captured baseline + Recipe run | rejects prompt/model/settings/API/input drift | no sponsor acceptance/prize eligibility claim |
| Release evidence | live repo/deploy/Recipe/Graph/Hedera/A/B/video captures | fail-closed release gate; placeholder and secret-shaped evidence rejected | only `READY_FOR_HUMAN_SUBMISSION_REVIEW` |
