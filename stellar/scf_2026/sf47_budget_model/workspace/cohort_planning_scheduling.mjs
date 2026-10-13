/**
 * Allocate original cohort occurrences to shared daily delivery capacity.
 * The maintained cohort calculator owns recurrence, funding and economics.
 */
import {COHORT_PLAN_SCHEMA, COHORT_PLAN_REPORT_SCHEMA, COHORT_SCHEDULING_SCHEMA,
  CohortPlanningError, normalizeCohortPlan, normalizeCohortScheduling, evaluateCohortPlan}
  from './cohort_planning.mjs';

export const COHORT_DELIVERY_SCHEDULE_SCHEMA = 'stellar-forge.sf47-delivery-schedule-report.v1';
const copy = value => JSON.parse(JSON.stringify(value));
const ordered = value => Array.isArray(value) ? value.map(ordered) : value && typeof value === 'object' ?
  Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
const canonical = value => JSON.stringify(ordered(value));
const DAY = 86400000, UNIT = 10n ** 24n;
const dateNumber = value => Date.parse(value + 'T00:00:00Z');
const distance = (a, b) => (dateNumber(a) - dateNumber(b)) / DAY;
const stamp = (job, date) => date + 'T' + job.schedule.timeUtc + ':00.000Z';
const finish = (job, date) => new Date(Date.parse(stamp(job, date)) + job.schedule.deliveryDelayMinutes * 60000).toISOString();
const hours = value => { const [whole, fraction = ''] = value.split('.'); return BigInt(whole) * UNIT + BigInt(fraction.padEnd(24, '0')); };
function hoursText(value) {
  const sign = value < 0n ? '-' : '', amount = value < 0n ? -value : value;
  const fraction = String(amount % UNIT).padStart(24, '0').replace(/0+$/, '');
  return sign + String(amount / UNIT) + (fraction ? '.' + fraction : '');
}
function fail(code, message, path = '') { throw new CohortPlanningError(code, message, path); }
function planFrom(document) {
  if (document?.schema === COHORT_PLAN_SCHEMA) return document;
  if (document?.schema === COHORT_PLAN_REPORT_SCHEMA && document.kind === 'PLAN') return document.input;
  if (document?.schema === COHORT_DELIVERY_SCHEDULE_SCHEMA) return document.candidate;
  if (document?.schema === 'stellar-forge.sf47-cohort-plan-edition.v1') return document.plan;
  fail('SCHEDULING_PLAN_REQUIRED', 'Select the complete original cohort plan, report or saved edition.', 'sourceDocument');
}
function defaultPolicy(scheduleId) {
  return {scheduleId, flexible: false, advanceDays: 0, delayDays: 0, releaseDate: null, dueDate: null,
    weekdays: [1, 2, 3, 4, 5, 6, 7], minimumGapDays: 0, priority: 0, note: ''};
}
export function seedCohortDeliveryScheduling(document) {
  const plan = normalizeCohortPlan(planFrom(document));
  const existing = plan.deliveryScheduling || {schema: COHORT_SCHEDULING_SCHEMA, strategy: 'NEAREST', schedules: [], note: ''};
  const selected = new Map(existing.schedules.map(row => [row.scheduleId, row]));
  return normalizeCohortScheduling({...copy(existing), schedules: plan.schedules.map(row => selected.get(row.id) || defaultPolicy(row.id))}, plan.schedules);
}
function capacityKey(pool, date) { return canonical([pool, date]); }
function compatible(before, beforeDate, after, afterDate, edge) {
  if (distance(afterDate, beforeDate) < edge.gapDays) return false;
  return !edge.ordered || (stamp(before, beforeDate).localeCompare(stamp(after, afterDate)) ||
    before.schedule.id.localeCompare(after.schedule.id) || before.sourceDate.localeCompare(after.sourceDate)) < 0;
}
export function scheduleCohortDelivery(document, rawConstraints = undefined, options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => !['name', 'method', 'maxSearchSteps'].includes(key)))
    fail('SCHEDULING_OPTIONS', 'Use the successor name, allocation method and optional search effort.');
  const allocationMethod = options.method ?? 'FIRST_FIT';
  if (!['FIRST_FIT', 'RESOLVE_CONFLICTS'].includes(allocationMethod))
    fail('SCHEDULING_OPTIONS', 'Choose FIRST_FIT or RESOLVE_CONFLICTS.', 'method');
  if (options.maxSearchSteps !== undefined && allocationMethod !== 'RESOLVE_CONFLICTS')
    fail('SCHEDULING_OPTIONS', 'Search effort applies to RESOLVE_CONFLICTS.', 'maxSearchSteps');
  const maxSearchSteps = options.maxSearchSteps ?? 100000;
  if (!Number.isSafeInteger(maxSearchSteps) || maxSearchSteps < 1 || maxSearchSteps > 1000000)
    fail('SCHEDULING_OPTIONS', 'Search effort must be a whole number from 1 to 1000000.', 'maxSearchSteps');
  const input = normalizeCohortPlan(planFrom(document));
  const supplied = rawConstraints === undefined ? seedCohortDeliveryScheduling(input) : normalizeCohortScheduling(rawConstraints, input.schedules);
  const suppliedById = new Map(supplied.schedules.map(row => [row.scheduleId, row]));
  const constraints = normalizeCohortScheduling({...supplied, schedules: input.schedules.map(row => suppliedById.get(row.id) || defaultPolicy(row.id))}, input.schedules);
  const before = evaluateCohortPlan(input);
  const dayByDate = new Map(before.days.map(day => [day.date, day]));
  const policies = new Map(constraints.schedules.map(row => [row.scheduleId, row]));
  const schedules = new Map(input.schedules.map(row => [row.id, row]));
  const funding = new Map(input.fundingGroups.map(row => [row.id, row]));
  const capacity = new Map();
  for (const pool of before.capacity.pools) for (const day of pool.days)
    capacity.set(capacityKey(pool.id, day.date), {available: day.availableHours === null ? null : hours(day.availableHours), used: 0n, unknown: 0});
  const jobs = before.occurrences.map((occurrence, index) => {
    const schedule = schedules.get(occurrence.scheduleId), policy = policies.get(schedule.id);
    const effort = occurrence.scheduledTasks === 0 ? 0n : schedule.economics?.activeHoursPerTask == null ? null :
      hours(schedule.economics.activeHoursPerTask) * BigInt(occurrence.scheduledTasks);
    const fixedReason = !occurrence.scheduledTasks ? 'NO_ACTIVE_WORK' : Date.parse(occurrence.scheduledAt) <= Date.parse(input.asOfAt) ? 'PAST_CUTOFF' :
      !policy.flexible ? 'FIXED_DATE' : effort === null ? 'EFFORT_REQUIRED' : effort > 0n && !schedule.capacityPoolId ? 'DELIVERY_POOL_REQUIRED' : null;
    return {id: occurrence.id, index, occurrence, schedule, policy, sourceDate: occurrence.sourceDate || occurrence.date,
      originalDate: occurrence.date, date: occurrence.date, effort, fixedReason, issues: [], rejected: [], predecessors: [], successors: []};
  });
  const byId = new Map(jobs.map(job => [job.id, job]));
  function reserve(job, date, sign) {
    if (!job.schedule.capacityPoolId) return;
    const bucket = capacity.get(capacityKey(job.schedule.capacityPoolId, date));
    if (job.effort === null) bucket.unknown += sign; else bucket.used += job.effort * BigInt(sign);
  }
  for (const job of jobs) reserve(job, job.date, 1);
  const issue = (code, message, extra = {}) => ({code, message, ...extra});
  function dateIssues(job, date, {fixed = false} = {}) {
    const selected = dayByDate.get(date), policy = job.policy, reasons = [];
    if (!selected) return [issue('OUTSIDE_ORIGINAL_WINDOW', 'Keep delivery inside the original cohort window.')];
    if (!fixed && (distance(date, job.sourceDate) < -policy.advanceDays || distance(date, job.sourceDate) > policy.delayDays))
      reasons.push(issue('OCCURRENCE_FLEXIBILITY', 'The date is outside the entered advance/delay range of the original occurrence.',
        {sourceDate: job.sourceDate, advanceDays: policy.advanceDays, delayDays: policy.delayDays}));
    if (!selected.isWorkingDay || job.schedule.excludedDates.some(row => row.date === date))
      reasons.push(issue('CLOSED_DELIVERY_DATE', 'The original plan or service calendar closes this date.'));
    if (!policy.weekdays.includes(selected.weekday)) reasons.push(issue('SERVICE_WEEKDAY', 'This weekday is outside the service’s permitted days.'));
    if (!fixed && Date.parse(stamp(job, date)) <= Date.parse(input.asOfAt))
      reasons.push(issue('PAST_CUTOFF', 'New date allocations must follow the retained planning cutoff.'));
    if (policy.releaseDate && date < policy.releaseDate)
      reasons.push(issue('RELEASE_DATE', 'Work cannot begin before the entered release.', {releaseDate: policy.releaseDate}));
    if (policy.dueDate && finish(job, date).slice(0, 10) > policy.dueDate)
      reasons.push(issue('COMPLETION_DEADLINE', 'The complete output would arrive after the entered deadline.',
        {dueDate: policy.dueDate, plannedCompleteAt: finish(job, date)}));
    if (finish(job, date).slice(0, 10) > before.window.end)
      reasons.push(issue('ORIGINAL_WINDOW_COMPLETION', 'The complete output must remain inside the original cohort window.'));
    for (const id of job.schedule.fundingGroupIds) {
      const group = funding.get(id);
      if (date < group.date) reasons.push(issue('ORIGINAL_FUNDING_DATE', 'Use cannot precede its retained purchase/funding date.', {fundingGroupId: id, fundingDate: group.date}));
    }
    return reasons;
  }
  for (const job of jobs) {
    job.domains = job.fixedReason ? [job.date] : before.days.filter(day => !dateIssues(job, day.date).length).map(day => day.date);
    if (['EFFORT_REQUIRED', 'DELIVERY_POOL_REQUIRED'].includes(job.fixedReason))
      job.issues.push(issue(job.fixedReason, job.fixedReason === 'EFFORT_REQUIRED' ? 'Enter active effort for the complete useful task.' : 'Assign the original work to an entered delivery pool.'));
    if (job.fixedReason === 'FIXED_DATE') job.issues.push(...dateIssues(job, job.date, {fixed: true}));
    if (!job.fixedReason && !job.domains.length) {
      job.issues.push(issue('NO_PERMITTED_DATE', 'The release, deadline, occurrence tolerance, funding and calendar constraints leave no permitted date.'));
      job.rejected = before.days.map(day => ({date: day.date, reasons: dateIssues(job, day.date)}));
    }
  }

  // The same original chronological order owns implicit prepaid consumption.
  // Connected sequences are placed together so a failed continuation can retain
  // all of its original dates and the exact existing pass economics.
  const parents = new Map(jobs.map(job => [job.id, job.id]));
  function root(id) { let current = id; while (parents.get(current) !== current) current = parents.get(current); return current; }
  function join(first, second) { parents.set(root(second), root(first)); }
  function edge(first, second, gapDays, ordered) {
    const value = {before: first.id, after: second.id, gapDays, ordered};
    first.successors.push(value); second.predecessors.push(value); join(first.id, second.id);
  }
  const chains = new Map();
  for (const job of jobs.filter(row => row.occurrence.scheduledTasks)) {
    if (job.policy.minimumGapDays > 0) {
      const key = 'schedule:' + job.schedule.id;
      if (!chains.has(key)) chains.set(key, {jobs: [], gap: job.policy.minimumGapDays, ordered: false});
      chains.get(key).jobs.push(job);
    }
    if (job.schedule.payment.kind === 'PREPAID') {
      const key = job.schedule.payment.passGroupId ? 'pass:' + job.schedule.payment.passGroupId : 'pass-schedule:' + job.schedule.id;
      if (!chains.has(key)) chains.set(key, {jobs: [], gap: 0, ordered: true});
      chains.get(key).jobs.push(job);
    }
  }
  for (const chain of chains.values()) for (let index = 1; index < chain.jobs.length; index++)
    edge(chain.jobs[index - 1], chain.jobs[index], chain.gap, chain.ordered);
  const groups = new Map();
  for (const job of jobs) {
    const key = root(job.id);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(job);
  }
  const groupOrder = [...groups.values()].sort((a, b) =>
    b.reduce((best, row) => Math.max(best, row.policy.priority), 0) - a.reduce((best, row) => Math.max(best, row.policy.priority), 0) ||
    (a.map(row => row.domains.at(-1) || row.date).sort()[0]).localeCompare(b.map(row => row.domains.at(-1) || row.date).sort()[0]) ||
    a[0].index - b[0].index);
  function capacityIssues(job, date) {
    if (job.effort === 0n) return [];
    if (job.effort === null) return [issue('EFFORT_REQUIRED', 'Enter the original task’s active effort.')];
    if (!job.schedule.capacityPoolId) return [issue('DELIVERY_POOL_REQUIRED', 'Choose a delivery pool for this effort.')];
    const bucket = capacity.get(capacityKey(job.schedule.capacityPoolId, date));
    const detail = {poolId: job.schedule.capacityPoolId, requiredHours: hoursText(job.effort),
      availableHours: bucket.available === null ? null : hoursText(bucket.available), reservedHours: hoursText(bucket.used),
      remainingHours: bucket.available === null ? null : hoursText(bucket.available - bucket.used),
      unknownEffortOccurrences: bucket.unknown};
    if (bucket.available === null) return [issue('AVAILABILITY_REQUIRED', 'Enter the pool’s available active hours on this date.', detail)];
    if (bucket.unknown) return [issue('RESERVED_EFFORT_UNKNOWN', 'Complete the effort of work already reserved on this date.', detail)];
    if (bucket.used + job.effort > bucket.available) return [issue('DAILY_CAPACITY', 'The complete occurrence does not fit the remaining daily capacity.', detail)];
    return [];
  }
  for (const group of groupOrder) {
    const movable = group.filter(job => !job.fixedReason);
    if (!movable.length) continue;
    for (const job of movable) reserve(job, job.originalDate, -1);
    const placed = new Map(), attempted = [];
    let failed = null;
    for (const job of group) {
      if (job.fixedReason) { placed.set(job.id, job.date); continue; }
      const candidates = [...job.domains].sort((a, b) => constraints.strategy === 'EARLIEST' ? a.localeCompare(b) :
        Math.abs(distance(a, job.sourceDate)) - Math.abs(distance(b, job.sourceDate)) || a.localeCompare(b));
      let chosen = null;
      for (const date of candidates) {
        const reasons = capacityIssues(job, date);
        for (const link of job.predecessors) {
          const previous = byId.get(link.before), previousDate = placed.get(previous.id) || previous.date;
          if (!compatible(previous, previousDate, job, date, link))
            reasons.push(issue('ORIGINAL_SEQUENCE', 'Retain the original prepaid order and entered spacing.', {relatedOccurrenceId: previous.id, relatedDate: previousDate, minimumGapDays: link.gapDays}));
        }
        for (const link of job.successors) {
          const next = byId.get(link.after);
          const future = next.fixedReason ? [next.date] : next.domains;
          if (!future.some(nextDate => compatible(job, date, next, nextDate, link)))
            reasons.push(issue('FOLLOWING_SERVICE_WINDOW', 'The following original occurrence needs a permitted date after this work.',
              {relatedOccurrenceId: next.id, latestPermittedDate: future.at(-1) || null, minimumGapDays: link.gapDays}));
        }
        if (reasons.length) job.rejected.push({date, reasons}); else { chosen = date; break; }
      }
      if (chosen === null) { failed = job; break; }
      job.date = chosen; placed.set(job.id, chosen); reserve(job, chosen, 1); attempted.push(job);
    }
    if (failed) {
      for (const job of attempted) reserve(job, job.date, -1);
      for (const job of movable) {
        job.date = job.originalDate; reserve(job, job.originalDate, 1);
        job.issues.push(job.id === failed.id ?
          issue('NO_AVAILABLE_PLACEMENT', 'No permitted date fits after fixed work and earlier allocated groups. Review the returned date constraints, capacity or priority.') :
          issue('LINKED_SERVICE_UNRESOLVED', 'The complete linked service retains its original dates because one occurrence needs a scheduling decision.', {relatedOccurrenceId: failed.id}));
      }
    }
  }
  let resolution = null;
  if (allocationMethod === 'RESOLVE_CONFLICTS') {
    // Revisit a complete set of linked services sharing potential capacity.
    // Unplaceable/unknown work stays reserved, and a partial search is never
    // applied. The original first-fit pass is retained for every unsolved set.
    const candidates = groupOrder.filter(group => {
      const movable = group.filter(job => !job.fixedReason);
      return movable.length && movable.every(job => job.domains.length) &&
        group.filter(job => job.fixedReason).every(job => !job.issues.length);
    });
    const componentParents = candidates.map((_, index) => index);
    function componentRoot(index) {
      let at = index;
      while (componentParents[at] !== at) at = componentParents[at];
      while (componentParents[index] !== index) {
        const previous = componentParents[index]; componentParents[index] = at; index = previous;
      }
      return at;
    }
    const resourceOwner = new Map();
    for (let index = 0; index < candidates.length; index++) {
      for (const job of candidates[index].filter(row => !row.fixedReason && row.effort > 0n)) {
        for (const date of new Set([job.date, ...job.domains])) {
          const key = capacityKey(job.schedule.capacityPoolId, date);
          if (resourceOwner.has(key)) componentParents[componentRoot(index)] = componentRoot(resourceOwner.get(key));
          else resourceOwner.set(key, index);
        }
      }
    }
    const components = new Map();
    for (let index = 0; index < candidates.length; index++) {
      const key = componentRoot(index);
      if (!components.has(key)) components.set(key, []);
      components.get(key).push(candidates[index]);
    }
    resolution = {method: 'RESOLVE_CONFLICTS', maxSearchSteps, visitedSteps: 0,
      reconsideredGroups: 0, resolvedGroups: 0, revisedDates: 0, components: []};
    function needsResolution(job) {
      if (job.issues.length) return true;
      if (job.effort > 0n && job.schedule.capacityPoolId) {
        const bucket = capacity.get(capacityKey(job.schedule.capacityPoolId, job.date));
        if (bucket.available === null || bucket.unknown || bucket.used > bucket.available) return true;
      }
      return job.predecessors.some(link => {
        const previous = byId.get(link.before);
        return !compatible(previous, previous.date, job, job.date, link);
      });
    }
    for (const component of components.values()) {
      const members = component.flat(), movable = members.filter(job => !job.fixedReason);
      if (!movable.some(needsResolution)) continue;
      const originalDates = new Map(movable.map(job => [job.id, job.date]));
      const result = {groupIds: component.map(group => group[0].id),
        occurrenceIds: movable.map(job => job.id), status: 'RETAINED', visitedSteps: 0, revisedDates: []};
      resolution.reconsideredGroups += component.length;
      resolution.components.push(result);
      if (resolution.visitedSteps >= maxSearchSteps) { result.status = 'SEARCH_LIMIT'; continue; }

      // Fixed members remain in capacity. Every movable member is released
      // together; each search prefix owns only the dates it has selected.
      for (const job of movable) reserve(job, job.date, -1);
      const dates = movable.map(job => [...job.domains].sort((a, b) =>
        constraints.strategy === 'EARLIEST' ? a.localeCompare(b) :
          Math.abs(distance(a, job.sourceDate)) - Math.abs(distance(b, job.sourceDate)) || a.localeCompare(b)));
      const next = movable.map(() => 0), chosen = movable.map(() => null), placed = new Map();
      let position = 0, limited = false;
      while (position >= 0 && position < movable.length) {
        const job = movable[position];
        let found = false;
        while (next[position] < dates[position].length && resolution.visitedSteps < maxSearchSteps) {
          const date = dates[position][next[position]++];
          resolution.visitedSteps++; result.visitedSteps++;
          if (capacityIssues(job, date).length) continue;
          if (job.predecessors.some(link => {
            const previous = byId.get(link.before);
            return !previous.fixedReason && !placed.has(previous.id) ||
              !compatible(previous, placed.get(previous.id) || previous.date, job, date, link);
          })) continue;
          if (job.successors.some(link => {
            const following = byId.get(link.after);
            const possible = following.fixedReason ? [following.date] :
              placed.has(following.id) ? [placed.get(following.id)] : following.domains;
            return !possible.some(followingDate => compatible(job, date, following, followingDate, link));
          })) continue;
          chosen[position] = date; job.date = date; placed.set(job.id, date); reserve(job, date, 1);
          position++;
          if (position < movable.length) { next[position] = 0; chosen[position] = null; }
          found = true; break;
        }
        if (found) continue;
        if (resolution.visitedSteps >= maxSearchSteps) { limited = true; break; }
        next[position] = 0;
        position--;
        if (position >= 0) {
          const previous = movable[position];
          reserve(previous, chosen[position], -1); chosen[position] = null;
          previous.date = originalDates.get(previous.id); placed.delete(previous.id);
        }
      }
      if (position === movable.length) {
        result.status = 'RESOLVED'; resolution.resolvedGroups += component.length;
        for (const job of movable) {
          const previousDate = originalDates.get(job.id);
          if (job.date !== previousDate) result.revisedDates.push({occurrenceId: job.id, before: previousDate, after: job.date});
          job.issues = job.issues.filter(row => !['NO_AVAILABLE_PLACEMENT', 'LINKED_SERVICE_UNRESOLVED'].includes(row.code));
        }
        resolution.revisedDates += result.revisedDates.length;
        // Explain alternatives against the complete accepted placement. A
        // selected occurrence's own reservation is excluded from this view.
        for (const job of movable) {
          reserve(job, job.date, -1);
          job.rejected = before.days.flatMap(day => {
            const date = day.date, reasons = dateIssues(job, date);
            if (!reasons.length) reasons.push(...capacityIssues(job, date));
            for (const link of job.predecessors) {
              const previous = byId.get(link.before);
              if (!compatible(previous, previous.date, job, date, link))
                reasons.push(issue('ORIGINAL_SEQUENCE', 'Retain the original prepaid order and entered spacing.',
                  {relatedOccurrenceId: previous.id, relatedDate: previous.date, minimumGapDays: link.gapDays}));
            }
            for (const link of job.successors) {
              const following = byId.get(link.after);
              if (!compatible(job, date, following, following.date, link))
                reasons.push(issue('FOLLOWING_SERVICE_WINDOW', 'Retain the following occurrence in the accepted complete allocation.',
                  {relatedOccurrenceId: following.id, relatedDate: following.date, minimumGapDays: link.gapDays}));
            }
            return reasons.length ? [{date, reasons}] : [];
          });
          reserve(job, job.date, 1);
        }
      } else {
        // Only a complete component can replace the first-fit allocation.
        for (const job of movable) if (placed.has(job.id)) reserve(job, placed.get(job.id), -1);
        for (const job of movable) { job.date = originalDates.get(job.id); reserve(job, job.date, 1); }
        result.status = limited ? 'SEARCH_LIMIT' : 'NO_COMPLETE_PLACEMENT';
      }
    }
  }
  const candidate = copy(input);
  candidate.deliveryScheduling = copy(constraints);
  if (options.name !== undefined) candidate.name = options.name;
  const jobsBySchedule = new Map(input.schedules.map(row => [row.id, []]));
  for (const job of jobs) jobsBySchedule.get(job.schedule.id).push(job);
  for (const schedule of candidate.schedules) {
    const selected = jobsBySchedule.get(schedule.id);
    const allocations = selected.filter(job => job.date !== job.sourceDate).map(job => ({sourceDate: job.sourceDate, date: job.date})).sort((a, b) => a.sourceDate.localeCompare(b.sourceDate));
    if (allocations.length || Object.hasOwn(schedule, 'dateAllocations')) schedule.dateAllocations = allocations;
  }
  const report = evaluateCohortPlan(candidate);
  const finalDays = new Map(report.capacity.pools.flatMap(pool => pool.days.map(day => [capacityKey(pool.id, day.date), day])));
  for (const job of jobs) {
    if (!job.occurrence.scheduledTasks || job.fixedReason === 'PAST_CUTOFF') continue;
    if (job.effort === null && !job.issues.some(row => row.code === 'EFFORT_REQUIRED'))
      job.issues.push(issue('EFFORT_REQUIRED', 'Enter active effort for the complete useful task.'));
    else if (job.effort > 0n && !job.schedule.capacityPoolId && !job.issues.some(row => row.code === 'DELIVERY_POOL_REQUIRED'))
      job.issues.push(issue('DELIVERY_POOL_REQUIRED', 'Assign the original work to an entered delivery pool.'));
    const day = finalDays.get(capacityKey(job.schedule.capacityPoolId, job.date));
    if (day?.status === 'OVERALLOCATED') job.issues.push(issue('RETAINED_CAPACITY_SHORTFALL', 'The retained date still needs additional active hours.',
      {poolId: day.poolId, date: day.date, requiredHours: day.requiredHours, availableHours: day.availableHours, additionalHours: day.additionalHoursKnownMinimum}));
    else if (job.effort !== 0n && day?.status === 'INCOMPLETE') job.issues.push(issue('RETAINED_CAPACITY_INCOMPLETE', 'Complete the capacity or task effort for this retained date.',
      {poolId: day.poolId, date: day.date, requiredHours: day.requiredHours, availableHours: day.availableHours}));
    for (const link of job.predecessors) {
      const previous = byId.get(link.before);
      if (!compatible(previous, previous.date, job, job.date, link))
        job.issues.push(issue('RETAINED_SERVICE_SPACING', 'The original dates need the entered minimum spacing.', {relatedOccurrenceId: previous.id, minimumGapDays: link.gapDays}));
    }
  }
  const conserved = ['scheduledTasks', 'scheduledRequests', 'plannedPaymentRequests', 'plannedPaidPurchases', 'allowanceUnits'];
  for (const key of conserved) if (before.summary[key] !== report.summary[key])
    fail('SCHEDULING_SCOPE_CHANGED', 'Scheduling must retain the original ' + key + '.', key);
  if (canonical(input.fundingGroups) !== canonical(report.input.fundingGroups) || canonical(before.currencies) !== canonical(report.currencies))
    fail('SCHEDULING_COMMERCIAL_CHANGED', 'Scheduling must preserve the complete funding groups and original service economics.');
  const assignments = jobs.map(job => ({
    occurrenceId: job.id, scheduleId: job.schedule.id, label: job.schedule.label || job.schedule.id,
    sourceDate: job.sourceDate, originalDate: job.originalDate, date: job.date,
    scheduledAt: stamp(job, job.date), plannedCompleteAt: finish(job, job.date),
    scheduledTasks: job.occurrence.scheduledTasks, scheduledRequests: job.occurrence.scheduledRequests,
    requiredHours: job.effort === null ? null : hoursText(job.effort), capacityPoolId: job.schedule.capacityPoolId,
    fundingGroupIds: copy(job.schedule.fundingGroupIds), priority: job.policy.priority,
    status: job.issues.length ? 'UNRESOLVED' : job.fixedReason ? 'FIXED' : 'PLACED',
    fixedReason: job.fixedReason, moved: job.date !== job.originalDate,
    permittedDates: copy(job.domains), rejectedDates: copy(job.rejected), issues: copy(job.issues)
  }));
  const unresolved = assignments.filter(row => row.status === 'UNRESOLVED');
  return {schema: COHORT_DELIVERY_SCHEDULE_SCHEMA, sourceDocument: copy(document), constraints,
    candidate: report.input, report,
    ...(resolution ? {resolution} : {}),
    method: resolution ? 'Deterministic conflict resolution over complete linked service groups sharing possible capacity dates. Fixed, past, unknown and unplaceable work remain reserved. Priority, service order and date preference order each search; only a complete component placement replaces its first-fit allocation. Components without an accepted complete placement retain their full previous dates and constraints. Reassigned-date explanations use the complete accepted placement.' : 'Deterministic first-fit allocation, ordered by descending service priority, earliest end of a permitted occurrence window and original occurrence order. Linked prepaid/spacing sequences are placed together. Fixed and unresolved work retain their original capacity reservations. Unresolved rows retain the remaining constraints under this allocation order; priorities and date preferences remain editable.',
    summary: {status: unresolved.length ? 'UNRESOLVED' : 'COMPLETE', occurrences: assignments.length,
      moved: assignments.filter(row => row.moved).length, fixed: assignments.filter(row => row.fixedReason).length,
      unresolved: unresolved.length, capacityBefore: before.capacity.status, capacityAfter: report.capacity.status,
      scheduledTasks: report.summary.scheduledTasks, scheduledRequests: report.summary.scheduledRequests,
      plannedPaymentRequests: report.summary.plannedPaymentRequests, fundingGroups: report.fundingGroups.length},
    assignments};
}
export function reopenCohortDeliverySchedule(document) {
  if (document?.schema !== COHORT_DELIVERY_SCHEDULE_SCHEMA)
    fail('SCHEDULING_REPORT_REQUIRED', 'Open the complete delivery scheduling result.');
  const recomputed = scheduleCohortDelivery(document.sourceDocument, document.constraints, {name: document.candidate?.name,
    ...(document.resolution ? {method: document.resolution.method, maxSearchSteps: document.resolution.maxSearchSteps} : {})});
  if (canonical(document) !== canonical(recomputed))
    fail('SCHEDULING_REPORT_CHANGED', 'The saved schedule differs from its complete original input and constraints.');
  return copy(document);
}
function csv(value) {
  let text = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (/^\s*[=+@]/.test(text) || /^[\t\r\n]/.test(text) || /^\s*-/.test(text) && !/^-\d+(?:\.\d+)?$/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}
export function exportCohortDeliveryScheduleCsv(document) {
  const report = reopenCohortDeliverySchedule(document);
  const keys = ['occurrenceId','scheduleId','label','sourceDate','originalDate','date','scheduledAt','plannedCompleteAt',
    'scheduledTasks','scheduledRequests','requiredHours','capacityPoolId','fundingGroupIds','priority','status','fixedReason','moved','permittedDates','rejectedDates','issues'];
  if (report.resolution) {
    const components = new Map(report.resolution.components.flatMap(row => row.occurrenceIds.map(id => [id, row])));
    const extra = ['allocationMethod', 'maxSearchSteps', 'componentStatus', 'componentVisitedSteps', 'previousAllocationDate'];
    return [[...keys, ...extra].map(csv).join(','), ...report.assignments.map(row => {
      const component = components.get(row.occurrenceId);
      const before = component?.revisedDates.find(change => change.occurrenceId === row.occurrenceId)?.before ?? row.date;
      return [...keys.map(key => csv(row[key])), ...[
        report.resolution.method, report.resolution.maxSearchSteps, component?.status ?? '',
        component?.visitedSteps ?? null, before
      ].map(csv)].join(',');
    })].join('\r\n') + '\r\n';
  }
  return [keys.map(csv).join(','), ...report.assignments.map(row => keys.map(key => csv(row[key])).join(','))].join('\r\n') + '\r\n';
}
