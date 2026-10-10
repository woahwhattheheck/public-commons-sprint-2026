/** MIT. External verification adapters only; never supplies a signer or wallet. */
export type StellarNetwork = 'stellar:testnet' | 'stellar:pubnet';
export type AssetRecord = Readonly<{
  network: StellarNetwork;
  asset: string; // SEP-41 contract ID, C-address
  code: string;
  decimals: number;
  source: string; // operator-vetted metadata origin and version
  verifiedAtMs: number;
  expiresAtMs: number;
}>;
export type PaymentRequirement = Readonly<{
  scheme: 'exact';
  network: StellarNetwork;
  asset: string;
  amount: string; // canonical atomic-unit integer, never a JS number
  payTo: string;
}>;
export type RecipientClaim = Readonly<{network: StellarNetwork;asset:string;payTo:string}>;
export type RecipientProof = RecipientClaim & Readonly<{ready:boolean;observedAtMs:number}>;
export function parseAtomic(value:string, decimals:number, options?:{allowZero?:boolean}):string;
export function formatAtomic(amount:string, decimals:number):string;
export class AssetRegistry {
  constructor(entries:readonly AssetRecord[], options?:{now?:number});
  get(network:StellarNetwork, asset:string, now?:number):AssetRecord;
}
export function validatePaymentTerms(req:PaymentRequirement, registry:AssetRegistry,
  options:{verifyRecipient:(input:RecipientClaim)=>Promise<RecipientProof>;now?:number}
):Promise<Readonly<PaymentRequirement & {
  decimalAmount:string;
  metadataSource:string;
  verifiedRecipientAtMs:number;
}>>;
export const StellarUSDC:Readonly<{testnet:string;pubnet:string;decimals:7}>;
