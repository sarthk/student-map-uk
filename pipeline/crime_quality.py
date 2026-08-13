"""Shared validation and audit metadata for police.uk street-crime inputs.

Raw downloads are intentionally retained between refreshes.  A build must
therefore select (not merely discover) one exact, contiguous rolling window and
make incomplete force submissions visible to downstream users.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import json
from pathlib import Path
import re
from typing import Iterable, Sequence


STREET_FILENAME_RE = re.compile(
    r"(?P<month>\d{4}-\d{2})-(?P<force>[a-z0-9-]+)-street\.csv"
)


class CrimeDataQualityError(RuntimeError):
    """Raised when raw inputs cannot support an honest rolling-window build."""


@dataclass(frozen=True)
class StreetFile:
    path: Path
    month: str
    force: str


def _month_parts(month: str) -> tuple[int, int]:
    """Validate and split a canonical ``YYYY-MM`` month."""
    if not re.fullmatch(r"\d{4}-\d{2}", month):
        raise ValueError(f"invalid month {month!r}; expected YYYY-MM")
    year, number = (int(part) for part in month.split("-"))
    if year < 1 or not 1 <= number <= 12:
        raise ValueError(f"invalid calendar month {month!r}")
    return year, number


def trailing_months(latest: str, count: int) -> list[str]:
    """Return ``count`` contiguous months, oldest first, ending at ``latest``."""
    if count <= 0:
        raise ValueError("month count must be positive")
    year, month = _month_parts(latest)
    result: list[str] = []
    for _ in range(count):
        result.append(f"{year:04d}-{month:02d}")
        month -= 1
        if month == 0:
            year, month = year - 1, 12
    return list(reversed(result))


def discover_street_files(raw_dir: Path) -> list[StreetFile]:
    """Discover canonical raw files and reject paths that could double-count."""
    found: list[StreetFile] = []
    seen: dict[tuple[str, str], Path] = {}
    for path in sorted(raw_dir.rglob("*-street.csv")):
        match = STREET_FILENAME_RE.fullmatch(path.name)
        if match is None:
            raise CrimeDataQualityError(f"non-canonical street CSV filename: {path}")
        month, force = match.group("month"), match.group("force")
        try:
            _month_parts(month)
        except ValueError as exc:
            raise CrimeDataQualityError(str(exc)) from exc
        if path.parent.name != month:
            raise CrimeDataQualityError(
                f"street CSV is under {path.parent.name!r}, but filename month is {month}: {path}"
            )
        key = (month, force)
        if key in seen:
            raise CrimeDataQualityError(
                f"duplicate force-month input {month}/{force}: {seen[key]} and {path}"
            )
        seen[key] = path
        found.append(StreetFile(path=path, month=month, force=force))
    return found


def select_latest_window(
    files: Sequence[StreetFile], count: int
) -> tuple[list[StreetFile], list[str]]:
    """Select the newest exact rolling window, ignoring retained older files.

    Every calendar month must have at least one street file. Per-force gaps are
    assessed separately because police.uk occasionally publishes genuine
    submission gaps for an otherwise valid month.
    """
    if not files:
        raise CrimeDataQualityError("no canonical street CSVs found")
    latest = max(item.month for item in files)
    months = trailing_months(latest, count)
    window = set(months)
    selected = [item for item in files if item.month in window]
    observed = {item.month for item in selected}
    missing = [month for month in months if month not in observed]
    if missing:
        raise CrimeDataQualityError(
            f"cannot build an exact {count}-month window ending {latest}; "
            f"no street files for: {', '.join(missing)}"
        )
    return selected, months


def force_month_coverage(
    files: Sequence[StreetFile], months: Sequence[str], expected_forces: Iterable[str]
) -> dict:
    """Return a JSON-safe expected-vs-observed force/month coverage audit."""
    month_set = set(months)
    forces = tuple(sorted(set(expected_forces)))
    expected = {(month, force) for month in months for force in forces}
    observed = {(item.month, item.force) for item in files if item.month in month_set}
    observed_expected = observed & expected
    missing = sorted(expected - observed)
    unexpected = sorted(observed - expected)
    expected_count = len(expected)
    ratio = len(observed_expected) / expected_count if expected_count else 1.0
    return {
        "expected_forces": list(forces),
        "observed_forces": sorted({force for _, force in observed}),
        "expected_force_months": expected_count,
        "observed_force_months": len(observed),
        "observed_expected_force_months": len(observed_expected),
        "coverage_ratio": round(ratio, 4),
        "missing_force_months": [[month, force] for month, force in missing],
        "unexpected_force_months": [[month, force] for month, force in unexpected],
    }


def utc_timestamp() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def quality_metadata(
    files: Sequence[StreetFile],
    months: Sequence[str],
    expected_forces: Iterable[str],
    *,
    generated_at: str | None = None,
) -> dict:
    """Build the optional metadata block embedded in national-details.json."""
    coverage = force_month_coverage(files, months, expected_forces)
    complete = not coverage["missing_force_months"]
    return {
        "schema_version": 1,
        "generated_at": generated_at or utc_timestamp(),
        "window": {
            "start": months[0],
            "end": months[-1],
            "months": len(months),
            "contiguous": True,
        },
        "coverage": coverage,
        "denominator": {
            "source": "ONS Census 2021 TS001",
            "vintage": 2021,
            "geography": "2021 LSOA",
        },
        "completeness_status": "complete" if complete else "partial",
    }


def write_manifest(path: Path, metadata: dict) -> None:
    """Atomically replace the local, regenerable coverage manifest."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(metadata, indent=2, allow_nan=False) + "\n")
    temporary.replace(path)
