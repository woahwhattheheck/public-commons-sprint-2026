/**
 * APM2 original-case operating content.
 * Source facts come from the retained CanadaBuys row. Scope, dates, capacity and
 * commercial values below are editable internal delivery proposals for a supplier.
 * Bind this content to workspace.getNotice(APM2_NOTICE_ID) before saving it.
 */
export const APM2_NOTICE_ID = 'notice-e7a769311f5a3c763d253568';
export const APM2_SOLICITATION = 'BPM026762/35133';

export function createApm2OperatingContent(notice, {
  owner = 'Procurement delivery',
  partner = 'Observability platform supplier / Canadian prime — selection in progress',
  availableFrom = '2026-10-13'
} = {}) {
  const entry = notice?.currentEntry;
  const row = entry?.row;
  if (notice?.id !== APM2_NOTICE_ID || !row ||
      row['referenceNumber-numeroReference'] !== 'SSC-26-00035133:T' ||
      row['solicitationNumber-numeroSollicitation'] !== APM2_SOLICITATION ||
      row['noticeType-avisType-eng'] !== 'Request for Information') {
    throw new Error('Open the complete retained SSC APM2 RFI before preparing this original case.');
  }
  if (!entry.id || !entry.sourceId || !entry.rowSha256 || !Number.isSafeInteger(entry.rowNumber)) {
    throw new Error('The original notice must include its source edition, row identity and row hash.');
  }
  const source = field => 'source:' + entry.sourceId + '#row=' + entry.rowNumber +
    '; entry=' + entry.id + '; rowSha256=' + entry.rowSha256 + '; field=' + field;
  const descriptionSource = source('tenderDescription-descriptionAppelOffres-eng');
  const attachment = row['attachment-piecesJointes-eng'];
  const closing = entry.summary?.closing || notice.summary?.closing;
  const requirement = (id, text, field, note) => ({
    id: 'apm2-' + id, requirement: text, status: 'unreviewed',
    source: field ? source(field) : descriptionSource, note
  });
  const qualification = {
    capability: [
      'Prepare the supplier’s complete technical and service response for the SSC Application Performance Management 2 RFI.',
      'Organize the response around the original scope: infrastructure, applications and datacentre observability; continuous availability/performance monitoring; and deeper diagnosis.',
      'Translate those needs into a deployment architecture, telemetry and integration map, capacity/retention model, security information map, migration sequence, and service operating model.',
      'For each supplier capability, attach its actual product version, supported configuration, documentation or deployment reference, and the engineer responsible for the statement.',
      'Our proposed delivery work covers response engineering and the supporting architecture/capacity package. Supplier product ownership, licensing authority, installed-base representations and prime-specific eligibility are assigned to the selected partner.',
      'The reusable output can support later vendor evaluation and procurement preparation while retaining this RFI’s exact source and buying stage.'
    ].join('\n\n'),
    eligibility: [
      'Source buyer: ' + row['contractingEntityName-nomEntitContractante-eng'] + '. Source delivery region: ' + row['regionsOfDelivery-regionsLivraison-eng'] + '.',
      'The retained source identifies an open competitive Request for Information. Its description seeks industry input to inform future procurement vehicles and refers respondents to the original RFI document for submission instructions.',
      'Populate the official response template and requirement register from that original attachment: ' + attachment,
      'Record all partner-specific submission, language, security, residency, supplier-registration, participation, confidentiality and intellectual-property provisions as they appear in the document. The current source row supplies the broad operational/security need; those detailed provisions are document review items.',
      'Use the original source links and already assigned document intake to obtain the complete material. The contracting authority is the source-designated destination for substantive RFI questions after the available document has been reviewed.',
      'Keep each answer’s evidence and owner with its source section so supplier representatives can approve the actual claims they contribute.'
    ].join('\n\n'),
    commercial: [
      'Buying stage: industry consultation for future observability procurement. The commercial route for this workshare is a defined response-engineering service sold to a platform supplier or Canadian prime participating in that consultation.',
      'Proposed package: a complete response master, architecture/telemetry/capacity/security annexes, product evidence map, migration and service model, and a reviewed operator handover.',
      'Internal pricing proposal: CAD 7,200 for the defined package, organized into four acceptance/payment milestones. This is our editable service proposal; the government notice provides no budget or award value.',
      'Planning basis: 60 production hours, including eight hours of technical review, plus six partner/principal hours. Entered delivery costs total CAD 4,000: 52 engineering hours at CAD 60, eight review hours at CAD 90, and CAD 160 for document handling and delivery expenses.',
      'The selected partner owns its product/license pricing and approves its own legal and procurement representations. A complete pricing/TCO comparison will preserve vendor quote dates, currency, included services, volume units, retention assumptions and renewal treatment.'
    ].join('\n\n'),
    timing: [
      'Original closing: ' + row['tenderClosingDate-appelOffresDateCloture'] + ' fixed UTC−05:00; parsed UTC: ' + (closing?.utc || 'read current source closing record') + '.',
      'Proposed production starts ' + availableFrom + ' and uses ten working days. Reserve six partner hours for evidence intake, architecture review and final approval.',
      'Sequence: source/template decomposition and partner evidence intake; architecture and quantitative capacity model; security/migration/service annexes; technical challenge and final response assembly.',
      'The planned final engineering handover is 2026-10-26, leaving time before the published 2026-11-09 closing for the participating supplier to review the original response instructions and complete its submission.',
      'When an amendment arrives, compare the complete original fields and attachment versions, update the requirements register, and issue a revised workshare edition with the changed source context visible.'
    ].join('\n\n'),
    requirements: [
      requirement('industry-input', 'The response must address the RFI’s request for industry information about current and emerging observability solutions.',
        'noticeType-avisType-eng',
        'Write a structured capability/evidence response. Preserve the RFI stage in the cover, executive summary and delivery scope.'),
      requirement('infrastructure', 'Describe coverage for the health and performance of the government IT infrastructure estate.',
        null,
        'Build a supported-estate matrix for hosts, operating systems, network dependencies, virtualization and cloud components using the partner’s actual version/support documentation.'),
      requirement('application', 'Describe application availability and performance observability.',
        null,
        'Map available instrumentation, request paths, service dependencies and diagnostic views to documented product capabilities. Record the installation and operating prerequisites.'),
      requirement('datacentre', 'Explain datacentre observability and its relationship to infrastructure and application views.',
        null,
        'Show the proposed site boundaries, data paths, correlation keys, local buffering and central access model. Assign each integration and operational responsibility.'),
      requirement('continuous', 'Explain continuous monitoring and tracking of availability and performance.',
        null,
        'Prepare the operating model for collection, data freshness, alert routing, maintenance windows, incident escalation and quality checks. Supply measurements only from the partner’s actual supported environment or documentation.'),
      requirement('diagnosis', 'Explain the deeper diagnostic investigation capability described in the RFI.',
        null,
        'Develop an incident investigation walkthrough that links the available telemetry views, timestamps, service/resource identity and change context. Identify any instrumentation the partner must enable.'),
      requirement('deployment-options', 'Describe viable solution approaches that can inform later procurement strategy.',
        null,
        'Produce an option matrix separating supported deployment models, configuration dependencies, licensed features and services. State the basis for each option and its major operating/cost tradeoffs.'),
      requirement('supporting-services', 'Include the supporting services needed with the observability platform.',
        null,
        'Assign implementation, migration, integration, operating documentation, training, support escalation and service governance between the supplier, prime and delivery team.'),
      requirement('operational-security', 'Address the government’s diverse operational and security needs at the level supported by the original documents.',
        null,
        'Build a data/control matrix for telemetry collection, access, retention, transport, storage, administration and support access. Link every stated document requirement to a response owner and supplier evidence.'),
      requirement('risk-agility', 'Explain how the proposed approach supports risk reduction, agility and sustained availability/performance.',
        null,
        'Connect migration sequencing, rollback, operating ownership, dependency management and measurable service objectives to the chosen deployment option.'),
      requirement('submission-document', 'Use the original RFI documentation for response instructions and templates.',
        'attachment-piecesJointes-eng',
        'The original English attachment is in the existing equipped document intake. Transcribe its actual sections, response format, delivery mechanism and required acknowledgments into the response register when received.'),
      requirement('calendar', 'Plan the partner review and response assembly around the published closing time.',
        'tenderClosingDate-appelOffresDateCloture',
        'Retain source time, fixed offset and UTC alongside the internal working calendar. Reserve the participating supplier’s final review slot before source closing.')
    ]
  };
  const workshare = {
    noticeId: notice.id,
    title: 'APM2 RFI response engineering — observability architecture and service package',
    status: 'draft', partner, owner, currency: 'CAD', feeCents: 720000,
    estimatedHours: 60, partnerHours: 6, availableFrom, deliveryDays: 10,
    scope: [
      'Develop the participating supplier’s complete technical and service response package for Shared Services Canada APM2 RFI ' + APM2_SOLICITATION + '.',
      'Convert the original RFI and its amendments into a requirements/response master, then assemble a source-linked account of the supplier’s supported observability platform, deployment options and accompanying services.',
      'The engineering package covers infrastructure, applications and datacentre observability; continuous availability/performance monitoring; diagnostic investigation; deployment and telemetry paths; sizing/retention/cost drivers; security information; migration; and the service operating model.',
      'Bind the final package to the actual supplier product, version, supported configurations and evidence. Record assumptions that the supplier must resolve and assign an owner to each response item.',
      'The prime/supplier remains responsible for its participation and final submission, commercial/legal representations, product license terms and approval of the capabilities it presents.'
    ].join('\n\n'),
    deliverables: [
      '1. Response master: an editable requirements register carrying original document/section, question, required response field, response owner, answer, evidence link, amendment impact and approval status. Include the complete original source row and attachment identities.',
      '2. Architecture annex: a deployment topology and option matrix; site and trust boundaries; collector/gateway/data-plane/control-plane responsibilities; platform dependencies; administrative access; and supported integration/version references.',
      '3. Telemetry and diagnosis annex: a source-to-view map for the supplier’s available metrics, traces, logs and diagnostic data; resource/service correlation; collection and enrichment points; buffering/backpressure behavior; alert routing; and an incident investigation walkthrough.',
      '4. Capacity and commercial model: editable inputs for estate size, collection intervals, active series, trace/sample volume, log volume, retention tiers, replication and headroom. Derive ingest rate, storage and licensed consumption from those explicit inputs. Tie capacity/performance statements to actual supported product evidence.',
      '5. Security information annex: telemetry data inventory; sensitive-data minimization; identity/role model; administrative/support access; transport/storage protection; retention/deletion; audit events; and document-specific deployment/residency requirements.',
      '6. Migration and operating annex: inventory/discovery, pilot entry criteria, coexistence, instrumentation/configuration rollout, acceptance, rollback, training, incident/service escalation, maintenance and ownership matrix.',
      '7. Supplier evidence register: supported product/version reference, licensing unit, public/private document location, configuration boundary, evidence owner, date and the exact response statements supported.',
      '8. Final handover: complete editable and reading copies, packaged original sources, annotated architecture/capacity files, a resolved review log, remaining supplier decisions with owners, and a delivery walkthrough.'
    ].join('\n\n'),
    partnerResponsibilities: [
      'Name a technical lead and the authorized respondent; provide six hours across evidence intake, architecture review and final approval.',
      'Provide access to the actual supported product documentation, deployment references, feature/license matrix, relevant measured capacity evidence, standard service terms and applicable procurement/security material.',
      'Confirm which product versions, deployment models and integrations the supplier will put forward, and approve all statements about its capabilities, certifications, experience and support.',
      'Supply dated product/service pricing and the intended prime/contracting structure for the optional TCO comparison.',
      'Review the final package against the original RFI delivery instructions and complete the supplier’s own final submission.'
    ].join('\n\n'),
    inputs: [
      'Retained source: ' + entry.sourceId + '; row ' + entry.rowNumber + '; entry ' + entry.id + '; row SHA-256 ' + entry.rowSha256 + '.',
      'Complete original RFI attachment and any amendments: ' + attachment,
      'Participating supplier identity, proposed product/version and named technical/commercial reviewers.',
      'Actual supported configuration, integration, licensing, security, support and capacity evidence; existing relevant deployment material that the supplier authorizes for the response.',
      'Working estate/deployment inputs for the capacity/TCO worksheet. Label entered planning scenarios with their source and date, and keep the calculated results attached to those inputs.',
      'Partner review calendar and confirmed recipient/mechanism from the RFI document.'
    ].join('\n\n'),
    acceptance: [
      'Every original RFI response item appears in the response master with its source section, named owner and filled answer or an explicit supplier decision assigned for resolution.',
      'Architecture, telemetry, capacity, security, migration and service annexes use the same product/version, deployment assumptions and operating responsibilities.',
      'Capacity and TCO values recalculate from visible input cells/formulas, units and dated evidence; source values remain distinguishable from the team’s planning assumptions.',
      'Each material supplier capability or performance statement links to the actual supporting document, supported configuration, deployment reference or original measurement.',
      'The partner reviews the production package in one structured walkthrough; review changes are incorporated into a versioned final handover.',
      'The handover opens independently of the working session, retains the original source identities and includes editable deliverables with clear operator instructions.'
    ].join('\n\n'),
    milestones: [
      { id: 'apm2-m1', title: 'Source decomposition and supplier evidence intake', amountCents: 180000, due: '2026-10-15',
        acceptance: 'Original document/template register, assigned requirements master, partner product/deployment selection and complete evidence request list.' },
      { id: 'apm2-m2', title: 'Architecture, telemetry and quantitative model', amountCents: 216000, due: '2026-10-20',
        acceptance: 'Consistent deployment/telemetry architecture, supported option matrix and editable capacity/cost worksheet with explicit units and assumptions.' },
      { id: 'apm2-m3', title: 'Security, migration and operating model review', amountCents: 216000, due: '2026-10-23',
        acceptance: 'Complete security information map, migration/rollback sequence and service responsibilities; partner technical review changes recorded and resolved.' },
      { id: 'apm2-m4', title: 'Final response engineering handover', amountCents: 108000, due: '2026-10-26',
        acceptance: 'Reviewed response package, original-source bundle, editable annexes, evidence register, handover walkthrough and assigned supplier final-submission actions.' }
    ],
    costs: [
      { id: 'apm2-cost-engineering', title: 'Planning basis: 52 engineering hours × CAD 60', amountCents: 312000 },
      { id: 'apm2-cost-review', title: 'Planning basis: 8 technical review hours × CAD 90', amountCents: 72000 },
      { id: 'apm2-cost-delivery', title: 'Planning allowance: document handling and delivery expenses', amountCents: 16000 }
    ],
    note: [
      'Internal service proposal for a participating observability supplier or prime. Status is draft until its delivery and commercial terms are reviewed with that partner.',
      'Proposed fee CAD 7,200; milestone allocation CAD 7,200; entered planning costs CAD 4,000; fee less entered costs CAD 3,200. Capacity is 60 production hours plus six partner/principal hours.',
      'Original buying stage and source identity: SSC APM2 Request for Information, ' + APM2_SOLICITATION +
        ', reference SSC-26-00035133:T. The retained row asks industry for information to support future procurement strategies.',
      'Keep subsequent amendments, partner evidence and saved workshare editions with this source-linked record.'
    ].join('\n\n')
  };
  return {
    schema: 'commons.canadabuys.apm2-operating-content.v1',
    noticeId: notice.id,
    source: { sourceId: entry.sourceId, entryId: entry.id, rowNumber: entry.rowNumber, rowSha256: entry.rowSha256,
      referenceNumber: row['referenceNumber-numeroReference'], solicitationNumber: APM2_SOLICITATION,
      originalClosing: row['tenderClosingDate-appelOffresDateCloture'], closingUTC: closing?.utc || null,
      originalAttachment: attachment },
    review: { disposition: 'reviewing', owner, shortlisted: true,
      nextAction: 'Complete the original RFI document/template register, map the supplier’s actual observability evidence, and prepare the architecture/capacity/security/service workshare for partner review.',
      note: 'Source-selected observability response-engineering opportunity. The retained notice is an RFI for future procurement planning; the saved workshare is our editable supplier-facing delivery proposal.',
      qualification },
    workshare
  };
}
