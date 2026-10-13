# Profile workbench

TokenJunkieLabs · Upper Savannah scientific application

## Open the product

Use the normal operator URL and select the intended workspace. Choose **Profile workbench** immediately after **Parameter profiles** in the sidebar. This desk uses the installed native coefficient engine, the existing operator queue and the original scientific workspace.

## Inspect and revise a saved profile

Select a saved profile from the library. The page shows its original coefficient table, original source URI and edition, native NDR/SDR parameters, model period and current scientific review record. The coefficient CSV remains downloadable. Profile IDs identify saved scientific configurations.

Choose **Create revision**. Set a descriptive profile title, scientific references, model period and notes. Select the native models to configure. The parameter inputs come from the installed native model descriptors; required and optional native fields retain their original meanings. When changing which native models are selected, save that choice with the unchanged coefficient table first. Open the saved edition before editing its coefficient cells.

Edit native coefficient cells directly, or choose **Load revised CSV**. The CSV route supports ordinary quoted fields, commas and quoted line breaks. A revision preserves the original columns, row order, land-cover codes and descriptive source values. It changes native coefficient cells. Use Original sources to import a genuinely different table, then create a profile from that source.

Use the row search to find a land-cover code or source description. The column selector switches between NDR fields, SDR fields, descriptive columns and the complete table. Changing these views preserves all values. Changed cells are marked with a darker border; the original value is available in the control's tooltip.

Record who prepared the revision, its actual source edition or date and the scientific reason for the change. Select **Review changes**. The native engine checks the table and parameters and returns a field-level comparison. Correct any named invalid values and review again. Select **Save working profile** to retain the new configuration in the existing operator queue.

The backend reuses the current original experiment-profile materializer for single-profile changes. Native scalar and routing choices, coefficient cell changes and original source references remain connected to that engine's retained lineage. The new profile appears in the existing native run selection as well as this workbench.

## Create a profile before its first run

Choose **New from source table**, select an already imported biophysical CSV and choose NDR, SDR or both. Fill in the native parameters and scientific references. The source table is shown as read-only during this initial save. Review and save the working profile, then open the saved result and choose **Create revision** to change coefficients.

## Reopen, compare and continue

Open a saved profile and choose an earlier or reference profile under **Compare saved revisions**. The comparison shows saved native parameter and coefficient values side by side. Inspect the source lineage and scientific review history alongside those differences.

Saved profiles, table editions, cell lineage and review records belong to the original scientific workspace and travel with its ordinary backup and restore. Browser drafts are stored separately in that browser and workspace. Save a working profile to retain the configuration with the project before transferring it.

Operations show queued, running, failed and interrupted states from the original operator. **Open operation** opens the original task details. **Resume same operation** continues that exact task after the named input or runtime issue is corrected. A repeated identical request retains its original operation ID so an uncertain response can be reconciled by the existing queue.

## Record scientific review

Open the exact saved profile and choose **Record review**. Enter the actual reviewer, role or organization, review reference and notes. Choose Working, Scientist reviewed or Changes requested to reflect that review's actual outcome. The form begins with Working and makes no review assertion on behalf of the reviewer.

A review is tied to the exact profile and coefficient bytes. The current review identity is included when saving so a newer review by another operator is preserved. Changing coefficients creates a working profile revision; its scientific review is recorded independently. The status informs the operator's choice of scientific configuration.

## Coefficient interpretation

Nitrogen and phosphorus loading coefficients use kilograms per hectare per year. The load_type_n and load_type_p columns state whether the original coefficient describes application-rate or measured-runoff. Keep that basis as supplied by the scientific source. Nutrient retention efficiencies and subsurface proportions are fractions; nutrient critical lengths use metres. USLE C and P are dimensionless factors. The desk retains these original native units and field meanings.

Primary model references:

- https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/ndr.html
- https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/sdr.html

## Application integration

The extension manifest is operator/extensions/profile-workbench.json. The browser module operator/web/profile_workbench.mjs exports createProfileWorkbench(host) with mount, update, detach and open methods. It receives the existing getState, api, refreshState and showTask capabilities. The neutral stylesheet is operator/web/profile_workbench.css.

The original extension registry binds ProfileWorkbench(operator, fault) from operator/profile_workbench.py. Read routes are /api/profile-workbench/catalog, /methods, /inspect, /table, /preview and /compare. Mutations use the existing /api/actions endpoint with profile.edition.save and profile.edition.review. Completed downloads use the existing authenticated file-ticket transport. The manifest includes verify_all(workspace) for ordinary workspace receiving.

The operator provider and model/profile_editions.py are in backend source F0C8NF1E4H4. The current sourced experiment engine is 85E65 F0C8HR43RS7 and its cumulative integration. Read those original sources together when receiving this extension.

## Focused receiving journey

With the retained 15-row regional source, open the original working profile, inspect its provenance, revise one selected native coefficient, preview its one-cell change, save, reopen and compare against the reference. Exercise one invalid native coefficient to confirm the draft remains correctable. Open the original task and its saved CSV/lineage files, then reopen the same scientific workspace from its normal archive. Record actual operation times and screenshots of this new interface on the receiving host.

The source package includes a completed module syntax and CSV behavior check. The live browser and native save/reopen sequence belongs to the receiving host's actual original workspace.

## Original coefficient evidence and endpoint experiments

Open a saved profile and use **Coefficient evidence and ranges** below its original coefficient table. The evidence template contains the original numeric cell text, native units and nutrient load types. Fill source title and citation only for coefficients whose source has been established; locator, period and notes can identify the actual table or method. Import the completed CSV through **Original sources**, select that retained table, inspect its coverage and save the evidence.

Each evidence edition binds the original profile ID and coefficient-table SHA256 to the retained evidence CSV. Coverage counts documented, unknown and ranged coefficient cells within the selected native models. General profile references remain visible but do not become individual-cell citations. Application-rate and measured-runoff tags retain their original meanings.

For coefficients with actual source-supported lower and upper values and a range basis, select the exact land-cover and parameter cells. Enter the scientific purpose, review the selected endpoint table and prepare the profiles. The maintained sourced-profile materializer creates the lower and upper parameter configurations; the original central profile remains the same saved profile and table. Other coefficients, descriptive columns, load types and native algorithm parameters stay unchanged.

Lower and upper refer to parameter values. They are not confidence intervals and do not automatically identify the lowest or highest pollution result. Use a completed baseline run under the central profile to prepare the existing native experiment. Each endpoint profile runs on baseline land cover and every selected scenario. Scenario changes are compared with the matching baseline under that same profile. Execute and inspect these cases in the existing Experiments view.

Saved evidence and endpoint records expose downloads through the operator's authenticated file transport, including the original evidence CSV. Workspace export retains both record directories, and normal archive receiving validates their profile, source and endpoint bindings before promotion. Requests retain operation IDs before submission; returning to the same profile restores saved requests and allows the existing operation to resume.

The additive backend is model/biophysical_evidence.py; scientific format and CLI details are in model/BIOPHYSICAL_EVIDENCE.md. The browser child module is operator/web/biophysical_evidence.mjs. ProfileWorkbench read routes under /api/profile-workbench/biophysical/ are catalog, template, evidence-preview, evidence-inspect, ranges-preview and ranges-inspect. Mutations use the existing action queue: profile.biophysical.evidence.save, profile.biophysical.ranges.prepare and profile.biophysical.experiment.prepare.

### Receiving this addition

Receive the complete current source package, run the standard profile workbench installer against the existing application, then restart the operator. The installer includes the evidence backend, browser module, extension descriptor, guide and current portable workspace implementation. Preserve newer changes when composing shared files.

On an actual retained profile, download its evidence template and import the unchanged template through Original sources. Inspect and save it: all unattributed cells should remain unknown, with the exact original values and load types retained. Then use actual supplied coefficient citations and ranges to inspect selected endpoints, prepare the native experiment and reopen the exported workspace. Confirm that the new evidence and ranges remain selectable and that the original central profile ID and table SHA256 are unchanged.
