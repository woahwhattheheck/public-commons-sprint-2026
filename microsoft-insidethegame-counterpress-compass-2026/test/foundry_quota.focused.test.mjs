import {strict as assert} from 'node:assert';
import {createFoundryQuota, quotaConfig} from '../src/foundry_quota.mjs';

// One focused, provider-free contract probe; no mock paid request or global suite.
let now = 1_000_000;
const quota = createFoundryQuota({concurrent:1, hourly:2, daily:3}, () => now);
const first = quota.reserve();
assert.equal(first.allowed, true);
assert.equal(quota.reserve().reason, 'IN_FLIGHT_LIMIT');
first.release(); first.release();
assert.equal(quota.reserve().allowed, true);
const third = quota.reserve(); // second request is still active
assert.equal(third.reason, 'IN_FLIGHT_LIMIT');
// Simulate completion without re-using the count by rebuilding a quota for limits.
const countQuota = createFoundryQuota({concurrent:2, hourly:2, daily:3}, () => now);
countQuota.reserve().release(); countQuota.reserve().release();
assert.equal(countQuota.reserve().reason, 'HOURLY_LIMIT');
now += 3_600_001;
assert.equal(countQuota.reserve().allowed, true);
assert.equal(countQuota.reserve().reason, 'DAILY_LIMIT');
now += 86_400_001;
assert.equal(countQuota.reserve().allowed, true);
assert.equal(createFoundryQuota({concurrent:0,hourly:2,daily:3}).reserve().reason, 'DISABLED');
assert.throws(() => quotaConfig({FOUNDRY_MAX_PER_DAY:'not-a-number'}), /integer/);
process.stdout.write('Focused Foundry quota admission contract: PASS\n');
