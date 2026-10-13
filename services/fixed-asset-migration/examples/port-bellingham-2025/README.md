# Port of Bellingham published capital reference

This complete reference contains the issuer's actual 2025 capital-class table and original six-domain asset/book/balance CSV inputs. Use the Source files screen to import the three CSVs as **source** and map their exact headers. Download and retain published-capital.json with Exit files. The original finance engine will show the available class balances and the missing actual event, journal, control and returned-target populations explicitly.

The source is the [2025 ACFR](https://portofbellingham.com/Archive.aspx?ADID=1301), Note4 printed page43 (physical49 of103), issued26June2026. Amounts are whole USD, with multiplier1. The local company/book/class keys identify this published-reference scope. They do not identify private tenant records. All12 class/measure rows, four printed totals, opening/increase/decrease/closing values and three source discrepancies are retained in JSON. Annual movements remain annual summary columns; no artificial transaction dates or journals are created.

The separate statement of net position differs from Note4 by +USD1 for buildings and −USD1 for improvements. Its depreciation/amortization expense is USD1 below the Note4 movement total. Keep these displayed as source reconciliation items. Never silently round the source or call the aggregate reference a completed customer migration.

Note1 printed34–35 defines the capital thresholds and straight-line policy. Normal maintenance is expensed. The complete work-order workflow therefore keeps maintenance cost allocation separate from financial capitalization and FA/GL reconciliation; actual authorized exports determine that joining work.

For a real installation, receive complete original asset/book/FA/GL/event/control exports and the actual returned target files into their own workspace identity. Keep the published class reference as a separate selected source scope.
