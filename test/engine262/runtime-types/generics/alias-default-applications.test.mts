import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError } from '../harness.mts';

// #sec-parameterized-types and #sec-bindtypearguments: a bare alias in a
// concrete type position has the same completed arguments as an empty list.

test.each(['Cell', 'Cell.<>', 'Cell.<uint8>'])('alias application %s contextualizes its initializer', (application) => {
  expect(evaluated(`type Cell<T: type = uint8> = { value: T };
    let cell: ${application} = { value: 1 }; String(cell.value is uint8);`)).toBe('true');
});

test('dependent alias defaults bind in declaration order', () => {
  expect(evaluated(`type Pair<T: type = uint8, U: type = T> = { left: T, right: U };
    let pair: Pair = { left: 1, right: 2 };
    String(pair.left is uint8) + '/' + String(pair.right is uint8);`)).toBe('true/true');
});

test('value defaults determine the contextual array extent', () => {
  expect(evaluated(`type Row<N: uint32 = 2, T: type = uint8> = [N].<T>;
    let row: Row = [1, 2]; String(row.length) + '/' + String(row[0] is uint8);`)).toBe('2/true');
});

test('bare alias defaults reach parameter and return boundaries', () => {
  expect(evaluated(`type Cell<T: type = uint8> = { value: T };
    function copy(cell: Cell): Cell { return { value: cell.value }; }
    const cell = copy({ value: 1 }); String(cell.value is uint8);`)).toBe('true');
  expectStaticTypeError(`type Cell<T: type = uint8> = { value: T };
    function bad(): Cell { return { value: 'wrong' }; }`);
});

test('missing alias arguments are refused even in an unused function', () => {
  expectStaticTypeError('type Cell<T: type> = { value: T }; function unused(cell: Cell) {}');
  expectStaticTypeError('type Cell<T: type> = { value: T }; function unused() { let cell: Cell; }');
});

test('defaulted alias boundaries reject incompatible values before execution', () => {
  expectStaticTypeError(`type Cell<T: type = uint8> = { value: T };
    function unused() { let cell: Cell = { value: 'wrong' }; }`);
  expectStaticTypeError(`type Small<T: type extends uint8 = uint8> = T;
    function unused() { let value: Small.<string>; }`);
});

test('the nearest alias declaration supplies its defaults', () => {
  expect(evaluated(`type Cell<T: type = uint8> = { value: T };
    function make() {
      type Cell<T: type = string> = { value: T };
      let cell: Cell = { value: 'inner' }; return cell.value;
    }
    make();`)).toBe('inner');
});

test('a type parameter shadows a generic alias of the same name', () => {
  expect(evaluated(`type Cell<T: type = uint8> = { value: T };
    function identity<Cell: type>(value: Cell): Cell { return value; }
    identity.<string>('parameter');`)).toBe('parameter');
});

test('higher-kinded arguments retain the alias declaration', () => {
  expect(evaluated(`type Cell<T: type> = { value: T };
    function choose<F<_>: type>(): type { return type F.<string>; }
    String(choose.<Cell>() === type Cell.<string>);`)).toBe('true');
});

test('default arguments select an alias specialization', () => {
  expect(evaluated(`type Storage<T: type = boolean> = T;
    type Storage<boolean> = uint8;
    let value: Storage = 1; String(value is uint8);`)).toBe('true');
});
