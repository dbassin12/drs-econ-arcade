// @ts-check
/* DRS Econ Arcade — the 1975 economy the Fed Chair game plays against.
   Sections: constants · clampRate · step · shocksFor · simulate · judgeMove · score · search.
   Pure arithmetic on plain objects: no DOM, no storage, no clock, so the whole file loads
   under `node --test` and the game in fed-chair.html is only a face on top of it.

   The lag is the whole lesson. The rate the Chair sets this quarter moves the output gap
   NEXT quarter (through the real rate), and inflation only reads the gap it inherited — so a
   hike shows up in unemployment one quarter out and in inflation two. Nothing the Chair does
   today can change today's inflation print. */
var FedModel = (function () {
  'use strict';

  /* ===== CONSTANTS — 1975: 11% inflation, a 4-point output gap, and no credibility ===== */

  /** The tuned 1975 economy.
   *  k demand's response to the real rate · rStar the neutral real rate · rho gap persistence ·
   *  phi the Phillips slope · FLOOR the deepest gap that still pulls inflation down ·
   *  a expectation stickiness · uStar the natural rate · piStar the target · lambda how fast a
   *  credible Fed drags expectations back to it · okun the gap-to-unemployment ratio. */
  var PARAMS_1975 = { k: 0.20, rStar: 1.0, rho: 1.0, phi: 0.30, FLOOR: -6, a: 0.60, uStar: 6.0, piStar: 2, lambda: 0.05, okun: 0.5 };

  /** @typedef {{t:number, pi:number, u:number, gap:number, piExp:number, rate:number, cred:number, real?:number}} FedState */

  /** Quarter 1, 1975: the state on the board before the Chair's first move.
   *  @type {FedState} */
  var INITIAL_1975 = { t: 1, pi: 11.0, u: 8.0, gap: -4.0, piExp: 11.0, rate: 6.50, cred: 0.1 };

  var RATE_MIN = 2;        // the fed funds rate floor the game allows
  var RATE_MAX = 14;       // and its ceiling
  var RATE_STEP = 0.25;    // rates move a quarter point at a time
  var MAX_MOVE = 1.00;     // and no more than a point in any one quarter
  var TURNS = 10;          // a run is ten quarters

  /** What actually happened, ten quarterly averages from 1975Q1 (inflation, unemployment, fed funds).
   *  Drawn against the player's run so the class can compare their Fed with Burns's.
   *  // TODO verify vs FRED CPIAUCSL/UNRATE/FEDFUNDS */
  var HISTORY_1975 = {
    pi: [11.0, 9.6, 8.7, 7.2, 6.4, 6.1, 5.5, 5.1, 5.8, 6.9],
    u: [8.3, 8.9, 8.5, 8.3, 7.7, 7.6, 7.7, 7.8, 7.5, 7.1],
    rate: [6.3, 5.4, 6.2, 5.4, 4.8, 5.2, 5.3, 4.9, 4.7, 5.2]
  };

  /** @param {number} v @param {number} lo @param {number} hi @returns {number} */
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  /* ===== clampRate — the only rates a player can actually set ===== */

  /** Snap a requested rate to a quarter point, then hold it inside both the 2–14 band and the
   *  one-point-a-quarter move limit. A request that is not a number leaves the rate where it was.
   *  @param {number} requested @param {number} prevRate last quarter's rate @returns {number} */
  function clampRate(requested, prevRate) {
    if (typeof requested !== 'number' || !isFinite(requested)) return prevRate;
    var snapped = Math.round(requested / RATE_STEP) * RATE_STEP;
    return clamp(snapped, Math.max(RATE_MIN, prevRate - MAX_MOVE), Math.min(RATE_MAX, prevRate + MAX_MOVE));
  }

  /* ===== step — one quarter ===== */

  /** Advance the economy one quarter at the given rate.
   *
   *    real   = rate - pi                                     (what the rate is worth in real terms)
   *    gap'   = rho*gap - k*(real - rStar) + demand
   *    pi'    = piExp + phi*max(gap, FLOOR) + supply           (reads the gap it inherited: the lag)
   *    piExp' = a*piExp + (1 - a)*pi' - cred*lambda*(piExp - piStar)
   *    u'     = uStar - okun*gap'
   *    cred'  = cred + 0.05 above rStar + 1, -0.05 below rStar - 2, kept inside 0-1
   *
   *  @param {FedState} state the state observed at the start of the quarter
   *  @param {number} rate the rate the Chair sets for this quarter (already legal)
   *  @param {{demand?:number, supply?:number}} [shocks]
   *  @param {typeof PARAMS_1975} [params]
   *  @returns {FedState} next quarter's state, carrying the `real` rate that produced it */
  function step(state, rate, shocks, params) {
    var p = params || PARAMS_1975;
    var s = shocks || {};
    var demand = s.demand || 0;
    var supply = s.supply || 0;

    var real = rate - state.pi;
    var gap = p.rho * state.gap - p.k * (real - p.rStar) + demand;
    var pi = state.piExp + p.phi * Math.max(state.gap, p.FLOOR) + supply;
    var piExp = p.a * state.piExp + (1 - p.a) * pi - state.cred * p.lambda * (state.piExp - p.piStar);
    var u = p.uStar - p.okun * gap;
    var cred = clamp(state.cred + (real > p.rStar + 1 ? 0.05 : 0) - (real < p.rStar - 2 ? 0.05 : 0), 0, 1);

    return { t: state.t + 1, pi: pi, u: u, gap: gap, piExp: piExp, rate: rate, cred: cred, real: real };
  }

  /* ===== shocksFor — the 1975 schedule ===== */

  /** The shocks that hit in quarter t: the oil-shock recession in Q1–Q2, the White House's call
   *  in Q4 if the Chair took it, and a wage-price spiral in Q6 if inflation ran above 8 through
   *  quarters 4, 5 and 6. `history[t - 1]` is the state observed at the start of quarter t, so the
   *  spiral reads history[3], history[4] and history[5].
   *  @param {number} t 1-based quarter
   *  @param {{acceptedCall?:boolean, history?:FedState[]}} [context] the run so far, index 0 = opening state
   *  @returns {{demand:number, supply:number}} */
  function shocksFor(t, context) {
    var c = context || {};
    var history = c.history || [];
    if (t === 1) return { demand: -3, supply: 0 };
    if (t === 2) return { demand: -1, supply: 2 };
    if (t === 4) return { demand: c.acceptedCall ? 2 : 0, supply: 0 };
    if (t === 6) {
      var spiral = history.length >= 6 && history[3].pi > 8 && history[4].pi > 8 && history[5].pi > 8;
      return { demand: 0, supply: spiral ? 1.5 : 0 };
    }
    if (t === 8) return { demand: -1.5, supply: 0 };
    return { demand: 0, supply: 0 };
  }

  /* ===== simulate — ten quarters ===== */

  /** Play a whole run. Each requested rate is clamped against the quarter before it, and the
   *  shocks are read off the history as it is built, so the spiral can see what inflation did.
   *  @param {number[]} rates ten requested rates, quarter 1 first
   *  @param {{acceptedCall?:boolean, params?:typeof PARAMS_1975, initial?:FedState}} [options]
   *  @returns {{history:FedState[], peakU:number, final:FedState}} eleven states: the opening one
   *    plus one per quarter, the worst unemployment reached, and where it ended */
  function simulate(rates, options) {
    var o = options || {};
    var params = o.params || PARAMS_1975;
    var history = [o.initial || INITIAL_1975];
    var peakU = -Infinity;

    for (var t = 1; t <= TURNS; t++) {
      var state = history[t - 1];
      var rate = clampRate(rates[t - 1], state.rate);
      var shocks = shocksFor(t, { acceptedCall: !!o.acceptedCall, history: history });
      var next = step(state, rate, shocks, params);
      history.push(next);
      if (next.u > peakU) peakU = next.u;
    }

    return { history: history, peakU: peakU, final: history[TURNS] };
  }

  /* ===== judgeMove — was that the move the moment called for? ===== */

  /** True if the move matched what the state called for, false if it went the other way (or stood
   *  still), null when the two mandates disagree and either move is defensible.
   *  @param {{pi:number, gap:number, rate?:number}} state
   *  @param {number} rate the rate just set
   *  @param {number} [prevRate] defaults to the rate the state came in with
   *  @returns {boolean|null} */
  function judgeMove(state, rate, prevRate) {
    var prev = prevRate === undefined ? state.rate : prevRate;
    if (state.pi > 4 && state.gap >= -2) return rate > prev;    // inflation high, slack nearly gone: hike
    if (state.gap < -3 && state.pi < 6) return rate < prev;     // deep recession, inflation off the boil: cut
    return null;
  }

  /* ===== score — the report card ===== */

  /** Score a finished run out of 105: 40 for landing inflation on target, 30 for unemployment at
   *  the natural rate, 20 for not having wrecked the labour market on the way, 10 for having
   *  brought expectations back down, and 5 for having refused the White House.
   *  @param {{peakU:number, final:{pi:number, u:number, piExp:number}}} run
   *  @param {{integrity?:boolean}} [options]
   *  @returns {{raw:number, stamp:number}} raw out of 105 and a 1–5 stamp */
  function score(run, options) {
    var o = options || {};
    var f = run.final;
    var raw = 40 * clamp(1 - Math.abs(f.pi - 2) / 9, 0, 1)
      + 30 * clamp(1 - Math.abs(f.u - 6) / 4, 0, 1)
      + 20 * clamp(1 - Math.max(0, run.peakU - 8) / 4, 0, 1)
      + 10 * clamp(1 - Math.abs(f.piExp - 2) / 9, 0, 1)
      + 5 * (o.integrity ? 1 : 0);
    var stamp = raw >= 70 ? 5 : raw >= 65 ? 4 : raw >= 55 ? 3 : raw >= 42 ? 2 : 1;
    return { raw: raw, stamp: stamp };
  }

  /* ===== search — how good could a run have been? ===== */

  /** Random-sample legal rate paths and keep the best-scoring one. Used to sanity-check that the
   *  par the game hands out is beatable; not part of play.
   *  @param {{n?:number, acceptedCall?:boolean, integrity?:boolean, params?:typeof PARAMS_1975,
   *           initial?:FedState, rng?:() => number}} [options]
   *  @returns {{raw:number, stamp:number, path:number[]}} */
  function search(options) {
    var o = options || {};
    var n = o.n === undefined ? 500 : o.n;
    var rng = o.rng || Math.random;
    var initial = o.initial || INITIAL_1975;
    var integrity = o.integrity === undefined ? true : o.integrity;
    var best = { raw: -Infinity, stamp: 1, path: /** @type {number[]} */ ([]) };
    var choices = 2 * MAX_MOVE / RATE_STEP + 1;   // nine rates are within a point of last quarter's

    for (var trial = 0; trial < n; trial++) {
      var path = /** @type {number[]} */ ([]);
      var prev = initial.rate;
      for (var t = 1; t <= TURNS; t++) {
        var rate = clampRate(prev - MAX_MOVE + RATE_STEP * Math.floor(rng() * choices), prev);
        path.push(rate);
        prev = rate;
      }
      var result = score(simulate(path, { acceptedCall: !!o.acceptedCall, params: o.params, initial: initial }), { integrity: integrity });
      if (result.raw > best.raw) best = { raw: result.raw, stamp: result.stamp, path: path };
    }
    return best;
  }

  return {
    PARAMS_1975: PARAMS_1975, INITIAL_1975: INITIAL_1975, HISTORY_1975: HISTORY_1975,
    RATE_MIN: RATE_MIN, RATE_MAX: RATE_MAX, RATE_STEP: RATE_STEP, MAX_MOVE: MAX_MOVE,
    clampRate: clampRate, step: step, shocksFor: shocksFor, simulate: simulate,
    judgeMove: judgeMove, score: score, search: search
  };
}());

if (typeof module !== 'undefined') module.exports = FedModel;
