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

/**
 * The NESTING limit, which the clause's floors do not state and which the host
 * imposes whether or not this file does.
 *
 * A step limit meters TOTAL work and cannot bound stack DEPTH: each level of a
 * recursive instantiation is a nested call, so a self-referential alias reaches
 * the host's own stack limit - a few thousand frames - long before ten million
 * steps. `type R<T> = R.<T>; type X = R.<uint8>;` therefore ended in a host
 * `Maximum call stack size exceeded`, which #sec-evaluation-budget rules out in
 * terms: exhaustion "is not an abrupt completion the evaluated code can
 * observe" and the evaluation is "abandoned". A host stack overflow is neither.
 * It escapes the engine entirely, so no program observes the diagnostic the
 * clause requires and the surrounding call dies with it.
 *
 * Set well below any host's stack so the metered failure always wins the race.
 * The margin has to be generous, because the stack cost of ONE level is not
 * fixed: measured here, a direct `R.<T>` and a recursion through an object
 * member survive to 200 while the same recursion through an ARRAY or a FUNCTION
 * member does not, those walking further per level. 100 covers every shape
 * tried - direct, object, array, tuple, function, union, and mutual A/B
 * recursion - and is far above any nesting a program writes on purpose.
 *
 * A host may raise it through `typeEvaluationBudget.depth`, as it may the other
 * two. This is a floor, not a ceiling, and a host with a deeper stack is free
 * to say so.
 */
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

const frames: BudgetFrame[] = [];

function hostLimits(): { steps: number, records: number, depth: number } {
  const hostDefined = (surroundingAgent.currentRealmRecord as unknown as {
    HostDefined?: { typeEvaluationBudget?: { steps?: number, records?: number, depth?: number } },
  })?.HostDefined;
  const configured = hostDefined?.typeEvaluationBudget;
  return {
    steps: typeof configured?.steps === 'number' ? configured.steps : DEFAULT_STEP_LIMIT,
    records: typeof configured?.records === 'number' ? configured.records : DEFAULT_RECORD_LIMIT,
    depth: typeof configured?.depth === 'number' ? configured.depth : DEFAULT_DEPTH_LIMIT,
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
    // A nested evaluation JOINS the enclosing frame - the same object is pushed
    // again - so its depth is the shared count, not the array length: the array
    // also grows for sibling evaluations that have already returned.
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
    exhausted: null,
  });
}

export function EndTypeEvaluation(): void {
  const frame = frames[frames.length - 1];
  if (frame) {
    frame.depth -= 1;
  }
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
/**
 * The hooks being evaluated, innermost last.
 *
 * PLAN-crossing-budget.md phase 4. #sec-evaluation-budget forbids an evaluation
 * that "ends in a way no program can observe and NO DIAGNOSTIC NAMES, which is
 * the outcome this clause exists to prevent" - so exhaustion inside a hook has
 * to name the hook, as `InstantiateGenericAlias` names its alias.
 *
 * A STACK rather than a counter: a hook may call another, and the diagnostic
 * should name the one that was running, not the one that started the chain.
 */
const hookSubjects: string[] = [];

export function EnterMetaHookEvaluation(subject = 'a meta hook'): void {
  hookSubjects.push(subject);
}

export function ExitMetaHookEvaluation(): void {
  hookSubjects.pop();
}

/** The innermost hook being evaluated, for the diagnostic. */
export function CurrentMetaHookSubject(): string {
  return hookSubjects.length > 0 ? hookSubjects[hookSubjects.length - 1]! : 'a meta hook';
}

/** Whether a node evaluation is happening inside a meta hook. */
export function InMetaHookEvaluation(): boolean {
  return hookSubjects.length > 0;
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
