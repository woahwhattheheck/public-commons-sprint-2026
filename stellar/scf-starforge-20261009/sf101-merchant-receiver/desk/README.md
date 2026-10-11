# Paid-file merchant desk

Operate the original SF101 paid-file business from a private local workspace: select a merchant-approved file, enroll its exact order and price, save the customer purchase handoff, inspect the native entitlement, diagnose the original file, and manage customer access. The desk uses the existing `merchant.sqlite3`, checkout configuration, receiver, and access controls. Orders created with the existing CLI appear here, and changes made here take effect in that same receiver.

The original [paid-file checkout](../CHECKOUT.md) and [access lifecycle](../ACCESS.md) remain the maintained engines. The desk calls `readCheckout`, `initializeMerchant`, `inspectOrder`, `prepareHandoff`, and `orderHandoff`; its Python child calls the original `access.py` operations. Receipt and status output come from the original receiver CLI. There is no alternative order store, payment engine, token issuer, or duplicate entitlement implementation.

## Prepare and open

Use Node 22+ and the Python 3.11+ executable in the existing checkout configuration. Install the full original source closure, including `receiver.py`, `access.py`, and the paid-file checkout files. No additional UI framework or Python package is required.

Keep three separate merchant locations:

| Location | Contents |
| --- | --- |
| Existing checkout state and outbox | The original order database and native settlement delivery journal |
| Approved file directory | Only the private files this operator is allowed to enroll as products |
| Desk workspace | Saved desk configuration and create-only customer/support exports |

Use real directories with private `0700` permissions; the checkout JSON and each enrolled product must be private regular `0600` files. Product files must be between 1 byte and 32 MiB, matching the original receiver. The product directory must exclude the checkout configuration, merchant state, outbox, and desk exports. The server rejects overlapping roots and symlinked source/output paths.

Create a desk workspace pointing at the existing checkout. The command creates a new private descriptor and export directory; it does not initialize or alter the original order store.

```sh
D=stellar/scf-starforge-20261009/sf101-merchant-receiver/desk
node "$D/cli.mjs" init \
  --dir /private/merchant/desk \
  --config /private/merchant/checkout.json \
  --files /private/merchant/products \
  --claim-env SF101_CLAIM_TOKEN \
  --claim-env SF101_REPLACEMENT_CLAIM_TOKEN \
  --actor merchant-operator

node "$D/cli.mjs" inspect --workspace /private/merchant/desk
node "$D/cli.mjs" start --workspace /private/merchant/desk
```

Set the selected claim-token environment variables in the existing private operator shell before starting. The desk stores and displays their **names and availability**, never their values. The original receiver requires a 32–1024 byte token. Each action receives only its selected environment variable in its own shell-free child process. Rotating a token does not change the server's shared environment or another operation's token. Restart the desk after updating the shell environment.

The launch result contains a private `http://127.0.0.1:PORT/#token=…` URL. Open that exact URL. The browser consumes the fragment into memory and removes it from the address bar. Keep the terminal output private. Every order, source-list, export, and mutation API requires the per-launch Bearer capability; the browser does not persist it. Reloading after fragment removal requires reopening the launch URL.

To use already prepared directories without saving a workspace descriptor:

```sh
node "$D/cli.mjs" serve \
  --config /private/merchant/checkout.json \
  --files /private/merchant/products \
  --out /private/merchant/desk-exports \
  --claim-env SF101_CLAIM_TOKEN \
  --actor merchant-operator --port 0
```

The desk runs in the foreground. Ctrl-C stops its listener and finishes already accepted native operations. The separately running checkout, receiver, and original SF98 delivery worker retain their own lifecycles.

## Operator workflow

1. **Review the merchant and terms.** The workspace shows the actual checkout route, public resource, exact atomic amount, network, asset, and recipient from the original compiled checkout. These values are fixed for the desk session. Change the original checkout configuration and reopen the desk when the merchant intentionally changes its terms.

2. **Initialize only a new store.** If the configured order store does not exist yet, use Initialize. This calls the original `initializeMerchant` path. Opening the desk alone does not create an order database.

3. **Enroll the approved file.** Choose a relative file name under the configured product root, enter the merchant's approved order reference, and select an available claim-token environment name. The server verifies the rooted file and calls the original `prepareHandoff`. Original SF101 enrollment stores the source's exact size and SHA-256, selected payment terms, and hashed token in its existing order. The create-only JSON handoff contains the original approved purchase URL and delivery URL; it contains no claim token. Checkout references use 1–80 letters, digits, dots, underscores, colons, or hyphens, but cannot begin with a hyphen or equal `.`/`..`: those values cannot round-trip the original checkout command/URL interface. Existing orders retain the original broader reference rules for inventory, access control, and receipts.

4. **Give the customer the original purchase handoff.** Download the handoff JSON for the existing SF88 purchase preparation flow documented in `CHECKOUT.md`. Send the separately provisioned claim token through the merchant's existing approved customer channel. The desk's handoff action does not send a message, execute a purchase, or create an entitlement.

5. **Follow the same order.** Search by exact order reference or filter the original paginated inventory by pending, available, suspended, or expired access. The detail view shows native order state and the access policy separately, with the current revision and original action history. Original SF98 signed notification acceptance changes `PENDING` to `ENTITLED` through the existing receiver. Access policy determines whether that entitled file is currently available to its customer.

6. **Resolve customer support in place.** Diagnose the original source to distinguish `MATCH`, `SOURCE_CHANGED`, and `SOURCE_UNAVAILABLE`. Suspend or resume access, set or clear an expiry, or rotate the original token hash after providing a reason. The server fixes the operator identity at startup. The existing `access.change_access` operation records the reason, identity, revision, and stable operation ID atomically in the original database.

7. **Export the actual record.** An entitled order can produce its original merchant entitlement receipt. Support export uses the original streamed order/access export, including its snapshot and action history. These create-only private artifacts are available through authenticated downloads. A receipt describes the authenticated SF98 notification accepted by this merchant; it does not replace the independent native Stellar accounting record.

### Recovery and concurrent edits

Each access action carries the exact displayed revision and one stable operation ID. A lost response can be retried with that **same complete action**. The original access engine returns the committed result if it already succeeded. Reusing an operation ID for changed arguments is a conflict. A changed revision requires a fresh review of the order before a new action.

Enrollment and handoff publication have separate durable outcomes. If the browser response is interrupted, inspect the same order reference and use **Recover handoff**. A recovered handoff calls the original order inspection; it does not enroll again, rotate the token, or make a payment. An existing deterministic `handoff-SHA256(orderRef).json` is reused only when its exact content still equals the original order and current compiled terms. An altered handoff is a conflict, and an original source that no longer matches its enrolled digest must be repaired before recovery.

Native writes continue if a browser disconnects after dispatch. The desk does not present a disconnected browser as proof that a mutation was cancelled. A worker timeout during an access mutation returns `ORIGINAL_ACCESS_OUTCOME_UNKNOWN`; inspect the current order and retry the same original operation ID when necessary.

Receipt and support exports receive unique names. Downloads are limited to artifacts registered by this desk session and their original metadata; a changed artifact is rejected. After restart, Recover handoff re-registers the original deterministic handoff. Other retained exports remain private files in the operator's export directory; create a new native receipt/support snapshot when a browser download is needed.

## Runtime integration

The server exports one launcher and leaves signal handling and output to its caller:

```js
import { startMerchantDesk } from './desk/server.mjs';

const desk = await startMerchantDesk({
  config: '/private/merchant/checkout.json',
  filesRoot: '/private/merchant/products',
  outputRoot: '/private/merchant/desk/exports',
  claimEnvs: ['SF101_CLAIM_TOKEN', 'SF101_REPLACEMENT_CLAIM_TOKEN'],
  actor: 'merchant-operator',
  port: 0,
  env: process.env,
});
// Deliver desk.url only to the local authorized operator.
// On shutdown:
await desk.close();
```

The result is `{origin, token, url, server, close}`. Config and file/output roots must be normalized absolute paths. Both supplied roots must already exist as private real directories. An absent original state directory is allowed only when its private parent exists; initialization remains an explicit action.

The listener binds `127.0.0.1` only and accepts its exact assigned Host and Origin. It rejects cross-site and same-site browser calls, duplicate authorization headers, unrecognized body fields, and arbitrary output paths. Local assets use a restrictive Content Security Policy without external scripts, styles, fonts, or telemetry. Keep this listener outside the merchant's public reverse proxy. Its capability supplements the owner's operating-system isolation; it is not a remote multi-user admin service.

File inventory is recursive, skips symlinks and files outside the original private-file contract, and uses stable name pagination. One root may contain at most 10,000 inspected entries and 64 nested levels. An oversized root returns an explicit error; select a narrower product directory instead of treating an incomplete list as complete. File contents are never sent to the desk browser. The original access support writer retains its own 256 MiB export limit.

### HTTP interface

All `/api/` requests require `Authorization: Bearer TOKEN`. POST bodies use `application/json`. Order references are URL-encoded path segments. A response error is `{error: 'STABLE_CODE'}`; validation is 422, missing orders/exports are 404, native revision/replay conflicts are 409, and unavailable native operations are 503.

| Method and path | Input | Result |
| --- | --- | --- |
| `GET /api/session` | None | Compiled checkout terms, configured roots, operator, environment names/availability, native store status |
| `GET /api/files` | Optional `after`, `limit` | `{files:[{name,bytes}],nextAfter,skipped}` under the approved product root |
| `GET /api/orders` | Optional `status`, `after`, `limit` | Original `access.list_orders` result |
| `GET /api/orders/REF` | Exact order reference | Original `access.show_order` result and latest actions |
| `POST /api/initialize` | `{}` | Original merchant initialization |
| `POST /api/enroll` | `{ref,file,claimEnv}` | Original enrollment and exported purchase handoff |
| `POST /api/handoff` | `{ref}` | Original order handoff creation or exact-content recovery |
| `POST /api/access` | `{ref,action,expectedRevision,operationId,reason,expiresAt?,claimEnv?}` | Original revision-checked access operation |
| `POST /api/file-health` | `{ref}` | Original file-health result |
| `POST /api/receipt` | `{ref}` | Original create-only entitlement receipt |
| `POST /api/support` | `{}` | Original create-only support export |
| `GET /api/exports/NAME` | Previously returned name | Authenticated download of the registered unchanged artifact |

`status` is one of `all`, `pending`, `available`, `suspended`, or `expired`. Page size is 1–500. `action` is `suspend`, `resume`, `expire`, `clear-expiry`, or `rotate-token`; a reason is required and limited to 500 characters. The fixed startup actor is at most 120 characters. `expiresAt` belongs only to `expire` and uses the original RFC3339 timestamp-with-timezone contract. `claimEnv` belongs only to `rotate-token` for access changes; enrollment requires it separately.

Handoff, receipt, and support results include `{name,bytes,sha256,download}` alongside the original operation summary. Clients fetch `download` with the same Bearer capability and create a local download from the returned bytes; uncredentialed browser navigation is not an export mechanism.

The backend intentionally delegates schema migrations, transaction boundaries, revision conflict handling, source fingerprints, and entitlement rules to the original modules. Its original-source end-to-end acceptance should exercise the composed desk and merchant store once; no separate test suite or hosted Actions workflow is introduced.
