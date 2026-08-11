import { test, expect } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

/**
 * Spec: #sec-reflection-contexts; design: decorators.md ~747.
 *
 * `getReflection` decided whether a call was a member read by testing the
 * context against a literal list of six, and every parameter and return context
 * was absent - so the call fell through to the TYPE path, which reads its first
 * argument as a type. A member name is a string, hence `"m" is not a type`,
 * which was the fall-through speaking rather than a diagnosis. The data was
 * always recorded: `getReflectionByIndex` read the same store and answered.
 */

const A = 'class A { m(first: uint8, second: string) {} } ';

test('parameter reflection: the enumerating form is keyed by name and by index', () => {
  // "{ [name: string | uint32]: Reflection }" - one reflection reached two ways
  expect(evaluated(`${A}const r = Reflect.getReflection.<Reflect.ClassMethodParameter, A>('m');`
    + ' String(r.first.name);')).toBe('first');
  expect(evaluated(`${A}const r = Reflect.getReflection.<Reflect.ClassMethodParameter, A>('m');`
    + ' String(r[1].name);')).toBe('second');
  expect(evaluated(`${A}const r = Reflect.getReflection.<Reflect.ClassMethodParameter, A>('m');`
    + ' String(r.first === r[0]);')).toBe('true');
});

test('parameter reflection: the selecting form takes a name or a position', () => {
  expect(evaluated(`${A}String(Reflect.getReflection.<Reflect.ClassMethodParameter, A>('m', 0).name);`)).toBe('first');
  expect(evaluated(`${A}String(Reflect.getReflection.<Reflect.ClassMethodParameter, A>('m', 'second').index);`)).toBe('1');
  expect(evaluated(`${A}String(Reflect.getReflection.<Reflect.ClassMethodParameter, A>('m', 0).kind);`))
    .toBe('ClassMethodParameter');
});

test('parameter reflection: a constructor is a method, so its parameters read too', () => {
  // where this was first noticed: "its parameters are that method's"
  expect(evaluated("class B { constructor(a: uint8, b: string) {} }"
    + " String(Reflect.getReflection.<Reflect.ClassMethodParameter, B>('constructor', 0).name);")).toBe('a');
  expect(evaluated("class B { constructor(a: uint8, b: string) {} }"
    + " const r = Reflect.getReflection.<Reflect.ClassMethodParameter, B>('constructor');"
    + ' String(r.b.index);')).toBe('1');
});

test('parameter reflection: a return names exactly one thing', () => {
  expect(evaluated(`${A}String(Reflect.getReflection.<Reflect.ClassMethodReturn, A>('m').kind);`))
    .toBe('ClassMethodReturn');
});

test('parameter reflection: what it refuses', () => {
  expectThrown(`${A}Reflect.getReflection.<Reflect.ClassMethodParameter, A>('nope');`);
  expectThrown(`${A}Reflect.getReflection.<Reflect.ClassMethodParameter, A>('m', 9);`);
  expectThrown(`${A}Reflect.getReflection.<Reflect.ClassMethodParameter, A>('m', 'absent');`);
});

test('parameter reflection: the paths it shares a store with are unchanged', () => {
  // getReflectionByIndex reads the same declarations and is the ORDERED form,
  // "a parameter list is read by position"
  expect(evaluated(`${A}const r = Reflect.getReflectionByIndex.<Reflect.ClassMethodParameter, A>('m');`
    + ' String(r.length);')).toBe('2');
  // and the member and type contexts still route where they did
  expect(evaluated(`${A}String(Reflect.getReflection.<Reflect.ClassMethod, A>('m').kind);`)).toBe('ClassMethod');
  expect(evaluated('String(Reflect.getReflection.<Reflect.Type>(uint8).kind);')).toBe('primitive');
});
