# Creator Pool: creator delivery workspace

The **Creator** view in the existing `creator-pool/web/` app now carries a creator's work from a local draft through the existing real `POST /api/campaigns/:id/submissions` API. It does not create a new award policy, wallet signer, payment method, server route, or external service.

## Creator flow

1. Open an **open** funded campaign and choose **Creator** in the existing role switch. In the local demo choose the correct demo actor; in public mode connect the actual submitting wallet.
2. Add a work title, a **publicly reachable** HTTP(S) work URL, and optional delivery notes. A live preview shows the URL the sponsor will receive and what remains to be completed. A URL with embedded credentials, a loopback host, or a private-address host is not accepted by the editor.
3. Choose **Save draft locally** at any time, even with partial fields. The status says **Unsaved changes**, **Saved on this device**, or **No saved draft**. **Discard draft** only affects this local copy. Browser navigation warns about unsaved edits where the browser supports it.
4. Select **Send submission** only once the editor is valid and the original wallet/actor gate passes. The existing API, operation journal, original chain transaction path, and browser transaction reconciliation are used, unmodified.
5. The creator's submitted work appears in the campaign's actual **Submissions** list after chain confirmation. The sponsor still independently chooses approval; an approved creator initiates any reward claim.

In the local demo, the header's **Demo actor** picker and the form's
**Submitting as** picker select the same creator. Either control updates the
form, the submission ownership labels and the claim controls together. Normal
state refresh keeps that selected actor and their current draft; switching to
another actor opens that actor's separate saved or unsent draft.

A confirmed submission removes the matching local draft. **Rejected, pending, uncertain, or unconfirmed outcomes preserve it**. The original wallet journal determines whether an outstanding transaction needs reconciliation, not a second click or a fresh operation ID. Do not create a new transaction to "retry" an uncertain send.

## Limits and boundaries

- Title: 1–140 characters. URL: 8–2048 characters; HTTP(S), no credentials, not a private/local host. Notes: at most 1000 characters. These match the existing backend field lengths.
- Draft copies use browser `localStorage`. Keys include original chain, pool contract, campaign, and creator demo actor or connected wallet. They are saved **only in this browser/origin**, not in the contract, backend, account or external cloud. The content is **not encrypted**. Use only material intended for the sponsor. Switching actors/wallets separates drafts.
- Changing an already-submitted title, work URL or note requires a **new independent submission**. Existing on-chain content hashes are immutable. A draft, request receipt or tx broadcast alone is not evidence of sponsor approval, settlement or revenue.
- Local demo signatures use its original unlocked Ganache actors and non-monetary demo token. Public mode continues to use the original connected EIP-1193 wallet, unsigned backend preparation and exact tx reconciliation.
- The existing sponsor campaign workspace, reward ledger, budget calculations, approval/claim/close controls, backend API, contracts and transaction journal are unchanged.

Source: `creator-pool/web/app.js`; authoritative contract: `creator-pool/backend/API-CONTRACT.md`.
