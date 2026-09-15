/**
 * A count badge drawn straight into a BGRA bitmap — no canvas, no SVG (Electron's
 * nativeImage decodes PNG/JPEG only, and the main process has no DOM). Used for
 * the tray icon (badge over the app glyph) and the taskbar overlay (badge on a
 * transparent square). Pure and tested.
 *
 * Glyphs are a 3×5 pixel font for the digits and '+', scaled to fit the badge.
 */

const GLYPHS = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '001', '001', '001'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
  '+': ['000', '010', '111', '010', '000']
}

/** Set one BGRA pixel (premultiplied alpha) if it is inside the bitmap. */
function put(buf, width, height, x, y, b, g, r, a) {
  if (x < 0 || y < 0 || x >= width || y >= height) return
  const i = (y * width + x) * 4
  buf[i] = b; buf[i + 1] = g; buf[i + 2] = r; buf[i + 3] = a
}

/**
 * Draw `label` (from `badgeLabel`) as a red disc with white text in the bottom
 * right of a `width`×`height` BGRA buffer, in place. An empty label draws
 * nothing. `scale` is the pixel size of one glyph cell; the disc fits the text.
 */
export function drawBadge(buf, width, height, label, { scale } = {}) {
  if (!label) return buf
  const s = Math.max(1, Math.floor(scale ?? Math.max(1, Math.round(height / 16))))
  const cols = label.length * 3 + (label.length - 1)
  const textW = cols * s
  const textH = 5 * s
  const pad = s
  const discW = textW + pad * 2 + s
  const discH = textH + pad * 2
  const x0 = width - discW
  const y0 = height - discH
  const rad = Math.floor(discH / 2)
  // Disc: a rounded rectangle — full rows in the middle, corners cut by radius.
  for (let y = 0; y < discH; y++) {
    for (let x = 0; x < discW; x++) {
      const cx = x < rad ? rad - x : x >= discW - rad ? x - (discW - rad - 1) : 0
      const cy = y < rad ? rad - y : y >= discH - rad ? y - (discH - rad - 1) : 0
      if (cx * cx + cy * cy > rad * rad) continue
      put(buf, width, height, x0 + x, y0 + y, 0x3c, 0x3c, 0xe0, 0xff)
    }
  }
  // Text, centered in the disc.
  let tx = x0 + Math.floor((discW - textW) / 2)
  const ty = y0 + Math.floor((discH - textH) / 2)
  for (const ch of label) {
    const rows = GLYPHS[ch] ?? GLYPHS['0']
    for (let gy = 0; gy < 5; gy++) {
      for (let gx = 0; gx < 3; gx++) {
        if (rows[gy][gx] !== '1') continue
        for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) put(buf, width, height, tx + gx * s + dx, ty + gy * s + dy, 0xff, 0xff, 0xff, 0xff)
      }
    }
    tx += 4 * s
  }
  return buf
}

/** A transparent `size`×`size` BGRA buffer. */
export function blankBitmap(size) {
  return Buffer.alloc(size * size * 4)
}
