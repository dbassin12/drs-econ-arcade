// @ts-check
/* DRS Econ Arcade — the shared engine every game loads.
   Sections: storage · sound · voice · tracker · motion · components.
   Nothing here touches the DOM at load except the guarded first-gesture listener in the
   sound section, so the pure half runs under `node --test`. */
var Arcade = (function () {
  'use strict';

  /* ===== STORAGE — arcade.* keys as JSON, with an in-memory Map when storage dies ===== */

  /** Stand-in used whenever localStorage is missing, blocked, or full. @type {Map<string, any>} */
  var mem = new Map();

  var store = {
    /** @param {string} key @param {*} [fallback] used when the key is absent or unreadable @returns {*} */
    get: function (key, fallback) {
      try {
        if (typeof localStorage !== 'undefined') {
          var raw = localStorage.getItem(key);
          return raw === null ? fallback : JSON.parse(raw);
        }
      } catch (err) { /* blocked or corrupt — read the memory copy instead */ }
      return mem.has(key) ? mem.get(key) : fallback;
    },
    /** @param {string} key @param {*} value JSON-serialisable @returns {boolean} false only if unstorable */
    set: function (key, value) {
      var json;
      try { json = JSON.stringify(value); } catch (err) { return false; }
      if (json === undefined) return false;
      try {
        if (typeof localStorage !== 'undefined') { localStorage.setItem(key, json); return true; }
      } catch (err) { /* quota or private mode — keep it for this session only */ }
      mem.set(key, JSON.parse(json));
      return true;
    },
    /** @param {string} key */
    remove: function (key) {
      try {
        if (typeof localStorage !== 'undefined') localStorage.removeItem(key);
      } catch (err) { /* nothing worth reporting */ }
      mem.delete(key);
    }
  };

  /** @param {*} s @returns {string} three A–Z characters, padded with ? */
  function normalizeInitials(s) {
    var letters = String(s === null || s === undefined ? '' : s).toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
    return (letters + '???').slice(0, 3);
  }

  /** @returns {string} the player's tag, '???' until they set one */
  function initials() { return normalizeInitials(store.get('arcade.initials', '')); }

  /** @param {string} s @returns {string} the normalised value that was stored */
  function setInitials(s) {
    var v = normalizeInitials(s);
    store.set('arcade.initials', v);
    return v;
  }

  /** @param {string} game @returns {{score:number, initials:string, date:string, level?:number}|null} */
  function bests(game) {
    var b = store.get('arcade.' + game + '.best', null);
    return b && typeof b === 'object' && typeof b.score === 'number' ? b : null;
  }

  /** @param {string} game @param {{score:number, initials?:string, level?:number}} entry
   *  @returns {boolean} true when this run beat the stored best */
  function saveBest(game, entry) {
    var score = Number(entry && entry.score);
    if (!Number.isFinite(score)) return false;
    var prev = bests(game);
    if (prev && prev.score >= score) return false;
    /** @type {{score:number, initials:string, date:string, level?:number}} */
    var rec = { score: score, initials: normalizeInitials(entry.initials || initials()), date: new Date().toISOString() };
    if (entry.level !== undefined && entry.level !== null) rec.level = entry.level;
    return store.set('arcade.' + game + '.best', rec);
  }

  /** @param {string} name @param {*} [fallback] @returns {*} query-string value, or fallback off-browser */
  function qs(name, fallback) {
    try {
      if (typeof location === 'undefined') return fallback;
      var v = new URLSearchParams(location.search).get(name);
      return v === null ? fallback : v;
    } catch (err) { return fallback; }
  }

  /* ===== SOUND — one AudioContext, opened by the first gesture; every cue synthesised ===== */

  /** @type {any} */ var ctx = null;
  /** @type {any} */ var master = null;
  var muted = store.get('arcade.muted', false) === true;
  var gestureBound = false;
  var speechPrimed = false;

  /** Create (once) and resume the AudioContext. The only `new AudioContext` in the arcade. */
  function unlock() {
    // Two try blocks, not one. Only construction may null the references: a throw out of resume()
    // on a context that already exists means "still locked", not "there is no context" — and
    // discarding a live one there leaked it and left audio dead for the session, because the
    // first-gesture listeners had already been detached.
    if (!ctx) {
      try {
        var w = /** @type {any} */ (typeof window !== 'undefined' ? window : null);
        var Ctor = w && (w.AudioContext || w.webkitAudioContext);
        if (!Ctor) return;
        var c = new Ctor();
        var m = c.createGain();
        m.gain.value = 0.9;
        m.connect(c.destination);
        ctx = c;
        master = m;
      } catch (err) { ctx = null; master = null; return; }
    }
    try {
      if (ctx.state === 'running') { detachFirstGesture(); return; }
      var p = ctx.resume();
      if (p && typeof p.then === 'function') p.then(detachFirstGesture, function () { /* stays locked */ });
    } catch (err) { /* stays locked, and the context survives for the next gesture */ }
  }

  /** One oscillator with an exponential gain envelope. `end` sweeps the pitch, `to` swaps the
   *  destination so a recipe can insert a filter.
   *  @param {number} freq @param {number} start AudioContext time @param {number} dur seconds
   *  @param {{type?:string, gain?:number, end?:number, to?:any}} [opts] */
  function tone(freq, start, dur, opts) {
    if (!ctx || !master) return;
    var o = opts || {};
    var osc = ctx.createOscillator();
    var g = ctx.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(freq, start);
    if (o.end) osc.frequency.exponentialRampToValueAtTime(o.end, start + dur);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(Math.min(0.12, o.gain === undefined ? 0.09 : o.gain), start + Math.min(0.012, dur / 3));
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(g);
    g.connect(o.to || master);
    osc.start(start);
    osc.stop(start + dur + 0.03);
  }

  /** A burst of white noise through a bandpass.
   *  @param {number} start @param {number} dur @param {{gain?:number, freq?:number}} [opts] */
  function noise(start, dur, opts) {
    if (!ctx || !master) return;
    var o = opts || {};
    var frames = Math.max(1, Math.floor(ctx.sampleRate * dur));
    var buf = ctx.createBuffer(1, frames, ctx.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < frames; i += 1) data[i] = Math.random() * 2 - 1;
    var src = ctx.createBufferSource();
    var bp = ctx.createBiquadFilter();
    var g = ctx.createGain();
    src.buffer = buf;
    bp.type = 'bandpass';
    bp.frequency.value = o.freq === undefined ? 1200 : o.freq;
    g.gain.setValueAtTime(Math.min(0.12, o.gain === undefined ? 0.08 : o.gain), start);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    src.connect(bp); bp.connect(g); g.connect(master);
    src.start(start);
    src.stop(start + dur + 0.02);
  }

  /** @param {number} freq @param {number} start @returns {any} a lowpass wired to the master bus */
  function lowpass(freq, start) {
    var f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(freq, start);
    f.connect(master);
    return f;
  }

  /** Every cue in the arcade, keyed by name. @type {Record<string, (t:number) => void>} */
  var RECIPES = {
    correct: function (t) {
      [523, 659, 784].forEach(function (f, i) { tone(f, t + i * 0.07, 0.09, { type: 'triangle', gain: 0.1 }); });
    },
    wrong: function (t) { tone(140, t, 0.22, { type: 'sawtooth', gain: 0.11, to: lowpass(400, t) }); },
    streak: function (t) {
      for (var i = 0; i < 5; i += 1) tone(880 + (1760 - 880) * (i / 4), t + i * 0.06, 0.05, { gain: 0.08 });
    },
    tick: function (t) { tone(1000, t, 0.03, { gain: 0.06 }); },
    tock: function (t) { tone(800, t, 0.03, { gain: 0.06 }); },
    boss: function (t) {
      var f = lowpass(200, t);
      f.frequency.exponentialRampToValueAtTime(2000, t + 0.4);
      [130, 131.5, 196].forEach(function (hz) { tone(hz, t, 0.4, { type: 'sawtooth', gain: 0.06, to: f }); });
    },
    coin: function (t) { tone(988, t, 0.06, { gain: 0.09 }); tone(1319, t + 0.06, 0.06, { gain: 0.09 }); },
    win: function (t) {
      [523, 659, 784].forEach(function (f, i) { tone(f, t + i * 0.11, 0.1, { type: 'triangle', gain: 0.1 }); });
      tone(1047, t + 0.33, 0.4, { type: 'triangle', gain: 0.12 });
    },
    grab: function (t) { tone(600, t, 0.02, { gain: 0.05 }); },
    snap: function (t) { tone(300, t, 0.06, { gain: 0.08, end: 150 }); },
    stamp: function (t) { tone(60, t, 0.08, { gain: 0.12 }); noise(t, 0.08, { gain: 0.09, freq: 900 }); },
    card: function (t) { noise(t, 0.12, { gain: 0.06, freq: 1200 }); }
  };

  /** @param {string} name a RECIPES key; unknown names, mute and locked audio are all no-ops */
  function play(name) {
    if (muted) return;
    // iOS suspends the context on a phone call, Siri or a backgrounding, and Chrome suspends a
    // discarded tab's. Nothing else in the arcade ever re-opens one — the first-gesture listeners
    // were torn down the moment audio first ran — so without this the tick/tock warning beat, the
    // right/wrong cues and the gavel go silent for the rest of the session.
    if (ctx && ctx.state !== 'running') unlock();
    if (!ctx || !master || ctx.state !== 'running') return;
    var recipe = RECIPES[name];
    if (!recipe) return;
    try { recipe(ctx.currentTime + 0.001); } catch (err) { /* an audio hiccup never stops play */ }
  }

  /** @type {any[]} */ var muteButtons = [];

  function syncMuteButtons() {
    for (var i = 0; i < muteButtons.length; i += 1) {
      muteButtons[i].textContent = muted ? '🔇' : '🔊';
      muteButtons[i].setAttribute('aria-pressed', muted ? 'true' : 'false');
    }
  }

  var sfx = {
    unlock: unlock,
    play: play,
    /** @returns {boolean} */
    get muted() { return muted; },
    /** @returns {boolean} the new muted state */
    toggleMute: function () {
      muted = !muted;
      store.set('arcade.muted', muted);
      syncMuteButtons();
      return muted;
    },
    /** @param {any} el a <button>; its 🔊/🔇 label and aria-pressed stay in sync */
    bindMuteButton: function (el) {
      if (!el) return;
      muteButtons.push(el);
      el.addEventListener('click', function () { sfx.toggleMute(); });
      syncMuteButtons();
    }
  };

  /* ===== VOICE — Web Speech, off by default, four newsroom personas ===== */

  var voiceOn = store.get('arcade.voice', false) === true;
  /** @type {any[]} */ var voiceButtons = [];
  /** @type {any} */ var cachedVoice = null;
  var voicesBound = false;

  /** rate/pitch per speaker. @type {Record<string, {rate:number, pitch:number}>} */
  var PERSONAS = {
    hawk: { rate: 1.05, pitch: 0.7 },
    dove: { rate: 0.95, pitch: 1.25 },
    anchor: { rate: 1.1, pitch: 1.0 },
    president: { rate: 0.9, pitch: 0.8 }
  };

  /** @returns {any} speechSynthesis, or null outside a speaking browser */
  function synth() { return typeof speechSynthesis === 'undefined' ? null : speechSynthesis; }

  /** @returns {any} an en-US voice, else en-GB, else whatever the device has */
  function pickVoice() {
    var s = synth();
    if (!s) return null;
    if (!voicesBound && typeof s.addEventListener === 'function') {
      voicesBound = true;
      s.addEventListener('voiceschanged', function () { cachedVoice = null; });
    }
    if (cachedVoice) return cachedVoice;
    var list = s.getVoices() || [];
    var prefer = ['en-US', 'en-GB'];
    for (var p = 0; p < prefer.length; p += 1) {
      for (var i = 0; i < list.length; i += 1) {
        if (list[i].lang && list[i].lang.replace('_', '-') === prefer[p]) { cachedVoice = list[i]; return cachedVoice; }
      }
    }
    cachedVoice = list.length ? list[0] : null;
    return cachedVoice;
  }

  /** Speak an empty utterance on the first gesture so later lines are not swallowed. A phone can
   *  refuse it outright — the utterance is dropped and nothing speaks — so the flag is only set once
   *  one really takes (it is speaking or queued, or it reports onstart), and every later gesture
   *  tries again until one does. Priming once on a refusal is how the first cue goes missing.
   *  @returns {boolean} whether speech is primed */
  function primeSpeech() {
    if (speechPrimed) return true;
    var s = synth();
    if (!s) return false;
    try {
      var u = new SpeechSynthesisUtterance('');
      u.onstart = function () { speechPrimed = true; };
      s.speak(u);
      if (s.speaking || s.pending) speechPrimed = true;
    } catch (err) { /* no voices yet — the next gesture tries again */ }
    return speechPrimed;
  }

  /** @param {string} text @param {{who?:string, interrupt?:boolean}} [opts] persona; interrupt defaults true
   *  @returns {boolean} false when voice is off or unsupported */
  function say(text, opts) {
    var s = synth();
    if (!voiceOn || !s || !text) return false;
    var o = opts || {};
    var persona = PERSONAS[o.who || 'anchor'] || PERSONAS.anchor;
    try {
      if (o.interrupt !== false) s.cancel();
      var u = new SpeechSynthesisUtterance(String(text));
      u.rate = persona.rate;
      u.pitch = persona.pitch;
      var v = pickVoice();
      if (v) u.voice = v;
      s.speak(u);
      return true;
    } catch (err) { return false; }
  }

  function syncVoiceButtons() {
    for (var i = 0; i < voiceButtons.length; i += 1) {
      voiceButtons[i].textContent = '🗣';
      voiceButtons[i].setAttribute('aria-pressed', voiceOn ? 'true' : 'false');
    }
  }

  var voice = {
    /** @returns {boolean} */
    get enabled() { return voiceOn; },
    /** @returns {boolean} the new enabled state */
    toggle: function () {
      voiceOn = !voiceOn;
      store.set('arcade.voice', voiceOn);
      syncVoiceButtons();
      // This runs inside the 🗣 button's own click handler, which is the one user activation
      // guaranteed to be about read-aloud. Priming here is what keeps the first headline a student
      // turns the voice on for from being swallowed.
      if (voiceOn) primeSpeech();
      if (!voiceOn) voice.stop();
      return voiceOn;
    },
    /** @param {any} el a <button>; its aria-pressed stays in sync */
    bindButton: function (el) {
      if (!el) return;
      voiceButtons.push(el);
      el.addEventListener('click', function () { voice.toggle(); });
      syncVoiceButtons();
    },
    stop: function () {
      var s = synth();
      if (!s) return;
      try { s.cancel(); } catch (err) { /* already quiet */ }
    },
    /** Open the speech channel from inside a user gesture. Safe to call on every gesture: it stops
     *  speaking once one utterance has actually taken. @returns {boolean} whether speech is primed */
    prime: function () { return primeSpeech(); }
  };

  /* ===== TRACKER — every scored answer, aggregated into AP readiness ===== */

  /** All 42 CED topics (Fall 2026 numbering). @type {Record<string, string>} */
  var CED_NAMES = {
    '1.1': 'Scarcity',
    '1.2': 'Opportunity Cost and the PPC',
    '1.3': 'Comparative Advantage and Gains from Trade',
    '1.4': 'Demand',
    '1.5': 'Supply',
    '1.6': 'Market Equilibrium/Disequilibrium and Changes in Equilibrium',
    '2.1': 'The Circular Flow and GDP',
    '2.2': 'Limitations of GDP',
    '2.3': 'Unemployment',
    '2.4': 'Price Indices and Inflation',
    '2.5': 'Costs of Inflation',
    '2.6': 'Real vs. Nominal GDP',
    '2.7': 'Business Cycles',
    '3.1': 'Aggregate Demand',
    '3.2': 'Multipliers',
    '3.3': 'Short-Run Aggregate Supply',
    '3.4': 'Long-Run Aggregate Supply',
    '3.5': 'Equilibrium in the AD–AS Model',
    '3.6': 'Changes in the AD–AS Model in the Short Run',
    '3.7': 'Long-Run Self-Adjustment',
    '3.8': 'Fiscal Policy',
    '3.9': 'Automatic Stabilizers',
    '4.1': 'Financial Assets',
    '4.2': 'Nominal vs. Real Interest Rates',
    '4.3': 'Definition, Measurement, and Functions of Money',
    '4.4': 'Banking and the Expansion of the Money Supply',
    '4.5': 'The Money Market',
    '4.6': 'Monetary Policy',
    '4.7': 'The Loanable Funds Market',
    '5.1': 'Fiscal and Monetary Policy Actions in the Short Run',
    '5.2': 'The Phillips Curve',
    '5.3': 'Money Growth and Inflation',
    '5.4': 'Government Deficits and the National Debt',
    '5.5': 'Crowding Out',
    '5.6': 'Economic Growth',
    '5.7': 'Public Policy and Economic Growth',
    '6.1': 'Balance of Payments Accounts',
    '6.2': 'Exchange Rates',
    '6.3': 'The Foreign Exchange Market',
    '6.4': 'Effect of Changes in Policies and Economic Conditions on the Foreign Exchange Market',
    '6.5': 'Changes in the Foreign Exchange Market and Net Exports',
    '6.6': 'Real Interest Rates and International Capital Flows'
  };

  /** @type {Record<number, string>} */
  var UNIT_NAMES = {
    1: 'Basic Economic Concepts',
    2: 'Economic Indicators & the Business Cycle',
    3: 'National Income & Price Determination',
    4: 'Financial Sector',
    5: 'Long-Run Consequences of Stabilization Policies',
    6: 'Open Economy'
  };

  /** Midpoints of the CED exam weights; they weight the score estimate. @type {Record<number, number>} */
  var UNIT_WEIGHTS = { 1: 7.5, 2: 14.5, 3: 22, 4: 20.5, 5: 25, 6: 11.5 };

  /** How many answered items a unit needs before its accuracy is allowed to steer the estimated
   *  band. Below it the unit still shows its accuracy in the heat map — the student earned that
   *  number and should see it — but it is labelled "n/8 items" and left out of `weightedAcc`.
   *  Eight is the floor at which a percentage stops being an anecdote: Unit 6 rides a single
   *  net-export card, and unweighted that one item used to carry about a third of the projected
   *  score for anyone who had only played Shift Happens. */
  var MIN_UNIT_ITEMS = 8;

  /** Which level drills which topic. @type {Record<string, {game:string, level:number}>} */
  var CED_TO_LEVEL = {
    '3.1': { game: 'shift', level: 1 }, '3.2': { game: 'shift', level: 1 }, '3.8': { game: 'shift', level: 1 },
    '3.3': { game: 'shift', level: 2 }, '3.6': { game: 'shift', level: 2 },
    '3.4': { game: 'shift', level: 3 }, '3.5': { game: 'shift', level: 3 },
    '3.7': { game: 'shift', level: 3 }, '3.9': { game: 'shift', level: 3 },
    '4.5': { game: 'fed', level: 1 }, '4.6': { game: 'fed', level: 1 }, '4.7': { game: 'fed', level: 1 },
    '5.1': { game: 'fed', level: 1 }, '5.2': { game: 'fed', level: 1 }, '5.3': { game: 'fed', level: 1 },
    // Unit 6 lands on Level 1's net-export cards until Level 6 FOREX Floor exists
    '6.1': { game: 'shift', level: 1 }, '6.2': { game: 'shift', level: 1 }, '6.3': { game: 'shift', level: 1 },
    '6.4': { game: 'shift', level: 1 }, '6.5': { game: 'shift', level: 1 }, '6.6': { game: 'shift', level: 1 }
  };

  /** Record one scored answer.
   *  @param {string} ced e.g. '3.1'
   *  @param {number} skill 1 Principles · 2 Interpretation · 3 Manipulation · 4 Graphing
   *  @param {boolean} correct
   *  @returns {{right:number, total:number, skills:Record<string,{r:number,t:number}>, last:string}} */
  function track(ced, skill, correct) {
    var mastery = store.get('arcade.mastery', {}) || {};
    var entry = mastery[ced] || { right: 0, total: 0, skills: {}, last: '' };
    if (!entry.skills) entry.skills = {};
    var per = entry.skills[String(skill)] || { r: 0, t: 0 };
    entry.total += 1;
    per.t += 1;
    if (correct) { entry.right += 1; per.r += 1; }
    entry.skills[String(skill)] = per;
    entry.last = new Date().toISOString();
    mastery[ced] = entry;
    store.set('arcade.mastery', mastery);
    return entry;
  }

  /** @param {number} v @returns {number} v held inside 0-1; NaN reads as 0 */
  function clamp01(v) { return v > 1 ? 1 : v > 0 ? v : 0; }

  /** @param {number} weightedAcc @returns {number} the 1–5 estimate */
  function bandScore(weightedAcc) {
    if (weightedAcc >= 0.85) return 5;
    if (weightedAcc >= 0.72) return 4;
    if (weightedAcc >= 0.58) return 3;
    if (weightedAcc >= 0.45) return 2;
    return 1;
  }

  /** @param {string|null} [ced] the weakest topic, if any @returns {{game:string, level:number, url:string, label:string}} */
  function playNext(ced) {
    var target = (ced ? CED_TO_LEVEL[ced] : { game: 'shift', level: 1 }) || { game: 'shift', level: 3 };
    if (target.game === 'fed') {
      return { game: 'fed', level: target.level, url: 'games/fed-chair.html?era=1975', label: 'Fed Chair · 1975' };
    }
    return {
      game: 'shift',
      level: target.level,
      url: 'games/shift-happens.html?level=' + target.level,
      label: 'Shift Happens · Level ' + target.level
    };
  }

  /** Aggregate mastery into the hub's heat map, score estimate and next-up nudge. Topics appear only
   *  once tracked; a unit with no data keeps `acc: null` and is left out of the weighted average.
   *  @param {Record<string, {right:number, total:number}>} [mastery] defaults to arcade.mastery
   *  @returns {{answered:number, units:any[], weakest:any, band:any, playNext:any}} */
  function readiness(mastery) {
    var m = mastery || store.get('arcade.mastery', {}) || {};
    var units = [];
    var u;
    for (u = 1; u <= 6; u += 1) {
      units.push({ unit: u, name: UNIT_NAMES[u], weight: UNIT_WEIGHTS[u], right: 0, total: 0, acc: null, counted: false, topics: [] });
    }

    var answered = 0;
    var ceds = Object.keys(m).sort();
    for (var i = 0; i < ceds.length; i += 1) {
      var ced = ceds[i];
      var entry = m[ced];
      var unit = parseInt(ced, 10);
      if (!entry || !(unit >= 1 && unit <= 6)) continue;
      // Counts are floored at 0 and accuracy clamped to 0-1 all the way down: arcade.mastery is a
      // localStorage object a student can edit, and an unclamped {right:50,total:20} rendered a
      // "250 %" heat cell and a confident 5 estimate built on it.
      var total = Math.max(0, Number(entry.total) || 0);
      var right = Math.max(0, Number(entry.right) || 0);
      if (total <= 0) continue;
      units[unit - 1].right += right;
      units[unit - 1].total += total;
      units[unit - 1].topics.push({ ced: ced, name: CED_NAMES[ced] || ced, right: right, total: total, acc: clamp01(right / total) });
      answered += total;
    }

    var num = 0;
    var den = 0;
    var weakest = null;
    for (u = 0; u < 6; u += 1) {
      if (units[u].total > 0) {
        units[u].acc = clamp01(units[u].right / units[u].total);
        // The heat cell shows that accuracy whatever the count. The estimate only listens to a
        // unit once there is enough of it to listen to.
        units[u].counted = units[u].total >= MIN_UNIT_ITEMS;
        if (units[u].counted) {
          num += units[u].weight * units[u].acc;
          den += units[u].weight;
        }
      }
      var topics = units[u].topics;
      for (var k = 0; k < topics.length; k += 1) {
        if (topics[k].total >= 3 && (!weakest || topics[k].acc < weakest.acc)) weakest = topics[k];
      }
    }

    // `den > 0` is now the whole gate: it takes one unit with MIN_UNIT_ITEMS behind it to open the
    // estimate, and the old flat "ten answered anywhere" floor let twelve items spread across three
    // units project a score off four apiece.
    var band = null;
    if (den > 0) {
      band = { score: bandScore(num / den), weightedAcc: num / den, label: 'estimate', n: answered };
    }
    return { answered: answered, units: units, weakest: weakest, band: band, playNext: playNext(weakest ? weakest.ced : null) };
  }

  /** @param {string} s */
  function b64encode(s) { return typeof btoa === 'function' ? btoa(s) : s; }
  /** @param {string} s */
  function b64decode(s) { return typeof atob === 'function' ? atob(s) : s; }

  /** The digest's salt. Deliberately not a secret — it is right here in the source, and the code
   *  is a summary of the student's own play, not a credential. The bar it sets is that decoding a
   *  code, editing a numerator and re-encoding it produces something that will not decode. */
  var CODE_SALT = 'drs-arcade-2026';

  /** FNV-1a 32-bit over `payload + CODE_SALT`, six base36 characters.
   *  @param {string} payload @returns {string} */
  function codeDigest(payload) {
    var h = 0x811c9dc5;
    var s = payload + CODE_SALT;
    for (var i = 0; i < s.length; i += 1) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return ('00000' + h.toString(36)).slice(-6);
  }

  /** The payload shape's version. It moved to 2 when the digest was added: version 1 is a
   *  nine-field code with no digest, and nothing that reads a code should have to guess which
   *  shape it is holding. */
  var CODE_VERSION = 2;

  /** @returns {string} base64 of `initials|version|r/t ×6|answered|digest`, for pasting into Schoology */
  function readinessCode() {
    var r = readiness();
    var parts = [initials(), String(CODE_VERSION)];
    for (var i = 0; i < r.units.length; i += 1) parts.push(r.units[i].right + '/' + r.units[i].total);
    parts.push(String(r.answered));
    var payload = parts.join('|');
    return b64encode(payload + '|' + codeDigest(payload));
  }

  /** @param {*} code @returns {{initials:string, version:number, units:number[][], answered:number}|null}
   *    null for anything that is not a version 2 code this build signed — including every unsigned
   *    nine-field code from before the digest existed, and any code still claiming version 1. */
  function decodeReadinessCode(code) {
    if (typeof code !== 'string' || !code) return null;
    var raw;
    try { raw = b64decode(code); } catch (err) { return null; }
    var parts = String(raw).split('|');
    if (parts.length !== 10) return null;
    var payload = parts.slice(0, 9).join('|');
    if (parts[9] !== codeDigest(payload)) return null;
    var version = Number(parts[1]);
    var answered = Number(parts[8]);
    if (version !== CODE_VERSION || !Number.isFinite(answered)) return null;
    var units = [];
    for (var i = 2; i <= 7; i += 1) {
      var pair = parts[i].split('/');
      if (pair.length !== 2 || pair[0] === '' || pair[1] === '') return null;
      if (!Number.isFinite(Number(pair[0])) || !Number.isFinite(Number(pair[1]))) return null;
      units.push([Number(pair[0]), Number(pair[1])]);
    }
    // Through normalizeInitials, so a decoded code's tag is the same three A-Z characters
    // initials() would have produced — the podium and the hub compare them.
    return { initials: normalizeInitials(parts[0]), version: version, units: units, answered: answered };
  }

  /** @param {string} s @returns {boolean} the pre-clipboard-API path: a hidden textarea */
  function legacyCopy(s) {
    if (typeof document === 'undefined' || !document.body) return false;
    try {
      var ta = document.createElement('textarea');
      ta.value = s;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (err) { return false; }
  }

  /** @param {string} text @returns {Promise<boolean>} */
  function copyText(text) {
    var s = String(text);
    try {
      var nav = /** @type {any} */ (typeof navigator !== 'undefined' ? navigator : null);
      if (nav && nav.clipboard && nav.clipboard.writeText) {
        return nav.clipboard.writeText(s).then(function () { return true; }, function () { return legacyCopy(s); });
      }
    } catch (err) { /* fall through to the textarea */ }
    return Promise.resolve(legacyCopy(s));
  }

  /* ===== MOTION — springs, confetti, shake; all of it collapses under reduced motion ===== */

  /** The three springs the arcade uses. Task 3's graph engine reads these by name. */
  var SPRING = {
    snap: { stiffness: 170, ratio: 0.8 },
    consequence: { stiffness: 80, ratio: 0.6 },
    jolt: { stiffness: 170, ratio: 0.35 }
  };

  /** @returns {boolean} checked live, so a mid-session OS change is honoured */
  function prefersReducedMotion() {
    try {
      return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (err) { return false; }
  }

  /** Semi-implicit Euler spring on one scalar. Without rAF (or under reduced motion) it lands on
   *  `to` synchronously.
   *  @param {number} from @param {number} to @param {(v:number) => void} onUpdate
   *  @param {{stiffness?:number, ratio?:number, onDone?:() => void}} [opts]
   *  @returns {{cancel:() => void, finish:() => void}} */
  function spring(from, to, onUpdate, opts) {
    var o = opts || {};
    var k = o.stiffness === undefined ? 170 : o.stiffness;
    var zeta = o.ratio === undefined ? 0.8 : o.ratio;
    var onDone = typeof o.onDone === 'function' ? o.onDone : null;
    var raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : null;
    var settled = false;
    var frame = 0;

    function done() {
      if (settled) return;
      settled = true;
      onUpdate(to);
      if (onDone) onDone();
    }
    function drop() {
      if (frame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
      frame = 0;
    }
    if (!raf || prefersReducedMotion()) {
      done();
      return { cancel: function () { settled = true; }, finish: done };
    }

    var c = 2 * Math.sqrt(k) * zeta;
    var x = from;
    var v = 0;
    var last = -1;
    function step(now) {
      if (settled) return;
      var dt = last < 0 ? 1 / 60 : Math.min(0.032, (now - last) / 1000);
      last = now;
      var a = -k * (x - to) - c * v;
      v += a * dt;
      x += v * dt;
      if (Math.abs(x - to) < 0.05 && Math.abs(v) < 0.5) { done(); return; }
      onUpdate(x);
      frame = raf(step);
    }
    frame = raf(step);
    return { cancel: function () { settled = true; drop(); }, finish: function () { drop(); done(); } };
  }

  /** @returns {string[]} palette tokens read off :root, so the stylesheet stays the only palette */
  function tokenColors() {
    var out = [];
    try {
      var cs = getComputedStyle(document.documentElement);
      ['--green', '--gold', '--blue', '--purple', '--red'].forEach(function (name) {
        var v = cs.getPropertyValue(name).trim();
        if (v) out.push(v);
      });
    } catch (err) { /* fall back to the gold token below */ }
    return out.length ? out : ['#FFC800'];
  }

  /** The reduced-motion stand-in for confetti: one 300 ms gold wash. */
  function goldFlash() {
    var el = document.createElement('div');
    el.className = 'flash-overlay';
    el.setAttribute('aria-hidden', 'true');
    document.body.appendChild(el);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 300);
  }

  /** @param {{count?:number, duration?:number, colors?:string[]}} [opts] */
  function confetti(opts) {
    if (typeof document === 'undefined' || !document.body) return;
    if (prefersReducedMotion()) { goldFlash(); return; }
    var o = opts || {};
    var duration = o.duration === undefined ? 2500 : o.duration;
    var colors = o.colors && o.colors.length ? o.colors : tokenColors();
    var canvas = document.createElement('canvas');
    canvas.className = 'confetti';
    canvas.setAttribute('aria-hidden', 'true');
    var w = canvas.width = window.innerWidth;
    var h = canvas.height = window.innerHeight;
    var g = canvas.getContext('2d');
    if (!g) return;
    document.body.appendChild(canvas);

    var bits = [];
    for (var i = 0; i < (o.count === undefined ? 140 : o.count); i += 1) {
      bits.push({
        x: Math.random() * w, y: -20 - Math.random() * h * 0.6,
        vx: (Math.random() - 0.5) * 6, vy: 2 + Math.random() * 4,
        size: 5 + Math.random() * 7, angle: Math.random() * Math.PI * 2,
        spin: (Math.random() - 0.5) * 0.3, color: colors[i % colors.length]
      });
    }

    var t0 = Date.now();
    function frame() {
      g.clearRect(0, 0, w, h);
      var alive = 0;
      for (var j = 0; j < bits.length; j += 1) {
        var b = bits[j];
        b.vy += 0.25;
        b.vx *= 0.99;
        b.vy *= 0.99;
        b.x += b.vx;
        b.y += b.vy;
        b.angle += b.spin;
        if (b.y - b.size > h) continue;
        alive += 1;
        g.save();
        g.translate(b.x, b.y);
        g.rotate(b.angle);
        g.fillStyle = b.color;
        g.fillRect(-b.size / 2, -b.size / 2, b.size, b.size * 0.6);
        g.restore();
      }
      if (!alive || Date.now() - t0 > duration) {
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
        return;
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  /** @param {any} el @param {string} [cls] default 'flash-red' @param {number} [ms] default 250 */
  function flash(el, cls, ms) {
    if (!el || !el.classList) return;
    var name = cls || 'flash-red';
    el.classList.add(name);
    setTimeout(function () { el.classList.remove(name); }, ms === undefined ? 250 : ms);
  }

  /** @param {any} el @param {{intensity?:number, duration?:number}} [opts] */
  function shake(el, opts) {
    if (!el) return;
    var o = opts || {};
    var intensity = o.intensity === undefined ? 8 : o.intensity;
    if (prefersReducedMotion() || typeof el.animate !== 'function') { flash(el, 'flash-red', 200); return; }
    var steps = 8;
    var frames = [];
    for (var i = 0; i <= steps; i += 1) {
      var decay = intensity * (1 - i / steps);
      frames.push({ transform: 'translateX(' + (i % 2 ? decay : -decay).toFixed(2) + 'px)' });
    }
    frames[steps] = { transform: 'translateX(0)' };
    try {
      el.animate(frames, { duration: o.duration === undefined ? 350 : o.duration, easing: 'ease-out' });
    } catch (err) { flash(el, 'flash-red', 200); }
  }

  /* ===== COMPONENTS — the shared chrome every game mounts ===== */

  /** @param {string} cls @param {string} [text] @returns {any} */
  function make(cls, text) {
    var el = document.createElement('div');
    if (cls) el.className = cls;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  /** @param {string} label @param {string} cls @param {() => void} onClick @returns {any} */
  function button(label, cls, onClick) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }

  /** @param {any} el container @param {number} [max] hearts to render, default 3
   *  @returns {{set:(n:number) => void, lose:() => number, get:() => number, reset:() => void}} */
  function hearts(el, max) {
    var cap = max === undefined ? 3 : max;
    var live = cap;
    /** @type {any[]} */ var pips = [];
    if (el && typeof document !== 'undefined') {
      el.classList.add('hearts');
      el.textContent = '';
      for (var i = 0; i < cap; i += 1) {
        var pip = make('heart', '❤️');
        el.appendChild(pip);
        pips.push(pip);
      }
    }
    function paint() {
      for (var i = 0; i < pips.length; i += 1) pips[i].classList.toggle('lost', i >= live);
    }
    return {
      set: function (n) { live = Math.max(0, Math.min(cap, n)); paint(); },
      lose: function () {
        if (live <= 0) return 0;
        live -= 1;
        paint();
        var pip = pips[live];
        if (pip) {
          pip.classList.add('crack');
          setTimeout(function () { pip.classList.remove('crack'); }, 450);
        }
        return live;
      },
      get: function () { return live; },
      reset: function () { live = cap; paint(); }
    };
  }

  /** The combo counter: mult = 1 + min(4, floor(count/3)) — ×2 at 3, ×5 at 12.
   *  @returns {{hit:() => number, miss:() => number, reset:() => void, count:number, mult:number, render:(el?:any) => void}} */
  function streak() {
    var count = 0;
    /** @type {any} */ var node = null;
    function tier() { return Math.min(4, Math.floor(count / 3)); }
    /** @param {any} [el] the element to bind and repaint */
    function render(el) {
      if (el) node = el;
      if (!node || !node.classList) return;
      node.classList.add('combo');
      for (var i = 1; i <= 4; i += 1) node.classList.toggle('s' + i, i === tier());
      node.textContent = count >= 3 ? '🔥×' + (1 + tier()) : '';
    }
    return {
      get count() { return count; },
      get mult() { return 1 + tier(); },
      hit: function () {
        count += 1;
        if (count === 3 || count === 6 || count === 9 || count === 12) play('streak');
        render();
        return 1 + tier();
      },
      miss: function () {
        count = 0;
        render();
        if (node && node.classList) {
          node.classList.add('crack');
          setTimeout(function () { node.classList.remove('crack'); }, 450);
        }
        return 1;
      },
      reset: function () { count = 0; render(); },
      render: render
    };
  }

  /** The round clock: a scaleX on .timer-fill, tick/tock inside the warning zone, onEnd once at 0.
   *  stop() and pause() both halt the loop; start() restarts from full, resume() picks up where it left off.
   *  @param {any} el a .timer-bar (its .timer-fill is created if missing) @param {number} ms
   *  @param {{warnAt?:number, onEnd?:() => void, onTick?:(left:number) => void}} [opts]
   *  @returns {{start:() => void, stop:() => void, pause:() => void, resume:() => void, remaining:() => number, extend:(extraMs:number) => void}} */
  function timerBar(el, ms, opts) {
    var o = opts || {};
    var MAX_FRAME_MS = 250;   // the most one frame may ever spend, however long the gap really was
    var warnAt = o.warnAt === undefined ? 3000 : o.warnAt;
    var raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : null;
    var total = ms;
    var left = ms;
    var running = false;
    var ended = false;
    var last = 0;
    var beat = 0;
    var tocked = false;
    var frame = 0;
    /** @type {any} */ var fill = null;

    if (el && typeof document !== 'undefined') {
      el.classList.add('timer-bar');
      fill = el.querySelector('.timer-fill');
      if (!fill) { fill = make('timer-fill'); el.appendChild(fill); }
    }
    function paint() {
      if (fill) fill.style.transform = 'scaleX(' + (total > 0 ? Math.max(0, left / total) : 0) + ')';
      if (el && el.classList) el.classList.toggle('warn', left <= warnAt && left > 0);
    }
    /** @param {number} dt ms since the last frame */
    function beatAudio(dt) {
      if (left > warnAt) { beat = 0; return; }
      beat += dt;
      if (beat >= 500) { beat -= 500; play(tocked ? 'tock' : 'tick'); tocked = !tocked; }
    }
    function step(now) {
      if (!running) return;
      // Cap the frame delta the way Arcade.spring already does. A hidden tab fires no frames at
      // all — a Chromebook switched to Google Classroom, a phone that locked — and the first frame
      // back carries the whole absence, which would zero the clock and take a heart for an answer
      // the student was never shown. A genuinely stalled device is not punished for it either.
      var dt = last ? Math.min(now - last, MAX_FRAME_MS) : 0;
      last = now;
      left = Math.max(0, left - dt);
      beatAudio(dt);
      paint();
      if (typeof o.onTick === 'function') o.onTick(left);
      if (left <= 0) {
        running = false;
        if (!ended) { ended = true; if (typeof o.onEnd === 'function') o.onEnd(); }
        return;
      }
      if (raf) frame = raf(step);
    }
    function run() {
      if (running || left <= 0 || !raf) return;
      running = true;
      last = 0;
      frame = raf(step);
    }
    function halt() {
      running = false;
      if (frame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
      frame = 0;
    }
    return {
      start: function () { halt(); left = total; ended = false; beat = 0; paint(); run(); },
      stop: halt,
      pause: halt,
      resume: run,
      remaining: function () { return left; },
      extend: function (extraMs) { left += extraMs; total = Math.max(total, left); paint(); }
    };
  }

  /** The three real medals. Anything else that reaches a className came out of localStorage, which
   *  is a text file the student owns, so it is checked against this list before it is concatenated
   *  into one. Not an XSS — className is not a parser — but a stored string should never be able to
   *  put a class of its choosing on an element. */
  var MEDALS = ['gold', 'silver', 'bronze'];

  /** @param {*} m a stored medal name @returns {string} it, or 'none' */
  function safeMedal(m) { return MEDALS.indexOf(/** @type {any} */ (m)) < 0 ? 'none' : String(m); }

  /** @param {number} acc 0–1 @param {{examPassed?:boolean}} [opts] gold is gated on the Exit Exam
   *  @returns {string|null} */
  function medalFor(acc, opts) {
    if (acc >= 0.95 && !!(opts && opts.examPassed)) return 'gold';
    if (acc >= 0.85) return 'silver';
    if (acc >= 0.75) return 'bronze';
    return null;
  }

  /** @param {number} acc 0–1 @returns {number} the AP-style stamp, 1–5 */
  function stampFor(acc) {
    if (acc >= 0.95) return 5;
    if (acc >= 0.85) return 4;
    if (acc >= 0.75) return 3;
    if (acc >= 0.6) return 2;
    return 1;
  }

  /** The title ladder: the points each rung asks for, low to high. Titles are pure decoration —
   *  they never gate a level, move a score or change a medal. */
  var TITLES = [
    { at: 0, name: 'Intern', emoji: '🧾' },
    { at: 3, name: 'Analyst', emoji: '📈' },
    { at: 7, name: 'Branch Economist', emoji: '🏢' },
    { at: 11, name: 'Regional Fed President', emoji: '🏛️' },
    { at: 15, name: 'Vice Chair', emoji: '🎩' },
    { at: 19, name: 'MAESTRO', emoji: '🎼' }
  ];

  /** What a Shift level's medal is worth. @type {Record<string, number>} */
  var TITLE_MEDAL_POINTS = { bronze: 1, silver: 2, gold: 3 };

  /** @typedef {{shift?: {levels?: Record<string, any>}|null, fed?: {score?: number}|null}} TitleProgress */

  /** Career points: a medal on each of Shift's three levels (max 9), two more for every level whose
   *  Exam Sprint was perfect (max 6), and the Fed Chair best stamp (1-5).
   *  @param {TitleProgress} p @returns {number} 0-20 */
  function titlePoints(p) {
    var shift = p.shift;
    var levels = shift && shift.levels && typeof shift.levels === 'object' ? shift.levels : {};
    var points = 0;
    for (var n = 1; n <= 3; n += 1) {
      var rec = levels[String(n)];
      if (!rec || typeof rec !== 'object') continue;
      // Own properties only: a stored medal of "toString" resolved through Object.prototype to a
      // truthy function, so `|| 0` never fired and the hub's title chip printed "NaN pts".
      var medal = String(rec.medal);
      if (Object.prototype.hasOwnProperty.call(TITLE_MEDAL_POINTS, medal)) points += TITLE_MEDAL_POINTS[medal];
      if (rec.examPerfect) points += 2;
    }
    var stamp = Number(p.fed && p.fed.score);
    if (Number.isFinite(stamp)) points += Math.min(5, Math.max(0, Math.floor(stamp)));
    return points;
  }

  /** The rank the player has earned across both games.
   *  @param {TitleProgress} [progress] used verbatim when given; otherwise read from the store
   *  @returns {{rank:number, name:string, emoji:string, next:{name:string, need:number}|null}} */
  function titleFor(progress) {
    var p = progress || { shift: store.get('arcade.shift.progress', null), fed: bests('fed') };
    var points = titlePoints(p);
    var rank = 0;
    for (var i = 1; i < TITLES.length; i += 1) if (points >= TITLES[i].at) rank = i;
    var next = TITLES[rank + 1];
    return {
      rank: rank,
      name: TITLES[rank].name,
      emoji: TITLES[rank].emoji,
      next: next ? { name: next.name, need: next.at - points } : null
    };
  }

  /** The panel every run ends on — a celebration by default, a plain red verdict under `tone:'fail'`.
   *  @param {any} el mount point; its contents are replaced
   *  @param {{title?:string, sub?:string, score?:number, accuracy?:number, medal?:string|null,
   *           stamp?:number, stats?:{label:string, value:string}[],
   *           buttons?:{label:string, onClick?:() => void, primary?:boolean, variant?:string}[],
   *           ribbon?:string, note?:string, tone?:string}} opts `accuracy` is a 0–1 fraction
   *  @returns {any} the panel element */
  function endScreen(el, opts) {
    if (typeof document === 'undefined') return null;
    var o = opts || {};
    // `tone:'fail'` swaps the celebratory gradient headline for the flat red the wrong-answer
    // sheet already uses, and borders the panel to match. Losing should not look like winning.
    var panel = make('panel stack' + (o.tone === 'fail' ? ' tone-fail' : ''));

    if (o.title) {
      var h = document.createElement('h2');
      h.className = 'h1';
      h.textContent = o.title;
      h.tabIndex = -1;          // so focusScreen can land the keyboard on the verdict, not on <body>
      panel.appendChild(h);
    }
    if (o.sub) panel.appendChild(make('muted', o.sub));

    var head = make('end-head');
    // No medal, no slot. A dashed empty circle reads as a medal the run failed to fill, which is not
    // what a Fed term (graded by the AP stamp) or a sub-bronze clear is saying.
    var medal = safeMedal(o.medal);
    if (medal !== 'none') head.appendChild(make('medal ' + medal, medal.charAt(0).toUpperCase()));
    var figures = make('');
    figures.appendChild(make('score end-score mono', String(o.score === undefined ? 0 : o.score)));
    // Labelled, not bare: "0" over "0% correct" on a zero-score fail scans as one number, "00%".
    if (o.accuracy !== undefined) figures.appendChild(make('muted', 'Accuracy ' + Math.round(o.accuracy * 100) + '%'));
    head.appendChild(figures);
    if (typeof o.stamp === 'number') head.appendChild(make('ap-stamp slam', String(o.stamp)));
    panel.appendChild(head);

    if (o.ribbon) {
      var ribbonRow = make('row');
      ribbonRow.appendChild(make('ribbon', o.ribbon));
      panel.appendChild(ribbonRow);
    }
    if (o.stats && o.stats.length) {
      var list = make('stack');
      o.stats.forEach(function (s) {
        var row = make('stat-row');
        row.appendChild(make('muted', s.label));
        row.appendChild(make('mono', String(s.value)));
        list.appendChild(row);
      });
      panel.appendChild(list);
    }
    if (o.note) panel.appendChild(make('muted', o.note));
    if (o.buttons && o.buttons.length) {
      var bar = make('stack');
      o.buttons.forEach(function (b) {
        var cls = 'btn btn-block' + (b.primary ? '' : ' btn-ghost') + (b.variant ? ' btn-' + b.variant : '');
        bar.appendChild(button(b.label, cls, b.onClick || function () { /* decorative */ }));
      });
      panel.appendChild(bar);
    }

    if (el) { el.textContent = ''; el.appendChild(panel); }
    if (typeof o.stamp === 'number') setTimeout(function () { play('stamp'); shake(panel); }, 300);
    return panel;
  }

  /** Three-slot initials keypad; persists through setInitials.
   *  @param {any} el mount point; its contents are replaced
   *  @param {{onDone?:(value:string) => void}} [opts] @returns {{value:string}} */
  function initialsEntry(el, opts) {
    var o = opts || {};
    var chars = initials().split('');
    var slot = 0;
    var api = { get value() { return chars.join(''); } };
    if (!el || typeof document === 'undefined') return api;

    /** @type {any[]} */ var slots = [];
    var row = make('initials');
    function paint() {
      for (var i = 0; i < slots.length; i += 1) {
        slots[i].textContent = chars[i];
        slots[i].classList.toggle('active', i === slot);
      }
    }
    for (var s = 0; s < 3; s += 1) {
      slots.push(button('', 'slot', (function (index) {
        return function () { slot = index; paint(); };
      }(s))));
      row.appendChild(slots[s]);
    }

    var grid = make('az-grid');
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach(function (ch) {
      grid.appendChild(button(ch, 'btn btn-ghost', function () {
        chars[slot] = ch;
        slot = Math.min(2, slot + 1);
        paint();
      }));
    });
    grid.appendChild(button('⌫', 'btn btn-ghost', function () {
      chars[slot] = '?';
      slot = Math.max(0, slot - 1);
      paint();
    }));
    grid.appendChild(button('OK', 'btn', function () {
      chars = setInitials(api.value).split('');
      paint();
      if (typeof o.onDone === 'function') o.onDone(api.value);
    }));

    el.textContent = '';
    el.appendChild(row);
    el.appendChild(grid);
    paint();
    return api;
  }

  /** @type {any[]} */ var bigTypeButtons = [];

  function syncBigTypeButtons() {
    var on = store.get('arcade.bigType', false) === true;
    for (var i = 0; i < bigTypeButtons.length; i += 1) {
      bigTypeButtons[i].textContent = '📺';
      bigTypeButtons[i].setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  /** @param {boolean} [on] omit to read (and re-apply) the stored setting @returns {boolean} the state in force */
  function bigType(on) {
    var next = on === undefined ? store.get('arcade.bigType', false) === true : on !== false;
    if (on !== undefined) store.set('arcade.bigType', next);
    if (typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.classList.toggle('big-type', next);
    }
    syncBigTypeButtons();
    return next;
  }

  /** @param {any} el a <button>; its 📺 label and aria-pressed stay in sync */
  function mountBigTypeButton(el) {
    if (!el) return;
    bigTypeButtons.push(el);
    el.addEventListener('click', function () { bigType(!bigType()); });
    bigType();
  }

  /** @param {string} msg @param {number} [ms] default 1800 @returns {any} the toast, or null off-browser */
  function toast(msg, ms) {
    if (typeof document === 'undefined' || !document.body) return null;
    var t = make('panel toast', String(msg));
    t.setAttribute('role', 'status');
    document.body.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, ms === undefined ? 1800 : ms);
    return t;
  }

  /* ===== TAP GUARD AND FOCUS — what a screen change owes a finger and a keyboard ===== */

  var guardUntil = 0;
  var GUARD_MS = 350;   // long enough to cover the second half of a double tap, short enough to feel instant

  /** Deafen the page for a moment. The tap that caused a screen change is still in flight: its
   *  `click` is delivered after the swap, to whatever now occupies that coordinate — the next
   *  screen's back button sitting in the identical 48 px box, or a choice button that did not
   *  exist when the finger went down. A double tap must do the single-tap thing only.
   *  @param {number} [ms] default 350 */
  function guardTaps(ms) { guardUntil = Date.now() + (ms === undefined ? GUARD_MS : ms); }

  /** @returns {boolean} true while a spent tap could still be arriving */
  function guarded() { return Date.now() < guardUntil; }

  /** @param {() => void} action @returns {() => void} the action, deaf while the guard is up */
  function ignoringSkipTap(action) { return function () { if (!guarded()) action(); }; }

  var FOCUSABLE = 'button:not([disabled]), [href], input, select, textarea, [tabindex]';

  /** Put focus on the screen that just became visible. Without it every navigation drops focus to
   *  <body> — the element it was on has just gone `display:none` — and a keyboard user restarts
   *  from the top of the document on every single move.
   *  @param {any} el the newly-active screen @returns {any} whatever took focus, or null */
  function focusScreen(el) {
    if (!el || typeof document === 'undefined') return null;
    var target = el.querySelector('[data-focus]') || el.querySelector('h1, h2, ' + FOCUSABLE);
    if (!target || typeof target.focus !== 'function') return null;
    try { target.focus({ preventScroll: true }); } catch (err) { target.focus(); }
    return target;
  }

  /** Make a dialog behave like one: focus lands inside it, Tab stays inside it, Escape leaves it,
   *  and the control that opened it gets focus back.
   *  @param {any} el the dialog @param {(() => void)|null} [onEscape] omit for a forced choice
   *  @returns {() => void} release it */
  function trapFocus(el, onEscape) {
    if (!el || typeof document === 'undefined') return function () { };
    var opener = document.activeElement;
    function stops() {
      var all = el.querySelectorAll(FOCUSABLE);
      var out = [];
      for (var i = 0; i < all.length; i += 1) {
        if (!all[i].disabled && all[i].getAttribute('tabindex') !== '-1'
          && (typeof all[i].getClientRects !== 'function' || all[i].getClientRects().length > 0)) out.push(all[i]);
      }
      return out;
    }
    /** @param {any} ev */
    function onKey(ev) {
      if (ev.key === 'Escape' && onEscape) { ev.preventDefault(); onEscape(); return; }
      if (ev.key !== 'Tab') return;
      var list = stops();
      if (!list.length) return;
      var first = list[0], last = list[list.length - 1];
      var here = document.activeElement;
      if (ev.shiftKey && (here === first || !el.contains(here))) { ev.preventDefault(); last.focus(); }
      else if (!ev.shiftKey && (here === last || !el.contains(here))) { ev.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', onKey, true);
    var open = stops()[0];
    if (open) { try { open.focus({ preventScroll: true }); } catch (err) { open.focus(); } }
    return function () {
      document.removeEventListener('keydown', onKey, true);
      if (opener && typeof opener.focus === 'function' && document.contains(opener)) {
        try { opener.focus({ preventScroll: true }); } catch (err) { opener.focus(); }
      }
    };
  }

  /* ===== FIRST GESTURE — the one DOM touch at load: unlock audio, prime speech ===== */

  /** Every activation-triggering event a student can produce here. A touch `pointerdown` is NOT one
   *  of them — the HTML spec only counts `pointerup`, `click`, `keydown` and a mouse `pointerdown` —
   *  so a phone's first tap would have its resume() refused and the first cue would be lost if the
   *  unlock hung on `pointerdown` alone. Pointer events only, no touch or mouse handlers.
   *  @type {string[]} */
  var GESTURE_EVENTS = ['pointerdown', 'pointerup', 'click', 'keydown'];

  function onFirstGesture() { unlock(); primeSpeech(); }

  /** Only once the context is really running: a refused resume leaves the listeners in place so the
   *  next gesture — and the next priming attempt, which rides the same activation — tries again. */
  function detachFirstGesture() {
    if (!gestureBound || typeof document === 'undefined') return;
    if (!ctx || ctx.state !== 'running') return;
    gestureBound = false;
    GESTURE_EVENTS.forEach(function (name) { document.removeEventListener(name, onFirstGesture); });
  }

  if (typeof document !== 'undefined') {
    gestureBound = true;
    GESTURE_EVENTS.forEach(function (name) { document.addEventListener(name, onFirstGesture); });
    // The guard is enforced in one place, in the capture phase, so no handler has to remember it.
    // Only `click` is swallowed: pointerdown and pointerup still reach the document, so the audio
    // unlock and the graph's own drag surface are untouched by a screen change.
    document.addEventListener('click', function (ev) {
      if (!guarded()) return;
      ev.stopPropagation();
      ev.preventDefault();
    }, true);
  }

  return {
    store: store, initials: initials, setInitials: setInitials, bests: bests, saveBest: saveBest, qs: qs,
    sfx: sfx, voice: voice, say: say,
    track: track, readiness: readiness, readinessCode: readinessCode, decodeReadinessCode: decodeReadinessCode,
    MIN_UNIT_ITEMS: MIN_UNIT_ITEMS,
    copyText: copyText, CED_NAMES: CED_NAMES, UNIT_NAMES: UNIT_NAMES, CED_TO_LEVEL: CED_TO_LEVEL,
    SPRING: SPRING, prefersReducedMotion: prefersReducedMotion, spring: spring,
    confetti: confetti, shake: shake, flash: flash,
    guardTaps: guardTaps, guarded: guarded, ignoringSkipTap: ignoringSkipTap,
    focusScreen: focusScreen, trapFocus: trapFocus,
    hearts: hearts, streak: streak, timerBar: timerBar, endScreen: endScreen,
    medalFor: medalFor, safeMedal: safeMedal, stampFor: stampFor, titleFor: titleFor, initialsEntry: initialsEntry,
    bigType: bigType, mountBigTypeButton: mountBigTypeButton, toast: toast
  };
}());

if (typeof module !== 'undefined') module.exports = Arcade;
