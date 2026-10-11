# SFTP dataset workspace

This private browser workspace turns a complete report on an SFTP server into a reviewed, versioned dataset product. Operators save the server connection, inspect its actual files, choose typed output fields, set merchant payment terms, and open each product's original publication console. The source capture, publication, recurring refresh, seller, and buyer use the maintained SF30 engines.

## Start and reopen

Run the publication workspace on Linux or WSL with Node 22 or later and the maintained SFTP runtime installed. The source transport uses `ssh2`; native paid delivery also uses the existing x402 runtime. See the [SFTP source guide](../README.md) for the native runtime and standalone commands.

Set the SSH credential in the launch environment. A key-file reference must contain an absolute path to a private regular file. The source configuration and browser hold the environment variable's name.

```sh
export SFTP_PRIVATE_KEY_FILE=/absolute/private/merchant_reader_key
node stellar/scf-starforge-20261009/sf30-seller-sdk/sftp/workspace/server.mjs \
  --state /absolute/private/sftp-workspace
```

The terminal prints `sftpWorkspace` with its full loopback URL. Open that URL, including its fragment. The workspace binds to `127.0.0.1` and checks its exact host, origin, and random bearer capability. The files under the selected state directory are private.

To import a prepared declaration and merchant terms when creating a workspace:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/sftp/workspace/server.mjs \
  --state /absolute/private/new-sftp-workspace \
  --source /absolute/private/source.json \
  --merchant /absolute/private/merchant.json
```

Use mode `0600` for those input files. To reopen an existing workspace, pass only its state directory and the same credential environment. It reads its retained revisions and product files. Seller intent and the original saved refresh policies reopen with the workspace.

Add `--dataset-facilitator https://YOUR_FACILITATOR` to use the original native x402 dataset seller. A local development facilitator at `http://127.0.0.1:PORT` also requires `--allow-local-dataset-facilitator`. Payment choices must match the selected facilitator and the merchant's actual network, asset, and recipient.

## 1. Save the source connection

On **Connection**, enter the server, port, username, remote root, trusted SSH host-key fingerprints, and credential reference. Obtain the host fingerprint from the server operator. The client compares the negotiated raw SSH host key against the saved SHA256 pins before authentication. A planned host-key rotation can retain more than one approved fingerprint.

Authentication supports a key-file environment reference, a key-value environment reference, or a password environment reference. An encrypted key can use a separate passphrase reference. The saved revision displays whether each named variable is configured in the launch environment.

The native source exposes read operations within the canonical remote root. Configure a read-only account on the server; OpenSSH's `internal-sftp -R` can also enforce read-only SFTP operation. The source checks remote paths against that root and retains the observed host identity and file attributes with every capture.

**Save revision** writes an immutable source/merchant pair with their exact hashes. A save compares the draft's base revision with the current saved revision. If another tab has saved a newer revision, the draft stays in the browser so the operator can reconcile the change. Earlier revisions remain available as drafts and as downloadable JSON.

## 2. Inspect files and define reports

On **Files and reports**, browse the saved source. The catalogue records a complete sorted directory observation and pages through it. A selected directory opens below the same root. Selecting a file fills the inspection controls.

Choose CSV, JSON, or NDJSON. For JSON, enter the JSON Pointer to its array of records, such as `/data/records`; a top-level array uses an empty pointer. **Capture and inspect file** reads and retains the complete file, computes its SHA256, and inspects every record. The table displays up to 20 records. The field suggestions describe those displayed records, and the capture summary identifies the complete original bytes.

Use **Use captured fields in report** to create a report draft. Review every output name, source pointer, scalar type, nullability, and missing-field behavior. Text fields preserve identifiers and exact numeric tokens. Integer fields require safe integers; Number fields intentionally use finite JavaScript numbers. CSV's empty value can map to null only when the selected field allows it. JSON and NDJSON numeric tokens remain exact strings in the inspection table.

Nested fields use JSON Pointer syntax. A slash inside a source key becomes `~1`, and a tilde becomes `~0`. Every output name starts with a letter and contains up to 48 letters, digits, or underscores.

Parameters and row filters are optional. For example, a report with an integer `units` output can declare:

```json
{
  "minimum_units": {
    "type": "integer",
    "required": true,
    "default": 0
  }
}
```

Its row filter can then be:

```json
[
  { "column": "units", "op": "gte", "parameter": "minimum_units" }
]
```

The declared parameter and field types must match. Operators set actual parameter values when saving the product's extraction plan. Supported comparisons are `eq`, `ne`, `lt`, `lte`, `gt`, and `gte`; Boolean fields use equality or inequality.

A report can require a specific file SHA256. Leave that field empty when the source is expected to publish refreshed files. The native capture records the received file's original bytes, observes attributes before and after reading, and compares every retained prefix byte before resuming an interrupted transfer. A completed capture is immutable. A changed source starts a distinct capture instead of appending it to a different edition.

**Keep report in draft** updates the draft. **Save revision** validates and retains the complete connection, report definitions, and merchant terms. It also includes the report currently being edited.

## 3. Save merchant payment terms

On **Merchant**, enable paid dataset publication and enter the public HTTPS origin, service name, description, and tags. Add every supported payment alternative. Amounts are decimal text in atomic units, including values larger than JavaScript's safe-integer range. The saved revision preserves each network, asset, amount, recipient, timeout, and complete `extra` object.

These settings describe the public merchant resource. The local seller address is assigned when a product's versioned dataset seller starts. The buyer handoff uses the original seller's advertised offer and binds it to the selected retained snapshot.

## 4. Publish a dataset product

On **Dataset products**, select a saved report and enter its public resource path, such as `/datasets/preservation`. **Create dataset product** binds that resource to the current saved source and merchant revision. Its private source file contains only the selected report. Changes to a later source revision do not switch the report or payment terms of an existing product.

Choose **Open publication console**. This opens the original maintained publisher for that specific product. Its complete workflow is:

1. Save a named extraction plan with its input values, typed dataset fields, deterministic ordering, and extraction limits.
2. Start the native extraction. The SFTP adapter reads the complete source capture and writes the candidate through the original dataset writer.
3. Inspect the candidate rows and original extraction manifest.
4. Record the operator's review against the current target version, then publish that reviewed candidate.
5. Return to the parent workspace and choose **Start dataset seller**.

The parent workspace lists the retained runs and downloads their original `data.csv`, `dataset.json`, and `candidate.json`. The file endpoint verifies the retained candidate and streams its CSV. The original publication console owns extraction cancellation, interrupted-run recovery, compare-and-swap publication, and version activation.

## 5. Operate recurring refreshes

After the initial reviewed publication and seller startup, configure the original refresh policy in the publication console. It binds the reference run, complete extraction plan, expected snapshot, target revision, interval, row limits, permitted drop, and error behavior. Enabling the policy records the displayed target revision.

Every occurrence uses the original source extraction and publication workflow. The full immutable source capture is retained with its result. Existing paid snapshot URLs continue to select their retained version when a new edition becomes current. The original schedule handles unchanged data, policy violations, interrupted operations, and missed slots.

The parent workspace displays whether the policy is enabled or paused. **Stop seller and pause refresh** first pauses that original policy against its current revision, then closes the seller. Reopening the workspace restores saved seller intent and the same publication/schedule state.

## 6. Prepare a retained-snapshot buyer

Open a retained run in the parent workspace and enter its first-page query, such as `limit=10`. **Load buyer payment choices** reads the running seller's actual health and offer metadata. It shows the exact snapshot, resource URL, payment alternatives, and extra terms.

Choose an advertised payment alternative, enter a unique buyer intent ID, and select **Prepare retained-snapshot buyer**. The operation checks that the displayed offer hash is still current and calls the original SF88 preparation function. It downloads the resulting buyer configuration and retains a hash-bound copy in the product's buyer list.

Run that configuration with the maintained SF88/SF31 buyer workflow and the intended buyer signer. The configuration fixes the selected snapshot and exact merchant payment terms. Prepared configurations remain downloadable after reopening the source workspace.

## State and operation

The state directory contains `workspace.json`, immutable `revisions/`, original `samples/` and `captures/`, and a separate `publications/` directory for each product. Each publication retains its selected source declaration, original publisher database, source plans and candidate files, versioned dataset, seller terms and intent, recurring schedule, and prepared buyers. Keep this complete directory together with the source's credential environment when moving a workspace.

The parent workspace holds the original kernel-backed private-directory lock. Each publication and capture uses the maintained source/publisher locks. The browser only refreshes product status when its products tab is visible, and it preserves unsaved connection, report, and payment drafts in that tab's session storage. Server errors and revision conflicts retain the draft.

The interface uses neutral gray controls and horizontally scrollable data tables for desktop and phone operation. The original publisher console remains the owner of publication and schedule controls, so CLI, MCP, and browser operations share the same retained plan, run, review, and version history.
