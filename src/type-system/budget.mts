import type { PlainEvaluator } from '../evaluator.mts';
import { surroundingAgent, EnsureCompletion, Throw, Value } from '#self';

/** #sec-evaluation-budget. Counters measure logical requests, not allocation. */
export const DEFAULT_STEP_LIMIT = 10_000_000;
export const DEFAULT_RECORD_LIMIT = 1_000_000;
export const DEFAULT_DEPTH_LIMIT = 100;

interface BudgetFrame {
  steps: number;
  records: number;
  depth: number;
  stepLimit: number;
  recordLimit: number;
  depthLimit: number;
  exhausted: 'steps' | 'records' | 'depth' | null;
}

interface EvaluationState {
  frames: BudgetFrame[];
  hookSubjects: string[];
}

// Suspended or reentrant host evaluation of another agent cannot spend this agent's fuel.
const states = new WeakMap<object, EvaluationState>();

function state(): EvaluationState {
  let active = states.get(surroundingAgent);
  if (!active) {
    active = { frames: [], hookSubjects: [] };
    states.set(surroundingAgent, active);
  }
  return active;
}

function limit(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError('type evaluation limits must be non-negative safe integers');
  }
  return value;
}

function hostLimits(): { steps: number, records: number, depth: number } {
  const hostDefined = (surroundingAgent.currentRealmRecord as unknown as {
    HostDefined?: { typeEvaluationBudget?: { steps?: number, records?: number, depth?: number } },
  })?.HostDefined;
  const configured = hostDefined?.typeEvaluationBudget;
  return {
    steps: limit(configured?.steps, DEFAULT_STEP_LIMIT),
    records: limit(configured?.records, DEFAULT_RECORD_LIMIT),
    depth: limit(configured?.depth, DEFAULT_DEPTH_LIMIT),
  };
}

/**
 * Bracket one TOP-LEVEL type-position evaluation. Nested calls join the
 * enclosing frame rather than opening a new one, which is what "per top-level"
 * means: a builder that calls a builder is one budget, or the recursion the
 * budget exists to bound could reset it by recursing.
 */
export function BeginTypeEvaluation(): void {
  const { frames } = state();
  if (frames.length > 0) {
    // A nested evaluation JOINS the enclosing frame - the same object is pushed
    // again, retaining the shared counters and sticky exhaustion state.
    const joined = frames[frames.length - 1]!;
    joined.depth += 1;
    if (joined.exhausted === null && joined.depth > joined.depthLimit) {
      joined.exhausted = 'depth';
    }
    frames.push(joined);
    return;
  }
  const limits = hostLimits();
  frames.push({
    steps: 0,
    records: 0,
    depth: 1,
    stepLimit: limits.steps,
    recordLimit: limits.records,
    depthLimit: limits.depth,
    exhausted: limits.depth < 1 ? 'depth' : null,
  });
}

export function EndTypeEvaluation(): void {
  const { frames } = state();
  const frame = frames[frames.length - 1];
  if (frame) {
    frame.depth -= 1;
  }
  frames.pop();
}

function current(): BudgetFrame | null {
  const { frames } = state();
  return frames.length > 0 ? frames[frames.length - 1]! : null;
}

/** Charge logical work without losing integer precision at the configured bound. */
export function ConsumeEvaluationSteps(n: number): void {
  const frame = current();
  if (!frame || frame.exhausted !== null) {
    return;
  }
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError('invalid type evaluation charge');
  if (n > frame.stepLimit - frame.steps) {
    frame.exhausted = 'steps';
  } else {
    frame.steps += n;
  }
}

/** Charge one GetTypeObject request, including an intern-table hit. */
export function CountTypeConstructionRequest(): void {
  const frame = current();
  if (!frame || frame.exhausted !== null) {
    return;
  }
  if (frame.records === frame.recordLimit) {
    frame.exhausted = 'records';
  } else {
    frame.records += 1;
  }
}

/** The subject stack also identifies nested builders, inverses and defaults. */
export function EnterTypeComputation(subject = 'a meta hook'): void {
  state().hookSubjects.push(subject);
}

export function ExitTypeComputation(): void {
  state().hookSubjects.pop();
}

/** The innermost hook being evaluated, for the diagnostic. */
export function CurrentTypeComputationSubject(): string {
  const { hookSubjects } = state();
  return hookSubjects.length > 0 ? hookSubjects[hookSubjects.length - 1]! : 'a meta hook';
}

/** Whether evaluated user code belongs to a metered type computation. */
export function InTypeComputation(): boolean {
  return state().hookSubjects.length > 0;
}

export function IsBudgetExhausted(): boolean {
  return current()?.exhausted != null;
}

/** Which limit was reached, for the diagnostic the clause asks to name. */
export function BudgetExhaustionKind(): 'steps' | 'records' | 'depth' | null {
  return current()?.exhausted ?? null;
}

/** Test and debugging support: what the enclosing frame has spent. */
export function BudgetSpent(): { steps: number, records: number } | null {
  const frame = current();
  return frame ? { steps: frame.steps, records: frame.records } : null;
}

/** Meter the whole computation and inspect sticky exhaustion before closing its frame. */
export function* EvaluateWithTypeBudget<T>(subject: string, evaluation: PlainEvaluator<T>): PlainEvaluator<T> {
  BeginTypeEvaluation();
  EnterTypeComputation(subject);
  try {
    ConsumeEvaluationSteps(1);
    if (!IsBudgetExhausted()) {
      const result = EnsureCompletion(yield* evaluation);
      if (!IsBudgetExhausted()) return result;
    }
    return Throw.TypeError('the type evaluation budget was exhausted at $1', Value(subject));
  } finally {
    ExitTypeComputation();
    EndTypeEvaluation();
  }
}
