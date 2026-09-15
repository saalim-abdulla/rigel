import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';
import { isRoutingFailure, routeCopilotModel } from './copilot-router';
import { readConfig } from './config';
import { chooseFavoriteModel } from './favorites';
import { createHandoff, EscalationHandoff, renderHandoff } from './handoff';
import { describeModel } from './model-selector';
import type { OrchestrationMetadata, PlanMetadata } from './orchestration-metadata';
import { runTaskPlan, TaskExecutionResult } from './orchestrator';
import { formatPrice, ModelCategory, ModelPrice } from './pricing-catalog';
import type { PricingStore } from './pricing-loader';
import { ProgressSupervisor, SupervisorDecision } from './progress-supervisor';
import {
  escapeMarkdown,
  parseTaskCompletion,
  parseTaskPlan,
  plannerPrompt,
  renderTaskPlan,
  taskPrompt
} from './task-plan';
import type { PlannedTask, TaskPlan } from './task-plan';
import { TOOL_NAMES } from './tools';

const PARTICIPANT_ID = 'rigel.chat';
const MAX_REFERENCE_BYTES = 64 * 1024;
const MAX_TOTAL_REFERENCE_BYTES = 128 * 1024;

interface RigelMetadata {
  version: 1;
  model?: string;
  category?: ModelCategory;
  routeReason?: string;
  supervisorReason?: string;
  handoff?: EscalationHandoff;
  handoffConsumed?: boolean;
  orchestration?: OrchestrationMetadata;
}

interface ToolOutcome {
  ok: boolean;
  summary: string;
  changedWorkspace: boolean;
}

export function createParticipant(pricing: PricingStore): vscode.ChatParticipant {
  const activePlanIds = new Set<string>();
  const handler: vscode.ChatRequestHandler = async (request, context, stream, token) => {
    if (request.command === 'why') {
      explainLastDecision(context, stream);
      return {};
    }
    if (request.command === 'favorite') {
      const updated = await chooseFavoriteModel(pricing.prices());
      stream.markdown(updated
        ? 'Favorite model settings updated. Future category requests will use them when the model is available.'
        : 'No favorite model was changed.');
      return {};
    }
    if (request.command === 'orchestrate') {
      return createOrchestrationPlan(request, stream, token, pricing);
    }
    if (request.command === 'run') {
      return executeOrchestrationPlan(
        request,
        context,
        stream,
        token,
        pricing,
        activePlanIds
      );
    }
    if (request.command === 'refresh') {
      stream.progress('Downloading the canonical pricing table from github/docs…');
      try {
        const refreshed = await pricing.refresh();
        stream.markdown([
          '**Rigel pricing refreshed.**',
          `- Models: ${refreshed.modelCount}`,
          `- Price tiers: ${refreshed.rowCount}`,
          `- Source SHA-256: \`${refreshed.sourceSha256}\``,
          `- Local cache: \`${refreshed.cacheLocation}\``,
          '',
          'You can now run `/favorite` or start a category request.'
        ].join('\n'));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        stream.markdown(`**Rigel could not refresh GitHub pricing:** ${message}`);
        return { errorDetails: { message } };
      }
      return {};
    }

    const config = readConfig();
    const priorHandoff = latestHandoff(context);
    if (request.command === 'rescue' && !priorHandoff) {
      stream.markdown('There is no stalled Rigel task in this chat to rescue. Start a normal `@rigel` request or use `/powerful` for a new task.');
      return {};
    }

    const category = requestedCategory(request.command, config.defaultCategory);
    const rescueHandoff = request.command === 'rescue' ? priorHandoff : undefined;
    const goal = rescueHandoff?.goal ?? request.prompt.trim();
    const referenceContext = await expandReferences(request.references, stream);
    const userPrompt = rescueHandoff
      ? [
          renderHandoff(rescueHandoff),
          request.prompt.trim() ? `Additional user direction:\n${request.prompt.trim()}` : '',
          referenceContext
        ].filter(Boolean).join('\n\n')
      : referenceContext
        ? `${referenceContext}\n\n---\n\nUser request:\n${request.prompt}`
        : request.prompt;
    const messages = buildMessages(userPrompt, context, Boolean(rescueHandoff));
    let routeResult: Awaited<ReturnType<typeof routeCopilotModel>>;
    try {
      routeResult = await routeCopilotModel(category, messages, pricing, token);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      stream.markdown(`**Rigel could not select a Copilot model:** ${message}`);
      return { errorDetails: { message } };
    }
    if (isRoutingFailure(routeResult)) {
      stream.markdown([
        '**Rigel could not select a Copilot model.**',
        '',
        routeResult.reason,
        '',
        'Run **Rigel: List Available Copilot Models** to inspect what your plan and organization currently expose.'
      ].join('\n'));
      return {
        errorDetails: { message: routeResult.reason },
        metadata: { rigel: { version: 1, category, routeReason: routeResult.reason } satisfies RigelMetadata }
      };
    }
    const selection = routeResult;

    stream.markdown(renderRouteBanner(
      selection.model,
      category,
      selection.reason,
      selection.price,
      selection.inputTokens,
      Boolean(rescueHandoff)
    ));

    const supervisor = new ProgressSupervisor({
      maxActions: config.maxToolActions,
      repeatedActionLimit: config.repeatedActionLimit,
      repeatedErrorLimit: config.repeatedErrorLimit
    });
    const tools = rigelTools();

    try {
      while (!token.isCancellationRequested) {
        const contextDecision = await checkContextBudget(selection.model, messages, token);
        if (contextDecision) {
          return renderEscalation(stream, goal, selection.model, category, selection.reason, contextDecision);
        }

        const response = await selection.model.sendRequest(
          messages,
          {
            justification: 'Run a user-initiated coding task with local progress supervision.',
            tools,
            toolMode: vscode.LanguageModelChatToolMode.Auto
          },
          token
        );

        const assistantParts: Array<vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart> = [];
        const toolCalls: vscode.LanguageModelToolCallPart[] = [];

        for await (const part of response.stream) {
          if (part instanceof vscode.LanguageModelTextPart) {
            assistantParts.push(part);
            stream.markdown(part.value);
          } else if (part instanceof vscode.LanguageModelToolCallPart) {
            assistantParts.push(part);
            toolCalls.push(part);
          }
        }

        if (assistantParts.length > 0) {
          messages.push(vscode.LanguageModelChatMessage.Assistant(assistantParts));
        }
        if (toolCalls.length === 0) {
          return successMetadata(
            selection.model,
            category,
            selection.reason,
            supervisor,
            Boolean(rescueHandoff)
          );
        }

        const resultParts: vscode.LanguageModelToolResultPart[] = [];
        for (const call of toolCalls) {
          if (supervisor.checkpoint().action === 'finish') {
            resultParts.push(skippedToolResultPart(call));
            continue;
          }
          const before = supervisor.observe({
            kind: 'tool-call',
            tool: call.name,
            input: call.input,
            mutatesWorkspace: call.name === 'rigel_writeFile'
          });
          if (before.action === 'escalate') {
            return renderEscalation(stream, goal, selection.model, category, selection.reason, before);
          }

          stream.progress(`Rigel action ${supervisor.snapshot().actionCount}: ${call.name}`);
          let toolResult: vscode.LanguageModelToolResult;
          try {
            toolResult = await vscode.lm.invokeTool(
              call.name,
              {
                input: call.input,
                toolInvocationToken: request.toolInvocationToken,
                tokenizationOptions: {
                  tokenBudget: Math.max(256, Math.min(8192, Math.floor(selection.model.maxInputTokens / 4))),
                  countTokens: (text, cancellation) => selection.model!.countTokens(text, cancellation)
                }
              },
              token
            );
          } catch (error) {
            toolResult = new vscode.LanguageModelToolResult([
              new vscode.LanguageModelTextPart(JSON.stringify({
                ok: false,
                error: error instanceof Error ? error.message : String(error)
              }))
            ]);
          }

          resultParts.push(new vscode.LanguageModelToolResultPart(call.callId, toolResult.content));
          const outcome = toolOutcome(toolResult);
          const after = supervisor.observe({
            kind: 'tool-result',
            tool: call.name,
            input: call.input,
            ok: outcome.ok,
            summary: outcome.summary,
            changedWorkspace: outcome.changedWorkspace
          });
          if (after.action === 'escalate') {
            return renderEscalation(stream, goal, selection.model, category, selection.reason, after);
          }
        }

        messages.push(vscode.LanguageModelChatMessage.User(resultParts));
        const checkpoint = supervisor.checkpoint();
        if (checkpoint.action === 'finish') {
          return finishWithCurrentModel(
            selection.model,
            messages,
            stream,
            token,
            category,
            selection.reason,
            supervisor,
            Boolean(rescueHandoff),
            goal
          );
        }
      }

      return {};
    } catch (error) {
      if (token.isCancellationRequested) {
        return {};
      }
      const message = error instanceof Error ? error.message : String(error);
      stream.markdown(`\n\n**Rigel stopped because the model request failed:** ${message}`);
      return {
        errorDetails: { message },
        metadata: {
          rigel: {
            version: 1,
            model: selection.model.id,
            category,
            routeReason: selection.reason
          } satisfies RigelMetadata
        }
      };
    }
  };

  const participant = vscode.chat.createChatParticipant(PARTICIPANT_ID, handler);
  participant.iconPath = new vscode.ThemeIcon('telescope');
  participant.followupProvider = {
    provideFollowups(result) {
      const metadata = getRigelMetadata(result.metadata);
      if (metadata?.orchestration?.kind === 'plan' && metadata.orchestration.state === 'awaitingApproval') {
        return [{ prompt: '', label: 'Approve and run this plan', command: 'run' }];
      }
      if (metadata?.handoff) {
        return [
          { prompt: '', label: 'Rescue with a powerful model', command: 'rescue' },
          { prompt: 'Continue despite the circuit breaker.', label: 'Continue manually' }
        ];
      }
      if (metadata?.model) {
        return [{ prompt: '', label: 'Why this model?', command: 'why' }];
      }
      return [];
    }
  };
  return participant;
}

async function createOrchestrationPlan(
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
  pricing: PricingStore
): Promise<vscode.ChatResult> {
  const goal = request.prompt.trim();
  if (!goal) {
    const message = 'Add a goal after `/orchestrate`.';
    stream.markdown(message);
    return { errorDetails: { message } };
  }

  try {
    const referenceContext = await expandReferences(request.references, stream);
    const files = await workspaceFileMap();
    const messages = [vscode.LanguageModelChatMessage.User(plannerPrompt(goal, files, referenceContext))];
    const route = await routeCopilotModel('Powerful', messages, pricing, token);
    if (isRoutingFailure(route)) {
      stream.markdown(`**Rigel could not select a Powerful planner:** ${route.reason}`);
      return { errorDetails: { message: route.reason } };
    }

    stream.markdown(renderRouteBanner(
      route.model,
      'Powerful',
      `Planning only. ${route.reason}`,
      route.price,
      route.inputTokens,
      false
    ));
    stream.progress('Creating a bounded task plan…');
    const response = await route.model.sendRequest(
      messages,
      { justification: 'Create a user-requested coding task plan for approval.' },
      token
    );
    let raw = '';
    for await (const part of response.stream) {
      if (part instanceof vscode.LanguageModelTextPart) {
        raw += part.value;
        if (Buffer.byteLength(raw, 'utf8') > 16 * 1024) {
          throw new Error('Planner response exceeded 16 KiB.');
        }
      }
    }
    const plan = parseTaskPlan(raw);
    if (plan.goal !== goal) {
      throw new Error('Planner changed the requested goal instead of preserving it exactly.');
    }

    const orchestration: PlanMetadata = {
      kind: 'plan',
      state: 'awaitingApproval',
      planId: randomUUID(),
      plannerModel: route.model.id,
      plannerRouteReason: route.reason,
      plan
    };
    stream.markdown(`\n\n${renderTaskPlan(plan)}`);
    return {
      metadata: {
        rigel: {
          version: 1,
          model: route.model.id,
          category: 'Powerful',
          routeReason: route.reason,
          orchestration
        } satisfies RigelMetadata
      }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stream.markdown(`\n\n**Rigel could not create a valid plan:** ${message}`);
    return { errorDetails: { message } };
  }
}

async function executeOrchestrationPlan(
  request: vscode.ChatRequest,
  context: vscode.ChatContext,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
  pricing: PricingStore,
  activePlanIds: Set<string>
): Promise<vscode.ChatResult> {
  if (request.prompt.trim()) {
    const message = '`/run` does not accept extra instructions. Create a new `/orchestrate` plan to change the scope.';
    stream.markdown(message);
    return { errorDetails: { message } };
  }
  const pending = latestPendingPlan(context);
  if (!pending) {
    const message = 'There is no unconsumed Rigel plan awaiting approval in this chat.';
    stream.markdown(message);
    return { errorDetails: { message } };
  }
  if (activePlanIds.has(pending.planId)) {
    const message = 'This plan is already running.';
    stream.markdown(message);
    return { errorDetails: { message } };
  }

  let plan: TaskPlan;
  try {
    plan = parseTaskPlan(JSON.stringify(pending.plan));
  } catch (error) {
    const message = `Stored plan failed validation: ${error instanceof Error ? error.message : String(error)}`;
    stream.markdown(message);
    return { errorDetails: { message } };
  }

  activePlanIds.add(pending.planId);
  stream.markdown([
    '**Rigel orchestration started**',
    `Plan: \`${pending.planId}\``,
    `Tasks: ${plan.tasks.length}`,
    '',
    'Tasks run sequentially. Each task receives a fresh scoped context and routes through its declared GitHub category.',
    ''
  ].join('\n'));

  try {
    const result = await runTaskPlan(
      plan,
      (task, index) => runPlannedTask(
        plan,
        task,
        index,
        request.toolInvocationToken,
        stream,
        token,
        pricing
      ),
      () => token.isCancellationRequested
    );
    stream.markdown(renderOrchestrationResult(result.outcomes, result.state, result.stopReason));
    return {
      metadata: {
        rigel: {
          version: 1,
          orchestration: {
            kind: 'run',
            state: result.state,
            planId: pending.planId,
            completedTasks: result.completedTasks,
            totalTasks: plan.tasks.length,
            outcomes: result.outcomes,
            stopReason: result.stopReason
          }
        } satisfies RigelMetadata
      }
    };
  } finally {
    activePlanIds.delete(pending.planId);
  }
}

async function runPlannedTask(
  plan: TaskPlan,
  task: PlannedTask,
  index: number,
  toolInvocationToken: vscode.ChatParticipantToolToken,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
  pricing: PricingStore
): Promise<TaskExecutionResult> {
  stream.markdown(`\n\n## Task ${index + 1}/${plan.tasks.length}: ${escapeMarkdown(task.title)}\n\n`);
  const messages = [
    vscode.LanguageModelChatMessage.User(systemInstructions()),
    vscode.LanguageModelChatMessage.User(taskPrompt(plan, task, index))
  ];
  let routeResult: Awaited<ReturnType<typeof routeCopilotModel>>;
  try {
    routeResult = await routeCopilotModel(task.category, messages, pricing, token);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stream.markdown(`**Task routing failed:** ${message}`);
    return { state: token.isCancellationRequested ? 'cancelled' : 'failed', actionCount: 0, summary: message };
  }
  if (isRoutingFailure(routeResult)) {
    stream.markdown(`**Task routing failed:** ${routeResult.reason}`);
    return { state: 'failed', actionCount: 0, summary: routeResult.reason };
  }
  const route = routeResult;
  stream.markdown(renderRouteBanner(
    route.model,
    task.category,
    route.reason,
    route.price,
    route.inputTokens,
    false
  ));

  const config = readConfig();
  const supervisor = new ProgressSupervisor({
    maxActions: config.maxToolActions,
    repeatedActionLimit: config.repeatedActionLimit,
    repeatedErrorLimit: config.repeatedErrorLimit
  });
  const tools = rigelTools();

  try {
    while (!token.isCancellationRequested) {
      const contextDecision = await checkContextBudget(route.model, messages, token);
      if (contextDecision) {
        stream.markdown(`\n\n**Task stalled:** ${contextDecision.reason}`);
        return taskResult('stalled', route.model.id, supervisor, contextDecision.reason ?? 'Context limit reached.');
      }

      const response = await route.model.sendRequest(
        messages,
        {
          justification: `Run approved Rigel task ${index + 1} of ${plan.tasks.length}.`,
          tools,
          toolMode: vscode.LanguageModelChatToolMode.Auto
        },
        token
      );
      const assistantParts: Array<vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart> = [];
      const toolCalls: vscode.LanguageModelToolCallPart[] = [];
      let responseText = '';
      for await (const part of response.stream) {
        if (part instanceof vscode.LanguageModelTextPart) {
          assistantParts.push(part);
          responseText += part.value;
          stream.markdown(part.value);
        } else if (part instanceof vscode.LanguageModelToolCallPart) {
          assistantParts.push(part);
          toolCalls.push(part);
        }
      }
      if (assistantParts.length) messages.push(vscode.LanguageModelChatMessage.Assistant(assistantParts));
      if (!toolCalls.length) {
        try {
          const completion = parseTaskCompletion(responseText);
          return taskResult(completion.status, route.model.id, supervisor, completion.summary);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          stream.markdown(`\n\n**Task failed:** ${message}`);
          return taskResult('failed', route.model.id, supervisor, message);
        }
      }

      const resultParts: vscode.LanguageModelToolResultPart[] = [];
      for (const call of toolCalls) {
        if (supervisor.checkpoint().action === 'finish') {
          resultParts.push(skippedToolResultPart(call));
          continue;
        }
        const before = supervisor.observe({
          kind: 'tool-call',
          tool: call.name,
          input: call.input,
          mutatesWorkspace: call.name === 'rigel_writeFile'
        });
        if (before.action === 'escalate') {
          stream.markdown(`\n\n**Task stalled:** ${before.reason}`);
          return taskResult('stalled', route.model.id, supervisor, before.reason ?? 'Repeated action.');
        }
        stream.progress(`Task ${index + 1}, action ${supervisor.snapshot().actionCount}: ${call.name}`);
        let toolResult: vscode.LanguageModelToolResult;
        try {
          toolResult = await vscode.lm.invokeTool(
            call.name,
            {
              input: call.input,
              toolInvocationToken,
              tokenizationOptions: {
                tokenBudget: Math.max(256, Math.min(8192, Math.floor(route.model.maxInputTokens / 4))),
                countTokens: (text, cancellation) => route.model.countTokens(text, cancellation)
              }
            },
            token
          );
        } catch (error) {
          toolResult = new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(JSON.stringify({
              ok: false,
              error: error instanceof Error ? error.message : String(error)
            }))
          ]);
        }
        resultParts.push(new vscode.LanguageModelToolResultPart(call.callId, toolResult.content));
        const outcome = toolOutcome(toolResult);
        const after = supervisor.observe({
          kind: 'tool-result',
          tool: call.name,
          input: call.input,
          ok: outcome.ok,
          summary: outcome.summary,
          changedWorkspace: outcome.changedWorkspace
        });
        if (after.action === 'escalate') {
          stream.markdown(`\n\n**Task stalled:** ${after.reason}`);
          return taskResult('stalled', route.model.id, supervisor, after.reason ?? 'Repeated failure.');
        }
      }
      messages.push(vscode.LanguageModelChatMessage.User(resultParts));

      const checkpoint = supervisor.checkpoint();
      if (checkpoint.action === 'finish') {
        stream.markdown(`\n\n> Task action budget reached. Asking \`${route.model.name}\` to finish without additional tools.\n\n`);
        messages.push(vscode.LanguageModelChatMessage.User(
          'The task tool budget is exhausted. Do not call more tools. Summarize completed work, state unmet criteria, and end with the required <rigel_task_result> JSON marker. Use failed if any criterion remains unmet.'
        ));
        const finalContextDecision = await checkContextBudget(route.model, messages, token);
        let finalMessages = messages;
        if (finalContextDecision) {
          stream.markdown('\n\n> Compacting this task context for a same-model final status.\n\n');
          finalMessages = [
            vscode.LanguageModelChatMessage.User(systemInstructions()),
            vscode.LanguageModelChatMessage.User([
              taskPrompt(plan, task, index),
              '',
              `Tool actions completed: ${supervisor.snapshot().actionCount}`,
              'Recent supervisor evidence:',
              ...supervisor.snapshot().evidence.map(item => `- ${item}`),
              '',
              'The detailed tool transcript was omitted to fit the context window. Do not call tools. End with the required <rigel_task_result> marker and use failed if any success criterion is unverified.'
            ].join('\n'))
          ];
        }
        const finalResponse = await route.model.sendRequest(
          finalMessages,
          { justification: 'Finish an approved task after its tool budget was reached.' },
          token
        );
        let finalText = '';
        for await (const part of finalResponse.stream) {
          if (part instanceof vscode.LanguageModelTextPart) {
            finalText += part.value;
            stream.markdown(part.value);
          }
        }
        try {
          const completion = parseTaskCompletion(finalText);
          return taskResult(completion.status, route.model.id, supervisor, completion.summary);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          stream.markdown(`\n\n**Task failed:** ${message}`);
          return taskResult('failed', route.model.id, supervisor, message);
        }
      }
    }
    return taskResult('cancelled', route.model.id, supervisor, 'User cancelled the task.');
  } catch (error) {
    if (token.isCancellationRequested) {
      return taskResult('cancelled', route.model.id, supervisor, 'User cancelled the task.');
    }
    const message = error instanceof Error ? error.message : String(error);
    stream.markdown(`\n\n**Task failed:** ${message}`);
    return taskResult('failed', route.model.id, supervisor, message);
  }
}

function taskResult(
  state: TaskExecutionResult['state'],
  model: string,
  supervisor: ProgressSupervisor,
  summary: string
): TaskExecutionResult {
  return {
    state,
    model,
    actionCount: supervisor.snapshot().actionCount,
    summary: summary.replace(/\s+/g, ' ').trim().slice(0, 500)
  };
}

async function workspaceFileMap(): Promise<string[]> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) return [];
  const files = await vscode.workspace.findFiles(
    new vscode.RelativePattern(folders[0], '**/*'),
    '**/{.git,node_modules,out,dist,build}/**',
    200
  );
  return files.map(uri => vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/')).sort();
}

function latestPendingPlan(context: vscode.ChatContext): PlanMetadata | undefined {
  for (let index = context.history.length - 1; index >= 0; index -= 1) {
    const turn = context.history[index];
    if (turn instanceof vscode.ChatResponseTurn) {
      const orchestration = getRigelMetadata(turn.result.metadata)?.orchestration;
      if (orchestration?.kind === 'run') return undefined;
      if (orchestration?.kind === 'plan' && orchestration.state === 'awaitingApproval') {
        return orchestration;
      }
    }
  }
  return undefined;
}

function renderOrchestrationResult(
  outcomes: readonly { title: string; category: ModelCategory; state: string; model?: string; actionCount: number }[],
  state: string,
  stopReason?: string
): string {
  return [
    '',
    '---',
    `**Rigel orchestration ${state}.**`,
    '',
    ...outcomes.map((outcome, index) =>
      `${index + 1}. ${escapeMarkdown(outcome.title)} — \`${outcome.category}\` / \`${escapeMarkdown(outcome.model ?? 'unavailable')}\` — **${outcome.state}** (${outcome.actionCount} actions)`
    ),
    stopReason ? `\nStopped: ${escapeMarkdown(stopReason)}` : ''
  ].filter(Boolean).join('\n');
}

function requestedCategory(command: string | undefined, configured: ModelCategory): ModelCategory {
  if (command === 'lightweight') return 'Lightweight';
  if (command === 'versatile') return 'Versatile';
  if (command === 'powerful' || command === 'rescue') return 'Powerful';
  return configured;
}

function buildMessages(
  prompt: string,
  context: vscode.ChatContext,
  fresh: boolean
): vscode.LanguageModelChatMessage[] {
  const messages = [vscode.LanguageModelChatMessage.User(systemInstructions())];

  if (!fresh) {
    for (const turn of context.history.slice(-6)) {
      if (turn instanceof vscode.ChatRequestTurn) {
        messages.push(vscode.LanguageModelChatMessage.User(turn.prompt));
      } else if (turn instanceof vscode.ChatResponseTurn) {
        const content = turn.response
          .filter((part): part is vscode.ChatResponseMarkdownPart => part instanceof vscode.ChatResponseMarkdownPart)
          .map(part => part.value.value)
          .join('');
        if (content) {
          messages.push(vscode.LanguageModelChatMessage.Assistant(content));
        }
      }
    }
  }

  messages.push(vscode.LanguageModelChatMessage.User(prompt));
  return messages;
}

function systemInstructions(): string {
  return [
    '<rigel_instructions>',
    'You are the worker in a transparent, cost-aware coding session.',
    'Use the supplied tools to inspect the workspace instead of asking the user to paste repository contents.',
    'Read narrowly and do not dump or summarize unrelated files.',
    'Before changing code, gather enough evidence to identify the root cause or requested design.',
    'Use write and command tools only when needed; the editor will request user confirmation.',
    'After a change, run the narrowest relevant validation available.',
    'If an approach fails, form a materially different hypothesis before trying again.',
    'Do not repeat an identical tool call unless the workspace changed and the repeat is necessary.',
    'Never claim a file changed or a command passed unless the corresponding tool result confirms it.',
    'Finish with a concise summary of changes and validation.',
    '</rigel_instructions>'
  ].join('\n');
}

function rigelTools(): vscode.LanguageModelChatTool[] {
  return vscode.lm.tools
    .filter(tool => TOOL_NAMES.has(tool.name))
    .map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema
    }));
}

async function expandReferences(
  references: readonly vscode.ChatPromptReference[],
  stream: vscode.ChatResponseStream
): Promise<string> {
  const parts: string[] = [];
  let remainingBytes = MAX_TOTAL_REFERENCE_BYTES;

  for (const reference of references) {
    if (remainingBytes <= 0) {
      stream.progress('Additional attached context was omitted because Rigel reached its context limit.');
      break;
    }

    try {
      if (reference.value instanceof vscode.Uri) {
        const bytes = await vscode.workspace.fs.readFile(reference.value);
        const excerpt = byteLimitedText(bytes, Math.min(MAX_REFERENCE_BYTES, remainingBytes));
        remainingBytes -= excerpt.bytesUsed;
        parts.push([
          `<file path="${vscode.workspace.asRelativePath(reference.value)}">`,
          excerpt.text,
          excerpt.truncated ? '\n[truncated]' : '',
          '</file>'
        ].join('\n'));
        stream.reference(reference.value);
      } else if (reference.value instanceof vscode.Location) {
        const document = await vscode.workspace.openTextDocument(reference.value.uri);
        const excerpt = byteLimitedText(
          new TextEncoder().encode(document.getText(reference.value.range)),
          Math.min(MAX_REFERENCE_BYTES, remainingBytes)
        );
        remainingBytes -= excerpt.bytesUsed;
        parts.push([
          `<selection path="${vscode.workspace.asRelativePath(reference.value.uri)}">`,
          excerpt.text,
          excerpt.truncated ? '\n[truncated]' : '',
          '</selection>'
        ].join('\n'));
        stream.reference(reference.value);
      } else if (typeof reference.value === 'string') {
        const excerpt = byteLimitedText(
          new TextEncoder().encode(reference.value),
          Math.min(MAX_REFERENCE_BYTES, remainingBytes)
        );
        remainingBytes -= excerpt.bytesUsed;
        parts.push(`<context>\n${excerpt.text}${excerpt.truncated ? '\n[truncated]' : ''}\n</context>`);
      }
    } catch (error) {
      stream.progress(`Could not read attached context: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return parts.length ? `User-attached context:\n\n${parts.join('\n\n')}` : '';
}

function byteLimitedText(bytes: Uint8Array, limit: number): { text: string; bytesUsed: number; truncated: boolean } {
  const bytesUsed = Math.min(bytes.byteLength, limit);
  return {
    text: new TextDecoder().decode(bytes.slice(0, bytesUsed)),
    bytesUsed,
    truncated: bytes.byteLength > bytesUsed
  };
}


async function checkContextBudget(
  model: vscode.LanguageModelChat,
  messages: vscode.LanguageModelChatMessage[],
  token: vscode.CancellationToken
): Promise<SupervisorDecision | undefined> {
  const reserve = Math.min(4096, Math.max(512, Math.floor(model.maxInputTokens / 5)));
  const safeInputLimit = Math.max(1, model.maxInputTokens - reserve);
  let inputTokens = 0;
  for (const message of messages) {
    inputTokens += await model.countTokens(message, token);
    if (inputTokens > safeInputLimit) {
      return {
        action: 'escalate',
        reason: `The accumulated context reached ${inputTokens} tokens, above Rigel's ${safeInputLimit}-token input limit for this model.`,
        evidence: ['The current run was stopped before another model request could exceed the context window.']
      };
    }
  }
  return undefined;
}

async function finishWithCurrentModel(
  model: vscode.LanguageModelChat,
  messages: vscode.LanguageModelChatMessage[],
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
  category: ModelCategory,
  routeReason: string,
  supervisor: ProgressSupervisor,
  handoffConsumed: boolean,
  goal: string
): Promise<vscode.ChatResult> {
  const actionCount = supervisor.snapshot().actionCount;
  stream.markdown(`\n\n> **Rigel checkpoint:** ${actionCount} tool actions completed. Asking the current model to finish without more tools; this is not an escalation.\n\n`);
  messages.push(vscode.LanguageModelChatMessage.User(
    'Rigel has reached the tool-action budget. Do not request more tools. Give the best final answer possible from the evidence already collected, clearly naming anything that remains unverified.'
  ));
  const contextDecision = await checkContextBudget(model, messages, token);
  let finalMessages = messages;
  if (contextDecision) {
    stream.markdown('\n\n> The full context is too large for a safe final turn. Rigel is compacting the handoff and keeping the same model.\n\n');
    finalMessages = [
      vscode.LanguageModelChatMessage.User(systemInstructions()),
      vscode.LanguageModelChatMessage.User([
        `Goal: ${goal}`,
        `Tool actions completed: ${actionCount}`,
        'Recent supervisor evidence:',
        ...supervisor.snapshot().evidence.map(item => `- ${item}`),
        '',
        'The detailed tool transcript was omitted to fit the context window. Do not call tools. Give a concise final status and clearly identify anything unverified.'
      ].join('\n'))
    ];
  }

  const response = await model.sendRequest(
    finalMessages,
    { justification: 'Finish a user-initiated coding task after its local tool budget was reached.' },
    token
  );
  for await (const part of response.stream) {
    if (part instanceof vscode.LanguageModelTextPart) {
      stream.markdown(part.value);
    }
  }
  return successMetadata(
    model,
    category,
    routeReason,
    supervisor,
    handoffConsumed,
    `Reached the ${actionCount}-action budget and finished with the same model.`
  );
}

function skippedToolResultPart(call: vscode.LanguageModelToolCallPart): vscode.LanguageModelToolResultPart {
  return new vscode.LanguageModelToolResultPart(call.callId, [
    new vscode.LanguageModelTextPart(JSON.stringify({
      ok: false,
      skipped: true,
      error: 'Rigel skipped this tool call because the configured action budget was reached.'
    }))
  ]);
}

function toolOutcome(toolResult: vscode.LanguageModelToolResult): ToolOutcome {
  const text = toolResult.content
    .filter((part): part is vscode.LanguageModelTextPart => part instanceof vscode.LanguageModelTextPart)
    .map(part => part.value)
    .join('\n');

  try {
    const parsed = JSON.parse(text) as {
      ok?: boolean;
      error?: string;
      stderr?: string;
      stdout?: string;
      changedWorkspace?: boolean;
    };
    return {
      ok: parsed.ok !== false,
      summary: parsed.error || parsed.stderr || parsed.stdout || text || 'Tool completed.',
      changedWorkspace: parsed.changedWorkspace === true
    };
  } catch {
    return { ok: true, summary: text || 'Tool completed.', changedWorkspace: false };
  }
}

function renderRouteBanner(
  model: vscode.LanguageModelChat,
  category: ModelCategory,
  reason: string,
  price: ModelPrice | undefined,
  inputTokens: number,
  rescue: boolean
): string {
  const lines = [
    `> **Rigel:** ${rescue ? 'fresh rescue with' : 'starting with'} \`${model.name}\``,
    `> Category: \`${category}\` · ${reason}`,
    price
      ? `> Published rate at approximately ${inputTokens.toLocaleString()} starting input tokens: ${formatPrice(price)}.`
      : '> Published rate: unavailable for this runtime model.',
    category === 'Powerful'
      ? '> Downshift policy: Powerful is leased only for this request or task; the next boundary routes independently.'
      : '> Downshift policy: this category is scoped to the current request or task.',
    '> Data path: local extension → VS Code Copilot. Rigel has no backend or telemetry.',
    ''
  ];
  return lines.join('  \n');
}

function renderEscalation(
  stream: vscode.ChatResponseStream,
  goal: string,
  model: vscode.LanguageModelChat,
  category: ModelCategory,
  routeReason: string,
  decision: SupervisorDecision
): vscode.ChatResult {
  const handoff = createHandoff(goal, describeModel(model), decision);
  const evidence = handoff.evidence.map(item => `> - ${item}`).join('\n');
  stream.markdown([
    '',
    '---',
    '**Rigel circuit breaker stopped this worker.**',
    '',
    `Reason: ${handoff.reason}`,
    '',
    evidence,
    '',
    'Choose **Rescue with a powerful model** below. The rescue starts with a compact handoff rather than inheriting the worker’s full reasoning context.'
  ].join('\n'));

  return {
    metadata: {
      rigel: {
        version: 1,
        model: model.id,
        category,
        routeReason,
        supervisorReason: decision.reason,
        handoff
      } satisfies RigelMetadata
    }
  };
}

function successMetadata(
  model: vscode.LanguageModelChat,
  category: ModelCategory,
  routeReason: string,
  supervisor: ProgressSupervisor,
  handoffConsumed: boolean,
  completionReason?: string
): vscode.ChatResult {
  const snapshot = supervisor.snapshot();
  return {
    metadata: {
      rigel: {
        version: 1,
        model: model.id,
        category,
        routeReason,
        handoffConsumed,
        supervisorReason: completionReason ?? (snapshot.actionCount
          ? `Completed after ${snapshot.actionCount} supervised tool actions.`
          : 'Completed without tool actions.')
      } satisfies RigelMetadata
    }
  };
}

function explainLastDecision(context: vscode.ChatContext, stream: vscode.ChatResponseStream): void {
  const metadata = latestMetadata(context);
  if (!metadata) {
    stream.markdown('No Rigel routing decision exists in this chat yet.');
    return;
  }
  stream.markdown([
    '**Last Rigel decision**',
    `- Model: \`${metadata.model ?? 'none'}\``,
    `- Category: \`${metadata.category ?? 'unknown'}\``,
    `- Route: ${metadata.routeReason ?? 'No reason recorded.'}`,
    `- Supervisor: ${metadata.supervisorReason ?? 'No intervention.'}`
  ].join('\n'));
}

function latestHandoff(context: vscode.ChatContext): EscalationHandoff | undefined {
  for (let index = context.history.length - 1; index >= 0; index -= 1) {
    const turn = context.history[index];
    if (turn instanceof vscode.ChatResponseTurn) {
      const metadata = getRigelMetadata(turn.result.metadata);
      if (metadata?.handoffConsumed) return undefined;
      if (metadata?.handoff) return metadata.handoff;
    }
  }
  return undefined;
}

function latestMetadata(context: vscode.ChatContext): RigelMetadata | undefined {
  for (let index = context.history.length - 1; index >= 0; index -= 1) {
    const turn = context.history[index];
    if (turn instanceof vscode.ChatResponseTurn) {
      const metadata = getRigelMetadata(turn.result.metadata);
      if (metadata) return metadata;
    }
  }
  return undefined;
}

function getRigelMetadata(metadata: vscode.ChatResult['metadata']): RigelMetadata | undefined {
  const value = metadata?.rigel;
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Partial<RigelMetadata>;
  return candidate.version === 1 ? candidate as RigelMetadata : undefined;
}
