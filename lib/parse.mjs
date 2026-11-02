// 순수 함수만 둔다(네트워크·파일 접근 없음). tests/에서 그대로 시험한다.

export const ASSETS = {
  BTC: { coin: "bitcoin", slug: "btc", funds: false },
  ETH: { coin: "ethereum", slug: "eth", funds: false },
  SOL: { coin: "solana", slug: "sol", funds: false },
  XRP: { coin: "ripple", slug: "xrp", funds: true },
  HYPE: { coin: "hyperliquid", slug: "hyp", funds: false },
  LTC: { coin: "litecoin", slug: "ltc", funds: true },
  NEAR: { coin: "near", slug: "near", funds: true },
  ZEC: { coin: "zcash", slug: "zec", funds: false },
};

const DATE = /^20\d{2}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

function isObject(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function validDate(s, today) {
  if (typeof s !== "string" || !DATE.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s && s <= today;
}

function symbolOf(v) {
  if (typeof v !== "string") return null;
  const s = v.toUpperCase();
  return s === "HYP" ? "HYPE" : s;
}

// CryptoETF.today /flows/{slug} → [{date, netFlowUsd|null}]
export function parseAssetFlows(asset, body, now = new Date()) {
  if (!isObject(body) || symbolOf(body.symbol) !== asset || !Array.isArray(body.days))
    throw new Error("ASSET_ENVELOPE");
  const updatedAt = Date.parse(body.updatedAt);
  if (!Number.isFinite(updatedAt)) throw new Error("ASSET_UPDATED_AT");
  const today = now.toISOString().slice(0, 10);
  const seen = new Set();
  const rows = [];
  for (const d of body.days) {
    if (!isObject(d) || !validDate(d.date, today) || seen.has(d.date)) throw new Error("ASSET_DATE");
    seen.add(d.date);
    const v = d.netFlowUsdM;
    if (v !== null && (typeof v !== "number" || !Number.isFinite(v) || Math.abs(v) > 1e9))
      throw new Error("ASSET_VALUE");
    rows.push({ date: d.date, netFlowUsd: v === null ? null : Math.round(v * 1e6) });
  }
  return { sourceUpdatedAt: new Date(updatedAt).toISOString(), rows };
}

// CryptoETF.today /flows/{slug}/funds → [{date, funds:[{ticker,issuer,netFlowUsd|null}], complete}]
export function parseFundFlows(asset, body, now = new Date()) {
  if (!isObject(body) || symbolOf(body.symbol) !== asset || !Array.isArray(body.days))
    throw new Error("FUND_ENVELOPE");
  const updatedAt = Date.parse(body.updatedAt);
  if (!Number.isFinite(updatedAt)) throw new Error("FUND_UPDATED_AT");
  const today = now.toISOString().slice(0, 10);
  const seen = new Set();
  const rows = [];
  for (const d of body.days) {
    if (!isObject(d) || !validDate(d.date, today) || seen.has(d.date) || !Array.isArray(d.funds))
      throw new Error("FUND_DAY");
    seen.add(d.date);
    const tickers = new Set();
    const funds = [];
    let complete = d.funds.length > 0;
    for (const f of d.funds) {
      if (!isObject(f) || typeof f.ticker !== "string" || !/^[-A-Z0-9.]{2,12}$/.test(f.ticker) || tickers.has(f.ticker))
        throw new Error("FUND_IDENTITY");
      tickers.add(f.ticker);
      const v = f.netFlowUsdM;
      if (v !== null && (typeof v !== "number" || !Number.isFinite(v) || Math.abs(v) > 1e9))
        throw new Error("FUND_VALUE");
      if (v === null) complete = false;
      funds.push({ ticker: f.ticker, issuer: typeof f.issuer === "string" ? f.issuer : null, netFlowUsd: v === null ? null : Math.round(v * 1e6) });
    }
    rows.push({ date: d.date, funds, complete });
  }
  return { sourceUpdatedAt: new Date(updatedAt).toISOString(), rows };
}

// CoinGecko market_chart → {date: {priceUsd, marketCapUsd}} — UTC 00:00 관측만, 미래·중복·비정상 제외
export function parseMarketChart(body, now = Date.now()) {
  if (!isObject(body) || !Array.isArray(body.prices) || !Array.isArray(body.market_caps))
    throw new Error("MARKET_ENVELOPE");
  const out = {};
  const take = (arr, field) => {
    const seen = new Set();
    for (const p of arr) {
      if (!Array.isArray(p) || p.length < 2) continue;
      const [ts, v] = p;
      if (!Number.isInteger(ts) || ts % DAY_MS !== 0 || ts > now) continue;
      if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) continue;
      const date = new Date(ts).toISOString().slice(0, 10);
      if (seen.has(date)) {
        delete out[date]?.[field]; // 같은 날짜가 두 번 오면 그 날짜 값을 버린다(충돌)
        continue;
      }
      seen.add(date);
      (out[date] ??= {})[field] = v;
    }
  };
  take(body.prices, "priceUsd");
  take(body.market_caps, "marketCapUsd");
  return out;
}

// 누적 병합 규칙: 확인된 값을 null로 덮지 않는다. 값이 바뀌면 이전 값을 revisions에 남긴다.
export function mergeRows(store, incoming, meta) {
  let added = 0, revised = 0;
  for (const [date, rec] of Object.entries(incoming)) {
    const old = store[date];
    if (!old) {
      store[date] = { ...rec, ...meta };
      added++;
      continue;
    }
    const next = { ...old };
    let changed = false;
    for (const [k, v] of Object.entries(rec)) {
      if (v === null || v === undefined) continue;
      if (JSON.stringify(old[k]) !== JSON.stringify(v)) {
        if (old[k] !== null && old[k] !== undefined) {
          (next.revisions ??= []).push({ field: k, previous: old[k], replacedAt: meta.fetchedAt });
          revised++;
        }
        next[k] = v;
        changed = true;
      }
    }
    if (changed) store[date] = { ...next, ...meta };
  }
  return { added, revised };
}

export function sortByDate(obj) {
  return Object.fromEntries(Object.entries(obj).sort(([a], [b]) => (a < b ? -1 : 1)));
}
