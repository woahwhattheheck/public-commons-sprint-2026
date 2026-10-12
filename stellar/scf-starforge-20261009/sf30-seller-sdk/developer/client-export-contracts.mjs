// MIT. Original tool metadata; provider runtimes load only when selected.


const CLIENT_EXPORT_MANIFEST = 'client-export.json';

const CLIENT_EXPORT_FILES = Object.freeze(['seller-client.mjs', 'seller-client.d.mts', 'seller-openapi.json', 'package.json', 'README.md']);

const MAX_CLIENT_EXPORT_FILE_BYTES = 64 * 1024 * 1024;

export { CLIENT_EXPORT_FILES, CLIENT_EXPORT_MANIFEST, MAX_CLIENT_EXPORT_FILE_BYTES };
