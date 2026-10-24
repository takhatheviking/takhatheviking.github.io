/*!
 * Ribbon — WebGL light-ribbon background (no dependencies).
 * A twisted sheet made of hundreds of thin strands. In dark mode strands are
 * blended additively, so where the sheet turns edge-on they pile up into a hot
 * bright knot. The shape morphs between per-section keyframes while scrolling.
 *
 * Ribbon.create(canvas, {
 *   keyframes: [{ el, at, state }],   // state: see STATE_KEYS
 *   colors: [[r,g,b] x4],             // 0..1: main, hot, mid, cool
 *   bg: [r,g,b], light: false, mobile: false, reducedMotion: false, density: 1
 * }) -> { measure(), destroy() }       // throws if WebGL is unavailable
 */
(function () {
  "use strict";

  var STATE_KEYS = [
    "p0", "p1", "p2", "p3", "width", "twist", "twistPhase", "pinch", "pinchT",
    "wobble", "defocus", "intensity", "hue", "ox", "oy", "rot", "scale",
  ];

  function lerpState(a, b, f, out) {
    for (var i = 0; i < STATE_KEYS.length; i++) {
      var k = STATE_KEYS[i], va = a[k], vb = b[k];
      if (Array.isArray(va)) {
        var o = out[k] || (out[k] = [0, 0, 0]);
        for (var j = 0; j < 3; j++) o[j] = va[j] + (vb[j] - va[j]) * f;
      } else {
        out[k] = va + (vb - va) * f;
      }
    }
    return out;
  }
  function cloneState(s) { return lerpState(s, s, 0, {}); }
  function smooth(x) { return x * x * (3 - 2 * x); }

  /* ───────── GLSL (ES 1.00, works in WebGL1 and WebGL2) ───────── */

  var SPINE = [
    "uniform float uTime;",
    "uniform vec3 uP0, uP1, uP2, uP3;",
    "uniform float uWidth, uTwist, uTwistPhase, uPinch, uPinchT, uWobble, uVel;",
    "vec3 bez(float t) {",
    "  float it = 1.0 - t;",
    "  return it*it*it*uP0 + 3.0*it*it*t*uP1 + 3.0*it*t*t*uP2 + t*t*t*uP3;",
    "}",
    "vec3 spine(float t) {",
    "  vec3 p = bez(t);",
    "  p.y += uWobble * 0.16 * sin(t * 5.0 + uTime * 0.31);",
    "  p.x += uWobble * 0.10 * sin(t * 3.0 - uTime * 0.23 + 1.3);",
    "  p.z += uWobble * 0.30 * cos(t * 4.0 + uTime * 0.27);",
    "  return p;",
    "}",
    "vec3 strandPos(float t, float s, vec4 r) {",
    "  vec3 c = spine(t);",
    "  vec3 tg = normalize(spine(t + 0.002) - spine(t - 0.002));",
    "  vec3 n0 = normalize(cross(tg, vec3(0.0, 0.0, 1.0)));",
    "  vec3 b0 = cross(tg, n0);",
    "  float th = uTwist * (t - 0.5) * 6.2831 + uTwistPhase + 0.5 * sin(t * 3.1 + uTime * 0.19);",
    "  vec3 dir = cos(th) * n0 + sin(th) * b0;",
    "  vec3 nrm = -sin(th) * n0 + cos(th) * b0;",
    "  float pinch = 1.0 - uPinch * exp(-pow((t - uPinchT) / 0.14, 2.0));",
    "  float W = uWidth * pinch;",
    "  float ruffle = 0.07 + uVel * 0.22;",
    "  float lat = s + ruffle * sin(t * (4.0 + r.x * 5.0) + r.y * 6.2831 + uTime * (0.25 + r.z * 0.35));",
    "  float dep = (r.w - 0.5) * 0.4 + 0.06 * sin(t * 7.0 + r.x * 9.0 + uTime * 0.4);",
    "  return c + dir * lat * W + nrm * dep * W;",
    "}",
  ].join("\n");

  var COMMON = [
    "uniform mat4 uMVP;",
    "uniform vec2 uRes, uMouse;",
    "uniform float uDpr, uDefocus, uIntensity, uHue, uMouseF;",
    "uniform vec3 uC0, uC1, uC2, uC3;",
    "vec4 toClip(vec3 p) { return uMVP * vec4(p, 1.0); }",
    "vec2 mousePush(vec2 ndc) {",
    "  vec2 asp = vec2(uRes.x / uRes.y, 1.0);",
    "  vec2 d = (ndc - uMouse) * asp;",
    "  float f = exp(-dot(d, d) * 9.0) * uMouseF;",
    "  return ndc + normalize(d + 1e-5) / asp * f * 0.05;",
    "}",
    "vec3 strandColor(float s, vec4 r) {",
    "  float band = smoothstep(0.05, 0.3, s) * (1.0 - smoothstep(0.42, 0.7, s));",
    "  float cool = clamp(band * (0.55 + 0.45 * r.z) + uHue * 0.35 * r.y, 0.0, 1.0);",
    "  vec3 col = mix(uC0, mix(uC2, uC3, r.w), cool);",
    "  return mix(col, uC1, pow(r.x, 5.0) * 0.85);",
    "}",
  ].join("\n");

  var STRAND_VERT = [
    "precision highp float;",
    SPINE, COMMON,
    "attribute float aT;",
    "attribute float aSide;",
    "attribute float aS;",
    "attribute vec4 aR;",
    "varying float vD;",
    "varying float vA;",
    "varying float vHw;",
    "varying vec3 vCol;",
    "void main() {",
    "  float e = 0.004;",
    "  vec4 c = toClip(strandPos(aT, aS, aR));",
    "  vec4 ca = toClip(strandPos(max(aT - e, 0.0), aS, aR));",
    "  vec4 cb = toClip(strandPos(min(aT + e, 1.0), aS, aR));",
    "  vec2 n = mousePush(c.xy / c.w);",
    "  vec2 na = mousePush(ca.xy / ca.w);",
    "  vec2 nb = mousePush(cb.xy / cb.w);",
    "  vec2 dir = normalize((nb - na) * uRes + 1e-6);",
    "  vec2 nrm = vec2(-dir.y, dir.x);",
    "  float hw = (3.5 + uDefocus * 5.0) * uDpr;",
    "  gl_Position = vec4((n + nrm * aSide * hw / uRes * 2.0) * c.w, c.z, c.w);",
    "  vD = aSide;",
    "  vHw = hw;",
    "  float b = 0.16 + 0.84 * pow(aR.x, 3.0);",
    "  float flow = 0.5 + 0.5 * sin(aT * 9.0 - uTime * (0.8 + uVel * 4.0) + aR.y * 30.0);",
    "  float ends = smoothstep(0.0, 0.14, aT) * smoothstep(1.0, 0.84, aT);",
    "  vA = b * (0.45 + 0.55 * flow) * ends * uIntensity;",
    "  vCol = strandColor(aS, aR);",
    "}",
  ].join("\n");

  var STRAND_FRAG = [
    "precision highp float;",
    "uniform float uDpr, uDefocus, uLight;",
    "varying float vD;",
    "varying float vA;",
    "varying float vHw;",
    "varying vec3 vCol;",
    "void main() {",
    "  float px = abs(vD) * vHw;",
    "  float coreW = mix(0.8, 2.2, uDefocus) * uDpr;",
    "  float glowW = mix(2.6, 6.0, uDefocus) * uDpr;",
    "  float core = exp(-px * px / (coreW * coreW));",
    "  float glow = exp(-px * px / (glowW * glowW)) * 0.16;",
    "  float a = (core + glow) * vA * mix(1.0, 0.75, uDefocus) * 0.55;",
    "  vec3 col = mix(vCol, vCol * 0.62, uLight);",
    "  gl_FragColor = vec4(col, a * mix(1.0, 0.8, uLight));",
    "}",
  ].join("\n");

  var DUST_VERT = [
    "precision highp float;",
    SPINE, COMMON,
    "attribute float aT;",
    "attribute float aS;",
    "attribute float aKind;",
    "attribute vec4 aR;",
    "varying float vA;",
    "varying float vKind;",
    "varying vec3 vCol;",
    "void main() {",
    "  float t = fract(aT + uTime * 0.006 * (0.4 + aR.z));",
    "  vec3 p = strandPos(t, aS, aR);",
    "  float spread = aKind > 0.5 ? 2.6 : 0.9;",
    "  p += (aR.xyz - 0.5) * vec3(0.5, 0.5, 1.2) * uWidth * spread;",
    "  vec4 c = toClip(p);",
    "  c.xy = mousePush(c.xy / c.w) * c.w;",
    "  gl_Position = c;",
    "  float size = aKind > 0.5 ? mix(9.0, 30.0, aR.w) : mix(1.2, 2.8, aR.w);",
    "  gl_PointSize = size * uDpr * (1.0 + uDefocus * 1.2);",
    "  float tw = 0.35 + 0.65 * pow(0.5 + 0.5 * sin(uTime * (0.8 + aR.x * 2.5) + aR.y * 40.0), 2.0);",
    "  float ends = smoothstep(0.0, 0.1, t) * smoothstep(1.0, 0.9, t);",
    "  vA = tw * ends * uIntensity;",
    "  vKind = aKind;",
    "  vCol = strandColor(aS, aR);",
    "}",
  ].join("\n");

  var DUST_FRAG = [
    "precision highp float;",
    "uniform float uDefocus, uLight;",
    "varying float vA;",
    "varying float vKind;",
    "varying vec3 vCol;",
    "void main() {",
    "  float d = length(gl_PointCoord - 0.5) * 2.0;",
    "  float a = vKind > 0.5",
    "    ? smoothstep(1.0, 0.75, d) * 0.07",
    "    : exp(-d * d * 5.0) * mix(0.9, 0.35, uDefocus);",
    "  vec3 col = mix(vCol, vCol * 0.62, uLight);",
    "  gl_FragColor = vec4(col, a * vA * mix(1.0, 0.6, uLight));",
    "}",
  ].join("\n");

  /* ───────── Geometry ───────── */

  function rng(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s + 0x6d2b79f5) >>> 0;
      var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // interleaved: aT, aSide, aS, r0..r3  (7 floats)
  function buildStrands(count, segs, rand) {
    var verts = count * (segs + 1) * 2;
    var data = new Float32Array(verts * 7);
    var index = new Uint32Array(count * segs * 6);
    var v = 0, ii = 0;
    for (var k = 0; k < count; k++) {
      var u = (k + rand()) / count;
      var s = Math.sign(u - 0.5) * Math.pow(Math.abs(u - 0.5) * 2, 0.85);
      var r = [rand(), rand(), rand(), rand()];
      var base = v;
      for (var j = 0; j <= segs; j++) {
        for (var side = -1; side <= 1; side += 2) {
          data.set([j / segs, side, s, r[0], r[1], r[2], r[3]], v * 7);
          v++;
        }
      }
      for (j = 0; j < segs; j++) {
        var a = base + j * 2;
        index.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], ii);
        ii += 6;
      }
    }
    return { data: data, index: index, count: index.length };
  }

  // interleaved: aT, aS, aKind, r0..r3  (7 floats)
  function buildDust(count, bokeh, rand) {
    var n = count + bokeh;
    var data = new Float32Array(n * 7);
    for (var i = 0; i < n; i++) {
      data.set([rand(), rand() * 2.4 - 1.2, i < count ? 0 : 1, rand(), rand(), rand(), rand()], i * 7);
    }
    return { data: data, count: n };
  }

  /* ───────── WebGL helpers ───────── */

  function compile(gl, type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
    return sh;
  }
  function program(gl, vs, fs) {
    var p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    var u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < n; i++) {
      var info = gl.getActiveUniform(p, i);
      u[info.name.replace(/\[0\]$/, "")] = gl.getUniformLocation(p, info.name);
    }
    return { p: p, u: u };
  }

  function perspective(fovy, aspect, near, far) {
    var f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
  }
  function mul(a, b) {
    var o = new Array(16);
    for (var c = 0; c < 4; c++) {
      for (var r = 0; r < 4; r++) {
        o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      }
    }
    return o;
  }

  /* ───────── Engine ───────── */

  function create(canvas, opts) {
    var keyframes = opts.keyframes;
    var mobile = !!opts.mobile, reducedMotion = !!opts.reducedMotion, light = !!opts.light;
    var density = opts.density || 1;
    var colors = opts.colors;
    var bg = opts.bg || [0.016, 0.016, 0.016];

    var ctxOpts = { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: "high-performance" };
    var gl = canvas.getContext("webgl2", ctxOpts);
    var isGL2 = !!gl;
    if (!gl) gl = canvas.getContext("webgl", ctxOpts) || canvas.getContext("experimental-webgl", ctxOpts);
    if (!gl) throw new Error("WebGL unavailable");
    var uintOk = isGL2 || !!gl.getExtension("OES_element_index_uint");

    var nStr = Math.round((mobile ? 120 : 240) * density);
    var segs = mobile ? 120 : 180;
    if (!uintOk) { nStr = Math.min(nStr, 150); segs = Math.min(segs, Math.floor(65535 / (nStr * 2)) - 1); }

    var rand = rng(7);
    var strands = buildStrands(nStr, segs, rand);
    var dust = buildDust(Math.round((mobile ? 500 : 1400) * density), mobile ? 18 : 40, rand);
    var indexArr = uintOk ? strands.index : new Uint16Array(strands.index);

    var sp = program(gl, STRAND_VERT, STRAND_FRAG);
    var dp = program(gl, DUST_VERT, DUST_FRAG);

    var sBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, sBuf);
    gl.bufferData(gl.ARRAY_BUFFER, strands.data, gl.STATIC_DRAW);
    var iBuf = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, iBuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indexArr, gl.STATIC_DRAW);
    var dBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, dBuf);
    gl.bufferData(gl.ARRAY_BUFFER, dust.data, gl.STATIC_DRAW);

    function attribs(prog, layout) {
      var off = 0, out = [];
      for (var i = 0; i < layout.length; i++) {
        out.push({ loc: gl.getAttribLocation(prog.p, layout[i][0]), size: layout[i][1], off: off });
        off += layout[i][1] * 4;
      }
      return out;
    }
    var sAttr = attribs(sp, [["aT", 1], ["aSide", 1], ["aS", 1], ["aR", 4]]);
    var dAttr = attribs(dp, [["aT", 1], ["aS", 1], ["aKind", 1], ["aR", 4]]);
    function bindAttr(buf, list) {
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      for (var i = 0; i < 8; i++) gl.disableVertexAttribArray(i);
      for (i = 0; i < list.length; i++) {
        if (list[i].loc < 0) continue;
        gl.enableVertexAttribArray(list[i].loc);
        gl.vertexAttribPointer(list[i].loc, list[i].size, gl.FLOAT, false, 28, list[i].off);
      }
    }

    var current = cloneState(keyframes[0].state);
    var target = cloneState(keyframes[0].state);

    /* size */
    var W = 1, H = 1, aspect = 1, dpr = 1, proj = perspective(35 * Math.PI / 180, 1, 0.1, 60);
    function resize() {
      W = window.innerWidth; H = window.innerHeight; aspect = W / H;
      dpr = Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 1.75);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
      proj = perspective(35 * Math.PI / 180, aspect, 0.1, 60);
      measure();
    }

    /* scroll keyframes */
    var anchors = [];
    function measure() {
      var sy = window.scrollY;
      anchors = keyframes.map(function (k) {
        if (!k.el) return 0;
        var parent = k.el.parentElement;
        var node = parent && parent.classList.contains("pin-spacer") ? parent : k.el;
        return node.getBoundingClientRect().top + sy - H * (k.at == null ? 0.4 : k.at);
      });
    }
    function computeTarget() {
      var y = window.scrollY, n = keyframes.length;
      if (n === 1 || y <= anchors[0]) return lerpState(keyframes[0].state, keyframes[0].state, 0, target);
      for (var i = 0; i < n - 1; i++) {
        if (y < anchors[i + 1]) {
          var span = Math.max(anchors[i + 1] - anchors[i], 1);
          var f = smooth(Math.min(Math.max((y - anchors[i]) / span, 0), 1));
          return lerpState(keyframes[i].state, keyframes[i + 1].state, f, target);
        }
      }
      return lerpState(keyframes[n - 1].state, keyframes[n - 1].state, 0, target);
    }

    /* mouse */
    var mouse = { x: 9, y: 9, tx: 9, ty: 9 };
    function onPointer(e) {
      if (e.pointerType && e.pointerType !== "mouse") return;
      mouse.tx = (e.clientX / W) * 2 - 1;
      mouse.ty = -((e.clientY / H) * 2 - 1);
      if (mouse.x > 5) { mouse.x = mouse.tx; mouse.y = mouse.ty; }
    }
    window.addEventListener("pointermove", onPointer, { passive: true });

    /* frame */
    var raf = 0, last = performance.now(), time = 0, lastY = window.scrollY, vel = 0, running = true, blurPx = -1;

    function setCommon(prog, s, mvp) {
      var u = prog.u;
      gl.useProgram(prog.p);
      gl.uniformMatrix4fv(u.uMVP, false, mvp);
      gl.uniform1f(u.uTime, time);
      gl.uniform1f(u.uVel, reducedMotion ? 0 : vel);
      gl.uniform3fv(u.uP0, s.p0); gl.uniform3fv(u.uP1, s.p1);
      gl.uniform3fv(u.uP2, s.p2); gl.uniform3fv(u.uP3, s.p3);
      gl.uniform1f(u.uWidth, s.width); gl.uniform1f(u.uTwist, s.twist);
      gl.uniform1f(u.uTwistPhase, s.twistPhase); gl.uniform1f(u.uPinch, s.pinch);
      gl.uniform1f(u.uPinchT, s.pinchT); gl.uniform1f(u.uWobble, s.wobble);
      gl.uniform2f(u.uRes, canvas.width, canvas.height);
      gl.uniform2f(u.uMouse, mouse.x, mouse.y);
      gl.uniform1f(u.uDpr, dpr);
      gl.uniform1f(u.uDefocus, s.defocus);
      gl.uniform1f(u.uIntensity, s.intensity);
      gl.uniform1f(u.uHue, s.hue);
      gl.uniform1f(u.uMouseF, mobile ? 0 : 1);
      gl.uniform1f(u.uLight, light ? 1 : 0);
      gl.uniform3fv(u.uC0, colors[0]); gl.uniform3fv(u.uC1, colors[1]);
      gl.uniform3fv(u.uC2, colors[2]); gl.uniform3fv(u.uC3, colors[3]);
    }

    function render(s) {
      // strong defocus is a CSS blur on the canvas — far cheaper than widening strands
      var b = Math.round(s.defocus * 22 * 2) / 2;
      if (b !== blurPx) { blurPx = b; canvas.style.filter = b > 0.5 ? "blur(" + b + "px)" : "none"; }

      var portrait = aspect < 1;
      var fit = portrait ? 0.55 + aspect * 0.25 : 1;
      var sc = s.scale * fit, rot = s.rot + (portrait ? 0.5 : 0);
      var ox = portrait ? s.ox * 0.4 + 0.45 : s.ox, oy = s.oy;
      var c = Math.cos(rot) * sc, sn = Math.sin(rot) * sc;
      var mv = [c, sn, 0, 0, -sn, c, 0, 0, 0, 0, sc, 0, ox, oy, -6, 1];
      var mvp = new Float32Array(mul(proj, mv));

      gl.clearColor(bg[0], bg[1], bg[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      if (light) gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      else gl.blendFunc(gl.SRC_ALPHA, gl.ONE);

      setCommon(sp, s, mvp);
      bindAttr(sBuf, sAttr);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, iBuf);
      gl.drawElements(gl.TRIANGLES, strands.count, uintOk ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, 0);

      setCommon(dp, s, mvp);
      bindAttr(dBuf, dAttr);
      gl.drawArrays(gl.POINTS, 0, dust.count);
    }

    function frame(now) {
      raf = requestAnimationFrame(frame);
      var dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      if (!reducedMotion) time += dt;
      var y = window.scrollY;
      var v = Math.min(Math.abs(y - lastY) / Math.max(dt, 1e-3) / 4000, 1);
      lastY = y;
      vel += (v - vel) * (v > vel ? 0.2 : 0.04);
      computeTarget();
      lerpState(current, target, reducedMotion ? 1 : 1 - Math.pow(0.0015, dt), current);
      mouse.x += (mouse.tx - mouse.x) * 0.08;
      mouse.y += (mouse.ty - mouse.y) * 0.08;
      render(current);
    }

    function onVisibility() {
      if (document.hidden && running) { cancelAnimationFrame(raf); running = false; }
      else if (!document.hidden && !running) { running = true; last = performance.now(); raf = requestAnimationFrame(frame); }
    }
    function onLost(e) { e.preventDefault(); cancelAnimationFrame(raf); running = false; if (opts.onLost) opts.onLost(); }
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("resize", resize);
    canvas.addEventListener("webglcontextlost", onLost);

    resize();
    computeTarget();
    lerpState(target, target, 0, current);
    raf = requestAnimationFrame(frame);

    return {
      measure: measure,
      destroy: function () {
        cancelAnimationFrame(raf);
        window.removeEventListener("pointermove", onPointer);
        window.removeEventListener("resize", resize);
        document.removeEventListener("visibilitychange", onVisibility);
        canvas.removeEventListener("webglcontextlost", onLost);
      },
    };
  }

  window.Ribbon = { create: create, STATE_KEYS: STATE_KEYS };
})();
