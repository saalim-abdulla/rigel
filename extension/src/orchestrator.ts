import type { ModelCategory } from './pricing-catalog';
import type { PlannedTask, TaskPlan } from './task-plan';

export type TaskState = 'succeeded' | 'failed' | 'stalled' | 'cancelled';

export interface TaskOutcome {
  index: number;
  title: string;
  category: ModelCategory;
  model?: string;
  state: TaskState;
  actionCount: number;
  summary: string;
}

export interface TaskExecutionResult {
  state: TaskState;
  model?: string;
  actionCount: number;
  summary: string;
}

export interface OrchestrationResult {
  state: TaskState;
  completedTasks: number;
  outcomes: TaskOutcome[];
  stopReason?: string;
}

export async function runTaskPlan(
  plan: TaskPlan,
  execute: (task: PlannedTask, index: number) => Promise<TaskExecutionResult>,
  cancelled: () => boolean
): Promise<OrchestrationResult> {
  const outcomes: TaskOutcome[] = [];
  for (let index = 0; index < plan.tasks.length; index += 1) {
    if (cancelled()) {
      return { state: 'cancelled', completedTasks: outcomes.length, outcomes, stopReason: 'User cancelled the plan.' };
    }
    const task = plan.tasks[index];
    const result = await execute(task, index);
    outcomes.push({
      index,
      title: task.title,
      category: task.category,
      model: result.model,
      state: result.state,
      actionCount: result.actionCount,
      summary: result.summary.slice(0, 500)
    });
    if (result.state !== 'succeeded') {
      return {
        state: result.state,
        completedTasks: outcomes.filter(outcome => outcome.state === 'succeeded').length,
        outcomes,
        stopReason: `Task ${index + 1} (${task.title}) ${result.state}.`
      };
    }
  }
  return { state: 'succeeded', completedTasks: outcomes.length, outcomes };
}
