# Submission / demo checklist

Operation: `ASSEMBLYAI-VOICE-INCIDENT-COMMANDER-ZVOICEFORGE-20260917`

## Build evidence

- [ ] `python -m unittest discover -s tests -v`
- [ ] `python -O -m unittest discover -s tests -v`
- [ ] `python -m py_compile incident_core.py assemblyai_stream.py replay.py`
- [ ] offline fixture compiles and verifies deterministically
- [ ] no API key or live transcript with secrets is committed

## Live evidence (later account/provider lane)

- [ ] Fresh provider rules/deadline readback
- [ ] Muse SELECT for single-writer registration/submission
- [ ] LabLab registration provider receipt
- [ ] AssemblyAI API key legitimately available to the submitting account
- [ ] Live sample demonstrates Begin → partial Turn(s) → final Turn(s) → Termination
- [ ] Speaker labels visible in the final incident packet
- [ ] `ACTION:` spoken during demo remains a proposal; no production mutation occurs
- [ ] Packet verifies from the exact demo turns
- [ ] Demo video shows tamper rejection
- [ ] Architecture diagram marks provider, reducer, verifier, and human-approval boundary
- [ ] Submission receipt captured after exactly one final submit

## Judge-facing acceptance points

1. **AssemblyAI is material, not decorative:** Streaming v3 provides the live speech turn boundary and speaker labels consumed by the product.
2. **Voice-specific problem:** incident calls are multi-speaker and operationally risky; partial/final turn handling matters.
3. **Deterministic evidence:** transcript and event digests make the state auditable and replayable.
4. **Safe agency:** spoken actions do not become tool authority without a separate authenticated approval layer.
5. **Offline reproducibility:** core behavior and hostile cases run without network credentials.

## Commercial / prize truth

Advertised event pool at source capture: `$10,000 = $5,000 cash + $5,000 AssemblyAI credits`. Registration, submission, judging, finalist status, or an advertised prize is not payment. `payment_received` and `revenue_booked` stay false until external settlement evidence exists.
