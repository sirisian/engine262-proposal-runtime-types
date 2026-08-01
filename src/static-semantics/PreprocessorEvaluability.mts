import type { ParseNode } from '../parser/ParseNode.mts';

/**
 * proposal-runtime-types `sec-preprocessor-modules`: a preprocessor module and
 * every export of it used as a replacement decorator must be compile-time
 * evaluable.
 *
 * typeprogramming.md states the discipline and states why it is a discipline
 * rather than a jail: "an evaluable function *cannot name* ambient mutable
 * state, I/O, or nondeterminism, so there is nothing to escape from", and
 * "Evaluability rules out `Date.now`, `Math.random`, I/O, and ambient reads by
 * construction, so builds are deterministic and the 'sandbox' is a property of
 * what the code can NAME rather than a wall around what it does."
 *
 * **This implements the NAMING half, which is the determinism-critical one.** A
 * full evaluability judgment - a body reads only its parameters, constants and
 * other evaluable functions - is a whole static analysis, and this engine holds
 * NO construct to it today: `RunPreEvaluationTypeCheck` says so in as many
 * words about enum initializers. Building it here for preprocessor modules
 * alone would be one construct held to a rule the rest of the language is not.
 *
 * What the naming half buys on its own is the property the phase exists for:
 * expansion cannot read a clock, a random source, or the network, so the same
 * source expands the same way twice and an implementation may cache the result
 * beside the code it compiled to.
 */

/**
 * The bindings a preprocessor module may not name.
 *
 * Each is here because naming it makes expansion NON-DETERMINISTIC, which is a
 * narrower and sharper test than "impure". `Date` and `Math` are ECMA-262, not
 * host additions - an earlier draft of the design drew the line at
 * "262 versus host-defined" and that line admits both.
 */
const FORBIDDEN = new Map<string, string>([
  ['Date', 'the wall clock'],
  ['Temporal', 'the wall clock'],
  ['Math', 'randomness (Math.random)'],
  ['WeakRef', 'observable garbage collection'],
  ['FinalizationRegistry', 'observable garbage collection'],
  ['SharedArrayBuffer', 'cross-agent state'],
  ['Atomics', 'cross-agent state'],
  ['Intl', "the host's locale data"],
  ['fetch', 'the network'],
  ['XMLHttpRequest', 'the network'],
  ['setTimeout', 'timers'],
  ['setInterval', 'timers'],
  ['queueMicrotask', 'timers'],
  ['globalThis', 'ambient state'],
  ['eval', 'ambient state'],
]);

export interface EvaluabilityViolation {
  readonly name: string;
  readonly why: string;
  readonly node: ParseNode;
}

/**
 * The first name a module reads that expansion may not depend on, or
 * *undefined* if it reads none.
 *
 * A reference is a violation wherever it appears - a preprocessor module's
 * top-level evaluation is as much a part of expansion as a decorator's body,
 * because a module that reads the network while evaluating closes over what it
 * read and its decorators are impure however pure their bodies look.
 */
export function FirstEvaluabilityViolation(root: ParseNode): EvaluabilityViolation | undefined {
  let found: EvaluabilityViolation | undefined;
  const shadowed = new Set<string>();

  const visit = (node: unknown): void => {
    if (found || node === null || typeof node !== 'object') {
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    const n = node as ParseNode & { type?: string, name?: string };
    // A local binding of a forbidden name is the module's own, not the ambient
    // one, so naming it is not a violation. Tracked coarsely and deliberately:
    // over-permitting a shadowed `Date` is a smaller error than refusing a
    // module that never touched the real one.
    if (n.type === 'BindingIdentifier' && typeof n.name === 'string') {
      shadowed.add(n.name);
    }
    if (n.type === 'IdentifierReference' && typeof n.name === 'string' && !shadowed.has(n.name)) {
      const why = FORBIDDEN.get(n.name);
      if (why !== undefined) {
        found = { name: n.name, why, node: n };
        return;
      }
    }
    for (const key of Object.keys(n)) {
      if (key === 'location' || key === 'sourceText' || key === 'strict') {
        continue;
      }
      visit((n as unknown as Record<string, unknown>)[key]);
    }
  };
  visit(root);
  return found;
}
