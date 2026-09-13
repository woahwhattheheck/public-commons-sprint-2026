# Architecture

```text
Live The Graph / Agent0
        |
        v
 Lane B policy verifier ---- SKIP/HOLD ----> STOP / retry later
        |
       BUY
        v
 Lane C receipt adapter + Recipe contract
        |
        v
 Lane A report endpoint --HTTP 402--> x402 / Hedera testnet settlement
        |                                  |
        |<------ independently verified ---|
        v
 paid report response
        |
        v
 Lane C deterministic result + A/B evidence + release evidence gate
```

## Trust boundaries

- **Lane B owns Graph truth.** Lane C does not manufacture provider reputation or substitute a static fixture for live Graph evidence. C also preserves B's out-of-band evidence-transport provenance and exact approved service URL.
- **Lane A owns payment truth.** Lane C treats `upstreamVerified` as a dependency and cannot create settlement authority itself.
- **Lane C owns product semantics and judge evidence.** It binds controlled-variable A/B evidence, preserves exact pricing/network/asset declarations, and refuses unsupported release claims.
- **Human owner retains submission authority.** Even a complete packet terminates at `READY_FOR_HUMAN_SUBMISSION_REVIEW`.

## Determinism

Canonical JSON and SHA-256 commitments bind normalized inputs/results. Money stays canonical decimal-string tinybar; HBAR display is derived with BigInt integer arithmetic. Lane B receipt digests are recomputed before C consumes them; B's trusted evidence transport/declaration must be internally consistent; and both the Lane B offer price **and exact service URL** must match Lane A before payment-required or settlement evidence can advance. Evidence schemas reject unknown fields so new authority-bearing claims cannot silently enter existing receipts.
