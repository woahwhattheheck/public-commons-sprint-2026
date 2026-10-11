# Native contracts and exact format choices

The receiving provider's selected configuration determines the actual import. This application retains the functional published source contracts, exact source identities and operator choices with each local handoff.

## MuniBilling source dictionaries

munibilling-native-contracts.json retains the published field names/types and source references.

| Dictionary | Declared fields | Projection |
| --- | ---: | --- |
| Customer | 64 | Account identity, native Customer ID, Legacy Customer ID, location Account Number, contact/preference and explicit opening balance/cutoff |
| Bills | 61 | Exact customer/service resolution, original period and amount components |
| Payments | 66 | Explicit provider/payment-type mapping, original transaction ID, original payment/return reference |
| Meter readings | 46 | Exact meter identity, start/end timestamps, six-place register values and original billing/estimated flags |
| Backflow devices | 15 | Native device/meter/service identity, active inventory and retained certificate/next-test dates |

The original Customer/Bills tables end with an unnamed type-only partial row. It is not turned into an invented field. Customer account_number is declared by the original overview without a detailed SQL type, so the raw value stays text.

Native Customer ID, Legacy Customer ID, parcel identity and Account Number are different fields. Their matching convention is explicit. Credential and sign-in fields are excluded from operational export presets.

Payments declares both rate_mulitiplier and rate_multiplier; they remain distinct. Native payment reading/consumption decimals use (16,2), while meter readings use (16,6). Bills flat_fee is a Boolean flag, not a monetary base charge.

Primary native implementation and dictionary source:
[MuniBilling implementation workflow](https://www.munibilling.com/success/implementation).
The exact field-page URLs and original table identities are retained in the included JSON contract.

## MuniBilling positional import mappings

munibilling-import-contracts.json contains nine separate selectable profiles. Native positions below are one-based; the internal mapping keys c000, c001, etc. retain the original zero-based position.

| Profile | Fields | Native distinction |
| --- | ---: | --- |
| Published customer PDF | 30 | Customer export; header YES, comma, CRLF, no quoting; Account Number match; separate parcel and customer INSERT/UPDATE/NONE controls |
| Published payment PDF | 11 | Payment staging fields, including payment type, two posted flags/dates and billing type; general format controls blank in the original |
| Published bill PDF | 19 | Bill staging and optional reading fields; duplicate START READ / END READ labels refer to distinct value/date positions |
| Published deposit PDF | 4 | Account, amount, type, date |
| Published credit PDF | 8 | PAYMENT transaction format; no header; includes separate customer-posted date |
| Published debit PDF | 7 | BILL transaction format; no header; no separate customer-posted date |
| Observed customer CSV | 49 | Two duplicate INSERT/UPDATE headers and a blank header at position 16; separate customer/parcel source values |
| Observed file named NEW CUSTOMER PAYMENTS IMPORT.csv | 7 | Exact header is Acct #, Charge, Bill Type, Bill Date, reference, note, POSTED; its file name does not establish transaction semantics |
| Observed deposit CSV | 4 | Account, establish date, amount, type; different order from the four-field deposit PDF |

The actual customer CSV header is kept exactly. Positions 1 and 2 remain separate despite their identical label, and position 16 remains a separate source cell despite its blank header.

The older payment prose names zero-based columns 00, 01, 02, 03 and 05 and leaves 04 unnamed. The application records that distinction and does not manufacture a column-04 field. The separate five-column bill sample has no observed header and is not offered as a guessed positional preset.

Original native import documentation:
[MuniBilling bill/payment/deposit imports](https://jiramb.atlassian.net/wiki/spaces/MKC/pages/261980183).
The included contract retains each individual original attachment URL, byte count and SHA-256 identity.

When a PDF leaves delimiter/header controls blank, select the receiving configuration's actual settings. When the original declares no quoting, values containing a comma, quote or line break need correction or a separately selected receiving format. Customer fields declared only DATE require the original date representation. The deposit date check uses the intended import date and the published fifteen-year window.

For a new handoff, output fields are explicit mappings/constants. Source-linked output metadata records the exact dataset or billing candidate, mapping, date/quote/header/record separator choices and original contract. Posted flags are configured values in the local file.

For a corrected positional source, only reversibly mapped cells change. Original headers, row order, unmodified field text, original quoting, BOM and record separators are preserved. An identity/combined-field change without a native inverse mapping requires the corrected original provider source.

## SmartFusion EZREADER

Primary source: [SmartFusion handheld types](https://learn.smartfusion.io/Page/115/HandheldTypes).

| Feature | Type F | Mueller Type X |
| --- | --- | --- |
| Import record length | 280 ASCII bytes | 618 ASCII bytes |
| Export record length | 280 ASCII bytes | 576 ASCII bytes |
| Import account | 217–228 | 209–228 |
| Export account | 217–228 | 351–370 |
| Import register | 229–238 | 309–318 |
| Export current register | ERT ID occupies 229–243 instead | 171–180 |
| Import date/time | 249–254 / 255–260 | 329–334 / 335–340 |
| Export water/read markers | W at 21; V at 88 | W at 15; M at 160; X at 576 |

The Type X source illustrates twelve zeroes for a ten-position imported register; the implementation preserves the actual ten-byte 309–318 range. Type F's six-digit date and time interpretation is not defined by the retrieved table, so the selected original convention is retained explicitly. Type X declares MMddyy; its two-digit-year window and time convention remain explicit.

Input retains every original byte and record hash. It supports source-selected CRLF, LF or packed fixed-width records and rejects mixed separators, non-ASCII content and a record length mismatch. The full raw file remains attached when an interpretation needs review.

Export uses the exact declared positions, numeric formatting, padding direction, fixed markers and record separators. A value that does not fit is returned for correction, never truncated.

The City's RFI names EZREADER without selecting a variant. Choose the actual predecessor/handheld format used in the workshare.

## Original rates and unresolved source interpretation

[City rates and fees](https://www.ashevillenc.gov/service/rates-fees/) and [high-bill adjustment guidance](https://www.ashevillenc.gov/service/higher-than-expected-bills/) are pinned in billing-rules.json. The indexed first-party page text was recovered while direct page retrieval returned HTTP 403; that source method is retained.

The clean residential 5/8-inch examples use:

| Cycle | Base fee | Single-family rate | Example |
| --- | ---: | ---: | --- |
| Monthly | 7.89 USD | 6.02 USD/ccf | 10 ccf → 68.09 USD |
| Bimonthly | 15.41 USD | 6.02 USD/ccf | 20 ccf → 135.81 USD |

One ccf equals 748 gallons. The full source contains all ten meter base fees, multifamily/irrigation rates and the unresolved commercial/manufacturer threshold boundaries.

The code asks for the implementation's actual threshold interpretation and explicit source overrides. It does not generate an unpublished leak-credit formula, automatic delinquency timing or an assumed stormwater tier at an ambiguous printed boundary.
