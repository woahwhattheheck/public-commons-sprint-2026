# Source and reuse notices

## Application code

The application code and its original documentation use the accompanying MIT license. `source_intake.py` reuses the original repository's NEKCV CSV/JSON/XLSX intake module unchanged. Its SHA-256 at this integration is `ba4de76acc4867e0a5f17dd1bfedb6d9e9ab48e2a71216d4cfc9df113e9b6684`. `intake.py` adds the airport-specific mapping; `engine.py` contains the airport assessment calculations. Persistence, request replay and private continuation reuse the existing PLAN workspace pattern.

## Public reference materials

`demo/sources/source_manifest.json` is the explicit public reference inventory. Each of its sixteen entries retains its original filename, byte length and SHA-256, with an original source URL or a named derivation. The manifest is itself retained as the seventeenth source attachment. The two saved example JSON documents identify public context and separately authored planning inputs.

The package includes first-party reference material from the Transportation Research Board / National Academies, the Federal Aviation Administration, Denver International Airport, Syracuse Regional Airport Authority and Westchester County Airport. Publisher text, graphics, trademarks and data retain their existing rights and notices. The application MIT license does not relicense those publications. The references identify their source and do not imply participation, sponsorship, approval or endorsement.

- [ACRP 03-88 project statement](https://rip.trb.org/View/2772553)
- [ACRP implementation memorandum template](https://onlinepubs.trb.org/onlinepubs/acrp/ACRP_Implementation_TechMemo_Template_2019.pdf)
- [FAA passenger boarding data](https://www.faa.gov/airports/planning_capacity/passenger_allcargo_stats/passenger)
- [FAA airport categories](https://www.faa.gov/airports/planning_capacity/categories)
- [DEN public governance context](https://www.flydenver.com/business-and-community/procurement/real-estate/districts-at-den/)
- [SYR public governance context](https://syrairport.org/about-us/)
- [HPN public governance context](https://airport.westchestercountyny.gov/general-information/overview)

The extracted text and structured records preserve derivation links to the retained original publications. The application does not recast extraction results as independently observed airport data. Original publisher footer rows and classifications remain available for review.

## Authored planning material

The opportunity templates and separate calculator/workflow example are authored demonstrator inputs. Their scenario costs, staff capacity, observations, decisions and claimed example effects do not describe actual airport operations. They remain labelled in project names, basis fields and limitations.

## Package boundary

The installable package contains the application, its industrial interface, the two public/authored seed documents, the explicit public source inventory and these notices. It excludes commercial proposals, prospective-partner research, contact histories, private workspaces, credentials and coordination records. Final research-tool materials remain generic, consistent with the original project statement's Special Note D.
