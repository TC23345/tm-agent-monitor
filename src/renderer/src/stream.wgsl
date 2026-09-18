// The burn-rate stream on a quota bar: streaks of light travelling along the
// filled part of the bar, as many and as fast as the projected pace says.
// `packStream` (@shared/burnStream.mjs) fills this exact layout — head is
// (time s, css width, css height, streak count); a is (speed css px/s, fill
// 0..1, css px per canvas px x, same y); color is the tint (lightened here).
// Output is premultiplied so the canvas composes over the bar's own fill.

struct Stream {
  head: vec4f,
  a: vec4f,
  color: vec4f,
}

@group(0) @binding(0) var<uniform> s: Stream;

struct VOut {
  @builtin(position) pos: vec4f,
}

@vertex
fn vs(@builtin(vertex_index) i: u32) -> VOut {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var o: VOut;
  o.pos = vec4f(p[i], 0.0, 1.0);
  return o;
}

fn hash1(n: f32) -> f32 {
  return fract(sin(n * 12.9898) * 43758.5453);
}

@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let t = s.head.x;
  let w = s.head.y;
  let h = s.head.z;
  let count = u32(s.head.w);
  let speed = s.a.x;
  let fill = max(s.a.y * w, 1.0);
  let p = pos.xy * s.a.zw;
  var sum = 0.0;
  for (var i = 0u; i < 40u; i = i + 1u) {
    if (i >= count) { break; }
    let fi = f32(i);
    let phase = hash1(fi + 1.0);
    let lane = 0.3 + 0.4 * hash1(fi + 7.0);
    let len = 6.0 + 10.0 * hash1(fi + 3.0);
    // Head position: wraps along the filled length at `speed` px/s.
    let x = fract(phase + t * speed / fill) * fill;
    let y = lane * h;
    let dx = p.x - x;
    let dy = (p.y - y) / max(h * 0.28, 0.5);
    // A streak: bright at the head, fading back over `len`, soft across.
    var along = 0.0;
    if (dx <= 0.0 && dx > -len) { along = 1.0 + dx / len; }
    let k = along * exp(-dy * dy * 2.0);
    sum = sum + k * (0.35 + 0.45 * hash1(fi + 11.0));
  }
  let alpha = 1.0 - exp(-sum);
  let tint = mix(s.color.xyz, vec3f(1.0), 0.55);
  return vec4f(tint * alpha, alpha);
}
