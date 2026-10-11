import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import solc from 'solc';

const CONTRACTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'contracts');

// Compiles the contract sources at run time. No compiled artifacts are shipped in source.
export function compileContracts() {
  const files = ['CreatorPool.sol', 'DemoToken.sol'];
  const sources = Object.fromEntries(files.map((f) => [f, { content: fs.readFileSync(path.join(CONTRACTS, f), 'utf8') }]));
  const input = {
    language: 'Solidity',
    sources,
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'paris', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } }
  };
  const out = JSON.parse(solc.compile(JSON.stringify(input)));
  const errs = (out.errors || []).filter((e) => e.severity === 'error');
  if (errs.length) throw new Error(errs.map((e) => e.formattedMessage).join('\n'));
  const pick = (f, n) => ({ abi: out.contracts[f][n].abi, bytecode: '0x' + out.contracts[f][n].evm.bytecode.object });
  return { CreatorPool: pick('CreatorPool.sol', 'CreatorPool'), DemoToken: pick('DemoToken.sol', 'DemoToken'), solcVersion: solc.version() };
}
