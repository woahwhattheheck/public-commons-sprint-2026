# Disclosure batch input contract
## Working agreement for the first portfolio

**Client/portfolio label:**  
**Technical contact:**  
**Named disclosure reviewer:**  
**Target installation environment:**  
**Agreed start:**  

## 1. Original document variants
Provide one representative original file for each agreed variant. Keep the file in its native XML encoding.

| Variant | Document role | Protocol or Results schema | Full or partial input | Originating system |
|---|---|---|---|---|
| A |  |  |  |  |
| B |  |  |  |  |
| C |  |  |  |  |

For each file, identify the client reference, source system, document date/version, document role and intended portfolio. The receiving manifest can link several client references to the same exact file; each reference keeps its own review history.

## 2. Identity and prior-document rules
State the authoritative identifier used by the source system. Provide the expected prior/base document for partial updates. Specify how protocol IDs, organization IDs, result groups and other repeated records are related.

Public-registry links are explicit entries containing a capture ID, NCT ID, original study SHA256 and a reason for the link. The operator validates that the selected retained public study exists. Filenames and similar titles provide context; the declared identifier relationship controls the comparison.

## 3. Review scope
Choose up to twelve comparison fields for the initial adaptation. For repeated records, state the correlation key or reviewed record links. Examples include participant groups, outcome measures, intervention arms and sites.

| Field or repeated record | Authoritative source | Matching rule | Expected handling of missing values | Reviewer |
|---|---|---|---|---|
|  |  |  |  |  |
|  |  |  |  |  |
|  |  |  |  |  |

Define the preparation dispositions:
- **Ready:** the named reviewer selects this document for the agreed preparation scope.
- **Follow-up:** retain the document with the question or finding that needs resolution.
- **Exclude:** retain the client reference and its reason for exclusion from the selected scope.

Current schema or unresolved composition findings remain visible and prevent an incompatible ready selection. A changed source or selected candidate requires a current-context review; earlier decisions remain in its history.

## 4. Customer receiving
Choose one environment and two receiving operators. Confirm the installed command, Python runtime and current PRS schema dependency. Confirm the destination for the batch register, exceptions, source/candidate XML, review records and portable workspace.

The acceptance sample should include at least one full protocol, one results or partial update, one duplicate input referenced by two client keys, one changed candidate and one follow-up disposition. This establishes the real workflow that the implementation must support.

## 5. Acceptance and correction
Agree the representative inputs and expected handling during the receiving-contract phase. Deliver review feedback as one consolidated list tied to client reference, selected source/candidate and expected behavior. Two correction rounds are included in the proposed workshare.

## 6. Technical capacity
The current operator accepts up to 1,000 client references in a batch, up to 64 MiB per XML file and 256 MiB across distinct input files. Batch review metadata and portable manifests each have a 16 MiB ceiling. The proposed first adaptation covers up to 500 original XML documents across the three agreed variants. Source and receiving limits are checked before a declared artifact is accepted or exported.
