// MIT. Concrete commands derived from the same original host plan.
import { join } from 'node:path';
import { shellWord as q } from './host.mjs';
import { retainedOperations } from './retained-runbook.mjs';

export function renderRunbook(p, bundle) {
  const root = join(p.sourceRoot, 'stellar/scf-starforge-20261009');
  const cli = `${q(p.node)} ${q(join(root, 'sf99-merchant-deploy/cli.mjs'))}`;
  const recovery = `${q(p.node)} ${q(join(root, 'sf101-merchant-recovery/recover.mjs'))}`;
  const names = p.services.map(s => s.unit).join(' ');
  const files = [...p.services.map(s => s.unit), p.target].map(n => q(join(bundle, n))).join(' ');
  const readable = ['deployment.json','RUNBOOK.md','Caddyfile','recovery-plan.json',
    p.target,...p.services.map(s => s.unit)].map(n => q(join(bundle,n))).join(' ');
  return `# ${p.merchant}: original Stellar Forge host

Profile: **${p.kind} / ${p.mode}**. Public origin: ${p.publicOrigin}.
Source: ${p.sourceRoot}.${p.operationsPort ? ` Operator: http://127.0.0.1:${p.operationsPort}/.` : ' Operator: original retained release CLI and private catalog controls.'}
This bundle uses the original product entry points. Configuration and original
merchant stores remain at their selected paths. Keep this private bundle at
${bundle}: service preflight refers to this exact location.

## Prepare the selected Linux host

Use an existing unprivileged account ${p.serviceUser}:${p.serviceGroup}, Node 22+,
systemd, Caddy 2, and util-linux flock. ${p.receiverState ? 'The receiver and checkout also require Python 3.11+ with the standard library.' : ''}
Ensure the service account can traverse the source and configuration directories,
read its application/assets, and execute the selected runtimes. Install native
x402 dependencies for the selected committed release before choosing native mode.
Use the original SF46 distribution doctor for its package versions.

Create the original state root, owned by that account:

\`\`\`sh
install -d -m 0700 -o ${p.serviceUser} -g ${p.serviceGroup} ${q(p.stateRoot)}
\`\`\`

${p.environmentFile ? `Provision ${p.environmentFile} through the merchant's secret manager, as a regular
0600 file with a traversable parent directory. Its format is systemd EnvironmentFile
assignments, without shell export commands. The original worker and receiver use
SF98_WEBHOOK_SECRET, the same 32–1024-byte key; upstream configuration uses its own
named environment values. The generator does not read, copy or print those values.
Keep configuration, bearer claim tokens and recovery passphrases private.\n` : 'This profile does not select a shared environment file.\n'}
${p.receiverState ? `The receiver service initializes its original SQLite schema idempotently before
serving. Checkout state is ${p.receiverState}; original delivery outbox is ${p.outbox}.
Enroll approved real files through the ORIGINAL checkout.mjs workflow and retain
its handoff. The seller service is checkout.mjs, which binds the same approved
order query/header, file, native terms and receiver state before payment. See
sf101-merchant-receiver/CHECKOUT.md for enrollment, buyer approval and download.
Keep approved file bytes under ${p.stateRoot}, or include their storage root in
a separate private recovery plan before snapshotting. The original database retains
their path and digest; it does not contain the file bytes.\n` : `The original seller configuration is ${p.configPath}.\n`}
Challenge mode advertises original unpaid challenges. Native mode uses the
explicit facilitator and original SDK.${p.delivery ? ` Delivery independently processes any
events already present in its selected outbox; use a fresh private state root for
a demonstration.` : ''} Starting this service never enrolls a customer or signs a purchase.

## Review and install the generated configuration

\`\`\`sh
chown root:${p.serviceGroup} ${q(bundle)} ${readable}
chmod 0750 ${q(bundle)}
chmod 0640 ${readable}
${cli} check --bundle ${q(bundle)}
runuser -u ${p.serviceUser} -g ${p.serviceGroup} -- ${cli} check --bundle ${q(bundle)}
systemd-analyze verify ${files}
caddy adapt --adapter caddyfile --config ${q(join(bundle, 'Caddyfile'))} --pretty
install -m 0644 ${files} /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now ${p.target}
${cli} smoke --bundle ${q(bundle)}
\`\`\`

The bundle is root-owned and readable by the service group; the service cannot
rewrite its preflight artifacts. Its parent directories must allow that account
to traverse them. The runuser check must succeed before starting services; it
also catches inaccessible source/configuration paths. A bundle left root-only
at 0700/0600 cannot be read by the unprivileged ExecStartPre command.

Check every component; a target groups services but its active state alone does
not establish application readiness. The smoke command reads the actual original
seller readiness and offers${p.operationsPort ? ', private operations' : ', retained process/source identity'}${p.receiverState ? ', plus receiver health' : ''}${p.discovery ? ', plus discovery readiness/resources' : ''}.
It sends no payment header and executes no paid merchant operation.

Merge this bundle's Caddyfile fragment into the host's EXISTING Caddy configuration.
The origin must resolve to this host and its existing firewall must admit the
selected HTTPS service. Validate the complete host configuration and reload the
existing Caddy service through its normal installation. Preserve other merchants.
Caddy performs the actual certificate issuance and renewal on that configured host.

\`\`\`sh
caddy validate --adapter caddyfile --config /etc/caddy/Caddyfile
systemctl reload caddy
${cli} smoke --bundle ${q(bundle)} --public
\`\`\`

The fragment admits the original route/method pairs and seller documentation.
It preserves request query strings, original payment headers and order identity.
It does not expose the operations port, readiness/health, diagnostics or private exports.
${p.receiverState ? `Only POST /internal/x402-events rewrites to the original receiver's /sf98/events.
GET /deliver/ORDER reaches that same receiver, retaining its bearer token and
original entitlement/access rules. Both remain on ${p.publicOrigin}, matching the
original buyer handoff. Receiver health remains private.\n` : ''}
Backend keepalive is disabled to prevent Go's HTTP transport from automatically
retrying an idempotent paid request on a stale reused connection. There is no
configured proxy retry, response cache or access-log directive in this fragment.
Inspect any existing global Caddy policy when importing it; prevent private bearer,
order and payment values from entering the host's existing logs.

## Operate and diagnose

\`\`\`sh
systemctl status ${p.target} ${names}
journalctl ${p.services.map(s => '-u ' + s.unit).join(' ')} --since today
${cli} smoke --bundle ${q(bundle)}
${p.delivery ? `${q(p.node)} ${q(join(root, 'sf98-merchant-delivery/worker.mjs'))} status --state ${q(p.outbox)}\n` : ''}\`\`\`

${p.operationsPort ? `The private operations interface is loopback-only. Use the host's existing SSH
tunnel or private access workflow, retaining its original Host/Origin checks.` : 'Use the original retained release and catalog commands below through the host’s existing private access workflow.'}
${p.delivery || p.receiverState ? 'An accepted webhook and a separately delivered file remain distinct outcomes.\n' : ''}
${p.delivery ? `The continuous worker reuses the original eight-attempt retry budget and private
checkpoint. A crash releases its Linux lock; restart resumes saved events. A
competing sender exits75, and the unit avoids a busy-restart loop. Do not run an
older unlocked drain beside this worker. SERVICE.md supplies exact retry/requeue
and cancellation behavior.\n` : ''}

${retainedOperations(p)}
## Stop, upgrade and recover

For this installed systemd/Caddy host, the source release includes the complete
maintenance and restored-state cutover command:

\`\`\`sh
${cli} maintenance --help
\`\`\`

sf99-merchant-deploy/MAINTENANCE.md carries its actual plan format, declared writer
group, encrypted backup, restored file/configuration paths, service activation,
interruption recovery and rollback. It maintains only this merchant's imported
Caddy fragment. The direct original engine sequence remains below.

Remove this merchant's public ingress before maintenance using the existing
Caddy configuration procedure. This bundle does not stop a shared Caddy service.
Stop the entire original component group:

\`\`\`sh
systemctl stop ${p.target}
systemctl is-active ${names}
\`\`\`

${p.release ? `The dependency order stops the original retained seller first, then its catalog
writer. The release manager drains its owned accepted work and the original
catalog completes accepted writes before closing its journal.` : `The dependency order stops the seller first, then sender, then receiver. The
original seller drains accepted work while its operations observer remains attached;
the sender retains ambiguous attempts for retry.`} Confirm all components stopped.
Also stop any separately operated catalog, application or database writers before
declaring their data quiesced. An inactive target does not prove unrelated writers
stopped. The generated recovery plan includes this merchant's state and selected
configuration files. To include other owned roots, copy recovery-plan.json to a
separate private path, edit that copy without nested/overlapping roots, and use
the copy's path for --plan in the snapshot command below. Keep the generated
bundle intact so its installation preflight continues to match. Credentials remain in their existing
secret store and have their own recovery procedure.

With all listed writers stopped, invoke the original encrypted recovery tool:

\`\`\`sh
${recovery} snapshot --plan ${q(join(bundle, 'recovery-plan.json'))} --out /private/backups/NEW_MERCHANT_BACKUP --pass-env SF101_RECOVERY_PASSPHRASE --quiesced
${recovery} verify --bundle /private/backups/NEW_MERCHANT_BACKUP --pass-env SF101_RECOVERY_PASSPHRASE
${recovery} restore --bundle /private/backups/NEW_MERCHANT_BACKUP --out /private/drills/NEW_RESTORE --pass-env SF101_RECOVERY_PASSPHRASE
\`\`\`

Choose actual new backup/restore locations and provision the passphrase privately.
Restore goes to a new directory. Use the original SF101/SF108 continuity/parity
workflow to reconcile journals and order state before selecting recovered data.
The deployment generator never replaces a live database or claims data parity.

For an upgrade, stage/select the exact original SF46 release, regenerate this host
bundle against its original source and current configuration, review the changes,
install the resulting units, daemon-reload, then start ${p.target}. Check the local
services before returning public ingress. Keep each selected source release
immutable: preflight hashes the selected configuration and service entrypoints,
not all transitive imports. Changing those tracked bytes makes the old bundle
preflight fail so its previous route map cannot silently serve new terms.
For a code rollback, select the retained earlier release and its compatible host
bundle; keep current journals and databases. Data rollback is a separate original
recovery operation. Keep the earlier configuration and source available for that
explicit rollback. No deployment step needs GitHub Actions or a new hosting purchase.
`;
}
