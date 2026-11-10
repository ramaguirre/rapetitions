// Animated GIF encoder for the rep clips. No browser APIs: it runs in a worker on the phone and in
// Node for the tests (tests/gif.test.mjs).
//
// One palette for the whole clip (median cut over 5-bit colours), so colours do not flicker from
// frame to frame. After the first frame, a pixel whose colour did not change is written as
// transparent: the previous frame shows through, and runs of transparent pixels compress well.

const TRANSPARENT = 255; // palette index kept free for "unchanged"

/**
 * frames: [{data: RGBA bytes (w * h * 4), delay: seconds}]. Returns the GIF file as a Uint8Array.
 * The clip loops forever.
 */
export function encodeGif(frames, w, h) {
  if (!frames.length) throw new Error("no frames");
  const { palette, lookup } = buildPalette(frames, 255);
  const out = new ByteWriter();
  out.str("GIF89a");
  out.u16(w); out.u16(h);
  out.byte(0xf7); // global colour table, 8-bit colour, 256 entries
  out.byte(0); out.byte(0);
  for (let i = 0; i < 256; i++) {
    const c = palette[i] ?? [0, 0, 0];
    out.byte(c[0]); out.byte(c[1]); out.byte(c[2]);
  }
  // Loop forever (NETSCAPE2.0 application extension).
  out.bytes([0x21, 0xff, 0x0b]); out.str("NETSCAPE2.0"); out.bytes([0x03, 0x01, 0x00, 0x00, 0x00]);

  const n = w * h;
  const shown = new Uint8Array(n);
  const idx = new Uint8Array(n);
  let carry = 0; // rounding error of the delays, in hundredths, so the total length stays right
  frames.forEach((fr, f) => {
    const d = fr.data;
    for (let i = 0; i < n; i++) {
      const k = 4 * i;
      const c = lookup[((d[k] >> 3) << 10) | ((d[k + 1] >> 3) << 5) | (d[k + 2] >> 3)];
      if (f > 0 && c === shown[i]) idx[i] = TRANSPARENT;
      else { idx[i] = c; shown[i] = c; }
    }
    const want = fr.delay * 100 + carry;
    const cs = Math.max(2, Math.round(want)); // browsers slow down anything under 2/100 s
    carry = want - cs;
    // Graphic control: keep the previous frame (disposal 1), transparency after the first frame.
    out.bytes([0x21, 0xf9, 0x04, (1 << 2) | (f > 0 ? 1 : 0)]);
    out.u16(cs);
    out.byte(TRANSPARENT); out.byte(0);
    out.byte(0x2c); out.u16(0); out.u16(0); out.u16(w); out.u16(h); out.byte(0);
    out.byte(8);
    lzw(idx, out);
  });
  out.byte(0x3b);
  return out.result();
}

/**
 * Median cut over a histogram of 5-bit colours. Returns up to `size` colours and a lookup from
 * the 15-bit colour key to a palette index (only for colours that occur).
 */
export function buildPalette(frames, size) {
  const count = new Uint32Array(32768);
  const sum = new Float64Array(32768 * 3);
  for (const fr of frames) {
    const d = fr.data;
    for (let k = 0; k < d.length; k += 4) {
      const key = ((d[k] >> 3) << 10) | ((d[k + 1] >> 3) << 5) | (d[k + 2] >> 3);
      count[key]++;
      sum[3 * key] += d[k]; sum[3 * key + 1] += d[k + 1]; sum[3 * key + 2] += d[k + 2];
    }
  }
  const keys = [];
  for (let key = 0; key < 32768; key++) if (count[key]) keys.push(key);
  const chan = (key, c) => (key >> (10 - 5 * c)) & 31;
  const boxOf = (ks) => {
    let pixels = 0;
    const lo = [31, 31, 31], hi = [0, 0, 0];
    for (const key of ks) {
      pixels += count[key];
      for (let c = 0; c < 3; c++) { const v = chan(key, c); if (v < lo[c]) lo[c] = v; if (v > hi[c]) hi[c] = v; }
    }
    const ranges = [0, 1, 2].map((c) => hi[c] - lo[c]);
    const axis = ranges.indexOf(Math.max(...ranges));
    return { ks, pixels, axis, range: ranges[axis] };
  };
  const boxes = [boxOf(keys)];
  while (boxes.length < size) {
    // Split the box with the most pixels times spread; boxes of one colour cannot be split.
    let best = -1, score = 0;
    boxes.forEach((b, i) => { const s = b.pixels * b.range; if (b.ks.length > 1 && s > score) { score = s; best = i; } });
    if (best < 0) break;
    const b = boxes[best];
    b.ks.sort((x, y) => chan(x, b.axis) - chan(y, b.axis));
    let acc = 0, cut = 1;
    for (let i = 0; i < b.ks.length - 1; i++) {
      acc += count[b.ks[i]];
      cut = i + 1;
      if (acc >= b.pixels / 2) break;
    }
    boxes.splice(best, 1, boxOf(b.ks.slice(0, cut)), boxOf(b.ks.slice(cut)));
  }
  const palette = [];
  const lookup = new Uint8Array(32768);
  boxes.forEach((b, i) => {
    let r = 0, g = 0, bl = 0, n = 0;
    for (const key of b.ks) { r += sum[3 * key]; g += sum[3 * key + 1]; bl += sum[3 * key + 2]; n += count[key]; lookup[key] = i; }
    palette.push([Math.round(r / n), Math.round(g / n), Math.round(bl / n)]);
  });
  return { palette, lookup };
}

/** GIF's LZW with 8-bit pixels, written as data sub-blocks (at most 255 bytes each). */
function lzw(idx, out) {
  const CLEAR = 256, EOI = 257;
  let size = 9, next = 258;
  let dict = new Map();
  const block = [];
  let bits = 0, nbits = 0;
  const emit = (code) => {
    bits |= code << nbits;
    nbits += size;
    while (nbits >= 8) {
      block.push(bits & 0xff);
      bits >>>= 8;
      nbits -= 8;
      if (block.length === 255) { out.byte(255); out.bytes(block); block.length = 0; }
    }
  };
  emit(CLEAR);
  let prefix = idx[0];
  for (let i = 1; i < idx.length; i++) {
    const k = idx[i];
    const key = (prefix << 8) | k;
    const code = dict.get(key);
    if (code !== undefined) { prefix = code; continue; }
    emit(prefix);
    if (next === 4096) {
      emit(CLEAR);
      dict = new Map();
      next = 258;
      size = 9;
    } else {
      if (next >= 1 << size) size++;
      dict.set(key, next++);
    }
    prefix = k;
  }
  emit(prefix);
  emit(EOI);
  if (nbits > 0) block.push(bits & 0xff);
  if (block.length) { out.byte(block.length); out.bytes(block); }
  out.byte(0);
}

class ByteWriter {
  constructor() { this.buf = new Uint8Array(1 << 16); this.n = 0; }
  byte(b) {
    if (this.n === this.buf.length) { const nb = new Uint8Array(this.buf.length * 2); nb.set(this.buf); this.buf = nb; }
    this.buf[this.n++] = b;
  }
  bytes(a) { for (const b of a) this.byte(b); }
  u16(v) { this.byte(v & 0xff); this.byte((v >> 8) & 0xff); }
  str(s) { for (let i = 0; i < s.length; i++) this.byte(s.charCodeAt(i)); }
  result() { return this.buf.slice(0, this.n); }
}
