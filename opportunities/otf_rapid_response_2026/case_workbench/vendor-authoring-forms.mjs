/* MIT. Complete nine-section forms for the maintained OTF vendor schema. */
export const VENDOR_SECTIONS = [
  {
    "id": "applicant",
    "title": "1. Applicant, expertise and personnel",
    "description": "Identify the applicant and actual assigned people. Keep original biography evidence alongside any outward evidence link.",
    "fields": [
      {
        "name": "applicant",
        "label": "Applicant",
        "type": "object",
        "fields": [
          {
            "name": "name",
            "label": "Legal / trading name",
            "type": "text"
          },
          {
            "name": "description",
            "label": "Background and technical expertise",
            "type": "textarea"
          },
          {
            "name": "policyContact",
            "label": "Policy and contracting contact",
            "type": "text"
          }
        ]
      },
      {
        "name": "contact",
        "label": "Proposal contact",
        "type": "object",
        "fields": [
          {
            "name": "replyOwner",
            "label": "Reply owner",
            "type": "text"
          },
          {
            "name": "email",
            "label": "Email",
            "type": "text"
          },
          {
            "name": "phone",
            "label": "Phone",
            "type": "text",
            "optional": true
          }
        ]
      },
      {
        "name": "team",
        "label": "Assigned personnel",
        "type": "array",
        "fields": [
          {
            "name": "name",
            "label": "Name",
            "type": "text"
          },
          {
            "name": "role",
            "label": "Assigned role",
            "type": "text"
          },
          {
            "name": "bio",
            "label": "Relevant biography",
            "type": "textarea"
          },
          {
            "name": "cvEvidence",
            "label": "Original CV / biography evidence",
            "type": "text"
          },
          {
            "name": "cvPublicEvidence",
            "label": "Outward CV link or attachment:filename (optional)",
            "type": "text",
            "optional": true
          }
        ]
      }
    ]
  },
  {
    "id": "services",
    "title": "2. Requested services and budget",
    "description": "Choose offered services and up to five fully loaded labor categories. Amounts are USD. Leave unknown amounts blank; enter zero only for a real zero direct-cost amount.",
    "fields": [
      {
        "name": "services",
        "label": "Primary services",
        "type": "array",
        "fields": [
          {
            "name": "category",
            "label": "Service",
            "type": "select",
            "options": [
              "organizational-security",
              "digital-attacks",
              "web-hosting",
              "censorship-response",
              "localization"
            ]
          },
          {
            "name": "offering",
            "label": "Offering and scope",
            "type": "textarea"
          },
          {
            "name": "method",
            "label": "Delivery method",
            "type": "textarea"
          }
        ]
      },
      {
        "name": "laborRates",
        "label": "Loaded labor categories",
        "type": "array",
        "maxItems": 5,
        "fields": [
          {
            "name": "id",
            "label": "Stable role ID (optional)",
            "type": "text",
            "optional": true
          },
          {
            "name": "title",
            "label": "Labor category",
            "type": "text"
          },
          {
            "name": "loadedHourlyCents",
            "label": "Loaded USD / hour",
            "type": "money",
            "nullable": true
          },
          {
            "name": "commercialHourlyCents",
            "label": "Standard commercial USD / hour (optional)",
            "type": "money",
            "optional": true
          }
        ]
      },
      {
        "name": "budget",
        "label": "Original issuer budget",
        "type": "object",
        "fields": [
          {
            "name": "requestedContractCeilingCents",
            "label": "Requested contract ceiling USD (maximum 150,000)",
            "type": "money",
            "nullable": true
          },
          {
            "name": "otherDirectCostsCategory",
            "label": "Other direct-cost category",
            "type": "text"
          },
          {
            "name": "otherDirectCostsCents",
            "label": "Other direct costs USD",
            "type": "money",
            "nullable": true
          }
        ]
      }
    ]
  },
  {
    "id": "support",
    "title": "3. Required support services",
    "description": "Describe all four support services, including how written case approval and completed-case reporting work.",
    "fields": [
      {
        "name": "supportServices",
        "label": "Support methods",
        "type": "object",
        "fields": [
          {
            "name": "assessment",
            "label": "Assessment and case work-order request",
            "type": "textarea"
          },
          {
            "name": "coordination",
            "label": "Client, OTF and partner coordination",
            "type": "textarea"
          },
          {
            "name": "outreach",
            "label": "Community outreach",
            "type": "textarea"
          },
          {
            "name": "reporting",
            "label": "Completion reports and invoicing",
            "type": "textarea"
          }
        ]
      }
    ]
  },
  {
    "id": "qualifications",
    "title": "4. Relevant qualifications",
    "description": "Use actual experience, staffing capacity, response arrangements and sensitive-data practices.",
    "fields": [
      {
        "name": "qualifications",
        "label": "Qualifications",
        "type": "object",
        "fields": [
          {
            "name": "community",
            "label": "Community, prior work and geographies",
            "type": "textarea"
          },
          {
            "name": "outreach",
            "label": "Promotion and outreach strategy",
            "type": "textarea"
          },
          {
            "name": "capacity",
            "label": "Cases / hours per month and assigned staffing",
            "type": "textarea"
          },
          {
            "name": "response",
            "label": "Methodology, availability, channels and triage",
            "type": "textarea"
          },
          {
            "name": "governance",
            "label": "Governance, privacy and sensitive data",
            "type": "textarea"
          }
        ]
      }
    ]
  },
  {
    "id": "work",
    "title": "5. Prior technical work",
    "description": "Describe completed work accurately. Preserve its original evidence and choose an outward link for the proposal edition.",
    "fields": [
      {
        "name": "workExamples",
        "label": "Technical examples",
        "type": "array",
        "fields": [
          {
            "name": "title",
            "label": "Example title",
            "type": "text"
          },
          {
            "name": "work",
            "label": "Actual work and result",
            "type": "textarea"
          },
          {
            "name": "evidence",
            "label": "Original evidence / custody",
            "type": "text"
          },
          {
            "name": "publicEvidence",
            "label": "Outward evidence link or attachment:filename (optional)",
            "type": "text",
            "optional": true
          },
          {
            "name": "disclosureApproved",
            "label": "Disclosure permission confirmed",
            "type": "boolean"
          }
        ]
      }
    ]
  },
  {
    "id": "languages",
    "title": "6. Languages other than English",
    "description": "Give the actual languages and level, or enter none when accurate.",
    "fields": [
      {
        "name": "languagesOtherThanEnglish",
        "label": "Languages",
        "type": "textarea"
      }
    ]
  },
  {
    "id": "other",
    "title": "7. Other relevant services",
    "description": "Describe additional services, or enter none when accurate.",
    "fields": [
      {
        "name": "otherServices",
        "label": "Other services",
        "type": "textarea"
      }
    ]
  },
  {
    "id": "restrictions",
    "title": "8. Proposal data restrictions",
    "description": "State restrictions on the issuer's use of this proposal, or enter none when accurate.",
    "fields": [
      {
        "name": "proposalDataRestrictions",
        "label": "Data restrictions",
        "type": "textarea"
      }
    ]
  },
  {
    "id": "appendix",
    "title": "9. Appendix A and eligibility",
    "description": "Record the authorized signatory's actual determinations against the original 2026 Appendix A.",
    "fields": [
      {
        "name": "attestations",
        "label": "Eligibility and Appendix A",
        "type": "object",
        "fields": [
          {
            "name": "authorizedSignatory",
            "label": "Authorized signatory",
            "type": "text"
          },
          {
            "name": "appendixAReviewedFrom",
            "label": "Original Appendix A source reviewed",
            "type": "text"
          },
          {
            "name": "noSurveillanceBusiness",
            "label": "Applicant and affiliates are not engaged in surveillance-technology trade",
            "type": "boolean"
          },
          {
            "name": "noExclusion",
            "label": "Applicant and affiliates are not sanctioned, debarred or excluded",
            "type": "boolean"
          },
          {
            "name": "remitFits",
            "label": "Proposed work fits OTF remit 2(b)",
            "type": "boolean"
          },
          {
            "name": "independentAudits",
            "label": "No relationship compromises independent impartial audits",
            "type": "boolean"
          },
          {
            "name": "acceptsAppendixA",
            "label": "Authorized signatory accepts the original Appendix A provisions",
            "type": "boolean"
          }
        ]
      }
    ]
  }
];
