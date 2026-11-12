// ETF 순유입·코인 가격·유통 시총 일별 누적 수집기 (GitHub Actions에서 실행)
// - 키 값은 절대 출력하지 않는다.
// - 실패한 종목은 기존 자료를 그대로 두고 건너뛴다. 누락을 0으로 채우지 않는다.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { ASSETS, parseAssetFlows, parseFundFlows, parseMarketChart, mergeRows, sortByDate } from "./lib/parse.mjs";
import { writeOsBundle } from "./lib/bundle.mjs";

const CRYPTOETF = "https://api.cryptoetf.today/api/v1";
const COINGECKO = "https://api.coingecko.com/api/v3";
const ETF_KEY = (process.env.CRYPTOETF_API_KEY || "").trim();
const CG_KEY = (process.env.COINGECKO_DEMO_KEY || "").trim();
const CG_GAP_MS = CG_KEY ? 4_000 : 15_000;
const DAYS = process.env.MARKET_DAYS || "30";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = new Date();
const fetchedAt = now.toISOString();

async function getJson(url, headers) {
  for (let attempt = 0; attempt < 2; attempt++) {
    let res;
    try {
      res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "crypto-etf-data/1.0", ...headers }, signal: AbortSignal.timeout(20_000), redirect: "error" });
    } catch {
      if (attempt === 0) { await sleep(5_000); continue; }
      throw new Error("REQUEST_FAILED");
    }
    if (res.status === 429 && attempt === 0) {
      const wait = Math.min(Number(res.headers.get("retry-after")) || 60, 90) * 1000;
      await sleep(wait);
      continue;
    }
    if (!res.ok) throw new Error("HTTP_" + res.status);
    return res.json();
  }
  throw new Error("RETRY_EXHAUSTED");
}

async function load(path) {
  try { return JSON.parse(await readFile(path, "utf8")); } catch { return null; }
}
async function save(path, obj) {
  await writeFile(path, JSON.stringify(obj, null, 1) + "\n");
}

const status = { runAt: fetchedAt, flows: {}, funds: {}, market: {} };
await mkdir("data/flows", { recursive: true });
await mkdir("data/funds", { recursive: true });
await mkdir("data/market", { recursive: true });

// 1) ETF 순유입 (CryptoETF.today)
if (!ETF_KEY) {
  for (const a of Object.keys(ASSETS)) status.flows[a] = { ok: false, error: "CRYPTOETF_API_KEY_MISSING" };
} else {
  const auth = { Authorization: `Bearer ${ETF_KEY}` };
  for (const [asset, cfg] of Object.entries(ASSETS)) {
    const path = `data/flows/${asset}.json`;
    const file = (await load(path)) ?? { asset, unit: "USD", source: "CryptoETF.today", rows: {} };
    try {
      const parsed = parseAssetFlows(asset, await getJson(`${CRYPTOETF}/flows/${cfg.slug}`, auth), now);
      const incoming = Object.fromEntries(parsed.rows.map((r) => [r.date, { netFlowUsd: r.netFlowUsd }]));
      const r = mergeRows(file.rows, incoming, { fetchedAt, sourceUpdatedAt: parsed.sourceUpdatedAt });
      file.rows = sortByDate(file.rows);
      await save(path, file);
      const dates = Object.keys(file.rows);
      status.flows[asset] = { ok: true, ...r, latestDate: dates.at(-1) ?? null, totalDays: dates.length };
    } catch (e) {
      status.flows[asset] = { ok: false, error: e.message };
    }
    if (cfg.funds) {
      const fpath = `data/funds/${asset}.json`;
      const ffile = (await load(fpath)) ?? { asset, unit: "USD", source: "CryptoETF.today", rows: {} };
      try {
        const parsed = parseFundFlows(asset, await getJson(`${CRYPTOETF}/flows/${cfg.slug}/funds`, auth), now);
        const incoming = Object.fromEntries(parsed.rows.map((r) => [r.date, { funds: r.funds, complete: r.complete }]));
        const r = mergeRows(ffile.rows, incoming, { fetchedAt, sourceUpdatedAt: parsed.sourceUpdatedAt });
        ffile.rows = sortByDate(ffile.rows);
        await save(fpath, ffile);
        status.funds[asset] = { ok: true, ...r, latestDate: Object.keys(ffile.rows).at(-1) ?? null };
      } catch (e) {
        status.funds[asset] = { ok: false, error: e.message };
      }
    }
    await sleep(1_500);
  }
}

// 2) 코인 가격·유통 시총 (CoinGecko, UTC 00:00 일별 관측)
const cgHeaders = CG_KEY ? { "x-cg-demo-api-key": CG_KEY } : {};
let first = true;
for (const [asset, cfg] of Object.entries(ASSETS)) {
  if (!first) await sleep(CG_GAP_MS);
  first = false;
  const path = `data/market/${asset}.json`;
  const file = (await load(path)) ?? { asset, coinId: cfg.coin, unit: "USD", source: "CoinGecko market_chart (UTC 00:00)", rows: {} };
  try {
    const incoming = parseMarketChart(await getJson(`${COINGECKO}/coins/${cfg.coin}/market_chart?vs_currency=usd&days=${DAYS}&interval=daily`, cgHeaders), now.getTime());
    const r = mergeRows(file.rows, incoming, { fetchedAt });
    file.rows = sortByDate(file.rows);
    await save(path, file);
    status.market[asset] = { ok: true, ...r, latestDate: Object.keys(file.rows).at(-1) ?? null };
  } catch (e) {
    status.market[asset] = { ok: false, error: e.message };
  }
}

await save("data/status.json", status);

// 3) OS용 묶음 파일 (위에서 저장한 data/ 파일만 읽는다). 실패해도 수집 자료 저장·종료 코드에는 영향 없음.
const bundle = await writeOsBundle({ now: new Date() });
console.log(JSON.stringify({ bundle }));

const parts = [status.flows, status.market];
const okCount = parts.flatMap((p) => Object.values(p)).filter((x) => x.ok).length;
console.log(JSON.stringify({ runAt: fetchedAt, ok: okCount, flows: Object.fromEntries(Object.entries(status.flows).map(([a, s]) => [a, s.ok ? s.latestDate : s.error])), market: Object.fromEntries(Object.entries(status.market).map(([a, s]) => [a, s.ok ? s.latestDate : s.error])) }));
if (okCount === 0) process.exit(1);
