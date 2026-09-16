# Capability matrix

| Surface | Implemented | Explicitly not claimed |
| --- | --- | --- |
| Lane B compatibility | Exact landed receipt schema, service URL, provenance fields, digest recomputation, host-clock freshness | Graph provider authenticity without retained host readback |
| Runtime authority | Frozen module-branded capability; serialized/object-spread lookalikes rejected | Authentication of arbitrary request JSON |
| Lane A | Exact receipt digest, HTTP 402 binding, settlement/report fields, service/amount match | Wallet write, payment execution, transaction verification without provider adapter |
| Report | Payload digest recomputation and Lane A service-response cross-binding | Truth of report claims beyond retained provider response |
| Offer/config | Exact tinybar arithmetic, public config normalization, secret-shape rejection | Funds custody or credential storage |
| A/B | Comparable-run drift detection and structured improvement score | Real model/provider run until actual captures replace fixtures |
| Release | Manifest validation, secret/placeholder checks, permanent HOLD | READY, submission, prize eligibility, or payment authority |
