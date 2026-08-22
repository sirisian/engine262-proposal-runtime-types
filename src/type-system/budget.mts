import { surroundingAgent } from '#self';

/**
 * proposal-runtime-types #sec-evaluation-budget.
 *
 * "Evaluation under this clause is metered by two host-defined limits: a count
 * of evaluation steps and a count of constructed Type Records, each per
 * top-level type-position evaluation."
 *
 * The checker and the checking pass RUN USER CODE by design - a builder at
 * specialization, a `where` predicate at a check, a meta hook at a crossing -
 * so an unbudgeted checker is a denial-of-service surface on any tool that
 * runs one. That is what this meters. It is not a performance guard: the
 * clause is explicit that "the limits decide whether compilation fails, never
 * what it produces", so a host that raises a floor can only turn a failure
 * into a result and never a result into a different one.
 *
 * EXHAUSTION IS STICKY, which is how "not an abrupt completion the evaluated
 * code can observe" is realized here. The clause says no `try` within the
 * evaluation handles it and the evaluation is abandoned. A thrown completion
 * would be catchable by a `where` predicate's own `try`, so instead the state
 * is recorded and every metered point after it short-circuits: user code may
 * catch whatever it likes and the containing type-position evaluation still
 * fails, which is the observable behaviour the clause requires.
 */

/** The floors #sec-evaluation-budget fixes. A host meets or exceeds them. */
export const DEFAULT_STEP_LIMIT = 10_000_000;
export const DEFAULT_RECORD_LIMIT = 1_000_000;

interface BudgetFrame {
  steps: number;
  records: number;
  stepLimit: number;
  recordLimit: number;
  exhausted: 'steps' | 'records' | null;
}

const frames: BudgetFrame[] = [];

function hostLimits(): { steps: number, records: number } {
  const hostDefined = (surroundingAgent.currentRealmRecord as unknown as {
    HostDefined?: { typeEvaluationBudget?: { steps?: number, records?: number } },
  })?.HostDefined;
  const configured = hostDefined?.typeEvaluationBudget;
  return {
    steps: typeof configured?.steps === 'number' ? configured.steps : DEFAULT_STEP_LIMIT,
    records: typeof configured?.records === 'number' ? configured.records : DEFAULT_RECORD_LIMIT,
  };
}

/**
 * Bracket one TOP-LEVEL type-position evaluation. Nested calls join the
 * enclosing frame rather than opening a new one, which is what "per top-level"
 * means: a builder that calls a builder is one budget, or the recursion the
 * budget exists to bound could reset it by recursing.
 */
export function BeginTypeEvaluation(): void {
  if (frames.length > 0) {
    frames.push(frames[frames.length - 1]!);
    return;
  }
  const limits = hostLimits();
  frames.push({
    steps: 0, records: 0, stepLimit: limits.steps, recordLimit: limits.records, exhausted: null,
  });
}

export function EndTypeEvaluation(): void {
  frames.pop();
}

function current(): BudgetFrame | null {
  return frames.length > 0 ? frames[frames.length - 1]! : null;
}

/**
 * Charge evaluation steps. Called where the type machinery runs USER CODE,
 * which is the cost the clause is about; the engine's own walking is bounded
 * by the source text and needs no meter.
 */
export function ConsumeEvaluationSteps(n: number): void {
  const frame = current();
  if (!frame || frame.exhausted !== null) {
    return;
  }
  frame.steps += n;
  if (frame.steps > frame.stepLimit) {
    frame.exhausted = 'steps';
  }
}

/** Charge one constructed Type Record. */
export function CountConstructedTypeRecord(): void {
  const frame = current();
  if (!frame || frame.exhausted !== null) {
    return;
  }
  frame.records += 1;
  if (frame.records > frame.recordLimit) {
    frame.exhausted = 'records';
  }
}

/** Whether the enclosing type-position evaluation has been abandoned. */
/**
 * Depth of meta-hook evaluation, so the step meter charges WHILE user code runs
 * rather than only when a hook is entered.
 *
 * PLAN-crossing-budget.md phase 1. The budget charged one step per hook CALL, so
 * a hook that looped forever never returned to be charged again and the bound
 * never bit. #sec-evaluation-budget: "The budget bounds a computation, which
 * either completes or is abandoned and reported" - a loop inside a hook body
 * does neither.
 *
 * A DEPTH rather than a flag: a hook may call another, and the charge must
 * continue across the inner call rather than stop when it returns.
 */
let hookDepth = 0;

export function EnterMetaHookEvaluation(): void {
  hookDepth += 1;
}

export function ExitMetaHookEvaluation(): void {
  hookDepth -= 1;
}

/** Whether a node evaluation is happening inside a meta hook. */
export function InMetaHookEvaluation(): boolean {
  return hookDepth > 0;
}

export function IsBudgetExhausted(): boolean {
  return current()?.exhausted != null;
}

/** Which limit was reached, for the diagnostic the clause asks to name. */
export function BudgetExhaustionKind(): 'steps' | 'records' | null {
  return current()?.exhausted ?? null;
}

/** Test and debugging support: what the enclosing frame has spent. */
export function BudgetSpent(): { steps: number, records: number } | null {
  const frame = current();
  return frame ? { steps: frame.steps, records: frame.records } : null;
}
