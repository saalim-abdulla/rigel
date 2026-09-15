# Rigel for VS Code

Rigel is an experimental, transparent chat participant that supervises GitHub Copilot model use. It selects the cheapest available model in a GitHub pricing category by default, supports one favorite per category, exposes a small set of workspace tools, and stops repeated actions or repeated errors. Reaching the ordinary tool budget asks the same model to finish instead of escalating.

## Try it locally

1. Install dependencies and compile:

   ```bash
   npm install
   npm test
   ```

2. Open the `extension/` directory in VS Code.
3. Press `F5` to open an Extension Development Host.
4. Ensure GitHub Copilot Chat is installed and authenticated.
5. Open Chat and enter:

   ```text
   @rigel review this repository and pick up where we left off
   ```

The first model request can display VS Code's consent prompt for this extension.

## Commands

- `@rigel <task>` — use the configured default category (`Versatile` initially).
- `@rigel /orchestrate <goal>` — ask a `Powerful` model for a bounded category-based plan, without executing it.
- `@rigel /run` — approve and execute the latest plan sequentially with a fresh context per task.
- `@rigel /lightweight <task>` — use a GitHub `Lightweight` model.
- `@rigel /versatile <task>` — use a GitHub `Versatile` model.
- `@rigel /powerful <task>` — use a GitHub `Powerful` model.
- `@rigel /favorite` — choose a favorite model for any category.
- `@rigel /refresh` — fetch the latest categories and prices directly from GitHub's canonical source.
- `@rigel /rescue` — restart the latest stalled Rigel task with a `Powerful` model and a compact handoff.
- `@rigel /why` — explain the latest routing and supervision result.
- **Rigel: Choose Favorite Model by Category** — configure or clear a category favorite.
- **Rigel: Refresh GitHub Model Pricing** — perform the same on-demand refresh from the Command Palette.
- **Rigel: List Available Copilot Models** — display model identifiers, categories, and published rates exposed to extensions by the current account and organization.

When no favorite is configured, Rigel chooses the available model with the lowest sum of its published input and output rates at the starting context size. This represents an equal-token comparison; the routing banner always shows the underlying input, output, and pricing-tier values separately.

Category choices are leases rather than sticky session state. `/powerful` applies only to that request, and an orchestrated task's category applies only to that task. The next plain `@rigel` request returns to `rigel.defaultCategory` (`Versatile` by default), while the next orchestrated task is routed independently. Rigel deliberately does not make periodic judge calls or switch models halfway through a task, because that adds cost and carries a potentially bloated reasoning context into another model.

## What the supervisor detects

The initial circuit breaker is deliberately deterministic. It stops a worker when:

- an equivalent tool call reaches the configured repeat limit;
- an equivalent normalized tool error reaches the configured repeat limit; or
Repeated actions and errors open the escalation circuit breaker. The default tool-action budget is 30; reaching it asks the current model to provide a final answer without more tools and does **not** recommend switching models.

It does not call another model to judge healthy sessions. Its decisions and recent evidence are shown in Chat.

## Data handling

Rigel has no backend, analytics, telemetry, or API keys. Its only runtime package is the audited `yaml` parser used for explicit pricing refreshes. Model requests use VS Code's official Language Model interface and are restricted to models whose vendor is `copilot`.

Workspace-derived content is sent to Copilot only when:

- the user explicitly attaches it to a Rigel request;
- `/orchestrate` sends the `Powerful` planner up to 200 workspace-relative file paths, but no file contents unless explicitly attached; or
- the active Copilot model requests a Rigel tool. Tool results can contain file contents, file names, or shell-command output.

Write and shell-command tools use VS Code's inline confirmation UI. Session metadata is stored in Chat result metadata so `/rescue` can work within the same Chat session; Rigel does not persist it separately.

Using Copilot still sends selected context to GitHub under the user's or organization's Copilot terms and policies. “No Rigel backend” does not mean that Copilot runs locally.

`/refresh` is the only additional network operation: when explicitly invoked, it downloads the public pricing YAML directly from `raw.githubusercontent.com`, validates it, and stores normalized pricing in VS Code's extension storage. No workspace content is included in that request.

## Current limitations

- Rigel supervises only requests addressed to `@rigel`; it cannot intercept built-in Copilot Chat.
- `/rescue` and orchestration approval work only in the same Rigel chat session.
- Orchestration is sequential, limited to six tasks, and stops at the first failed or stalled task.
- Task success is based on normal model completion plus visible validation output; Rigel cannot generically prove semantic correctness.
- Tools operate on the first workspace folder in a multi-root workspace.
- Runtime model IDs are matched to GitHub's published model names. An unrecognized model cannot be selected by category until the catalog or matching rule is updated.
- Model identifiers are controlled by the Copilot provider and can change.
- This prototype uses whole-file writes and should be tested on work protected by version control.
- Command timeouts terminate the immediate shell process, but operating systems may leave descendant or background processes running.
