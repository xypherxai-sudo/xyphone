// Creates minimal valid PNG icons without any npm dependencies
// Uses raw PNG encoding (pure Node.js, no external packages)
// Run: node create-icons-inline.js

const fs = require('fs');
const zlib = require('zlib');

function createPNG(width, height, drawFn) {
  // Create RGBA pixel buffer
  const pixels = new Uint8Array(width * height * 4);

  // Fill background: #0f0f1e
  for (let i = 0; i < width * height; i++) {
    pixels[i * 4 + 0] = 0x0f; // R
    pixels[i * 4 + 1] = 0x0f; // G
    pixels[i * 4 + 2] = 0x1e; // B
    pixels[i * 4 + 3] = 0xff; // A
  }

  drawFn(pixels, width, height);

  // Build PNG raw data (filter byte 0 per row)
  const rowSize = width * 4;
  const rawData = Buffer.alloc(height * (rowSize + 1));
  for (let y = 0; y < height; y++) {
    rawData[y * (rowSize + 1)] = 0; // filter type: None
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * 4;
      const dstIdx = y * (rowSize + 1) + 1 + x * 4;
      rawData[dstIdx + 0] = pixels[srcIdx + 0];
      rawData[dstIdx + 1] = pixels[srcIdx + 1];
      rawData[dstIdx + 2] = pixels[srcIdx + 2];
      rawData[dstIdx + 3] = pixels[srcIdx + 3];
    }
  }

  const compressed = zlib.deflateSync(rawData, { level: 9 });

  // PNG Signature
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  function chunk(type, data) {
    const typeBuf = Buffer.from(type, 'ascii');
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(data.length, 0);
    const combined = Buffer.concat([typeBuf, data]);
    const crc = crc32(combined);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc >>> 0, 0);
    return Buffer.concat([lenBuf, combined, crcBuf]);
  }

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // IDAT
  const idat = compressed;

  // IEND
  const iend = Buffer.alloc(0);

  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', iend)]);
}

// CRC32 table
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function setPixel(pixels, width, x, y, r, g, b, a = 255) {
  if (x < 0 || x >= width || y < 0 || y >= pixels.length / width / 4) return;
  const i = (Math.round(y) * width + Math.round(x)) * 4;
  pixels[i] = r;
  pixels[i + 1] = g;
  pixels[i + 2] = b;
  pixels[i + 3] = a;
}

function fillCircle(pixels, width, height, cx, cy, radius, r, g, b) {
  for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y++) {
    for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x++) {
      const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      if (dist <= radius) {
        setPixel(pixels, width, x, y, r, g, b);
      }
    }
  }
}

function pointInHexagon(px, py, cx, cy, r) {
  // Regular hexagon with flat-top (pointy-top rotated -30deg)
  const dx = Math.abs(px - cx);
  const dy = Math.abs(py - cy);
  return dx <= r * Math.sqrt(3) / 2 && dy <= r && r * dy + r * Math.sqrt(3) / 2 * dx <= r * r * Math.sqrt(3) / 2 * 1;
}

function fillHexagon(pixels, width, height, cx, cy, r, red, green, blue) {
  const x0 = Math.floor(cx - r - 1);
  const x1 = Math.ceil(cx + r + 1);
  const y0 = Math.floor(cy - r - 1);
  const y1 = Math.ceil(cy + r + 1);

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      // Check if point is inside hexagon (pointy-top)
      // Use 6 half-planes
      let inside = true;
      for (let i = 0; i < 6; i++) {
        const a1 = Math.PI / 180 * (60 * i - 30);
        const a2 = Math.PI / 180 * (60 * (i + 1) - 30);
        const nx = -(Math.sin(a1) + Math.sin(a2));
        const ny = (Math.cos(a1) + Math.cos(a2));
        const dx = x - cx, dy = y - cy;
        if (nx * dx + ny * dy > r * Math.sqrt(3)) { inside = false; break; }
      }
      if (inside) {
        setPixel(pixels, width, x, y, red, green, blue);
      }
    }
  }
}

function drawX(pixels, width, height, cx, cy, size, thick, r, g, b) {
  const halfSize = size / 2;
  const halfThick = thick / 2;

  for (let y = Math.floor(cy - halfSize); y <= Math.ceil(cy + halfSize); y++) {
    for (let x = Math.floor(cx - halfSize); x <= Math.ceil(cx + halfSize); x++) {
      const dx = x - cx;
      const dy = y - cy;
      // Two diagonals: y = x and y = -x
      const dist1 = Math.abs(dy - dx) / Math.sqrt(2);
      const dist2 = Math.abs(dy + dx) / Math.sqrt(2);
      if ((dist1 < halfThick || dist2 < halfThick) && Math.abs(dx) <= halfSize && Math.abs(dy) <= halfSize) {
        setPixel(pixels, width, x, y, r, g, b);
      }
    }
  }
}

function drawIcon(pixels, width, height) {
  const cx = width / 2;
  const cy = height / 2;
  const hexR = width * 0.38;

  // Fill hexagon with purple #7c3aed
  fillHexagon(pixels, width, height, cx, cy, hexR, 0x7c, 0x3a, 0xed);

  // Draw white X
  const xSize = hexR * 0.52;
  const xThick = hexR * 0.18;
  drawX(pixels, width, height, cx, cy, xSize * 2, xThick, 255, 255, 255);
}

// Generate both sizes
for (const size of [192, 512]) {
  const png = createPNG(size, size, drawIcon);
  fs.writeFileSync(__dirname + `/icon-${size}.png`, png);
  console.log(`✅ icon-${size}.png erstellt (${png.length} Bytes)`);
}

console.log('\n✅ Icons erfolgreich generiert!');
