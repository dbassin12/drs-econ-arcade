// @ts-check
/* DRS Econ Arcade — the 1975 economy the Fed Chair game plays against.
   Sections: constants · clampRate · step · shocksFor · politics · simulate · judgeMove · score · search.
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
   *  Checked against FRED CPIAUCSL (year-over-year, averaged per quarter), UNRATE and FEDFUNDS
   *  (quarterly means) for 1975Q1-1977Q2: every value agrees to within 0.2. */
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

  /* ===== POLITICS — the street, Washington, and what ignoring them costs =====
     Two meters ride alongside the economy. STREET is public anger. It chases inflation first and
     unemployment second — the 1970s public hated the price of sugar more than the jobless rate —
     and it chases with a lag, because a crowd takes a quarter to notice and a quarter to forgive.
     WASHINGTON is the pressure to ease: it climbs with unemployment — twice as fast in 1976, an
     election year — and with an angry street; it falls when the Chair is visibly cutting or when
     jobs come back; and it jumps when Congress is told no. That asymmetry is the political
     business cycle: please Washington and the street pays, please the street and Washington
     comes for the dial. Neither meter touches the arithmetic above. They decide which events fire,
     and one of them can end a term. */

  /** The tuned politics. Meters run 0–1; quarters are 1-based; `electionQuarters` is 1976. */
  var POLITICS_1975 = {
    streetSpeed: 0.5, streetPi: 0.11, piBase: 3, streetU: 0.04, uBase: 5, hotAbove: 0.75,
    negRealBelow: -3, posRealAbove: 2,
    jobsBar: 8, jobsHeat: 0.05, electionQuarters: [5, 6, 7, 8], electionBoost: 2,
    cutRelief: 0.10, hikeCost: 0.05, coolBelow: 7, cooling: 0.06, spillAbove: 0.6, spill: 0.10,
    callRefuse: 0.25, callAccept: -0.15,
    hearingHold: 0.10, hearingPromise: -0.25, promiseCred: -0.10, brokenPromise: 0.40,
    billEase: -0.40, billEaseCred: -0.10, billEaseDemand: 2, billHeld: -0.35,
    volckerCred: 0.3, volckerReal: 2,
    reappointAbove: 0.7, revoltAbove: 0.75, endedCap: 30
  };

  var CALL_QUARTER = 4;    // the quarter the Washington call opens

  /** @typedef {{street:number, washington:number, hot:number, negRealRun:number, posRealRun:number, peakStreet:number}} Politics */

  /** January 1975: an angry street, and a Congress already restless. @type {Politics} */
  var INITIAL_POLITICS = { street: 0.55, washington: 0.2, hot: 0, negRealRun: 0, posRealRun: 0, peakStreet: 0.55 };

  /** The political events, in the order they are checked: the ladder first — the hearing, then the
   *  White House, then the bill, each needing the rung below it (`stage`) — then the street. Each
   *  fires once a run and at most one fires a quarter. `when` reads a politicsView; `minT` is the
   *  first quarter an event may open, and the two that punish inflation wait until the Chair's own
   *  policy has had time to show, because the inflation of 1975 is inherited and every policy
   *  carries it for a year. `effects` is what a card does on its own; a `choice` event's effects
   *  come from resolveEvent. The words for each id live in the game file, in SCENARIO_1975.POLITICS. */
  var POLITICAL_EVENTS = [
    { id: 'bill', stage: 2, choice: true, when: function (v) { return v.washington >= 0.95; } },
    { id: 'whitehouse', stage: 1, when: function (v) { return v.washington >= 0.7; }, effects: { street: 0.1 } },
    { id: 'hearing', stage: 0, minT: 5, choice: true, when: function (v) { return v.washington >= 0.45; } },
    { id: 'strike', minT: 7, when: function (v) { return v.street >= 0.75 && v.pi >= 8; }, effects: { supply: 1.0 } },
    { id: 'editorial', minT: 7, when: function (v) { return v.hot >= 2; }, effects: { washington: 0.15 } },
    { id: 'march', when: function (v) { return v.street >= 0.5 && v.u >= 8.5; }, effects: { washington: 0.05 } },
    { id: 'boycott', when: function (v) { return v.street >= 0.5 && v.pi >= 9; }, effects: {} },
    { id: 'savers', when: function (v) { return v.negRealRun >= 2; }, effects: { street: 0.1 } },
    { id: 'bondRally', when: function (v) { return v.posRealRun >= 2; }, effects: { washington: -0.1 } },
    { id: 'relief', when: function (v) { return v.street < 0.45 && v.peakStreet >= 0.6; }, effects: { washington: -0.1 } }
  ];

  /** Advance the two meters one quarter, reading the economy the quarter just produced.
   *
   *    target      = clamp(streetPi * (pi - piBase) + streetU * (u - uBase))
   *    street'     = street + streetSpeed * (target - street)
   *    washington' = washington + jobsHeat * max(0, u - jobsBar) * (election ? boost : 1)
   *                  + spill * max(0, street' - spillAbove) - (u < coolBelow ? cooling : 0)
   *                  - cutRelief if the Chair cut, + hikeCost if the Chair hiked
   *                  + brokenPromise if a promise to ease was not kept
   *
   *  @param {Politics} prev
   *  @param {FedState} econ the state just stepped to; its `t` is the quarter about to open
   *  @param {{move?:number, brokenPromise?:boolean}} [ctx] the rate change that produced `econ`
   *  @param {typeof POLITICS_1975} [params]
   *  @returns {Politics} */
  function stepPolitics(prev, econ, ctx, params) {
    var P = params || POLITICS_1975;
    var c = ctx || {};
    var target = clamp(P.streetPi * (econ.pi - P.piBase) + P.streetU * (econ.u - P.uBase), 0, 1);
    var street = clamp(prev.street + P.streetSpeed * (target - prev.street), 0, 1);
    var election = P.electionQuarters.indexOf(econ.t) >= 0;
    var jobs = P.jobsHeat * Math.max(0, econ.u - P.jobsBar) * (election ? P.electionBoost : 1);
    var spill = P.spill * Math.max(0, street - P.spillAbove);
    var cool = econ.u < P.coolBelow ? P.cooling : 0;
    var move = c.move || 0;
    var policy = move < -1e-9 ? -P.cutRelief : move > 1e-9 ? P.hikeCost : 0;
    var washington = clamp(prev.washington + jobs + spill - cool + policy + (c.brokenPromise ? P.brokenPromise : 0), 0, 1);
    var real = typeof econ.real === 'number' ? econ.real : econ.rate - econ.pi;
    return {
      street: street,
      washington: washington,
      hot: street >= P.hotAbove ? prev.hot + 1 : 0,
      negRealRun: real < P.negRealBelow ? prev.negRealRun + 1 : 0,
      posRealRun: real >= P.posRealAbove ? prev.posRealRun + 1 : 0,
      peakStreet: Math.max(prev.peakStreet, street)
    };
  }

  /** Move the meters by an event's effects, inside 0–1. Only street and washington are meters; a
   *  cred, demand or supply effect is the caller's to apply to the economy.
   *  @param {Politics} pol @param {{street?:number, washington?:number}} [effects] @returns {Politics} */
  function bump(pol, effects) {
    var e = effects || {};
    var out = Object.assign({}, pol);
    out.street = clamp(pol.street + (e.street || 0), 0, 1);
    out.washington = clamp(pol.washington + (e.washington || 0), 0, 1);
    out.peakStreet = Math.max(out.peakStreet, out.street);
    return out;
  }

  /** Everything a rule's `when` may read: the meters and their counters, the ladder stage, the
   *  quarter about to open, and the economy as it stands.
   *  @param {Politics} pol @param {FedState} econ @param {{stage?:number, t?:number}} [extra] */
  function politicsView(pol, econ, extra) {
    var x = extra || {};
    return {
      street: pol.street, washington: pol.washington, hot: pol.hot, negRealRun: pol.negRealRun,
      posRealRun: pol.posRealRun, peakStreet: pol.peakStreet,
      stage: x.stage || 0, t: x.t === undefined ? econ.t : x.t,
      pi: econ.pi, u: econ.u, gap: econ.gap, cred: econ.cred, rate: econ.rate,
      real: typeof econ.real === 'number' ? econ.real : econ.rate - econ.pi
    };
  }

  /** The one event due now, or null: the first rule in order that has not fired, whose rung is the
   *  current one, whose quarter has come, and whose condition holds.
   *  @param {any} view a politicsView @param {Record<string, boolean>} [fired] ids already used
   *  @param {any[]} [rules] defaults to POLITICAL_EVENTS @returns {any} the rule, or null */
  function dueEvent(view, fired, rules) {
    var list = rules || POLITICAL_EVENTS;
    var done = fired || {};
    for (var i = 0; i < list.length; i += 1) {
      var r = list[i];
      if (done[r.id]) continue;
      if (r.stage !== undefined && r.stage !== view.stage) continue;
      if (r.minT !== undefined && view.t < r.minT) continue;
      if (r.when(view)) return r;
    }
    return null;
  }

  /** What an event does once it has been answered. A card's effects are its own. The hearing is
   *  held or answered with a promise to ease; the bill is eased into, or held — and holding it is
   *  survived only by a Fed the markets believe, which is credibility of volckerCred or a real rate
   *  of volckerReal or better on the day; otherwise it passes and the term ends.
   *  @param {any} rule @param {string|null} choice 'hold' | 'promise' | 'ease'; anything else holds
   *  @param {any} view the politicsView the rule fired on @param {typeof POLITICS_1975} [params]
   *  @returns {{effects:{street?:number, washington?:number, cred?:number, demand?:number, supply?:number},
   *             flags:{promised?:boolean, capitulated?:boolean, volcker?:boolean}, ending:string|null}} */
  function resolveEvent(rule, choice, view, params) {
    var P = params || POLITICS_1975;
    var out = { effects: {}, flags: {}, ending: null };
    if (!rule.choice) { out.effects = Object.assign({}, rule.effects || {}); return out; }
    if (rule.id === 'hearing') {
      if (choice === 'promise') {
        out.effects = { washington: P.hearingPromise, cred: P.promiseCred };
        out.flags.promised = true;
      } else {
        out.effects = { washington: P.hearingHold };
      }
      return out;
    }
    if (rule.id === 'bill') {
      if (choice === 'ease') {
        out.effects = { washington: P.billEase, cred: P.billEaseCred, demand: P.billEaseDemand };
        out.flags.capitulated = true;
      } else if (view.cred >= P.volckerCred || view.real >= P.volckerReal) {
        out.effects = { washington: P.billHeld };
        out.flags.volcker = true;
      } else {
        out.ending = 'congress';
      }
      return out;
    }
    return out;
  }

  /** The political story a term ends on: the bill passed, the street in revolt, a Chair the White
   *  House will not reappoint, or nothing to add to the economics.
   *  @param {Politics} pol the meters as the term ends @param {{ending?:string|null}} [flags]
   *  @param {typeof POLITICS_1975} [params] @returns {string|null} */
  function politicalVerdict(pol, flags, params) {
    var P = params || POLITICS_1975;
    var f = flags || {};
    if (f.ending) return f.ending;
    if (pol.street >= P.revoltAbove) return 'revolt';
    if (pol.washington >= P.reappointAbove) return 'notReappointed';
    return null;
  }

  /* ===== simulate — ten quarters ===== */

  /** Play a whole run. Each requested rate is clamped against the quarter before it, and the
   *  shocks are read off the history as it is built, so the spiral can see what inflation did.
   *  With `politics` on, the two meters advance each quarter, the Washington call moves them when
   *  it opens, one political event may open each quarter — answered by `decide` when it is a
   *  choice — and the bill can end the run early, in which case the history stops there.
   *  @param {number[]} rates ten requested rates, quarter 1 first
   *  @param {{acceptedCall?:boolean, params?:typeof PARAMS_1975, initial?:FedState,
   *           politics?:boolean, decide?:(id:string, view:any) => string,
   *           politicsParams?:typeof POLITICS_1975, initialPolitics?:Politics}} [options]
   *    `decide` answers 'hold' | 'promise' to the hearing and 'ease' | 'hold' to the bill; the
   *    default holds the line at both.
   *  @returns {{history:FedState[], peakU:number, final:FedState, politics?:Politics[],
   *    events?:{t:number, id:string, choice:string|null}[], ending?:string|null,
   *    capitulated?:boolean, volcker?:boolean, stage?:number, verdict?:string|null}}
   *    the opening state plus one per quarter played, the worst unemployment reached, and where
   *    it ended; with politics, the meters per quarter, the events by the quarter they opened, and
   *    the verdict */
  function simulate(rates, options) {
    var o = options || {};
    var params = o.params || PARAMS_1975;
    var P = o.politicsParams || POLITICS_1975;
    // A copy, never the constant itself: `history[0]` is handed straight back to the caller, and
    // one poke at it would rewrite INITIAL_1975 for every later simulate(), search() and run.
    var history = [Object.assign({}, o.initial || INITIAL_1975)];
    var peakU = -Infinity;
    var pol = Object.assign({}, o.initialPolitics || INITIAL_POLITICS);
    var politics = [pol];
    /** @type {{t:number, id:string, choice:string|null}[]} */ var events = [];
    /** @type {Record<string, boolean>} */ var fired = {};
    var stage = 0, pending = { demand: 0, supply: 0 };
    var promised = false, capitulated = false, volcker = false;
    /** @type {string|null} */ var ending = null;
    var decide = typeof o.decide === 'function' ? o.decide : function () { return 'hold'; };

    for (var t = 1; t <= TURNS; t++) {
      var state = history[t - 1];
      var rate = clampRate(rates[t - 1], state.rate);
      var shocks = shocksFor(t, { acceptedCall: !!o.acceptedCall, history: history });
      if (o.politics) {
        shocks = { demand: shocks.demand + pending.demand, supply: shocks.supply + pending.supply };
        pending = { demand: 0, supply: 0 };
      }
      var next = step(state, rate, shocks, params);
      history.push(next);
      if (next.u > peakU) peakU = next.u;
      if (!o.politics) continue;

      var broke = promised && rate >= state.rate - 1e-9;
      promised = false;
      pol = stepPolitics(pol, next, { move: rate - state.rate, brokenPromise: broke }, P);
      if (t + 1 === CALL_QUARTER) pol = bump(pol, { washington: o.acceptedCall ? P.callAccept : P.callRefuse });
      var view = politicsView(pol, next, { stage: stage, t: t + 1 });
      var rule = t < TURNS ? dueEvent(view, fired) : null;   // nothing opens after the last quarter
      if (rule) {
        fired[rule.id] = true;
        var choice = rule.choice ? decide(rule.id, view) : null;
        var res = resolveEvent(rule, choice, view, P);
        pol = bump(pol, res.effects);
        if (res.effects.cred) next.cred = clamp(next.cred + res.effects.cred, 0, 1);
        pending.demand += res.effects.demand || 0;
        pending.supply += res.effects.supply || 0;
        if (res.flags.promised) promised = true;
        if (res.flags.capitulated) capitulated = true;
        if (res.flags.volcker) volcker = true;
        if (rule.stage !== undefined) stage = rule.stage + 1;
        events.push({ t: t + 1, id: rule.id, choice: choice });
        if (res.ending) { ending = res.ending; politics.push(pol); break; }
      }
      politics.push(pol);
    }

    var final = history[history.length - 1];
    /** @type {any} */ var out = { history: history, peakU: peakU, final: final };
    if (o.politics) {
      out.politics = politics;
      out.events = events;
      out.ending = ending;
      out.capitulated = capitulated;
      out.volcker = volcker;
      out.stage = stage;
      out.verdict = politicalVerdict(politics[politics.length - 1], { ending: ending }, P);
    }
    return out;
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
   *  brought expectations back down, and 5 for having held the Fed's independence. A term that
   *  Congress ended is capped at endedCap: whatever the numbers were the day the bill passed, the
   *  Chair did not finish the job.
   *  @param {{peakU:number, final:{pi:number, u:number, piExp:number}}} run
   *  @param {{integrity?:boolean, ended?:string|null}} [options]
   *  @returns {{raw:number, stamp:number}} raw out of 105 and a 1–5 stamp */
  function score(run, options) {
    var o = options || {};
    var f = run.final;
    // clamp() propagates NaN and every threshold below compares false against it, so a run handed in
    // without a peakU would fall through to a stamp of 1 — a perfect landing graded as a bloodbath.
    var peak = Number.isFinite(run.peakU) ? run.peakU : 0;
    var raw = 40 * clamp(1 - Math.abs(f.pi - 2) / 9, 0, 1)
      + 30 * clamp(1 - Math.abs(f.u - 6) / 4, 0, 1)
      + 20 * clamp(1 - Math.max(0, peak - 8) / 4, 0, 1)
      + 10 * clamp(1 - Math.abs(f.piExp - 2) / 9, 0, 1)
      + 5 * (o.integrity ? 1 : 0);
    if (o.ended) raw = Math.min(raw, POLITICS_1975.endedCap);
    var stamp = raw >= 70 ? 5 : raw >= 65 ? 4 : raw >= 55 ? 3 : raw >= 42 ? 2 : 1;
    return { raw: raw, stamp: stamp };
  }

  /* ===== search — how good could a run have been? ===== */

  /** Random-sample legal rate paths and keep the best-scoring one. Used to sanity-check that the
   *  par the game hands out is beatable; not part of play. With `politics` on, each path is played
   *  against the meters too, holding the line at every choice unless `decide` says otherwise, and
   *  a capitulation or an ended term scores as it would in the game.
   *  @param {{n?:number, acceptedCall?:boolean, integrity?:boolean, params?:typeof PARAMS_1975,
   *           initial?:FedState, rng?:() => number, politics?:boolean,
   *           decide?:(id:string, view:any) => string}} [options]
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
      var run = simulate(path, { acceptedCall: !!o.acceptedCall, params: o.params, initial: initial, politics: !!o.politics, decide: o.decide });
      var result = score(run, { integrity: integrity && !run.capitulated, ended: run.ending });
      if (result.raw > best.raw) best = { raw: result.raw, stamp: result.stamp, path: path };
    }
    return best;
  }

  return {
    PARAMS_1975: PARAMS_1975, INITIAL_1975: INITIAL_1975, HISTORY_1975: HISTORY_1975,
    RATE_MIN: RATE_MIN, RATE_MAX: RATE_MAX, RATE_STEP: RATE_STEP, MAX_MOVE: MAX_MOVE,
    POLITICS_1975: POLITICS_1975, INITIAL_POLITICS: INITIAL_POLITICS, POLITICAL_EVENTS: POLITICAL_EVENTS,
    CALL_QUARTER: CALL_QUARTER,
    clampRate: clampRate, step: step, shocksFor: shocksFor, simulate: simulate,
    stepPolitics: stepPolitics, bump: bump, politicsView: politicsView, dueEvent: dueEvent,
    resolveEvent: resolveEvent, politicalVerdict: politicalVerdict,
    judgeMove: judgeMove, score: score, search: search
  };
}());

if (typeof module !== 'undefined') module.exports = FedModel;
