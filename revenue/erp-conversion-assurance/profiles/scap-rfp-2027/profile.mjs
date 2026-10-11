// MIT. Selectable conversion cohorts; the operator supplies actual export mappings.
export const SCAP_PROFILE = {
  "id": "scap-rfp-2027",
  "title": "SCAP conversion workspace",
  "source": {
    "url": "https://scapnc.org/wp-content/uploads/2026/10/REQUEST-FOR-PROPOSALS-Accounting-Software.pdf",
    "label": "SCAP RFP 2027 — issued October 5, 2026",
    "sections": [
      "18",
      "25",
      "31"
    ]
  },
  "cohorts": [
    {
      "id": "chart_accounts",
      "title": "Account structure",
      "purpose": "Match the selected account catalog across fund and grant codes, including renamed codes and text changes.",
      "keys": [
        "fund",
        "grant",
        "account"
      ],
      "amounts": [],
      "attributes": [
        "name",
        "account_type",
        "status"
      ],
      "groupBy": [
        "fund",
        "grant"
      ]
    },
    {
      "id": "gl_history",
      "title": "Ledger history",
      "purpose": "Reconcile the agreed journal-line grain and accounting dimensions with exact debit and credit differences.",
      "keys": [
        "fund",
        "grant",
        "account",
        "fiscal_year",
        "period",
        "journal",
        "line"
      ],
      "amounts": [
        {
          "name": "debit",
          "scale": 2,
          "tolerance": "0.00"
        },
        {
          "name": "credit",
          "scale": 2,
          "tolerance": "0.00"
        }
      ],
      "attributes": [
        "posting_date"
      ],
      "groupBy": [
        "fund",
        "grant",
        "fiscal_year",
        "period"
      ]
    },
    {
      "id": "vendors",
      "title": "Supplier records",
      "purpose": "Retain each supplier identity and compare the selected name and status fields.",
      "keys": [
        "vendor"
      ],
      "amounts": [],
      "attributes": [
        "name",
        "status"
      ],
      "groupBy": []
    },
    {
      "id": "funders",
      "title": "Customer and funding records",
      "purpose": "Retain each customer or funding-party identity and compare the selected classification and status.",
      "keys": [
        "party"
      ],
      "amounts": [],
      "attributes": [
        "name",
        "party_type",
        "status"
      ],
      "groupBy": []
    },
    {
      "id": "employee_master",
      "title": "Staff records",
      "purpose": "Compare stable employee identities and selected organizational assignments before payroll trials.",
      "keys": [
        "employee"
      ],
      "amounts": [],
      "attributes": [
        "department",
        "position",
        "status"
      ],
      "groupBy": []
    },
    {
      "id": "payroll_history",
      "title": "Payroll history",
      "purpose": "Reconcile the agreed employee/pay-run line grain and original monetary fields.",
      "keys": [
        "employee",
        "pay_run",
        "pay_line"
      ],
      "amounts": [
        {
          "name": "gross",
          "scale": 2,
          "tolerance": "0.00"
        },
        {
          "name": "withheld",
          "scale": 2,
          "tolerance": "0.00"
        },
        {
          "name": "net",
          "scale": 2,
          "tolerance": "0.00"
        }
      ],
      "attributes": [],
      "groupBy": [
        "pay_run"
      ]
    },
    {
      "id": "payroll_allocations",
      "title": "Labor distributions",
      "purpose": "Compare each actual allocation line by employee and run, including its fund, grant and program dimensions.",
      "keys": [
        "employee",
        "pay_run",
        "allocation",
        "fund",
        "grant",
        "program"
      ],
      "amounts": [
        {
          "name": "earnings",
          "scale": 2,
          "tolerance": "0.00"
        },
        {
          "name": "hours",
          "scale": 4,
          "tolerance": "0.0000"
        }
      ],
      "attributes": [],
      "groupBy": [
        "fund",
        "grant",
        "program",
        "pay_run"
      ]
    },
    {
      "id": "fixed_assets",
      "title": "Asset register",
      "purpose": "Compare each asset's selected funding assignment, descriptive fields and agreed cost/depreciation measures.",
      "keys": [
        "asset",
        "fund",
        "grant"
      ],
      "amounts": [
        {
          "name": "acquisition_cost",
          "scale": 2,
          "tolerance": "0.00"
        },
        {
          "name": "accumulated_depreciation",
          "scale": 2,
          "tolerance": "0.00"
        },
        {
          "name": "book_value",
          "scale": 2,
          "tolerance": "0.00"
        }
      ],
      "attributes": [
        "name",
        "acquisition_date",
        "status"
      ],
      "groupBy": [
        "fund",
        "grant"
      ]
    },
    {
      "id": "grant_programs",
      "title": "Award and program structure",
      "purpose": "Retain the selected fund, award and program relationships with their original period and status fields.",
      "keys": [
        "fund",
        "grant",
        "program"
      ],
      "amounts": [],
      "attributes": [
        "name",
        "award_start",
        "award_end",
        "status"
      ],
      "groupBy": [
        "fund",
        "grant"
      ]
    }
  ],
  "scenarios": [
    {
      "id": "fund_conversion",
      "title": "Grant and fund conversion",
      "cohorts": [
        "chart_accounts",
        "grant_programs",
        "gl_history"
      ]
    },
    {
      "id": "payroll_conversion",
      "title": "Payroll and labor allocation",
      "cohorts": [
        "employee_master",
        "payroll_history",
        "payroll_allocations"
      ]
    },
    {
      "id": "party_conversion",
      "title": "Supplier and funder continuity",
      "cohorts": [
        "vendors",
        "funders",
        "gl_history"
      ]
    },
    {
      "id": "asset_conversion",
      "title": "Fixed asset conversion",
      "cohorts": [
        "fixed_assets",
        "chart_accounts"
      ]
    }
  ]
};
