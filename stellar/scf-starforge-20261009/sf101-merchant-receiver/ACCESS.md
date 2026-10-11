# Merchant order access and support

The original SF101 receiver now gives a merchant a practical way to inspect its enrolled orders, suspend a file, change an access deadline, replace a compromised claim token, and export the same records for support. Run `access.py` beside the existing `receiver.py`, using the same private `--state` directory. Python 3.11+ standard library is sufficient.

The existing `orders` and `events` retain the original enrollment, exact product digest, payment identity and entitlement. Access controls are additive tables in that same `merchant.sqlite3`; claim-token rotation updates the original `orders.token_sha256`. Native order enrollment and the paid-file purchase path continue through their original commands and owners.

## Install with the original receiver

Install the current `receiver.py` and `access.py` together. Restart the original receiver process using its existing service configuration, keeping the same private state, webhook secret and reverse proxy. Existing stores require no initialization or data conversion: orders remain enabled with no access deadline until the merchant configures them. The first access mutation creates only the two additive access tables.

After the restart, the original `GET /health` response includes:

```json
{"service":"sf101-merchant-receiver","status":"READY","accessControls":"stellar-forge.sf101.access-policy.v1"}
```

Use the original receiver's health URL to confirm the running process has the updated file-release check. A process that was started from older source keeps that older behavior until restarted. The access CLI does not start, stop, reconfigure or contact a service.

Commands below run from `stellar/scf-starforge-20261009/sf101-merchant-receiver`. Replace the example state, order reference, operator identity and operation IDs with your own values. This guide contains no claim tokens or enrolled example orders.

## Find and inspect an order

```sh
python3 access.py list --state /private/merchant --limit 100
python3 access.py list --state /private/merchant --status pending --limit 100
python3 access.py show --state /private/merchant --ref order-1042
```

`list` returns original route, method, network, atomic amount, asset digest, file digest/size, native order state and current access policy. It includes the original optional recipient digest when that column exists. It excludes the source filesystem path, stored token hash and token itself.

Use the returned `nextAfter` as `--after` to read the next page, keeping the same filter. Up to 500 orders can be requested per page. Order-reference keyset pagination avoids rereading an ever-growing first page. Each call takes a consistent database read snapshot; subsequent calls reflect subsequent merchant changes. Filters are `all`, `pending`, `available`, `suspended` and `expired`.

`show` includes the latest 50 access actions and the current `order.access.revision`. That revision is the input for the next mutation. An order with no configured policy has revision zero. Native order state and access state are separate fields: an enabled `PENDING` order still awaits the original SF98 entitlement event.

| Access state | File-release behavior |
| --- | --- |
| `AWAITING_ENTITLEMENT` | Original enrollment exists and the original native entitlement has not completed. |
| `AVAILABLE` | The order is entitled, enabled and within its configured deadline; the original claim token and exact file bytes are still required. |
| `SUSPENDED` | The merchant has disabled subsequent file authorizations. |
| `EXPIRED` | The configured UTC deadline has elapsed. |

## Suspend and resume file access

```sh
python3 access.py suspend --state /private/merchant --ref order-1042 \
  --expected-revision 0 --operation-id order-1042-suspend-001 \
  --actor merchant-operator --reason 'Customer requested temporary suspension'
```

The result contains the updated revision. To resume, use that exact revision:

```sh
python3 access.py resume --state /private/merchant --ref order-1042 \
  --expected-revision 1 --operation-id order-1042-resume-001 \
  --actor merchant-operator --reason 'Customer access restored'
```

These commands control access for both pending and entitled orders. A later successful SF98 event still updates the original entitlement; it does not clear a suspension. Resuming does not remove an existing deadline, and an expired deadline continues to deny access until changed or cleared.

The native receiver returns the existing generic 404 when access is suspended or expired. Original HMAC verification, entitlement binding, token comparison and file-digest checks remain in their original paths. Suspension does not rewrite settlement, release a refund or erase original events. The merchant handles any associated commercial adjustment through its existing payment process.

Access changes apply to subsequent authorization checks. A download already authorized and in progress may complete; already delivered bytes remain with their recipient.

## Set or remove an access deadline

Supply a full RFC3339 timestamp with seconds and timezone. Choose a future time matching the merchant's actual agreed access period; the example date below must be replaced.

```sh
python3 access.py expire --state /private/merchant --ref order-1042 \
  --expires-at 2026-12-31T23:59:59Z \
  --expected-revision 2 --operation-id order-1042-deadline-001 \
  --actor merchant-operator --reason 'Agreed access period ends at this deadline'
```

Expiry is evaluated at the original file authorization, so it needs no scheduler or background job. `expire` also replaces an earlier deadline. For an immediate stop, use `suspend`.

```sh
python3 access.py clear-expiry --state /private/merchant --ref order-1042 \
  --expected-revision 3 --operation-id order-1042-clear-deadline-001 \
  --actor merchant-operator --reason 'Access period extended without a fixed deadline'
```

Clearing a deadline leaves any suspension in place. The merchant chooses the policy explicitly; no deadline is inferred from price, enrollment time or payment.

## Replace a claim token

Provision a new high-entropy token using the merchant's existing secret mechanism and place it in a private environment variable in the operator process. The native contract is 32–1024 UTF-8 bytes. The command accepts the variable's name, never a raw token argument:

```sh
python3 access.py rotate-token --state /private/merchant --ref order-1042 \
  --token-env SF101_REPLACEMENT_CLAIM_TOKEN \
  --expected-revision 4 --operation-id order-1042-token-001 \
  --actor merchant-operator --reason 'Replace previously issued claim credential'
```

The update changes the original token hash inside the same transaction as the access revision and action record. The old token stops authorizing subsequent requests. Suspension, deadline, original payment identity and authorized file stay unchanged. No token appears in stdout, the action history or the support export. Distribute the replacement through the merchant's existing private customer channel; this CLI performs no message send.

The original receiver still serves the same `/deliver/<orderRef>` endpoint. The original buyer retrieve command should receive the replacement token through its existing private token input. It does not need another purchase or enrollment.

## Handle an interrupted or competing operator action

Every mutation requires an operation ID and expected access revision. The transaction records the original request fingerprint and its result. Repeating the exact same operation after a lost terminal response returns that result with `replayed:true`, including when the first action already advanced the revision. A different request cannot reuse the same operation ID.

On `ACCESS_REVISION_CONFLICT`, read `show`, review the current policy and submit the intended action with its new revision and a new operation ID. The rejected action makes no token, policy or history change. A repeated token rotation uses the same replacement token in the named environment variable; it never silently generates another token.

`suspend`, `resume`, `expire` and `clear-expiry` reject a fresh operation that would make no change. Exact retries with the same operation ID still recover their original result.

## Diagnose a file and export a support record

```sh
python3 access.py verify-file --state /private/merchant --ref order-1042
python3 access.py export --state /private/merchant --out /private/support/merchant-access.json
```

`verify-file` invokes the original private-file reader and compares its bytes/hash with the original enrollment. Its result is `MATCH`, `SOURCE_CHANGED` or `SOURCE_UNAVAILABLE`. It returns metadata only. Restore the merchant's original enrolled bytes at their original managed location when correcting a source-file problem; changing the authorized digest is a different product decision and is not performed by this command.

The support export streams all orders and access-action history from one SQLite read snapshot into a new 0600 JSON file. It refuses an existing output, caps output at 256 MiB, and returns the completed file's byte count and SHA-256. It contains native order/entitlement metadata and access history, with no claim-token hash or source path. Treat the export as private merchant order data. The original `receiver.py receipt` command remains the source of a merchant-entitlement receipt; the original SF98 outbox remains the source for notification delivery/retry history.

## Integration and source review

The native receiver exports `access_allowed(db, ref, now=None) -> bool`, and `get_entitled_file` calls it on the original SQLite connection before release. This read-only helper also lets the original checkout admission reject an explicitly suspended or expired pending order before requesting payment. Call it after resolving the existing order and alongside the original route/method/payment/file checks. Start one explicit SQLite read transaction **before** reading the order and keep the policy lookup in that same transaction, then close it. The native download path does this so token/entitlement and policy cannot come from different concurrent revisions. It evaluates access policy only: a true result never establishes an order, payment or entitlement. The caller owns the connection and its transaction; the helper opens no connection and writes no data.

The receiver also exposes the health capability field. These changes have no new Python import dependency. `access.py` imports the same original receiver for state/secret/private-file handling. Current recipient-binding and six-method changes can be composed without replacing their enrollment, signature or notification code. The optional recipient digest in order inventory is read from the original column when available.

The two new tables are `sf101_access_policy` and `sf101_access_actions`. Keep them with `merchant.sqlite3` in the existing SQLite-consistent merchant backup and restoration workflow. Access controls, action history and rotated native token hashes restore together; a restored older database also restores its older access state, so use the existing guarded merchant recovery process when replacing a live store.

This change received source review. It does not add or run a test suite, build, hosted Action or payment simulation. Existing accepted sender/receiver execution results describe their original paths; no new runtime acceptance is claimed for these access controls.
