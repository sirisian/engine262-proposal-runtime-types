import { test, expect } from 'vitest';
import { evaluated } from '../harness.mts';

/**
 * Three of the four decisions PLAN-decorators-remaining.md section 8 listed, settled
 * and implemented. The fourth - the private accessor desugaring - is scoped
 * there and not done.
 */

test('DECISION 3: an accessor\'s layout slot reports the DECLARED name', () => {
  // section 2.1 settled that an accessor "participates in the memory layout exactly as
  // a field does". Reflecting it as one is the consistent completion: its
  // backing is an unnameable Private Name, and a slot no program can name
  // leaves a hole in a layout walk - a serializer would see bytes it could not
  // label. Not C#'s answer, whose generated `<a>k__BackingField` leaks a
  // compiler artifact into every reflective enumeration.
  const cls = 'class A { a: uint8; accessor b: uint32 = 0; c: uint8; } ';
  expect(evaluated(`${cls} String(Reflect.getReflection.<Reflect.ClassFieldLayout, A>("b").offset);`)).toBe('4');
  expect(evaluated(`${cls} String(Reflect.getReflection.<Reflect.ClassField, A>("b").name);`)).toBe('b');
  // The layout itself is untouched - this names a slot, it does not move one.
  expect(evaluated(`${cls} String((type A).byteLength);`)).toBe('12');
  expect(evaluated(`${cls} String(Reflect.getReflection.<Reflect.ClassFieldLayout, A>("c").offset);`)).toBe('8');
  // A GENUINE private field keeps its invisibility: it was never reachable by
  // name, so nothing about it changed. The two cases are distinct and only one
  // was ever meant to be reached.
  expect(evaluated('class A { a: uint8; #b: uint32; } '
    + 'try { eval("Reflect.getReflection.<Reflect.ClassField, A>(\\"b\\");"); "ACCEPTED"; } catch (e) { e.constructor.name; }')).toBe('TypeError');
});

test('DECISION 1: the accessor context carries `access` over its own slot', () => {
  // decorators.md's replacement for `Reflect.ClassAccessor` is a `{ get, set }`
  // pair. A replacement that cannot reach the ORIGINAL storage has to close
  // over storage of its own, orphaning the layout slot the backing occupies -
  // so the context now hands the pair over, as TC39's `context.access` does.
  expect(evaluated('let t = "?"; function f(c) { t = typeof c.access + "/" + typeof c.access.get + "/" + typeof c.access.set; } '
    + 'class A { @f accessor a: uint8 = 1; } t;')).toBe('object/function/function');
  // THE ASSERTION THAT MATTERS is that it reaches the REAL storage, both ways -
  // a pair that merely existed would satisfy a `typeof` check and still leave
  // the slot dead.
  expect(evaluated('let g; function f(c) { g = c.access; } class A { @f accessor a: uint8 = 5; } '
    + 'const o = new A(); o.a = 9; String(g.get.call(o));')).toBe('9');
  expect(evaluated('let g; function f(c) { g = c.access; } class A { @f accessor a: uint8 = 5; } '
    + 'const o = new A(); g.set.call(o, 3); String(o.a);')).toBe('3');
  // It follows the receiver rather than closing over one instance.
  expect(evaluated('let g; function f(c) { g = c.access; } class A { @f accessor a: uint8 = 5; } '
    + 'const x = new A(), y = new A(); x.a = 1; y.a = 2; String(g.get.call(x)) + "/" + String(g.get.call(y));')).toBe('1/2');
  // A plain field has no pair, so it has no `access`.
  expect(evaluated('let t = "?"; function f(c) { t = typeof c.access; } class A { @f a: uint8 = 1; } t;')).toBe('undefined');
});

test('DECISION 4: a block decorator runs on every ENTRY', () => {
  // section 6.2 recorded this as unanswered by the design; the engine had been
  // answering it. It follows from "a decorator runs when the declaration it
  // decorates is evaluated" - a block inside a loop is evaluated each
  // iteration - and it is what makes a block decorator useful for
  // instrumentation at all.
  expect(evaluated('const l = []; function f(c) { l.push(1); } for (let i = 0; i < 3; i += 1) @f { let a = 1; } String(l.length);')).toBe('3');
  expect(evaluated('const l = []; function f(c) { l.push(1); } for (let i = 0; i < 0; i += 1) @f { let a = 1; } String(l.length);')).toBe('0');
  // A block NOT in a loop runs once, which is what says the count follows the
  // entries rather than being a property of blocks.
  expect(evaluated('const l = []; function f(c) { l.push(1); } @f { let a = 1; } String(l.length);')).toBe('1');
  // THE CONTRAST THAT MAKES IT A DECISION: every other decorator runs once per
  // DECLARATION, however many times the declaration's body runs. A method in a
  // loop-called class is still decorated once.
  expect(evaluated('const l = []; function f(c) { l.push(1); } class A { @f m() {} } '
    + 'const o = new A(); for (let i = 0; i < 3; i += 1) { o.m(); } String(l.length);')).toBe('1');
});
