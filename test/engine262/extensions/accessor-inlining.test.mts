import { test, expect } from 'vitest';
import { evaluated } from '../readme/harness.mts';

/**
 * PLAN-accessor.md stage F, and the answer to its §2.4.
 *
 * README: "an undecorated accessor is INLINED TO A DIRECT FIELD ACCESS". Two
 * readings, both with textual support, and they differ in what a program can
 * SEE:
 *
 *   1. An OPTIMIZATION. The pair is always installed and always observable; an
 *      engine may expand the call, and `get a() { return this.#backing; }`
 *      expanded IS a direct field access. README lists "operators, accessors,
 *      and small numeric kernels" among the things "called directly and only
 *      directly", which is the property that makes them inlinable.
 *   2. A SEMANTIC. An undecorated accessor installs no pair at all and is a
 *      data property; a decorated one installs the pair the decorator returned.
 *      README's `inline` section supports this reading too: an `inline`
 *      function's value cannot be taken, and "reading it as a property is a
 *      TypeError".
 *
 * SETTLED AS READING 1, and the deciding argument is what reading 2 costs:
 * DECORATING WOULD CHANGE THE CLASS'S OBSERVABLE SHAPE. The same declaration
 * would yield a data property or an accessor pair depending on whether a
 * decorator ran - different `getOwnPropertyDescriptor`, different own-property
 * enumeration, different `Object.keys`. decorators.md requires the `accessor`
 * keyword precisely so that "all decorators see the same context", which is a
 * stability argument; making the SHAPE unstable cuts against the same instinct.
 *
 * So the inlining is unobservable BY CONSTRUCTION, and what this file pins is
 * the commitment that makes it so: the shape does not depend on decoration.
 * No engine change was needed - stage B already built it this way - and the
 * value here is that the decision is now made and guarded rather than implicit.
 */

test('the observable shape does NOT depend on decoration', () => {
  // The assertion §2.4 turns on. If inlining were semantic these two would
  // differ, and every one of them is a thing a program can branch on.
  const shape = 'const d = Object.getOwnPropertyDescriptor(A.prototype, "a"); '
    + 'typeof d.get + "/" + typeof d.set + "/" + String(d.enumerable) + "/" + String(d.value); ';
  expect(evaluated(`class A { accessor a: uint32 = 5; } ${shape}`)).toBe('function/function/false/undefined');
  expect(evaluated(`function f(c) {} class A { @f accessor a: uint32 = 5; } ${shape}`)).toBe('function/function/false/undefined');
  // Own-property enumeration is the same question from the instance's side: the
  // storage is private either way, so nothing is enumerable and nothing leaks.
  expect(evaluated('class A { accessor a: uint32 = 5; } JSON.stringify(Object.getOwnPropertyNames(new A()));')).toBe('[]');
  expect(evaluated('function f(c) {} class A { @f accessor a: uint32 = 5; } JSON.stringify(Object.getOwnPropertyNames(new A()));')).toBe('[]');
  expect(evaluated('class A { accessor a: uint32 = 5; } JSON.stringify(Object.keys(new A()));')).toBe('[]');
});

test('an accessor is observably an ACCESSOR, not a field', () => {
  // The contrast that gives the test above its meaning: a plain field IS an own
  // data property with a value, and the accessor is neither. Under reading 2 an
  // undecorated accessor would have looked exactly like this.
  expect(evaluated('class A { a: uint32 = 5; } const e = Object.getOwnPropertyDescriptor(new A(), "a"); typeof e.get + "/" + String(e.value);')).toBe('undefined/5');
  expect(evaluated('class A { accessor a: uint32 = 5; } String(Object.getOwnPropertyDescriptor(new A(), "a"));')).toBe('undefined');
  // The pair lives on the prototype, where a hand-written one lives, so it is
  // inherited and shared rather than per instance.
  expect(evaluated('class A { accessor a: uint32 = 5; } const x = new A(), y = new A(); '
    + 'String(Object.getOwnPropertyDescriptor(A.prototype, "a").get === Object.getOwnPropertyDescriptor(A.prototype, "a").get);')).toBe('true');
  // And it still round-trips per instance through that shared pair (stage B),
  // which is what says the storage is separate from the pair.
  expect(evaluated('class A { accessor a: uint32 = 5; } const x = new A(), y = new A(); x.a = 1; y.a = 2; String(x.a) + "/" + String(y.a);')).toBe('1/2');
});

test('the pair is reachable, which reading 2 would have forbidden', () => {
  // README's `inline` rule is that an inline function's value cannot be taken -
  // "storing it, passing it as a callback, or reading it as a property is a
  // TypeError". An accessor's generated pair is NOT marked `inline` and is not
  // subject to that: the getter can be read off the descriptor and called.
  // Pinned because it is the sharpest observable difference between the two
  // readings of §2.4.
  expect(evaluated('class A { accessor a: uint32 = 5; } const o = new A(); o.a = 7; '
    + 'const g = Object.getOwnPropertyDescriptor(A.prototype, "a").get; String(g.call(o));')).toBe('7');
  expect(evaluated('class A { accessor a: uint32 = 5; } const o = new A(); '
    + 'const s = Object.getOwnPropertyDescriptor(A.prototype, "a").set; s.call(o, 3); String(o.a);')).toBe('3');
});

test('PINNED: `inline` itself is not implemented', () => {
  // The keyword README defines - "a contextual keyword placed before
  // `function`, a method name, or `operator`" - does not parse, and neither
  // does the `@inline` decorator it says sets the same property. So the
  // GUARANTEE side of inlining is unbuilt; what stage F settles is only what an
  // accessor's inlining may and may not be observed to do.
  const outcome = (source: string): string => evaluated(`try { eval(${JSON.stringify(source)}); "ACCEPTED"; } catch (e) { e.constructor.name; }`);
  expect(outcome('class A { inline m() { return 1; } }')).toBe('SyntaxError');
  expect(outcome('inline function f() { return 1; }')).toBe('SyntaxError');
});
