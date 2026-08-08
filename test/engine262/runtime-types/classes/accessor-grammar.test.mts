import { test, expect } from 'vitest';
import { evaluated, evaluatedFlagOff } from '../harness.mts';

/**
 * PLAN-accessor.md stage A: the `accessor` grammar under `runtime-types`.
 *
 * README.md: "An `accessor` field declares a typed field together with a getter
 * and setter over it. It desugars to a private typed field and the matching
 * pair, so the backing field participates in the memory layout, and an
 * undecorated accessor is inlined to a direct field access."
 *
 * STAGE A OPENS THE GRAMMAR AND NOTHING ELSE. None of the desugaring is built,
 * so an `accessor` declaration is REFUSED at evaluation rather than treated as
 * the plain field it currently resembles. That refusal is the deliberate part:
 * a plain field gets and sets, which is close enough to an accessor to read as
 * support while reflecting as `ClassField` and occupying the wrong kind of
 * slot. Stage B replaces the refusal with the desugaring, and these tests flip
 * to assert behaviour rather than a limit.
 *
 * THE GRAMMAR IS THIS PROPOSAL'S, NOT TC39'S. The `decorators` feature is
 * mutually exclusive with `runtime-types` and is never enabled here. What the
 * two share is the DISAMBIGUATION - `accessor` is not a reserved word, so it is
 * the modifier only when a property name follows on the same line - and that is
 * pure syntax, kept in one place because a rule written twice drifts.
 */

const outcome = (source: string): string => evaluated(`try { eval(${JSON.stringify(source)}); "ACCEPTED"; } catch (e) { e.constructor.name; }`);

test('every form of the declaration parses and works', () => {
  // All four forms of README's grammar, plus the two the shape implies: an
  // accessor need not be typed, and need not be initialized. Stage B made these
  // evaluate rather than be refused, so each is asserted by its RESULT - a
  // parse-only assertion would now pass against a declaration that parsed and
  // did nothing.
  expect(evaluated('class A { accessor a: uint32 = 5; } String(new A().a);')).toBe('5');
  expect(evaluated('class A { static accessor count: uint32 = 3; } String(A.count);')).toBe('3');
  expect(evaluated('class A { accessor a = 5; } String(new A().a);')).toBe('5');
  expect(evaluated('class A { accessor a: uint32; } String(new A().a);')).toBe('0');
  // A decoration in front of one parses and fires, which is the whole point of
  // the stage - though the CONTEXT it fires with is stage E's business.
  expect(evaluated('let n = 0; function f(c) { n += 1; } class A { @f accessor a: uint32 = 5; } String(n);')).toBe('1');
  // The private forms are stage B's remainder (PLAN-accessor.md section 2.3), refused
  // rather than crashing: see accessor-semantics.test.mts.
  // A PRIVATE accessor landed (PLAN-accessor.md section 2.3) - see
  // accessor-semantics.test.mts for what it desugars to.
  expect(outcome('class A { accessor #internal: int32 = 0; }')).toBe('ACCEPTED');
});

test('the positions the design refuses stay refused', () => {
  // Cycle 132 settled that a decorator precedes a type only where the position
  // has a reflection context, and an accessor's annotation is a FIELD's, not a
  // return's. The accessor grammar must not reopen it.
  expect(outcome('function f(c) {} class A { accessor a: @f uint32 = 5; }')).toBe('SyntaxError');
  // README: abstract fields and accessors "are not part of the proposal". An
  // abstract FIELD is already a SyntaxError, and the accessor inherits it
  // rather than needing a rule of its own - asserted so that a later stage
  // making abstract fields legal does not silently make abstract accessors
  // legal with them.
  expect(outcome('abstract class A { abstract accessor a: uint32; }')).toBe('SyntaxError');
  expect(outcome('abstract class A { abstract a: uint32; }')).toBe('SyntaxError');
});

test('`accessor` is still an ordinary identifier, which is the hazard', () => {
  // `accessor` is not a reserved word. It is the modifier only when a property
  // name follows ON THE SAME LINE; everywhere else it is a name. These passed
  // before stage A because the keyword did not exist at all - they pass now
  // only because the lookahead is right, which is what makes them worth having.
  expect(evaluated('class A { accessor = 1; } String(new A().accessor);')).toBe('1');
  expect(evaluated('class A { accessor: uint8 = 7; } String(new A().accessor);')).toBe('7');
  expect(evaluated('class A { accessor() { return "m"; } } (new A()).accessor();')).toBe('m');
  expect(evaluated('const accessor = 3; String(accessor);')).toBe('3');
  expect(evaluated('class A { static accessor = 9; } String(A.accessor);')).toBe('9');
  // THE LINE-TERMINATOR CASE, which is the one a careless lookahead breaks: a
  // newline between `accessor` and a name makes them TWO FIELDS, not one
  // accessor. If this regressed it would report the refusal above instead.
  expect(evaluated('class A { accessor\n  a = 1; } const o = new A(); String(o.accessor) + "/" + String(o.a);')).toBe('undefined/1');
});

test('the keyword belongs to the feature, not to the engine', () => {
  // With `runtime-types` off there is no `accessor` modifier at all, so the
  // word is only ever a name. This is what says the grammar was added to THIS
  // proposal rather than to the language.
  expect(evaluatedFlagOff('try { eval("class A { accessor a = 5; }"); "ACCEPTED"; } catch (e) { e.constructor.name; }')).toBe('SyntaxError');
  expect(evaluatedFlagOff('class A { accessor = 1; } String(new A().accessor);')).toBe('1');
});
