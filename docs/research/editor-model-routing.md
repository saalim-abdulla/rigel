# Editor model routing and Copilot subscription access

Research performed on 2026-09-05 using official documentation.

## Executive summary

| Question | Finding |
| --- | --- |
| Can DSPy optimize model routing? | DSPy can configure multiple concrete LMs and makes custom routing straightforward, but its documented optimizers optimize prompts, demonstrations, program behavior, or model weights—not the provider/model choice itself. Model selection must be represented as application logic and evaluated explicitly. |
| What does GitHub Copilot Auto do? | Auto routes tasks according to task complexity plus real-time model health and availability. On paid Copilot plans, Auto receives a 10% discount on model costs in the documented Copilot surfaces. |
| Can a VS Code extension call Copilot models through the user's subscription? | Yes. VS Code's public Language Model API lets extensions discover Copilot-provided models and call a selected model, subject to user initiation, per-extension consent, availability, policy, and quota. It does not give the extension a reusable Copilot API token. |
| Can a Zed extension do the same? | Zed itself can use an existing Copilot subscription as a model provider, but the documented Zed extension API does not expose a general API for invoking Zed's selected LLM. Zed extensions can package MCP servers; Zed currently supports MCP tools and prompts, not MCP sampling. |
| Can MCP bridge this gap? | Not reliably. MCP is primarily a context/tool protocol, not a model-provider API. Its former sampling facility is deprecated in the latest specification; even there, model hints were advisory and the client retained final model choice. |

## DSPy: routing versus optimization

`dspy.LM` is constructed with a concrete provider/model identifier such as
`"openai/gpt-4o"`. DSPy documents global configuration, scoped
`dspy.context(...)` overrides, and `Module.set_lm(...)`; a program can therefore
use different LMs in different modules or choose an LM in custom program logic.
The `Module.get_lm()` API explicitly accounts for a module containing multiple
LMs by raising when there is no unique LM to return.
([LM API](https://dspy.ai/api/models/LM/),
[Module API](https://dspy.ai/api/modules/Module/),
[settings and context](https://dspy.ai/diving-deeper/settings-and-context/))

DSPy optimizers require a metric and training/evaluation examples, then compile
a program to improve its prompts, few-shot demonstrations, program strategy,
or weights. The official optimizer guide distinguishes prompt optimizers from
weight optimizers. `BetterTogether`, for example, sequences prompt and weight
optimization and returns the best intermediate program according to validation
scores; it does not search across model-provider choices.
([optimizer guide](https://dspy.ai/diving-deeper/choosing-an-optimizer/),
[BetterTogether](https://dspy.ai/api/optimizers/BetterTogether/),
[evaluation](https://dspy.ai/diving-deeper/metrics-and-evaluation/))

**Conclusion:** DSPy is suitable for implementing and evaluating a router, but
the current official API does not document a built-in optimizer whose search
space is “which hosted model should handle this request.” A defensible design
would treat routing as explicit program logic, evaluate candidate routes on a
representative dataset with a quality/cost/latency metric, and optimize each
route's DSPy program separately. Do not describe ordinary DSPy prompt
optimization as automatic model routing.

## GitHub Copilot Auto selection and discount

GitHub says Auto with task optimization combines task-complexity evaluation
with real-time system health and availability. It routes on natural cache
boundaries rather than switching models freely within a session, because
mid-session switching can add cache cost without enough quality improvement.
The candidate set is constrained by the user's plan, administrator policies,
data-residency/FedRAMP restrictions, and evaluation-model policy; available
models may change over time.
([About Copilot auto model selection](https://docs.github.com/en/copilot/concepts/auto-model-selection))

On a paid Copilot plan, GitHub documents a **10% discount on model costs** when
using Auto in Copilot Chat, Copilot CLI, the GitHub Copilot app, or Copilot
cloud agent. This is an Auto-specific discount, not a promise that every
explicitly selected model is discounted. The current billing documentation
meters model interactions by tokens converted to GitHub AI Credits; included
allowances and overage behavior depend on the plan. Code completions and next
edit suggestions are not billed in AI credits on paid plans.
([Auto discount](https://docs.github.com/en/copilot/concepts/auto-model-selection#discount-for-using-auto-model-selection),
[models and pricing](https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing))

Auto with task optimization is documented as generally available in VS Code,
while other listed IDEs may use the reliability/availability form rather than
task optimization. GitHub does not document Auto as a general API that an
arbitrary external application can call.
([Auto availability](https://docs.github.com/en/copilot/concepts/auto-model-selection#auto-model-selection-in-copilot))

## Programmatic use from editors

### VS Code extensions: supported

VS Code's public Language Model API allows an extension to:

- discover models with `vscode.lm.selectChatModels(...)`;
- filter by `vendor`, `family`, `id`, or `version`;
- select Copilot-provided models with `vendor: "copilot"`;
- call a returned `LanguageModelChat` using `sendRequest(...)`; and
- in a chat participant, use `ChatRequest.model` to respect the model the user
  selected in the chat UI.

The returned model IDs and availability are explicitly unstable, so extensions
must handle zero matches, model removal, policy restrictions, and quota errors.
([Language Model API guide](https://code.visualstudio.com/api/extension-guides/language-model),
[`vscode.lm` API](https://code.visualstudio.com/api/references/vscode-api#lm),
[`ChatRequest.model`](https://code.visualstudio.com/api/references/vscode-api#ChatRequest))

Copilot models require per-extension user consent. Because the first request
may display consent UI, it must occur in response to a user action. The API can
reject requests for missing consent, unavailable models, access restrictions,
or exhausted quota. VS Code also states that model usage can affect the user's
quota. Thus this is the supported way to use the user's existing Copilot model
access inside a VS Code extension; it is mediated by VS Code/Copilot and does
not expose a bearer token for calling a private Copilot endpoint elsewhere.
([consent and errors](https://code.visualstudio.com/api/extension-guides/language-model#send-the-language-model-request),
[`LanguageModelChat.sendRequest`](https://code.visualstudio.com/api/references/vscode-api#LanguageModelChat),
[rate limiting](https://code.visualstudio.com/api/extension-guides/language-model#rate-limiting))

The public API supports selecting a concrete exposed model or respecting the
user's UI selection. The official docs do not establish that selecting a model
whose display name is `Auto` reproduces GitHub's product-level Auto router, so
an extension should not assume Auto availability or the 10% discount unless
that behavior is explicitly exposed and documented by the Copilot provider.

### Zed: native use is supported; extension invocation is not documented

Zed documents GitHub Copilot as an existing-subscription path for “Copilot Chat
models for Zed AI features,” as well as Copilot edit prediction. Zed Agent uses
models configured through Zed's LLM Providers, and agent profiles can set a
default provider/model. A user can therefore select and use Copilot-backed
models in Zed itself without supplying a separate provider API key.
([Use an Existing Subscription](https://zed.dev/docs/ai/use-an-existing-subscription.md#github-copilot),
[Zed Agent](https://zed.dev/docs/ai/zed-agent.md),
[Agent Profiles](https://zed.dev/docs/ai/agent-profiles.md))

That does **not** imply a public extension API. Zed's documented extension
features are languages, debuggers, themes, icon themes, snippets, and MCP
servers. Its documented extension capabilities are process execution, file
downloads, and npm installation; no LLM discovery or completion-call
capability is listed. MCP extensions only return the command used to start an
MCP server.
([Developing Extensions](https://zed.dev/docs/extensions/developing-extensions.md),
[Extension Capabilities](https://zed.dev/docs/extensions/capabilities.md),
[MCP Server Extensions](https://zed.dev/docs/extensions/mcp-extensions.md))

**Conclusion:** based on the current public documentation, an ordinary Zed
extension cannot programmatically invoke whichever Copilot model the user has
selected in Zed. Zed itself can use the subscription, and a Copilot External
Agent can own its own Copilot authentication and model behavior over ACP, but
that is a separate agent integration—not arbitrary extension access to Zed's
LLM provider.
([External Agents: Copilot](https://zed.dev/docs/ai/external-agents.md#copilot),
[configuration boundaries](https://zed.dev/docs/ai/external-agents.md#configuration-boundaries))

## MCP limitations relevant to model routing

The MCP architecture explicitly says MCP focuses on context exchange and does
not dictate how an AI application uses LLMs or manages supplied context. Its
core server primitives are tools, resources, and prompts. The host decides how
resources are incorporated; prompts are user-controlled; tools are generally
model-controlled but clients are expected to retain approval and security
controls.
([MCP architecture](https://modelcontextprotocol.io/docs/learn/architecture),
[tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools),
[resources](https://modelcontextprotocol.io/specification/2026-07-28/server/resources),
[prompts](https://modelcontextprotocol.io/specification/2026-07-28/server/prompts))

Important constraints for this use case:

1. **MCP does not expose the host's model catalog or subscription token.** A
   tool server receives tool calls and returns results; it does not thereby
   gain a general API to the model currently driving the host.
2. **Feature support is client-dependent.** Unsupported optional capabilities
   cannot be assumed merely because they exist in a specification revision.
3. **Sampling is no longer a sound integration target.** The latest MCP
   specification (`2026-07-28`) deprecates `sampling/createMessage`, says new
   implementations should not adopt it, and recommends direct integration
   with LLM provider APIs.
4. **Sampling never guaranteed an exact model.** In revisions that support it,
   model names are advisory hints, clients may map them to an equivalent model
   from another provider, and the client makes the final selection. Clients
   may also modify or ignore the requested system prompt, context inclusion,
   temperature, stop sequences, and provider metadata.
5. **Zed is narrower still.** Zed currently documents support for MCP Tools and
   Prompts and explicitly lists Sampling among features not yet supported.

Sources: [latest MCP sampling specification](https://modelcontextprotocol.io/specification/2026-07-28/client/sampling),
[legacy sampling model preferences](https://modelcontextprotocol.io/specification/2025-11-25/client/sampling#model-preferences),
[Zed MCP supported features](https://zed.dev/docs/ai/mcp.md#supported-features).

## Practical decision

- For a **VS Code extension**, use the official Language Model API and let VS
  Code mediate Copilot consent, model availability, policy, and quota. This is
  the only researched path that directly supports extension-initiated calls to
  selectable Copilot models through the user's editor account.
- For **Zed**, use Copilot through Zed Agent, a Copilot External Agent, or the
  Copilot CLI. Do not plan on a Zed extension or MCP server gaining generic
  access to the user's selected Copilot model.
- Use **DSPy** behind an API/provider boundary you control when you need
  measurable routing and optimization. DSPy can implement and evaluate the
  routing policy, but editor subscription access must come from a supported
  editor API; DSPy itself does not unlock Copilot subscription credentials.
- Do not make **MCP sampling** the architectural bridge. It is unsupported by
  Zed, optional in older clients, unable to require an exact model, and
  deprecated in the latest MCP specification.
