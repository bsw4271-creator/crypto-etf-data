// OS용 묶음 파일(data/os/bundle-v1.json). Crypto Investment OS가 하루 2번 이 파일 하나만 읽어 간다.
// - 이미 저장한 data/ 파일만 읽는다. 외부 호출 없음.
// - null은 미확인 그대로 둔다. 0으로 채우지 않는다.
// - 토·일 행은 넣지 않는다. 미국 휴일은 OS가 자기 달력으로 거른다(달력을 두 곳에 두지 않기 위해).
// - 형식(키 순서·정렬)은 고정한다. 바꾸면 파일 이름의 번호를 올린다(bundle-v2.json).
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { ASSETS } from "./parse.mjs";

export const BUNDLE_SCHEMA = "crypto-etf-data/os-bundle@1";
export const BUNDLE_PATH = "data/os/bundle-v1.json";
export const BUNDLE_DAYS = 60;
// OS는 256KB가 넘으면 거절한다. 여유를 두고 여기서 먼저 멈춘다.
export const BUNDLE_MAX_BYTES = 200_000;

const DAY_MS = 86_400_000;
const DATE = /^20\d{2}-\d{2}-\d{2}$/;
const TICKER = /^[A-Z0-9]{2,12}$/;
const CODE = /^[A-Z0-9_]{2,64}$/;

function isDate(s) {
  if (typeof s !== "string" || !DATE.test(s)) return false;
  const t = Date.parse(s + "T00:00:00Z");
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s;
}
function isWeekend(date) {
  const d = new Date(date + "T12:00:00Z").getUTCDay();
  return d === 0 || d === 6;
}
function isTime(s) {
  return typeof s === "string" && Number.isFinite(Date.parse(s));
}
function latest(rows, key) {
  const values = Object.values(rows).map((r) => r?.[key]).filter(isTime).map((s) => new Date(s).toISOString());
  return values.length ? values.sort().at(-1) : null;
}
function flowValue(v, where) {
  if (v === null || v === undefined) return null;
  if (!Number.isInteger(v) || Math.abs(v) > 1e11) throw new Error("BUNDLE_FLOW_VALUE " + where);
  return v;
}
function positive(v, where) {
  if (v === null || v === undefined) return null;
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) throw new Error("BUNDLE_MARKET_VALUE " + where);
  return v;
}
function runPart(part) {
  if (!part || typeof part !== "object") return { ok: false, latestDate: null, error: "NOT_RUN" };
  const out = { ok: part.ok === true, latestDate: isDate(part.latestDate) ? part.latestDate : null };
  if (!out.ok) out.error = typeof part.error === "string" && CODE.test(part.error) ? part.error : "UNKNOWN";
  return out;
}

// 순수 함수. input = { status, flows: {자산: 파일}, funds: {자산: 파일|null}, market: {자산: 파일} }
export function buildOsBundle(input, { now = new Date(), days = BUNDLE_DAYS } = {}) {
  const { status } = input;
  if (!status || !isTime(status.runAt)) throw new Error("BUNDLE_STATUS");
  const runAt = new Date(status.runAt).toISOString();
  const generatedAt = new Date(now).toISOString();
  if (runAt > generatedAt) throw new Error("BUNDLE_RUN_AFTER_GENERATED");
  const to = runAt.slice(0, 10);
  const from = new Date(Date.parse(to + "T00:00:00Z") - (days - 1) * DAY_MS).toISOString().slice(0, 10);
  const keep = (date) => {
    if (!isDate(date)) throw new Error("BUNDLE_DATE " + date);
    return date >= from && date <= to && !isWeekend(date);
  };
  const sortedDates = (rows) => Object.keys(rows).filter(keep).sort();
  const run = { runAt, flows: {}, funds: {}, market: {} };
  const assets = {};
  for (const [asset, cfg] of Object.entries(ASSETS)) {
    const flows = input.flows[asset], market = input.market[asset], funds = cfg.funds ? input.funds[asset] : null;
    if (flows?.asset !== asset || flows.source !== "CryptoETF.today" || flows.unit !== "USD" || !flows.rows || typeof flows.rows !== "object")
      throw new Error("BUNDLE_FLOWS_FILE " + asset);
    if (market?.asset !== asset || market.coinId !== cfg.coin || market.unit !== "USD" || !market.rows || typeof market.rows !== "object")
      throw new Error("BUNDLE_MARKET_FILE " + asset);
    if (funds && (funds.asset !== asset || funds.source !== "CryptoETF.today" || funds.unit !== "USD" || !funds.rows || typeof funds.rows !== "object"))
      throw new Error("BUNDLE_FUNDS_FILE " + asset);
    run.flows[asset] = runPart(status.flows?.[asset]);
    if (cfg.funds) run.funds[asset] = runPart(status.funds?.[asset]);
    run.market[asset] = runPart(status.market?.[asset]);

    const flowRows = sortedDates(flows.rows).map((date) => [date, flowValue(flows.rows[date].netFlowUsd, asset + " " + date)]);
    let fundPart = null;
    if (funds) {
      const issuers = {};
      const rows = [];
      for (const date of sortedDates(funds.rows)) {
        const list = funds.rows[date].funds;
        // 티커가 OS 규칙에 맞지 않거나 운용사 목록이 비면 그날 운용사 자료만 뺀다(합계는 flows에 남는다).
        if (!Array.isArray(list) || !list.length || list.some((f) => typeof f?.ticker !== "string" || !TICKER.test(f.ticker))) continue;
        const tickers = list.map((f) => f.ticker).sort();
        if (new Set(tickers).size !== tickers.length) continue;
        const values = {};
        for (const t of tickers) {
          const f = list.find((x) => x.ticker === t);
          values[t] = flowValue(f.netFlowUsd, asset + " " + date + " " + t);
          if (typeof f.issuer === "string" && f.issuer.length <= 100) issuers[t] = f.issuer;
        }
        rows.push([date, values]);
      }
      fundPart = { fetchedAt: latest(funds.rows, "fetchedAt"), rows, issuers: Object.fromEntries(Object.entries(issuers).sort(([a], [b]) => (a < b ? -1 : 1))) };
    }
    const marketRows = [];
    for (const date of sortedDates(market.rows)) {
      const r = market.rows[date];
      const price = positive(r.priceUsd, asset + " " + date), cap = positive(r.marketCapUsd, asset + " " + date);
      if (price === null && cap === null) continue;
      marketRows.push([date, price, cap]);
    }
    assets[asset] = {
      coinId: cfg.coin,
      flows: { provider: "CryptoETF.today", fetchedAt: latest(flows.rows, "fetchedAt"), sourceUpdatedAt: latest(flows.rows, "sourceUpdatedAt"), rows: flowRows },
      funds: fundPart,
      market: { fetchedAt: latest(market.rows, "fetchedAt"), rows: marketRows },
    };
  }
  const bundle = { schemaVersion: BUNDLE_SCHEMA, generatedAt, run, window: { from, to }, assets };
  const text = JSON.stringify(bundle) + "\n";
  const bytes = Buffer.byteLength(text);
  if (bytes > BUNDLE_MAX_BYTES) throw new Error("BUNDLE_TOO_LARGE");
  return { bundle, text, bytes };
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}
async function readOptional(path) {
  try {
    return await readJson(path);
  } catch (e) {
    if (e?.code === "ENOENT") return null;
    throw e;
  }
}
const withoutGeneratedAt = (b) => JSON.stringify({ ...b, generatedAt: null });

// data/에서 읽어 묶음 파일을 쓴다. 던지지 않고 결과를 돌려준다(수집 자료 저장을 막지 않기 위해).
// 실패하면 이전 묶음 파일은 그대로 남는다. 내용이 같으면(생성 시각 제외) 다시 쓰지 않는다.
export async function writeOsBundle({ root = ".", now = new Date() } = {}) {
  try {
    const input = { status: await readJson(join(root, "data/status.json")), flows: {}, funds: {}, market: {} };
    for (const [asset, cfg] of Object.entries(ASSETS)) {
      input.flows[asset] = await readJson(join(root, `data/flows/${asset}.json`));
      input.market[asset] = await readJson(join(root, `data/market/${asset}.json`));
      input.funds[asset] = cfg.funds ? await readOptional(join(root, `data/funds/${asset}.json`)) : null;
    }
    const { bundle, text, bytes } = buildOsBundle(input, { now });
    const path = join(root, BUNDLE_PATH);
    const previous = await readOptional(path).catch(() => null);
    if (previous && withoutGeneratedAt(previous) === withoutGeneratedAt(bundle)) return { ok: true, written: false, bytes };
    await mkdir(join(root, "data/os"), { recursive: true });
    await writeFile(path, text);
    return { ok: true, written: true, bytes };
  } catch (e) {
    const message = e instanceof Error ? e.message : "";
    const code = message.split(" ")[0];
    return { ok: false, written: false, error: CODE.test(code) ? code : "BUNDLE_FAILED" };
  }
}
