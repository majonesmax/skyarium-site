// A ghost flight's way and timing (D298), as the app flies it (Tailspot/Sky/GhostFlight+Path.swift, GhostPath with no
// runway known): rolling about 12 minutes after its gate time, climbing out, cruising, down the glide path, landing on
// time. The page can't know the wind, so the first and last few miles may differ from the app's by a minute or two.
// tools/ghosts/path_fixture.mjs writes points from this for GhostFlightTests to check the app against.
(function () {
  const R = 6_371_008.8, PER_DEGREE = 111_320, KT = 0.514444, NM = 1_852, RAD = Math.PI / 180;
  const TAXI_OUT = 12 * 60, TAXI_IN = 5 * 60, TAXI_MIN = 3 * 60, TAXI_MAX = 20 * 60, FADE = 20;
  const LIFTOFF_KT = 150, FINAL_KT = 140, LOW_KT = 250, TURN_OFF_KT = 20;
  const STRAIGHT_OUT = 5_000, TURN_RADIUS = 3_000, FINAL = 18_520;
  const CLIMB_FT_NM = 480, GLIDE_FT_NM = 318, ROLLOUT = 1_500, TOUCHDOWN = 300;
  const GIVE = [0.85, 1.2];

  const unit = (lat, lon) => [Math.cos(lat * RAD) * Math.cos(lon * RAD), Math.cos(lat * RAD) * Math.sin(lon * RAD), Math.sin(lat * RAD)];
  const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const clamp1 = (x) => Math.min(Math.max(x, -1), 1);
  const latLon = (v) => [Math.asin(clamp1(v[2])) / RAD, Math.atan2(v[1], v[0]) / RAD];
  function slerp(a, b, t) {
    const w = Math.acos(clamp1(dot(a, b)));
    if (w <= 1e-9) return a;
    const s = Math.sin(w), p = a.map((x, i) => (Math.sin((1 - t) * w) * x + Math.sin(t * w) * b[i]) / s);
    const n = Math.hypot(...p);
    return p.map((x) => x / n);
  }
  const distance = (p, q) => Math.acos(clamp1(dot(unit(p[0], p[1]), unit(q[0], q[1])))) * R;
  const offset = (p, v) => [p[0] + v[1] / PER_DEGREE, p[1] + v[0] / (PER_DEGREE * Math.cos(p[0] * RAD))];
  const metres = (p, q) => [(q[1] - p[1]) * PER_DEGREE * Math.cos(p[0] * RAD), (q[0] - p[0]) * PER_DEGREE];
  function bearing(p, q) {
    const f1 = p[0] * RAD, f2 = q[0] * RAD, d = (q[1] - p[1]) * RAD;
    const v = [Math.sin(d) * Math.cos(f2), Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(d)];
    const n = Math.hypot(...v);
    return n > 0 ? [v[0] / n, v[1] / n] : [0, 1];
  }
  const rotate = (v, a) => [v[0] * Math.cos(a) - v[1] * Math.sin(a), v[0] * Math.sin(a) + v[1] * Math.cos(a)];

  function turn(p, h0, target) {
    const b = bearing(p, target), k = Math.min(distance(p, target), 2_000_000), t = [b[0] * k, b[1] * k];
    const left = h0[0] * t[1] - h0[1] * t[0] > 0, step = (left ? 5 : -5) * RAD;
    const centre = [-h0[1] * (left ? TURN_RADIUS : -TURN_RADIUS), h0[0] * (left ? TURN_RADIUS : -TURN_RADIUS)];
    if (Math.hypot(t[0] - centre[0], t[1] - centre[1]) <= TURN_RADIUS * 1.05) return [];
    let q = [0, 0], h = h0;
    const out = [];
    for (let i = 0; i < 72; i++) {
      const d = [t[0] - q[0], t[1] - q[1]], n = Math.hypot(...d), toward = [d[0] / n, d[1] / n];
      if (Math.acos(clamp1(h[0] * toward[0] + h[1] * toward[1])) <= Math.abs(step) / 2) break;
      if ((h[0] * toward[1] - h[1] * toward[0] > 0) !== left) break;
      const r = rotate([q[0] - centre[0], q[1] - centre[1]], step);
      q = [centre[0] + r[0], centre[1] + r[1]];
      h = rotate(h, step);
      out.push(offset(p, q));
    }
    return out;
  }

  function greatCircle(a, b) {
    const u = unit(a[0], a[1]), v = unit(b[0], b[1]);
    const n = Math.max(Math.trunc((Math.acos(clamp1(dot(u, v))) * R) / 20_000), 1);
    return Array.from({ length: n + 1 }, (_, i) => latLon(slerp(u, v, i / n)));
  }

  function stand(pos, other, leaving) {
    const d = bearing(pos, other);
    return { lat: pos[0], lon: pos[1], heading: leaving ? d : [-d[0], -d[1]], lengthM: 2_500, elevationFt: 0 };
  }

  function route(a, b) {
    const a0 = [a.lat, a.lon], b0 = [b.lat, b.lon], ah = a.heading, bh = b.heading;
    const scale = (v, k) => [v[0] * k, v[1] * k];
    const liftoff = offset(a0, scale(ah, Math.min(0.55 * a.lengthM, 2_200)));
    const out = offset(a0, scale(ah, a.lengthM + STRAIGHT_OUT));
    const final = offset(b0, scale(bh, -FINAL));
    const turnOut = turn(out, ah, final);
    const turnIn = turn(final, [-bh[0], -bh[1]], turnOut.at(-1) ?? out).reverse();
    const cruise = greatCircle(turnOut.at(-1) ?? out, turnIn[0] ?? final);
    const points = [a0, liftoff, out, ...turnOut, ...cruise.slice(1, -1), ...turnIn, final, b0];
    const touchdown = points.length;
    points.push(offset(b0, scale(bh, TOUCHDOWN)), offset(b0, scale(bh, TOUCHDOWN + ROLLOUT)));
    return { points, liftoff: 1, touchdown };
  }

  function altitudeFt(s, p) {
    if (s <= p.liftoffM) return p.fromFt;
    if (s >= p.touchdownM) return p.toFt;
    const up = p.fromFt + ((s - p.liftoffM) / NM) * CLIMB_FT_NM;
    const down = p.toFt + 50 + ((p.touchdownM - s) / NM) * GLIDE_FT_NM;
    return Math.min(Math.max(p.cruiseFt, p.fromFt, p.toFt), up, down);
  }

  function speedMps(s, p, cruiseKt) {
    const lift = LIFTOFF_KT * KT, fin = FINAL_KT * KT;
    if (s < p.liftoffM) return Math.max(Math.sqrt((lift * lift * s) / p.liftoffM), 3);
    if (s > p.touchdownM) {
      const slow = TURN_OFF_KT * KT, k = (fin * fin - slow * slow) / ROLLOUT;
      return Math.max(Math.sqrt(Math.max(fin * fin - k * (s - p.touchdownM), 0)), slow);
    }
    const alt = altitudeFt(s, p);
    const high = alt < 10_000 ? LOW_KT : LOW_KT + (cruiseKt - LOW_KT) * Math.min((alt - 10_000) / Math.max(p.cruiseFt - 10_000, 1), 1);
    const out = s - p.liftoffM, toGo = p.touchdownM - s;
    const climbing = out < 12_000 ? LIFTOFF_KT + ((LOW_KT - LIFTOFF_KT) * out) / 12_000 : Infinity;
    const landing = toGo < 15_000 ? FINAL_KT : toGo < 30_000 ? FINAL_KT + ((LOW_KT - FINAL_KT) * (toGo - 15_000)) / 15_000 : Infinity;
    return Math.min(high, climbing, landing) * KT;
  }

  function table(p, cruiseKt) {
    let s = 0, t = 0;
    const ss = [0], ts = [0];
    while (s < p.totalM) {
      const near = s < p.liftoffM + 40_000 || s > p.touchdownM - 40_000;
      const ds = Math.min(near ? 100 : 2_000, p.totalM - s);
      t += ds / speedMps(s + ds / 2, p, cruiseKt);
      s += ds;
      ss.push(s);
      ts.push(t);
    }
    return { s: ss, t: ts };
  }

  function index(xs, x) {
    let lo = 0, hi = xs.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (xs[mid] <= x) lo = mid;
      else hi = mid;
    }
    return lo;
  }
  const lerp = (xs, ys, x) => {
    const i = index(xs, x), f = (x - xs[i]) / Math.max(xs[i + 1] - xs[i], 1e-9);
    return ys[i] + f * (ys[i + 1] - ys[i]);
  };

  // A night file's flight → its way: `at(date)` where it is, and when it lifts off and touches down.
  function GhostPath(f) {
    const depart = Date.parse(f.depart) / 1000, arrive = Date.parse(f.arrive) / 1000;
    const a = stand(f.fromPos, f.toPos, true), b = stand(f.toPos, f.fromPos, false);
    const r = route(a, b);
    const along = [0];
    for (let i = 1; i < r.points.length; i++) along.push(along[i - 1] + distance(r.points[i - 1], r.points[i]));
    const p = {
      points: r.points, along, liftoffM: along[r.liftoff], touchdownM: along[r.touchdown], totalM: along.at(-1),
      fromFt: a.elevationFt, toFt: b.elevationFt, cruiseFt: f.cruiseFt,
    };
    const latest = arrive - TAXI_IN, target = latest - (depart + TAXI_OUT);
    let lo = GIVE[0], hi = GIVE[1];
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (table(p, f.cruiseKt * mid).t.at(-1) > target) lo = mid;
      else hi = mid;
    }
    p.cruiseKt = (f.cruiseKt * (lo + hi)) / 2;
    const tab = table(p, p.cruiseKt);
    p.rollToStop = tab.t.at(-1);
    p.rollStart = Math.min(Math.max(latest - p.rollToStop, depart + TAXI_MIN), depart + TAXI_MAX);
    const timeAt = (s) => (s <= 0 ? 0 : s >= p.totalM ? p.rollToStop : lerp(tab.s, tab.t, s));
    const metresAt = (t) => (t <= 0 ? 0 : t >= p.rollToStop ? p.totalM : lerp(tab.t, tab.s, t));
    const position = (s) => {
      const c = Math.min(Math.max(s, 0), p.totalM), i = index(along, c);
      const k = (c - along[i]) / Math.max(along[i + 1] - along[i], 1e-9), u = r.points[i], v = r.points[i + 1];
      return [u[0] + (v[0] - u[0]) * k, u[1] + (v[1] - u[1]) * k];
    };
    p.liftoff = new Date((p.rollStart + timeAt(p.liftoffM)) * 1000);
    p.touchdown = new Date((p.rollStart + timeAt(p.touchdownM)) * 1000);
    p.appears = new Date((p.rollStart - FADE) * 1000);
    p.gone = new Date((p.rollStart + p.rollToStop + FADE) * 1000);
    // Where it is at `date` (a Date): position, height (ft), track (degrees), whether it's airborne; null off the sky.
    p.at = (date) => {
      const sec = date.getTime() / 1000;
      if (sec < p.rollStart - FADE || sec > p.rollStart + p.rollToStop + FADE) return null;
      const s = metresAt(sec - p.rollStart), behind = Math.max(s - 40, 0), ahead = Math.min(s + 40, p.totalM);
      const d = metres(position(behind), position(Math.max(ahead, behind + 1)));
      return {
        lat: position(s)[0], lon: position(s)[1], altFt: altitudeFt(s, p),
        trackDeg: ((Math.atan2(d[0], d[1]) / RAD) % 360 + 360) % 360, airborne: s > p.liftoffM && s < p.touchdownM,
      };
    };
    return p;
  }
  GhostPath.distance = distance;
  GhostPath.bearing = bearing;
  GhostPath.bearingDeg = (p, q) => {
    const b = bearing(p, q);
    return ((Math.atan2(b[0], b[1]) / RAD) % 360 + 360) % 360;
  };
  globalThis.GhostPath = GhostPath;
})();
