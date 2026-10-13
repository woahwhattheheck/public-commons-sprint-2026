export const SOURCE_COLLECTION_CLI_SCHEMA:'stellar-forge.installation-source-collection-cli.v1';
export interface InstallationSourceCollectionCLIResult {
 schema:typeof SOURCE_COLLECTION_CLI_SCHEMA;command:string;workspaceDirectory:string;directory:string;result:unknown;
}
export function runInstallationSourceCollectionCLI(argv:string[],options?:{stdout?:{write(value:string):unknown}}):Promise<InstallationSourceCollectionCLIResult|{help:true}>;
