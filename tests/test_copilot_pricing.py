import csv
import json
import tempfile
import unittest
from pathlib import Path

from rigel.copilot_pricing import normalize_rows, parse_price, parse_threshold, write_outputs


SAMPLE = b"""
- model: 'Gemini Test[^promo]'
  provider: google
  release_status: GA
  category: Versatile
  threshold: Not applicable
  tier: Default
  input: $0.75
  cached_input: $0.075
  output: $3.75
- model: Model Long
  provider: openai
  release_status: Public preview
  category: Powerful
  threshold: '> 272K'
  tier: Long context
  input: $5.00
  cached_input: $0.50
  cache_write: Not applicable
  output: $22.50
"""


class PricingNormalizationTests(unittest.TestCase):
    def test_parses_prices_and_absent_values(self) -> None:
        self.assertEqual(parse_price("$0.075", "input"), 0.075)
        self.assertIsNone(parse_price("Not applicable", "cache_write"))
        self.assertIsNone(parse_price(None, "cache_write"))

    def test_parses_thresholds_into_operator_and_token_count(self) -> None:
        self.assertEqual(parse_threshold("<= 272K"), ("lte", 272_000))
        self.assertEqual(parse_threshold("> 1.5M"), ("gt", 1_500_000))
        self.assertEqual(parse_threshold("Not applicable"), (None, None))

    def test_normalizes_provider_rows_and_footnotes(self) -> None:
        rows = normalize_rows(SAMPLE)
        self.assertEqual(rows[0]["provider"], "openai")
        self.assertEqual(rows[0]["threshold_tokens"], 272_000)
        self.assertIsNone(rows[0]["cache_write_usd_per_million_tokens"])
        self.assertEqual(rows[1]["model"], "Gemini Test")
        self.assertEqual(rows[1]["notes"], "Upstream footnote: promo")

    def test_rejects_unknown_threshold_syntax(self) -> None:
        with self.assertRaisesRegex(ValueError, "Unsupported input-token threshold"):
            parse_threshold("around 200K")

    def test_rejects_unknown_model_category(self) -> None:
        source = SAMPLE.replace(b"category: Versatile", b"category: Experimental")
        with self.assertRaisesRegex(ValueError, "unsupported category"):
            normalize_rows(source)

    def test_writes_json_csv_and_markdown(self) -> None:
        rows = normalize_rows(SAMPLE)
        with tempfile.TemporaryDirectory() as directory:
            output_dir = Path(directory)
            write_outputs(SAMPLE, rows, output_dir)

            document = json.loads((output_dir / "copilot-pricing.json").read_text())
            self.assertEqual(document["schema_version"], 1)
            self.assertEqual(len(document["prices"]), 2)

            browser_data = (output_dir / "copilot-pricing.js").read_text()
            self.assertTrue(browser_data.startswith("window.RIGEL_PRICING = {"))
            self.assertIn('"Gemini Test"', browser_data)

            with (output_dir / "copilot-pricing.csv").open(newline="") as handle:
                csv_rows = list(csv.DictReader(handle))
            self.assertEqual(csv_rows[1]["model"], "Gemini Test")

            markdown = (output_dir / "copilot-pricing.md").read_text()
            self.assertIn("| google | Gemini Test |", markdown)
            self.assertIn("$0.075", markdown)


if __name__ == "__main__":
    unittest.main()
