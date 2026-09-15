import type { TaskOutcome, TaskState } from './orchestrator';
import type { TaskPlan } from './task-plan';

export interface PlanMetadata {
  kind: 'plan';
  state: 'awaitingApproval';
  planId: string;
  plannerModel: string;
  plannerRouteReason: string;
  plan: TaskPlan;
}

export interface RunMetadata {
  kind: 'run';
  state: TaskState;
  planId: string;
  completedTasks: number;
  totalTasks: number;
  outcomes: TaskOutcome[];
  stopReason?: string;
}

export type OrchestrationMetadata = PlanMetadata | RunMetadata;
