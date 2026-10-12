// MIT. Page-referenced methods index for the original publicly hosted protocol.
export const STUDY_PROTOCOL_METHODS = {
  "schema": "sf88-study-protocol-methods/v1",
  "studyId": "NCT03529110",
  "sourceUrl": "https://cdn.clinicaltrials.gov/large-docs/10/NCT03529110/Prot_SAP_001.pdf",
  "document": {
    "protocolId": "DS8201-A-U302",
    "version": "6.0",
    "versionDate": "2020-09-25",
    "versionText": "25 Sep 2020",
    "pdfPages": 117,
    "registeredFilename": "Prot_SAP_001.pdf",
    "registeredBytes": 1599281
  },
  "observations": [
    {
      "id": "allocation",
      "title": "Allocation",
      "pdfPage": 48,
      "section": "5.1.2",
      "anchors": [
        "IXRS",
        "pertuzumab"
      ],
      "fact": "Allocation is 1:1 through IXRS, stratified by hormone-receptor status, prior pertuzumab and visceral-disease history."
    },
    {
      "id": "masking",
      "title": "Masking",
      "pdfPage": 48,
      "section": "5.1.2",
      "anchors": [
        "BICR"
      ],
      "fact": "Treatment is open-label; central review assesses the primary endpoint."
    },
    {
      "id": "pfs-censoring",
      "title": "PFS censoring",
      "pdfPage": 75,
      "section": "7.1.1",
      "anchors": [
        "censoring",
        "SAP"
      ],
      "fact": "Progression-free survivors are censored at their last evaluable tumor assessment; detailed censoring rules are delegated to the SAP."
    },
    {
      "id": "fas",
      "title": "Efficacy population",
      "pdfPage": 94,
      "section": "11.2.1",
      "anchors": [
        "FAS"
      ],
      "fact": "FAS uses all randomized participants with assigned treatment and strata."
    },
    {
      "id": "safety",
      "title": "Safety population",
      "pdfPage": 94,
      "section": "11.2.2",
      "anchors": [
        "Safety"
      ],
      "fact": "Safety requires dosing and uses treatment received."
    },
    {
      "id": "pps",
      "title": "Protocol population",
      "pdfPage": 95,
      "section": "11.2.3",
      "anchors": [
        "PPS"
      ],
      "fact": "PPS requires dosing and excludes SAP-defined major deviations."
    },
    {
      "id": "pfs-analysis",
      "title": "PFS analysis",
      "pdfPage": 95,
      "section": "11.4.1.1",
      "anchors": [
        "log-rank",
        "Haybittle"
      ],
      "fact": "BICR PFS uses stratified log-rank testing; the Haybittle–Peto design plans 234/335 events."
    },
    {
      "id": "os-analysis",
      "title": "OS analysis",
      "pdfPage": 96,
      "section": "11.4.1.2",
      "anchors": [
        "Lan-DeMets"
      ],
      "fact": "OS testing requires significant PFS, using Lan–DeMets/O’Brien–Fleming spending."
    },
    {
      "id": "sap-detail",
      "title": "Detailed analysis",
      "pdfPage": 97,
      "section": "11.4.1.2",
      "anchors": [
        "SAP"
      ],
      "fact": "Detailed response-duration censoring is deferred to the SAP."
    },
    {
      "id": "boundary-recalculation",
      "title": "Boundary recalculation",
      "pdfPage": 103,
      "section": "11.5 / Table 11.1",
      "anchors": [
        "0.000204",
        "0.049998"
      ],
      "fact": "Nominal boundaries depend on actual event counts and previously spent alpha."
    }
  ],
  "plannedBoundaries": {
    "pdfPage": 103,
    "section": "11.5 / Table 11.1",
    "sidedness": "two-sided",
    "rows": [
      {
        "endpoint": "PFS",
        "look": "interim",
        "events": 234,
        "pValue": "0.000204",
        "hazardRatio": "0.615"
      },
      {
        "endpoint": "PFS",
        "look": "final",
        "events": 335,
        "pValue": "0.049998",
        "hazardRatio": "0.807"
      },
      {
        "endpoint": "OS",
        "look": "interim 1",
        "events": 96,
        "pValue": "0.001",
        "hazardRatio": "0.496"
      },
      {
        "endpoint": "OS",
        "look": "interim 2",
        "events": 153,
        "pValue": "0.008",
        "hazardRatio": "0.652"
      },
      {
        "endpoint": "OS",
        "look": "final",
        "events": 250,
        "pValue": "0.047",
        "hazardRatio": "0.778"
      }
    ]
  },
  "use": "Planned protocol methods; the existing appraisal workflow owns reviewed assessments."
};
