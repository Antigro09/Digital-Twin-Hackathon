from __future__ import annotations

from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from .errors import DomainError
from .models import Calendar


class WorkingCalendar:
    def __init__(self, timezone_name: str, calendar: Calendar) -> None:
        try:
            self.zone = ZoneInfo(timezone_name)
        except ZoneInfoNotFoundError as exc:
            raise DomainError("invalid_calendar", f"Unknown IANA timezone: {timezone_name}") from exc
        hour, minute = (int(part) for part in calendar.workday_start.split(":"))
        self.start_time = time(hour, minute)
        self.hours_per_day = calendar.hours_per_workday
        self.working_weekdays = frozenset(calendar.working_weekdays)
        self.holidays = frozenset(calendar.holidays)

    def _start(self, local_day: date) -> datetime:
        return datetime.combine(local_day, self.start_time, tzinfo=self.zone)

    def _end(self, local_day: date) -> datetime:
        return self._start(local_day) + timedelta(hours=self.hours_per_day)

    def is_working_day(self, local_day: date) -> bool:
        return local_day.isoweekday() in self.working_weekdays and local_day not in self.holidays

    def next_working_start(self, local_day: date) -> datetime:
        candidate = local_day
        for _ in range(3700):
            if self.is_working_day(candidate):
                return self._start(candidate)
            candidate += timedelta(days=1)
        raise DomainError("invalid_calendar", "No working day exists within the calendar guardrail.")

    def normalize(self, instant: datetime) -> datetime:
        local = instant.astimezone(self.zone)
        if not self.is_working_day(local.date()):
            return self.next_working_start(local.date() + timedelta(days=1))
        start = self._start(local.date())
        end = self._end(local.date())
        if local < start:
            return start
        if local >= end:
            return self.next_working_start(local.date() + timedelta(days=1))
        return local

    def add_workdays(self, instant: datetime, workdays: float) -> datetime:
        if workdays < 0:
            raise DomainError("invalid_duration", "Negative working duration is not supported.")
        current = self.normalize(instant)
        remaining_seconds = workdays * self.hours_per_day * 3600.0
        if remaining_seconds == 0:
            return current
        for _ in range(2_000_000):
            end = self._end(current.date())
            available = max(0.0, (end - current).total_seconds())
            if remaining_seconds <= available + 1e-9:
                return current + timedelta(seconds=remaining_seconds)
            remaining_seconds -= available
            current = self.next_working_start(current.date() + timedelta(days=1))
        raise DomainError("simulation_too_large", "Working-time calculation exceeded its safety bound.", status_code=413)

    def working_days_between(self, start: datetime, end: datetime) -> float:
        if start == end:
            return 0.0
        if end < start:
            return -self.working_days_between(end, start)
        current = self.normalize(start)
        if current >= end.astimezone(self.zone):
            return 0.0
        target = end.astimezone(self.zone)
        seconds = 0.0
        for _ in range(2_000_000):
            if current >= target:
                break
            day_end = self._end(current.date())
            segment_end = min(day_end, target)
            if segment_end > current:
                seconds += (segment_end - current).total_seconds()
            if day_end >= target:
                break
            current = self.next_working_start(current.date() + timedelta(days=1))
        else:
            raise DomainError("simulation_too_large", "Working-time difference exceeded its safety bound.", status_code=413)
        return seconds / (self.hours_per_day * 3600.0)

    def local_date(self, instant: datetime) -> date:
        return instant.astimezone(self.zone).date()

    def target_cutoff(self, target: date) -> datetime:
        # Exclusive start of the next local civil date; it is intentionally not
        # normalized to a working instant.
        return datetime.combine(target + timedelta(days=1), time.min, tzinfo=self.zone)

