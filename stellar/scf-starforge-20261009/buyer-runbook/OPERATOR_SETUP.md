# Set up and retain the local buyer host

The buyer runbook’s **Local buyer setup** prepares this receiving machine for
customer SDK requests and paid-file orders. It saves the original SF88 operator
preset inside the existing private workspace, retains earlier versions, and
shows which request reviews would be affected by a change. Native preparation,
spending ledgers, acquisition execution and accounting keep their original
owners.

## Start a new receiving workspace

Start from the operator terminal using an existing canonical private parent:

```sh
node stellar/scf-starforge-20261009/buyer-runbook/cli.mjs workspace \
  --state /private/acquisitions/workspace \
  --port 8460
```

The installed command is `starforge buyer-runbook workspace` with the same flags.
A new workspace creates its private `configs` directory automatically when
`--configs` is omitted. To use an existing configuration directory, pass its
absolute path. The selected workspace and configuration paths remain fixed on
reopen. Directories use `0700` and state files use `0600`.

Open the printed loopback URL and choose **Local buyer setup**. Requests and
customer SDKs can be received before setup; preparing a new buyer requires a
valid selected preset. Reopen later with the same `--state`.

The same host/session controls protect setup and the existing workspace. Only
the local operator supplies these fields. Imported SDKs, merchant requests and
file-order handoffs cannot select host identity, signer references or paths.

## Enter the original host fields

| Field | Original meaning |
| --- | --- |
| Actor and service | Stable local operator identifiers, using letters, digits, period, underscore, colon or hyphen; up to 160 characters each. |
| Stellar payer | This host’s public `G…` account. Keep the wallet secret in its existing environment or trusted signer provider. |
| Python executable | The absolute Python path used by the original spending ledger, commonly `/usr/bin/python3`. |
| Maximum total and daily atomic budgets | Positive decimal integer strings, up to `9223372036854775807`. Daily must fit inside total. Each prepared request or order gets its own policy bounded by these ceilings. |
| Wallet environment name | The existing variable name containing the wallet key at execution. The native default is `STELLAR_SECRET`. Only the name enters the preset. |
| Trusted signer provider | Alternatively, the canonical absolute path to this host’s existing SEP-43 provider. Use one signing source. |
| RPC override | Optional original SF88 RPC setting. The native buyer validates it against the selected payment network when reviewing/preparing that request. |
| HTTPS proxy environment | Optional name of the existing proxy variable. The native buyer binds that transport to the actual request origin during preparation. |
| Reason for this version | Optional host note, retained with the saved version. It does not change native payment or policy terms. |

These limits apply **per prepared request or order**. They are not a shared
account-wide budget across separate operators. The exact asset and network come
from each explicitly selected merchant payment option; amounts are never
converted to floating point.

The page reports whether the Python executable, signing reference and proxy
environment are present in this process. It never returns an environment value.
That observation does not establish wallet funding, validate a remote RPC, or
replace the native signer’s checks. Saving setup creates no payment.

## Review, save and use the host

Choose **Review host settings**. The page reads the current selected version,
compares it with the form, and shows:

- every changed host field;
- the exact proposed settings SHA-256 and review SHA-256;
- prepared buyers and retained buyer preparations that keep their settings;
- pending request reviews that would need to be saved again.

Choose **Save host settings** for that review. The saved version contains an
ordinary `stellar-forge.buyer-runbook-operator.v1` preset, together with a private
immutable revision record. The active selection changes atomically under the
same metadata lease used by original request preparation. A different window’s
save requires a new review against its actual current selection.

The form keeps unsaved edits while the workspace refreshes. **Discard edits and
reload** explicitly replaces the draft with the current saved settings.
Historical **Use as draft** loads a retained version for comparison; it does not
change the selected host until it has been reviewed and saved.

Continue with [customer SDK receiving](CLIENT_SDK.md), a
[private merchant request](WORKSPACE.md#receive-a-private-merchant-request), or
[paid-file receiving](PAID_FILES.md). Their existing **Local buyer setup** buttons
return to this same host panel. Each request still has its own explicit payment
option and budget review before the original native buyer is prepared.

## Adopt an existing launcher preset

Existing deployments can keep using:

```sh
node stellar/scf-starforge-20261009/buyer-runbook/cli.mjs workspace \
  --state /private/acquisitions/workspace \
  --operator-settings /private/acquisitions/local-operator.json
```

The original declared path is retained. Until a workspace version is saved,
the intake reads that original file using the original private-file and preset
validator. An older workspace without a declaration can attach its first file
with the same flag.

Local buyer setup shows **Launcher-declared preset**. Review and save the
unchanged fields to adopt the settings into this workspace. The exact original
file bytes are copied into the retained version; the external file is left
intact. A preset that omitted the native default `secretEnv` retains its original
bytes when the form shows `STELLAR_SECRET`. This preserves the SHA-256 already
used by pending native request reviews.

After adoption, the saved workspace selection is authoritative for new reviews.
Editing the old external file does not change it. The declaration remains in
the original workspace metadata, and a conflicting launcher path is still
rejected. To change the active host, review and save through Local buyer setup
or its CLI below.

New field drafts are saved in the original preset format with stable JSON
formatting. **Download settings** returns the exact retained bytes of the
selected historical version. A downloaded preset contains local identifiers,
public payer and reference names/paths; keep it with the private operator files.

## Settings changes and original buyers

| Existing state | Behavior after saving different host settings |
| --- | --- |
| Received but unreviewed request/order | Its next review reads the newly selected host preset. |
| Reviewed request/order whose preparation has not started | The page flags a different settings SHA. Save a current request/order review before preparing. |
| Interrupted native SDK/request preparation | Its attempt retains the complete original preset bytes before native setup. **Resume local buyer setup** continues that same generation, keys and ledger after the active host changes. Older attempts without that copy can adopt the actual matching bytes from the current preset or retained host versions. |
| File-order preparation already started | The original receiver has retained the reviewed settings. **Resume local buyer setup** continues that same original operator even if the active host preset changed. |
| Prepared buyer or initialized acquisition | It keeps its original configuration, payer, signing references, policy, keys, ledger and selected payment terms. Host edits do not rotate these files. |

To restore an earlier preset, choose **Use as draft** beside that version and
review/save it. The new selection retains the exact original settings bytes,
rather than reserializing them. A pending review of those identical bytes can
therefore match again. If you edit a field, the form treats it as a new draft.

A legacy interrupted request whose original preset bytes are not present reports
that its original settings are needed. Restore the matching original declared
preset or saved host version, then resume the retained attempt. New attempts
retain their own exact preset copy before the native initializer starts. Each
copy is bound to its review and generation, so an interrupted copy for another
review stays intact without obstructing new setup. Earlier per-generation copies
are adopted only after their exact bytes match the saved review.

If a save response is lost, retry the same review with the same fields, reason
and source version. When that revision is already active, the save returns the
original revision. An interrupted write before selection can finish selecting
the same retained revision. If a later host change has occurred, the original
state pin requires a fresh review instead of silently selecting the old draft.

An invalid selected preset is reported in the host panel while retained requests
and intact saved versions stay available. Review an intact version or corrected
host fields to create a new selection. Original native reads continue to reject
damaged selected settings until that explicit repair is saved.

## CLI operating flow

The existing command exposes the same setup engine. `operator status` reports
current settings, versions and request effects:

```sh
node stellar/scf-starforge-20261009/buyer-runbook/cli.mjs operator status \
  --state /private/acquisitions/workspace
```

Prepare a private `0600` draft in the original preset format and review it:

```sh
node stellar/scf-starforge-20261009/buyer-runbook/cli.mjs operator review \
  --state /private/acquisitions/workspace \
  --file /private/acquisitions/proposed-operator.json \
  --note "Receiving host for this customer"
```

Use the returned `expectedStateSha256` and `reviewSha256` with the same inputs:

```sh
node stellar/scf-starforge-20261009/buyer-runbook/cli.mjs operator save \
  --state /private/acquisitions/workspace \
  --file /private/acquisitions/proposed-operator.json \
  --note "Receiving host for this customer" \
  --expect STATE_SHA256 \
  --review REVIEW_SHA256
```

Omit `--file` to review/adopt the current declared preset. Supply
`--from-revision preset-…` to both review and save when restoring an exact
retained version. `--file` and `--from-revision` are alternatives. Review also
accepts `--expect` to require an already observed host state.

Inspect or export a retained revision through the same original file reader:

```sh
node stellar/scf-starforge-20261009/buyer-runbook/cli.mjs operator revision \
  --state /private/acquisitions/workspace --id preset-REVISION_SHA256

umask 077
node stellar/scf-starforge-20261009/buyer-runbook/cli.mjs operator export \
  --state /private/acquisitions/workspace --id preset-REVISION_SHA256 \
  > /private/acquisitions/retained-operator.json
```

The export writes the original preset bytes to stdout. These commands do not
execute an acquisition. Original signing, SF81 terminal approval, payment,
accounting and file entitlement remain in their existing execution workflows.

## Retention and recovery

The versions live under the existing workspace’s
`handoffs/operator-presets/revisions`, with one `current.json` selection.
The revision records preserve the reviewed previous selection and settings
bytes when available. Keep the original workspace/configuration paths; existing
native operators still refer to their retained canonical files.

The existing runbook encrypted backup/recovery collector includes this directory
with the original intake, ledgers, requests and acquisitions. Use its normal
operator selection and quiescence workflow once a native operator exists.
Wallet secrets and proxy environment values remain supplied by the receiving
host after restart or restore. See [WORKSPACE.md](WORKSPACE.md) for acquisition,
accounting and complete original-workspace recovery.
