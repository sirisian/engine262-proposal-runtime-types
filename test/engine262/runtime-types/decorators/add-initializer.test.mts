import { test, expect } from 'vitest';
import { evaluated } from '../harness.mts';

/**
 * Spec: #sec-addinitializer (AddInitializer). Design: decorators.md.
 *
 * decorators.md gives it to the contexts that "represent declaration sites
 * where initialization logic can be injected", and rule 4 of its ordering
 * section says when the callbacks run: "`addInitializer` callbacks run AFTER
 * EVERY DECORATOR of that declaration has been applied, in the order they were
 * added."
 *
 * THE TABLE IS CLOSED AND NOT DERIVABLE FROM THE POSITION, which is why it is
 * read off the context's own `kind` in one place rather than decided at each
 * call site: `Reflect.Function` has return replacement and NO addInitializer,
 * while `Reflect.ObjectField` has neither though `Reflect.ClassField` has both.
 */

test('the contexts that have it', () => {
  const t = 'let t = "?"; function f(c) { t = typeof c.addInitializer; } ';
  expect(evaluated(`${t} @f class A {} t;`)).toBe('function');
  expect(evaluated(`${t} class A { @f a: uint8 = 1; } t;`)).toBe('function');
  expect(evaluated(`${t} class A { @f m() {} } t;`)).toBe('function');
  expect(evaluated(`${t} class A { @f get v(): uint8 { return 1; } } t;`)).toBe('function');
  expect(evaluated(`${t} class A { @f set v(x: uint8) {} } t;`)).toBe('function');
  expect(evaluated(`${t} class A { @f accessor a: uint8 = 1; } t;`)).toBe('function');
  expect(evaluated(`${t} const o = { @f m() {} }; t;`)).toBe('function');
});

test('the contexts that do NOT, which is the half a positional rule gets wrong', () => {
  const t = 'let t = "?"; function f(c) { t = typeof c.addInitializer; } ';
  // `Reflect.Function` is the case that makes the list closed rather than
  // derivable: it HAS return replacement and does not have this.
  expect(evaluated(`${t} @f function g() {} t;`)).toBe('undefined');
  // Sub-targets, which the table excludes wholesale.
  expect(evaluated(`${t} class A { m(@f p: uint8) {} } t;`)).toBe('undefined');
  expect(evaluated(`${t} class A { m(): @f uint8 { return 1; } } t;`)).toBe('undefined');
  // Bindings and blocks.
  expect(evaluated(`${t} @f let x = 1; t;`)).toBe('undefined');
  expect(evaluated(`${t} @f const y = 1; t;`)).toBe('undefined');
  expect(evaluated(`${t} @f { let a = 1; } t;`)).toBe('undefined');
  // And an ENUM, which is a declaration site but not an initializable one.
  expect(evaluated(`${t} @f enum E { A } t;`)).toBe('undefined');
});

test('callbacks run AFTER every decorator of the declaration', () => {
  // Rule 4. The decorator body runs first and the callback after, which is what
  // lets an initializer observe what a later-applied decorator did.
  expect(evaluated('const l = []; function f(c) { c.addInitializer(() => l.push("init")); l.push("decorator"); } '
    + 'class A { @f m() {} } l.join(",");')).toBe('decorator,init');
  // With TWO decorators, BOTH bodies run before EITHER callback - the sharper
  // form, and the one that would fail if callbacks ran as each decorator
  // returned.
  expect(evaluated('const l = []; '
    + 'function a(c) { c.addInitializer(() => l.push("a-init")); l.push("a"); } '
    + 'function b(c) { c.addInitializer(() => l.push("b-init")); l.push("b"); } '
    + 'class A { @a @b m() {} } l.join(",");')).toBe('b,a,b-init,a-init');
});

test('callbacks run in the order they were ADDED', () => {
  // "in the order they were added" - which is NOT the order the decorators ran
  // in reversed. `@a @b` applies b first, so b's callback is added first and
  // runs first; the decorators themselves ran b, a.
  expect(evaluated('const l = []; function a(c) { c.addInitializer(() => l.push("a")); } '
    + 'function b(c) { c.addInitializer(() => l.push("b")); } class A { @a @b m() {} } l.join(",");')).toBe('b,a');
  // Several from ONE decorator keep their own order too.
  expect(evaluated('const l = []; function f(c) { c.addInitializer(() => l.push("1")); c.addInitializer(() => l.push("2")); } '
    + 'class A { @f m() {} } l.join(",");')).toBe('1,2');
});

test('what is added must be callable', () => {
  const kind = (source: string): string => evaluated(`try { eval(${JSON.stringify(source)}); "ACCEPTED"; } catch (e) { e.constructor.name; }`);
  expect(kind('function f(c) { c.addInitializer(5); } class A { @f m() {} }')).toBe('TypeError');
  expect(kind('function f(c) { c.addInitializer(); } class A { @f m() {} }')).toBe('TypeError');
  expect(kind('function f(c) { c.addInitializer(() => {}); } class A { @f m() {} }')).toBe('ACCEPTED');
});
