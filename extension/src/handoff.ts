import { SupervisorDecision } from './progress-supervisor';

export interface EscalationHandoff {
  goal: string;
  previousModel: string;
  reason: string;
  evidence: string[];
}

export function createHandoff(
  goal: string,
  previousModel: string,
  decision: SupervisorDecision
): EscalationHandoff {
  return {
    goal: goal.trim(),
    previousModel,
    reason: decision.reason ?? 'Rigel stopped the previous run.',
    evidence: [...decision.evidence]
  };
}

export function renderHandoff(handoff: EscalationHandoff): string {
  const evidence = handoff.evidence.length
    ? handoff.evidence.map(item => `- ${item}`).join('\n')
    : '- No additional evidence was recorded.';

  return [
    'You are taking over a coding task from another model after a circuit breaker stopped it.',
    '',
    `Goal: ${handoff.goal}`,
    `Previous model: ${handoff.previousModel}`,
    `Escalation reason: ${handoff.reason}`,
    '',
    'Recent evidence:',
    evidence,
    '',
    'Start from the current workspace state. Re-evaluate the approach rather than continuing the previous reasoning blindly. Inspect relevant files and tests before making further changes.'
  ].join('\n');
}
