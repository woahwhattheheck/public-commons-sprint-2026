// MIT. Complete private Turbolong source/runtime retention and original-command execution.
// Original publisher: https://github.com/Dgetsylver/TurboLong/tree/f017de605bb020bf3d7f4285aae4c654508e8d86
// The independently authored companion does not redistribute the original unlicensed source.
import {createHash, randomUUID} from 'node:crypto';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {constants} from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {getTurbolongAction,validateTurbolongArguments} from './catalogue.mjs';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const SCHEMA='stellar-forge.turbolong-operations.runtime.v1';
const BUFFER_BYTES=256*1024;
const SHA256=/^[a-f0-9]{64}$/;
const PACKAGE_NAME=/^(?:@[A-Za-z0-9._~-]+\/)?[A-Za-z0-9_~-][A-Za-z0-9._~-]*$/;
const VCS=new Set(['.git','.hg','.svn']);
const FILE_HASH_CACHE=new Map();
const FILE_HASH_CACHE_LIMIT=8192;

export class TurbolongRuntimeError extends Error {
  constructor(code, details = {}, cause) {
    super(code, cause ? {cause} : undefined);
    this.name = 'TurbolongRuntimeError';
    this.code = code;
    this.details = details;
  }
  toJSON() { return {code: this.code, details: this.details}; }
}
function fail(code, details, cause) { throw new TurbolongRuntimeError(code, details, cause); }
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (object(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function jsonBytes(value) { return Buffer.from(JSON.stringify(value, null, 2) + '\n'); }
function identity(manifest) {
  const {id, ...body} = manifest;
  return sha256(Buffer.from(canonical(body)));
}
function absolute(value, field) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) fail('RUNTIME_PATH_REQUIRED', {field});
  return path.resolve(value);
}
function relative(value) {
  if (typeof value !== 'string' || !value || value.includes('\0') || value.includes('\\') || value.startsWith('/') ||
      value.split('/').some(part => !part || part === '.' || part === '..')) fail('RUNTIME_PATH_INVALID', {path: value});
  return value;
}
function join(root, value) { return path.join(root, ...relative(value).split('/')); }
function within(root, candidate) {
  const rel = path.relative(root, candidate);
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
}
function mode(value) {
  if (!Number.isInteger(value) || value < 0 || value > 0o777) fail('RUNTIME_MODE_INVALID', {mode: value});
  return value;
}
function count(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) fail('RUNTIME_MANIFEST_INVALID', {field});
  return value;
}
function hash(value, field) {
  if (typeof value !== 'string' || !SHA256.test(value)) fail('RUNTIME_DIGEST_INVALID', {field});
  return value;
}
function linkTarget(link) {
  relative(link.path);
  if (typeof link.target !== 'string' || !link.target || link.target.includes('\0') || link.target.includes('\\') ||
      path.posix.isAbsolute(link.target)) fail('RUNTIME_LINK_INVALID', {path: link.path});
  const target = path.posix.normalize(path.posix.join(path.posix.dirname(link.path), link.target));
  if (!target || target === '.' || target === '..' || target.startsWith('../')) fail('RUNTIME_LINK_ESCAPE', {path: link.path});
  return relative(target);
}
async function lstatMaybe(filename) {
  try { return await fs.lstat(filename); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function directory(filename) {
  const info = await lstatMaybe(filename);
  if (!info || !info.isDirectory() || info.isSymbolicLink()) fail('RUNTIME_DIRECTORY_REQUIRED', {path: filename});
  return info;
}
async function safeParents(root, relativePath, {create = false} = {}) {
  const parts = relative(relativePath).split('/');
  let current = root;
  await directory(root);
  for (const part of parts.slice(0, -1)) {
    current = path.join(current, part);
    if (create) {
      try { await fs.mkdir(current, {mode: 0o700}); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    await directory(current);
  }
}
async function syncDirectory(filename) {
  const handle = await fs.open(filename, constants.O_RDONLY);
  try { await handle.sync(); } finally { await handle.close(); }
}
async function readFile(filename, maximumBytes = 64 * 1024 * 1024) {
  const handle = await fs.open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > maximumBytes) fail('RUNTIME_FILE_INVALID', {path: filename, bytes: info.size});
    const bytes = await handle.readFile();
    if (bytes.length !== info.size) fail('RUNTIME_SOURCE_CHANGED', {path: filename});
    return bytes;
  } finally { await handle.close(); }
}
async function readJSON(filename, maximumBytes) {
  const bytes = await readFile(filename, maximumBytes);
  try { return {bytes, value: JSON.parse(bytes.toString('utf8'))}; }
  catch (error) { fail('RUNTIME_JSON_INVALID', {path: filename}, error); }
}
function fingerprint(info) {
  return [String(info.dev), String(info.ino), String(info.size), String(info.mtimeNs), String(info.ctimeNs)].join(':');
}
async function inspectFile(filename) {
  const handle = await fs.open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await handle.stat({bigint: true});
    if (!before.isFile() || before.size > BigInt(Number.MAX_SAFE_INTEGER)) fail('RUNTIME_FILE_INVALID', {path: filename});
    const currentIdentity=fingerprint(before),cached=FILE_HASH_CACHE.get(filename);
    if(cached?.fingerprint===currentIdentity) {
      const after=await handle.stat({bigint:true});
      if(fingerprint(after)!==currentIdentity)fail('RUNTIME_SOURCE_CHANGED',{path:filename});
      return {...cached};
    }
    const digest = createHash('sha256');
    const buffer = Buffer.allocUnsafe(BUFFER_BYTES);
    let bytes = 0;
    while (true) {
      const {bytesRead} = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      digest.update(buffer.subarray(0, bytesRead));
      bytes += bytesRead;
    }
    const after = await handle.stat({bigint: true});
    if (fingerprint(before) !== fingerprint(after) || BigInt(bytes) !== before.size) fail('RUNTIME_SOURCE_CHANGED', {path: filename});
    const result={bytes,sha256:digest.digest('hex'),mode:Number(before.mode&0o777n),fingerprint:currentIdentity};
    FILE_HASH_CACHE.set(filename,result);
    if(FILE_HASH_CACHE.size>FILE_HASH_CACHE_LIMIT)FILE_HASH_CACHE.delete(FILE_HASH_CACHE.keys().next().value);
    return {...result};
  } finally { await handle.close(); }
}
async function atomicBytes(root, relativePath, bytes, fileMode = 0o600) {
  await safeParents(root, relativePath, {create: true});
  const filename = join(root, relativePath);
  const temporary = filename + '.partial-' + randomUUID();
  const handle = await fs.open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
  try {
    try {
      await handle.writeFile(bytes);
      await handle.chmod(fileMode);
      await handle.sync();
    } finally { await handle.close(); }
    await fs.rename(temporary, filename);
    await syncDirectory(path.dirname(filename));
  } finally { await fs.rm(temporary, {force: true}); }
}

const SOURCE_COMMIT="f017de605bb020bf3d7f4285aae4c654508e8d86";
const SOURCE_INVENTORY_SHA256="4bd292ad2cfee84e08c25612f4b0c9750a95334b0d8906ccc306f379893ce9ad";
const ORIGINAL_SOURCE_ROWS=[[".github/dependabot.yml","100644",2547,"721f8f14518e8e442bdb049e97a5f0f25af254f40e0654444c258236697f317d","36e779678a2882d86fed33b7cc075937fc9dac9b"],[".github/pull_request_template.md","100644",562,"1e75ecfd1d4e76bd93ab7b2c7cd17f69504bd906eb5db312361c790da89e5440","673c6dad9c4d43782ce6df17cd98d76410848586"],[".github/workflows/cargo-audit.yml","100644",1252,"4e88a4b95d49b07b63f47ee0ab2c235793a3f07ac574d985c921ed577f7f7c97","2a121d041bcaaf0083c398f25f521b5d88b89318"],[".github/workflows/contracts.yml","100644",1067,"471de55db1f62b5399aa94e4269d4851219052007516582baac2c3f06859448d","e7a0c04e3e6d1c8153b14ccedd50a0f606a45027"],[".github/workflows/frontend-ci.yml","100644",1660,"481236264722e005e55b2ca82f7cb0321204c4e394da7dd657231e78c98d7305","4ff5430440a41a2182d8daff35b33d465d683584"],[".github/workflows/parity.yml","100644",619,"5ac4f0cda99866cf69e56b92f18f09f065a22a89a158c98471541d557ce45f7d","3aabba667332202ca73f7ff4f1e5baf96d9a7ff9"],[".github/workflows/secret-scan.yml","100644",2872,"9c4aeff1f8995708c9d0ae7b7616ed8bc19bdc67ed45605b3275d4cdba916f8b","6f85ea45c226121768decd311ff26b0cdf871c2c"],[".gitignore","100644",652,"0ff8dcd01d70815fecb7c47500743568f7db4a5983ef815ab1f890303012b1f1","66011f7848606a4ec366a4d8a2a55d7d329af943"],[".gitleaks.toml","100644",5830,"98c5cc6fdb99c6a6b36a7b15886788fad6899f8bc5f7b8dd39dff666e31cede8","f71f9bd769e94c7c824081a7d699d58edec404c3"],[".gitleaksignore","100644",2044,"4101f71d7b387b4faa9c537acd1e6a2474b13df83dd3c9f0c4c0e4f51209e9e3","f80c9b435cce2f4057504dcb087417bba1ac5cca"],[".kiro/specs/trustline-auto-setup/.config.kiro","100644",111,"10665058bcc958ebb0e5c9f5f56abf25ffd29232de1bef99dea993bc410e59bb","66b971a83c92ce255c895cbe13134d37ad7f22a9"],[".kiro/specs/trustline-auto-setup/design.md","100644",10003,"bd3eca5382eaa6b3fcb2244fe2c91f0d4f30ae31695c48c7428d852211d045e4","cf8581d5bc3b997226856935176a25fb32a93f8e"],[".kiro/specs/trustline-auto-setup/requirements.md","100644",7520,"d2aed92d3090e682d41d7bc1866cde97d37dad4ab1d000abf86a1ce0172e7ac7","72f6304f7e6550bcd9494a1cdf3396b9190dc697"],[".kiro/specs/trustline-auto-setup/tasks.md","100644",4605,"90b30b3e72ba36abc72b35a0ff4e1682e4d5fe1840e51d1513073622de4d0e93","0a2890f12391f9207ece5430c73760d9a580b5bd"],[".pre-commit-config.yaml","100644",1656,"cbde23c33f723ac12d3cc6a72551f8b7a6458b9c92abb4ef1c99653243a24169","086a25f71d2cf2701c8df54843eaaecb9df5ee6d"],["Cargo.lock","100644",95289,"692246090bebfd671ebf1ff9242d125110f1fe865cc23e765d26071bbe2b735e","bdd1d7885d2018628137c44fea669bd40a878ecd"],["Cargo.toml","100644",926,"576c63b6f9d302f27b86130cbaa4c5f926a2507a79bf4b65e5ad2874fd272736","c37540c6002656a4efe8fef2b447361cb7090672"],["SECURITY.md","100644",4460,"3a0391e4e16de8361ce99f20ca8ab1b7d91363697a029dbf00497c9670da03df","2ef38f57ab1d4795363ca63c1dc2647216f3b0d7"],["alerts/.dev.vars.example","100644",146,"d4fb4587135c23d315ff033777fad8838247068825ec503cc447d27c1de76022","9ce78179a0e5519c1fe20910ce8be2697eded57c"],["alerts/README.md","100644",2691,"c7c8949759e4b56d13e0d9211b0db1ce0954c570374288e228fe976fe383a7a0","528bf100a721f105221b082282d5b90602895604"],["alerts/migrations/0001_t2_historical_apy_hf_alerts.sql","100644",1271,"9ba98d33dd08b19345fd4c7d2e8313679bd278b92abb1deff6d7d0a0e8e9144f","88d9db44da0c70f45f6fd902054dca2378665ff8"],["alerts/migrations/0002_swap_routes.sql","100644",1026,"5e0ced0cbdda8cf3d2483594b687b28bdbc9f8193ee5cab17183284ba6d21ea3","6159e07b03a3afbe40bb0a52c90639907d93344d"],["alerts/migrations/0003_edge_triggered_alerts.sql","100644",1531,"f35bbbaf345f0a727fccf21db8eb4090f7903218189fbefe2d1295e0f2dad233","45289241aa65187164b3af9b561de13a41bb4310"],["alerts/package-lock.json","100644",54053,"6fc6dbe6e74e04be8a400891fdaf84c1a3ad56e20ca9e5416e14ad005c5bc553","1265749218736556532a844dc29c4f9e7a69f169"],["alerts/package.json","100644",771,"ff5b933677aa37f1dcf1d9b0dee516bccbedbb2a47c136cd5ee70e753221f0c6","05c642b0a7d03505bcf438504976de20645bf6b0"],["alerts/scripts/deploy-remote.ps1","100644",1627,"1b76f6acd6686e3c2fcd9a369e4a2fbaedcbae623b0ce7f3a86aaa59543daa79","fb83be6a57240bf2a47f242781ee3ae2b1b68e33"],["alerts/src/email.ts","100644",6869,"9bcac588d309c91b82d4f363744058d181cc29add378f8fecc2b632e106650df","567576818c278b4182ae0b58e34d42eaafd97310"],["alerts/src/index.ts","100644",36461,"6e71a503e3b161d8d092c30890c61ae95f331e3162fee0dbda23c0ffd4a6fe28","f3c3f2dff952d47908e9543b8529192d4d199b87"],["alerts/src/push.ts","100644",2278,"45518c45f78e20fba626685c486563527da8e9ae9e63d82e6b78df9d299001e0","13a65ec6ee06c17f3d662a1fd6b59dbd66fbc58d"],["alerts/src/schema.sql","100644",4388,"2a3f8523e183fc5df5635399532c127dfdd45c9aadd1aefcd55cb29355a15799","9dfbeb68bb525c49c954139d81270044da57c85b"],["alerts/src/stellar.ts","100644",13081,"5a973f3f2fa694c06cad29f638f7da5a9a9094117eb8ce5f3dc19f17c1d607d6","2f92912d2e0e94902acb561cad442ec5fed639fe"],["alerts/src/xdr.ts","100644",11984,"333ded3c09ebf300d1e96a10c32a489445b92cc1eaf0532815f695319a880b0a","2cb503f79b43fe3454ed38517d874c9fd7507b34"],["alerts/tsconfig.json","100644",382,"3718a7e5ae09f72792650d8b47c2b0a3abaf668bf4a67e8012528a627d046b5d","4a9d79a35318d27090a781dc517e648f8719cba5"],["alerts/wrangler.toml","100644",879,"11ff3576b822d60091a6ba8293b1d88372a215289f64d913e23fc544e245eddf","ecb18dc451ccbaea215f6ec6b6c957e3a68ceb2f"],["contracts/strategies/blend_leverage/Cargo.lock","100644",45936,"c16ccc9dc9698a56432fbdcec4c73ace59dd7599b92629c297950ae1a88d7056","196917af72b96be94655c6cb7d59b000fb4af5de"],["contracts/strategies/blend_leverage/Cargo.toml","100644",815,"8424c989c1b396bc27967448ef07dbd236acea51e7d5afe671f88a20549d288f","07ca9a90175a0f1a55cb0675a7785159ca5b505c"],["contracts/strategies/blend_leverage/src/blend_pool.rs","100644",18559,"e453934a6b46f7d282eef6e40a9172133b0db89049a5755934b6d4566273af74","b42f33786a2685093d2ff57b2b06bd3de71d41aa"],["contracts/strategies/blend_leverage/src/constants.rs","100644",5383,"28e22b23d4810d25776460c97389cd5bf152453a8aa7c8b721f0b250874a29aa","6db9df4494f39c8068d56cd073dfc987ac39db56"],["contracts/strategies/blend_leverage/src/leverage.rs","100644",20501,"b4b0e683fe6242d5c5f03a4f0f90d60167c15b1ee18b20f68d825952eb3380ea","eb1cd07d5b5c5e2c87f00d7fe6ecdad6d8b0467f"],["contracts/strategies/blend_leverage/src/lib.rs","100644",58040,"8ee1cb78be0a1c4bd146769ac9407ac295e1d45090f47ab37144c1fb00f40be4","5131d4aa7f0ec578e1105d3f86dd89c0fe9371f8"],["contracts/strategies/blend_leverage/src/reserves.rs","100644",16568,"83cacc27d505cb58bb00382e558bb282a531b775eef439641101e9aed81ba7ec","c2c0231efb86932faabb96ffb2ef304e01c3d47c"],["contracts/strategies/blend_leverage/src/soroswap.rs","100644",2591,"aadea37d0266c4b0f1035f4adda80b15bc189d100617f3f387f893a1bcdfa38c","e20a89eac430e7d19e0b9a96a94cae395c40e5e2"],["contracts/strategies/blend_leverage/src/storage.rs","100644",13601,"d957e697160cc37215725fbecfdcd5dc0018ec6091d617341bf5e4f039c35f6a","a603e1d798e22149ea92ada7356971e610a6ba84"],["contracts/strategies/blend_leverage/src/test_integration.rs","100644",202454,"424767816773874e787dc13518f973f70a8dc7f17c48c32f7103fa1151131512","57a6fe847434bc819be7c5a24f14b8e208397ac3"],["contracts/strategies/blend_leverage/src/test_leverage.rs","100644",62134,"09119b85219ec0fde3742497fe8c75fb4b49830b410420773502133f11198d98","f8dc604839030ef45d7e373bd5eb9ef6371a1b87"],["contracts/tokens/vault_share/Cargo.lock","100644",46727,"fbdbae8a2983655c1d4003d44c042a36961b08dfe2a72f600aaa8b6bacbfb5e9","36fab6af9d1b9648dc6d42553493258d267b4155"],["contracts/tokens/vault_share/Cargo.toml","100644",805,"66165f22b452ec166bd1bf2fad4610fc1dee4bb9d71b92766082f3a988e309e7","64986c54539caf135e11f7d11ed0dcd310cbcdfd"],["contracts/tokens/vault_share/src/lib.rs","100644",10242,"aef7c04aabcab46e0d1010671aae203f55a1a0a1ed1e4e38d153ff9cfc3115fd","29ce87d5dcd428ccc3885e9b7155ae538ae1e773"],["contracts/tokens/vault_share/src/storage.rs","100644",5563,"26ffcd35e8acd39282923a685f6afc41db80f6fa9c327fbbd5245751dce42a45","b1a4c8da8b05654a547d646ccde74ff65d9055a3"],["contracts/tokens/vault_share/src/test.rs","100644",7440,"c17f3a385fa1257afd5fab3c7539332ea7a6be467d6e3b6e07dcbcbddbcc5d92","2b60301e872e940a14ff01029c6310699088655b"],["deployed-vaults.testnet.json","100644",665,"02c0e9f18b5758f8755ef2a193e329f92dd8576d83964c7df16cd27d00910150","833ce4cf7f12b4c276889079626fefea324ca365"],["docs/CONTRIBUTING.md","100644",4822,"76a0c8fe38d86f2e7ae338e42cc75f703f14c13480f526231a3be7b766817b1a","7007f723167878a798da3d9b402777fb152644fe"],["docs/aquarius-listing-runbook.md","100644",9610,"a00bef2f42809c37800f5f312496899594283dd657ceaa39b46b4c992625ca45","0e6d5baf33436ae64daa5157235b18979583b828"],["docs/blend-bug-bounty-report.md","100644",19516,"4abd604c3257edf54361a1a6dc1066d53808c7de3462a78b3134ba495ea82e49","ada45db69b25119c338db8301c79ea8ff7132383"],["docs/blend-vulnerability-report.md","100644",30893,"6aacb3dcfd02e243fce59f3d912504889077b58450939c16247663fb5ca9fa2b","025c7fc59043e0181519436a05ab9332b76e3405"],["docs/d1-deploy-readiness.md","100644",3893,"6124f925a8cdf0936f26e4c48865c53fec2d030003fcb686b2d85c6d1934c7b6","866ae5ad48ffa9b40389c4623078d1d7aae1660d"],["docs/evidence/apy-history-demo-20260717-103756.jsonl","100644",3922,"94d15818637fdaf7772aabf9df07b59d0c7169fae153a00940709ca3d2f1ea97","0a3ea7f7ccb06f6a5d740516d3651273ad8e8bc7"],["docs/evidence/apy-history-demo-20260717-112632.jsonl","100644",4126,"e385007e753eebe0cb46e07f1bd27c9a1637388207a479a415a8b525e7731350","807f0c84ec6a2e56ac5e152e8149905c98d8073d"],["docs/evidence/apy-history-t2-5-acceptance.md","100644",9405,"97916d7d5600a7fe74215b22a32d506fab1a6830506e714615c9e8db73b351ab","f8b9e6ff0f205193dc632c5e18ec50d182907edc"],["docs/evidence/compare-pools-a9-acceptance.md","100644",7543,"b6ac0a50147ff5eac0612b381c26445c6ba309b0b66f80ecb488d1894febb1a3","f9a72147c63034bb926565b2477e6406433dd51e"],["docs/evidence/compare-pools-a9/compare-01-default.png","100644",483880,"16eb6c3c21161aec4abb7e22e0d1732b82ffb9bee5bd8aee96a7de0dd438ebb9","c200495d5a2586e4ca4230396acbd3f4f98afc00"],["docs/evidence/compare-pools-a9/compare-02-bracket-2x.png","100644",481301,"0fda514861e5f459ce70dd65cc7076ea36c50ba54b6586f3365815140c239b62","0ae4d01125e81cc69638eb31795e7878efb39150"],["docs/evidence/compare-pools-a9/compare-03-window-7d.png","100644",481526,"1af0cb9a4e00eb0fb1c3e5eeed7c04da13c7cf5477b5b44a798269985237360a","6a1d2640340332a4161e6b07cb3257771b3a45e1"],["docs/evidence/compare-pools-a9/compare-04-charts-expanded.png","100644",685193,"ebebe340b8f7dd1a0add536f9f4d2a0cc9a4a82b8c1c3c7c2d977ff1b12ce120","331d9093dd7d15139aa2efbca88692c704e1e05a"],["docs/evidence/gitleaks-block-demo.md","100644",1479,"20c1179c34e685f0696a5a6cf87c1df7d6d21d1c8bbce4386afa8a4fd57845d5","4a6246dc3e7e4e8d22a3a6efc273b9e918a10937"],["docs/evidence/harvest-router-log.jsonl","100644",1181,"a9901a3eac387a175fba6d3cdeea7b87e78660beab705fdc175bc908737a77fa","0af63bce4ff96201538192fa7d2dc88159248d93"],["docs/evidence/rebalance-keeper-demo-20260716-161500.jsonl","100644",538,"4f6fd12c5a5085d8786f0638d2af37de3190a84f97b258e95ec5517f7a37bd05","6d7ab285e99b5ff803aa4a935ae4a9634392a6ea"],["docs/evidence/rebalance-sim-dataset.json","100644",43207,"9e3f4b02740e5b045165a6c1729f1d85a5eaa8165dd04b8e1549765ee4b36121","d8587b5a8c96dec1a43551d69ccb2645a2ae962f"],["docs/evidence/rebalance-sim-report.md","100644",2686,"1982d9d03a7c6666d8a47bf9cb2cc79ae47ebc51b07d0d1a9dcdec64b3a80453","805eb99e14052316184142cc21f6f0dfb41459f3"],["docs/evidence/rebalance-testnet-validation.md","100644",1461,"b842b71f54da10e054008b1133123d360678b8d379d429a0b076f423d1ff61c4","48e67e6a3d9dcca308010bb4d6dbd990b25383e4"],["docs/launch-runbook.md","100644",4368,"24ec1329c3440be09129d14815b2257f79d8047ee7086d5bc11a0ea078832f77","e354f2fe2f06adb7555987bdf3adb47aa3db8f5e"],["docs/leverage-model.md","100644",4331,"0c8ab06792a35913e9eda6e79797d079022ab462b2fdb8c984e714e0a7e799a2","1310baf54d70d467d2bc798f68cb69207eed3df6"],["docs/mainnet-go-live-runbook.md","100644",6014,"29463e5c6acf3b0b91e79a3ecc59361fd5c316d9058309161a4cc41352f9da72","9a8078dadfd4ee97dd7ba722470a8327225efc92"],["docs/migration-runbook.md","100644",6119,"4a565705a0f9b5f8d8d59f89847b90757e78f5f718f89d7da00052b48d649ceb","15b577d1d98586ef554ac9746e79f61d4b7a4f0a"],["docs/profitability-analysis.md","100644",11913,"950110d01c1dc79e367ec435d1c26163b1c3ac07d02392aa22cb4a2e32f64eea","8879c360f41762b8b619e182e7b5dfb3b1b3cedd"],["docs/scf-t1-completion-report.md","100644",4921,"6f1dc9b25d852a2d400a1a667a1507dd2e89f4918590c05389211ddd69e8c133","28bd89cf68e167ae1eddff25caf3a46833731509"],["docs/scf-t2-completion-report.md","100644",7274,"60496c78b0cd4bb417028690fdc9757c719f23f3e469df9b9d2fb68d68947e0e","f0c779bd5bbc1788174c403b68bc5d605956ca19"],["docs/scf-t3-completion-report.md","100644",3329,"2a3240b01a4d76c69a221769ab4e80f15a6f6cd863eec8df23c2116d1a3c2459","d6eb39766de28138190ee5aeffe71493c1e6a799"],["docs/security-audit-2026-08.md","100644",47355,"1ad0a00daa7addbafb0fe1881967f915c1b5895f7f74a11796e7a13adec5b11e","a34213a9c94018368cf75edc416aa056cae480bd"],["docs/security-todo.md","100644",710,"3d1f5278e4ff423dc620bae0d9b6aa765165cc9406964a30f21d076d1c68d49c","19bc37754f4af46a398d6fc46ed85af3b207918e"],["docs/testing-programme.md","100644",9524,"874d964a6253191e219bb17ef9994ac20dfc12596891896ef0b96d8b96437810","ec64d2a0a1f6371b6f434b119505fb2bac6d7114"],["docs/ux-audit.md","100644",75899,"ce8bda8b567a68120658bde602352ca11734a7f5bb717555f4119bc85fc012cc","c6c95d7729c1bc781de200460262ed3370c9eb30"],["frontend/.env.example","100644",585,"81b29e24031d28431d57d782875af14c0c14d1958f05c0415bd89aa93fa0f17e","5c5da84ba531b736c60a8bc1a7b344c3eebcbd27"],["frontend/.npmrc","100644",33,"82952390ba119c39e2e495c5afdd42a45129f8ce49918f219eca7bcd6549c7d9","41583e36ca8d2eaf61c855a0500988bb163adc2a"],["frontend/biome.json","100644",907,"4a89aed8bc5e36de1202c3578861ed5ee1d0841e1029f27f902763a053f47df1","0cdf69cd627d5f491dff5250c89b5a486ea5e166"],["frontend/e2e/package.json","100644",378,"c14e6008e6b2bebfceb02dfc1f82dfa06c9ca66a2eaaee8a9ae0a14572c01e3a","e49185c7594a025c3b6aee50fd0a4341d437300e"],["frontend/e2e/playwright.config.ts","100644",1185,"1864f15ea867c31b396355655d9c8affb0dcc176a2be0b4e9e428395224b231d","b3d084a747b90f00c0209057c25195cd0235d71b"],["frontend/e2e/tests/wallets.spec.ts","100644",2230,"420aab4b1c46035410a2a7d0caee669bcfa4afcb59413cc0ac8d5ed84208205a","fbad17e4dc6b113f20fe4042e6566ecd37409fb1"],["frontend/index.html","100644",658,"5522c7dab983b2ecfbf10e4b8f48e0a2378d113c45bde220faedcd742eeca906","33993622fbfe632319fa06f01864aa866f1048bc"],["frontend/package.json","100644",789,"f1fc6f72438c5e4e0f8d9b73d73114b0ec166aa1749889e628063026c123450b","91a03131cddfe2f75a090725beab99c26c23a3e0"],["frontend/preview-ui.html","100644",328,"d3638125581e348f9f6705261bc1f54a9f866d8ad22318bd14127f2e73490a4e","edca3574637a55c6f07f81ba3cd8ac3f7d085bf0"],["frontend/public/_redirects","100644",19,"6036983e5fc00f0169c9e939b1816ed771eee00e27f2fcc517b819041460b9ef","7797f7c6a7356b0d451d11a49925df854c22e978"],["frontend/public/favicon.svg","100644",530,"fed6229bc75b2435ab3c56e131d670c45e239dc5db584ba849b1f764adb74623","458736975a5d8fd4d57e2d8acc3feb7616da13c1"],["frontend/public/logo.svg","100644",1076,"b1d21ddfa7744ac1cdff5f7dd4361c871b100aae588ef1bda6f9ccdaccc02999","19f3b74df878e7bce86055100ec6664357c573f8"],["frontend/public/sw.js","100644",1012,"3b89cb331fc0b740c86f49f9adafa0c966773d2e372e038d19f4cb7bed50950e","550555c696be62531f5c9ec24c28c4817c3e409c"],["frontend/src/app/chrome.css","100644",1724,"4634e6159aedadb4c1fe9939e15c8f7a07878f41668b9cf1db2cae0bf97d1eb4","754d40fa52db343bf68e84dccecf109bd1733823"],["frontend/src/app/chrome.ts","100644",3217,"1005c736bf446bd10116942d122148d6d312f66ac9c92275ffcb9f1199b23fe5","0e2d6d73e4aa7a93d23ec840a5e8b4630c95fd43"],["frontend/src/app/modals.ts","100644",8778,"93f60685e48524095231ee3eef77e3ac99cc66311a39c86018a70898610dd059","35dcc14ccc7fd911b0c42fc730c0cc3eb7f8fcf6"],["frontend/src/app/router.ts","100644",1003,"2712af94d2345a809f1e8938eef812b6d8277bc0be86643ac241fdc30800cbf5","70429448f41edb657cc014bf9464bc44c4490a04"],["frontend/src/app/screens.ts","100644",1660,"0e72c6aaf14274bf0198f7a63e3408d186683ce311a2768c40eda9a902bae563","91787bb87131313626170ce1909fe995def10a9d"],["frontend/src/app/shell.css","100644",7499,"05ac889ecd40f919268d152e34466537907dd11d34951cf86268faeaeec42f60","2ecff09b6204af84866f8d0ea9494fbc8e7dcf01"],["frontend/src/app/shell.ts","100644",7949,"9874cfd4e2b18a914e95f1f7bdf59ba226d73dbbc2fb01231f94f5af5520564b","f2b4ebb7138f5da6a48837160cf4fa3046d54461"],["frontend/src/app/state.ts","100644",1645,"89de9c4228718dea22fd32d6a0642e93cb9449d3a4fe48a5525afa4f313ead12","7b1b98322d5c50b9f48ef7bb7169ab0647910cd3"],["frontend/src/app/theme.ts","100644",939,"50a8a620f186b4037075eb5124d5ca12ee80452d459838d0fbf688bba1fdf137","8cd56b25bfc4eaed5ffca91c49c508f9597d96cb"],["frontend/src/app/wallet.ts","100644",8734,"a47030c5e4aba68f5916ca32a4cd9e2c3d8ff5d7a1d948bff3ba99180285fd42","f3a6441cc2582efd4d875a5ae7b60a885e4c633c"],["frontend/src/aquarius.ts","100644",5107,"46d55c5525f2b980113431d709c42d118a9ecbeecf7a54248192360d860300db","e24c258f739a581c531f9bb0f3e090a7e07ef7a7"],["frontend/src/aquarius_listings.ts","100644",3984,"fe6490e9b20addbeb60ab9edb1c9c336b58aa04ede04d2b9e7ba22bec450e6df","64f256ddc4a72892096fb26d393f79f5d2072190"],["frontend/src/aquarius_trade.ts","100644",9324,"e358f54c8a5b71d78b627c710885fb63a3eacf60c67f2c5c7b87939cd00a173f","f9ff47c8ae2990abe0c8d221541103520d0a21d2"],["frontend/src/blend.ts","100644",74372,"8978096b2a29ab361e956dae465e704c2c447af86d30561cad7b2c012f1372f1","8ca5edb521735c9d5763a937e13a695ccd8cbad4"],["frontend/src/compare_model.ts","100644",9418,"f7a94c302b31bc2eefa8088333a54a3b4214f2f965229075eb6cc7320ad1d05d","65cb1ed52859bbd4aae7023d6114cdf12e14695f"],["frontend/src/defindex.ts","100644",21407,"5e19a3ad2173a69aeb337730ed16ab70e9ab20e9c025af1a0e44a491eb70969e","db0b3b78a2254cf88389eec6d663d01529ef258d"],["frontend/src/ds/colors.css","100644",2959,"b54d7e9dfb739c74321bb167116760f54393d65dd12208eb942cd8afd3b9939f","4a6673cddb3efcc07f9a249f94ba3011a6cd5b3c"],["frontend/src/ds/spacing.css","100644",1254,"f10e2f3189e263fee9e955045ee8de2d5127020dc8dbc654ae89eab6f7a78263","74201931691623cde28ff6da88ca52dd95533724"],["frontend/src/ds/typography.css","100644",1550,"6e5b592b33d61989e6ddd2e68b7b11d8af39fb33a2cee203dd0dc1922edc70ce","206e45d84a8590f1d44e9eb9d785de74b75fcf20"],["frontend/src/e2e-harness.ts","100644",5527,"f3a729090a790b04c8f73d49e41435a7d9b8ed2a4b2e08d3d289f6b38718ab49","45a9daf47b2b23200789e27a48b53751de845a71"],["frontend/src/history.ts","100644",3382,"a6d258727c011a8062354b865f9b074f63a45fe0ed5b17d667ff17d8e56f3cd6","690a9055a2d48cd9b75b04d090a6203f84bf8f66"],["frontend/src/i18n.ts","100644",3101,"7dd8fd1e5dfef395f46e75af127011b6bd5b35351b288f1db422c8f4bdda71e1","4ea026af5ddc8f5984903effefad3cb216e7f112"],["frontend/src/locales.ts","100644",67808,"843f184ad17efa82c22adf05c8cfba6922af8e95b185501617e68523987178e0","3eadb04f009e71da69820aef01c8ea5973a62e68"],["frontend/src/main.ts","100644",1891,"ff8a69e7094ffa905d5dd0283479aa5b58133244ff2a9103919829c398f118e0","059da6f679deae9e4516dce59bdc1c190c9b48b0"],["frontend/src/polyfills.ts","100644",639,"18b326d497283bf8fcc16e974f5c4ffd365ff2fc3e01b66ee741f390a6dc7476","07d3bc5eae12408de9e1002268c158bc733b5693"],["frontend/src/preview-ui.ts","100644",4194,"b53bfb0549411cd958a29340d8bc05a0fa93fbd20b9a4eb8368d28946c9308e4","68a5b152e171c47d2865c9b61f27d62391f65be1"],["frontend/src/status.ts","100644",4616,"d9a49944619c00a182189ab7e877f4fe54d562633385fb61fe7e47578f65e5a1","800f35940864e22e50353a4f31b820bc315d5b4a"],["frontend/src/style.css","100644",90933,"5e6fecc9064c61b24e0648001d3e06b1a19f8afc04945d960f7d5991b00efef2","644e8531a3cd12efc548d7d6e5f1619dcca86269"],["frontend/src/swap-assets.ts","100644",6946,"14448612f88c665092aa4276b6bbf8b7b3bc997ab08f5bdf0dea075f74d524ab","486334ecf22d34d05756b2ec75bd22f29459c99e"],["frontend/src/tokens/base.css","100644",1410,"e9b9ce9c4d76b6c9ffd7f766ad1d6e1d1aea89af2a4f018c110e1265009feff0","0605c9a82225249f175ecf9a904afab1ea506511"],["frontend/src/tokens/colors.css","100644",2959,"b54d7e9dfb739c74321bb167116760f54393d65dd12208eb942cd8afd3b9939f","4a6673cddb3efcc07f9a249f94ba3011a6cd5b3c"],["frontend/src/tokens/fonts.css","100644",619,"158200b5b10237cbbd88ff943f8e7e605d91dc8c8502cb92553d8fb69ea527d9","b84efff593c9789bfeeb25fb1a1f10bb292c689b"],["frontend/src/tokens/spacing.css","100644",1254,"f10e2f3189e263fee9e955045ee8de2d5127020dc8dbc654ae89eab6f7a78263","74201931691623cde28ff6da88ca52dd95533724"],["frontend/src/tokens/styles.css","100644",445,"eb6d30a1a8a2749d01bbd65233835535266e7cc311c0a26ee01d8ec53d13ff83","6b7c2527806f4f7a46e32373f74e9110f75032a0"],["frontend/src/tokens/typography.css","100644",1550,"6e5b592b33d61989e6ddd2e68b7b11d8af39fb33a2cee203dd0dc1922edc70ce","206e45d84a8590f1d44e9eb9d785de74b75fcf20"],["frontend/src/tour.ts","100644",5197,"a439217b42f82fea5603ef0a9bcbef2746727be9adb8fe0f2b2f514acffd9f96","0dab4b0695ba68602cd93c1184b8d341504654b9"],["frontend/src/ui/apyChart.css","100644",1673,"47256d3fed7887ccc18145a1e54e18bff870e977f179d7bed47d619703b681d1","1d567d9532f2ecbd7afa19f1e601f4a88a9bdfb3"],["frontend/src/ui/apyChart.ts","100644",3404,"c8d6837c09acdde254abc1d6f7e7636f679c55becf32376c9e1f1f047fc19972","9d3ab017c48548d5ca0ea895a51b82941345920d"],["frontend/src/ui/assetTab.css","100644",1225,"a691529bac83cedd2b8f0ee28df061fac8dbd4e7d1d03efe36dd76af923d25cd","3068f00a95ade2ba6b98ccaa2a7a966dc86955a3"],["frontend/src/ui/assetTab.ts","100644",1187,"01921aa2a25e109aebc674b8017c828690f688d5090634b1586b7295632f8907","e370dddef8f974efcf6be6e0cfc07b62864383fd"],["frontend/src/ui/badge.css","100644",1508,"521a5ab697ecf0ff3fffb1df7323709605c30ea7363955719b0815cc46be535f","15d640ed3b967aaa18bb17a490aebdbeb546dcbb"],["frontend/src/ui/badge.ts","100644",1015,"9b9edad4d5b141af03246dedfc002ed4ca38c28dda4c5d6bdefa3c20e7344f7c","39e7314609b1f881a4d7c9e70fd0b2d9b9a03fe6"],["frontend/src/ui/button.css","100644",2413,"a014a7409673087815d5287f7ed8686ed205d2f8209abdf795267426e861532f","c476dda4baf113912bc8c9ec36e96a07f075f016"],["frontend/src/ui/button.ts","100644",1382,"2fe882eea0a37421e5ebe13270ec7f7b123a5d9bd6ae78f4fede3012c7565c0c","81d5e60957dad9bd72a013f4bfd72c4eea47948e"],["frontend/src/ui/card.css","100644",714,"6d83c43a768953247c6f5e2074a7ec7999958a137e4f88bcb4e4ce511b3c103f","0c424fb4d30b0c606c255b58ad11d4ad069e3ff0"],["frontend/src/ui/card.ts","100644",1463,"2932b63c1f3adfc03d0398927607ad13c63de03e261c81626b1a7fd8783d5b5e","c2c394442e4a65ffdaa0a2dde78f19a522d5ccaf"],["frontend/src/ui/el.ts","100644",1961,"7721cb83b20d9b5ff8b9b74134ce096c7f4a85aa0403ba7a2c15f97e4f04cea1","718977ce33201d79667ba393886c841daae88fdd"],["frontend/src/ui/healthFactor.css","100644",2200,"ec16cbaacf19448947ab2acf12f196628accc5da414ef75d2c186f98a5a6925c","13d6ce3832b18ca28feb981b3e2a5bf1e13e2863"],["frontend/src/ui/healthFactor.ts","100644",3284,"e7d76f3437d35ee17163cbd587a54d314a66cd0ff04b36a536b68172c5c4b61e","bdadd28662030c67dd6d0b7206c91e5f8e4bde73"],["frontend/src/ui/index.ts","100644",1978,"d4aa376c5b70d03458732761e631fe451955c6c2053597908211c3942eebec92","1f62543715e368e3c43a7690ae04a3c7fcd2da2f"],["frontend/src/ui/input.css","100644",2077,"22e665d2cc80f1a12ad96d991033ac8ff7e303414bc5cec5d9fc4eb93a9452d5","d5a8bef105a1441b34dfee5ba36cf7e80b9e8cfb"],["frontend/src/ui/input.ts","100644",2649,"457819488b8af98e411fcccb6e0c05f5ee1c3c3c4e8bc0b87783cbaf433a6131","9aefc65d61f1de6d09c35b131c8f42ddcfc4f867"],["frontend/src/ui/leverageSlider.css","100644",3752,"80e175f79c7f7cc70bf17d709edda331356125dde0274d030d11b9314da87368","d08f02606f70b1072c91f26f44700af942f76631"],["frontend/src/ui/leverageSlider.ts","100644",2883,"60e09fda4c231582ecdc64ad3854f930356a2383fa3f5d6bbe703fb2f3f12274","7c2ef51088def3f6bd888228adb1517883579e39"],["frontend/src/ui/metricHero.css","100644",1247,"c8b973033788ce7ec32120355c9334cc034f32b37da8d727620719571bc564c9","b5a947ab1411d96a4d07668bdde88e6bb2ba9796"],["frontend/src/ui/metricHero.ts","100644",1167,"d0361e48c40d4cef385ef2a17c6745e5e7a13de82678a95e704019c6491be4cf","03804b98b34f7bf160eb4ea892ad5f4a8f1d959f"],["frontend/src/ui/modal.css","100644",2053,"470cbfb33353eb48eba17180ae8af1821384a8911c978abaf8e8fce6e404ef52","45d658a0098d842c2ea0e4c4b181adac3b32465d"],["frontend/src/ui/modal.ts","100644",3194,"00ffecd7efa7bb20a947457139ff3ec87b471b570f3319a4c50cee7c42800e41","879bb227f616f57f73a1a5fd2ee2d3654866d927"],["frontend/src/ui/riskBand.css","100644",2063,"ea353481116b75dc7c662bc0ef87f454834e748d0928bf8185fe05f979c2e2ed","c84d71b5b35422ee0fd8c3e18e144bc2973095d6"],["frontend/src/ui/riskBand.ts","100644",1747,"c3c7bdb000d103541d6bfe79609d6728db773579c5a3c7832817749ee38e29b5","dcbf16cba01a934ceff1df9727e05ea20ecc91d8"],["frontend/src/ui/select.css","100644",1218,"89ca39ba8345ef7c75f52b077dbd82ca098d002920d53dfa540c6c2a7ba36eee","0707df1d3cfad451b0df282a675fadda77ebb1e2"],["frontend/src/ui/select.ts","100644",1456,"a9f9db6a6d5a35e50687b563389b94f9b8d3c04a04c2d2b6cf792226bc3b7ed4","3f6fe898244b6308d49eda3c21fc25eed0e81992"],["frontend/src/ui/skeleton.css","100644",522,"aecde02c55f20963369443a476bb049ad6b6cbc39df2e02c8ab05bdbfd04f259","0b8a7a45cd12c3c0aa4e6e317b8751e509989300"],["frontend/src/ui/skeleton.ts","100644",1120,"e01f95dc280a8c4b4e6f0198e5468e0e5658ab3d9845db78bdc37807c4b52fff","e8f9023c065bb72756c2e27ef48ea213d064ec81"],["frontend/src/ui/sparkline.css","100644",419,"af3ac9fbebe19dbf9a6b0bf4abe94a00c2f56da75ac1e0e3ecf7d9ebe13a138c","bb81b4653ceeffbac3976675c316cfc76a3b94cf"],["frontend/src/ui/sparkline.ts","100644",3069,"febf292335ee34bba650c95adb7c447efc845ba86c1bbe36db7dc4ed7cb2da5f","f5ac61deed58b7441db31700841e7f24adf9ea7c"],["frontend/src/ui/statCard.css","100644",1794,"f9917add1d653596cc712d0ab2414f3d1e82395ed8625c71884219fb3dafe282","84809da588a2754a7ada60d4d607882708c04c0f"],["frontend/src/ui/statCard.ts","100644",1351,"13c613cdb3eaf1d58229049616c04d4d0e84be5e2fedc4e20d572ad07572145a","e42e9a70ab8de4386c3b1275f9b2bbe9814d86b4"],["frontend/src/ui/tooltip.css","100644",1822,"60f1d08cdd8a08828014a9d90eca39ff95b294fcac80392ca6bb137b6566b043","50bc798a83658789f7cb78cff67b66238f2510d2"],["frontend/src/ui/tooltip.ts","100644",1560,"6a81fac5e00113eb1ea8356a7deffd8a3f67a0cdc7036bcbf2e037985d7d3814","4f1fb88d135d153904b9b37d33480e9b5a6fef1c"],["frontend/src/ui/txStepper.css","100644",2770,"65b5277295f253d94b64e1b2d8659a440067f7a04fca633d5bdb6540bcde5d61","5bc62156faa3ad2811520735e1fc25e43a0e488c"],["frontend/src/ui/txStepper.ts","100644",2234,"d30565a35ba2fcab29a66f5f297ae12c9ec8efdb246a198ae218b06a51c4656f","2ef79fec5c6903a18e6e1b52fb1e5433fe661315"],["frontend/src/views/compare.css","100644",6253,"578bc1bcb24efd4f301f3db47949bf16ff216fb33baa4ad9baedc203555ed4f5","8fcedb13d1ccec784048390923a29d4fb601d754"],["frontend/src/views/compare.ts","100644",16462,"2970796cd2eb4e248137be02d350bb8a5516efafa5d9d26f68588a5708600d20","1c31f2085c39a51b4bcb05de842945728654c3a7"],["frontend/src/views/dashboard.css","100644",7366,"27768377f762fd0d8d703fa92646bcf6f475e8aac3734a392a1f8ed0c6274c6c","aba41ae3408df37856f054b33a9f3217b85ea4c6"],["frontend/src/views/dashboard.screen.ts","100644",4412,"d8559f5227ea3c868f43a8f76be032657e84f2a3eb3e0cf3040c8e54487e8726","b80dda92845968c352c6baa99d5e0cbc0e9fdb96"],["frontend/src/views/dashboard.ts","100644",14897,"784f892ed3d8dd9c6557d950b33802ef83835e34348dadb77ca1ae0d71e3b93e","412273e2a58ba19093a82b51a3c1d51de6e7f561"],["frontend/src/views/status.css","100644",2978,"836e7e9a81547d3bf67e211690aec51f0ea4a673dd0c4a0bcff779edc70217ec","4613c99b0acfa9f3dd7f453feb074716ade97672"],["frontend/src/views/status.ts","100644",6137,"b31f93bce86c837bfb710f7cfc21f587fe6456e08811a7f8a7ed7aa9c428ac2b","1b2253d522a729e3b00e5fa1fcafb2743ade8c98"],["frontend/src/views/swap.css","100644",5677,"22a835d9361b121c7f405b3139fb660b1078887cd66c161ffcd67b258a8b9324","06974a1f6eeca375ab29c6ec6b9167e569eb290b"],["frontend/src/views/swap.ts","100644",29944,"a07b5defee6a7c8d26fa8ca15d372314abdb37b4f7e66d9dce1c677df62defa2","dc2cdf2e2762f9cae0653d8d17c2795d3eaffc00"],["frontend/src/views/trade.css","100644",17750,"376101b5877bca66879f621e969cc2c2183eae461723e7710dd8a0d1101f266b","45e729a92be1bcde36fb4c03d98a18b676b3e40f"],["frontend/src/views/trade.ts","100644",61405,"0d370c9da181c9aa85bd5864103ba18c717af8147ae7aabb40153d5873eaf2e4","32d5ec1760b14a4d5d630e986880b38675672571"],["frontend/src/views/vault.css","100644",8050,"5c6f3a2edea66da5d26fb23ffbeb5d19d9ecb850bbc7d207e8acd91806ef06ff","406bb2e3915bde305f46ead2aa7ac8b0c1f297d7"],["frontend/src/views/vault.ts","100644",31812,"feea19376c725e7348f20ea7038b74a744cfca8cbe78548ce627766dab4d3ba2","ff78ed8d3c9c3fb73c1df1a28e1e2093118beaf1"],["frontend/status.html","100644",1294,"faccc4106c0899ff5b6b8cd22d1556e71b1eb9142a2268ae409a32ff28fb1739","19a10e9dcbc74a08a8bdcc9f02eac00e40574cc9"],["frontend/test/aquarius.test.ts","100644",2960,"eb5aae8f02358788c8468cf7b33c5224a4ec7fce22fde3ea3f11bc4eb627e0ea","69f25e61724b36aaf592a4df7a8e7132a169eae6"],["frontend/test/aquarius_trade.test.ts","100644",5051,"b3ccc60f5cd92147829bd0dc5c0d24cb477a0a7f962c2ec768ae884c8bda7e47","625db996908515aacd32eba83b7ea462d214b8c6"],["frontend/test/compare.test.ts","100644",11422,"efb14f7d40b48faef9e49c4a8f68a4429cc0ce5693b2ddfa2f1eba083661114c","a935f5e0e3297b2a14e2c45098d92b97ffe0c62d"],["frontend/test/history.test.ts","100644",2640,"5c263f7193993371c804db64bad2ddaecb3fc2472d74d8c43fec2f666959cf1e","685bbd14428aa772bebca1e8b0d6f4c63edf230b"],["frontend/test/parity.test.ts","100644",4191,"bb9990708dfa581597e337baaca30d32d45d3b078e1090c61166bf5b4ad90600","cc36bcbf0569bbe15fad94aeb3ef9ee565b8efcd"],["frontend/test/removeFunds.test.ts","100644",2731,"72af9edea00a7ed655ffed901c6288222cb6ee0a124fa52492c70744b4c89a83","24548d7c6da4ef77995de9fc73034235f897d1c9"],["frontend/test/swap-assets.test.ts","100644",4140,"2c546a3c1034cbb6700a97f4417356f112233ac09a78f147307fbc1a35bf9f6a","ef40b35390f0495db2d58b9aee7d387bc95a2358"],["frontend/tsconfig.json","100644",273,"7435c85de7c1bd336263a6292280ebba1eaa30e32082d452e0b9c3a3b8ca81d3","1616678df611d0baa7cda3a52c48a2ddf2b99de6"],["frontend/vite.config.ts","100644",1409,"7f7b755b2223ad143dc8567d8f9cdb87a39c81a21610b3803ae46ec401e2f342","b7b6b2bcae7275c5922be95a2013e687592e74b0"],["landing/.well-known/security.txt","100644",324,"6928e46e09a635802720adb16796402bba420ee399d738efa096338ec250d45c","87435bf8ace0c0147db0ba5ee7a5bb5e147159f4"],["landing/bug-bounty.html","100644",21611,"f9d7d664383576afa3634950e00f819e2af61e9137920d243fc39d44067dd7d1","0e9e6768ba5cbf561908ff37a0a3c8af4784a27a"],["landing/favicon.svg","100644",477,"21f83ba442e2f830f889e4c0666d2f23b9f708e722ef5903be658e5054839c98","d0da4fe5fb0f0cfacb0e6c9b20e22581ce615f87"],["landing/index.html","100644",37196,"760aed02a7d6a7bc995ded8391e820205e2bb5cb68f659029b936dbeec35b788","72a34735aab3919b02d8196a29ce8dafd2eb6abb"],["landing/logo.svg","100644",1109,"728817e6fddbdedc6fa74dd1586d70071a7caee5bf8e9e5d9f71d588351bc0a2","a59cc7c308123b09d64b5133abd234515b6a1374"],["landing/scf-thumbnail.png","100644",89395,"19077dc8686cf3d400f67c2a230bd3589f6e1e739ce823046e33677e553c4f75","ed3133de1da3059859c137d250a116c684dd2e39"],["landing/style.css","100644",24949,"35751a0124e6ec2547148831a1c0664baf90f81141357fd3571874f060227ae0","a5847de4ece4dd0b3c828d966dc2d2abbe8536ed"],["landing/tokens.css","100644",8073,"b74c1f92dbcf6b55b09849929faf1db24d176051ba183cdd4a24dece90eb2a71","166ce770e3a5c3dbc9f8ea2ab6b6423bc1ef220f"],["package-lock.json","100644",88,"aa0dec85f648e97e03d7a349695794702936e1a0dcf57ebc245f96f7269abab9","efdeb1ff611c8998bd96277df0bf3a5dd4685d66"],["scripts/.npmrc","100644",33,"82952390ba119c39e2e495c5afdd42a45129f8ce49918f219eca7bcd6549c7d9","41583e36ca8d2eaf61c855a0500988bb163adc2a"],["scripts/aquarius_create_pool.ts","100644",17098,"ef7be740bd11aa2d844a92b393a75cd310718bafe524790657cc50c08bc6b0af","10ec61aa55e95932e1942bd60607537c7fef3c0c"],["scripts/check_testnet_infra.ts","100644",1702,"f73e0c954b75a1daf042e01aa28ca26602c71cda679dedae24029849410836e7","2ef80d9d8ccf18b12f90e0db634b63c7d27a0183"],["scripts/debug_blnd.ts","100644",2572,"3266aba2d64ebc8a0bdd5281a4dc3d4023d128ad8ba1b14133a738847dfacc8c","90fa08ad0ce23f77c9bf7a4dfdbcf642d7818bb7"],["scripts/debug_pool.ts","100644",6146,"ef5cfe8a35544ce72181b196aa89cb59ca11dc233bfe79c4ff9d776f5c9320c1","7204e90a3126ea6d3257d3bb689f526b0caac639"],["scripts/demo_t2.sh","100755",6128,"80dd254140fef39f450790a1ef3a4977d3e09aff526c9d58fb9f81b6d2b4f80c","7b4b1ff3af50f67e1c6448535e18d180789ca168"],["scripts/demo_t2_5.sh","100755",15912,"55e4f98cabe2793cea3ca2114ca748c3efeebec2d252fd4c1f62dc8b41e35215","c7ebbbe44015a80e40de169affba37ea76ece3de"],["scripts/demo_t3.sh","100755",9549,"5c55411ff36c57cb9ae70313c21c3cb9a54d259ed4a339e1f89c5752c5b653e6","96faf0cafc9e003fd4a1fda1530bfe00e8990d82"],["scripts/demo_t3_mainnet.sh","100755",11134,"81a28752b44368087b44ef575a1541ab7c4877062cdd4e8ff7fec8a7029ac287","030995cec1a3fffe99f188ab08d7d0639a828a50"],["scripts/deploy/harvest-keeper.env.example","100644",2898,"a2869345345e70869a8acf08fa1fc54cb3322300b14acebebbd3959dd07c6661","6e2836b8564a841f68cd38482e31307af4296921"],["scripts/deploy/harvest-keeper.service","100644",1915,"9791f0893546ee61a5bde993838bd0ead6a815298dd596bd83276fd260d9f067","db1f3594780dd8da697e0f2fe53d526dba343dc8"],["scripts/deploy/rebalance-keeper.env.example","100644",977,"4d3246eada5dfaf34e8ffd759762d9c59f56d09404cccd8f7452208cea6b0e67","18a0816d8cf7998ae62a3f3814f51ed4cc998f56"],["scripts/deploy/rebalance-keeper.service","100644",1656,"4b5cb2236da25863a8de207373cecf3c8f3de419a170ab7761dee28eb9ba46d7","34ba834bc6a90176a3ef7aba23ea49533954a62c"],["scripts/deploy_strategy.ts","100644",4413,"477bf7b8e0efdac72e4eb5d079f05445d7b8d979677c84bc1fcdafc299a871e0","bdc9b234802a3231460e25a5f25299436ee3760a"],["scripts/deploy_strategy_mainnet.ts","100644",19658,"3a2cfc222845514d4279bfa402acacb90f06fdf29c3f711923e4c66656bd911e","8674ed1fb65ddc3512c2eb079f623c2581beb932"],["scripts/deploy_strategy_testnet.ts","100644",11450,"771662900be8c2ce72101cf62b2f3004985a5a2dfc3581ac2b6a6c691c1a1fb1","1189c0a833cd5aff489042645e7d8f0dd0184ec8"],["scripts/deposit_testnet_vault.ts","100644",7380,"e2115b34420a95533d4b219a61ba71cdf20d7304148c731fd4f88181082c0f03","0986cf996a1d2002d60e7c3d0ba5a57c990a8eef"],["scripts/discover_pools.ts","100644",2475,"f7577e0bd8d7a44ceb3b57002247c0b5c5904387b0f8ef45e131ca744ea403db","f59fcc7ca36d81e51700193afcb5f829739b421c"],["scripts/fund_testnet_aqua.ts","100644",4102,"7d3b033737fdafef4a5d7a6f911af5fe27f9d5f5a5690d5c3167bada66cbe715","8c58dd3fc1fb3a9065e45b4578781339cdbe5fe3"],["scripts/gen_thumbnail.py","100644",5586,"a3f5115470347e68f6407601a61b7543abd42b6a967fe2116ee86f4a50823da7","9e5650fa1179b7fa9aef1b2024ffb9ad545f23dd"],["scripts/get_oracle.ts","100644",1852,"317931820a444ccab38dae6c05bf1075a2374898c129cd2a8ad06e9797763395","6398fa4dc8beba6a1ad1668c2c95c9ba3a6b907d"],["scripts/get_oracle2.ts","100644",2625,"38e4b57297748a1e7d77a937bbec39b2bfc9cca9122925f9fa62970a2c480dfe","21939989b7346dd40349e12f121bc28d5b058bc6"],["scripts/harvest_router.ts","100644",31102,"61a9be221770efa994489c86330282ad3e48f6ab071c5efcb827e50b8364d147","8284a35fcaec8abf9cf9f3fe6e5c67eac7561c47"],["scripts/identify_tokens.ts","100644",3738,"2331e16fc5e2abc71199deda7dcd6abd7d38ae39d78938c7d1f77e6a1cd3606a","f3d87ed1b94acf4608aad1f48f2b8856bfd950af"],["scripts/mainnet_loop.ts","100644",22858,"525f5a79d4227a0a686c6cf28b9d567108acc5bdfd22935fa7dd786d33893440","314aeb5ddcebae7816f1b42820421f86bca6c28a"],["scripts/oracle_deep.ts","100644",4962,"20d7ee3fe6c71cb5ffa4934bf8ce703e01088b39e699e6e34ec4bf2aa9443961","acf7852e16c9aa765ae5242974cf5accf03d3479"],["scripts/oracle_deep2.ts","100644",3722,"8ac8aa1239ac6e1d3dc196c97ec7041348f54e88d6b25315a5ec7e4a5569eb9e","949daf291bdbe3491f9f10e7dcab91f8bc3e8416"],["scripts/oracle_deep3.ts","100644",2723,"d3f79699707c2d5d7e7fbe41552173cf35cf98b6b782003bb792665db7ae8d80","7da74fdbdb84d91040eb90e8754dcc112a5dd0bc"],["scripts/oracle_deep4.ts","100644",2002,"07284b6b508839be2e5344bc7c2e10ba255ab70b9f5489cfee0adc95af73685d","8f58e3ab237a836c954745de1f116472e90976f6"],["scripts/package.json","100644",553,"67c1812320fd58619c433a285c73bb3232ac0cd1418e92cdb67d52f6f7c4a782","0d5c462942c08b9b5ab1b788ed9a256ae6a9e6b7"],["scripts/query_oracle.ts","100644",4793,"18c916bfea41596098222010c7e87638cd925227b3f8175036bc23ecec0c6c88","bd1973f6aebf8416c226cd16056976152f7d1c56"],["scripts/query_testnet_pool.ts","100644",2427,"27d6d3f97a936c2019872e5684f2d26d70e469ead3dfdc740cc83f56d15251e7","afbb875f95e04e944393b91d88c6b3edac7c016a"],["scripts/rebalance_keeper.ts","100644",14880,"b7b57f2228e813bab2eb2664260bfe1895e508b62a7a9da3803f652e036af400","61cf8744d950a44f3ee121f5398cda01ffbe11d8"],["scripts/rebalance_sim.ts","100644",15667,"912f2899ec119965fb55c325ea5dfdf647687b1f2b09ce8019319d10ef89f846","901a9beca39488a34be7a1e417ef9a75ed775e21"],["scripts/rebalance_testnet_sim.ts","100644",9018,"a579a9b03f6f571042131ac54252bcb58d00d9c4fc65313fd61c167eae3d0642","1a995279aa9b6b1b1335e6857d40460aa8bd6e29"],["scripts/swap_route_report.ts","100644",7798,"c9707d04b9429a6134c3ee23b43f51860f354d7374f482f5016e1055d48c6632","f2b0dc968d2e9703dcd56247823fc1992e616423"],["scripts/test-disclosure-pipeline.ts","100644",8586,"df25ee3d63995f5527034efed2175c79858ed55ebbd3bb2978ab68e7fe6eaa50","9cf06049ab257a18376908f469270fc01c3a9e8e"],["scripts/test_strategy.ts","100644",9769,"cf91c5ccae6d1681b79115f0ebba1ff85cca9de89832602ad96daf308951c030","560cc580aaade55d5c02209bb546b13aa6fedeb1"],["scripts/testnet_loop.ts","100644",14088,"116b6245abdefc2c90bec875df72bd377ed643eb1c5effac3d7821fd6b1b6c72","ae774a8cc6ac8851835763a3d90013ac6c6cddf1"],["scripts/wire_mainnet_vaults.ts","100644",2479,"021b56d5f2a47824b28e3918c379c9dae5a19a8887fb6a1659c4bf3a13a5a491","940bd1a588f4ec51ca0b6c6179f7f3305458f0a6"],["scripts/wire_testnet_vaults.ts","100644",2874,"d4bc4332fa39a20607284a1abe06d253747fde8b54d6156b96043c055cedadc9","ba52b68304deb2695d1ab11990c6bfb280fbf8f4"],["src/bin/execute_loop.rs","100644",18017,"3104843fa3ef539e0ed6d467dcad30beb417e52b3a6e2f86bfdd4af6cd3cc40d","9a6517b42ed3461eb8aaf24eaf15719915a02890"],["src/bin/rate_calc.rs","100644",4056,"676441998f40a77a1dfecfbbbe4880f7f93a58ee66eb363b6175b11c70c747d8","22ac4718d7188283444a549daca03bc5d741551b"],["src/bin/simulate.rs","100644",22975,"4ff690a7aae2435c83349912bc84828d217f798e2b07463d580f573ec165df81","d2677b7dd48d4c15d5a8d3ed69b740c4ea1e2be6"],["tests-snapshot-source/7ac33997544e3175d266bd022439b22cdb16508c01163f26e5cb2a3e1045a979/61605613-after/2a53f2eec6da48e5c7d52f0e575ac74d1a9d80812af1b1433ffdd50c0a1d424b.json","100644",2689,"ad065be7deb16f8cf65a26b8de9f9188698efff8e552004c8c8ee696a1ea668f","9be94d1b5a624ce396e624ce0c6ac10cfc9ad676"],["tests-snapshot-source/7ac33997544e3175d266bd022439b22cdb16508c01163f26e5cb2a3e1045a979/61605613-after/2a53f2eec6da48e5c7d52f0e575ac74d1a9d80812af1b1433ffdd50c0a1d424b.lock","100644",0,"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855","e69de29bb2d1d6434b8b29ae775ad8c2e48c5391"],["tests-snapshot-source/7ac33997544e3175d266bd022439b22cdb16508c01163f26e5cb2a3e1045a979/61605613-after/6e2e8e3ab823ffdb8544db12c7ba61ed9735ca723d5faad61dc0d16c931b3ed7.json","100644",2689,"d01612fe2d3a59e07a64bff320a07e46fe8bb11860ab0b95d60ad562061ea88e","4c2bb2e2b2366d99be7b906d07a8ad98bd336c81"],["tests-snapshot-source/7ac33997544e3175d266bd022439b22cdb16508c01163f26e5cb2a3e1045a979/61605613-after/6e2e8e3ab823ffdb8544db12c7ba61ed9735ca723d5faad61dc0d16c931b3ed7.lock","100644",0,"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855","e69de29bb2d1d6434b8b29ae775ad8c2e48c5391"],["tests-snapshot-source/7ac33997544e3175d266bd022439b22cdb16508c01163f26e5cb2a3e1045a979/61605613-after/74dcb863bc92e4b21bd1d0af5f06318fd2a84551412a1a2ccfa6ce2ec1d81f1c.json","100644",115320,"bc9b6376506fa1e1aa79565a558c04619fb25c9d9554588f43e88bb597b43a12","1dca568e1328dfd2b6ecb18fb4348c8dec2cfb19"],["tests-snapshot-source/7ac33997544e3175d266bd022439b22cdb16508c01163f26e5cb2a3e1045a979/61605613-after/74dcb863bc92e4b21bd1d0af5f06318fd2a84551412a1a2ccfa6ce2ec1d81f1c.lock","100644",0,"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855","e69de29bb2d1d6434b8b29ae775ad8c2e48c5391"],["tests-snapshot-source/7ac33997544e3175d266bd022439b22cdb16508c01163f26e5cb2a3e1045a979/61605613-after/7b017f054e1fcf7d3faa33f873757b4fe832e9fb5f4c2a8d4887db373d585043.json","100644",2739,"f9303507da447694581228de00d4e0f21f6311b316403a774bb29f0a8d87197b","c5674525f0da4e9f66840f2e36767a56d3695e47"],["tests-snapshot-source/7ac33997544e3175d266bd022439b22cdb16508c01163f26e5cb2a3e1045a979/61605613-after/7b017f054e1fcf7d3faa33f873757b4fe832e9fb5f4c2a8d4887db373d585043.lock","100644",0,"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855","e69de29bb2d1d6434b8b29ae775ad8c2e48c5391"],["tests-snapshot-source/7ac33997544e3175d266bd022439b22cdb16508c01163f26e5cb2a3e1045a979/61605613-after/7bda255b314ae96b4ae903f21864e818b7abd9d60b2b7bd5de0db76d2301dca2.json","100644",870,"5300eaa1382b68f2f84b18b81e189fa7dee72b98222239b07b8b593471efd35c","1eee2db25cc2f4fc4dfc2ca28f353667e3eefa26"],["tests-snapshot-source/7ac33997544e3175d266bd022439b22cdb16508c01163f26e5cb2a3e1045a979/61605613-after/7bda255b314ae96b4ae903f21864e818b7abd9d60b2b7bd5de0db76d2301dca2.lock","100644",0,"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855","e69de29bb2d1d6434b8b29ae775ad8c2e48c5391"],["tests-snapshot-source/7ac33997544e3175d266bd022439b22cdb16508c01163f26e5cb2a3e1045a979/61605613-after/8aab76719e30fb72d0601eaa969e4369b3df94a622de9a429654e1bd1c755823.json","100644",2557,"af109fd24766b8ee0d6ad3527c2b74e01bf42a2c48dcd6d9cdcb118ff0e34e42","4324167dd9e3a704c96b39be4d2ba0d0bb84322b"],["tests-snapshot-source/7ac33997544e3175d266bd022439b22cdb16508c01163f26e5cb2a3e1045a979/61605613-after/8aab76719e30fb72d0601eaa969e4369b3df94a622de9a429654e1bd1c755823.lock","100644",0,"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855","e69de29bb2d1d6434b8b29ae775ad8c2e48c5391"],["tests-snapshot-source/7ac33997544e3175d266bd022439b22cdb16508c01163f26e5cb2a3e1045a979/61605613-after/a63213d713efb243ba64897692d711ef088e5d5719b392ca68030f36bcecb1a4.json","100644",1627,"d683ab458fc7d224f6df9811188502401d844c52d6ff650451f2742463e049d0","7e5fdb61a9fe539e9526699ecab23291b47e2d2c"],["tests-snapshot-source/7ac33997544e3175d266bd022439b22cdb16508c01163f26e5cb2a3e1045a979/61605613-after/a63213d713efb243ba64897692d711ef088e5d5719b392ca68030f36bcecb1a4.lock","100644",0,"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855","e69de29bb2d1d6434b8b29ae775ad8c2e48c5391"],["tests-snapshot-source/7ac33997544e3175d266bd022439b22cdb16508c01163f26e5cb2a3e1045a979/61605613-after/b86249be9e096906a9371acf3393a9bbe8bca33772fd0ce7498d30676a415921.json","100644",1666,"3eac060562b5c2b5ac01469c67519778bedb3b9d0141e2b65ab8f74abe598bd7","fddff92ab7c7242080174509eda75869a3fc5bac"],["tests-snapshot-source/7ac33997544e3175d266bd022439b22cdb16508c01163f26e5cb2a3e1045a979/61605613-after/b86249be9e096906a9371acf3393a9bbe8bca33772fd0ce7498d30676a415921.lock","100644",0,"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855","e69de29bb2d1d6434b8b29ae775ad8c2e48c5391"],["tests-snapshot-source/7ac33997544e3175d266bd022439b22cdb16508c01163f26e5cb2a3e1045a979/61605613-after/e67aa35bb6c2f28a4b22d4fa5f51633ac1fa9c7642a58ee05a6c4afdfd89a93b.json","100644",2664,"a79adbf8959862994eedc3fdb3fc9f5efb9ade0a82227579c7c9792d00dc2f29","854d7dede53437fa806aa81ba45cd26f85a7e621"],["tests-snapshot-source/7ac33997544e3175d266bd022439b22cdb16508c01163f26e5cb2a3e1045a979/61605613-after/e67aa35bb6c2f28a4b22d4fa5f51633ac1fa9c7642a58ee05a6c4afdfd89a93b.lock","100644",0,"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855","e69de29bb2d1d6434b8b29ae775ad8c2e48c5391"],["tests-snapshot-source/7ac33997544e3175d266bd022439b22cdb16508c01163f26e5cb2a3e1045a979/61605613-after/f6a8b6da411248fa837b0de49e85d5236457e5a8333fcb50fa18f1c24a98c825.json","100644",2689,"5e5bc82937bd0b152b54382e3ca386a03c050de2404ff79abfecab667ae4bed9","21e6cf8820509e814abf49e0339ace42eff180e8"],["tests-snapshot-source/7ac33997544e3175d266bd022439b22cdb16508c01163f26e5cb2a3e1045a979/61605613-after/f6a8b6da411248fa837b0de49e85d5236457e5a8333fcb50fa18f1c24a98c825.lock","100644",0,"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855","e69de29bb2d1d6434b8b29ae775ad8c2e48c5391"],["tests/fixtures/rates.json","100644",14989,"0ca6cdc28ae6d0d60431f4824a73b48f4156aa1862b3c10135deba4c899987e0","5304f7696a3c397e9837488dda5b7527da769fe2"],["tests/leverage_sim.rs","100644",27090,"7dc368e9edb5096258a27bdffd23b466363a21e3b363e9972ba416f71ae81844","dda4f7d1494ba1858e727b698d4542cf9740b5af"],["vendor/blend-contract-sdk/Cargo.toml","100644",646,"710e860ad552634976fc6c25e2cdb3e4c3e71fdce481851822a76fce3f1b63b0","ecd1587e88ea4c69b68e87b809fad722a78d5191"],["vendor/blend-contract-sdk/LICENSE","100644",1061,"3ff705bd2c415e61544413ca38c366c2cffa536d13061960f781f26bd402edf7","a1f5895d2a07b648d5fb3a0f19b8a6ac5181d5be"],["vendor/blend-contract-sdk/README.md","100644",4072,"120d339cba3a3f8a022ee1766b1eea0e1a991cbc7c03bbe44155b0fe01705c59","36ab6a8bad8225268708e6557b359c96c16b28ac"],["vendor/blend-contract-sdk/src/lib.rs","100644",415,"c814eefa1d95fc8afb448888215852fc414d5e5cb49dd659ea1544bdd936eccc","92a45ca593a1d45fed79588c05b1bdc2cfb8e4b8"],["vendor/blend-contract-sdk/src/testutils.rs","100644",6260,"c08ceed452b6d935dd8abb78d8b99e0506ee7ced7c5b6abb160983b1beb05308","af437ee0fdfa2aa37a6807b6b5f371ca3b9da9f4"],["vendor/blend-contract-sdk/wasm/backstop.wasm","100644",30772,"c1f4502a757e25c611f5a159bc1ab0eef64085adac6c68123dca66e87faffbc2","1f1466e715ee4535e8d23ce87502209630947fa4"],["vendor/blend-contract-sdk/wasm/comet.wasm","100755",29046,"5d721fa580714291f6846fc01738e86d70acb47e449ea75312e272a0f7436dd8","e9493fd7536361d7142313a2e593d4eb9fbf51af"],["vendor/blend-contract-sdk/wasm/comet_factory.wasm","100755",2502,"bf7adb09076853eb3aa569278754111d86e161e35e7dc6a984ecde2b9d6700ae","9db8020a75832879ce60472bcf1bf129d4c6cf62"],["vendor/blend-contract-sdk/wasm/emitter.wasm","100755",10448,"438a5528cff17ede6fe515f095c43c5f15727af17d006971485e52462e7e7b89","c6f00d0e3465362f801dca34a43f38aa1f3f6cf6"],["vendor/blend-contract-sdk/wasm/pool.wasm","100644",57328,"a41fc53d6753b6c04eb15b021c55052366a4c8e0e21bc72700f461264ec1350e","c2b22407552b2d822b1bf5bb7dcf2fa09f081828"],["vendor/blend-contract-sdk/wasm/pool_factory.wasm","100644",3230,"31328050548831f63d2b72e37bcfd0bb7371b7907135755dbe09ed434d755ca9","3a6fde5c81ee17273c0ad92d4465ee89d5024089"]];

const SOURCE_FILES=ORIGINAL_SOURCE_ROWS.map(([path,gitMode,bytes,sha256,gitBlobSha])=>({path,mode:parseInt(gitMode.slice(-3),8),bytes,sha256,gitBlobSha}));
const SOURCE_BY_PATH=new Map(SOURCE_FILES.map(file=>[file.path,file]));
const BUILD_SCHEMA='stellar-forge.turbolong-operations.build.v1';
const COMMAND_SCHEMA='stellar-forge.turbolong-operations.original-command.v1';
const REQUEST_SCHEMA='stellar-forge.turbolong-operations.original-preparation.v1';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROOT_PROJECTS=['scripts','frontend','alerts'];
const BUILD_TARGETS=['scripts','binaries','contracts','frontend','alerts','cargo-sources'];
const SECRET_NAMES=new Set(['KEEPER_SECRET','DEPLOY_SECRET_KEY','KEEPER_INGEST_KEY','STELLAR_BROKER_PARTNER_KEY']);
const PUBLIC_SCRIPT_NAMES=new Set(['NETWORK','RPC_URL','VAULTS_JSON','SLIPPAGE','SOROSWAP_ROUTER','QUOTE_AMOUNT_BLND','HARVEST_MIN_BLND','BROKER_TRADE_TIMEOUT_S','FALLBACK_MIN_HF','FALLBACK_ORANGE_HF','ADMIN_PUBKEY','KEEPER_PUBKEY','MIN_HARVEST_RATE_USDC','MIN_HARVEST_RATE_USTRY','MIN_HARVEST_RATE_CETES','MIN_HARVEST_RATE_XLM']);
const VIEW_METHODS=new Set(['config','health_factor','risk_factors','position','locked_profit','version','get_keeper','share_token','swap_account','swap_via','min_harvest_rate','pending_harvest']);
const SHARE_METHODS=new Set(['decimals','name','symbol','total_supply','minter','balance','allowance']);
const RUNTIME_ACTIONS=['vault.inspect','vault.shareInspect','keeper.rebalance.probe','keeper.rebalance.execute','keeper.harvest.quote','keeper.harvest.execute','routing.report','rates.project','rates.simulate','deployment.plan'];
const SIM_ACCOUNT='GBHD3V2XKX6DXHYZDSHA2UYZTO4MKB2R6QNSCDT4XEKNGTLPXT7A36EA';
const NETWORK_PASSPHRASES={mainnet:'Public Global Stellar Network ; September 2015',testnet:'Test SDF Network ; September 2015'};
function selectedId(value,field='requestId'){if(typeof value!=='string'||!value||value.length>200||/[\x00-\x1f]/.test(value))fail('RUNTIME_REQUEST_ID_INVALID',{field});return value;}
function signalCheck(signal){if(signal?.aborted)fail('RUNTIME_ABORTED');}
function portable(value){try{return JSON.parse(JSON.stringify(value));}catch{fail('RUNTIME_JSON_VALUE_REQUIRED');}}
function descriptor(root,manifest,manifestSha256){
 const entries=Object.fromEntries(Object.entries(manifest.entrypoints).map(([name,entry])=>[name,entry===null?null:join(root,entry)]));
 const tools=Object.fromEntries(Object.entries(manifest.tools).map(([name,item])=>[name,{...item,path:join(root,item.path),libraryDirectories:(item.libraryDirectories??[]).map(value=>join(root,value))}]));
 return {id:manifest.id,directory:root,manifest,manifestSha256,version:manifest.version,
  sourceDirectory:join(root,manifest.source.root),entrypoints:entries,tools,platform:{...manifest.platform},
  capabilities:portable(manifest.capabilities)};
}
async function writeExact(root,rel,bytes,permissions=0o600){
 await safeParents(root,rel,{create:true});const filename=join(root,rel),old=await lstatMaybe(filename);
 if(old){if(!old.isFile()||old.isSymbolicLink())fail('RUNTIME_IMMUTABLE_CONFLICT',{path:rel});const actual=await inspectFile(filename);
  if(actual.bytes!==bytes.length||actual.sha256!==sha256(bytes))fail('RUNTIME_IMMUTABLE_CONFLICT',{path:rel});return;}
 const temp=filename+'.partial-'+randomUUID(),handle=await fs.open(temp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL,permissions);
 try{try{await handle.writeFile(bytes);await handle.chmod(permissions);await handle.sync();}finally{await handle.close();}
  try{await fs.link(temp,filename);}catch(error){if(error.code!=='EEXIST')throw error;const actual=await inspectFile(filename);
   if(actual.bytes!==bytes.length||actual.sha256!==sha256(bytes))fail('RUNTIME_IMMUTABLE_CONFLICT',{path:rel});}
  await syncDirectory(path.dirname(filename));
 }finally{await fs.rm(temp,{force:true});}
}
async function privateDirectory(value){await fs.mkdir(value,{recursive:true,mode:0o700});await directory(value);return value;}
function sourceCapsule(value){
 if(!object(value)||value.repository!=='Dgetsylver/TurboLong'||value.commit!==SOURCE_COMMIT||
  !Array.isArray(value.files)||value.files.length!==SOURCE_FILES.length)fail('RUNTIME_ORIGINAL_SOURCE_REQUIRED',{commit:SOURCE_COMMIT});
 const found=new Map();
 for(const file of value.files){
  const expected=SOURCE_BY_PATH.get(file.path);if(!expected||found.has(file.path)||typeof file.content!=='string')fail('RUNTIME_ORIGINAL_SOURCE_MISMATCH',{path:file.path});
  if(!['utf-8','base64'].includes(file.encoding??'utf-8'))fail('RUNTIME_ORIGINAL_SOURCE_MISMATCH',{path:file.path});
  const bytes=Buffer.from(file.content,file.encoding==='base64'?'base64':'utf8');
  const git=createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex');
  if(bytes.length!==expected.bytes||sha256(bytes)!==expected.sha256||git!==expected.gitBlobSha)fail('RUNTIME_ORIGINAL_SOURCE_MISMATCH',{path:file.path});
  found.set(file.path,{...expected,content:bytes});
 }
 return found;
}
async function verifyOriginalSource(root){
 await directory(root);
 for(const file of SOURCE_FILES){
  await safeParents(root,file.path);const actual=await inspectFile(join(root,file.path));
  if(actual.bytes!==file.bytes||actual.sha256!==file.sha256)fail('RUNTIME_ORIGINAL_SOURCE_CHANGED',{path:file.path,commit:SOURCE_COMMIT});
 }
 return {repository:'Dgetsylver/TurboLong',commit:SOURCE_COMMIT,inventorySha256:SOURCE_INVENTORY_SHA256,fileCount:SOURCE_FILES.length};
}
async function prepareOriginalSource(root,{sourceDirectory,sourceCapsuleFile}={}){
 await privateDirectory(root);
 if(sourceCapsuleFile){
  const checked=sourceCapsule((await readJSON(absolute(sourceCapsuleFile,'sourceCapsuleFile'),128*1024*1024)).value);
  for(const file of checked.values())await writeExact(root,file.path,file.content,file.mode);
 }else if(sourceDirectory){
  const original=absolute(sourceDirectory,'sourceDirectory');await verifyOriginalSource(original);
  if(original!==root)for(const item of SOURCE_FILES)await copyFile({filename:join(original,item.path)},root,item);
 }else await verifyOriginalSource(root);
 return verifyOriginalSource(root);
}

async function packageAt(lookup) {
  const entry = await lstatMaybe(lookup);
  if (!entry) return null;
  const root = await fs.realpath(lookup);
  await directory(root);
  const loaded = await readJSON(path.join(root, 'package.json'), 16 * 1024 * 1024);
  if (!object(loaded.value) || typeof loaded.value.name !== 'string' || typeof loaded.value.version !== 'string')
    fail('RUNTIME_PACKAGE_INVALID', {path: lookup});
  return {root, lookup: path.resolve(lookup), metadata: loaded.value, packageBytes: loaded.bytes};
}
async function resolvePackage(name, from) {
  if (!PACKAGE_NAME.test(name)) fail('RUNTIME_PACKAGE_NAME_INVALID', {name});
  let current = await fs.realpath(from);
  while (true) {
    if (path.basename(current) !== 'node_modules') {
      const candidate = path.join(current, 'node_modules', ...name.split('/'));
      if (await lstatMaybe(candidate)) return packageAt(candidate);
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}
async function installedChildren(nodeModules) {
  const children = [];
  const entries = (await fs.readdir(nodeModules, {withFileTypes: true})).sort((a, b) => a.name.localeCompare(b.name, 'en'));
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (entry.name.startsWith('@')) {
      const scope = path.join(nodeModules, entry.name);
      if (!(await fs.stat(scope)).isDirectory()) continue;
      for (const item of (await fs.readdir(scope, {withFileTypes: true})).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
        const lookup = path.join(scope, item.name);
        if (await lstatMaybe(path.join(lookup, 'package.json'))) children.push({name: entry.name + '/' + item.name, lookup});
      }
    } else {
      const lookup = path.join(nodeModules, entry.name);
      if (await lstatMaybe(path.join(lookup, 'package.json'))) children.push({name: entry.name, lookup});
    }
  }
  return children;
}



function packageDeclarations(metadata,includeDevelopment=false){
 const declarations=new Map();
 for(const[name,range]of Object.entries(metadata.dependencies??{}))declarations.set(name,{name,range,kind:'dependency',optional:false});
 for(const[name,range]of Object.entries(metadata.optionalDependencies??{}))declarations.set(name,{name,range,kind:'optional',optional:true});
 for(const[name,range]of Object.entries(metadata.peerDependencies??{}))if(!declarations.has(name))
  declarations.set(name,{name,range,kind:'peer',optional:metadata.peerDependenciesMeta?.[name]?.optional===true});
 if(includeDevelopment)for(const[name,range]of Object.entries(metadata.devDependencies??{}))if(!declarations.has(name))
  declarations.set(name,{name,range,kind:'development',optional:false});
 return declarations;
}
async function discoverPackages(installationDirectory){
 const packages=[],byRoot=new Map(),byLookup=new Map(),roots=[];
 function add(found,project=null){
  let node=byRoot.get(found.root);
  if(!node){node={...found,id:'p'+String(packages.length).padStart(4,'0'),dependencies:[],installed:[],project};
   node.path=project?'source/'+project:'packages/'+node.id;packages.push(node);byRoot.set(found.root,node);}
  byLookup.set(found.lookup,node);return node;
 }
 for(const project of ROOT_PROJECTS){const found=await packageAt(path.join(installationDirectory,project));if(found)roots.push(add(found,project));}
 for(let index=0;index<packages.length;index++){
  const node=packages[index];
  for(const dependency of [...packageDeclarations(node.metadata,Boolean(node.project)).values()].sort((a,b)=>a.name.localeCompare(b.name,'en'))){
   const found=await resolvePackage(dependency.name,node.root);
   if(!found){node.dependencies.push({...dependency,packageId:null,present:false});continue;}
   const selected=add(found);node.dependencies.push({...dependency,packageId:selected.id,present:true});
  }
  async function scan(current,rel=''){
   for(const entry of (await fs.readdir(current,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name,'en'))){
    if(VCS.has(entry.name))continue;
    const filename=path.join(current,entry.name),child=rel?rel+'/'+entry.name:entry.name;
    if(entry.name==='node_modules'&&entry.isDirectory()){
     for(const installed of await installedChildren(filename)){const found=await packageAt(installed.lookup),selected=add(found);
      node.installed.push({path:child+'/'+installed.name,name:installed.name,packageId:selected.id});}
     continue;
    }
    if(!node.project&&entry.isDirectory()&&!byRoot.has(filename))await scan(filename,child);
   }
  }
  await scan(node.root);
 }
 return {packages,roots,byRoot,byLookup};
}
function cleanEnvironment(extra={}){
 const allowed=['PATH','SystemRoot','WINDIR','COMSPEC','PATHEXT','LANG','LC_ALL','SSL_CERT_FILE','SSL_CERT_DIR','HTTP_PROXY','HTTPS_PROXY','NO_PROXY'];
 const env={};for(const key of allowed)if(process.env[key]!==undefined)env[key]=process.env[key];
 for(const[key,value]of Object.entries(extra))if(value!==undefined&&value!==null)env[key]=String(value);
 return env;
}
async function actualExecutable(value,name,{required=true}={}){
 const requested=value??name;
 if(typeof requested!=='string'||!requested||requested.includes('\0'))fail('RUNTIME_TOOL_INVALID',{tool:name});
 let selected=null;
 if(path.isAbsolute(requested)||requested.includes(path.sep)){if(await lstatMaybe(path.resolve(requested)))selected=path.resolve(requested);}
 else for(const dir of String(process.env.PATH??'').split(path.delimiter)){if(!dir)continue;for(const suffix of process.platform==='win32'?['','.exe','.cmd']:['']){
  const candidate=path.join(dir,requested+suffix);if(await lstatMaybe(candidate)){selected=candidate;break;}}if(selected)break;}
 if(!selected){if(required)fail('RUNTIME_TOOL_REQUIRED',{tool:name});return null;}
 const real=await fs.realpath(selected),info=await fs.stat(real);
 if(!info.isFile())fail('RUNTIME_TOOL_INVALID',{tool:name});return {selected,real};
}
async function smallCommand(executable,args,{cwd,env,signal,maximumBytes=4*1024*1024}={}){
 signalCheck(signal);try{
 const result=await promisify(execFile)(executable,args,{cwd,env:env??cleanEnvironment(),signal,timeout:30000,maxBuffer:maximumBytes,encoding:'buffer'});
 return {status:0,stdout:Buffer.from(result.stdout),stderr:Buffer.from(result.stderr)};
 }catch(error){if(error.code==='ENOENT')fail('RUNTIME_TOOL_REQUIRED',{executable:path.basename(executable)});
 return {status:Number.isInteger(error.code)?error.code:1,stdout:Buffer.from(error.stdout??''),stderr:Buffer.from(error.stderr??String(error.message))};}
}
async function inspectTool(name,value,{required=false,signal,versionArgs=['--version']}={}){
 let found=await actualExecutable(value,name,{required});if(!found)return null;
 if(['cargo','rustc'].includes(name)&&/^(?:rustup)(?:\.exe)?$/.test(path.basename(found.real))){
  const selected=await smallCommand(found.real,['which',name],{signal,env:{...cleanEnvironment(),...(process.env.RUSTUP_HOME?{RUSTUP_HOME:process.env.RUSTUP_HOME}:{}),...(process.env.RUSTUP_TOOLCHAIN?{RUSTUP_TOOLCHAIN:process.env.RUSTUP_TOOLCHAIN}:{})}});
  if(selected.status!==0)fail('RUNTIME_TOOLCHAIN_REQUIRED',{tool:name});found=await actualExecutable(selected.stdout.toString('utf8').trim(),name,{required:true});
 }
 const version=versionArgs?await smallCommand(found.selected,versionArgs,{signal}):{status:0,stdout:Buffer.from('original '+SOURCE_COMMIT),stderr:Buffer.alloc(0)},binary=await inspectFile(found.real);
 const description={name,path:'tools/'+name+'/bin/'+path.basename(found.selected),version:version.stdout.toString('utf8').trim()||version.stderr.toString('utf8').trim(),
  sha256:binary.sha256,bytes:binary.bytes,libraryDirectories:[]};
 if(versionArgs&&version.status!==0)fail('RUNTIME_TOOL_VERSION_FAILED',{tool:name,status:version.status});
 const observation={kind:'tool.version',tool:name,args:versionArgs??[],status:version.status,stdout:version.stdout,stderr:version.stderr};
 if(name==='node'){
  const native=await smallCommand(found.real,['-p','JSON.stringify({platform:process.platform,architecture:process.arch,nodeVersion:process.version,modulesAbi:process.versions.modules})'],{signal});
  if(native.status!==0)fail('RUNTIME_NODE_METADATA_REQUIRED');
  try{description.nativePlatform=JSON.parse(native.stdout.toString('utf8'));}catch{fail('RUNTIME_NODE_METADATA_REQUIRED');}
  const [major,minor]=description.nativePlatform.nodeVersion.replace(/^v/,'').split('.').map(Number);
  if(major<22||major===22&&minor<16)fail('RUNTIME_NODE_VERSION_UNSUPPORTED',{required:'22.16',actual:description.nativePlatform.nodeVersion});
 }
 let shared={status:0,stdout:Buffer.alloc(0),stderr:Buffer.alloc(0)},libraries=[],libraryAliases=[];
 if(process.platform==='linux'){
  const ldd=await actualExecutable('ldd','ldd',{required:false});
  if(ldd){shared=await smallCommand(ldd.real,[found.real],{signal});
   for(const line of shared.stdout.toString('utf8').split('\n')){
    const match=line.match(/=>\s+(\/[^\s]+)\s+\(/)||line.match(/^\s*(\/[^\s]+)\s+\(/);
    if(match){const lib=await fs.realpath(match[1]);if(!libraries.includes(lib))libraries.push(lib);libraryAliases.push({filename:lib,name:path.basename(match[1])});}
    if(/=>\s+not found/.test(line))fail('RUNTIME_TOOL_LIBRARY_REQUIRED',{tool:name,library:line.trim()});
   }
  }
 }
 return {found,binary,description,observation,shared,libraries,libraryAliases};
}
async function planRuntime(installationDirectory,options={}){
 const source=await verifyOriginalSource(installationDirectory),graph=await discoverPackages(installationDirectory);
 const files=new Map(),directories=new Map(),links=new Map(),sources=new Map(),pendingLinks=[],resources=[],resourceByRoot=new Map(),directoryChecks=new Map();
 const tools={},capabilities={},entrypoints={},packageBindings={},sourceRoots=[{root:installationDirectory,path:'source'}];
 function addDirectory(rel,permissions=null){relative(rel);const parts=rel.split('/');for(let i=1;i<=parts.length;i++){const p=parts.slice(0,i).join('/');
  if(!directories.has(p))directories.set(p,{path:p,mode:i===parts.length&&permissions!==null?permissions:0o755});
  else if(i===parts.length&&permissions!==null)directories.get(p).mode=permissions;}}
 function parents(rel){const p=path.posix.dirname(rel);if(p!=='.')addDirectory(p);}
 function addLink(rel,targetPath,original=null){parents(rel);const row={path:rel,target:path.posix.relative(path.posix.dirname(rel),targetPath)};
  if(original!==null&&!path.isAbsolute(original))row.originalTarget=original;
  linkTarget(row);const old=links.get(rel);if(old&&old.target!==row.target)fail('RUNTIME_RESOLUTION_CONFLICT',{path:rel});links.set(rel,row);}
 async function addFile(filename,rel){parents(rel);const actual=await inspectFile(filename),old=files.get(rel);
  if(old&&(old.sha256!==actual.sha256||old.mode!==actual.mode))fail('RUNTIME_PATH_CONFLICT',{path:rel});
  files.set(rel,{path:rel,bytes:actual.bytes,sha256:actual.sha256,mode:actual.mode});sources.set(rel,{filename,fingerprint:actual.fingerprint});}
 function addBytes(rel,bytes,permissions=0o600){parents(rel);files.set(rel,{path:rel,bytes:bytes.length,sha256:sha256(bytes),mode:permissions});sources.set(rel,{content:bytes});}
 function physical(filename){const choices=[...graph.packages.map(n=>({root:n.root,path:n.path})),...resources,...sourceRoots].filter(r=>within(r.root,filename)).sort((a,b)=>b.root.length-a.root.length);
  if(!choices.length)return null;const p=choices[0],rel=path.relative(p.root,filename).split(path.sep).join('/');return rel?p.path+'/'+rel:p.path;}
 async function walk(filename,rel,ownRoot,{skipVcs=true}={}){
  const info=await fs.lstat(filename,{bigint:true});
  if(info.isSymbolicLink()){pendingLinks.push({filename,path:rel,original:await fs.readlink(filename)});return;}
  const node=graph.byRoot.get(filename);if(node&&filename!==ownRoot){addLink(rel,node.path);return;}
  if(info.isDirectory()){
   addDirectory(rel,Number(info.mode&0o777n));directoryChecks.set(filename,fingerprint(info));
   for(const child of (await fs.readdir(filename,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name,'en'))){
    if(skipVcs&&VCS.has(child.name))continue;await walk(path.join(filename,child.name),rel+'/'+child.name,ownRoot,{skipVcs});}
  }else if(info.isFile())await addFile(filename,rel);else fail('RUNTIME_SOURCE_FILE_TYPE_UNSUPPORTED',{path:filename});
 }
 addDirectory('source',(await directory(installationDirectory)).mode&0o777);
 const sourceParents=new Set();
 for(const file of SOURCE_FILES){
  let parent=path.posix.dirname(file.path);
  while(parent!=='.'){if(!sourceParents.has(parent)){sourceParents.add(parent);const actual=await directory(join(installationDirectory,parent));addDirectory('source/'+parent,actual.mode&0o777);}parent=path.posix.dirname(parent);}
  await addFile(join(installationDirectory,file.path),'source/'+file.path);
 }
 const generated=['scripts/package-lock.json','frontend/package-lock.json','scripts/npm-shrinkwrap.json','frontend/npm-shrinkwrap.json','.turbolong-build.json',
  'target/release/rate_calc','target/release/simulate','target/release/execute_loop',
  'contracts/strategies/blend_leverage/target/wasm32v1-none/release/blend_leverage_strategy.wasm',
  'contracts/tokens/vault_share/target/wasm32v1-none/release/vault_share_token.wasm'];
 for(const rel of generated)if(await lstatMaybe(join(installationDirectory,rel)))await addFile(join(installationDirectory,rel),'source/'+rel);
 for(const rel of ['frontend/dist','alerts/.turbolong-worker']){
  const filename=join(installationDirectory,rel);if(await lstatMaybe(filename))await walk(filename,'source/'+rel,filename);
 }
 for(const rel of options.additionalSourcePaths??[]){
  relative(rel);if(rel.split('/').some(v=>v==='node_modules'||VCS.has(v))||/^(?:\.env|\.npmrc)$/.test(path.posix.basename(rel)))fail('RUNTIME_ADDITIONAL_SOURCE_INVALID',{path:rel});
  await walk(join(installationDirectory,rel),'source/'+rel,join(installationDirectory,rel));
 }
 for(const node of graph.packages)if(!node.project)await walk(node.root,node.path,node.root);
 for(const node of graph.packages){
  for(const edge of node.dependencies){if(!edge.present)continue;const selected=graph.packages.find(p=>p.id===edge.packageId);addLink(node.path+'/node_modules/'+edge.name,selected.path);}
  for(const edge of node.installed){const selected=graph.packages.find(p=>p.id===edge.packageId);addLink(node.path+'/'+edge.path,selected.path);}
  const actual=files.get(node.path+'/package.json');if(!actual||actual.sha256!==sha256(node.packageBytes))fail('RUNTIME_PACKAGE_METADATA_CHANGED',{package:node.metadata.name});
 }
 for(const project of graph.roots){
  packageBindings[project.project]={};
  for(const edge of project.dependencies){if(edge.present){const selected=graph.packages.find(p=>p.id===edge.packageId);packageBindings[project.project][edge.name]=selected.path;}}
  const bin=path.join(project.root,'node_modules','.bin');
  if(await lstatMaybe(bin))await walk(bin,project.path+'/node_modules/.bin',bin);
 }
 const selectedTools={node:options.nodeExecutable??process.execPath,stellar:options.stellarExecutable??'stellar',cargo:options.cargoExecutable??'cargo',rustc:options.rustcExecutable??'rustc',npm:options.npmExecutable??'npm'};
 const includeTools=options.includeTools??Object.keys(selectedTools);
 if(!Array.isArray(includeTools)||!includeTools.includes('node')||includeTools.some(name=>!Object.hasOwn(selectedTools,name)))fail('RUNTIME_TOOL_SELECTION_INVALID');
 for(const[name,value]of Object.entries(selectedTools)){
  if(!includeTools.includes(name))continue;
  let observed;try{observed=await inspectTool(name,value,{required:name==='node',signal:options.signal});}
  catch(error){if(name==='node'||options[name+'Executable'])throw error;addBytes('build/tool-observations/'+name+'-unavailable.json',jsonBytes({code:error.code??error.name,details:error.details??{}}));continue;}
  if(!observed)continue;
  const description=observed.description;await addFile(observed.found.real,description.path);
  addBytes('build/tool-observations/'+name+'-version.stdout',observed.observation.stdout);addBytes('build/tool-observations/'+name+'-version.stderr',observed.observation.stderr);
  addBytes('build/tool-observations/'+name+'-libraries.stdout',observed.shared.stdout);addBytes('build/tool-observations/'+name+'-libraries.stderr',observed.shared.stderr);
  for(const filename of observed.libraries){
   const logical='tools/'+name+'/lib/'+path.basename(filename);await addFile(filename,logical);
   if(!description.libraryDirectories.includes('tools/'+name+'/lib'))description.libraryDirectories.push('tools/'+name+'/lib');
   for(const alias of observed.libraryAliases.filter(row=>row.filename===filename))if(alias.name!==path.basename(filename))addLink('tools/'+name+'/lib/'+alias.name,logical);
  }
  if(name==='rustc'&&options.includeRustToolchain!==false){
   const sysroot=await smallCommand(observed.found.real,['--print','sysroot'],{signal:options.signal});
   if(sysroot.status===0){const root=await fs.realpath(sysroot.stdout.toString('utf8').trim());
    const item={root,path:'tools/rust-toolchain'};resources.push(item);resourceByRoot.set(root,item);await walk(root,item.path,root);
    description.sysroot=item.path;const relativeBinary=physical(observed.found.real);if(relativeBinary)description.path=relativeBinary;}
  }
  if(name==='npm'){
   let root=path.dirname(observed.found.real),packageRoot=null;
   while(true){if(await lstatMaybe(path.join(root,'package.json'))){try{if((await readJSON(path.join(root,'package.json'))).value.name==='npm'){packageRoot=root;break;}}catch{}}
    const parent=path.dirname(root);if(parent===root)break;root=parent;}
   if(!packageRoot)fail('RUNTIME_NPM_SOURCE_REQUIRED');
   const item={root:packageRoot,path:'tools/npm/source'};resources.push(item);resourceByRoot.set(packageRoot,item);await walk(packageRoot,item.path,packageRoot);
   description.path=physical(observed.found.real);description.nodeTool=true;
  }
  if(name==='stellar'){
   const help=await smallCommand(observed.found.real,['contract','invoke','--help'],{signal:options.signal});
   addBytes('build/tool-observations/stellar-invoke-help.stdout',help.stdout);addBytes('build/tool-observations/stellar-invoke-help.stderr',help.stderr);
   const helpText=Buffer.concat([help.stdout,help.stderr]).toString('utf8');
   description.invokeFlags={rpcUrl:helpText.includes('--rpc-url'),networkPassphrase:helpText.includes('--network-passphrase')};
   description.invokeEnvironment={rpcUrl:helpText.includes('STELLAR_RPC_URL'),networkPassphrase:helpText.includes('STELLAR_NETWORK_PASSPHRASE')};
  }
  tools[name]=description;
 }
 const buildDirectory=absolute(options.buildDirectory??installationDirectory+'.turbolong-build','buildDirectory');
 if(await lstatMaybe(buildDirectory)){
  for(const rel of ['operation.json','receipt.json','commands','cargo-vendor','cargo-vendor-config.toml']){
   const filename=join(buildDirectory,rel);if(await lstatMaybe(filename)){
    const item={root:filename,path:'build/'+rel};resources.push(item);resourceByRoot.set(filename,item);await walk(filename,item.path,filename);}
  }
 }
 for(let index=0;index<pendingLinks.length;index++){
  const item=pendingLinks[index];let target;try{target=await fs.realpath(item.filename);}catch(error){fail('RUNTIME_SOURCE_LINK_UNAVAILABLE',{path:item.path},error);}
  let mapped=physical(target);
  if(!mapped){
   let resource=resourceByRoot.get(target);if(!resource){resource={root:target,path:'resources/r'+String(resources.length).padStart(4,'0')};resources.push(resource);resourceByRoot.set(target,resource);await walk(target,resource.path,target);}
   mapped=resource.path;
  }
  if(!files.has(mapped)&&!directories.has(mapped)&&!links.has(mapped)){
   // A link into selected original source must carry that exact target too.
   await walk(target,mapped,target);
  }
  addLink(item.path,mapped,item.original);
 }
 const scriptRoot=graph.roots.find(n=>n.project==='scripts');
 const missingDependencies=[];const visited=new Set();
 function missingFrom(node){if(visited.has(node.id))return;visited.add(node.id);for(const edge of node.dependencies){
  if(!edge.present){if(!edge.optional)missingDependencies.push(node.metadata.name+' → '+edge.name);}
  else missingFrom(graph.packages.find(p=>p.id===edge.packageId));}}
 if(scriptRoot)missingFrom(scriptRoot);else missingDependencies.push('scripts/package.json');
 const tsx=scriptRoot?await resolvePackage('tsx',scriptRoot.root):null;
 let tsxPath=null;if(tsx){const bin=typeof tsx.metadata.bin==='string'?tsx.metadata.bin:tsx.metadata.bin?.tsx;if(bin)tsxPath=physical(await fs.realpath(path.resolve(tsx.root,bin)));}
 entrypoints.tsx=tsxPath;
 const scripts={rebalance:'scripts/rebalance_keeper.ts',harvest:'scripts/harvest_router.ts',routing:'scripts/swap_route_report.ts',
  deploymentMainnet:'scripts/deploy_strategy_mainnet.ts',deploymentTestnet:'scripts/deploy_strategy_testnet.ts'};
 for(const[name,rel]of Object.entries(scripts))entrypoints[name]='source/'+rel;
 for(const[name,rel]of Object.entries({rateCalc:'target/release/rate_calc',simulate:'target/release/simulate',executeLoop:'target/release/execute_loop'})){
  entrypoints[name]=files.has('source/'+rel)?'source/'+rel:null;
  if(entrypoints[name]&&process.platform==='linux'){
   const observed=await inspectTool(name,join(installationDirectory,rel),{required:true,signal:options.signal,versionArgs:null});
   for(const lib of observed.libraries){const logical='tools/'+name+'/lib/'+path.basename(lib);await addFile(lib,logical);
    for(const alias of observed.libraryAliases.filter(row=>row.filename===lib))if(alias.name!==path.basename(lib))addLink('tools/'+name+'/lib/'+alias.name,logical);}
   tools[name]={...observed.description,path:entrypoints[name],libraryDirectories:observed.libraries.length?['tools/'+name+'/lib']:[]};
   addBytes('build/tool-observations/'+name+'-libraries.stdout',observed.shared.stdout);
  }
 }
 const scriptReady=Boolean(tools.node&&tsxPath&&!missingDependencies.length);
 for(const action of RUNTIME_ACTIONS){
  let required=[],ready=false;
  if(action==='vault.inspect'||action==='vault.shareInspect'){ready=Boolean(tools.stellar);required=['stellar'];}
  else if(action==='rates.project'){ready=Boolean(entrypoints.rateCalc);required=['rateCalc'];}
  else if(action==='rates.simulate'){ready=Boolean(entrypoints.simulate&&tools.stellar);required=['simulate','stellar'];}
  else{ready=scriptReady;required=['node','tsx',...missingDependencies];}
  if(action==='deployment.plan'){
   const wasm=['source/contracts/strategies/blend_leverage/target/wasm32v1-none/release/blend_leverage_strategy.wasm','source/contracts/tokens/vault_share/target/wasm32v1-none/release/vault_share_token.wasm'];
   ready=ready&&wasm.every(p=>files.has(p));required.push(...wasm.filter(p=>!files.has(p)));
  }
  capabilities[action]={available:ready,required,missingDependencies:scriptReady?[]:missingDependencies};
 }
 if(tools.cargo){const found=await actualExecutable(options.cargoExecutable??'cargo','cargo',{required:false});if(found){const mapped=physical(found.real);if(mapped&&mapped.startsWith('tools/rust-toolchain/'))tools.cargo.path=mapped;}}
 for(const filename of directoryChecks.keys()){const current=await fs.lstat(filename,{bigint:true});if(fingerprint(current)!==directoryChecks.get(filename))fail('RUNTIME_SOURCE_CHANGED',{path:filename});}
 for(const rel of files.keys())if(directories.has(rel)||links.has(rel))fail('RUNTIME_PATH_CONFLICT',{path:rel});
 for(const rel of directories.keys())if(links.has(rel))fail('RUNTIME_PATH_CONFLICT',{path:rel});
 const sortedFiles=[...files.values()].sort((a,b)=>a.path.localeCompare(b.path,'en'));
 const manifest={schema:SCHEMA,version:SOURCE_COMMIT,source:{...source,root:'source',files:SOURCE_FILES},
  platform:{...(tools.node?.nativePlatform??{platform:process.platform,architecture:process.arch,nodeVersion:process.version,modulesAbi:process.versions.modules}),
   hasNativeAddons:sortedFiles.some(f=>f.path.endsWith('.node'))},
  entrypoints,tools,capabilities,packageBindings,
  packages:graph.packages.map(n=>({id:n.id,path:n.path,name:n.metadata.name,version:n.metadata.version,project:n.project,
   packageJsonSha256:sha256(n.packageBytes),dependencies:n.dependencies,installed:n.installed})),
  directories:[...directories.values()].sort((a,b)=>a.path.localeCompare(b.path,'en')),links:[...links.values()].sort((a,b)=>a.path.localeCompare(b.path,'en')),
  files:sortedFiles,fileCount:sortedFiles.length,bytes:sortedFiles.reduce((n,f)=>n+f.bytes,0)};
 count(manifest.bytes,'bytes');manifest.id=identity(manifest);validateManifest(manifest);
 return {manifest,sources,directoryChecks};
}


function manifestPaths(manifest){
 const paths=new Map(),links=new Map();
 for(const[kind,items]of [['file',manifest.files],['directory',manifest.directories],['link',manifest.links]])for(const item of items){
  if(!object(item))fail('RUNTIME_MANIFEST_INVALID',{kind});relative(item.path);
  if(paths.has(item.path)||['manifest.json','.operation.json'].includes(item.path))fail('RUNTIME_PATH_CONFLICT',{path:item.path});
  paths.set(item.path,kind);if(kind==='link'){linkTarget(item);links.set(item.path,item);}else mode(item.mode);
  if(kind==='file'){count(item.bytes,item.path);hash(item.sha256,item.path);}
 }
 function resolved(value){
  let rel=relative(value);const seen=new Set();
  for(let step=0;step<=links.size;step++){
   const parts=rel.split('/');let changed=false;
   for(let i=1;i<=parts.length;i++){const prefix=parts.slice(0,i).join('/'),link=links.get(prefix);if(!link)continue;
    if(seen.has(prefix))fail('RUNTIME_LINK_CYCLE',{path:prefix});seen.add(prefix);
    rel=linkTarget(link)+(i<parts.length?'/'+parts.slice(i).join('/'):'');changed=true;break;}
   if(!changed){if(!paths.has(rel))fail('RUNTIME_LINK_TARGET_MISSING',{path:rel});return rel;}
  }fail('RUNTIME_LINK_CYCLE');
 }
 return {paths,links,resolved};
}
function validateManifest(manifest){
 if(!object(manifest)||manifest.schema!==SCHEMA||manifest.version!==SOURCE_COMMIT||!Array.isArray(manifest.files)||
  !Array.isArray(manifest.directories)||!Array.isArray(manifest.links)||!Array.isArray(manifest.packages)||
  !object(manifest.entrypoints)||!object(manifest.tools)||!object(manifest.capabilities)||!object(manifest.packageBindings)||
  !object(manifest.platform))fail('RUNTIME_MANIFEST_INVALID');
 hash(manifest.id,'id');if(identity(manifest)!==manifest.id)fail('RUNTIME_ID_MISMATCH');
 const {paths,resolved}=manifestPaths(manifest);
 for(const rel of paths.keys()){let parent=path.posix.dirname(rel);while(parent!=='.'){if(paths.get(parent)!=='directory')fail('RUNTIME_PARENT_INVALID',{path:rel,parent});parent=path.posix.dirname(parent);}}
 for(const link of manifest.links)resolved(link.path);
 if(manifest.fileCount!==manifest.files.length||manifest.bytes!==manifest.files.reduce((sum,item)=>sum+item.bytes,0))fail('RUNTIME_MANIFEST_TOTAL_MISMATCH');
 count(manifest.bytes,'bytes');
 if(manifest.source?.repository!=='Dgetsylver/TurboLong'||manifest.source.commit!==SOURCE_COMMIT||
  manifest.source.inventorySha256!==SOURCE_INVENTORY_SHA256||manifest.source.root!=='source'||
  canonical(manifest.source.files)!==canonical(SOURCE_FILES))fail('RUNTIME_ORIGINAL_SOURCE_MISMATCH');
 const declared=new Map(manifest.files.map(item=>[item.path,item]));
 for(const original of SOURCE_FILES){const item=declared.get('source/'+original.path);if(!item||item.bytes!==original.bytes||item.sha256!==original.sha256)fail('RUNTIME_ORIGINAL_SOURCE_MISMATCH',{path:original.path});}
 for(const[name,entry]of Object.entries(manifest.entrypoints))if(entry!==null&&paths.get(resolved(entry))!=='file')fail('RUNTIME_ENTRYPOINTS_INVALID',{entrypoint:name});
 for(const[name,item]of Object.entries(manifest.tools)){
  if(!object(item)||typeof item.version!=='string'||paths.get(resolved(item.path))!=='file'||!Array.isArray(item.libraryDirectories))fail('RUNTIME_TOOL_INVALID',{tool:name});
  for(const dir of item.libraryDirectories)if(paths.get(resolved(dir))!=='directory')fail('RUNTIME_TOOL_LIBRARY_REQUIRED',{tool:name});
 }
 const packageMap=new Map();for(const item of manifest.packages){
  if(!object(item)||!/^p[0-9]{4,}$/.test(item.id)||packageMap.has(item.id)||
   (item.project?item.path!=='source/'+item.project||!ROOT_PROJECTS.includes(item.project):item.path!=='packages/'+item.id)||
   !Array.isArray(item.dependencies)||!Array.isArray(item.installed)||!declared.has(item.path+'/package.json'))
    fail('RUNTIME_PACKAGE_GRAPH_INVALID');
  hash(item.packageJsonSha256,'packageJsonSha256');packageMap.set(item.id,item);
 }
 for(const item of manifest.packages){
  for(const edge of item.dependencies){
   if(!object(edge)||!PACKAGE_NAME.test(edge.name)||typeof edge.present!=='boolean'||typeof edge.optional!=='boolean'||
    (edge.present?!packageMap.has(edge.packageId):edge.packageId!==null))fail('RUNTIME_PACKAGE_GRAPH_INVALID',{package:item.id});
   if(edge.present&&resolved(item.path+'/node_modules/'+edge.name)!==packageMap.get(edge.packageId).path)fail('RUNTIME_RESOLUTION_MISMATCH',{package:item.id,dependency:edge.name});
  }
  for(const edge of item.installed)if(!packageMap.has(edge.packageId)||resolved(item.path+'/'+relative(edge.path))!==packageMap.get(edge.packageId).path)
   fail('RUNTIME_RESOLUTION_MISMATCH',{package:item.id});
 }
 for(const[project,bindings]of Object.entries(manifest.packageBindings)){
  if(!ROOT_PROJECTS.includes(project)||!object(bindings))fail('RUNTIME_PACKAGE_BINDINGS_INVALID');
  for(const[name,target]of Object.entries(bindings))if(!PACKAGE_NAME.test(name)||resolved('source/'+project+'/node_modules/'+name)!==target)
   fail('RUNTIME_PACKAGE_BINDINGS_INVALID',{project,name});
 }
 if(manifest.platform.hasNativeAddons!==manifest.files.some(item=>item.path.endsWith('.node')))fail('RUNTIME_NATIVE_ABI_METADATA_MISMATCH');
 for(const action of RUNTIME_ACTIONS)if(!object(manifest.capabilities[action])||typeof manifest.capabilities[action].available!=='boolean')fail('RUNTIME_CAPABILITIES_INVALID',{action});
 return manifest;
}
async function loadManifest(root,expectedManifestSha256){
 if(expectedManifestSha256!==undefined&&expectedManifestSha256!==null)hash(expectedManifestSha256,'expectedManifestSha256');
 await directory(root);const bytes=await readFile(path.join(root,'manifest.json')),manifestSha256=sha256(bytes);
 if(expectedManifestSha256&&manifestSha256!==expectedManifestSha256)fail('RUNTIME_MANIFEST_HASH_MISMATCH');
 let manifest;try{manifest=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch(error){fail('RUNTIME_MANIFEST_INVALID',{},error);}
 validateManifest(manifest);if(!bytes.equals(jsonBytes(manifest)))fail('RUNTIME_MANIFEST_SERIALIZATION_MISMATCH');
 return {manifest,manifestSha256,bytes};
}
async function verifyFiles(root,manifest,{layout=true,signal}={}){
 for(const item of manifest.files){
  signalCheck(signal);await safeParents(root,item.path);const actual=await inspectFile(join(root,item.path));
  if(actual.bytes!==item.bytes||actual.sha256!==item.sha256)fail('RUNTIME_FILE_HASH_MISMATCH',{path:item.path});
  if(layout&&actual.mode!==item.mode)fail('RUNTIME_FILE_MODE_MISMATCH',{path:item.path});
 }
 if(layout){
  for(const item of manifest.directories){const actual=await directory(join(root,item.path));if((actual.mode&0o777)!==item.mode)fail('RUNTIME_DIRECTORY_MODE_MISMATCH',{path:item.path});}
  for(const item of manifest.links){await safeParents(root,item.path);const filename=join(root,item.path),info=await lstatMaybe(filename);
   if(!info?.isSymbolicLink()||await fs.readlink(filename)!==item.target)fail('RUNTIME_LINK_MISMATCH',{path:item.path});
   if(!within(root,await fs.realpath(filename)))fail('RUNTIME_LINK_ESCAPE',{path:item.path});}
 }
 const files=new Map(manifest.files.map(item=>[item.path,item]));
 for(const item of manifest.packages){
  const loaded=await readJSON(join(root,item.path+'/package.json'),16*1024*1024),metadata=loaded.value;
  if(sha256(loaded.bytes)!==item.packageJsonSha256||metadata.name!==item.name||metadata.version!==item.version)fail('RUNTIME_PACKAGE_METADATA_MISMATCH',{package:item.id});
  const expected=packageDeclarations(metadata,Boolean(item.project));
  if(expected.size!==item.dependencies.length)fail('RUNTIME_PACKAGE_DECLARATION_MISMATCH',{package:item.id});
  for(const edge of item.dependencies){const declaration=expected.get(edge.name);if(!declaration||declaration.range!==edge.range||declaration.kind!==edge.kind||declaration.optional!==edge.optional)
   fail('RUNTIME_PACKAGE_DECLARATION_MISMATCH',{package:item.id,dependency:edge.name});}
 }
 const receiptFile=files.get('build/receipt.json')??files.get('source/.turbolong-build.json');
 if(receiptFile){const receipt=(await readJSON(join(root,receiptFile.path))).value;
  if(receipt.schema!==BUILD_SCHEMA||receipt.sourceCommit!==SOURCE_COMMIT||receipt.sourceInventorySha256!==SOURCE_INVENTORY_SHA256)fail('RUNTIME_BUILD_RECEIPT_INVALID');
  if(!Array.isArray(receipt.artifacts)||receipt.artifactsSha256!==sha256(Buffer.from(canonical(receipt.artifacts))))fail('RUNTIME_BUILD_ARTIFACTS_INVALID');
  for(const artifact of receipt.artifacts){const item=files.get('source/'+relative(artifact.path));if(!item||item.bytes!==artifact.bytes||item.sha256!==artifact.sha256||item.mode!==artifact.mode)
   fail('RUNTIME_COMPILED_SOURCE_CHANGED',{path:artifact.path});}
 }
}
async function matchesProcessIdentity(owner) {
  if(!object(owner)||!Number.isInteger(owner.pid)||owner.pid<=0)return false;
  if(process.platform==='linux'){
    const actual=Number.isInteger(owner.procPid)&&owner.procPid>0?await procIdentity(owner.procPid):await processIdentity(owner.pid);
    if(!actual||actual.absent)return false;
    if(owner.boot&&actual.boot!==owner.boot||owner.namespace&&actual.namespace!==owner.namespace||
       owner.start&&actual.start!==owner.start)return false;
    if(owner.procPid&&(!owner.start||actual.procPid!==owner.procPid))return false;
    return true;
  }
  try{process.kill(owner.pid,0);return true;}catch(error){if(error.code==='ESRCH')return false;if(error.code==='EPERM')return true;throw error;}
}
async function procIdentity(procPid) {
  const base=procPid==='self'?'/proc/self':'/proc/'+procPid;
  let stat;
  try { stat=await fs.readFile(base+'/stat','utf8'); }
  catch(error){if(['ENOENT','ESRCH'].includes(error.code))return null;throw error;}
  const actualPid=Number(stat.slice(0,stat.indexOf(' ')));
  const fields=stat.slice(stat.lastIndexOf(')')+2).trim().split(/\s+/);
  let namespace=null,nspids=[],boot=null;
  try{namespace=await fs.readlink(base+'/ns/pid');}catch(error){if(!['ENOENT','EACCES','EPERM'].includes(error.code))throw error;}
  try{
    const status=await fs.readFile(base+'/status','utf8'),line=status.split('\n').find(row=>row.startsWith('NSpid:'));
    if(line)nspids=line.slice(6).trim().split(/\s+/).map(Number);
  }catch(error){if(!['ENOENT','EACCES','EPERM'].includes(error.code))throw error;}
  try{boot=(await fs.readFile('/proc/sys/kernel/random/boot_id','utf8')).trim();}catch{}
  if(!Number.isInteger(actualPid)||actualPid<=0||!/^\d+$/.test(fields[19]??''))fail('RUNTIME_PROCESS_IDENTITY_UNAVAILABLE');
  return {pid:nspids.at(-1)??actualPid,procPid:actualPid,boot,start:fields[19],namespace,nspids};
}
async function processIdentity(pid=process.pid) {
  if(process.platform!=='linux')return {pid,procPid:null,boot:null,start:null,namespace:null,nspids:[]};
  const self=await procIdentity('self');
  if(!self)fail('RUNTIME_PROCESS_IDENTITY_UNAVAILABLE');
  if(pid===process.pid)return {...self,pid:process.pid};
  let direct=await procIdentity(pid);
  if(direct&&direct.pid===pid&&direct.namespace===self.namespace)return direct;
  // /proc can be mounted from an ancestor PID namespace while Node reports a
  // container-local PID. Resolve children by both namespace and their NSpid.
  for(const item of await fs.readdir('/proc',{withFileTypes:true})){
    if(!item.isDirectory()||!/^\d+$/.test(item.name)||Number(item.name)===self.procPid)continue;
    try{
      const actual=await procIdentity(Number(item.name));
      if(actual&&actual.pid===pid&&actual.namespace===self.namespace)return actual;
    }catch(error){if(!['ENOENT','ESRCH','EACCES','EPERM'].includes(error.code))throw error;}
  }
  return {pid,procPid:null,boot:self.boot,start:null,namespace:self.namespace,nspids:[],absent:true};
}

async function acquire(destination) {
  const lease = destination + '.runtime-lock';
  const token = randomUUID();
  const owner = {...await processIdentity(), token};
  for (let attempt = 0; attempt < 3; attempt++) {
    const candidate = lease + '.candidate-' + token;
    await fs.mkdir(candidate, {mode: 0o700});
    try {
      await atomicBytes(candidate, 'owner.json', jsonBytes(owner));
      try {
        await fs.rename(candidate, lease);
        await syncDirectory(path.dirname(lease));
        return async () => {
          const current = (await readJSON(path.join(lease, 'owner.json'))).value;
          if (current.token !== token) fail('RUNTIME_LEASE_CHANGED');
          await fs.rm(lease, {recursive: true});
          await syncDirectory(path.dirname(lease));
        };
      } catch (error) {
        if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error;
      }
    } finally { await fs.rm(candidate, {recursive: true, force: true}); }
    let previous;
    try { previous = (await readJSON(path.join(lease, 'owner.json'))).value; }
    catch { fail('RUNTIME_BUSY', {directory: destination}); }
    if (!Number.isInteger(previous.pid) || previous.pid <= 0 || typeof previous.token !== 'string')
      fail('RUNTIME_BUSY', {directory: destination});
    if(await matchesProcessIdentity(previous))
      fail('RUNTIME_BUSY',{directory:destination,owner:{pid:previous.pid,procPid:previous.procPid??null,
        boot:previous.boot??null,start:previous.start??null,namespace:previous.namespace??null}});
    const stale = lease + '.stale-' + previous.token + '-' + randomUUID();
    try { await fs.rename(lease, stale); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    const moved = (await readJSON(path.join(stale, 'owner.json'))).value;
    if (moved.token !== previous.token) {
      try { await fs.rename(stale, lease); } catch {}
      fail('RUNTIME_LEASE_CHANGED');
    }
    await fs.rm(stale, {recursive: true});
  }
  fail('RUNTIME_BUSY', {directory: destination});
}
async function copyFile(source, destinationRoot, item) {
  await safeParents(destinationRoot, item.path, {create: true});
  const filename = join(destinationRoot, item.path);
  const existing = await lstatMaybe(filename);
  if (existing) {
    if (!existing.isFile() || existing.isSymbolicLink()) fail('RUNTIME_STAGING_FILE_CONFLICT', {path: item.path});
    const actual = await inspectFile(filename);
    if (actual.bytes !== item.bytes || actual.sha256 !== item.sha256) fail('RUNTIME_STAGING_FILE_CONFLICT', {path: item.path});
    await fs.chmod(filename, item.mode);
    return;
  }
  if (source.content) {
    if (source.content.length !== item.bytes || sha256(source.content) !== item.sha256) fail('RUNTIME_SOURCE_CHANGED', {path: item.path});
    await atomicBytes(destinationRoot, item.path, source.content, item.mode);
    return;
  }
  const input = await fs.open(source.filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  const temporary = filename + '.partial-' + randomUUID();
  let output;
  try {
    const before = await input.stat({bigint: true});
    if (!before.isFile() || (source.fingerprint && fingerprint(before) !== source.fingerprint)) fail('RUNTIME_SOURCE_CHANGED', {path: item.path});
    output = await fs.open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    const digest = createHash('sha256'), buffer = Buffer.allocUnsafe(BUFFER_BYTES);
    let bytes = 0;
    while (true) {
      const {bytesRead} = await input.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      const chunk = buffer.subarray(0, bytesRead);
      digest.update(chunk);
      let written = 0;
      while (written < bytesRead) {
        const result = await output.write(chunk, written, bytesRead - written, null);
        if (!result.bytesWritten) fail('RUNTIME_WRITE_INCOMPLETE', {path: item.path});
        written += result.bytesWritten;
      }
      bytes += bytesRead;
    }
    const after = await input.stat({bigint: true});
    if (fingerprint(before) !== fingerprint(after) || bytes !== item.bytes || digest.digest('hex') !== item.sha256)
      fail('RUNTIME_SOURCE_CHANGED', {path: item.path});
    await output.chmod(item.mode);
    await output.sync();
    await output.close(); output = null;
    await fs.rename(temporary, filename);
    await syncDirectory(path.dirname(filename));
  } finally {
    await input.close();
    if (output) await output.close();
    await fs.rm(temporary, {force: true});
  }
}
async function materialize(destination, plan, kind) {
  const parent = path.dirname(destination);
  await fs.mkdir(parent, {recursive: true, mode: 0o700});
  await directory(parent);
  const release = await acquire(destination);
  try {
    const existing = await lstatMaybe(destination);
    if (existing) {
      await directory(destination);
      if (await lstatMaybe(path.join(destination, 'manifest.json'))) {
        const result = await verifyTurbolongRuntime({directory: destination});
        if (result.id !== plan.manifest.id) fail('RUNTIME_GENERATION_CONFLICT', {directory: destination});
        return result;
      }
      if ((await fs.readdir(destination)).length) fail('RUNTIME_DESTINATION_NOT_EMPTY', {directory: destination});
    }
    const staging = destination + '.runtime-stage';
    const existed = await lstatMaybe(staging);
    if (!existed) {
      await fs.mkdir(staging, {mode: 0o700});
      await atomicBytes(staging, '.operation.json', jsonBytes({schema: 'stellar-forge.turbolong-operations.runtime-operation.v1', kind, id: plan.manifest.id}));
    } else {
      await directory(staging);
      const markerFile = path.join(staging, '.operation.json');
      if (await lstatMaybe(markerFile)) {
        const marker = (await readJSON(markerFile)).value;
        if (marker.schema !== 'stellar-forge.turbolong-operations.runtime-operation.v1' || marker.kind !== kind || marker.id !== plan.manifest.id)
          fail('RUNTIME_GENERATION_CONFLICT', {directory: destination});
      } else if (await lstatMaybe(path.join(staging, 'manifest.json'))) {
        const retained = await loadManifest(staging);
        if (retained.manifest.id !== plan.manifest.id) fail('RUNTIME_GENERATION_CONFLICT', {directory: destination});
      } else {
        const leftovers = await fs.readdir(staging);
        if (leftovers.some(name => !/^\.operation\.json\.partial-[0-9a-f-]{36}$/.test(name)))
          fail('RUNTIME_GENERATION_CONFLICT', {directory: destination});
        for (const name of leftovers) await fs.rm(path.join(staging, name), {force: true});
        await atomicBytes(staging, '.operation.json', jsonBytes({schema: 'stellar-forge.turbolong-operations.runtime-operation.v1', kind, id: plan.manifest.id}));
      }
    }
    for (const item of plan.manifest.directories) {
      await safeParents(staging, item.path, {create: true});
      const target = join(staging, item.path);
      try { await fs.mkdir(target, {mode: 0o700}); } catch (error) { if (error.code !== 'EEXIST') throw error; }
      await directory(target);
      await fs.chmod(target, 0o700);
    }
    for (const item of plan.manifest.files) { signalCheck(plan.signal); await copyFile(plan.sources.get(item.path), staging, item); }
    for(const [filename,expected] of plan.directoryChecks??[]) { const current=await fs.lstat(filename,{bigint:true}); if(fingerprint(current)!==expected)fail("RUNTIME_SOURCE_CHANGED",{path:filename}); }
    for (const item of plan.manifest.links) {
      await safeParents(staging, item.path);
      const filename = join(staging, item.path), info = await lstatMaybe(filename);
      if (info) {
        if (!info.isSymbolicLink() || await fs.readlink(filename) !== item.target) fail('RUNTIME_STAGING_LINK_CONFLICT', {path: item.path});
      } else await fs.symlink(item.target, filename);
      await syncDirectory(path.dirname(filename));
    }
    // Only temporaries of this generation's declared files are ours to remove.
    const temporaryParents = new Map();
    for (const item of [...plan.manifest.files, {path: 'manifest.json'}, {path: '.operation.json'}]) {
      const parentPath = path.dirname(join(staging, item.path));
      if (!temporaryParents.has(parentPath)) temporaryParents.set(parentPath, new Set());
      temporaryParents.get(parentPath).add(path.basename(item.path));
    }
    for (const [parentPath, filenames] of temporaryParents) {
      for (const name of await fs.readdir(parentPath)) {
        const match = /^(.*)\.partial-([0-9a-f-]{36})$/.exec(name);
        if (match && filenames.has(match[1])) await fs.rm(path.join(parentPath, name), {force: true});
      }
    }
    for (const item of [...plan.manifest.directories].sort((a, b) => b.path.split('/').length - a.path.split('/').length))
      await fs.chmod(join(staging, item.path), item.mode);
    const manifestBytes = jsonBytes(plan.manifest);
    await atomicBytes(staging, 'manifest.json', manifestBytes);
    await verifyFiles(staging, plan.manifest);

    await fs.rm(path.join(staging, '.operation.json'), {force: true});
    await syncDirectory(staging);
    if (await lstatMaybe(destination)) await fs.rmdir(destination);
    await fs.rename(staging, destination);
    await syncDirectory(parent);
    return descriptor(destination, plan.manifest, sha256(manifestBytes));
  } finally { await release(); }
}

/** Capture the complete selected original source and installed native tools before use.
 * The exact generation directory is caller-selected. An acknowledged immutable
 * generation reopens as itself; interrupted copies retain their original plan ID.
 */

function runtimeLogicalFile(manifest,value){
 let current=relative(value);const map=new Map(manifest.links.map(item=>[item.path,item])),seen=new Set();
 for(let step=0;step<=manifest.links.length;step++){
  const parts=current.split('/');let changed=false;
  for(let i=1;i<=parts.length;i++){
   const prefix=parts.slice(0,i).join('/'),link=map.get(prefix);if(!link)continue;
   if(seen.has(prefix))fail('RUNTIME_LINK_CYCLE');seen.add(prefix);
   current=linkTarget(link)+(i<parts.length?'/'+parts.slice(i).join('/'):'');changed=true;break;
  }
  if(!changed){if(!manifest.files.some(item=>item.path===current))fail('RUNTIME_FILE_REQUIRED',{path:value});return current;}
 }fail('RUNTIME_LINK_CYCLE');
}

export async function retainTurbolongRuntime(options={}){
 const installed=absolute(options.installationDirectory??options.sourceDirectory,'installationDirectory');
 const destination=absolute(options.directory,'directory');
 if(within(installed,destination)||within(destination,installed))fail('RUNTIME_SOURCE_DESTINATION_OVERLAP');
 if(await lstatMaybe(path.join(destination,'manifest.json')))return verifyTurbolongRuntime({directory:destination,expectedManifestSha256:options.expectedManifestSha256,signal:options.signal});
 const plan=await planRuntime(installed,options);plan.signal=options.signal;
 const result=await materialize(destination,plan,'retain');
 if(options.expectedManifestSha256&&result.manifestSha256!==hash(options.expectedManifestSha256,'expectedManifestSha256'))fail('RUNTIME_MANIFEST_HASH_MISMATCH');
 return result;
}
export async function verifyTurbolongRuntime({directory:selectedDirectory,expectedManifestSha256,signal}={}){
 const root=absolute(selectedDirectory,'directory'),loaded=await loadManifest(root,expectedManifestSha256);
 await verifyFiles(root,loaded.manifest,{signal});return descriptor(root,loaded.manifest,loaded.manifestSha256);
}
export async function restoreTurbolongRuntime({sourceDirectory,destination:selectedDestination,expectedManifestSha256,signal}={}){
 const source=absolute(sourceDirectory,'sourceDirectory'),destination=absolute(selectedDestination,'destination');
 if(source===destination)return verifyTurbolongRuntime({directory:source,expectedManifestSha256,signal});
 if(within(source,destination)||within(destination,source))fail('RUNTIME_SOURCE_DESTINATION_OVERLAP');
 const loaded=await loadManifest(source,expectedManifestSha256);await verifyFiles(source,loaded.manifest,{layout:false,signal});
 const result=await materialize(destination,{manifest:loaded.manifest,sources:new Map(loaded.manifest.files.map(file=>[file.path,{filename:join(source,file.path)}])),signal},'restore');
 if(result.manifestSha256!==loaded.manifestSha256)fail('RUNTIME_MANIFEST_HASH_MISMATCH');return result;
}
export async function resolveTurbolongRuntime(options={}){
 const selected=options.directory??options.runtimeDirectory;
 if(selected){
  const root=absolute(selected,'runtimeDirectory');
  if(await lstatMaybe(path.join(root,'manifest.json'))){
   const loaded=await loadManifest(root,options.expectedManifestSha256);await verifyFiles(root,loaded.manifest,{layout:false,signal:options.signal});
   try{return await verifyTurbolongRuntime({directory:root,expectedManifestSha256:loaded.manifestSha256,signal:options.signal});}
   catch(error){if(!['RUNTIME_LINK_MISMATCH','RUNTIME_DIRECTORY_MODE_MISMATCH','RUNTIME_FILE_MODE_MISMATCH','RUNTIME_DIRECTORY_REQUIRED'].includes(error.code))throw error;
    return restoreTurbolongRuntime({sourceDirectory:root,destination:root+'.installed-'+loaded.manifest.id,expectedManifestSha256:loaded.manifestSha256,signal:options.signal});}
  }
  return retainTurbolongRuntime({...options,directory:root});
 }
 const installed=absolute(options.installationDirectory??options.sourceDirectory,'installationDirectory'),plan=await planRuntime(installed,options);plan.signal=options.signal;
 return materialize(installed+'.turbolong-runtimes/'+plan.manifest.id,plan,'retain');
}
export async function readTurbolongRuntimeManifest({directory:selectedDirectory,expectedManifestSha256}={}){
 return loadManifest(absolute(selectedDirectory,'directory'),expectedManifestSha256);
}
export function publicTurbolongRuntime(runtime){
 return Object.freeze({id:hash(runtime.id,'runtimeId'),manifestSha256:hash(runtime.manifestSha256,'manifestSha256'),version:SOURCE_COMMIT,platform:portable(runtime.platform??runtime.manifest?.platform)});
}
export async function bindTurbolongRuntime({directory:selectedDirectory,applicationDirectory,expectedManifestSha256}={}){
 const runtime=await verifyTurbolongRuntime({directory:selectedDirectory,expectedManifestSha256});
 const application=absolute(applicationDirectory,'applicationDirectory');await directory(application);
 // Native scripts resolve inside their own complete retained package graph. The
 // independently authored host imports no publisher modules from its source tree.
 return {schema:'stellar-forge.turbolong-operations.runtime-binding.v1',...publicTurbolongRuntime(runtime),
  applicationDirectory:await fs.realpath(application),runtimeDirectory:runtime.directory,sourceDirectory:runtime.sourceDirectory,
  entrypoints:runtime.entrypoints,tools:runtime.tools,configuration:{runtimeDirectory:runtime.directory,expectedManifestSha256:runtime.manifestSha256}};
}


const SUPERVISOR_SOURCE="\nimport {spawn} from 'node:child_process';\nimport {createHash} from 'node:crypto';\nimport {constants} from 'node:fs';\nimport * as fs from 'node:fs/promises';\nimport path from 'node:path';\nconst root=process.argv[2],digest=b=>createHash('sha256').update(b).digest('hex');\nconst bytes=v=>Buffer.from(JSON.stringify(v,null,2)+'\\n');\nasync function syncDir(p){const h=await fs.open(p,constants.O_RDONLY);try{await h.sync();}finally{await h.close();}}\nasync function save(name,value){const p=path.join(root,name),tmp=p+'.writing-'+process.pid,h=await fs.open(tmp,'w',0o600);try{await h.writeFile(bytes(value));await h.sync();}finally{await h.close();}await fs.rename(tmp,p);await syncDir(root);}\nasync function identity(pid='self'){\n if(process.platform!=='linux')return {pid:pid==='self'?process.pid:pid};\n async function one(v){try{\n const base='/proc/'+v,stat=await fs.readFile(base+'/stat','utf8'),fields=stat.slice(stat.lastIndexOf(')')+2).trim().split(/\\s+/);\n const status=await fs.readFile(base+'/status','utf8'),line=status.split('\\n').find(x=>x.startsWith('NSpid:'));\n const nspids=line?line.slice(6).trim().split(/\\s+/).map(Number):[];\n return {pid:nspids.at(-1)??Number(stat.split(' ')[0]),procPid:Number(stat.split(' ')[0]),start:fields[19],nspids,\n namespace:await fs.readlink(base+'/ns/pid'),boot:(await fs.readFile('/proc/sys/kernel/random/boot_id','utf8')).trim()};\n }catch(error){if(['ENOENT','EACCES','EPERM','ESRCH'].includes(error.code))return null;throw error;}}\n const me=await one('self');if(pid==='self')return {...me,pid:process.pid};\n const direct=await one(pid);if(direct&&direct.pid===pid&&direct.namespace===me?.namespace)return direct;\n for(const row of await fs.readdir('/proc',{withFileTypes:true})){if(!row.isDirectory()||!/^\\d+$/.test(row.name))continue;const result=await one(row.name);if(result&&result.pid===pid&&result.namespace===me?.namespace)return result;}\n return {pid,absent:true,namespace:me?.namespace,boot:me?.boot};\n}\nconst selectionBytes=await fs.readFile(path.join(root,'selection.json')),selection=JSON.parse(selectionBytes);\nconst selectionSha256=digest(selectionBytes);\nlet supplied=Buffer.alloc(0);\nfor await(const chunk of process.stdin){supplied=Buffer.concat([supplied,chunk]);if(supplied.length>16*1024*1024)throw new Error('COMMAND_INPUT_TOO_LARGE');}\nconst input=JSON.parse(supplied.toString('utf8'));supplied.fill(0);\nif(input.selectionSha256!==selectionSha256)throw new Error('COMMAND_SELECTION_CHANGED');\nif(typeof input.executable!=='string'||!Array.isArray(input.args)||typeof input.cwd!=='string'||!input.environment||typeof input.token!=='string')throw new Error('COMMAND_INPUT_INVALID');\nconst startedAt=new Date().toISOString(),wrapper=await identity();\nawait save('process.json',{schema:'stellar-forge.turbolong-operations.process.v1',selectionSha256,token:input.token,phase:'STARTING',wrapper,startedAt});\nconst stdout=await fs.open(path.join(root,'stdout'),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL,0o600);\nconst stderr=await fs.open(path.join(root,'stderr'),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL,0o600);\nlet child,spawned=false;\ntry{\n await save('spawn-intent.json',{selectionSha256,token:input.token,startedAt,wrapper});\n child=spawn(input.executable,input.args,{cwd:input.cwd,env:{...input.environment,TURBOLONG_COMMAND_TOKEN:input.token},detached:process.platform!=='win32',stdio:['pipe',stdout.fd,stderr.fd],windowsHide:true});\n const finished=await new Promise(resolve=>{\n  child.once('spawn',async()=>{spawned=true;\n   try{await save('process.json',{schema:'stellar-forge.turbolong-operations.process.v1',selectionSha256,token:input.token,phase:'RUNNING',wrapper,child:await identity(child.pid),startedAt});}\n   catch(error){await stderr.write(Buffer.from('\\nSupervisor receipt error: '+String(error.message)+'\\n')).catch(()=>{});}\n  });\n  child.once('error',error=>resolve({returncode:null,signal:null,error:{code:error.code??'SPAWN_ERROR',message:String(error.message)},spawned}));\n  child.once('exit',(returncode,signal)=>resolve({returncode,signal,error:null,spawned:true}));\n  child.stdin.on('error',()=>{});\n  child.stdin.end(input.stdinBase64?Buffer.from(input.stdinBase64,'base64'):undefined);\n });\n await stdout.sync();await stderr.sync();\n await save('outcome.json',{schema:'stellar-forge.turbolong-operations.command-outcome.v1',selectionSha256,token:input.token,startedAt,finishedAt:new Date().toISOString(),\n  wrapper,child:child?.pid?await identity(child.pid):null,...finished,status:finished.spawned?(finished.returncode===0?'COMPLETED':'FAILED'):'NOT_STARTED'});\n}finally{await stdout.close();await stderr.close();for(const key of Object.keys(input.environment))input.environment[key]='';}\n";
async function delay(ms,signal){
 if(signal?.aborted)return;
 await new Promise(resolve=>{const timer=setTimeout(done,ms);function done(){clearTimeout(timer);signal?.removeEventListener('abort',done);resolve();}signal?.addEventListener('abort',done,{once:true});});
}
async function commandProcesses(token){
 if(process.platform!=='linux')return [];
 const matches=[];for(const entry of await fs.readdir('/proc',{withFileTypes:true})){
  if(!entry.isDirectory()||!/^\d+$/.test(entry.name))continue;
  try{const base='/proc/'+entry.name,info=await fs.stat(base);if(typeof process.getuid==='function'&&info.uid!==process.getuid())continue;
   const env=await fs.readFile(base+'/environ');if(env.includes(Buffer.from('TURBOLONG_COMMAND_TOKEN='+token+'\0'))){const owner=await procIdentity(Number(entry.name));if(owner)matches.push(owner);}}
  catch(error){if(!['ENOENT','ESRCH','EPERM','EACCES'].includes(error.code))throw error;}
 }return matches;
}
async function optionalJSON(filename){if(!await lstatMaybe(filename))return null;return (await readJSON(filename)).value;}
async function commandState(root){
 const selection=await optionalJSON(path.join(root,'selection.json'));if(!selection)return {status:'NOT_STARTED',directory:root};
 const selectionSha256=sha256(jsonBytes(selection)),outcome=await optionalJSON(path.join(root,'outcome.json'));
 if(outcome){if(outcome.selectionSha256!==selectionSha256)fail('RUNTIME_COMMAND_RECEIPT_CONFLICT');return {...outcome,directory:root,selection};}
 const launched=await optionalJSON(path.join(root,'launch.json')),record=await optionalJSON(path.join(root,'process.json'));
 if(record&&record.selectionSha256!==selectionSha256||launched&&launched.selectionSha256!==selectionSha256)fail('RUNTIME_COMMAND_RECEIPT_CONFLICT');
 const token=launched?.token??record?.token;
 for(const owner of [record?.wrapper,record?.child,launched?.wrapper])if(owner&&await matchesProcessIdentity(owner))return {status:'PENDING',directory:root,selection,record,token};
 if(token&&(await commandProcesses(token)).length)return {status:'PENDING',directory:root,selection,record,token};
 if(!launched&&!record&&!await lstatMaybe(path.join(root,'spawn-intent.json')))return {status:'NOT_STARTED',directory:root,selection};
 return {status:'UNCERTAIN',directory:root,selection,record,token,reason:'Original launch was recorded but no matching live process or completed receipt is currently visible.'};
}
async function waitCommand(root,{signal,maximumWaitMs=30000}={}){
 const start=Date.now();while(true){
  const status=await commandState(root);if(status.status!=='PENDING')return status;
  if(signal?.aborted||Date.now()-start>=maximumWaitMs)return status;
  await delay(Math.min(500,maximumWaitMs-(Date.now()-start)),signal);
 }
}
async function originalCommand({directory:commandRoot,selection,actual,nodeExecutable,allowRetry=false,reconcileOnly=false,continueUnstarted=false,signal,maximumWaitMs=30000}){
 await privateDirectory(commandRoot);const selectedBytes=jsonBytes(selection);await writeExact(commandRoot,'original-selection.json',selectedBytes);
 const release=await acquire(path.join(commandRoot,'launch'));let attemptRoot,observed;
 try{
  const attempts=path.join(commandRoot,'attempts');await privateDirectory(attempts);
  const names=(await fs.readdir(attempts)).filter(name=>/^[0-9]{6}$/.test(name)).sort();
  if(names.length){attemptRoot=path.join(attempts,names.at(-1));observed=await commandState(attemptRoot);
   if(observed.status==='COMPLETED'||observed.status==='PENDING'||reconcileOnly&&!(continueUnstarted&&observed.status==='NOT_STARTED')||!allowRetry&&observed.status!=='NOT_STARTED')
    return observed.status==='PENDING'?await waitCommand(attemptRoot,{signal,maximumWaitMs}):observed;
   if(observed.status==='UNCERTAIN'){
    await writeExact(attemptRoot,'interrupted-observation.json',jsonBytes({observedAt:new Date().toISOString(),selectionSha256:sha256(jsonBytes(observed.selection)),status:'UNCERTAIN',reason:observed.reason}));
   }
  }
  if(reconcileOnly&&!continueUnstarted)return observed??{status:'NOT_STARTED',directory:commandRoot,selection};
  signalCheck(signal);
  // Resolve private command inputs only after the original receipt has been checked.
  actual=typeof actual==='function'?await actual():actual;
  if(!actual)fail('RUNTIME_COMMAND_CONFIGURATION_REQUIRED');
  const index=names.length+1;attemptRoot=path.join(attempts,String(index).padStart(6,'0'));await fs.mkdir(attemptRoot,{mode:0o700});
  const attemptSelection={schema:COMMAND_SCHEMA,selectionSha256:sha256(selectedBytes),attempt:index,selection,supervisorSha256:sha256(Buffer.from(SUPERVISOR_SOURCE)),createdAt:new Date().toISOString()};
  await writeExact(attemptRoot,'selection.json',jsonBytes(attemptSelection));await writeExact(attemptRoot,'supervisor.mjs',Buffer.from(SUPERVISOR_SOURCE));
  if(actual.stdin&&Buffer.from(actual.stdin).length)await writeExact(attemptRoot,'stdin',Buffer.from(actual.stdin));
  const token=randomUUID(),selectionSha256=sha256(jsonBytes(attemptSelection));
  await writeExact(attemptRoot,'launch.json',jsonBytes({selectionSha256,token,phase:'LAUNCHING',at:new Date().toISOString(),parent:await processIdentity()}));
  const payload={selectionSha256,token,executable:actual.executable,args:actual.args,cwd:actual.cwd,environment:actual.env,
   stdinBase64:actual.stdin?Buffer.from(actual.stdin).toString('base64'):null};
  let child;
  try{
   child=spawn(nodeExecutable??process.execPath,[path.join(attemptRoot,'supervisor.mjs'),attemptRoot],{cwd:attemptRoot,
    env:{...cleanEnvironment(actual.supervisorEnvironment??{}),TURBOLONG_COMMAND_TOKEN:token},detached:process.platform!=='win32',stdio:['pipe','ignore','ignore'],windowsHide:true});
   await new Promise((resolve,reject)=>{child.once('error',reject);child.once('spawn',resolve);});
   // The private payload travels only through this original supervisor's pipe.
   child.stdin.on('error',()=>{});child.stdin.end(jsonBytes(payload));child.unref();
   await atomicBytes(attemptRoot,'launch.json',jsonBytes({selectionSha256,token,phase:'STARTED',at:new Date().toISOString(),parent:await processIdentity(),wrapper:await processIdentity(child.pid)}));
  }catch(error){
   if(!child?.pid)await atomicBytes(attemptRoot,'outcome.json',jsonBytes({schema:'stellar-forge.turbolong-operations.command-outcome.v1',selectionSha256,token,status:'NOT_STARTED',spawned:false,returncode:null,signal:null,
    finishedAt:new Date().toISOString(),error:{code:error.code??'SPAWN_ERROR',message:'The original command supervisor did not start.'}}));
   throw error;
  }finally{for(const key of Object.keys(payload.environment??{}))payload.environment[key]='';}
 }finally{await release();}
 return waitCommand(attemptRoot,{signal,maximumWaitMs});
}
async function commandAttempts(root){
 const attempts=path.join(root,'attempts');if(!await lstatMaybe(attempts))return [];
 const result=[];for(const name of (await fs.readdir(attempts)).filter(name=>/^[0-9]{6}$/.test(name)).sort())result.push(await commandState(path.join(attempts,name)));return result;
}
async function fileDescriptors(root,rel='',result=[]){
 const current=rel?join(root,rel):root;
 for(const item of (await fs.readdir(current,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name,'en'))){
  const child=rel?rel+'/'+item.name:item.name;if(item.isSymbolicLink())continue;
  if(item.isDirectory())await fileDescriptors(root,child,result);
  else if(item.isFile()){const actual=await inspectFile(join(root,child));result.push({path:child,bytes:actual.bytes,sha256:actual.sha256,mode:actual.mode});}
 }return result;
}
async function readOriginalFileRange(root,item,offset=0,length=4*1024*1024){
 count(offset,'offset');count(length,'length');if(length>4*1024*1024||offset>item.bytes)fail('RUNTIME_RANGE_INVALID');
 const filename=join(root,relative(item.path));await safeParents(root,item.path);const actual=await inspectFile(filename);
 if(actual.bytes!==item.bytes||actual.sha256!==item.sha256)fail('RUNTIME_ORIGINAL_ARTIFACT_CHANGED',{path:item.path});
 const h=await fs.open(filename,constants.O_RDONLY|(constants.O_NOFOLLOW??0));try{
  const before=await h.stat({bigint:true});if(fingerprint(before)!==actual.fingerprint)fail('RUNTIME_ORIGINAL_ARTIFACT_CHANGED',{path:item.path});
  const buffer=Buffer.alloc(Math.min(length,item.bytes-offset));let got=0;while(got<buffer.length){const n=await h.read(buffer,got,buffer.length-got,offset+got);if(!n.bytesRead)fail('RUNTIME_ORIGINAL_ARTIFACT_CHANGED');got+=n.bytesRead;}
  const after=await h.stat({bigint:true});if(fingerprint(after)!==actual.fingerprint)fail('RUNTIME_ORIGINAL_ARTIFACT_CHANGED',{path:item.path});return buffer;
 }finally{await h.close();}
}


function buildInteger(value,fallback,minimum,maximum,name){
 const selected=value??fallback;if(!Number.isSafeInteger(selected)||selected<minimum||selected>maximum)fail('RUNTIME_BUILD_OPTION_INVALID',{name});return selected;
}
async function selectedBuildTool(name,executable,required){
 const found=await actualExecutable(executable??name,name,{required});if(!found)return null;
 let resolved=found;if(['cargo','rustc'].includes(name)&&/^(?:rustup)(?:\.exe)?$/.test(path.basename(found.real))){
  const observed=await smallCommand(found.real,['which',name],{env:cleanEnvironment({RUSTUP_HOME:process.env.RUSTUP_HOME,RUSTUP_TOOLCHAIN:process.env.RUSTUP_TOOLCHAIN})});
  if(observed.status!==0)fail('RUNTIME_TOOLCHAIN_REQUIRED',{tool:name});resolved=await actualExecutable(observed.stdout.toString('utf8').trim(),name);
 }
 const actual=await inspectFile(resolved.real),version=await smallCommand(resolved.selected,['--version']);
 if(version.status!==0)fail('RUNTIME_TOOL_VERSION_FAILED',{tool:name,status:version.status});
 return {path:resolved.selected,real:resolved.real,sha256:actual.sha256,bytes:actual.bytes,mode:actual.mode,version:version.stdout.toString('utf8').trim()||version.stderr.toString('utf8').trim()};
}
async function buildArtifacts(installed){
 const result=[],paths=['scripts/package-lock.json','frontend/package-lock.json','target/release/rate_calc','target/release/simulate','target/release/execute_loop',
  'contracts/strategies/blend_leverage/target/wasm32v1-none/release/blend_leverage_strategy.wasm',
  'contracts/tokens/vault_share/target/wasm32v1-none/release/vault_share_token.wasm'];
 for(const rel of paths)if(await lstatMaybe(join(installed,rel))){const actual=await inspectFile(join(installed,rel));result.push({path:rel,bytes:actual.bytes,sha256:actual.sha256,mode:actual.mode});}
 for(const rel of ['frontend/dist','alerts/.turbolong-worker'])if(await lstatMaybe(join(installed,rel))){
  for(const file of await fileDescriptors(join(installed,rel)))result.push({...file,path:rel+'/'+file.path});
 }
 return result.sort((a,b)=>a.path.localeCompare(b.path,'en'));
}
export async function buildTurbolongRuntime(options={}){
 const installed=absolute(options.installationDirectory,'installationDirectory');
 const buildDirectory=absolute(options.buildDirectory??installed+'.turbolong-build','buildDirectory');
 if(within(installed,buildDirectory)||within(buildDirectory,installed))fail('RUNTIME_BUILD_DIRECTORY_OVERLAP');
 await privateDirectory(buildDirectory);const release=await acquire(path.join(buildDirectory,'build'));
 try{
  signalCheck(options.signal);await prepareOriginalSource(installed,options);
  const targets=options.buildTargets??BUILD_TARGETS;if(!Array.isArray(targets)||!targets.length||new Set(targets).size!==targets.length||targets.some(t=>!BUILD_TARGETS.includes(t)))fail('RUNTIME_BUILD_TARGETS_INVALID');
  const nodeHeapMB=buildInteger(options.nodeHeapMB,512,256,65536,'nodeHeapMB'),cargoJobs=buildInteger(options.cargoJobs,1,1,256,'cargoJobs');
  const npmNeeded=targets.some(t=>['scripts','frontend','alerts'].includes(t)),cargoNeeded=targets.some(t=>['binaries','contracts','cargo-sources'].includes(t));
  const node=await selectedBuildTool('node',options.nodeExecutable??process.execPath,true),
   npm=await selectedBuildTool('npm',options.npmExecutable,npmNeeded),
   cargo=await selectedBuildTool('cargo',options.cargoExecutable,cargoNeeded),rustc=await selectedBuildTool('rustc',options.rustcExecutable,cargoNeeded);
  const toolSelections={node,npm,cargo,rustc},existing=await optionalJSON(path.join(buildDirectory,'operation.json'));
  const projectModes=existing?.projectModes??Object.fromEntries(await Promise.all(ROOT_PROJECTS.map(async project=>[project,await lstatMaybe(path.join(installed,project,'package-lock.json'))?'ci':'install'])));
  const selection={schema:BUILD_SCHEMA,sourceCommit:SOURCE_COMMIT,sourceInventorySha256:SOURCE_INVENTORY_SHA256,
   targets:[...targets],nodeHeapMB,cargoJobs,projectModes,tools:toolSelections};
  if(existing&&canonical(existing.selection)!==canonical(selection))fail('RUNTIME_BUILD_SELECTION_CONFLICT',{buildDirectory});
  if(!existing)await writeExact(buildDirectory,'operation.json',jsonBytes({schema:BUILD_SCHEMA,selection,projectModes,createdAt:new Date().toISOString()}));
  for(const rel of ['commands','temporary','npm-cache','cargo-home','bin'])await privateDirectory(join(buildDirectory,rel));
  await writeExact(buildDirectory,'npm-userconfig',Buffer.alloc(0));
  const env=cleanEnvironment({PATH:[path.dirname(node.path),path.dirname(npm?.path??node.path),path.dirname(cargo?.path??node.path),process.env.PATH??''].join(path.delimiter),
   NODE_OPTIONS:'--max-old-space-size='+nodeHeapMB,npm_config_cache:join(buildDirectory,'npm-cache'),npm_config_userconfig:join(buildDirectory,'npm-userconfig'),
   TMPDIR:join(buildDirectory,'temporary'),TMP:join(buildDirectory,'temporary'),TEMP:join(buildDirectory,'temporary'),
   CARGO_HOME:join(buildDirectory,'cargo-home'),CARGO_BUILD_JOBS:String(cargoJobs),RUSTC:rustc?.path,
   ...(process.env.RUSTUP_HOME?{RUSTUP_HOME:process.env.RUSTUP_HOME}:{}),...(process.env.RUSTUP_TOOLCHAIN?{RUSTUP_TOOLCHAIN:process.env.RUSTUP_TOOLCHAIN}:{})});
  const results=[];
  async function stage(name,executable,args,cwd,{stdin}={}){
   signalCheck(options.signal);options.progress?.({stage:name,status:'STARTING',buildDirectory});
   const original={schema:COMMAND_SCHEMA,kind:'original-build',sourceCommit:SOURCE_COMMIT,sourceInventorySha256:SOURCE_INVENTORY_SHA256,
    stage:name,toolSha256:(await inspectFile(await fs.realpath(executable))).sha256,args,cwd,environmentKeys:Object.keys(env).sort(),
    nodeHeapMB,cargoJobs,stdinSha256:stdin?sha256(stdin):null};
   let result=await originalCommand({directory:join(buildDirectory,'commands/'+name),selection:original,actual:{executable,args,cwd,env:{...env},stdin},nodeExecutable:node.path,
    allowRetry:true,signal:options.signal,maximumWaitMs:30000});
   while(result.status==='PENDING'&&!options.signal?.aborted){options.progress?.({stage:name,status:'RUNNING',directory:result.directory});result=await waitCommand(result.directory,{signal:options.signal,maximumWaitMs:30000});}
   results.push({stage:name,status:result.status,returncode:result.returncode??null,attempt:path.basename(result.directory),selectionSha256:result.selectionSha256??null});
   options.progress?.({stage:name,status:result.status,directory:result.directory});
   if(result.status!=='COMPLETED')fail(result.status==='PENDING'?'RUNTIME_BUILD_PENDING':'RUNTIME_BUILD_COMMAND_FAILED',{stage:name,status:result.status,directory:result.directory,returncode:result.returncode??null});
   await verifyOriginalSource(installed);return result;
  }
  for(const project of ROOT_PROJECTS)if(targets.includes(project)||project==='scripts'&&targets.includes('scripts')){
   await stage('npm-'+project,npm.path,[projectModes[project],'--no-audit','--no-fund'],path.join(installed,project));
   if(project==='frontend')await stage('frontend-build',npm.path,['run','build'],path.join(installed,project));
   if(project==='alerts')await stage('alerts-build',npm.path,['run','build','--','--outdir','.turbolong-worker'],path.join(installed,project));
  }
  if(targets.includes('binaries'))await stage('rust-binaries',cargo.path,['build','--locked','--release','--bins'],installed);
  if(targets.includes('contracts'))for(const[short,rel]of [['strategy','contracts/strategies/blend_leverage'],['share','contracts/tokens/vault_share']])
   await stage('rust-'+short,cargo.path,['build','--locked','--target','wasm32v1-none','--release'],join(installed,rel));
  if(targets.includes('cargo-sources')){
   const vendored=join(buildDirectory,'cargo-vendor');
   const vendor=await stage('cargo-vendor',cargo.path,['vendor','--locked','--versioned-dirs','--sync',path.join(installed,'contracts/strategies/blend_leverage/Cargo.toml'),
    '--sync',path.join(installed,'contracts/tokens/vault_share/Cargo.toml'),vendored],installed);
   const stdout=await readFile(path.join(vendor.directory,'stdout'),16*1024*1024);
   await atomicBytes(buildDirectory,'cargo-vendor-config.toml',stdout);
  }
  const artifacts=await buildArtifacts(installed),receipt={schema:BUILD_SCHEMA,sourceCommit:SOURCE_COMMIT,sourceInventorySha256:SOURCE_INVENTORY_SHA256,
   selectionSha256:sha256(jsonBytes(selection)),targets,stages:results,artifacts,artifactsSha256:sha256(Buffer.from(canonical(artifacts))),completedAt:new Date().toISOString()};
  const previous=await optionalJSON(path.join(buildDirectory,'receipt.json'));
  if(previous){
   if(previous.artifactsSha256!==receipt.artifactsSha256||previous.selectionSha256!==receipt.selectionSha256)fail('RUNTIME_BUILD_ARTIFACTS_CHANGED');
  }else await writeExact(buildDirectory,'receipt.json',jsonBytes(receipt));
  const accepted=previous??receipt;await writeExact(installed,'.turbolong-build.json',jsonBytes(accepted));
  const retained=options.directory?await retainTurbolongRuntime({...options,installationDirectory:installed,buildDirectory}):
   await resolveTurbolongRuntime({...options,installationDirectory:installed,buildDirectory});
  return {...retained,build:{directory:buildDirectory,receipt:accepted,sourceDirectory:installed}};
 }finally{await release();}
}


const RESULT_KINDS={
 'vault.inspect':'vault.state','vault.shareInspect':'vault.share-state','keeper.rebalance.probe':'keeper.rebalance','keeper.rebalance.execute':'keeper.rebalance',
 'keeper.harvest.quote':'keeper.harvest','keeper.harvest.execute':'keeper.harvest','routing.report':'routing.original-report','rates.project':'rates.original-projection',
 'rates.simulate':'rates.original-simulation','deployment.plan':'deployment.original-plan'};
const MAINNET_RPC='https://mainnet.sorobanrpc.com',TESTNET_RPC='https://soroban-testnet.stellar.org';
function strictEndpoint(value,field){
 let url;try{url=new URL(value);}catch{fail('RUNTIME_CONNECTION_INVALID',{field});}
 if(!(url.protocol==='https:'||url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname))||url.username||url.password||url.hash)
  fail('RUNTIME_CONNECTION_INVALID',{field});
 return url.href;
}
function publicEndpoint(value){const url=new URL(value);for(const key of [...url.searchParams.keys()])if(/key|token|secret|password|signature|credential|auth/i.test(key))url.searchParams.set(key,'[private]');return url.href;}
function connectionSettings(connection){
 if(!object(connection))fail('RUNTIME_CONNECTION_INVALID');
 const selected={...connection,...(object(connection.private)?connection.private:{})};
 selected.runtime=selected.runtime??{installationDirectory:selected.installationDirectory,runtimeDirectory:selected.runtimeDirectory,expectedManifestSha256:selected.expectedManifestSha256,
  nodeExecutable:selected.nodeExecutable,npmExecutable:selected.npmExecutable,cargoExecutable:selected.cargoExecutable,rustcExecutable:selected.rustcExecutable,stellarExecutable:selected.stellarExecutable};
 selected.network=selected.network??'mainnet';if(!NETWORK_PASSPHRASES[selected.network])fail('RUNTIME_NETWORK_INVALID');
 selected.rpcUrl=strictEndpoint(selected.rpcUrl??(selected.network==='mainnet'?MAINNET_RPC:TESTNET_RPC),'rpcUrl');
 selected.environment=object(selected.environment)?{...selected.environment}:{};
 selected.secretFiles=object(selected.secretFiles)?{...selected.secretFiles}:{};
 return selected;
}
async function privateBindings(settings,names){
 const result={};for(const name of names){
  let value=settings.environment[name]??settings[name];
  if(settings.secretFiles[name]!==undefined)value=(await readFile(absolute(settings.secretFiles[name],'secretFiles.'+name),64*1024)).toString('utf8').trim();
  if(value!==undefined&&value!==null){if(typeof value!=='string'||!value||value.includes('\0'))fail('RUNTIME_PRIVATE_BINDING_INVALID',{name});result[name]=value;}
 }return result;
}
function redactionVariants(values){
 const selected=new Set();
 for(const value of values){if(typeof value!=='string'||!value)continue;
  const forms=[value,JSON.stringify(value).slice(1,-1),encodeURI(value),encodeURIComponent(value),new URLSearchParams({v:value}).toString().slice(2)];
  for(const form of forms){selected.add(form);selected.add(form.replace(/%[0-9A-F]{2}/g,match=>match.toLowerCase()));}
 }
 return [...selected].sort((a,b)=>b.length-a.length);
}
function redactor(values){
 const secrets=redactionVariants(values);
 return text=>{let result=String(text);for(const secret of secrets)result=result.split(secret).join('[redacted]');return result;};
}
function redactValue(value,redact){
 if(typeof value==='string')return redact(value);
 if(Array.isArray(value))return value.map(item=>redactValue(item,redact));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[redact(key),redactValue(item,redact)]));
 return value;
}
function endpointPrivateValues(settings){
 const values=[],endpoint=new URL(settings.rpcUrl);
 if(endpoint.username)values.push(decodeURIComponent(endpoint.username));
 if(endpoint.password)values.push(decodeURIComponent(endpoint.password));
 for(const[key,value]of endpoint.searchParams)if(/key|token|secret|password|signature|credential|auth/i.test(key))values.push(value);
 return values;
}
async function executionRedactions(root,values=[]){
 // These values stay inside the original private execution directory. They are
 // excluded from every artifact list and delivery; only redacted bytes and
 // original wire hashes leave that custody. Retaining them lets an old command
 // be safely inspected after its host credential has rotated or been removed.
 const filename=path.join(root,'private-redaction.json'),release=await acquire(path.join(root,'redaction'));
 try{
  const old=await optionalJSON(filename);
  if(old&&(!Array.isArray(old.values)||old.values.some(value=>typeof value!=='string')))fail('RUNTIME_PRIVATE_REDACTION_INVALID');
  const current=[...new Set([...(old?.values??[]),...values.filter(value=>typeof value==='string'&&value)])];
  if(!old||canonical(old.values)!==canonical(current))await atomicBytes(root,'private-redaction.json',jsonBytes({schema:'stellar-forge.turbolong-operations.private-redaction.v1',values:current}),0o600);
  return current;
 }finally{await release();}
}
function sourcePath(runtime,rel){return join(runtime.directory,runtimeLogicalFile(runtime.manifest,rel));}
function selectedEnvironment(runtime,extra={}){
 const dirs=[...new Set(Object.values(runtime.tools).flatMap(item=>item.libraryDirectories??[]))];
 return cleanEnvironment({PATH:[...new Set(Object.values(runtime.tools).map(item=>path.dirname(item.path))),process.env.PATH??''].join(path.delimiter),
  ...(dirs.length?{LD_LIBRARY_PATH:dirs.join(path.delimiter)}:{}),...extra});
}
async function nativePublicKey(runtime,secret){
 if(!runtime.entrypoints.tsx)fail('RUNTIME_CAPABILITY_UNAVAILABLE',{capability:'original Keypair'});
 const source="import{createRequire}from'node:module';const require=createRequire(process.argv[1]+'/scripts/package.json');const{Keypair}=require('@stellar/stellar-sdk');process.stdout.write(JSON.stringify({publicKey:Keypair.fromSecret(process.env.TURBOLONG_ORIGINAL_SECRET).publicKey()}));";
 const result=await smallCommand(runtime.tools.node.path,['--input-type=module','-e',source,runtime.sourceDirectory],
  {env:selectedEnvironment(runtime,{TURBOLONG_ORIGINAL_SECRET:secret})});
 if(result.status!==0)fail('RUNTIME_ORIGINAL_KEY_INVALID',{method:'Keypair.fromSecret',runtimeId:runtime.id});
 let value;try{value=JSON.parse(result.stdout.toString('utf8'));}catch{fail('RUNTIME_ORIGINAL_KEY_RESULT_INVALID');}
 if(!/^G[A-Z2-7]{55}$/.test(value.publicKey))fail('RUNTIME_ORIGINAL_KEY_RESULT_INVALID');return value.publicKey;
}
async function executionOrigin(root){
 await privateDirectory(root);const release=await acquire(path.join(root,'origin'));
 try{
  const old=await optionalJSON(path.join(root,'origin.json'));if(old){
   if(old.schema!=='stellar-forge.turbolong-operations.execution-origin.v1'||!UUID.test(old.id??''))fail('RUNTIME_EXECUTION_ORIGIN_INVALID');return old;
  }
  const value={schema:'stellar-forge.turbolong-operations.execution-origin.v1',id:randomUUID(),createdAt:new Date().toISOString()};
  await writeExact(root,'origin.json',jsonBytes(value));return value;
 }finally{await release();}
}
function nativeVaults(value,action){
 if(value===undefined)return undefined;
 if(!Array.isArray(value)||!value.length)fail('RUNTIME_VAULT_SELECTION_INVALID');
 const harvest=action.startsWith('keeper.harvest.');const ids=new Set();
 return value.map(row=>{
  if(!object(row)||typeof row.symbol!=='string'||!row.symbol||!/^C[A-Z2-7]{55}$/.test(row.strategyId??'')||ids.has(row.strategyId))fail('RUNTIME_VAULT_SELECTION_INVALID');
  ids.add(row.strategyId);
  if(harvest&&!(row.underlyingClassic===null||typeof row.underlyingClassic==='string'&&row.underlyingClassic)&&!/^C[A-Z2-7]{55}$/.test(row.underlyingSoroban??''))fail('RUNTIME_VAULT_ASSET_REQUIRED');
  if(harvest&&(!/^C[A-Z2-7]{55}$/.test(row.underlyingSoroban??'')||!(row.underlyingClassic===null||typeof row.underlyingClassic==='string')||
   row.swapVia!==undefined&&row.swapVia!==null&&!/^C[A-Z2-7]{55}$/.test(row.swapVia)))fail('RUNTIME_VAULT_ASSET_REQUIRED');
  return portable(row);
 });
}

function originalRateInputs(inputs){
 if(!Array.isArray(inputs)||!inputs.length)fail('RUNTIME_RATE_INPUT_REQUIRED');
 function integer(value,signed,field){
  if(typeof value==='number'){if(!Number.isSafeInteger(value))fail('RUNTIME_UNSAFE_INTEGER',{field});value=String(value);}
  if(typeof value!=='string'||!(/^-?(?:0|[1-9][0-9]*)$/).test(value))fail('RUNTIME_INTEGER_REQUIRED',{field});
  const n=BigInt(value),min=signed?-(1n<<63n):0n,max=signed?(1n<<63n)-1n:(1n<<64n)-1n;
  if(n<min||n>max)fail('RUNTIME_NATIVE_INTEGER_RANGE',{field});return n.toString();
 }
 return Buffer.from('['+inputs.map((row,index)=>{
  if(!object(row)||typeof row.name!=='string'||!object(row.rateConfig))fail('RUNTIME_RATE_INPUT_INVALID',{index});
  const config=['rBase','rOne','rTwo','rThree','utilOpt','irMod','backstopFP'].map(key=>JSON.stringify(key)+':'+integer(row.rateConfig[key],true,'inputs['+index+'].rateConfig.'+key));
  const entries=[JSON.stringify('name')+':'+JSON.stringify(row.name),'"rateConfig":{'+config.join(',')+'}'];
  for(const key of ['totalSupply','totalBorrow','addSupply','addBorrow','priceUsd','blndPrice']){const value=row[key];if(typeof value!=='number'||!Number.isFinite(value))fail('RUNTIME_NATIVE_FLOAT_REQUIRED',{index,field:key});entries.push(JSON.stringify(key)+':'+JSON.stringify(value));}
  for(const key of ['supplyEps','borrowEps'])entries.push(JSON.stringify(key)+':'+integer(row[key],false,'inputs['+index+'].'+key));
  return '{'+entries.join(',')+'}';
 }).join(',')+']\n');
}

async function commandPlan(runtime,settings,action,args){
 validateTurbolongArguments(action,args);
 if(!RUNTIME_ACTIONS.includes(action))fail('RUNTIME_ACTION_UNSUPPORTED',{action});
 if(args.network!==undefined&&args.network!==settings.network)fail('RUNTIME_NETWORK_MISMATCH');
 if(!runtime.capabilities[action]?.available)fail('RUNTIME_CAPABILITY_UNAVAILABLE',{action,capability:runtime.capabilities[action]??null,runtime:publicTurbolongRuntime(runtime)});
 if(runtime.platform.platform!==process.platform||runtime.platform.architecture!==process.arch)fail('RUNTIME_PLATFORM_MISMATCH',{required:runtime.platform,actual:{platform:process.platform,architecture:process.arch}});
 if((action.startsWith('keeper.harvest.')||action==='rates.simulate')&&settings.network!=='mainnet')fail('RUNTIME_ORIGINAL_MAINNET_ONLY',{action});
 const environment={NETWORK:settings.network};
 for(const[name,value]of Object.entries(settings.environment))if(PUBLIC_SCRIPT_NAMES.has(name)&&!['NETWORK','RPC_URL','VAULTS_JSON'].includes(name))environment[name]=String(value);
 const configuredVaults=args.vaults??(settings.environment.VAULTS_JSON?JSON.parse(settings.environment.VAULTS_JSON):undefined),vaults=nativeVaults(configuredVaults,action);
 if(vaults)environment.VAULTS_JSON=JSON.stringify(vaults);
 if((action==='keeper.harvest.execute'||action.startsWith('keeper.rebalance.')&&settings.network==='mainnet')&&!vaults)fail('RUNTIME_VAULT_SELECTION_REQUIRED',{action});
 if(args.quoteAmountBlnd!==undefined)environment.QUOTE_AMOUNT_BLND=String(args.quoteAmountBlnd);
 if(args.slippage!==undefined)environment.SLIPPAGE=String(args.slippage);
 if(args.adminPublicKey!==undefined)environment.ADMIN_PUBKEY=args.adminPublicKey;
 if(args.keeperPublicKey!==undefined)environment.KEEPER_PUBKEY=args.keeperPublicKey;
 for(const[symbol,amount]of Object.entries(args.minHarvestRates??{})){
  if(!['USDC','USTRY','CETES','XLM'].includes(symbol)||typeof amount!=='string'||!/^[0-9]+$/.test(amount))fail('RUNTIME_DEPLOYMENT_OPTION_INVALID',{symbol});
  environment['MIN_HARVEST_RATE_'+symbol]=amount;
 }
 const privateNames=[];let actorPublicKey=null;
 if(action.endsWith('.execute'))privateNames.push('KEEPER_SECRET');
 if(action==='deployment.plan'){privateNames.push('DEPLOY_SECRET_KEY');environment.DRY_RUN='1';}
 if(action.startsWith('keeper.harvest.'))privateNames.push('STELLAR_BROKER_PARTNER_KEY');
 if(args.telemetry===true){
  if(!action.startsWith('keeper.harvest.'))fail('RUNTIME_TELEMETRY_NOT_SUPPORTED');
  privateNames.push('KEEPER_INGEST_KEY');
  const ingest=settings.environment.SWAP_ROUTES_URL??settings.SWAP_ROUTES_URL??settings.telemetryUrl;
  if(!ingest)fail('RUNTIME_TELEMETRY_BINDING_REQUIRED');environment.SWAP_ROUTES_URL=publicEndpoint(strictEndpoint(ingest,'SWAP_ROUTES_URL'));
 }
 const bindings=await privateBindings(settings,privateNames);
 for(const name of ['KEEPER_SECRET','DEPLOY_SECRET_KEY','KEEPER_INGEST_KEY'])if(privateNames.includes(name)&&!bindings[name])fail('RUNTIME_PRIVATE_BINDING_REQUIRED',{name});
 const key=bindings.KEEPER_SECRET??bindings.DEPLOY_SECRET_KEY;if(key)actorPublicKey=await nativePublicKey(runtime,key);
 if(settings.actorPublicKey&&actorPublicKey&&settings.actorPublicKey!==actorPublicKey)fail('RUNTIME_ACTOR_MISMATCH',{expected:settings.actorPublicKey,actual:actorPublicKey});
 const commands=[],input=args.inputs===undefined?null:originalRateInputs(args.inputs);
 function add(tool,argv,extra={}){commands.push({id:String(commands.length+1).padStart(3,'0'),tool,args:argv,cwd:'source',environment:{...environment},
  stdinSha256:input?sha256(input):null,...extra});}
 if(action==='vault.inspect'||action==='vault.shareInspect'){
  const share=action==='vault.shareInspect',allowed=share?SHARE_METHODS:VIEW_METHODS;
  const methods=args.methods??(share?['decimals','name','symbol','total_supply','minter',...(args.holder?['balance']:[]),...(args.holder&&args.spender?['allowance']:[])]:[...VIEW_METHODS]);
  if(!Array.isArray(methods)||!methods.length||new Set(methods).size!==methods.length||methods.some(m=>!allowed.has(m)))fail('RUNTIME_READ_METHOD_INVALID');
  if(!runtime.tools.stellar.invokeFlags?.rpcUrl||!runtime.tools.stellar.invokeFlags?.networkPassphrase)fail('RUNTIME_CLI_RPC_SELECTION_UNSUPPORTED');
  for(const method of methods){
   if(method==='balance'&&!args.holder||method==='allowance'&&(!args.holder||!args.spender))fail('RUNTIME_HOLDER_REQUIRED',{method});
   const argv=['contract','invoke','--id',share?args.tokenId:args.strategyId,'--source-account',settings.simulationAccount??SIM_ACCOUNT,
    '--rpc-url',{binding:'rpcUrl'},'--network-passphrase',NETWORK_PASSPHRASES[settings.network],'--send=no','--',method];
   if(method==='balance')argv.push('--id',args.holder);if(method==='allowance')argv.push('--from',args.holder,'--spender',args.spender);
   add('stellar',argv,{method});
  }
 }else if(action==='rates.project'){add('rateCalc',[],{input:'input.json'});}
 else if(action==='rates.simulate'){
  if(!runtime.tools.stellar.invokeEnvironment?.rpcUrl||!runtime.tools.stellar.invokeEnvironment?.networkPassphrase)fail('RUNTIME_CLI_NETWORK_ENVIRONMENT_UNSUPPORTED');
  add('simulate',['--loops',String(args.loops??20)],{nativeMainnetProfile:true});
 }else{
  const entry=action.startsWith('keeper.rebalance.')?'rebalance':action.startsWith('keeper.harvest.')?'harvest':action==='routing.report'?'routing':
   settings.network==='mainnet'?'deploymentMainnet':'deploymentTestnet';
  const argv=[{entrypoint:'tsx'},{source:runtime.manifest.entrypoints[entry].slice('source/'.length)}];
  if(action.endsWith('.execute'))argv.push('--execute');
  if(action==='routing.report')argv.push('--url',args.url??settings.telemetryUrl??'https://turbolong-alerts.turbolong.workers.dev','--network',settings.network);
  add('node',argv,{entrypoint:entry});
 }
 return {commands,input,actorPublicKey,privateNames,scope:{network:settings.network,rpcUrl:publicEndpoint(settings.rpcUrl),vaults:vaults??null,
  defaultVaultSource:!vaults&&action.startsWith('keeper.rebalance.')?'deployed-vaults.testnet.json':!vaults&&action==='keeper.harvest.quote'?'scripts/harvest_router.ts:DEFAULT_VAULTS':null,
  telemetry:args.telemetry===true,originalDeploymentPhase:action==='deployment.plan'?'first-install-preparation':null,
  originalReportWindow:action==='routing.report'?{recentLimit:500,aggregate:'all-time',completeHistory:false}:null}};
}
async function prepareExecutionView(runtime,root,action){
 const release=await acquire(path.join(root,'source-view'));
 try{
  const marker=await optionalJSON(path.join(root,'view.json')),view=path.join(root,'source');
  if(marker&&(marker.runtimeId!==runtime.id||marker.manifestSha256!==runtime.manifestSha256))fail('RUNTIME_EXECUTION_SOURCE_CHANGED');
  const sourceFiles=runtime.manifest.files.filter(item=>item.path.startsWith('source/'));
  const sourceLinks=runtime.manifest.links.filter(item=>item.path.startsWith('source/'));
  const mutable=action==='routing.report'?new Set(['docs/evidence/swap-route-report.md']):new Set();
  await privateDirectory(view);
  for(const item of sourceFiles){
   const rel=item.path.slice('source/'.length),target=join(view,rel);
   if(marker){
    await safeParents(view,rel);
    const st=await lstatMaybe(target);
    if(mutable.has(rel)){if(st&&(!st.isFile()||st.isSymbolicLink()))fail('RUNTIME_EXECUTION_SOURCE_CHANGED',{path:rel});continue;}
    if(!st?.isFile()||st.isSymbolicLink())fail('RUNTIME_EXECUTION_SOURCE_CHANGED',{path:rel});
    const actual=await inspectFile(target);
    if(actual.bytes!==item.bytes||actual.sha256!==item.sha256||actual.mode!==item.mode)fail('RUNTIME_EXECUTION_SOURCE_CHANGED',{path:rel});
   }else await copyFile({filename:join(runtime.directory,item.path)},view,{...item,path:rel});
  }
  for(const item of sourceLinks){
   const rel=item.path.slice('source/'.length);await safeParents(view,rel,{create:!marker});
   const selected=path.resolve(path.dirname(join(runtime.directory,item.path)),item.target),target=join(view,rel);
   const mapped=within(runtime.sourceDirectory,selected)?path.join(view,path.relative(runtime.sourceDirectory,selected)):selected;
   const destination=path.relative(path.dirname(target),mapped),old=await lstatMaybe(target);
   if(old){if(!old.isSymbolicLink()||await fs.readlink(target)!==destination)fail('RUNTIME_EXECUTION_SOURCE_CHANGED',{path:rel});}
   else{if(marker)fail('RUNTIME_EXECUTION_SOURCE_CHANGED',{path:rel});await fs.symlink(destination,target);await syncDirectory(path.dirname(target));}
   const real=await fs.realpath(target);
   if(!within(view,real)&&!within(runtime.directory,real))fail('RUNTIME_EXECUTION_SOURCE_CHANGED',{path:rel});
  }
  const permitted=new Set([...sourceFiles,...sourceLinks].map(item=>item.path.slice('source/'.length)));
  for(const item of runtime.manifest.directories)if(item.path.startsWith('source/'))permitted.add(item.path.slice('source/'.length));
  for(const rel of mutable)permitted.add(rel);
  for(const rel of [...permitted]){let parent=path.posix.dirname(rel);while(parent!=='.'){permitted.add(parent);parent=path.posix.dirname(parent);}}
  async function checkDirectory(rel=''){
   for(const entry of await fs.readdir(rel?join(view,rel):view,{withFileTypes:true})){
    const child=rel?rel+'/'+entry.name:entry.name;
    if(!permitted.has(child))fail('RUNTIME_EXECUTION_SOURCE_CHANGED',{path:child});
    if(entry.isDirectory())await checkDirectory(child);
    else if(!entry.isFile()&&!entry.isSymbolicLink())fail('RUNTIME_EXECUTION_SOURCE_CHANGED',{path:child});
   }
  }
  await checkDirectory();
  if(!marker)await writeExact(root,'view.json',jsonBytes({schema:'stellar-forge.turbolong-operations.execution-source.v1',runtimeId:runtime.id,manifestSha256:runtime.manifestSha256,sourceCommit:SOURCE_COMMIT}));
  return view;
 }finally{await release();}
}
async function actualCommand(runtime,settings,prepared,spec,executionDirectory){
 await verifyTurbolongRuntime({directory:runtime.directory,expectedManifestSha256:runtime.manifestSha256});
 const view=await prepareExecutionView(runtime,executionDirectory,prepared.action),bindings=await privateBindings(settings,prepared.privateNames);
 await executionRedactions(executionDirectory,[...Object.values(bindings),...endpointPrivateValues(settings)]);
 for(const name of ['KEEPER_SECRET','DEPLOY_SECRET_KEY','KEEPER_INGEST_KEY'])if(prepared.privateNames.includes(name)&&!bindings[name])fail('RUNTIME_PRIVATE_BINDING_REQUIRED',{name});
 if(prepared.actorPublicKey){const publicKey=await nativePublicKey(runtime,bindings.KEEPER_SECRET??bindings.DEPLOY_SECRET_KEY);if(publicKey!==prepared.actorPublicKey)fail('RUNTIME_ACTOR_MISMATCH',{expected:prepared.actorPublicKey,actual:publicKey});}
 const tool=runtime.tools[spec.tool];if(!tool)fail('RUNTIME_TOOL_REQUIRED',{tool:spec.tool});
 const args=spec.args.map(value=>{
  if(typeof value==='string')return value;
  if(value?.binding==='rpcUrl')return settings.rpcUrl;
  if(value?.entrypoint)return runtime.entrypoints[value.entrypoint]??fail('RUNTIME_ENTRYPOINT_REQUIRED');
  if(value?.source)return join(view,value.source);fail('RUNTIME_ARGUMENT_SELECTION_INVALID');
 });
 const env=selectedEnvironment(runtime,{...spec.environment,...bindings,RPC_URL:settings.rpcUrl,
  EVIDENCE_FILE:path.join(executionDirectory,'evidence.jsonl'),TMPDIR:path.join(executionDirectory,'temporary'),TMP:path.join(executionDirectory,'temporary'),TEMP:path.join(executionDirectory,'temporary')});
 await privateDirectory(env.TMPDIR);
 if(prepared.scope.telemetry){env.SWAP_ROUTES_URL=strictEndpoint(settings.environment.SWAP_ROUTES_URL??settings.SWAP_ROUTES_URL??settings.telemetryUrl,'SWAP_ROUTES_URL');}
 else{delete env.SWAP_ROUTES_URL;delete env.KEEPER_INGEST_KEY;}
 if(spec.nativeMainnetProfile){
  env.STELLAR_RPC_URL=settings.rpcUrl;env.STELLAR_NETWORK_PASSPHRASE=NETWORK_PASSPHRASES.mainnet;
  // The original Rust discovery checks HOME and then PATH. No system HOME is
  // replaced; only the selected native executable is placed first on PATH.
  const originalHome=process.env.HOME;if(originalHome){
   const preferred=path.join(originalHome,'.cargo/bin/stellar');if(await lstatMaybe(preferred)){
    const actual=await inspectFile(await fs.realpath(preferred));if(actual.sha256!==runtime.tools.stellar.sha256)fail('RUNTIME_NATIVE_TOOL_SELECTION_CONFLICT',{tool:'stellar'});
   }env.HOME=originalHome;
  }
 }
 const stdin=spec.input?await readFile(join(executionDirectory,spec.input),64*1024*1024):null;
 if((stdin?sha256(stdin):null)!==spec.stdinSha256)fail('RUNTIME_INPUT_CHANGED');
 return {executable:tool.path,args,cwd:view,env,stdin,supervisorEnvironment:selectedEnvironment(runtime)};
}

function parseOriginalJSON(text) {
  let inside=false,escaped=false,out='',last=0;const numberPreservation=[];
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(inside){if(escaped)escaped=false;else if(ch==='\\')escaped=true;else if(ch==='"')inside=false;continue;}
    if(ch==='"'){inside=true;continue;}
    if(ch==='-'||ch>='0'&&ch<='9'){
      const found=text.slice(i).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
      if(!found)continue;const token=found[0],n=Number(token);
      if(!Number.isFinite(n)||Number.isInteger(n)&&!Number.isSafeInteger(n)){
        out+=text.slice(last,i)+JSON.stringify(token);last=i+token.length;numberPreservation.push({offset:i,token});
      }
      i+=token.length-1;
    }
  }
  out+=text.slice(last);
  return {value:JSON.parse(out),numberPreservation};
}

async function artifactEnvelope(root,item,secrets=[]){
 const known=redactionVariants(secrets);
 const replace=redactor(secrets),maxSecret=Math.max(0,...known.map(value=>value.length)),decoder=known.length?new TextDecoder('utf-8',{fatal:true}):null;
 const chunks=[],hashOut=createHash('sha256');let outputOffset=0,carry='',redacted=false,pending=Buffer.alloc(0);
 function emit(bytes){
  if(!bytes.length)return;pending=Buffer.concat([pending,bytes]);
  while(pending.length>=4*1024*1024){const chunk=pending.subarray(0,4*1024*1024);chunks.push({offset:outputOffset,bodyBase64:chunk.toString('base64')});hashOut.update(chunk);outputOffset+=chunk.length;pending=pending.subarray(chunk.length);}
 }
 function textPart(value,final=false){
  carry+=value;let cutoff=final?carry.length:Math.max(0,carry.length-maxSecret);
  if(cutoff>0&&cutoff<carry.length&&carry.charCodeAt(cutoff-1)>=0xd800&&carry.charCodeAt(cutoff-1)<=0xdbff)cutoff--;
  // Leave a whole potential private token in the carry, including a match which
  // begins before the nominal cut and ends after it.
  for(const token of known){const from=Math.max(0,cutoff-token.length+1),at=carry.indexOf(token,from);if(at>=0&&at<cutoff&&at+token.length>cutoff)cutoff=at;}
  const before=carry.slice(0,cutoff),after=replace(before);if(before!==after)redacted=true;emit(Buffer.from(after));carry=carry.slice(cutoff);
 }
 for(let offset=0;offset<item.bytes;offset+=4*1024*1024){
  const bytes=await readOriginalFileRange(root,item,offset,Math.min(4*1024*1024,item.bytes-offset));
  if(decoder)textPart(decoder.decode(bytes,{stream:true}));else emit(bytes);
 }
 if(decoder)textPart(decoder.decode(),true);
 if(pending.length){chunks.push({offset:outputOffset,bodyBase64:pending.toString('base64')});hashOut.update(pending);outputOffset+=pending.length;}
 if(!chunks.length)chunks.push({offset:0,bodyBase64:''});
 return {bytes:outputOffset,sha256:hashOut.digest('hex'),bodyComplete:true,...(chunks.length===1?{bodyBase64:chunks[0].bodyBase64}:{chunks}),
  ...(redacted?{redacted:true,wire:{bytes:item.bytes,sha256:item.sha256},privateOriginalRetained:true}:{})};
}
function transactionIds(value,set=new Set()){
 if(Array.isArray(value)){for(const item of value)transactionIds(item,set);return set;}
 if(object(value)){for(const[key,item]of Object.entries(value)){
   if(['tx','tx_hash','txHash','transactionHash','reinvestHash','hash'].includes(key)&&typeof item==='string'&&/^[0-9a-f]{64}$/i.test(item))set.add(item.toLowerCase());
   else if(object(item)||Array.isArray(item))transactionIds(item,set);
  }}
 return set;
}
async function transactionReferences(root,item){
 const handle=await fs.open(join(root,item.path),constants.O_RDONLY|(constants.O_NOFOLLOW??0)),references=[],seen=new Set();
 try{
  const before=await handle.stat({bigint:true}),buffer=Buffer.alloc(65536);let carry=Buffer.alloc(0),offset=0;
  function scan(bytes,base,final){
   const text=bytes.toString('latin1'),limit=final?text.length:Math.max(0,text.length-256);
   const pattern=/\b(?:tx(?:=|:[ \t]{0,32}|[ \t]{1,32})|Transaction hash:[ \t]{0,32}|confirmed![ \t]{0,32}Hash:[ \t]{0,32})([a-f0-9]{64})\b/gi;
   for(const match of text.matchAll(pattern)){
    if(match.index>=limit)continue;
    const position=base+match.index,key=position+':'+match[1].toLowerCase();if(seen.has(key))continue;seen.add(key);
    references.push({hash:match[1].toLowerCase(),path:item.path,offset:position,bytes:match[0].length,sourceSha256:item.sha256,classification:'original-command-reference'});
   }
   return bytes.subarray(limit);
  }
  while(true){const{bytesRead}=await handle.read(buffer,0,buffer.length,null);if(!bytesRead)break;
   const combined=Buffer.concat([carry,buffer.subarray(0,bytesRead)]),base=offset-carry.length;
   carry=scan(combined,base,false);offset+=bytesRead;
  }
  scan(carry,offset-carry.length,true);
  const after=await handle.stat({bigint:true});
  if(fingerprint(before)!==fingerprint(after)||Number(after.size)!==item.bytes)fail('RUNTIME_SOURCE_CHANGED',{path:item.path});
  return references;
 }finally{await handle.close();}
}
async function outputJSON(root,relativePath){
 const filename=join(root,relativePath);if(!await lstatMaybe(filename))return null;
 const bytes=await readFile(filename,64*1024*1024);try{return {value:parseOriginalJSON(new TextDecoder('utf-8',{fatal:true}).decode(bytes)).value};}catch{return null;}
}
async function evidenceRows(root){
 const filename=path.join(root,'evidence.jsonl');if(!await lstatMaybe(filename))return {rows:[],errors:[],file:null};
 const actual=await inspectFile(filename),item={path:'evidence.jsonl',bytes:actual.bytes,sha256:actual.sha256,mode:actual.mode};
 const decoder=new TextDecoder('utf-8',{fatal:true}),rows=[],errors=[];let tail='',line=0;
 function consume(text,final=false){
  tail+=text;let i;while((i=tail.indexOf('\n'))>=0){const current=tail.slice(0,i).replace(/\r$/,'');tail=tail.slice(i+1);line++;
   if(!current.trim())continue;try{const value=parseOriginalJSON(current).value;if(!object(value))throw new Error('Native evidence row is not an object');rows.push(value);}
   catch(error){errors.push({line,sha256:sha256(Buffer.from(current)),error:error.message});}
  }
  if(Buffer.byteLength(tail)>8*1024*1024)fail('RUNTIME_EVIDENCE_ROW_TOO_LARGE',{line:line+1});
  if(final&&tail.trim()){line++;errors.push({line,sha256:sha256(Buffer.from(tail)),error:'The final original JSONL row has no complete line terminator.'});}
 }
 for(let offset=0;offset<item.bytes;offset+=4*1024*1024)consume(decoder.decode(await readOriginalFileRange(root,item,offset,Math.min(4*1024*1024,item.bytes-offset)),{stream:true}));
 consume(decoder.decode(),true);return {rows,errors,file:item};
}
async function retainedExecutionArtifacts(root,action){
 const all=[];
 for(const rel of ['prepared.json','input.json','view.json','evidence.jsonl'])if(await lstatMaybe(join(root,rel))){
  const item=await inspectFile(join(root,rel));all.push({path:rel,bytes:item.bytes,sha256:item.sha256,mode:item.mode});}
 if(await lstatMaybe(path.join(root,'commands')))for(const item of await fileDescriptors(path.join(root,'commands')))all.push({...item,path:'commands/'+item.path});
 if(action==='routing.report'){
  const rel='source/docs/evidence/swap-route-report.md';if(await lstatMaybe(join(root,rel))){const item=await inspectFile(join(root,rel));all.push({path:rel,bytes:item.bytes,sha256:item.sha256,mode:item.mode});}
 }
 return all.sort((a,b)=>a.path.localeCompare(b.path,'en'));
}
async function outcomeFor(runtime,settings,prepared,root,states){
 const observedAt=new Date().toISOString(),secretValues=await executionRedactions(root,endpointPrivateValues(settings));
 const redact=redactor(secretValues),commands=[],values={},transactionHashes=new Set(),artifacts=await retainedExecutionArtifacts(root,prepared.action),observations=[],transactionSources=[];
 let evidence={rows:[],errors:[],file:null};try{evidence=await evidenceRows(root);}catch(error){evidence.errors.push({code:error.code??error.name,error:'Original evidence is changing or cannot yet be read completely.'});}
 const rows=redactValue(evidence.rows,redact);
 for(const spec of prepared.commands){
  const commandRoot=path.join(root,'commands',spec.id),attempts=await commandAttempts(commandRoot),latest=attempts.at(-1)??{status:'NOT_STARTED'};
  commands.push({id:spec.id,method:spec.method??null,entrypoint:spec.entrypoint??null,status:latest.status,returncode:latest.returncode??null,
   attempts:attempts.map(item=>({attempt:path.basename(item.directory),status:item.status,returncode:item.returncode??null,selectionSha256:item.selectionSha256??null,
    startedAt:item.startedAt??item.record?.startedAt??null,finishedAt:item.finishedAt??null}))});
  if(latest.directory){
   const value=await outputJSON(latest.directory,'stdout');
   if(spec.method&&value!==null)values[spec.method]=redactValue(value.value,redact);
   if(prepared.action==='rates.project'&&value!==null)values.projection=redactValue(value.value,redact);
   transactionIds(value?.value,transactionHashes);
  }
 }
 transactionIds(rows,transactionHashes);
 for(const artifact of artifacts.filter(item=>/\/(?:stdout|stderr)$/.test(item.path))){
  try{const references=await transactionReferences(root,artifact);for(const reference of references){transactionHashes.add(reference.hash);transactionSources.push(reference);}}catch(error){if(error.code!=='RUNTIME_SOURCE_CHANGED')throw error;}
 }
 const original={sourceCommit:SOURCE_COMMIT,sourceInventorySha256:SOURCE_INVENTORY_SHA256,action:prepared.action,executionId:prepared.executionId,executionOriginId:prepared.executionOriginId,runtime:prepared.runtime};
 for(const artifact of artifacts){
  try{
   const response=await artifactEnvelope(root,artifact,secretValues);
   const observation={schema:'stellar-forge.turbolong-operations-observation.v1',id:sha256(Buffer.from(prepared.executionId+'\0'+artifact.path+'\0'+response.sha256)),
    kind:artifact.path==='evidence.jsonl'?RESULT_KINDS[prepared.action]:'original.process-artifact',operationId:prepared.executionId,observedAt,network:prepared.network,runtime:prepared.runtime,
    request:{kind:'original-command-artifact',path:artifact.path,action:prepared.action,executionId:prepared.executionId,runtimeId:runtime.id},
    response:{...response,contentType:/\.json$|\.jsonl$/.test(artifact.path)?'application/json':'application/octet-stream',mode:artifact.mode},
    original:{...original,path:artifact.path,bytes:artifact.bytes,sha256:artifact.sha256}};
   if(artifact.path==='evidence.jsonl')observation.parsed={kind:RESULT_KINDS[prepared.action],rows,errors:evidence.errors};
   observations.push(observation);
  }catch(error){observations.push({schema:'stellar-forge.turbolong-operations-observation.v1',
   id:sha256(Buffer.from(prepared.executionId+'\0'+artifact.path+'\0pending')),kind:'original.process-artifact.pending',operationId:prepared.executionId,observedAt,
   network:prepared.network,runtime:prepared.runtime,request:{path:artifact.path,executionId:prepared.executionId},response:{bodyBase64:'',bytes:0,sha256:sha256(Buffer.alloc(0)),bodyComplete:false},
   error:{code:error.code??error.name,message:'Original artifact is changing; its completed bytes remain pending.'},original:{...original,path:artifact.path}});}
 }
 const processPending=commands.some(item=>item.status==='PENDING'),unknown=commands.some(item=>item.status==='UNCERTAIN');
 const commandFailures=commands.filter(item=>['FAILED','NOT_STARTED'].includes(item.status)),completed=commands.filter(item=>item.status==='COMPLETED');
 const failedRows=rows.filter(row=>['error','read_error'].includes(row.action)||row.sim_ok===false||['failed','send_error'].includes(row.status));
 const pendingRows=rows.filter(row=>row.status==='timeout'||prepared.action==='keeper.harvest.execute'&&row.status==='failed'&&row.tx_hash);
 let status=processPending?'PENDING':unknown||pendingRows.length?'UNCERTAIN':commandFailures.length?(completed.length?'PARTIAL':'FAILED'):'COMPLETED';
 if(status==='COMPLETED'&&failedRows.length)status=failedRows.length===rows.length?'FAILED':'PARTIAL';
 if(status==='COMPLETED'&&prepared.action.startsWith('keeper.')&&!rows.length)status='PARTIAL';
 if(status==='COMPLETED'&&evidence.errors.length)status='PARTIAL';
 const coveredVaults=new Set(rows.map(row=>row.strategy??row.strategy_id).filter(Boolean));
 const expectedVaults=prepared.scope.vaults??null;
 if(status==='COMPLETED'&&expectedVaults&&expectedVaults.some(row=>!coveredVaults.has(row.strategyId)))status='PARTIAL';
 if(status==='COMPLETED'&&['vault.inspect','vault.shareInspect'].includes(prepared.action)&&prepared.commands.some(spec=>!Object.hasOwn(values,spec.method)))status='PARTIAL';
 const health=rows.map((row,index)=>({row,index})).filter(({row})=>typeof row.ts==='string'&&Number.isFinite(Date.parse(row.ts))).map(({row,index})=>({
  observedAt:row.ts,dimension:'keeper',healthy:!['error','read_error'].includes(row.action)&&row.sim_ok!==false&&!row.error&&!row.sim_error&&!['failed','send_error','timeout'].includes(row.status),
  strategyId:row.strategy??row.strategy_id??null,detail:{action:row.action??null,status:row.status??null,reason:row.reason??null},
  source:{executionId:prepared.executionId,path:'evidence.jsonl',row:index,sha256:sha256(Buffer.from(canonical(evidence.rows[index])))} }));
 const content={kind:RESULT_KINDS[prepared.action],network:prepared.network,action:prepared.action,executionId:prepared.executionId,runtime:prepared.runtime,
  scope:prepared.scope,commands,rows,values,artifacts:artifacts.map(item=>({...item,privateOriginalRetained:true})),transactionHashes:[...transactionHashes],transactionReferences:transactionSources,
  original,coverage:{processComplete:!processPending&&!unknown,rows:rows.length,expectedVaults:expectedVaults?.length??null,observedVaults:coveredVaults.size,
   failedRows:failedRows.length,evidenceErrors:evidence.errors,complete:status==='COMPLETED',...(prepared.scope.originalReportWindow??{})},
  operating:{health}};
 return {status,content,observations,runtime:prepared.runtime,original,reconciliation:{executionId:prepared.executionId,mode:'original-process-receipt',observedAt,transactionHashes:[...transactionHashes]}};
}
export async function openTurbolongRuntimeExecution({connection={}}={}){
 const settings=connectionSettings(connection);let closed=false,runtimePromise=null;const waits=new Set();
 const executionDirectory=absolute(settings.executionDirectory??((settings.runtime.runtimeDirectory??settings.runtime.installationDirectory??settings.runtime.directory??'')+'.turbolong-executions'),'executionDirectory');
 if(!settings.executionDirectory&&!settings.runtime.runtimeDirectory&&!settings.runtime.installationDirectory&&!settings.runtime.directory)fail('RUNTIME_EXECUTION_DIRECTORY_REQUIRED');
 async function selectedRuntime(){if(!runtimePromise)runtimePromise=resolveTurbolongRuntime(settings.runtime).catch(error=>{runtimePromise=null;throw error;});return runtimePromise;}
 function assertOpen(){if(closed)fail('RUNTIME_EXECUTION_CLOSED');}
 function describe(){return {schema:'stellar-forge.turbolong-operations.runtime-execution.v1',network:settings.network,sourceCommit:SOURCE_COMMIT,
  actions:[...RUNTIME_ACTIONS],rpcUrl:publicEndpoint(settings.rpcUrl)};}
 async function prepare({action,args={},requestId}={}){
  assertOpen();selectedId(requestId);const runtime=await selectedRuntime();const origin=await executionOrigin(executionDirectory);
  const root=path.join(executionDirectory,'executions',sha256(Buffer.from(requestId)));await privateDirectory(root);
  const release=await acquire(path.join(root,'preparation'));try{
  const old=await optionalJSON(path.join(root,'prepared.json'));
  if(old){if(old.action!==action||canonical(old.args)!==canonical(args)||old.runtime.id!==runtime.id||old.runtime.manifestSha256!==runtime.manifestSha256)fail('RUNTIME_REQUEST_CONFLICT');return old;}
  const plan=await commandPlan(runtime,settings,action,args),mutates=action.endsWith('.execute')||args.telemetry===true;
  const prepared={schema:REQUEST_SCHEMA,executionId:requestId,executionOriginId:origin.id,action,args:portable(args),network:settings.network,mutates,
   runtime:publicTurbolongRuntime(runtime),commands:plan.commands,privateNames:plan.privateNames,actorPublicKey:plan.actorPublicKey,scope:plan.scope,
   input:plan.input?{path:'input.json',bytes:plan.input.length,sha256:sha256(plan.input)}:null,preparedAt:new Date().toISOString()};
  prepared.sha256=identity(prepared);
  if(plan.input)await writeExact(root,'input.json',plan.input);
  await writeExact(root,'prepared.json',jsonBytes(prepared));return portable(prepared);
  }finally{await release();}
 }
 function originalRequest(value){const request=value?.request??value?.preparedRequest??value?.prepared??value,prepared=request?.original??request;
  if(!object(prepared)||prepared.schema!==REQUEST_SCHEMA)fail('RUNTIME_PREPARED_REQUEST_REQUIRED');
  const {sha256:expected,...unsigned}=prepared;if(sha256(Buffer.from(canonical(unsigned)))!==expected)fail('RUNTIME_PREPARED_REQUEST_CHANGED');
  selectedId(prepared.executionId);if(prepared.network!==settings.network)fail('RUNTIME_NETWORK_MISMATCH');return prepared;
 }
 async function execute(prepared,{signal,reconcileOnly=false}={}){
  assertOpen();const runtime=await selectedRuntime();
  if(prepared.runtime.id!==runtime.id||prepared.runtime.manifestSha256!==runtime.manifestSha256)fail('RUNTIME_SELECTION_CHANGED');
  const origin=await executionOrigin(executionDirectory),root=path.join(executionDirectory,'executions',sha256(Buffer.from(prepared.executionId)));
  if(prepared.mutates&&prepared.executionOriginId!==origin.id)fail('RUNTIME_EXECUTION_ORIGIN_REQUIRED',{executionId:prepared.executionId,originalExecutionOriginId:prepared.executionOriginId,
   actualExecutionOriginId:origin.id,runtime:prepared.runtime});
  await privateDirectory(root);await writeExact(root,'prepared.json',jsonBytes(prepared));
  if(prepared.input&&!await lstatMaybe(join(root,prepared.input.path))){
   const bytes=originalRateInputs(prepared.args.inputs);if(bytes.length!==prepared.input.bytes||sha256(bytes)!==prepared.input.sha256)fail('RUNTIME_INPUT_CHANGED');
   await writeExact(root,prepared.input.path,bytes);
  }
  const controller=new AbortController();const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();waits.add(controller);
  try{
   const states=[];for(const spec of prepared.commands){
    const selection={schema:COMMAND_SCHEMA,executionId:prepared.executionId,preparationSha256:prepared.sha256,runtime:prepared.runtime,
     action:prepared.action,network:prepared.network,command:spec,actorPublicKey:prepared.actorPublicKey,privateInputNames:prepared.privateNames};
    const commandRoot=path.join(root,'commands',spec.id);
    const continueUnstarted=reconcileOnly&&!prepared.mutates&&!controller.signal.aborted&&states.every(item=>item.status==='COMPLETED');
    const actual=(!reconcileOnly||continueUnstarted)&&!controller.signal.aborted?()=>actualCommand(runtime,settings,prepared,spec,root):null;
    const result=await originalCommand({directory:commandRoot,selection,actual,nodeExecutable:runtime.tools.node.path,
     allowRetry:!prepared.mutates,reconcileOnly:reconcileOnly||controller.signal.aborted,continueUnstarted,signal:controller.signal,maximumWaitMs:30000});
    states.push(result);
    if(result.status==='PENDING'||result.status==='UNCERTAIN'||controller.signal.aborted)break;
   }
   return await outcomeFor(runtime,settings,prepared,root,states);
  }finally{signal?.removeEventListener('abort',abort);waits.delete(controller);}
 }
 async function perform({request,signal}={}){return execute(originalRequest(request),{signal});}
 async function reconcile({operation,signal}={}){return execute(originalRequest(operation),{signal,reconcileOnly:true});}
 async function close(){closed=true;for(const controller of waits)controller.abort();waits.clear();}
 return {describe,prepare,perform,reconcile,close};
}
export async function readTurbolongExecutionFile({executionDirectory,executionId,path:relativePath,sha256:expectedSha256,offset=0,length=4*1024*1024}={}){
 selectedId(executionId);relative(relativePath);hash(expectedSha256,'sha256');
 const root=join(absolute(executionDirectory,'executionDirectory'),'executions/'+sha256(Buffer.from(executionId)));
 const permitted=await retainedExecutionArtifacts(root,(await readJSON(path.join(root,'prepared.json'))).value.action);
 const item=permitted.find(file=>file.path===relativePath&&file.sha256===expectedSha256);if(!item)fail('RUNTIME_ARTIFACT_NOT_SELECTED');
 const bytes=await readOriginalFileRange(root,item,offset,length);
 return {...item,offset,length:bytes.length,complete:offset+bytes.length===item.bytes,bodyBase64:bytes.toString('base64')};
}
