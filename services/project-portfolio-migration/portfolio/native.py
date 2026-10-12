"""The maintained MPXJ engine owns all project parsing and native output."""
from __future__ import annotations

import base64
import contextlib
import hashlib
import importlib.metadata
import json
import math
from pathlib import Path
import threading

from .storage import PortfolioError, canonical, digest, file_identity, require

MPXJ_VERSION = "16.10.0"
UPSTREAM_COMMIT = "7ef9e72813d33378c55ec6ceb148cc831ed22033"
MODEL_SCHEMA = "project-portfolio-model.v1"
NATIVE_LOCK = threading.RLock()
INPUT_DEFAULTS = {"format": "auto", "raw_timephased": True, "ignore_errors": False,
                  "microsoft_compatible": True, "charset": None,
                  "source_timezone": None, "source_locale": None}
OUTPUT_DEFAULTS = {"write_timephased": True, "microsoft_compatible": True,
                   "save_version": "Project2016"}
SAVE_VERSIONS = {"Project2002", "Project2003", "Project2007", "Project2010",
                 "Project2013", "Project2016"}
FAMILY_TYPES = {"project": "ProjectField", "tasks": "TaskField",
                "resources": "ResourceField", "assignments": "AssignmentField"}
SINGULAR = {"tasks": "task", "resources": "resource", "assignments": "assignment",
            "dependencies": "dependency", "calendars": "calendar", "project": "project"}
IDENTITY_FIELDS = {"UNIQUE_ID", "ID", "GUID", "PARENT_TASK_UNIQUE_ID",
                   "TASK_UNIQUE_ID", "RESOURCE_UNIQUE_ID", "PROJECT_UNIQUE_ID",
                   "PREDECESSORS", "SUCCESSORS", "SUBPROJECT", "SUBPROJECT_GUID",
                   "ASSIGNMENT_TASK_GUID", "ASSIGNMENT_RESOURCE_GUID"}
SCALAR_TYPES = {"string", "integer", "number", "boolean", "local_datetime",
                "local_date", "local_time", "duration", "rate", "enum"}
TYPE_COMPATIBILITY = {
    "STRING": {"string"}, "NOTES": {"string"}, "CHAR": {"string"},
    "INTEGER": {"integer"}, "SHORT": {"integer"},
    "CURRENCY": {"number", "integer"}, "NUMERIC": {"number", "integer"},
    "UNITS": {"number", "integer"}, "PERCENTAGE": {"number", "integer"},
    "BOOLEAN": {"boolean"}, "DATE": {"local_datetime"},
    "TIME": {"local_time"}, "DURATION": {"duration"},
    "WORK": {"duration"}, "DELAY": {"duration"},
    "RATE": {"rate"},
}


def input_profile(value=None):
    value = value or {}
    require(isinstance(value, dict) and set(value) <= set(INPUT_DEFAULTS),
            "input_profile", "Use the named native input controls.", sorted(INPUT_DEFAULTS))
    result = {**INPUT_DEFAULTS, **value}
    require(result["format"] in ("auto", "mpp", "mpt", "mspdi"),
            "source_format", "Select MPP, MPT or MSPDI input.")
    for name in ("raw_timephased", "ignore_errors", "microsoft_compatible"):
        require(type(result[name]) is bool, "input_profile", name + " must be a boolean.")
    for name in ("charset", "source_timezone", "source_locale"):
        require(result[name] is None or isinstance(result[name], str) and 0 < len(result[name]) <= 160,
                "input_profile", name + " must be an explicit source value or null.")
    return result


def output_profile(value=None):
    value = value or {}
    require(isinstance(value, dict) and set(value) <= set(OUTPUT_DEFAULTS),
            "output_profile", "Use the named native MSPDI output controls.", sorted(OUTPUT_DEFAULTS))
    result = {**OUTPUT_DEFAULTS, **value}
    require(type(result["write_timephased"]) is bool and type(result["microsoft_compatible"]) is bool
            and result["save_version"] in SAVE_VERSIONS,
            "output_profile", "Choose explicit timephased, Microsoft compatibility and SaveVersion values.")
    return result


def native_uid(value):
    return None if value is None else str(value)


def make_keys(rows, family, findings):
    counts = {}
    for row in rows:
        uid = row["uid"]
        if uid is not None:
            counts[uid] = counts.get(uid, 0) + 1
    for ordinal, row in enumerate(rows):
        uid = row["uid"]
        prefix = SINGULAR[family]
        row["ordinal"] = ordinal
        row["key"] = prefix + ":" + uid if uid is not None and counts[uid] == 1 else prefix + ":row:" + str(ordinal)
        if uid is None or counts[uid] != 1:
            finding = {"code": "missing_uid" if uid is None else "duplicate_uid",
                       "severity": "review", "path": family + "/" + row["key"],
                       "message": "The native row has no unique UID; preserve its original row position when matching.",
                       "details": {"uid": uid, "ordinal": ordinal}}
            findings.append({"id": digest(finding), **finding})


class NativeMPXJ:
    def __init__(self, mpp_password_provider=None, jvm_args=()):
        self.mpp_password_provider = mpp_password_provider
        self.jvm_args = tuple(jvm_args)
        self._classes = {}
        self._runtime = None
        self._jpype = None

    @contextlib.contextmanager
    def locked(self):
        with NATIVE_LOCK:
            self.ensure()
            yield self

    def ensure(self):
        with NATIVE_LOCK:
            if self._runtime is not None:
                return self._runtime
            try:
                import jpype
                import jpype.imports
                import mpxj
            except ImportError as error:
                raise PortfolioError("native_runtime", "Install the pinned MPXJ and JPype requirements and a Java runtime.", str(error)) from error
            if not jpype.isJVMStarted():
                jpype.startJVM(*self.jvm_args, convertStrings=False)
                if threading.current_thread() is not threading.main_thread():
                    # JNI attaches the launching thread as non-daemon. A disposable
                    # request worker must release that attachment before returning;
                    # otherwise DestroyJavaVM waits for its already-ended thread.
                    java_thread = jpype.JClass("java.lang.Thread")
                    java_thread.detach()
                    java_thread.attachAsDaemon()
            actual = str(jpype.JClass("org.mpxj.MPXJ").VERSION)
            require(actual == MPXJ_VERSION, "native_version",
                    "Use the selected MPXJ " + MPXJ_VERSION + " runtime.", {"actual": actual})
            self._jpype = jpype
            system = jpype.JClass("java.lang.System")
            lib = Path(mpxj.__file__).parent / "lib"
            jars = [{"name": path.name, **file_identity(path)} for path in sorted(lib.glob("*.jar"))]
            require(jars, "native_jars", "The installed MPXJ Python package has no native JAR files.")
            self._runtime = {"library": "MPXJ", "version": actual, "upstream_commit": UPSTREAM_COMMIT,
                             "python_package_version": importlib.metadata.version("mpxj"),
                             "jpype_version": importlib.metadata.version("JPype1"),
                             "java_version": str(system.getProperty("java.version")),
                             "java_vendor": str(system.getProperty("java.vendor")), "jars": jars}
            return self._runtime

    def jclass(self, name):
        self.ensure()
        if name not in self._classes:
            self._classes[name] = self._jpype.JClass(name)
        return self._classes[name]

    def read(self, path, profile=None):
        selected = input_profile(profile)
        path = Path(path)
        with self.locked():
            if selected["format"] == "auto":
                suffix = path.suffix.lower()
                if suffix in (".mpp", ".mpt"):
                    selected["format"] = suffix[1:]
                else:
                    with open(path, "rb") as stream:
                        prefix = stream.read(16)
                    selected["format"] = "mpp" if prefix.startswith(bytes.fromhex("d0cf11e0a1b11ae1")) else "mspdi"
            if selected["format"] in ("mpp", "mpt"):
                reader = self.jclass("org.mpxj.mpp.MPPReader")()
                reader.setUseRawTimephasedData(selected["raw_timephased"])
                reader.setReadPresentationData(True)
                reader.setReadPropertiesOnly(False)
                reader.setRespectPasswordProtection(True)
                if self.mpp_password_provider is not None:
                    password = self.mpp_password_provider(path)
                    if password is not None:
                        require(isinstance(password, str), "source_password", "The selected protected-source provider must return text.")
                        reader.setReadPassword(password)
            else:
                reader = self.jclass("org.mpxj.mspdi.MSPDIReader")()
                reader.setIgnoreErrors(selected["ignore_errors"])
                reader.setMicrosoftProjectCompatibleInput(selected["microsoft_compatible"])
                if selected["charset"]:
                    reader.setCharset(self.jclass("java.nio.charset.Charset").forName(selected["charset"]))
            project = reader.read(str(path.absolute()))
            require(project is not None, "native_empty", "The native reader returned no project.")
            return project, selected

    def write_mspdi(self, project, destination, profile=None):
        selected = output_profile(profile)
        with self.locked():
            writer = self.jclass("org.mpxj.mspdi.MSPDIWriter")()
            writer.setWriteTimephasedData(selected["write_timephased"])
            writer.setMicrosoftProjectCompatibleOutput(selected["microsoft_compatible"])
            writer.setSaveVersion(getattr(self.jclass("org.mpxj.mspdi.SaveVersion"), selected["save_version"]))
            writer.write(project, str(Path(destination).absolute()))
        return selected

    def _is(self, value, name):
        return isinstance(value, self.jclass(name))

    def _finding(self, findings, code, path, message, details=None):
        item = {"code": code, "severity": "review", "path": path,
                "message": message, "details": details}
        findings.append({"id": digest(item), **item})

    def _encode(self, value, findings, path):
        if value is None:
            return None
        if isinstance(value, bool) or self._is(value, "java.lang.Boolean"):
            return {"type": "boolean", "value": bool(value)}
        if isinstance(value, str) or self._is(value, "java.lang.String") or self._is(value, "java.lang.Character"):
            return {"type": "string", "value": str(value)}
        if self._is(value, "org.mpxj.Duration"):
            return {"type": "duration", "value": str(value.getDuration()),
                    "units": str(value.getUnits().name()), "elapsed": bool(value.getUnits().isElapsed())}
        if self._is(value, "org.mpxj.Rate"):
            return {"type": "rate", "value": str(value.getAmount()), "units": str(value.getUnits().name())}
        if isinstance(value, (int, float)) or self._is(value, "java.lang.Number"):
            class_name = str(value.getClass().getName()) if hasattr(value, "getClass") else type(value).__name__
            integer = class_name in ("java.lang.Integer", "java.lang.Long", "java.lang.Short", "java.lang.Byte", "java.math.BigInteger", "int")
            return {"type": "integer" if integer else "number", "value": str(value),
                    "java_class": class_name}
        for name, kind in (("LocalDateTime", "local_datetime"), ("LocalDate", "local_date"), ("LocalTime", "local_time")):
            if self._is(value, "java.time." + name):
                return {"type": kind, "value": str(value)}
        if self._is(value, "java.util.UUID"):
            return {"type": "string", "value": str(value), "java_class": "java.util.UUID"}
        if self._is(value, "java.lang.Enum"):
            return {"type": "enum", "value": str(value.name()),
                    "java_class": str(value.getDeclaringClass().getName())}
        if self._is(value, "org.mpxj.Priority"):
            return {"type": "integer", "value": str(value.getValue()), "java_class": "org.mpxj.Priority"}
        if self._is(value, "org.mpxj.TimephasedItem"):
            return {"type": "map", "java_class": str(value.getClass().getName()),
                    "value": {"start": self._encode(value.getStart(), findings, path + "/start"),
                              "finish": self._encode(value.getFinish(), findings, path + "/finish"),
                              "amount_per_hour": self._encode(value.getAmountPerHour(), findings, path + "/amount_per_hour"),
                              "total_amount": self._encode(value.getTotalAmount(), findings, path + "/total_amount")}}
        for name in ("LocalDateTimeRange", "LocalDateRange", "LocalTimeRange"):
            if self._is(value, "org.mpxj." + name):
                return {"type": "map", "java_class": "org.mpxj." + name,
                        "value": {"start": self._encode(value.getStart(), findings, path + "/start"),
                                  "end": self._encode(value.getEnd(), findings, path + "/end")}}
        if self._is(value, "org.mpxj.Relation"):
            return {"type": "reference", "value": self._relation(value, findings, path)}
        for name in ("Task", "Resource", "ResourceAssignment", "ProjectCalendar"):
            if self._is(value, "org.mpxj." + name):
                return {"type": "reference", "java_class": "org.mpxj." + name,
                        "value": {"uid": native_uid(value.getUniqueID())}}
        if self._is(value, "java.util.Map"):
            # Entries preserve key types and avoid JSON-key coercion or collisions.
            entries = [{"key": self._encode(e.getKey(), findings, path + "/key"),
                        "value": self._encode(e.getValue(), findings, path + "/value")}
                       for e in value.entrySet()]
            entries.sort(key=lambda e: canonical(e["key"]))
            return {"type": "map", "value": entries}
        if self._is(value, "java.util.Collection"):
            return {"type": "list", "value": [self._encode(item, findings, path + "/" + str(i))
                                              for i, item in enumerate(value)]}
        clazz = value.getClass() if hasattr(value, "getClass") else None
        if clazz is not None and clazz.isArray():
            if str(clazz.getComponentType().getName()) == "byte":
                return {"type": "native", "java_class": "[B", "encoding": "base64",
                        "value": base64.b64encode(bytes(int(v) & 255 for v in value)).decode("ascii")}
            return {"type": "list", "value": [self._encode(item, findings, path + "/" + str(i))
                                              for i, item in enumerate(value)]}
        if self._is(value, "org.mpxj.Notes"):
            result = {"type": "native", "java_class": str(value.getClass().getName()),
                      "encoding": "native-notes-text", "value": str(value)}
            # Inspect only named, public, zero-argument native format getters.
            # This preserves rich notes without manufacturing an HTML/RTF parser.
            for method in value.getClass().getMethods():
                name = str(method.getName())
                if name in {"getHtml", "getHTML", "getRtf", "getRTF"} and int(method.getParameterCount()) == 0:
                    result.setdefault("original_formats", {})[name] = str(getattr(value, name)())
            return result
        name = str(clazz.getName()) if clazz is not None else type(value).__name__
        self._finding(findings, "native_structured_value", path,
                      "The original native object and source remain available; select its supported target mapping explicitly.",
                      {"java_class": name})
        return {"type": "native", "java_class": name, "value": str(value)}

    def _fields(self, container, enum_name, udf, findings, path):
        declared = list(self.jclass("org.mpxj." + enum_name).values()) + list(udf)
        cached, fields, catalogue = {}, {}, {}
        # Capture every original cached field before any native calculated getter.
        for field in declared:
            name = str(field.name())
            catalogue[name] = {"name": str(field.getName()), "data_type": str(field.getDataType().name()),
                               "native_type": str(field.getDataType().getValue()),
                               "units_field": None if field.getUnitsType() is None else str(field.getUnitsType().name()),
                               "user_defined": not self._is(field, "java.lang.Enum")}
            try:
                value = container.getCachedValue(field)
                if value is not None:
                    cached[name] = self._encode(value, findings, path + "/cached_fields/" + name)
            except Exception as error:
                self._finding(findings, "native_cached_field", path + "/cached_fields/" + name,
                              str(error), {"native_field": name})
        for field in declared:
            name = str(field.name())
            try:
                value = container.get(field)
                if value is not None:
                    fields[name] = self._encode(value, findings, path + "/fields/" + name)
            except Exception as error:
                self._finding(findings, "native_calculated_field", path + "/fields/" + name,
                              str(error), {"native_field": name})
        return fields, cached, catalogue

    def _relation(self, relation, findings, path):
        predecessor, successor = relation.getPredecessorTask(), relation.getSuccessorTask()
        return {"uid": native_uid(relation.getUniqueID()),
                "predecessor_uid": native_uid(predecessor.getUniqueID()) if predecessor is not None else None,
                "successor_uid": native_uid(successor.getUniqueID()) if successor is not None else None,
                "type": str(relation.getType().name()),
                "lag": self._encode(relation.getLag(), findings, path + "/lag"),
                "notes": None if relation.getNotes() is None else str(relation.getNotes()),
                "driving": bool(relation.getDriving())}

    def _resource_details(self, resource, findings, path):
        tables = {}
        count = int(self.jclass("org.mpxj.CostRateTable").MAX_TABLES)
        rates = int(self.jclass("org.mpxj.CostRateTableEntry").MAX_RATES)
        for index in range(count):
            table = resource.getCostRateTable(index)
            tables[str(index)] = None if table is None else [{"start": self._encode(row.getStartDate(), findings, path + "/rate_start"),
                                   "end": self._encode(row.getEndDate(), findings, path + "/rate_end"),
                                   "cost_per_use": self._encode(row.getCostPerUse(), findings, path + "/cost_per_use"),
                                   "rates": {str(i): self._encode(row.getRate(i), findings, path + "/rates/" + str(i))
                                             for i in range(rates)}} for row in table]
        availability = [{"range": self._encode(row.getRange(), findings, path + "/availability"),
                         "units": self._encode(row.getUnits(), findings, path + "/availability/units")}
                        for row in resource.getAvailability()]
        return {"cost_rate_tables": tables, "availability": availability}

    def _calendar_details(self, calendar, findings, path):
        days = list(self.jclass("java.time.DayOfWeek").values())
        def hours(value, location):
            return None if value is None else [{"start": self._encode(item.getStart(), findings, location + "/start"),
                                                "end": self._encode(item.getEnd(), findings, location + "/end")}
                                               for item in value]
        def week(value, location):
            return {str(day.name()): {"type": self._encode(value.getCalendarDayType(day), findings, location),
                                     "hours": hours(value.getCalendarHours(day), location)}
                    for day in days}
        def recurrence(value, location):
            if value is None:
                return None
            getters = ("StartDate", "FinishDate", "Occurrences", "RecurrenceType", "UseEndDate",
                       "WorkingDaysOnly", "Relative", "Frequency", "DayOfWeek", "DayNumber", "MonthNumber")
            result = {name: self._encode(getattr(value, "get" + name)(), findings, location + "/" + name)
                      for name in getters}
            result["WeeklyDays"] = {str(day.name()): bool(value.getWeeklyDay(day)) for day in days}
            return result
        result = {"week": week(calendar, path + "/week"), "exceptions": [], "work_weeks": []}
        for index, value in enumerate(calendar.getCalendarExceptions()):
            location = path + "/exceptions/" + str(index)
            result["exceptions"].append({"name": None if value.getName() is None else str(value.getName()),
                                          "from": self._encode(value.getFromDate(), findings, location + "/from"),
                                          "to": self._encode(value.getToDate(), findings, location + "/to"),
                                          "working": bool(value.getWorking()),
                                          "hours": hours(value, location + "/hours"),
                                          "recurrence": recurrence(value.getRecurring(), location + "/recurrence")})
        for index, value in enumerate(calendar.getWorkWeeks()):
            location = path + "/work_weeks/" + str(index)
            result["work_weeks"].append({"name": None if value.getName() is None else str(value.getName()),
                                         "range": self._encode(value.getDateRange(), findings, location + "/range"),
                                         "week": week(value, location + "/week")})
        for label, getter in (("minutes_per_day", "getCalendarMinutesPerDay"),
                              ("minutes_per_week", "getCalendarMinutesPerWeek"),
                              ("minutes_per_month", "getCalendarMinutesPerMonth"),
                              ("minutes_per_year", "getCalendarMinutesPerYear")):
            result[label] = self._encode(getattr(calendar, getter)(), findings, path + "/" + label)
        return result

    def capture(self, project, provenance):
        require(isinstance(provenance, dict), "capture_provenance", "Retain the selected native source and reader provenance.")
        with self.locked():
            findings, catalogue = [], {}
            udf = project.getUserDefinedFields()
            model = {"schema": MODEL_SCHEMA, "native": self.ensure(),
                     "provenance": provenance, "findings": findings}
            fields, cached, catalogue["project"] = self._fields(
                project.getProjectProperties(), "ProjectField", udf.getProjectFields(), findings, "project")
            scalar = lambda row, name: row.get(name, {}).get("value")
            model["project"] = {"key": "project", "uid": scalar(fields, "UNIQUE_ID"),
                                "guid": scalar(fields, "GUID"), "fields": fields, "cached_fields": cached}
            families = (("tasks", project.getTasks(), "TaskField", udf.getTaskFields()),
                        ("resources", project.getResources(), "ResourceField", udf.getResourceFields()),
                        ("assignments", project.getResourceAssignments(), "AssignmentField", udf.getAssignmentFields()))
            for family, objects, enum_name, user_fields in families:
                rows = []
                for ordinal, item in enumerate(objects):
                    uid = native_uid(item.getUniqueID())
                    path = family + "/" + (uid if uid is not None else "row:" + str(ordinal))
                    fields, cached, types = self._fields(item, enum_name, user_fields, findings, path)
                    catalogue[family] = types
                    row = {"uid": uid, "guid": scalar(fields, "GUID"), "fields": fields, "cached_fields": cached}
                    if family == "tasks":
                        row["parent_uid"] = native_uid(item.getParentTaskUniqueID())
                    elif family == "assignments":
                        row.update(task_uid=native_uid(item.getTaskUniqueID()),
                                   resource_uid=native_uid(item.getResourceUniqueID()))
                    else:
                        row["native_details"] = self._resource_details(item, findings, path)
                    rows.append(row)
                make_keys(rows, family, findings)
                model[family] = rows
            dependencies = [self._relation(row, findings, "dependencies/" + str(i))
                            for i, row in enumerate(project.getRelations())]
            for row in dependencies:
                row.update(guid=None, fields={}, cached_fields={})
            make_keys(dependencies, "dependencies", findings)
            model["dependencies"] = dependencies
            output = self.jclass("java.io.ByteArrayOutputStream")()
            writer = self.jclass("org.mpxj.json.JsonWriter")()
            writer.setPretty(True)
            writer.setCharset(self.jclass("java.nio.charset.StandardCharsets").UTF_8)
            writer.setIncludeLayoutData(True)
            writer.setWriteAttributeTypes(True)
            writer.setWriteTimephasedData(True)
            writer.write(project, output)
            native_raw = bytes((int(value) & 255) for value in output.toByteArray())
            native_json = json.loads(native_raw)
            model["native_json"] = native_json
            model["native_json_text"] = native_raw.decode("utf-8")
            model["native_json_identity"] = {"sha256": hashlib.sha256(native_raw).hexdigest(), "bytes": len(native_raw)}
            calendars = []
            json_calendars = {}
            for row in native_json.get("calendars", []):
                json_calendars.setdefault(native_uid(row.get("unique_id")), []).append(row)
            for ordinal, original in enumerate(project.getCalendars()):
                uid = native_uid(original.getUniqueID())
                matches = json_calendars.get(uid, [])
                row = matches[0] if len(matches) == 1 else None
                if len(matches) > 1:
                    self._finding(findings, "calendar_json_identity", "calendars/" + str(ordinal),
                                  "The native JSON contains repeated calendar UIDs; the full native calendar is retained.",
                                  {"uid": uid, "matches": len(matches)})
                exact = self._calendar_details(original, findings, "calendars/" + str(ordinal))
                calendars.append({"uid": uid, "guid": native_uid(original.getGUID()),
                                  "parent_uid": native_uid(original.getParentUniqueID()),
                                  "fields": {}, "cached_fields": {}, "native": row, "native_details": exact})
            make_keys(calendars, "calendars", findings)
            model["calendars"] = calendars
            for error in project.getIgnoredErrors():
                self._finding(findings, "native_ignored_parse_error", "source", str(error),
                              {"java_class": str(error.getClass().getName())})
            model["field_catalogue"] = catalogue
            model["counts"] = {family: len(model[family]) for family in SINGULAR if family != "project"}
            model["counts"]["fields"] = sum(len(row["fields"]) for family in FAMILY_TYPES
                                           for row in ([model["project"]] if family == "project" else model[family]))
            model["findings"] = list({row["id"]: row for row in findings}.values())
            return model

    def _decode_scalar(self, value, data_type, current):
        if value is None:
            return None
        require(isinstance(value, dict) and value.get("type") in SCALAR_TYPES,
                "correction_type", "Choose a supported typed native scalar correction.", value)
        kind, raw = value["type"], value["value"]
        allowed = TYPE_COMPATIBILITY.get(data_type)
        if allowed is not None:
            require(kind in allowed, "correction_type", "The correction does not match the native field type.",
                    {"data_type": data_type, "value": value})
        elif kind != "enum":
            require(current is not None and self._encode(current, [], "value").get("type") == kind,
                    "correction_type", "The native field requires its current exact typed representation.")
        if kind == "boolean":
            require(type(raw) is bool, "correction_boolean", "A boolean correction must be true or false.")
            return self.jclass("java.lang.Boolean")(raw)
        if kind == "string":
            require(isinstance(raw, str), "correction_string", "A text correction must be complete text.")
            if data_type == "GUID":
                return self.jclass("java.util.UUID").fromString(raw)
            if data_type == "NOTES":
                return self.jclass("org.mpxj.Notes")(raw)
            if data_type == "CHAR":
                require(len(raw) == 1, "correction_character", "Choose one native character.")
                return self.jclass("java.lang.Character")(raw)
            return self.jclass("java.lang.String")(raw)
        if kind == "integer":
            require(isinstance(raw, str) and raw.lstrip("-").isdigit(), "correction_integer", "Use an exact integer string.")
            if data_type == "PRIORITY":
                return self.jclass("org.mpxj.Priority").getInstance(int(raw))
            return self.jclass("java.lang.Short")(int(raw)) if data_type == "SHORT" else self.jclass("java.lang.Integer")(int(raw))
        if kind == "number":
            require(isinstance(raw, str), "correction_number", "Use an exact decimal string.")
            require(math.isfinite(float(raw)), "correction_number", "Choose a finite native number.")
            name = str(current.getClass().getName()) if current is not None and hasattr(current, "getClass") else "java.lang.Double"
            if name == "java.math.BigDecimal":
                return self.jclass(name)(raw)
            return self.jclass("java.lang.Float" if name == "java.lang.Float" else "java.lang.Double").valueOf(raw)
        if kind in ("local_datetime", "local_date", "local_time"):
            cls = {"local_datetime": "LocalDateTime", "local_date": "LocalDate", "local_time": "LocalTime"}[kind]
            return self.jclass("java.time." + cls).parse(raw)
        if kind in ("duration", "rate"):
            require(isinstance(raw, str) and math.isfinite(float(raw)) and isinstance(value.get("units"), str),
                    "correction_duration", "Use an exact native amount and TimeUnit name.")
            units = self.jclass("org.mpxj.TimeUnit").valueOf(value["units"])
            if kind == "duration":
                return self.jclass("org.mpxj.Duration").getInstance(float(raw), units)
            return self.jclass("org.mpxj.Rate")(float(raw), units)
        require(kind == "enum" and current is not None and self._is(current, "java.lang.Enum"),
                "correction_enum", "Select a member of the original native enum.")
        classname = str(current.getDeclaringClass().getName())
        require(value.get("java_class", classname) == classname,
                "correction_enum", "The correction belongs to a different native enum.")
        return self.jclass(classname).valueOf(raw)

    def apply_corrections(self, project, corrections):
        require(isinstance(corrections, list), "corrections", "Supply the reviewed correction list.")
        if not corrections:
            return project
        with self.locked():
            model = self.capture(project, {"kind": "native-correction-preimage"})
            native = {"project": [project.getProjectProperties()], "tasks": list(project.getTasks()),
                      "resources": list(project.getResources()), "assignments": list(project.getResourceAssignments())}
            chosen = []
            seen = set()
            for correction in corrections:
                require(isinstance(correction, dict) and set(correction) == {"family", "key", "field", "before", "after"},
                        "correction_shape", "Supply family, key, native field, before and after values.")
                family, key, name = correction["family"], correction["key"], correction["field"]
                require(family in FAMILY_TYPES and isinstance(name, str) and name not in IDENTITY_FIELDS,
                        "correction_identity", "Keep original project, hierarchy and link identities; change a supported native value.")
                rows = [model["project"]] if family == "project" else model[family]
                matches = [(index, row) for index, row in enumerate(rows) if row["key"] == key]
                require(len(matches) == 1, "correction_target", "Choose one original native entity key.", correction)
                index, row = matches[0]
                require((family, key, name) not in seen, "duplicate_correction", "Review a native field once per correction edition.")
                seen.add((family, key, name))
                require(row["fields"].get(name) == correction["before"],
                        "correction_preimage", "The selected native field differs from the reviewed value.", correction)
                enum = self.jclass("org.mpxj." + FAMILY_TYPES[family])
                try:
                    field = enum.valueOf(name)
                except Exception as error:
                    getters = {"project": "getProjectFields", "tasks": "getTaskFields",
                               "resources": "getResourceFields", "assignments": "getAssignmentFields"}
                    fields = getattr(project.getUserDefinedFields(), getters[family])()
                    matches = [candidate for candidate in fields if str(candidate.name()) == name]
                    require(len(matches) == 1, "correction_field",
                            "Choose a declared enum or unique original user-defined field.", name)
                    field = matches[0]
                obj = native[family][index]
                current = obj.get(field)
                changed = self._decode_scalar(correction["after"], str(field.getDataType().name()), current)
                chosen.append((obj, field, changed, correction))
            for obj, field, changed, correction in chosen:
                obj.set(field, changed)
                actual = self._encode(obj.get(field), [], "corrected/" + correction["field"])
                expected = self._encode(changed, [], "reviewed/" + correction["field"])
                # Native getter side effects are retained in the derived model.
                # Compare the selected semantic scalar, including duration units.
                for name in ("type", "value", "units", "elapsed", "java_class", "encoding"):
                    if expected is not None and name in expected:
                        require(actual is not None and actual.get(name) == expected[name],
                                "native_correction_result", "The native getter did not retain the reviewed correction.",
                                {"correction": correction, "actual": actual})
                if expected is None:
                    require(actual is None, "native_correction_result",
                            "The native engine recalculates this field after a clear; choose an explicit source correction.",
                            {"correction": correction, "actual": actual})
            return project
