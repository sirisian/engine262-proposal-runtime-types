import { test, expect } from 'vitest';
import {
  Agent, FirstEvaluabilityViolation, ManagedRealm, Parser, setSurroundingAgent,
} from '#self';

/**
 * Spec: #sec-preprocessor-modules (Preprocessor Modules) - the evaluability
 * requirement of
 * `sec-preprocessor-modules`.
 */

function check(source: string): string {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  void new ManagedRealm();
  const module = new Parser({ source, specifier: 't' }).parseModule();
  const violation = FirstEvaluabilityViolation(module);
  return violation ? violation.name : 'evaluable';
}

test('a macro that computes over its tokens is evaluable', () => {
  expect(check('export function d(i) { return i.map((t) => t); }')).toBe('evaluable');
  // LOCAL mutation is fine - typeprogramming.md is explicit that a Set of seen
  // keys or an accumulator is evaluable and only SHARED module-level mutable
  // state is not. A macro must still be able to compute.
  expect(check('export function d(i) { const s = new Set(); return i.filter((t) => !s.has(t)); }')).toBe('evaluable');
  expect(check('export function d(i) { let n = 0; for (const t of i) { n += 1; } return n; }')).toBe('evaluable');
});

test('naming a source of NONDETERMINISM is a violation', () => {
  // The test is narrower and sharper than "impure": each of these makes the same
  // source expand differently on two runs, which is what forfeits caching.
  expect(check('export function d(i) { return Date.now(); }')).toBe('Date');
  expect(check('export function d(i) { return Math.random(); }')).toBe('Math');
  expect(check('export function d(i) { return fetch("x"); }')).toBe('fetch');
  expect(check('export function d(i) { return new WeakRef(i); }')).toBe('WeakRef');
  expect(check('export function d(i) { return setTimeout(() => 1, 0); }')).toBe('setTimeout');
});

test('`Date` and `Math` are ECMA-262, which is why the rule is not "262 versus host"', () => {
  // An earlier draft of the design drew the sandbox at "ECMA-262 yes,
  // host-defined no". **That line admits both of these**, and the determinism
  // argument the sandbox exists for does not survive either. The rule is the
  // PROPERTY - expansion is a pure function of its input - with the capability
  // list derived from it.
  expect(check('export function d(i) { return Date.now(); }')).toBe('Date');
  expect(check('export function d(i) { return Math.random(); }')).toBe('Math');
  expect(check('export function d(i) { return Intl.NumberFormat; }')).toBe('Intl');
});

test('EVALUATION is bound too, not only the decorator body', () => {
  // A module that read the network while evaluating would close over what it
  // read, and its decorators would be impure however pure their bodies looked.
  expect(check('const t = Date.now(); export function d(i) { return i; }')).toBe('Date');
  expect(check('export const seed = Math.random();')).toBe('Math');
});

test('a SHADOWED name is the module\'s own', () => {
  // Naming a local `Date` does not touch the ambient one. Tracked coarsely on
  // purpose: over-permitting a shadowed binding is a smaller error than refusing
  // a module that never reached the real thing.
  expect(check('export function d(i) { const Date = 1; return Date; }')).toBe('evaluable');
});

test('this is the NAMING half only', () => {
  // A full evaluability judgment - a body reads only its parameters, constants
  // and other evaluable functions - is a whole static analysis, and **this
  // engine holds no construct to it today**: the pre-evaluation type check says
  // so about enum initializers. So a module can still do impure things by
  // routes that name nothing forbidden, and that is a known gap rather than a
  // discovered one.
  expect(check('export function d(i) { return i.length; }')).toBe('evaluable');
  // Reading an imported binding is not checked here, for instance.
  expect(check('import { clock } from "./x.js"; export function d(i) { return clock(); }')).toBe('evaluable');
});
