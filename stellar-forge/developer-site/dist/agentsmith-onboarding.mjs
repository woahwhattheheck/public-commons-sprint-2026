import {parseOffer} from './offer.mjs';
import {zipWorkspace} from './onboarding.mjs';

export const AGENTSMITH_SCHEMA = 'stellar-forge.frontdoor-agentsmith.v1';
export const AGENTSMITH_ASSET = 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA';
export const AGENTSMITH_SOURCE = Object.freeze({
  capturePath: 'stellar/scf-starforge-20261009/partners/agentsmith/capture.py',
  captureSha256: '60dd7f472ec518846f50c222160c53751554648f492d150f384b70fa05fb4381',
  capturedBundleSha256: '18d45f986bc0f53292086f715f8dbafc5cbf92a59f5fb599c0034285d97103a8',
  sourceCommit: '41f15c0e57d2ba9655885399c1b37134e1a81d41',
  walletSourceCommit: 'c3f1f9a930e1a4b08a6d60f5643b98ba2f4a0e1d'
});
const encoder = new TextEncoder();
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const need = (value, message) => { if (!value) throw new Error(message); };
export const sha256 = async text => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',
  typeof text === 'string' ? encoder.encode(text) : text)), byte => byte.toString(16).padStart(2, '0')).join('');
function https(value) {
  need(typeof value === 'string' && value.length < 8192, 'The capture needs its original HTTPS URL.');
  const url = new URL(value);
  need(url.protocol === 'https:' && !url.username && !url.password && !url.hash,
    'Use the original credential-free HTTPS resource.');
  return value;
}

export async function readAgentSmithBundle(text) {
  need(typeof text === 'string' && encoder.encode(text).length <= 24 * 1024 * 1024,
    'Import one complete source bundle of at most 24 MiB.');
  const bundle = JSON.parse(text);
  need(object(bundle) && bundle.schema === 'commons.agentsmith.http-bundle.v1',
    'Select an original AgentSmith HTTP source bundle.');
  const seller = https(bundle.seller), facilitator = https(bundle.facilitator);
  const response = bundle.challenge, supported = bundle.supported;
  need(object(response) && object(supported) && typeof bundle.requestUtf8 === 'string',
    'The complete original request and both HTTP responses are required.');
  need(response.status === 402 && response.url === seller && response.method === 'POST' &&
    supported.status === 200 && supported.url === facilitator.replace(/\/$/, '') + '/supported' &&
    supported.method === 'GET', 'The captured resource, methods or HTTP status changed.');
  need(typeof response.bodyUtf8 === 'string' && typeof supported.bodyUtf8 === 'string',
    'Both original response bodies are required.');
  const requestBytes = encoder.encode(bundle.requestUtf8).length;
  need(requestBytes > 0 && requestBytes <= 16 * 1024 * 1024 &&
    response.requestBodyBytes === requestBytes &&
    response.requestBodySha256 === await sha256(bundle.requestUtf8), 'The captured request bytes changed.');
  need(object(JSON.parse(bundle.requestUtf8)), 'The request must be the original JSON object.');
  need(response.bodySha256 === await sha256(response.bodyUtf8) &&
    supported.bodySha256 === await sha256(supported.bodyUtf8), 'The original HTTP response bytes changed.');
  const {offer} = parseOffer(response.headers?.['payment-required']);
  need(offer.x402Version === 2 && offer.resource?.url === seller, 'The original x402 resource binding changed.');
  need(offer.accepts.length <= 32, 'The original receiving capture accepts at most 32 choices.');
  const selected = offer.accepts.map((choice, index) => ({choice, index})).filter(({choice}) =>
    choice.scheme === 'exact' && choice.network === 'stellar:testnet' && choice.asset === AGENTSMITH_ASSET &&
    choice.extra?.areFeesSponsored === true && (choice.extra.paymentFlow ?? 'authorization') === 'authorization');
  need(selected.length === 1, 'The native receiver needs exactly one sponsored exact testnet USDC choice.');
  const {choice, index} = selected[0];
  need(typeof choice.amount === 'string' && /^[1-9][0-9]*$/.test(choice.amount) &&
    BigInt(choice.amount) <= 9223372036854775807n &&
    /^[GC][A-Z2-7]{55}$/.test(choice.payTo) && Number.isInteger(choice.maxTimeoutSeconds) &&
    choice.maxTimeoutSeconds > 0 && choice.maxTimeoutSeconds <= 86400,
    'The original selected amount, recipient or authorization lifetime is invalid.');
  const kinds = JSON.parse(supported.bodyUtf8).kinds;
  need(Array.isArray(kinds) && kinds.some(kind => kind.x402Version === 2 && kind.scheme === 'exact' &&
    kind.network === 'stellar:testnet' && kind.extra?.areFeesSponsored === true),
    'The original facilitator must advertise sponsored exact Stellar testnet.');
  need(typeof response.retrievedAt === 'string' && Number.isFinite(Date.parse(response.retrievedAt)),
    'The original capture timestamp is required.');
  return {text, bundle, offer, selected: choice, acceptIndex: index, requestBytes,
    capturedAt: response.retrievedAt, bundleSha256: await sha256(text)};
}

export function validateAgentSmithInput(input) {
  need(object(input) && input.schema === AGENTSMITH_SCHEMA, 'Open a saved AgentSmith receiving draft.');
  const folder = input.folder?.trim();
  need(typeof folder === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(folder) && !['.', '..'].includes(folder),
    'Use a simple packet folder name.');
  const privateDirectory = input.privateDirectory?.trim();
  need(typeof privateDirectory === 'string' && privateDirectory.startsWith('/') && privateDirectory !== '/' &&
    !privateDirectory.endsWith('/') && !/[\u0000-\u001f\u007f\\]/.test(privateDirectory) &&
    privateDirectory.split('/').slice(1).every(part => part && part !== '.' && part !== '..'),
    'Choose a new absolute private directory on the receiving Linux host.');
  need(typeof input.intentId === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(input.intentId),
    'Choose one stable operation ID using letters, digits, dot, colon, dash or underscore.');
  need(typeof input.actor === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(input.actor),
    'Choose the receiving operator ID.');
  need(typeof input.payer === 'string' && (!input.payer || /^G[A-Z2-7]{55}$/.test(input.payer)),
    'Enter the intended Freighter public account, or leave it for operator initialization.');
  return {...input, folder, privateDirectory};
}

export function importAgentSmithDraft(text) {
  const draft = JSON.parse(text);
  need(object(draft) && draft.schema === AGENTSMITH_SCHEMA && typeof draft.sourceText === 'string',
    'Select the complete saved receiving draft.');
  return draft;
}

const quote = value => "'" + String(value).replaceAll("'", "'\\''") + "'";
export function agentSmithCommands(input) {
  const common = ['node', 'buyer.mjs'];
  const actions = ['prepare', 'review', 'operator-init', 'wallet-prepare', 'wallet-serve', 'execute', 'inspect'];
  return actions.map(action => ({action, argv:[...common, action, '--toolkit', '/ABSOLUTE/EXISTING/TOOLKIT'],
    command: [...common, action, '--toolkit', '/ABSOLUTE/EXISTING/TOOLKIT'].map(quote).join(' ')}));
}

export async function createAgentSmithPacket(input, {runnerSource, captureSource, licenseSource}) {
  const saved = validateAgentSmithInput(input), source = await readAgentSmithBundle(saved.sourceText);
  need(typeof runnerSource === 'string' && runnerSource.includes('stellar-forge.frontdoor-agentsmith-packet.v1'),
    'Load the maintained native packet runner.');
  need(await sha256(captureSource) === AGENTSMITH_SOURCE.captureSha256,
    'The original AgentSmith capture program changed; reload the matching receiving page.');
  need(typeof licenseSource === 'string' && licenseSource.startsWith('MIT License\n') &&
    licenseSource.includes('Permission is hereby granted'), 'Load the original distribution license.');
  const config = {schema:'stellar-forge.frontdoor-agentsmith-packet.v1',
    privateDirectory:saved.privateDirectory, intentId:saved.intentId, actor:saved.actor, payer:saved.payer,
    sourceBundleSha256:source.bundleSha256, captureSha256:AGENTSMITH_SOURCE.captureSha256,
    runnerSha256:await sha256(runnerSource), sourceCommit:AGENTSMITH_SOURCE.sourceCommit,
    walletSourceCommit:AGENTSMITH_SOURCE.walletSourceCommit};
  const commands = agentSmithCommands(saved);
  const lines = ['# Stellar Forge — AgentSmith receiving packet', '',
    'This packet carries the original request and offer into the maintained native buyer and Freighter operator flow.', '',
    '## Prepare the receiving host', '',
    'Use Linux, Node.js 22.16 or newer and Python 3.11 or newer. Keep the complete existing toolkit installation or source checkout. The browser-wallet component must be included for wallet actions. The runner accepts the checkout root, the installed package root containing source/, or the original Stellar component root.', '',
    'Unzip into a private directory. Replace /ABSOLUTE/EXISTING/TOOLKIT in the commands with that actual root. The selected private operation directory is ' + saved.privateDirectory + '.', '',
    'Select the native and freighter-wallet features in the maintained runtime. It uses the original @x402 2.28.0 engine, Stellar SDK satisfying ^16.3.0, and @stellar/freighter-api 6.0.1. Keep them in the same dependency tree as the original source. The connected browser needs the Freighter extension.', '',
    'For an existing Node application that already manages the toolkit dependencies:', '',
    '```sh', 'npm install --save-exact @stellar/freighter-api@6.0.1', 'starforge doctor --native --feature freighter-wallet', '```', '',
    '## Review this original source', '',
    'Captured: ' + source.capturedAt, 'Resource: ' + source.bundle.seller,
    'Method: POST', 'Request: ' + source.requestBytes + ' exact UTF-8 bytes',
    'Selected choice: ' + source.acceptIndex + ', exact / stellar:testnet / sponsored authorization',
    'Asset: ' + source.selected.asset, 'Recipient: ' + source.selected.payTo,
    'Maximum atomic amount: ' + source.selected.amount,
    'Authorization lifetime: ' + source.selected.maxTimeoutSeconds + ' seconds', '',
    'The complete original offer, all alternatives, response headers, and request bytes remain in source-http.json. Preparation restores them and asks the original buyer to prepare and review. Native execution obtains current merchant terms before approval. A changed request or payment selection requires review in that same original flow.', '',
    '## Run the original operation', '',
    '1. Prepare the original capture and native request; the same command resumes completed preparation without replacing its files.', '',
    '```sh', commands[0].command, commands[1].command, '```', '',
    '2. Initialize the original operator. ' + (saved.payer ? 'The selected public payer is ' + saved.payer + '.' : 'Append --payer followed by the actual Freighter public account to operator-init. No private key is needed in this packet.'), '',
    '```sh', commands[2].command, commands[3].command, '```', '',
    '3. Start the private wallet server and open its printed loopback URL in a browser with Freighter. Connect the intended account on Stellar testnet. Keep this terminal running.', '',
    '```sh', commands[4].command, '```', '',
    '4. In a second terminal run execute, inspect the exact terminal approval, and approve the original authorization entry in Freighter when requested.', '',
    '```sh', commands[5].command, '```', '',
    'The original buyer saves the useful response at ' + saved.privateDirectory + '/request/metar-result.json. The original operator and wallet remain at operator/ and wallet/ inside that same directory.', '',
    '5. Inspect or reopen the same operation after an interruption.', '',
    '```sh', commands[6].command, '```', '',
    'The runner never chooses a new intent or starts another payment to repair a saved result. Its status shows the existing source, request, operator, wallet and response. Use the original buyer and wallet recovery instructions for an unfinished execution. Keep the original private operator keys and ledger together on their authorized host.', '',
    '## Receive current terms for a new operation', '',
    'capture.py also provides capture --directory NEW_SOURCE --url ORIGINAL_RESOURCE --facilitator ORIGINAL_FACILITATOR --body-file ORIGINAL_REQUEST. It sends the real unpaid POST and facilitator request. Give a genuinely new purchase its own stable intent and new reviewed packet; retain the previous operation and its result.', '',
    '## Reopen or transfer this preparation', '',
    'Import setup-input.json into the same receiving page to edit the packet. It preserves the exact source text. Transfer the whole downloaded packet to the receiving engineer; it contains public request/offer source and preparation settings. Keep actual operator state on the authorized private host. INSTALL.json carries command arrays for tools that avoid shell parsing.', '',
    'TokenJunkieLabs', 'MIT license applies to the original integration and these receiving files.', ''];
  const files = [
    {path:saved.folder + '/setup-input.json',content:JSON.stringify(saved,null,2) + '\n'},
    {path:saved.folder + '/packet.json',content:JSON.stringify(config,null,2) + '\n'},
    {path:saved.folder + '/source-http.json',content:saved.sourceText},
    {path:saved.folder + '/request.json',content:source.bundle.requestUtf8},
    {path:saved.folder + '/capture.py',content:captureSource},
    {path:saved.folder + '/buyer.mjs',content:runnerSource},
    {path:saved.folder + '/INSTALL.json',content:JSON.stringify({schema:'stellar-forge.frontdoor-command-list.v1',commands},null,2) + '\n'},
    {path:saved.folder + '/README.md',content:lines.join('\n')},
    {path:saved.folder + '/LICENSE',content:licenseSource}
  ];
  return {files, zip:zipWorkspace(files), source, config, commands};
}
