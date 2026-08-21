import { test, expect } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

// -- A deferred application as a binding's type (#sec-deferred-applications) --
//
// "an application over an unbound parameter is carried as an ~application~ Type
// Record and evaluated at specialization". The closed alias form always worked;
// these are the forms inside a generic body, where the parameter is bound by the
// call rather than by the declaration.

const pairOf = 'function pairOf(T) { return Reflect.makeType({ kind: "tuple", '
  + 'elements: [{ type: T, rest: false }, { type: T, rest: false }] }); } ';

test('a deferred application annotates a binding and specializes per call', () => {
  // The default is the specialization's, which is what distinguishes a real
  // deferral from a lucky one: the same generic gives typed zeros at uint8 and
  // empty strings at string.
  expect(evaluated(`${pairOf} function make<T>(x: T) { let p: pairOf(T); return p; }`
    + ' const r = make((1 := uint8)); `${r.length}:${r[0]}:${r[0] is uint8}`;')).toBe('2:0:true');
  expect(evaluated(`${pairOf} function make<T>(x: T) { let p: pairOf(T); return p; }`
    + ' const r = make("a"); `${r.length}:${JSON.stringify(r[0])}`;')).toBe('2:""');
});

test('a deferred application enforces its annotation', () => {
  expect(evaluated(`${pairOf} function init<T>(x: T) { let p: pairOf(T) = [x, x]; return p; }`
    + ' String(init((7 := uint8)));')).toBe('7,7');
  expectThrown(`${pairOf} function bad<T>(x: T) { let p: pairOf(T) = ["wrong", "wrong"]; return p; }`
    + ' bad((1 := uint8));');
  // And the store into it is checked, with either initializer shape - the
  // already-conforming one is what the tuple stamp above is for.
  expectThrown(`${pairOf} function f<T>(x: T) { let p: pairOf(T) = [1, 2]; p[0] = "bad"; return p; }`
    + ' f((1 := uint8));');
  expectThrown(`${pairOf} function f<T>(x: T) { let p: pairOf(T) = [x, x]; p[0] = "bad"; return p; }`
    + ' f((1 := uint8));');
});

test('a deferred application works in every position a parameter is bound', () => {
  expect(evaluated(`${pairOf} function nested<T>(x: T) { let p: pairOf(pairOf(T)); return p; }`
    + ' const r = nested((1 := uint8)); `${r.length}:${r[0].length}`;')).toBe('2:2');
  expect(evaluated(`${pairOf} function param<T>(x: T, p: pairOf(T)) { return p.length; }`
    + ' String(param((1 := uint8), [1, 2]));')).toBe('2');
  expect(evaluated(`${pairOf} function ret<T>(x: T): pairOf(T) { return [x, x]; }`
    + ' String(ret((3 := uint8)));')).toBe('3,3');
});

test('a class field reaches it too', () => {
  // This was the one position a deferred application did NOT reach: a field's
  // type was resolved over a frame that bound each parameter to a fresh unbound
  // record, shadowing the specialization's own bindings, so the application was
  // still over `T` when the field was defined and the declaration was refused
  // for having no default. With the field deferring to an active binding, the
  // application specializes here as it does everywhere else.
  expect(evaluated(`${pairOf} class Box<T> { p: pairOf(T); }`
    + ' const b = new Box.<uint8>(); `${b.p.length}:${b.p[0]}`;')).toBe('2:0');
  // And the positions substituted, so a store into one is checked.
  expectThrown(`${pairOf} class Box<T> { p: pairOf(T); }`
    + ' const b = new Box.<uint8>(); b.p[0] = "wrong";');
});

test('a method may carry a where clause naming its class\'s parameters', () => {
  // PLAN-where-on-methods.md D2. #sec-type-annotations, as amended: a method
  // takes |WhereClauses| the same way a function declaration does. The rule
  // needs no restatement - "checked at each specialization once its parameters
  // are bound" - because a generic method specializes as a generic function
  // does.
  //
  // The part that is NEW: a method's clause may name the parameters of its CLASS
  // as well as its own. `N` is bound at the instantiation and `I` at the call,
  // and no clause before this one had to resolve across two scopes.
  const V = 'class V<N: uint32> { lane<I: uint32>(): uint32 where I < N { return (1 := uint32); } } ';
  expect(evaluated(`${V} String(new V.<4>().lane.<1>());`)).toBe('1');
  expectThrown(`${V} new V.<4>().lane.<9>();`);
  // The class frame is pushed UNDER the method's, so a method parameter shadows
  // a class parameter of the same name - `N > 2` reads the method's 5, not the
  // class's 0.
  expect(evaluated('class X<N: uint32> { m<N: uint32>(): uint32 where N > 2 { return (1 := uint32); } } '
    + 'String(new X.<0>().m.<5>());')).toBe('1');
  // A non-generic class contributes no frame, and a method-only clause still
  // works - which is the case that would break if the frame were pushed
  // unconditionally.
  expect(evaluated('class Y { m<I: uint32>(): uint32 where I < 3 { return (1 := uint32); } } '
    + 'String(new Y().m.<1>());')).toBe('1');
  // The two positions that already worked are untouched.
  expect(evaluated('function f<N: uint32>(): uint32 where N > 0 { return (1 := uint32); } String(f.<3>());')).toBe('1');
  expectThrown('function g<N: uint32>(): uint32 where N > 0 { return (1 := uint32); } g.<0>();');
});
