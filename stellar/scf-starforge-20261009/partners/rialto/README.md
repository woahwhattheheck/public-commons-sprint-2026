# Rialto customer receiving

A complete receiving workflow for an original Rialto catalogue and a useful paid HTTP request. The customer can inspect every original listing and payment alternative, describe the exact task, prepare with the existing Stellar Forge buyer, transfer the complete operation, and reopen it on another machine.

## Included product

- Complete original offset-page catalogue capture with raw HTTP responses and visible observation intervals.
- Saved-catalogue comparison retaining original rows, resource/tool identities, changed fields and scope.
- Self-contained grayscale catalogue and request editor with search, pagination, saved browser drafts and full filtered printing.
- Exact request selection with original source, body, ordinary headers, intent, asset, recipient and atomic cap.
- Pre-dispatch attempt retention and explicit challenge capture IDs for interrupted requests.
- Actual merchant challenge receiving followed by the original SF88 prepare, review and export commands.
- Complete private archive and independent receiving with source and member hashes.
- A concrete customer handover guide and fixed-price merchant onboarding workshare.

## Use

Requirements: Node.js 22+, Linux `flock`, and a complete installed original Commons checkout. The four modules use Node built-ins.

```sh
node customer.mjs capture --plan plan.example.json --directory /absolute/private/catalogue-001
node customer.mjs inspect --directory /absolute/private/catalogue-001
```

Open `catalogue-001/report.html`, review an actual HTTP resource, describe the useful customer request, and download its selection. Follow [OPERATING.md](OPERATING.md) through the actual challenge, original buyer preparation, export, receiving and reopening.

| File | Role |
|---|---|
| `core.mjs` | Original pagination, catalogue comparison, selected request and challenge contracts |
| `io.mjs` | Private files, original HTTP captures, Linux writer lock and complete receiving |
| `customer.mjs` | End-to-end CLI joining the original catalogue and installed SF88 buyer |
| `report.mjs` | Offline grayscale source browser and request editor |
| [OPERATING.md](OPERATING.md) | Complete operator and receiving journey |
| [WORKSHARE.md](WORKSHARE.md) | Merchant-specific $1,500 implementation proposal and account workflow |
| [SOURCE_CONTRACT.md](SOURCE_CONTRACT.md) | Exact reviewed Rialto and original buyer source interfaces |
| `plan.example.json` | Public original testnet discovery and facilitator endpoints |

The maintained Rialto source already includes an MCP client. MCP resources remain fully visible in the received catalogue, while their original tools retain execution. This receiving path focuses on a customer HTTP request and the existing buyer's portable operation.

Every live run retains its original source pages, actual request and response. A named merchant capture is sent once; reusing an interrupted capture returns its existing attempt. The original buyer retains account authorization, payment, response storage and recovery.

MIT. Copyright 2026 TokenJunkieLabs.
