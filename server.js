require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 3000;
const TD_KEY = process.env.TD_KEY;
const FINNHUB_KEY = process.env.FINNHUB_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;
const CRON_SECRET = process.env.CRON_SECRET || 'tg_cron_2026';
const GROQ_KEY = process.env.GROQ_API_KEY;
const DELUKA_GROQ_KEY = process.env.DELUKA_GROQ_KEY;

app.use(cors({
  origin: [
    'https://luka1233-cpu.github.io',
    'http://localhost',
    'http://127.0.0.1',
    /\.github\.io$/,
    /localhost/,
  ],
  credentials: true,
}));
app.use(express.json());

const sb = {
  async query(path, opts = {}) {
    const r = await axios({
      method: opts.method || 'GET',
      url: `${SUPABASE_URL}/rest/v1/${path}`,
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: opts.prefer || '' },
      data: opts.body, params: opts.params, timeout: 10000,
    });
    return r.data;
  },
  async insert(table, rows) { return this.query(table, { method: 'POST', body: rows, prefer: 'return=representation' }); },
  async select(table, params) { return this.query(table, { params }); },
  async update(table, params, body) { return this.query(table, { method: 'PATCH', params, body, prefer: 'return=representation' }); },
  async upsert(table, rows, onConflict) { return this.query(table, { method: 'POST', body: rows, prefer: `resolution=merge-duplicates,return=representation`, params: { on_conflict: onConflict } }); },
};

app.get('/', (req, res) => { res.json({ status: 'TradeGuard API running' }); });

const MACRO_STANCE = {
  USD: { bias: 'neutral', note: 'Higher for longer, cuts priced but not imminent', shift: null, lastUpdate: '2026-06-01' },
  EUR: { bias: 'dovish', note: 'ECB cutting cycle underway', shift: 'hawkish_to_dovish', lastUpdate: '2026-06-01' },
  GBP: { bias: 'dovish', note: 'BoE on hold, watching inflation', shift: null, lastUpdate: '2026-06-01' },
  JPY: { bias: 'hawkish', note: 'BoJ normalizing, rate hikes expected', shift: 'dovish_to_hawkish', lastUpdate: '2026-06-01' },
  AUD: { bias: 'dovish', note: 'Dovish tilt, cuts expected but not fully underway', shift: 'neutral_to_dovish', lastUpdate: '2026-06-01' },
  NZD: { bias: 'dovish', note: 'RBNZ aggressive cutting cycle', shift: 'hawkish_to_dovish', lastUpdate: '2026-06-01' },
  CAD: { bias: 'dovish', note: 'BoC cutting, growth concerns', shift: 'neutral_to_dovish', lastUpdate: '2026-06-01' },
  CHF: { bias: 'dovish', note: 'SNB cutting, low inflation', shift: 'neutral_to_dovish', lastUpdate: '2026-06-01' },
};

app.get('/macro', (req, res) => { res.json({ result: MACRO_STANCE }); });

app.get('/health', async (req, res) => {
  try { await sb.select('cot_snapshots', { select: 'id', limit: 1 }); } catch (_) {}
  res.json({ status: 'ok' });
});

app.get('/price', async (req, res) => {
  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: 'symbol required' });
  try {
    const r = await axios.get(`https://api.twelvedata.com/price?symbol=${symbol}&apikey=${TD_KEY}`);
    res.json(r.data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const MAJOR_COUNTRIES = ['US','EU','GB','JP','AU','CA','NZ','CH','DE','FR','IE','IT','ES','PT','NL','BE','AT','FI','GR'];
const HIGH_IMPACT_KW = ['non farm payroll','nonfarm payroll','nfp','consumer price index','cpi','producer price index','ppi','fomc','federal open market','interest rate decision','rate decision','rate statement','gdp growth rate','gross domestic product','pce price','core pce','ism manufacturing pmi','ism services pmi','initial jobless claims','rba interest','boe interest','ecb interest','boj interest','rbnz interest','fed funds','cash rate','unemployment rate','inflation rate','retail sales','jolts job openings','jolts','adp employment','adp nonfarm','cb consumer confidence','consumer confidence','michigan consumer sentiment','consumer sentiment'];
const NOISE_KW = ['baden','bavaria','brandenburg','hesse','saxony','thuringia','north rhine','rhineland','westphalia','palatinate','saarland','hamburg','bremen','berlin','schleswig','mecklenburg','lower saxony','brc ','dmp ','u-6 ','private non farm','flash estimate','prelim estimate','2nd est','3rd est','final est','qoq final','yoy final','harmonised','prel','prelim'];
const isNoise = n => NOISE_KW.some(k => (n||'').toLowerCase().includes(k));
const isHighImpact = (e,c) => MAJOR_COUNTRIES.includes(c) && HIGH_IMPACT_KW.some(k => (e||'').toLowerCase().includes(k)) && !isNoise(e);

app.get('/calendar', async (req, res) => {
  const { start_date, end_date } = req.query;
  if (!start_date || !end_date) return res.status(400).json({ error: 'start_date and end_date required' });
  try {
    const FMP_KEY = process.env.FMP_KEY;
    const url = `https://financialmodelingprep.com/stable/economic-calendar?from=${start_date}&to=${end_date}&apikey=${FMP_KEY}`;
    const r = await axios.get(url, { timeout: 10000 });
    const raw = Array.isArray(r.data) ? r.data : [];
    const HIGH_IMPACT_EVENTS = ['non farm payroll','nonfarm payroll','nfp','consumer price index','cpi','producer price index','ppi','fomc','federal open market','interest rate decision','rate decision','rate statement','gdp growth rate','gross domestic product','pce price','core pce','ism manufacturing','ism services','initial jobless claims','rba interest','rba cash rate','cash rate','boe interest','bank of england','ecb interest','ecb rate','boj interest','bank of japan','rbnz interest','rbnz rate','fed funds','unemployment rate','inflation rate','retail sales','jolts','adp employment','adp nonfarm','consumer confidence','michigan consumer sentiment','norges bank','riksbank','snb interest','snb rate','bank of canada','boc rate'];
    const MAJOR_CCY_COUNTRIES = ['US','EU','GB','JP','AU','CA','NZ','CH','DE','FR','NO','SE'];
    const events = raw
      .filter(e => {
        const name = (e.event || '').toLowerCase();
        const country = (e.country || '').toUpperCase();
        const impact = (e.impact || '').toLowerCase();
        const isHigh = impact === 'high' || HIGH_IMPACT_EVENTS.some(k => name.includes(k));
        const isMajor = MAJOR_CCY_COUNTRIES.includes(country);
        return isHigh && isMajor;
      })
      .map(e => ({
        event: e.event, country: e.country,
        date: e.date ? e.date.split(' ')[0] : '',
        time: e.date ? (e.date.split(' ')[1] || '') : '',
        importance: 'high',
        forecast: e.estimate != null ? String(e.estimate) : null,
        previous: e.previous != null ? String(e.previous) : null,
        actual: e.actual != null ? String(e.actual) : null,
      }));
    res.json({ result: events });
  } catch (e) {
    console.error('Calendar error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

const COT_MARKETS = {
  'EUR': 'EURO FX - CHICAGO MERCANTILE EXCHANGE',
  'GBP': 'BRITISH POUND - CHICAGO MERCANTILE EXCHANGE',
  'JPY': 'JAPANESE YEN - CHICAGO MERCANTILE EXCHANGE',
  'CAD': 'CANADIAN DOLLAR - CHICAGO MERCANTILE EXCHANGE',
  'AUD': 'AUSTRALIAN DOLLAR - CHICAGO MERCANTILE EXCHANGE',
  'NZD': 'NZ DOLLAR - CHICAGO MERCANTILE EXCHANGE',
  'CHF': 'SWISS FRANC - CHICAGO MERCANTILE EXCHANGE',
  'USD': 'USD INDEX - ICE FUTURES U.S.',
};

let cotCache = null, cotCacheTime = null, cotTopPairsCache = null;
const COT_CACHE_MS = 6 * 60 * 60 * 1000;

function getLastCftcReleaseTime() {
  const now = new Date();
  const d = now.getUTCDay(), h = now.getUTCHours();
  const back = d===5&&h>=21 ? 0 : d===5 ? 7 : d===6 ? 1 : d===0 ? 2 : d+2;
  const r = new Date(now);
  r.setUTCDate(now.getUTCDate() - back);
  r.setUTCHours(21,0,0,0);
  return r.getTime();
}

let historicalRanges = null, historicalRangesTime = null;
const HIST_CACHE_MS = 24*60*60*1000;

async function fetchHistoricalRanges() {
  if (historicalRanges && historicalRangesTime && (Date.now()-historicalRangesTime) < HIST_CACHE_MS) return historicalRanges;
  try {
    const url = `https://publicreporting.cftc.gov/resource/6dca-aqww.json?$order=report_date_as_yyyy_mm_dd DESC&$limit=2000`;
    const response = await axios.get(url, { timeout: 60000, headers: { 'Accept': 'application/json' } });
    const allRows = response.data || [];
    const threeYearsAgo = new Date(); threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3);
    const fiveYearsAgo  = new Date(); fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - 5);
    const ranges = {};
    Object.entries(COT_MARKETS).forEach(([currency, marketName]) => {
      const rows3y = allRows.filter(r => { const d = new Date(r.report_date_as_yyyy_mm_dd); return d >= threeYearsAgo && r.market_and_exchange_names && r.market_and_exchange_names.toUpperCase() === marketName.toUpperCase(); });
      const rows5y = allRows.filter(r => { const d = new Date(r.report_date_as_yyyy_mm_dd); return d >= fiveYearsAgo  && r.market_and_exchange_names && r.market_and_exchange_names.toUpperCase() === marketName.toUpperCase(); });
      if (rows3y.length === 0) return;
      const commNets3y = rows3y.map(r => (parseInt(r.comm_positions_long_all)||0) - (parseInt(r.comm_positions_short_all)||0));
      const specNets3y = rows3y.map(r => (parseInt(r.noncomm_positions_long_all)||0) - (parseInt(r.noncomm_positions_short_all)||0));
      const recentSpecWows = rows3y.slice(0,8).map(r => ((parseInt(r.change_in_noncomm_long_all)||0) - (parseInt(r.change_in_noncomm_short_all)||0)));
      const commNets5y = rows5y.length > 0 ? rows5y.map(r => (parseInt(r.comm_positions_long_all)||0) - (parseInt(r.comm_positions_short_all)||0)) : commNets3y;
      const specNets5y = rows5y.length > 0 ? rows5y.map(r => (parseInt(r.noncomm_positions_long_all)||0) - (parseInt(r.noncomm_positions_short_all)||0)) : specNets3y;
      ranges[currency] = {
        min: Math.min(...commNets3y), max: Math.max(...commNets3y), count: rows3y.length,
        spec_min: Math.min(...specNets3y), spec_max: Math.max(...specNets3y), recent_spec_wows: recentSpecWows,
        min_5y: Math.min(...commNets5y), max_5y: Math.max(...commNets5y), count_5y: rows5y.length,
        spec_min_5y: Math.min(...specNets5y), spec_max_5y: Math.max(...specNets5y),
      };
    });
    historicalRanges = ranges; historicalRangesTime = Date.now();
    return ranges;
  } catch (e) { console.error('Historical fetch error:', e.message); return {}; }
}

async function fetchCotData() {
  const url = `https://publicreporting.cftc.gov/resource/6dca-aqww.json?$order=report_date_as_yyyy_mm_dd DESC&$limit=500`;
  const r = await axios.get(url, { timeout: 15000, headers: { 'Accept': 'application/json' } });
  const allRows = r.data || [];
  if (allRows.length === 0) return [];
  const latestDate = allRows[0].report_date_as_yyyy_mm_dd;
  return allRows.filter(r => r.report_date_as_yyyy_mm_dd === latestDate);
}

function calcCommIndex(commNet, ranges, currency) {
  if (!ranges?.[currency]) return 50;
  const { min, max } = ranges[currency];
  if (max === min) return 50;
  return Math.round(((commNet - min) / (max - min)) * 100);
}

function calcCommIndex5y(commNet, ranges, currency) {
  if (!ranges?.[currency]) return 50;
  const { min_5y, max_5y } = ranges[currency];
  if (max_5y === undefined || max_5y === min_5y) return 50;
  return Math.round(((commNet - min_5y) / (max_5y - min_5y)) * 100);
}

function getExtremeLabel(commIndex3y, commIndex5y, trendState) {
  const extreme3y = commIndex3y >= 80 || commIndex3y <= 20;
  const extreme5y = commIndex5y >= 85 || commIndex5y <= 15;
  const sameSide  = (commIndex3y >= 80 && commIndex5y >= 85) || (commIndex3y <= 20 && commIndex5y <= 15);
  const expanding = trendState === 'EXPANDING';
  if (!extreme3y) return null;
  if (extreme5y && sameSide && expanding) return 'ELITE';
  if (extreme5y && sameSide) return 'STRUCTURAL_EXTREME';
  return 'LOCAL_EXTREME';
}

function calcSpecIndex(specNet, ranges, currency) {
  if (!ranges?.[currency]) return 50;
  const { spec_min, spec_max } = ranges[currency];
  if (spec_max === spec_min) return 50;
  return Math.round(((specNet - spec_min) / (spec_max - spec_min)) * 100);
}

function getCrowdSignal(specIndex, specWow, oi) {
  const specWowPct = oi > 0 ? specWow / oi : 0;
  const crowdBullish = specIndex >= 50;
  const crowdDir = crowdBullish ? 'bullish crowd' : 'bearish crowd';
  const crowdExtreme = specIndex >= 70 || specIndex <= 30;
  const wowReinforcing = (crowdBullish && specWowPct > 0.005) || (!crowdBullish && specWowPct < -0.005);
  const wowFading     = (crowdBullish && specWowPct < -0.005) || (!crowdBullish && specWowPct > 0.005);
  let state;
  if (!crowdExtreme && wowReinforcing)                    state = 'BUILDING';
  else if (crowdExtreme && wowReinforcing)                state = 'ACCELERATING';
  else if (crowdExtreme && !wowFading && !wowReinforcing) state = 'EXHAUSTING';
  else if (crowdExtreme && wowFading)                     state = 'UNWINDING';
  else return null;
  return { state, crowdDir };
}

function calcPressureScore(cL, cS, sL, sS, oi) {
  if (!oi) return 50;
  return Math.min(100, Math.round(Math.abs(((cL-cS)/oi - (sL-sS)/oi)) * 200));
}

function getPressureLabel(s) { return s>=80 ? 'CRITICAL' : s>=60 ? 'PRESSURIZED' : s>=40 ? 'BUILDING' : 'NEUTRAL'; }

function calcBiasScore(pressureScore, commIndex, commNet, specNet, specWow, oi) {
  const commDirection = (commIndex - 50) / 50;
  const commStrength = Math.abs(commIndex - 50) / 50;
  let b = pressureScore * commDirection * commStrength;
  const specStrength = Math.min(1, (oi > 0 ? Math.abs(specNet)/oi : 0) * 5);
  if ((commNet > 0) !== (specNet > 0)) {
    b *= (1 + specStrength * 0.5);
    if (specWow < 0 && commNet > 0) b *= 1.1;
    if (specWow > 0 && commNet < 0) b *= 1.1;
  } else { b *= 0.5; }
  return Math.max(-100, Math.min(100, Math.round(b)));
}

function getBiasLabel(s) { return s>=50 ? 'STR BULLISH' : s>=20 ? 'BULLISH' : s>=5 ? 'WK BULLISH' : s<=-50 ? 'STR BEARISH' : s<=-20 ? 'BEARISH' : s<=-5 ? 'WK BEARISH' : 'NEUTRAL'; }
function getSignal(i) { return i<=20 ? 'BEARISH' : i>=80 ? 'BULLISH' : 'NEUTRAL'; }
function getFreshness(i, w) { if (i>=80 || i<=20) return (i>=80 ? w>=5000 : w<=-5000) ? 'FRESH' : 'STALE'; return 'NEUTRAL'; }

async function buildCotResult() {
  const [rows, ranges] = await Promise.all([fetchCotData(), fetchHistoricalRanges()]);
  const result = {};
  Object.entries(COT_MARKETS).forEach(([currency, marketName]) => {
    const row = rows.find(r => r.market_and_exchange_names && (
      r.market_and_exchange_names.toUpperCase() === marketName.toUpperCase() ||
      (currency==='NZD' && r.market_and_exchange_names.toUpperCase().includes('NZ DOLLAR'))
    ));
    if (!row) { result[currency] = { currency, error: 'no data' }; return; }
    const cL = parseInt(row.comm_positions_long_all)||0, cS = parseInt(row.comm_positions_short_all)||0;
    const sL = parseInt(row.noncomm_positions_long_all)||0, sS = parseInt(row.noncomm_positions_short_all)||0;
    const oi = parseInt(row.open_interest_all)||0;
    const commNet = cL - cS, specNet = sL - sS;
    const commWoW = (parseInt(row.change_in_comm_long_all)||0) - (parseInt(row.change_in_comm_short_all)||0);
    const specWoW = (parseInt(row.change_in_noncomm_long_all)||0) - (parseInt(row.change_in_noncomm_short_all)||0);
    const commIndex   = calcCommIndex(commNet, ranges, currency);
    const commIndex5y = calcCommIndex5y(commNet, ranges, currency);
    const specIndex   = calcSpecIndex(specNet, ranges, currency);
    const pressure    = calcPressureScore(cL,cS,sL,sS,oi);
    const biasScore   = calcBiasScore(pressure, Math.round(commIndex), commNet, specNet, specWoW, oi);
    const crowdSignal = getCrowdSignal(specIndex, specWoW, oi);
    const wowPct = oi > 0 ? commWoW / oi : 0;
    const trendState = wowPct > 0.015 ? 'EXPANDING' : wowPct < -0.015 ? 'UNWINDING' : 'PEAKING';
    const extremeLabel = getExtremeLabel(Math.round(commIndex), Math.round(commIndex5y), trendState);
    result[currency] = {
      currency, report_date: row.report_date_as_yyyy_mm_dd,
      comm_long: cL, comm_short: cS, comm_net: commNet, comm_wow: commWoW,
      spec_long: sL, spec_short: sS, spec_net: specNet, spec_wow: specWoW,
      open_interest: oi,
      comm_index: Math.round(commIndex), comm_index_5y: Math.round(commIndex5y),
      spec_index: Math.round(specIndex),
      extreme_label: extremeLabel,
      pressure_score: pressure, pressure_label: getPressureLabel(pressure),
      signal: getSignal(commIndex), freshness: getFreshness(Math.round(commIndex), commWoW),
      bias_score: biasScore, bias_label: getBiasLabel(biasScore),
      trend_state: trendState,
      crowd_state: crowdSignal ? crowdSignal.state : null,
      crowd_dir:   crowdSignal ? crowdSignal.crowdDir : null,
    };
  });
  return result;
}

app.get('/cot', async (req, res) => {
  try {
    const now = Date.now();
    const cacheIsStale = cotCacheTime && cotCacheTime < getLastCftcReleaseTime();
    if (cotCache && cotCacheTime && (now-cotCacheTime) < COT_CACHE_MS && !cacheIsStale)
      return res.json({ result: cotCache, top_pairs: cotTopPairsCache||[], cached: true });
    const result = await buildCotResult();
    const REAL_FOREX_PAIRS = ['EUR/USD','GBP/USD','AUD/USD','NZD/USD','USD/JPY','USD/CAD','USD/CHF','EUR/GBP','EUR/JPY','EUR/CAD','EUR/CHF','EUR/AUD','EUR/NZD','GBP/JPY','GBP/CAD','GBP/CHF','GBP/AUD','GBP/NZD','AUD/JPY','AUD/CAD','AUD/CHF','AUD/NZD','NZD/JPY','NZD/CAD','NZD/CHF','CAD/JPY','CAD/CHF','CHF/JPY'];
    const pairs = [];
    for (const pairName of REAL_FOREX_PAIRS) {
      const [base, quote] = pairName.split('/');
      const bd = result[base], qd = result[quote];
      if (!bd||!qd||bd.comm_index===undefined||qd.comm_index===undefined) continue;
      const spread = bd.comm_index - qd.comm_index;
      const absSpread = Math.abs(spread);
      if (absSpread < 40) continue;
      const isLong = spread > 0;
      const lc = isLong ? base : quote, sc = isLong ? quote : base;
      const lb = MACRO_STANCE[lc]?.bias||'neutral', sb = MACRO_STANCE[sc]?.bias||'neutral';
      const aligned = lb==='hawkish' && sb==='dovish';
      const opposite = lb==='dovish' && sb==='hawkish';
      const avgP = ((result[lc]?.pressure_score||0) + (result[sc]?.pressure_score||0)) / 2;
      if (opposite && avgP < 60) continue;
      let score = absSpread;
      if (aligned) score *= 1.25; else if (opposite) score *= 0.6;
      const ltp = (result[lc]?.comm_wow||0) / (result[lc]?.open_interest||1);
      const stp = (result[sc]?.comm_wow||0) / (result[sc]?.open_interest||1);
      if (ltp > 0.015 || stp < -0.015) score *= 1.2;
      if (ltp < -0.015 || stp > 0.015) score *= 0.7;
      if (result[lc]?.extreme_label === 'ELITE' || result[lc]?.extreme_label === 'STRUCTURAL_EXTREME') score *= 1.15;
      if (result[lc]?.extreme_label === 'ELITE' && aligned) score *= 1.1;
      const longD = result[lc];
      const dominantBiasScore = isLong ? bd.bias_score : -qd.bias_score;
      const avgPressure2 = Math.round((bd.pressure_score + qd.pressure_score) / 2);
      const avgPressureLabel2 = getPressureLabel(avgPressure2);
      const trendState2 = longD?.trend_state || 'PEAKING';
      const extremeLabel2 = longD?.extreme_label || null;
      const macroAlignment2 = aligned ? 'ALIGNED' : opposite ? 'CONFLICT' : 'NEUTRAL';
      const tier = calcTier(dominantBiasScore, avgPressureLabel2, macroAlignment2, trendState2, extremeLabel2);
      const isUltra = extremeLabel2 === 'ELITE' && aligned;
      const badge = isUltra ? 'ULTRA' : extremeLabel2 === 'ELITE' ? 'ELITE' : extremeLabel2 === 'STRUCTURAL_EXTREME' ? 'STRUCTURAL' : extremeLabel2 === 'LOCAL_EXTREME' ? 'LOCAL' : null;
      pairs.push({
        pair: pairName, direction: isLong ? `Long ${pairName}` : `Short ${pairName}`,
        bias: isLong ? 'LONG' : 'SHORT', spread: Math.round(absSpread), score: Math.round(score),
        long_ccy: lc, short_ccy: sc,
        long_index: isLong ? bd.comm_index : qd.comm_index,
        short_index: isLong ? qd.comm_index : bd.comm_index,
        long_signal: isLong ? bd.signal : qd.signal,
        short_signal: isLong ? qd.signal : bd.signal,
        long_bias: lb, short_bias: sb,
        macro_alignment: macroAlignment2,
        strength: absSpread>=70 ? 'STRONG' : absSpread>=55 ? 'MODERATE' : 'WEAK',
        long_extreme: isLong ? bd.extreme_label : qd.extreme_label,
        short_extreme: isLong ? qd.extreme_label : bd.extreme_label,
        ultra: isUltra,
        long_index_5y: isLong ? bd.comm_index_5y : qd.comm_index_5y,
        short_index_5y: isLong ? qd.comm_index_5y : bd.comm_index_5y,
        tier, badge,
      });
    }
    pairs.sort((a,b) => b.score - a.score);
    cotCache = result; cotTopPairsCache = pairs.slice(0,5); cotCacheTime = now;
    res.json({ result, top_pairs: pairs.slice(0,5), cached: false });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/cot-debug', async (req, res) => {
  try {
    const url = `https://publicreporting.cftc.gov/resource/6dca-aqww.json?$order=report_date_as_yyyy_mm_dd DESC&$limit=500`;
    const r = await axios.get(url, { timeout: 15000, headers: { 'Accept': 'application/json' } });
    const rows = r.data||[];
    const latestDate = rows[0]?.report_date_as_yyyy_mm_dd;
    const latestRows = rows.filter(r => r.report_date_as_yyyy_mm_dd === latestDate);
    const keys = ['EURO FX','BRITISH POUND','JAPANESE YEN','CANADIAN DOLLAR','AUSTRALIAN DOLLAR','NEW ZEALAND','NZ DOLLAR','SWISS FRANC','USD INDEX'];
    const forexRows = latestRows.filter(r => keys.some(k => (r.market_and_exchange_names||'').toUpperCase().includes(k)));
    res.json({ latestDate, totalLatest: latestRows.length, forexCount: forexRows.length,
      forex: forexRows.map(r => ({ name: r.market_and_exchange_names, date: r.report_date_as_yyyy_mm_dd, comm_long: r.comm_positions_long_all, comm_short: r.comm_positions_short_all })) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

function calcTier(biasScore, pressureLabel, macroAlignment, trendState, extremeLabel) {
  const absScore = Math.abs(biasScore);
  if (absScore > 70 && pressureLabel === 'CRITICAL' && macroAlignment === 'ALIGNED' && trendState === 'EXPANDING') return 'A+';
  if (absScore > 55 && (pressureLabel === 'CRITICAL' || pressureLabel === 'PRESSURIZED') && macroAlignment !== 'CONFLICT') return 'A';
  if (absScore > 40 && pressureLabel !== 'NEUTRAL') return 'B';
  return null;
}

function tdSymbol(pair) { return pair.replace('/', ''); }

async function fetchDailyOHLC(pair, outputSize = 30) {
  const sym = tdSymbol(pair);
  const url = `https://api.twelvedata.com/time_series?symbol=${sym}&interval=1day&outputsize=${outputSize}&apikey=${TD_KEY}`;
  const r = await axios.get(url, { timeout: 10000 });
  if (r.data.status === 'error') throw new Error(r.data.message);
  return r.data.values || [];
}

function evaluateSnapshot(snap, ohlcRows) {
  if (!ohlcRows || ohlcRows.length === 0) return null;
  const entry = parseFloat(snap.entry_price);
  if (!entry) return null;
  const isLong = snap.direction === 'LONG';
  const pipSize = snap.pair.includes('JPY') ? 0.01 : 0.0001;
  let maxMFE = 0, maxMAE = 0, timeMFEday = 0;
  ohlcRows.forEach((row, idx) => {
    const high = parseFloat(row.high), low = parseFloat(row.low);
    const mfe = isLong ? (high - entry) / pipSize : (entry - low) / pipSize;
    const mae = isLong ? (entry - low) / pipSize  : (high - entry) / pipSize;
    if (mfe > maxMFE) { maxMFE = mfe; timeMFEday = idx + 1; }
    if (mae > maxMAE)   maxMAE = mae;
  });
  const strengthRatio = maxMAE > 0 ? parseFloat((maxMFE / maxMAE).toFixed(2)) : null;
  const mfeThreshold = snap.pair.includes('JPY') ? 80 : 50;
  const directionCorrect = maxMFE >= mfeThreshold;
  const strongSignal = strengthRatio !== null && strengthRatio >= 1.5;
  return {
    mfe_pips: Math.round(maxMFE), mae_pips: Math.round(maxMAE),
    time_to_mfe_days: timeMFEday, strength_ratio: strengthRatio,
    direction_correct: directionCorrect, strong_signal: strongSignal,
    days_tracked: ohlcRows.length,
  };
}

function buildTierStats(snaps) {
  const tiers = ['A+', 'A', 'B'];
  const result = {};
  for (const tier of tiers) {
    const t = snaps.filter(s => s.tier === tier);
    const withDir  = t.filter(s => s.direction_correct !== null && s.direction_correct !== undefined);
    const withMFE  = t.filter(s => s.mfe_pips != null && s.mae_pips != null);
    const wins     = t.filter(s => s.result === 'WIN').length;
    const losses   = t.filter(s => s.result === 'LOSS').length;
    const dirCorrect = withDir.filter(s => s.direction_correct === true).length;
    const avgMFE   = withMFE.length ? Math.round(withMFE.reduce((a, s) => a + (s.mfe_pips||0), 0) / withMFE.length) : null;
    const avgMAE   = withMFE.length ? Math.round(withMFE.reduce((a, s) => a + (s.mae_pips||0), 0) / withMFE.length) : null;
    const avgRatio = withMFE.length ? parseFloat((withMFE.reduce((a, s) => a + (s.strength_ratio||0), 0) / withMFE.length).toFixed(2)) : null;
    result[tier] = {
      total: t.length, wins,
      winrate: t.length ? parseFloat((wins / t.length).toFixed(4)) : 0,
      effective_win_rate: (wins + losses) > 0 ? parseFloat((wins / (wins + losses)).toFixed(4)) : null,
      follow_through_rate: t.length ? parseFloat((wins / t.length).toFixed(4)) : 0,
      losses, flats: t.length - wins - losses,
      direction_accuracy: withDir.length ? parseFloat((dirCorrect / withDir.length).toFixed(4)) : null,
      avg_mfe_pips: avgMFE, avg_mae_pips: avgMAE, avg_strength_ratio: avgRatio,
      sample_ok: t.length >= 10,
    };
  }
  return result;
}

function buildAlignmentStats(snaps) {
  const alignments = ['ALIGNED', 'NEUTRAL', 'CONFLICT'];
  const result = {};
  for (const align of alignments) {
    const t = snaps.filter(s => s.macro_alignment === align);
    const wins = t.filter(s => s.result === 'WIN').length;
    const withDir = t.filter(s => s.direction_correct !== null && s.direction_correct !== undefined);
    const dirCorrect = withDir.filter(s => s.direction_correct === true).length;
    const losses_a = t.filter(s => s.result === 'LOSS').length;
    result[align] = {
      total: t.length, wins, losses: losses_a, flats: t.length - wins - losses_a,
      winrate: t.length ? parseFloat((wins / t.length).toFixed(4)) : 0,
      effective_win_rate: (wins + losses_a) > 0 ? parseFloat((wins / (wins + losses_a)).toFixed(4)) : null,
      follow_through_rate: t.length ? parseFloat((wins / t.length).toFixed(4)) : 0,
      direction_accuracy: withDir.length ? parseFloat((dirCorrect / withDir.length).toFixed(4)) : null,
    };
  }
  return result;
}

function buildCurrencyStats(snaps) {
  const ccyMap = {};
  for (const s of snaps) {
    for (const ccy of [s.long_ccy, s.short_ccy]) {
      if (!ccy) continue;
      if (!ccyMap[ccy]) ccyMap[ccy] = { total: 0, wins: 0, dir_total: 0, dir_correct: 0, mfe_sum: 0, mfe_count: 0 };
      ccyMap[ccy].total++;
      if (s.result === 'WIN') ccyMap[ccy].wins++;
      if (s.direction_correct !== null && s.direction_correct !== undefined) {
        ccyMap[ccy].dir_total++;
        if (s.direction_correct) ccyMap[ccy].dir_correct++;
      }
      if (s.mfe_pips != null) { ccyMap[ccy].mfe_sum += s.mfe_pips; ccyMap[ccy].mfe_count++; }
    }
  }
  const result = {};
  for (const [ccy, d] of Object.entries(ccyMap)) {
    if (d.total < 3) continue;
    result[ccy] = {
      total: d.total, wins: d.wins,
      winrate: parseFloat((d.wins / d.total).toFixed(4)),
      direction_accuracy: d.dir_total ? parseFloat((d.dir_correct / d.dir_total).toFixed(4)) : null,
      avg_mfe_pips: d.mfe_count ? Math.round(d.mfe_sum / d.mfe_count) : null,
    };
  }
  return result;
}

app.get('/analytics', async (req, res) => {
  try {
    const snaps = await sb.select('cot_snapshots', {
      is_complete: 'eq.true',
      select: 'tier,result,macro_alignment,long_ccy,short_ccy,direction_correct,mfe_pips,mae_pips,strength_ratio,holding_days',
      order: 'created_at.desc', limit: 500,
    });
    if (!snaps || snaps.length === 0) return res.json({ total_complete: 0, message: 'No completed snapshots yet' });
    const byTier = buildTierStats(snaps);
    const byAlignment = buildAlignmentStats(snaps);
    const byCurrency = buildCurrencyStats(snaps);
    const wins = snaps.filter(s => s.result === 'WIN').length;
    const losses = snaps.filter(s => s.result === 'LOSS').length;
    const flats = snaps.filter(s => s.result === 'FLAT').length;
    const withDir = snaps.filter(s => s.direction_correct !== null && s.direction_correct !== undefined);
    const dirCorrect = withDir.filter(s => s.direction_correct === true).length;
    const withHolding = snaps.filter(s => s.holding_days != null);
    const withMFE = snaps.filter(s => s.mfe_pips != null && s.mae_pips != null);
    res.json({
      total_complete: snaps.length,
      overall_winrate: parseFloat((wins / snaps.length).toFixed(4)),
      effective_win_rate: (wins + losses) > 0 ? parseFloat((wins / (wins + losses)).toFixed(4)) : null,
      follow_through_rate: parseFloat((wins / snaps.length).toFixed(4)),
      wins, losses, flats,
      overall_direction_accuracy: withDir.length ? parseFloat((dirCorrect / withDir.length).toFixed(4)) : null,
      avg_holding_days: withHolding.length ? parseFloat((withHolding.reduce((a, s) => a + s.holding_days, 0) / withHolding.length).toFixed(1)) : null,
      avg_mfe_pips: withMFE.length ? Math.round(withMFE.reduce((a, s) => a + s.mfe_pips, 0) / withMFE.length) : null,
      avg_mae_pips: withMFE.length ? Math.round(withMFE.reduce((a, s) => a + s.mae_pips, 0) / withMFE.length) : null,
      avg_strength_ratio: withMFE.length ? parseFloat((withMFE.reduce((a, s) => a + (s.strength_ratio||0), 0) / withMFE.length).toFixed(2)) : null,
      best_tier: ['A+','A','B'].filter(t => byTier[t].total >= 5).sort((a,b) => byTier[b].winrate - byTier[a].winrate)[0] || null,
      best_currency: Object.entries(byCurrency).filter(([,d]) => d.total >= 5).sort((a,b) => b[1].winrate - a[1].winrate)[0]?.[0] || null,
      winrate_by_tier: byTier,
      direction_accuracy_by_tier: Object.fromEntries(Object.entries(byTier).map(([t,d]) => [t, d.direction_accuracy])),
      avg_mfe_mae_by_tier: Object.fromEntries(Object.entries(byTier).map(([t,d]) => [t, { avg_mfe_pips: d.avg_mfe_pips, avg_mae_pips: d.avg_mae_pips, avg_strength_ratio: d.avg_strength_ratio }])),
      winrate_by_alignment: byAlignment,
      winrate_by_currency: byCurrency,
    });
  } catch (e) { console.error('Analytics error:', e.message); res.status(500).json({ error: e.message }); }
});

app.post('/performance/ohlc-update', async (req, res) => {
  if (req.headers['x-cron-secret'] !== CRON_SECRET) return res.status(401).json({ error: 'unauthorized' });
  try {
    const openSnaps = await sb.select('cot_snapshots', { is_complete: 'eq.false', select: 'id,pair,direction,entry_price,created_at' });
    if (openSnaps.length === 0) return res.json({ updated: 0, message: 'No active snapshots' });
    const today = new Date().toISOString().split('T')[0];
    let updated = 0, skipped = 0, errors = 0, entryFetched = 0;
    for (const snap of openSnaps) {
      try {
        if (!snap.entry_price) {
          try {
            const priceRes = await axios.get(`https://api.twelvedata.com/price?symbol=${snap.pair.replace('/','')}&apikey=${TD_KEY}`, { timeout: 5000 });
            const price = parseFloat(priceRes.data?.price) || null;
            if (price) { await sb.update('cot_snapshots', { id: `eq.${snap.id}` }, { entry_price: price }); snap.entry_price = price; entryFetched++; }
          } catch (_) {}
          await new Promise(r => setTimeout(r, 8000));
        }
        const existing = await sb.select('cot_ohlc_daily', { snapshot_id: `eq.${snap.id}`, date: `eq.${today}`, select: 'id', limit: 1 });
        if (existing.length > 0) { skipped++; continue; }
        const ohlc = await fetchDailyOHLC(snap.pair, 2);
        if (!ohlc || ohlc.length === 0) { errors++; continue; }
        const candle = ohlc[0];
        const candleDate = candle.datetime.split(' ')[0];
        const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split('T')[0];
        if (candleDate !== today && candleDate !== yesterdayStr) { skipped++; continue; }
        await sb.insert('cot_ohlc_daily', [{ snapshot_id: snap.id, pair: snap.pair, date: candleDate, open: parseFloat(candle.open), high: parseFloat(candle.high), low: parseFloat(candle.low), close: parseFloat(candle.close) }]);
        await sb.update('cot_snapshots', { id: `eq.${snap.id}` }, { snapshot_status: 'partial' });
        updated++;
        await new Promise(r => setTimeout(r, 8000));
      } catch (e) { console.error(`OHLC update error for ${snap.pair}:`, e.message); errors++; }
    }
    res.json({ updated, skipped, errors, entry_fetched: entryFetched, total_active: openSnaps.length, date: today });
  } catch (e) { console.error('OHLC update error:', e.message); res.status(500).json({ error: e.message }); }
});

app.get('/performance/ohlc/:snapshotId', async (req, res) => {
  try {
    const rows = await sb.select('cot_ohlc_daily', { snapshot_id: `eq.${req.params.snapshotId}`, select: '*', order: 'date.asc' });
    res.json({ ohlc: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/performance', async (req, res) => {
  try {
    const snapshots = await sb.select('cot_snapshots', { select: '*', order: 'report_date.desc', limit: 500 });
    const enriched = await Promise.all(snapshots.map(async (snap) => {
      try {
        const ohlcRows = await sb.select('cot_ohlc_daily', { snapshot_id: `eq.${snap.id}`, select: 'date,open,high,low,close', order: 'date.asc' });
        const evaluation = evaluateSnapshot(snap, ohlcRows);
        return { ...snap, ohlc_evaluation: evaluation, ohlc_days: ohlcRows.length };
      } catch (_) { return { ...snap, ohlc_evaluation: null, ohlc_days: 0 }; }
    }));
    res.json({ snapshots: enriched });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/performance/snapshot', async (req, res) => {
  if (req.headers['x-cron-secret'] !== CRON_SECRET) return res.status(401).json({ error: 'unauthorized' });
  try {
    const cotData = await buildCotResult();
    const reportDate = Object.values(cotData).find(d => d.report_date)?.report_date;
    if (!reportDate) return res.status(500).json({ error: 'no COT data' });
    const existing = await sb.select('cot_snapshots', { report_date: `eq.${reportDate}`, select: 'pair,snapshot_status' });
    const existingPairs = new Set((existing || []).map(s => s.pair));
    const REAL_FOREX_PAIRS = ['EUR/USD','GBP/USD','AUD/USD','NZD/USD','USD/JPY','USD/CAD','USD/CHF','EUR/GBP','EUR/JPY','EUR/CAD','EUR/CHF','EUR/AUD','EUR/NZD','GBP/JPY','GBP/CAD','GBP/CHF','GBP/AUD','GBP/NZD','AUD/JPY','AUD/CAD','AUD/CHF','AUD/NZD','NZD/JPY','NZD/CAD','NZD/CHF','CAD/JPY','CAD/CHF','CHF/JPY'];
    const snapshots = [];
    for (const pairName of REAL_FOREX_PAIRS) {
      const [base, quote] = pairName.split('/');
      const bd = cotData[base], qd = cotData[quote];
      if (!bd || !qd || bd.error || qd.error) continue;
      const spread = bd.comm_index - qd.comm_index;
      const absSpread = Math.abs(spread);
      if (absSpread < 40) continue;
      const isLong = spread > 0;
      const longCcy = isLong ? base : quote, shortCcy = isLong ? quote : base;
      const longD = isLong ? bd : qd;
      const lb = MACRO_STANCE[longCcy]?.bias || 'neutral';
      const sb_bias = MACRO_STANCE[shortCcy]?.bias || 'neutral';
      const aligned = lb === 'hawkish' && sb_bias === 'dovish';
      const conflict = lb === 'dovish' && sb_bias === 'hawkish';
      const macroAlignment = aligned ? 'ALIGNED' : conflict ? 'CONFLICT' : 'NEUTRAL';
      const dominantBiasScore = isLong ? bd.bias_score : -qd.bias_score;
      const avgPressure = Math.round((bd.pressure_score + qd.pressure_score) / 2);
      const avgPressureLabel = getPressureLabel(avgPressure);
      const trendState = longD.trend_state || 'PEAKING';
      const freshnessLabel = longD.freshness || 'STALE';
      const crowdState = longD.crowd_state || 'BUILDING';
      const extremeLabel = longD.extreme_label || null;
      const tier = calcTier(dominantBiasScore, avgPressureLabel, macroAlignment, trendState, extremeLabel);
      if (!tier) continue;
      const weekType = (macroAlignment === 'ALIGNED' && absSpread >= 60) ? 'CLEAN' : 'MIXED';
      const badge = (extremeLabel === 'ELITE' && aligned) ? 'ULTRA' : extremeLabel === 'ELITE' ? 'ELITE' : extremeLabel === 'STRUCTURAL_EXTREME' ? 'STRUCTURAL' : extremeLabel === 'LOCAL_EXTREME' ? 'LOCAL' : null;
      snapshots.push({
        pair: pairName, report_date: reportDate, direction: isLong ? 'LONG' : 'SHORT', tier, badge,
        bias_score: Math.round(dominantBiasScore), bias_label: isLong ? bd.bias_label : qd.bias_label,
        macro_alignment: macroAlignment, macro_long_bias: lb, macro_short_bias: sb_bias,
        pressure_score: avgPressure, pressure_label: avgPressureLabel,
        trend_state: trendState, freshness_label: freshnessLabel, crowd_state: crowdState,
        long_ccy: longCcy, short_ccy: shortCcy, week_type: weekType,
        entry_price: null, entry_day_of_week: new Date().getUTCDay(),
        exit_price: null, return_pct: null, result: null, holding_days: null,
        is_complete: false, snapshot_status: 'pending', created_at: new Date().toISOString(),
      });
    }
    if (snapshots.length === 0) return res.json({ saved: 0, already_saved: existingPairs.size, message: existingPairs.size > 0 ? 'All qualifying pairs already saved this week' : 'No qualifying setups this week', report_date: reportDate });
    const upserted = await sb.upsert('cot_snapshots', snapshots, 'report_date,pair');
    const newCount = upserted.filter(s => !existingPairs.has(s.pair)).length;
    const updCount = upserted.filter(s =>  existingPairs.has(s.pair)).length;
    res.json({ saved: newCount, updated: updCount, already_saved: existingPairs.size, report_date: reportDate, snapshot_status: 'complete' });
  } catch (e) { console.error('Snapshot error:', e.message); res.status(500).json({ error: e.message }); }
});

app.post('/performance/close', async (req, res) => {
  if (req.headers['x-cron-secret'] !== CRON_SECRET) return res.status(401).json({ error: 'unauthorized' });
  try {
    const open = await sb.select('cot_snapshots', { is_complete: 'eq.false', entry_price: 'not.is.null', select: 'id,pair,direction,entry_price,report_date,created_at,badge' });
    if (open.length === 0) return res.json({ closed: 0, message: 'No open snapshots' });
    const now = Date.now();
    let closed = 0;
    for (const snap of open) {
      try {
        const createdAt = new Date(snap.created_at).getTime();
        const daysOpen = (now - createdAt) / (1000 * 60 * 60 * 24);
        const closeAfterDays = (snap.badge === 'ULTRA' || snap.badge === 'ELITE') ? 28 : 14;
        if (daysOpen < closeAfterDays) continue;
        const ohlcRows = await sb.select('cot_ohlc_daily', { snapshot_id: `eq.${snap.id}`, select: 'date,open,high,low,close', order: 'date.asc' });
        const evaluation = evaluateSnapshot(snap, ohlcRows);
        let exitPrice = null;
        try {
          const priceRes = await axios.get(`https://api.twelvedata.com/price?symbol=${snap.pair.replace('/','')}&apikey=${TD_KEY}`, { timeout: 5000 });
          exitPrice = parseFloat(priceRes.data?.price) || null;
        } catch (_) {}
        const entry = parseFloat(snap.entry_price);
        const holdingDays = Math.round(daysOpen);
        let result = 'FLAT';
        if (evaluation) {
          if (evaluation.direction_correct && evaluation.strong_signal) result = 'WIN';
          else if (evaluation.direction_correct) result = 'FLAT';
          else result = 'LOSS';
        } else if (exitPrice) {
          const rawReturn = snap.direction === 'LONG' ? (exitPrice - entry) / entry : (entry - exitPrice) / entry;
          result = rawReturn > 0.005 ? 'WIN' : rawReturn < -0.005 ? 'LOSS' : 'FLAT';
        }
        const returnPct = exitPrice ? parseFloat(((snap.direction === 'LONG' ? (exitPrice - entry) / entry : (entry - exitPrice) / entry) * 100).toFixed(4)) : null;
        await sb.update('cot_snapshots', { id: `eq.${snap.id}` }, {
          exit_price: exitPrice, return_pct: returnPct, result, holding_days: holdingDays, is_complete: true, snapshot_status: 'complete',
          ...(evaluation ? { mfe_pips: evaluation.mfe_pips, mae_pips: evaluation.mae_pips, time_to_mfe_days: evaluation.time_to_mfe_days, strength_ratio: evaluation.strength_ratio, direction_correct: evaluation.direction_correct } : {}),
        });
        closed++;
      } catch (e) { console.error(`Close error for ${snap.pair}:`, e.message); }
    }
    res.json({ closed, total_open: open.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/performance/fetch-entries', async (req, res) => {
  try {
    const snaps = await sb.select('cot_snapshots', { is_complete: 'eq.false', entry_price: 'is.null', select: 'id,pair', limit: 1 });
    if (!snaps || snaps.length === 0) return res.json({ done: true, message: 'All snapshots have entry_price' });
    const snap = snaps[0];
    const priceRes = await axios.get(`https://api.twelvedata.com/price?symbol=${snap.pair.replace('/','')}&apikey=${TD_KEY}`, { timeout: 5000 });
    const price = parseFloat(priceRes.data?.price) || null;
    if (price) { await sb.update('cot_snapshots', { id: `eq.${snap.id}` }, { entry_price: price }); }
    const remaining = await sb.select('cot_snapshots', { is_complete: 'eq.false', entry_price: 'is.null', select: 'id', limit: 100 });
    res.json({ pair: snap.pair, price, remaining: remaining.length, done: remaining.length === 0 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/performance/status', async (req, res) => {
  try {
    const all = await sb.select('cot_snapshots', { select: 'id,pair,tier,badge,result,is_complete,entry_price,report_date', order: 'created_at.desc', limit: 20 });
    res.json({ total: all.length, complete: all.filter(s => s.is_complete).length, open: all.filter(s => !s.is_complete).length, without_entry: all.filter(s => !s.entry_price).length, recent: all.slice(0,5) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── AI CHAT ───────────────────────────────────────────────────────────────
const TG_SYSTEM_PROMPT = `You are TradeGuard Assistant — an in-app guide for the TradeGuard Forex toolkit. You ONLY answer questions about TradeGuard features. For anything else, say in the user's language: "I can only help with TradeGuard features."

Always respond in the SAME LANGUAGE the user writes in. Be concise — users are on mobile. Never invent features.

═══════════════════════════════════════
TAB 1 — RISK CALCULATOR
═══════════════════════════════════════
Purpose: Calculate exact lot size based on account balance and risk %.

HOW IT WORKS:
1. Enter account Balance (e.g. 79000)
2. Select Currency (USD, EUR, GBP, etc.)
3. Set Risk Mode: % (percentage of balance) or $ (fixed dollar amount)
4. Select Instrument — 60+ available: Forex pairs, commodities, crypto, indices, stocks. Live prices fetched automatically.
5. Enter Custom SL (stop loss distance in points/pips, e.g. 37)
6. App instantly shows: Lot Size, Dollar Risk, Pip Value

SL LADDER TABLE: Shows lot sizes for common SL distances (10-200 points) at current risk setting.

R:R TARGETS: Shows potential profit at 1:1, 1:1.5, 1:2, 1:3 ratios.

RESET button (↺ icon): Clears all fields back to defaults.

PRO FEATURE: Custom/exotic instruments beyond standard list require Pro.

═══════════════════════════════════════
TAB 2 — TRADE JOURNAL
═══════════════════════════════════════
Purpose: Log, track and analyze trades over time.

HOW TO ADD A TRADE:
- Tap the "+" button
- Choose mode:
  • QUICK MODE: log just Result (Win/Loss/BE) and P&L amount
  • ADVANCED MODE: full details — Pair, Direction (Long/Short), Entry, SL, TP, Lots, Risk, Result, R:R planned vs realized, Tags, Notes, Date

AUTO P&L: Enter risk amount → app calculates P&L (Win = +risk, Loss = -risk)

TAGS: Label trades with setups (A+ Setup), emotions (FOMO, Revenge), behaviors (Patient, Early Exit).

STATISTICS (shown at top): Total P&L, Win Rate, Average R:R, Top tag, Wins/Losses/BE count.

FILTERS: Filter by Win / Loss / BE / specific pair

EDIT: Tap any trade to edit
DELETE: Long-press or tap X button

EXPORT (Pro): Save all trades as JSON file
IMPORT (Pro): Restore trades from exported JSON

Trades are saved locally on the device.

═══════════════════════════════════════
TAB 3 — NEWS FEED
═══════════════════════════════════════
Purpose: Live Forex news from multiple sources.

3 SUB-TABS:
• BREAKING — Latest headlines under 2 hours old. Red LIVE badge = under 2h.
• HIGH IMPACT — Fed, ECB, central banks, rate decisions, GDP, employment.
• MARKET — General forex, crypto, indices, commodities news.

SOURCES: ForexLive and InvestingLive RSS feeds.
AUTO-REFRESH: Every 15 seconds while on News tab.
MANUAL REFRESH: Tap ↻ icon.
READ ARTICLE: Tap card → see summary → tap "Read more →" to open in browser.

═══════════════════════════════════════
TAB 4 — ECONOMIC CALENDAR
═══════════════════════════════════════
Purpose: High-impact economic events for major currencies only.

SHOWS: NFP, CPI, PPI, FOMC, rate decisions, GDP, unemployment, retail sales, PCE. No low-impact noise.
CURRENCIES: USD, EUR, GBP, JPY, AUD, CAD, NZD, CHF, NOK, SEK.

NEXT BANNER: Blue banner at top — next event with live countdown (updates every second).
TODAY: Events today highlighted in red.
PASSED: Shows "PASSED" badge. If results available → green "Results" badge → tap to see Actual, Forecast, Previous.
REMINDERS (🔔): Notifications 15 min and 5 min before event. Tap bell again to cancel.
EVENT DETAILS: Tap any event → see Actual (green), Forecast (blue), Previous (gray).

PRO FEATURE: Economic Calendar requires Pro or active Trial.

═══════════════════════════════════════
TAB 5 — COT REPORT (Commitment of Traders)
═══════════════════════════════════════
Purpose: Weekly CFTC data showing how the largest players are positioned.

WHO IS WHO:
- COMMERCIALS = banks, exporters, importers, institutions. Hedge real business. Position AHEAD of major moves. Almost always right at extremes. THIS IS SMART MONEY.
- NON-COMMERCIALS = hedge funds, CTAs. Trend followers. At extremes they are the crowd that gets squeezed.
- This app uses Commercial-first methodology (same as Larry Williams, Steve Briese, Floyd Upperman).

COMM INDEX (0-100):
- Where commercials sit vs their 3-year range.
- 0 = max short (bearish) | 100 = max long (bullish)
- BULLISH signal: COMM index >= 80
- BEARISH signal: COMM index <= 20
- NEUTRAL: 20-80

PRESSURE SCORE (0-100) — divergence between commercials and speculators:
- NEUTRAL (0-40): no COT edge
- BUILDING (40-60): divergence growing
- PRESSURIZED (60-80): significant divergence
- CRITICAL (80-100): extreme divergence, squeeze likely

FRESH vs STALE:
- FRESH: strong signal + commercials still adding (WoW positive)
- STALE: strong signal but positions stagnant or reversing

WoW (Week over Week): Change in commercial positions vs last week.

TREND OF POSITIONING:
- EXPANDING: WoW > +1.5% of open interest — actively building
- PEAKING: WoW within ±1.5% — slowing
- UNWINDING: WoW < -1.5% — reducing, reversal pressure

SIGNAL BADGES:
- ULTRA: 5Y extreme + expanding + macro aligned. Rarest, highest conviction.
- ELITE: 5Y confirmed extreme + actively expanding.
- STRUCTURAL: Confirmed by 3Y and 5Y range, not expanding yet.
- LOCAL: Only extreme in 3Y window — lower confidence.

BIAS SCORE (-100 to +100):
- STR BULLISH >= +50 | BULLISH +20 to +49 | WK BULLISH +5 to +19
- NEUTRAL -5 to +5
- WK BEARISH -5 to -19 | BEARISH -20 to -49 | STR BEARISH <= -50

TIER SYSTEM (Top Pairs):
- A+: High bias score + CRITICAL pressure + ALIGNED macro + EXPANDING trend
- A: Good bias score + CRITICAL or PRESSURIZED + not CONFLICT
- B: Moderate bias + pressure not NEUTRAL

TOP 5 PAIRS: Auto-detected pairs with largest COMM index divergence (>=40 points).
Shows: direction (LONG/SHORT), strength (STRONG/MODERATE/WEAK), macro alignment.

CROWD ACCELERATION SIGNAL:
- BUILDING: crowd entering trend at mid-range
- ACCELERATING: crowd at extreme AND adding more — squeeze risk high
- EXHAUSTING: crowd at extreme, momentum fading — peak warning
- UNWINDING: crowd exiting — highest reversal risk
Best setup: STR BULLISH Commercials + UNWINDING bearish crowd = classic squeeze.

HOW TO USE COT (step by step):
1. Check Macro Bias tab for directional context (hawkish/dovish per currency)
2. Check COT COMM Index and signal for that currency
3. When Macro + COT aligned → wait for price at a HTF key zone
4. Look for LTF confirmation entry
Highest conviction setup = CRITICAL + FRESH + EXPANDING + Macro aligned + key zone

RELEASE SCHEDULE: CFTC publishes every Friday 15:30 ET (21:30 UTC). App auto-refreshes.

MACRO BIAS (inside COT tab):
- HAWKISH: rate hikes, tightening → bullish for currency
- DOVISH: rate cuts, easing → bearish for currency
- NEUTRAL: on hold

═══════════════════════════════════════
SUBSCRIPTION
═══════════════════════════════════════
- FREE TRIAL: 14 days full access
- PRO: Full access to everything
- FREE (expired trial): Risk Calculator basic + Journal basic only
- AI Assistant: available during Trial and for Pro users

STRICT RULES:
1. ONLY answer about TradeGuard features described above. EXCEPTION: You CAN explain why a specific pair shows LONG or SHORT in the COT tab — explain the COT logic (COMM index, pressure score, macro alignment, badge, tier) as it applies to that pair. This is part of understanding the app's data.
2. Never give general trading advice, market predictions, or discuss other apps. Do NOT give entry/exit signals, price targets, or tell users when to open/close trades.
3. Always respond in the SAME LANGUAGE the user writes in. IMPORTANT: If the user writes in Serbian (srpski), use standard Serbian language (Serbia dialect) - NOT Bosnian or Croatian. Use words like "na primer" (not "primjerice"), "takođe" (not "također"), "račun" (not "računovodstvo"), "izaberi" (not "odaberi").
4. If asked something outside scope: say "I can only help with TradeGuard features. What would you like to know about the app?" in the user's language.
5. Never invent features not described above.
6. RESPONSE STYLE: Max 4-5 sentences total. No long paragraphs. Answer immediately without restating the question. Use numbered steps only for actions (max 5 steps). Be direct and brief - mobile screen is small.`

app.post('/api/ai-chat', async (req, res) => {
  try {
    if (!GROQ_KEY) return res.status(503).json({ error: 'AI not configured' });
    const { message, tab, history = [] } = req.body;
    if (!message || typeof message !== 'string' || message.trim().length === 0)
      return res.status(400).json({ error: 'message required' });
    if (message.trim().length > 500)
      return res.status(400).json({ error: 'message too long' });

    // Build messages array
    const messages = [{ role: 'system', content: TG_SYSTEM_PROMPT }];

    // Add history (last 6 messages max)
    const recentHistory = history.slice(-6);
    for (const msg of recentHistory) {
      if (msg.role === 'user') messages.push({ role: 'user', content: msg.content });
      else if (msg.role === 'assistant') messages.push({ role: 'assistant', content: msg.content });
    }

    // Add current message with tab context
    const userText = tab ? `[Context: user is currently viewing the ${tab} tab, but their question may be about any feature]\n${message.trim()}` : message.trim();
    messages.push({ role: 'user', content: userText });

    const groqRes = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: 'llama-3.1-8b-instant',
        messages,
        max_tokens: 400,
        temperature: 0.4,
      },
      {
        headers: { Authorization: `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' },
        timeout: 25000,
      }
    );

    const reply = groqRes.data?.choices?.[0]?.message?.content || 'Sorry, I could not generate a response.';
    res.json({ reply: reply.trim() });
  } catch (e) {
    console.error('AI chat error:', e.message);
    res.status(500).json({ error: 'AI service error', reply: 'Something went wrong. Please try again.' });
  }
});

// ── DELUKA JOURNAL AI CHAT ────────────────────────────────────────────────
const DELUKA_SYSTEM_PROMPT = `You are DeLuka Journal Assistant — an in-app AI coach exclusively for the DeLuka Trade Journal.

DeLuka Trade Journal is a professional Forex trading journal with these features:
- Dashboard: stats overview (total trades, win rate, avg R:R, best trade, checklist avg), win/loss donut chart, R:R distribution bar chart, recent performance line chart
- All Trades: full trade table with filters (All/Wins/Losses/B/E/Long/Short), sortable columns
- Calendar: monthly view showing trades per day color-coded (green=win, red=loss, yellow=B/E)
- Analytics: setup performance by win rate, emotion vs performance analysis, best/worst stats
- Equity Curve: cumulative P&L chart (R or $), drawdown underwater curve, stats (max drawdown, best/worst streak, profit factor), filters by period (30D/90D/6M/1Y/All)
- Duration Analysis: scatter plot (duration vs outcome), performance by duration bucket, distribution histogram
- Import: JSON backup merge, Broker CSV import (OTC/MT4/MT5 format)
- Export: JSON backup download

TRADE ENTRY FIELDS:
- Pair (e.g. EURUSD, XAUUSD), Date, Setup/Strategy
- Entry Time, Exit Time (auto-calculates duration)
- Direction: Long or Short
- Result: Win, Loss, B/E (breakeven)
- HTF Zone (Monthly/Weekly/Daily/4H/2H/1H), LTF Entry (Daily/4H/1H/30min/15min/5min/2min/1min)
- Entry price, Stop Loss, Take Profit (auto-calculates R:R ratio)
- Lots/Position Size
- P&L in $ (optional)
- Emotional State: Calm, Confident, Anxious, FOMO, Revenge, Neutral, Tired, Greedy
- HTF and LTF screenshot URLs
- MBT Checklist (12 items, scored 0-12):
  1. COT aligned with direction
  2. Strong move away from zone
  3. Min. 2 clear candles
  4. Imbalance min 2:1
  5. No 50% candle
  6. Momentum Line break
  7. Price removed opposing zone
  8. Min. 2 clear 1H candles
  9. 1H Imbalance min 2:1
  10. ML break OR opposing zone (1H)
  11. 1-4 Candle Rule met
  12. No high-impact news
- Notes: free text for trade review

MBT METHODOLOGY (Austin Moneyball):
- HTF zones (Supply & Demand): identify key areas on higher timeframes first
- LTF entry: wait for confirmation on lower timeframe before entering
- Imbalance 2:1: the move away from a zone must be at least twice the size of the base
- No 50% candle: none of the base candles should retrace more than 50% of the previous candle
- Momentum Line: a trendline connecting the swing points; a break confirms entry direction
- 1-4 Candle Rule: entry should come within 1-4 candles after the LTF confirmation signal
- COT alignment: commercial traders (smart money) should be positioned in the same direction as the trade

HOW TO USE THE JOURNAL:
- Click "+ NEW TRADE" to log a trade
- Fill in pair, date, direction, result (minimum required)
- Add entry/SL/TP for automatic R:R calculation
- Add entry and exit times for automatic duration calculation
- Go through MBT checklist to score your setup quality
- Use Analytics tab to find your best setups and worst emotional states
- Use Equity Curve to track overall account growth
- Export regularly as JSON backup
- Import broker CSV to auto-populate trades from MT4/MT5/OTC

STRICT RULES:
1. ONLY answer about DeLuka Journal features, how to use them, or MBT methodology as it applies to journaling
2. You CAN explain MBT checklist items and what they mean
3. You CAN explain what the stats and charts show and how to interpret them
4. You CAN give journaling advice (how to review trades, what patterns to look for)
5. Never give live trading signals, market predictions, or tell users when to open/close trades
6. Always respond in the SAME LANGUAGE the user writes in. If Serbian: use standard Serbian (Serbia dialect) — "na primer" not "primjerice", "takođe" not "također"
7. Be concise — max 4-5 sentences or 5 bullet points. Users are on desktop but keep it focused.
8. Never invent features not described above.`;

app.post('/api/journal-ai-chat', async (req, res) => {
  try {
    console.log('Journal AI hit, key present:', !!DELUKA_GROQ_KEY, 'key prefix:', DELUKA_GROQ_KEY ? DELUKA_GROQ_KEY.substring(0,8) : 'none');
    if (!DELUKA_GROQ_KEY) return res.status(503).json({ error: 'AI not configured' });
    const { message, page, history = [] } = req.body;
    if (!message || typeof message !== 'string' || message.trim().length === 0)
      return res.status(400).json({ error: 'message required' });
    if (message.trim().length > 500)
      return res.status(400).json({ error: 'message too long' });

    const messages = [{ role: 'system', content: DELUKA_SYSTEM_PROMPT }];
    const recentHistory = history.slice(-6);
    for (const msg of recentHistory) {
      if (msg.role === 'user') messages.push({ role: 'user', content: msg.content });
      else if (msg.role === 'assistant') messages.push({ role: 'assistant', content: msg.content });
    }
    const userText = page ? `[User is on the ${page} page]\n${message.trim()}` : message.trim();
    messages.push({ role: 'user', content: userText });

    const groqRes = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: 'llama-3.1-8b-instant',
        messages,
        max_tokens: 400,
        temperature: 0.4,
      },
      {
        headers: { Authorization: `Bearer ${DELUKA_GROQ_KEY}`, 'Content-Type': 'application/json' },
        timeout: 25000,
      }
    );

    const reply = groqRes.data?.choices?.[0]?.message?.content || 'Sorry, I could not generate a response.';
    res.json({ reply: reply.trim() });
  } catch (e) {
    console.error('DeLuka AI chat error:', e.message);
    res.status(500).json({ error: 'AI service error', reply: 'Something went wrong. Please try again.' });
  }
});

app.listen(PORT, () => console.log(`TradeGuard server running on port ${PORT}`));require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 3000;
const TD_KEY = process.env.TD_KEY;
const FINNHUB_KEY = process.env.FINNHUB_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;
const CRON_SECRET = process.env.CRON_SECRET || 'tg_cron_2026';
const GROQ_KEY = process.env.GROQ_API_KEY;
const DELUKA_GROQ_KEY = process.env.DELUKA_GROQ_KEY;

app.use(cors({
  origin: [
    'https://luka1233-cpu.github.io',
    'http://localhost',
    'http://127.0.0.1',
    /\.github\.io$/,
    /localhost/,
  ],
  credentials: true,
}));
app.use(express.json());

const sb = {
  async query(path, opts = {}) {
    const r = await axios({
      method: opts.method || 'GET',
      url: `${SUPABASE_URL}/rest/v1/${path}`,
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: opts.prefer || '' },
      data: opts.body, params: opts.params, timeout: 10000,
    });
    return r.data;
  },
  async insert(table, rows) { return this.query(table, { method: 'POST', body: rows, prefer: 'return=representation' }); },
  async select(table, params) { return this.query(table, { params }); },
  async update(table, params, body) { return this.query(table, { method: 'PATCH', params, body, prefer: 'return=representation' }); },
  async upsert(table, rows, onConflict) { return this.query(table, { method: 'POST', body: rows, prefer: `resolution=merge-duplicates,return=representation`, params: { on_conflict: onConflict } }); },
};

app.get('/', (req, res) => { res.json({ status: 'TradeGuard API running' }); });

const MACRO_STANCE = {
  USD: { bias: 'neutral', note: 'Higher for longer, cuts priced but not imminent', shift: null, lastUpdate: '2026-06-01' },
  EUR: { bias: 'dovish', note: 'ECB cutting cycle underway', shift: 'hawkish_to_dovish', lastUpdate: '2026-06-01' },
  GBP: { bias: 'dovish', note: 'BoE on hold, watching inflation', shift: null, lastUpdate: '2026-06-01' },
  JPY: { bias: 'hawkish', note: 'BoJ normalizing, rate hikes expected', shift: 'dovish_to_hawkish', lastUpdate: '2026-06-01' },
  AUD: { bias: 'dovish', note: 'Dovish tilt, cuts expected but not fully underway', shift: 'neutral_to_dovish', lastUpdate: '2026-06-01' },
  NZD: { bias: 'dovish', note: 'RBNZ aggressive cutting cycle', shift: 'hawkish_to_dovish', lastUpdate: '2026-06-01' },
  CAD: { bias: 'dovish', note: 'BoC cutting, growth concerns', shift: 'neutral_to_dovish', lastUpdate: '2026-06-01' },
  CHF: { bias: 'dovish', note: 'SNB cutting, low inflation', shift: 'neutral_to_dovish', lastUpdate: '2026-06-01' },
};

app.get('/macro', (req, res) => { res.json({ result: MACRO_STANCE }); });

app.get('/health', async (req, res) => {
  try { await sb.select('cot_snapshots', { select: 'id', limit: 1 }); } catch (_) {}
  res.json({ status: 'ok' });
});

app.get('/price', async (req, res) => {
  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: 'symbol required' });
  try {
    const r = await axios.get(`https://api.twelvedata.com/price?symbol=${symbol}&apikey=${TD_KEY}`);
    res.json(r.data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const MAJOR_COUNTRIES = ['US','EU','GB','JP','AU','CA','NZ','CH','DE','FR','IE','IT','ES','PT','NL','BE','AT','FI','GR'];
const HIGH_IMPACT_KW = ['non farm payroll','nonfarm payroll','nfp','consumer price index','cpi','producer price index','ppi','fomc','federal open market','interest rate decision','rate decision','rate statement','gdp growth rate','gross domestic product','pce price','core pce','ism manufacturing pmi','ism services pmi','initial jobless claims','rba interest','boe interest','ecb interest','boj interest','rbnz interest','fed funds','cash rate','unemployment rate','inflation rate','retail sales','jolts job openings','jolts','adp employment','adp nonfarm','cb consumer confidence','consumer confidence','michigan consumer sentiment','consumer sentiment'];
const NOISE_KW = ['baden','bavaria','brandenburg','hesse','saxony','thuringia','north rhine','rhineland','westphalia','palatinate','saarland','hamburg','bremen','berlin','schleswig','mecklenburg','lower saxony','brc ','dmp ','u-6 ','private non farm','flash estimate','prelim estimate','2nd est','3rd est','final est','qoq final','yoy final','harmonised','prel','prelim'];
const isNoise = n => NOISE_KW.some(k => (n||'').toLowerCase().includes(k));
const isHighImpact = (e,c) => MAJOR_COUNTRIES.includes(c) && HIGH_IMPACT_KW.some(k => (e||'').toLowerCase().includes(k)) && !isNoise(e);

app.get('/calendar', async (req, res) => {
  const { start_date, end_date } = req.query;
  if (!start_date || !end_date) return res.status(400).json({ error: 'start_date and end_date required' });
  try {
    const FMP_KEY = process.env.FMP_KEY;
    const url = `https://financialmodelingprep.com/stable/economic-calendar?from=${start_date}&to=${end_date}&apikey=${FMP_KEY}`;
    const r = await axios.get(url, { timeout: 10000 });
    const raw = Array.isArray(r.data) ? r.data : [];
    const HIGH_IMPACT_EVENTS = ['non farm payroll','nonfarm payroll','nfp','consumer price index','cpi','producer price index','ppi','fomc','federal open market','interest rate decision','rate decision','rate statement','gdp growth rate','gross domestic product','pce price','core pce','ism manufacturing','ism services','initial jobless claims','rba interest','rba cash rate','cash rate','boe interest','bank of england','ecb interest','ecb rate','boj interest','bank of japan','rbnz interest','rbnz rate','fed funds','unemployment rate','inflation rate','retail sales','jolts','adp employment','adp nonfarm','consumer confidence','michigan consumer sentiment','norges bank','riksbank','snb interest','snb rate','bank of canada','boc rate'];
    const MAJOR_CCY_COUNTRIES = ['US','EU','GB','JP','AU','CA','NZ','CH','DE','FR','NO','SE'];
    const events = raw
      .filter(e => {
        const name = (e.event || '').toLowerCase();
        const country = (e.country || '').toUpperCase();
        const impact = (e.impact || '').toLowerCase();
        const isHigh = impact === 'high' || HIGH_IMPACT_EVENTS.some(k => name.includes(k));
        const isMajor = MAJOR_CCY_COUNTRIES.includes(country);
        return isHigh && isMajor;
      })
      .map(e => ({
        event: e.event, country: e.country,
        date: e.date ? e.date.split(' ')[0] : '',
        time: e.date ? (e.date.split(' ')[1] || '') : '',
        importance: 'high',
        forecast: e.estimate != null ? String(e.estimate) : null,
        previous: e.previous != null ? String(e.previous) : null,
        actual: e.actual != null ? String(e.actual) : null,
      }));
    res.json({ result: events });
  } catch (e) {
    console.error('Calendar error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

const COT_MARKETS = {
  'EUR': 'EURO FX - CHICAGO MERCANTILE EXCHANGE',
  'GBP': 'BRITISH POUND - CHICAGO MERCANTILE EXCHANGE',
  'JPY': 'JAPANESE YEN - CHICAGO MERCANTILE EXCHANGE',
  'CAD': 'CANADIAN DOLLAR - CHICAGO MERCANTILE EXCHANGE',
  'AUD': 'AUSTRALIAN DOLLAR - CHICAGO MERCANTILE EXCHANGE',
  'NZD': 'NZ DOLLAR - CHICAGO MERCANTILE EXCHANGE',
  'CHF': 'SWISS FRANC - CHICAGO MERCANTILE EXCHANGE',
  'USD': 'USD INDEX - ICE FUTURES U.S.',
};

let cotCache = null, cotCacheTime = null, cotTopPairsCache = null;
const COT_CACHE_MS = 6 * 60 * 60 * 1000;

function getLastCftcReleaseTime() {
  const now = new Date();
  const d = now.getUTCDay(), h = now.getUTCHours();
  const back = d===5&&h>=21 ? 0 : d===5 ? 7 : d===6 ? 1 : d===0 ? 2 : d+2;
  const r = new Date(now);
  r.setUTCDate(now.getUTCDate() - back);
  r.setUTCHours(21,0,0,0);
  return r.getTime();
}

let historicalRanges = null, historicalRangesTime = null;
const HIST_CACHE_MS = 24*60*60*1000;

async function fetchHistoricalRanges() {
  if (historicalRanges && historicalRangesTime && (Date.now()-historicalRangesTime) < HIST_CACHE_MS) return historicalRanges;
  try {
    const url = `https://publicreporting.cftc.gov/resource/6dca-aqww.json?$order=report_date_as_yyyy_mm_dd DESC&$limit=2000`;
    const response = await axios.get(url, { timeout: 60000, headers: { 'Accept': 'application/json' } });
    const allRows = response.data || [];
    const threeYearsAgo = new Date(); threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3);
    const fiveYearsAgo  = new Date(); fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - 5);
    const ranges = {};
    Object.entries(COT_MARKETS).forEach(([currency, marketName]) => {
      const rows3y = allRows.filter(r => { const d = new Date(r.report_date_as_yyyy_mm_dd); return d >= threeYearsAgo && r.market_and_exchange_names && r.market_and_exchange_names.toUpperCase() === marketName.toUpperCase(); });
      const rows5y = allRows.filter(r => { const d = new Date(r.report_date_as_yyyy_mm_dd); return d >= fiveYearsAgo  && r.market_and_exchange_names && r.market_and_exchange_names.toUpperCase() === marketName.toUpperCase(); });
      if (rows3y.length === 0) return;
      const commNets3y = rows3y.map(r => (parseInt(r.comm_positions_long_all)||0) - (parseInt(r.comm_positions_short_all)||0));
      const specNets3y = rows3y.map(r => (parseInt(r.noncomm_positions_long_all)||0) - (parseInt(r.noncomm_positions_short_all)||0));
      const recentSpecWows = rows3y.slice(0,8).map(r => ((parseInt(r.change_in_noncomm_long_all)||0) - (parseInt(r.change_in_noncomm_short_all)||0)));
      const commNets5y = rows5y.length > 0 ? rows5y.map(r => (parseInt(r.comm_positions_long_all)||0) - (parseInt(r.comm_positions_short_all)||0)) : commNets3y;
      const specNets5y = rows5y.length > 0 ? rows5y.map(r => (parseInt(r.noncomm_positions_long_all)||0) - (parseInt(r.noncomm_positions_short_all)||0)) : specNets3y;
      ranges[currency] = {
        min: Math.min(...commNets3y), max: Math.max(...commNets3y), count: rows3y.length,
        spec_min: Math.min(...specNets3y), spec_max: Math.max(...specNets3y), recent_spec_wows: recentSpecWows,
        min_5y: Math.min(...commNets5y), max_5y: Math.max(...commNets5y), count_5y: rows5y.length,
        spec_min_5y: Math.min(...specNets5y), spec_max_5y: Math.max(...specNets5y),
      };
    });
    historicalRanges = ranges; historicalRangesTime = Date.now();
    return ranges;
  } catch (e) { console.error('Historical fetch error:', e.message); return {}; }
}

async function fetchCotData() {
  const url = `https://publicreporting.cftc.gov/resource/6dca-aqww.json?$order=report_date_as_yyyy_mm_dd DESC&$limit=500`;
  const r = await axios.get(url, { timeout: 15000, headers: { 'Accept': 'application/json' } });
  const allRows = r.data || [];
  if (allRows.length === 0) return [];
  const latestDate = allRows[0].report_date_as_yyyy_mm_dd;
  return allRows.filter(r => r.report_date_as_yyyy_mm_dd === latestDate);
}

function calcCommIndex(commNet, ranges, currency) {
  if (!ranges?.[currency]) return 50;
  const { min, max } = ranges[currency];
  if (max === min) return 50;
  return Math.round(((commNet - min) / (max - min)) * 100);
}

function calcCommIndex5y(commNet, ranges, currency) {
  if (!ranges?.[currency]) return 50;
  const { min_5y, max_5y } = ranges[currency];
  if (max_5y === undefined || max_5y === min_5y) return 50;
  return Math.round(((commNet - min_5y) / (max_5y - min_5y)) * 100);
}

function getExtremeLabel(commIndex3y, commIndex5y, trendState) {
  const extreme3y = commIndex3y >= 80 || commIndex3y <= 20;
  const extreme5y = commIndex5y >= 85 || commIndex5y <= 15;
  const sameSide  = (commIndex3y >= 80 && commIndex5y >= 85) || (commIndex3y <= 20 && commIndex5y <= 15);
  const expanding = trendState === 'EXPANDING';
  if (!extreme3y) return null;
  if (extreme5y && sameSide && expanding) return 'ELITE';
  if (extreme5y && sameSide) return 'STRUCTURAL_EXTREME';
  return 'LOCAL_EXTREME';
}

function calcSpecIndex(specNet, ranges, currency) {
  if (!ranges?.[currency]) return 50;
  const { spec_min, spec_max } = ranges[currency];
  if (spec_max === spec_min) return 50;
  return Math.round(((specNet - spec_min) / (spec_max - spec_min)) * 100);
}

function getCrowdSignal(specIndex, specWow, oi) {
  const specWowPct = oi > 0 ? specWow / oi : 0;
  const crowdBullish = specIndex >= 50;
  const crowdDir = crowdBullish ? 'bullish crowd' : 'bearish crowd';
  const crowdExtreme = specIndex >= 70 || specIndex <= 30;
  const wowReinforcing = (crowdBullish && specWowPct > 0.005) || (!crowdBullish && specWowPct < -0.005);
  const wowFading     = (crowdBullish && specWowPct < -0.005) || (!crowdBullish && specWowPct > 0.005);
  let state;
  if (!crowdExtreme && wowReinforcing)                    state = 'BUILDING';
  else if (crowdExtreme && wowReinforcing)                state = 'ACCELERATING';
  else if (crowdExtreme && !wowFading && !wowReinforcing) state = 'EXHAUSTING';
  else if (crowdExtreme && wowFading)                     state = 'UNWINDING';
  else return null;
  return { state, crowdDir };
}

function calcPressureScore(cL, cS, sL, sS, oi) {
  if (!oi) return 50;
  return Math.min(100, Math.round(Math.abs(((cL-cS)/oi - (sL-sS)/oi)) * 200));
}

function getPressureLabel(s) { return s>=80 ? 'CRITICAL' : s>=60 ? 'PRESSURIZED' : s>=40 ? 'BUILDING' : 'NEUTRAL'; }

function calcBiasScore(pressureScore, commIndex, commNet, specNet, specWow, oi) {
  const commDirection = (commIndex - 50) / 50;
  const commStrength = Math.abs(commIndex - 50) / 50;
  let b = pressureScore * commDirection * commStrength;
  const specStrength = Math.min(1, (oi > 0 ? Math.abs(specNet)/oi : 0) * 5);
  if ((commNet > 0) !== (specNet > 0)) {
    b *= (1 + specStrength * 0.5);
    if (specWow < 0 && commNet > 0) b *= 1.1;
    if (specWow > 0 && commNet < 0) b *= 1.1;
  } else { b *= 0.5; }
  return Math.max(-100, Math.min(100, Math.round(b)));
}

function getBiasLabel(s) { return s>=50 ? 'STR BULLISH' : s>=20 ? 'BULLISH' : s>=5 ? 'WK BULLISH' : s<=-50 ? 'STR BEARISH' : s<=-20 ? 'BEARISH' : s<=-5 ? 'WK BEARISH' : 'NEUTRAL'; }
function getSignal(i) { return i<=20 ? 'BEARISH' : i>=80 ? 'BULLISH' : 'NEUTRAL'; }
function getFreshness(i, w) { if (i>=80 || i<=20) return (i>=80 ? w>=5000 : w<=-5000) ? 'FRESH' : 'STALE'; return 'NEUTRAL'; }

async function buildCotResult() {
  const [rows, ranges] = await Promise.all([fetchCotData(), fetchHistoricalRanges()]);
  const result = {};
  Object.entries(COT_MARKETS).forEach(([currency, marketName]) => {
    const row = rows.find(r => r.market_and_exchange_names && (
      r.market_and_exchange_names.toUpperCase() === marketName.toUpperCase() ||
      (currency==='NZD' && r.market_and_exchange_names.toUpperCase().includes('NZ DOLLAR'))
    ));
    if (!row) { result[currency] = { currency, error: 'no data' }; return; }
    const cL = parseInt(row.comm_positions_long_all)||0, cS = parseInt(row.comm_positions_short_all)||0;
    const sL = parseInt(row.noncomm_positions_long_all)||0, sS = parseInt(row.noncomm_positions_short_all)||0;
    const oi = parseInt(row.open_interest_all)||0;
    const commNet = cL - cS, specNet = sL - sS;
    const commWoW = (parseInt(row.change_in_comm_long_all)||0) - (parseInt(row.change_in_comm_short_all)||0);
    const specWoW = (parseInt(row.change_in_noncomm_long_all)||0) - (parseInt(row.change_in_noncomm_short_all)||0);
    const commIndex   = calcCommIndex(commNet, ranges, currency);
    const commIndex5y = calcCommIndex5y(commNet, ranges, currency);
    const specIndex   = calcSpecIndex(specNet, ranges, currency);
    const pressure    = calcPressureScore(cL,cS,sL,sS,oi);
    const biasScore   = calcBiasScore(pressure, Math.round(commIndex), commNet, specNet, specWoW, oi);
    const crowdSignal = getCrowdSignal(specIndex, specWoW, oi);
    const wowPct = oi > 0 ? commWoW / oi : 0;
    const trendState = wowPct > 0.015 ? 'EXPANDING' : wowPct < -0.015 ? 'UNWINDING' : 'PEAKING';
    const extremeLabel = getExtremeLabel(Math.round(commIndex), Math.round(commIndex5y), trendState);
    result[currency] = {
      currency, report_date: row.report_date_as_yyyy_mm_dd,
      comm_long: cL, comm_short: cS, comm_net: commNet, comm_wow: commWoW,
      spec_long: sL, spec_short: sS, spec_net: specNet, spec_wow: specWoW,
      open_interest: oi,
      comm_index: Math.round(commIndex), comm_index_5y: Math.round(commIndex5y),
      spec_index: Math.round(specIndex),
      extreme_label: extremeLabel,
      pressure_score: pressure, pressure_label: getPressureLabel(pressure),
      signal: getSignal(commIndex), freshness: getFreshness(Math.round(commIndex), commWoW),
      bias_score: biasScore, bias_label: getBiasLabel(biasScore),
      trend_state: trendState,
      crowd_state: crowdSignal ? crowdSignal.state : null,
      crowd_dir:   crowdSignal ? crowdSignal.crowdDir : null,
    };
  });
  return result;
}

app.get('/cot', async (req, res) => {
  try {
    const now = Date.now();
    const cacheIsStale = cotCacheTime && cotCacheTime < getLastCftcReleaseTime();
    if (cotCache && cotCacheTime && (now-cotCacheTime) < COT_CACHE_MS && !cacheIsStale)
      return res.json({ result: cotCache, top_pairs: cotTopPairsCache||[], cached: true });
    const result = await buildCotResult();
    const REAL_FOREX_PAIRS = ['EUR/USD','GBP/USD','AUD/USD','NZD/USD','USD/JPY','USD/CAD','USD/CHF','EUR/GBP','EUR/JPY','EUR/CAD','EUR/CHF','EUR/AUD','EUR/NZD','GBP/JPY','GBP/CAD','GBP/CHF','GBP/AUD','GBP/NZD','AUD/JPY','AUD/CAD','AUD/CHF','AUD/NZD','NZD/JPY','NZD/CAD','NZD/CHF','CAD/JPY','CAD/CHF','CHF/JPY'];
    const pairs = [];
    for (const pairName of REAL_FOREX_PAIRS) {
      const [base, quote] = pairName.split('/');
      const bd = result[base], qd = result[quote];
      if (!bd||!qd||bd.comm_index===undefined||qd.comm_index===undefined) continue;
      const spread = bd.comm_index - qd.comm_index;
      const absSpread = Math.abs(spread);
      if (absSpread < 40) continue;
      const isLong = spread > 0;
      const lc = isLong ? base : quote, sc = isLong ? quote : base;
      const lb = MACRO_STANCE[lc]?.bias||'neutral', sb = MACRO_STANCE[sc]?.bias||'neutral';
      const aligned = lb==='hawkish' && sb==='dovish';
      const opposite = lb==='dovish' && sb==='hawkish';
      const avgP = ((result[lc]?.pressure_score||0) + (result[sc]?.pressure_score||0)) / 2;
      if (opposite && avgP < 60) continue;
      let score = absSpread;
      if (aligned) score *= 1.25; else if (opposite) score *= 0.6;
      const ltp = (result[lc]?.comm_wow||0) / (result[lc]?.open_interest||1);
      const stp = (result[sc]?.comm_wow||0) / (result[sc]?.open_interest||1);
      if (ltp > 0.015 || stp < -0.015) score *= 1.2;
      if (ltp < -0.015 || stp > 0.015) score *= 0.7;
      if (result[lc]?.extreme_label === 'ELITE' || result[lc]?.extreme_label === 'STRUCTURAL_EXTREME') score *= 1.15;
      if (result[lc]?.extreme_label === 'ELITE' && aligned) score *= 1.1;
      const longD = result[lc];
      const dominantBiasScore = isLong ? bd.bias_score : -qd.bias_score;
      const avgPressure2 = Math.round((bd.pressure_score + qd.pressure_score) / 2);
      const avgPressureLabel2 = getPressureLabel(avgPressure2);
      const trendState2 = longD?.trend_state || 'PEAKING';
      const extremeLabel2 = longD?.extreme_label || null;
      const macroAlignment2 = aligned ? 'ALIGNED' : opposite ? 'CONFLICT' : 'NEUTRAL';
      const tier = calcTier(dominantBiasScore, avgPressureLabel2, macroAlignment2, trendState2, extremeLabel2);
      const isUltra = extremeLabel2 === 'ELITE' && aligned;
      const badge = isUltra ? 'ULTRA' : extremeLabel2 === 'ELITE' ? 'ELITE' : extremeLabel2 === 'STRUCTURAL_EXTREME' ? 'STRUCTURAL' : extremeLabel2 === 'LOCAL_EXTREME' ? 'LOCAL' : null;
      pairs.push({
        pair: pairName, direction: isLong ? `Long ${pairName}` : `Short ${pairName}`,
        bias: isLong ? 'LONG' : 'SHORT', spread: Math.round(absSpread), score: Math.round(score),
        long_ccy: lc, short_ccy: sc,
        long_index: isLong ? bd.comm_index : qd.comm_index,
        short_index: isLong ? qd.comm_index : bd.comm_index,
        long_signal: isLong ? bd.signal : qd.signal,
        short_signal: isLong ? qd.signal : bd.signal,
        long_bias: lb, short_bias: sb,
        macro_alignment: macroAlignment2,
        strength: absSpread>=70 ? 'STRONG' : absSpread>=55 ? 'MODERATE' : 'WEAK',
        long_extreme: isLong ? bd.extreme_label : qd.extreme_label,
        short_extreme: isLong ? qd.extreme_label : bd.extreme_label,
        ultra: isUltra,
        long_index_5y: isLong ? bd.comm_index_5y : qd.comm_index_5y,
        short_index_5y: isLong ? qd.comm_index_5y : bd.comm_index_5y,
        tier, badge,
      });
    }
    pairs.sort((a,b) => b.score - a.score);
    cotCache = result; cotTopPairsCache = pairs.slice(0,5); cotCacheTime = now;
    res.json({ result, top_pairs: pairs.slice(0,5), cached: false });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/cot-debug', async (req, res) => {
  try {
    const url = `https://publicreporting.cftc.gov/resource/6dca-aqww.json?$order=report_date_as_yyyy_mm_dd DESC&$limit=500`;
    const r = await axios.get(url, { timeout: 15000, headers: { 'Accept': 'application/json' } });
    const rows = r.data||[];
    const latestDate = rows[0]?.report_date_as_yyyy_mm_dd;
    const latestRows = rows.filter(r => r.report_date_as_yyyy_mm_dd === latestDate);
    const keys = ['EURO FX','BRITISH POUND','JAPANESE YEN','CANADIAN DOLLAR','AUSTRALIAN DOLLAR','NEW ZEALAND','NZ DOLLAR','SWISS FRANC','USD INDEX'];
    const forexRows = latestRows.filter(r => keys.some(k => (r.market_and_exchange_names||'').toUpperCase().includes(k)));
    res.json({ latestDate, totalLatest: latestRows.length, forexCount: forexRows.length,
      forex: forexRows.map(r => ({ name: r.market_and_exchange_names, date: r.report_date_as_yyyy_mm_dd, comm_long: r.comm_positions_long_all, comm_short: r.comm_positions_short_all })) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

function calcTier(biasScore, pressureLabel, macroAlignment, trendState, extremeLabel) {
  const absScore = Math.abs(biasScore);
  if (absScore > 70 && pressureLabel === 'CRITICAL' && macroAlignment === 'ALIGNED' && trendState === 'EXPANDING') return 'A+';
  if (absScore > 55 && (pressureLabel === 'CRITICAL' || pressureLabel === 'PRESSURIZED') && macroAlignment !== 'CONFLICT') return 'A';
  if (absScore > 40 && pressureLabel !== 'NEUTRAL') return 'B';
  return null;
}

function tdSymbol(pair) { return pair.replace('/', ''); }

async function fetchDailyOHLC(pair, outputSize = 30) {
  const sym = tdSymbol(pair);
  const url = `https://api.twelvedata.com/time_series?symbol=${sym}&interval=1day&outputsize=${outputSize}&apikey=${TD_KEY}`;
  const r = await axios.get(url, { timeout: 10000 });
  if (r.data.status === 'error') throw new Error(r.data.message);
  return r.data.values || [];
}

function evaluateSnapshot(snap, ohlcRows) {
  if (!ohlcRows || ohlcRows.length === 0) return null;
  const entry = parseFloat(snap.entry_price);
  if (!entry) return null;
  const isLong = snap.direction === 'LONG';
  const pipSize = snap.pair.includes('JPY') ? 0.01 : 0.0001;
  let maxMFE = 0, maxMAE = 0, timeMFEday = 0;
  ohlcRows.forEach((row, idx) => {
    const high = parseFloat(row.high), low = parseFloat(row.low);
    const mfe = isLong ? (high - entry) / pipSize : (entry - low) / pipSize;
    const mae = isLong ? (entry - low) / pipSize  : (high - entry) / pipSize;
    if (mfe > maxMFE) { maxMFE = mfe; timeMFEday = idx + 1; }
    if (mae > maxMAE)   maxMAE = mae;
  });
  const strengthRatio = maxMAE > 0 ? parseFloat((maxMFE / maxMAE).toFixed(2)) : null;
  const mfeThreshold = snap.pair.includes('JPY') ? 80 : 50;
  const directionCorrect = maxMFE >= mfeThreshold;
  const strongSignal = strengthRatio !== null && strengthRatio >= 1.5;
  return {
    mfe_pips: Math.round(maxMFE), mae_pips: Math.round(maxMAE),
    time_to_mfe_days: timeMFEday, strength_ratio: strengthRatio,
    direction_correct: directionCorrect, strong_signal: strongSignal,
    days_tracked: ohlcRows.length,
  };
}

function buildTierStats(snaps) {
  const tiers = ['A+', 'A', 'B'];
  const result = {};
  for (const tier of tiers) {
    const t = snaps.filter(s => s.tier === tier);
    const withDir  = t.filter(s => s.direction_correct !== null && s.direction_correct !== undefined);
    const withMFE  = t.filter(s => s.mfe_pips != null && s.mae_pips != null);
    const wins     = t.filter(s => s.result === 'WIN').length;
    const losses   = t.filter(s => s.result === 'LOSS').length;
    const dirCorrect = withDir.filter(s => s.direction_correct === true).length;
    const avgMFE   = withMFE.length ? Math.round(withMFE.reduce((a, s) => a + (s.mfe_pips||0), 0) / withMFE.length) : null;
    const avgMAE   = withMFE.length ? Math.round(withMFE.reduce((a, s) => a + (s.mae_pips||0), 0) / withMFE.length) : null;
    const avgRatio = withMFE.length ? parseFloat((withMFE.reduce((a, s) => a + (s.strength_ratio||0), 0) / withMFE.length).toFixed(2)) : null;
    result[tier] = {
      total: t.length, wins,
      winrate: t.length ? parseFloat((wins / t.length).toFixed(4)) : 0,
      effective_win_rate: (wins + losses) > 0 ? parseFloat((wins / (wins + losses)).toFixed(4)) : null,
      follow_through_rate: t.length ? parseFloat((wins / t.length).toFixed(4)) : 0,
      losses, flats: t.length - wins - losses,
      direction_accuracy: withDir.length ? parseFloat((dirCorrect / withDir.length).toFixed(4)) : null,
      avg_mfe_pips: avgMFE, avg_mae_pips: avgMAE, avg_strength_ratio: avgRatio,
      sample_ok: t.length >= 10,
    };
  }
  return result;
}

function buildAlignmentStats(snaps) {
  const alignments = ['ALIGNED', 'NEUTRAL', 'CONFLICT'];
  const result = {};
  for (const align of alignments) {
    const t = snaps.filter(s => s.macro_alignment === align);
    const wins = t.filter(s => s.result === 'WIN').length;
    const withDir = t.filter(s => s.direction_correct !== null && s.direction_correct !== undefined);
    const dirCorrect = withDir.filter(s => s.direction_correct === true).length;
    const losses_a = t.filter(s => s.result === 'LOSS').length;
    result[align] = {
      total: t.length, wins, losses: losses_a, flats: t.length - wins - losses_a,
      winrate: t.length ? parseFloat((wins / t.length).toFixed(4)) : 0,
      effective_win_rate: (wins + losses_a) > 0 ? parseFloat((wins / (wins + losses_a)).toFixed(4)) : null,
      follow_through_rate: t.length ? parseFloat((wins / t.length).toFixed(4)) : 0,
      direction_accuracy: withDir.length ? parseFloat((dirCorrect / withDir.length).toFixed(4)) : null,
    };
  }
  return result;
}

function buildCurrencyStats(snaps) {
  const ccyMap = {};
  for (const s of snaps) {
    for (const ccy of [s.long_ccy, s.short_ccy]) {
      if (!ccy) continue;
      if (!ccyMap[ccy]) ccyMap[ccy] = { total: 0, wins: 0, dir_total: 0, dir_correct: 0, mfe_sum: 0, mfe_count: 0 };
      ccyMap[ccy].total++;
      if (s.result === 'WIN') ccyMap[ccy].wins++;
      if (s.direction_correct !== null && s.direction_correct !== undefined) {
        ccyMap[ccy].dir_total++;
        if (s.direction_correct) ccyMap[ccy].dir_correct++;
      }
      if (s.mfe_pips != null) { ccyMap[ccy].mfe_sum += s.mfe_pips; ccyMap[ccy].mfe_count++; }
    }
  }
  const result = {};
  for (const [ccy, d] of Object.entries(ccyMap)) {
    if (d.total < 3) continue;
    result[ccy] = {
      total: d.total, wins: d.wins,
      winrate: parseFloat((d.wins / d.total).toFixed(4)),
      direction_accuracy: d.dir_total ? parseFloat((d.dir_correct / d.dir_total).toFixed(4)) : null,
      avg_mfe_pips: d.mfe_count ? Math.round(d.mfe_sum / d.mfe_count) : null,
    };
  }
  return result;
}

app.get('/analytics', async (req, res) => {
  try {
    const snaps = await sb.select('cot_snapshots', {
      is_complete: 'eq.true',
      select: 'tier,result,macro_alignment,long_ccy,short_ccy,direction_correct,mfe_pips,mae_pips,strength_ratio,holding_days',
      order: 'created_at.desc', limit: 500,
    });
    if (!snaps || snaps.length === 0) return res.json({ total_complete: 0, message: 'No completed snapshots yet' });
    const byTier = buildTierStats(snaps);
    const byAlignment = buildAlignmentStats(snaps);
    const byCurrency = buildCurrencyStats(snaps);
    const wins = snaps.filter(s => s.result === 'WIN').length;
    const losses = snaps.filter(s => s.result === 'LOSS').length;
    const flats = snaps.filter(s => s.result === 'FLAT').length;
    const withDir = snaps.filter(s => s.direction_correct !== null && s.direction_correct !== undefined);
    const dirCorrect = withDir.filter(s => s.direction_correct === true).length;
    const withHolding = snaps.filter(s => s.holding_days != null);
    const withMFE = snaps.filter(s => s.mfe_pips != null && s.mae_pips != null);
    res.json({
      total_complete: snaps.length,
      overall_winrate: parseFloat((wins / snaps.length).toFixed(4)),
      effective_win_rate: (wins + losses) > 0 ? parseFloat((wins / (wins + losses)).toFixed(4)) : null,
      follow_through_rate: parseFloat((wins / snaps.length).toFixed(4)),
      wins, losses, flats,
      overall_direction_accuracy: withDir.length ? parseFloat((dirCorrect / withDir.length).toFixed(4)) : null,
      avg_holding_days: withHolding.length ? parseFloat((withHolding.reduce((a, s) => a + s.holding_days, 0) / withHolding.length).toFixed(1)) : null,
      avg_mfe_pips: withMFE.length ? Math.round(withMFE.reduce((a, s) => a + s.mfe_pips, 0) / withMFE.length) : null,
      avg_mae_pips: withMFE.length ? Math.round(withMFE.reduce((a, s) => a + s.mae_pips, 0) / withMFE.length) : null,
      avg_strength_ratio: withMFE.length ? parseFloat((withMFE.reduce((a, s) => a + (s.strength_ratio||0), 0) / withMFE.length).toFixed(2)) : null,
      best_tier: ['A+','A','B'].filter(t => byTier[t].total >= 5).sort((a,b) => byTier[b].winrate - byTier[a].winrate)[0] || null,
      best_currency: Object.entries(byCurrency).filter(([,d]) => d.total >= 5).sort((a,b) => b[1].winrate - a[1].winrate)[0]?.[0] || null,
      winrate_by_tier: byTier,
      direction_accuracy_by_tier: Object.fromEntries(Object.entries(byTier).map(([t,d]) => [t, d.direction_accuracy])),
      avg_mfe_mae_by_tier: Object.fromEntries(Object.entries(byTier).map(([t,d]) => [t, { avg_mfe_pips: d.avg_mfe_pips, avg_mae_pips: d.avg_mae_pips, avg_strength_ratio: d.avg_strength_ratio }])),
      winrate_by_alignment: byAlignment,
      winrate_by_currency: byCurrency,
    });
  } catch (e) { console.error('Analytics error:', e.message); res.status(500).json({ error: e.message }); }
});

app.post('/performance/ohlc-update', async (req, res) => {
  if (req.headers['x-cron-secret'] !== CRON_SECRET) return res.status(401).json({ error: 'unauthorized' });
  try {
    const openSnaps = await sb.select('cot_snapshots', { is_complete: 'eq.false', select: 'id,pair,direction,entry_price,created_at' });
    if (openSnaps.length === 0) return res.json({ updated: 0, message: 'No active snapshots' });
    const today = new Date().toISOString().split('T')[0];
    let updated = 0, skipped = 0, errors = 0, entryFetched = 0;
    for (const snap of openSnaps) {
      try {
        if (!snap.entry_price) {
          try {
            const priceRes = await axios.get(`https://api.twelvedata.com/price?symbol=${snap.pair.replace('/','')}&apikey=${TD_KEY}`, { timeout: 5000 });
            const price = parseFloat(priceRes.data?.price) || null;
            if (price) { await sb.update('cot_snapshots', { id: `eq.${snap.id}` }, { entry_price: price }); snap.entry_price = price; entryFetched++; }
          } catch (_) {}
          await new Promise(r => setTimeout(r, 8000));
        }
        const existing = await sb.select('cot_ohlc_daily', { snapshot_id: `eq.${snap.id}`, date: `eq.${today}`, select: 'id', limit: 1 });
        if (existing.length > 0) { skipped++; continue; }
        const ohlc = await fetchDailyOHLC(snap.pair, 2);
        if (!ohlc || ohlc.length === 0) { errors++; continue; }
        const candle = ohlc[0];
        const candleDate = candle.datetime.split(' ')[0];
        const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split('T')[0];
        if (candleDate !== today && candleDate !== yesterdayStr) { skipped++; continue; }
        await sb.insert('cot_ohlc_daily', [{ snapshot_id: snap.id, pair: snap.pair, date: candleDate, open: parseFloat(candle.open), high: parseFloat(candle.high), low: parseFloat(candle.low), close: parseFloat(candle.close) }]);
        await sb.update('cot_snapshots', { id: `eq.${snap.id}` }, { snapshot_status: 'partial' });
        updated++;
        await new Promise(r => setTimeout(r, 8000));
      } catch (e) { console.error(`OHLC update error for ${snap.pair}:`, e.message); errors++; }
    }
    res.json({ updated, skipped, errors, entry_fetched: entryFetched, total_active: openSnaps.length, date: today });
  } catch (e) { console.error('OHLC update error:', e.message); res.status(500).json({ error: e.message }); }
});

app.get('/performance/ohlc/:snapshotId', async (req, res) => {
  try {
    const rows = await sb.select('cot_ohlc_daily', { snapshot_id: `eq.${req.params.snapshotId}`, select: '*', order: 'date.asc' });
    res.json({ ohlc: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/performance', async (req, res) => {
  try {
    const snapshots = await sb.select('cot_snapshots', { select: '*', order: 'report_date.desc', limit: 500 });
    const enriched = await Promise.all(snapshots.map(async (snap) => {
      try {
        const ohlcRows = await sb.select('cot_ohlc_daily', { snapshot_id: `eq.${snap.id}`, select: 'date,open,high,low,close', order: 'date.asc' });
        const evaluation = evaluateSnapshot(snap, ohlcRows);
        return { ...snap, ohlc_evaluation: evaluation, ohlc_days: ohlcRows.length };
      } catch (_) { return { ...snap, ohlc_evaluation: null, ohlc_days: 0 }; }
    }));
    res.json({ snapshots: enriched });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/performance/snapshot', async (req, res) => {
  if (req.headers['x-cron-secret'] !== CRON_SECRET) return res.status(401).json({ error: 'unauthorized' });
  try {
    const cotData = await buildCotResult();
    const reportDate = Object.values(cotData).find(d => d.report_date)?.report_date;
    if (!reportDate) return res.status(500).json({ error: 'no COT data' });
    const existing = await sb.select('cot_snapshots', { report_date: `eq.${reportDate}`, select: 'pair,snapshot_status' });
    const existingPairs = new Set((existing || []).map(s => s.pair));
    const REAL_FOREX_PAIRS = ['EUR/USD','GBP/USD','AUD/USD','NZD/USD','USD/JPY','USD/CAD','USD/CHF','EUR/GBP','EUR/JPY','EUR/CAD','EUR/CHF','EUR/AUD','EUR/NZD','GBP/JPY','GBP/CAD','GBP/CHF','GBP/AUD','GBP/NZD','AUD/JPY','AUD/CAD','AUD/CHF','AUD/NZD','NZD/JPY','NZD/CAD','NZD/CHF','CAD/JPY','CAD/CHF','CHF/JPY'];
    const snapshots = [];
    for (const pairName of REAL_FOREX_PAIRS) {
      const [base, quote] = pairName.split('/');
      const bd = cotData[base], qd = cotData[quote];
      if (!bd || !qd || bd.error || qd.error) continue;
      const spread = bd.comm_index - qd.comm_index;
      const absSpread = Math.abs(spread);
      if (absSpread < 40) continue;
      const isLong = spread > 0;
      const longCcy = isLong ? base : quote, shortCcy = isLong ? quote : base;
      const longD = isLong ? bd : qd;
      const lb = MACRO_STANCE[longCcy]?.bias || 'neutral';
      const sb_bias = MACRO_STANCE[shortCcy]?.bias || 'neutral';
      const aligned = lb === 'hawkish' && sb_bias === 'dovish';
      const conflict = lb === 'dovish' && sb_bias === 'hawkish';
      const macroAlignment = aligned ? 'ALIGNED' : conflict ? 'CONFLICT' : 'NEUTRAL';
      const dominantBiasScore = isLong ? bd.bias_score : -qd.bias_score;
      const avgPressure = Math.round((bd.pressure_score + qd.pressure_score) / 2);
      const avgPressureLabel = getPressureLabel(avgPressure);
      const trendState = longD.trend_state || 'PEAKING';
      const freshnessLabel = longD.freshness || 'STALE';
      const crowdState = longD.crowd_state || 'BUILDING';
      const extremeLabel = longD.extreme_label || null;
      const tier = calcTier(dominantBiasScore, avgPressureLabel, macroAlignment, trendState, extremeLabel);
      if (!tier) continue;
      const weekType = (macroAlignment === 'ALIGNED' && absSpread >= 60) ? 'CLEAN' : 'MIXED';
      const badge = (extremeLabel === 'ELITE' && aligned) ? 'ULTRA' : extremeLabel === 'ELITE' ? 'ELITE' : extremeLabel === 'STRUCTURAL_EXTREME' ? 'STRUCTURAL' : extremeLabel === 'LOCAL_EXTREME' ? 'LOCAL' : null;
      snapshots.push({
        pair: pairName, report_date: reportDate, direction: isLong ? 'LONG' : 'SHORT', tier, badge,
        bias_score: Math.round(dominantBiasScore), bias_label: isLong ? bd.bias_label : qd.bias_label,
        macro_alignment: macroAlignment, macro_long_bias: lb, macro_short_bias: sb_bias,
        pressure_score: avgPressure, pressure_label: avgPressureLabel,
        trend_state: trendState, freshness_label: freshnessLabel, crowd_state: crowdState,
        long_ccy: longCcy, short_ccy: shortCcy, week_type: weekType,
        entry_price: null, entry_day_of_week: new Date().getUTCDay(),
        exit_price: null, return_pct: null, result: null, holding_days: null,
        is_complete: false, snapshot_status: 'pending', created_at: new Date().toISOString(),
      });
    }
    if (snapshots.length === 0) return res.json({ saved: 0, already_saved: existingPairs.size, message: existingPairs.size > 0 ? 'All qualifying pairs already saved this week' : 'No qualifying setups this week', report_date: reportDate });
    const upserted = await sb.upsert('cot_snapshots', snapshots, 'report_date,pair');
    const newCount = upserted.filter(s => !existingPairs.has(s.pair)).length;
    const updCount = upserted.filter(s =>  existingPairs.has(s.pair)).length;
    res.json({ saved: newCount, updated: updCount, already_saved: existingPairs.size, report_date: reportDate, snapshot_status: 'complete' });
  } catch (e) { console.error('Snapshot error:', e.message); res.status(500).json({ error: e.message }); }
});

app.post('/performance/close', async (req, res) => {
  if (req.headers['x-cron-secret'] !== CRON_SECRET) return res.status(401).json({ error: 'unauthorized' });
  try {
    const open = await sb.select('cot_snapshots', { is_complete: 'eq.false', entry_price: 'not.is.null', select: 'id,pair,direction,entry_price,report_date,created_at,badge' });
    if (open.length === 0) return res.json({ closed: 0, message: 'No open snapshots' });
    const now = Date.now();
    let closed = 0;
    for (const snap of open) {
      try {
        const createdAt = new Date(snap.created_at).getTime();
        const daysOpen = (now - createdAt) / (1000 * 60 * 60 * 24);
        const closeAfterDays = (snap.badge === 'ULTRA' || snap.badge === 'ELITE') ? 28 : 14;
        if (daysOpen < closeAfterDays) continue;
        const ohlcRows = await sb.select('cot_ohlc_daily', { snapshot_id: `eq.${snap.id}`, select: 'date,open,high,low,close', order: 'date.asc' });
        const evaluation = evaluateSnapshot(snap, ohlcRows);
        let exitPrice = null;
        try {
          const priceRes = await axios.get(`https://api.twelvedata.com/price?symbol=${snap.pair.replace('/','')}&apikey=${TD_KEY}`, { timeout: 5000 });
          exitPrice = parseFloat(priceRes.data?.price) || null;
        } catch (_) {}
        const entry = parseFloat(snap.entry_price);
        const holdingDays = Math.round(daysOpen);
        let result = 'FLAT';
        if (evaluation) {
          if (evaluation.direction_correct && evaluation.strong_signal) result = 'WIN';
          else if (evaluation.direction_correct) result = 'FLAT';
          else result = 'LOSS';
        } else if (exitPrice) {
          const rawReturn = snap.direction === 'LONG' ? (exitPrice - entry) / entry : (entry - exitPrice) / entry;
          result = rawReturn > 0.005 ? 'WIN' : rawReturn < -0.005 ? 'LOSS' : 'FLAT';
        }
        const returnPct = exitPrice ? parseFloat(((snap.direction === 'LONG' ? (exitPrice - entry) / entry : (entry - exitPrice) / entry) * 100).toFixed(4)) : null;
        await sb.update('cot_snapshots', { id: `eq.${snap.id}` }, {
          exit_price: exitPrice, return_pct: returnPct, result, holding_days: holdingDays, is_complete: true, snapshot_status: 'complete',
          ...(evaluation ? { mfe_pips: evaluation.mfe_pips, mae_pips: evaluation.mae_pips, time_to_mfe_days: evaluation.time_to_mfe_days, strength_ratio: evaluation.strength_ratio, direction_correct: evaluation.direction_correct } : {}),
        });
        closed++;
      } catch (e) { console.error(`Close error for ${snap.pair}:`, e.message); }
    }
    res.json({ closed, total_open: open.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/performance/fetch-entries', async (req, res) => {
  try {
    const snaps = await sb.select('cot_snapshots', { is_complete: 'eq.false', entry_price: 'is.null', select: 'id,pair', limit: 1 });
    if (!snaps || snaps.length === 0) return res.json({ done: true, message: 'All snapshots have entry_price' });
    const snap = snaps[0];
    const priceRes = await axios.get(`https://api.twelvedata.com/price?symbol=${snap.pair.replace('/','')}&apikey=${TD_KEY}`, { timeout: 5000 });
    const price = parseFloat(priceRes.data?.price) || null;
    if (price) { await sb.update('cot_snapshots', { id: `eq.${snap.id}` }, { entry_price: price }); }
    const remaining = await sb.select('cot_snapshots', { is_complete: 'eq.false', entry_price: 'is.null', select: 'id', limit: 100 });
    res.json({ pair: snap.pair, price, remaining: remaining.length, done: remaining.length === 0 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/performance/status', async (req, res) => {
  try {
    const all = await sb.select('cot_snapshots', { select: 'id,pair,tier,badge,result,is_complete,entry_price,report_date', order: 'created_at.desc', limit: 20 });
    res.json({ total: all.length, complete: all.filter(s => s.is_complete).length, open: all.filter(s => !s.is_complete).length, without_entry: all.filter(s => !s.entry_price).length, recent: all.slice(0,5) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── AI CHAT ───────────────────────────────────────────────────────────────
const TG_SYSTEM_PROMPT = `You are TradeGuard Assistant — an in-app guide for the TradeGuard Forex toolkit. You ONLY answer questions about TradeGuard features. For anything else, say in the user's language: "I can only help with TradeGuard features."

Always respond in the SAME LANGUAGE the user writes in. Be concise — users are on mobile. Never invent features.

═══════════════════════════════════════
TAB 1 — RISK CALCULATOR
═══════════════════════════════════════
Purpose: Calculate exact lot size based on account balance and risk %.

HOW IT WORKS:
1. Enter account Balance (e.g. 79000)
2. Select Currency (USD, EUR, GBP, etc.)
3. Set Risk Mode: % (percentage of balance) or $ (fixed dollar amount)
4. Select Instrument — 60+ available: Forex pairs, commodities, crypto, indices, stocks. Live prices fetched automatically.
5. Enter Custom SL (stop loss distance in points/pips, e.g. 37)
6. App instantly shows: Lot Size, Dollar Risk, Pip Value

SL LADDER TABLE: Shows lot sizes for common SL distances (10-200 points) at current risk setting.

R:R TARGETS: Shows potential profit at 1:1, 1:1.5, 1:2, 1:3 ratios.

RESET button (↺ icon): Clears all fields back to defaults.

PRO FEATURE: Custom/exotic instruments beyond standard list require Pro.

═══════════════════════════════════════
TAB 2 — TRADE JOURNAL
═══════════════════════════════════════
Purpose: Log, track and analyze trades over time.

HOW TO ADD A TRADE:
- Tap the "+" button
- Choose mode:
  • QUICK MODE: log just Result (Win/Loss/BE) and P&L amount
  • ADVANCED MODE: full details — Pair, Direction (Long/Short), Entry, SL, TP, Lots, Risk, Result, R:R planned vs realized, Tags, Notes, Date

AUTO P&L: Enter risk amount → app calculates P&L (Win = +risk, Loss = -risk)

TAGS: Label trades with setups (A+ Setup), emotions (FOMO, Revenge), behaviors (Patient, Early Exit).

STATISTICS (shown at top): Total P&L, Win Rate, Average R:R, Top tag, Wins/Losses/BE count.

FILTERS: Filter by Win / Loss / BE / specific pair

EDIT: Tap any trade to edit
DELETE: Long-press or tap X button

EXPORT (Pro): Save all trades as JSON file
IMPORT (Pro): Restore trades from exported JSON

Trades are saved locally on the device.

═══════════════════════════════════════
TAB 3 — NEWS FEED
═══════════════════════════════════════
Purpose: Live Forex news from multiple sources.

3 SUB-TABS:
• BREAKING — Latest headlines under 2 hours old. Red LIVE badge = under 2h.
• HIGH IMPACT — Fed, ECB, central banks, rate decisions, GDP, employment.
• MARKET — General forex, crypto, indices, commodities news.

SOURCES: ForexLive and InvestingLive RSS feeds.
AUTO-REFRESH: Every 15 seconds while on News tab.
MANUAL REFRESH: Tap ↻ icon.
READ ARTICLE: Tap card → see summary → tap "Read more →" to open in browser.

═══════════════════════════════════════
TAB 4 — ECONOMIC CALENDAR
═══════════════════════════════════════
Purpose: High-impact economic events for major currencies only.

SHOWS: NFP, CPI, PPI, FOMC, rate decisions, GDP, unemployment, retail sales, PCE. No low-impact noise.
CURRENCIES: USD, EUR, GBP, JPY, AUD, CAD, NZD, CHF, NOK, SEK.

NEXT BANNER: Blue banner at top — next event with live countdown (updates every second).
TODAY: Events today highlighted in red.
PASSED: Shows "PASSED" badge. If results available → green "Results" badge → tap to see Actual, Forecast, Previous.
REMINDERS (🔔): Notifications 15 min and 5 min before event. Tap bell again to cancel.
EVENT DETAILS: Tap any event → see Actual (green), Forecast (blue), Previous (gray).

PRO FEATURE: Economic Calendar requires Pro or active Trial.

═══════════════════════════════════════
TAB 5 — COT REPORT (Commitment of Traders)
═══════════════════════════════════════
Purpose: Weekly CFTC data showing how the largest players are positioned.

WHO IS WHO:
- COMMERCIALS = banks, exporters, importers, institutions. Hedge real business. Position AHEAD of major moves. Almost always right at extremes. THIS IS SMART MONEY.
- NON-COMMERCIALS = hedge funds, CTAs. Trend followers. At extremes they are the crowd that gets squeezed.
- This app uses Commercial-first methodology (same as Larry Williams, Steve Briese, Floyd Upperman).

COMM INDEX (0-100):
- Where commercials sit vs their 3-year range.
- 0 = max short (bearish) | 100 = max long (bullish)
- BULLISH signal: COMM index >= 80
- BEARISH signal: COMM index <= 20
- NEUTRAL: 20-80

PRESSURE SCORE (0-100) — divergence between commercials and speculators:
- NEUTRAL (0-40): no COT edge
- BUILDING (40-60): divergence growing
- PRESSURIZED (60-80): significant divergence
- CRITICAL (80-100): extreme divergence, squeeze likely

FRESH vs STALE:
- FRESH: strong signal + commercials still adding (WoW positive)
- STALE: strong signal but positions stagnant or reversing

WoW (Week over Week): Change in commercial positions vs last week.

TREND OF POSITIONING:
- EXPANDING: WoW > +1.5% of open interest — actively building
- PEAKING: WoW within ±1.5% — slowing
- UNWINDING: WoW < -1.5% — reducing, reversal pressure

SIGNAL BADGES:
- ULTRA: 5Y extreme + expanding + macro aligned. Rarest, highest conviction.
- ELITE: 5Y confirmed extreme + actively expanding.
- STRUCTURAL: Confirmed by 3Y and 5Y range, not expanding yet.
- LOCAL: Only extreme in 3Y window — lower confidence.

BIAS SCORE (-100 to +100):
- STR BULLISH >= +50 | BULLISH +20 to +49 | WK BULLISH +5 to +19
- NEUTRAL -5 to +5
- WK BEARISH -5 to -19 | BEARISH -20 to -49 | STR BEARISH <= -50

TIER SYSTEM (Top Pairs):
- A+: High bias score + CRITICAL pressure + ALIGNED macro + EXPANDING trend
- A: Good bias score + CRITICAL or PRESSURIZED + not CONFLICT
- B: Moderate bias + pressure not NEUTRAL

TOP 5 PAIRS: Auto-detected pairs with largest COMM index divergence (>=40 points).
Shows: direction (LONG/SHORT), strength (STRONG/MODERATE/WEAK), macro alignment.

CROWD ACCELERATION SIGNAL:
- BUILDING: crowd entering trend at mid-range
- ACCELERATING: crowd at extreme AND adding more — squeeze risk high
- EXHAUSTING: crowd at extreme, momentum fading — peak warning
- UNWINDING: crowd exiting — highest reversal risk
Best setup: STR BULLISH Commercials + UNWINDING bearish crowd = classic squeeze.

HOW TO USE COT (step by step):
1. Check Macro Bias tab for directional context (hawkish/dovish per currency)
2. Check COT COMM Index and signal for that currency
3. When Macro + COT aligned → wait for price at a HTF key zone
4. Look for LTF confirmation entry
Highest conviction setup = CRITICAL + FRESH + EXPANDING + Macro aligned + key zone

RELEASE SCHEDULE: CFTC publishes every Friday 15:30 ET (21:30 UTC). App auto-refreshes.

MACRO BIAS (inside COT tab):
- HAWKISH: rate hikes, tightening → bullish for currency
- DOVISH: rate cuts, easing → bearish for currency
- NEUTRAL: on hold

═══════════════════════════════════════
SUBSCRIPTION
═══════════════════════════════════════
- FREE TRIAL: 14 days full access
- PRO: Full access to everything
- FREE (expired trial): Risk Calculator basic + Journal basic only
- AI Assistant: available during Trial and for Pro users

STRICT RULES:
1. ONLY answer about TradeGuard features described above. EXCEPTION: You CAN explain why a specific pair shows LONG or SHORT in the COT tab — explain the COT logic (COMM index, pressure score, macro alignment, badge, tier) as it applies to that pair. This is part of understanding the app's data.
2. Never give general trading advice, market predictions, or discuss other apps. Do NOT give entry/exit signals, price targets, or tell users when to open/close trades.
3. Always respond in the SAME LANGUAGE the user writes in. IMPORTANT: If the user writes in Serbian (srpski), use standard Serbian language (Serbia dialect) - NOT Bosnian or Croatian. Use words like "na primer" (not "primjerice"), "takođe" (not "također"), "račun" (not "računovodstvo"), "izaberi" (not "odaberi").
4. If asked something outside scope: say "I can only help with TradeGuard features. What would you like to know about the app?" in the user's language.
5. Never invent features not described above.
6. RESPONSE STYLE: Max 4-5 sentences total. No long paragraphs. Answer immediately without restating the question. Use numbered steps only for actions (max 5 steps). Be direct and brief - mobile screen is small.`

app.post('/api/ai-chat', async (req, res) => {
  try {
    if (!GROQ_KEY) return res.status(503).json({ error: 'AI not configured' });
    const { message, tab, history = [] } = req.body;
    if (!message || typeof message !== 'string' || message.trim().length === 0)
      return res.status(400).json({ error: 'message required' });
    if (message.trim().length > 500)
      return res.status(400).json({ error: 'message too long' });

    // Build messages array
    const messages = [{ role: 'system', content: TG_SYSTEM_PROMPT }];

    // Add history (last 6 messages max)
    const recentHistory = history.slice(-6);
    for (const msg of recentHistory) {
      if (msg.role === 'user') messages.push({ role: 'user', content: msg.content });
      else if (msg.role === 'assistant') messages.push({ role: 'assistant', content: msg.content });
    }

    // Add current message with tab context
    const userText = tab ? `[Context: user is currently viewing the ${tab} tab, but their question may be about any feature]\n${message.trim()}` : message.trim();
    messages.push({ role: 'user', content: userText });

    const groqRes = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: 'llama-3.1-8b-instant',
        messages,
        max_tokens: 400,
        temperature: 0.4,
      },
      {
        headers: { Authorization: `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' },
        timeout: 25000,
      }
    );

    const reply = groqRes.data?.choices?.[0]?.message?.content || 'Sorry, I could not generate a response.';
    res.json({ reply: reply.trim() });
  } catch (e) {
    console.error('AI chat error:', e.message);
    res.status(500).json({ error: 'AI service error', reply: 'Something went wrong. Please try again.' });
  }
});

// ── DELUKA JOURNAL AI CHAT ────────────────────────────────────────────────
const DELUKA_SYSTEM_PROMPT = `You are DeLuka Journal Assistant — an in-app AI coach exclusively for the DeLuka Trade Journal.

DeLuka Trade Journal is a professional Forex trading journal with these features:
- Dashboard: stats overview (total trades, win rate, avg R:R, best trade, checklist avg), win/loss donut chart, R:R distribution bar chart, recent performance line chart
- All Trades: full trade table with filters (All/Wins/Losses/B/E/Long/Short), sortable columns
- Calendar: monthly view showing trades per day color-coded (green=win, red=loss, yellow=B/E)
- Analytics: setup performance by win rate, emotion vs performance analysis, best/worst stats
- Equity Curve: cumulative P&L chart (R or $), drawdown underwater curve, stats (max drawdown, best/worst streak, profit factor), filters by period (30D/90D/6M/1Y/All)
- Duration Analysis: scatter plot (duration vs outcome), performance by duration bucket, distribution histogram
- Import: JSON backup merge, Broker CSV import (OTC/MT4/MT5 format)
- Export: JSON backup download

TRADE ENTRY FIELDS:
- Pair (e.g. EURUSD, XAUUSD), Date, Setup/Strategy
- Entry Time, Exit Time (auto-calculates duration)
- Direction: Long or Short
- Result: Win, Loss, B/E (breakeven)
- HTF Zone (Monthly/Weekly/Daily/4H/2H/1H), LTF Entry (Daily/4H/1H/30min/15min/5min/2min/1min)
- Entry price, Stop Loss, Take Profit (auto-calculates R:R ratio)
- Lots/Position Size
- P&L in $ (optional)
- Emotional State: Calm, Confident, Anxious, FOMO, Revenge, Neutral, Tired, Greedy
- HTF and LTF screenshot URLs
- MBT Checklist (12 items, scored 0-12):
  1. COT aligned with direction
  2. Strong move away from zone
  3. Min. 2 clear candles
  4. Imbalance min 2:1
  5. No 50% candle
  6. Momentum Line break
  7. Price removed opposing zone
  8. Min. 2 clear 1H candles
  9. 1H Imbalance min 2:1
  10. ML break OR opposing zone (1H)
  11. 1-4 Candle Rule met
  12. No high-impact news
- Notes: free text for trade review

MBT METHODOLOGY (Austin Moneyball):
- HTF zones (Supply & Demand): identify key areas on higher timeframes first
- LTF entry: wait for confirmation on lower timeframe before entering
- Imbalance 2:1: the move away from a zone must be at least twice the size of the base
- No 50% candle: none of the base candles should retrace more than 50% of the previous candle
- Momentum Line: a trendline connecting the swing points; a break confirms entry direction
- 1-4 Candle Rule: entry should come within 1-4 candles after the LTF confirmation signal
- COT alignment: commercial traders (smart money) should be positioned in the same direction as the trade

HOW TO USE THE JOURNAL:
- Click "+ NEW TRADE" to log a trade
- Fill in pair, date, direction, result (minimum required)
- Add entry/SL/TP for automatic R:R calculation
- Add entry and exit times for automatic duration calculation
- Go through MBT checklist to score your setup quality
- Use Analytics tab to find your best setups and worst emotional states
- Use Equity Curve to track overall account growth
- Export regularly as JSON backup
- Import broker CSV to auto-populate trades from MT4/MT5/OTC

STRICT RULES:
1. ONLY answer about DeLuka Journal features, how to use them, or MBT methodology as it applies to journaling
2. You CAN explain MBT checklist items and what they mean
3. You CAN explain what the stats and charts show and how to interpret them
4. You CAN give journaling advice (how to review trades, what patterns to look for)
5. Never give live trading signals, market predictions, or tell users when to open/close trades
6. Always respond in the SAME LANGUAGE the user writes in. If Serbian: use standard Serbian (Serbia dialect) — "na primer" not "primjerice", "takođe" not "također"
7. Be concise — max 4-5 sentences or 5 bullet points. Users are on desktop but keep it focused.
8. Never invent features not described above.`;

app.post('/api/journal-ai-chat', async (req, res) => {
  try {
    if (!DELUKA_GROQ_KEY) return res.status(503).json({ error: 'AI not configured' });
    const { message, page, history = [] } = req.body;
    if (!message || typeof message !== 'string' || message.trim().length === 0)
      return res.status(400).json({ error: 'message required' });
    if (message.trim().length > 500)
      return res.status(400).json({ error: 'message too long' });

    const messages = [{ role: 'system', content: DELUKA_SYSTEM_PROMPT }];
    const recentHistory = history.slice(-6);
    for (const msg of recentHistory) {
      if (msg.role === 'user') messages.push({ role: 'user', content: msg.content });
      else if (msg.role === 'assistant') messages.push({ role: 'assistant', content: msg.content });
    }
    const userText = page ? `[User is on the ${page} page]\n${message.trim()}` : message.trim();
    messages.push({ role: 'user', content: userText });

    const groqRes = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: 'llama-3.1-8b-instant',
        messages,
        max_tokens: 400,
        temperature: 0.4,
      },
      {
        headers: { Authorization: `Bearer ${DELUKA_GROQ_KEY}`, 'Content-Type': 'application/json' },
        timeout: 25000,
      }
    );

    const reply = groqRes.data?.choices?.[0]?.message?.content || 'Sorry, I could not generate a response.';
    res.json({ reply: reply.trim() });
  } catch (e) {
    console.error('DeLuka AI chat error:', e.message);
    res.status(500).json({ error: 'AI service error', reply: 'Something went wrong. Please try again.' });
  }
});

app.listen(PORT, () => console.log(`TradeGuard server running on port ${PORT}`));
