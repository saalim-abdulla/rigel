# Rigel

Rigel tracks and normalizes GitHub Copilot model pricing and includes an experimental VS Code supervisor for transparent, cost-aware model use.

## Current outputs

- [`data/copilot-pricing.md`](data/copilot-pricing.md) — human-readable unified table
- [`data/copilot-pricing.csv`](data/copilot-pricing.csv) — spreadsheet-friendly rows
- [`data/copilot-pricing.json`](data/copilot-pricing.json) — typed data for later analysis
- [`data/copilot-pricing.js`](data/copilot-pricing.js) — browser-ready copy for opening the static UI directly

The source is GitHub's own structured [`models-and-pricing.yml`](https://github.com/github/docs/blob/main/data/tables/copilot/models-and-pricing.yml), which feeds the public [Copilot models and pricing](https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing) page. Prices are USD per one million tokens.

## Browse the pricing

Open [`web/index.html`](web/index.html) directly, or start a local static server from the repository root:

```bash
python -m http.server 8000
```

Then visit <http://localhost:8000/web/>. The prototype includes three layouts, live search, provider/category/context filters, an output-price ceiling, and sorting. Use the floating switcher or the left/right arrow keys to compare layouts A, B, and C.

## Try the VS Code supervisor

The experimental extension lives in [`extension/`](extension/). It registers an `@rigel` chat participant that uses Copilot models through VS Code's official Language Model interface, performs a bounded tool loop, and stops repeated actions or errors.

```bash
cd extension
npm install
npm test
```

Open either the repository root or `extension/` in VS Code, press `F5`, choose **Run Rigel Extension**, and enter this in Chat inside the Extension Development Host:

```text
@rigel review this repository and pick up where we left off
```

Use `/lightweight`, `/versatile`, or `/powerful` to select one of GitHub's model categories, `/orchestrate` to create a Powerful-model task plan for approval, `/run` to execute its tasks sequentially, `/favorite` to choose a preferred model in each category, `/refresh` to fetch GitHub's latest catalog on demand, and `/rescue` after Rigel opens its circuit breaker. Without a favorite, Rigel selects the cheapest available model in the requested category. Rigel has no backend or telemetry, and write or command tools require confirmation. See [`extension/README.md`](extension/README.md) for usage and [`docs/architecture/vscode-supervisor.md`](docs/architecture/vscode-supervisor.md) for the architecture, threat model, and current limitations.

## Refresh

Requires Python 3.11 or newer.

```bash
python -m pip install -e .
rigel-sync
```

A scheduled GitHub Actions workflow runs daily and opens a pull request when the generated pricing data changes. It can also be started manually from the Actions tab.

## Test

```bash
PYTHONPATH=src python3 -m unittest discover -s tests
cd extension && npm test
```

## Scope

The pricing browser does not claim that price alone determines the best model: useful recommendations must combine price with task-specific quality, latency, context-window, and availability evidence. The VS Code extension uses GitHub's categories, favorites, published prices for the starting context size, and deterministic supervision. More sophisticated task-quality evidence is a later step.

See [`docs/research/copilot-model-pricing-sources.md`](docs/research/copilot-model-pricing-sources.md) for source selection, existing projects, and caveats.
