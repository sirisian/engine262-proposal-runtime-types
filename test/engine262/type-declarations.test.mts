import { expect, test } from 'vitest';
import {
  Agent, ManagedRealm, Parser, setSurroundingAgent,
} from '#self';

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
  expect(statements('meta Point { default = 0; validate(v, c) { return v; } }')[0]).toMatchObject({
    type: 'MetaDeclaration',
    TypeName: { type: 'TypeName' },
    MetaHookList: [
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
