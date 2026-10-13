# Review the original Upstate work

The customer review desk gathers a selected source edition, completed native run or completed delivery into one portable folder. It shows the original source descriptions and files, records decisions and correction requests, and reopens the same review after the scientific workspace is restored.

## Open the prepared publisher-source review

The included source operation uses the publisher's **Protecting Our Drinking Water** map. It retains the complete returned item metadata and Web Map JSON from the issuer's own public map link. The review purpose is to understand the existing publisher context and confirm the retained source meanings for the internal project discussion.

Run the preparation command from the original application:

    python source/prior-work/20261012/open_review.py --workspace WORKSPACE --destination NEW_REVIEW_DIRECTORY --zip NEW_REVIEW.zip

Open **NEW_REVIEW_DIRECTORY/index.html**. The folder includes the complete source files, the original intake manifest and the response template. You can move the folder or extract its ZIP on another computer and open the same review desk.

The source-file inventory explains two different quantities. The publisher item metadata includes the hosted item's own size field. Each downloaded file also has its actual captured byte count. The original item-data response in this packet is 185,054 bytes; these two measures describe different objects. The original population fields name their historical years. The review desk preserves those names alongside the original county geometry and source metadata.

## Record a useful review

First read the purpose at the top of the desk. Every decision applies to that selected purpose and those original files.

Search for a file, filter by its type or current decision, and open the original download. Text previews show a prefix of the actual retained file; the complete file remains available beside it. The source details include the publisher URI, edition date, file size, units when declared, and original source identifiers. GIS companion files preserve their relative positions so their primary file remains usable.

For each selected artifact and requirement, choose the decision that describes your review:

| Decision | What to record |
| --- | --- |
| Unreviewed | Leave an item here while work is continuing. |
| Accepted | The item is suitable for the stated review purpose. Add any useful interpretation or conditions. |
| Changes requested | Describe the precise correction and assign the responsible person or team. |
| Question | State the question or the missing interpretation. |
| Not applicable | Explain why the item does not apply to this purpose. |

Use the correction list for work that spans multiple files or requirements. Link the affected items, describe the work, select its priority and assign it. When it is resolved, record what changed.

Enter your own name and role before exporting a response. A local draft remains editable in that browser. **Export response** creates a JSON file for return to the project workspace. The original input files stay available throughout the review.

Select **Ready for purpose** after each artifact and requirement is accepted or explained as not applicable, at least one actual artifact is accepted, and the listed corrections are resolved. **In review** retains work in progress. **Changes requested** records a concrete requested correction.

## Return a response and continue the same review

Import the exported response into the original or restored scientific workspace:

    python model/review_cli.py --workspace WORKSPACE response-import RESPONSE.json

The importer retains the entire response as a new immutable record. Sending the same response again returns its original record. A response based on an older revision is preserved in its input file and reports that the newer retained response needs reconciliation. Open an updated packet, compare the recorded history, and apply the appropriate decisions to a new response.

Export the current review and its complete history:

    python model/review_cli.py --workspace WORKSPACE export REVIEW_ID NEW_REVIEW_DIRECTORY --zip NEW_REVIEW.zip

Read its history directly:

    python model/review_cli.py --workspace WORKSPACE history REVIEW_ID

A previously exported packet can join the same original workspace:

    python model/review_cli.py --workspace WORKSPACE packet-import REVIEW.zip

The packet importer checks the selected workspace, original source records and complete ordered response history. It can extend a shared history or recognize an older packet whose decisions are already retained.

## Select completed scientific work

Use the catalogue to see the actual source editions, native run states and delivery states:

    python model/review_cli.py --workspace WORKSPACE catalogue

Create a selection document with schema **upstate.customer-review-selection/v1** and these fields:

| Field | Meaning |
| --- | --- |
| title | A useful name for this review. |
| purpose | The decision this selection is intended to support. |
| source_collection_ids | Exact retained source-edition IDs from the catalogue. |
| run_ids | Exact completed native run IDs. |
| delivery_ids | Exact completed delivery IDs. |
| requirements | Objects containing id, title and detail for the requirements being reviewed. |
| notes | Useful context for the reviewer. |

The application accepts one or more actual retained selections. Completed runs contribute their original run records, parameter selections, output files and declared units. Completed deliveries contribute their original manifest, maps, report, working archive, package inventory, technical audit, navigator and captured delivery files. The original delivery snapshot verifier checks the existing package before it enters the review.

Create and export the review:

    python model/review_cli.py --workspace WORKSPACE create SELECTION.json
    python model/review_cli.py --workspace WORKSPACE export REVIEW_ID NEW_REVIEW_DIRECTORY --zip NEW_REVIEW.zip

A changed source edition or completed delivery can have a new purpose and review. Compare the two selections to see changed file bytes, changed source metadata, additions and removals:

    python model/review_cli.py --workspace WORKSPACE compare ORIGINAL_REVIEW_ID NEW_REVIEW_ID

## Reopen the entire working project

The review desk uses the original scientific workspace's backup and receiving implementation. The full workspace archive carries retained sources, profiles, scenarios, native working files, results, review records and application code together.

    python model/review_cli.py --workspace WORKSPACE workspace-backup SCIENTIFIC_WORKSPACE.zip
    python model/review_cli.py workspace-restore SCIENTIFIC_WORKSPACE.zip NEW_DIRECTORY
    python NEW_DIRECTORY/application/model/review_cli.py --workspace NEW_DIRECTORY/workspace list

The restore command reopens the original archive and then checks the customer review records against the restored source selections and response history. You can continue the review from the restored application.

The offline review ZIP is useful for the selected files and review conversation. The scientific workspace archive is the full working project. Both use the original selected file contents and can be moved to a new receiving directory.

## Original references

The publisher's [drinking-water page](https://www.upstateforever.org/drinkingwater) links the retained public Web Map. Its [original item metadata](https://upstateforever.maps.arcgis.com/sharing/rest/content/items/f90ca2e367464d5ba9f8c63949e3f6cd?f=pjson) and [complete item-data response](https://upstateforever.maps.arcgis.com/sharing/rest/content/items/f90ca2e367464d5ba9f8c63949e3f6cd/data?f=pjson) are included in this application source packet. Esri documents the [item-data interface](https://developers.arcgis.com/rest/users-groups-and-items/item-data/).

The scientific application selects the original [InVEST 3.20 NDR](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/ndr.html) and [InVEST 3.20 SDR](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/sdr.html) engines. Their selected native units and parameter references remain attached to the actual completed run and delivery records.
