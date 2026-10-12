# Original Eurostat source

## Production input

- Dataset: **UNE_RT_M**, “Unemployment by sex and age - monthly data”, source **ESTAT**.
- [Complete original response](sources/une_rt_m-2024-2025.original.json).
- Original URL: https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/une_rt_m?lang=EN&freq=M&age=TOTAL&age=Y_LT25&unit=PC_ACT&s_adj=SA&sex=T&sex=F&sex=M&geo=DE&geo=FR&geo=IT&geo=ES&sinceTimePeriod=2024-01&untilTimePeriod=2025-12
- Actual retrieval: **2026-10-12T08:52:51.708Z**.
- Publisher update: **2026-10-08T11:00:00+0200**.
- Complete response: **10,408 bytes**.
- SHA256: **689d5a0a94c358459f5321fd6a2f8c1da8c089f46ae032b27590c6d895ea56cf**.
- Carrier: native public HTTPS attachment import followed by complete literal UTF-8 readback. Original upload ID: **3f7dd772-3100-8194-9b73-00b2621f13f7**.

Capture ID: **d233dffca23950f40743535de9b76b98c3a9c25b0ad0e32610d691e750a09727**.
Capture manifest SHA256: **af85437f27e8a2bb0b2797ed56c4a47a5eda41581bb57cd1acbdf1e67f86f4a0**.

These identities bind the actual source URL, retrieval timestamp and complete response. The ready handover preserves the same original retrieval description.

## Returned dimensions

| Position | Dimension | Actual category order |
| --- | --- | --- |
| 0 | freq | M |
| 1 | s_adj | SA |
| 2 | age | TOTAL, Y_LT25 |
| 3 | unit | PC_ACT |
| 4 | sex | T, M, F |
| 5 | geo | DE, ES, FR, IT |
| 6 | time | 2024-01 through 2025-12 |

Original size **[1,1,2,1,3,4,24]** gives **576 cells**. All have numeric observations. This selected response has no null/absent values and no status member. Other source editions retain these states through separate published fields.

The original unit is “Percentage of population in the labour force”. Adjustment is “Seasonally adjusted data, not calendar adjusted data”. Age labels are “Total” and “Less than 25 years”. These definitions remain in the capture and published fields.

Provider category order differs from the submitted sex/geography order. Index 192 is the original total-age, female, Germany observation for 2024-01 with exact numeric spelling **3.0**.

The OBS_COUNT annotation describes the larger Eurostat dataset and remains metadata. This selected response’s count is computed directly. DOI: [10.2908/UNE_RT_M](https://doi.org/10.2908/UNE_RT_M). The complete response preserves its original ESMS metadata and explanatory-note links.

## Original source discovery

| Original file | Returned state | Bytes | SHA256 |
| --- | --- | --- | --- |
| sources/une_rt_m-empty-age.original.json | Y15-74 produced a zero-sized age dimension and empty selection | 4,455 | c1b3350152df902608e6f32ea796369834b45d1c1820ba4c298c46fa0212a2df |
| sources/une_rt_m-latest-dimensions.original.json | TOTAL, Y_LT25, Y25-74; global latest period 2026-09 with three absent selected Germany values | 3,689 | 7cb510b83165ac6c1029340760e47ed331ee14c92cf22d3c83b57bd27d5daad8 |

The first used the production URL with age=Y15-74 and sex=T. The second used:
https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/une_rt_m?lang=EN&freq=M&unit=PC_ACT&s_adj=SA&sex=T&geo=DE&lastTimePeriod=1

Both files retain their complete actual responses. Their native categories and source states informed the populated production selection.

## Primary contracts and reuse

- [Eurostat Statistics API](https://ec.europa.eu/eurostat/web/user-guides/data-browser/api-data-access/api-detailed-guidelines/api-statistics): dataset endpoint, language, repeated filters, time selection, errors and asynchronous responses.
- [Eurostat data access](https://ec.europa.eu/eurostat/web/user-guides/data-browser/api-data-access/): current dissemination interfaces.
- [JSON-stat specification](https://json-stat.org/format/): dimension/category order, dense/sparse values, cell order, metadata and status.
- [Eurostat reuse notice](https://ec.europa.eu/eurostat/en/help/copyright-notice): statistical reuse, source acknowledgement, third-party/geographic/data-specific conditions and adaptation notice.

Eurostat allows commercial and noncommercial statistical reuse with acknowledgement subject to stated conditions. The included review is specific to this ESTAT unemployment selection and its four EU countries, outside the listed trade exceptions. Original metadata and linked source conditions remain available.

For other data, record its actual source, geographies and relevant conditions. The published notice identifies conditions involving third-party material, non-EU/EFTA/candidate-country data and certain trade statistics. The console requires a source-specific review. Statistical-data reuse and editorial web-content licence wording are separate policies.

The briefing identifies Commons’ selection and presentation, preserves Eurostat attribution and includes the adaptation notice. Its original complete response accompanies all derived outputs.

## Actual generated products

The production model and briefing generator executed against the complete original response. Outputs contain every selected observation and all 24 matching monthly series.

| Artifact | Bytes | SHA256 |
| --- | --- | --- |
| examples/briefing-20261012/briefing.html | 107,672 | ef7176b7223b3674d6f88e4f0e96dc8675e6514cf2c78fc9a566cb5b3fff9a4d |
| examples/briefing-20261012/briefing.json | 415,668 | a1da7cf47d9a42a9d4de0ca7d26835a24ef5880691921235d3a430ab70407eab |
| examples/briefing-20261012/observations.csv | 160,202 | e4a0326aa171efbfe919b1633ee9d5842cebd4fd455a3407a8bddd0a898613f2 |
| examples/briefing-20261012/original-response.json | 10,408 | 689d5a0a94c358459f5321fd6a2f8c1da8c089f46ae032b27590c6d895ea56cf |

Monthly changes use exact decimal integer arithmetic. Each comparison keeps original current/baseline values, flags, matched dimension codes and the actual baseline period.
