# Normalized GitHub Copilot model pricing

Prices are USD per 1 million tokens. Missing or inapplicable prices are shown as `—`.
Source: [`github/docs` pricing YAML](https://raw.githubusercontent.com/github/docs/main/data/tables/copilot/models-and-pricing.yml)
Source SHA-256: `5102545cdc2cc19a71a648c47c259c0281794836ba49eb6fb6170aeb57cb2fd8`

| Provider | Model | Status | Category | Tier | Input threshold | Input | Cached input | Cache write | Output |
| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| openai | GPT-5 mini | GA | Lightweight | Default | — | $0.25 | $0.025 | — | $2 |
| openai | GPT-5.3-Codex | GA | Powerful | Default | — | $1.75 | $0.175 | — | $14 |
| openai | GPT-5.4 | GA | Versatile | Default | ≤ 272K | $2.5 | $0.25 | — | $15 |
| openai | GPT-5.4 | GA | Versatile | Long context | > 272K | $5 | $0.5 | — | $22.5 |
| openai | GPT-5.4 mini | GA | Lightweight | Default | — | $0.75 | $0.075 | — | $4.5 |
| openai | GPT-5.4 nano | GA | Lightweight | Default | — | $0.2 | $0.02 | — | $1.25 |
| openai | GPT-5.5 | GA | Powerful | Default | ≤ 272K | $5 | $0.5 | — | $30 |
| openai | GPT-5.5 | GA | Powerful | Long context | > 272K | $10 | $1 | — | $45 |
| openai | GPT-5.6 Luna | GA | Lightweight | Default | ≤ 200K | $0.2 | $0.02 | $0.25 | $1.2 |
| openai | GPT-5.6 Luna | GA | Lightweight | Long context | > 200K | $0.4 | $0.04 | $0.5 | $1.8 |
| openai | GPT-5.6 Sol | GA | Powerful | Default | ≤ 272K | $4 | $0.4 | $5 | $20 |
| openai | GPT-5.6 Sol | GA | Powerful | Long context | > 272K | $8 | $0.8 | $10 | $30 |
| openai | GPT-5.6 Terra | GA | Versatile | Default | ≤ 272K | $2 | $0.2 | $2.5 | $12 |
| openai | GPT-5.6 Terra | GA | Versatile | Long context | > 272K | $4 | $0.4 | $5 | $18 |
| openai | GPT-6 Astra | GA | Powerful | Default | ≤ 272K | $10 | $1 | $12.5 | $50 |
| openai | GPT-6 Astra | GA | Powerful | Long context | > 272K | $20 | $2 | $25 | $75 |
| anthropic | Claude Fable 5 | GA | Powerful | Default | — | $10 | $1 | $12.5 | $50 |
| anthropic | Claude Fable 5.1 | GA | Powerful | Default | — | $10 | $0.25 | $12.5 | $50 |
| anthropic | Claude Haiku 4.5 | GA | Versatile | Default | — | $1 | $0.1 | $1.25 | $5 |
| anthropic | Claude Opus 4.7 | GA | Powerful | Default | — | $5 | $0.5 | $6.25 | $25 |
| anthropic | Claude Opus 4.8 | GA | Powerful | Default | — | $5 | $0.5 | $6.25 | $25 |
| anthropic | Claude Opus 4.8 (fast mode) (preview) | GA | Powerful | Default | — | $10 | $1 | $12.5 | $50 |
| anthropic | Claude Opus 5 | GA | Powerful | Default | — | $5 | $0.5 | $6.25 | $25 |
| anthropic | Claude Sonnet 4 | GA | Versatile | Default | — | $3 | $0.3 | $3.75 | $15 |
| anthropic | Claude Sonnet 4.6 | GA | Versatile | Default | — | $3 | $0.3 | $3.75 | $15 |
| anthropic | Claude Sonnet 5 | GA | Versatile | Default | — | $2 | $0.2 | $2.5 | $10 |
| google | Gemini 3.5 Flash | GA | Lightweight | Default | — | $1.5 | $0.15 | — | $9 |
| google | Gemini 3.6 Flash | GA | Versatile | Default | — | $0.75 | $0.075 | — | $3.75 |
| google | Gemini 3.7 Flash | GA | Versatile | Default | — | $0.75 | $0.075 | — | $3.75 |
| google | Gemini 3.8 Flash | GA | Versatile | Default | — | $0.75 | $0.075 | — | $3.75 |
| microsoft | MAI-Code-1.1-Flash | GA | Lightweight | Default | — | $0.2 | $0.02 | — | $1.2 |
| xai | Grok 4.5 | GA | Versatile | Default | ≤ 200K | $2 | $0.5 | — | $6 |
| xai | Grok 4.5 | GA | Versatile | Long context | > 200K | $4 | $1 | — | $12 |
| xai | Grok 4.6 | GA | Versatile | Default | ≤ 200K | $2 | $0.5 | — | $6 |
| xai | Grok 4.6 | GA | Versatile | Long context | > 200K | $4 | $1 | — | $12 |
| moonshot_ai | Kimi K2.7 Code | GA | Versatile | Default | — | $0.95 | $0.19 | — | $4 |
| moonshot_ai | Kimi K3 | GA | Powerful | Default | — | $3 | $0.3 | — | $15 |
