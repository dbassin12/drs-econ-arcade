// @ts-check
/* DRS Econ Arcade — Crisis Country's model: one small open economy, twelve turns, a hand of
   policy cards. Pure functions only; the page and `node --test` both load this file.

   The state is what a finance minister watches: the output gap (% of potential), inflation,
   unemployment, the exchange rate (an index, 100 at the start), reserves (months of imports),
   debt (% of GDP), popularity (0–100), and whether the central bank is still independent.
   Each turn a card moves the state through the textbook's own chains — G↑ → AD→right → PL↑
   Y↑ u↓; a rate hike → AD→left and the currency appreciates; printing money → AD→right and
   expectations unmoored — then the economy self-corrects a little, the Phillips relation
   sets inflation, Okun's law sets unemployment, reserves follow the trade balance and any
   defence of the currency, and the public reacts. */
var CrisisModel = (function () {
  'use strict';

  var TURNS = 12;
  var U_STAR = 5;                  // the natural rate
  var PI_TARGET = 3;               // where prices are meant to settle

  /** How the economy answers, per turn. */
  var DYN = {
    gapDecay: 0.25,                // the share of the output gap that closes on its own each turn
    phillips: 0.5,                 // inflation points per point of gap
    anchoring: 0.65,               // how much of last turn's inflation carries into expectations
    okun: 0.5,                     // unemployment points per point of gap
    passThrough: 0.08,             // inflation points per point of depreciation
    tradeGap: 0.15,                // reserves (months) lost per point of positive gap (imports)
    tradeFx: 0.02,                 // reserves gained per point of depreciation (exports)
    flightBase: 0.3,               // reserves drained per turn while the currency is under pressure
    popUnemp: 2,                   // popularity lost per point of unemployment above u*
    popInflation: 0.5,             // popularity lost per point of inflation above target
    popPainCap: 6,                 // the most the economy can cost in one turn
    popRelief: 2.5,                // popularity won per point inflation falls in a turn (beating inflation is the one popular cure)
    popDrift: 4                    // popularity drifts back toward 50 by this much a turn
  };

  /** What every card does, in one line each. `chain` is the FRQ sentence the card flips to.
   *  Effects: gap (pp of output), pi (inflation pp, this turn), exp (expected-inflation pp,
   *  lasting), e (exchange-rate index points, + is appreciation), reserves (months), debt (pp of
   *  GDP), pop (points), leanOnBank (ends independence), float/peg (regime), reply (next turn's gap). */
  var CARDS = {
    spend: { name: 'Public works', kind: 'fiscal', emoji: '🏗️', gap: 1.5, debt: 3, pop: 6, chain: 'G↑ → AD shifts right → PL↑, real GDP↑, u↓; financed by borrowing, so debt↑ and, with a fixed money supply, the real interest rate↑ crowds out some private investment.' },
    taxcut: { name: 'Cut taxes', kind: 'fiscal', emoji: '✂️', gap: 1.2, debt: 2.5, pop: 5, chain: 'T↓ → disposable income↑ → C↑ → AD shifts right → PL↑, real GDP↑, u↓; the tax multiplier is smaller than the spending multiplier because part of the cut is saved.' },
    taxup: { name: 'Raise taxes', kind: 'fiscal', emoji: '🧾', gap: -1.2, exp: -0.5, debt: -2.5, pop: -7, chain: 'T↑ → disposable income↓ → C↓ → AD shifts left → PL↓, real GDP↓, u↑; the deficit shrinks and the debt path improves.' },
    austerity: { name: 'Cut spending', kind: 'fiscal', emoji: '📉', gap: -1.5, exp: -0.5, debt: -3, pop: -6, chain: 'G↓ → AD shifts left → PL↓, real GDP↓, u↑; the smaller deficit lowers the demand for loanable funds and the real interest rate↓.' },
    hike: { name: 'Raise the policy rate', kind: 'monetary', emoji: '📈', gap: -1.0, exp: -1.5, e: 6, reserves: 0.4, pop: -2, chain: 'Policy rate↑ → nominal and real interest rates↑ → interest-sensitive C and I↓ → AD shifts left → PL↓, real GDP↓, u↑; higher returns attract capital inflows → demand for the currency↑ → it appreciates.' },
    cut: { name: 'Cut the policy rate', kind: 'monetary', emoji: '📉', gap: 1.0, exp: 0.5, e: -6, reserves: -0.3, pop: 2, chain: 'Policy rate↓ → real interest rate↓ → C and I↑ → AD shifts right → PL↑, real GDP↑, u↓; capital flows out → demand for the currency↓ → it depreciates, which raises net exports.' },
    print: { name: 'Print money to pay the bills', kind: 'monetary', emoji: '🖨️', gap: 1.5, pi: 3, exp: 3, e: -10, pop: 3, chain: 'Money supply↑ → nominal interest rate↓ → AD shifts right → PL↑; financing deficits with money raises expected inflation → SRAS shifts left → PL↑ again with no lasting gain in output, and the currency depreciates.' },
    lean: { name: 'Lean on the central bank', kind: 'monetary', emoji: '🏛️', gap: 0.8, exp: 2, e: -4, pop: 2, leanOnBank: true, chain: 'A central bank that takes orders from the treasury loses credibility: expected inflation↑ → SRAS shifts left → PL↑ for the same output; the currency depreciates on the lost anchor.' },
    reform: { name: 'Currency reform + independent bank', kind: 'monetary', emoji: '⚓', gap: -1.0, pi: -5, exp: -10, e: 6, debt: -2, pop: -4, restoreBank: true, chain: 'A credible new anchor — an independent central bank forbidden to finance the deficit, and a new currency — lowers expected inflation → SRAS shifts right → PL↓ for the same output; it holds only if the printing stops.' },
    float: { name: 'Float the currency', kind: 'exchange', emoji: '🌊', regime: 'float', e: -8, pop: -2, chain: 'Abandoning the peg lets the exchange rate fall to where supply of and demand for the currency meet: depreciation → exports↑, imports↓ → net exports↑ → AD shifts right; the central bank stops selling reserves to defend the rate.' },
    defend: { name: 'Defend the peg', kind: 'exchange', emoji: '🛡️', regime: 'peg', reserves: -1.2, e: 2, pop: 1, chain: 'To hold a fixed exchange rate the central bank sells foreign reserves and buys its own currency; reserves fall each turn the pressure lasts, and when they run out the peg breaks anyway.' },
    devalue: { name: 'Devalue 15%', kind: 'exchange', emoji: '⚖️', e: -15, gap: 1.2, pi: 1.5, reserves: 0.6, pop: -5, chain: 'A devaluation makes exports cheaper abroad and imports dearer at home → net exports↑ → AD shifts right → real GDP↑, u↓; import prices↑ → PL↑; the current account improves.' },
    controls: { name: 'Capital controls', kind: 'exchange', emoji: '🚧', reserves: 0.8, e: 2, gap: -0.3, pop: -2, calm: true, chain: 'Capital controls stop the outflow that was draining reserves and holding the currency down, at the cost of investor confidence; the financial account is closed off, so the current account must adjust instead.' },
    tariff: { name: 'Tariffs on imports', kind: 'trade', emoji: '🧱', gap: 0.4, pi: 0.8, reserves: 0.3, pop: 4, reply: -0.8, chain: 'Tariffs raise import prices → PL↑ and shift spending toward domestic goods → net exports↑ in the short run; trading partners retaliate, so exports fall the next turn and the gain reverses.' },
    tradedeal: { name: 'Sign a trade deal', kind: 'trade', emoji: '🤝', gap: 0.3, pi: -0.5, reserves: 0.2, pop: -1, reply: 0.5, chain: 'Lower trade barriers → import prices↓ → PL↓; exports↑ as partners open too → net exports↑ → AD shifts right over time; gains from specialization raise real income.' },
    imf: { name: 'IMF loan with conditions', kind: 'imf', emoji: '🏦', reserves: 2.5, gap: -1.0, exp: -2, e: 4, debt: 4, pop: -6, chain: 'An IMF loan rebuilds reserves and restores confidence in the currency; its conditions cut the deficit → AD shifts left → real GDP↓, u↑ in the short run, in exchange for a sustainable debt path.' },
    hold: { name: 'Hold course', kind: 'none', emoji: '⏸️', chain: 'No policy change: the economy self-corrects toward potential as wages and prices adjust, which is slow when the gap is large.' }
  };
  var CARD_IDS = Object.keys(CARDS);

  /** @param {number} v @returns {number} */
  function r1(v) { return Math.round(v * 10) / 10; }
  /** @param {number} v @param {number} lo @param {number} hi @returns {number} */
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  /** @returns {{gap:number, pi:number, exp:number, u:number, e:number, reserves:number, debt:number, pop:number, independent:boolean, regime:string, pressure:number, reply:number, turn:number}} */
  function blank() {
    return { gap: 0, pi: PI_TARGET, exp: PI_TARGET, u: U_STAR, e: 100, reserves: 4, debt: 50, pop: 55, independent: true, regime: 'float', pressure: 0, reply: 0, controls: false, turn: 0 };
  }

  /** The hand a minister can draw from this turn. @param {any} s @returns {string[]} */
  function hand(s) {
    var ids = ['spend', 'taxcut', 'taxup', 'austerity', 'tariff', 'tradedeal', 'imf', 'hold'];
    if (s.independent) ids.push('lean'); else ids.push('hike', 'cut', 'print', 'reform');
    if (s.regime === 'peg') ids.push('float', 'devalue', 'defend'); else ids.push('controls');
    if (s.regime === 'float') ids.push('devalue');
    return ids.filter(function (id, i, arr) { return arr.indexOf(id) === i; });
  }

  /** One turn: the card, the shock, then the economy answers.
   *  @param {any} s the state @param {string} cardId @param {{gap?:number, pi?:number, exp?:number, e?:number, reserves?:number, pop?:number, pressure?:number, bank?:string}} [shock]
   *    `bank`: what an independent central bank does on its own this turn — 'hike' | 'cut' | null
   *  @returns {any} the next state, with `card`, `shock` and `effects` recorded */
  function step(s, cardId, shock) {
    var c = CARDS[cardId];
    if (!c) throw new Error('no such card: ' + cardId);
    var k = shock || {};
    var n = {};
    Object.keys(s).forEach(function (key) { n[key] = s[key]; });
    n.turn = s.turn + 1;

    // the card, this turn
    var gapPush = (c.gap || 0) + s.reply + (k.gap || 0);
    var piPush = (c.pi || 0) + (k.pi || 0);
    n.exp = s.exp + (c.exp || 0) + (k.exp || 0);
    n.e = s.e + (c.e || 0) + (k.e || 0);
    n.reserves = s.reserves + (c.reserves || 0) + (k.reserves || 0);
    n.debt = s.debt + (c.debt || 0);
    n.reply = c.reply || 0;
    if (c.leanOnBank) n.independent = false;
    if (c.restoreBank) n.independent = true;
    if (c.regime) n.regime = c.regime;
    if (k.pressure !== undefined) n.pressure = k.pressure;

    // an independent bank acts on its own mandate
    var bank = n.independent ? (k.bank || null) : null;
    if (bank === 'hike') { gapPush -= 0.8; n.exp -= 0.4; n.e += 4; }
    if (bank === 'cut') { gapPush += 0.8; n.exp += 0.2; n.e -= 4; }
    n.bank = bank;

    // capital controls, once imposed, keep the outflow shut; the Fund's money calms it for a turn
    if (c.calm) n.controls = true;
    var calm = !!n.controls || cardId === 'imf';
    // a peg under pressure bleeds reserves unless something stopped the outflow; out of reserves, it breaks
    if (n.regime === 'peg' && n.pressure > 0 && !calm) n.reserves -= DYN.flightBase * n.pressure;
    if (n.regime === 'peg' && n.reserves <= 0) { n.regime = 'float'; n.e -= 15; n.reserves = 0; n.broke = true; }
    if (n.regime === 'float' && n.pressure > 0 && !calm) n.e -= 3 * n.pressure;
    n.reserves = clamp(n.reserves, 0, 12);

    // the economy answers
    var depreciation = s.e - n.e;                                             // + when the currency fell
    n.gap = s.gap * (1 - DYN.gapDecay) + gapPush + 0.04 * depreciation;       // a cheaper currency lifts net exports
    n.pi = DYN.anchoring * s.pi + (1 - DYN.anchoring) * n.exp + DYN.phillips * n.gap + piPush + DYN.passThrough * Math.max(0, depreciation);
    n.exp = 0.5 * n.exp + 0.5 * n.pi;                                          // expectations chase what happened
    n.u = clamp(U_STAR - DYN.okun * n.gap, 1.5, 30);
    n.reserves = clamp(n.reserves - DYN.tradeGap * Math.max(0, n.gap) + DYN.tradeFx * Math.max(0, depreciation), 0, 12);
    var pain = Math.min(DYN.popPainCap, DYN.popUnemp * Math.max(0, n.u - U_STAR) + DYN.popInflation * Math.max(0, n.pi - PI_TARGET));
    var relief = DYN.popRelief * Math.max(0, Math.min(s.pi, 30) - Math.max(n.pi, PI_TARGET));
    n.pop = clamp(s.pop + (c.pop || 0) + (k.pop || 0) - pain + relief + DYN.popDrift * (50 - s.pop) / 50, 0, 100);

    ['gap', 'pi', 'exp', 'u', 'e', 'reserves', 'debt', 'pop'].forEach(function (key) { n[key] = r1(n[key]); });
    n.card = cardId;
    n.shock = k;
    return n;
  }

  /** Is the country stable? The win condition, checked after any turn. @param {any} s @returns {{ok:boolean, inflation:boolean, jobs:boolean, reserves:boolean}} */
  function stable(s) {
    var inflation = Math.abs(s.pi - PI_TARGET) <= 2;
    var jobs = s.u <= U_STAR + 1.5;
    var reserves = s.reserves >= 2;
    return { ok: inflation && jobs && reserves, inflation: inflation, jobs: jobs, reserves: reserves };
  }

  /** How the run ended early, if it did. @param {any} s @returns {string|null} 'election' | 'hyperinflation' | 'default' */
  function ended(s) {
    if (s.pi >= 40) return 'hyperinflation';
    if (s.reserves <= 0 && s.debt >= 120) return 'default';
    return null;
  }

  /** The score: 70 for a clean end state, less how far it sits from stability, plus up to 30
   *  for stabilizing early — so a 5 needs both a healthy country and a quick hand.
   *  @param {any} s the end state @param {{turnsToStable:number|null, endedBy:string|null}} run
   *  @returns {{score:number, stamp:number}} */
  function score(s, run) {
    var miss = Math.abs(s.pi - PI_TARGET) * 4 + Math.max(0, s.u - U_STAR) * 6 + Math.max(0, 3 - s.reserves) * 8 + Math.max(0, s.debt - 90) * 0.5;
    var sc = 70 - miss;
    if (run.turnsToStable !== null) sc += 30 * Math.max(0, TURNS - run.turnsToStable) / (TURNS - 1);
    sc = clamp(sc, 0, 100);
    if (run.endedBy) sc = Math.min(sc, run.endedBy === 'election' ? 45 : 20);
    var stamp = sc >= 82 ? 5 : sc >= 68 ? 4 : sc >= 55 ? 3 : sc >= 35 ? 2 : 1;
    return { score: Math.round(sc), stamp: stamp };
  }

  return {
    TURNS: TURNS, U_STAR: U_STAR, PI_TARGET: PI_TARGET, DYN: DYN, CARDS: CARDS, CARD_IDS: CARD_IDS,
    blank: blank, hand: hand, step: step, stable: stable, ended: ended, score: score
  };
}());

if (typeof module !== 'undefined') module.exports = CrisisModel;
