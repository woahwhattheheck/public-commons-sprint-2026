# Original supplier example and exchange schema

These files preserve the publisher's ETIM10 example and the corresponding XML schema from [ETIM BMEcat Guideline V5.0.2, dated 2024-12-12](https://www.etim-international.com/wp-content/uploads/2021/09/ETIM-BMEcat-Guideline-V5-0-2-2024-12-12.zip). The archive contains 3,242,056 bytes; its SHA-256 is aa0fdcfae703005eeeebfe542f877b4167c4e4b04594f2095fc105364d224de4.

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| SampleFile_bmecat_etim_V5_T_NEW_CATALOG_ETIM10.xml | 18,076 | 50568f0357c982a853eaf523475d18d6f2a594d0c8a392143a4df50007cddf8e |
| bmecat_etim_501.xsd | 99,041 | 821e4dbcec9fa32b64df4298531adc5d3cdab68507686317dd08e8266378b005 |
| etim10-supplier-products.jsonl | 5,123 | e8903a41da5ddbaef6bbaa9b6a585aef051488400c02ff5538d364bba0f72903 |
| etim10-supplier-profile.json | 1,879 | 87b91d494209ffeff782c473913679632e1c95c5516b57b4e3411ec0e6596020 |
| etim10-source-mapping.json | 71,652 | 6e2e753b5e38094244530c1393304fd004c145523bd8ee2746a7d8f0af700a09 |

The original XML contains the publisher's one ETIM10 product, supplier ID 411061, and 30 original features. Its dates, example parties, product values, two image records and external product relation remain as published. The source profile selects ETIM BMEcat requirements for this example.

The product JSON Lines file and profile are the explicit conversion performed by convert-published-etim10.py. The source mapping records 301 original fields: 203 are represented in the initial supplier conversion; 98 have their original values retained outside that projection. The complete original XML is included here. The native supplier journey also embeds it in its retained material source, so the full original document travels in the portable customer workspace.

The converter was run against the exact original XML and its emitted files are retained unchanged. See its command-line interface for paths. The [native delivery journey](../../receiving/supplier-delivery-journey.mjs) checks the four execution input hashes before opening the workspace and validates the generated XML with this original schema.

## Sonepar's separate receiving requirements

The additional target follows [Sonepar Product Data Guidelines, April 2026, release 3.1](https://www.sonepar.com/resource/blob/85322/d6950a910363f19c4fdc060017186082/sonepar-product-data-guidelines-data.pdf), identifier PDx_2026.04_3.1. The original PDF contains 13,672,702 bytes; its SHA-256 is 63dd77f1ac6688d54db171fd8f2fe4852207fede1bfa6978fe7a2ea5d524e65d.

The [branch-role clarification](sonepar-branch-roles.json) records the distinction between product branch numbers and supplier branch identifiers, including Sonepar's inconsistent printed XML label. Both actual roles remain separate in the product model and ETIM output.

The pure profile module retains exact source identities and source references for its field rules. Choose the customer's actual receiving targets and profile before preparing another delivery.
