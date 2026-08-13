from __future__ import annotations

from pathlib import Path
import sys
import unittest


PROJECT_DIR = Path(__file__).resolve().parents[2]
if str(PROJECT_DIR) not in sys.path:
    sys.path.insert(0, str(PROJECT_DIR))

from serve import parse_range_header


class RangeHeaderTests(unittest.TestCase):
    def test_closed_range(self) -> None:
        self.assertEqual(parse_range_header("bytes=10-19", 100), (10, 19))

    def test_open_range(self) -> None:
        self.assertEqual(parse_range_header("bytes=90-", 100), (90, 99))

    def test_suffix_range(self) -> None:
        self.assertEqual(parse_range_header("bytes=-10", 100), (90, 99))

    def test_invalid_or_unsatisfiable_range(self) -> None:
        self.assertIsNone(parse_range_header("bytes=100-", 100))
        self.assertIsNone(parse_range_header("bytes=20-10", 100))
        self.assertIsNone(parse_range_header("bytes=0-1,4-5", 100))


if __name__ == "__main__":
    unittest.main()
