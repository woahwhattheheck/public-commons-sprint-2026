/**
 * Evaluates the published Lake Keowee parcel criteria from typed observations.
 * Geometry preparation belongs to the existing native data/import pipeline.
 * Source ranges remain literal; ambiguity is returned with its source reference.
 */
const UNKNOWN = Symbol("unknown");
const unique = (values) => [...new Set(values)].sort((a, b) => a - b);

function possibleFor(rule) {
  if (rule.type === "numeric_bins") return unique(rule.bins.map((b) => b.points));
  if (rule.type === "variants") return unique(Object.values(rule.variants).flatMap(possibleFor));
  if (rule.type === "array_max") return unique([0, ...Object.values(rule.points_by_value)]);
  if (rule.type === "stream_class_max") return [0, 1, 2, 3, 4];
  if (rule.type === "floodplain_protection") return [0, 1, 2];
  if (rule.type === "waterway_adjacency") return [0, 2, 4];
  return unique([rule.false_points ?? 0, rule.true_points]);
}

function contextFor(profile, input) {
  const fields = new Map(profile.fields.map((field) => [field.id, field]));
  const issues = [];
  const readKeys = new Set();
  function read(key, optional = false) {
    readKeys.add(key);
    const observation = input.observations?.[key];
    const spec = fields.get(key);
    if (!spec) throw new Error("Unknown profile field: " + key);
    const issue = (code, detail) => {
      issues.push({ field: key, code, detail });
      return UNKNOWN;
    };
    if (!observation || typeof observation !== "object" || !Object.hasOwn(observation, "value") || observation.value === null) {
      return optional ? UNKNOWN : issue("missing_observation", "No observed value supplied.");
    }
    const value = observation.value;
    let valid = false;
    if (spec.type === "boolean") valid = typeof value === "boolean";
    if (spec.type === "number") valid = typeof value === "number" && Number.isFinite(value);
    if (spec.type === "integer") valid = Number.isInteger(value);
    if (spec.type === "string") valid = typeof value === "string";
    if (spec.type === "integer[]") valid = Array.isArray(value) && value.every(Number.isInteger);
    if (spec.type === "string[]") valid = Array.isArray(value) && value.every((v) => typeof v === "string");
    if (!valid) return issue("type_mismatch", "Expected " + spec.type + ".");
    if (spec.unit && observation.unit !== spec.unit) {
      return issue("unit_mismatch", "Expected " + spec.unit + "; observed " + String(observation.unit) + ".");
    }
    if (typeof value === "number" && ((spec.minimum != null && value < spec.minimum) || (spec.maximum != null && value > spec.maximum))) {
      return issue("outside_field_domain", "Observed value is outside the field's declared domain.");
    }
    if (spec.enum) {
      const values = Array.isArray(value) ? value : [value];
      if (values.some((v) => !spec.enum.includes(v))) return issue("unknown_class", "A value is outside the declared class set.");
    }
    return value;
  }
  function readInterval(key) {
    readKeys.add(key);
    const observation = input.observations?.[key];
    const interval = observation?.interval;
    if (interval == null) return UNKNOWN;
    const spec = fields.get(key);
    if (!spec) throw new Error("Unknown profile field: " + key);
    const invalid = (detail) => {
      issues.push({ field: key, code: "invalid_numeric_interval", detail });
      return UNKNOWN;
    };
    if (spec.type !== "number" || typeof interval !== "object" || Array.isArray(interval)) {
      return invalid("A numeric source interval requires a declared numeric field.");
    }
    const {lower, upper} = interval;
    if (typeof lower !== "number" || typeof upper !== "number" ||
        !Number.isFinite(lower) || !Number.isFinite(upper) || lower > upper ||
        interval.closed !== true) {
      return invalid("Supply finite ordered lower/upper values with both endpoints closed.");
    }
    if (spec.unit && (observation.unit !== spec.unit || interval.unit !== spec.unit)) {
      return invalid("The observation and interval must retain the declared unit " + spec.unit + ".");
    }
    if ((spec.minimum != null && lower < spec.minimum) ||
        (spec.maximum != null && upper > spec.maximum)) {
      return invalid("The complete interval must remain inside the declared field domain.");
    }
    if (typeof interval.method !== "string" || !interval.method.trim() ||
        typeof interval.reference !== "string" || !interval.reference.trim()) {
      return invalid("Retain the interval's source method and reference.");
    }
    return interval;
  }
  return { input, read, readInterval, issues, readKeys };
}


function classifyNumericInterval(rule, interval, ctx, detail) {
  // Boundaries and each intervening region exhaust the literal bin changes.
  // These evaluation points stay internal; observations retain their interval.
  const boundaries = new Set([interval.lower, interval.upper]);
  for (const bin of rule.bins) for (const value of [bin.min, bin.max]) {
    if (value !== null && interval.lower <= value && value <= interval.upper) boundaries.add(value);
  }
  const ordered = [...boundaries].sort((a, b) => a - b);
  const probes = [...ordered];
  for (let i = 1; i < ordered.length; i++) {
    const left = ordered[i - 1], right = ordered[i];
    const middle = left / 2 + right / 2;
    if (left < middle && middle < right) probes.push(middle);
  }
  const options = [], labels = [], possibleLabels = [], states = new Set();
  for (const value of probes) {
    const matching = rule.bins.filter((bin) =>
      (bin.min === null || (bin.min_inclusive ? value >= bin.min : value > bin.min)) &&
      (bin.max === null || (bin.max_inclusive ? value <= bin.max : value < bin.max))
    );
    states.add(matching.length > 1 ? "ambiguous" : matching.length ? "scored" : "unclassified");
    labels.push(...matching.map((bin) => bin.label));
    const possible = matching.length ? matching : rule.bins;
    possibleLabels.push(...possible.map((bin) => bin.label));
    options.push(...possible.map((bin) => bin.points));
  }
  const values = unique(options);
  const retainedInterval = JSON.parse(JSON.stringify(interval));
  detail.classification = {
    mode: "literal_published_bins_over_closed_interval", state: "bounded_interval",
    labels: [...new Set(labels)], matched_classes: [...new Set(labels)],
    classes: [...new Set(possibleLabels)], score_options: values,
    attainable_states: [...states].sort(), value_interval: retainedInterval
  };
  detail.value_interval = retainedInterval;
  detail.points_determined_by_interval = values.length === 1;
  if (states.has("unclassified")) ctx.issues.push({
    field: rule.field, code: "interval_crosses_unclassified_source_values",
    detail: "The closed interval includes a printed gap or values outside the original bins; original alternatives are retained."
  });
  if (states.has("ambiguous")) ctx.issues.push({
    field: rule.field, code: "interval_crosses_overlapping_source_bins",
    detail: "The closed interval includes overlapping published bins; every matching class is retained."
  });
  return values;
}

function evaluateRule(rule, ctx, detail) {
  const read = ctx.read;
  const uncertain = () => possibleFor(rule);
  if (rule.type === "boolean") {
    const value = read(rule.field);
    return value === UNKNOWN ? uncertain() : [value ? rule.true_points : rule.false_points];
  }
  if (rule.type === "any_boolean") {
    const values = rule.fields.map((field) => read(field));
    if (values.includes(true)) return [rule.true_points];
    return values.includes(UNKNOWN) ? uncertain() : [rule.false_points];
  }
  if (rule.type === "array_any") {
    const values = read(rule.field);
    return values === UNKNOWN ? uncertain() : [values.some((value) => rule.values.includes(value)) ? rule.true_points : rule.false_points];
  }
  if (rule.type === "array_max") {
    const values = read(rule.field);
    return values === UNKNOWN ? uncertain() : [Math.max(0, ...values.map((value) => rule.points_by_value[value]))];
  }
  if (rule.type === "numeric_bins") {
    if (rule.original_class_field) {
      const originalClass = read(rule.original_class_field, true);
      if (originalClass !== UNKNOWN) {
        const matching = rule.bins.filter((bin) => bin.label === originalClass);
        if (matching.length) {
          detail.classification = { mode: "retained_original_class", labels: [originalClass] };
          return unique(matching.map((bin) => bin.points));
        }
      }
    }
    const observation = ctx.input.observations?.[rule.field];
    const hasInterval = observation?.interval != null;
    const interval = hasInterval ? ctx.readInterval(rule.field) : UNKNOWN;
    const value = read(rule.field, hasInterval);
    if (hasInterval && interval === UNKNOWN) return uncertain();
    if (value !== UNKNOWN && interval !== UNKNOWN &&
        (value < interval.lower || value > interval.upper)) {
      ctx.issues.push({ field: rule.field, code: "value_outside_numeric_interval",
        detail: "The exact observed value is outside its retained source interval." });
      return uncertain();
    }
    if (value === UNKNOWN) {
      if (interval !== UNKNOWN && (observation.value === null || observation.value === undefined)) {
        return classifyNumericInterval(rule, interval, ctx, detail);
      }
      return uncertain();
    }
    const matching = rule.bins.filter((bin) =>
      (bin.min === null || (bin.min_inclusive ? value >= bin.min : value > bin.min)) &&
      (bin.max === null || (bin.max_inclusive ? value <= bin.max : value < bin.max))
    );
    detail.classification = { mode: "literal_published_bins", labels: matching.map((bin) => bin.label) };
    if (!matching.length) {
      ctx.issues.push({ field: rule.field, code: "outside_published_bins", detail: "Value falls in a printed gap or outside the original range." });
      return uncertain();
    }
    if (matching.length > 1) {
      ctx.issues.push({ field: rule.field, code: "overlapping_published_bins", detail: "The source ranges assign more than one class." });
    }
    return unique(matching.map((bin) => bin.points));
  }
  if (rule.type === "variants") {
    const choice = ctx.input.choices?.[rule.choice_key];
    if (choice != null) {
      if (!Object.hasOwn(rule.variants, choice)) throw new Error("Unknown source interpretation: " + String(choice));
      detail.source_interpretation = choice;
      return evaluateRule(rule.variants[choice], ctx, detail);
    }
    const results = Object.entries(rule.variants).map(([name, variant]) => {
      const variantDetail = {};
      return { name, possible_points: evaluateRule(variant, ctx, variantDetail), ...variantDetail };
    });
    detail.source_variants = results;
    const values = unique(results.flatMap((result) => result.possible_points));
    if (values.length > 1) ctx.issues.push({ code: "source_interpretation_differs", detail: "The published source variants produce different scores." });
    return values;
  }
  if (rule.type === "stream_class_max") {
    const classes = read("stream_classes");
    if (classes === UNKNOWN) return uncertain();
    if (classes.includes("ORW") || classes.includes("TN")) return [4];
    if (classes.includes("TGPT")) return [3];
    if (!classes.includes("FW")) return [0];
    const impaired = read("fw_stream_has_impairment");
    return impaired === UNKNOWN ? [1, 2] : [impaired ? 1 : 2];
  }
  if (rule.type === "floodplain_protection") {
    const floodplain = read("floodplain_intersects");
    if (floodplain === false) return [0];
    const developed = read("developed_land_present");
    const whenInside = developed === UNKNOWN ? [1, 2] : [developed ? 1 : 2];
    return floodplain === UNKNOWN ? unique([0, ...whenInside]) : whenInside;
  }
  if (rule.type === "waterway_adjacency") {
    const drinking = read("adjacent_drinking_water_reservoir_or_intake");
    if (drinking === true) return [4];
    const other = read("adjacent_other_waterway");
    const whenOther = other === UNKNOWN ? [0, 2] : [other ? 2 : 0];
    return drinking === UNKNOWN ? unique([...whenOther, 4]) : whenOther;
  }
  if (rule.type === "compare_fields") {
    const left = read(rule.left);
    const right = read(rule.right);
    if (left === UNKNOWN || right === UNKNOWN) return uncertain();
    if (rule.operator !== ">") throw new Error("Unsupported comparison: " + rule.operator);
    return [left > right ? rule.true_points : rule.false_points];
  }
  throw new Error("Unsupported criterion rule: " + rule.type);
}

export function evaluateCriterion(profile, criterionId, input) {
  const criterion = profile.criteria.find((item) => item.id === criterionId);
  if (!criterion) throw new Error("Unknown criterion: " + criterionId);
  const ctx = contextFor(profile, input);
  const detail = {};
  const values = unique(evaluateRule(criterion.rule, ctx, detail));
  if (!values.length || values.some((value) => !Number.isInteger(value) || value < 0 || value > criterion.max_points)) {
    throw new Error("Criterion produced invalid point values: " + criterionId);
  }
  const issues = ctx.issues.filter((issue, index, all) => all.findIndex((other) => JSON.stringify(other) === JSON.stringify(issue)) === index);
  return {
    criterion_id: criterion.id,
    score: values.length === 1 ? values[0] : null,
    possible_points: values,
    minimum: values[0],
    maximum: values.at(-1),
    status: values.length === 1 ? "resolved" : "multiple_possible_scores",
    max_points: criterion.max_points,
    observations: [...ctx.readKeys].filter((key) => input.observations?.[key] != null).map((key) => ({ field: key, ...input.observations[key] })),
    references: criterion.references,
    issues,
    ...detail
  };
}

export function evaluateAllCriteria(profile, input) {
  return {
    schema: "upstate.keowee-criterion-results/v1",
    profile_id: profile.id,
    profile_version: profile.version,
    parcel_id: input.parcel_id,
    huc10: input.huc10 ?? null,
    original_geography: input.huc10 ? profile.geography.original_huc10.includes(input.huc10) : null,
    criteria: profile.criteria.map((criterion) => evaluateCriterion(profile, criterion.id, input))
  };
}

/**
 * Aggregates the already-evaluated leaves using a category's published caps.
 * It does not rank parcels or alter the existing conservation engine.
 */
export function aggregateCategory(profile, categoryId, criterionResults, input) {
  const category = profile.categories.find((item) => item.id === categoryId);
  if (!category) throw new Error("Unknown category: " + categoryId);
  if (criterionResults.profile_id != null && (criterionResults.profile_id !== profile.id || criterionResults.profile_version !== profile.version)) throw new Error("Criterion results belong to a different profile.");
  if (!Array.isArray(criterionResults)) {
    if (criterionResults.parcel_id !== input.parcel_id) throw new Error("Criterion results belong to a different parcel.");
    if (criterionResults.huc10 != null && input.huc10 != null && criterionResults.huc10 !== input.huc10) throw new Error("Criterion results belong to a different HUC10.");
  }
  const byId = new Map((criterionResults.criteria ?? criterionResults).map((item) => [item.criterion_id, item]));
  function get(id) {
    const result = byId.get(id);
    if (!result) throw new Error("Missing criterion result: " + id);
    const spec = profile.criteria.find((item) => item.id === id);
    const allowed = possibleFor(spec.rule);
    if (!Array.isArray(result.possible_points) || !result.possible_points.length || result.possible_points.some((value) => !allowed.includes(value))) throw new Error("Invalid criterion points: " + id);
    return { ...result, minimum: Math.min(...result.possible_points), maximum: Math.max(...result.possible_points) };
  }
  let eligible = true;
  if (category.eligibility.type === "boolean") {
    const ctx = contextFor(profile, input);
    const value = ctx.read(category.eligibility.field);
    eligible = value === UNKNOWN ? null : value === category.eligibility.equals;
  } else if (category.eligibility.type === "any_positive") {
    const leaves = category.eligibility.criteria.map(get);
    eligible = leaves.some((item) => item.minimum > 0) ? true : leaves.every((item) => item.maximum === 0) ? false : null;
  }
  const groups = category.groups.map((group) => {
    let values = [0];
    for (const id of group.criteria) {
      values = unique(values.flatMap((existing) => get(id).possible_points.map((value) =>
        Math.min(group.max_points, group.operator === "max" ? Math.max(existing, value) : existing + value)
      )));
    }
    return { group_id: group.id, possible_points: values, cap: group.max_points, operator: group.operator };
  });
  let values = [0];
  for (const group of groups) values = unique(values.flatMap((existing) => group.possible_points.map((value) => existing + value)));
  const priorities = unique(values).map((value) => category.priority_ranges.find((range) => value >= range.min && value <= range.max)?.label).filter(Boolean);
  return {
    category_id: category.id,
    eligible,
    score: eligible === true && values.length === 1 ? values[0] : null,
    possible_points: eligible === false ? [] : values,
    possible_priorities: eligible === false ? [] : [...new Set(priorities)],
    max_points: category.max_points,
    groups,
    references: category.references,
    refinement: category.refinement ?? null,
    uncertainty_note: values.length > 1 ? "Ranges conservatively combine unresolved criteria; correlations between missing observations are not inferred." : null
  };
}

export function evaluateSepticScreen(profile, input) {
  const ctx = contextFor(profile, input);
  const sewerDistance = ctx.read("home_sewer_distance_ft");
  const waterDistance = ctx.read("home_surface_water_distance_ft");
  const rawYear = input.observations?.oldest_residence_year_built?.value;
  const year = rawYear == null ? UNKNOWN : ctx.read("oldest_residence_year_built");
  const soil = ctx.read("septic_soil_class", true);
  const soilRating = ctx.read("septic_soil_limitation_rating", true);
  const assumedSewer = sewerDistance === UNKNOWN ? null : sewerDistance <= 500;
  const withinWaterScreen = waterDistance === UNKNOWN ? null : waterDistance <= 300;
  let ageClass = "no_information";
  if (year !== UNKNOWN) {
    if (year < 1970) ageClass = "pre_1970";
    else if (year >= 1971 && year <= 2000) ageClass = "1971_2000";
    else if (year >= 2001 && year <= 2019) ageClass = "2001_2019";
    else ageClass = "outside_published_age_classes";
  }
  const originalCandidate = assumedSewer === true || withinWaterScreen === false ? false
    : assumedSewer === false && withinWaterScreen === true ? true : null;
  return {
    schema: "upstate.keowee-septic-screen/v1",
    profile_id: profile.id,
    parcel_id: input.parcel_id,
    assumed_sewer: assumedSewer,
    within_300ft_surface_water: withinWaterScreen,
    original_screen_candidate: originalCandidate,
    year_built: year === UNKNOWN ? null : year,
    age_class: ageClass,
    soil_class: soil === UNKNOWN ? null : soil,
    soil_limitation_rating: soilRating === UNKNOWN ? null : soilRating,
    observations: [...ctx.readKeys].filter((key) => input.observations?.[key] != null).map((key) => ({ field: key, ...input.observations[key] })),
    high_medium_priority: null,
    priority_method: profile.septic.rules.high_medium_method,
    references: profile.septic.references,
    issues: ctx.issues
  };
}

export function estimateReferenceCost(profile, items) {
  const lines = items.map((item) => {
    const rate = profile.cost_catalog.rates.find((entry) => entry.id === item.rate_id);
    if (!rate) throw new Error("Unknown rate: " + item.rate_id);
    if (!Number.isFinite(item.quantity) || item.quantity < 0) throw new Error("Cost quantity must be finite and nonnegative.");
    if (item.unit !== rate.unit) throw new Error("Expected quantity unit " + rate.unit + " for " + item.rate_id + ".");
    return { rate_id: rate.id, quantity: item.quantity, unit: item.unit, unit_rate: rate.rate, amount: item.quantity * rate.rate, reference: rate.reference };
  });
  return {
    currency: profile.cost_catalog.currency,
    price_basis: profile.cost_catalog.price_basis,
    adjusted_to_current_prices: false,
    lines,
    total: lines.reduce((sum, line) => sum + line.amount, 0)
  };
}

export function estimateLandcoverLoads(profile, rows, statistic = "median") {
  const source = profile.load_sources.landcover_coefficients;
  if (!["minimum", "median", "maximum"].includes(statistic)) throw new Error("Unknown coefficient statistic.");
  const lines = rows.map((row) => {
    const coefficient = source.values[row.land_cover]?.[statistic];
    if (!coefficient) throw new Error("Unknown land-cover coefficient: " + row.land_cover);
    if (!Number.isFinite(row.area) || row.area < 0) throw new Error("Area must be finite and nonnegative.");
    if (!["acre", "hectare"].includes(row.area_unit)) throw new Error("Area unit must be acre or hectare.");
    const areaHa = row.area_unit === "acre" ? row.area * source.conversion.hectares_per_acre : row.area;
    return { land_cover: row.land_cover, area_hectares: areaHa, coefficients_kg_ha_year: coefficient, loads_kg_year: Object.fromEntries(Object.entries(coefficient).map(([name, value]) => [name, value * areaHa])) };
  });
  const total = { tss: 0, tp: 0, tn: 0 };
  for (const line of lines) for (const pollutant of Object.keys(total)) total[pollutant] += line.loads_kg_year[pollutant];
  return { method: "source_coefficient_screening", statistic, area_hectares: lines.reduce((sum, line) => sum + line.area_hectares, 0), loads_kg_year: total, lines, reference: source.reference };
}

export function compareLandcoverLoads(profile, baselineRows, alternativeRows, statistic = "median") {
  const baseline = estimateLandcoverLoads(profile, baselineRows, statistic);
  const alternative = estimateLandcoverLoads(profile, alternativeRows, statistic);
  const difference = Object.fromEntries(Object.keys(baseline.loads_kg_year).map((pollutant) => [pollutant, alternative.loads_kg_year[pollutant] - baseline.loads_kg_year[pollutant]]));
  return {
    baseline,
    alternative,
    difference_kg_year: difference,
    reduction_positive_kg_year: Object.fromEntries(Object.entries(difference).map(([pollutant, value]) => [pollutant, -value])),
    area_difference_hectares: alternative.area_hectares - baseline.area_hectares,
    convention: "alternative minus baseline"
  };
}

/**
 * Maps the observed publisher class token to the original method's class spelling.
 * Raw values, source fields and identifiers remain on the returned observation.
 */
export function normalizeStreamClasses(profile, observation, adaptationId = "scdes-h2oclass-to-keowee-2020") {
  const adaptation = profile.native_integration.provider_adaptations.find((item) => item.id === adaptationId);
  if (!adaptation) throw new Error("Unknown stream-class adaptation: " + adaptationId);
  if (!observation || typeof observation !== "object" || !Object.hasOwn(observation, "value")) throw new Error("A source observation is required.");
  const raw = observation.value === null ? null : typeof observation.value === "string" ? [observation.value] : observation.value;
  if (raw !== null && (!Array.isArray(raw) || raw.some((value) => typeof value !== "string"))) throw new Error("Source stream classes must be a string, string array or null.");
  const changes = (raw ?? []).filter((value) => Object.hasOwn(adaptation.aliases, value)).map((value) => ({source_field: adaptation.source_field, raw_value: value, mapped_value: adaptation.aliases[value]}));
  const mapped = raw === null ? null : [...new Set(raw.map((value) => Object.hasOwn(adaptation.aliases, value) ? adaptation.aliases[value] : value))];
  const allowed = profile.fields.find((field) => field.id === adaptation.target_field).enum;
  const unassigned = mapped === null ? [] : mapped.filter((value) => !allowed.includes(value));
  const originalValues = {...(observation.original_values ?? {})};
  if (typeof observation.value === "string" && !Object.hasOwn(originalValues, adaptation.source_field)) originalValues[adaptation.source_field] = observation.value;
  return {
    adaptation_id: adaptation.id,
    status: raw === null ? "missing_source_observation" : unassigned.length ? "unassigned_source_codes" : "mapped",
    observation: {
      ...observation,
      value: unassigned.length ? null : mapped,
      original_fields: [...new Set([...(observation.original_fields ?? []), adaptation.source_field])],
      original_values: originalValues,
      source_class_values: raw,
      class_mapping: {adaptation_id: adaptation.id, source_field: adaptation.source_field, changes}
    },
    mapped_values: mapped,
    unassigned_codes: unassigned,
    references: adaptation.references,
    provider_layer_uri: adaptation.provider_layer_uri
  };
}
