#!/usr/bin/env Rscript
# Complete native analysis using the original, installed nmecr package.
# Original meter/weather data and every model object remain in the analysis case.
options(warn = 1, width = 140)
args <- commandArgs(trailingOnly = TRUE)
if (length(args) != 1L) stop("Usage: Rscript --vanilla native_analysis.R native-request.json")
if (!requireNamespace("jsonlite", quietly = TRUE)) stop("Install the declared jsonlite dependency.")

read_json <- function(path) jsonlite::fromJSON(path, simplifyVector = FALSE)
write_json <- function(path, value) {
  candidate <- paste0(path, ".pending-", Sys.getpid())
  jsonlite::write_json(value, candidate, auto_unbox = TRUE, pretty = TRUE,
                       dataframe = "rows", POSIXt = "ISO8601", na = "null", null = "null", digits = NA)
  if (!file.rename(candidate, path)) stop(paste("Could not retain", path))
}
write_csv <- function(value, path) {
  candidate <- paste0(path, ".pending-", Sys.getpid())
  utils::write.csv(value, candidate, row.names = FALSE, na = "NA", fileEncoding = "UTF-8")
  if (!file.rename(candidate, path)) stop(paste("Could not retain", path))
}
write_rds <- function(value, path) {
  candidate <- paste0(path, ".pending-", Sys.getpid())
  saveRDS(value, candidate, version = 3)
  if (!file.rename(candidate, path)) stop(paste("Could not retain", path))
}
request <- read_json(args[[1]])
root <- normalizePath(request$directory, mustWork = TRUE)
setwd(root)
set.seed(as.integer(request$seed))
Sys.setenv(TZ = request$timezone)
started <- format(Sys.time(), tz = "UTC", usetz = TRUE)
diagnostics <- list()
model_results <- list()
metadata <- list(startedAt = started, R = R.version.string, timezone = request$timezone,
                 inputSha256 = request$inputSha256, interval = request$interval,
                 units = request$units, originalSource = request$source,
                 weather = request$weather, randomSeed = request$seed,
                 invocation = commandArgs(), sourceExpected = list(
                   repository = "https://github.com/kW-Labs/nmecr",
                   commit = "343146d7a1e20d027e6ca48bd7ca2b38c646592a", version = "1.0.18"))
add_diagnostic <- function(code, message, details = list()) {
  diagnostics[[length(diagnostics) + 1L]] <<- list(code = code, message = message, details = details)
}
native_result <- function(status, terminal) {
  write_json("native-result.json", list(schema = request$schema, inputSha256 = request$inputSha256,
    status = status, terminal = terminal, models = model_results, diagnostics = diagnostics,
    metadata = c(metadata, list(finishedAt = format(Sys.time(), tz = "UTC", usetz = TRUE)))))
}
capture_call <- function(code, path) {
  warnings <- messages <- character()
  error <- NULL
  value <- tryCatch(withCallingHandlers(code(),
    warning = function(w) { warnings <<- c(warnings, conditionMessage(w)); invokeRestart("muffleWarning") },
    message = function(m) { messages <<- c(messages, conditionMessage(m)); invokeRestart("muffleMessage") }),
    error = function(e) {
      error <<- list(class = class(e), message = conditionMessage(e),
                    call = if (is.null(conditionCall(e))) NULL else paste(deparse(conditionCall(e)), collapse = "\n"))
      NULL
    })
  outcome <- list(ok = is.null(error), warnings = as.list(warnings), messages = as.list(messages), error = error)
  write_json(paste0(path, "-outcome.json"), outcome)
  list(value = value, outcome = outcome)
}
file_inventory <- function(directory) {
  names <- list.files(directory, recursive = TRUE, all.files = TRUE, full.names = TRUE)
  names <- names[!file.info(names)$isdir]
  names <- names[!grepl("result.json$|\\.pending-", names)]
  if (!length(names)) return(list())
  sums <- tools::md5sum(names)
  lapply(seq_along(names), function(i) list(
    name = substring(names[[i]], nchar(directory) + 2L),
    bytes = unname(file.info(names[[i]])$size), md5 = unname(sums[[i]])))
}
valid_checkpoint <- function(directory, checkpoint) {
  if (is.null(checkpoint$inputSha256) || checkpoint$inputSha256 != request$inputSha256) return(FALSE)
  if (!isTRUE(checkpoint$terminal)) return(FALSE)
  if (!is.null(request$normalization) &&
      !identical(checkpoint$normalizationAdapter, NORMALIZATION_ADAPTER)) return(FALSE)
  for (entry in checkpoint$files) {
    path <- file.path(directory, entry$name)
    if (!file.exists(path) || file.info(path)$isdir || file.info(path)$size != entry$bytes ||
        unname(tools::md5sum(path)) != entry$md5) return(FALSE)
  }
  TRUE
}
numeric_frames <- function(path) {
  frame <- utils::read.csv(path, stringsAsFactors = FALSE, check.names = FALSE)
  frame$time <- as.POSIXct(frame$time, origin = "1970-01-01", tz = request$timezone)
  frame
}
native_time <- function(value) as.POSIXct(value, origin = "1970-01-01", tz = request$timezone)
format_boundary <- function(value) format(native_time(value), "%m/%d/%Y %H:%M:%S", tz = request$timezone)
physical_frame <- function(frame, model) {
  if (model %in% c("SLR", "HDD", "CDD", "HDD-CDD"))
    frame <- frame[, setdiff(names(frame), c("interval_start", "interval_end")), drop = FALSE]
  frame
}
fit_model <- function(frame, model) {
  native_args <- request$arguments
  for (name in c("temp_knots_value", "initial_breakpoints"))
    if (!is.null(native_args[[name]])) native_args[[name]] <- as.numeric(unlist(native_args[[name]]))
  native_args$regression_type <- model
  native_args$timescale_days <- NULL
  options <- do.call(nmecr::assign_model_inputs, native_args)
  frame <- physical_frame(frame, model)
  object <- if (model == "Mean") nmecr::model_with_mean(frame, options) else
    if (model == "SLR") nmecr::model_with_SLR(frame, options) else
    if (model %in% c("3PC", "3PH", "4P", "5P")) nmecr::model_with_CP(frame, options) else
    if (model %in% c("HDD", "CDD", "HDD-CDD")) nmecr::model_with_HDD_CDD(frame, options) else
    nmecr::model_with_TOWT(training_data = frame, model_input_options = options)
  if (is.null(object) || is.null(object$training_data))
    stop("The original native algorithm returned no fitted model.")
  if (nrow(object$training_data) != nrow(frame) ||
      any(as.numeric(object$training_data$time) != as.numeric(frame$time)))
    stop("The native algorithm dropped or reordered original training rows.")
  if (length(object$training_data$model_fit) != nrow(frame) ||
      any(!is.finite(object$training_data$model_fit)))
    stop("The native algorithm returned incomplete or non-finite fitted values.")
  object
}
predict_model <- function(model, object, training, prediction) {
  if (model == "Mean") {
    # The upstream prediction dispatcher has no Mean branch. Use the actual
    # intercept model's native stats::predict method, retaining that distinction.
    values <- as.numeric(stats::predict(object$model, newdata = prediction))
    if (request$interval == "Monthly" && isTRUE(object$model_input_options$day_normalized))
      values <- values * prediction$days
    if (!isTRUE(request$allowNegativePredictions)) values[values < 0] <- 0
    prediction$predictions <- values
    return(prediction)
  }
  nmecr::calculate_model_predictions(
    training_data = physical_frame(training, model),
    prediction_data = physical_frame(prediction, model),
    modeled_object = object, allow_neg_predict = isTRUE(request$allowNegativePredictions))
}

# Pinned upstream normalization body, adapted only at its input seams.
# Source: https://github.com/kW-Labs/nmecr/blob/343146d7a1e20d027e6ca48bd7ca2b38c646592a/R/normalized_savings_and_uncertainty.R
# MIT License
# 
# Copyright (c) 2022 kW Engineering
# 
# Permission is hereby granted, free of charge, to any person obtaining a copy
# of this software and associated documentation files (the "Software"), to deal
# in the Software without restriction, including without limitation the rights
# to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
# copies of the Software, and to permit persons to whom the Software is
# furnished to do so, subject to the following conditions:
# 
# The above copyright notice and this permission notice shall be included in all
# copies or substantial portions of the Software.
# 
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
# FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
# AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
# LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
# OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
# SOFTWARE.
#' Calculate normalized savings and associated uncertainty as per ASHRAE Guideline 2014
#'
#' \code{This function calculates normalized (hourly or daily) savings achieved and the associated uncertainty.}
#'
#' @param baseline_model Baseline model
#' @param baseline_stats Baseline model's corresponding statistics
#' @param performance_model  Performance model
#' @param performance_stats Performance model's corresponding statistics
#' @param normalized_weather Weather dataset to be used for model prediction normalization
#' @param confidence_level Numeric corresponding to the confidence level to be used for savings uncertainty calculation
#'
#' @importFrom magrittr %>%
#'
#' @return a list with the following components:
#' \describe{
#'   \item{normalized_savings}{a dataframe with normalized baseline and performance predictions, and savings.}
#'   \item{normalized_savings_frac}{a numeric indicating the fraction of normalized savings against normalized baseline}
#'   \item{normalized_savings_unc}{a numeric indicating normalized savings uncertainty in energy units}
#'   \item{normalized_savings_unc_pct}{a numeric indicating normalized savings uncertainty in percent units}
#'   \item{confidence_leve}{a numeric indicating the confidence level at which the computation was performed.}
#' }
#'
#' @export

selected_norm_savings_and_uncertainty <- function(baseline_model = NULL, baseline_stats = NULL,
                                                   performance_model = NULL, performance_stats = NULL,
                                                   normalized_weather = NULL, confidence_level = 90,
                                                   prepared_weather = NULL, prediction_function = NULL){

  predictions <- norm.baseline <- norm.performance <- NULL # No visible binding for global variable

  if(confidence_level < 0 | confidence_level > 100){
    stop("Error: confidence level cannot be less than zero or greater than 100")
  }

  if(! is.numeric(confidence_level)){
    stop("Error: confidence level needs to be a numeric input between 0 and 100")
  }

  if(baseline_model$model_input_options$chosen_modeling_interval != performance_model$model_input_options$chosen_modeling_interval) {
    stop('Baseline and Performance Period models need to be over the same data interval')
  } else {

    if (baseline_model$model_input_options$chosen_modeling_interval != "15-min") {
      normalized_weather <- prepared_weather
    }

  }

  baseline_normalized <- prediction_function(training_data = baseline_model$training_data, prediction_data = normalized_weather,
                                                           modeled_object = baseline_model)

  performance_normalized <- prediction_function(training_data = performance_model$training_data, prediction_data = normalized_weather,
                                                        modeled_object = performance_model)

  normalized_savings <- baseline_normalized

  normalized_savings <- normalized_savings %>%
    dplyr::rename(norm.baseline = predictions)

  if (baseline_model$model_input_options$chosen_modeling_interval == "Daily") {
    normalized_savings <- normalized_savings %>%
      dplyr::left_join(performance_normalized, by = c("time", "temp", "HDD", "CDD"))
  } else if (baseline_model$model_input_options$chosen_modeling_interval == "Monthly") {

    if (baseline_model$model_input_options$day_normalized & performance_model$model_input_options$day_normalized) { # Both models are day-normalized
      normalized_savings <- normalized_savings %>%
        dplyr::left_join(performance_normalized, by = c("time", "temp", "HDD", "CDD", "HDD_perday", "CDD_perday", "days"))
    } else if (! (baseline_model$model_input_options$day_normalized & performance_model$model_input_options$day_normalized) ) { # None of the models are day-normalized
      normalized_savings <- normalized_savings %>%
        dplyr::left_join(performance_normalized, by = c("time", "temp", "HDD", "CDD"))
    } else {
      stop('Both models need to be either day-normalized or not. Cannot process a mix of the two options.')
    }
  } else { # Hourly or 15-min
    normalized_savings <- normalized_savings %>%
      dplyr::left_join(performance_normalized, by = c("time", "temp"))
  }

  normalized_savings <- normalized_savings %>%
    dplyr::rename(norm.performance = predictions)

  normalized_savings <- normalized_savings %>%
    dplyr::mutate(norm.savings = norm.baseline - norm.performance)

  if (baseline_model$model_input_options$chosen_modeling_interval == "Hourly" |
      baseline_model$model_input_options$chosen_modeling_interval == "15-min") {

    alpha <- 1.26

  } else if (baseline_model$model_input_options$chosen_modeling_interval == "Daily") {

    observation_count <- nrow(normalized_weather)/mean(c(30, 31))

    alpha <- ( - 0.00024 * (observation_count ^ 2) + (0.03535 * (observation_count) + 1.00286))

  } else if (baseline_model$model_input_options$chosen_modeling_interval == "Monthly") {

    observation_count <- nrow(normalized_weather)

    alpha <- (- 0.00022 * (observation_count ^ 2)) + (0.03306 * (observation_count)) + 0.94054
  }

  # correlation coeff ----

  calculate_independent_points <- function(model_fit_df) {

    corr_df <- as.data.frame(matrix(nrow = length(model_fit_df$time), ncol = 2))
    names(corr_df) <- c("residuals", "residuals_shifted")

    corr_df$residuals <- model_fit_df$eload - model_fit_df$model_fit
    corr_df$residuals_shifted <- dplyr::lag(corr_df$residuals, 1)
    corr_df <- corr_df[-1, ]

    rho <- stats::cor(corr_df[,1], corr_df[,2])
    n <- length(model_fit_df$time)
    n_dash <- n*(1 - rho)/(1+rho)

    return(n_dash)

  }

  n <- nrow(baseline_model$training_data)
  m <- nrow(performance_model$training_data)
  g <- nrow(normalized_weather)

  n_dash <- calculate_independent_points(baseline_model$training_data)
  m_dash <- calculate_independent_points(performance_model$training_data)

  baseline_dof <- baseline_stats$deg_of_freedom
  performance_dof <- performance_stats$deg_of_freedom
  baseline_dof_dash <- n_dash - baseline_stats$`#Parameters`
  performance_dof_dash <- m_dash - performance_stats$`#Parameters`

  baseline_t_stat <- stats::qt(1 - (1 - (confidence_level/100)) / 2, df = baseline_dof)
  performance_t_stat <- stats::qt(1 - (1 - (confidence_level/100)) / 2, df = performance_dof)
  baseline_t_stat_dash <- stats::qt(1 - (1 - (confidence_level/100)) / 2, df = baseline_dof_dash)
  performance_t_stat_dash <- stats::qt(1 - (1 - (confidence_level/100)) / 2, df = performance_dof_dash)

  mean_baseline_eload = mean(baseline_model$training_data$eload, na.rm = T)
  mean_baseline_normalized_eload = mean(baseline_normalized$predictions, na.rm = T)
  mean_performance_eload = mean(performance_model$training_data$eload, na.rm = T)
  mean_performance_normalized_eload = mean(performance_normalized$predictions, na.rm = T)

  baseline_squared_error <- (baseline_model$training_data$eload - baseline_model$training_data$model_fit) %>%
    magrittr::raise_to_power(2)

  performance_squared_error <- (performance_model$training_data$eload - performance_model$training_data$model_fit) %>%
    magrittr::raise_to_power(2)

  baseline_MSE <-  sum(baseline_squared_error, na.rm = T)/baseline_dof
  performance_MSE <- sum(performance_squared_error, na.rm = T)/performance_dof
  baseline_MSE_dash <-  sum(baseline_squared_error, na.rm = T)/baseline_dof_dash
  performance_MSE_dash <- sum(performance_squared_error, na.rm = T)/performance_dof_dash

  if (baseline_model$model_input_options$chosen_modeling_interval == "Monthly") {

    baseline_normalized_uncertainty <- (baseline_t_stat * alpha)*(mean_baseline_normalized_eload/mean_baseline_eload) * sqrt(baseline_MSE * (1+(2/n))  * g)
    performance_normalized_uncertainty <- (performance_t_stat * alpha)*(mean_performance_normalized_eload/mean_performance_eload) * sqrt(performance_MSE * (1+(2/m))  * g)

  } else {

    baseline_normalized_uncertainty <- (baseline_t_stat_dash * alpha)*(mean_baseline_normalized_eload/mean_baseline_eload) * sqrt(baseline_MSE_dash * (1+(2/n_dash))  * g)
    performance_normalized_uncertainty <- (performance_t_stat_dash * alpha)*(mean_performance_normalized_eload/mean_performance_eload) * sqrt(performance_MSE_dash * (1+(2/m_dash))  * g)

  }

  normalized_uncertainty <- sqrt(baseline_normalized_uncertainty^2 + performance_normalized_uncertainty^2)

  normalized_uncertainty_frac <- normalized_uncertainty/sum(normalized_savings$norm.baseline - normalized_savings$norm.performance)


  results <- NULL

  results$normalized_savings <- normalized_savings

  normalized_savings_df <- list()
  normalized_savings_df$normalized_savings_frac <- sum(normalized_savings$norm.baseline - normalized_savings$norm.performance)/sum(normalized_savings$norm.baseline)
  normalized_savings_df$normalized_savings_unc <- normalized_uncertainty
  normalized_savings_df$normalized_savings_unc_frac <- normalized_uncertainty_frac
  normalized_savings_df$confidence_level <- confidence_level

  results$normalized_savings_df <- normalized_savings_df

  return(results)
}

# Normalization uses the original upstream mathematics below with two explicit
# input seams: a once-aggregated native weather frame and the same selected
# native prediction policy used for reporting. The installed package is intact.
NORMALIZATION_ADAPTER <- "nmecr-1.0.18-selected-weather-v1"
normalize_selected_models <- function(model, baseline_model, baseline_stats,
                                      performance_model, performance_stats,
                                      original_weather, directory) {
  selected <- request$normalization
  interval <- baseline_model$model_input_options$chosen_modeling_interval
  if (interval != request$interval ||
      interval != performance_model$model_input_options$chosen_modeling_interval)
    stop("Normalization requires the same actual interval in both original fitted models.")
  start <- native_time(selected$start)
  end <- native_time(selected$end)
  weather <- original_weather[, c("time", "temp"), drop = FALSE]
  if (!nrow(weather) || any(!stats::complete.cases(weather)) ||
      any(!is.finite(weather$temp)) || anyDuplicated(weather$time) ||
      is.unsorted(as.numeric(weather$time), strictly = TRUE))
    stop("Normalization weather must contain every ordered, finite original observation.")
  boundary_unit <- switch(interval, "15-min" = "15 minutes", Hourly = "hour",
                          Daily = "day", Monthly = "day",
                          stop("The selected native normalization interval is unsupported."))
  if (as.numeric(lubridate::floor_date(start, boundary_unit)) != selected$start ||
      as.numeric(lubridate::floor_date(end, boundary_unit)) != selected$end)
    stop("The normalization weather window must contain complete selected modeling intervals; monthly windows must contain complete calendar days.")

  write_csv(weather, file.path(directory, "normalization-original-weather.csv"))
  write_rds(weather, file.path(directory, "normalization-original-weather.rds"))
  dput(nmecr::calculate_norm_savings_and_uncertainty,
       file = file.path(directory, "normalization-upstream-function.R"))
  dput(selected_norm_savings_and_uncertainty,
       file = file.path(directory, "normalization-selected-function.R"))
  write_json(file.path(directory, "normalization-input-policy.json"), list(
    adapter = NORMALIZATION_ADAPTER,
    upstreamCommit = "343146d7a1e20d027e6ca48bd7ca2b38c646592a",
    upstreamFunctionBlob = "7c87427de359c9de6253bffbb53d56cc37a92e62",
    upstreamAggregationBlob = "4a91b7d6e56fa86231c23db7066379e03e62164b",
    aggregationApi = "nmecr::aggregate",
    balancePointF = request$balancePoint, interval = interval,
    startInclusive = selected$start, endExclusive = selected$end,
    shiftNormalWeather = FALSE,
    allowNegativePredictions = isTRUE(request$allowNegativePredictions),
    predictionApi = if (model == "Mean") "stats::predict on original native intercept model"
                    else "nmecr::calculate_model_predictions",
    arithmetic = "Original pinned normalization body; savings and uncertainty expressions unchanged."))

  prepared <- nmecr::aggregate(
    temp_data = weather, convert_to_data_interval = interval,
    temp_balancepoint = request$balancePoint, shift_normal_weather = FALSE,
    start_date = start, end_date = native_time(selected$end - 1))
  write_csv(prepared, file.path(directory, "normalization-native-weather.csv"))
  write_rds(prepared, file.path(directory, "normalization-native-weather.rds"))
  if (!is.data.frame(prepared) || !nrow(prepared) ||
      !("time" %in% names(prepared)) || any(!stats::complete.cases(prepared)) ||
      anyDuplicated(prepared$time) || is.unsorted(as.numeric(prepared$time), strictly = TRUE))
    stop("Original native normalization aggregation returned incomplete or unordered weather.")
  numeric_columns <- vapply(prepared, is.numeric, logical(1))
  if (any(!vapply(prepared[numeric_columns], function(column) all(is.finite(column)), logical(1))))
    stop("Original native normalization aggregation returned non-finite predictors.")
  group_unit <- switch(interval, "15-min" = "15 minutes", Hourly = "hour",
                       Daily = "day", Monthly = "month")
  expected_times <- unique(as.numeric(lubridate::floor_date(weather$time, group_unit)))
  if (interval == "Monthly") expected_times[[1]] <- selected$start
  if (nrow(prepared) != length(expected_times) ||
      any(as.numeric(prepared$time) != expected_times))
    stop("Original native normalization aggregation omitted or changed a selected weather period.")
  if (interval == "Monthly") {
    required <- c("interval_start", "interval_end", "days", "HDD", "CDD", "HDD_perday", "CDD_perday")
    if (!all(required %in% names(prepared)))
      stop("Original monthly normalization frame lacks its native interval and degree-day fields.")
    starts <- as.numeric(prepared$interval_start)
    ends <- as.numeric(prepared$interval_end) + 86400
    if (starts[[1]] != selected$start || tail(ends, 1) != selected$end ||
        any(ends <= starts) ||
        (length(starts) > 1L && any(starts[-1L] != head(ends, -1L))) ||
        any(abs(prepared$days - (ends - starts) / 86400) > 1e-9))
      stop("Original native monthly normalization boundaries do not cover the complete selected weather window.")
  }

  predictions <- list()
  selected_predict <- function(training_data, prediction_data, modeled_object) {
    index <- length(predictions) + 1L
    if (index > 2L) stop("The selected upstream normalization invoked an unexpected extra prediction.")
    label <- if (index == 1L) "baseline" else "performance"
    output <- predict_model(model, modeled_object, training_data, prediction_data)
    write_rds(output, file.path(directory, paste0("normalization-", label, "-predictions.rds")))
    if (is.data.frame(output))
      write_csv(output, file.path(directory, paste0("normalization-", label, "-predictions.csv")))
    if (!is.data.frame(output) || nrow(output) != nrow(prepared) ||
        is.null(output$time) ||
        any(as.numeric(output$time) != as.numeric(prepared$time)) ||
        is.null(output$predictions) || length(output$predictions) != nrow(prepared) ||
        any(!is.finite(output$predictions)))
      stop(paste("Native normalized", label, "predictions dropped, reordered, or failed original weather periods."))
    predictions[[index]] <<- output
    output
  }
  # Resolve the original namespace imports, including %>%, without attaching
  # packages globally or changing the installed upstream implementation.
  selected_function <- selected_norm_savings_and_uncertainty
  environment(selected_function) <- environment(nmecr::calculate_norm_savings_and_uncertainty)
  value <- selected_function(
    baseline_model = baseline_model, baseline_stats = baseline_stats,
    performance_model = performance_model, performance_stats = performance_stats,
    normalized_weather = prepared, confidence_level = request$confidenceLevel,
    prepared_weather = prepared, prediction_function = selected_predict)
  # Preserve even a native joined result that fails the coverage check.
  write_rds(value, file.path(directory, "normalization-native-return.rds"))
  dput(value, file = file.path(directory, "normalization-native-return.R"))
  joined <- value$normalized_savings
  if (length(predictions) != 2L || !is.data.frame(joined) ||
      nrow(joined) != nrow(prepared) ||
      !all(c("time", "norm.baseline", "norm.performance", "norm.savings") %in% names(joined)) ||
      any(as.numeric(joined$time) != as.numeric(prepared$time)) ||
      any(!is.finite(joined$norm.baseline)) || any(!is.finite(joined$norm.performance)) ||
      any(!is.finite(joined$norm.savings)) ||
      any(joined$norm.baseline != predictions[[1L]]$predictions) ||
      any(joined$norm.performance != predictions[[2L]]$predictions))
    stop("Original normalization join did not preserve both complete native prediction series.")
  value
}

retain_object <- function(object, prefix) {
  write_rds(object, paste0(prefix, "-model.rds"))
  write_csv(object$training_data, paste0(prefix, "-fitted.csv"))
  capture.output(str(object, max.level = 3), file = paste0(prefix, "-structure.txt"))
  dput(object$model_input_options, file = paste0(prefix, "-options.R"))
  write_json(paste0(prefix, "-options.json"), object$model_input_options)
  for (name in intersect(names(object), c("model_stats", "model_occupied_stats", "model_unoccupied_stats")))
    write_csv(object[[name]], paste0(prefix, "-", gsub("_", "-", name), ".csv"))
  for (name in intersect(names(object), c("model", "model_occupied", "model_unoccupied"))) {
    if (is.null(object[[name]])) next
    capture.output(summary(object[[name]]), file = paste0(prefix, "-", gsub("_", "-", name), "-summary.txt"))
    capture.output(stats::formula(object[[name]]), file = paste0(prefix, "-", gsub("_", "-", name), "-formula.txt"))
  }
}
retain_statistics <- function(object, prefix) {
  captured <- capture_call(function() nmecr::calculate_summary_statistics(object),
                           paste0(prefix, "-statistics"))
  if (!captured$outcome$ok) return(captured)
  write_csv(captured$value, paste0(prefix, "-statistics.csv"))
  write_rds(captured$value, paste0(prefix, "-statistics.rds"))
  dput(captured$value, file = paste0(prefix, "-statistics.R"))
  write_json(paste0(prefix, "-statistics.json"), captured$value)
  captured
}
plot_model <- function(object, prediction, path, model) {
  grDevices::pdf(path, width = 10, height = 7, onefile = TRUE, paper = "special")
  on.exit(grDevices::dev.off(), add = TRUE)
  graphics::par(mfrow = c(2, 2), mar = c(4, 4, 3, 1), col.axis = "#303030", col.lab = "#202020")
  data <- object$training_data
  graphics::plot(data$time, data$eload, type = "l", col = "#343434", xlab = "Original time",
                 ylab = paste("Energy", request$units), main = paste(model, "baseline"))
  graphics::lines(data$time, data$model_fit, col = "#777777", lty = 2)
  graphics::legend("topleft", c("Observed", "Native fitted"), col = c("#343434", "#777777"),
                   lty = c(1, 2), bty = "n", cex = 0.8)
  graphics::plot(data$temp, data$eload, col = "#555555", pch = 16, cex = 0.5,
                 xlab = "Observed temperature (F)", ylab = paste("Energy", request$units),
                 main = "Observed temperature response")
  graphics::plot(data$time, data$eload - data$model_fit, type = "h", col = "#555555",
                 xlab = "Original time", ylab = paste("Residual", request$units),
                 main = "Original signed residuals")
  graphics::abline(h = 0, col = "#999999")
  if (!is.null(prediction)) {
    graphics::plot(prediction$time, prediction$eload, type = "l", col = "#343434",
                   xlab = "Original reporting time", ylab = paste("Energy", request$units),
                   main = "Reporting period")
    graphics::lines(prediction$time, prediction$predictions, col = "#777777", lty = 2)
  } else {
    graphics::plot.new()
    graphics::text(0, 1, adj = c(0, 1),
      labels = paste("Source:", request$source$id, "\nRevision:", request$source$revisionId,
                     "\nUnits:", request$units, "\nReporting period: not selected"), cex = 0.8)
  }
}
run <- function() {
  required <- c("nmecr", "dplyr", "lubridate", "segmented", "magrittr", "xts", "zoo", "purrr", "jsonlite")
  missing <- required[!vapply(required, requireNamespace, logical(1), quietly = TRUE)]
  if (length(missing)) stop(paste("Install the declared native dependencies:", paste(missing, collapse = ", ")))
  versions <- lapply(required, function(name) list(package = name,
                          version = as.character(utils::packageVersion(name)),
                          path = find.package(name)))
  metadata$packages <<- versions
  metadata$nmecrVersion <<- as.character(utils::packageVersion("nmecr"))
  if (metadata$nmecrVersion != "1.0.18") stop("Use the pinned nmecr 1.0.18 source installation.")
  if (utils::packageVersion("dplyr") < "1.1.0")
    stop("This original nmecr source requires dplyr >= 1.1.0 for its native interval joins.")
  origin <- file.path(find.package("nmecr"), "commons-source-origin.json")
  if (file.exists(origin)) {
    provenance <- read_json(origin)
    if (provenance$commit != metadata$sourceExpected$commit)
      stop("The installed nmecr source origin differs from the selected original commit.")
    for (entry in provenance$installedFiles) {
      path <- file.path(find.package("nmecr"), entry$name)
      if (!file.exists(path) || unname(tools::md5sum(path)) != entry$md5)
        stop(paste("The installed original nmecr file changed:", entry$name))
    }
    metadata$verifiedInstalledSource <<- provenance
  } else {
    add_diagnostic("source_origin_unrecorded",
      "The package reports its version; install with the provided source receiver to retain its exact original source identity.")
  }
  capture.output(sessionInfo(), file = "native-session-info.txt")
  write_json("native-packages.json", metadata$packages)
  meter <- numeric_frames("meter-native.csv")
  weather <- numeric_frames("weather-native.csv")
  meter_end <- max(meter$end)
  load <- meter[, c("time", "eload")]
  temperatures <- weather[, c("time", "temp")]
  frame_result <- capture_call(function() nmecr::create_dataframe(
    eload_data = load, temp_data = temperatures,
    start_date = format_boundary(min(as.numeric(meter$time))),
    end_date = format_boundary(meter_end - 1),
    convert_to_data_interval = request$interval,
    temp_balancepoint = request$balancePoint, shift_normal_weather = FALSE), "native-frame")
  if (!frame_result$outcome$ok) stop(frame_result$outcome$error$message)
  frame <- frame_result$value
  write_rds(frame, "native-frame.rds")
  write_csv(frame, "native-frame.csv")
  if (nrow(frame) != nrow(meter) ||
      any(as.numeric(frame$time) != as.numeric(meter$time)) ||
      any(!is.finite(frame$eload)) ||
      any(abs(frame$eload - meter$eload) > pmax(1e-9, abs(meter$eload) * 1e-12)))
    stop("The original native frame changed the selected energy row identities or quantities.")
  if (any(!stats::complete.cases(frame)))
    stop("The native frame contains incomplete rows; no energy readings were dropped for fitting.")
  if (request$interval == "Monthly") {
    expected_days <- as.numeric(difftime(native_time(meter$end), meter$time, units = "days"))
    if (any(abs(frame$days - expected_days) > 1e-9) ||
        any(as.numeric(frame$interval_start) != as.numeric(meter$time)) ||
        any(abs(as.numeric(frame$interval_end) + 86400 - meter$end) > 1e-6))
      stop("Native monthly billing boundaries differ from the original selected intervals.")
  }
  metadata$nativeFrameRows <<- nrow(frame)
  metadata$nativeEnergySum <<- sum(frame$eload)
  metadata$predictorPolicy <<- list(
    retained = "Complete original create_dataframe output is retained.",
    SLR_HDD_CDD = "Date boundary metadata is omitted from regression predictors; original physical columns are retained.",
    CP = "Original native monthly boundary fields are retained for the native CP column selection.",
    normalization = "Native selected-balance-point aggregation and the same prediction policy; pinned upstream savings and uncertainty mathematics; complete row and interval coverage checked.",
    MeanPrediction = "stats::predict on the actual native intercept model; upstream dispatcher has no Mean branch.",
    statistics = "Original signed values and unmodified native objects; JSON non-finite numbers are null with raw R/CSV retained.")
  baseline_indices <- if (is.null(request$baseline)) seq_len(nrow(frame)) else as.integer(unlist(request$baseline$indices))
  training <- frame[baseline_indices, , drop = FALSE]
  reporting <- if (is.null(request$reporting)) NULL else frame[as.integer(unlist(request$reporting$indices)), , drop = FALSE]
  write_csv(training, "baseline-native.csv")
  if (!is.null(reporting)) write_csv(reporting, "reporting-native.csv")
  normal_weather <- NULL
  if (!is.null(request$normalization)) {
    normal_weather <- temperatures[as.numeric(temperatures$time) >= request$normalization$start &
                                    as.numeric(temperatures$time) < request$normalization$end, , drop = FALSE]
    write_csv(normal_weather, "normalization-original-weather.csv")
  }
  dir.create("models", showWarnings = FALSE, mode = "0700")
  for (model in unlist(request$models)) {
    effective_seed <- as.integer((as.double(request$seed) + match(model, c("Mean", "SLR", "3PC", "3PH", "4P", "5P", "HDD", "CDD", "HDD-CDD", "TOW", "TOWT"))) %% 2147483647)
    set.seed(effective_seed)
    directory <- file.path(root, "models", model)
    dir.create(directory, showWarnings = FALSE, mode = "0700")
    checkpoint_path <- file.path(directory, "result.json")
    if (file.exists(checkpoint_path)) {
      checkpoint <- read_json(checkpoint_path)
      if (valid_checkpoint(directory, checkpoint)) {
        model_results[[length(model_results) + 1L]] <<- checkpoint
        cat(jsonlite::toJSON(list(stage = "model-resumed", model = model, status = checkpoint$status), auto_unbox = TRUE), "\n")
        next
      }
      if (!is.null(checkpoint$inputSha256) && checkpoint$inputSha256 != request$inputSha256)
        stop("A retained model directory belongs to different original analysis input.")
    }
    result <- list(model = model, inputSha256 = request$inputSha256, randomSeed = effective_seed, terminal = TRUE,
                   status = "failed", diagnostics = list(),
                   normalizationAdapter = if (is.null(request$normalization)) NULL else NORMALIZATION_ADAPTER,
                   predictionApi =
                     if (model == "Mean") "stats::predict.lm on nmecr::model_with_mean$model" else
                       "nmecr::calculate_model_predictions")
    if ((request$interval == "Monthly" && model %in% c("TOW", "TOWT")) ||
        (request$interval %in% c("15-min", "Hourly") && model %in% c("HDD", "CDD", "HDD-CDD"))) {
      result$status <- "inapplicable"
      result$diagnostics <- list(list(code = "native_interval", message =
        paste(model, "does not support the original", request$interval, "interval.")))
    } else {
      prefix <- file.path(directory, "baseline")
      fit <- capture_call(function() fit_model(training, model), paste0(prefix, "-fit"))
      result$fit <- fit$outcome
      if (fit$outcome$ok) {
        object <- fit$value
        retain_object(object, prefix)
        stats <- retain_statistics(object, prefix)
        result$status <- "fitted"
        result$statistics <- stats$outcome
        if (stats$outcome$ok) result$summary <- stats$value
        prediction <- NULL
        if (!is.null(reporting)) {
          prediction_result <- capture_call(function() predict_model(model, object, training, reporting),
                                            file.path(directory, "reporting-prediction"))
          result$prediction <- prediction_result$outcome
          if (prediction_result$outcome$ok) {
            prediction <- prediction_result$value
            if (nrow(prediction) != nrow(reporting) ||
                any(as.numeric(prediction$time) != as.numeric(reporting$time)) ||
                is.null(prediction$predictions) || any(!is.finite(prediction$predictions))) {
              result$prediction$ok <- FALSE
              result$prediction$error <- list(message = "Native reporting predictions are incomplete or reordered.")
              write_rds(prediction, file.path(directory, "reporting-prediction-original.rds"))
              prediction <- NULL
            } else {
              write_csv(prediction, file.path(directory, "reporting-predictions.csv"))
              write_rds(prediction, file.path(directory, "reporting-predictions.rds"))
              if (stats$outcome$ok) {
                savings <- capture_call(function() nmecr::calculate_savings_and_uncertainty(
                  prediction_df = prediction, modeled_object = object,
                  model_summary_statistics = stats$value, confidence_level = request$confidenceLevel),
                  file.path(directory, "reporting-savings"))
                result$savings <- savings$outcome
                if (savings$outcome$ok) {
                  write_rds(savings$value, file.path(directory, "reporting-savings.rds"))
                  write_json(file.path(directory, "reporting-savings.json"), savings$value)
                  dput(savings$value, file = file.path(directory, "reporting-savings.R"))
                  for (name in names(savings$value))
                    if (is.data.frame(savings$value[[name]]))
                      write_csv(savings$value[[name]], file.path(directory, paste0("reporting-", name, ".csv")))
                  result$savingsSummary <- savings$value$savings_summary_df
                }
              }
            }
          }
        }
        if (!is.null(normal_weather)) {
          performance <- capture_call(function() fit_model(reporting, model), file.path(directory, "performance-fit"))
          result$performanceFit <- performance$outcome
          if (performance$outcome$ok) {
            retain_object(performance$value, file.path(directory, "performance"))
            performance_stats <- retain_statistics(performance$value, file.path(directory, "performance"))
            result$performanceStatistics <- performance_stats$outcome
            if (stats$outcome$ok && performance_stats$outcome$ok) {
              normalized <- capture_call(function() normalize_selected_models(
                model = model, baseline_model = object, baseline_stats = stats$value,
                performance_model = performance$value, performance_stats = performance_stats$value,
                original_weather = normal_weather, directory = directory),
                file.path(directory, "normalized-savings"))
              result$normalizedSavings <- normalized$outcome
              if (normalized$outcome$ok) {
                write_rds(normalized$value, file.path(directory, "normalized-savings.rds"))
                write_json(file.path(directory, "normalized-savings.json"), normalized$value)
                dput(normalized$value, file = file.path(directory, "normalized-savings.R"))
                for (name in names(normalized$value))
                  if (is.data.frame(normalized$value[[name]]))
                    write_csv(normalized$value[[name]], file.path(directory, paste0("normalized-", name, ".csv")))
                result$normalizedSavingsSummary <- normalized$value$normalized_savings_df
              }
            }
          }
        }
        plot <- capture_call(function() plot_model(object, prediction, file.path(directory, "model-report.pdf"), model),
                             file.path(directory, "plot"))
        result$plot <- plot$outcome
        if (!stats$outcome$ok || (!is.null(result[["prediction"]]) && !result[["prediction"]][["ok"]]) ||
            (!is.null(result[["savings"]]) && !result[["savings"]][["ok"]]) ||
            (!is.null(result[["performanceFit"]]) && !result[["performanceFit"]][["ok"]]) ||
            (!is.null(result[["performanceStatistics"]]) && !result[["performanceStatistics"]][["ok"]]) ||
            (!is.null(result[["normalizedSavings"]]) && !result[["normalizedSavings"]][["ok"]]) ||
            !plot$outcome$ok)
          result$status <- "partial"
      }
    }
    result$files <- file_inventory(directory)
    write_json(checkpoint_path, result)
    model_results[[length(model_results) + 1L]] <<- result
    cat(jsonlite::toJSON(list(stage = "model-complete", model = model, status = result$status), auto_unbox = TRUE), "\n")
    flush.console()
  }
  flat <- lapply(model_results, function(item) data.frame(
    model = item$model, status = item$status, interval = request$interval,
    units = request$units, baseline_readings = nrow(training),
    reporting_readings = if (is.null(reporting)) 0L else nrow(reporting),
    stringsAsFactors = FALSE))
  write_csv(do.call(rbind, flat), "model-comparison.csv")
  write_json("model-comparison.json", model_results)
  capture.output(sessionInfo(), file = "native-session-info.txt")
  successes <- sum(vapply(model_results, function(item) item$status %in% c("fitted", "partial"), logical(1)))
  failures <- sum(vapply(model_results, function(item) item$status %in% c("failed", "partial"), logical(1)))
  metadata$fittedModels <<- successes
  metadata$failedOrPartialModels <<- failures
  if (successes == 0L) native_result("failed", TRUE) else
    if (failures > 0L) native_result("partial", TRUE) else native_result("complete", TRUE)
}
tryCatch({
  run()
}, error = function(e) {
  add_diagnostic("native_error", conditionMessage(e),
                 list(class = class(e), call = if (is.null(conditionCall(e))) NULL else paste(deparse(conditionCall(e)), collapse = "\n")))
  capture.output(sessionInfo(), file = "native-session-info.txt")
  native_result("failed", FALSE)
  cat(conditionMessage(e), "\n", file = stderr())
  quit(save = "no", status = 1L)
})
