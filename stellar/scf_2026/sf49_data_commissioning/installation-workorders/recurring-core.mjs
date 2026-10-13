/** Complete proposed customer calendars and native SF47 installation composition. */
const copy = value => JSON.parse(JSON.stringify(value));
const check = (ok, message) => { if (!ok) throw new Error(message); };
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const ordered = value => Array.isArray(value) ? value.map(ordered) : record(value) ?
  Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
const same = (a, b) => JSON.stringify(ordered(a)) === JSON.stringify(ordered(b));
const DAY = 86400000;
function day(value) {
  check(typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value), "Use an explicit YYYY-MM-DD UTC date.");
  const instant = Date.parse(value + "T00:00:00.000Z");
  check(Number.isFinite(instant) && new Date(instant).toISOString().slice(0, 10) === value, "Use a real UTC calendar date.");
  return instant;
}
function time(value) {
  check(typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value), "Use an explicit HH:MM UTC review time.");
  return value;
}
function instant(date, clock) { return new Date(day(date) + (+clock.slice(0, 2) * 60 + +clock.slice(3)) * 60000).toISOString(); }
const dateOf = value => new Date(value).toISOString().slice(0, 10);
export function prepareCalendar(input) {
  check(record(input) && input.schema === "tjlabs.scf-purchase-calendar-input.v1", "Use the complete calendar input.");
  const first = day(input.startDate);
  check(Number.isSafeInteger(input.days) && input.days > 0 && input.days <= 366, "Use 1–366 explicit calendar days.");
  check(Array.isArray(input.weekdays) && input.weekdays.length && input.weekdays.every(n => Number.isInteger(n) && n >= 0 && n <= 6), "Select UTC weekdays 0–6.");
  const working = new Set(input.weekdays);
  const excluded = new Set((input.blackoutDates ?? []).map(value => dateOf(day(value))));
  check(Array.isArray(input.participants) && input.participants.length > 0, "Select the full merchant/buyer participant list.");
  const profiles = new Set();
  const participants = input.participants.map(item => {
    check(record(item) && typeof item.profile === "string" && /^[a-z][a-z0-9-]+$/.test(item.profile), "Select a profile identity.");
    check(!profiles.has(item.profile), "Keep one selected calendar participant per installation profile.");
    profiles.add(item.profile);
    for (const key of ["merchantRole", "buyerRole"]) check(typeof item[key] === "string" && item[key].trim(), "Name the proposed " + key + ".");
    check(["SNAPSHOT", "CLOSED_WINDOW"].includes(item.kind), "Select SNAPSHOT or CLOSED_WINDOW.");
    check(Array.isArray(item.sessionsUtc) && item.sessionsUtc.length > 0, "Select the actual useful daily review times.");
    const sessions = item.sessionsUtc.map(time);
    check(new Set(sessions).size === sessions.length, "Keep each distinct review time once.");
    return {...copy(item), sessionsUtc: sessions.sort()};
  });
  const eligible = value => working.has(new Date(value).getUTCDay()) && !excluded.has(dateOf(value));
  const rows = [];
  for (let offset = 0; offset < input.days; offset++) {
    const now = first + offset * DAY;
    if (!eligible(now)) continue;
    const date = dateOf(now);
    for (const item of participants) for (let index = 0; index < item.sessionsUtc.length; index++) {
      const scheduledAt = instant(date, item.sessionsUtc[index]);
      let windowStart = null;
      if (item.kind === "CLOSED_WINDOW") {
        if (index > 0) windowStart = instant(date, item.sessionsUtc[index - 1]);
        else {
          let previous = now - DAY;
          // A finite source start is required even when the explicit calendar has a long closure.
          let traversed = 0;
          while (!eligible(previous)) { previous -= DAY; check(++traversed <= 3660, "Select a preceding working date within ten years."); }
          windowStart = instant(dateOf(previous), item.sessionsUtc.at(-1));
        }
      }
      rows.push({
        id: item.profile + ":" + scheduledAt, profile: item.profile,
        merchantRole: item.merchantRole, buyerRole: item.buyerRole, date, scheduledAt,
        kind: item.kind, sourceStartInclusive: windowStart, sourceEndExclusive: item.kind === "CLOSED_WINDOW" ? scheduledAt : null,
        requestedSnapshotAt: item.kind === "SNAPSHOT" ? scheduledAt : null,
        sourceHours: windowStart === null ? null : (Date.parse(scheduledAt) - Date.parse(windowStart)) / 3600000,
        status: "PROPOSED", usefulTaskCount: 1
      });
    }
  }
  rows.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt) || a.profile.localeCompare(b.profile));
  const byProfile = participants.map(item => ({
    profile: item.profile, merchantRole: item.merchantRole, buyerRole: item.buyerRole,
    scheduledUsefulTasks: rows.filter(row => row.profile === item.profile).length,
    distinctDays: new Set(rows.filter(row => row.profile === item.profile).map(row => row.date)).size
  }));
  const windows = [7, 14].filter(length => length <= input.days).map(length => {
    const counts = [];
    for (let offset = 0; offset + length <= input.days; offset++) {
      const start = first + offset * DAY, end = start + length * DAY;
      const selected = rows.filter(row => Date.parse(row.scheduledAt) >= start && Date.parse(row.scheduledAt) < end);
      counts.push({startDate: dateOf(start), endDateInclusive: dateOf(end - DAY), scheduledUsefulTasks: selected.length});
    }
    return {days: length, minimumScheduledUsefulTasks: Math.min(...counts.map(row => row.scheduledUsefulTasks)), maximumScheduledUsefulTasks: Math.max(...counts.map(row => row.scheduledUsefulTasks)), windows: counts};
  });
  return {
    schema: "tjlabs.scf-purchase-calendar.v1", status: "PROPOSED", inputs: copy(input),
    startDate: input.startDate, endDateInclusive: dateOf(first + (input.days - 1) * DAY),
    summary: {scheduledUsefulTasks: rows.length, distinctDays: new Set(rows.map(row => row.date)).size, byProfile, windows},
    rows,
    countingBasis: "Scheduled useful customer tasks. Native SF88/SCF cohort records determine actual qualifying purchases and full-output completion.",
    commercialChoice: "Per-task or per-route collection and prepaid allowance are selected in original merchant terms; one prepaid pass retains one settlement."
  };
}
function atomic(value, label) {
  check(typeof value === "string" && /^(0|[1-9][0-9]{0,29})$/.test(value), label + " must be a whole atomic string.");
  return BigInt(value);
}
export function reviewTaskBudget(input) {
  check(record(input) && Array.isArray(input.lines) && input.lines.length, "Select all priced routes for the complete task.");
  for (const key of ["network", "asset", "recipient"]) check(typeof input[key] === "string" && input[key].trim(), "Select the actual payment " + key + ".");
  const maximum = atomic(input.maximumAtomic, "Task maximum");
  const seen = new Set();
  let total = 0n;
  const lines = input.lines.map(line => {
    check(record(line) && typeof line.operation === "string" && line.operation.trim() && !seen.has(line.operation), "Keep each priced operation once with its full quantity.");
    seen.add(line.operation);
    check(Number.isSafeInteger(line.quantity) && line.quantity >= 0 && line.quantity <= 1e12, "Use the complete whole request/page quantity.");
    const value = atomic(line.priceAtomic, "Route price") * BigInt(line.quantity);
    total += value;
    return {...copy(line), totalAtomic: String(value)};
  });
  return {network: input.network, asset: input.asset, recipient: input.recipient,
    maximumAtomic: String(maximum), selectedTotalAtomic: String(total),
    headroomAtomic: String(maximum - total), withinBudget: total <= maximum, lines,
    feeTreatment: input.feeTreatment ?? "Record the selected original network/facilitator fee treatment separately."};
}
export function composeInstallation({seed, profile, bindings, calendarInput, nativePrepare, nativeRender, taskBudget}) {
  check(typeof nativePrepare === "function" && typeof nativeRender === "function", "Supply the maintained SF47 preparation and renderer.");
  const prepared = nativePrepare(copy(seed), copy(profile), copy(bindings));
  const preserved = ["workorder", "assignments", "checks", "workshare", "workflowPeriods", "coordination"];
  for (const key of preserved) check(same(prepared.document[key], seed.document[key]), "Native " + key + " changed during composition.");
  const calendar = prepareCalendar(calendarInput);
  check(calendar.inputs.participants.some(item => item.profile === profile.id), "Include this installation in its proposed calendar.");
  const budget = taskBudget === undefined ? null : reviewTaskBudget(taskBudget);
  if (budget) {
    check(budget.withinBudget, "The full selected paid task exceeds its approved native amount.");
    for (const key of ["network", "asset", "recipient"]) check(budget[key] === prepared.document.payment[key], "Task budget " + key + " differs from the original native selection.");
    check(budget.maximumAtomic === prepared.document.payment.taskBudgetAtomic, "Task maximum differs from the original Installation budget.");
  }
  return {
    schema: "tjlabs.scf-installation-composition.v1", status: "PROPOSED",
    profile: profile.id, source: copy(prepared.source),
    originalWorkshareCaseId: prepared.workshareCaseId,
    document: prepared.document, preview: prepared.preview,
    calendar, taskBudget: budget, sourceSelections: prepared.selections,
    receivingMarkdown: nativeRender(prepared),
    originalNativePreparation: prepared
  };
}
export function calendarCsv(calendar) {
  const columns = ["id", "profile", "merchantRole", "buyerRole", "date", "scheduledAt", "kind", "sourceStartInclusive", "sourceEndExclusive", "requestedSnapshotAt", "sourceHours", "status"];
  const cell = value => '"' + String(value ?? "").replace(/"/g, '""') + '"';
  return [columns, ...calendar.rows.map(row => columns.map(key => row[key]))].map(row => row.map(cell).join(",")).join("\r\n") + "\r\n";
}
