// The session field: one soft glow per session row behind the sidebar.
// `packField` (@shared/sessionField.mjs) fills this exact layout — head is
// (time s, css px per canvas px x, same y, glow count); each glow is
// (x, y, rx, ry) in css px, (r, g, b, intensity), (motion, pulse, flare, seed).
// Output is premultiplied so the canvas composes over the translucent card.

struct Glow {
  a: vec4f,
  b: vec4f,
  c: vec4f,
}

struct Field {
  head: vec4f,
  glows: array<Glow, 24>,
}

@group(0) @binding(0) var<uniform> field: Field;

struct VOut {
  @builtin(position) pos: vec4f,
}

// One triangle covering the clip space; no vertex buffer.
@vertex
fn vs(@builtin(vertex_index) i: u32) -> VOut {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var o: VOut;
  o.pos = vec4f(p[i], 0.0, 1.0);
  return o;
}

fn hash(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
}

// Cheap value noise: enough grain to make a running glow look alive.
fn noise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = hash(i);
  let b = hash(i + vec2f(1.0, 0.0));
  let c = hash(i + vec2f(0.0, 1.0));
  let d = hash(i + vec2f(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let t = field.head.x;
  let count = u32(field.head.w);
  let p = pos.xy * field.head.yz;
  var rgb = vec3f(0.0);
  var sum = 0.0;
  for (var i = 0u; i < 24u; i = i + 1u) {
    if (i >= count) { break; }
    let g = field.glows[i];
    let motion = g.c.x;
    let pulse = g.c.y;
    let flare = g.c.z;
    let seed = g.c.w;
    let phase = seed * 6.2832;
    var centre = g.a.xy;
    var radius = g.a.zw;
    // A running glow wanders a little inside its row; the others hold still.
    centre = centre + motion * radius * vec2f(0.12 * sin(t * 0.6 + phase), 0.18 * cos(t * 0.8 + phase * 0.7));
    // Breathing: slow while running, quicker and deeper while waiting.
    let breathe = 1.0 + pulse * 0.3 * sin(t * (1.6 + 1.4 * pulse) + phase);
    radius = radius * (1.0 + flare * 0.9);
    let d = (p - centre) / radius;
    var k = exp(-dot(d, d) * 2.4);
    k = k * (0.8 + 0.2 * (1.0 - motion) + 0.2 * motion * noise(p * 0.02 + vec2f(t * 0.25, seed * 10.0)));
    let s = k * g.b.w * breathe * (1.0 + flare * 2.0);
    rgb = rgb + g.b.xyz * s;
    sum = sum + s;
  }
  // Soft cap: overlapping glows brighten toward, never past, full coverage.
  let alpha = 1.0 - exp(-sum);
  let tone = rgb / max(sum, 0.0001);
  return vec4f(tone * alpha, alpha);
}
