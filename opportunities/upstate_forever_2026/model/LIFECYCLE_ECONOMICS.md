# Lifecycle economics in the Economic desk

Needs expert review. This is an editable planning calculation attached to the completed Upper Savannah scientific report. The scientist or cost estimator supplies the programme, cost sources, price basis and establishment assumptions.

## Use the existing workflow

Select the completed native report and reporting zone in the Economic desk. The original annual cost comparison, targets and scenario frontier remain available.

Enable the optional lifecycle section. Enter its currency, price basis, price date, start date, whole-year horizon and discount rate. A constant-price schedule uses a real rate; a nominal schedule uses a nominal rate. Machine-readable rates are fractions (0.03 means 3%). Every amount must already use the selected currency and price basis. The calculator performs no inflation, escalation or currency conversion.

Choose the completed alternatives to include. For each:

1. Enter dated establishment, maintenance, replacement and other gross expenditure, with a stable row ID, label, source title, source URI, as-of date and estimate notes.
2. Enter assistance and salvage as separate positive credits. Retain eligibility, programme and payment timing assumptions. An assistance schedule is not a gross implementation price.
3. Supply an explicit benefit factor for every year and a source for that trajectory assumption. Each factor scales the original native annual avoided load. It describes an analyst-authored establishment assumption, not a new InVEST simulation or a measured biological response.
4. Add the sensitivity cases required by the study: discount rate, gross-cost multiplier and benefit multiplier. Credits retain their authored amounts. Cases carry no probability.

Preview, save the draft, build the complete edition and reopen it through the existing saved-edition controls. The original selection retains every schedule/source/factor. Switching report or zone requires explicit re-binding in the editor before the schedule can be used.

Lifecycle costs describe whole completed alternatives. The calculator does not invent treatment area or rescale native export by an estimated footprint. The adjacent footprint/unit-rate worksheet can supply a cost estimate; the completed native comparison remains the physical source.

## Read the results

The report separates gross present-value expenditure, present-value assistance, present-value salvage and net funded present value:

    net funded PV = gross expenditure PV - assistance PV - salvage PV

Assistance changes the funder's cost, not gross resource expenditure. Credits exceeding expenditure yield a visible negative net value.

Equivalent annual cost spreads the selected present value over the horizon with the same discount rate. The dated cashflow table retains the entered timing; an annual equivalent is not a forecast of the actual cash required in each calendar year.

Each modeled pollutant has its own original annual native avoided load, total assumed avoided load without discounting, discounted avoided load, gross/net PV cost per undiscounted total unit, and gross/net constant unit-value break-even amount.

Nitrogen and phosphorus remain separate kilograms; sediment remains metric tonnes. Negative avoided loads remain visible. Zero/adverse loads have no positive-load cost ratio. Without common physical support, lifecycle physical totals and ratios remain unavailable.

Each pollutant comparison uses the full programme cost independently. These views neither allocate joint cost between pollutants nor add together. A break-even value solves a unit-price assumption; it does not establish an available sale price, grant award, monetized benefit or investment return.

Factors above one are allowed when deliberately authored and explained. No default trajectory assumes full first-year establishment. An explicit empty cashflow list describes zero cost; a missing list is invalid. Omitted scenarios remain in the annual report without lifecycle results.

## Calculation

For cashflow C at time t and discount rate r:

    PV(C,t) = C * exp(-t * log1p(r))

Exact calendar anniversaries are whole years. Between anniversaries n and n+1, elapsed days divide by the actual interval length. A February 29 start uses February 28 anniversaries in non-leap years. Cashflow dates may include both endpoints of the horizon.

The annual present-value factor for H years is:

    A(r,H) = H                                if r = 0
    A(r,H) = -expm1(-H * log1p(r)) / r          otherwise

Equivalent annual cost is PV / A(r,H). For original annual avoided load L and explicit year-y factor f_y:

    assumed annual avoided load_y = L * f_y
    total avoided load = sum(L * f_y)
    discounted avoided load = sum(L * f_y / (1+r)^y)
    constant unit-value break-even = cost PV / discounted avoided load

Benefits occur at year-end anniversaries. Discounted mass is a financial weighting. The unchanged original annual model values and source report remain in the edition.

General present-value arithmetic and consistent real/nominal treatment are described in [NIST Handbook 135, 2025](https://nvlpubs.nist.gov/nistpubs/hb/2025/NIST.HB.135e2025.pdf), Chapters 3–4. The day convention, ecosystem trajectories, programme and discount rates are explicit application inputs. This application does not select FEMP rates or assert compliance with a federal procurement methodology.

## Selection contract

Optional selection.lifecycle uses schema upstate.lifecycle-selection/v1 with:

| Field | Meaning |
| --- | --- |
| currency | Three-letter uppercase code |
| price_basis | constant or nominal |
| price_date | YYYY-MM-DD price reference date |
| start_date | YYYY-MM-DD present-value date |
| horizon_years | Positive integer ending within calendar year 9999 |
| discount_rate | Finite nonnegative fraction |
| note | Analyst notes |
| scenarios | Nonempty list of completed alternatives |
| sensitivity_cases | Optional list of explicit cases |

Each scenario contains run_id, note, trajectory_source, benefit_factors and cashflows. A source is an object with title, uri and as_of (YYYY-MM-DD). Each benefit factor contains year, factor and note; every year from 1 through H appears exactly once.

Each cashflow has id, label, date, kind, amount, source and note. Kinds are establishment, maintenance, replacement, other, assistance and salvage. Amounts are positive or zero; direction follows kind. Every date must lie within the selected horizon. IDs are unique within a scenario.

Each sensitivity case has id, label, discount_rate, cost_multiplier and benefit_multiplier. IDs are unique; base is reserved for the authored schedule. Multipliers are finite and nonnegative. The gross-cost multiplier affects establishment, maintenance, replacement and other; assistance and salvage remain unchanged.

No arbitrary horizon, row-count or case-count cap is imposed. Unsupported fields and nonfinite inputs are rejected with the existing Economic desk error response.

The complete decision CLI already accepts this selection:

    python -B application/decision_cli.py packet \
      --input physical-input.json --selection selection.json \
      --output /path/to/new-lifecycle-edition

For the original native source report:

    python -B application/decision_cli.py scenario-report \
      --report /path/to/original/report.json --zone-id ACTUAL_ZONE_ID \
      --selection selection.json --output /path/to/new-lifecycle-edition

Use the actual source-bound scenario-selection command or the Economic desk to prepare the parent selection. Lifecycle additions never replace original comparison IDs.

## Complete edition and Workspace

The existing complete ZIP and immutable edition include report.json, selection.json, the offline index.html, application/lifecycle_economics.py and this guide. Through the Economic desk they also include physical-input.json and the exact source-inputs/scenario-report.json.

Three additional CSVs retain the entire result:

- lifecycle-cashflows.csv: dates, original source references, discount factors and present values.
- lifecycle-benefits.csv: every explicit year factor and separate pollutant loads.
- lifecycle-comparison.csv: authored schedule and each sensitivity case, including gross/net costs and physical denominators.

The existing safe CSV writer protects text cells from spreadsheet formula interpretation. Edition identity includes the calculator hash. Reopening/restoring a lifecycle edition checks its selected programme, complete companions and original archived calculator identity. When the installed calculator matches that identity, its result is also recalculated against the retained native physical output. An unchanged historical edition retains its archived calculation when a newer calculator is installed; a new calculation produces a new edition. Draft validation uses the original report/zone. Publication holds the existing Workspace filesystem lock so backup cannot capture a partial edition.

## Receive the actual product

The installed Economic desk loads `operator/web/economic_lifecycle.css` through the original extension's asset and stylesheet declarations. Receive the module, stylesheet, current desk and complete `economic-desk.json` together. This preserves the operator's existing `style-src 'self'` policy: the editor and in-app results do not inject inline style elements. The standalone downloaded decision HTML retains its embedded styles and requires no adjacent stylesheet. In the same original receiving course, inspect the populated editor and lifecycle results at desktop and 390 pixels, then open the saved offline HTML independently and confirm both remain styled. Preserve current quantity-estimate and other Economic contributions when composing shared files.

Carry CURRENT_OWNER_DIRECTION.md version 2026-10-13.4 and the current 52-order post-call campaign ECO-POSTCALL-20261013 into the existing native receiver. Preserve active processes, original completed projects, cost-worksheet ownership and all operator extensions.

Operate this exact source in the populated scientific Workspace. Inspect the Economic desk and downloaded offline edition at the actual presentation width and 390 pixels. Enter a real sourced schedule, preview it, change a factor/cashflow, save, reopen, export and cold-reopen the downloaded package. Use the fields, error states, tables and unchanged annual comparison. View actual screenshots and every outgoing attachment as a recipient would. Repair observed defects. Source review alone does not establish product readiness; keep focused validation and disabled GitHub Actions.

The current primary product mandate is to let the scientist run his own data through the original application: open original files, review the actual fields/units/periods, choose scientific settings, run, inspect readable results and save/export/reopen. This lifecycle editor uses ordinary labeled forms and computed tables; JSON remains an optional export. Preserve client labels and source organization in the existing intake and keep incoming client data in the original appropriate secure storage, outside public source Git. The same workflow can receive the completed outputs from those real client sources when available.

Tim/Michael relationship work stays in its existing internal Slack case. Bryce selects the candidate and authorizes the exact onward send.
