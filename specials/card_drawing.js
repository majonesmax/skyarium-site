// A flight card's drawing (D264): Open Liveries' own side view (its renderer, `openliveries_renderer.js`) of the
// scheme an airframe wears, on its type's measured shape, with our own marks for its logos. Run in a hidden web
// view by `CardDrawing.swift`, which sets `CARD_DATA` first: { liveries: card_liveries.json, shapes:
// plane_shapes.json, marks: marks.json, fonts: Fonts/stand_ins.json with each face's data } (all as parsed JSON). Also runs in Node, for tools/card_drawing_check.mjs.
(function (root) {
  'use strict';
  const OL = root.OpenLiveries;

  /** A compact shape (Open Liveries' tools/export_shapes.py: lines flat, in centimeters) back as a measured one. */
  function measured(id) {
    const data = root.CARD_DATA.shapes;
    const c = data.shapes[id];
    if (!c) return undefined;
    const m = (v) => v / 100;
    const line = (flat) => {
      const out = [];
      for (let i = 0; i + 1 < flat.length; i += 2) out.push([flat[i] / 100, flat[i + 1] / 100]);
      return out;
    };
    // A wing's `fair`: its flap track fairings, [y, front, back, depth, width] each.
    const surface = (s) => ({
      leading: line(s.le),
      trailing: line(s.te),
      z: line(s.z),
      ...(s.fair
        ? {
            fairings: s.fair.map(([y, x0, x1, depth, width]) => ({
              y: m(y),
              x: [m(x0), m(x1)],
              depth: m(depth),
              ...(width ? { width: m(width) } : {}),
            })),
          }
        : {}),
    });
    // A freighter's `wb`: where its passenger version's first and last window would be.
    const windows = (w) =>
      w && { z: [m(w.z[0]), m(w.z[1])], width: m(w.w), x: w.x.map(m), ...(w.wb ? { wouldBe: w.wb.map(m) } : {}) };
    const kinds = { d: 'door', e: 'exit', c: 'cargo' };
    const shape = {
      id,
      name: id,
      types: Object.keys(data.types).filter((t) => data.types[t].includes(id)),
      fuselage: { length: m(c.L), crown: line(c.crown), belly: line(c.belly), halfWidth: line(c.half) },
      fin: { leading: line(c.fin.le), trailing: line(c.fin.te) },
      stabilizer: surface(c.stab),
      wing: surface(c.wing),
      engines: c.eng.map((e) => {
        const out = { x: [m(e.x[0]), m(e.x[1])], y: m(e.y), top: line(e.top), bottom: line(e.bot) };
        if (e.cowl !== undefined) out.cowlEnd = m(e.cowl);
        if (e.m) out.mount = e.m;
        if (e.duct) out.duct = e.duct;
        if (e.half) out.halfWidth = line(e.half);
        if (e.inlet) out.inlet = { z: m(e.inlet[0]), width: m(e.inlet[1]), height: m(e.inlet[2]) };
        if (e.strut) out.strut = e.strut.map(m);
        if (e.nozzle) out.nozzle = { top: line(e.nozzle.top), bottom: line(e.nozzle.bot) };
        if (e.pylon)
          out.pylon = { leading: line(e.pylon.le), trailing: line(e.pylon.te), z: line(e.pylon.z), thickness: m(e.pylon.t) };
        if (e.prop) {
          const p = e.prop;
          out.propeller = { x: m(p.x), z: m(p.z), diameter: m(p.d), blades: p.n };
          if (p.spinner) out.propeller.spinner = { x: [m(p.spinner[0]), m(p.spinner[1])], diameter: m(p.spinner[2]) };
        }
        return out;
      }),
      cabin: {
        windows: windows(c.win) || { z: [0, 0], width: 0, x: [] },
        doors: (c.doors || []).map((d) => {
          const door = { x: [m(d[0]), m(d[1])], z: [m(d[2]), m(d[3])], kind: kinds[d[4]] || 'door' };
          if (d[5]) door.side = d[5] === 'l' ? 'left' : 'right';
          return door;
        }),
      },
      cockpit: { windows: (c.cockpit || []).map(line) },
    };
    if (c.widest !== undefined) shape.fuselage.widest = m(c.widest);
    if (c.hump) {
      shape.fuselage.hump = { crown: line(c.hump.crown), width: m(c.hump.w) };
      if (c.hump.section) shape.fuselage.hump.section = line(c.hump.section);
    }
    if (c.fin.fillet) shape.fin.fillet = line(c.fin.fillet);
    if (c.fin.rudder) shape.fin.rudder = line(c.fin.rudder);
    if (c.stab.fin) shape.stabilizer.mount = 'fin';
    if (c.tip) {
      shape.wingtip = { kind: c.tip.kind, leading: line(c.tip.le), trailing: line(c.tip.te) };
      if (c.tip.front) shape.wingtip.front = line(c.tip.front);
    }
    if (c.win2) shape.cabin.upperWindows = windows(c.win2);
    return shape;
  }

  const shapes = new Map();
  /** A measured shape by its id, or the renderer's own generic one ("generic:narrowbody"). */
  function shapeFor(id) {
    if (id.startsWith('generic:')) return OL.SHAPES[id.slice(8)];
    if (!shapes.has(id)) shapes.set(id, measured(id));
    return shapes.get(id);
  }

  /**
   * The measured shape a scheme was drawn on (its `drawnOn` type: the shape of that id, else one serving it), so the
   * renderer fits it to another type by their landmarks (Open Liveries' docs/COORDINATES.md, Landmarks).
   */
  function drawnOnShape(scheme) {
    const type = scheme.drawnOn;
    if (!type) return undefined;
    // The shape whose id is the designator (B763, the 767-300F, before B763-passenger), else the first serving it.
    const { shapes: all, types } = root.CARD_DATA.shapes;
    const id = all[type] ? type : (types?.[type] || []).find((k) => all[k]);
    return id ? shapeFor(id) : undefined;
  }

  /** The fin's outline in the left view's pixels (leading edge up, trailing edge down), for fitting a logo on it. */
  function finOutline(shape) {
    const projection = OL.sideProjection(shape);
    const px = ([x, z]) => {
      const [u, v] = projection.uv(x, z);
      return [u * projection.width, (1 - v) * projection.height];
    };
    return [...shape.fin.leading.map(px), ...shape.fin.trailing.slice().reverse().map(px)];
  }

  function inside([x, y], polygon) {
    let hit = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const [xi, yi] = polygon[i];
      const [xj, yj] = polygon[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
    }
    return hit;
  }

  const r1 = (v) => Math.round(v * 10) / 10;

  /**
   * Lettering in a mirrored mark (`keep`, tools/make_marks.py): the shapes marked `keep` are one group, mirrored with
   * the mark and then reflected back across the line through the group's middle (its bounding box's centre, mirrored)
   * square to its baseline. Upright lettering (`keep: true`) comes out unflipped where the mirror puts it, reading
   * normally; lettering on a slant (`keep: <degrees>`, its baseline's angle, counter-clockwise from the left side's x)
   * also takes the mirrored slant, its first letter still first (Western Global's WGA rises toward the tail on both
   * sides). Returns a function from a point in the mark's box to its place on the right side, or undefined.
   */
  function keeper(mark) {
    const kept = mark.shapes.filter((s) => s.keep);
    if (!kept.length) return undefined;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s of kept) {
      for (const [x, y] of s.p) {
        x0 = Math.min(x0, x); x1 = Math.max(x1, x);
        y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
    }
    const slant = kept.map((s) => s.keep).find((k) => typeof k === 'number') || 0;
    // The axis after the mirror: through the mirrored centre, at 90° − slant (the mirror of the baseline's normal).
    const cx = mark.aspect - (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const a = ((90 - slant) * Math.PI) / 180;
    const ux = Math.cos(a), uy = Math.sin(a);
    return ([x, y]) => {
      const dx = mark.aspect - x - cx, dy = y - cy;
      const t = dx * ux + dy * uy;
      return [cx + 2 * t * ux - dx, cy + 2 * t * uy - dy];
    };
  }

  /**
   * Draws a logo with our own mark (Tailspot's marks.json, the Horizon's), centred in the renderer's box, its height
   * the box's; clipped to its part by the renderer, as Open Liveries draws it (United's globe runs off the fin). A
   * jet's tail art (`fit`) is made smaller until it's on the fin, as the Horizon paints it (PlaneModel.finBox). A
   * mark we don't have is left out: an empty string, never the renderer's labeled placeholder. `side` is the view
   * when the renderer doesn't say (a 3D texture's right half says 'right'). `texture`: for the 3D fuselage texture
   * (the body unrolled, x straight along it), where a pattern's copies are laid out evenly (`tiles`).
   */
  function painter(scheme, shape, side, texture = false) {
    const marks = root.CARD_DATA.marks.marks;
    let fin;
    return (logo, box, view) => {
      side = view === 'left' || view === 'right' ? view : side;
      const mark = marks[logo.mark];
      if (!mark) return '';
      const colors = (logo.colors || []).map((c) => OL.colorOf(scheme, c, '#999999'));
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      let h = box.height;
      if (logo.fit && shape.fin.leading) {
        fin = fin || finOutline(shape);
        const outline = side === 'right' ? fin.map(([x, y]) => [1000 - x, y]) : fin;
        const fits = (h) => {
          const w = (mark.aspect * h) / 2;
          const inset = 0.94;
          return [-1, 0, 1].every((dx) =>
            [-1, 1].every((dy) => inside([cx + dx * w * inset, cy + (dy * h) / 2], outline)),
          );
        };
        while (!fits(h) && h > 2) h *= 0.95;
      }
      // A title drawn as its mark (D288): the box is the title's, baseline at its foot; stretched along to its length.
      const stretch = box.fitWidth && box.width > 0 ? box.width / (mark.aspect * h) : 1;
      // Shapes are in a box `aspect` wide and 1 tall, y up, facing forward seen from the left. From the right the
      // nose is on the right: a mark that faces forward (`mirror`) is flipped to; any other reads the same.
      const flip = side === 'right' && mark.mirror;
      const unflip = flip ? keeper(mark) : undefined;
      const copy = ({ x: cx, y: cy, h, stretch = 1 }) => {
        const x0 = cx - (mark.aspect * h * stretch) / 2;
        const y0 = cy + h / 2;
        const at = ([x, y]) => `${r1(x0 + x * h * stretch)},${r1(y0 - y * h)}`;
        const point = ([x, y]) => at([flip ? mark.aspect - x : x, y]);
        return mark.shapes
          .map((s) => {
            const fill = typeof s.c === 'number' ? (colors[s.c] ?? '#999999') : s.c;
            const place = s.keep && unflip ? (p) => at(unflip(p)) : point;
            const ring = (points) => 'M' + points.map(place).join('L') + 'Z';
            const d = [s.p, ...(s.holes || [])].map(ring).join('');
            return `<path d="${d}" fill="${fill}" fill-rule="evenodd"/>`;
          })
          .join('');
      };
      const one = { x: cx, y: cy, h, stretch };
      const copies =
        texture && logo.place === 'fuselage'
          ? textureTiles(scheme, view || side, logo, mark, one)
          : tiles(scheme, shape, side, logo, mark, one);
      return copies.map(copy).join('');
    };
  }

  /**
   * Where a logo's copies go, in the picture: a pattern mark (`tile`, Fiji's masi) repeated side by side across the
   * painted area under its centre, as the Horizon does (PlaneModel.tiles). On the fuselage from the area's forward
   * edge aft, each copy as tall as the body is there (it tapers to the tail; the renderer clips them to the body);
   * on the fin across the band, the fin's outline clipping them at its swept edges. Anything else: once.
   */
  function tiles(scheme, shape, side, logo, mark, one) {
    if (!mark.tile || (logo.place !== 'fuselage' && logo.place !== 'fin')) return [one];
    const band = bandOf(scheme, side, logo);
    if (!band) return [one];
    const [lo, hi] = band;
    const view = (x) => (side === 'right' ? 1000 - x : x);
    const out = [];
    if (logo.place === 'fuselage') {
      const projection = OL.sideProjection(shape);
      const profile = OL.fuselageProfile(shape);
      const length = shape.fuselage.length;
      // The body at x (0 nose → 1 tail) in the left view's pixels: its left edge, middle and height.
      const at = (x) => {
        const { crown, belly } = profile(Math.min(x, 1));
        const [u, top] = projection.uv(x * length, crown);
        const [, bottom] = projection.uv(x * length, belly);
        const h = (top - bottom) * projection.height;
        return { px: u * projection.width, y: (1 - (top + bottom) / 2) * projection.height, h };
      };
      const perShare = at(1).px - at(0).px;
      for (let x = lo; x < hi && out.length < 60; ) {
        let here = at(x);
        let w = (mark.aspect * here.h) / perShare;
        here = at(x + w / 2);
        if (here.h <= 1) break;
        w = (mark.aspect * here.h) / perShare;
        out.push({ x: view(at(x).px + (w * perShare) / 2), y: here.y, h: here.h });
        x += w;
      }
      return out.length ? out : [one];
    }
    // The fin: across the band at its middle height, a copy past each edge the band reaches (the edges are swept).
    const fin = finOutline(shape);
    const y = one.y;
    const edges = [];
    for (let i = 0, j = fin.length - 1; i < fin.length; j = i++) {
      const [xi, yi] = fin[i];
      const [xj, yj] = fin[j];
      if (yi > y !== yj > y) edges.push(xi + ((xj - xi) * (y - yi)) / (yj - yi));
    }
    if (edges.length < 2) return [one];
    const lead = Math.min(...edges);
    const chord = Math.max(...edges) - lead;
    const w = mark.aspect * one.h;
    const from = lead + lo * chord - (lo <= 0.01 ? w : 0);
    const to = lead + hi * chord + (hi >= 0.99 ? w : 0);
    for (let x = from; x < to && out.length < 30; x += w) out.push({ x: view(x + w / 2), y, h: one.h });
    return out;
  }

  /** The painted area a pattern logo sits on, as its x range on its part (0 to 1), or undefined. */
  function bandOf(scheme, side, logo) {
    const part = logo.place === 'fuselage' ? scheme.fuselage : scheme.fin;
    const shows = (a) => !a.side || a.side === 'both' || a.side === side;
    const area = (part?.areas || []).filter((a) => shows(a) && inside(logo.at, a.points)).at(-1);
    if (!area) return undefined;
    const xs = area.points.map((p) => p[0]);
    return [Math.max(Math.min(...xs), 0), Math.min(Math.max(...xs), 1)];
  }

  /**
   * A pattern's copies on the 3D fuselage texture (x straight along the body, `x * width` seen from the left,
   * `(1 - x) * width` from the right; the body's height the same all along): a whole number of copies stretched a
   * little to fill its area edge to edge, as the Horizon lays them (PlaneModel.tiles).
   */
  function textureTiles(scheme, view, logo, mark, one) {
    const band = mark.tile && bandOf(scheme, view, logo);
    const width = view === 'right' ? one.x / (1 - logo.at[0]) : one.x / logo.at[0];
    if (!band || !(width > 0) || !isFinite(width)) return [one];
    const [lo, hi] = band;
    const w = (mark.aspect * one.h) / width;
    const n = Math.max(1, Math.round((hi - lo) / w));
    const step = (hi - lo) / n;
    return Array.from({ length: n }, (_, i) => {
      const x = lo + step * (i + 0.5);
      return { x: (view === 'right' ? 1 - x : x) * width, y: one.y, h: one.h, stretch: step / w };
    });
  }

  /** A font name's covered family ("Gotham Rounded Bold": Gotham Rounded), the longest first; undefined if none. */
  function coveredFamily(name, covers) {
    const n = name.toLowerCase();
    return Object.keys(covers)
      .filter((f) => n === f.toLowerCase() || n.startsWith(f.toLowerCase() + ' '))
      .sort((a, b) => b.length - a.length)[0];
  }

  /**
   * The scheme with our bundled look-alikes (D287, tools/build_fonts.py) after each title's own fonts, so a phone
   * without Gotham draws Montserrat rather than Helvetica, as the Horizon does (PlaneModel.font).
   */
  function withStandIns(scheme) {
    const covers = root.CARD_DATA.fonts?.covers;
    if (!covers) return scheme;
    const title = (t) => {
      const similar = t.type?.similar ?? [];
      const extra = similar.map((n) => covers[coveredFamily(n, covers)]).filter(Boolean);
      return extra.length ? { ...t, type: { ...t.type, similar: [...similar, ...new Set(extra)] } } : t;
    };
    const out = { ...scheme };
    if (scheme.titles) out.titles = scheme.titles.map(title);
    if (scheme.types) {
      out.types = Object.fromEntries(
        Object.entries(scheme.types).map(([k, v]) => [k, v.titles ? { ...v, titles: v.titles.map(title) } : v]),
      );
    }
    return out;
  }

  /**
   * An SVG with the stand-in faces its titles name embedded (a picture drawn through an image sees no other
   * fonts than the system's and its own).
   */
  function withFonts(markup) {
    const faces = (root.CARD_DATA.fonts?.faces ?? []).filter((f) => f.data && markup.includes(`'${f.family}'`));
    if (!faces.length) return markup;
    const rules = faces
      .map((f) => `@font-face{font-family:'${f.family}';font-weight:${f.weight};src:url(data:font/ttf;base64,${f.data})}`)
      .join('');
    return markup.replace(/<svg\b[^>]*>/, (open) => `${open}<style>${rules}</style>`);
  }

  /**
   * A request's scheme and shape: `ref` is "liveries/<id>" or "airlines/<code>" in card_liveries.json; `art` a jet's
   * own tail art ({ family, colors }) in place of the scheme's fin logos. Undefined if either isn't there.
   */
  function prepare({ ref, shape: shapeId, art, registration }) {
    const [group, ...rest] = ref.split('/');
    let scheme = root.CARD_DATA.liveries[group]?.[rest.join('/')];
    const shape = shapeFor(shapeId);
    if (!scheme || !shape) return undefined;
    scheme = withStandIns(scheme);
    // The aircraft's own number where the scheme paints it (the Coast Guard's on the nose), as the Horizon letters it
    // (OpenLiveries.withRegistration): this plane's, or none, never the measured plane's.
    const lettered = (titles) =>
      titles.flatMap((t) => (!t.registration ? [t] : registration ? [{ ...t, text: registration, parts: undefined }] : []));
    if ((scheme.titles || []).some((t) => t.registration)) scheme = { ...scheme, titles: lettered(scheme.titles) };
    if (scheme.types) {
      // Each type's own paint (the Coast Guard's HC-144) letters it too.
      const types = Object.fromEntries(
        Object.entries(scheme.types).map(([k, v]) => [k, v.titles ? { ...v, titles: lettered(v.titles) } : v]),
      );
      scheme = { ...scheme, types };
    }
    if (art) {
      // As the Horizon does (OpenLiveries.withArt): the family's silhouette in the animal's colours, a little low on
      // the fin, as big as fits.
      scheme = { ...scheme, logos: (scheme.logos || []).filter((l) => l.place !== 'fin') };
      scheme.logos.push({
        mark: 'ANIMAL/' + art.family,
        place: 'fin',
        at: [0.5, 0.4],
        height: 0.8,
        colors: art.colors && art.colors.length ? art.colors : ['#595959'],
        fit: true,
      });
    }
    return { scheme, shape, drawnOn: drawnOnShape(scheme) };
  }

  /** One scheme on one shape (`prepare`'s request), from one side ('left', 'right' or 'below'), as SVG. */
  function svg(request) {
    const prepared = prepare(request);
    if (!prepared) return undefined;
    const { scheme, shape, drawnOn } = prepared;
    const side = request.side || 'left';
    const painted = OL.schemeOn(scheme, shape);
    const logo = painter(painted, shape, side === 'right' ? 'right' : 'left');
    if (side === 'below') return withFonts(OL.renderBelow(scheme, { shape, drawnOn, logo, idPrefix: 'card' }));
    return withFonts(OL.renderSide(scheme, { shape, side, drawnOn, logo, idPrefix: 'card' }));
  }

  /** The same as a PNG data URL `width` pixels wide (in a page: drawn through an image and a canvas). */
  async function png(request) {
    const markup = svg(request);
    if (!markup) return undefined;
    const [, , vw, vh] = markup.match(/viewBox="([^"]+)"/)[1].split(' ').map(Number);
    const width = Math.round(request.width || 1200);
    const height = Math.round((width * vh) / vw);
    const image = new Image();
    image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(markup);
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(image, 0, 0, width, height);
    return { png: canvas.toDataURL('image/png'), aspect: vw / vh };
  }

  root.CardDrawing = { measured, prepare, painter, svg, png, withFonts };
})(globalThis);
