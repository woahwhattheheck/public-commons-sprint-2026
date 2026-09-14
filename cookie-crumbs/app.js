import { composeReceipt, parseReceipt, parsedTransactionSignedBy, shortAddress, utf8Bytes, MAX_MEMO_BYTES } from './receipt.mjs';

const RPC_URL = 'https://rpc.cookiescan.io';
const WS_URL = 'https://wss.cookiescan.io';
const EXPLORER = 'https://cookiescan.io';
const MEMO_PROGRAM_ID = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
const HISTORY_LIMIT = 12;

const state = {
  connection: null,
  wallet: null,
  account: null,
  publicKey: null,
  genesisHash: null,
  lastReceipt: null,
};

const $ = (id) => document.getElementById(id);
const elements = {
  walletStatus: $('wallet-status'),
  walletAddress: $('wallet-address'),
  connect: $('connect-wallet'),
  disconnect: $('disconnect-wallet'),
  refresh: $('refresh-dashboard'),
  rpcStatus: $('rpc-status'),
  rpcDetails: $('rpc-details'),
  balance: $('balance'),
  slot: $('slot'),
  tps: $('tps'),
  epoch: $('epoch'),
  form: $('receipt-form'),
  kind: $('receipt-kind'),
  subject: $('receipt-subject'),
  note: $('receipt-note'),
  preview: $('receipt-preview'),
  byteCount: $('byte-count'),
  write: $('write-receipt'),
  writeStatus: $('write-status'),
  latestTx: $('latest-tx'),
  history: $('history'),
  historyStatus: $('history-status'),
};

function web3() {
  if (!window.solanaWeb3) throw new Error('Solana web3 bundle did not load. Check your network and reload.');
  return window.solanaWeb3;
}

function setStatus(node, text, tone = 'neutral') {
  node.textContent = text;
  node.dataset.tone = tone;
}

function randomId() {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function getNightly() {
  return window.nightly?.solana ?? null;
}

function getFeature(wallet, names) {
  for (const name of names) {
    const feature = wallet?.features?.[name];
    if (feature) return feature;
  }
  return null;
}

async function ensureConnection() {
  if (!state.connection) {
    state.connection = new (web3().Connection)(RPC_URL, {
      commitment: 'confirmed',
      wsEndpoint: WS_URL,
    });
  }
  return state.connection;
}

async function connectWallet() {
  setStatus(elements.walletStatus, 'Connecting to Nightly…');
  const wallet = getNightly();
  if (!wallet) {
    throw new Error('Nightly Wallet was not detected. Install Nightly, enable the extension, then reload.');
  }

  const connection = await ensureConnection();
  const genesisHash = await connection.getGenesisHash();
  state.genesisHash = genesisHash;

  if (typeof wallet.changeNetwork === 'function' && wallet.genesisHash !== genesisHash) {
    await wallet.changeNetwork({ genesisHash, url: RPC_URL });
  }

  const connectFeature = getFeature(wallet, ['standard:connect']);
  if (!connectFeature?.connect) throw new Error('Nightly does not expose the standard connect feature.');
  const result = await connectFeature.connect({ silent: false });
  const account = result?.accounts?.[0];
  if (!account) throw new Error('Nightly returned no authorized account.');

  const publicKey = new (web3().PublicKey)(account.address || account.publicKey);
  state.wallet = wallet;
  state.account = account;
  state.publicKey = publicKey;

  elements.walletAddress.textContent = publicKey.toBase58();
  elements.connect.hidden = true;
  elements.disconnect.hidden = false;
  setStatus(elements.walletStatus, `Nightly connected · ${shortAddress(publicKey.toBase58())}`, 'good');
  await refreshDashboard();
}

async function disconnectWallet() {
  const feature = getFeature(state.wallet, ['standard:disconnect']);
  if (feature?.disconnect) await feature.disconnect();
  state.wallet = null;
  state.account = null;
  state.publicKey = null;
  elements.walletAddress.textContent = 'Not connected';
  elements.connect.hidden = false;
  elements.disconnect.hidden = true;
  setStatus(elements.walletStatus, 'Wallet disconnected');
  elements.balance.textContent = '—';
  elements.history.innerHTML = '';
  setStatus(elements.historyStatus, 'Connect Nightly to index your recent Cookie Crumbs receipts.');
}

async function refreshNetworkHealth() {
  const connection = await ensureConnection();
  const [version, slot, epochInfo, samples, genesisHash] = await Promise.all([
    connection.getVersion(),
    connection.getSlot('confirmed'),
    connection.getEpochInfo('confirmed'),
    connection.getRecentPerformanceSamples(1),
    connection.getGenesisHash(),
  ]);

  const sample = samples?.[0];
  const tps = sample?.samplePeriod ? sample.numTransactions / sample.samplePeriod : null;
  state.genesisHash = genesisHash;
  elements.slot.textContent = slot.toLocaleString();
  elements.tps.textContent = tps === null ? '—' : `${Math.round(tps).toLocaleString()} tx/s`;
  elements.epoch.textContent = `${epochInfo.epoch} · ${Math.round((epochInfo.slotIndex / epochInfo.slotsInEpoch) * 100)}%`;
  elements.rpcDetails.textContent = `RPC ${RPC_URL} · core ${version['solana-core'] ?? 'unknown'} · genesis ${shortAddress(genesisHash, 7, 7)}`;
  setStatus(elements.rpcStatus, 'Cookie Chain RPC healthy', 'good');
}

async function refreshWalletFacts() {
  if (!state.publicKey) return;
  const connection = await ensureConnection();
  const lamports = await connection.getBalance(state.publicKey, 'confirmed');
  elements.balance.textContent = `${(lamports / web3().LAMPORTS_PER_SOL).toLocaleString(undefined, { maximumFractionDigits: 6 })} COOK`;
}

function instructionMemo(instruction) {
  const programId = instruction?.programId?.toBase58?.() ?? instruction?.programId?.toString?.() ?? '';
  if (programId !== MEMO_PROGRAM_ID && instruction?.program !== 'spl-memo') return null;
  if (typeof instruction.parsed === 'string') return instruction.parsed;
  if (typeof instruction.parsed?.info === 'string') return instruction.parsed.info;
  if (typeof instruction.parsed?.memo === 'string') return instruction.parsed.memo;
  return null;
}

async function fetchReceipt(signatureInfo) {
  const connection = await ensureConnection();
  const tx = await connection.getParsedTransaction(signatureInfo.signature, {
    commitment: 'confirmed',
    maxSupportedTransactionVersion: 0,
  });
  if (!tx) return null;
  const walletAddress = state.publicKey?.toBase58?.();
  if (!parsedTransactionSignedBy(tx, walletAddress)) return null;
  for (const instruction of tx.transaction.message.instructions) {
    const memo = instructionMemo(instruction);
    if (!memo) continue;
    try {
      const receipt = parseReceipt(memo);
      if (receipt) return { ...receipt, signature: signatureInfo.signature, slot: signatureInfo.slot };
    } catch {
      // Ignore malformed or foreign memo payloads; this index is intentionally app-specific.
    }
  }
  return null;
}

function renderHistory(receipts) {
  elements.history.innerHTML = '';
  if (!receipts.length) {
    setStatus(elements.historyStatus, 'No Cookie Crumbs receipts found in the latest wallet activity.');
    return;
  }
  setStatus(elements.historyStatus, `${receipts.length} receipt${receipts.length === 1 ? '' : 's'} found in recent activity.`, 'good');
  for (const receipt of receipts) {
    const item = document.createElement('li');
    const title = document.createElement('strong');
    title.textContent = `${receipt.kind} · ${receipt.subject}`;
    const meta = document.createElement('span');
    meta.textContent = `${new Date(receipt.createdAt).toLocaleString()} · slot ${receipt.slot.toLocaleString()}`;
    const note = document.createElement('p');
    note.textContent = receipt.note || 'No note';
    const link = document.createElement('a');
    link.href = `${EXPLORER}/tx/${encodeURIComponent(receipt.signature)}`;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = shortAddress(receipt.signature, 8, 8);
    item.append(title, meta, note, link);
    elements.history.append(item);
  }
}

async function refreshHistory() {
  if (!state.publicKey) return;
  setStatus(elements.historyStatus, 'Indexing recent wallet activity…');
  const connection = await ensureConnection();
  const signatures = await connection.getSignaturesForAddress(state.publicKey, { limit: HISTORY_LIMIT }, 'confirmed');
  const receipts = [];
  for (const signatureInfo of signatures) {
    const receipt = await fetchReceipt(signatureInfo);
    if (receipt) receipts.push(receipt);
  }
  renderHistory(receipts);
}

async function refreshDashboard() {
  elements.refresh.disabled = true;
  try {
    await refreshNetworkHealth();
    if (state.publicKey) await Promise.all([refreshWalletFacts(), refreshHistory()]);
  } catch (error) {
    setStatus(elements.rpcStatus, `RPC check failed: ${friendlyError(error)}`, 'bad');
  } finally {
    elements.refresh.disabled = false;
  }
}

function currentReceipt() {
  return composeReceipt({
    kind: elements.kind.value,
    subject: elements.subject.value,
    note: elements.note.value,
    createdAt: new Date(),
    id: state.lastReceipt?.draftId ?? randomId(),
  });
}

function updatePreview() {
  try {
    const draftId = state.lastReceipt?.draftId ?? randomId();
    state.lastReceipt = { draftId };
    const memo = composeReceipt({
      kind: elements.kind.value,
      subject: elements.subject.value,
      note: elements.note.value,
      createdAt: new Date(),
      id: draftId,
    });
    elements.preview.textContent = memo;
    elements.byteCount.textContent = `${utf8Bytes(memo)} / ${MAX_MEMO_BYTES} bytes`;
    elements.write.disabled = !state.publicKey;
    setStatus(elements.writeStatus, state.publicKey ? 'Ready to sign. Nothing is sent until you click “Write receipt on-chain”.' : 'Connect Nightly to enable signing.');
  } catch (error) {
    elements.preview.textContent = friendlyError(error);
    elements.byteCount.textContent = `limit ${MAX_MEMO_BYTES} bytes`;
    elements.write.disabled = true;
    setStatus(elements.writeStatus, friendlyError(error), 'bad');
  }
}

async function signWithNightly(transaction) {
  const feature = getFeature(state.wallet, ['solana:signTransaction', 'standard:signTransaction']);
  if (!feature?.signTransaction) throw new Error('Nightly does not expose a Solana transaction signing feature.');
  const serialized = transaction.serialize({ requireAllSignatures: false, verifySignatures: false });
  const outputs = await feature.signTransaction({
    account: state.account,
    transaction: serialized,
  });
  const signed = outputs?.[0]?.signedTransaction;
  if (!signed) throw new Error('Nightly returned no signed transaction.');
  return signed;
}

async function writeReceipt(event) {
  event.preventDefault();
  if (!state.publicKey || !state.wallet || !state.account) {
    setStatus(elements.writeStatus, 'Connect Nightly before writing a receipt.', 'bad');
    return;
  }

  elements.write.disabled = true;
  try {
    const memo = currentReceipt();
    elements.preview.textContent = memo;
    elements.byteCount.textContent = `${utf8Bytes(memo)} / ${MAX_MEMO_BYTES} bytes`;
    setStatus(elements.writeStatus, 'Building transaction…');

    const connection = await ensureConnection();
    const { Transaction, TransactionInstruction, PublicKey } = web3();
    const latest = await connection.getLatestBlockhash('confirmed');
    const transaction = new Transaction({
      feePayer: state.publicKey,
      recentBlockhash: latest.blockhash,
    }).add(new TransactionInstruction({
      keys: [],
      programId: new PublicKey(MEMO_PROGRAM_ID),
      data: new TextEncoder().encode(memo),
    }));

    setStatus(elements.writeStatus, 'Awaiting Nightly signature…');
    const signedTransaction = await signWithNightly(transaction);
    setStatus(elements.writeStatus, 'Submitting to Cookie Chain…');
    const signature = await connection.sendRawTransaction(signedTransaction, {
      skipPreflight: false,
      maxRetries: 3,
      preflightCommitment: 'confirmed',
    });

    elements.latestTx.href = `${EXPLORER}/tx/${encodeURIComponent(signature)}`;
    elements.latestTx.textContent = `View ${shortAddress(signature, 9, 9)} on CookieScan`;
    elements.latestTx.hidden = false;
    setStatus(elements.writeStatus, `Submitted ${shortAddress(signature, 9, 9)} · confirming…`);

    const confirmation = await connection.confirmTransaction({
      signature,
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
    }, 'confirmed');
    if (confirmation.value.err) throw new Error(`Transaction confirmed with error: ${JSON.stringify(confirmation.value.err)}`);

    setStatus(elements.writeStatus, 'Receipt confirmed on Cookie Chain.', 'good');
    state.lastReceipt = null;
    updatePreview();
    await Promise.all([refreshWalletFacts(), refreshHistory(), refreshNetworkHealth()]);
  } catch (error) {
    setStatus(elements.writeStatus, friendlyError(error), 'bad');
  } finally {
    elements.write.disabled = !state.publicKey;
  }
}

function friendlyError(error) {
  const message = String(error?.message ?? error ?? 'Unknown error');
  if (/rejected|declined|denied|cancel/i.test(message)) return 'Signature request was rejected. No receipt was written.';
  if (/blockhash/i.test(message)) return 'The transaction expired before confirmation. Refresh and try again.';
  if (/insufficient|balance|funds/i.test(message)) return 'Insufficient COOK to pay the transaction fee.';
  if (/failed to fetch|network|rpc/i.test(message)) return `Cookie Chain RPC/network error: ${message}`;
  return message;
}

for (const input of [elements.kind, elements.subject, elements.note]) input.addEventListener('input', updatePreview);
elements.connect.addEventListener('click', () => connectWallet().catch((error) => setStatus(elements.walletStatus, friendlyError(error), 'bad')));
elements.disconnect.addEventListener('click', () => disconnectWallet().catch((error) => setStatus(elements.walletStatus, friendlyError(error), 'bad')));
elements.refresh.addEventListener('click', refreshDashboard);
elements.form.addEventListener('submit', writeReceipt);

updatePreview();
refreshNetworkHealth().catch((error) => setStatus(elements.rpcStatus, friendlyError(error), 'bad'));
