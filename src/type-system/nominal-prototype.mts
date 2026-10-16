import { ObjectValue, NullValue, Value } from '../value.mts';
import type { ThrowCompletion } from '../completion.mts';
import type { TypeRecord } from './records.mts';
import { Throw } from '#self';

type Obligation = { owner: WeakRef<ObjectValue>, target: WeakRef<ObjectValue>, links: WeakRef<ObjectValue>[] };
type Change = { obligation: Obligation, links: ObjectValue[] };
const acquired = new WeakMap<ObjectValue, Map<ObjectValue, Obligation>>();
const dependents = new WeakMap<ObjectValue, Set<Obligation>>();

function detach(obligation: Obligation): void {
  for (const link of obligation.links) {
    const object = link.deref();
    if (object) dependents.get(object)?.delete(obligation);
  }
  obligation.links = [];
}

// Neither a live prototype nor this finalizer may retain an admitted instance,
// including through a target prototype property that points back to it.
const finalized = new FinalizationRegistry<Obligation>(detach);

function attach(obligation: Obligation, links: readonly ObjectValue[]): void {
  detach(obligation);
  for (const object of links) {
    let entries = dependents.get(object);
    if (!entries) dependents.set(object, entries = new Set());
    entries.add(obligation);
    obligation.links.push(new WeakRef(object));
  }
}

/** A path contains exactly the objects whose outgoing prototype links are
 * consulted before reaching target. The target's own prototype is irrelevant.
 * undefined means observable/exotic evidence, null an ordinary nonmember. */
function pathTo(owner: ObjectValue, target: ObjectValue, changed?: ObjectValue,
  replacement?: ObjectValue | NullValue): ObjectValue[] | null | undefined {
  const path: ObjectValue[] = [];
  const seen = new Set<ObjectValue>();
  let object: ObjectValue | NullValue = owner;
  while (object instanceof ObjectValue) {
    if (seen.has(object)) return null;
    seen.add(object);
    if (object.GetPrototypeOf !== ObjectValue.prototype.GetPrototypeOf || !('Prototype' in object)) return undefined;
    path.push(object);
    const next: ObjectValue | NullValue = object === changed ? replacement! : object.Prototype as ObjectValue | NullValue;
    if (next === target) return path;
    object = next;
  }
  return null;
}

/** Only resolved, non-generic source classes with a permanent own prototype
 * identity enter this specialization. This is not a new nominal brand. */
export function AcquireNominalPrototype(value: Value, type: TypeRecord): ThrowCompletion | undefined {
  if (type.Kind !== 'nominal' || type.Arguments.length) return undefined;
  const declaration = (type.Declaration as { type?: string } | undefined)?.type;
  if (declaration !== 'ClassDeclaration' && declaration !== 'ClassExpression') return undefined;
  const constructor = type.Constructor;
  if (!(constructor instanceof ObjectValue) || constructor.GetOwnProperty !== ObjectValue.prototype.GetOwnProperty) return undefined;
  const prototype = constructor.properties.get(Value('prototype'));
  if (!(prototype?.Value instanceof ObjectValue) || prototype.Writable !== Value.false || prototype.Configurable !== Value.false) return undefined;
  if (!(value instanceof ObjectValue)) return Throw.TypeError('a class boundary returned a non-Object value');
  const target = prototype.Value;
  const links = pathTo(value, target);
  if (links === undefined) return undefined;
  if (links === null) return Throw.TypeError('a class boundary returned a value outside its nominal prototype contract');
  let contracts = acquired.get(value);
  if (!contracts) acquired.set(value, contracts = new Map());
  let obligation = contracts.get(target);
  if (!obligation) {
    obligation = { owner: new WeakRef(value), target: new WeakRef(target), links: [] };
    contracts.set(target, obligation);
    finalized.register(value, obligation);
  }
  attach(obligation, links);
  return undefined;
}

/** Plan without invoking GetPrototypeOf, publishing a link, or changing any
 * live dependency. All acquired exact class obligations remain conjunctive. */
export function PlanNominalPrototypeChange(object: ObjectValue, replacement: ObjectValue | NullValue): Change[] | false {
  const changes: Change[] = [];
  for (const obligation of dependents.get(object) ?? []) {
    const owner = obligation.owner.deref();
    if (!owner) {
      detach(obligation);
      continue;
    }
    const target = obligation.target.deref();
    if (!target) return false;
    const links = pathTo(owner, target, object, replacement);
    if (!links) return false;
    changes.push({ obligation, links });
  }
  return changes;
}

/** Called immediately after the ordinary link publication, with no user code
 * between planning and commit. Old links cease to constrain later mutations. */
export function CommitNominalPrototypeChange(changes: readonly Change[]): void {
  for (const { obligation, links } of changes) attach(obligation, links);
}
