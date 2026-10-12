# Receive the SCC bilingual consultation workflow

This controller exercises one complete public-source review exchange through the running workbench and its standalone reviewer page. It resumes the same project from its `progress.json` after a completed invocation. The application remains the original `operator/` package; the controller adds no replacement server, payment service or reviewer account.

## Inputs and runtime

Use the exact selected `operator/` source from this feature/release and the adjacent `consultation-receiving.mjs`. Python 3.10 or newer runs the original application. Its declared `python-docx==1.2.0` and `reportlab==4.4.9` dependencies generate the successor edition. Supply an existing Node runtime, Playwright module and compatible Chromium executable. Paths in the configuration are absolute paths on the receiving machine.

The program uses the bundled original Statistics Canada files and authored bilingual clauses. It creates its own practice comments and marks every response as an authored example. It requires no applicant records, actual reviewer correspondence, private restored project or external credentials. The selected workspace must be owned by this receiving operation and must not be an existing customer's project.

Copy `consultation-config.example.json` to a local configuration file and replace its paths. Keep the application source separate from the runtime's workspace and output directories. Use a free localhost port. Server and browser are launched by the same controller so they share the receiving environment.

~~~sh
node ./consultation-receiving.mjs --config /absolute/path/review-config.json
~~~

If the receiving environment uses a maintained capacity scheduler, submit that entire command once through its normal owned-job route. The browser, Node process, Python server and document generation are one operation. Do not run a second controller while the first still owns the workspace.

## What the operator actually does

The controller opens the workbench, prepares its public-source bilingual review example, and freezes a second reviewer packet through the actual operator editor. It saves that request, lets the original server commit it, presents an authored proxy 502 response to the browser, then uses **Retry original pending save**. The recovered response must retain the same request and packet identity.

It downloads and opens the actual reviewer ZIP, reads the paired clauses and source-linked cases, and enters two authored comments. One concerns the distinction between a Census reference date and a municipal-change effective date. The other concerns literal missing values and real zero. It exports a local draft and the actual response JSON.

The original operator then retains those exact response bytes. It records one disposition and applies the other comment as an explicit paired-language amendment. A concurrent source-note edit causes an actual project revision conflict. The form retains the proposed words, exposes the current clause, and rebases the change explicitly. The concurrent note and chosen English/French text must both remain.

The workbench freezes the successor edition and records the amendment's disposition. The reviewer opens the original returned file, corrects only the first entry, and exports a second response under the same declared response identity. Receiving that correction retains its exact predecessor. **Adopt unchanged decisions** transfers only the unchanged entry's earlier decision; the changed entry remains open for its own recorded resolution.

A duplicate re-export retains its original bytes without creating another set of comments. The handover then includes a selected respondent reply and a successor publication containing only the explicitly selected public entry. Finally, a complete local archive restores into a fresh workspace and the same project reopens in the browser.

## Outputs and continuation

The output directory retains:

- `progress.json`: completed stages, source identities and the current stage.
- `result.json`: completed journey, original project ID, actual output sizes and SHA-256 values.
- The original packet, local authored draft and two returned files.
- The selected respondent reply and successor edition.
- Desktop and mobile screenshots.
- The private complete-project archive and its fresh restored workspace.
- `failure.json` only when an invocation fails, with the exact stage and message.

The source digest covers the complete selected package before and after the run. It records the producer source without claiming an external signature. The controller does not email or upload any output.

A private archive is an operator continuation artifact. Keep it with the existing authorized project owner. The public-source recipient packet, explicitly authored example returns and selected document outputs have separate, readable contents; inspect the intended selected output before any delivery.

To resume after a completed failed invocation, use the same configuration, workspace and output path. The recorded stage logic reuses the actual packet, original response and retained decisions where they already exist. Do not delete `progress.json` to obtain a fresh apparent result.

If a concrete software correction changes the package between invocations, retain the old files/result, set `continuation_from_source_identity` to the exact prior value from `progress.json`, and provide `source_change_note` describing the correction. The next invocation appends that source transition and continues the same case. This is a local operation-owner record, not a request for a new reviewer decision.

## Product use after the demonstration

An operator can perform the same exchange manually:

~~~sh
standards-workbench --workspace ./review-workspace --review-demo
~~~

Open **Consultation receiving**, download the ready packet, and follow the receiving guide bundled with the application. Subsequent use can start from an operator's own scoped standard and actual selected procedure. The demonstration does not populate committee membership, ballot results, approval, funding or actual customer response.
