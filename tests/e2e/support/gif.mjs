/**
 * A valid animated GIF of two solid frames, red and then blue, that loops without end. The
 * frames last 100 ms each, so a test can watch the picture change over time.
 */
export function animatedGif(size = 16) {
  const bytes = [];
  const word = (value) => bytes.push(value & 0xff, value >> 8);
  const text = (value) => bytes.push(...Buffer.from(value, 'latin1'));

  text('GIF89a');
  word(size);
  word(size);
  // A global color table of 4 colors: red, blue and two unused.
  bytes.push(0b1000_0001, 0, 0);
  bytes.push(255, 0, 0, 0, 0, 255, 0, 0, 0, 0, 0, 0);
  // The loop count: 0 means forever.
  bytes.push(0x21, 0xff, 11);
  text('NETSCAPE2.0');
  bytes.push(3, 1, 0, 0, 0);

  for (const color of [0, 1]) {
    // The frame delay is in 1/100 s.
    bytes.push(0x21, 0xf9, 4, 0, 10, 0, 0, 0);
    bytes.push(0x2c);
    word(0);
    word(0);
    word(size);
    word(size);
    bytes.push(0, 2);
    // LZW with 3-bit codes. A clear code before every second pixel keeps the code size fixed.
    const clear = 4;
    const end = 5;
    const codes = [];
    for (let pixel = 0; pixel < size * size; pixel += 2) codes.push(clear, color, color);
    codes.push(end);
    let bits = 0;
    let count = 0;
    const data = [];
    for (const code of codes) {
      bits |= code << count;
      count += 3;
      while (count >= 8) {
        data.push(bits & 0xff);
        bits >>= 8;
        count -= 8;
      }
    }
    if (count > 0) data.push(bits & 0xff);
    for (let at = 0; at < data.length; at += 255) {
      const block = data.slice(at, at + 255);
      bytes.push(block.length, ...block);
    }
    bytes.push(0);
  }
  bytes.push(0x3b);
  return Buffer.from(bytes);
}
