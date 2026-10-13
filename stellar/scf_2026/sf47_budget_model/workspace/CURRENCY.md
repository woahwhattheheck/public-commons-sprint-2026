# Original currencies in operating forecasts

Keep the original currency of each customer quote and delivery estimate through Forecast, Portfolio, saved records and complete receiving. Choose an explicit retained exchange rate when a USD comparison is useful. Payments keep their originally recorded USD values and their separately entered credit against the original quote.

Open **Delivery operations → Operating forecast**. The existing [forecast guide](FORECAST.md) explains the complete planning workflow; [Portfolio](PORTFOLIO.md) explains allocation, release dates and selecting dates back into Forecast.

## Enter the original quote and its rates

1. Under **Original currencies and rate sources**, select **Add exchange-rate source**. Retain its identity, base and quote currencies, exact decimal rate, observation date, publication date when known, source basis and USD cent rounding.
2. In the customer scenario, choose **Native currency amounts with explicit valuation** under **Quote and delivery-cost entry**. Enter the original price, its currency and the selected rate. Enter the customer-specific delivery estimate separately; it can use a different currency and rate.
3. Enter milestone amounts in the original quoted currency. Their sum must equal the original price exactly. Preserve the original offer identity, stage, scope, source attachments, remaining hours and collection conditions.
4. Select the original observed customer receipts, delivery invoices and direct expenses. For a foreign-currency quote or estimate, enter the credited native amount and allocation basis beside every selected eligible original record.
5. Preview the complete case. Review original and USD amounts, source age, payment credits, rounding, missing valuation and collection dates. Save the reviewed inputs with the existing version and preview controls.

**Original USD amounts** keeps the existing USD entry form. An existing saved USD forecast reopens in its original mode. Choosing native entry is explicit; typed figures are not silently treated as a different currency.

A foreign amount can be retained with no selected rate. Its USD valuation is then **Unvalued**. You can finish the scope, hours and scheduling decisions while retaining the unresolved financial inputs in the same product.

## Read the rate direction

Every retained rate means **one unit of base currency equals the entered number of quote-currency units**. Exactly one side must be USD.

| Retained source | Original amount | Calculation before USD rounding |
| --- | --- | --- |
| Base USD, quote ZAR, rate 16.6685 | ZAR 1,000 | 1,000 ÷ 16.6685 |
| Base ZAR, quote USD, rate 0.06 | ZAR 1,000 | 1,000 × 0.06 |
| Original currency USD | USD 40.00 | Original USD 40.00 |

Price and delivery cost select their rates independently. A selected rate must connect that amount's exact currency with USD. Conversion is direct; no cross-currency path is inferred.

Keep original amounts and rates as JSON decimal strings. Foreign amounts preserve up to eight decimal places; USD inputs use two. Rates preserve up to eighteen decimal places. The retained rate selects **Half up** or **Half even** for USD cents. Saved inputs preserve the selected original rate rather than downloading a replacement when reopened.

## Keep the source and date meaningful

Choose **Published reference observation** for a retained original observation. Supply its original URL or an attachment already present in the case, and identify the publication, table or quotation in the reference field. Choose **Explicit planning assumption** for an entered scenario rate and retain the assumption in its note.

The observation date must be on or before the forecast as-of date. If a publication date is supplied, it must be on or after the observation and on or before the as-of date. A historical rate remains a dated input; the report displays its age. The application does not turn a retained observation into a current settlement quotation.

The loadable [complete example](examples/native-currency-forecast.json) retains the Federal Reserve H.10 observation of **16.6685 ZAR per USD on October 2, 2026**, published October 5. Original references are the [October 5 H.10 release](https://www.federalreserve.gov/releases/h10/20261005/), [FRED DEXSFUS](https://fred.stlouisfed.org/series/DEXSFUS) and the [H.10 publication schedule](https://www.federalreserve.gov/releases/h10/default.htm). The example is a generic ZAR 1,000 quote and USD 40 delivery estimate; replace its commercial inputs and terms with the actual retained opportunity.

## Credit original payments and expenses

An original USD cash record tells the forecast how much USD was actually recorded. A foreign quote additionally needs the number of quoted units that this receipt paid. Enter that amount once under **Credit in quoted currency**, with its original allocation basis.

For example, suppose the retained quote is ZAR 1,000 and an original USD customer receipt paid ZAR 300 of that quote. Enter the selected original cash ID and a ZAR 300 credit. The remaining quote is ZAR 700. Revising the planning rate changes the USD reference value of those native amounts; it does not change the original recorded USD receipt or its ZAR 300 payment credit.

Credits apply to the original milestones in order. Excess native payment remains visible as an over-credit. Each customer receipt still belongs to at most one selected assignment under the original eligibility rules. The forecast lists original receipts missing a native credit as **unallocated observed USD** and leaves the full outstanding native amount unresolved until those credits are entered.

Apply the same principle to a foreign delivery estimate. Each selected non-void delivery invoice and direct expense needs **Credit in delivery-cost currency** and its allocation basis. The remaining estimate is its original native total less those credits, floored at zero. A native overrun remains visible. The effective USD delivery cost combines the original USD invoices and direct payments with the valued native estimate still to incur. Original unpaid invoices retain their separate due dates.

A USD price or cost uses the original selected USD records automatically. Its native-credit arrays stay empty. Grant-package invoices remain with their original packages; the existing distinct record assignments and observed-cash rules still apply.

## Exact milestone and payment rounding

The forecast converts cumulative native milestone totals, then takes the difference between successive rounded totals. This conserves the USD value of the full original quote.

For the example rate:

| Milestone | Original amount | Cumulative native amount | Cumulative USD | Assigned USD |
| --- | ---: | ---: | ---: | ---: |
| Deposit | ZAR 300 | ZAR 300 | 18.00 | 18.00 |
| Complete delivery | ZAR 400 | ZAR 700 | 42.00 | 24.00 |
| Accepted handover | ZAR 300 | ZAR 1,000 | 59.99 | 17.99 |
| Total | ZAR 1,000 | | | 59.99 |

Converting all three independently would yield USD 60.00. The final milestone's explicit USD −0.01 valuation adjustment keeps the retained total at USD 59.99.

Credited and remaining native milestone amounts each use the same cumulative method. Their independently rounded USD valuations can differ from the quoted allocation by a cent. The export retains this as a signed **settlement rounding** amount alongside the quote, credited valuation and remaining valuation. It is a rounding reconciliation; original observed cash retains its own recorded amount.

## Understand complete and partial comparisons

The report distinguishes complete selected-scope valuation from complete dated cash valuation.

| Result | Meaning |
| --- | --- |
| Complete selected scope | Every selected native project has enough rate and native-credit information to value its remaining scope. |
| Complete dated cash | Every selected native amount currently assigned to the dated cash curve can be valued. An undated amount remains in its separate date decision. |
| Valued portion | The known original and forecast cash retained when other selected money is unresolved. It is shown with its partial-coverage explanation. |
| Unresolved project | The report identifies the missing price rate, cost rate, receipt credit or expense credit in that project's original input. |

When dated cash valuation is incomplete, the full commercial cash metrics and full commercial daily balances remain unvalued. The dated table still shows known inflows, known outflows and the explicitly labeled valued portion. Existing spending and conditional grant calculations keep their original source inputs.

The Portfolio allocator retains the full task and its original hours even when a currency decision is unfinished. A workable alternative can be operationally ready and can provide dates back to Forecast. A financial frontier or comparison requires both complete selected-scope valuation and complete dated cash valuation. An alternative without that coverage carries the specific reason; comparisons with the baseline also require a complete baseline.

## Keep event-dependent terms through allocation

A quote can remain undated while its original deposit, access or other start condition is unresolved. Keep both work dates empty together, retain the business-day delivery window and one original collection condition per milestone. The native quote and delivery estimate stay in the complete scope; undated amounts and hours remain outside the dated curves until their dates are chosen.

Portfolio retains the original release condition and reviewed release date, uses the selected working calendar for the promised deadline, and preserves every currency input, rate, payment credit and receipt when a ready alternative supplies work dates back to Forecast. Collection dates remain their original separate decisions.

## Complete save, export and reopen

Use the existing preview, save, download and complete-case export actions. Each saved forecast keeps the complete normalized native inputs, retained rates, source snapshot and calculated report under its original immutable saved identity.

A native-currency forecast ZIP adds:

| Member | Contents |
| --- | --- |
| currency-valuation.json | Complete source-aware currency coverage and project valuation |
| retained-exchange-rates.csv | Original rate direction, dates, basis, source and rounding |
| native-commercial-pricing.csv | Original quote and delivery estimate with credit and valuation totals |
| native-commercial-receipts.csv | Original milestones, native credits, remaining amounts and rounding |
| native-record-credits.csv | Original cash/invoice identities and native credit basis |
| known-commercial-cash.csv | The dated valued portion beside full valuation coverage |
| CURRENCY-VALUATION.txt | Interpretation of original units, explicit rate selection and coverage |

The complete JSON and case archive remain the authoritative portable representation, including original attachments. Portfolio exports retain the same currency inputs and explain financial comparison eligibility. Importing the complete case validates and reopens the original saved records through the existing application.

The CLI accepts the complete example with its existing `--inputs` option. Agent clients and Merchant's forecast preview/save tools accept the same object inline or through their original verified input references and `inputPointer`. No separate currency store is required.

## Run the original case through the complete application

Use [the native receiving workflow](examples/NATIVE_CURRENCY_RECEIVING.md) to import an existing complete case, recalculate its retained forecasts and portfolios, review a native quote in the application, and export and reopen the resulting case. The maintained caller and browser continuation use the application's original APIs and saved records. Customer-specific inputs belong in the private configuration described by that guide.
