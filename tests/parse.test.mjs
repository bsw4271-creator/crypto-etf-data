import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAssetFlows, parseFundFlows, parseMarketChart, mergeRows } from "../lib/parse.mjs";

const NOW = new Date("2026-11-02T03:00:00Z");

test("자산 합계 유출입: 백만 달러를 달러로, null은 미확인으로 유지", () => {
  const r = parseAssetFlows("HYPE", { symbol: "HYP", updatedAt: "2026-11-01T22:00:00Z", days: [{ date: "2026-10-30", netFlowUsdM: -0.6 }, { date: "2026-10-31", netFlowUsdM: null }] }, NOW);
  assert.deepEqual(r.rows, [{ date: "2026-10-30", netFlowUsd: -600000 }, { date: "2026-10-31", netFlowUsd: null }]);
});

test("미래 날짜·중복 날짜·다른 종목 응답은 거부", () => {
  assert.throws(() => parseAssetFlows("BTC", { symbol: "BTC", updatedAt: "2026-11-01T00:00:00Z", days: [{ date: "2026-11-03", netFlowUsdM: 1 }] }, NOW));
  assert.throws(() => parseAssetFlows("BTC", { symbol: "BTC", updatedAt: "2026-11-01T00:00:00Z", days: [{ date: "2026-10-30", netFlowUsdM: 1 }, { date: "2026-10-30", netFlowUsdM: 2 }] }, NOW));
  assert.throws(() => parseAssetFlows("BTC", { symbol: "ETH", updatedAt: "2026-11-01T00:00:00Z", days: [] }, NOW));
});

test("펀드별 유출입: 하나라도 null이면 complete=false", () => {
  const r = parseFundFlows("XRP", { symbol: "XRP", updatedAt: "2026-11-01T00:00:00Z", days: [{ date: "2026-10-30", funds: [{ ticker: "XRPC", issuer: "Canary", netFlowUsdM: 1.5 }, { ticker: "XRPZ", issuer: "Franklin", netFlowUsdM: null }] }] }, NOW);
  assert.equal(r.rows[0].complete, false);
  assert.equal(r.rows[0].funds[0].netFlowUsd, 1500000);
});

test("CoinGecko: UTC 00:00만, 미래·0·장중 값 제외", () => {
  const d0 = Date.UTC(2026, 9, 31), d1 = Date.UTC(2026, 10, 1), intraday = Date.UTC(2026, 10, 1, 13), future = Date.UTC(2026, 10, 3);
  const r = parseMarketChart({ prices: [[d0, 100], [d1, 101], [intraday, 999], [future, 5]], market_caps: [[d0, 1e9], [d1, 0]] }, NOW.getTime());
  assert.deepEqual(r, { "2026-10-31": { priceUsd: 100, marketCapUsd: 1e9 }, "2026-11-01": { priceUsd: 101 } });
});

test("병합: 확인된 값을 null로 덮지 않고, 수정은 이력으로 남김", () => {
  const store = { "2026-10-30": { netFlowUsd: 100, fetchedAt: "a" } };
  const r = mergeRows(store, { "2026-10-30": { netFlowUsd: null }, "2026-10-31": { netFlowUsd: 5 } }, { fetchedAt: "b" });
  assert.equal(store["2026-10-30"].netFlowUsd, 100);
  assert.equal(r.added, 1);
  const r2 = mergeRows(store, { "2026-10-30": { netFlowUsd: 120 } }, { fetchedAt: "c" });
  assert.equal(r2.revised, 1);
  assert.equal(store["2026-10-30"].netFlowUsd, 120);
  assert.deepEqual(store["2026-10-30"].revisions, [{ field: "netFlowUsd", previous: 100, replacedAt: "c" }]);
});
