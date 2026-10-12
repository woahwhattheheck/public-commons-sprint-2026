// MIT. Keep the funded deployment and maintenance plan in the original SCF application.
const SECTIONS = [
  {
    parent: 'Three funded tranches and six priced deliverables',
    heading: 'Existing components and funded deployment changes',
    body: [
      'The six packages extend the maintained product in the two selected installations. Each receiving package includes the usable application and its original configuration, data and operating procedure. The component map below identifies the starting source and the remaining funded change.',
      '',
      '|Package|Maintained starting component|Funded change and receiving result|',
      '| --- | --- | --- |',
      '|T1 resource integration — 80 hours / $7,600|Seller workspace, native HTTP/MCP seller, source adapters and managed distribution.|Adapt the selected source and consumer together. Deliver the exact operation, source edition, typed request/result, complete pagination or file output and selected Stellar payment terms in the merchant and buyer applications.|',
      '|T1 authority and handover — 40 hours / $3,800|Merchant release store, source/terms change and withdrawal, buyer saved output and receiving workspaces.|Connect the actual merchant roles and receiving engineer. Deliver the source/terms change or withdrawal, preserved acquired output and a second operator who can reopen and operate each installation.|',
      '|T2 provider/ledger deployment — 70 hours / $6,650|Native Stellar facilitator, buyer signer and spend governor, independent transfer reconciliation and merchant settlement accounting.|Implement the selected providers’ actual registration and wire differences for the same useful service. Deliver two-provider operation with each original approval, transfer, complete result and fulfillment joined in the existing applications.|',
      '|T2 threat response — 50 hours / $4,750|Existing threat model, operations telemetry, buyer inbox and merchant delivery/recovery records.|Bind observations, notifications and responses to the two real installations; repair material integration findings. Deliver the two stated customer recovery journeys and receiving of the same financial and output state.|',
      '|T3 mainnet rollout — 90 hours / $8,550|Native payment runtime, versioned merchant distribution, fleet release/rollback and recurring customer applications.|Configure the actual mainnet asset, parties, host and provider policies, repair deployment differences and publish the selected release. Deliver recurring independent use with complete output from both merchant installations.|',
      '|T3 recovery and handover — 70 hours / $6,650|Original backup/receiving, buyer and merchant continuity, release history and support/accounting workspaces.|Integrate the selected supervision and off-host retention; implement receiving-host configuration and post-backup reconciliation. Deliver the restored customer application, measured recovery, independent support case and maintainable release handover.|',
      '',
      'A source change is assigned to one package and one selected installation requirement before it enters the estimate. A reusable fix belongs to the public component; customer data, signing material and private configuration stay with the deployment. Package completion includes the corresponding documentation and receiving changes so the next operator can use the delivered capability.',
    ].join('\n'),
  },
  {
    parent: 'Threat response and outcome measurement',
    heading: 'Installed responsibility and response',
    body: [
      'The installation workorder records the responsible operator at each boundary. These responsibilities travel with the maintained service when its receiving engineer changes.',
      '',
      '|Boundary|Responsible operator and working handover|',
      '| --- | --- |',
      '|Source, offer and fulfillment|The merchant selects the authorized source, publication and terms. Its operator retains the release history, full delivery result and original fulfillment/accounting case.|',
      '|Approval, signing and aggregate spend|The buyer operator supplies the existing signer or trusted provider and spending policy. The handover preserves the approved request, reservation and original dispatch; secret references are configured through the receiving host’s existing custody.|',
      '|Facilitator and network|The selected facilitator operator owns its signing capacity, fee policy and service operation. Our integration retains its actual supported metadata, network/RPC observations and original settlement result; a third-party provider keeps its own administrative boundary.|',
      '|Observation, recovery and receiving|Each installation names primary and backup responders, the supported observation sources and notification/acknowledgment route. The receiving engineer obtains the selected release, protected state, complete files and the original open cases.|',
      '',
      'The existing threat model supplies ten threat decisions and eight monitoring/response definitions. Deployment binds them to actual sources, numerical thresholds and responders inside the same T2 package. Process availability, provider readiness, financial outcome and full delivery remain separate observations. A transfer that settled before an interrupted response is recovered through its original entitlement or delivery session. An uncertain transfer is reconciled before any further financial action.',
      '',
      'The acceptance report includes the actual installation coverage and unresolved findings with the two original recovery cases. Public grant reporting uses the outcome counts, timings and sanitized source/version references; request bodies, account credentials, customer files and populated response destinations remain in the operator’s protected workspace.',
    ].join('\n'),
  },
  {
    parent: 'Delivery capacity, payment timing and sustainability',
    heading: 'Maintainable release and support handover',
    body: [
      'The day-150 handover gives each independent operator one source-versioned release, its dependency and license inventory, installation and upgrade instructions, the selected configuration references, and the original customer data/state receiving procedure. It also names the host owner, maintainer, primary and backup responder, service-cost owner and separately agreed care scope. These are deliverables of the existing rollout and recovery packages.',
      '',
      'Updates begin from the deployed source and preserve the merchant’s public resource identity, buyer records and state directories outside the installed package. The operator reviews changed routes, schemas and payment terms, stages the replacement and drains admitted work before switching traffic. A rollback selects a retained release while preserving later purchases and fulfilled output. A receiving-host restore reconciles operations after the backup point before continuing unfinished work.',
      '',
      'During funded delivery, dependency or protocol changes are assessed against the selected Stellar SDK, x402 wire format, token/account behavior and the installations that use them. Necessary compatibility corrections return to the maintained source with the affected operating example and migration instructions. The selected provider’s sponsored-fee declaration, authorization lifetime, accepted payment flow and transaction payload remain explicit parts of that compatibility review.',
      '',
      'At handover, the maintainer receives known limitations, open support cases and the continuation procedure for each one. The installed release and usable customer output remain available for self-operation. Paid care is separately scoped around the actual hosting, response and upgrade responsibilities; the grant’s 400 hours and $38,000 fund the prospective six-package delivery described here.',
    ].join('\n'),
  },
];

const clean = value => String(value).replaceAll('\r\n', '\n').trim() + '\n';

/** Receive these owned subsections without replacing other application answers. */
export function applyGrantDeliveryPlan(markdown) {
  if (typeof markdown !== 'string') throw new TypeError('Select the complete application Markdown.');
  let result = clean(markdown);
  for (const { parent, heading, body } of SECTIONS) {
    const parentLine = '## ' + parent + '\n';
    const begin = result.indexOf(parentLine);
    if (begin < 0 || result.indexOf(parentLine, begin + parentLine.length) >= 0) {
      throw Object.assign(new Error('Retain one original application answer: ' + parent), { code: 'GRANT_DELIVERY_ANSWER_REQUIRED' });
    }
    const afterParent = begin + parentLine.length;
    const next = result.slice(afterParent).search(/^## /m);
    const end = next < 0 ? result.length : afterParent + next;
    let section = result.slice(afterParent, end);
    const ownedLine = '### ' + heading + '\n';
    const old = section.indexOf(ownedLine);
    const addition = ownedLine + body + '\n';
    if (old >= 0) {
      if (section.indexOf(ownedLine, old + ownedLine.length) >= 0) {
        throw Object.assign(new Error('Retain one delivery subsection: ' + heading), { code: 'GRANT_DELIVERY_SUBSECTION_DUPLICATE' });
      }
      const following = section.slice(old + ownedLine.length).search(/^#{1,3} /m);
      const oldEnd = following < 0 ? section.length : old + ownedLine.length + following;
      section = section.slice(0, old) + addition + '\n' + section.slice(oldEnd);
    } else {
      section = clean(section) + '\n' + addition + '\n';
    }
    result = result.slice(0, afterParent) + section + result.slice(end);
  }
  return clean(result);
}
