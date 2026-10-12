import {createPublicHttpsFetch} from '../../sf31-buyer-client/public-transport.mjs';
import {createOfficialEventDecoder} from '../../sf43-agent-commerce/verify.mjs';
const decoder=await createOfficialEventDecoder();
if(typeof decoder!=='function')throw Error('ORIGINAL_DECODER_UNAVAILABLE');
const fetch=createPublicHttpsFetch({trustedProxy:{mode:'explicit-connect',origin:'https://soroban-testnet.stellar.org',proxyUrl:process.argv[2]}});
const response=await fetch('https://soroban-testnet.stellar.org',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:'api-native-observer-preflight',method:'getNetwork'}),redirect:'manual'});
if(response.status!==200)throw Error('ORIGINAL_RPC_HTTP_FAILED');
const data=await response.json();
if(data.result?.passphrase!=='Test SDF Network ; September 2015')throw Error('ORIGINAL_TESTNET_RPC_REQUIRED');
console.log(JSON.stringify({state:'ORIGINAL_OBSERVER_TLS_AND_DECODER_READY',passphrase:data.result.passphrase,protocolVersion:data.result.protocolVersion,keysLoaded:false,transactionOrPayment:false}));

