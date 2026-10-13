# Published pasture loading cases

This recipe prepares six source-linked profiles in the existing Management Cases workflow. It starts from an actual retained profile and an explicitly selected pasture code. It does not execute a model or change the original profile.

## Published source

Endale and colleagues (2021), [DOI 10.2489/jswc.2021.00164](https://doi.org/10.2489/jswc.2021.00164), studied grazed tall fescue near Watkinsville, Georgia. The randomized design used two approximately one-hectare paddocks per treatment, predominantly Cecil soil, with area-weighted slopes of 3.3–4.8%. [Supplemental Table S4, page 14](https://www.ars.usda.gov/ARSUSERFILES/60480500/2020/SUPPLEMENTARY%20INFORMATION/JSWS-D-19-00164-R1%20SUPPLEMENTAL.PDF) provides individual-treatment annual total-N and total-P means for 2007–2009.

The accompanying CSV preserves the six published pairs. Missing events were estimated by the authors; the period includes dry and wet years. These are field-edge surface-runoff estimates, not long-term local calibration. The hayed arm is excluded because its endophyte label differs between the abstract and methods/table. Table S5's pooled totals are not substituted for individual annual coefficients.

## Make the project choice explicit

Set STUDY and PROFILE to the actual existing Workspace and profile. Set PASTURE_LUCODE to the confirmed class from that profile; there is no default code. The helper verifies the retained CSV hash through the original profile API. Both nutrient load tags must already be measured-runoff. It refuses to relabel application-rate inputs.

Choose one nitrogen boundary:

- existing-surface-only requires the selected original class already to have proportion_subsurface_n=0.
- explicit-surface-only includes an explicit zero partition in all six literature cases. It represents only the observed surface compartment; it is not evidence that subsurface losses are absent.

The two annual loads are always changed together. No independent N/P factorial is created. Retention efficiency, critical lengths, C/P, native model parameters and all other classes remain as supplied by the actual baseline. The source's full treatment and field context remains linked in each derived profile.

From the existing application directory:

~~~bash
python -B source_tools/prepare_endale_pasture_cases.py \
  --workspace "$STUDY" \
  --profile "$PROFILE" \
  --lucode "$PASTURE_LUCODE" \
  --confirm-pasture \
  --nitrogen-compartment existing-surface-only \
  --applicability "$PASTURE_APPLICABILITY" \
  --output "$RECEIVING_OUTPUT"
~~~

PASTURE_APPLICABILITY records why the chosen class represents the intended grazed area and the limits of applying the literature to this site. RECEIVING_OUTPUT must be a dedicated output directory. Repeating an unchanged command verifies and reuses its exact selection files. A different selection requires its own directory.

This first call writes the original selection, source binding, profile preview, complete recipe and six evidence CSVs. Review the prospective cells in the existing Profile Workbench. Add --prepare to the same command to save the profiles through management_cases.prepare; the saved native management record is immediately inspected through management_cases.inspect. Existing source identities remain authoritative, and the helper returns the actual management-case ID and the actual profile ID for each treatment.

## Compare the intended pairs

Use the existing experiment workflow for the prepared profiles on one common LULC/scenario/grid/runoff input. Keep the same runoff-proxy normalization. The comparison CSV defines three litter-to-inorganic contrasts within the same endophyte. All three have lower published P and higher published N. These numerical contrasts are not tests of statistical significance or evidence of the same local response.

A regional baseline versus one literature profile includes a source-transfer change; it is not the matched fertilizer-treatment comparison. Once the six treatment runs exist, select each litter run as the comparison baseline and its matching inorganic profile as the alternative. Reuse the completed run identities with the existing source_run_ids mechanism; do not repeat identical native work.

InVEST routes and runoff-normalizes the chosen source inputs. Its downstream stream-export endpoint differs from the field-edge endpoint in the study. Report native N/P outcomes separately, alongside changed area and the original paired-mask quantities. No published confidence interval is supplied by this recipe.

## Evidence and editable handoff

receiving-result.json maps every treatment profile to its two-row evidence CSV. Import each CSV against that exact profile using the existing coefficient evidence workflow. The CSV documents only load_n and load_p; it does not invent evidence for inherited cells or the declared zero-partition assumption. Keep range_ids empty. Evidence registration has not occurred merely because the helper wrote these files.

Retain the selection, source-binding, CSVs, native management record and actual downstream report/Study identifiers in the original operation. Use the existing scientific/customer reports and editable Study export/cold restore. Do not create a parallel project.

Follow CURRENT_OWNER_DIRECTION.md, version 2026-10-13.4 or its actual successor: continue unfinished work without the obsolete production cutoff, preserve completed runs and current writer custody, and keep communication authorization separate. The producing worker must open the exact populated application and reports, look at desktop and narrow views, use the relevant controls, open every outgoing CSV/JSON/HTML/PDF and cold-reopen the editable export. Source inspection alone is not a native execution or visual-review receipt.
