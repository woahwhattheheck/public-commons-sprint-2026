/** Read original USGS reporting dates without changing their timezone or units. */
export function originalDailyFlow(response, source) {
  if (!source || typeof source.id !== "string" || typeof source.site !== "string") {
    throw new Error("Original gauge source identity is required");
  }
  const series = response?.value?.timeSeries;
  if (!Array.isArray(series)) throw new Error("Expected the original USGS WaterML response");
  const selected = series.filter(item =>
    item.sourceInfo?.siteCode?.some(code => code.value === source.site) &&
    item.variable?.variableCode?.some(code => code.value === "00060") &&
    item.variable?.options?.option?.some(option => option.optionCode === "00003"));
  if (selected.length !== 1) throw new Error("Select exactly one original daily-mean discharge series");
  const item = selected[0];
  if (item.variable.unit?.unitCode !== "ft3/s") throw new Error("The original flow unit must remain ft3/s");
  if (!Array.isArray(item.values)) throw new Error("Original USGS value groups are missing");
  const records = [], dates = new Set();
  item.values.forEach((group, valuesIndex) => {
    if (!Array.isArray(group.value)) throw new Error("Original USGS value records are missing");
    group.value.forEach((record, recordIndex) => {
      if (typeof record.dateTime !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(record.dateTime)) {
        throw new Error("Original flow must retain its reporting date");
      }
      const date = record.dateTime.slice(0, 10);
      if (dates.has(date)) throw new Error("Duplicate original gauge reporting date: " + date);
      dates.add(date);
      if (typeof record.value !== "string" || !Array.isArray(record.qualifiers)) {
        throw new Error("Original flow values and qualifiers must retain their source fields");
      }
      const numeric = record.value.trim() === "" ? null : Number(record.value);
      if (numeric !== null && !Number.isFinite(numeric)) throw new Error("Invalid original daily discharge");
      records.push({
        site: source.site, date,
        reported_mean_cfs: numeric === null || numeric === item.variable.noDataValue ? "" : record.value,
        qualifiers: record.qualifiers.join(";"), source_id: source.id,
        source_values_index: String(valuesIndex), source_record_index: String(recordIndex),
      });
    });
  });
  return records;
}
