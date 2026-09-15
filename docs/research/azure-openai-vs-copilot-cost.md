# Azure OpenAI in VS Code or Zed vs. GitHub Copilot cost

**Research date:** 2026-09-05

**Scope:** USD list-price comparison for using an Azure OpenAI deployment from VS Code or Zed versus buying GitHub Copilot. Only Microsoft/Azure, GitHub, VS Code, and Zed first-party sources are used.

## Executive conclusion

**Azure OpenAI can be cheaper for light, chat-only use, but connecting it to an editor does not make it free.** VS Code and Zed send requests to the user's Azure resource, where tokens and any tools, storage, provisioned throughput, or other services remain billable. The editor is a client, not an Azure allowance.

At current individual prices, and treating the same workload as having the same dollar-denominated model/tool cost in either service, Azure pay-as-you-go is cheaper while monthly use is below the Copilot subscription fee: **$10 for Pro, $39 for Pro+, or $100 for Max**. Above that point, Copilot's included AI Credits make the subscription cheaper. Current total monthly allowances are worth **$15, $70, and $200**, respectively, so the maximum recurring advantage over equivalent pay-as-you-go usage is **$5, $31, and $100** before considering Copilot's unlimited paid-plan code completions.

This is not a feature-equivalent comparison. A bring-your-own-model connection does not reproduce all Copilot-only capabilities. Copilot can therefore be the better coding-product value even before raw token break-even, while Azure can be preferable for low use, deployment control, identity, networking, data-boundary, or governance requirements.

## The three cost layers

1. **Editor or integration.** Installing or configuring a provider in VS Code or Zed does not include Azure model capacity. VS Code explicitly allows bring-your-own-key (BYOK) models without a GitHub account or Copilot plan for supported chat and utility tasks, but requests still go to the configured provider. Zed similarly supports provider API access and OpenAI-compatible custom endpoints ([VS Code: Language models](https://code.visualstudio.com/docs/copilot/customization/language-models), [Zed: Use API access](https://zed.dev/docs/ai/use-api-access), [Zed: LLM providers](https://zed.dev/docs/ai/llm-providers)).
2. **Model/API consumption.** Azure Standard deployments are pay-as-you-go by billable token. Provisioned Throughput Units (PTUs) are capacity commitments billed by allocated throughput; reservations can alter that cost. Azure Batch is listed at a 50% discount from Global Standard with a 24-hour completion target ([Azure OpenAI pricing](https://azure.microsoft.com/en-us/pricing/details/cognitive-services/openai-service/)).
3. **Coding subscription.** GitHub Copilot charges a recurring plan fee, includes AI Credits for chat/agent/model consumption, and charges overage when enabled. Paid plans also include unlimited code completions and next-edit suggestions, which do not consume AI Credits ([Copilot plans](https://docs.github.com/en/copilot/get-started/plans-for-github-copilot), [models and pricing](https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing)).

A fair budget must include all three relevant layers. In particular, “Azure in VS Code/Zed” is not a route around Azure billing.

## GitHub Copilot prices and included allowances

GitHub defines **1 AI Credit as $0.01** and lists additional usage at **$0.01 per credit**. Current allowances combine base and flex credits; GitHub describes flex as a current additional allotment, so it should not be treated as a permanent contractual entitlement without checking the plan at purchase or renewal ([Copilot plans](https://docs.github.com/en/copilot/get-started/plans-for-github-copilot), [models and pricing](https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing), [Copilot pricing](https://github.com/features/copilot/plans)).

| Plan | Monthly list price | Included AI Credits/month | Included value |
|---|---:|---:|---:|
| Pro | $10 | 1,500 = 1,000 base + 500 flex | $15 |
| Pro+ | $39 | 7,000 = 3,900 base + 3,100 flex | $70 |
| Max | $100 | 20,000 = 10,000 base + 10,000 flex | $200 |
| Business | $19/user | 1,900 pooled per user | $19 |
| Enterprise | $39/user | 3,900 pooled per user | $39 |

Paid plans include unlimited code completions and next-edit suggestions; AI Credits apply to eligible chat, agent, model, and other metered interactions. Copilot code review can also consume AI Credits and GitHub Actions minutes ([models and pricing](https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing)). The Free plan has 2,000 code completions per month and limited chat/agent use rather than an unrestricted substitute for either paid option ([Copilot plans](https://docs.github.com/en/copilot/get-started/plans-for-github-copilot)).

GitHub prices models by input, cached-input, cache-write where applicable, and output tokens. The model mix therefore affects how fast credits are consumed. Copilot Auto has a documented 10% model-cost discount on supported paid-plan surfaces ([models and pricing](https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing), [Auto model selection](https://docs.github.com/en/copilot/concepts/auto-model-selection)).

A legacy exception matters for annual subscribers: eligible Pro and Pro+ customers who remained on legacy premium-request billing after 2026-06-01 may instead have 300 or 1,500 premium requests per month, with additional requests at $0.04 each. Those customers should compare against their actual account terms, not the AI Credit table above ([Copilot requests](https://docs.github.com/en/copilot/concepts/billing/copilot-requests)).

## Azure pricing: verified representative rates

Azure's dynamic OpenAI pricing page exposed deployment categories during this research but rendered numeric fields as `$-`, so it is not reliable evidence for exact figures on this date. It does confirm Standard/pay-as-you-go, Provisioned/PTU, Batch, Global, Data Zone, Regional, and separately priced built-in-tool categories ([Azure OpenAI pricing](https://azure.microsoft.com/en-us/pricing/details/cognitive-services/openai-service/)).

The exact representative numbers below were instead checked on **2026-09-05** against Microsoft's official [Azure Retail Prices API](https://prices.azure.com/api/retail/prices), following its [official API documentation](https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices). Current records use the service name `Foundry Models`; Azure OpenAI product records and meter/SKU names were filtered for Global Standard USD token meters.

| Representative model/deployment | Uncached input / 1M | Cached input / 1M | Output / 1M | API effective date |
|---|---:|---:|---:|---:|
| GPT-5 mini, Global Standard | $0.25 | $0.025 | $2.00 | 2025-08-01 |
| GPT-5.4 default/short-context, Global Standard | $2.50 | $0.25 | $15.00 | 2026-03-01 |

The relevant API SKU/meter filters were `GPT 5 Mini Inpt Glbl`, `GPT 5 Mini cchd Inpt Glbl`, `GPT 5 Mini outpt Glbl`, `5.4 inp Gl`, `5.4 cd inp Gl`, and `5.4 opt Gl`. These are a dated, representative snapshot—not a claim that every Azure region, model version, context tier, deployment type, currency, or enterprise agreement has those rates. Query the Retail Prices API for the intended subscription geography and deployment immediately before budgeting. The API returns retail estimates; negotiated agreements, currency conversion, taxes, reservations, and Azure billing terms can change the effective amount.

### Azure cost formula

For a pay-as-you-go deployment:

```text
Azure monthly cost =
  (uncached_input_tokens / 1,000,000 × input_rate)
+ (cached_input_tokens / 1,000,000 × cached_input_rate)
+ (cache_write_tokens / 1,000,000 × cache_write_rate, if applicable)
+ (output_and_reasoning_tokens / 1,000,000 × output_rate)
+ tool-call/session/search/storage charges
+ provisioned/PTU commitments, if any
```

Batch, reservations, Data Zone/Regional pricing, and negotiated discounts should be represented by substituting their actual rates rather than applying the sample Global Standard table blindly ([Azure OpenAI pricing](https://azure.microsoft.com/en-us/pricing/details/cognitive-services/openai-service/), [Retail Prices API documentation](https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices)).

## Agent, caching, and tool overhead

Token counts in an IDE agent are larger than the visible prompt and answer:

- System instructions, repository context, previous turns, planning passes, retries, summaries, and utility/background-model calls can all add input or output tokens. VS Code supports separate models for utility tasks and notes that thinking effort increases reasoning-token and AI-credit use ([VS Code: Language models](https://code.visualstudio.com/docs/copilot/customization/language-models)).
- Tool arguments and tool results can be added to later context. An agentic edit can therefore make several model calls, not one. Agent models must support tool calling in VS Code ([VS Code: Language models](https://code.visualstudio.com/docs/copilot/customization/language-models)).
- Prompt caching reduces cost only when the provider recognizes a reusable prefix. Some model/provider schedules also charge cache writes, so “cached” does not always mean free ([GitHub model pricing](https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing), [Zed settings](https://zed.dev/docs/configuring-zed#all-settings)).
- Azure built-in tools can create charges separate from model tokens, including file-search calls and storage and code-interpreter sessions. Stateful APIs, uploaded files, and vector stores can also have lifecycle/storage implications ([Azure OpenAI pricing](https://azure.microsoft.com/en-us/pricing/details/cognitive-services/openai-service/)).

Consequently, a break-even estimate based only on text typed by the developer will normally understate real agent consumption. Measure billed tokens and tool usage from the provider or organization usage reports.

## Practical break-even

Let `U` be the monthly pay-as-you-go dollar cost of the equivalent model and tool workload, excluding any editor cost and assuming Copilot meters the workload at comparable effective rates:

```text
Azure = U
Copilot = plan_fee + max(0, U - included_credit_value)
```

This simplified comparison produces:

| Copilot plan | Azure cheaper while `U` is below | Result at/above threshold | Maximum Copilot saving from included value |
|---|---:|---|---:|
| Pro | $10/month | Copilot cheaper | $5/month |
| Pro+ | $39/month | Copilot cheaper | $31/month |
| Max | $100/month | Copilot cheaper | $100/month |
| Business | $19/user/month | Rough token-cost tie at/above $19 | $0 |
| Enterprise | $39/user/month | Rough token-cost tie at/above $39 | $0 |

For individual plans, the break-even occurs at the subscription fee because the included credit value exceeds that fee. For Business and Enterprise, included value equals the seat fee; raw metered cost becomes approximately equal above the threshold. Those statements ignore the positive value of paid-plan unlimited completions, model availability, Copilot-only retrieval, policy/admin functions, pooling, and support. They also assume the current flex-credit amounts remain available.

### Token examples at the $10 Pro threshold

Using only one token class and the verified representative Azure rates:

| Workload | Approximately $10 of Azure usage |
|---|---:|
| GPT-5 mini, all uncached input | 40,000,000 tokens |
| GPT-5 mini, all output | 5,000,000 tokens |
| GPT-5.4, all uncached input | 4,000,000 tokens |
| GPT-5.4, all output | 666,667 tokens |
| GPT-5.4, 80% uncached input / 20% output by token count | 2,000,000 total tokens |

The mixed GPT-5.4 example has a blended price of `0.8 × $2.50 + 0.2 × $15 = $5 per million tokens`. In general:

```text
break_even_tokens_in_millions =
  plan_fee
  / (p_input × input_rate
     + p_cached × cached_rate
     + p_cache_write × cache_write_rate
     + p_output × output_rate)
```

The proportions must sum to 1, and separately billed tools or fixed commitments must be added before comparing with the plan fee. Reasoning tokens should be assigned to the provider's billed output category where the model's pricing rules require it.

## VS Code and Zed integration limits

### VS Code

VS Code has a built-in Azure provider configuration for endpoint/deployment settings and Microsoft Entra ID authentication. BYOK can be used for supported chat and utility work without a GitHub account or Copilot plan. It does **not** replace Copilot-only semantic search, embeddings, or inline suggestions, so it is not equivalent to the full Copilot coding product. Tool-using agent models must support tool calling ([VS Code: Language models](https://code.visualstudio.com/docs/copilot/customization/language-models)).

The cost implication is twofold: Azure BYOK can avoid a Copilot subscription for a narrow chat workflow, but recreating missing retrieval, completion, governance, or operational capabilities may add engineering or service cost.

### Zed

Zed supports API keys, OpenAI-compatible custom endpoints, custom headers, tool configuration, caching settings, and reasoning limits. Its official first-class provider list does **not** list Azure OpenAI, so Azure in Zed should be treated as an OpenAI-compatible/custom-endpoint route whose Azure URL, API version, authentication/header behavior, and tool compatibility must be validated for the selected deployment—not as a documented native Azure provider ([Zed: Use API access](https://zed.dev/docs/ai/use-api-access), [Zed: LLM providers](https://zed.dev/docs/ai/llm-providers), [Zed settings](https://zed.dev/docs/configuring-zed#all-settings)).

Zed also supports using an existing GitHub Copilot subscription for Copilot Chat and edit prediction ([Zed: Use an existing subscription](https://zed.dev/docs/ai/use-an-existing-subscription)). Neither route makes the underlying subscription or Azure calls free.

## Enterprise, security, and operational differences

Raw token prices can be outweighed by operating requirements:

- **Azure identity and network control.** Azure supports Microsoft Entra ID, RBAC, and managed identities, reducing reliance on long-lived API keys. Azure deployment, private networking, logging, monitoring, capacity management, and policy work can add labor or Azure-resource cost even when they are not token line items ([Azure OpenAI managed identity](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/how-to/managed-identity)).
- **Azure data handling and boundaries.** Microsoft states that prompts and completions are not available to OpenAI and are not used to train foundation models without permission; stored data is encrypted. Global, Data Zone, and Regional deployment choices affect where processing can occur. Content filtering and abuse-monitoring behavior should also be included in a security review ([Azure OpenAI data, privacy, and security](https://learn.microsoft.com/en-us/legal/cognitive-services/openai/data-privacy), [Azure OpenAI content filtering](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/concepts/content-filter)).
- **Copilot organization features.** Business and Enterprise bundle centralized seats, policies, usage controls, pooled credits, enterprise security features, and IP indemnity. GitHub states Business/Enterprise data is not used to train GitHub's models; its pricing disclosures also distinguish IDE chat/completion retention from other surfaces. These bundled controls can make Copilot operationally cheaper than assembling and maintaining an Azure-based equivalent ([Copilot pricing](https://github.com/features/copilot/plans), [Copilot licenses](https://docs.github.com/en/billing/concepts/product-billing/github-copilot-licenses)).

Security and residency are not interchangeable between the products. The selected editor, extension, endpoint, model, tools, telemetry, and any intermediary service must all be reviewed; using Azure for the model alone does not automatically place every part of an editor workflow inside the same boundary.

## Decision guidance

- Choose **Azure pay-as-you-go** when use is genuinely light or intermittent, chat/agent functionality is sufficient, and the estimated all-in monthly API/tool cost remains below the applicable Copilot fee. It can also be justified by Azure-specific identity, network, processing-boundary, or governance requirements.
- Choose **Copilot Pro/Pro+/Max** when expected equivalent monthly model use exceeds **$10/$39/$100**, respectively, or when unlimited completions and Copilot-only coding features matter. Under the current credit schedule, Copilot remains ahead after the threshold because included value exceeds the individual plan fee.
- Evaluate **Business/Enterprise** on the whole organizational package. Their included credit value equals the seat price, so raw token cost alone is roughly neutral above **$19/$39 per user**, but pooled allowances, admin/security controls, support, procurement, and implementation effort can dominate.
- Recalculate with actual usage traces. Include uncached input, cached input, cache writes, reasoning/output, agent retries, utility calls, tools, sessions, storage, and fixed capacity. Recheck GitHub flex allowances and Azure meters at purchase or renewal.

## Official sources

### Microsoft and VS Code

- [Azure OpenAI Service pricing](https://azure.microsoft.com/en-us/pricing/details/cognitive-services/openai-service/)
- [Azure Retail Prices API](https://prices.azure.com/api/retail/prices)
- [Azure Retail Prices API documentation](https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices)
- [Azure OpenAI managed identity](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/how-to/managed-identity)
- [Azure OpenAI data, privacy, and security](https://learn.microsoft.com/en-us/legal/cognitive-services/openai/data-privacy)
- [Azure OpenAI content filtering](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/concepts/content-filter)
- [VS Code language models and BYOK](https://code.visualstudio.com/docs/copilot/customization/language-models)

### GitHub

- [GitHub Copilot plans](https://docs.github.com/en/copilot/get-started/plans-for-github-copilot)
- [GitHub Copilot pricing](https://github.com/features/copilot/plans)
- [Copilot models and AI Credit pricing](https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing)
- [Copilot Auto model selection](https://docs.github.com/en/copilot/concepts/auto-model-selection)
- [Legacy premium requests](https://docs.github.com/en/copilot/concepts/billing/copilot-requests)
- [Copilot licenses](https://docs.github.com/en/billing/concepts/product-billing/github-copilot-licenses)

### Zed

- [Use API access](https://zed.dev/docs/ai/use-api-access)
- [Use an existing subscription](https://zed.dev/docs/ai/use-an-existing-subscription)
- [LLM providers](https://zed.dev/docs/ai/llm-providers)
- [Zed settings](https://zed.dev/docs/configuring-zed#all-settings)
