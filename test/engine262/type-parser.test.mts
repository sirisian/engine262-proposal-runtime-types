import { expect, test } from 'vitest';
import {
  Agent, ManagedRealm, Parser, setSurroundingAgent, TokenNames,
} from '#self';

function makeParser(source: string) {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  void new ManagedRealm();
  return new Parser({ source, specifier: 'type-test' });
}

function parseType(source: string) {
  const p = makeParser(source);
  const node = p.parseType();
  expect(TokenNames[p.peek().type]).toBe('EOS');
  return node;
}

function expectTypeError(source: string) {
  const p = makeParser(source);
  expect(() => {
    p.parseType();
    if (TokenNames[p.peek().type] !== 'EOS') {
      throw new Error('trailing input');
    }
  }).toThrow();
}

test('TypeReference, plain and qualified', () => {
  expect(parseType('uint8')).toMatchObject({
    type: 'TypeReference',
    TypeName: { type: 'TypeName', MemberNames: [] },
    TypeArguments: null,
  });
  expect(parseType('Reflect.Type')).toMatchObject({
    type: 'TypeReference',
    TypeName: { type: 'TypeName', MemberNames: [{ type: 'IdentifierName' }] },
  });
});

test('union binds looser than intersection', () => {
  expect(parseType('A | B & C')).toMatchObject({
    type: 'UnionType',
    Types: [
      { type: 'TypeReference' },
      { type: 'IntersectionType', Types: [{ type: 'TypeReference' }, { type: 'TypeReference' }] },
    ],
  });
});

test('keyof, shared, and ref prefixes', () => {
  expect(parseType('keyof { a: uint8 }')).toMatchObject({ type: 'KeyOfType', Type: { type: 'ObjectType' } });
  expect(parseType('shared A')).toMatchObject({ type: 'SharedType', Type: { type: 'TypeReference' } });
  expect(parseType('ref uint8')).toMatchObject({ type: 'ReferenceType', Type: { type: 'TypeReference' } });
  // Bare, these are ordinary type references.
  expect(parseType('shared')).toMatchObject({ type: 'TypeReference' });
  expect(parseType('keyof')).toMatchObject({ type: 'TypeReference' });
});

test('predefined and literal types', () => {
  expect(parseType('void')).toMatchObject({ type: 'PredefinedType', keyword: 'void' });
  expect(parseType('null')).toMatchObject({ type: 'PredefinedType', keyword: 'null' });
  expect(parseType('-1')).toMatchObject({
    type: 'LiteralType', kind: 'number', value: 1, negated: true,
  });
  expect(parseType('2i')).toMatchObject({ type: 'LiteralType', kind: 'imaginary', value: 2 });
  expect(parseType('3n')).toMatchObject({ type: 'LiteralType', kind: 'bigint', value: 3n });
  expect(parseType("'left' | 'right'")).toMatchObject({
    type: 'UnionType',
    Types: [
      { type: 'LiteralType', kind: 'string', value: 'left' },
      { type: 'LiteralType', kind: 'string', value: 'right' },
    ],
  });
  expect(parseType('true')).toMatchObject({ type: 'LiteralType', kind: 'boolean', value: true });
});

test('array types, dynamic and fixed extent', () => {
  expect(parseType('[].<float32>')).toMatchObject({
    type: 'ArrayType',
    ArrayExtent: null,
    TypeArguments: { TypeArgumentList: [{ type: 'TypeReference' }] },
  });
  expect(parseType('[]')).toMatchObject({ type: 'ArrayType', ArrayExtent: null, TypeArguments: null });
  expect(parseType('[4].<float32>')).toMatchObject({
    type: 'ArrayType',
    ArrayExtent: { type: 'NumericLiteral' },
    TypeArguments: { TypeArgumentList: [{ type: 'TypeReference' }] },
  });
  expect(parseType('[n * 2].<float32>')).toMatchObject({
    type: 'ArrayType',
    ArrayExtent: { type: 'MultiplicativeExpression' },
  });
});

test('tuple types, including the one-element rewind', () => {
  expect(parseType('[float32, uint8]')).toMatchObject({
    type: 'TupleType',
    TupleElementList: [
      { type: 'TupleElement', Rest: false },
      { type: 'TupleElement', Rest: false },
    ],
  });
  // `float32` parses as an expression too, so this exercises the rewind.
  expect(parseType('[float32]')).toMatchObject({
    type: 'TupleType',
    TupleElementList: [{ type: 'TupleElement' }],
  });
  expect(parseType('[uint8 = 7, ...float32]')).toMatchObject({
    type: 'TupleType',
    TupleElementList: [
      { Initializer: { type: 'NumericLiteral' }, Rest: false },
      { Initializer: null, Rest: true },
    ],
  });
});

test('object types: members, optionals, methods, index and computed keys', () => {
  expect(parseType('{ a: uint8, b?: float32 = 1; m(x: uint8): float32 }')).toMatchObject({
    type: 'ObjectType',
    TypeMemberList: [
      { type: 'TypeMember', Optional: false, TypeAnnotation: { type: 'TypeAnnotation' }, Initializer: null },
      { type: 'TypeMember', Optional: true, Initializer: { type: 'NumericLiteral' } },
      { type: 'TypeMember', MethodSignature: { type: 'MethodSignature', TypeAnnotation: { type: 'TypeAnnotation' } } },
    ],
  });
  expect(parseType('{ [key: string]: uint8 }')).toMatchObject({
    type: 'ObjectType',
    TypeMemberList: [{ type: 'IndexSignature', KeyTypeAnnotation: { type: 'TypeAnnotation' } }],
  });
  expect(parseType('{ [Symbol.iterator]: uint8 }')).toMatchObject({
    type: 'ObjectType',
    TypeMemberList: [{ type: 'TypeMember', PropertyName: { type: 'PropertyName' } }],
  });
  expect(parseType('{}')).toMatchObject({ type: 'ObjectType', TypeMemberList: [] });
});

test('function types and parenthesized types', () => {
  expect(parseType('(x: uint8, ref y: float32, ...rest: uint8) => float32')).toMatchObject({
    type: 'FunctionType',
    FunctionTypeParameterList: [
      { Ref: false, Rest: false, Optional: false, TypeAnnotation: { type: 'TypeAnnotation' } },
      { Ref: true, Rest: false },
      { Ref: false, Rest: true },
    ],
    ReturnType: { type: 'TypeReference' },
  });
  expect(parseType('() => void')).toMatchObject({
    type: 'FunctionType',
    FunctionTypeParameterList: [],
    ReturnType: { type: 'PredefinedType' },
  });
  expect(parseType('(x?: uint8) => void')).toMatchObject({
    type: 'FunctionType',
    FunctionTypeParameterList: [{ Optional: true }],
  });
  expect(parseType('(uint8)')).toMatchObject({ type: 'ParenthesizedType', Type: { type: 'TypeReference' } });
  expect(parseType('A | (B & C)')).toMatchObject({
    type: 'UnionType',
    Types: [{ type: 'TypeReference' }, { type: 'ParenthesizedType', Type: { type: 'IntersectionType' } }],
  });
});

test('nested type arguments split `>>`', () => {
  expect(parseType('Map.<string, Map.<string, uint8>>')).toMatchObject({
    type: 'TypeReference',
    TypeArguments: {
      TypeArgumentList: [
        { type: 'TypeReference' },
        { type: 'TypeReference', TypeArguments: { TypeArgumentList: [{ type: 'TypeReference' }, { type: 'TypeReference' }] } },
      ],
    },
  });
});

test('computed types are call-shaped', () => {
  expect(parseType('Reflect.typeOf(x)')).toMatchObject({
    type: 'ComputedType',
    Callee: { type: 'TypeReference', TypeName: { type: 'TypeName' } },
  });
});

test('type parameters with constraint and default', () => {
  // Reordered so the defaulted parameter comes last. A parameter carrying a
  // default may not precede one that does not - an application supplying fewer
  // arguments fills from the end - and the rule is enforced now where it was
  // only stated before. The ordering was incidental to this test, which is
  // about parsing a constraint and a default together.
  const p = makeParser('<U extends A.B, T: Comparable = uint8>');
  const params = p.parseTypeParameters();
  expect(TokenNames[p.peek().type]).toBe('EOS');
  expect(params).toMatchObject({
    type: 'TypeParameters',
    TypeParameterList: [
      { type: 'TypeParameter', TypeParameterConstraint: { type: 'TypeReference' }, TypeParameterDefault: null },
      { type: 'TypeParameter', TypeParameterConstraint: { type: 'TypeReference' }, TypeParameterDefault: { type: 'TypeReference' } },
    ],
  });
});

test('type annotation and typed initializer entry points', () => {
  const p1 = makeParser(': [].<uint8>');
  expect(p1.parseTypeAnnotation()).toMatchObject({ type: 'TypeAnnotation', Type: { type: 'ArrayType' } });
  const p2 = makeParser(':= a + 1');
  expect(p2.parseTypedInitializer()).toMatchObject({
    type: 'TypedInitializer',
    AssignmentExpression: { type: 'AdditiveExpression' },
  });
});

test('where clauses, plain and conditional', () => {
  const p = makeParser('where a > b where if (c) { d } else { e }');
  const clauses = p.parseWhereClauses();
  expect(TokenNames[p.peek().type]).toBe('EOS');
  expect(clauses).toHaveLength(2);
  expect(clauses[0]).toMatchObject({ type: 'WhereClause', RefinementPredicate: { type: 'RelationalExpression' } });
  expect(clauses[1]).toMatchObject({
    type: 'WhereClause',
    RefinementPredicate: { type: 'ConditionalRefinement', Alternate: { type: 'IdentifierReference' } },
  });
});

test('rejected forms', () => {
  expectTypeError('(a, b)'); // a parameter list is not a parenthesized type
  expectTypeError('{ a }'); // type members need an annotation or method signature
  expectTypeError('[1, 2].<uint8>'); // an extent is a single expression
  expectTypeError('.<uint8>'); // type arguments need a reference
});
