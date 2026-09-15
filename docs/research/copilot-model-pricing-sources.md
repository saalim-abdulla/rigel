# GitHub Copilot model pricing sources

Research performed on 2026-09-05.

## Recommendation

Use GitHub's structured pricing YAML as the ingestion source, rather than scraping the rendered documentation page:

- Canonical data: [`github/docs/data/tables/copilot/models-and-pricing.yml`](https://github.com/github/docs/blob/main/data/tables/copilot/models-and-pricing.yml)
- Raw data URL: [`raw.githubusercontent.com/.../models-and-pricing.yml`](https://raw.githubusercontent.com/github/docs/main/data/tables/copilot/models-and-pricing.yml)
- Human-readable page: [Models and pricing for GitHub Copilot](https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing)
- Page template: [`content/copilot/reference/copilot-billing/models-and-pricing.md`](https://github.com/github/docs/blob/main/content/copilot/reference/copilot-billing/models-and-pricing.md)

The page template renders each provider table from `tables.copilot.models-and-pricing`. The YAML therefore avoids brittle HTML parsing while remaining the first-party source used by the published page. Its commit history also provides a first-party audit trail of additions, removals, and pricing changes: [file commit history](https://github.com/github/docs/commits/main/data/tables/copilot/models-and-pricing.yml).

The source states that all values are USD prices per one million tokens and provides model, provider, release status, category, tier, input-token threshold, input, cached-input, cache-write, and output fields. Not every provider supplies every field, so a normalized format must represent missing values explicitly.

## Normalized shape

Each price tier becomes one row with:

- provider and cleaned model name
- release status and GitHub's category
- tier
- normalized threshold operator and integer token count
- numeric input, cached-input, cache-write, and output prices
- source notes/annotations

Long-context prices remain separate rows. Missing or inapplicable prices become `null`; they must not be treated as zero.

## Existing projects

Several public repositories overlap with the idea:

1. [`fstandhartinger/model-market-comparison`](https://github.com/fstandhartinger/model-market-comparison) is the closest match to the broader vision. Its README says it compares capability and normalized prices across GitHub Copilot, OpenRouter, Bedrock, Azure AI Foundry, Vertex AI, Claude Code, and other providers. It also combines pricing with coding and agent benchmarks. However, its documented refresh process describes Copilot data as a manually scraped snapshot, and GitHub reports no repository license. It is useful as product/design research, but its code or data should not be copied without permission.
2. [`madeindigio/copilot-models-pricing-comparator`](https://github.com/madeindigio/copilot-models-pricing-comparator) is a small Copilot/OpenRouter web comparator. At the time checked, its README was still the default Vite template and GitHub reported no repository license.
3. [`ftison/gh-copilot-pricing-tui`](https://github.com/ftison/gh-copilot-pricing-tui) is an MIT-licensed terminal UI that fetches the GitHub Docs page and parses provider tables on each run. It is useful if the only goal is interactive viewing, but it does not present itself as a historical monitor or cross-provider task recommender.

Conclusion: the broader product already has a close analogue, but there is still a clear implementation niche for a small, auditable, first-party-source pipeline that tracks GitHub's structured data and later joins it to benchmark/task evidence. Before expanding substantially, evaluate whether contributing monitoring improvements to `model-market-comparison` would be preferable to maintaining another full comparison application.

## Caveats

- Prices alone cannot determine the best model for a task. The next stage needs task-specific quality evidence, latency, context limits, availability, and a declared workload/token mix.
- GitHub's category labels (`Lightweight`, `Versatile`, `Powerful`) are useful metadata, not independent benchmark results.
- The rendered page can include explanatory footnotes (for example, promotional expiry dates) outside the YAML table. If those terms become decision inputs, monitor the page template or its referenced reusable content in addition to the pricing YAML.
- GitHub's code-review feature may select an undisclosed model, so it cannot be optimized using the visible model rows alone. The official pricing page explicitly calls out this exception.
