# Scientific setup operator desk

Open **Scientific setup** in the existing operator navigation. The desk prepares the actual saved study setup for the original customer review workflow.

## Inspect the saved scientific choices

Select the actual saved profile and grid, then choose **Inspect selected configuration**. This reads the source-bound profile and its original coefficient table. It leaves the current setup and review unchanged.

The configuration sheet shows each native parameter's saved value, units, model, meaning and original method reference. **Used by selected grid** distinguishes a parameter used by that grid from a parameter retained only in the profile. Missing method descriptions or units are shown as unrecorded; the desk does not infer them.

**Original coefficient table** includes every original row and column. It retains source cell strings, including the original application-rate or measured-runoff basis beside nutrient values. Search filters the visible rows; Previous and Next page through that filtered view without removing anything from the captured setup. Clear the search to return to the complete table. Expand **Column names, units and original methods** and **Complete original source, model period and citations** to inspect the source identity, original table bytes, model period and references.

A nutrient input coefficient is not a routed stream-export result. Read it with its original load-basis column and physical units. The configuration sheet keeps model inputs, observations and completed outputs distinct.

### Revise through the original Profile Workbench

1. Inspect the exact profile you intend to revise.
2. Choose **Open this profile for revision**. The existing Profile Workbench opens that original profile.
3. Use its original source/table editor and normal preview/save workflow to create a separate saved revision. Keep the selected original source and its scientific meaning visible while making changes.
4. Return to **Scientific setup**, refresh the saved inputs, and select the newly saved profile revision.
5. Choose **Preview setup**. Inspect the revised grid/profile combination and the full setup before retaining it.

Opening the workbench does not replace the scientific setup's selected profile. Saving a profile revision also does not alter an immutable saved setup or its customer review. The operator selects the revision on return and explicitly retains a new ordinary setup task.

When a saved setup is open, the next setup preview compares its captured configuration with the newly previewed selection. Expand **Every changed choice and source** to see original/current parameter values, coefficient cells, model membership, units, method references, coefficient-source identity, model period and citations. A changed load basis remains a distinct interpretation change; the desk does not calculate a percentage model effect or approve a scientific choice from those differences.

Older saved setups may predate the captured configuration sheet. Their original profile/table remain available. Open their selections and preview a new setup to capture the complete sheet; an unavailable earlier sheet is not reported as an unchanged configuration.

## Prepare and review

Choose the saved model grid, parameter profile, baseline, and alternative scenarios. Describe the scientific question, the reporting area and contributing-domain rationale, the intended validation comparison, and the reviewer/operator responsibilities. Select additional source collections and saved observations when relevant; the backend includes source collections already bound to the selected grid, profile and scenarios.

The requested grid resolution and alternative count are comparison targets. A difference is shown as a review finding beside the actual saved definition. Clear either field when no target is requested. A new Eco setup starts with the proposed 30 m grid and two alternatives.

**Preview setup** reads the selected originals and presents the grid definition, prepared input provenance, original parameter profile, exact scenario definitions, source coverage and units, observations, validation plan and review findings. Raster headers are captured when the setup is retained.

### Review the original measurements and their support

Selected observations show all retained measurement rows with their original columns, including station/facility/outfall/gauge identifiers where present, species or fractions, original value text, units, qualifiers, periods, quantity basis, coverage and physical support. Expand each row's **Complete retained measurement fields** and the record's **Original metadata, column mapping and support** for its full original meaning. Search and paging change only the view.

**Eligible annual-load input** means the row meets the existing intake's comparison conditions. It does not establish scientific acceptance, validation or equivalence to a different species, fraction, concentration or time basis. Context rows remain visible alongside their original issues. Use the intended validation plan to choose the actual comparison and retain the scientist's review.

**Retain setup and create review** uses the existing retained task API. The same operation identifier survives a network interruption; reopening the desk offers continuation of that request. Completed setups appear in the project history with their original file downloads.

**Open customer review** dispatches the original operator's `review-open` action. Review decisions, export, returned responses and reconciliation continue through Customer reviews and Returned responses.

## Continued editing

Form drafts are retained separately for each workspace and project. Reopening a saved setup shows its original captured specification. **Use as a new setup** restores that selection into the form so a revised setup can be previewed and retained without modifying the original review selection.

The desk composes through the maintained extension registry. Its descriptor registers the three browser assets, the scientific setup provider, its task action and read routes, workspace overview, task decoration and original-backup verifier. Reload the existing operator after installing all backend and browser dependencies.

The browser uses existing operator layout and task conventions with scoped neutral styles. Provider values are escaped; large original definitions remain available in expandable sections. Requested targets, unassigned roles, unavailable saved selections and raster headers awaiting capture are represented explicitly.


## Retained files and independent reopening

A newly captured setup keeps the same original setup/review IDs and ordinary task history. Its retained setup object includes the complete configuration under method.configuration and the complete selected observation rows under support_rows. Source identities and original table cells travel with the existing setup package.

The saved index.html presents the same scientific choices and original coefficient table. It includes all retained coefficient rows, rather than the currently visible search page. The selected-parameters.csv companion contains the saved native parameter choices, units, model membership, descriptions and original references. It is a readable parameter sheet; the original coefficient-source file and captured configuration remain the sources for exact coefficient cells. Spreadsheet formula-like leading characters in that readable CSV are escaped by the existing exporter.

Use the original setup detail's downloads to inspect every retained companion and the customer-review package. Open index.html, the full JSON and CSV files, original coefficient/source members and selected observation companions. Check the actual data and units in those files, then export the original Workspace through its maintained complete transfer and reopen it in an independent receiving Workspace. Open the same saved setup and review by their original identities. A reopened setup should retain the full configuration, all original table columns/rows, selected parameters, measurement support and all original review links.

If configuration inspection reports that a table differs from the saved profile, return to the actual original source/profile edition. The desk verifies both the saved source descriptor and the profile's original table hash. Prepare an intentional separate revision through Profile Workbench when different data is required.

A missing or invalid saved profile/grid selection is reported through the existing selection error. Refresh the actual saved inputs and select the intended originals. A replaced or unavailable source should remain visible as that source condition until its original bytes or an explicitly revised selection are received.

## Install the complete existing family

This flow remains in the original Scientific setup provider, extension registry and native setup writer. Receive it through the current complete application or the existing Keowee/watershed/scientific-setup family installer:

    python -B source_tools/install_keowee_watershed_join.py \
      --application /actual/existing/application \
      --source-root /actual/complete/current/source \
      --dry-run

Review the resulting actual source selection, then run the same command without --dry-run at the original operator's source-adoption boundary. Reload that existing operator after the complete backend/browser update. The installer preserves its original exact join recipes, predecessor guards, shared installation lock and complete profile-source edition.

The source closure now includes model/setup_configuration.py and operator/web/setup_configuration.mjs, the current setup provider/model/UI/style/descriptor, this guide and the original receiving courses. The Scientific setup registration contains all three browser assets and its /configuration read route. The actual existing **Profile Workbench** component, experiment_profiles.catalog and the host's openDesk capability are dependencies of the revision journey. Receive those original components together; the Scientific setup desk does not provide a second profile editor.

The current canonical application component list includes these sources and that explicit Profile Workbench dependency. The family source manifest records exact full postimage hashes and recognized predecessors, so a different concurrent installed source is surfaced for composition rather than silently replaced.

## Whole original receiving course

Use the existing source_tools/receive_scientific_setup.py invocation with the same actual Workspace, saved setup selection and owned receiving directory. Its native course retains the setup and original customer review, exports the complete Workspace, restores it independently and reads the same saved originals. The extension checks the captured configuration, readable parameter CSV and selected measurement-support rows after that restore.

The same application's source_tools/receive_scientific_configuration_browser.mjs course operates the actual configuration sheet and original Profile Workbench route through the existing receiving browser. It belongs to the same scientific setup operation and does not start another native writer.

The producing owner should operate the actual desktop/screenshare and narrow layout, LOOK at the real rendered views or captures, and exercise profile selection, inspection, search, paging, method/source expansion, original workbench revision, return/refresh/reselection, comparison, preview and retained setup history. Open every outgoing setup/review attachment and independently reopen the complete export. Inspect actual scientific names, physical units, basis distinctions, long cell content, table navigation, original observations and the readable parameter CSV. Repair observed display or source problems before presenting that output.

Keep Tim's source and interpretation under his control and preserve TJLabs and original scientific-source attribution. These configuration controls help the scientist inspect and revise the actual saved inputs through the maintained workflow; model execution and scientific acceptance continue through their existing original operations.
