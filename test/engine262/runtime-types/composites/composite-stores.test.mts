import { expect, test } from 'vitest';
import { evaluated, observeScript } from '../harness.mts';

/**
 * Spec: #sec-composite-types.
 *
 * A composite is frozen from its creation, so no store through a receiver
 * whose Static Type is a composite type can succeed, whatever the shape says:
 * the shape of `Composite.<S>` reads every member readonly, and the top type
 * `Composite` is the type of frozen objects only. A shaped member store was a
 * runtime TypeError, a tuple index store and a top-type store failed
 * silently, and a parameter form was never judged.
 */

const refused = (source: string, rule = 'rt-readonly-store'): void => {
  expect(observeScript(source)).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule, phase: 'static' } });
};

test('a store through a composite-typed receiver is refused', () => {
  refused('const c = Composite.<{ x: uint8 }>({ x: 1 }); c.x = 2;');
  refused('function f(c: Composite.<{ x: uint8 }>) { c.x = 2; }');
  refused('const t = Composite.<[uint8, uint8]>([1, 2]); t[0] = 3;');
  refused('const c = Composite({ x: 1 }); c.x = 2;');
  refused('const c = Composite.<{ x: uint8 }>({ x: 1 }); c.x += 1;');
  refused('const c = Composite({ x: 1 }); delete c.x;', 'rt-typed-delete');
});

test('reads and tests of a composite are unchanged', () => {
  expect(evaluated('const c = Composite.<{ x: uint8 }>({ x: 1 }); String(c.x);')).toBe('1');
  expect(evaluated('function f(c: Composite.<{ x: uint8 }> | null) { return c ? c.x : 0; } String(f(Composite.<{ x: uint8 }>({ x: 2 })));')).toBe('2');
});
