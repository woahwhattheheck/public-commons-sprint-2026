export interface UpstreamTlsDeclaration {
  caFileEnv?: string;
  certFileEnv?: string;
  keyFileEnv?: string;
  pfxFileEnv?: string;
  passphraseEnv?: string;
  minVersion?: 'TLSv1.2' | 'TLSv1.3';
}
export const UPSTREAM_TLS_SCHEMA: 'stellar-forge.upstream-tls.v1';
export function compileUpstreamTls(value: undefined, options?: { origin?: string }): undefined;
export function compileUpstreamTls(value: UpstreamTlsDeclaration, options?: { origin?: string }): Readonly<UpstreamTlsDeclaration>;
export function upstreamTlsReferences(value?: UpstreamTlsDeclaration): readonly string[];
