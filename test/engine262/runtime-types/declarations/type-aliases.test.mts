import { expect, test } from 'vitest';
import {
  Agent, ManagedRealm, Parser, setSurroundingAgent,
} from '#self';

/**
 * Spec: #sec-type-alias-declarations (Type Alias Declarations).
 *
 * The `type` declaration form: its grammar, its scoping and hoisting, the
 * interface declaration gate beside it, and the shape of the bindings both
 * introduce.
 */

function makeRealm(runtimeTypes = true) {
  setSurroundingAgent(new Agent(runtimeTypes ? { features: ['runtime-types'] } : {}));
  return new ManagedRealm();
}

function parseScript(source: string, runtimeTypes = true) {
  makeRealm(runtimeTypes);
  const p = new Parser({ source, specifier: 'declarations-test' });
  const script = p.parseScript();
  if (p.earlyErrors.size > 0) {
    throw p.earlyErrors.values().next().value;
  }
  return script;
}

function statements(source: string, runtimeTypes = true) {
  const body = parseScript(source, runtimeTypes).ScriptBody;
  expect(body).toBeTruthy();
  return body ? body.StatementList : [];
}

function expectParseError(source: string, runtimeTypes = true) {
  expect(() => parseScript(source, runtimeTypes)).toThrow();
}

test('type alias declarations', () => {
  expect(statements('type T = uint8;')[0]).toMatchObject({
    type: 'TypeAliasDeclaration',
    BindingIdentifier: { name: 'T' },
    TypeParameters: null,
    Type: { type: 'TypeReference' },
    WhereClauses: null,
  });
  expect(statements('type Pair<A, B> = [A, B] where A;')[0]).toMatchObject({
    type: 'TypeAliasDeclaration',
    TypeParameters: { type: 'TypeParameters' },
    Type: { type: 'TupleType' },
    WhereClauses: [{ type: 'WhereClause' }],
  });
});

test('the `type` gate is contextual', () => {
  // A line terminator after `type` keeps it an identifier.
  const stmts = statements('type\nT = uint8;');
  expect(stmts[0]).toMatchObject({ type: 'ExpressionStatement', Expression: { type: 'IdentifierReference', name: 'type' } });
  expect(statements('type = 5;')[0]).toMatchObject({ type: 'ExpressionStatement' });
  expect(statements('let type = 5; type(1);')[1]).toMatchObject({
    Expression: { type: 'CallExpression' },
  });
});

test('interface declarations mix type members and operators', () => {
  const decl = statements(`interface I<T> {
    x: uint8;
    m(a: T): T;
    operator ==(a, b): boolean { return true; };
    static operator +(a, b);
    [k: string]: uint8
  }`)[0];
  expect(decl).toMatchObject({
    type: 'InterfaceDeclaration',
    BindingIdentifier: { name: 'I' },
    TypeParameters: { type: 'TypeParameters' },
  });
  const members = (decl as { InterfaceMemberList?: readonly { type: string }[] }).InterfaceMemberList;
  expect(members?.map((m) => m.type)).toEqual(['TypeMember', 'TypeMember', 'OperatorDefinition', 'OperatorDefinition', 'IndexSignature']);
  expect(members?.[2]).toMatchObject({ OperatorName: '==', static: false, FunctionBody: { type: 'FunctionBody' } });
  expect(members?.[3]).toMatchObject({ OperatorName: '+', static: true, FunctionBody: null });
  // `operator` stays usable as a member name.
  expect(statements('interface J { operator: uint8 }')[0]).toMatchObject({
    InterfaceMemberList: [{ type: 'TypeMember' }],
  });
});

test('enum declarations', () => {
  expect(statements('enum Color: uint8 { Red, Green = 2, Blue, }')[0]).toMatchObject({
    type: 'EnumDeclaration',
    BindingIdentifier: { name: 'Color' },
    TypeAnnotation: { type: 'TypeAnnotation' },
    EnumMemberList: [
      { type: 'EnumMember', IdentifierName: { name: 'Red' }, Initializer: null },
      { type: 'EnumMember', IdentifierName: { name: 'Green' }, Initializer: { type: 'NumericLiteral' } },
      { type: 'EnumMember', IdentifierName: { name: 'Blue' } },
    ],
  });
});

test('meta declarations', () => {
  expect(statements('meta Point { subtype(a, b) { return true; } default = 0; validate(v, c) { return v; } }')[0]).toMatchObject({
    type: 'MetaDeclaration',
    TypeName: { type: 'TypeName' },
    MetaHookList: [
      // `subtype` is required by #sec-primitive-metadata, so a well-formed
      // declaration carries it; the parser records hooks in source order and
      // leaves the requirement to evaluation, which is where the error is raised.
      { type: 'MethodDefinition' },
      { type: 'MetaDefaultHook', AssignmentExpression: { type: 'NumericLiteral' } },
      { type: 'MethodDefinition' },
    ],
  });
});

test('primitive operator declarations', () => {
  const decl = statements(`primitive uint8 {
    operator +(a, b): uint8 { return a; }
    * operator ...() { yield 1; }
    operator float32() { return 0; }
  }`)[0];
  expect(decl).toMatchObject({ type: 'PrimitiveOperatorDeclaration', TypeName: { type: 'TypeName' } });
  const ops = (decl as { OperatorDefinitionList?: readonly object[] }).OperatorDefinitionList;
  expect(ops?.[0]).toMatchObject({ OperatorName: '+', TypeAnnotation: { type: 'TypeAnnotation' } });
  expect(ops?.[1]).toMatchObject({ OperatorGenerator: true, GeneratorBody: { type: 'GeneratorBody' } });
  expect(ops?.[2]).toMatchObject({ OperatorName: null, Type: { type: 'TypeReference' } });
});

test('declared names join the lexical scope', () => {
  expectParseError('type T = uint8; let T = 1;');
  expectParseError('interface I {} class I {}');
  expectParseError('enum E {} const E = 1;');
});

test('declarations evaluate to a bound name and an empty completion', () => {
  const realm = makeRealm();
  const completion = realm.evaluateScriptSkipDebugger('type T = uint8; interface I {} enum E { A } typeof T === "object" && typeof I === "object" && typeof E === "object" ? "bound" : "unexpected";');
  expect(completion).toMatchObject({ Type: 'normal' });
  const value = (completion as unknown as { Value: { stringValue(): string } }).Value;
  expect(value.stringValue()).toBe('bound');
});

test('feature off: every declaration form stays an error', () => {
  expectParseError('type T = uint8;', false);
  expectParseError('interface I {}', false);
  expectParseError('enum E {}', false);
  expectParseError('meta Point {}', false);
  expectParseError('primitive uint8 {}', false);
  // And the identifier readings still work.
  expect(statements('type = 5;', false)[0]).toMatchObject({ type: 'ExpressionStatement' });
});

// -- Self-reference (#sec-type-alias-declarations) ------------------------------
//
// "An alias may refer to itself, directly or through other aliases, provided
// every cycle passes through a position that holds a reference rather than an
// inline layout: a member written `T | null`, the element of a dynamic array,
// or a field of a sealed class. It is a type error if a cycle never does."

/** The completion value of _source_, as a string. */
function evaluated(source: string): string {
  const realm = makeRealm();
  const completion = realm.evaluateScriptSkipDebugger(source) as unknown as {
    Type: string, Value: { stringValue(): string },
  };
  if (completion.Type !== 'normal') {
    throw new Error(`expected a normal completion, got ${completion.Type}`);
  }
  return completion.Value.stringValue();
}

/** The constructor name of the error _source_ throws, and its message. */
function thrown(source: string): string {
  const realm = makeRealm();
  const completion = realm.evaluateScriptSkipDebugger(source) as unknown as { Type: string };
  expect(completion.Type).toBe('throw');
  return evaluated(`try { ${source} "no error"; } catch (e) { e.constructor.name + ": " + e.message; }`);
}

test('a recursive alias resolves and its values flow', () => {
  expect(evaluated('type L = { value: uint8, next: L | null };'
    + ' const n: L = { value: 1, next: { value: 2, next: null } };'
    + ' String(n.next.value);')).toBe('2');
});

test('a cycle may run through other aliases', () => {
  expect(evaluated('type A = { b: B | null }; type B = { a: A | null };'
    + ' const v: A = { b: { a: null } }; String(v.b.a);')).toBe('null');
});

test('a cycle may run through a dynamic array element', () => {
  expect(evaluated('type Arr = { items: [].<Arr> };'
    + ' const t: Arr = { items: [] }; String(t.items.length);')).toBe('0');
});

test('two identical recursive aliases are one type', () => {
  // #sec-structural-identity over a cycle: the intern key has to describe the
  // SHAPE of the recursion rather than the declaration it came from, or these
  // two would be different types.
  expect(evaluated('type L1 = { next: L1 | null }; type L2 = { next: L2 | null };'
    + ' String(L1 === L2);')).toBe('true');
});

test('an alias is still transparent', () => {
  // The recursive case must not have made aliases nominal.
  expect(evaluated('type P = { x: uint8 }; String(P === type { x: uint8 });')).toBe('true');
});

test('a recursive alias survives the reflection round trip', () => {
  expect(evaluated('type L = { next: L | null };'
    + ' String(Reflect.makeType(Reflect.getReflection(L)) === L);')).toBe('true');
});

test('a cycle through no reference position is a type error', () => {
  expect(thrown('type Bad = { self: Bad };'))
    .toBe('TypeError: "Bad" contains itself through field "self", so it has no finite layout');
});

test('a fixed extent lays its elements inline, so it closes a cycle', () => {
  // The dynamic array above holds its elements out of line; `[2].<Fixed>` does
  // not, which is the distinction #sec-layout-finiteness draws.
  expect(thrown('type Fixed = { items: [2].<Fixed> };'))
    .toBe('TypeError: "Fixed" contains itself through field "items", so it has no finite layout');
});

test('an alias defined as itself denotes no type', () => {
  expect(thrown('type L = L;'))
    .toBe('TypeError: "L" is defined as itself, so it denotes no type');
});

test('a recursive alias is checked, not merely resolved', () => {
  const realm = makeRealm();
  const completion = realm.evaluateScriptSkipDebugger('type L = { next: L | null }; let x: L = 5;');
  expect(completion).toMatchObject({ Type: 'throw' });
});

test('a self-referential interface resolves rather than exhausting the stack', () => {
  // This ran at CHECK time, so the recursion took the host process down before
  // any of the program ran.
  expect(evaluated('interface I { value: uint8, next: I | null }'
    + ' const n: I = { value: 1, next: null }; String(n.value);')).toBe('1');
});
