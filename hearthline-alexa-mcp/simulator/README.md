# Hearthline interaction simulator

A judge-visible, browser-only interaction surface for the Amazon Build, Ship, Shape / Alexa+ Hearthline experiment.

It demonstrates the product law without touching a provider: routine work may proceed, irreversible work stops for a human decision, uncertain execution outcomes fence retries, and every transition is preserved in a deterministic operation receipt.

## Run

From `experiments/hearthline-alexa-mcp`:

```bash
python -m http.server 8080
```

Open `http://localhost:8080/simulator/`.

No backend, account, credential, network provider, booking, purchase, contract, payment, or Alexa device is required. The two seeded operations and evidence records are synthetic demonstration fixtures.

## Interaction contract

- `ROUTINE` starts `READY` and can execute without approval.
- `IRREVERSIBLE` starts `DECISION_REQUIRED`; execution is impossible before explicit approval.
- denial is terminal.
- an `unknown` execution result enters `RECONCILIATION_REQUIRED`; retry is impossible until the simulator records whether the prior effect actually occurred.
- reconciliation as `not_executed` increments the attempt generation before retry.
- every command has a caller-provided ID. An exact replay is idempotent. Reusing that ID for different input fails closed.
- evidence has a bounded stable ID, capture time, human-readable note, and exact 64-hex content digest.
- export uses canonical recursively sorted-key JSON. Same state means byte-identical export.

Keyboard shortcuts use `Alt+A` approve, `Alt+D` deny, `Alt+E` execute, and `Alt+R` reconcile-as-not-executed. Native buttons remain available for keyboard, touch, and pointer users. Status updates use an ARIA live region and focus styles remain visible.
