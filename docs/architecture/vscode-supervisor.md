# VS Code supervisor architecture

Status: experimental MVP

## Objective

Rigel provides a user-invoked, Copilot-backed chat participant that can stop obvious agent loops and prepare a fresh escalation to a stronger model. It does not intercept or modify built-in Copilot Chat.

## Data flow

```text
workspace -> Rigel extension host -> VS Code Language Model interface -> GitHub Copilot
```

There is no Rigel network service. The extension does not acquire or expose a Copilot token and does not call model-provider endpoints directly. An explicit `/refresh` request downloads only GitHub's public pricing YAML from `raw.githubusercontent.com` and stores the validated result in VS Code extension storage.

## Modules

### Model selection

`extension/src/model-selector.ts` is a pure module. Its interface accepts a GitHub category, runtime-discovered Copilot models, the normalized pricing catalog, and an optional favorite model ID. It returns the chosen model, matched price row, and a human-readable reason.

The user-facing categories are GitHub's `Lightweight`, `Versatile`, and `Powerful` labels. A valid favorite wins within its category. Otherwise Rigel selects the available model with the lowest sum of the applicable input and output prices at the starting context size, with deterministic tie-breakers. The equal-token sum is deliberately simple and is disclosed to users rather than presented as a workload-specific cost estimate.

### Pricing catalog

`extension/src/pricing-loader.ts` starts from the catalog bundled at build time. An explicit `/refresh` request downloads GitHub's canonical `models-and-pricing.yml`, parses it locally, rejects unknown categories or malformed prices, and writes the normalized result to VS Code's extension storage. The repository's scheduled workflow performs the same catalog synchronization every day.

### Planner and sequential workers

`extension/src/task-plan.ts` defines a strict, bounded plan containing one to six tasks. The planner always routes through `Powerful`, can assign only GitHub categories, and cannot select model IDs. The plan is rendered for approval and stored only in the current chat result metadata.

`/run` validates the stored plan again and executes tasks sequentially. Every task receives only the overall goal, its own instructions and success criteria, and the current workspace state; planner prose, chat history, and previous worker transcripts are not replayed. Each task resolves its category to the current favorite or cheapest available model at execution time. A failed or stalled task stops the plan.

Categories are scoped leases. An explicit `/powerful` selection lasts one request, and a planner-assigned category lasts one task. The next boundary routes independently, which provides deterministic downshifting without another judge-model call. Rigel does not switch models within an active task because doing so loses cache locality and can preserve a bloated or misleading context.

### Progress supervision

`extension/src/progress-supervisor.ts` is a pure module with one important operation:

```ts
supervisor.observe(event): SupervisorDecision
```

It retains only bounded, in-memory evidence. Tool arguments are canonicalized for comparison, but are not written to disk or logs. Error text is normalized so volatile numbers, durations, and memory addresses do not hide a repeated failure. Repeated actions or errors trigger escalation; reaching the ordinary action budget asks the existing model to finish without tools.

The initial policy intentionally favors understandable rules over an LLM judge. A classifier can be evaluated later against recorded, deliberately sanitized test traces, but it should not become a runtime dependency without evidence that it improves decisions.

### Copilot adapter

`extension/src/participant.ts` is the VS Code adapter. It:

1. receives an explicit `@rigel` request;
2. discovers models with `vscode.lm.selectChatModels({ vendor: "copilot" })`;
3. matches runtime model identifiers to the bundled GitHub pricing catalog and selects a category favorite or cheapest candidate;
4. performs a bounded model/tool loop;
5. sends every action and result to the supervisor; and
6. returns a serializable handoff when the circuit breaker opens.

A `/rescue` request deliberately starts a fresh model message sequence containing the compact handoff. It does not replay the previous model's full reasoning context.

### Workspace tools

`extension/src/tools.ts` registers five tools:

- read one text file;
- list one directory;
- find file names by glob;
- create or replace one text file; and
- run one time- and output-limited shell command.

Paths are restricted to the first workspace root, including checks against symbolic-link escape. Writes and commands require VS Code confirmation. File reads and command output are size-limited. Command output is returned to the active Copilot model.

## Threat model

Rigel aims to avoid adding a new data recipient or persistence layer to normal Copilot use.

| Risk | Mitigation |
| --- | --- |
| Hidden third-party model call | Only `vendor: "copilot"` models are eligible |
| Credential extraction | Uses `vscode.lm`; stores no provider token |
| Silent mutation | Write and command tools request confirmation |
| Workspace traversal | Tool paths reject absolute paths and `..` segments, then verify real paths against symbolic-link escape |
| Accidental bulk disclosure | No automatic repository upload; reads are targeted and size-limited. `/orchestrate` sends at most 200 relative paths, not automatic file contents |
| Sensitive telemetry | No analytics, telemetry, prompt logging, or Rigel backend |
| Pricing refresh disclosure | Fetches only a public GitHub URL and sends no workspace data |
| Runaway tool use | Deterministic repetition and action limits |
| Bad reasoning retained during rescue | Rescue constructs a fresh compact handoff |

The remaining trust relationship is GitHub Copilot itself. Any content provided to a Copilot model is processed according to the account's Copilot plan, organization policy, and GitHub terms.

## Known gaps

- The supervisor observes tool behavior, not hidden model reasoning.
- A semantically wrong approach that continues producing novel actions can evade the initial detector.
- The cheapest-model rule assumes equal input and output token counts and selects at the starting context size; it does not reroute a running worker if later tool results cross a long-context threshold.
- The extension cannot supervise a conversation owned by another chat participant.
- Orchestrated task success remains model-reported; generic semantic proof is not possible.
- The first orchestration version is sequential and stops at the first unsuccessful task.
- A command timeout kills the immediate shell process, but descendant or background processes may survive on some operating systems.
- Zed does not currently expose an equivalent subscription-backed language-model interface to extensions.
