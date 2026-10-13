# FVRL staff portal — proposed ThoughtFarmer implementation workshare

**Prepared for ThoughtFarmer's delivery and partnerships team · 12 October 2026**

Token Junkie Labs proposes a **USD 24,000 / 160-hour engineering workshare** to support a ThoughtFarmer-led response to Fort Vancouver Regional Libraries' staff-portal procurement. The engagement covers source and permission discovery, supported platform integrations, a complete configured sandbox, reviewed migration tooling and assistance, the eight scored platform scenarios, training and a reusable operating handover.

The procurement is **FVRL RFP 2026-002**, with proposals due **19 October 2026 at 17:00 Pacific**. The issuer's RFP and Addendum 1 control the final proposal. The prime's actual license, hosting, support and integration quote completes the five-year offer. [1, 2]

## A concrete opportunity for the delivery team

FVRL describes about **300 staff across 16 branches**, roughly 30 departments or roles and 10 audiences. Its intended migration is about **300 selected active CFM/HTML/PDF pages with associated images, documents and forms**. Most of the approximately 30,000-file legacy archive is outside that selected population. FVRL will select, clean and migrate its content; the supplier provides the platform, tools, assistance and training. [1, 2]

ThoughtFarmer's published professional services, native Google Workspace integration and identity options align with this work. This proposed workshare takes on the engineering and content-operation work alongside the prime's supported product and customer relationship. The deliverable includes an independently editable migration workbench, the exact native field and permission mappings, original files and returned platform IDs, and practical operating instructions. [3, 4, 5]

The agreed implementation would operate the **actual configured ThoughtFarmer platform** for the issuer's evaluation. The workbench supports migration and handover; Addendum Q80 requires the proposed platform itself for the scored environment. [2]

## Proposed delivery and acceptance

| Phase | Planned effort | Target window | Acceptance |
| --- | ---: | --- | --- |
| Source and permission discovery | 24 hours | 10–12 December | Selected content population, complete original export, field/hierarchy/owner/audience mappings, responsibilities and native connection contract agreed with the district and prime. |
| Platform, identity and integrations | 56 hours | 14–23 December | The actual tenant has the selected identity flow, Google Workspace integration and agreed core-system integration; content ownership, audiences and lifecycle use supported product configuration. |
| Complete sandbox and eight scenarios | 24 hours | 24–31 December | All required functions, configurations and integrations are present; the eight native scenarios are prepared and operated with one consolidated correction cycle. Prime and district holiday availability is agreed. |
| District migration assistance and training | 40 hours | January–February 2027 | The agreed pilot is received, native IDs and returned-content differences are reviewed, district operators can repeat the selected batches, and content-owner/administrator sessions are complete. |
| Rollout and receiving handover | 16 hours | March 2027 through 31 March | Final selected-population reconciliation, complete editable workspace/source, actual native configuration, operating instructions and agreed rollout assistance are delivered and reopened by the receiving operator. |
| **Total** | **160 hours** | **Issuer schedule, subject to agreed staffing and commencement** | **Complete supported-platform implementation workshare and reusable engineering handover.** |

FVRL's target contract date is 9 December; discovery is 10–23 December; the **31 December sandbox must contain all required functions and integrations**. Migration and training continue into March, with rollout targeted for 31 March 2027. December staffing and holiday review availability are therefore first-call qualification items. [2]

### Eight scored native scenarios

| Issuer scenario | Proposed configured platform demonstration | Engineering and receiving material |
| --- | --- | --- |
| Two personalized homepages | Two actual staff roles sign in and see their selected home content and audience targeting. | Original identity/role mapping, intended access checks and retained platform observations. |
| Targeted scheduled news and digests | An author selects the intended audience and schedules a supported native news/post; the correct users receive the intended content. | Original audience, scheduled time and timezone; actual returned publication state and selected-role access observation. |
| Search and archive distinction | A staff user searches imperfect terms, identifies current content, and distinguishes archive material. | Selected current/archive inventory, search test phrases and observed results; indexing decisions and failed-search review. |
| Draft, review, approval, publish, retire | A content owner takes a real page through the configured lifecycle and retains its ownership and audience. | Native content IDs, reviewed mapping, original source, changed state and return comparison. |
| Analytics and named viewers | The configured reports expose the requested activity, named-viewer and failed-search views to authorized administrators. | Actual product configuration, permitted report fields and observed reporting path. |
| Google Drive and a core system | Staff use the supported Drive link/embed/search and the selected standard or API-driven core integration. | Original Drive access observations, actual connector configuration and the agreed core-system interface. |
| Town hall | A staff member finds the event, joins the configured meeting path and accesses the selected recording. | Native event/content configuration and actual Meet/Zoom/Drive or supported recording linkage. |
| Frontline and mobile | A frontline user completes the required tasks in the responsive browser on a mobile device. | Selected role/device receiving journey, actual navigation/access findings and operator handover. |

The implementation will use actual product capabilities and documented configuration. The district's ordinary keyword-search requirements are separately scored from any optional AI feature. Native mobile browser access is sufficient under the Addendum. [1, 2]

## Content, identity and integration approach

### Preserve the full source and control the selected work

The workbench retains the complete original inventory and every row's original field positions. It distinguishes migration, retirement, retained reference and exclusion. The approximately 300-page work limit applies to the selected migration population; excluded archive entries remain visible in the source record.

Each selected page binds its title, HTML, original URL, parent, owner, audience, lifecycle, native page type, language and navigation/search decisions. Before execution, the reviewer approves the actual page population and selected native target.

For newly created pages, the native flow obtains all destination IDs before rewriting links. Forward and sibling links then resolve to their actual returned URLs, including selected fragments. Original documents and images are retained as complete bytes; their actual native upload/returned download is adopted with matching file identity. Google Drive references retain the actual Drive access observation, because intranet-page access does not grant Drive-file permission. [4, 6]

### Use the supported ThoughtFarmer interfaces

The public REST API and partial official SDK identify the supported content, owner, user and effective-permission operations. The workbench retains the selected tenant contract and the actual native responses. API tokens stay in the customer's existing private environment. Exact tenant Swagger supplies any further agreed interface. [5]

File and image upload use ThoughtFarmer's native document/image flow or a specifically agreed tenant API. Supported native scheduling is reviewed as a publish-on operation for news/blog/forum posts; the receiving record observes the returned status and date. The implementation retains original request IDs and full attempts so a temporary read failure, a declined write or a lost write response can be continued through the corresponding original operation. [5, 6, 7]

### Configure the existing identity and Drive flow

Entra is FVRL's preferred authoritative identity and already synchronizes Google. The required design is the chosen Microsoft or Google SSO plus Google Workspace integration; it does not require two independent SSO implementations. The agreed provisioning configuration should support the required manual or at-least-daily operation. [2]

ThoughtFarmer documents a native Google Workspace connector for Drive links/embeds/search and Calendar. The implementation selects the needed toggles and scopes, validates the native login test and preserves the actual integration settings. The prime and district identify the core-system interface and its access owner. District-owned external API entitlement and prime/platform fees remain separately identified in the commercial model. [2, 4]

## Commercial proposal

### Token Junkie Labs engineering workshare

**Proposed fixed fee: USD 24,000 for the agreed 160-hour scope.**

| Milestone | Amount | Completion basis |
| --- | ---: | --- |
| Source and integration design | USD 7,200 | Original source/permission contract, reviewed native configuration and migration plan, and complete implementation schedule. |
| Configured sandbox and migration receiving | USD 12,000 | Actual required product functions and integrations in the agreed December sandbox; reviewed pilot/native receiving and documented district-operated migration process. |
| Training and rollout handover | USD 4,800 | Operator training, full editable receiving package, the included consolidated correction cycle and agreed March rollout assistance. |
| **Total** | **USD 24,000** | **Milestone triggers, invoice due dates and commencement to be agreed in the workshare.** |

The scope covers one district implementation, its selected active content population, one consolidated acceptance correction cycle and the stated platform/integration work. Changes to volume, interfaces, review rounds, continuing managed operation or the agreed schedule are recorded and priced in the same scope before adoption.

### Complete five-year evaluated offer

ThoughtFarmer's currently published 200–499-user tier is **USD 7 per user per month**. At 300 users, the flat-price illustration is USD 25,200 annually and USD 126,000 over five years. Adding the proposed USD 24,000 engineering workshare gives a **known planning subtotal of USD 150,000**. [8]

The final evaluated quote needs all five years of required recurring coverage, quoted in USD. The following items remain explicit supplier quote selections:

- Platform subscription, applicable seat assumptions, any agreed discount and renewal increases.
- Prime implementation services that sit outside the agreed engineering workshare.
- US hosting, storage, backup, product support and account management.
- Required identity/integration additions and any applicable publisher charges.
- Coverage matching the issuer's support terms, or an expressly agreed exception.
- Applicable taxes and any optional services, with options subtotaled separately.

**The support quote is material.** The sample agreement requires a qualified Severity 1 response within **two elapsed hours, 24/7**, Severity 2 within four business hours and Severity 3 within one business day. The publisher's public standard response description uses different windows. The final offer should name the actual quoted support tier, upgrade or agreed exception across all five years. [2, 9]

## Responsibilities and handover

**ThoughtFarmer as prime** supplies the proposed supported platform and actual sandbox/customer tenant, complete license/hosting/support quote, US storage and service commitments, product security/accessibility material, contracted references, account management and the customer relationship. It confirms the implementation and holiday staffing that the December milestone requires.

**FVRL** selects and cleans its content, operates the agreed migration with assistance, supplies original sources and actual identity/audience/integration owners, provides review access and signs off the selected outcomes. Its retained legacy archive follows its explicit selection and retention decisions.

**Token Junkie Labs** supplies the agreed engineering source and operating workbench, platform/integration configuration assistance, native pilot and returned-content review, the eight configured-platform scenario preparations, operator training, one correction cycle and the complete receiving handover.

The engineering handover contains the original files, full selected inventory and row bindings, reviewed hierarchy/owner/audience choices, native request and return records, actual destination IDs, unresolved exceptions, complete editable workspace, source and operating instructions. A second operator reopens the delivered package and verifies the same selected work and original content. Credentials remain with the existing customer/prime environment.

## Initial qualification

A useful first conversation can settle four concrete decisions:

1. Whether ThoughtFarmer wants to pursue this FVRL opportunity and which delivery lead would own the prime response.
2. Whether the December tenant, integration and holiday-review capacity supports the complete 31 December sandbox.
3. Which actual platform/license/support arrangement meets the five-year USD offer, US hosting and required response times.
4. Which existing integration and content-owner contacts should join discovery and acceptance.

The issuer requires three independently contactable references; the Addendum permits the bidding firm or named contracted partner, subject to its exact conditions. The prime's reference and configured-product accessibility/security selections belong in the final proposal. [2]

## Original sources

1. [FVRL procurement notice](https://www.fvrl.org/submit-bids/) and [RFP 2026-002](https://www.fvrl.org/wp-content/uploads/sites/168/2026/09/FVRL_RFP_Intranet_2026-002.pdf).
2. [FVRL Addendum 1](https://www.fvrl.org/wp-content/uploads/sites/168/2026/10/Addendum-1.pdf), including Q25, Q28–33, Q41–46, Q51, Q53, Q55, Q68–71 and Q80–81, and the sample agreement's support section.
3. [ThoughtFarmer professional services](https://www.thoughtfarmer.com/professional-services/).
4. [ThoughtFarmer Google Workspace integration](https://helpdesk.thoughtfarmer.com/hc/en-us/articles/360059477814-Google-Workspace-integration).
5. [ThoughtFarmer REST API](https://helpdesk.thoughtfarmer.com/hc/en-us/articles/360061320453-ThoughtFarmer-REST-API) and [official development tools](https://github.com/thoughtfarmer/thoughtfarmer-dev-tools).
6. [ThoughtFarmer permissions to view and edit](https://helpdesk.thoughtfarmer.com/hc/en-us/articles/360061746713-Permissions-to-view-and-edit), [attach files](https://helpdesk.thoughtfarmer.com/hc/en-us/articles/16908718812307-Attach-files), [insert images](https://helpdesk.thoughtfarmer.com/hc/en-us/articles/1500001198401-Insert-images), and [link/embed cloud Drive files](https://helpdesk.thoughtfarmer.com/hc/en-us/articles/1500001434642-Link-and-embed-cloud-drive-files).
7. [ThoughtFarmer page settings](https://helpdesk.thoughtfarmer.com/hc/en-us/articles/360059511054-Page-settings-overview) and [add a basic page or post](https://helpdesk.thoughtfarmer.com/hc/en-us/articles/1500000986282-Add-a-basic-page-or-post).
8. [ThoughtFarmer published pricing](https://www.thoughtfarmer.com/get/pricing/).
9. [ThoughtFarmer customer support](https://www.thoughtfarmer.com/customer-success/) and the sample agreement in [FVRL Addendum 1](https://www.fvrl.org/wp-content/uploads/sites/168/2026/10/Addendum-1.pdf).

**Contact: Token Junkie Labs · Bryce Muhlnickel**
