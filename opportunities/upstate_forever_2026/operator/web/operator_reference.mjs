/** Current operator reference, composed with the existing Guided journey. */
export const referenceEdition='2026-10-13.2';
export const referenceSections=[
  {
    "id": "start",
    "title": "Choose the right starting point",
    "paragraphs": [
      "Open the intended workspace and read its project title before selecting sources or changing a case. Guided journey → Open data or a saved study connects the original source, grid, profile, scenario and run forms.",
      "For your own data, choose Open original files, inspect the original names, fields, dates, units, coordinate system and missing-value codes, then retain that source edition. For a previous analysis, choose its saved source or baseline. A retained file is a preserved input; its presence alone does not establish that its values are field measurements.",
      "Keep observed measurements, modeled native results and authored teaching inputs explicitly identified. A source vintage is a published edition label; it must not be silently turned into an observation date. The original source inspection and references remain the authority for each field."
    ]
  },
  {
    "id": "screens",
    "title": "Find the correct screen",
    "screens": [
      [
        "journey",
        "Guided journey",
        "Follow an original source or saved baseline through preparation, calculation, comparison, maps and complete project transfer. Save the selected operating view before handover."
      ],
      [
        "sources",
        "Original sources",
        "Inspect and download original files, their retained editions, native field schema, coordinate information and source references before selecting scientific inputs."
      ],
      [
        "grids",
        "Model grids",
        "Choose the reference grid and original layers. Keep the contributing model domain separate from the reporting boundary. Read the actual cell size and coordinate system."
      ],
      [
        "profiles",
        "Parameter profiles",
        "Read the complete biophysical table, model period, NDR/SDR settings and published references. Save a separate revision when assumptions change."
      ],
      [
        "scenarios",
        "Land-cover scenarios",
        "Retain the unchanged baseline or a separate change with explicit original masks, replacement codes, sequence and reason."
      ],
      [
        "runs",
        "Native model runs",
        "Prepare a saved grid/profile/scenario selection, then start its selected original NDR, SDR or combined calculation. Open Tasks for actual progress, recovery and original logs."
      ],
      [
        "comparisons",
        "Run comparisons",
        "Select distinct completed runs on the same grid with a common model. Read shared valid support, actual units and any profile change beside each alternative-minus-baseline result."
      ],
      [
        "spatial",
        "Spatial review",
        "Open original sources, run outputs or comparisons, choose the actual layer and statistic, inspect its legend and extent, and retain a geographic view or map pack."
      ],
      [
        "landcover-ledger",
        "Land-cover changes",
        "Compare original land-cover observations or enter an ordered year/source/band timeline. Inspect common fractional support, class trajectories, returns and original-grid exports."
      ],
      [
        "terrain-conditioning",
        "Terrain editions",
        "Save an explicit DEM/context/hydrography case, prepare its terrain editions, then run and compare native results using the selected DEM edition."
      ],
      [
        "observations",
        "Observed water quality",
        "Retain original observation fields and units, inspect their actual dates and support, and select a scientifically compatible modeled comparison."
      ],
      [
        "calibration",
        "Calibration",
        "Open the retained observation support, candidate profiles, partition choices and saved review. Read model/data units, coverage and held-out results before choosing a profile."
      ],
      [
        "parameter-studies",
        "Parameter studies",
        "Select a source-bound baseline and explicit parameter axes, prepare the study, and open its original queued run and saved summary."
      ],
      [
        "conservation",
        "Conservation plans",
        "Inspect the retained candidate geography, selected criteria and constraints, then save a planning selection and its original report."
      ],
      [
        "communities",
        "Communities",
        "Inspect the original table, fields, selected geography and comparison context. Preserve its source and meaning with the geographic view."
      ],
      [
        "deliveries",
        "Maps and delivery",
        "Build a delivery from the selected completed runs and supporting sources. Open its actual report, map files, metadata and complete editable package."
      ],
      [
        "project-continuity",
        "Project continuity",
        "Create or receive the complete project and selected operating history, open the received workspace and continue the retained original work."
      ]
    ]
  },
  {
    "id": "run",
    "title": "Change inputs and run the original calculation",
    "steps": [
      "Inspect the retained source and choose its grid, parameter profile and baseline scenario. Read the native preview and original source choices before preparing the run.",
      "For a scientific alternative, save a separate scenario or profile revision with the actual change and reason. Select that saved revision in the original run form. Changing a source, grid or profile can change the scientific support and comparison meaning.",
      "Prepare the run, then choose Run native models for that exact saved run. Read the task state and native stage rather than repeatedly submitting the form. A completed native case and the completion of its enclosing programme are separate states.",
      "If a response is interrupted, open the original task or Recover original request. Resume original task continues that task and its retained stages. Open the retained log and selected sources when correcting a failure; preserve completed results.",
      "Open the completed maps and results. Read the actual quantity, units, valid-cell coverage and source/profile selection. Reused stages retain their original origin and timestamps; current task duration is not their historical compute duration."
    ]
  },
  {
    "id": "calibration-cycle",
    "title": "Compare observations and develop parameter profiles",
    "paragraphs": [
      "Use Calibration and validation to compare completed baseline profiles with original annual-load observations on compatible catchments and periods. Keep the uncalibrated baseline, every original source edition and earlier evaluations. A completed calculation is not evidence that its inputs are measured or that its prediction is accurate.",
      "Whole upstream gauge basins, the model domain and the reporting boundary describe different support. A nearby station, a HUC label or a clipped reporting total does not establish the load at a gauge. The retained regional example uses actual geography with simulated physical inputs; preserve that description when inspecting its results."
    ],
    "steps": [
      "Retain the original observation table and basin files in the selected workspace. In Calibration and validation, inspect Original annual-load observations and Original source before choosing a table. Read the original station and catchment IDs, constituent, annual-load unit, period, method, qualifiers and exclusion reasons. Import original observations if a suitable original edition is not yet present; a concentration sample is not an annual mass.",
      "If a new basin edition is needed from the actual prepared model DEM, choose Prepare gauge catchments. Select the saved model grid, original observation edition, coordinate carrier, longitude and latitude fields, original basin source/layer and catchment ID field. Confirm the actual WGS84 coordinate datum. Keep original coordinates and basin geometry; select native snapping settings only when scientifically appropriate. When snapping is selected, Stream initiation area is entered in hectares and Stream search window in grid cells.",
      "Choose Inspect original outlets and terrain. Review finite-cell coverage, the original basin's coverage inside the DEM, original and prepared DEM identities, and every selected outlet. Resolve out-of-grid or NoData findings before Run native delineation. Open source and map afterwards; inspect the original and D8 basins, actual outlet movement, stream membership and edge diagnostics. Use these catchments in calibration carries the original observation subset and the actual new source edition into the form.",
      "Choose New calibration, or continue the source-bound form. Select the Native grid and unchanged baseline and the completed candidate runs/profiles. Choose the original observation edition and polygon source/layer/ID field. Review observation period weighting, pollutant weights, annual mass scales and their sources, and any separately supported delivered external loads. Candidate profiles compared together must retain compatible native model outputs, grid and baseline.",
      "Choose Inspect original catchments. Assign Calibration and validation groups before selecting a profile from its scores, then choose Save calibration selection. Review Source support for this evaluation and original reference-reuse explanations. Previously inspected holdout records do not become fresh independent evidence by changing their group label; preserve the earlier training/validation history.",
      "Open the saved selection and choose Analyze selection. Use its original task and Resume analysis after a recoverable failure. Open Results to inspect the chosen profile, observed and modeled annual loads, candidate outcomes, units, valid support, calibration loss and reserved-group performance. No eligible candidate is a retained scientific outcome with source/support reasons, not a reason to hide excluded rows.",
      "Choose Continue selected profile to populate Parameter studies from the exact selected native profile and its original Calibration context. In Working designs and recovery, use Save working revision to preserve named unfinished controls; use Save as new branch when exploring a different design. Download unfinished form and history retains raw controls and any pending original save request. Open working designs and Review history reopen the saved ancestry. When a named design is scientifically ready, save its changed raw fields before the ordinary preview and preparation, then run the chosen new Parameter cases through their existing native tasks.",
      "Return the completed Parameter candidates to Calibration. Inspect the carried original observations, catchments, records, weights and training/validation groups before making any scientific changes. In a followed-up result, open Selected-profile history, choose an earlier evaluation and constituent, and inspect actual annual loads, errors and partition changes. Pairing uses the original reference support; changed or incomplete sources remain separately labelled. Native-load changes and delivered external-load changes are distinct.",
      "Use Export complete results and Export selected-profile history for readable results and original source packages. From a saved Calibration design or evaluation, choose Share editable Study; the existing Studies form opens with that exact record selected. Inspect Preview contents, choose Export editable study and use Transfer archive to receive it in a separate destination. In the received study, Open original evaluation reopens the saved scientific result, Open editable design opens its source-bound selection, and Open selected native run opens the retained selected calculation. Reopen original observations, catchments, native cases and linked evaluation history before editing. Keep readable report/source ZIPs distinct from the editable Study and retain all original archive members."
    ],
    "rows": [
      [
        "Same-DEM catchments",
        "DelineateIt derives D8 basins from the chosen DEM. NDR/SDR uses its own native routing; sharing the DEM does not establish identical routing support. Original outlet coordinates and basin files remain retained. A finite outlet cell or a successful delineation alone does not establish complete upstream terrain coverage."
      ],
      [
        "Calibration loss and validation",
        "Profile selection uses the declared training objective. Held-out results describe the selected profile on the reserved groups. Review prior use of those references and actual support before making an accuracy claim."
      ],
      [
        "Physical history",
        "Compare annual quantities and physical errors only where original reference support matches. Each evaluation keeps its own objective and partition; a lower score under changed weights is not the same as a lower error on unchanged evidence."
      ],
      [
        "Working design, prepared study and result",
        "A named working copy can retain unfinished or invalid controls. Preparation validates a scientific selection; Run executes that selected case. Earlier completed results remain available while later work is prepared or runs."
      ],
      [
        "Calibration study selections",
        "Studies provides Calibration designs, Calibration evaluations, Calibration source-error reviews, Calibration residual maps, Calibration scientific reviews and Calibration report sources. Choose the retained record whose work you want to continue; Preview contents shows its selected dependencies before export. A received editable design preserves its original scientific source context."
      ]
    ]
  },
  {
    "id": "units",
    "title": "Read quantities and difference signs",
    "rows": [
      [
        "Nutrient export",
        "NDR annual nitrogen and phosphorus export is modeled delivery to streams, ordinarily kg/year as recorded with the output. Read the actual artifact units; these are not intake concentrations."
      ],
      [
        "Sediment export",
        "SDR annual sediment delivery uses the retained output units, ordinarily metric tonnes/year. Do not compare a mass total directly with a concentration sample."
      ],
      [
        "Signed native difference",
        "Alternative minus baseline. A negative export difference is lower modeled export on the compared valid cells; a positive difference is higher. Read changed support separately."
      ],
      [
        "Reporting support",
        "A reporting polygon summarizes the selected physical quantity. The wider model domain supplies upstream context. Overlapping areas cannot be summed as independent unique land without accounting for overlap."
      ],
      [
        "Area and coverage",
        "Land-cover trajectory areas are hectares on the common fractional polygon support. Percentages use their stated denominator. Missing coverage is not a measured or calculated zero."
      ],
      [
        "Observed versus modeled",
        "Observation units, time basis, method, qualifiers and reporting limits must be explicitly compatible with the model quantity and geography. Keep excluded and censored rows visible."
      ],
      [
        "Terrain settings",
        "Burn depth is in metres and the selected half-width is not the total width. Geometric filling volume is not water storage. Scenario values describe the analyst’s terrain choice."
      ],
      [
        "Timeline persistence",
        "A final class present in multiple trailing selected observations is observed persistence over those selections. Gaps are explicit; it does not assert an unobserved continuous interval or future permanence."
      ],
      [
        "Forest crossings",
        "Forest entry and exit count any observed crossing and can overlap when land returns. Ending forest membership is a separate quantity. The selected class definitions remain explicit."
      ]
    ]
  },
  {
    "id": "maps",
    "title": "Switch maps and read the result",
    "paragraphs": [
      "Open Spatial review or the original report map. Choose the actual source, output or comparison layer and statistic, then read the legend, units, geographic extent and selected reporting area together. Retain missing-data hatching and explicit zero values.",
      "In Land-cover changes, ordinary comparison maps and whole-history timeline maps describe different questions. Choose the desired metric and read its exact value table: stable or changed area, return to the initial class, final-class retention, or forest entry/exit. Repeated transitions are retained in the separate timeline summary and trajectory tables.",
      "Inspect the original raster or geographic download when it is needed for another GIS workflow. A screen color or screenshot does not replace the original GeoTIFF, vector/table, source references and saved selection."
    ]
  },
  {
    "id": "save",
    "title": "Save, export and reopen",
    "steps": [
      "Save the current scientific record and operating selections in their original controls. A notes file or view-selection file records that view; it is not the complete scientific project.",
      "Open each report and every relevant map, CSV, source table and working document before transferring them. Use the actual download controls so the file belongs to the selected saved edition.",
      "Use Project continuity for the full project and its operating history, or the specific complete working package when continuing that product. Keep the original archive members together and follow its included opening instructions.",
      "Receive the archive into a separate chosen destination, open that received workspace and check the original project, sources, saved selections and completed outputs. Continue an unfinished operation from its retained task rather than creating a replacement case.",
      "For a land-cover portable archive, retain its complete report, source-year choices, six CSV tables and original-grid rasters. Use the documented land-cover receiving command to cold-open the original edition; an extracted report alone is the readable result, not the full application."
    ]
  },
  {
    "id": "examples",
    "title": "Worked examples and their actual scope",
    "paragraphs": [
      "The native terrain example is explicitly SIMULATED headwaters. Its completed 2 m conditioning alternative changes 267 cells / 24.03 ha. On 14,155 common valid cells / 1,273.95 ha, annual modeled N decreases 66.7786 kg, P decreases 5.4895 kg, and sediment increases 52.2197 metric tonnes. Nine lost valid cells remain separate. This is a completed case retained in its own original project, not an observation or a result automatically present in another workspace.",
      "The completed original-file monitoring example retains all 208 public-source rows, including 49 below-limit results, across nine separate series and 302 same-month pairs. Its multi-year view opens the original record, qualifier and unit selections. These counts describe that retained source edition and do not supply another study’s observations.",
      "The temporal land-cover teaching course uses a declared four-observation raster with stable, once-changed, repeatedly changed, returning, missing and unknown-code cells. Its small authored grid explains interpretation and receiving. Use the actual completed receiving output before quoting a numerical result; the live timeline controls also accept retained regional source observations."
    ]
  },
  {
    "id": "help",
    "title": "When a result cannot be opened",
    "paragraphs": [
      "Keep the selected workspace, original operation and source choices. Read the exact current error and the original log or task details. Missing source, incompatible units/grid, incomplete native output and a lost response require different corrections.",
      "If the application says a source or saved item changed, reopen the intended original edition or compose the actual newer source with its owner. Do not replace the original files to make an old identifier appear valid.",
      "Use Download operation record for the full native operation when it is available. Share the actual exception, selected case and original task with the operator maintaining that project. The reference does not start jobs, change scientific settings or alter saved data."
    ]
  }
];
export const referenceCSS=".operator-reference{color:#202124;background:#fff;border:1px solid #c7c9cc;border-radius:4px;padding:1rem;margin-top:1.5rem;font:16px/1.55 system-ui,sans-serif;overflow-wrap:anywhere}.operator-reference summary{font-weight:650;cursor:pointer}.operator-reference h2{font-size:1.5rem;line-height:1.25;margin:1.7rem 0 .75rem}.operator-reference h3{font-size:1.15rem}.operator-reference p,.operator-reference li{max-width:82ch}.operator-reference nav{display:flex;flex-wrap:wrap;gap:.5rem 1rem;margin:1rem 0}.operator-reference a{color:#242424;text-decoration:underline}.operator-reference .reference-table{overflow:auto;max-width:100%;margin:1rem 0}.operator-reference table{border-collapse:collapse;width:100%;font-size:1rem}.operator-reference th,.operator-reference td{padding:.75rem;border:1px solid #c7c9cc;text-align:left;vertical-align:top}.operator-reference th{background:#f1f2f3;font-weight:650}.operator-reference td:first-child{min-width:11rem}.operator-reference button{font:inherit;background:#f5f5f5;color:#202124;border:1px solid #9b9da0;border-radius:3px;padding:.45rem .65rem;margin:.4rem 0}.operator-reference .reference-caption{font-size:.9rem;color:#4f5358}.operator-reference .reference-records{padding:.8rem;background:#f6f6f6;border-left:3px solid #85898e}.operator-reference pre{white-space:pre-wrap}.operator-reference li{margin:.5rem 0}@media(max-width:560px){.operator-reference{padding:.8rem}.operator-reference h2{font-size:1.25rem}.operator-reference table{min-width:32rem}.operator-reference nav{display:block}.operator-reference nav a{display:block;margin:.4rem 0}}@media print{.operator-reference{border:0;padding:0;font-size:11pt}.operator-reference button,.operator-reference nav{display:none}.operator-reference .reference-table{overflow:visible}.operator-reference table{font-size:10pt}.operator-reference h2{break-after:avoid}.operator-reference tr{break-inside:avoid}.operator-reference a{color:#000}}";
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const records=(state,name)=>Array.isArray(state?.data?.[name])?state.data[name]:[];
function summary(state){
 if(!state?.data?.project)return '';
 const project=state.data.project, runs=records(state,'runs'), complete=runs.filter(row=>row.state==='complete').length;
 return '<aside class="reference-records"><h3>Current selected workspace</h3><p>'+escape(project.title||'Selected scientific workspace')+'</p><p>'+records(state,'sources').length+' retained source editions; '+runs.length+' saved native runs, of which '+complete+' are complete. Open their original records for scientific selections, units, coverage and reuse.</p><p class="reference-caption">This snapshot describes only the currently opened workspace. The worked examples below belong to their named retained cases.</p></aside>';
}
export function renderOperatorReference({state=null,availableViews=[],interactive=false}={}){
 const allowed=new Set(availableViews),nav=referenceSections.map(s=>interactive?'<button type="button" data-action="journey-reference-section" data-reference-section="'+escape(s.id)+'">'+escape(s.title)+'</button>':'<a href="#operator-reference-'+escape(s.id)+'">'+escape(s.title)+'</a>').join('');
 const content=referenceSections.map(section=>{
  let html='<section id="operator-reference-'+escape(section.id)+'"><h2>'+escape(section.title)+'</h2>';
  html+=(section.paragraphs||[]).map(p=>'<p>'+escape(p)+'</p>').join('');
  if(section.steps)html+='<ol>'+section.steps.map(p=>'<li>'+escape(p)+'</li>').join('')+'</ol>';
  if(section.screens)html+='<div class="reference-table" tabindex="0" role="region" aria-label="Operator screen reference"><table><thead><tr><th>Screen</th><th>Use it for</th></tr></thead><tbody>'+section.screens.map(([view,label,meaning])=>'<tr><th scope="row">'+escape(label)+(interactive&&allowed.has(view)?'<br><button type="button" data-action="journey-view" data-view-name="'+escape(view)+'">Open '+escape(label)+'</button>':'')+'</th><td>'+escape(meaning)+'</td></tr>').join('')+'</tbody></table></div>';
  if(section.rows)html+='<div class="reference-table" tabindex="0" role="region" aria-label="Scientific quantity reference"><table><thead><tr><th>Quantity or choice</th><th>Read it this way</th></tr></thead><tbody>'+section.rows.map(([label,meaning])=>'<tr><th scope="row">'+escape(label)+'</th><td>'+escape(meaning)+'</td></tr>').join('')+'</tbody></table></div>';
  return html+'</section>';
 }).join('');
 return '<article class="operator-reference" data-operator-reference="'+referenceEdition+'"><header><h2>Operator reference</h2><p>Use your original data, inspect the scientific choices, calculate, compare and reopen the complete project.</p><p class="reference-caption">Reference edition '+referenceEdition+'. Screens are available according to the components installed in the current application. Opening buttons appear only for navigation actually present in this operator.</p>'+(interactive?'<button type="button" data-action="journey-reference-download">Download complete reference</button>':'')+'</header><nav aria-label="Operator reference contents">'+nav+'</nav>'+summary(state)+content+'<footer><p class="reference-caption">Upper Savannah scientific workbench · TokenJunkieLabs. Detailed methods, original sources and component operating guides accompany the complete application.</p></footer></article>';
}
export function operatorReferenceDocument(options={}){
 return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Upper Savannah — Operator reference</title><style>body{margin:0;background:#f4f4f4;color:#202124;padding:1rem}main{max-width:1100px;margin:auto}'+referenceCSS+'</style></head><body><main>'+renderOperatorReference({...options,interactive:false})+'</main></body></html>\n';
}
export function operatorReferenceMarkdown(){
 let text='# Upper Savannah operator reference\n\nReference edition '+referenceEdition+'. TokenJunkieLabs.\n\nUse your original data, inspect the scientific choices, calculate, compare and reopen the complete project.\n';
 for(const section of referenceSections){
  text+='\n## '+section.title+'\n\n';
  text+=(section.paragraphs||[]).join('\n\n')+'\n';
  if(section.steps)text+='\n'+section.steps.map((step,i)=>(i+1)+'. '+step).join('\n')+'\n';
  if(section.screens)text+='\n'+section.screens.map(([,label,meaning])=>'**'+label+'** — '+meaning).join('\n\n')+'\n';
  if(section.rows)text+='\n'+section.rows.map(([label,meaning])=>'**'+label+'** — '+meaning).join('\n\n')+'\n';
 }
 return text;
}
