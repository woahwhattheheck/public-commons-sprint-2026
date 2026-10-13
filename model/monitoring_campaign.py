"""Complete calendar planning and source-station field events for monitoring plans."""
from __future__ import annotations
from datetime import date, datetime, time, timedelta
from decimal import Decimal, InvalidOperation
from typing import Any
from .monitoring_common import ContractError


def integer(value: Any, name: str, minimum: int = 0) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise ContractError(f"{name} must be an integer >= {minimum}")
    return value


def money_cents(value: Any, name: str) -> int:
    if isinstance(value, bool):
        raise ContractError(f"{name} must be a nonnegative exact monetary amount")
    try:
        amount = Decimal(str(value))
        if not amount.is_finite() or amount < 0 or amount * 100 != (amount * 100).to_integral_value():
            raise ValueError()
        cents = int(amount * 100)
        if cents > 10**12:
            raise ValueError()
        return cents
    except (InvalidOperation, ValueError, TypeError) as exc:
        raise ContractError(f"{name} must be nonnegative with at most two decimal places") from exc


def dollars(cents: int) -> str:
    return f"{Decimal(cents) / 100:.2f}"


def parse_date(value: Any, name: str) -> date:
    try:
        if not isinstance(value, str):
            raise ValueError()
        return date.fromisoformat(value)
    except ValueError as exc:
        raise ContractError(f"{name} must be an ISO date YYYY-MM-DD") from exc


def rounds(config: dict) -> list[dict]:
    start = parse_date(config.get("start_date"), "start_date")
    end = parse_date(config.get("end_date"), "end_date")
    if end < start or (end - start).days > 3660:
        raise ContractError("calendar must span 0 through 3660 days")
    interval = integer(config.get("interval_days", 30), "interval_days", 1)
    window = integer(config.get("round_window_days", min(interval, 7)), "round_window_days", 1)
    if window > interval:
        raise ContractError("round_window_days cannot exceed interval_days")
    allowed = config.get("weekdays", [0, 1, 2, 3, 4])
    if not isinstance(allowed, list) or not allowed or any(type(day) is not int or day not in range(7) for day in allowed):
        raise ContractError("weekdays must be a nonempty array of integers 0..6")
    blackouts = {parse_date(value, "blackout date") for value in config.get("blackout_dates", [])}
    months = config.get("months", list(range(1, 13)))
    if not isinstance(months, list) or not months or any(type(m) is not int or m not in range(1, 13) for m in months):
        raise ContractError("months must be a nonempty array of integers 1..12")
    result, nominal = [], start
    while nominal <= end:
        deadline = min(nominal + timedelta(days=window - 1), end)
        if nominal.month in months:
            dates = [nominal + timedelta(days=i) for i in range((deadline - nominal).days + 1)]
            dates = [d for d in dates if d.weekday() in allowed and d not in blackouts and d.month in months]
            if not dates:
                raise ContractError(f"round beginning {nominal} has no eligible field date before {deadline}")
            result.append({"round": len(result) + 1, "nominal_date": nominal.isoformat(),
                           "deadline": deadline.isoformat(), "eligible_dates": [d.isoformat() for d in dates]})
        nominal += timedelta(days=interval)
    if not result:
        raise ContractError("campaign has no sampling rounds under the supplied month/date restrictions")
    return result


def field_capacity(config: dict) -> dict:
    visit = integer(config.get("visit_minutes", 60), "visit_minutes", 1)
    travel = integer(config.get("travel_buffer_minutes", 30), "travel_buffer_minutes")
    minutes = integer(config.get("crew_day_minutes", 480), "crew_day_minutes", 1)
    crews = integer(config.get("crews", 1), "crews", 1)
    if crews > 1000 or minutes > 24 * 60:
        raise ContractError("crews must be <= 1000 and crew_day_minutes <= 1440")
    try:
        start = time.fromisoformat(config.get("day_start", "08:00"))
        if start.tzinfo or start.second or start.microsecond:
            raise ValueError()
    except (ValueError, TypeError) as exc:
        raise ContractError("day_start must be local HH:MM without seconds or timezone") from exc
    if start.hour * 60 + start.minute + minutes > 1440:
        raise ContractError("field day extends past local midnight")
    slots = minutes // (visit + travel)
    if not slots:
        raise ContractError("a complete visit plus explicit travel allowance does not fit in the field day")
    return {"crews": crews, "slots_per_crew_day": slots, "visit_minutes": visit,
            "travel_buffer_minutes": travel, "day_start": start.strftime("%H:%M"),
            "crew_day_minutes": minutes}


def calendar_site_capacity(config: dict) -> int:
    capacity = field_capacity(config)
    return min(len(r["eligible_dates"]) * capacity["crews"] * capacity["slots_per_crew_day"] for r in rounds(config))


def build_calendar(selected_ids: list[str], config: dict, *, site_labels: dict | None = None) -> dict:
    selected = sorted(selected_ids)
    if len(selected) != len(set(selected)):
        raise ContractError("calendar site IDs must be unique")
    capacity = field_capacity(config)
    schedule = []
    for item in rounds(config):
        available = len(item["eligible_dates"]) * capacity["crews"] * capacity["slots_per_crew_day"]
        if len(selected) > available:
            raise ContractError(f"round {item['round']}: {len(selected)} sites exceed {available} field slots")
        for index, site in enumerate(selected):
            slots = capacity["slots_per_crew_day"]
            per_day = capacity["crews"] * slots
            day_index, rest = divmod(index, per_day)
            crew, slot = divmod(rest, slots)
            dt = datetime.combine(date.fromisoformat(item["eligible_dates"][day_index]), time.fromisoformat(capacity["day_start"]))
            begin = dt + timedelta(minutes=slot * (capacity["visit_minutes"] + capacity["travel_buffer_minutes"]))
            finish = begin + timedelta(minutes=capacity["visit_minutes"])
            schedule.append({"visit_key": f"r{item['round']}:{site}", "round": item["round"],
                             "site_id": site, "site_label": (site_labels or {}).get(site, site),
                             "date": begin.date().isoformat(), "start_local": begin.strftime("%H:%M"),
                             "finish_local": finish.strftime("%H:%M"), "crew": crew + 1,
                             "round_deadline": item["deadline"], "status": "planned"})
    return {"rounds": rounds(config), "field_capacity": capacity, "visits": schedule,
            "scheduling_basis": "local calendar slots; explicit travel allowance, not a routed travel-time model",
            "planning_unit": "source catchment search area until an actual source station is bound"}


def cost_table(network: dict, config: dict, calendar: dict) -> tuple[dict[str, int], dict]:
    n_rounds = len(rounds(calendar))
    default = config.get("default_cost")
    specific = config.get("site_costs", {})
    if not isinstance(specific, dict):
        raise ContractError("site_costs must be an object keyed by catchment ID")
    unknown = set(specific) - set(network["nodes"])
    if unknown:
        raise ContractError(f"site_costs contains unknown catchments: {sorted(unknown)}")
    costs, details = {}, {}
    for key in sorted(network["nodes"]):
        values = specific.get(key, default)
        if not isinstance(values, dict) or "setup" not in values or "per_visit" not in values:
            raise ContractError(f"site {key}: explicit setup and per_visit planning costs are required")
        setup = money_cents(values["setup"], f"{key}.setup")
        visit = money_cents(values["per_visit"], f"{key}.per_visit")
        costs[key] = setup + visit * n_rounds
        details[key] = {"setup_cents": setup, "per_visit_cents": visit, "rounds": n_rounds,
                        "total_cents": costs[key], "basis": str(values.get("basis", "operator planning estimate"))}
    return costs, details
