// MIT. Optional audience-specific metadata for the original source distribution.
const ownPath = 'stellar/scf-starforge-20261009/distribution';
const schema = 'stellar-forge.merchant-product-package.v1';
const defaults = {
  description: 'Original Starforge Stellar x402 merchant, buyer and operations toolkit',
  repository: { type: 'git', url: 'https://github.com/woahwhattheheck/public-commons-sprint-2026.git', directory: ownPath },
  readme: ownPath + '/README.md',
  bin: { starforge: ownPath + '/cli.mjs' },
};
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function sourcePath(value, label, empty = false) {
  if (empty && value === '') return value;
  if (typeof value !== 'string' || !value || value.length > 512 ||
      /[\u0000-\u0020\u007f\\?#%:*]/.test(value) ||
      value.split('/').some(part => !part || part === '.' || part === '..'))
    throw new TypeError('Invalid product source path: ' + label);
  return value;
}
function repository(value) {
  if (!plain(value) || Object.keys(value).some(key => !['url', 'directory'].includes(key)))
    throw new TypeError('Product repository requires its public GitHub URL and optional directory');
  if (typeof value.url !== 'string' || !/^https:\/\/github\.com\/[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]+(?:\.git)?$/.test(value.url))
    throw new TypeError('Product repository must be an exact public GitHub repository URL');
  const url = value.url.replace(/\.git$/, '');
  const name = url.split('/').at(-1);
  if (name === '.' || name === '..' || name.length > 100)
    throw new TypeError('Invalid product repository name');
  return { type: 'git', url: url + '.git', directory: sourcePath(value.directory ?? '', 'repository.directory', true) };
}

/** Validate only declarative metadata; source selection and original Git pin stay with buildDistribution. */
export function productPackageMetadata(value) {
  if (value === undefined) return { ...defaults, repository: { ...defaults.repository }, bin: { ...defaults.bin },
    sourceRepository: defaults.repository.url.slice(0, -4) };
  if (!plain(value) || value.schema !== schema ||
      Object.keys(value).some(key => !['schema', 'description', 'repository', 'readme', 'bin'].includes(key)))
    throw new TypeError('Unsupported product package metadata');
  const result = productPackageMetadata();
  if (value.description !== undefined) {
    if (typeof value.description !== 'string' || !value.description.trim() || value.description.length > 512 ||
        /[\u0000-\u001f\u007f]/.test(value.description))
      throw new TypeError('Product description must be one nonempty line up to 512 characters');
    result.description = value.description;
  }
  if (value.repository !== undefined) {
    result.repository = repository(value.repository);
    result.sourceRepository = result.repository.url.slice(0, -4);
  }
  if (value.readme !== undefined) {
    result.readme = sourcePath(value.readme, 'readme');
    if (!/\.md$/i.test(result.readme)) throw new TypeError('Product README must select an original Markdown source');
  }
  if (value.bin !== undefined) {
    if (!plain(value.bin) || !Object.keys(value.bin).length || Object.keys(value.bin).length > 8)
      throw new TypeError('Product bin must declare one to eight original Node entrypoints');
    result.bin = Object.create(null);
    for (const [name, path] of Object.entries(value.bin)) {
      if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(name)) throw new TypeError('Invalid product command name: ' + name);
      sourcePath(path, 'bin.' + name);
      if (!/\.(?:mjs|cjs|js)$/.test(path)) throw new TypeError('Product bin must select original Node source: ' + name);
      result.bin[name] = path;
    }
  }
  return result;
}
