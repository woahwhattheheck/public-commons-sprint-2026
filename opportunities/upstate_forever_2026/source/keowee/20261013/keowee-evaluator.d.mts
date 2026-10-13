/**
 * Typed adapter for lake-keowee-methodology.json and keowee-evaluator.mjs.
 * Original source field names and identifiers stay in each observation's lineage.
 */
export type Scalar = string | number | boolean | null;
export type FieldId = "already_protected" | "cwa_mean" | "stream_orders" | "stream_classes" | "fw_stream_has_impairment" | "sensitive_buffer_acres" | "forested_sensitive_buffer_present" | "wetland_classes" | "hydric_soil_acres" | "floodplain_intersects" | "developed_land_present" | "source_water_protection_area_intersects" | "stream_length_miles" | "watershed_mean_stream_length_miles" | "adjacent_protected_land" | "parcel_area_acres" | "bacterial_impairment_relation" | "agricultural_fraction" | "agricultural_land_adjacent_to_stream" | "agricultural_land_contains_impoundment" | "known_logging_operation" | "nitrogen_export_mean" | "phosphorus_export_mean" | "sediment_export_mean" | "nitrogen_export_class" | "phosphorus_export_class" | "sediment_export_class" | "unpermitted_agricultural_source" | "permitted_agricultural_source" | "unpermitted_stormwater_source" | "permitted_stormwater_source" | "modified_wetland_present" | "historic_wetland_present" | "dam_present" | "sensitive_buffer_intersects" | "adjacent_drinking_water_reservoir_or_intake" | "adjacent_other_waterway" | "private_boat_ramp_present" | "private_dock_present" | "high_traffic_pet_business_present" | "public_land_open_to_people" | "home_sewer_distance_ft" | "home_surface_water_distance_ft" | "oldest_residence_year_built" | "septic_soil_class" | "septic_soil_limitation_rating";
export type CriterionId = "protection_cwa" | "protection_stream_order" | "protection_stream_class" | "protection_sensitive_buffer" | "forested_sensitive_buffer_present" | "protection_wetland_class" | "protection_hydric_soils" | "protection_floodplain" | "source_water_protection_area_intersects" | "protection_stream_length" | "adjacent_protected_land" | "protection_parcel_size" | "bacterial_impairment" | "agricultural_cover_share" | "agricultural_water_connection" | "developed_land_present" | "known_logging_operation" | "nitrogen_export" | "phosphorus_export" | "sediment_export" | "unpermitted_agricultural_source" | "permitted_agricultural_source" | "unpermitted_stormwater_source" | "permitted_stormwater_source" | "modified_wetland_present" | "historic_wetland_present" | "dam_present" | "sensitive_buffer_intersects" | "restoration_stream_order" | "waterway_adjacency" | "floodplain_intersects" | "private_boat_ramp_present" | "private_dock_present" | "high_traffic_pet_business_present" | "public_land_open_to_people";
export type CategoryId = "land_protection" | "agricultural_bmp" | "wetland_restoration" | "riparian_restoration" | "voluntary_dam_removal" | "shoreline_management" | "stormwater_bmp" | "pet_waste";
/** Closed numeric source bounds; supported by numeric-bin criteria. */
export interface ClosedNumericInterval<U extends string = string> {
  lower: number;
  upper: number;
  closed: true;
  unit: U;
  method: string;
  reference: string;
  area_basis?: "whole_original_parcel" | "reporting_parcel" | string;
  structural_only?: boolean;
  source_geometry_sha256?: string;
  /** Original source coverage, geometry and method metadata remain intact. */
  [key: string]: unknown;
}
export interface ObservationMetadata {
  source_uri?: string;
  source_sha256?: string;
  source_binding?: Record<string, unknown>;
  numeric_interval_source?: string;
  original_numeric_interval?: Record<string, unknown>;
  spatial_scope?: {area_basis?: string | null; meaning: string; bound_applies_to: string};
  source_collection_id?: string;
  source_entry_id?: string;
  original_fields?: string[];
  original_values?: Record<string, Scalar>;
  feature_ids?: string[];
  method?: string;
  vintage?: string;
  source_crs?: string;
  analysis_crs?: string;
  baseline_run_id?: string;
  output_layer_id?: string;
  grid_id?: string;
  pixel_area_m2?: number;
  source_units?: string;
  source_class_values?: string[] | null;
  class_mapping?: {adaptation_id: string; source_field: string; changes: Array<{source_field: string; raw_value: string; mapped_value: string}>};
}
export type Observation<T, U extends string | null = null> =
  ObservationMetadata & {value: T | null} &
  (U extends string ? {unit: U} : {unit?: null}) &
  (T extends number ? {interval?: ClosedNumericInterval<U extends string ? U : string>} : {interval?: never});
export interface Observations {
  /** Already protected parcel Source: Existing parks, preserves, water-utility land and conservation easements. */
  already_protected?: Observation<boolean>;
  /** Parcel mean of the original derived CWA index Source: Furman University 2017 CWA raster. */
  cwa_mean?: Observation<number, "dimensionless_index">;
  /** Stream orders intersecting the parcel Source: National Hydrography Dataset. */
  stream_orders?: Observation<number[]>;
  /** Stream classifications intersecting the parcel Source: SCDHEC stream classifications. */
  stream_classes?: Observation<Array<"ORW" | "TN" | "TGPT" | "FW">>;
  /** Any impairment on a parcel's FW stream Source: SCDHEC impairment data. */
  fw_stream_has_impairment?: Observation<boolean>;
  /** Sensitive-buffer area within parcel Source: UF sensitive-buffer layer. */
  sensitive_buffer_acres?: Observation<number, "acre">;
  /** Forested cover overlaps a sensitive buffer within parcel Source: NLCD forest cover and UF buffer layer. */
  forested_sensitive_buffer_present?: Observation<boolean>;
  /** Wetland classes intersecting parcel Source: National Wetlands Inventory. */
  wetland_classes?: Observation<Array<"freshwater_forested_shrub" | "freshwater_emergent" | "riverine" | "freshwater_pond" | "lake" | "other">>;
  /** Hydric-soil area within parcel Source: State Soil Survey Geographical Database. */
  hydric_soil_acres?: Observation<number, "acre">;
  /** Parcel contains 1% annual-chance floodplain Source: FEMA National Flood Hazard Layer. */
  floodplain_intersects?: Observation<boolean>;
  /** Developed land occurs on parcel Source: NLCD 2011 developed classes. */
  developed_land_present?: Observation<boolean>;
  /** Parcel in a source-water protection area Source: SCDHEC Source Water Protection Areas. */
  source_water_protection_area_intersects?: Observation<boolean>;
  /** Stream length along or within parcel Source: NHD and parcel polygons. */
  stream_length_miles?: Observation<number, "mile">;
  /** Watershed mean stream length; record cohort Source: Measured parcel cohort in named watershed. */
  watershed_mean_stream_length_miles?: Observation<number, "mile">;
  /** Parcel adjacent to protected land Source: NCED, UF easements, parks and preserves. */
  adjacent_protected_land?: Observation<boolean>;
  /** Parcel area Source: County parcel polygons. */
  parcel_area_acres?: Observation<number, "acre">;
  /** Includes, adjacent to, or upstream of bacterial impairment Source: SCDHEC 2016 303(d) and NHD. */
  bacterial_impairment_relation?: Observation<Array<"includes" | "adjacent" | "upstream" | "none">>;
  /** Agricultural proportion of parcel Source: NLCD 2011 pasture/hay and cultivated crops. */
  agricultural_fraction?: Observation<number, "fraction">;
  /** Agricultural land itself adjacent to stream Source: Agricultural cover and NHD. */
  agricultural_land_adjacent_to_stream?: Observation<boolean>;
  /** Agricultural land includes a water impoundment Source: Agricultural cover and water polygons. */
  agricultural_land_contains_impoundment?: Observation<boolean>;
  /** Known logging operation Source: Landowner inventory. */
  known_logging_operation?: Observation<boolean>;
  /** Parcel mean of current annual nitrogen export per pixel Source: Furman InVEST current nitrogen raster. */
  nitrogen_export_mean?: Observation<number, "kg/pixel/year">;
  /** Parcel mean of current annual phosphorus export per pixel Source: Furman InVEST current phosphorus raster. */
  phosphorus_export_mean?: Observation<number, "kg/pixel/year">;
  /** Parcel mean of current annual sediment export per pixel Source: Furman InVEST current sediment raster. */
  sediment_export_mean?: Observation<number, "tons/pixel/year">;
  /** Retained original low, medium or high nitrogen class Source: Original parcel classification layer. */
  nitrogen_export_class?: Observation<"low" | "medium" | "high">;
  /** Retained original low, medium or high phosphorus class Source: Original parcel classification layer. */
  phosphorus_export_class?: Observation<"low" | "medium" | "high">;
  /** Retained original low, medium or high sediment class Source: Original parcel classification layer. */
  sediment_export_class?: Observation<"low" | "medium" | "high">;
  /** Agricultural source identified by the source analysis Source: Known farm inventory below permitting threshold. */
  unpermitted_agricultural_source?: Observation<boolean>;
  /** Relevant CAFO, biosolid, animal-management, land-application or farm record Source: Agricultural permits and source inventory. */
  permitted_agricultural_source?: Observation<boolean>;
  /** Known source selected for stormwater analysis Source: Original below-threshold point-source inventory. */
  unpermitted_stormwater_source?: Observation<boolean>;
  /** Relevant permitted non-agricultural source Source: Non-agricultural NPDES, mines, gravel pits and landfills. */
  permitted_stormwater_source?: Observation<boolean>;
  /** Wetland with one of the original special modifiers Source: Current National Wetlands Inventory. */
  modified_wetland_present?: Observation<boolean>;
  /** Historical wetland intersects parcel Source: Historical National Wetlands Inventory. */
  historic_wetland_present?: Observation<boolean>;
  /** Mapped dam on parcel Source: National Inventory of Dams. */
  dam_present?: Observation<boolean>;
  /** Full or partial parcel overlap with sensitive buffer Source: UF sensitive-buffer layer. */
  sensitive_buffer_intersects?: Observation<boolean>;
  /** Direct adjacency to drinking-water reservoir or intake Source: NHD and drinking-water intakes. */
  adjacent_drinking_water_reservoir_or_intake?: Observation<boolean>;
  /** Direct adjacency to other waterway Source: NHD. */
  adjacent_other_waterway?: Observation<boolean>;
  /** Private ramp along drinking-water reservoir Source: Private ramp/dock inventory. */
  private_boat_ramp_present?: Observation<boolean>;
  /** Private dock along drinking-water reservoir Source: Private ramp/dock inventory. */
  private_dock_present?: Observation<boolean>;
  /** Veterinary hospital, pet store, grooming/boarding facility or shelter Source: Verified pet-related business inventory. */
  high_traffic_pet_business_present?: Observation<boolean>;
  /** Existing publicly open land Source: Public parks, preserves and other open land. */
  public_land_open_to_people?: Observation<boolean>;
  /** Residence distance to sewer Source: Residence locations and county/utility sewer lines. */
  home_sewer_distance_ft?: Observation<number, "foot">;
  /** Residence distance to open surface water Source: Residence locations and surface waters. */
  home_surface_water_distance_ft?: Observation<number, "foot">;
  /** Oldest residence on a multi-home parcel; system-age proxy Source: Oconee and Pickens county property records. */
  oldest_residence_year_built?: Observation<number, "year">;
  /** Original soil suitability class Source: SSURGO septic tank absorption-field interpretation. */
  septic_soil_class?: Observation<"not_limited" | "somewhat_limited" | "very_limited" | "not_rated">;
  /** Severity of a soil limitation; not a probability Source: SSURGO interpretation. */
  septic_soil_limitation_rating?: Observation<number, "fraction">;
}
export interface ParcelInput {
  parcel_id: string;
  huc10?: string;
  observations: Observations;
  choices?: {protection_stream_order?: "appendix_d" | "table31"};
}
export interface Reference {source_id: string; printed_pages: number[]; detail: string}
export interface Issue {field?: FieldId; code: string; detail: string}
export interface CriterionResult {
  criterion_id: CriterionId;
  score: number | null;
  possible_points: number[];
  minimum: number;
  maximum: number;
  status: "resolved" | "multiple_possible_scores";
  max_points: number;
  observations: Array<ObservationMetadata & {field: FieldId; value: unknown; unit?: string | null; interval?: ClosedNumericInterval}>;
  references: Reference[];
  issues: Issue[];
  classification?: {
    mode: "literal_published_bins" | "retained_original_class" | "literal_published_bins_over_closed_interval";
    labels: string[];
    state?: "bounded_interval";
    matched_classes?: string[];
    classes?: string[];
    score_options?: number[];
    attainable_states?: Array<"scored" | "ambiguous" | "unclassified">;
    value_interval?: ClosedNumericInterval;
  };
  value_interval?: ClosedNumericInterval;
  points_determined_by_interval?: boolean;
  source_interpretation?: string;
  source_variants?: Array<{name: string; possible_points: number[]}>;
}
export interface CriterionResults {
  schema: "upstate.keowee-criterion-results/v1";
  profile_id: string;
  profile_version: string;
  parcel_id: string;
  huc10: string | null;
  original_geography: boolean | null;
  criteria: CriterionResult[];
}
export interface CategoryResult {
  category_id: CategoryId;
  eligible: boolean | null;
  score: number | null;
  possible_points: number[];
  possible_priorities: Array<"low" | "medium" | "high">;
  max_points: number;
  groups: Array<{group_id: string; possible_points: number[]; cap: number; operator: "sum" | "max"}>;
  references: Reference[];
  refinement: null | {description: string; reference: Reference; changes_original_score: boolean};
  uncertainty_note: string | null;
}
export interface MethodologyProfile {
  schema: "upstate.keowee-methodology/v1";
  id: string;
  version: string;
  title: string;
  fields: Array<{id: FieldId; type: string; unit: string | null; source: string; description: string; minimum?: number; maximum?: number; enum?: string[]}>;
  criteria: Array<{id: CriterionId; max_points: number; rule: Record<string, unknown>; references: Reference[]}>;
  categories: Array<{id: CategoryId; max_points: number; groups: unknown[]; priority_ranges: unknown[]; eligibility: unknown; references: Reference[]}>;
  geography: {original_huc10: string[]};
  septic: {rules: {high_medium_method: string}; references: Reference[]};
  cost_catalog: {currency: string; price_basis: string; rates: Array<{id: string; rate: number; unit: string; reference: Reference}>};
  load_sources: {landcover_coefficients: {values: Record<string, Record<string, Record<string, number>>>; conversion: {hectares_per_acre: number}; reference: Reference}};
  [key: string]: unknown;
}
export interface SepticScreen {
  schema: "upstate.keowee-septic-screen/v1";
  profile_id: string;
  parcel_id: string;
  assumed_sewer: boolean | null;
  within_300ft_surface_water: boolean | null;
  original_screen_candidate: boolean | null;
  year_built: number | null;
  age_class: "no_information" | "pre_1970" | "1971_2000" | "2001_2019" | "outside_published_age_classes";
  soil_class: "not_limited" | "somewhat_limited" | "very_limited" | "not_rated" | null;
  soil_limitation_rating: number | null;
  observations: CriterionResult["observations"];
  high_medium_priority: null;
  priority_method: string;
  references: Reference[];
  issues: Issue[];
}
export type RateId = "septic_repair_replacement" | "agricultural_bmp_bundle" | "pet_waste_station" | "conservation_easement_closing" | "streambank_fencing" | "water_well_500ft" | "water_pipeline" | "alternative_watering_source" | "heavy_use_area" | "riparian_buffer" | "filter_strip" | "drip_irrigation" | "tree_shrub_site_preparation" | "tree_shrub_establishment";
export interface CostItem {rate_id: RateId; quantity: number; unit: string}
export interface CostEstimate {
  currency: string; price_basis: string; adjusted_to_current_prices: false;
  lines: Array<CostItem & {unit_rate: number; amount: number; reference: Reference}>;
  total: number;
}
export type LandCover = "single_family_low_density" | "forest" | "pasture" | "grass" | "road" | "commercial";
export type CoefficientStatistic = "minimum" | "median" | "maximum";
export interface AreaRow {land_cover: LandCover; area: number; area_unit: "acre" | "hectare"}
export interface PollutantLoads {tss: number; tp: number; tn: number}
export interface LoadEstimate {
  method: "source_coefficient_screening"; statistic: CoefficientStatistic; area_hectares: number;
  loads_kg_year: PollutantLoads;
  lines: Array<{land_cover: LandCover; area_hectares: number; coefficients_kg_ha_year: PollutantLoads; loads_kg_year: PollutantLoads}>;
  reference: Reference;
}
export interface LoadComparison {
  baseline: LoadEstimate; alternative: LoadEstimate;
  difference_kg_year: PollutantLoads; reduction_positive_kg_year: PollutantLoads;
  area_difference_hectares: number; convention: "alternative minus baseline";
}
export function evaluateCriterion(profile: MethodologyProfile, criterionId: CriterionId, input: ParcelInput): CriterionResult;
export function evaluateAllCriteria(profile: MethodologyProfile, input: ParcelInput): CriterionResults;
export function aggregateCategory(profile: MethodologyProfile, categoryId: CategoryId, criterionResults: CriterionResult[] | CriterionResults, input: ParcelInput): CategoryResult;
export function evaluateSepticScreen(profile: MethodologyProfile, input: ParcelInput): SepticScreen;
export function estimateReferenceCost(profile: MethodologyProfile, items: CostItem[]): CostEstimate;
export function estimateLandcoverLoads(profile: MethodologyProfile, rows: AreaRow[], statistic?: CoefficientStatistic): LoadEstimate;
export function compareLandcoverLoads(profile: MethodologyProfile, baselineRows: AreaRow[], alternativeRows: AreaRow[], statistic?: CoefficientStatistic): LoadComparison;

export interface StreamClassAdaptationResult {
  adaptation_id: string;
  status: "missing_source_observation" | "unassigned_source_codes" | "mapped";
  observation: Observation<Array<"ORW" | "TN" | "TGPT" | "FW">>;
  mapped_values: string[] | null;
  unassigned_codes: string[];
  references: Reference[];
  provider_layer_uri: string;
}
export function normalizeStreamClasses(profile: MethodologyProfile, observation: Observation<string | string[]>, adaptationId?: string): StreamClassAdaptationResult;
