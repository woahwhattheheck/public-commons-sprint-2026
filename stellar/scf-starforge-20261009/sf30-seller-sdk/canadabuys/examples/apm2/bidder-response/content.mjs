// MIT. Original APM2 response production content for the existing saved bidder desk.
// Public statements are attributed; drafted engineering responses are editable proposals.
export const RESPONSE_CONTENT = {
  "schema": "commons.canadabuys.apm2-response-content.v1",
  "operation": "SCF-CANADABUYS-PROCUREMENT-9FCD-20261012",
  "noticeId": "notice-e7a769311f5a3c763d253568",
  "reference": "SSC-26-00035133:T",
  "solicitation": "BPM026762/35133",
  "reviewedAt": "2026-10-13T07:50:00Z",
  "sources": [
    {
      "id": "P1",
      "title": "Dynatrace partner listing — Optimiz",
      "url": "https://www.dynatrace.com/partners/optimiz/",
      "reviewed": "2026-10-13",
      "kind": "supplier-publication",
      "summary": "The vendor directory lists Optimiz for Canadian coverage and includes Government among its focus industries. Its service description includes observability implementation, custom AppEngine applications and ServiceNow integration. These published statements support partner selection; the chosen deployment, edition, available delivery team and contractual commitments remain supplier inputs."
    },
    {
      "id": "P2",
      "title": "Optimiz platform partnerships",
      "url": "https://www.optimiz.ca/our-partners/",
      "reviewed": "2026-10-13",
      "kind": "supplier-publication",
      "summary": "Optimiz describes work with Dynatrace, IBM, ServiceNow, Datadog, Splunk, AppDynamics and Grafana. The page describes implementation and integration capabilities. The response should select an actual supported platform and edition with its product owner."
    },
    {
      "id": "P3",
      "title": "Optimiz published contact",
      "url": "https://www.optimiz.ca/contact/",
      "reviewed": "2026-10-13",
      "kind": "supplier-publication",
      "summary": "The company publishes info@optimiz.ca and a Toronto office contact. That is the original commercial contact route for this opportunity."
    },
    {
      "id": "T1",
      "title": "Dynatrace OTLP endpoints",
      "url": "https://docs.dynatrace.com/docs/ingest-from/opentelemetry/otlp-api",
      "reviewed": "2026-10-13",
      "kind": "technical-primary",
      "summary": "Native ingestion uses HTTP with binary Protocol Buffers and distinct traces, metrics and logs paths. Select the documented SaaS or environment-qualified ActiveGate URL. The documented token families use different authorization prefixes and scopes. Ordinary OTLP through ActiveGate needs explicit host/topology enrichment. Supplier selection must specify token type, endpoint, network trust and supported product edition."
    },
    {
      "id": "T2",
      "title": "OpenTelemetry Collector scaling",
      "url": "https://opentelemetry.io/docs/collector/scaling/",
      "reviewed": "2026-10-13",
      "kind": "technical-primary",
      "summary": "Collector scaling depends on signal workload and whether processors are stateless, scrape-based or stateful. Inspect memory pressure, queues and downstream throughput. Scrape targets need allocation; stateful sampling needs consistent trace routing. More collectors do not resolve a saturated downstream endpoint."
    },
    {
      "id": "T3",
      "title": "OpenTelemetry Collector resiliency",
      "url": "https://opentelemetry.io/docs/collector/resiliency/",
      "reviewed": "2026-10-13",
      "kind": "technical-primary",
      "summary": "Exporter queues and retries provide finite buffering. Queue saturation or expiration can discard telemetry. Select the supported storage and retry configuration for the intended failure window, and measure its behaviour with the actual pipeline."
    }
  ],
  "supplierProfile": {
    "label": "Optimiz — APM2 public-source partner review",
    "legalName": "",
    "operatingNames": [
      "Optimiz"
    ],
    "description": "Public-source partner review for the SSC APM2 RFI. Dynatrace's directory describes Canadian observability implementation, custom applications and ServiceNow integration. The supplier's selected platform, available staff, legal respondent identity and proposed service commitments are entered through its own review.",
    "keywords": [
      "observability",
      "application performance",
      "infrastructure",
      "datacentre",
      "monitoring",
      "diagnostic"
    ],
    "excludedKeywords": [],
    "categories": [],
    "commodityCodes": [],
    "deliveryRegions": [],
    "opportunityRegions": [],
    "capacity": {
      "state": "UNKNOWN",
      "availableFrom": null,
      "minimumLeadDays": null,
      "note": "Supplier availability is not inferred from the public directory. The separate TJLabs workshare proposes 60 production hours over ten working days from agreed scope and inputs."
    },
    "commercial": {
      "currency": "CAD",
      "minimumContractValue": null,
      "maximumContractValue": null,
      "maximumBidCost": null,
      "note": "Supplier platform/license economics and bid budgets remain supplier inputs. The saved TJLabs engineering workshare is separately proposed at CAD 7,200."
    },
    "notes": "Public-source engineering review. A public partner listing is used for fit and evidence assignment; legal entity, registrations, customer references, named staff, support terms and response approval remain distinct supplier fields."
  },
  "responses": [
    {
      "id": "industry-input",
      "title": "Response purpose and solution position",
      "draft": "Present the selected observability option as an industry response to APM2's consultation. Organize the answer by the original issuer questions, then map platform coverage, implementation prerequisites, service responsibilities and commercial units to supporting documents. Describe currently supported capabilities and explicitly distinguish proposed engineering work. Reuse the source and response matrix across amendments so the final supplier-approved package retains the reviewed question set.",
      "inputs": [
        "Actual RFI sections and templates",
        "Selected platform, edition and product owner",
        "Supplier-approved response position"
      ],
      "deliverable": "Editable response master with source/question/answer/evidence/owner/status fields.",
      "acceptance": "Every original issuer response item has a response location and an assigned approval decision.",
      "sources": [
        "P1",
        "P2"
      ]
    },
    {
      "id": "infrastructure",
      "title": "Infrastructure coverage",
      "draft": "Maintain one supported-estate row per technology and version: infrastructure owner, hosting zone, monitoring method, collector or agent dependency, resource identifiers, signal set, required privileges, change window and operating responsibility. Start with the actual supplied estate inventory. Link host and process observations to the service registry through retained resource identity. Capture deployment prerequisites and excluded configurations in the same matrix so rollout planning uses the same support boundary as the response.",
      "inputs": [
        "Estate/version inventory",
        "Vendor support matrix",
        "Installation permissions and change windows"
      ],
      "deliverable": "Supported-estate and interface matrix with source references, owners, prerequisites and a documented receiving walkthrough using existing authorized supplier evidence or demo.",
      "acceptance": "Each selected estate row has a cited support reference and assigned owner; the response records the proposed receiving path and available walkthrough evidence.",
      "sources": [
        "P1",
        "T1"
      ],
      "proposedPilotAcceptance": "Each selected estate row has an actual support reference, owner and validated receiving path."
    },
    {
      "id": "application",
      "title": "Application and service coverage",
      "draft": "Map each business service to its application owner, deployment, entry points and material dependencies. Select instrumentation by supported language/runtime and deployment method. Record request, error, latency and diagnostic views with their meaning, time basis and observation gaps. Correlate service identity across metrics, traces and relevant logs; carry environment and version through the path. Product-specific views and automatic topology claims are approved against the actual selected platform documentation.",
      "inputs": [
        "Service inventory and supported runtimes",
        "Required transactions and diagnostic views",
        "Documented product feature/licensing dependencies"
      ],
      "deliverable": "Application/service identity and diagnostic-view design with a documented walkthrough using existing authorized supplier evidence or demo.",
      "acceptance": "The response traces a selected service identity to proposed application and diagnostic views, with supporting supplier documentation or existing demo observations.",
      "sources": [
        "P1",
        "T1"
      ],
      "proposedPilotAcceptance": "A selected service can be followed from its source identity to the intended application and diagnostic views."
    },
    {
      "id": "datacentre",
      "title": "Sites, trust boundaries and data movement",
      "draft": "Document collection, processing, storage, analysis and administration as separate paths. Give every connection an owner, protocol, authentication reference, destination, permitted data classes and outage behaviour. Compare supported local and remote collection options using the actual site, network and residency decisions. Retain source resource identity through any gateway and record the required topology enrichment. Select administrative and support access separately from telemetry transport.",
      "inputs": [
        "Actual sites and trust zones",
        "Permitted destinations and data classes",
        "Network and identity owners",
        "Product deployment options"
      ],
      "deliverable": "Deployment option matrix and interface register.",
      "acceptance": "Every selected connection and data location is named, sourced and assigned to its operating owner.",
      "sources": [
        "T1"
      ]
    },
    {
      "id": "continuous",
      "title": "Continuous availability and performance operation",
      "draft": "Define each monitored service's operational indicator, calculation window, data freshness expectation and owner. Track collection health independently of service health so missing telemetry is distinguishable from a healthy service. Connect actionable findings to the agreed incident route, acknowledgement and escalation roles. Include maintenance behaviour and restoration confirmation. Enter measured and contractual thresholds from the selected service, rather than deriving an SLA from a product feature.",
      "inputs": [
        "Selected service objectives and support hours",
        "Maintenance and escalation policy",
        "Actual collection-quality observations"
      ],
      "deliverable": "Availability/performance operations design, service indicator register and escalation walkthrough documented from existing authorized supplier evidence or demo.",
      "acceptance": "The response identifies the service, freshness assessment, proposed incident route and responsible owners, with sourced walkthrough material.",
      "sources": [
        "P1",
        "T2"
      ],
      "proposedPilotAcceptance": "Operators can identify the affected service, assess data freshness and follow an owned escalation and restoration path."
    },
    {
      "id": "diagnosis",
      "title": "Diagnostic investigation",
      "draft": "Begin an investigation with the affected service, symptom and time window. Establish clock and data freshness before comparing baseline and changed behaviour. Follow a representative request or dependency path through the available traces, service metrics and relevant logs; retain exact timestamps and identifiers. Correlate deployment or configuration changes and record a competing explanation before changing production. Document the chosen mitigation, authorization, observed outcome and rollback condition in the incident record.",
      "inputs": [
        "Available diagnostic views and permissions",
        "Change/event source",
        "Representative operational incident",
        "Supplier-supported correlation method"
      ],
      "deliverable": "Investigation runbook and documented walkthrough using existing authorized supplier evidence or demo.",
      "acceptance": "The response package retains the walkthrough's source observations, alternative explanations and proposed decision path so the reviewer can reopen it.",
      "sources": [
        "T1"
      ],
      "proposedPilotAcceptance": "The case can be reopened with its original observations and the reasoning behind the chosen action."
    },
    {
      "id": "deployment-options",
      "title": "Deployment and capacity options",
      "draft": "Compare the supported product options on integration coverage, data flow, identity, collection placement, resilience, service operation and commercial units. Attach the capacity planner's complete input file to the chosen option. Keep trace, metric and log policies separate; identify measured versus assumed input, peak and average load, retained fractions, transport/storage factors and outage buffers. Evaluate horizontal scaling in the context of scrape ownership, stateful processing and downstream limits. The supplier confirms the supported configuration and actual performance evidence.",
      "inputs": [
        "Supported option/version list",
        "Measured workload inputs",
        "Vendor commercial units and quote",
        "Chosen failure windows"
      ],
      "deliverable": "Option matrix plus the existing editable capacity project and report.",
      "acceptance": "Every projected output traces to visible input, unit, source/date and the selected configuration.",
      "sources": [
        "T2",
        "T3"
      ]
    },
    {
      "id": "supporting-services",
      "title": "Implementation and service responsibilities",
      "draft": "Allocate implementation, configuration, documentation, training, integration and support across the supplier, prime, delivery team and customer. Name the accepting owner for every deliverable and the escalation route for each service boundary. Separate license support from operated-service support. Carry access prerequisites, change approval and incident authority into the runbooks. Tie handover to original source, editable configuration, known issues and an independently reopened operating package.",
      "inputs": [
        "Prime and subcontract structure",
        "Named technical and service owners",
        "Product support and service terms"
      ],
      "deliverable": "Responsibility matrix, service catalogue and operator handover.",
      "acceptance": "Each material delivery and operating action has one accountable owner and a defined receiving party.",
      "sources": [
        "P1",
        "P2"
      ]
    },
    {
      "id": "operational-security",
      "title": "Security and information handling",
      "draft": "Inventory telemetry fields by source, sensitivity, purpose and destination. Apply minimization and transformation before transmission where supported, with an owner for the rule and a retained configuration reference. Record transport trust, service identities, token scopes, operator roles, administrative/support access and audit events. Map retention and deletion to each stored data class and backup path. The actual RFI provisions and selected deployment documents supply the security and residency obligations used in the final response.",
      "inputs": [
        "Actual RFI security/residency clauses",
        "Product control documentation",
        "Telemetry classification",
        "Access and retention owners"
      ],
      "deliverable": "Data/control decision register and selected-boundary diagram.",
      "acceptance": "Each stated control maps to the selected configuration, evidence, responsible operator and approval decision.",
      "sources": [
        "T1"
      ]
    },
    {
      "id": "risk-agility",
      "title": "Migration, recovery and change",
      "draft": "Group rollout by service dependency and operating risk. For each wave, name the current monitor, coexistence period, acceptance observations, change approval, rollback destination and recovery owner. Verify telemetry receiving and incident routing before retiring a predecessor. Keep instrumentation and collector configuration versions with the service inventory. Record capacity, queue and downstream observations after each wave and update the chosen option from measured results.",
      "inputs": [
        "Current monitoring estate and dependencies",
        "Approved change/recovery process",
        "Pilot service and rollback configuration"
      ],
      "deliverable": "Proposed wave plan, pilot acceptance template and rollback runbook.",
      "acceptance": "The response names the proposed wave observations, accepting owner, rollback criteria and source configuration references.",
      "sources": [
        "T2",
        "T3"
      ],
      "proposedPilotAcceptance": "A wave can be accepted or reversed using named observations and retained original settings."
    },
    {
      "id": "submission-document",
      "title": "Issuer response instructions",
      "draft": "Populate the response master from the original RFI and amendments in their actual order. Preserve document identity, version, section and response field alongside every answer. Record the supplier's actual submission mechanism, required acknowledgements and named submission owner after the document is received. The current notice-derived coverage register seeds the engineering work and will be joined to those issuer sections.",
      "inputs": [
        "Complete original RFI and amendments",
        "Actual submission instructions",
        "Authorized respondent and final file list"
      ],
      "deliverable": "Original-question crosswalk and complete editable response package.",
      "acceptance": "The supplier can locate every source question and its corresponding final response file.",
      "sources": []
    },
    {
      "id": "calendar",
      "title": "Response and partner review calendar",
      "draft": "Keep the publisher's original closing time, fixed offset and UTC value together. Schedule source review, product decisions, technical challenge, commercial review and final packaging backwards from that closing. Express internal dates as an editable delivery plan tied to agreed inputs and named reviewers. Preserve later source changes and revise the plan alongside the saved workshare.",
      "inputs": [
        "Original closing and amendments",
        "Partner reviewer availability",
        "Agreed scope/input receipt date"
      ],
      "deliverable": "Editable production and approval calendar.",
      "acceptance": "The plan identifies each dependency, reviewer and final submission responsibility before the source deadline.",
      "sources": []
    }
  ],
  "annexes": [
    {
      "id": "architecture",
      "title": "APM2 architecture and interface register",
      "sections": [
        {
          "title": "Response engineering scope",
          "text": "The proposed CAD 7,200 workshare provides 60 hours of response engineering over ten working days: source mapping, supported-estate/interface design, capacity and cost inputs, operational/security annexes, documented walkthroughs using existing authorized supplier evidence or demos, and an editable response package. Platform and pilot acceptance criteria describe the proposed solution for the supplier's response. Any new production rollout, configuration change or remediation is separately selected and agreed scope."
        },
        {
          "title": "Selected solution record",
          "text": "Record platform, edition, version, licensed features, deployment option, tenant or environment identity, support owner and the actual supporting documents. Retain an alternatives table until the solution owner selects the proposed option. Each option uses the same service inventory, source requirements and input units."
        },
        {
          "title": "Service inventory",
          "text": "Columns: service ID; business function; technical owner; environment; hosting/site; runtime and version; current monitor; dependency IDs; instrumentation method; privilege required; signal IDs; operating hours; support route; change owner; acceptance record. Use stable service IDs across all annexes. Keep an unknown cell open instead of substituting a product default."
        },
        {
          "title": "Signal and interface register",
          "text": "Columns: interface ID; source/service ID; signal; collector/agent and version; receive protocol; transformation/enrichment; destination; authentication reference; network owner; data classes; buffering/retry reference; scale partition; monitoring owner. Store secret reference names rather than credential values. Every interface names who can rotate or revoke its identity."
        },
        {
          "title": "Dynatrace ingestion selection",
          "text": "For the candidate Dynatrace path, use the actual supported HTTP/protobuf endpoint and its signal suffix. Confirm SaaS versus environment-qualified ActiveGate routing, token family/scopes and host enrichment against T1. Record the chosen URL template and supported collector edition in the interface register. Product-specific settings are approved from the supplier's selected environment."
        },
        {
          "title": "Capacity integration",
          "text": "Open the existing APM2 capacity application, enter the chosen estate's measured or declared planning values, and retain its complete JSON with the response. Use separate signal policies, average/peak inputs, periods, factors and currencies. Keep projection assumptions and measurement references together. Queue byte estimates are planning inputs; actual exporter queue units and processing overhead come from the selected component's supported configuration."
        },
        {
          "title": "Scaling and resilience",
          "text": "Use T2/T3 to review the selected pipeline's scaling and buffering design. Record scrape ownership, trace-state routing, queue/disk limits and downstream capacity. An increase in queues triggers diagnosis of the destination and network as well as the collector. Select a supported storage/retry policy and retain its measured receiving behaviour for the intended outage."
        },
        {
          "title": "Security and residency decisions",
          "text": "Columns: decision ID; data class; origin; transformation; destination/location; transport control; storage/backup; retention/deletion; administrative/support access; identity/role; audit event; source clause; evidence; owner; chosen value; reviewer/date. Complete these from the actual source and supplier option. The response avoids conflating the operator's headquarters with telemetry processing location."
        }
      ]
    },
    {
      "id": "operations",
      "title": "APM2 operating and acceptance handbook",
      "sections": [
        {
          "title": "Response engineering scope",
          "text": "The proposed CAD 7,200 workshare provides 60 hours of response engineering over ten working days: source mapping, supported-estate/interface design, capacity and cost inputs, operational/security annexes, documented walkthroughs using existing authorized supplier evidence or demos, and an editable response package. Platform and pilot acceptance criteria describe the proposed solution for the supplier's response. Any new production rollout, configuration change or remediation is separately selected and agreed scope."
        },
        {
          "title": "Runbook 1 — stale or missing telemetry",
          "text": "Select the affected service, signal and time range. Check source liveness and time basis; identify the last complete receiving point. Follow source, collector, transformation and exporter in order. Inspect authorization, certificate, rejection and destination responses using permitted logs. Record whether the problem is source absence, processing rejection, transport failure or delayed destination indexing. Apply the owned remedy, then confirm fresh receiving at the intended view and record any unrecovered interval."
        },
        {
          "title": "Runbook 2 — exporter backlog or rejected traffic",
          "text": "Record the selected pipeline/version, signal, queue trend, age, retry state, available storage and destination response. Compare arrival and successful rates. Determine whether the limiting resource is collection, processing, network or destination. Use the agreed overload policy and approved settings; preserve dropped-data observations and the time range they affect. Resume normal flow and verify that the queue drains within the selected operational objective."
        },
        {
          "title": "Runbook 3 — application degradation",
          "text": "Open the service and selected observation window. Confirm sufficient fresh telemetry. Compare error, latency and resource observations with the retained baseline; follow the affected request/dependency path where available. Add change context and alternative explanations. Assign the mitigation owner and authorization. After the action, record observed service recovery, remaining symptoms and the condition that would trigger rollback."
        },
        {
          "title": "Runbook 4 — identity or certificate rotation",
          "text": "Locate the exact interface, identity owner and supported rotation procedure. Retain the current configuration reference without copying secrets into the response. Stage the approved new identity/trust chain, verify intended receiving, and then revoke the superseded identity under its owner. Confirm that unrelated destinations and permissions remain as selected. Record access/audit observations and the recovery path."
        },
        {
          "title": "Runbook 5 — collector or platform upgrade",
          "text": "Compare supported components, deprecations and configuration syntax for the exact selected versions. Select a representative authorized service, preserve its original configuration and receiving baseline, apply the approved change, then inspect signal integrity and operational routing. Roll out by service dependency only after the accepting owner records the observed outcome. Keep original and new configuration references through handover."
        },
        {
          "title": "Wave acceptance",
          "text": "For each real service, retain source/service identity; chosen configuration; capture period; actual receiving observations; freshness and dropped-data observations; diagnostic and alert-route outcome; approved data/control decisions; operating owner; recovery/rollback reference; accepting reviewer/time. Thresholds and service objectives are entered from the customer or supplier agreement. The register records actual results against those selected values."
        },
        {
          "title": "Support responsibility and handover",
          "text": "Assign telemetry source, collection, backend/platform, network/identity, incident service and commercial support boundaries. Retain the receiving party for each escalation. Deliver editable source, version/configuration references, the capacity project, response register, source index, runbooks, known issues and named owners. Reopen the exported package independently using the existing CanadaBuys receiver."
        }
      ]
    },
    {
      "id": "partner-inputs",
      "title": "APM2 supplier input and review schedule",
      "sections": [
        {
          "title": "Response engineering scope",
          "text": "The proposed CAD 7,200 workshare provides 60 hours of response engineering over ten working days: source mapping, supported-estate/interface design, capacity and cost inputs, operational/security annexes, documented walkthroughs using existing authorized supplier evidence or demos, and an editable response package. Platform and pilot acceptance criteria describe the proposed solution for the supplier's response. Any new production rollout, configuration change or remediation is separately selected and agreed scope."
        },
        {
          "title": "Product and platform owner",
          "text": "Confirm product/edition/version, supported environment and deployment, licensed feature boundary, supported estate, integration references, endpoint/authentication choice, topology enrichment, documented capacity evidence and product support route. Provide the source location and approving owner for each material product statement."
        },
        {
          "title": "Security and operations owner",
          "text": "Confirm selected data processing and backup locations, source telemetry classes, transformations, retention/deletion, identity scopes, operator/support roles, access audit and the actual service commitments. Join these to the original RFI clauses and chosen deployment rather than to a general corporate policy."
        },
        {
          "title": "Commercial and response owner",
          "text": "Confirm legal respondent identity, prime/subcontract role, original RFI template and final submission route, dated platform/license/services quote, currency and commercial units. Review the separate proposed TJLabs CAD7,200/60-hour/ten-working-day scope and milestone acceptance. Choose the actual start date from agreed inputs."
        },
        {
          "title": "Review allocation",
          "text": "The proposed six partner hours cover one hour for scope and source decisions, two hours for product and architecture inputs, one hour for security/service responsibilities and two hours for integrated review. The proposed allocation is editable. The technical owner approves product statements, the commercial owner approves commercial content and the submission owner controls the final issuer response."
        }
      ]
    }
  ],
  "workshareScope": "The proposed CAD 7,200 workshare provides 60 hours of response engineering over ten working days: source mapping, supported-estate/interface design, capacity and cost inputs, operational/security annexes, documented walkthroughs using existing authorized supplier evidence or demos, and an editable response package. Platform and pilot acceptance criteria describe the proposed solution for the supplier's response. Any new production rollout, configuration change or remediation is separately selected and agreed scope."
};


export function buildResponseMaster(notice, originalContent) {
  const entry = notice?.currentEntry;
  if (notice?.id !== RESPONSE_CONTENT.noticeId || !entry?.row ||
      entry.row['referenceNumber-numeroReference'] !== RESPONSE_CONTENT.reference ||
      entry.row['solicitationNumber-numeroSollicitation'] !== RESPONSE_CONTENT.solicitation ||
      !entry.rowSha256 || !entry.id || !entry.sourceId) throw new Error('Select the complete original APM2 notice edition.');
  const requirements = originalContent?.review?.qualification?.requirements;
  if (!Array.isArray(requirements) || requirements.length !== RESPONSE_CONTENT.responses.length) throw new Error('Use the original complete APM2 coverage register.');
  const byId = new Map(requirements.map(value => [value.id, value]));
  const responses = RESPONSE_CONTENT.responses.map(value => {
    const original = byId.get('apm2-' + value.id);
    if (!original) throw new Error('The original APM2 coverage identifiers changed.');
    return {...structuredClone(value), sourceRequirement:structuredClone(original), issuerClassification:'notice-derived coverage', supplierApproval:'draft'};
  });
  return {schema:RESPONSE_CONTENT.schema, operation:RESPONSE_CONTENT.operation,
    binding:{noticeId:notice.id, sourceId:entry.sourceId, entryId:entry.id, rowSha256:entry.rowSha256, rowNumber:entry.rowNumber},
    originalRow:structuredClone(entry.row), originalClosing:entry.row['tenderClosingDate-appelOffresDateCloture'],
    responseBasis:'Notice-derived engineering coverage; join original attachment questions when received.',
    workshareScope:RESPONSE_CONTENT.workshareScope,
    supplierProfile:structuredClone(RESPONSE_CONTENT.supplierProfile), sources:structuredClone(RESPONSE_CONTENT.sources),
    responses, annexes:structuredClone(RESPONSE_CONTENT.annexes)};
}

export function renderResponseMarkdown(master) {
  const out = ['# APM2 response engineering master', '',
    'Solicitation: ' + RESPONSE_CONTENT.solicitation + ' · Reference: ' + RESPONSE_CONTENT.reference, '',
    master.responseBasis, '', '## Workshare scope', '', master.workshareScope, '', 'Source entry: ' + master.binding.entryId + '; row SHA256: ' + master.binding.rowSha256 + '.', '',
    '## Response register', ''];
  for (const row of master.responses) out.push('### ' + row.id + ' — ' + row.title, '',
    '**Original coverage:** ' + row.sourceRequirement.requirement, '',
    '**Source:** ' + row.sourceRequirement.source, '',
    '**Draft response:** ' + row.draft, '',
    '**Supplier inputs:** ' + row.inputs.join('; ') + '.', '',
    '**Response workshare deliverable:** ' + row.deliverable, '', '**Response workshare acceptance:** ' + row.acceptance, '',
    ...(row.proposedPilotAcceptance ? ['**Proposed platform/pilot acceptance criterion:** ' + row.proposedPilotAcceptance, ''] : []),
    '**Technical/public source references:** ' + (row.sources.join(', ') || 'Original notice and issuer attachment') + '.', '',
    '**Supplier approval:** draft; selected product and commitments remain editable.', '');
  for (const annex of master.annexes) { out.push('## ' + annex.title, ''); for (const section of annex.sections) out.push('### ' + section.title, '', section.text, ''); }
  out.push('## Source index', '');
  for (const source of master.sources) out.push('### ' + source.id + ' — ' + source.title, '', source.url, '',
    'Reviewed ' + source.reviewed + '. ' + source.summary, '');
  return out.join('\n') + '\n';
}
