import { expect, test } from 'vitest';
import { LIBRARY_INSTANCE_MEMBERS } from '../../../../src/type-system/library-members.mts';
import { evaluated, expectThrown, observeScript } from '../harness.mts';

/**
 * Question AP, direction AP2: a built-in base contributes the members its
 * library type has, and a store or a call to a member that neither the class
 * chain nor the built-in declares is refused before running, as it is for a
 * class whose chain the program wrote (#sec-library-instance-members). It was
 * left to the seal, which threw when the store ran, or to the call, which
 * called *undefined*:
 *
 *   class E extends Error { code: uint8 = 0; }
 *   const e: E = new E("m"); e.extra = 1;   TypeError when it ran
 *
 * TypeScript refuses the same store through its library types. A member is
 * storable on a sealed instance only where every instance holds it as its own
 * writable property, so `name`, and `message` and `cause`, which an instance
 * holds only where its constructor was given them, can be read and not
 * stored. A class that stores to one declares it. `stack`, whose place an
 * implementation chooses, is read, and a store to it is left to the seal.
 */

/** Arguments that construct each built-in, for the comparison with the realm. */
const ARGUMENTS: Record<string, string> = {
  AggregateError: '[]', WeakRef: '{}', FinalizationRegistry: '() => {}', Promise: '() => {}', DataView: 'new ArrayBuffer(8)',
};

test('the library table lists what the realm gives each built-in\'s instances', () => {
  for (const [name, row] of Object.entries(LIBRARY_INSTANCE_MEMBERS)) {
    if (name === 'Object') continue;
    const described = evaluated(`(() => {
      const x = new ${name}(${ARGUMENTS[name] ?? ''});
      const own = Object.getOwnPropertyNames(x).map((k) => k + (Object.getOwnPropertyDescriptor(x, k).writable ? ':w' : ':r')).sort();
      const proto = Object.getPrototypeOf(x);
      const names = Object.getOwnPropertyNames(proto).sort();
      const next = Object.getPrototypeOf(proto);
      return JSON.stringify({ own, names, next: next === Object.prototype ? null : next.constructor.name });
    })()`);
    const realm = JSON.parse(described) as { own: string[], names: string[], next: string | null };
    expect(realm.own, name).toEqual(row.instance.map((k) => `${k}:w`).sort());
    expect(realm.names, name).toEqual([...row.prototype].sort());
    expect(realm.next, name).toBe(row.base);
  }
  // `message` and `cause` are own where the constructor was given them.
  expect(evaluated('Object.getOwnPropertyNames(new Error("m", { cause: 1 })).sort().join()')).toBe('cause,message');
  expect(evaluated('Object.getOwnPropertyNames(new AggregateError([], "m", { cause: 1 })).sort().join()')).toBe('cause,errors,message');
});

const E = 'class E extends Error { code: uint8 = 0; } const e: E = new E("m"); ';
const refused = (source: string) => expect(observeScript(source)).toMatchObject({ bodyEntered: false, diagnostic: { rule: 'rt-undeclared-member' } });

test('a store to or a call of a member neither the class nor its built-in base declares is refused', () => {
  refused(`${E}e.extra = 1;`);
  refused(`${E}e.extra();`);
  refused('class T extends TypeError { code: uint8 = 0; } const t: T = new T(); t.extra = 1;');
  refused('class E extends Error { code: uint8 = 0; } class F extends E { } const f: F = new F(); f.extra = 1;');
  refused('class R extends RegExp { code: uint8 = 0; } const r: R = new R("a"); r.exek("a");');
  refused('class M extends Map { code: uint8 = 0; } const m: M = new M(); m.extra = 1;');
  refused('class D extends Date { code: uint8 = 0; } const d: D = new D(0); d.getTimee();');
  expectThrown(`${E}e.extra = 1;`, '"extra" is not a member of "E"');
});

test('a member the built-in declares is read and called', () => {
  expect(evaluated(`${E}e.toString();`)).toBe('Error: m');
  expect(evaluated(`${E}const s: string = e.message; s;`)).toBe('m');
  expect(evaluated(`${E}typeof e.stack;`)).toBe('string');
  expect(evaluated('class T extends TypeError { code: uint8 = 0; } new T("a").toString();')).toBe('TypeError: a');
  expect(evaluated('class M extends Map { code: uint8 = 0; } const m: M = new M(); m.set("a", 1); String(m.size) + String(m.getOrInsert("b", 2));')).toBe('12');
  expect(evaluated('class R extends RegExp { code: uint8 = 0; } const r: R = new R("a"); String(r.exec("a"));')).toBe('a');
  expect(evaluated('class N extends Number { code: uint8 = 0; } new N(1).toFixed(1);')).toBe('1.0');
  // A member every object has, and a Symbol-keyed member.
  expect(evaluated('class M extends Map { code: uint8 = 0; } const m: M = new M(); String(m.hasOwnProperty("x")) + typeof m[Symbol.iterator];')).toBe('falsefunction');
});

test('a member every instance holds as its own writable property is stored to, and no other', () => {
  expect(evaluated('class A extends AggregateError { code: uint8 = 0; } const a: A = new A([]); a.errors = [1]; String(a.errors.length);')).toBe('1');
  expect(evaluated('class R extends RegExp { code: uint8 = 0; } const r: R = new R("a"); r.lastIndex = 3; String(r.lastIndex);')).toBe('3');
  for (const store of ['e.message = "n";', 'e.name = "F";', 'e.cause = 1;']) refused(`${E}${store}`);
  // `stack` is an implementation's: an own writable property of every error on
  // one, an accessor of the prototype on another, as here. A store to it is
  // left to the seal.
  expect(observeScript(`${E}e.stack = "s";`)).toMatchObject({ bodyEntered: true });
  refused('class M extends Map { code: uint8 = 0; } const m: M = new M(); m.size = 3;');
  expectThrown(`${E}e.name = "F";`, '"name" is not a writable own property of every "Error", and an instance of "E" is sealed');
  // A class that stores to one declares it, and its constructor may give the instance one before it is sealed.
  expect(evaluated('class E extends Error { code: uint8 = 0; name = "E"; } const e: E = new E("m"); e.name = "F"; e.name;')).toBe('F');
  expect(evaluated('class E extends Error { code: uint8 = 0; message: string = ""; } const e: E = new E("m"); e.message = "n"; e.message;')).toBe('n');
  expect(evaluated('class E extends Error { code: uint8 = 0; constructor(m: string) { super(); this.message = m; } } new E("x").message;')).toBe('x');
  // A method runs when the instance is sealed.
  refused('class E extends Error { code: uint8 = 0; set(m: string): void { this.message = m; } }');
});

test('a class whose instances are not sealed, or whose base the table does not list, is left to the run time', () => {
  expect(evaluated('class E extends Error { } const e: E = new E("m"); e.extra = 1; String(e.extra);')).toBe('1');
  expect(evaluated('dynamic class E extends Error { code: uint8 = 0; } const e: E = new E("m"); e.extra = 1; String(e.extra);')).toBe('1');
  expectThrown('class A extends Array { code: uint8 = 0; } const a: A = new A(); a.extra = 1;', 'Cannot set property');
});
