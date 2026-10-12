# MIT. Reused fixed-stop GTFS parser, calendar and instance engine.
# Function bodies match the maintained transit engine Git blob
# 2926b9bfd280e93ee93c6f6229343c1f6e01aafb.
import collections, csv, datetime as dt, hashlib, io, pathlib, re, zipfile

TABLES = ("agency", "routes", "trips", "stop_times", "stops", "calendar", "calendar_dates",
          "feed_info", "frequencies", "transfers", "attributions", "shapes")
WEEKDAYS = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")

def require(ok, message):
    if not ok:
        raise ValueError(message)

def sha(data):
    return hashlib.sha256(data).hexdigest()

def time_seconds(value):
    if not value:
        return None
    require(bool(re.fullmatch(r"\d{1,3}:[0-5]\d:[0-5]\d", value)), f"Invalid GTFS time: {value}")
    h, m, s = map(int, value.split(":"))
    return 3600 * h + 60 * m + s

def clock(seconds):
    if seconds is None:
        return ""
    return f"{seconds//3600:02d}:{seconds//60%60:02d}:{seconds%60:02d}"

def dates(start, end):
    a, b = dt.date.fromisoformat(start), dt.date.fromisoformat(end)
    require(a <= b and (b-a).days < 367, "Select one to 367 service dates.")
    return [(a+dt.timedelta(days=n)).isoformat() for n in range((b-a).days+1)]

def indexed(rows, field):
    result = {}
    for row in rows:
        require(row.get(field) and row[field] not in result, f"Missing or duplicate {field}: {row}")
        result[row[field]] = row
    return result

def load_feed(path):
    raw = pathlib.Path(path).read_bytes()
    require(len(raw) <= 16*1024*1024, "Feed archive exceeds this source workshare's 16 MiB input limit.")
    data, catalog = {}, []
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        names = archive.namelist()
        require(len(names) == len(set(names)), "Duplicate ZIP member names.")
        require(sum(x.file_size for x in archive.infolist()) <= 128*1024*1024,
                "Feed expands beyond 128 MiB.")
        for entry in archive.infolist():
            require(not entry.is_dir() and "/" not in entry.filename and "\\" not in entry.filename,
                    "GTFS members must be files at the archive root.")
            catalog.append({"name":entry.filename, "bytes":entry.file_size, "crc32":f"{entry.CRC:08x}"})
        for name in TABLES:
            file = name + ".txt"
            if file not in names:
                data[name] = []
                continue
            contents = archive.read(file).decode("utf-8-sig")
            reader = csv.DictReader(io.StringIO(contents))
            require(reader.fieldnames and len(reader.fieldnames) == len(set(reader.fieldnames)),
                    f"Invalid columns: {file}")
            rows = []
            for n, row in enumerate(reader, 2):
                require(None not in row and all(v is not None for v in row.values()), f"Invalid CSV row {file}:{n}")
                rows.append(row)
            data[name] = rows
    for name in ("agency", "routes", "trips", "stop_times", "stops"):
        require(data[name], f"Required {name}.txt is empty or missing.")
    require(data["calendar"] or data["calendar_dates"], "The feed has no service calendar.")
    if len(data["agency"]) == 1 and not data["agency"][0].get("agency_id"):
        data["agency"][0]["agency_id"] = "_single_agency"
    agency = indexed(data["agency"], "agency_id")
    for row in data["routes"]:
        if not row.get("agency_id"):
            require(len(agency)==1, "Multi-agency route lacks agency_id.")
            row["agency_id"] = next(iter(agency))
        require(row["agency_id"] in agency, f"Unknown route agency {row['agency_id']}")
    routes, trips, stops = (indexed(data[n], k) for n,k in
                           (("routes","route_id"),("trips","trip_id"),("stops","stop_id")))
    stop_times = collections.defaultdict(list)
    seen = set()
    for row in data["stop_times"]:
        require(row["trip_id"] in trips and row.get("stop_id") in stops, "Unknown trip or fixed stop reference.")
        key = (row["trip_id"], int(row["stop_sequence"]))
        require(key not in seen, f"Duplicate stop sequence: {key}")
        seen.add(key)
        stop_times[row["trip_id"]].append({**row, "sequence":key[1],
                                         "arrival":time_seconds(row.get("arrival_time")),
                                         "departure":time_seconds(row.get("departure_time"))})
    for trip_id, trip in trips.items():
        require(trip["route_id"] in routes, f"Unknown route for trip {trip_id}")
        points = sorted(stop_times[trip_id], key=lambda x:x["sequence"])
        require(len(points)>=2, f"Trip {trip_id} has fewer than two stops.")
        require(points[0]["departure"] is not None and points[-1]["arrival"] is not None,
                f"Trip {trip_id} lacks endpoint schedule times.")
        last = None
        for point in points:
            for field in ("arrival","departure"):
                value = point[field]
                if value is not None:
                    require(last is None or value>=last, f"Non-monotone times in trip {trip_id}")
                    last = value
        stop_times[trip_id] = points
    frequencies = collections.defaultdict(list)
    for row in data["frequencies"]:
        require(row["trip_id"] in trips, "Unknown frequency trip.")
        row = {**row, "start":time_seconds(row["start_time"]), "end":time_seconds(row["end_time"]),
               "headway":int(row["headway_secs"])}
        require(row["start"] is not None and row["end"]>row["start"] and row["headway"]>0,
                "Invalid frequency interval.")
        frequencies[row["trip_id"]].append(row)
    for rows in frequencies.values():
        rows.sort(key=lambda x:x["start"])
        require(all(a["end"]<=b["start"] for a,b in zip(rows,rows[1:])), "Overlapping frequency intervals.")
    calendar = indexed(data["calendar"], "service_id")
    exceptions = {}
    for row in data["calendar_dates"]:
        key = (row["service_id"], row["date"])
        require(key not in exceptions and row["exception_type"] in ("1","2"), "Invalid calendar exception.")
        exceptions[key] = row["exception_type"]
    for row in trips.values():
        require(row["service_id"] in calendar or any(k[0]==row["service_id"] for k in exceptions),
                f"Trip uses undefined service {row['service_id']}")
    return {"sha256":sha(raw), "bytes":len(raw), "catalog":catalog, "data":data,
            "agency":agency, "routes":routes, "trips":trips, "stops":stops,
            "stop_times":stop_times, "frequencies":frequencies,
            "calendar":calendar, "exceptions":exceptions}

def active(feed, service, day):
    date = dt.date.fromisoformat(day)
    stamp = date.strftime("%Y%m%d")
    exception = feed["exceptions"].get((service,stamp))
    if exception:
        return exception == "1"
    row = feed["calendar"].get(service)
    return bool(row and row["start_date"]<=stamp<=row["end_date"] and row[WEEKDAYS[date.weekday()]]=="1")

def instances(feed, selected_dates):
    result, frequency_windows = [], []
    for day in selected_dates:
        for tid, trip in feed["trips"].items():
            if not active(feed,trip["service_id"],day):
                continue
            points = feed["stop_times"][tid]
            starts = [(points[0]["departure"], 0)]
            if tid in feed["frequencies"]:
                starts = []
                for row in feed["frequencies"][tid]:
                    if row.get("exact_times","0") != "1":
                        frequency_windows.append({"date":day, "trip_id":tid, "route_id":trip["route_id"],
                            "start":clock(row["start"]), "end":clock(row["end"]), "headway_seconds":row["headway"],
                            "kind":"UNSCHEDULED_FREQUENCY_WINDOW"})
                    else:
                        starts.extend((t,t-points[0]["departure"]) for t in range(row["start"],row["end"],row["headway"]))
            for origin, shift in starts:
                route = feed["routes"][trip["route_id"]]
                result.append({"id":f"{day}/{tid}/{origin}", "date":day, "trip_id":tid,
                    "route_id":trip["route_id"], "agency_id":route["agency_id"],
                    "direction_id":trip.get("direction_id",""), "headsign":trip.get("trip_headsign",""),
                    "block_id":trip.get("block_id",""), "shape_id":trip.get("shape_id",""),
                    "start":origin, "end":points[-1]["arrival"]+shift, "shift_seconds":shift,
                    "kind":"PUBLISHED_SCHEDULE", "source_instance":None})
    return result, frequency_windows

