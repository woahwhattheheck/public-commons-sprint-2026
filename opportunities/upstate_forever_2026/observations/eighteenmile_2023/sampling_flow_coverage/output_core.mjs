export function buildOutputFiles(result, figure) {
  const json = value => JSON.stringify(value, null, 2) + "\n";
  const csv = rows => {
    const columns = [...new Set(rows.flatMap(row => Object.keys(row)))];
    const cell = value => {
      const text = value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
      return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
    };
    return columns.map(cell).join(",") + "\n" +
      rows.map(row => columns.map(key => cell(row[key])).join(",")).join("\n") + "\n";
  };
  const outputs = {"derived/results.json": json(result), "figure-spec.json":json(figure.spec),
    "flow_volume_and_sampling.svg": figure.svg};
  for (const name of ["duration", "sampling", "ranked", "spells", "activities", "daily"])
    outputs["derived/" + name + ".csv"] = csv(result[name]);
  outputs["derived/summary.json"] = json({schema:result.schema, gauge_id:result.gauge_id,
    method:result.method, annual:result.annual,
    row_counts:Object.fromEntries(["duration","sampling","ranked","spells","activities","daily"].map(k=>[k,result[k].length])),
    study_window:result.duration.filter(r=>r.scope==="lake_study_2023"),
    sampling:result.sampling});
  return outputs;
}
