import { test, expect } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

/**
 * Spec: #sec-decorator-contexts, #sec-reflection-retrieval. `getReflection` decides whether a call is a member
 * read by testing the context, and every parameter and return context must be among those that name members;
 * otherwise the call falls through to the TYPE path, which reads its first argument as a type, so a member
 * name would report `"m" is not a type` - the fall-through speaking rather than a diagnosis. The data is
 * recorded: `getReflectionByIndex` reads the same store and answers.
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

/**
 * #sec-reflection-shape-rules: `initial` holds a declared default only where it is a constant, and *undefined*
 * otherwise; `initializer` carries the declaration as a TokenStream. The pair is a value and the expression
 * that produced it, not two spellings of one thing. A `hasDefault` Boolean is not a field: a default is an
 * expression evaluated per call, which is true of a NON-CONSTANT default and leaves out the constant one, and
 * once `initializer` exists `hasDefault` would be `initializer !== undefined`, reporting what a second field
 * implies.
 */
test('parameter reflection: a default is a value and the expression that made it', () => {
  const at = (decl: string, expr: string) => `class A { m(${decl}) {} }`
    + " const p = Reflect.getReflection.<Reflect.ClassMethodParameter, A>('m', 0);"
    + ` String(${expr});`;
  // a constant default reports its value, and the declaration either way
  expect(evaluated(at('a = 5', 'p.initial'))).toBe('5');
  expect(evaluated(at('a = 5', 'typeof p.initializer'))).toBe('object');
  // a non-constant one reports no value, and still the declaration - evaluating
  // it would run user code at class definition rather than per call
  expect(evaluated(at('a = f()', 'p.initial'))).toBe('undefined');
  expect(evaluated(at('a = f()', 'typeof p.initializer'))).toBe('object');
  // an UNANNOTATED parameter with no default has neither
  expect(evaluated(at('a', 'p.initial'))).toBe('undefined');
  expect(evaluated(at('a', 'typeof p.initializer'))).toBe('undefined');
  // an ANNOTATED one zero-values, "a typed field's zero value, or a constant
  // initializer" - so an absent `initial` is not how a default is detected
  expect(evaluated(at('a: uint8', 'p.initial'))).toBe('0');
  expect(evaluated(at('a: uint8', 'typeof p.initializer'))).toBe('undefined');
});

test('parameter reflection: the presence of a default is read from initializer', () => {
  const at = (decl: string) => `class A { m(${decl}) {} }`
    + " const p = Reflect.getReflection.<Reflect.ClassMethodParameter, A>('m', 0);"
    + ' String(p.initializer !== undefined);';
  // `= undefined` and no default agree on `initial` and differ here, which is
  // the case that makes the pair two fields rather than one
  expect(evaluated(at('a = undefined'))).toBe('true');
  expect(evaluated(at('a'))).toBe('false');
  expect(evaluated(at('a = 5'))).toBe('true');
  expect(evaluated(at('a = f()'))).toBe('true');
  // a constructor's parameters carry the pair as a method's do
  expect(evaluated('class B { constructor(a = 7) {} }'
    + " String(Reflect.getReflection.<Reflect.ClassMethodParameter, B>('constructor', 0).initial);")).toBe('7');
});
