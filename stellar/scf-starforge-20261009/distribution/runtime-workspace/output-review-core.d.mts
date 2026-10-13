export interface OutputReview {
  schema:'stellar-forge.runtime-output-review.v1'; query:string; contextBytes:number;
  endOffset:number; complete:true; matches:Array<[number,number,number,number]>;
}
export type OutputReviewRead=(offset:number,length:number)=>Promise<Uint8Array>;
export function projectOutputReview(options:{read:OutputReviewRead;endOffset:number;query:string;contextBytes?:number;maximumBytes?:number}):Promise<OutputReview>;
export function verifyOutputReview(review:unknown,options:{read:OutputReviewRead;endOffset:number;maximumBytes?:number}):Promise<OutputReview>;
