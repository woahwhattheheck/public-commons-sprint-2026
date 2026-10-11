// MIT
'use strict';

class StarforgeBuyerWorkspace {
  constructor() {
    this.name = 'starforgeBuyerWorkspace';
    this.displayName = 'Starforge Buyer Workspace';
    this.documentationUrl = 'https://github.com/woahwhattheheck/public-commons-sprint-2026/tree/main/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/n8n';
    this.properties = [
      { displayName: 'Original SF88 Runtime Directory', name: 'runtimeDirectory', type: 'string',
        default: '', required: true, placeholder: '/srv/starforge/source/stellar/scf-starforge-20261009/sf88-operator-buyer-cli',
        description: 'Installed original directory containing cli.mjs and node/index.mjs; accessible to the n8n process' },
      { displayName: 'Existing Node Application State', name: 'stateDirectory', type: 'string',
        default: '', required: true, placeholder: '/srv/private/customer-purchases',
        description: 'Existing private canonical Node buyer state directory, owned by the same operating-system user' },
      { displayName: 'Existing Native Inbox', name: 'inboxDirectory', type: 'string',
        default: '', required: true, placeholder: '/srv/private/customer-inbox',
        description: 'Original private inbox already initialized through the native buyer; no replacement is created' },
      { displayName: 'Original Operator Profile File', name: 'operatorProfile', type: 'string',
        default: '', placeholder: '/srv/private/operator-profile.json',
        description: 'Required for merchant handoff intake only when no operator workspace is selected; path to the original private profile' },
      { displayName: 'Original Operator Workspace', name: 'workspaceDirectory', type: 'string',
        default: '', placeholder: '/srv/private/original-operator',
        description: 'Binds new handoff intake, the reviewed terminal command and original reservation finalization to this same native workspace' },
      { displayName: 'Original Merchant Outbox', name: 'outboxDirectory', type: 'string', default: '',
        description: 'Optional existing outbox for merchant finalization; pair it with an explicit merchant route' },
      { displayName: 'Private Report Directory', name: 'reportDirectory', type: 'string', default: '',
        description: 'Existing private export directory; leave empty to use n8n-reports inside the original Node state' },
      { displayName: 'Native Command Timeout (Milliseconds)', name: 'timeoutMs', type: 'number',
        default: 360000, typeOptions: { minValue: 1000, maxValue: 3600000 },
        description: 'Timeout for the original native command and its maintained cleanup handling' },
    ];
  }
}
module.exports = { StarforgeBuyerWorkspace };
