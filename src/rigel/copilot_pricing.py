from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
from pathlib import Path
from typing import Any
from urllib.parse import urlparse
from urllib.request import Request, urlopen

import yaml

SOURCE_URL = (
    "https://raw.githubusercontent.com/github/docs/main/"
    "data/tables/copilot/models-and-pricing.yml"
)
UNIT = "USD per 1 million tokens"
VALID_CATEGORIES = {"Lightweight", "Versatile", "Powerful"}
PROVIDER_ORDER = {
    "openai": 0,
    "anthropic": 1,
    "google": 2,
    "github": 3,
    "microsoft": 4,
    "xai": 5,
    "moonshot_ai": 6,
}
CSV_FIELDS = [
    "provider",
    "model",
    "release_status",
    "category",
    "tier",
    "threshold_operator",
    "threshold_tokens",
    "input_usd_per_million_tokens",
    "cached_input_usd_per_million_tokens",
    "cache_write_usd_per_million_tokens",
    "output_usd_per_million_tokens",
    "notes",
]
_PRICE_FIELDS = {
    "input": "input_usd_per_million_tokens",
    "cached_input": "cached_input_usd_per_million_tokens",
    "cache_write": "cache_write_usd_per_million_tokens",
    "output": "output_usd_per_million_tokens",
}
_FOOTNOTE_RE = re.compile(r"\[\^([^\]]+)\]")
_THRESHOLD_RE = re.compile(r"^(≤|<=|<|>|≥|>=)\s*([\d,.]+)\s*([KMB]?)$", re.I)


def read_source(source: str) -> bytes:
    parsed = urlparse(source)
    if parsed.scheme in {"http", "https"}:
        request = Request(source, headers={"User-Agent": "rigel-pricing/0.1"})
        with urlopen(request, timeout=30) as response:
            return response.read()
    return Path(source).read_bytes()


def parse_price(value: Any, field: str) -> float | None:
    if value is None or (
        isinstance(value, str) and value.strip().lower() == "not applicable"
    ):
        return None
    if isinstance(value, bool):
        raise ValueError(f"{field} must be a price, got {value!r}")
    if isinstance(value, (int, float)):
        price = float(value)
    elif isinstance(value, str):
        cleaned = value.strip().replace("$", "").replace(",", "")
        try:
            price = float(cleaned)
        except ValueError as error:
            raise ValueError(f"{field} must be a USD price, got {value!r}") from error
    else:
        raise ValueError(f"{field} must be a price, got {value!r}")
    if price < 0:
        raise ValueError(f"{field} cannot be negative")
    return price


def parse_threshold(value: Any) -> tuple[str | None, int | None]:
    if value is None or str(value).strip().lower() == "not applicable":
        return None, None

    text = str(value).strip()
    match = _THRESHOLD_RE.fullmatch(text)
    if not match:
        raise ValueError(f"Unsupported input-token threshold: {value!r}")

    symbol, amount_text, suffix = match.groups()
    multipliers = {"": 1, "K": 1_000, "M": 1_000_000, "B": 1_000_000_000}
    amount = float(amount_text.replace(",", "")) * multipliers[suffix.upper()]
    if not amount.is_integer():
        raise ValueError(f"Input-token threshold is not an integer: {value!r}")
    operators = {"≤": "lte", "<=": "lte", "<": "lt", ">": "gt", "≥": "gte", ">=": "gte"}
    return operators[symbol], int(amount)


def clean_model_name(value: Any) -> tuple[str, list[str]]:
    if not isinstance(value, str) or not value.strip():
        raise ValueError("Every pricing row must have a model name")
    annotations = _FOOTNOTE_RE.findall(value)
    model = _FOOTNOTE_RE.sub("", value).strip()
    return model, annotations


def normalize_rows(source_bytes: bytes) -> list[dict[str, Any]]:
    loaded = yaml.safe_load(source_bytes)
    if not isinstance(loaded, list):
        raise ValueError("Expected the upstream pricing document to contain a YAML list")

    rows: list[dict[str, Any]] = []
    identities: set[tuple[Any, ...]] = set()
    for index, raw in enumerate(loaded, start=1):
        if not isinstance(raw, dict):
            raise ValueError(f"Pricing row {index} must be a mapping")

        provider = raw.get("provider")
        if not isinstance(provider, str) or not provider.strip():
            raise ValueError(f"Pricing row {index} must have a provider")
        provider = provider.strip().lower()
        model, annotations = clean_model_name(raw.get("model"))
        threshold_operator, threshold_tokens = parse_threshold(raw.get("threshold"))
        tier = str(raw.get("tier") or "Default").strip()
        category = str(raw.get("category") or "").strip()
        if category not in VALID_CATEGORIES:
            raise ValueError(f"Pricing row {index} has unsupported category {category!r}")

        row: dict[str, Any] = {
            "provider": provider,
            "model": model,
            "release_status": str(raw.get("release_status") or "").strip(),
            "category": category,
            "tier": tier,
            "threshold_operator": threshold_operator,
            "threshold_tokens": threshold_tokens,
        }
        for upstream_name, normalized_name in _PRICE_FIELDS.items():
            row[normalized_name] = parse_price(raw.get(upstream_name), upstream_name)

        notes = raw.get("notes")
        note_parts = [str(notes).strip()] if notes else []
        note_parts.extend(f"Upstream footnote: {annotation}" for annotation in annotations)
        row["notes"] = "; ".join(note_parts)

        identity = (provider, model.casefold(), tier.casefold(), threshold_operator, threshold_tokens)
        if identity in identities:
            raise ValueError(f"Duplicate pricing tier for {provider}/{model}/{tier}")
        identities.add(identity)
        rows.append(row)

    rows.sort(
        key=lambda row: (
            PROVIDER_ORDER.get(row["provider"], len(PROVIDER_ORDER)),
            row["provider"],
            row["model"].casefold(),
            0 if row["tier"].casefold() == "default" else 1,
            row["threshold_tokens"] or 0,
        )
    )
    return rows


def _display_price(value: float | None) -> str:
    if value is None:
        return "—"
    return f"${value:.6f}".rstrip("0").rstrip(".")


def _display_threshold(row: dict[str, Any]) -> str:
    operator = row["threshold_operator"]
    tokens = row["threshold_tokens"]
    if operator is None or tokens is None:
        return "—"
    symbols = {"lte": "≤", "lt": "<", "gt": ">", "gte": "≥"}
    if tokens % 1_000_000 == 0:
        amount = f"{tokens // 1_000_000}M"
    elif tokens % 1_000 == 0:
        amount = f"{tokens // 1_000}K"
    else:
        amount = f"{tokens:,}"
    return f"{symbols[operator]} {amount}"


def render_markdown(rows: list[dict[str, Any]], source_hash: str) -> str:
    lines = [
        "# Normalized GitHub Copilot model pricing",
        "",
        f"Prices are {UNIT}. Missing or inapplicable prices are shown as `—`.",
        f"Source: [`github/docs` pricing YAML]({SOURCE_URL})",
        f"Source SHA-256: `{source_hash}`",
        "",
        "| Provider | Model | Status | Category | Tier | Input threshold | Input | Cached input | Cache write | Output |",
        "| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |",
    ]
    for row in rows:
        cells = [
            row["provider"],
            row["model"],
            row["release_status"],
            row["category"],
            row["tier"],
            _display_threshold(row),
            _display_price(row["input_usd_per_million_tokens"]),
            _display_price(row["cached_input_usd_per_million_tokens"]),
            _display_price(row["cache_write_usd_per_million_tokens"]),
            _display_price(row["output_usd_per_million_tokens"]),
        ]
        lines.append("| " + " | ".join(str(cell).replace("|", "\\|") for cell in cells) + " |")
    return "\n".join(lines) + "\n"


def write_outputs(source_bytes: bytes, rows: list[dict[str, Any]], output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    source_hash = hashlib.sha256(source_bytes).hexdigest()

    document = {
        "schema_version": 1,
        "unit": UNIT,
        "source": {"url": SOURCE_URL, "sha256": source_hash},
        "prices": rows,
    }
    serialized_document = json.dumps(document, indent=2, ensure_ascii=False)
    (output_dir / "copilot-pricing.json").write_text(
        serialized_document + "\n",
        encoding="utf-8",
    )
    (output_dir / "copilot-pricing.js").write_text(
        f"window.RIGEL_PRICING = {serialized_document};\n",
        encoding="utf-8",
    )

    with (output_dir / "copilot-pricing.csv").open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=CSV_FIELDS)
        writer.writeheader()
        writer.writerows(rows)

    (output_dir / "copilot-pricing.md").write_text(
        render_markdown(rows, source_hash), encoding="utf-8"
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Fetch and normalize GitHub Copilot model pricing."
    )
    parser.add_argument("--source", default=SOURCE_URL, help="Upstream YAML URL or local path")
    parser.add_argument("--output-dir", type=Path, default=Path("data"))
    return parser


def main() -> None:
    args = build_parser().parse_args()
    source_bytes = read_source(args.source)
    rows = normalize_rows(source_bytes)
    write_outputs(source_bytes, rows, args.output_dir)
    print(f"Normalized {len(rows)} pricing rows into {args.output_dir}")


if __name__ == "__main__":
    main()
