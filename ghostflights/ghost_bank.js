// Tonight's ghost flights from Ghostflights' schedule bank (docs/GHOSTS.md › Version 2, D301), worked out the way the
// app does it (Tailspot/Sky/GhostBank.swift) and by the broadcast's own rules (ghostflights' sim/feed.js: flies(),
// thenIn(), cruiseFt(), the station's paint()). Every airline, every real flight that leaves from 9 PM at its origin's
// clock and lands by 7 AM at its destination's, less the through flights read as one leg, and one flagged extra that
// isn't Ghostflights' (Western's nightly DC-10 to Palm Springs, a special flight).
//
// In a page: <script src="ghost_bank.js"></script>, then GhostBank.night(bank, n). In Node: await import() it.
// tools/ghosts/selection_fixture.mjs checks it against Ghostflights' engine and writes the fixture GhostFlightTests
// holds the app to.
(function () {
  const DAY = 86_400_000, RAD = Math.PI / 180;
  const LEAVE_FROM = 21 * 60, LAND_BY = 7 * 60;
  const SPEED_KT = { MD82: 430, DC91: 420, DC93: 425, DC95: 430, B722: 455, B733: 430, B752: 460, B747: 490, B74S: 500, DC10: 475,
    L101: 475, L15: 490, A30B: 460, B462: 390, CV580: 290 };
  const HEAVY = new Set(['B747', 'B74S', 'DC10', 'L101', 'L15']);

  const nm = ([la1, lo1], [la2, lo2]) => {
    const h = Math.sin((la2 - la1) * RAD / 2) ** 2 + Math.cos(la1 * RAD) * Math.cos(la2 * RAD) * Math.sin((lo2 - lo1) * RAD / 2) ** 2;
    return 2 * 3440.065 * Math.asin(Math.sqrt(h));
  };
  const mod = (x, m) => ((x % m) + m) % m;
  // How far the destination's clock is ahead of the origin's, minutes.
  const ahead = (row) => mod(row[10] - row[3] - row[5] + 720, 1440) - 720;
  // Not a through flight read as one leg: a block more than half again the type's time plus half an hour.
  const plausible = (row, airports) => row[5] <= (nm(airports[row[1]], airports[row[2]]) / SPEED_KT[row[9]] * 60 + 25) * 1.5 + 30;
  // Which part of a night it flies: 'evening' (leaves from 9 PM on the night's date), 'morning' (leaves after midnight,
  // the next date), or null (lands after 7 AM, or leaves in the day).
  function part(row) {
    const [, , , leave, , block] = row, lands = leave + block + ahead(row);
    if (leave >= LEAVE_FROM && lands <= 1440 + LAND_BY) return 'evening';
    if (leave < LAND_BY && lands <= LAND_BY) return 'morning';
    return null;
  }
  // feed.js's thenIn and flies(): its weekday in its airline's year, within its date notes (ISO dates in the bank).
  function thenIn(d, year) {
    const date = new Date(d * DAY);
    return new Date(Date.UTC(year, date.getUTCMonth(), Math.min(date.getUTCDate(), date.getUTCMonth() === 1 ? 28 : 31)));
  }
  function flies(row, d, year) {
    const then = thenIn(d, year), iso = then.toISOString().slice(0, 10);
    if (!((row[6] >> ((then.getUTCDay() + 6) % 7)) & 1)) return false;
    return !((row[7] && iso < row[7]) || (row[8] && iso > row[8]));
  }
  // feed.js's cruiseFt, and whether a route heads east.
  const eastbound = ([la1, lo1], [la2, lo2]) => {
    const y = Math.sin((lo2 - lo1) * RAD) * Math.cos(la2 * RAD);
    const x = Math.cos(la1 * RAD) * Math.sin(la2 * RAD) - Math.sin(la1 * RAD) * Math.cos(la2 * RAD) * Math.cos((lo2 - lo1) * RAD);
    return mod(Math.atan2(y, x) / RAD + 360, 360) < 180;
  };
  function cruiseFt(miles, kind, east, seed) {
    const [lo, hi] = kind === 'CV580' ? (miles < 100 ? [9, 13] : miles < 200 ? [13, 17] : [17, 23])
      : miles < 150 ? [15, 21] : miles < 300 ? [21, 28] : miles < 700 ? [27, 35]
      : HEAVY.has(kind) ? (miles < 2500 ? [31, 39] : [33, 39]) : [31, 37];
    const levels = [];
    for (let k = lo; k <= hi; k++) {
      const ok = k < 29 ? (k % 2 === 1) === east : east ? (k - 29) % 4 === 0 : (k - 31) % 4 === 0;
      if (ok) levels.push(k * 1000);
    }
    let h = 0;
    for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return levels[h % levels.length];
  }
  // The type's speed (a tenth more at most), slowed where an old block is long for the distance, so GhostPath, which
  // gives only 15 to 20% either way, lands it on time.
  function cruiseKt(kind, miles, block) {
    const fits = miles * 60 / Math.max(block - 30, 10), speed = SPEED_KT[kind];
    return Math.floor(Math.max(Math.min(speed * 1.1, Math.floor(fits / 5 + 0.5) * 5), speed * 0.7));
  }
  const clock = (m) => `${String(Math.floor(mod(m, 1440) / 60)).padStart(2, '0')}:${String(mod(m, 60)).padStart(2, '0')}`;
  const iso = (ms) => new Date(ms).toISOString().replace('.000', '');

  // Night n's ghosts (n: days since 1970 of the night's evening, at each flight's own clock), in departure order.
  // A type's tails go round its flights that night in that order, starting from a different one each night, one
  // flight a tail (the extra's tail that night left out); the rest have none.
  function night(bank, n) {
    const airports = bank.airports;
    // The extras first: their tails aren't given to another flight that night.
    const out = extras(bank, n), taken = new Set(out.map((f) => f.registration));
    for (const [code, a] of Object.entries(bank.airlines)) {
      const mine = [];
      for (const row of a.rows) {
        const p = part(row);
        if (!p || !plausible(row, airports)) continue;
        const d = p === 'evening' ? n : n + 1;
        if (!flies(row, d, a.year)) continue;
        const [number, from, to, leave, offset, block, , , , kind, arrives] = row;
        const depart = d * DAY + (offset + leave) * 60_000, t = a.types[kind];
        const deck = t.paints.flatMap(([s, k]) => Array(k).fill(s));
        const p0 = airports[from].slice(0, 2), p1 = airports[to].slice(0, 2), miles = nm(p0, p1);
        mine.push({
          airline: code, name: a.name, short: a.short, year: a.year, scheme: deck[number % deck.length], type: kind,
          typeName: t.name, ...(t.drawAs ? { drawAs: t.drawAs } : {}), shape: t.shape, number, flight: `${a.designator} ${number}`,
          from, to, fromPos: p0, toPos: p1, fromCity: airports[from][2], toCity: airports[to][2],
          depart: iso(depart), arrive: iso(depart + block * 60_000), departLocal: clock(leave), arriveLocal: clock(arrives),
          cruiseFt: cruiseFt(miles, kind, eastbound(p0, p1), `${a.seededAs ?? code}${number}${from}${to}`), cruiseKt: cruiseKt(kind, miles, block),
          channel: a.channel, night: n,
        });
      }
      mine.sort((x, y) => x.depart.localeCompare(y.depart) || x.number - y.number || x.from.localeCompare(y.from));
      const used = {};
      for (const f of mine) {
        const tails = (a.types[f.type].tails ?? []).filter((t) => !taken.has(t)), i = used[f.type] = (used[f.type] ?? -1) + 1;
        if (i < tails.length) f.registration = tails[(i + n) % tails.length];
      }
      out.push(...mine);
    }
    return out.sort((x, y) => x.depart.localeCompare(y.depart) || x.airline.localeCompare(y.airline) || (x.number ?? 0) - (y.number ?? 0));
  }
  // The bank's extras (Skyarium's own, not on the air at Ghostflights): Western's DC-10 from Minneapolis to Palm
  // Springs, a special flight, every night. Its time a night: a step through its window by the night's
  // number; its tail, the night's in turn. No number and no channel; `trip` says where it comes from.
  function extras(bank, n) {
    return (bank.extras ?? []).map((x) => {
      const steps = 1 + (x.leaveTo - x.leaveFrom) / 5, leave = x.leaveFrom + 5 * mod(37 * n + 11, steps);
      const depart = n * DAY + (x.offset + leave) * 60_000, a = bank.airlines[x.airline];
      const p0 = bank.airports[x.from].slice(0, 2), p1 = bank.airports[x.to].slice(0, 2), miles = nm(p0, p1);
      return {
        airline: x.airline, name: a.name, short: a.short, year: x.year, scheme: x.scheme, type: x.type, typeName: x.name, shape: x.shape,
        registration: x.tails[mod(n, x.tails.length)], trip: x.trip,
        from: x.from, to: x.to, fromPos: p0, toPos: p1, fromCity: bank.airports[x.from][2], toCity: bank.airports[x.to][2],
        depart: iso(depart), arrive: iso(depart + x.block * 60_000), departLocal: clock(leave), arriveLocal: clock(leave + x.block + x.ahead),
        cruiseFt: cruiseFt(miles, x.type, eastbound(p0, p1), `${x.airline}${x.from}${x.to}`), cruiseKt: cruiseKt(x.type, miles, x.block), night: n,
      };
    });
  }
  // The day number of a date's evening ("2026-11-26").
  const dayOf = (date) => Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY);
  // Whether a row ever flies a night (whatever the day): the page's night cities and types.
  const atNight = (row, airports) => !!part(row) && plausible(row, airports);

  globalThis.GhostBank = { night, extras, dayOf, atNight, flies, cruiseFt, cruiseKt, plausible, part, LEAVE_FROM, LAND_BY };
})();
