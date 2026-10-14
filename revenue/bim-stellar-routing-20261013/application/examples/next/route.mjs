// MIT. Copy into app/api/bim/[...path]/route.js and select the actual server helper import.
import {bimOwner} from '../../../bim-server.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request){return await (await bimOwner()).GET(request);}
export async function POST(request){return await (await bimOwner()).POST(request);}
