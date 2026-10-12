# Original eLTSS source and licences

The workbench's Python and JavaScript integration source is MIT, under the repository licence.
It composes the existing SF30 dataset engine/versioned seller and original SF88 buyer;
their maintained licences continue to apply.

**Needs expert review:** Source-selected field mappings and clinical terminology are reviewed through the workbench’s retained field-review and scoped decision records.

## HL7 originals

The complete original publication example is retained at
`examples/Bundle-2039212f3fa5406bb4ffd4a.json`.
Its source is https://hl7.org/fhir/us/eltss/STU2/Bundle-2039212f3fa5406bb4ffd4a.json,
publication hl7.fhir.us.eltss 2.0.0, STU2, FHIR 4.0.1.
The exact 128,055 bytes (including original CRLF) have SHA256
`b1bfe61134b7f18c8d8831b9d253f64df7d37e8bb4e457a00ab472e0aa1b4de2`.
The Bundle contains 39 original resources, including two CarePlans; its source identity
is independent of any later operator-authored review or correction.

The exact original mapping XML is retained at
`examples/eLTSS_to_FHIR_R4_element.xml` from
https://github.com/HL7/eLTSS/blob/2d9df1050811f551f6f6dfad180906869e989d20/input/pagecontent/eLTSS_to_FHIR_R4_element.xml.
Its SHA256 is `9470e52559d3f20d23d2d21888f6544d7e93101c31975e6e570715c0f56a1f92`.
All 56 original mapping rows and the 52 accessory source rows remain in
`field-profile.json`, with ordered source cells, row hashes and exact locators.
Default selectors are labelled operator-review drafts derived from the original mapping
and published example. Older narrative terminology references remain as published;
selecting a current endpoint or profile does not rewrite them.

`examples/HL7_LICENSE.txt` preserves the original repository notice verbatim:

> Copyright (c) 2017, HL7
>
> This document is licensed under the terms of HL7's FHIR license.
> http://hl7.org/fhir/license.html
>
> Creative Commons "No Rights Reserved" (CC0)

FHIR's applicable trademark and third-party terminology notices remain with their respective
publishers. This workbench preserves original codes and lexical values; a source-field
observation or authored applicability choice does not replace an original terminology or
profile validation result.

## Optional complete computable definitions

The native receiving command can additionally retain the unchanged archive at
https://hl7.org/fhir/us/eltss/STU2/definitions.json.zip with `--definitions-zip`.
It records the actual archive and every complete member's byte count and SHA256,
and preserves the archive as an original workspace artifact.
The published instance `$all-eltss-careplan` operation is draft and experimental.
Use a selected endpoint's retained CapabilityStatement to choose its supported operation,
ordinary REST reads/searches, or an explicitly supplied complete Bundle.
