import { isArray, OutOfRange } from '../utils/language.mts';
import { R } from '../abstract-ops/all.mjs';
import { isBooleanObject } from '../intrinsics/Boolean.mts';
import { isRangeObject } from '../intrinsics/Range.mts';
import { isNumberObject } from '../intrinsics/Number.mts';
import { isBigIntObject } from '../intrinsics/BigInt.mts';
import { isStringObject } from '../intrinsics/String.mts';
import { isSymbolObject } from '../intrinsics/Symbol.mts';
import {
  BigIntValue,
  BooleanValue,
  Construct, CreateArrayFromList, EscapeRegExpPattern, isArrayBufferObject, isArrayExoticObject, isDateObject, isErrorObject, isFunctionObject, isModuleNamespaceObject, isPromiseObject, isRegExpObject, isTypedArrayObject, JSStringValue, NullValue, NumberValue, ObjectValue, PrivateName, surroundingAgent, SymbolValue, ThrowCompletion, UndefinedValue, Value, X,
  type Intrinsics, type ErrorObject,
  TypedNumberValue,
  VectorValue,
  ReferenceValue,
} from '#self';

/** https://tc39.es/ecma262/#sec-throw-an-exception */
export function Throw(_: never): never
/** @internal */
export function Throw(_: Value): never
export function Throw(_: Value): never {
  throw new Error('Throw requires build.');
}

function ThrowFactory(intrinsicName: keyof Intrinsics & `%${string}Error%`): Throw {
  return (message: string, ...args: readonly Formattable[]) => {
    message.matchAll(/(\$(\d+))/g);
    let lastIndex = 0;
    let formattedMessage = '';
    const unformattedMessage: (string | Value)[] = [];
    for (const match of message.matchAll(/(\$(\d+))/g)) {
      const index = Number(match[2]) - 1;
      if (index < 0) {
        throw new RangeError('We count from $1 ha ha');
      }
      if (index < 0 || index >= args.length) {
        throw new RangeError('Insufficient arguments for format string');
      }
      const arg = args[index];
      if (arg === undefined) {
        throw new RangeError(`Argument for ${match[0]} is undefined in message '${message}'`);
      }
      formattedMessage += message.slice(lastIndex, match.index) + format(arg);
      unformattedMessage.push(message.slice(lastIndex, match.index), toDisplayableValue(arg));
      lastIndex = match.index + match[0].length;
    }
    formattedMessage += message.slice(lastIndex);
    unformattedMessage.push(message.slice(lastIndex));
    if (unformattedMessage[0] === '') unformattedMessage.shift();
    if (unformattedMessage.at(-1) === '') unformattedMessage.pop();

    let E: ErrorObject;
    if (intrinsicName === '%AggregateError%') {
      E = X(Construct(surroundingAgent.intrinsic(intrinsicName), [X(CreateArrayFromList([])), Value(formattedMessage)])) as ErrorObject;
    } else {
      E = X(Construct(surroundingAgent.intrinsic(intrinsicName), [Value(formattedMessage)])) as ErrorObject;
    }
    if (unformattedMessage.some((part) => typeof part !== 'string')) {
      E.HostDefinedMessage = unformattedMessage;
    }
    return ThrowCompletion(E);
  };
}
Throw.EvalError = ThrowFactory('%EvalError%');
Throw.RangeError = ThrowFactory('%RangeError%');
Throw.ReferenceError = ThrowFactory('%ReferenceError%');
Throw.SyntaxError = ThrowFactory('%SyntaxError%');
Throw.TypeError = ThrowFactory('%TypeError%');
Throw.URIError = ThrowFactory('%URIError%');
Throw.Error = ThrowFactory('%Error%');
Throw.AggregateError = ThrowFactory('%AggregateError%');

export type Formattable = string | number | bigint | Value | PrivateName | readonly Formattable[];

export function format(arg: Formattable): string {
  switch (true) {
    case typeof arg !== 'object':
      return String(arg);
    case arg instanceof PrivateName:
      return `#${arg.Description instanceof UndefinedValue ? '' : arg.Description.stringValue()}`;
    case arg instanceof JSStringValue:
      return JSON.stringify(arg.stringValue());
    case arg instanceof NumberValue: {
      const n = R(arg);
      if (n === 0 && Object.is(n, -0)) {
        return '-0';
      }
      return n.toString();
    }
    // proposal-runtime-types R6: a typed number displays its value with a typed
    // marker in error messages, matching the inspector.
    // proposal-runtime-types #sec-vector-types: a vector in a diagnostic prints
    // as its lanes. Without this the formatter fell through to its exhaustive
    // throw, so a REFUSAL involving a vector - which is a message the design
    // needs often - crashed the host instead of reporting.
    case arg instanceof VectorValue:
      return `(${(arg as VectorValue).lanes.map((lane: unknown) => format(lane as never)).join(', ')})`;
    case arg instanceof TypedNumberValue:
      // Read as carried, so a diagnostic about a wide value names the value the
      // program wrote rather than the nearest double to it.
      return `${(arg as TypedNumberValue).value} (typed)`;
    case arg instanceof BigIntValue:
      return `${String(R(arg))}n`;
    case arg instanceof SymbolValue:
      return `Symbol(${arg.Description instanceof UndefinedValue ? '' : arg.Description.stringValue()})`;
    case arg instanceof NullValue:
      return 'null';
    case arg instanceof UndefinedValue:
      return 'undefined';
    case arg instanceof BooleanValue:
      return String(arg.booleanValue());
    case arg instanceof ObjectValue: {
      if (isPromiseObject(arg)) {
        return '[object Promise]';
      }
      if (isModuleNamespaceObject(arg)) {
        return '[object Module]';
      }
      if (isFunctionObject(arg)) {
        const name = arg.properties.get('name');
        if (name && name.Value instanceof JSStringValue && name.Value.stringValue() !== '') {
          return `[Function ${name.Value.stringValue()}]`;
        }
        return '[Function]';
      }
      if (isErrorObject(arg)) {
        return '[object Error]';
      }
      if (isRegExpObject(arg)) {
        const P = EscapeRegExpPattern(arg.OriginalSource, arg.OriginalFlags).stringValue();
        const F = arg.OriginalFlags.stringValue();
        return `/${P}/${F}`;
      }
      if (isDateObject(arg)) {
        const d = new Date(arg.DateValue);
        if (Number.isNaN(d.getTime())) {
          return '[Date Invalid]';
        }
        return `[Date ${d.toISOString()}]`;
      }
      if (isBooleanObject(arg)) {
        return `[Boolean ${format(arg.BooleanData)}]`;
      }
      if (isNumberObject(arg)) {
        return `[Number ${format(arg.NumberData)}]`;
      }
      if (isBigIntObject(arg)) {
        return `[BigInt ${format(arg.BigIntData)}]`;
      }
      if (isStringObject(arg)) {
        return `[String ${format(arg.StringData)}]`;
      }
      if (isSymbolObject(arg)) {
        return `[Symbol ${format(arg.SymbolData)}]`;
      }
      if (isArrayExoticObject(arg)) {
        return '[object Array]';
      }
      if (isTypedArrayObject(arg)) {
        return `[object ${arg.TypedArrayName}]`;
      }
      if (isArrayBufferObject(arg)) {
        return '[object ArrayBuffer]';
      }
      // proposal-runtime-types (ranges.md): a range prints as it was WRITTEN.
      // Every diagnostic that names a range value named it "[object Object]",
      // which tells a reader nothing about the one thing that went wrong - the
      // endpoints and their bounds are the whole content of the value.
      if (isRangeObject(arg)) {
        const start = arg.RangeStart === undefined ? '' : format(arg.RangeStart);
        const end = arg.RangeEnd === undefined ? '' : format(arg.RangeEnd);
        const open = arg.RangeStartBound === 'open' ? '<..' : '..';
        const close = arg.RangeEndBound === undefined ? '' : (arg.RangeEndBound === 'open' ? '<' : '=');
        return `${start}${open}${close}${end}`;
      }
      return '[object Object]';
    }
    case isArray(arg):
      return `[${arg.map(format).join(', ')}]`;
    case arg instanceof ReferenceValue:
      return '[reference]';
    default:
      throw OutOfRange.exhaustive(arg);
  }
}

function toDisplayableValue(arg: Formattable): Value | string {
  switch (true) {
    case typeof arg === 'string':
      return arg;
    case typeof arg === 'string' || typeof arg === 'number' || typeof arg === 'bigint':
      return Value(arg);
    case arg instanceof Value:
      return arg;
    case arg instanceof PrivateName:
      return Value(`#${arg.Description.stringValue()}`);
    case isArray(arg):
      return CreateArrayFromList(arg.map((value) => {
        const v = toDisplayableValue(value);
        return v instanceof Value ? v : Value(v);
      }));
    default:
      throw OutOfRange.exhaustive(arg);
  }
}

export interface Throw {
  // auto-generate start
  (m:
'"arguments" cannot be used as an identifier in class static block'
  | '"day" is required'
  | '"month-code" or "month" is required'
  | '"year" is required'
  | "'getPrototypeOf' on proxy: proxy target is non-extensible but the trap did not return its actual prototype"
  | "'getPrototypeOf' on proxy: trap returned neither object nor null"
  | "'ownKeys' on proxy: trap result returned extra keys but proxy target is non-extensible"
  | "'ownKeys' on proxy: trap returned duplicate entries"
  | "'preventExtensions' on proxy: trap returned truthy but the proxy target is extensible"
  | "'setPrototypeOf' on proxy: trap returned truthy for setting a new prototype on the non-extensible proxy target"
  | 'A `default` clause must be last'
  | 'A class cannot be both sealed and dynamic'
  | 'A class cannot have static and instance private methods with the same name'
  | 'A class element cannot be named as "constructor"'
  | 'A class element cannot be named as "prototype" or "constructor"'
  | 'A class static block takes no decorator'
  | 'A class static field cannot be named as "constructor"'
  | 'A partial class requires a name'
  | 'A ref binding is not allowed in a for await loop'
  | 'A ref binding may not appear in a for statement initializer'
  | 'A ref binding requires a for-of loop'
  | 'A ref binding takes a type annotation, not a typed initializer'
  | 'A ref member may not be optional'
  | 'A ref member may not have a default value'
  | 'A ref parameter may not be optional'
  | 'A ref parameter may not have a default value'
  | 'A ref parameter must be a single name'
  | 'A typed destructuring member must bind a single name'
  | 'AbstractModuleSource cannot be constructed'
  | 'An abstract method requires an abstract class'
  | 'Array length must be uint32.'
  | 'Array length too big.'
  | 'ArrayBuffer cannot be invoked without new'
  | 'Attempt to access detached ArrayBuffer'
  | 'Attempt to access shared ArrayBuffer'
  | 'BigInt has no unsigned right shift, use >> instead'
  | 'BigInt is not a constructor'
  | 'BigInt literal cannot have leading zero'
  | 'Calendar annotation is not allowed when day is absent'
  | 'Calendar annotation is not allowed when year is absent'
  | 'Calendars are not equal'
  | 'Cannot JSON stringify a circular structure'
  | 'Cannot add a date to an instant'
  | 'Cannot allocate memory'
  | 'Cannot call addInitializer after decoration is finished'
  | 'Cannot convert object to primitive value'
  | 'Cannot define private element to a non-extensible object'
  | 'Cannot delete a super property'
  | 'Cannot delete an identifier in strict mode'
  | 'Cannot delete private names'
  | 'Cannot divide by zero'
  | 'Cannot make length of array-like object surpass the bounds of an integer index'
  | 'Cannot mix BigInt and other types, use explicit conversions'
  | 'Cannot mix logical operator with ?? operator. Add parentheses to determine precedence.'
  | 'Cannot reduce an empty array with no initial value'
  | 'Cannot resize ArrayBuffer to bigger than maxByteLength'
  | 'Cannot serialize a BigInt to JSON'
  | 'Cannot transfer ArrayBuffer with custom detach key'
  | 'Class missing binding identifier'
  | 'Class modifier already seen'
  | 'Could not set prototype of object'
  | 'Critical calendar annotation failed.'
  | 'DataView cannot be invoked without new'
  | 'DateTime outside of range'
  | 'Decorators can only be used to decorate classes'
  | 'Decorators cannot appear on both sides of the export keyword'
  | 'Default export already declared'
  | 'Derived TypedArray constructor created an array which was too small'
  | 'Duplicate __proto__ property'
  | 'Duplicate constructor'
  | 'Duplicate meta declaration'
  | 'Exponent of bigint must be positive'
  | 'FinalizationRegistry cannot be invoked without new'
  | 'Host does not set a module loader'
  | 'ISODate is out of range'
  | 'Identifier has already been declared'
  | 'Illegal octal escape'
  | 'Import name cannot be "eval" or "arguments"'
  | 'Import name cannot be a keyword'
  | 'Import name cannot be a string'
  | 'Invalid Unicode escape'
  | 'Invalid alphabet'
  | 'Invalid assignment in rest element'
  | 'Invalid assignment target'
  | 'Invalid base64 string'
  | 'Invalid call to ArrayBuffer.prototype.detached on shared ArrayBuffer'
  | 'Invalid call to ArrayBuffer.prototype.maxByteLength on shared ArrayBuffer'
  | 'Invalid call to ArrayBuffer.prototype.resizable on shared ArrayBuffer'
  | 'Invalid call to ArrayBuffer.prototype.resize on detached ArrayBuffer'
  | 'Invalid call to ArrayBuffer.prototype.resize on shared ArrayBuffer'
  | 'Invalid class range'
  | 'Invalid code point'
  | 'Invalid date'
  | 'Invalid decimal digits'
  | 'Invalid duration'
  | 'Invalid empty identifier'
  | 'Invalid hex digit'
  | 'Invalid hex string'
  | 'Invalid identifier escape'
  | 'Invalid identity escape'
  | 'Invalid lastChunkHandling'
  | 'Invalid leap month'
  | 'Invalid left-hand side in for-in/of statement'
  | 'Invalid length'
  | 'Invalid meta hook name'
  | 'Invalid month'
  | 'Invalid normalization form'
  | 'Invalid receiver'
  | 'Invalid surrogate pair'
  | 'Invalid template escape'
  | 'Invalid time'
  | 'Invalid trailing surrogate'
  | 'Invalid unicode escape'
  | 'Invalid unicode property'
  | 'Invalid unicode property name'
  | 'Invalid unicode property name or value'
  | 'Invalid unicode property value'
  | 'Invalid use of arguments'
  | 'Invalid use of super'
  | 'Iterator cannot be invoked without new'
  | 'Iterator is an abstract class'
  | 'Iterator length is bigger than MAX_SAFE_INTEGER'
  | 'Iterator.zip mode must be one of "shortest", "longest", or "strict"'
  | 'Iterator.zip strict mode requires all iterators to end together'
  | 'Iterator.zipKeyed mode must be one of "shortest", "longest", or "strict"'
  | 'Legacy octal literal in strict mode'
  | 'Let in lexical binding'
  | 'Map cannot be invoked without new'
  | 'Meta hook signature does not match the table'
  | 'Mismatching month and month code'
  | 'Missing catch or finally clause in try statement'
  | 'Missing initializer in const declaration'
  | 'Missing initializer in ref declaration'
  | 'Module export name contains invalid Unicode'
  | 'Module source is not available'
  | 'Multiple possible epoch nanoseconds'
  | 'Newline after throw statement'
  | "Newly created TypedArray did not match exemplar's content type"
  | 'No matching offset found for the given date and time'
  | 'No possible epoch nanoseconds'
  | 'No promises passed to Promise.any were fulfilled'
  | 'Non-simple parameter cannot be used with "use strict" directive'
  | 'Not a Uint8Array'
  | 'Not a hex digit'
  | 'Numbers out of order in quantifier'
  | 'Object prototype must be an Object or null'
  | 'Object prototype must be an object or null'
  | 'Offset is out of bound'
  | 'Offset is outside the bounds of the DataView'
  | 'Options parameter is required'
  | 'PlainDateTime outside of range'
  | 'PlainMonthDay out of range'
  | 'PlainYearMonth calendars do not match'
  | 'PlainYearMonth out of range'
  | 'PlusModifiers and MinusModifiers cannot be both empty.'
  | 'Promise cannot be invoked without new'
  | 'Promise reject function already set'
  | 'Promise resolve function already set'
  | 'Proxy cannot be invoked without new'
  | 'Radix must be between 2 and 36, inclusive'
  | 'RegExp flags "v" and "u" cannot be used together'
  | 'Repeated modifiers in modifier group'
  | 'Rest element must be last element'
  | 'Resulting ISODate is out of range'
  | 'Resulting date-time is out of range'
  | 'Separator is not allowed after leading zero'
  | 'Set cannot be invoked without new'
  | 'ShadowRealm cannot be invoked without new'
  | 'SoA.from needs an array with a declared element type'
  | 'Spread element must be last element'
  | 'String is too long'
  | 'Sum of start offset and byte length should be less than the size of the TypedArray'
  | 'Sum of start offset and byte length should be less than the size of underlying buffer'
  | "Super class's prototype must be an object or null"
  | 'Symbol is not a constructor'
  | 'Template in optional chain'
  | 'Temporal.Duration cannot be converted to primitive value. If you are comparing two Temporal.Duration objects with > or <, use Temporal.Duration.compare() instead.'
  | 'Temporal.Duration constructor cannot be called without new'
  | 'Temporal.Instant cannot be called without new'
  | 'Temporal.Instant cannot be converted to primitive value If you are comparing two Temporal.Duration objects with > or <, use Temporal.Instant.compare() instead.'
  | 'Temporal.PlainDate cannot be converted to primitive value. If you are comparing two Temporal.PlainDate objects with > or <, use Temporal.PlainDate.compare() instead.'
  | 'Temporal.PlainDate constructor cannot be called without new'
  | 'Temporal.PlainDateTime cannot be called without new'
  | 'Temporal.PlainDateTime cannot be converted to primitive value. If you are comparing two Temporal.PlainDateTime objects with > or <, use Temporal.PlainDateTime.compare() instead.'
  | 'Temporal.PlainMonthDay cannot be called without new'
  | 'Temporal.PlainMonthDay cannot be converted to primitive value. If you are comparing two Temporal.PlainMonthDay objects with > or <, use Temporal.PlainMonthDay.compare() instead.'
  | 'Temporal.PlainTime cannot be called without new'
  | 'Temporal.PlainTime cannot be converted to primitive value. If you are comparing two Temporal.PlainTime objects with > or <, use Temporal.PlainTime.compare() instead.'
  | 'Temporal.PlainYearMonth cannot be called without new'
  | 'Temporal.PlainYearMonth cannot be converted to primitive value. If you are comparing two Temporal.PlainYearMonth objects with > or <, use Temporal.PlainYearMonth.compare() instead.'
  | 'Temporal.ZonedDateTime cannot be called without new'
  | 'Temporal.ZonedDateTime cannot be converted to primitive value. If you are comparing two Temporal.ZonedDateTime objects with > or <, use Temporal.ZonedDateTime.compare() instead.'
  | 'The caller, callee, and arguments properties may not be accessed on functions or the arguments objects for calls to them'
  | 'The iterator is already complete.'
  | 'This class cannot be inverted'
  | 'Time zones are not equal'
  | 'Too many capturing groups'
  | 'TypedArray index out of bounds'
  | 'TypedArray out of bounds'
  | 'URI malformed'
  | 'Unexpected - in modifiers'
  | 'Unexpected end of CharacterClass'
  | 'Unexpected end of input'
  | 'Unexpected escape'
  | 'Unexpected token'
  | 'Unexpected token in JSON'
  | 'Unexpected token let'
  | 'Unterminated comment'
  | 'Unterminated range'
  | 'Unterminated regular expression'
  | 'Unterminated string literal'
  | 'Unterminated template literal'
  | 'WeakMap cannot be invoked without new'
  | 'WeakRef cannot be invoked without new'
  | 'WeakSet cannot be invoked without new'
  | 'a column of this type cannot be read'
  | 'a column of this type cannot be written'
  | 'a computed member name must be a literal or a `const` bound to a Symbol'
  | 'a decimal operand requires a decimal on both sides'
  | 'a decorator in a match arm must be followed by a block'
  | 'a field of this type cannot be placed in a buffer'
  | 'a fixed-extent SoA cannot be grown'
  | 'a fixed-extent SoA cannot be shortened'
  | 'a fixed-extent array cannot be grown'
  | 'a meta type whose constraint shape is an object type requires an object default'
  | 'a pipeline step must use the topic'
  | 'a placement allocation needs a type with a layout'
  | 'a range endpoint must be ordered, and NaN is not'
  | 'a range endpoint must be ordered: a number, a bigint, or a type declaring operator<'
  | 'a range index needs the view substrate, which is not implemented'
  | 'a range is not an ordered value and cannot be compared'
  | 'a range over an integer type needs integer endpoints'
  | 'a range scale factor must be a number'
  | 'a range step must be a nonzero number'
  | 'a range step must be a number'
  | 'a range with a non-integer endpoint has no implicit step; use step(by)'
  | 'a range with a non-integer endpoint has no length'
  | 'a range with a non-integer or missing endpoint has no implicit step; use step(by)'
  | 'a range with no end cannot be consumed entirely; bound it with take(n)'
  | 'a range with no end cannot be reversed'
  | 'a range with no start cannot be iterated'
  | 'a range without both endpoints has no length'
  | 'a rational cannot have a zero denominator'
  | 'a rational denominator must be an integer'
  | 'a rational exponent must be an integer'
  | 'a rational numerator must be an integer'
  | 'a ref for-of loop requires an array or an SoA whose elements can be referenced'
  | 'a token stream is produced by the engine, not constructed'
  | 'a typed own property cannot be added to an instance of a non-dynamic typed class'
  | 'a using declaration requires an object with a Symbol.dispose method'
  | 'a var declaration may not appear in a do expression in a parameter'
  | 'a view element cannot have a zero byte length'
  | 'a view needs an ArrayBuffer, a SharedArrayBuffer, or a typed array'
  | 'a view needs an element type with a layout'
  | 'a zero rational to a negative power'
  | 'an SoA may not be resized while a reference into it is live'
  | 'an SoA view needs a byte offset that is a multiple of its alignment'
  | 'an SoA view needs an ArrayBuffer, a SharedArrayBuffer, or a typed array'
  | 'an accessor may not declare type parameters; use a method'
  | 'an array may not be resized while a reference into it is live'
  | 'an element of this type cannot be viewed in a buffer'
  | 'an index accessor that returns a ref needs no set operator[], and declaring both gives the write two meanings'
  | 'an unlabelled break or continue may not appear in a do expression in a loop head'
  | 'an untyped catch clause must be last'
  | 'argument[0] must be a string'
  | 'argument[0] must be an ArrayBuffer'
  | 'arguments cannot be referenced in a class field initializer'
  | 'await cannot be used as an identifier inside async functions'
  | 'await cannot be used as an identifier inside async functions or modules'
  | 'await cannot be used as an identifier inside parameters of async functions'
  | 'await cannot be used in class static block'
  | 'await cannot be used in formal parameters'
  | 'await cannot be used inside parameters of arrow functions'
  | 'calendar is not a string'
  | 'cannot take a ref of a private member or a super property'
  | 'cannot take a ref of a property of a primitive'
  | 'cannot take a ref of a value; a ref needs a variable, a property, or an array element'
  | 'capacity is available on an array with an element type'
  | 'decimal arithmetic is not yet defined; use toString to read the value'
  | 'direction option is required'
  | 'directionParam is required'
  | 'division of a decimal by zero'
  | 'division of a rational by zero'
  | 'expansion exceeded the limit'
  | 'interval arithmetic needs two ranges'
  | 'largestUnit must be larger than smallestUnit'
  | 'no assignment of the arguments satisfies the parameter list'
  | 'object.constructor[Symbol.species] is not a constructor'
  | 'only a fixed-extent SoA can view a buffer'
  | 'relativeTo is required for calendar units'
  | 'relativeTo option is required when comparing durations with calendar units'
  | 'remainder of a decimal by zero'
  | 'reserve is available on an array with an element type'
  | 'roundTo is required'
  | 'roundingIncrement must be 1 when rounding a date unit to a larger unit'
  | 'size property must be a positive integer'
  | 'size property must not be undefined, as it will be NaN'
  | 'smallestUnit and largestUnit cannot both be omitted'
  | 'smallestUnit cannot be auto'
  | 'smallestUnit cannot be hour'
  | 'smallestUnit cannot be hour or minute'
  | 'the buffer does not hold this SoA view'
  | 'the call is ambiguous between two declared signatures'
  | 'the comparison is ambiguous among its result forms; write the result type'
  | 'the default of a meta type must be a value of its constraint shape'
  | 'the first placement argument must be an ArrayBuffer'
  | 'the placement extent exceeds the buffer'
  | 'the range is empty'
  | 'the reciprocal of zero is undefined'
  | 'the topic is a value, not a reference'
  | 'the topic is not bound here'
  | 'the type in a property descriptor must be a type'
  | 'the view extent exceeds the buffer'
  | 'this SoA view is over a buffer that no longer covers it'
  | 'this call did not return a ref, so there is no location to assign to'
  | 'this call did not return a ref, so there is no location to borrow'
  | 'this call did not return a ref, so there is no location to update'
  | 'this column projection is into an SoA that has since grown'
  | 'this element type cannot be stored as columns'
  | 'this element type has no constructor'
  | 'this has already been initialized'
  | 'this has not been initialized'
  | 'this index accessor has no set operator[], so the write would not be read back'
  | 'this instance is placed on a buffer that no longer covers it'
  | 'this instance is placed on a detached buffer'
  | 'this operator is not defined for a binary floating-point type'
  | 'this operator is not defined for a decimal'
  | 'this operator is not defined for a rational'
  | 'this reference is into an SoA element that has since been removed'
  | 'this reference is into an SoA that has since grown'
  | 'this reference is into an array that has since grown'
  | 'this view is over a buffer that no longer covers it'
  | 'this view is over a detached buffer'
  | 'timeZone is not a string'
  | 'totalOf is required'
  | 'u and v cannot be used together'
  | 'unit cannot be auto'
  | 'with statement cannot be used in strict mode'
  | 'yield cannot be used as an identifier inside generator functions'
  | 'yield cannot be used as an identifier inside generator functions or modules'
  | 'yield cannot be used in formal parameters'
  | 'yield cannot be used inside parameters of arrow functions'
  ): ThrowCompletion;
  (m:
'$1'
  | '$1 by zero is not defined'
  | '$1 can only be used with v flag'
  | '$1 cannot be bound by ref here'
  | '$1 cannot be extended by a partial class'
  | '$1 cannot be inverted'
  | '$1 cannot be invoked without new'
  | '$1 cannot be stored as columns'
  | '$1 cannot be used as a WeakMap key'
  | '$1 cannot be used as an identifier'
  | '$1 cannot be used as an identifier in strict mode'
  | '$1 cannot be used as an index'
  | '$1 cannot be used before initialization'
  | '$1 cannot be weakly referenced'
  | '$1 could not be appended'
  | '$1 does not look like a TemporalTimeLike object'
  | "$1 does not match the pattern's length"
  | '$1 does not name a replacement decorator, and a statement declares nothing for a decorator to run at'
  | '$1 has no custom matcher'
  | '$1 has no decimal value'
  | '$1 has no default value, so a declaration of it needs an initializer'
  | '$1 has no signature taking values of two numeric types'
  | '$1 is a readonly field and can only be assigned in the declaring class constructor'
  | '$1 is a readonly member and cannot be assigned'
  | '$1 is a replacement decorator and cannot be shadowed'
  | '$1 is a replacement decorator and must be written outermost'
  | '$1 is a typed class and cannot be proxied'
  | '$1 is a typed element and cannot be deleted'
  | '$1 is a typed property and cannot be deleted'
  | '$1 is already an enumerator of this enum'
  | '$1 is already claimed by another meta type'
  | '$1 is already declared'
  | '$1 is already declared on this interface'
  | '$1 is an abstract class and cannot be instantiated'
  | '$1 is defined as itself, so it denotes no type'
  | '$1 is missing from this composite'
  | '$1 is not a Promise constructor'
  | '$1 is not a RegExp object'
  | '$1 is not a TemporalTimeLike object'
  | '$1 is not a class and cannot be extended by a partial class'
  | '$1 is not a constructor'
  | '$1 is not a decimal'
  | '$1 is not a field of this type'
  | '$1 is not a finite number'
  | '$1 is not a function'
  | '$1 is not a generic type'
  | '$1 is not a list'
  | '$1 is not a member of this type'
  | '$1 is not a member of this vector'
  | '$1 is not a number'
  | '$1 is not a parameter'
  | '$1 is not a partial Temporal object'
  | '$1 is not a property'
  | '$1 is not a range'
  | '$1 is not a range iterator'
  | '$1 is not a rational'
  | '$1 is not a rebindable ref binding'
  | '$1 is not a ref binding'
  | '$1 is not a signature'
  | '$1 is not a string'
  | '$1 is not a supported calendar'
  | '$1 is not a token stream'
  | '$1 is not a tuple'
  | '$1 is not a tuple element'
  | '$1 is not a type'
  | '$1 is not a type node'
  | '$1 is not a valid array length'
  | '$1 is not a valid composite key'
  | '$1 is not a valid epoch nanoseconds'
  | '$1 is not a valid literal'
  | '$1 is not a valid member key'
  | '$1 is not a valid modifier'
  | '$1 is not a valid month code'
  | '$1 is not a valid property name'
  | '$1 is not a valid radix'
  | '$1 is not a valid type'
  | '$1 is not a value of this enum'
  | '$1 is not an SoA'
  | '$1 is not an array'
  | '$1 is not an element of this SoA'
  | '$1 is not an element of this type'
  | '$1 is not an index signature'
  | '$1 is not an integer'
  | '$1 is not an interface'
  | '$1 is not an object'
  | '$1 is not an object or a symbol'
  | '$1 is not an object or tuple type'
  | '$1 is not defined'
  | '$1 is not iterable'
  | '$1 is not object or null'
  | '$1 is not supported yet'
  | '$1 is not the [[ArrayBufferDetachKey]] of the given ArrayBuffer'
  | '$1 is out of range'
  | '$1 is out of range for the type'
  | '$1 is out of range for this vector'
  | '$1 is protected'
  | '$1 is too large'
  | '$1 is too small'
  | '$1 matched no clause of this match'
  | '$1 must be supplied by explicit application and is never inferred'
  | '$1 names a lane twice and cannot be assigned to'
  | '$1 needs an element type, as in `new SoA.<T, N>()`'
  | '$1 of a negative value is not defined'
  | '$1 requires a contextual type'
  | '$1 requires a reflection context as a type argument'
  | '$1 requires an argument'
  | '$1 requires an argument of a sized integer type'
  | '$1 requires new'
  | '$1 returned a tuple where a Boolean was required'
  | '$1 takes one lane index'
  | '$1 with a negative exponent is not defined for an integer type'
  | "'defineProperty' on proxy: trap returned truthy for adding property $1 that is incompatible with the existing property in the proxy target"
  | "'defineProperty' on proxy: trap returned truthy for adding property $1 to the non-extensible proxy target"
  | "'defineProperty' on proxy: trap returned truthy for defining non-configurable property $1 which cannot be non-writable, unless there exists a corresponding non-configurable, non-writable own property of the target object"
  | "'defineProperty' on proxy: trap returned truthy for defining non-configurable property $1 which is either non-existent or configurable in the proxy target"
  | "'deleteProperty' on proxy: trap returned truthy for property $1 but the proxy target is non-extensible"
  | "'deleteProperty' on proxy: trap returned truthy for property $1 which is non-configurable in the proxy target"
  | "'get' on proxy: property $1 is a non-configurable accessor property on the proxy target and does not have a getter function, but the trap did not return 'undefined'"
  | "'get' on proxy: property $1 is a read-only and non-configurable data property on the proxy target but the proxy did not return its actual value"
  | "'getOwnPropertyDescriptor' on proxy: trap reported non-configurability for property $1 which is either non-existent or configurable in the proxy target"
  | "'getOwnPropertyDescriptor' on proxy: trap reported non-configurability for property $1 which is writable or configurable in the proxy target"
  | "'getOwnPropertyDescriptor' on proxy: trap returned descriptor for property $1 that is incompatible with the existing property in the proxy target"
  | "'getOwnPropertyDescriptor' on proxy: trap returned neither object nor undefined for property $1"
  | "'getOwnPropertyDescriptor' on proxy: trap returned undefined for property $1 which exists in the non-extensible target"
  | "'getOwnPropertyDescriptor' on proxy: trap returned undefined for property $1 which is non-configurable in the proxy target"
  | "'has' on proxy: trap returned falsy for property $1 but the proxy target is not extensible"
  | "'has' on proxy: trap returned falsy for property $1 which exists in the proxy target as non-configurable"
  | "'isExtensible' on proxy: trap result does not reflect extensibility of proxy target (which is $1)"
  | "'ownKeys' on proxy: trap result did not include $1"
  | "'set' on proxy: trap returned truthy for property $1 which exists in the proxy target as a non-configurable and non-writable accessor property without a setter"
  | "'set' on proxy: trap returned truthy for property $1 which exists in the proxy target as a non-configurable and non-writable data property with a different value"
  | 'Accessor decorator must return an object or undefined, but $1 was returned'
  | 'Assignment to constant variable $1'
  | 'Cannot assign to $1'
  | 'Cannot convert $1 to Temporal.Duration'
  | 'Cannot convert $1 to TemporalPartialDurationRecord'
  | 'Cannot convert $1 to a BigInt'
  | 'Cannot convert $1 to object'
  | 'Cannot convert a Symbol value to a $1'
  | 'Cannot convert a symbol value $1 to a number'
  | 'Cannot create a ShadowRealm wrapped function on $1'
  | 'Cannot define property $1'
  | 'Cannot delete property $1'
  | 'Cannot load module $1'
  | 'Cannot manipulate a running generator $1'
  | 'Cannot mix BigInt and other types in $1 operation'
  | "Cannot perform '$1' on a proxy that has been revoked"
  | 'Cannot resolve a promise $1 with itself'
  | 'Class decorator must return a function or undefined, but $1 was returned'
  | 'Count $1 is invalid'
  | 'Critical annotation "$1" failed.'
  | 'Duplicate import attribute $1'
  | 'Duplicate regular expression flag "$1"'
  | 'Duplicated capture group $1'
  | 'Expect a CharacterClassEscape but $1 found'
  | "Expected 'this' value to be a function but got $1"
  | 'Expected a character but got $1'
  | 'Export identifier $1 already declared'
  | 'Field decorator must return a function or undefined, but $1 was returned'
  | 'First argument to $1 must not be a regular expression'
  | 'Function $1 already declared'
  | 'Identifier $1 already declared'
  | 'Import attribute value must be a string, but $1'
  | 'Index $1 is too big'
  | 'Invalid TemporalUnit value $1'
  | 'Invalid code point $1'
  | 'Invalid format range for $1'
  | 'Invalid hint: $1'
  | 'Invalid time string $1'
  | 'Invalid time zone identifier: $1'
  | 'Label $1 not found'
  | 'Method decorator must return a function or undefined, but $1 was returned'
  | 'Module "$1" is not ready for synchronous execution'
  | 'Module undefined export $1'
  | 'No module loader can load this module request.$1'
  | 'Only primitive values and functions can be passed across the ShadowRealm boundary, but $1 is an object'
  | 'Private field $1 is not a getter'
  | 'Private field $1 is not a setter'
  | 'Private identifier $1 already declared'
  | 'Private identifier $1 not defined'
  | 'Private method $1 cannot be set'
  | 'Promise reject function $1 is not callable'
  | 'Promise resolve function $1 is not callable'
  | 'Property descriptors must not specify both accessors and a value or writable attribute, but $1 does'
  | 'RegExp flags must not have duplicates ($1)'
  | 'RegExp has invalid flags ($1)'
  | 'Return value $1 of a derived constructor is not an object or undefined'
  | 'Right-hand side of "in" ($1) is not an object'
  | 'Right-hand side of "instanceof" ($1) is not a function'
  | 'Right-hand side of "instanceof" ($1) is not an object'
  | 'Subclass constructor returned a smaller-than-requested object $1'
  | 'Subclass constructor returned the same object $1'
  | 'Super class $1 is not a constructor'
  | 'The "with" option in import() must be an object, but $1'
  | 'The RegExp passed to String.prototype.$1 must have the global flag'
  | 'The get property of the return value of an accessor decorator must be a function or undefined, but $1 was returned'
  | 'The init property of the return value of an accessor decorator must be a function or undefined, but $1 was returned'
  | 'The iterator $1 does not provide a throw method'
  | 'The second argument to import() must be an object, but $1'
  | 'The set property of the return value of an accessor decorator must be a function or undefined, but $1 was returned'
  | 'There is no $1 capture groups'
  | 'There is no capture group called $1'
  | 'Unable to freeze object $1'
  | 'Unable to prevent extensions on object $1'
  | 'Unable to seal object $1'
  | 'Unexpected $1'
  | 'Unexpected character $1 in JSON'
  | 'Unsupported import attribute "$1"'
  | 'Unsupported import attribute $1'
  | 'Variable $1 already declared'
  | 'a $1 clause is not satisfied by this application'
  | 'a call assigned to must return a ref, and $1 does not'
  | 'a call in a ++ or -- operand must return a ref, and $1 does not'
  | 'a decimal is constructed from a string of digits; the conversion from $1 is not yet defined'
  | 'a do expression may not end in $1'
  | 'a match arm may not end in $1'
  | 'a meta declaration requires a $1 hook'
  | 'a positional type argument cannot follow a named one in $1'
  | 'a string is not a conversion source for $1; use its parse or tryParse'
  | 'a using declaration cannot be typed $1, whose values carry no disposal method'
  | 'addInitializer must be called with a function, but $1 was passed'
  | 'an SoA is not assignable to $1; convert with toArray()'
  | 'arguments[0] ($1) is not a symbol'
  | 'arguments[1] ($1) is not a function'
  | 'calendar must be a string, but $1'
  | 'calendarName option is invalid ($1), only "auto", "always", "never" and "critical" are accepted'
  | 'callbackfn ($1) is not a function'
  | 'cannot take a ref of $1, which is a bit-field and has no byte address'
  | 'comparator ($1) is not a function'
  | 'direction option is not valid ($1), only "next" and "previous" are accepted'
  | 'disambiguation option is invalid ($1), only "compatible", "earlier", "later" and "reject" are accepted'
  | 'expansion of $1 exceeded the limit'
  | 'heldValue $1 matches target'
  | 'invalid time zone identifier: $1'
  | 'mapper ($1) is not a function'
  | 'monthCode ($1) is not a string'
  | 'no argument for the required parameter $1'
  | 'no declared signature accepts an argument of type $1'
  | 'no overload of $1 matches these arguments'
  | 'no parameter named $1 for this call'
  | 'offset option is invalid ($1), only "auto" and "never" are accepted'
  | 'offset option is invalid ($1), only "prefer", "use", "ignore" and "reject" are accepted'
  | 'operator $1 is declared by the right operand, but operator dispatch keys on the left operand'
  | 'option $1 is required'
  | 'option.padding $1 is not an object'
  | 'options.padding $1 is not an object'
  | 'overflow option is invalid ($1), only "constrain" and "reject" are accepted'
  | 'parameter $1 cannot be bound by ref here'
  | 'parameter $1 requires a ref argument'
  | 'parse is not defined for $1'
  | 'stack property must be set to a string value, but got $1'
  | 'super ($1) is not a constructor'
  | 'targetOffset ($1) cannot be negative'
  | 'temporalCalendarLike must be a string or a Temporal object, but got $1'
  | 'the $1 test can never fail, so the branch it guards is dead code'
  | 'the $1 test can never succeed, so the branch it guards is dead code'
  | 'the argument bound by ref to $1 does not satisfy its type annotation'
  | 'the call to $1 is ambiguous between overloads'
  | 'the replacement decorator $1 did not return tokens'
  | 'the replacement decorator $1 rejected what it decorates'
  | 'the type evaluation budget was exhausted ($1) while checking this source text'
  | 'the type evaluation budget was exhausted at $1'
  | 'the value bound by ref to $1 does not satisfy its type annotation'
  | 'this type has no layout, so it has no $1'
  | 'this value $1 is not an object'
  | 'this.add ($1) is not a function'
  | 'timeZoneName option is invalid ($1), only "auto", "never" and "critical" are accepted'
  | 'tryParse is not defined for $1'
  , $1: Formattable): ThrowCompletion;
  (m:
'"add" property ($1) of object $2 is not a function'
  | '"set" property ($1) of object $2 is not a function'
  | '$1 and $2 are different numeric types and do not mix; convert one of them'
  | '$1 called on incompatible receiver $2'
  | '$1 called on invalid receiver: $2'
  | '$1 contains itself through field $2, so it has no finite layout'
  | '$1 does not exist on $2'
  | '$1 does not match any of productions ($2)'
  | '$1 does not name a type parameter of $2'
  | '$1 has no signature taking a value of type $2'
  | '$1 is a required on object $2'
  | '$1 is already an enumerator of $2, and a value may be an enumerator of at most one enum'
  | '$1 is ambiguous against $2'
  | '$1 is not a $2'
  | '$1 is not a $2 object'
  | '$1 is not a case of enum $2'
  | '$1 is not a value of $2'
  | '$1 is not assignable to $2'
  | '$1 is not claimed by any meta type, in $2'
  | '$1 is not in the range of $2'
  | '$1 is out of range for $2'
  | '$1 lanes were supplied where $2 are wanted'
  | '$1 takes $2 type arguments and cannot be used unapplied'
  | 'Cannot create a proxy with a $1 as $2'
  | 'Cannot not delete property $1 on $2'
  | 'Cannot set property $1 on $2'
  | 'Expected $1 but got $2'
  | 'Expected character $1 but got $2 in JSON'
  | 'Export $1 from module "$2" is ambiguous'
  | 'Invalid range: $1 is bigger than $2'
  | 'Module "$1" does not have an export named $2'
  | 'Module $1 does not have an export named $2'
  | 'Object $1 does not have internal slot [[$2]]'
  | 'Private element $1 is already defined on $2'
  | 'Size of $1 should be a multiple of $2'
  | 'Start offset of $1 should be a multiple of $2'
  | 'The return value ($1) of the next() on an iterator ($2) must be an object'
  | 'The return value ($1) of the return() on an iterator ($2) must be an object'
  | 'The return value ($1) of the throw() on an iterator ($2) must be an object'
  | 'a $1 annotation is not a $2'
  | 'a tuple of $1 positions has no position at index $2'
  | 'a value of the $1 type and a $2 are different numeric types and do not mix; convert one of them'
  | 'getter ($1) in a property descriptor $2 must be a function'
  | 'lane $1 is out of range for a vector of $2 lanes'
  | 'match over $1 is missing $2 and has no default'
  | 'match over enum $1 is missing $2 and has no default'
  | 'match over sealed class $1 is missing $2 and has no default'
  | 'setter ($1) in a property descriptor $2 must be a function'
  | 'switch over enum $1 is missing $2 and has no default'
  | 'the replacement decorator $1 is not compile-time evaluable: it names $2'
  | 'the type parameter $1 of $2 has no argument and no default'
  | 'the type parameter $1 of $2 is supplied twice'
  , $1: Formattable, $2: Formattable): ThrowCompletion;
  (m:
'"roundingMode" on object $1 is not valid ($2), only $3 are accepted'
  | '$1 does not admit converting $2 to $3'
  | '$1 is not a function. (In "$2", it is $3)'
  | '$1 is not a generic declaration; $2 expects one taking $3 type arguments'
  | '$1 is not assignable to $2: it does not satisfy $3'
  | '$1 takes $2 type arguments; $3 expects one taking $4'
  | '$1-$2-$3 is not a valid date'
  | 'Duration($1, $2, $3, $4) is not a valid duration'
  | "a $1 holds a $2 rather than taking this position's $3; declare it $4 if it is never reassigned, or annotate it"
  | 'option $1 does not accept value $2 (only $3 accepted)'
  , $1: Formattable, $2: Formattable, $3: Formattable): ThrowCompletion;
  // auto-generate end
  <const S extends string>(m: S, ...args: ParsePrintFormat<S>): ThrowCompletion;
}

// thanks https://github.com/type-challenges/type-challenges/blob/main/questions/00147-hard-c-printf-parser/README.md
type ParametersMap = {
  '1': Formattable;
  '2': Formattable;
  '3': Formattable;
  '4': Formattable;
  '5': Formattable;
}
type ParsePrintFormat<S extends string> = S extends `${string}$${infer T}${infer End}` ? T extends keyof ParametersMap ? [ParametersMap[T], ...ParsePrintFormat<End>] : ParsePrintFormat<End> : []
