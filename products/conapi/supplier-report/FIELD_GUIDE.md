# Supplier feed review: operator guide

## What you receive

Supplier feed review compares two retained source editions, presents their record-level differences and lets a reviewer produce an accepted item table. The saved workspace carries the source files, field configuration, comparison and decisions together so another operator can continue the same work.

Use it for a supplier's updated price list, a received feed against a retained customer master, or another pair of editions whose business identifiers and fields have been explicitly mapped. Choose the source's real identity before reviewing the differences.

## 1. Open the review and select the source editions

From the complete received directory, run `node supplier-report-cli.mjs serve --port 8765` and open the printed local browser address. The supplied localhost server loads the original review modules together. Choose New comparison to load the retained baseline and the candidate source. A baseline is the edition you are comparing from; the candidate is the edition you are evaluating. Use labels a colleague can recognize, such as the supplier name and original issue date.

Keep the original filenames and source addresses in the edition notes. Enter the source's known capture time when supplied; a blank capture time uses the current import time. Keep the publisher's issue or effective date and the retrieval time in the source notes, and preserve date fields inside the original source rows unchanged.

For a prior saved case, choose Open review and select the complete saved review JSON. This restores the original source and review. Use the saved case rather than recreating a comparison from only its changes CSV.

## 2. Configure the field mapping

Open the Mapping and comparison rules drawer, edit Rules JSON, and choose Recompare retained editions. The comparison uses both retained original editions and records its predecessor. Map each selected source column to the intended canonical field. Explicitly select the key, decimal fields and the context used to decide whether prices are comparable. Preserve identifiers as text, including leading zeros and letter case where meaningful.

A good key identifies one business row. For a single-tier supplier price list it may be supplier and item code. For tiered pricing it may also need the quantity break, location, validity interval or customer class. A product description is unsuitable when several products share the wording.

Map every descriptive or operational column that must appear in the accepted export. The workspace retains the originals; the accepted table follows the canonical columns configured for this comparison. Include source URLs, effective dates, units, price qualifications or tax-basis fields when the recipient needs them to use the result.

For the included Elite Digital price source, the price key is name. The source's path identifies the service and is shared by multiple tiers. Use amount_gbp as a decimal amount; charity_amount_gbp permits a blank where the publisher gives no separate rate. Retain period and display so monthly, one-off, free and starting-price meanings stay visible. SOURCE_NOTES.md explains the complete original files.

## 3. Review the differences

Read the summary, then inspect the records that need a decision. Use record search, the Record kind and Decision filters, and the row's Open control to inspect the full record. Each row should be understood in the context of both original editions and the selected key.

An addition is present in the candidate and absent from the baseline. A missing candidate record needs review: the supplier may have discontinued it, sent a partial file or changed its identifier. A changed record can involve a price, a description or the commercial basis. An unchanged record preserves its original identity and values.

If the same key appears more than once, inspect the original rows. First establish whether the key omits a legitimate tier or location. Correct the mapping and recompute when those rows represent distinct business items. Use Choose one original source row to select the source side and exact original row only when that is the intended resolution.

A price difference is meaningful only when currency and price basis agree. A pack price and an each price, a monthly fee and a one-off charge, or a fixed price and a starting price require an explicit interpretation. Read both source values and the context; the application keeps those records reviewable when it cannot supply a comparable arithmetic difference.

## 4. Record the disposition

Use the record actions according to the intended accepted table.

| Action | Intended disposition |
| --- | --- |
| Use candidate record | Accept the candidate record for this business key. |
| Keep baseline record | Retain the baseline record for this key. |
| Exclude this key | Omit the key from the accepted table while retaining its source and review history. |
| Enter complete corrected record | Enter an explicit authored record using every configured canonical field. |
| Choose one original source row | Select the source side and exact original record when resolving an ambiguous source choice. |

Supply Reviewer and Decision reason for every saved decision. “Supplier confirmed the twelve-unit pack” or “Retain current item until replacement code is mapped” tells the next operator what supports the choice. Use the actual supporting source or correspondence reference when it is available.

Enter complete corrected record supplies an operator-authored result with every canonical field. Use the field's null checkbox for null; an unchecked empty value is an empty string. Preserve identifiers and decimal values as exact text. Preserve the original source records and describe the change. Changing a review outcome does not edit a publisher's source file.

Use Save review while working to download the complete retained JSON. The review is portable in that saved JSON. Keep its selected configuration and original files with it when transferring the case to another operator.

## 5. Resolve the remaining records and complete the review

Review all remaining ambiguous or incomplete rows and ensure the accepted result represents the chosen source and business rules. Check the actual item identities, units, price qualifiers and effective dates that the recipient will use.

Use Complete review after resolving pending decisions and accepted-key conflicts. It confirms the accepted record count and enables the reviewed output workflow. The resulting accepted table is the reviewed edition for the downstream workflow. Record the operating owner and the intended recipient in the handover accompanying it.

If the source or mapping changes, use a newly retained edition or successor review. Preserve the original completed case so a colleague can explain which source and decisions produced an earlier output.

## 6. Deliver the useful output

Choose the output for the recipient's next operation.

| Output | Use |
| --- | --- |
| Accepted CSV | The complete canonical table resulting from the recorded decisions. |
| Changes CSV | The comparison findings for review or a downstream change process. |
| Review HTML | A readable view of the comparison and decisions. |
| SQLite snapshot | A new SQLite table with TEXT columns and a lineage transaction from the reviewed accepted records. |
| Complete review JSON | Reopen the original source, configuration, comparison and review in this application. |

Choose a new SQLite table name before exporting the SQLite snapshot. The file creates a new table with TEXT columns and a lineage transaction from the reviewed accepted records; it does not update an existing table. Keep this exact SQL together with its accepted CSV and complete review JSON. The receiving database owner applies it through the customer's normal installation process.

The accepted CSV includes the configured canonical columns. Include required original source fields in that configuration before finalizing. The full source remains in the complete workspace even when a downstream table needs only selected columns.

## 7. Receive and continue the handover

On the receiving installation, start the supplied localhost server from the complete delivered directory with `node supplier-report-cli.mjs serve --port 8765`. Open its printed browser address, choose Open review and select workspace.json or the complete saved review JSON. The file must contain valid UTF-8. Confirm the source labels, rules, decisions and accepted table before continuing the customer's next operation.

Continue the customer's actual next task: inspect an original record, review a changed source edition or make an explicit correction. Save the resulting workspace as a successor and keep the prior delivered edition. This lets the recipient continue the work with the full source context.

The included public-source bundle provides real publisher records for configured intake and source-coverage review. Its pricing CSV and service catalog are different tables with a many-to-one relationship; follow SOURCE_NOTES.md when composing them. Use the actual customer's selected feed and retained master for a customer price-change decision.

## Application interface

The delivered JavaScript interface provides createEdition, reconcile, decide, decideMany and finalize for the review lifecycle. exportCSV selects changes or accepted records; exportHTML provides the readable report; exportSQL produces a new SQLite TEXT table and lineage transaction using the selected tableName. serializeWorkspace and reopenWorkspace carry the original source, configuration, comparison and review between installations.

The command-line interface groups the same work under compare, decide, export and inspect. Follow the exact command options in the delivered receiving guide. The browser, command line and customer workflow should use the same domain implementation and saved case.
