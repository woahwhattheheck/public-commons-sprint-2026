export type UnitMode = 'standard' | 'metric' | 'imperial';
export interface WeatherRecord {
  at: number;
  temperature?: number; feelsLike?: number; dewPoint?: number;
  pressure?: number; humidity?: number; clouds?: number; visibility?: number; uvIndex?: number;
  windSpeed?: number; windGust?: number; windDirection?: number;
  rainRate?: number; snowRate?: number; precipitationProbability?: number;
  sunrise?: number; sunset?: number;
  weather?: Array<{id: number; main?: string; description?: string; icon?: string}>;
  alertIds?: string[];
}
export interface Coverage {
  complete: boolean; expectedHours: number; receivedHours: number;
  gaps: Array<{start: number; end: number; hours: number}>;
  duplicateRecords: number; conflictingRecords: number;
}
export interface WeatherEnvelope {
  schema: 'stellar-forge.openweather-customer.v1';
  project: string; review: string; timezone: string | null;
  units: Record<string,string>; coverage: Coverage; reviewedAt: string;
  sources: Array<{id: string; kind: 'current' | 'hourly'; receivedAt: string; sha256: string; status: number}>;
}
export interface CurrentWeather extends WeatherEnvelope {record: WeatherRecord | null}
export interface HourlyPage extends WeatherEnvelope {
  data: WeatherRecord[]; offset: number; total: number; nextOffset: number | null;
}
export interface WeatherClient {
  current(project: string, options?: {review?: string}): Promise<CurrentWeather>;
  hourlyPage(project: string, options?: {review?: string; offset?: number; limit?: number}): Promise<HourlyPage>;
  hourly(project: string, options?: {review?: string; limit?: number}): AsyncGenerator<WeatherRecord>;
}
export function createWeatherClient(options: {
  url: string; token: string; timeoutMs?: number; fetchImpl?: typeof fetch;
}): WeatherClient;
