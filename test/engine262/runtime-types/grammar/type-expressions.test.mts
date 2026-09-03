import { expect, test } from 'vitest';
import {
  Agent, ManagedRealm, Parser, setSurroundingAgent, TokenNames,
} from '#self';

/**
 * Spec: #sec-type-expressions (Type Expressions).
 *
 * The type-expression grammar at the parser level, through the parseType
 * entry point: references, unions and intersections and their precedence,
 * prefixes (keyof, shared, ref), literal and predefined types, arrays,
 * tuples, object and function types, nested argument lists splitting `>>`,
 * computed types, type parameters, where clauses, and the rejected forms.
 */

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

/** Evaluates a script under the feature and returns its completion value as a string. */
function evaluated(source: string): string {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  const completion = realm.evaluateScriptSkipDebugger(source);
  expect(completion, `expected normal completion for: ${source}`).toMatchObject({ Type: 'normal' });
  return (completion as unknown as { Value: { stringValue(): string } }).Value.stringValue();
}

test('a prefix takes a CALL operand, which is a PrimaryType like any other', () => {
  // The lookahead that decides whether `keyof` is an operator or an ordinary type
  // reference has to admit whatever begins a PrimaryType, or `keyof` reads as a
  // NAME and what follows is unexpected.
  //
  // `Reflect.typeOf(x)` is the type query (typeprogramming.md 4.1) and parses as
  // a ComputedType, so it is the operand this exercises the lookahead with. It is
  // also the spelling an enum's enumerator names are reached by.
  expect(parseType('keyof Reflect.typeOf(E)')).toMatchObject({
    type: 'KeyOfType', Type: { type: 'ComputedType' },
  });
  expect(parseType('shared Reflect.typeOf(v)')).toMatchObject({
    type: 'SharedType', Type: { type: 'ComputedType' },
  });
  expect(parseType('ref Reflect.typeOf(v)')).toMatchObject({
    type: 'ReferenceType', Type: { type: 'ComputedType' },
  });
  // The grouping the parenthesized form already had is unchanged.
  expect(parseType('keyof (Reflect.typeOf(E))')).toMatchObject({ type: 'KeyOfType' });
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
  // Bare `[]` is the EMPTY TUPLE. `[].<T>` is still an array,
  // and `[].<any>` is the family bound that `[]` used to spell.
  expect(parseType('[]')).toMatchObject({ type: 'TupleType', TupleElementList: [] });
  expect(parseType('[].<any>')).toMatchObject({ type: 'ArrayType', ArrayExtent: null });
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
  expectTypeError('.<uint8>'); // type arguments need a reference
  // `[1, 2].<uint8>` is NO LONGER a parse error. It once was, because the only
  // production carrying |TypeArguments| onto a bracketed form was
  // `[` ArrayExtent `]` TypeArguments and an extent is a single expression.
  // |ParameterizedType| now applies |TypeArguments| to any |PostfixType|, so
  // `[1, 2]` parses as a TUPLE and the arguments parameterize it. The form is
  // rejected one stage later instead, the tuple taking a metadata record where
  // a type was written - which is a better error than a parse failure was.
});

// -- What `keyof` answers where there is nothing to answer with -----------------
test('keyof a type with no keys is the empty type, not an error', () => {
  // A type with no keys has an empty key set - a definite answer, not an unknown
  // one. An empty object type already answered that way, so `keyof {}` and
  // `keyof uint8` disagreed for no reason a reader could give.
  expect(evaluated('type A = keyof uint8; type B = keyof { }; String(A === B);')).toBe('true');
  expect(evaluated('type K = keyof string; String("a" is K);')).toBe('false');
  expect(evaluated('enum C { Zero } type K = keyof C; String("Zero" is K);')).toBe('false');
  // The enumerator NAMES are reached through the enum object's type, which is a
  // different question and still answers.
  expect(evaluated('enum C { Zero } type K = keyof Reflect.typeOf(C); String("Zero" is K);')).toBe('true');
});

test('a keyless member of an intersection contributes nothing, rather than voiding it', () => {
  // A behaviour CHANGE, not a simplification: while a sentinel stood for "no
  // keys", one keyless member made the whole intersection keyless. An
  // intersection has every key its members have, so `keyof (A & { })` is
  // `keyof A`.
  //
  // The keyless member is `{ }` rather than the `uint8` this pinned before.
  // #sec-aredisjoint makes an object type and a primitive DISJOINT - the fact
  // #sec-narrowto already stated - so `A & uint8` is now `never`, and `keyof`
  // over the empty type is the empty type rather than an intersection with a
  // keyless member. `{ }` is keyless and NOT disjoint from `A`, so it exercises
  // the rule this test is about on a type that still has values.
  expect(evaluated('type A = { a: uint8 }; type X = keyof (A & { }); type Y = keyof A; '
    + 'String(X === Y);')).toBe('true');
  // A union is the other way round - its keys are those COMMON to every member -
  // so a keyless member empties it, which needs no special case either.
  expect(evaluated('type A = { a: uint8 }; type K = keyof (A | uint8); String("a" is K);')).toBe('false');
  expect(evaluated('type A = { a: uint8, b: string }; type B = { a: uint8 }; type K = keyof (A | B); '
    + 'String(("a" is K) && !("b" is K));')).toBe('true');
});

// -- keyof over a class ---------------------------------------------------------
test('a class type answers with its declared instance members', () => {
  // An interface answered already, because its Type Record carries a structure
  // this operation reads; a class type carries none, so `keyof C` reported a type
  // with no keys while `keyof I` for the same shape answered. The keys are
  // derived from the declaration rather than by giving a class a structure -
  // that structure is what makes an INTERFACE parameter structural in overload
  // resolution, and a class must stay nominal by declaration.
  const C = 'class C { a: uint8 = 1; b: string = "x"; m(): void {} static s = 1; #p = 2; } ';
  expect(evaluated(`${C}type K = keyof C; String(("a" is K) && ("b" is K));`)).toBe('true');
  // Methods are keys, as they are for an interface.
  expect(evaluated(`${C}type K = keyof C; String("m" is K);`)).toBe('true');
  // A static belongs to the constructor, reached through `keyof Reflect.typeOf(C)`.
  expect(evaluated(`${C}type K = keyof C; String("s" is K);`)).toBe('false');
  // A private name is not a property key and cannot be written as one.
  expect(evaluated(`${C}type K = keyof C; String("p" is K);`)).toBe('false');
  // A class and an interface of one shape agree, which is the comparison that
  // made the old behaviour hard to defend.
  expect(evaluated('interface I { a: uint8, m(): void } class D { a: uint8 = 1; m(): void {} } '
    + 'type KI = keyof I; type KD = keyof D; String(KI === KD);')).toBe('true');
});
