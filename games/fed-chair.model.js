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
  var U_FLOOR = 2.0;       // unemployment never reads below this, however hot the gap

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

  /** @typedef {{min:number, max:number, step:number, move:number}} RateBand the rates an era allows */

  /** 1975's band: 2 to 14, a quarter point at a time, a point a quarter. @type {RateBand} */
  var BAND_1975 = { min: RATE_MIN, max: RATE_MAX, step: RATE_STEP, move: MAX_MOVE };

  /** Snap a requested rate to the band's step, then hold it inside both the band and the move
   *  limit. A request that is not a number leaves the rate where it was.
   *  @param {number} requested @param {number} prevRate last quarter's rate
   *  @param {RateBand} [band] defaults to 1975's @returns {number} */
  function clampRate(requested, prevRate, band) {
    var b = band || BAND_1975;
    if (typeof requested !== 'number' || !isFinite(requested)) return prevRate;
    var snapped = Math.round(requested / b.step) * b.step;
    return clamp(snapped, Math.max(b.min, prevRate - b.move), Math.min(b.max, prevRate + b.move));
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
    var u = Math.max(U_FLOOR, p.uStar - p.okun * gap);
    var cred = clamp(state.cred + (real > p.rStar + 1 ? 0.05 : 0) - (real < p.rStar - 2 ? 0.05 : 0), 0, 1);

    return { t: state.t + 1, pi: pi, u: u, gap: gap, piExp: piExp, rate: rate, cred: cred, real: real };
  }

  /* ===== shocksFor — the 1975 schedule ===== */

  /** 1975's scheduled shocks: the oil-shock recession in Q1–Q2, a wage-price spiral in Q6 if
   *  inflation ran above 8 through quarters 4, 5 and 6, and the order books thinning in Q8.
   *  `history[t - 1]` is the state observed at the start of quarter t, so the spiral reads
   *  history[3], history[4] and history[5]. The Washington call is the era's `call`, not here.
   *  @param {number} t 1-based quarter @param {{history?:FedState[]}} [context]
   *  @returns {{demand:number, supply:number}} */
  function shocks1975(t, context) {
    var history = (context || {}).history || [];
    if (t === 1) return { demand: -3, supply: 0 };
    if (t === 2) return { demand: -1, supply: 2 };
    if (t === 6) {
      var spiral = history.length >= 6 && history[3].pi > 8 && history[4].pi > 8 && history[5].pi > 8;
      return { demand: 0, supply: spiral ? 1.5 : 0 };
    }
    if (t === 8) return { demand: -1.5, supply: 0 };
    return { demand: 0, supply: 0 };
  }

  /** 1980: the credit-controls collapse in Q2 and the rebound after, the recession the squeeze
   *  buys in 1981, the tax cut, and the oil glut that finally helps in 1982. */
  function shocks1980(t) {
    if (t === 2) return { demand: -4, supply: 0 };
    if (t === 3) return { demand: 2.5, supply: 0 };
    if (t === 5) return { demand: 0, supply: -1 };
    if (t === 7) return { demand: -1, supply: 0 };
    if (t === 8) return { demand: -1.5, supply: 0 };
    if (t === 9) return { demand: 0, supply: -1.5 };
    return { demand: 0, supply: 0 };
  }

  /** 2008: oil to $147 through the summer, the credit crunch, then the collapse — oil's crash
   *  drags inflation below zero while demand falls out of the floor — and the stimulus of 2009. */
  function shocks2008(t) {
    if (t === 1) return { demand: -1, supply: 1 };
    if (t === 2) return { demand: -0.5, supply: 1.5 };
    if (t === 3) return { demand: -2, supply: 0.5 };
    if (t === 4) return { demand: 0, supply: -3 };       // Lehman's own hit is the era's call
    if (t === 5) return { demand: -3, supply: -1.5 };
    if (t === 6) return { demand: -1.5, supply: -1 };
    if (t === 7) return { demand: 0.5, supply: 1.5 };    // the stimulus lands and oil climbs back
    if (t === 8) return { demand: 1, supply: 1 };
    if (t === 9) return { demand: 0.5, supply: 0 };
    return { demand: 0, supply: 0 };
  }

  /** 2021: the rescue-plan checks and the reopening, then six quarters of supply-side inflation —
   *  snarled supply chains, then the war in Ukraine's oil and food — healing through 2023. */
  function shocks2021(t) {
    if (t === 1) return { demand: 2.5, supply: 0 };
    if (t === 2) return { demand: 1.5, supply: 2.5 };
    if (t === 3) return { demand: 0, supply: 1.5 };
    if (t === 4) return { demand: -0.5, supply: 2 };
    if (t === 5) return { demand: 0, supply: 2.5 };
    if (t === 6) return { demand: 0, supply: 1.5 };
    if (t === 7) return { demand: 0, supply: 0.5 };
    if (t === 8) return { demand: 0, supply: -1 };
    if (t === 9) return { demand: 0, supply: -1.5 };
    if (t === 10) return { demand: 0, supply: -1.5 };
    return { demand: 0, supply: 0 };
  }

  /** The 1975 total, as the game and the tests have always read it: the schedule plus the call.
   *  @param {number} t 1-based quarter
   *  @param {{acceptedCall?:boolean, history?:FedState[]}} [context] the run so far, index 0 = opening state
   *  @returns {{demand:number, supply:number}} */
  function shocksFor(t, context) { return eraShocks('1975', t, context); }

  /** Every shock that lands in quarter t of an era: its schedule, the branch of its pressure beat
   *  the Chair chose, and QE once it has been launched.
   *  @param {string} eraId @param {number} t
   *  @param {{acceptedCall?:boolean, history?:FedState[], qeAt?:number|null}} [context]
   *  @returns {{demand:number, supply:number}} */
  function eraShocks(eraId, t, context) {
    var era = ERAS[eraId] || ERAS['1975'];
    var c = context || {};
    var base = era.shocks(t, c);
    var demand = base.demand, supply = base.supply;
    var branch = c.acceptedCall ? era.call.accept : era.call.refuse;
    var extra = branch && branch[t];
    if (extra) { demand += extra.demand || 0; supply += extra.supply || 0; }
    if (era.qe && c.qeAt && t >= c.qeAt) demand += era.qe.demand;
    return { demand: demand, supply: supply };
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
    cutRelief: 0.10, hikeCost: 0.05, coolBelow: 7, cooling: 0.06, spillAbove: 0.6, spill: 0.10, streetHike: 0,
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
   *                  + streetHike in any quarter the Chair hiked (an era's public that wants the fight)
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
    var move = c.move || 0;
    // streetHike: an era where the public wants the Fed to fight prices credits a Fed it can see hiking
    var street = clamp(prev.street + P.streetSpeed * (target - prev.street) + (move > 1e-9 ? (P.streetHike || 0) : 0), 0, 1);
    var election = P.electionQuarters.indexOf(econ.t) >= 0;
    var jobs = P.jobsHeat * Math.max(0, econ.u - P.jobsBar) * (election ? P.electionBoost : 1);
    var spill = P.spill * Math.max(0, street - P.spillAbove);
    var cool = econ.u < P.coolBelow ? P.cooling : 0;
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

  /* ===== ERAS — four crises: a tuned economy, its real history, its shocks, its politics =====
     Everything an era needs is data here, and the game reads only this. `history` is FRED
     (CPIAUCSL year-over-year, UNRATE, FEDFUNDS; quarterly means, checked 2026-09-03). `call` is
     the era's pressure beat: the quarter it opens, and the shocks each answer adds by quarter.
     `integrityFor` says which answer earns the score's independence point — none for Lehman,
     which is a judgment about a bank, not about Washington. `qe` exists only where the floor does. */

  /** @typedef {{demand?:number, supply?:number}} Shock */
  /** @typedef {{t:number, accept:Record<number, Shock>, refuse:Record<number, Shock>, integrityFor:string|null}} EraCall */

  var ERAS = {
    '1975': {
      year: 1975, chair: 'Burns',
      params: PARAMS_1975, initial: INITIAL_1975, history: HISTORY_1975,
      band: BAND_1975,
      score: { uStar: 6, peakBar: 8, roaredAbove: 9, bloodbathAbove: 10 },
      call: { t: 4, accept: { 4: { demand: 2 } }, refuse: {}, integrityFor: 'refuse' },
      shocks: shocks1975,
      politics: {},
      qe: null
    },
    '1980': {
      year: 1980, chair: 'Volcker',
      // rho under one: the squeeze opens a gap that settles rather than compounds, so a real rate
      // five points over neutral for two years costs the 9-and-a-half unemployment it cost, not 17
      params: { k: 0.20, rStar: 2.0, rho: 0.85, phi: 0.35, FLOOR: -8, a: 0.55, uStar: 6.0, piStar: 2, lambda: 0.08, okun: 0.5 },
      initial: { t: 1, pi: 14.0, u: 6.3, gap: 0.5, piExp: 12.5, rate: 15.0, cred: 0.2 },
      history: {
        pi: [14.2, 14.4, 12.9, 12.5, 11.3, 9.9, 10.9, 9.6, 7.6, 6.9],
        u: [6.3, 7.3, 7.7, 7.4, 7.4, 7.4, 7.4, 8.2, 8.8, 9.4],
        rate: [15.0, 12.7, 9.8, 15.9, 16.6, 17.8, 17.6, 13.6, 14.2, 14.5]
      },
      band: { min: 5, max: 20, step: 0.25, move: 2.0 },
      score: { uStar: 6, peakBar: 9, roaredAbove: 11, bloodbathAbove: 11 },
      call: { t: 4, accept: { 4: { demand: 2 } }, refuse: {}, integrityFor: 'refuse' },
      shocks: shocks1980,
      politics: { electionQuarters: [1, 2, 3, 4] },
      qe: null
    },
    '2008': {
      year: 2008, chair: 'Bernanke',
      // a flat Phillips curve and well-anchored expectations: the "missing deflation" of 2009 —
      // a ten-point gap and prices barely fell — is the era's own lesson; rho near one is the
      // jobless recovery, a gap that will not close on its own
      params: { k: 0.15, rStar: 1.0, rho: 0.97, phi: 0.15, FLOOR: -6, a: 0.85, uStar: 5.0, piStar: 2, lambda: 0.10, okun: 0.5 },
      initial: { t: 1, pi: 4.1, u: 5.0, gap: 0.0, piExp: 2.5, rate: 3.0, cred: 0.7 },
      history: {
        pi: [4.1, 4.3, 5.3, 1.6, -0.2, -0.9, -1.6, 1.5, 2.4, 1.8],
        u: [5.0, 5.3, 6.0, 6.9, 8.3, 9.3, 9.6, 9.9, 9.8, 9.6],
        rate: [3.2, 2.1, 1.9, 0.5, 0.2, 0.2, 0.2, 0.1, 0.1, 0.2]
      },
      band: { min: 0.25, max: 6, step: 0.25, move: 1.0 },
      score: { uStar: 5, peakBar: 9.5, roaredAbove: 6, bloodbathAbove: 11 },
      // Lehman: backstop it and the panic is milder — and the street hates a bailout; let it fail
      // and the crash is the one that happened, in two instalments, and Congress asks why
      call: {
        t: 4, accept: { 4: { demand: -3 }, 5: { demand: -0.5 } }, refuse: { 4: { demand: -4 }, 5: { demand: -1.5 } }, integrityFor: null,
        politics: { accept: { street: 0.25, washington: 0.10 }, refuse: { street: 0.10, washington: 0.20 } }
      },
      shocks: shocks2008,
      politics: { electionQuarters: [1, 2, 3, 4], jobsBar: 7, streetPi: 0.04, piBase: 3, streetU: 0.12, uBase: 5, hotAbove: 0.7 },
      // launched only at the floor; a quarter of QE is worth about half a point of demand
      qe: { demand: 0.6 }
    },
    '2021': {
      year: 2021, chair: 'Powell',
      // a fast-settling gap and a loose Okun link are the tight labour market of 2022; `a` under
      // 0.65 is the era's risk — expectations that come unanchored if the Fed sits at zero
      params: { k: 0.15, rStar: 0.5, rho: 0.8, phi: 0.35, FLOOR: -6, a: 0.70, uStar: 4.0, piStar: 2, lambda: 0.08, okun: 0.35 },
      initial: { t: 1, pi: 1.9, u: 6.2, gap: -3.0, piExp: 2.2, rate: 0.25, cred: 0.8 },
      history: {
        pi: [1.9, 4.8, 5.2, 6.8, 8.0, 8.6, 8.3, 7.1, 5.7, 4.1],
        u: [6.2, 5.9, 5.1, 4.2, 3.9, 3.6, 3.5, 3.6, 3.5, 3.5],
        rate: [0.1, 0.1, 0.1, 0.1, 0.1, 0.8, 2.2, 3.7, 4.5, 5.0]
      },
      band: { min: 0.25, max: 7, step: 0.25, move: 1.5 },
      // a tighter inflation yardstick: 2021's whole job was prices, and the labour market never
      // gave the score anything to lose
      score: { uStar: 4, peakBar: 6.5, roaredAbove: 7, bloodbathAbove: 7, piSpan: 5, expSpan: 5 },
      // keep the bond buying going through the recovery, or taper now
      call: { t: 3, accept: { 3: { demand: 1 }, 4: { demand: 1 } }, refuse: {}, integrityFor: 'refuse' },
      shocks: shocks2021,
      // the street of 2022 is about one thing: prices; hikes cost more with the Senate than in 1975
      politics: { electionQuarters: [5, 6, 7, 8], jobsBar: 6, hikeCost: 0.10, streetPi: 0.24, piBase: 2, streetU: 0.03, uBase: 4, hotAbove: 0.7, streetHike: -0.06, reappointAbove: 0.9 },
      qe: null
    }
  };

  /** The eras in the order the game lists them. */
  var ERA_IDS = ['1975', '1980', '2008', '2021'];

  /** @param {string} eraId @returns {typeof POLITICS_1975} the era's politics: 1975's, overridden */
  function politicsFor(eraId) {
    var era = ERAS[eraId] || ERAS['1975'];
    return Object.assign({}, POLITICS_1975, era.politics || {});
  }

  /** What answering the era's pressure beat does to the meters: Washington eases off a Chair who
   *  did as asked and leans on one who did not — unless the era says otherwise (a bailout angers
   *  the street whichever way it goes).
   *  @param {any} era @param {boolean} accepted @param {typeof POLITICS_1975} P
   *  @returns {{street?:number, washington?:number}} */
  function callBump(era, accepted, P) {
    var own = era.call.politics;
    if (own) return accepted ? own.accept : own.refuse;
    return { washington: accepted ? P.callAccept : P.callRefuse };
  }

  /* ===== simulate — ten quarters ===== */

  /** Play a whole run. Each requested rate is clamped against the quarter before it, and the
   *  shocks are read off the history as it is built, so the spiral can see what inflation did.
   *  With `politics` on, the two meters advance each quarter, the pressure beat moves them when
   *  it opens, one political event may open each quarter — answered by `decide` when it is a
   *  choice — and the bill can end the run early, in which case the history stops there.
   *  @param {number[]} rates ten requested rates, quarter 1 first
   *  @param {{era?:string, acceptedCall?:boolean, qeAt?:number|null, params?:typeof PARAMS_1975,
   *           initial?:FedState, politics?:boolean, decide?:(id:string, view:any) => string,
   *           politicsParams?:typeof POLITICS_1975, initialPolitics?:Politics}} [options]
   *    `era` picks the crisis (default 1975); `qeAt` is the quarter QE was launched in, where the
   *    era has it; `decide` answers 'hold' | 'promise' to the hearing and 'ease' | 'hold' to the
   *    bill; the default holds the line at both.
   *  @returns {{history:FedState[], peakU:number, final:FedState, politics?:Politics[],
   *    events?:{t:number, id:string, choice:string|null}[], ending?:string|null,
   *    capitulated?:boolean, volcker?:boolean, stage?:number, verdict?:string|null}}
   *    the opening state plus one per quarter played, the worst unemployment reached, and where
   *    it ended; with politics, the meters per quarter, the events by the quarter they opened, and
   *    the verdict */
  function simulate(rates, options) {
    var o = options || {};
    var eraId = o.era || '1975';
    var era = ERAS[eraId] || ERAS['1975'];
    var params = o.params || era.params;
    var P = o.politicsParams || politicsFor(eraId);
    var band = era.band;
    // A copy, never the constant itself: `history[0]` is handed straight back to the caller, and
    // one poke at it would rewrite the era's opening state for every later simulate(), search() and run.
    var history = [Object.assign({}, o.initial || era.initial)];
    var peakU = -Infinity;
    var pol = Object.assign({}, o.initialPolitics || INITIAL_POLITICS);
    var politics = [pol];
    /** @type {{t:number, id:string, choice:string|null}[]} */ var events = [];
    /** @type {Record<string, boolean>} */ var fired = {};
    var stage = 0, pending = { demand: 0, supply: 0 };
    var promised = false, capitulated = false, volcker = false;
    /** @type {string|null} */ var ending = null;
    var decide = typeof o.decide === 'function' ? o.decide : function () { return 'hold'; };
    var qeAt = era.qe && o.qeAt ? o.qeAt : null;

    for (var t = 1; t <= TURNS; t++) {
      var state = history[t - 1];
      var rate = clampRate(rates[t - 1], state.rate, band);
      // QE is a thing a Fed does at the floor: a launch in a quarter whose rate is above it never happens
      if (qeAt === t && rate > band.min + 1e-9) qeAt = null;
      var shocks = eraShocks(eraId, t, { acceptedCall: !!o.acceptedCall, history: history, qeAt: qeAt });
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
      if (t + 1 === era.call.t) pol = bump(pol, callBump(era, !!o.acceptedCall, P));
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
   *  still), null when the two mandates disagree and either move is defensible — or when the move
   *  the moment called for was not on the dial: a cut at the floor, a hike at the ceiling.
   *  @param {{pi:number, gap:number, rate?:number}} state
   *  @param {number} rate the rate just set
   *  @param {number} [prevRate] defaults to the rate the state came in with
   *  @param {RateBand} [band] the era's band, default 1975's
   *  @returns {boolean|null} */
  function judgeMove(state, rate, prevRate, band) {
    var b = band || BAND_1975;
    var prev = prevRate === undefined ? state.rate : prevRate;
    if (state.pi > 4 && state.gap >= -2) return prev >= b.max - 1e-9 ? null : rate > prev;    // inflation high, slack nearly gone: hike
    if (state.gap < -3 && state.pi < 6) return prev <= b.min + 1e-9 ? null : rate < prev;     // deep recession, inflation off the boil: cut
    return null;
  }

  /* ===== score — the report card ===== */

  /** Score a finished run out of 105: 40 for landing inflation on target, 30 for unemployment at
   *  the era's natural rate, 20 for not having wrecked the labour market on the way (past the
   *  era's bar), 10 for having brought expectations back down, and 5 for having held the Fed's
   *  independence. A term that Congress ended is capped at endedCap: whatever the numbers were the
   *  day the bill passed, the Chair did not finish the job.
   *  @param {{peakU:number, final:{pi:number, u:number, piExp:number}}} run
   *  @param {{integrity?:boolean, ended?:string|null, era?:string}} [options]
   *  @returns {{raw:number, stamp:number}} raw out of 105 and a 1–5 stamp */
  function score(run, options) {
    var o = options || {};
    var f = run.final;
    var target = (ERAS[o.era || '1975'] || ERAS['1975']).score;
    var piSpan = target.piSpan || 9, expSpan = target.expSpan || 9;
    // clamp() propagates NaN and every threshold below compares false against it, so a run handed in
    // without a peakU would fall through to a stamp of 1 — a perfect landing graded as a bloodbath.
    var peak = Number.isFinite(run.peakU) ? run.peakU : 0;
    var raw = 40 * clamp(1 - Math.abs(f.pi - 2) / piSpan, 0, 1)
      + 30 * clamp(1 - Math.abs(f.u - target.uStar) / 4, 0, 1)
      + 20 * clamp(1 - Math.max(0, peak - target.peakBar) / 4, 0, 1)
      + 10 * clamp(1 - Math.abs(f.piExp - 2) / expSpan, 0, 1)
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
    var eraId = o.era || '1975';
    var era = ERAS[eraId] || ERAS['1975'];
    var band = era.band;
    var n = o.n === undefined ? 500 : o.n;
    var rng = o.rng || Math.random;
    var initial = o.initial || era.initial;
    var integrity = o.integrity === undefined ? true : o.integrity;
    var best = { raw: -Infinity, stamp: 1, path: /** @type {number[]} */ ([]) };
    var choices = Math.round(2 * band.move / band.step) + 1;   // every rate within a move of last quarter's

    for (var trial = 0; trial < n; trial++) {
      var path = /** @type {number[]} */ ([]);
      var prev = initial.rate;
      for (var t = 1; t <= TURNS; t++) {
        var rate = clampRate(prev - band.move + band.step * Math.floor(rng() * choices), prev, band);
        path.push(rate);
        prev = rate;
      }
      var run = simulate(path, { era: eraId, acceptedCall: !!o.acceptedCall, qeAt: o.qeAt || null, params: o.params, initial: initial, politics: !!o.politics, decide: o.decide });
      var result = score(run, { integrity: integrity && !run.capitulated, ended: run.ending, era: eraId });
      if (result.raw > best.raw) best = { raw: result.raw, stamp: result.stamp, path: path };
    }
    return best;
  }

  return {
    PARAMS_1975: PARAMS_1975, INITIAL_1975: INITIAL_1975, HISTORY_1975: HISTORY_1975,
    RATE_MIN: RATE_MIN, RATE_MAX: RATE_MAX, RATE_STEP: RATE_STEP, MAX_MOVE: MAX_MOVE, BAND_1975: BAND_1975,
    POLITICS_1975: POLITICS_1975, INITIAL_POLITICS: INITIAL_POLITICS, POLITICAL_EVENTS: POLITICAL_EVENTS,
    CALL_QUARTER: CALL_QUARTER, ERAS: ERAS, ERA_IDS: ERA_IDS,
    clampRate: clampRate, step: step, shocksFor: shocksFor, eraShocks: eraShocks, politicsFor: politicsFor,
    callBump: callBump, U_FLOOR: U_FLOOR, simulate: simulate,
    stepPolitics: stepPolitics, bump: bump, politicsView: politicsView, dueEvent: dueEvent,
    resolveEvent: resolveEvent, politicalVerdict: politicalVerdict,
    judgeMove: judgeMove, score: score, search: search
  };
}());

if (typeof module !== 'undefined') module.exports = FedModel;
