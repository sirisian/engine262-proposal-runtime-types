import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrownKind, ok } from '../harness.mts';

// #sec-static-type-of-an-expression: each known destination constrains a store.
for (const type of ['[].<uint8> | [].<string>', '[uint8] | [string]', '[uint8] | [].<string>']) {
  test.each([
    'a[0] = true;', "a[0] = 'bad';", "a[0] ||= 'bad';", "[a[0]] = ['bad'];",
    "[[a[0]]] = [['bad']];", "for (a[0] of ['bad']) {}",
    "let ref p = a[0]; p = 'bad';", "let ref p = a[0]; const ref q = p; q = 'bad';",
  ])(`keeps every destination of ${type}: %s`, (operation) => {
    expectStaticTypeError(`function f(a: ${type}) { ${operation} }`);
  });
}

test.each([
  'function f(a: [].<uint8> | [].<uint16>) { a[0] = 2; }',
  'function f(a: [uint8] | [uint16]) { a[0] = 2; }',
  "function f(a: [].<uint8 | string>) { a[0] = 'ok'; }",
  "function f(a: any) { a[0] = true; }",
  'function f(a: [].<uint8> | [].<string>) { let v: uint8 | string = a[0]; }',
])('compatible destinations and joined reads: %s', (source) => expect(ok(source)).toBe(true));

test('numeric compound result must fit each destination', () => {
  expectStaticTypeError('function f(a: [].<uint8> | [].<uint16>) { a[0] += 300; }');
});

for (const operation of [
  'a[k] = true;', "a[k] = 'bad';", "a[k] ||= 'bad';", "[a[k]] = ['bad'];",
  "for (a[k] of ['bad']) {}", "let ref p = a[k]; p = 'bad';",
]) {
  test(`finite keys preserve write types: ${operation}`, () => {
    expectStaticTypeError(`function f(a: { x: uint8, y: string }, k: 'x' | 'y') { ${operation} }`);
  });
}
for (const fields of ['readonly x: uint8; readonly y: uint8;', 'readonly x: uint8; y: uint8;']) {
  test.each(['a[k] = 1;', 'a[k]++;', '[a[k]] = [1];', 'let ref p = a[k]; p = 1;'])
  (`finite keys preserve permissions (${fields}): %s`, (operation) => {
    expectStaticTypeError(`class C { ${fields} } function f(a: C, k: 'x' | 'y') { ${operation} }`);
  });
}

test.each([
  "function f(a: { x: uint8, y: uint8 }, k: 'x' | 'y') { a[k] = 2; }",
  "function f(a: { x: uint8, y: string }, k: 'x' | 'y') { if (k === 'x') a[k] = 2; }",
  'function f(a: any, k: string) { a[k] = true; }',
  'function f(a: { readonly x: uint8 }, k: string) { a[k] = 2; }',
])('narrowing and genuinely unknown keys retain their contracts: %s', (source) => expect(ok(source)).toBe(true));

test('numeric key alternatives are property identities', () => {
  expectStaticTypeError('function f(a: [uint8, string], k: 0 | 1) { a[k] = true; }');
});

test.each([
  'class A { x: uint8; } class B { y: uint8; } function f(a: A | B) { a.z = 1; }',
  'class A { x: uint8; } class B { y: uint8; } function f(a: A | B) { a.x = 1; }',
  "class A { x: uint8; } class B { y: uint8; } function f(a: A | B) { a['z'] = 1; }",
  'class A { x: uint8; } function f(a: A | { z: uint8 }) { a.z = 1; }',
])('closed storage is checked per receiver: %s', expectStaticTypeError);

test.each([
  'class Base { x: uint8; } class A extends Base {} class B extends Base {} function f(a: A | B) { a.x = 1; }',
  'function f(a: { x: uint8 } | { y: uint8 }) { a.z = 1; }',
  'class A { x: uint8; } function f(a: any) { a.z = 1; }',
])('inherited and open storage retain their behavior: %s', (source) => expect(ok(source)).toBe(true));

for (const [classes, params, location] of [
  ['class A { x: uint.<1>; } class B { x: uint.<2>; }', 'a: A | B', 'a.x'],
  ['class C { x: uint.<1>; y: uint.<2>; }', "a: C, k: 'x' | 'y'", 'a[k]'],
]) {
  test.each([
    `let ref r = ${location};`, `let ref r = other; ref r = ${location};`,
    `take(ref ${location});`, `return ref ${location};`,
  ])(`all selected fields are bit-fields (${params}): %s`, (operation) => {
    expectStaticTypeError(`${classes} function take(ref v) {} function f(other, ${params}) { ${operation} }`);
  });
}

test.each([
  'class A { x: uint8; } class B { x: uint16; } function f(a: A | B) { let ref r = a.x; }',
  'class A { x: uint.<1>; } class B { x: uint8; } function f(a: A | B) { let ref r = a.x; }',
  "class C { x: uint.<1>; y: uint8; } function f(a: C, k: 'x' | 'y') { let ref r = a[k]; }",
  'function f(a: { x: uint.<1> } | { x: uint.<2> }) { let ref r = a.x; }',
])('byte storage and mixed/unknown provenance remain eligible: %s', (source) => expect(ok(source)).toBe(true));

test('a deferred mixed selection still checks layout at runtime', () => {
  expectThrownKind('class A { x: uint.<1>; } class B { x: uint8; } function f(a: A | B) { let ref r = a.x; } f(new A());', 'TypeError');
});

test('a computed key is evaluated once when the store executes', () => {
  expect(evaluated("let calls = 0; function key(): 'x' | 'y' { calls++; return 'x'; } let a: { x: uint8, y: uint8 } = { x: 1, y: 1 }; a[key()] = 2; String(calls) + ':' + String(a.x);")).toBe('1:2');
});

test('the declaring constructor may initialize every selected own readonly field', () => {
  expect(ok("class C { readonly x: uint8; readonly y: uint8; constructor(k: 'x' | 'y') { this[k] = 1; } }")).toBe(true);
});

test.each([
  'reference class A { x: uint8; } reference class B { y: uint8; } function f(a: A | B) { a.z = 1; }',
  'class A { x: uint8; set operator[](i: uint32, v: uint8) {} } class B { x: uint8; set operator[](i: uint32, v: uint8) {} } function f(a: A | B) { a[0] = 1; }',
])('preserves reference-class and index-operator exemptions: %s', (source) => expect(ok(source)).toBe(true));

test('a substituted reference retains runtime liveness checks', () => {
  expectThrownKind('function first<T: type>(a: [].<T>): ref T { return ref a[0]; } let a: [].<uint8> = [1]; let ref r = first.<uint8>(a); a.pop(); String(r);', 'TypeError');
});

test('a Symbol key retains its readonly permission', () => {
  expectStaticTypeError('const k = Symbol(); interface I { readonly [k]: uint8; } function f(a: I) { a[k] = 1; }');
});
