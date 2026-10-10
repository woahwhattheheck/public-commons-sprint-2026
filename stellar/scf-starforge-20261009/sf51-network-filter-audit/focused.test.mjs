// MIT. One focused local behavioral check, not a simulation or hosted CI job.
import { strict as assert } from 'node:assert';
import { auditPair, eligibleNetworkOffers, selectNetworkResources, validatePairUrls } from './network-filter.mjs';

const canonical = {
  type:'http',resource:'https://api.example.com/x402/weather',x402Version:2,
  accepts:[{scheme:'exact',network:'eip155:8453',amount:'200',asset:'0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',payTo:'0x209693Bc6afc0C5328bA36FaF03C514EF312287C'}]
};
// The resource/price/network are from the actual upstream x402 Bazaar published example.
// Only this LOCAL acceptance-check fixture is generated. It is not evidence
// of a live endpoint; real provider observations are documented separately.
const raw = Buffer.from(JSON.stringify({x402Version:2,items:[canonical],pagination:{total:1,offset:0,limit:2}}));
const base='https://facilitator.example.org/discovery/resources?limit=2&offset=0&network=';
const input={filteredBytes:raw,controlBytes:raw,filteredUrl:base+'stellar%3Atestnet',
  controlUrl:base+'eip155%3A8453',network:'stellar:testnet',
  filteredAt:'2026-10-10T06:20:00Z',controlAt:'2026-10-10T06:20:01Z'};
const bad=auditPair(input);
assert.equal(bad.finding,'RETURNED_ROWS_WITHOUT_REQUESTED_NETWORK');
assert.equal(bad.observed.nonmatching_rows,1);
assert.equal(bad.observed.same_page_identities,true);
assert.equal(bad.observed.identical_raw_page_bytes,true);
assert.equal(bad.buyer_safe_candidates.length,0);
assert.equal(eligibleNetworkOffers(canonical,'stellar:testnet').length,0);
assert.deepEqual(selectNetworkResources([canonical],'stellar:testnet'),[]);
const multi=structuredClone(canonical);
multi.accepts.push({...multi.accepts[0],network:'stellar:testnet'});
const good=auditPair({...input,filteredBytes:Buffer.from(JSON.stringify({x402Version:2,items:[multi],pagination:{total:1}}))});
assert.equal(good.finding,'OBSERVED_FILTERED_PAGE_COMPATIBLE');
assert.equal(good.observed.nonmatching_rows,0);
assert.equal(good.buyer_safe_candidates.length,1);
assert.equal(selectNetworkResources([multi],'stellar:testnet')[0].accepts.length,1);
assert.deepEqual(multi.accepts.map(x=>x.network),['eip155:8453','stellar:testnet']);
assert.throws(()=>validatePairUrls('http://facilitator.example.org/discovery/resources?network=stellar%3Atestnet',input.controlUrl,'stellar:testnet'),/SOURCE_PAIR_NOT_SAME_HTTPS_DISCOVERY/);
assert.throws(()=>auditPair({...input,controlUrl:base+'stellar%3Atestnet'}),/SOURCE_PAIR_NETWORK_FILTER_INVALID/);
assert.throws(()=>auditPair({...input,filteredBytes:Buffer.from('not-json')}),/PAGE_INVALID_JSON/);
console.log('SF51 PASS: source-schema page parsing, original raw SHA retention, network-filter failures, mixed-network allow, safe per-network offer selection, URL guards; no paid calls.');
