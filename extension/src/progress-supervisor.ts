export type SupervisorAction = 'continue' | 'finish' | 'escalate';

export interface SupervisorDecision {
  action: SupervisorAction;
  reason?: string;
  evidence: string[];
}

export interface SupervisorOptions {
  maxActions: number;
  repeatedActionLimit: number;
  repeatedErrorLimit: number;
  evidenceLimit?: number;
}

export interface ToolCallEvent {
  kind: 'tool-call';
  tool: string;
  input: unknown;
  mutatesWorkspace?: boolean;
}

export interface ToolResultEvent {
  kind: 'tool-result';
  tool: string;
  input: unknown;
  ok: boolean;
  summary: string;
  changedWorkspace?: boolean;
}

export type ProgressEvent = ToolCallEvent | ToolResultEvent;

const DEFAULT_EVIDENCE_LIMIT = 8;
const SIGNATURE_TEXT_LIMIT = 400;

export class ProgressSupervisor {
  private readonly actionCounts = new Map<string, number>();
  private readonly errorCounts = new Map<string, number>();
  private readonly evidence: string[] = [];
  private actionCount = 0;
  private workspaceRevision = 0;

  constructor(private readonly options: SupervisorOptions) {
    if (options.maxActions < 1) {
      throw new Error('maxActions must be at least 1');
    }
    if (options.repeatedActionLimit < 2 || options.repeatedErrorLimit < 2) {
      throw new Error('repeat limits must be at least 2');
    }
  }

  observe(event: ProgressEvent): SupervisorDecision {
    if (event.kind === 'tool-call') {
      return this.observeToolCall(event);
    }
    return this.observeToolResult(event);
  }

  checkpoint(): SupervisorDecision {
    if (this.actionCount >= this.options.maxActions) {
      const reason = `The tool-action budget of ${this.options.maxActions} was reached.`;
      this.record(`${reason} The current model should finish without more tools.`);
      return { action: 'finish', reason, evidence: [...this.evidence] };
    }
    return this.continue();
  }

  snapshot(): { actionCount: number; evidence: string[] } {
    return {
      actionCount: this.actionCount,
      evidence: [...this.evidence]
    };
  }

  private observeToolCall(event: ToolCallEvent): SupervisorDecision {
    this.actionCount += 1;
    const revision = event.mutatesWorkspace ? 'mutation' : this.workspaceRevision;
    const signature = `${event.tool}:${stableStringify(event.input)}:${revision}`;
    const repeats = (this.actionCounts.get(signature) ?? 0) + 1;
    this.actionCounts.set(signature, repeats);
    this.record(`Action ${this.actionCount}: ${event.tool}`);

    if (repeats >= this.options.repeatedActionLimit) {
      const reason = `The same ${event.tool} call was requested ${repeats} times.`;
      this.record(reason);
      return this.escalate(reason);
    }

    return this.continue();
  }

  private observeToolResult(event: ToolResultEvent): SupervisorDecision {
    if (event.changedWorkspace) {
      this.workspaceRevision += 1;
      this.record(`${event.tool} changed the workspace; read-action tracking moved to a new revision.`);
    }

    const invocation = `${event.tool}:${stableStringify(event.input)}`;
    if (event.ok) {
      this.clearFailuresFor(invocation);
      return this.continue();
    }

    const normalized = normalizeError(event.summary);
    const signature = `${invocation}:${normalized}`;
    const repeats = (this.errorCounts.get(signature) ?? 0) + 1;
    this.errorCounts.set(signature, repeats);
    this.record(`${event.tool} failed: ${truncate(event.summary, 180)}`);

    if (repeats >= this.options.repeatedErrorLimit) {
      const reason = `The same ${event.tool} failure occurred ${repeats} times.`;
      this.record(reason);
      return this.escalate(reason);
    }

    return this.continue();
  }

  private clearFailuresFor(invocation: string): void {
    const prefix = `${invocation}:`;
    for (const signature of this.errorCounts.keys()) {
      if (signature.startsWith(prefix)) {
        this.errorCounts.delete(signature);
      }
    }
  }

  private continue(): SupervisorDecision {
    return { action: 'continue', evidence: [...this.evidence] };
  }

  private escalate(reason: string): SupervisorDecision {
    return { action: 'escalate', reason, evidence: [...this.evidence] };
  }

  private record(message: string): void {
    const limit = this.options.evidenceLimit ?? DEFAULT_EVIDENCE_LIMIT;
    this.evidence.push(message);
    if (this.evidence.length > limit) {
      this.evidence.splice(0, this.evidence.length - limit);
    }
  }
}

export function normalizeError(value: string): string {
  return value
    .toLowerCase()
    .replace(/\\/g, '/')
    .replace(/\b0x[0-9a-f]+\b/g, '<address>')
    .replace(/\b\d+(?:\.\d+)?(?:ms|s|kb|mb|gb)?\b/g, '<number>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, SIGNATURE_TEXT_LIMIT);
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
}

function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}
