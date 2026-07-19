import { test } from 'vitest';
import { expectBuilderTrue } from './harness.mts';

/**
 * Type Challenges — the hard tier, shard 7 (the structural cluster).
 * Source: ecmascript-types/examples/typechallenges.md
 *
 * Curried function-type construction, printf-style format parsing, and the
 * Vue/Pinia boundary. The function-type transforms (Currying, printf) and the
 * format parsers port directly over makeType kind:'function'. The Vue/Pinia
 * challenges depend on a `this`-parameter type on function signatures, which the
 * engine does not represent, so their full assertions are pending with that
 * primitive named; the portable sub-piece (inferPropType) is asserted on its own.
 */

const L = `function literal(v) { return Reflect.makeType({ kind: 'literal', value: v, base: Reflect.typeOf(v) }); }`;
const TUP = `
function tupleOf(ts) { return Reflect.makeType({ kind: 'tuple', elements: ts.map(t => ({ type: t, rest: false })) }); }
function union(a) { return Reflect.makeType({ kind: 'union', arms: a }); }
function fn(params, ret) { return Reflect.makeType({ kind: 'function', signatures: [{ parameters: params.map(t => ({ type: t })), return: { type: ret } }] }); }
function returnType(F) { return Reflect.getReflection(F).signatures[0].return.type; }
`;

// 17 · Currying 1 — a multi-argument function type to nested single-argument
// function types. Asserted as the type transform curried(F) === Expected (the
// corpus's `Reflect.typeOf(currying(f))` form would additionally need generic
// return-type computation from the argument).
test('hard 17 · Currying 1', () => {
  const f = `${TUP}
    function curried(F) {
      const node = Reflect.getReflection(F);
      if (node.kind !== 'function') { throw new TypeError('not a function'); }
      const signature = node.signatures[0];
      if (signature.parameters.length <= 1) { return F; }
      const [first, ...rest] = signature.parameters;
      const tail = fn(rest.map(p => p.type), signature.return.type);
      return Reflect.makeType({ kind: 'function', signatures: [{ parameters: [first], return: { type: curried(tail) } }] });
    }`;
  expectBuilderTrue(`${f}
    type F = (a: string, b: float64, c: boolean) => true;
    type Expected = (a: string) => (b: float64) => (c: boolean) => true;
    String(curried(F) === Expected);
  `);
  // a single-argument (or zero-argument) function type is unchanged
  expectBuilderTrue(`${f}\n type F = () => true; String(curried(F) === F);`);
});

// 147 · C-printf Parser — the format controls as a tuple of literal types.
test('hard 147 · C-printf Parser', () => {
  const f = `${L}${TUP}
    const controlsMap = { c: 'char', s: 'string', d: 'dec', o: 'oct', h: 'hex', f: 'float', p: 'pointer' };
    function parsePrintFormat(s) {
      const out = [];
      for (let i = 0; i < s.length - 1; i += 1) {
        if (s[i] !== '%') { continue; }
        const letter = s[i + 1];
        if (letter === '%') { i += 1; continue; }
        if (letter in controlsMap) { out.push(literal(controlsMap[letter])); }
      }
      return tupleOf(out);
    }`;
  expectBuilderTrue(`${f}\n type Expected = ['dec']; String(parsePrintFormat('The result is %d.') === Expected);`);
  // %% is an escaped percent
  expectBuilderTrue(`${f}\n const empty = Reflect.makeType({ kind: 'tuple', elements: [] }); String(parsePrintFormat('The result is %%d.') === empty);`);
  expectBuilderTrue(`${f}\n type Expected = ['dec']; String(parsePrintFormat('The result is %%%d.') === Expected);`);
  expectBuilderTrue(`${f}\n type Expected = ['string', 'dec']; String(parsePrintFormat('Hello %s: score is %d.') === Expected);`);
});

// 545 · printf — a format string to a curried function type ending in string.
test('hard 545 · printf', () => {
  const f = `${TUP}
    const mapDict = { s: string, d: float64 };
    function format(f2) {
      const specs = [...f2.matchAll(/%(.)/g)].map(m => m[1]).filter(c => c in mapDict);
      return specs.reduceRight((rest, c) => fn([mapDict[c]], rest), string);
    }`;
  expectBuilderTrue(`${f}\n String(format('') === string);`);
  expectBuilderTrue(`${f}\n type Expected = (x: string) => string; String(format('%s') === Expected);`);
  expectBuilderTrue(`${f}\n type Expected = (x: float64) => string; String(format('%d') === Expected);`);
  expectBuilderTrue(`${f}\n type Expected = (x: string) => (y: float64) => string; String(format('%s%d') === Expected);`);
});

// 213 · Vue Basic Props — the full vueProps type needs `this`-typed methods
// (below), but its prop-type inference is a standalone builder: read a prop's
// declared `type`, and map a constructor (a function type) to its return, a
// tuple of constructors to the union, and anything else to itself.
test('hard 213 · Vue Basic Props (inferPropType)', () => {
  const f = `${TUP}
    function inferPropType(P) {
      const node = Reflect.getReflection(P);
      const declared = node.kind === 'object' ? (node.properties.find(p => p.name === 'type')?.type ?? any) : P;
      function each(C) {
        const n = Reflect.getReflection(C);
        if (n.kind === 'tuple') { return union(n.elements.map(e => each(e.type))); }
        return n.kind === 'function' ? returnType(C) : C;
      }
      return each(declared);
    }`;
  expectBuilderTrue(`${f}\n type P = { type: () => uint32 }; String(inferPropType(P) === uint32);`);
  expectBuilderTrue(`${f}\n type P = [() => uint32, () => string]; type Expected = uint32 | string; String(inferPropType(P) === Expected);`);
});

// 6 · Simple Vue — vueOptions types `data`, `computed`, and `methods` so each
// method sees the right `this`: computed getters see data's shape as `this`,
// methods see data, the computed results, and methods. The `this`-parameter type
// on function signatures (implemented in this phase) makes `withThisType`
// expressible, so the typed-options identity is asserted here.
test('hard 6 · Simple Vue', () => {
  const f = `
    function objectOf(props) { return Reflect.makeType({ kind: 'object', properties: props, indexSignatures: [] }); }
    function fn(params, ret) { return Reflect.makeType({ kind: 'function', signatures: [{ parameters: params.map(t => ({ type: t })), return: { type: ret } }] }); }
    function prop(name, type) { return { name, type, optional: false, readonly: false }; }
    function returnType(F) { return Reflect.getReflection(F).signatures[0].return.type; }
    function mapProperties(T, g) { return objectOf(Reflect.getReflection(T).properties.map(g)); }
    function withThisType(F, Self) {
      const sig = Reflect.getReflection(F).signatures[0];
      return Reflect.makeType({ kind: 'function', signatures: [{ parameters: sig.parameters, return: sig.return, this: Reflect.getReflection(Self) }] });
    }
    function computedResults(C) { return mapProperties(C, p => ({ ...p, type: returnType(p.type) })); }
    function withThisOnMethods(O, Self) { return mapProperties(O, p => ({ ...p, type: withThisType(p.type, Self) })); }
    function vueOptions(D, C, M) {
      const self = Reflect.makeType({ kind: 'intersection', members: [D, computedResults(C), M] });
      return objectOf([
        prop('data', withThisType(fn([], D), type void)),
        prop('computed', withThisOnMethods(C, D)),
        prop('methods', withThisOnMethods(M, self)),
      ]);
    }`;
  // data binds `this: void`, computed getters bind `this: D`, methods bind
  // `this: D & computedResults(C) & M`.
  expectBuilderTrue(`${f}
    type D = { count: uint32 };
    type C = { double: () => uint32 };
    type M = { inc: () => void };
    type Expected = {
      data: (this: void) => { count: uint32 },
      computed: { double: (this: { count: uint32 }) => uint32 },
      methods: { inc: (this: { count: uint32 } & { double: uint32 } & { inc: () => void }) => void }
    };
    String(vueOptions(D, C, M) === Expected);
  `);
  // the shape is deterministic, so interned identity holds across two builds
  expectBuilderTrue(`${f}
    type D = { firstname: string, lastname: string };
    type C = { fullname: () => string };
    type M = { hi: () => string };
    String(vueOptions(D, C, M) === vueOptions(D, C, M));
  `);
});

// 1290 · Pinia — storeOptions binds `this` on getters and actions with the same
// withThisType helper, so it needs the same `this`-parameter type primitive.
test('hard 1290 · Pinia', () => {
  const f = `
    function objectOf(props) { return Reflect.makeType({ kind: 'object', properties: props, indexSignatures: [] }); }
    function fn(params, ret) { return Reflect.makeType({ kind: 'function', signatures: [{ parameters: params.map(t => ({ type: t })), return: { type: ret } }] }); }
    function prop(name, type) { return { name, type, optional: false, readonly: false }; }
    function returnType(F) { return Reflect.getReflection(F).signatures[0].return.type; }
    function mapProperties(T, g) { return objectOf(Reflect.getReflection(T).properties.map(g)); }
    function readonly(T) { return mapProperties(T, p => ({ ...p, readonly: true })); }
    function withThisType(F, Self) {
      const sig = Reflect.getReflection(F).signatures[0];
      return Reflect.makeType({ kind: 'function', signatures: [{ parameters: sig.parameters, return: sig.return, this: Reflect.getReflection(Self) }] });
    }
    function computedResults(G) { return mapProperties(G, p => ({ ...p, type: returnType(p.type) })); }
    function withThisOnMethods(O, Self) { return mapProperties(O, p => ({ ...p, type: withThisType(p.type, Self) })); }
    function all(members) { return Reflect.makeType({ kind: 'intersection', members }); }
    function storeOptions(S, G, A) {
      return objectOf([
        prop('id', string),
        prop('state', fn([], S)),
        prop('getters', withThisOnMethods(G, all([computedResults(G), readonly(S)]))),
        prop('actions', withThisOnMethods(A, all([A, S, readonly(computedResults(G))]))),
      ]);
    }`;
  // storeOptions is deterministic (interned identity holds across two builds),
  // and each piece matches its construction. Asserting against builder-constructed
  // expectations mirrors the corpus and avoids hand-transcribing deeply nested
  // `this`-type intersections.
  expectBuilderTrue(`${f}
    type S = { count: uint32 };
    type G = { double: () => uint32 };
    type A = { inc: () => void };
    String(storeOptions(S, G, A) === storeOptions(S, G, A));
  `);
  expectBuilderTrue(`${f}
    type S = { count: uint32 };
    type G = { double: () => uint32 };
    type A = { inc: () => void };
    const store = storeOptions(S, G, A);
    const props = Reflect.getReflection(store).properties;
    const byName = (n) => props.find(p => p.name === n).type;
    const idOk = byName('id') === string;
    const stateOk = byName('state') === fn([], S);
    const gettersOk = byName('getters') === withThisOnMethods(G, all([computedResults(G), readonly(S)]));
    const actionsOk = byName('actions') === withThisOnMethods(A, all([A, S, readonly(computedResults(G))]));
    String(idOk && stateOk && gettersOk && actionsOk);
  `);
  // the getters this-type is exactly the computed results intersected with the
  // readonly state; spot-check it against a hand-written type (the shallow case
  // that is safe to transcribe).
  expectBuilderTrue(`${f}
    type S = { count: uint32 };
    type G = { double: () => uint32 };
    type Expected = { double: (this: { double: uint32 } & { readonly count: uint32 }) => uint32 };
    String(withThisOnMethods(G, all([computedResults(G), readonly(S)])) === Expected);
  `);
});
