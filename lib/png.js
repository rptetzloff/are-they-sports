/** A PNG's pixels, for reading a coverage map (lib/coverage.js).
 *
 *  8-bit RGB and RGBA, non-interlaced, which is what 506sports' maps and
 *  swatches are; anything else throws, so a change of format is noticed
 *  rather than misread. Node's zlib does the inflating, so this needs no
 *  dependency. */
import { inflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function decodePng(buf) {
	if (!buf.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG');
	let width = 0, height = 0, depth = 0, type = 0, interlace = 0;
	const idat = [];
	for (let at = 8; at < buf.length;) {
		const len = buf.readUInt32BE(at);
		const kind = buf.toString('latin1', at + 4, at + 8);
		const data = buf.subarray(at + 8, at + 8 + len);
		if (kind === 'IHDR') {
			width = data.readUInt32BE(0); height = data.readUInt32BE(4);
			depth = data[8]; type = data[9]; interlace = data[12];
		} else if (kind === 'IDAT') idat.push(data);
		else if (kind === 'IEND') break;
		at += 12 + len;
	}
	const channels = type === 6 ? 4 : type === 2 ? 3 : 0;
	if (depth !== 8 || !channels || interlace) throw new Error(`unsupported PNG (depth ${depth}, type ${type}, interlace ${interlace})`);
	const raw = inflateSync(Buffer.concat(idat));
	const stride = width * channels;
	const out = Buffer.alloc(height * stride);
	for (let y = 0; y < height; y++) {
		const filter = raw[y * (stride + 1)];
		const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
		const row = out.subarray(y * stride, (y + 1) * stride);
		const prior = y ? out.subarray((y - 1) * stride, y * stride) : null;
		for (let x = 0; x < stride; x++) {
			const a = x >= channels ? row[x - channels] : 0;
			const b = prior ? prior[x] : 0;
			const c = prior && x >= channels ? prior[x - channels] : 0;
			let v = line[x];
			if (filter === 1) v += a;
			else if (filter === 2) v += b;
			else if (filter === 3) v += (a + b) >> 1;
			else if (filter === 4) {
				const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
				v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
			}
			row[x] = v & 0xff;
		}
	}
	const pixel = (x, y) => {
		const i = (y * width + x) * channels;
		return [out[i], out[i + 1], out[i + 2]];
	};
	return { width, height, pixel };
}
