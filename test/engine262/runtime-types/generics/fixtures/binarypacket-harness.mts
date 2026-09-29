// The design's binary packet example
// (ecmascript-types, examples/binarypacket.md) - its writer, reader, and tuple
// reader, with the design's `doc` decorators, typed inputs, and the writer's
// bytes in place of the network - as a string, as the corpus suites hold their
// programs: it is proposal syntax, which the TypeScript build must not check
// as JavaScript (as a `.js` file it reported one error per line).
export const binaryPacketProgram = `const docKey = Symbol('doc');

// Metadata

partial interface ClassMetadata {
	[docKey]?: string;
}
partial interface ClassFieldMetadata {
	[docKey]?: string;
}
partial interface ClassMethodMetadata {
	[docKey]?: string;
}
partial interface ClassMethodParameterMetadata {
	[docKey]?: string;
}
partial interface ClassGetterMetadata {
	[docKey]?: string;
}
partial interface ClassSetterMetadata {
	[docKey]?: string;
}
partial interface ClassSetterParameterMetadata {
	[docKey]?: string;
}
partial interface ClassAccessorMetadata {
	[docKey]?: string;
}
partial interface ClassOperatorMetadata {
	[docKey]?: string;
}
partial interface FunctionMetadata {
	[docKey]?: string;
}
partial interface ObjectMethodMetadata {
	[docKey]?: string;
}
partial interface ObjectGetterMetadata {
	[docKey]?: string;
}
partial interface ObjectSetterMetadata {
	[docKey]?: string;
}

// Decorators

function doc<T: type>(description: string, { metadata }: Reflect.Class.<T>) {
	metadata[docKey] = description;
}

function doc<T: type, TClass: type>(description: string, { metadata }: Reflect.ClassField.<T, TClass>) {
	metadata[docKey] = description;
}

function doc<T: type extends (...args: [].<any>) => any, TClass: type>(description: string, { metadata }: Reflect.ClassMethod.<T, TClass>) {
	metadata[docKey] = description;
}

function doc<T: type, TMethod: type, TClass: type>(description: string, { metadata }: Reflect.ClassMethodParameter.<T, TMethod, TClass>) {
	metadata[docKey] = description;
}

function doc<T: type, TClass: type>(description: string, { metadata }: Reflect.ClassGetter.<T, TClass>) {
	metadata[docKey] = description;
}

function doc<T: type, TClass: type>(description: string, { metadata }: Reflect.ClassSetter.<T, TClass>) {
	metadata[docKey] = description;
}

function doc<T: type, TClass: type>(description: string, { metadata }: Reflect.ClassSetterParameter.<T, TClass>) {
	metadata[docKey] = description;
}

// Every other context kind whose metadata the table marks available.
function doc<T: type, TClass: type>(description: string, { metadata }: Reflect.ClassAccessor.<T, TClass>) {
	metadata[docKey] = description;
}

function doc<T: type, TClass: type>(description: string, { metadata }: Reflect.ClassOperator.<T, TClass>) {
	metadata[docKey] = description;
}

function doc<T: type>(description: string, { metadata }: Reflect.Function.<T>) {
	metadata[docKey] = description;
}

function doc<T: type, TObject: type>(description: string, { metadata }: Reflect.ObjectMethod.<T, TObject>) {
	metadata[docKey] = description;
}

function doc<T: type, TObject: type>(description: string, { metadata }: Reflect.ObjectGetter.<T, TObject>) {
	metadata[docKey] = description;
}

function doc<T: type, TObject: type>(description: string, { metadata }: Reflect.ObjectSetter.<T, TObject>) {
	metadata[docKey] = description;
}
@doc('A bit-granular packet writer for realtime network protocols.')
class PacketWriter<Size: uint32 = 1400, HeaderSize: uint32 = 16, BufferBits: uint32 = 64> {
	@doc('The word buffer for the packet. Bits fill each word from the most significant end.')
	// 1500 byte MTU minus IP/TCP/WebSocket framing ~= 1400 byte default payload.
	// A fixed array field sized by the class's parameters, zero-filled by default;
	// its extent divides as uint32 does, so round the word count up first.
	#buffer: [(Size + BufferBits / 8 - 1) / (BufferBits / 8)].<uint.<BufferBits>>;

	// Typed declarations without initializers default to 0.
	@doc('The current bit index of the writer.')
	#bitIndex: uint32;

	@doc('The bit index recorded by end() and written into the header.')
	#maximumBitIndex: uint32;

	@doc('The written packet as bytes, sized to the bits actually used.')
	get bytes(): [].<uint8> {
		return Span.<uint8>(this.#buffer).slice(0, (this.#maximumBitIndex + 7) / 8);
	}

	@doc('Reserves the header. Call before writing values.')
	begin(): PacketWriter {
		this.#bitIndex = HeaderSize;
		return this;
	}

	@doc('Records the final bit length into the header. Call after writing values.')
	end(): PacketWriter {
		this.#maximumBitIndex = this.#bitIndex;
		this.#buffer[0] |= uint.<BufferBits>(this.#maximumBitIndex) << (BufferBits - HeaderSize);
		return this;
	}

	@doc('Reads bits at an arbitrary bit index without moving the cursor.')
	#bitsAt(bitIndex: uint32, bits: uint32): uint.<BufferBits> {
		const offset = bitIndex % BufferBits;
		let value = this.#buffer[bitIndex / BufferBits] << offset >> (BufferBits - bits);
		if (offset > BufferBits - bits) {
			value |= this.#buffer[bitIndex / BufferBits + 1] >> (2 * BufferBits - bits - offset);
		}
		return value;
	}

	@doc('Writes the low \`bits\` bits of value at the cursor, spilling across a word boundary when needed.')
	#writeBits(value: uint.<BufferBits>, bits: uint32) {
		const offset = this.#bitIndex % BufferBits;
		// Left-align the value in a word, then shift it down to the cursor.
		// The left shift also discards any bits above \`bits\`.
		this.#buffer[this.#bitIndex / BufferBits] |= value << (BufferBits - bits) >> offset;
		if (offset > BufferBits - bits) {
			// The value crossed into the next word.
			this.#buffer[this.#bitIndex / BufferBits + 1] |= value << (2 * BufferBits - bits - offset);
		}
		this.#bitIndex += bits;
	}

	@doc('Writes a 1-bit boolean.')
	write<boolean>(value: boolean): PacketWriter {
		this.#writeBits(value ? 1 : 0, 1);
		return this;
	}

	@doc('Writes an n-bit unsigned integer, e.g. write.<uint.<12>>(value).')
	write<uint.<const N>>(value: uint.<N>): PacketWriter {
		this.#writeBits(uint.<BufferBits>(value), N);
		return this;
	}

	@doc('Writes an n-bit signed integer as two\\'s complement.')
	write<int.<const N>>(value: int.<N>): PacketWriter {
		return this.write.<uint.<N>>(uint.<N>(value));
	}

	@doc('Writes an unsigned integer in [0, maximum] using the fewest bits that hold the range.')
	write<uint.<const N>, maximum: uint32>(value: uint.<N>): PacketWriter {
		const bits: uint32 = 32 - Math.clz32(maximum);
		this.#writeBits(uint.<BufferBits>(value), bits);
		return this;
	}

	@doc('Writes an unsigned integer in [minimum, maximum] using the fewest bits that hold the range.')
	write<uint.<const N>, minimum: uint32, maximum: uint32>(value: uint.<N>): PacketWriter {
		const bits: uint32 = 32 - Math.clz32(maximum - minimum);
		this.#writeBits(uint.<BufferBits>(uint32(value) - minimum), bits);
		return this;
	}

	@doc('Writes a signed integer in [minimum, maximum] using the fewest bits that hold the range.')
	write<int.<const N>, minimum: int32, maximum: int32>(value: int.<N>): PacketWriter {
		const bits: uint32 = 32 - Math.clz32(uint32(maximum - minimum));
		this.#writeBits(uint.<BufferBits>(uint32(int32(value) - minimum)), bits);
		return this;
	}

	@doc('Writes an exact 32-bit float by reinterpreting its bits through a view.')
	write<float32>(value: float32): PacketWriter {
		const scratch: [1].<float32> = [value];
		return this.write.<uint32>(Span.<uint32>(scratch)[0]);
	}

	@doc('Writes a float quantized onto [0, maximum] with the given bit budget.')
	write<float32, maximum: float32, bits: uint32>(value: float32): PacketWriter {
		this.#writeBits(uint.<BufferBits>(Math.round(value / maximum * float32((1 << bits) - 1))), bits);
		return this;
	}

	@doc('Writes a float quantized onto [minimum, maximum]. When the range spans zero, code 0 is reserved so 0.0 round-trips exactly.')
	write<float32, minimum: float32, maximum: float32, bits: uint32>(value: float32): PacketWriter {
		if (minimum < 0 && maximum > 0) {
			this.#writeBits(uint.<BufferBits>(value == 0 ? 0 : Math.round((value - minimum) / (maximum - minimum) * float32((1 << bits) - 2)) + 1), bits);
		} else {
			this.#writeBits(uint.<BufferBits>(Math.round((value - minimum) / (maximum - minimum) * float32((1 << bits) - 1))), bits);
		}
		return this;
	}

	@doc('Writes an exact 64-bit float by reinterpreting its bits through a view.')
	write<float64>(value: float64): PacketWriter where BufferBits >= 64 {
		const scratch: [1].<float64> = [value];
		return this.write.<uint64>(Span.<uint64>(scratch)[0]);
	}

	@doc('Writes an unsigned integer with a variable-width encoding. Each continuation bit adds \`bits\` more value bits; size \`bits\` for the typical value.')
	writeVariableWidthUint<bits: uint32 = 8>(value: uint.<BufferBits>): PacketWriter {
		let width: uint32 = bits;
		while (width < BufferBits && value >> width != 0) {
			this.write.<boolean>(true); // One more interval follows.
			width += bits;
		}
		if (width < BufferBits) {
			this.write.<boolean>(false); // Terminate the sequence.
		}
		this.#writeBits(value, Math.min(width, BufferBits));
		return this;
	}

	@doc('Writes a signed integer with a variable-width encoding using zigzag mapping, so small magnitudes of either sign stay small.')
	writeVariableWidthInt<bits: uint32 = 8>(value: int.<BufferBits>): PacketWriter {
		return this.writeVariableWidthUint.<bits>(uint.<BufferBits>((value << 1) ^ (value >> (BufferBits - 1))));
	}

	@doc('Writes a length-prefixed ASCII string. A non-ASCII character fails the uint.<7> cast with a TypeError.')
	write<string, LengthType: type extends uint.<_> = uint16>(value: string): PacketWriter {
		this.write.<LengthType>(LengthType(value.length));
		for (let index: uint64 = 0; index < uint64(value.length); ++index) {
			this.write.<uint.<7>>(uint.<7>(value.charCodeAt(index)));
		}
		return this;
	}

	@doc('Writes another packet, header included, so the receiver can carve it back out.')
	write<PacketWriter>(value: PacketWriter): PacketWriter {
		for (let cursor: uint32 = 0; cursor < value.#maximumBitIndex; cursor += BufferBits) {
			const bits = Math.min(BufferBits, value.#maximumBitIndex - cursor);
			this.#writeBits(value.#bitsAt(cursor, bits), bits);
		}
		return this;
	}

	@doc('Returns the written bits as a string of 0s and 1s for debugging.')
	trace(): string {
		let s = '';
		const end = Math.max(this.#bitIndex, this.#maximumBitIndex);
		for (let index: uint32 = 0; index < end; ++index) {
			if (index != 0 && index % 8 == 0) {
				s += ' ';
			}
			s += this.#bitsAt(index, 1) == 0 ? '0' : '1';
		}
		return s;
	}
}

@doc('A bit-granular packet reader mirroring PacketWriter.')
class PacketReader<Size: uint32 = 1400, HeaderSize: uint32 = 16, BufferBits: uint32 = 64> {
	// Sized as the writer's buffer is: a packet never exceeds Size bytes. Whole
	// words, zero-filled by default, so the shift math never runs off the end.
	#buffer: [(Size + BufferBits / 8 - 1) / (BufferBits / 8)].<uint.<BufferBits>>;
	#bitIndex: uint32;
	#maximumBitIndex: uint32;

	@doc('Constructs a reader over received bytes, e.g. a WebSocket message or a WebTransport datagram.')
	constructor(buffer: Span.<uint8>) {
		// No writer of this Size produces more; a larger input is a mismatch.
		if (uint32(buffer.length) > Size) {
			throw new RangeError('The packet is larger than this reader\\'s Size');
		}
		Span.<uint8>(this.#buffer).set(buffer);
		this.readHeader();
	}

	@doc('Reads the packet bit length from the header.')
	readHeader() {
		// Bounds checks compare against the whole buffer until the real length is known.
		this.#maximumBitIndex = uint32(this.#buffer.length) * BufferBits;
		this.#maximumBitIndex = uint32(this.#readBits(HeaderSize));
	}

	#bitsAt(bitIndex: uint32, bits: uint32): uint.<BufferBits> {
		const offset = bitIndex % BufferBits;
		let value = this.#buffer[bitIndex / BufferBits] << offset >> (BufferBits - bits);
		if (offset > BufferBits - bits) {
			value |= this.#buffer[bitIndex / BufferBits + 1] >> (2 * BufferBits - bits - offset);
		}
		return value;
	}

	@doc('Reads \`bits\` bits at the cursor with a bounds check against the header length.')
	#readBits(bits: uint32): uint.<BufferBits> {
		if (this.#bitIndex + bits > this.#maximumBitIndex) {
			throw new Error(\`\${bits} bits expected\`);
		}
		const value = this.#bitsAt(this.#bitIndex, bits);
		this.#bitIndex += bits;
		return value;
	}

	@doc('The generic contract every single-argument read keeps. It has no body: a type with no read below is an error at the call, and generic code such as the accumulating reader forwards to it.')
	read<T: type>(): T;

	@doc('Reads a 1-bit boolean.')
	read<boolean>(): boolean {
		return this.#readBits(1) == 1;
	}

	@doc('Reads an n-bit unsigned integer, e.g. read.<uint.<12>>().')
	read<uint.<const N>>(): uint.<N> {
		return uint.<N>(this.#readBits(N));
	}

	@doc('Reads an n-bit signed integer written as two\\'s complement.')
	read<int.<const N>>(): int.<N> {
		return int.<N>(this.read.<uint.<N>>());
	}

	@doc('Reads an unsigned integer written with the [0, maximum] range encoding.')
	read<uint.<const N>, maximum: uint32>(): uint.<N> {
		const bits: uint32 = 32 - Math.clz32(maximum);
		return uint.<N>(this.#readBits(bits));
	}

	@doc('Reads an unsigned integer written with the [minimum, maximum] range encoding.')
	read<uint.<const N>, minimum: uint32, maximum: uint32>(): uint.<N> {
		const bits: uint32 = 32 - Math.clz32(maximum - minimum);
		return uint.<N>(uint32(this.#readBits(bits)) + minimum);
	}

	@doc('Reads a signed integer written with the [minimum, maximum] range encoding.')
	read<int.<const N>, minimum: int32, maximum: int32>(): int.<N> {
		const bits: uint32 = 32 - Math.clz32(uint32(maximum - minimum));
		return int.<N>(int32(this.#readBits(bits)) + minimum);
	}

	@doc('Reads an exact 32-bit float.')
	read<float32>(): float32 {
		let scratch: [1].<uint32>; // Defaults to [0]
		scratch[0] = uint32(this.#readBits(32));
		return Span.<float32>(scratch)[0];
	}

	@doc('Reads a float quantized onto [0, maximum].')
	read<float32, maximum: float32, bits: uint32>(): float32 {
		return float32(this.#readBits(bits)) / float32((1 << bits) - 1) * maximum;
	}

	@doc('Reads a float quantized onto [minimum, maximum], honoring the reserved exact-zero code for ranges spanning zero.')
	read<float32, minimum: float32, maximum: float32, bits: uint32>(): float32 {
		const value = this.#readBits(bits);
		if (minimum < 0 && maximum > 0) {
			return value == 0 ? 0 : float32(value - 1) / float32((1 << bits) - 2) * (maximum - minimum) + minimum;
		}
		return float32(value) / float32((1 << bits) - 1) * (maximum - minimum) + minimum;
	}

	@doc('Reads an exact 64-bit float.')
	read<float64>(): float64 where BufferBits >= 64 {
		let scratch: [1].<uint64>;
		scratch[0] = this.#readBits(64);
		return Span.<float64>(scratch)[0];
	}

	@doc('Reads an unsigned integer written with the variable-width encoding.')
	readVariableWidthUint<bits: uint32 = 8>(): uint.<BufferBits> {
		let width: uint32 = bits;
		while (width < BufferBits && this.read.<boolean>()) {
			width += bits;
		}
		return this.#readBits(Math.min(width, BufferBits));
	}

	@doc('Reads a signed integer written with the zigzag variable-width encoding.')
	readVariableWidthInt<bits: uint32 = 8>(): int.<BufferBits> {
		const zigzag = this.readVariableWidthUint.<bits>();
		return int.<BufferBits>(zigzag >> 1) ^ -int.<BufferBits>(zigzag & 1);
	}

	@doc('Reads a length-prefixed ASCII string.')
	read<string, LengthType: type extends uint.<_> = uint16>(): string {
		let value = '';
		const length = uint32(this.read.<LengthType>());
		for (let index: uint32 = 0; index < length; ++index) {
			value += String.fromCharCode(this.read.<uint.<7>>());
		}
		return value;
	}

	@doc('Reads a nested packet written with write.<PacketWriter>, positioned after its header.')
	read<PacketReader>(): PacketReader {
		const maximumBitIndex = uint32(this.#readBits(HeaderSize));
		if (this.#bitIndex + maximumBitIndex - HeaderSize > this.#maximumBitIndex) {
			throw new Error('Packet expected');
		}
		// The constructor's own header read is discarded by the explicit cursor below.
		const value = new PacketReader.<Size, HeaderSize, BufferBits>(Span.<uint8>(this.#buffer));
		value.#bitIndex = this.#bitIndex;
		value.#maximumBitIndex = this.#bitIndex + maximumBitIndex - HeaderSize;
		this.#bitIndex += maximumBitIndex - HeaderSize;
		return value;
	}
}

class TupleReader extends PacketReader {
	@doc('Reads one value per type, in order, as a tuple.')
	readAll<...Ts: type>(): Ts;

	readAll<>(): [] {
		return [];
	}

	readAll<const T, ...const Rest>(): [T, ...Rest] {
		const first = this.read.<T>();
		return [first, ...this.readAll.<...Rest>()];
	}
}

// Harness: the inputs block 19 writes, and in place of the network, its bytes.
const sequence = (513 := uint16);
const firing = true;
const position = { x: (12.5 := float32), y: (-300.25 := float32) };
const entityId = (777777 := uint32);
const callsign = 'ace';
const movement = new PacketWriter()
	.begin()
	.write.<uint16>(sequence)
	.write.<boolean>(firing)
	.write.<float32, -1024, 1024, 18>(position.x) // 18 bits: ~0.03 unit resolution over 2048
	.write.<float32, -1024, 1024, 18>(position.y)
	.write.<uint32, 0, 1000000>(entityId) // 20 bits, from the range
	.write.<string>(callsign)
	.end();

movement.trace(); // '01000000 00101101 1...'
movement.bytes; // [].<uint8>, only the bytes used
const bytes = movement.bytes;
const roundTrip = (() => {
const packet = new PacketReader(bytes);
const sequence = packet.read.<uint16>();
const firing = packet.read.<boolean>();
const x = packet.read.<float32, -1024, 1024, 18>();
const y = packet.read.<float32, -1024, 1024, 18>();
const entityId = packet.read.<uint32, 0, 1000000>();
const callsign = packet.read.<string>();
  return [String(sequence), String(firing), String(x), String(y), String(entityId), callsign].join(',');
})();
// The tuple reader's usage, over a packet written in the layout it reads.
const accumulated = (() => {
  const bytes = new PacketWriter().begin().write.<boolean>(true).write.<uint.<12>>((3000 := uint.<12>)).write.<string>('zed').end().bytes;
const [alive: boolean, id: uint.<12>, name: string] =
	new TupleReader(bytes).readAll.<boolean, uint.<12>, string>();
  return [String(alive), String(id), name].join(',');
})();
roundTrip + ' | ' + accumulated;
`;
