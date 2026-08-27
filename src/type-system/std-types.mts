import type { HostLoadImportedModulePayloadOpaque } from '../host-defined/engine.mts';
import type { CyclicModuleRecord } from '../modules.mts';
import type { ModuleRequestRecord } from '../static-semantics/ModuleRequests.mts';
import type { ManagedRealm } from '../api.mts';
import { FinishLoadingImportedModule, surroundingAgent, type Realm, type ScriptRecord } from '#self';

/**
 * proposal-runtime-types `annex-standard-kit`, PLAN-std-types.md phase 1: the
 * STANDARD BUILDER KIT, shipped under the specifier `std:types`.
 *
 * The annex fixes the implementation strategy and rules out the obvious
 * shortcut. The kit is "roughly two hundred lines of ordinary evaluable code"
 * over the core primitives, it "ships as source", and "A codebase that cannot
 * assume the module can polyfill it verbatim." Building these as intrinsics
 * would falsify all three sentences, so the kit is SOURCE TEXT compiled as an
 * ordinary module - nothing below is engine magic, and the same text loads
 * unchanged as a user module, which is what makes the polyfill claim testable.
 *
 * Written over the primitives of typeprogramming.md §3.6 - `Reflect.makeType`,
 * `Reflect.getReflection`, `Reflect.isAssignable`, and `type never` - plus
 * `Reflect.typeOf`, which `literal` needs and which neither §3.6 nor the annex
 * lists (PLAN-std-types.md, phase 5: the two lists also differ from each other
 * on `keyof`).
 *
 * WHERE THIS DEPARTS FROM THE DESIGN DOCUMENT, and why. Each is a finding fed
 * back by PLAN-std-types.md phase 5; none is a silent edit.
 *
 *   F105  §4.1's `js` block is missing from typeprogramming.md, so `indexed`
 *         had no definition anywhere. Reconstructed here against
 *         #sec-indexed-access-types and checked to agree with the `T[K]`
 *         operator.
 *   F113  §4.0 annotates with `Reflect.TypeReflection`,
 *         `TypePropertyReflection`, `TypeTupleElement` and `TypeIndexSignature`
 *         - twenty uses of four names that exist in NEITHER the specification
 *         nor the engine. Erased here rather than invented.
 *   F114  §4.5's `head` is `elementTypes(T)[0] ?? never`, which does not run: a
 *         `[].<type>` annotation makes the result a CHECKED array, so the guard
 *         is statically dead code and the empty case raises rather than
 *         yielding `undefined`. Written as a length test.
 *   F116  §4.3's `awaited` compares `node.generic?.base === Promise`, which is
 *         the CONSTRUCTOR, not the type. `type Promise` is the operand.
 *   F117  a signature's `this` slot reflects as a NODE where every other
 *         type-valued slot reflects as a Type Object, so §6.3's
 *         `thisParameterType` needs a `makeType` to normalise it.
 *   F120  §4.0's `genericApplication` spreads the READ view
 *         (`{ ...reflect(base), generic: {...} }`). The write side ignores a
 *         `generic` field on a primitive node, so that spelling silently
 *         returns the BARE BASE - a wrong type rather than an error. The write
 *         form is the `generic` KIND.
 *
 * THE EXPORT SET IS 71, and three decisions moved it after this module first
 * landed at 73. Each is recorded at the definition it touches:
 *
 *   OQ1-C   `keys` ADDED - the function form of `keyof`, forwarding to the
 *           operator rather than reimplementing it. Named for the kit's own
 *           convention, where an `Of` suffix constructs and a bare plural
 *           extracts; `keysOf`, which three sources advertise, would be the
 *           first extractor carrying `Of`.
 *   OQ8-C   `suffixed` and `stringPattern` WITHHELD - written, unexported,
 *           reversible in one word. The `pattern` claim they depend on is
 *           provisional.
 *   OQ10-C  `instanceType` RETIRED - the identity for a class, `returnType`
 *           under a second name for a factory.
 *
 * BLOCKED, and on what. `brand` alone, and twice over: it builds a
 * `parameterized` node, which the read side emits and the write side rejects
 * (F110), and no meta type claims the `brand` key, so even the syntactic
 * `uint32.<{ brand: 'X' }>` is refused (F126). It needs OQ6-A and OQ9-A. It is
 * exported as written so the failure names the gap rather than the caller.
 *
 * NOT blocked, contrary to an earlier note: a walk over a struct CONTAINING a
 * branded or enum field works, because a field's type rides as a Type Object
 * and a walk's default arm passes it through untouched. `deepPartial`,
 * `traverse` and `deepMap` are fine; only reconstruction of the parameterized
 * or enum type ITSELF fails.
 */
export const STD_TYPES_SPECIFIER = 'std:types';

export const STD_TYPES_SOURCE = `
// ---- foundations — §4.0 ----------------------------------------

export function reflect(T: type) {
  return Reflect.getReflection(T);
}
export function literal(value: string | number | boolean | bigint): type {
  return Reflect.makeType({ kind: 'literal', value, base: Reflect.typeOf(value) });
}
export function union(armList: [].<type>): type {
  return Reflect.makeType({ kind: 'union', members: armList });
}
export function arms(T: type): [].<type> {
  const node = reflect(T);
  return node.kind === 'union' ? node.members : [T];
}
export function intersection(members: [].<type>): type {
  return Reflect.makeType({ kind: 'intersection', members });
}
export function literalValues(T: type) {
  return arms(T).map(arm => {
    const node = reflect(arm);
    if (node.kind !== 'literal') throw new TypeError(\`expected a union of literals, got \${String(arm)}\`);
    return node.value;
  });
}
export function literalValue(T: type): any {
  const values = literalValues(T);
  if (values.length !== 1) throw new TypeError(\`literalValue expects a single literal type, got \${String(T)}\`);
  return values[0];
}
export function prop(name: string | symbol, type: type,
    { optional = false, readonly = false, initial = undefined } = {}) {
  return { name, type, optional, readonly, initial };
}
export function objectOf(properties: [].<any>, indexSignatures: [].<any> = []): type {
  return Reflect.makeType({ kind: 'object', properties, indexSignatures });
}
export function tupleOf(types: [].<type>): type {
  return Reflect.makeType({ kind: 'tuple', elements: types.map(type => ({ type, rest: false, initial: undefined })) });
}
export function arrayOf(element: type, extent: uint32 | undefined = undefined): type {
  return Reflect.makeType({ kind: 'array', element, extent });
}
export function tupleElements(T: type): [].<any> {
  const node = reflect(T);
  if (node.kind !== 'tuple') throw new TypeError(\`expected a tuple type, got \${String(T)}\`);
  return node.elements.slice();
}
export function elementTypes(T: type): [].<type> {
  return tupleElements(T).map(e => e.type);
}

// ---- property and element mapping — §4.0 -----------------------

export function mapProperties(T: type, f): type {
  const node = reflect(T);
  if (node.kind === 'union') return union(node.members.map(arm => mapProperties(arm, f)));
  if (node.kind === 'intersection')
    return Reflect.makeType({ kind: 'intersection', members: node.members.map(m => mapProperties(m, f)) });
  if (node.kind !== 'object') throw new TypeError(\`mapProperties expects an object type, got \${String(T)}\`);
  return objectOf(node.properties.map(f).filter(p => p !== null), node.indexSignatures);
}
export function mapPropertyTypes(T: type, f): type {
  return mapProperties(T, p => ({ ...p, type: f(p.type) }));
}
export function mapElements(T: type, f): type {
  const node = reflect(T);
  if (node.kind === 'tuple')
    return Reflect.makeType({ ...node, elements: node.elements.map(e => ({ ...e, type: f(e.type) })) });
  if (node.kind === 'array') return arrayOf(f(node.element), node.extent);
  throw new TypeError(\`mapElements expects a tuple or array type, got \${String(T)}\`);
}
export function propertyType(T: type, name: string | symbol) {
  const node = reflect(T);
  if (node.kind === 'object') return node.properties.find(p => p.name === name)?.type;
  if (node.kind === 'intersection') {
    for (const m of node.members) { const t = propertyType(m, name); if (t !== undefined) return t; }
    return undefined;
  }
  throw new TypeError(\`propertyType expects an object type, got \${String(T)}\`);
}
export function genericApplication(base: type, args: [].<any>): type {
  // F120: §4.0 writes \`{ ...reflect(base), generic: { base, arguments } }\`,
  // which mirrors the READ view. The write side ignores a \`generic\` FIELD on a
  // primitive node, so that spelling silently returns the bare base instead of
  // the application - a wrong answer rather than an error. The write form is
  // the \`generic\` KIND.
  return Reflect.makeType({ kind: 'generic', base, arguments: args });
}

// ---- object utilities — §4.2 -----------------------------------

export function partial(T: type): type  { return mapProperties(T, p => ({ ...p, optional: true  })); }
export function required(T: type): type { return mapProperties(T, p => ({ ...p, optional: false })); }
export function readonly(T: type): type { return mapProperties(T, p => ({ ...p, readonly: true  })); }
export function mutable(T: type): type  { return mapProperties(T, p => ({ ...p, readonly: false })); }

export function pick(T: type, K): type {
  const wanted = new Set(Array.isArray(K) ? K : literalValues(K));
  const have = new Set(literalValues(type keyof T));
  for (const key of wanted) if (!have.has(key))
    throw new TypeError(\`pick: \${String(T)} has no property '\${String(key)}'\`);
  return mapProperties(T, p => wanted.has(p.name) ? p : null);
}
export function omit(T: type, K): type {
  const dropped = new Set(Array.isArray(K) ? K : literalValues(K));
  return mapProperties(T, p => dropped.has(p.name) ? null : p);
}
export function record(K: type, V: type): type {
  const node = reflect(K);
  if (node.kind === 'literal' || node.kind === 'union' && node.members.every(a => reflect(a).kind === 'literal'))
    return objectOf(literalValues(K).map(name => prop(name, V)));
  return objectOf([], [{ key: K, value: V }]);
}
export function pickByValue(T: type, V: type): type {
  return mapProperties(T, p => Reflect.isAssignable(p.type, V) ? p : null);
}
export function removeKind(T: type): type { return omit(T, ['kind']); }
export function merge(A: type, B: type): type {
  const a = reflect(A), b = reflect(B);
  if (a.kind !== 'object' || b.kind !== 'object') throw new TypeError('merge expects object types');
  return objectOf(
    [...a.properties.filter(p => !b.properties.some(q => q.name === p.name)), ...b.properties],
    [...a.indexSignatures.filter(s => !b.indexSignatures.some(h => h.key === s.key)), ...b.indexSignatures]);
}
export function renameProperties(T: type, f): type {
  return mapProperties(T, p => ({ ...p, name: typeof p.name === 'string' ? f(p.name) : p.name }));
}

// ---- unions and discriminated unions — §4.3, §4.7 --------------

export function exclude(T: type, U: type): type {
  return union(arms(T).filter(arm => !Reflect.isAssignable(arm, U)));
}
export function extract(T: type, U: type): type {
  return union(arms(T).filter(arm => Reflect.isAssignable(arm, U)));
}
export function nonNullable(T: type): type {
  return exclude(T, type null | undefined);
}
export function mapUnion(T: type, f): type { return union(arms(T).map(f)); }
export function toArrayEach(T: type): type { return union(arms(T).map(arm => arrayOf(arm))); }
export function toArrayAll(T: type): type  { return arrayOf(T); }
export function discriminants(T: type, tag: string = 'kind') {
  return arms(T).map(arm => {
    const p = reflect(arm).properties.find(p => p.name === tag);
    if (!p) throw new TypeError(\`discriminants: \${String(arm)} lacks a '\${tag}' discriminant\`);
    return literalValues(p.type)[0];
  });
}
export function byKind(T: type, k: string, tag: string = 'kind'): type {
  return extract(T, objectOf([prop(tag, literal(k))]));
}
export function handlers(T: type, R: type, tag: string = 'kind'): type {
  return objectOf(discriminants(T, tag).map(k => prop(k, fn([byKind(T, k, tag)], R))));
}

// ---- functions — §4.0, §4.3 ------------------------------------

export function fn(parameterTypes: [].<type>, returnType: type): type {
  return Reflect.makeType({ kind: 'function', signatures: [{
    parameters: parameterTypes.map((type, index) => ({ type, name: \`p\${index}\`, index, rest: false, initial: undefined, metadata: {} })),
    return: { type: returnType, metadata: {} }
  }] });
}
export function flatten(T: type): type {
  const node = reflect(T);
  return node.kind === 'array' ? node.element : T;
}
export function firstParameter(F: type): type {
  const node = reflect(F);
  if (node.kind !== 'function') return never;
  return union(node.signatures.map(s => s.parameters[0]?.type ?? never));
}
export function returnType(F: type): type {
  const node = reflect(F);
  if (node.kind !== 'function') throw new TypeError(\`returnType: \${String(F)} is not a function type\`);
  const returns = node.signatures.map(s => s.return.type);
  return returns.length === 1 ? returns[0] : union(returns);
}
export function parameters(F: type): type {
  const [signature] = reflect(F).signatures;
  return Reflect.makeType({ kind: 'tuple',
    elements: signature.parameters.map(p => ({ type: p.type, rest: p.rest, initial: p.initial })) });
}

// ---- literals and strings — §4.2, §4.4 -------------------------

const capitalizeFirst = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

export function mapLiterals(T: type, f): type {
  return union(literalValues(T).map(v => literal(f(String(v)))));
}
export function uppercase(T: type): type   { return mapLiterals(T, s => s.toUpperCase()); }
export function lowercase(T: type): type   { return mapLiterals(T, s => s.toLowerCase()); }
export function capitalized(T: type): type { return mapLiterals(T, capitalizeFirst); }
export function uncapitalized(T: type): type {
  return mapLiterals(T, s => s.charAt(0).toLowerCase() + s.slice(1));
}
export function getters(T: type): type {
  return mapProperties(T, p => typeof p.name !== 'string' ? p
    : prop(\`get\${capitalizeFirst(p.name)}\`, fn([], p.type), { readonly: true }));
}
export function listeners(T: type): type {
  return mapProperties(T, p => typeof p.name !== 'string' ? p
    : prop(\`on\${capitalizeFirst(p.name)}Changed\`, fn([p.type], type void)));
}

// ---- tuples and arrays — §4.5 ----------------------------------

export function head(T: type): type {
  // F114: \`elementTypes(T)[0] ?? never\`, as §4.5 writes it, does not work. The
  // \`[].<type>\` return annotation makes the result a CHECKED array, so the
  // guard is statically dead code (refused at check time) and the empty case
  // raises a range error at run time rather than yielding \`undefined\`. A length
  // test is correct under either answer to OQ8.
  const elements = elementTypes(T);
  return elements.length === 0 ? never : elements[0];
}
export function tail(T: type): type    { return tupleOf(elementTypes(T).slice(1)); }
export function concat(A: type, B: type): type { return tupleOf([...elementTypes(A), ...elementTypes(B)]); }
export function reverse(T: type): type { return tupleOf(elementTypes(T).toReversed()); }
export function zip(A: type, B: type): type {
  const a = elementTypes(A), b = elementTypes(B);
  return tupleOf(a.slice(0, Math.min(a.length, b.length)).map((t, i) => tupleOf([t, b[i]])));
}

// ---- recursion and composition — §4.6, §4.9 --------------------

export function deepPartial(T: type): type {
  const node = reflect(T);
  switch (node.kind) {
    case 'object':
      return objectOf(
        node.properties.map(p => ({ ...p, optional: true, type: deepPartial(p.type) })),
        node.indexSignatures.map(s => ({ ...s, value: deepPartial(s.value) })));
    case 'array': return arrayOf(deepPartial(node.element), node.extent);
    case 'tuple': return Reflect.makeType({ ...node, elements: node.elements.map(e => ({ ...e, type: deepPartial(e.type) })) });
    case 'union': return union(node.members.map(deepPartial));
    default:      return T;
  }
}
export function paths(T: type): type {
  const node = reflect(T);
  if (node.kind !== 'object') return never;
  return union(node.properties.flatMap(p => {
    const nested = paths(p.type);
    const suffixes = nested === never ? [] : literalValues(nested);
    return [literal(p.name), ...suffixes.map(rest => literal(\`\${p.name}.\${rest}\`))];
  }));
}
export function compose(...fs) {
  return T => fs.reduceRight((result, f) => f(result), T);
}
export function traverse(T: type, { leaf = t => t, property = p => p, element = e => e } = {}): type {
  const rec = (t: type): type => traverse(t, { leaf, property, element });
  const node = reflect(T);
  switch (node.kind) {
    case 'object': return objectOf(
      node.properties.map(p => property({ ...p, type: rec(p.type) })).filter(p => p !== null),
      node.indexSignatures.map(s => ({ ...s, value: rec(s.value) })));
    case 'tuple': return Reflect.makeType({ ...node, elements: node.elements.map(e => element({ ...e, type: rec(e.type) })) });
    case 'array': return arrayOf(rec(node.element), node.extent);
    case 'union': return union(node.members.map(rec));
    case 'intersection': return intersection(node.members.map(rec));
    default: return leaf(T);
  }
}
export function deepMap(T: type, leaf): type { return traverse(T, { leaf }); }

// ---- keys and indexing, promises, routes, and the maximal set — §4.1, §4.3, §4.4, §6 ----

export function keys(T: type): type {
  // OQ1-C. The function form of \`keyof\`, and literally the operator: not a
  // reimplementation over reflection, which could not agree with it. \`keyof\`
  // reads a class body and a nominal's structure; reflection collapses both to
  // an opaque \`primitive\` leaf, so a version written over \`reflect()\` would
  // give a DIFFERENT answer on a nominal - the one thing annex-standard-kit
  // forbids. Forwarding satisfies the agreement obligation by construction.
  //
  // Named \`keys\`, not \`keysOf\`, which is what three sources advertise. The
  // kit's convention is unambiguous across ten names: an \`Of\` suffix
  // CONSTRUCTS (\`objectOf\`, \`tupleOf\`, \`arrayOf\`) and a bare plural
  // EXTRACTS (\`arms\`, \`parameters\`, \`paths\`, \`discriminants\`, \`getters\`,
  // \`elementTypes\`, \`tupleElements\`). This extracts. \`paths\` is the exact
  // model - a bare plural returning a union of literal types.
  //
  // OQ5-D: keyless is \`never\`, not an error. \`keys(uint8)\` is \`never\`; the
  // refusal lives at the USE, which \`indexed\` below performs.
  return type keyof T;
}
export function indexed(T: type, K: type): type {
  // F105: §4.1's \`js\` block is missing from the design document. This
  // reproduces #sec-indexed-access-types / IndexedAccessTypeRecord: distribute
  // over T's arms and K's keys; an optional property's read admits \`undefined\`.
  return union(arms(T).flatMap(arm => literalValues(K).map(key => {
    const t = propertyType(arm, key);
    if (t === undefined) throw new TypeError(\`indexed: \${String(arm)} has no property '\${String(key)}'\`);
    const p = reflect(arm).properties.find(p => p.name === key);
    return p.optional ? union([t, type undefined]) : t;
  })));
}
export function awaited(T: type): type {
  const node = reflect(T);
  if (node.kind === 'union') return union(node.members.map(awaited));
  if (node.kind === 'primitive' && node.generic?.base === type Promise)   // F116: §4.3 writes bare \`Promise\`, which is the CONSTRUCTOR, not the type
    return awaited(node.generic.arguments[0]);
  const then = node.kind === 'object' && node.properties.find(p => p.name === 'then');
  if (then) {
    const onfulfilled = reflect(then.type).signatures[0]?.parameters[0];
    return onfulfilled ? awaited(firstParameter(onfulfilled.type)) : never;
  }
  return T;
}
export function routeParams(path: string): type {
  return objectOf(path.split('/')
    .filter(segment => segment.startsWith(':'))
    .map(segment => prop(segment.slice(1), string)));
}
export function noInfer(T: type): type { return T; }
export function withThisType(F: type, Self: type): type {
  const node = reflect(F);
  return Reflect.makeType({ ...node, signatures: node.signatures.map(s => ({ ...s, this: Self })) });
}
export function thisParameterType(F: type): type {
  // F117: the \`this\` slot holds a reflection NODE, where every other
  // type-valued slot on a signature holds a Type Object. \`makeType\` normalises
  // it. §6.3 writes \`?? any\` against the Type Object the model promises.
  const thisNode = reflect(F).signatures[0].this;
  return thisNode === undefined ? any : Reflect.makeType(thisNode);
}
export function omitThisParameter(F: type): type {
  const node = reflect(F);
  return Reflect.makeType({ ...node, signatures: node.signatures.map(({ this: _t, ...s }) => s) });
}
export function options(Data: type, Methods: type): type {
  const self = Reflect.makeType({ kind: 'intersection', members: [Data, Methods] });
  return objectOf([
    prop('data', fn([], Data)),
    ...reflect(Methods).properties.map(p => prop(p.name, withThisType(p.type, self))),
  ]);
}
export function brand(T: type, tag: string | symbol): type {
  return Reflect.makeType({ kind: 'parameterized', base: T, metadata: { brand: tag } });
}
// NOT EXPORTED - OQ8-C. Written and kept so the decision is reversible in one
// word, but withheld while the \`pattern\` claim is provisional. \`StringPattern\`
// is a hardcoded intrinsic claiming a good name out of a flat, first-come
// namespace, and its \`subtype\` judgment is at the floor of reflexivity and not
// consulted anywhere yet - so the reservation currently buys nothing over
// interning. Export both when §6.4's exact automaton subtyping lands, or sooner
// if a scoping design for claims arrives.
function suffixed(suffix: string): type {
  return Reflect.makeType({ kind: 'parameterized', base: string,
    metadata: { pattern: new RegExp(\`^.*\${RegExp.escape(suffix)}$\`) } });
}

export function constructorParameters(C: type): type {
  const { signatures } = Reflect.getReflection.<Reflect.ClassMethod, C>('constructor');
  // F118: a ZERO-PARAMETER constructor reflects with no \`signatures\` at all,
  // where a one-parameter constructor reflects one. Named rather than papered
  // over, so the diagnostic points at the engine gap instead of at the caller.
  if (signatures === undefined) throw new TypeError(\`constructorParameters: \${String(C)} reflects no constructor signatures (F118)\`);
  return Reflect.makeType({ kind: 'tuple',
    elements: signatures[0].parameters.map(p => ({ type: p.type, rest: p.rest, initial: p.initial })) });
}
// RETIRED - OQ10-C. For a class it is the IDENTITY: §4.3 says "a class's type
// object is the class and the class name is its instance type - there is no
// \`typeof C\` constructor-type / instance-type split", and §4.11's coverage
// table says "a class is its own". For a function type it is \`returnType\`
// under a second name. Shipping it would advertise a split this proposal
// deliberately does not have, which is the reasoning §4.12 used to decline
// \`isEqual\`. Use \`returnType\` for the factory case.

// NOT EXPORTED - OQ8-C, see \`suffixed\` above.
function stringPattern(pattern, ...holes) {
  // §6.4. Callable with a RegExp, or as a template tag where each hole
  // contributes the sub-pattern its type matches. BLOCKED on F110 in the same
  // way \`brand\` and \`suffixed\` are: it builds a \`parameterized\` node.
  const holePattern = (t: type): string => {
    const node = reflect(t);
    if (node.kind === 'literal') return RegExp.escape(String(node.value));
    if (node.kind === 'union') return \`(?:\${node.members.map(holePattern).join('|')})\`;
    return t === string ? '[\\\\s\\\\S]*' : '-?\\\\d+(?:\\\\.\\\\d+)?';
  };
  const source = pattern instanceof RegExp ? pattern.source
    : pattern.map((chunk, i) => RegExp.escape(chunk) + (i < holes.length ? holePattern(holes[i]) : '')).join('');
  return Reflect.makeType({ kind: 'parameterized', base: string,
    metadata: { pattern: pattern instanceof RegExp ? pattern : new RegExp(\`^\${source}$\`) } });
}
`;

/** The compiled kit, per realm. Evaluation is memoized by the module cache; this
 * memoizes the PARSE, which is otherwise repeated for every realm that imports
 * the kit and is the only cost the kit adds that a user module would not. */
const compiled = new WeakMap<Realm, ReturnType<ManagedRealm['compileModule']>>();

/**
 * Resolve `std:types` if this request is for it, and answer whether it was.
 *
 * PLAN-std-types.md OQ3-B: a dedicated resolver ahead of the host, NOT a
 * widening of `createBuiltinModuleLoader`'s `isBuiltinModule` predicate. Three
 * reasons, in the plan's order. The predicate is
 * `!/^(\.|\/|#|\w+:)/.test(specifier)`, so `std:types` matches `\w+:` and is
 * DECLINED by default - admitting it means widening a shared predicate for one
 * specifier, and `preprocessor:` and `node:` shapes already ride on it. The
 * predicate has no access to the agent, so it cannot honour the feature gate,
 * and `std:types` must not resolve when `runtime-types` is off. And eight call
 * sites wire loaders today (five engine tests, `lib-src/node/example.mts`, and
 * the devtools worker and example validator); seeding each is eight chances to
 * forget a STANDARD module. Resolving here means an embedder gets the kit
 * without configuring anything, which is the arrangement Rust's implicit
 * `extern crate std` describes and the one the annex assumes when it says the
 * ecosystem shares one interned vocabulary.
 */
export function LoadStandardKitModule(
  referrer: CyclicModuleRecord | ScriptRecord | Realm,
  moduleRequest: ModuleRequestRecord,
  payload: HostLoadImportedModulePayloadOpaque,
): boolean {
  if (moduleRequest.Specifier !== STD_TYPES_SPECIFIER) {
    return false;
  }
  if (!surroundingAgent.feature('runtime-types')) {
    // Not ours to serve with the feature off: the kit is written in syntax that
    // does not parse, and claiming the specifier would turn a missing feature
    // into a parse error naming the kit rather than the program.
    return false;
  }
  const realm = ('Realm' in referrer ? referrer.Realm : referrer) as ManagedRealm;
  let module = compiled.get(realm);
  if (module === undefined) {
    module = realm.compileModule(STD_TYPES_SOURCE, { specifier: STD_TYPES_SPECIFIER });
    compiled.set(realm, module);
  }
  FinishLoadingImportedModule(referrer, moduleRequest, payload, module);
  return true;
}
