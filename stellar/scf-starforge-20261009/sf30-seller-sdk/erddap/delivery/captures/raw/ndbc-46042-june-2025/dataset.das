Attributes {
 s {
  longitude {
    String _CoordinateAxisType "Lon";
    Float32 actual_range -177.75, 179.001;
    String axis "X";
    Float64 colorBarMaximum 180.0;
    Float64 colorBarMinimum -180.0;
    String comment "The longitude of the station.";
    String ioos_category "Location";
    String long_name "Longitude";
    String standard_name "longitude";
    String units "degrees_east";
  }
  latitude {
    String _CoordinateAxisType "Lat";
    Float32 actual_range -55.0, 71.758;
    String axis "Y";
    Float64 colorBarMaximum 90.0;
    Float64 colorBarMinimum -90.0;
    String comment "The latitude of the station.";
    String ioos_category "Location";
    String long_name "Latitude";
    String standard_name "latitude";
    String units "degrees_north";
  }
  time {
    String _CoordinateAxisType "Time";
    Float64 actual_range 4910400.0, 1.7917929e+9;
    String axis "T";
    Float64 colorBarMaximum 2.0e+9;
    Float64 colorBarMinimum 0.0;
    String ioos_category "Time";
    String long_name "Time";
    String standard_name "time";
    String time_origin "01-JAN-1970 00:00:00";
    String units "seconds since 1970-01-01T00:00:00Z";
  }
  WD {
    Int16 _FillValue 32767;
    Int16 actual_range 0, 359;
    Float64 colorBarMaximum 360.0;
    Float64 colorBarMinimum 0.0;
    String comment "Wind direction (the direction the wind is coming from in degrees clockwise from true N) during the same period used for WSPD.";
    String ioos_category "Wind";
    String long_name "Wind Direction";
    Int16 missing_value 32767;
    String standard_name "wind_from_direction";
    String units "degrees_true";
  }
  WSPD {
    Float32 _FillValue -9999999.0;
    Float32 actual_range 0.0, 96.0;
    Float64 colorBarMaximum 15.0;
    Float64 colorBarMinimum 0.0;
    String comment "Average wind speed (m/s).";
    String ioos_category "Wind";
    String long_name "Wind Speed";
    Float32 missing_value -9999999.0;
    String standard_name "wind_speed";
    String units "m s-1";
  }
  GST {
    Float32 _FillValue -9999999.0;
    Float32 actual_range 0.0, 75.5;
    Float64 colorBarMaximum 30.0;
    Float64 colorBarMinimum 0.0;
    String comment "Peak 5 or 8 second gust speed (m/s).";
    String ioos_category "Wind";
    String long_name "Wind Gust Speed";
    Float32 missing_value -9999999.0;
    String standard_name "wind_speed_of_gust";
    String units "m s-1";
  }
  WVHT {
    Float32 _FillValue -9999999.0;
    Float32 actual_range 0.0, 92.39;
    Float64 colorBarMaximum 10.0;
    Float64 colorBarMinimum 0.0;
    String comment "Significant wave height (meters) is calculated as the average of the highest one-third of all of the wave heights during the 20-minute sampling period.";
    String ioos_category "Surface Waves";
    String long_name "Wave Height";
    Float32 missing_value -9999999.0;
    String standard_name "sea_surface_wave_significant_height";
    String units "m";
  }
  DPD {
    Float32 _FillValue -9999999.0;
    Float32 actual_range 0.0, 64.0;
    Float64 colorBarMaximum 20.0;
    Float64 colorBarMinimum 0.0;
    String comment "Dominant wave period (seconds) is the period with the maximum wave energy.";
    String ioos_category "Surface Waves";
    String long_name "Wave Period, Dominant";
    Float32 missing_value -9999999.0;
    String standard_name "sea_surface_swell_wave_period";
    String units "s";
  }
  APD {
    Float32 _FillValue -9999999.0;
    Float32 actual_range 0.0, 95.0;
    Float64 colorBarMaximum 20.0;
    Float64 colorBarMinimum 0.0;
    String comment "Average wave period (seconds) of all waves during the 20-minute period.";
    String ioos_category "Surface Waves";
    String long_name "Wave Period, Average";
    Float32 missing_value -9999999.0;
    String standard_name "sea_surface_swell_wave_period";
    String units "s";
  }
  MWD {
    Int16 _FillValue 32767;
    Int16 actual_range 0, 359;
    Float64 colorBarMaximum 360.0;
    Float64 colorBarMinimum 0.0;
    String comment "Mean wave direction corresponding to energy of the dominant period (DOMPD).";
    String ioos_category "Surface Waves";
    String long_name "Wave Direction";
    Int16 missing_value 32767;
    String standard_name "sea_surface_wave_to_direction";
    String units "degrees_true";
  }
  BAR {
    Float32 _FillValue -9999999.0;
    Float32 actual_range 800.7, 1198.8;
    Float64 colorBarMaximum 1050.0;
    Float64 colorBarMinimum 950.0;
    String comment "Air pressure (hPa). ('PRES' on some NDBC tables.) For C-MAN sites and Great Lakes buoys, the recorded pressure is reduced to sea level using the method described in NWS Technical Procedures Bulletin 291 (11/14/80).";
    String ioos_category "Pressure";
    String long_name "Air Pressure";
    Float32 missing_value -9999999.0;
    String standard_name "air_pressure_at_sea_level";
    String units "hPa";
  }
  ATMP {
    Float32 _FillValue -9999999.0;
    Float32 actual_range -153.4, 50.0;
    Float64 colorBarMaximum 40.0;
    Float64 colorBarMinimum -10.0;
    String comment "Air temperature (Celsius). For sensor heights on buoys, see Hull Descriptions. For sensor heights at C-MAN stations, see C-MAN Sensor Locations.";
    String ioos_category "Temperature";
    String long_name "Air Temperature";
    Float32 missing_value -9999999.0;
    String standard_name "air_temperature";
    String units "degree_C";
  }
  WTMP {
    Float32 _FillValue -9999999.0;
    Float32 actual_range -98.7, 50.0;
    Float64 colorBarMaximum 32.0;
    Float64 colorBarMinimum 0.0;
    String comment "Sea surface temperature (Celsius). For sensor depth, see Hull Description.";
    String ioos_category "Temperature";
    String long_name "SST";
    Float32 missing_value -9999999.0;
    String standard_name "sea_surface_temperature";
    String units "degree_C";
  }
  DEWP {
    Float32 _FillValue -9999999.0;
    Float32 actual_range -99.9, 48.7;
    Float64 colorBarMaximum 40.0;
    Float64 colorBarMinimum 0.0;
    String comment "Dewpoint temperature taken at the same height as the air temperature measurement.";
    String ioos_category "Temperature";
    String long_name "Dewpoint Temperature";
    Float32 missing_value -9999999.0;
    String standard_name "dew_point_temperature";
    String units "degree_C";
  }
  VIS {
    Float32 _FillValue -9999999.0;
    Float32 actual_range 0.0, 66.7;
    Float64 colorBarMaximum 100.0;
    Float64 colorBarMinimum 0.0;
    String comment "Station visibility (km, originally nautical miles in the NDBC .txt files). Note that buoy stations are limited to reports from 0 to 1.6 nmi.";
    String ioos_category "Meteorology";
    String long_name "Station Visibility";
    Float32 missing_value -9999999.0;
    String standard_name "visibility_in_air";
    String units "km";
  }
  PTDY {
    Float32 _FillValue -9999999.0;
    Float32 actual_range -14.2, 10.4;
    Float64 colorBarMaximum 3.0;
    Float64 colorBarMinimum -3.0;
    String comment "Pressure Tendency is the direction (plus or minus) and the amount of pressure change (hPa) for a three hour period ending at the time of observation.";
    String ioos_category "Pressure";
    String long_name "Pressure Tendency";
    Float32 missing_value -9999999.0;
    String standard_name "tendency_of_air_pressure";
    String units "hPa";
  }
  TIDE {
    Float32 _FillValue -9999999.0;
    Float32 actual_range -9.37, 6.15;
    Float64 colorBarMaximum 5.0;
    Float64 colorBarMinimum -5.0;
    String comment "The water level in meters (originally feet in the NDBC .txt files) above or below Mean Lower Low Water (MLLW).";
    String ioos_category "Sea Level";
    String long_name "Water Level";
    Float32 missing_value -9999999.0;
    String standard_name "surface_altitude";
    String units "m";
  }
  WSPU {
    Float32 _FillValue -9999999.0;
    Float32 actual_range -98.7, 97.5;
    Float64 colorBarMaximum 15.0;
    Float64 colorBarMinimum -15.0;
    String comment "The zonal wind speed (m/s) indicates the u component of where the wind is going, derived from Wind Direction and Wind Speed.";
    String ioos_category "Wind";
    String long_name "Wind Speed, Zonal";
    Float32 missing_value -9999999.0;
    String standard_name "eastward_wind";
    String units "m s-1";
  }
  WSPV {
    Float32 _FillValue -9999999.0;
    Float32 actual_range -98.7, 97.5;
    Float64 colorBarMaximum 15.0;
    Float64 colorBarMinimum -15.0;
    String comment "The meridional wind speed (m/s) indicates the v component of where the wind is going, derived from Wind Direction and Wind Speed.";
    String ioos_category "Wind";
    String long_name "Wind Speed, Meridional";
    Float32 missing_value -9999999.0;
    String standard_name "northward_wind";
    String units "m s-1";
  }
  station {
    String cf_role "timeseries_id";
    String comment "The station identifier.";
    String ioos_category "Identifier";
    String long_name "Station Identifier";
  }
  station_id {
    String ioos_category "Identifier";
    String long_name "Station Id";
  }
  station_name {
    String ioos_category "Identifier";
    String long_name "Station Name";
  }
  station_location {
    String ioos_category "Location";
    String long_name "Station Location";
  }
  station_type {
    String ioos_category "Unknown";
    String long_name "Station Type";
  }
  timezone {
    String ioos_category "Unknown";
    String long_name "Timezone";
  }
  owner_code {
    String ioos_category "Identifier";
    String long_name "Owner Code";
  }
  owner_name {
    String ioos_category "Identifier";
    String long_name "Owner Name";
  }
  country_code {
    String ioos_category "Location";
    String long_name "Country Code";
  }
  data_coverage_start {
    String comment "Start of data coverage across historical and nrt files combined.";
    String ioos_category "Time";
    String long_name "Data Coverage Start";
  }
  data_coverage_end {
    String comment "End of data coverage across historical and nrt files combined.";
    String ioos_category "Time";
    String long_name "Data Coverage End";
  }
 }
  NC_GLOBAL {
    String cdm_data_type "TimeSeries";
    String cdm_timeseries_variables "station, latitude, longitude";
    String contributor_name "NOAA NDBC";
    String contributor_role "Source of data.";
    String Conventions "COARDS, CF-1.10, ACDD-1.3";
    String creator_email "erd.data@noaa.gov";
    String creator_name "NOAA NMFS SWFSC ERD";
    String creator_type "institution";
    String creator_url "https://www.pfeg.noaa.gov";
    String date_created "2026-07-14";
    String date_issued "2026-07-14";
    Float64 Easternmost_Easting 179.001;
    String featureType "TimeSeries";
    Float64 geospatial_lat_max 71.758;
    Float64 geospatial_lat_min -55.0;
    String geospatial_lat_units "degrees_north";
    Float64 geospatial_lon_max 179.001;
    Float64 geospatial_lon_min -177.75;
    String geospatial_lon_units "degrees_east";
    String geospatial_vertical_positive "down";
    String geospatial_vertical_units "m";
    String history "Around the 25th of each month, erd.data@noaa.gov downloads the latest yearly and monthly historical .txt.gz files from https://www.ndbc.noaa.gov/data/historical/stdmet/ and generates one historical .nc file for each station. erd.data@noaa.gov also downloads all of the 45day near real time .txt files from https://www.ndbc.noaa.gov/data/realtime2/ and generates one near real time .nc file for each station.
Every 5 minutes, erd.data@noaa.gov downloads the list of latest data from all stations for the last 2 hours from https://www.ndbc.noaa.gov/data/latest_obs/latest_obs.txt and updates the near real time .nc files.
2026-10-12T09:16:05Z (local files)
2026-10-12T09:16:05Z https://coastwatch.pfeg.noaa.gov/erddap/tabledap/cwwcNDBCMet.das";
    String id "cwwcNDBCMet";
    String infoUrl "https://www.ndbc.noaa.gov/";
    String institution "NOAA NDBC, NOAA NMFS SWFSC ERD";
    String keywords "1970-present, air, air_pressure_at_sea_level, air_temperature, altitude, APD, atmosphere, atmospheric, ATMP, average, BAR, boundary, buoy, center, coast, coastwatch, code, control, country, country_code, coverage, data, data_coverage_end, data_coverage_start, depth, dew, dew point, dew_point_temperature, DEWP, dewpoint, direction, dominant, DPD, earth, Earth Science > Atmosphere > Air Quality > Visibility, Earth Science > Atmosphere > Altitude > Planetary Boundary Layer Height, Earth Science > Atmosphere > Atmospheric Pressure > Atmospheric Pressure Measurements, Earth Science > Atmosphere > Atmospheric Pressure > Pressure Tendency, Earth Science > Atmosphere > Atmospheric Pressure > Sea Level Pressure, Earth Science > Atmosphere > Atmospheric Pressure > Static Pressure, Earth Science > Atmosphere > Atmospheric Temperature > Air Temperature, Earth Science > Atmosphere > Atmospheric Temperature > Dew Point Temperature, Earth Science > Atmosphere > Atmospheric Temperature > Surface Air Temperature, Earth Science > Atmosphere > Atmospheric Water Vapor > Dew Point Temperature, Earth Science > Atmosphere > Atmospheric Winds > Surface Winds, Earth Science > Oceans > Ocean Temperature > Sea Surface Temperature, Earth Science > Oceans > Ocean Waves > Significant Wave Height, Earth Science > Oceans > Ocean Waves > Swells, Earth Science > Oceans > Ocean Waves > Wave Period, Earth Science > Oceans > Ocean Waves > Wave Speed/Direction, eastward, eastward_wind, end, erd, fisheries, GST, gust, height, identifier, latitude, layer, level, longitude, marine, measurements, meridional, meteorological, meteorology, MWD, name, national, ndbc, near, nmfs, noaa, node, northward, northward_wind, nrt, ocean, oceans, owner, owner_code, owner_name, period, planetary, point, present, pressure, PTDY, quality, real, science, sea, sea level, sea_surface_swell_wave_period, sea_surface_swell_wave_significant_height, sea_surface_swell_wave_to_direction, sea_surface_temperature, sea_surface_wave_significant_height, sea_surface_wave_to_direction, seawater, service, significant, southwest, speed, sst, standard, start, static, station, station_id, station_location, station_name, station_type, surface, surface waves, surface_altitude, swell, swells, swfsc, swh, temperature, tendency, tendency_of_air_pressure, TIDE, time, timezone, type, vapor, VIS, visibility, visibility_in_air, water, wave, waves, wcn, west, wind, wind_from_direction, wind_speed, wind_speed_of_gust, winds, WSPD, WSPU, WSPV, WTMP, WVHT, zonal";
    String keywords_vocabulary "GCMD Science Keywords";
    String license "The data may be used and redistributed for free but is not intended
for legal use, since it may contain inaccuracies. Neither the data
Contributor, ERD, NOAA, nor the United States Government, nor any
of their employees or contractors, makes any warranty, express or
implied, including warranties of merchantability and fitness for a
particular purpose, or assumes any legal liability for the accuracy,
completeness, or usefulness, of this information.";
    String naming_authority "gov.noaa.pfeg.coastwatch";
    Float64 Northernmost_Northing 71.758;
    String project "NOAA NDBC and NOAA NMFS SWFSC ERD";
    String publisher_email "erd.data@noaa.gov";
    String publisher_name "NOAA NMFS SWFSC ERD";
    String publisher_type "institution";
    String publisher_url "https://www.pfeg.noaa.gov";
    String quality "Automated QC checks with periodic manual QC";
    String source "station observation";
    String sourceUrl "(local files)";
    Float64 Southernmost_Northing -55.0;
    String standard_name_vocabulary "CF Standard Name Table v70";
    String subsetVariables "station, latitude, longitude";
    String summary "The National Data Buoy Center (NDBC) distributes meteorological data from
moored buoys maintained by NDBC and others. Moored buoys are the weather
sentinels of the sea. They are deployed in the coastal and offshore waters
from the western Atlantic to the Pacific Ocean around Hawaii, and from the
Bering Sea to the South Pacific. NDBC's moored buoys measure and transmit
barometric pressure; wind direction, speed, and gust; air and sea
temperature; and wave energy spectra from which significant wave height,
dominant wave period, and average wave period are derived. Even the
direction of wave propagation is measured on many moored buoys. See
https://www.ndbc.noaa.gov/measdes.shtml for a description of the measurements.

The source data from NOAA NDBC has different column names, different units,
and different missing values in different files, and other problems (notably,
lots of rows with duplicate or different values for the same time point).
This dataset is a standardized, reformatted, and lightly edited version of
that source data, created by NOAA National Marine Fisheries Service (NMFS) Southwest Fisheries Science Center (SWFSC) ERD (email: erd.data at noaa.gov).
Before 2020-01-29, this dataset only had the data that was closest to a given
hour, rounded to the nearest hour. Now, this dataset has all of the data
available from NDBC with the original time values. If there are multiple
source rows for a given buoy for a given time, only the row with the most
non-NaN data values is kept. If there is a gap in the data, a row of missing
values is inserted (which causes a nice gap when the data is graphed). Also,
some impossible data values are removed, but this data is not perfectly clean.
This dataset is now updated every 5 minutes.

This dataset has both historical data (quality controlled) and near real time
data (less quality controlled).";
    String testOutOfDate "now-25minutes";
    String time_coverage_end "2026-10-12T08:15:00Z";
    String time_coverage_start "1970-02-26T20:00:00Z";
    String title "NDBC Standard Meteorological Buoy Data, 1970-present";
    Float64 Westernmost_Easting -177.75;
  }
}
