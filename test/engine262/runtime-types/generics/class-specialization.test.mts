import { expect, test } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';
import { Agent, Get, ManagedRealm, setSurroundingAgent, Value, X } from '#self';

// Phase 5, slice 1: class specializations (plan 6.3). A CASE - a class
// declaration whose list specializes its family - supplies a complete body,
// selected per application by the rule function cases use, and keeps the
// primary's public contract.

const P = 'class Box<T: type> { v: T; constructor(v: T) { this.v = v; } get kind(): string { return "primary"; } } ';
const PACKED = 'class Box<boolean> { v: boolean; bits: uint8; constructor(v: boolean) { this.v = v; this.bits = v ? 1 : 0; } get kind(): string { return "packed"; } } ';

test('an application selects the case\'s complete body, or the primary\'s', () => {
  expect(evaluated(`${P}${PACKED} new Box.<boolean>(true).kind + "," + new Box.<uint8>((1 := uint8)).kind;`)).toBe('packed,primary');
  // Its own representation: a member the primary does not declare.
  expect(evaluated(`${P}${PACKED} String(new Box.<boolean>(true).bits);`)).toBe('1');
});

test('the application keeps the family\'s identity, one stable definition', () => {
  expect(evaluated(`${P}${PACKED} String(Reflect.typeOf(new Box.<boolean>(true)));`)).toBe('Box.<boolean>');
  expect(evaluated(`${P}${PACKED} String((Box.<boolean>) === (Box.<boolean>));`)).toBe('true');
  expect(evaluated(`${P}${PACKED} String(new Box.<boolean>(true) instanceof Box.<boolean>);`)).toBe('true');
  // One binding: a case declares no name of its own.
  expect(evaluated(`${P}${PACKED} typeof Box;`)).toBe('function');
});

test('a case is inert where it is written: its body is evaluated once, when selected', () => {
  expect(evaluated('globalThis.ran = 0; class Box<T: type> { static { globalThis.ran += 1; } } '
    + 'class Box<boolean> { static { globalThis.ran += 10; } } const before = globalThis.ran; Box.<boolean>; Box.<boolean>; '
    + 'String(before) + "," + String(globalThis.ran);')).toBe('0,10');
});

test('a capture\'s bound is enforced in selection, for classes and functions alike', () => {
  // The host's bound check was a stub that admitted every argument.
  expect(evaluated('class B<T: type> { get k(): string { return "p"; } } class B<const T: type extends [].<any>> { get k(): string { return "arr"; } } '
    + 'new B.<[].<uint8>>().k + "," + new B.<string>().k;')).toBe('arr,p');
  expect(evaluated('function f<T: type>(): string { return "p"; } function f<const T: type extends [].<any>>(): string { return "arr"; } '
    + 'f.<[].<uint8>>() + "," + f.<string>();')).toBe('arr,p');
});

test('a case belongs to the primary declared in its own statement list', () => {
  expectThrown('class B<uint8> {}', 'no `class B<...>` in this statement list declares the family it would specialize');
  expectThrown('{ class Box<T: type> {} } class Box<uint32> {}', 'no `class Box<...>` in this statement list');
  expectThrown('class Pair<const T, T> {}', 'a capture, `const T`, belongs to a specialization list');
  // An additive partial class, and a class expression, may not specialize.
  expectThrown('partial class Box<boolean> {}', 'has no domain');
  expectThrown('class Box<T: type> {} const X = class Box<boolean> {};', 'declares parameters only');
});

test('a case keeps the primary\'s public contract after substitution', () => {
  expectThrown(`${P} class Box<boolean> { v: boolean; constructor(v: boolean) { this.v = v; } }`, 'it has no `kind`');
  expectThrown(`${P} class Box<boolean> { v: boolean; constructor(v: boolean) { this.v = v; } get kind(): uint8 { return (1 := uint8); } }`,
    'its `kind` is uint.<8>, not assignable to string');
  expectThrown(`${P} class Box<boolean> { get kind(): string { return "x"; } constructor(v: boolean) {} }`, 'it has no `v`');
  expectThrown(`${P} class Box<boolean> { v: boolean; constructor(v: string) { this.v = true; } get kind(): string { return "x"; } }`,
    'its constructor does not accept (boolean)');
});

test('an application\'s layout is derived after selection, from the selected body', () => {
  // Plan 6.3: "do not infer ... size ... from the fallback body when a
  // replacement can differ". The case adds a uint32, so a field of its
  // application occupies 1 + 1 + 2 (padding) + 4 bytes, not the primary's 2 -
  // even when no instance of it exists yet.
  const S = 'class Cell<T: type> { a: T; b: T; } class Cell<uint8> { a: uint8; b: uint8; c: uint32; } ';
  expect(evaluated(`${S} class H { g: Cell.<uint8> = new Cell.<uint8>(); } String(H.byteLength);`)).toBe('8');
  expect(evaluated(`${S} class H { g: Cell.<uint16> = new Cell.<uint16>(); } String(H.byteLength);`)).toBe('4');
});

test('no program can replace a foreign or intrinsic family: a case needs its primary beside it', () => {
  // Plan 6.3: replacement is confined to the owning declaration group, so an
  // intrinsic family, and a family declared in another scope, cannot be given
  // a case.
  expectThrown('class Array<boolean> {}', 'no `class Array<...>` in this statement list');
  expectThrown('class Map<string, uint8> {}', 'no `class Map<...>` in this statement list');
  expectThrown('type uint8<boolean> = string;', 'no `type uint8<...>` in this statement list');
  expectThrown('class Box<T: type> {} function f() { class Box<boolean> {} }', 'no `class Box<...>` in this statement list');
});

test('in a module, a case exports no name of its own, and an imported family takes no case', () => {
  const compile = (source: string) => {
    setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
    const realm = new ManagedRealm();
    const m = realm.compileModule(source, { specifier: 'main.mjs' }) as { Type?: string, Value?: unknown };
    if (m && m.Type === 'throw') {
      const pop = (realm as unknown as { pushTopContext?: () => (() => void) }).pushTopContext?.();
      try {
        return (X(Get(m.Value as never, Value('message'))) as unknown as { stringValue(): string }).stringValue();
      } finally {
        pop?.();
      }
    }
    return 'compiled';
  };
  expect(compile('export class Box<T: type> {} export class Box<boolean> {}')).toBe('compiled');
  expect(compile('export class Box<T: type> {} class Box<boolean> {}')).toBe('compiled');
  expect(compile('import { Box } from "./box.mjs"; class Box<boolean> {}')).toContain('no `class Box<...>` in this statement list');
});

test('reflection makes the selected declaration discoverable', () => {
  // Plan C23: an application reports which declaration it selected - the case
  // whose complete body it runs, or the primary - as written.
  expect(evaluated(`${P}${PACKED} String(Reflect.getReflection(Box.<boolean>).generic.selected);`)).toBe('Box<boolean>');
  expect(evaluated(`${P}${PACKED} String(Reflect.getReflection(Box.<uint8>).generic.selected);`)).toBe('Box<T: type>');
  expect(evaluated('class G<T: type> { a: T; } String(Reflect.getReflection(G.<uint8>).generic.selected);')).toBe('G<T: type>');
});
