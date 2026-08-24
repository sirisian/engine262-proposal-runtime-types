import { test } from 'vitest';
import { expectBuilderTrue, kit } from './harness.mts';

/**
 * Type Challenges - the medium tier, shard 3.
 * Source: ecmascript-types/examples/typechallenges.md
 *
 * Function-type reflection and construction, and recursion over reflected
 * structure. getReflection exposes a function type's signatures (parameter types
 * and return type), and makeType constructs a function type from that shape
 * (the `function` node case was added this shard, completing the function round
 * trip makeType(getReflection(F)) === F). Recursion uses the reflect/makeType
 * round trip applied to nested structure.
 */

const FN = `function fnType(params, ret) { return Reflect.makeType({ kind: 'function', signatures: [{ parameters: params.map(t => ({ type: t })), return: { type: ret } }] }); }`;

// 2 - Get Return Type - the return type of a function type.
test('medium 2 - Get Return Type', () => {
  const rt = '';
  expectBuilderTrue(kit(`${rt}\n type F = () => string; String(returnType(F) === string);`));
  expectBuilderTrue(kit(`${rt}\n type F = () => 123; String(returnType(F) === type 123);`));
  // a function returning a function type
  expectBuilderTrue(kit(`${rt}\n type F = () => () => string; type Inner = () => string; String(returnType(F) === Inner);`));
});

// 3312 - Parameters - the parameter list of a function type, as a tuple.
test('medium 3312 - Parameters', () => {
  const params = ` function parameters(F) { return tupleOf(Reflect.getReflection(F).signatures[0].parameters.map(p => p.type)); }`;
  expectBuilderTrue(kit(`${params}
    type F = (a: string, b: uint32) => void;
    type Expected = [string, uint32];
    String(parameters(F) === Expected);
  `));
  // a single parameter
  expectBuilderTrue(kit(`${params}
    type F = (a: uint8) => void;
    type Expected = [uint8];
    String(parameters(F) === Expected);
  `));
});

// 191 - Append Argument - a function type with one more parameter appended.
// Reads the signature, appends the argument type, reconstructs the function.
test('medium 191 - Append Argument', () => {
  const append = `${FN}
    function appendArgument(F, X) {
      const sig = Reflect.getReflection(F).signatures[0];
      return fnType([...sig.parameters.map(p => p.type), X], sig.return.type);
    }`;
  expectBuilderTrue(kit(`${append}
    type F = (a: uint32, b: string) => uint32;
    type Expected = (a: uint32, b: string, x: boolean) => uint32;
    String(appendArgument(F, boolean) === Expected);
  `));
  // appending to a no-argument function
  expectBuilderTrue(kit(`${append}
    type F = () => void;
    type Expected = (x: uint8) => void;
    String(appendArgument(F, uint8) === Expected);
  `));
});

// The function round trip that the above rely on: reflect a function type and
// reconstruct it to the same interned type.
test('function round trip - makeType(getReflection(F)) === F', () => {
  expectBuilderTrue(kit(`
    type F = (a: uint32, b: string) => boolean;
    String(Reflect.makeType(Reflect.getReflection(F)) === F);
  `));
});

// 459 - Flatten - flatten nested tuples into one, recursively.
test('medium 459 - Flatten', () => {
  const flatten = `    function flat(elements) {
      return elements.flatMap(e => {
        const r = Reflect.getReflection(e.type);
        return r.kind === 'tuple' ? flat(r.elements) : [e.type];
      });
    }
    function flatten(T) { return tupleOf(flat(Reflect.getReflection(T).elements)); }`;
  expectBuilderTrue(kit(`${flatten}
    type T = [1, 2, [3, 4], [[[5]]]];
    type Expected = [1, 2, 3, 4, 5];
    String(flatten(T) === Expected);
  `));
  // a tuple of an object and a string is unchanged (neither is a tuple)
  expectBuilderTrue(kit(`${flatten}
    type T = [{ foo: 'bar' }, 'foobar'];
    type Expected = [{ foo: 'bar' }, 'foobar'];
    String(flatten(T) === Expected);
  `));
});
