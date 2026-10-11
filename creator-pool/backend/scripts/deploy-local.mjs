// Deploys DemoToken (local, non-monetary) and CreatorPool to a LOOPBACK local dev chain only.
// It uses the chain's unlocked dev account 0 through RPC. It never reads or prints private keys.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ethers } from 'ethers';
import { compileContracts } from '../lib/compile.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = process.env.CP_DATA_DIR || path.join(HERE, '..', 'data');
const RPC = process.env.RPC_URL || 'http://127.0.0.1:8545';
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(RPC).hostname)) throw new Error('deploy-local only targets a loopback RPC');

const provider = new ethers.JsonRpcProvider(RPC);
const { chainId } = await provider.getNetwork();
if (![1337n, 31337n].includes(chainId)) throw new Error(`refusing: chainId ${chainId} is not a local development chain`);
const accounts = await provider.send('eth_accounts', []);
if (accounts.length < 3) throw new Error('need at least 3 unlocked local dev accounts');
const sponsor = await provider.getSigner(accounts[0]);

const built = compileContracts();
async function deploy(a) {
  const c = await new ethers.ContractFactory(a.abi, a.bytecode, sponsor).deploy();
  const r = await c.deploymentTransaction().wait(1);
  return { c, r };
}
const tok = await deploy(built.DemoToken);
const pl = await deploy(built.CreatorPool);
const supply = 1000000n * 10n ** 6n;
const mr = await (await tok.c.mint(accounts[0], supply)).wait(1);

fs.mkdirSync(DATA, { recursive: true });
fs.writeFileSync(path.join(DATA, 'abi.json'), JSON.stringify({ CreatorPool: built.CreatorPool.abi, DemoToken: built.DemoToken.abi }));
const dep = {
  mode: 'local',
  network: 'Local Ganache EVM (development only)',
  chainId: chainId.toString(),
  poolAddress: await pl.c.getAddress(),
  tokenAddress: await tok.c.getAddress(),
  deployBlock: tok.r.blockNumber,
  solcVersion: built.solcVersion,
  txs: { token: tok.r.hash, pool: pl.r.hash, mintToSponsor: mr.hash },
  assetNotice: 'CPDEMO is a local non-monetary demo token'
};
fs.writeFileSync(path.join(DATA, 'deployment.json'), JSON.stringify(dep, null, 2));
console.log(JSON.stringify(dep, null, 2));
