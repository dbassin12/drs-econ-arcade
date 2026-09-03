// @ts-check
/* DRS Econ Arcade — The Investor's model: five assets, honest rules, twelve quarters.
   Pure functions only; the page and `node --test` both load this file.

   The rules are the ones the exam tests, kept simple enough to say in a sentence each:
   cash earns the short rate and inflation eats it; a CD locks the rate it was bought at;
   long bonds move inverse to rates (a rise of one point costs about 3.5%); stocks like growth
   and hate rate spikes; real estate loves falling mortgage rates. Every return is nominal
   until `realReturn` deflates it, which is the lesson. */
var InvestorModel = (function () {
  'use strict';

  /** The five buckets, in tray order. */
  var ASSET_IDS = ['cash', 'cd', 'bonds', 'stocks', 'realestate'];
  var START_VALUE = 10000;
  var COINS = 10;                           // each coin is a tenth of the portfolio

  /** Response of each asset to the quarter's facts. Per-point rate moves, annual growth above 2. */
  var RULES = {
    bondDuration: 3.5,                      // % price change per point of Fed move (long rates move about half the short move × duration 7)
    stockBase: 1.5,                         // % per quarter with growth at trend
    stockGrowth: 0.8,                       // % per point of annual growth above 2
    stockRate: 3.0,                         // % lost per point of Fed hike
    reBase: 1.0,
    reGrowth: 0.3,
    reRate: 2.0,                            // mortgage rates follow long rates
    bondCoupon: 1.0,                        // % per quarter
    cdSpread: 0.5                           // a CD pays the short rate plus this, locked at purchase
  };

  /** What a named shock does to each asset that quarter, in % points. */
  var SHOCKS = {
    crash: { stocks: -15 },
    rally: { stocks: 8 },
    flight: { bonds: 3, stocks: -6 },       // a flight to safety
    housingBust: { realestate: -10 },
    housingBoom: { realestate: 6 }
  };

  /** @param {number} v @returns {number} two decimals */
  function r2(v) { return Math.round(v * 100) / 100; }

  /** Nominal quarterly return of each asset, in %.
   *  @param {{rate:number, dRate:number, inflation:number, growth:number, shock?:string|null}} q
   *    rate: the short rate at the start of the quarter (annual %); dRate: the Fed's move this
   *    quarter in points; inflation and growth annual %; shock: a SHOCKS key or null
   *  @param {{cdRate:number}} held the CD rate locked when it was bought
   *  @returns {Object<string, number>} */
  function returns(q, held) {
    var shock = (q.shock && SHOCKS[q.shock]) || {};
    var out = {
      cash: q.rate / 4,
      cd: held.cdRate / 4,
      bonds: RULES.bondCoupon - RULES.bondDuration * q.dRate + (shock.bonds || 0),
      stocks: RULES.stockBase + RULES.stockGrowth * (q.growth - 2) - RULES.stockRate * Math.max(0, q.dRate) + (shock.stocks || 0),
      realestate: RULES.reBase + RULES.reGrowth * (q.growth - 2) - RULES.reRate * q.dRate + (shock.realestate || 0)
    };
    ASSET_IDS.forEach(function (id) { out[id] = r2(out[id]); });
    return out;
  }

  /** @param {number} nominalPct quarterly @param {number} inflationAnnual @returns {number} the real quarterly return, % */
  function realReturn(nominalPct, inflationAnnual) {
    return r2(((1 + nominalPct / 100) / (1 + inflationAnnual / 400) - 1) * 100);
  }

  /** @param {number[]} coins ten coins across ASSET_IDS order @returns {boolean} */
  function validCoins(coins) {
    if (!Array.isArray(coins) || coins.length !== ASSET_IDS.length) return false;
    var sum = 0;
    for (var i = 0; i < coins.length; i += 1) { if (!Number.isInteger(coins[i]) || coins[i] < 0) return false; sum += coins[i]; }
    return sum === COINS;
  }

  /** One quarter: the allocation is applied to the portfolio, then every bucket earns its return.
   *  @param {{value:number, priceLevel:number, cdRate:number}} state
   *  @param {number[]} coins the allocation for the quarter
   *  @param {{rate:number, dRate:number, inflation:number, growth:number, shock?:string|null}} q
   *  @returns {{value:number, priceLevel:number, cdRate:number, returns:Object<string, number>, gains:Object<string, number>, nominalPct:number, realPct:number, realValue:number}} */
  function step(state, coins, q) {
    if (!validCoins(coins)) throw new Error('ten coins, please');
    var held = { cdRate: coins[1] > 0 ? (state.cdRate || (q.rate + RULES.cdSpread)) : 0 };
    // a CD bought this quarter locks the rate on offer now; one already held keeps its rate
    if (coins[1] > 0 && !state.cdRate) held.cdRate = q.rate + RULES.cdSpread;
    var rets = returns(q, held);
    var value = 0;
    var gains = {};
    ASSET_IDS.forEach(function (id, i) {
      var slice = state.value * coins[i] / COINS;
      var gain = slice * rets[id] / 100;
      gains[id] = r2(gain);
      value += slice + gain;
    });
    var priceLevel = state.priceLevel * (1 + q.inflation / 400);
    var nominalPct = r2((value / state.value - 1) * 100);
    return {
      value: r2(value),
      priceLevel: r2(priceLevel),
      cdRate: coins[1] > 0 ? held.cdRate : 0,
      returns: rets,
      gains: gains,
      nominalPct: nominalPct,
      realPct: realReturn(nominalPct, q.inflation),
      realValue: r2(value / priceLevel)
    };
  }

  /** @returns {{value:number, priceLevel:number, cdRate:number}} */
  function initial() { return { value: START_VALUE, priceLevel: 1, cdRate: 0 }; }

  /** Play a whole scenario with a fixed allocation each quarter.
   *  @param {{rate0:number, quarters:{dRate:number, inflation:number, growth:number, shock?:string|null}[]}} scenario
   *  @param {(q:any, i:number, state:any) => number[]} allocate
   *  @returns {{finalValue:number, realValue:number, realPct:number, priceLevel:number, history:any[]}} */
  function simulate(scenario, allocate) {
    var state = initial();
    var rate = scenario.rate0;
    var history = [];
    for (var i = 0; i < scenario.quarters.length; i += 1) {
      var src = scenario.quarters[i];
      var q = { rate: rate, dRate: src.dRate, inflation: src.inflation, growth: src.growth, shock: src.shock || null };
      var coins = allocate(q, i, state);
      var next = step(state, coins, q);
      history.push({ q: q, coins: coins.slice(), result: next });
      state = { value: next.value, priceLevel: next.priceLevel, cdRate: next.cdRate };
      rate = r2(rate + src.dRate);
    }
    return { finalValue: state.value, realValue: r2(state.value / state.priceLevel), realPct: r2((state.value / state.priceLevel / START_VALUE - 1) * 100), priceLevel: state.priceLevel, history: history };
  }

  /** The do-nothing yardstick: the better of a fifth in every bucket and all cash, all the way
   *  through — so a hiking cycle, where balanced money gets hammered, does not make sitting in
   *  cash look like genius. @param {any} scenario @returns {number} real % */
  function benchmark(scenario) {
    var balanced = simulate(scenario, function () { return [2, 2, 2, 2, 2]; }).realPct;
    var cash = simulate(scenario, function () { return [10, 0, 0, 0, 0]; }).realPct;
    return Math.max(balanced, cash);
  }

  /** The AP stamp, 1–5, from the real return against the scenario's par.
   *  @param {number} realPct @param {number} par @returns {number} */
  function stamp(realPct, par) {
    var edge = realPct - par;
    if (edge >= 8) return 5;
    if (edge >= 3) return 4;
    if (edge >= -2) return 3;
    if (edge >= -8) return 2;
    return 1;
  }

  /** The lesson a quarter teaches, by what mattered most in it. @param {any} q @param {Object<string, number>} rets @returns {string} */
  function lessonFor(q, rets) {
    if (q.shock === 'crash') return 'crash';
    if (q.shock === 'flight') return 'flight';
    if (q.shock === 'housingBust' || q.shock === 'housingBoom') return 'housing';
    if (q.dRate > 0) return 'bondsDown';
    if (q.dRate < 0) return 'bondsUp';
    if (q.inflation >= 5) return 'realVsNominal';
    if (rets && rets.cd > rets.cash + 0.05) return 'cdLock';
    return 'transmission';
  }

  /** Badges earned over a run's history.
   *  @param {{highInflation?:boolean}} scenario @param {any[]} history simulate()'s history
   *  @param {number} realPct
   *  @returns {string[]} */
  function badges(scenario, history, realPct) {
    var out = [];
    var whisperer = history.some(function (h) { return h.q.dRate < 0 && h.coins[2] >= 3 && h.result.returns.bonds > 0; });
    if (whisperer) out.push('bondWhisperer');
    if (scenario.highInflation && realPct > 0) out.push('inflationSurvivor');
    for (var i = 0; i < history.length; i += 1) {
      if (history[i].q.shock !== 'crash' || history[i].coins[3] < 3) continue;
      for (var j = i + 1; j < history.length; j += 1) {
        if (history[j].coins[3] < 3) break;
        if (history[j].q.shock === 'rally') { out.push('diamondHands'); i = history.length; break; }
      }
    }
    return out;
  }

  return {
    ASSET_IDS: ASSET_IDS, START_VALUE: START_VALUE, COINS: COINS, RULES: RULES, SHOCKS: SHOCKS,
    returns: returns, realReturn: realReturn, validCoins: validCoins, step: step, initial: initial,
    simulate: simulate, benchmark: benchmark, stamp: stamp, lessonFor: lessonFor, badges: badges
  };
}());

if (typeof module !== 'undefined') module.exports = InvestorModel;
