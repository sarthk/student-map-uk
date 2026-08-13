from __future__ import annotations

import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

import pandas as pd


PIPELINE_DIR = Path(__file__).resolve().parents[1]
if str(PIPELINE_DIR) not in sys.path:
    sys.path.insert(0, str(PIPELINE_DIR))

import build_national
import config
import download
from crime_quality import (CrimeDataQualityError, StreetFile,
                           discover_street_files, force_month_coverage,
                           quality_metadata, select_latest_window,
                           trailing_months)


CSV_HEADER = "LSOA code,LSOA name,Month,Crime type\n"


def write_street(raw: Path, month: str, force: str = "test-force", *,
                 content_month: str | None = None, crime_type: str = "Burglary") -> Path:
    folder = raw / month
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{month}-{force}-street.csv"
    path.write_text(
        CSV_HEADER + f"E01000001,Example 001A,{content_month or month},{crime_type}\n"
    )
    return path


class MonthWindowTests(unittest.TestCase):
    def test_trailing_months_crosses_year_in_chronological_order(self) -> None:
        self.assertEqual(
            trailing_months("2026-02", 4),
            ["2025-11", "2025-12", "2026-01", "2026-02"],
        )

    def test_invalid_calendar_month_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            trailing_months("2026-13", 12)

    def test_latest_exact_window_ignores_retained_old_file(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            raw = Path(td)
            for month in trailing_months("2026-04", 13):
                write_street(raw, month)
            discovered = discover_street_files(raw)
            selected, months = select_latest_window(discovered, 12)
            self.assertEqual(months[0], "2025-05")
            self.assertEqual(months[-1], "2026-04")
            self.assertEqual(len(selected), 12)
            self.assertNotIn("2025-04", {item.month for item in selected})

    def test_missing_calendar_month_rejects_window(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            raw = Path(td)
            months = trailing_months("2026-04", 12)
            for month in months:
                if month != "2025-11":
                    write_street(raw, month)
            with self.assertRaisesRegex(CrimeDataQualityError, "2025-11"):
                select_latest_window(discover_street_files(raw), 12)


class CoverageTests(unittest.TestCase):
    def test_force_month_manifest_exposes_partial_coverage(self) -> None:
        months = ["2026-01", "2026-02"]
        files = [
            StreetFile(Path("a"), "2026-01", "alpha"),
            StreetFile(Path("b"), "2026-02", "alpha"),
            StreetFile(Path("c"), "2026-01", "beta"),
            StreetFile(Path("d"), "2026-01", "transport"),
        ]
        coverage = force_month_coverage(files, months, ("alpha", "beta"))
        self.assertEqual(coverage["expected_force_months"], 4)
        self.assertEqual(coverage["observed_expected_force_months"], 3)
        self.assertEqual(coverage["coverage_ratio"], 0.75)
        self.assertEqual(coverage["missing_force_months"], [["2026-02", "beta"]])
        self.assertEqual(
            coverage["unexpected_force_months"], [["2026-01", "transport"]]
        )
        metadata = quality_metadata(
            files, months, ("alpha", "beta"), generated_at="2026-08-14T00:00:00Z"
        )
        self.assertEqual(metadata["completeness_status"], "partial")
        self.assertEqual(metadata["denominator"]["vintage"], 2021)


class NationalAggregationTests(unittest.TestCase):
    def test_aggregate_uses_only_latest_twelve_months(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            raw = root / "raw"
            for month in trailing_months("2026-04", 13):
                write_street(raw, month)
            manifest = root / "interim" / "crime-coverage.json"
            with mock.patch.object(config, "RAW_DIR", raw), \
                    mock.patch.object(config, "CRIME_COVERAGE_MANIFEST", manifest), \
                    mock.patch.object(config, "ENGLAND_WALES_FORCES", ("test-force",)):
                out, months, quality = build_national.aggregate_national()
            self.assertEqual(months, trailing_months("2026-04", 12))
            self.assertEqual(int(out.loc["E01000001", "t_res"]), 12)
            self.assertEqual(out.loc["E01000001", "monthly_counts"], [1] * 12)
            self.assertEqual(quality["completeness_status"], "complete")
            self.assertTrue(manifest.exists())

    def test_csv_month_must_match_its_filename(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            raw = root / "raw"
            months = trailing_months("2026-04", 12)
            for month in months:
                write_street(raw, month)
            write_street(raw, "2026-04", content_month="2026-03")
            with mock.patch.object(config, "RAW_DIR", raw), \
                    mock.patch.object(config, "CRIME_COVERAGE_MANIFEST", root / "manifest.json"), \
                    mock.patch.object(config, "ENGLAND_WALES_FORCES", ("test-force",)):
                with self.assertRaisesRegex(CrimeDataQualityError, "filename says 2026-04"):
                    build_national.aggregate_national()

    def test_unknown_category_fails_instead_of_disappearing_from_all_crime(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            raw = root / "raw"
            for month in trailing_months("2026-04", 12):
                write_street(raw, month)
            write_street(raw, "2026-04", crime_type="New category")
            with mock.patch.object(config, "RAW_DIR", raw), \
                    mock.patch.object(config, "CRIME_COVERAGE_MANIFEST", root / "manifest.json"), \
                    mock.patch.object(config, "ENGLAND_WALES_FORCES", ("test-force",)):
                with self.assertRaisesRegex(CrimeDataQualityError, "unrecognised Crime type"):
                    build_national.aggregate_national()


class BuildRegressionTests(unittest.TestCase):
    def test_rates_require_quality_metadata(self) -> None:
        frame = pd.DataFrame({"t_all": [1]}, index=["E01000001"])
        boundaries = {"features": []}
        with self.assertRaisesRegex(CrimeDataQualityError, "quality metadata is required"):
            build_national.build_table(frame, boundaries, 12)

    def test_unmapped_force_gap_stops_the_build(self) -> None:
        with self.assertRaisesRegex(CrimeDataQualityError, "cannot safely publish"):
            build_national.coverage_gap_areas([["2026-04", "unmapped-force"]])

    def test_force_month_gap_areas_are_excluded_from_rates(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            pop = root / "population.csv"
            pop.write_text(
                f"{config.POP_COL_CODE},{config.POP_COL_VALUE}\n"
                "E01000001,1500\nE01000002,1500\n"
            )
            zero_categories = {category: 0 for category in config.ALL_CRIME_TYPES}
            frame = pd.DataFrame.from_dict({
                "E01000001": {"lsoa21nm": "Manchester 001A", "t_res": 1,
                    "t_foot": 1, "t_all": 2, "by_category": zero_categories,
                    "monthly_counts": [0] * 12},
                "E01000002": {"lsoa21nm": "Leeds 001A", "t_res": 12,
                    "t_foot": 12, "t_all": 24, "by_category": zero_categories,
                    "monthly_counts": [1] * 12},
            }, orient="index")
            frame.attrs["crime_quality"] = {"coverage": {"missing_force_months": [
                ["2026-04", "greater-manchester"]
            ]}}
            boundaries = {"features": [
                {"properties": {config.BOUNDARY_FIELD_CODE: code,
                    config.BOUNDARY_FIELD_NAME: row["lsoa21nm"]}}
                for code, row in frame.iterrows()
            ]}
            with mock.patch.object(config, "POP_CSV", pop), \
                    mock.patch.object(build_national, "load_price", return_value={}), \
                    mock.patch.object(build_national, "load_rent", return_value={}), \
                    mock.patch.object(build_national, "load_lsoa_lad", return_value={}):
                result = build_national.build_table(
                    frame, boundaries, 12,
                    {"coverage": {"missing_force_months": [
                        ["2026-04", "greater-manchester"],
                    ]}},
                )
            self.assertTrue(result.loc["E01000001", "coverage_unavailable"])
            self.assertTrue(pd.isna(result.loc["E01000001", "r_all"]))
            self.assertTrue(pd.isna(result.loc["E01000001", "p_all"]))
            self.assertFalse(result.loc["E01000002", "coverage_unavailable"])
            self.assertFalse(pd.isna(result.loc["E01000002", "r_all"]))

    def test_out_of_region_rows_use_current_total_column(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            pop = root / "population.csv"
            pop.write_text(
                f"{config.POP_COL_CODE},{config.POP_COL_VALUE}\nE01000001,1500\n"
            )
            zero_categories = {category: 0 for category in config.ALL_CRIME_TYPES}
            frame = pd.DataFrame.from_dict(
                {
                    "E01000001": {
                        "lsoa21nm": "Example 001A", "t_res": 3, "t_foot": 2,
                        "t_all": 5, "by_category": zero_categories,
                        "monthly_counts": [0] * 12,
                    },
                    "S01000001": {
                        "lsoa21nm": "Outside", "t_res": 4, "t_foot": 3,
                        "t_all": 7, "by_category": zero_categories,
                        "monthly_counts": [0] * 12,
                    },
                }, orient="index"
            )
            boundaries = {"features": [{"properties": {
                config.BOUNDARY_FIELD_CODE: "E01000001",
                config.BOUNDARY_FIELD_NAME: "Example 001A",
            }}]}
            with mock.patch.object(config, "POP_CSV", pop), \
                    mock.patch.object(build_national, "load_price", return_value={}), \
                    mock.patch.object(build_national, "load_rent", return_value={}), \
                    mock.patch.object(build_national, "load_lsoa_lad", return_value={}):
                result = build_national.build_table(
                    frame, boundaries, 12,
                    {"coverage": {"missing_force_months": []}},
                )
            self.assertEqual(list(result.index), ["E01000001"])
            self.assertEqual(int(result.loc["E01000001", "t_all"]), 5)

    def test_output_additions_are_backwards_compatible(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            interim = root / "interim"
            web = root / "web"
            code = "E01000001"
            row = {
                "lsoa21nm": "Example 001A", "pop": 1500, "low_pop_flag": False,
                "price": 200000, "price_pctl": 0.4, "yield": 5.5, "yield_pctl": 0.6,
                "by_category": {category: 0 for category in config.ALL_CRIME_TYPES},
                "monthly_counts": [1] * 12,
            }
            for suffix in build_national.BUNDLE_CODE.values():
                row.update({f"t_{suffix}": 12, f"r_{suffix}": 8.0,
                            f"p_{suffix}": 0.2, f"h_{suffix}": False})
            frame = pd.DataFrame.from_dict({code: row}, orient="index")
            boundaries = {"features": [{
                "type": "Feature", "geometry": None,
                "properties": {config.BOUNDARY_FIELD_CODE: code,
                               config.BOUNDARY_FIELD_NAME: "Example 001A"},
            }]}
            quality = {"completeness_status": "complete"}
            with mock.patch.object(config, "INTERIM_DIR", interim), \
                    mock.patch.object(config, "NATIONAL_SLIM_GEOJSON", interim / "slim.json"), \
                    mock.patch.object(config, "WEB_DATA_DIR", web), \
                    mock.patch.object(config, "NATIONAL_DETAILS", web / "details.json"), \
                    mock.patch.object(config, "NATIONAL_FILTER", web / "filter.json"), \
                    mock.patch.object(config, "NATIONAL_META", web / "meta.json"):
                build_national.write_outputs(
                    frame, boundaries, 12, trailing_months("2026-04", 12), quality
                )
            details = json.loads((web / "details.json").read_text())
            index = json.loads((web / "filter.json").read_text())
            metadata = json.loads((web / "meta.json").read_text())
            self.assertEqual(details["quality"], quality)
            self.assertEqual(metadata["crime_window_end"], "2026-04")
            self.assertEqual(metadata["area_count"], 1)
            self.assertEqual(
                index["fields"][:5], ["code", "name", "crime_pctl_res", "price", "yield"]
            )
            self.assertEqual(index["rows"][0][:5], [code, "Example 001A", 0.2, 200000, 5.5])
            self.assertEqual(index["rows"][0][5:], [12, 1500, 8.0])

    def test_custom_route_cannot_silently_claim_national_download(self) -> None:
        with self.assertRaisesRegex(ValueError, "one force only"):
            download.download_crime("custom", keep_archive=False, force=None)


if __name__ == "__main__":
    unittest.main()
