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
                   status = "failed", diagnostics = list(), predictionApi =
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
              normalized <- capture_call(function() nmecr::calculate_norm_savings_and_uncertainty(
                baseline_model = object, baseline_stats = stats$value,
                performance_model = performance$value, performance_stats = performance_stats$value,
                normalized_weather = normal_weather, confidence_level = request$confidenceLevel),
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
        if (!stats$outcome$ok || (!is.null(result$prediction) && !result$prediction$ok) ||
            (!is.null(result$savings) && !result$savings$ok) ||
            (!is.null(result$performanceFit) && !result$performanceFit$ok) ||
            (!is.null(result$performanceStatistics) && !result$performanceStatistics$ok) ||
            (!is.null(result$normalizedSavings) && !result$normalizedSavings$ok) ||
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
