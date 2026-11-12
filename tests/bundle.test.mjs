import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ASSETS } from "../lib/parse.mjs";
import { buildOsBundle, writeOsBundle, BUNDLE_SCHEMA, BUNDLE_PATH, BUNDLE_MAX_BYTES } from "../lib/bundle.mjs";

const NOW = new Date("2026-11-11T07:45:00Z");
const RUN_AT = "2026-11-11T07:43:51.272Z";
const F = "2026-11-11T07:43:51.272Z";

// 합성 자료: 8종 모두, 2026-09-01부터 11-11까지(창 밖·주말 포함).
function fixture() {
  const status = { runAt: RUN_AT, flows: {}, funds: {}, market: {} };
  const flows = {}, funds = {}, market = {};
  for (const [asset, cfg] of Object.entries(ASSETS)) {
    status.flows[asset] = { ok: true, added: 1, revised: 0, latestDate: "2026-11-10", totalDays: 30 };
    status.market[asset] = { ok: true, added: 1, revised: 0, latestDate: "2026-11-11" };
    if (cfg.funds) status.funds[asset] = { ok: true, added: 1, revised: 0, latestDate: "2026-11-10" };
    const fr = {}, mr = {}, ur = {};
    for (let t = Date.parse("2026-09-01T00:00:00Z"); t <= Date.parse("2026-11-11T00:00:00Z"); t += 86_400_000) {
      const date = new Date(t).toISOString().slice(0, 10);
      if (date <= "2026-11-10") fr[date] = { netFlowUsd: 1_000_000, fetchedAt: F, sourceUpdatedAt: F };
      mr[date] = { priceUsd: 100.5, marketCapUsd: 1e9, fetchedAt: F };
      if (cfg.funds && date <= "2026-11-10") ur[date] = { funds: [{ ticker: "ZZB", issuer: "Beta", netFlowUsd: 400_000 }, { ticker: "AAA", issuer: "Alpha", netFlowUsd: 600_000 }], complete: true, fetchedAt: F, sourceUpdatedAt: F };
    }
    flows[asset] = { asset, unit: "USD", source: "CryptoETF.today", rows: fr };
    market[asset] = { asset, coinId: cfg.coin, unit: "USD", source: "CoinGecko market_chart (UTC 00:00)", rows: mr };
    funds[asset] = cfg.funds ? { asset, unit: "USD", source: "CryptoETF.today", rows: ur } : null;
  }
  return { status, flows, funds, market };
}

test("형식: 스키마·키 순서·8종 고정, 60일 창, 유출입 주말 제외·시장 주말 포함, 날짜 오름차순", () => {
  const { bundle, text, bytes } = buildOsBundle(fixture(), { now: NOW });
  assert.deepEqual(Object.keys(bundle), ["schemaVersion", "generatedAt", "run", "window", "assets"]);
  assert.equal(bundle.schemaVersion, BUNDLE_SCHEMA);
  assert.equal(bundle.generatedAt, NOW.toISOString());
  assert.equal(bundle.run.runAt, RUN_AT);
  assert.deepEqual(bundle.window, { from: "2026-09-13", to: "2026-11-11" });
  assert.deepEqual(Object.keys(bundle.assets), ["BTC", "ETH", "SOL", "XRP", "HYPE", "LTC", "NEAR", "ZEC"]);
  assert.equal(text, JSON.stringify(bundle) + "\n");
  assert.equal(bytes, Buffer.byteLength(text));
  for (const a of Object.values(bundle.assets)) {
    assert.deepEqual(Object.keys(a), ["coinId", "flows", "funds", "market"]);
    for (const [kind, rows] of [["flows", a.flows.rows], ["market", a.market.rows], ["funds", a.funds?.rows ?? []]]) {
      const dates = rows.map((r) => r[0]);
      assert.deepEqual(dates, [...dates].sort());
      assert.equal(new Set(dates).size, dates.length);
      for (const d of dates) {
        assert(d >= "2026-09-13" && d <= "2026-11-11", d);
        if (kind !== "market") assert(![0, 6].includes(new Date(d + "T12:00:00Z").getUTCDay()), "weekend " + d);
      }
    }
    // OS는 금요일 유출입에 토요일 UTC 00:00 시총을 쓴다: 시장 자료의 토요일 행이 있어야 한다.
    assert(a.market.rows.some((r) => new Date(r[0] + "T12:00:00Z").getUTCDay() === 6), "market keeps Saturday");
  }
  assert.equal(bundle.assets.BTC.flows.rows.at(-1)[0], "2026-11-10");
  assert.equal(bundle.assets.BTC.market.rows.at(-1)[0], "2026-11-11");
  assert.deepEqual(bundle.assets.BTC.market.rows.at(-1), ["2026-11-11", 100.5, 1e9]);
  assert.equal(bundle.assets.BTC.coinId, "bitcoin");
  assert.equal(bundle.assets.BTC.funds, null);
});

test("runAt·실행 결과를 넣고, 오류는 고정 코드만 남긴다", () => {
  const input = fixture();
  input.status.flows.SOL = { ok: false, error: "HTTP_429" };
  input.status.market.ETH = { ok: false, error: "Unexpected token < in JSON at position 0" };
  const { bundle } = buildOsBundle(input, { now: NOW });
  assert.equal(bundle.run.runAt, RUN_AT);
  assert.deepEqual(bundle.run.flows.BTC, { ok: true, latestDate: "2026-11-10" });
  assert.deepEqual(bundle.run.flows.SOL, { ok: false, latestDate: null, error: "HTTP_429" });
  assert.deepEqual(bundle.run.market.ETH, { ok: false, latestDate: null, error: "UNKNOWN" });
  assert.deepEqual(Object.keys(bundle.run.funds), ["XRP", "LTC", "NEAR"]);
});

test("null은 null로 남고 0은 0으로 남는다", () => {
  const input = fixture();
  input.flows.BTC.rows["2026-11-09"].netFlowUsd = null;
  input.flows.BTC.rows["2026-11-06"].netFlowUsd = 0;
  input.market.ETH.rows["2026-11-10"].marketCapUsd = null;
  delete input.market.ETH.rows["2026-11-09"].priceUsd;
  const { bundle } = buildOsBundle(input, { now: NOW });
  const btc = Object.fromEntries(bundle.assets.BTC.flows.rows);
  assert.equal(btc["2026-11-09"], null);
  assert.equal(btc["2026-11-06"], 0);
  const eth = Object.fromEntries(bundle.assets.ETH.market.rows.map(([d, p, c]) => [d, [p, c]]));
  assert.deepEqual(eth["2026-11-10"], [100.5, null]);
  assert.deepEqual(eth["2026-11-09"], [null, 1e9]);
});

test("운용사: 티커 정렬·운용사 이름, 규칙에 맞지 않는 날은 운용사 자료만 빠지고 합계는 남는다", () => {
  const input = fixture();
  input.funds.XRP.rows["2026-11-10"].funds.push({ ticker: "BAD.T", issuer: "Odd", netFlowUsd: 0 });
  input.funds.XRP.rows["2026-11-09"].funds[0].netFlowUsd = null;
  input.funds.XRP.rows["2026-11-06"].funds = [];
  const { bundle } = buildOsBundle(input, { now: NOW });
  const xrp = bundle.assets.XRP;
  const byDate = Object.fromEntries(xrp.funds.rows);
  assert.equal(byDate["2026-11-10"], undefined);
  assert.equal(byDate["2026-11-06"], undefined);
  assert.deepEqual(Object.keys(byDate["2026-11-05"]), ["AAA", "ZZB"]);
  assert.deepEqual(byDate["2026-11-09"], { AAA: 600_000, ZZB: null });
  assert.deepEqual(xrp.funds.issuers, { AAA: "Alpha", ZZB: "Beta" });
  assert(Object.fromEntries(xrp.flows.rows)["2026-11-10"] === 1_000_000);
});

test("이상한 저장 자료는 묶음을 만들지 않는다", () => {
  for (const mutate of [
    (i) => { i.flows.BTC.rows["2026-11-10"].netFlowUsd = 1.5; },
    (i) => { i.flows.BTC.rows["2026-11-10"].netFlowUsd = "1"; },
    (i) => { i.market.BTC.rows["2026-11-10"].priceUsd = -1; },
    (i) => { i.market.BTC.coinId = "ethereum"; },
    (i) => { i.flows.ETH.asset = "BTC"; },
    (i) => { i.flows.BTC.rows["2026-02-30"] = { netFlowUsd: 1 }; },
    (i) => { i.status.runAt = "not-a-time"; },
    (i) => { delete i.flows.NEAR; },
  ]) {
    const input = fixture();
    mutate(input);
    assert.throws(() => buildOsBundle(input, { now: NOW }), /^Error: BUNDLE_/);
  }
  assert.throws(() => buildOsBundle(fixture(), { now: new Date("2026-11-11T07:00:00Z") }), /BUNDLE_RUN_AFTER_GENERATED/);
});

test("크기 상한을 넘으면 만들지 않는다", () => {
  assert(BUNDLE_MAX_BYTES < 256 * 1024);
  const input = fixture();
  for (let i = 0; i < 4000; i++) input.funds.XRP.rows["2026-11-10"].funds.push({ ticker: "T" + String(i).padStart(4, "0"), issuer: "x".repeat(90), netFlowUsd: 0 });
  assert.throws(() => buildOsBundle(input, { now: NOW }), /BUNDLE_TOO_LARGE/);
});

async function tempRoot(input) {
  const root = await mkdtemp(join(tmpdir(), "bundle-test-"));
  for (const d of ["flows", "funds", "market"]) await mkdir(join(root, "data", d), { recursive: true });
  await writeFile(join(root, "data/status.json"), JSON.stringify(input.status));
  for (const asset of Object.keys(ASSETS)) {
    await writeFile(join(root, `data/flows/${asset}.json`), JSON.stringify(input.flows[asset]));
    await writeFile(join(root, `data/market/${asset}.json`), JSON.stringify(input.market[asset]));
    if (input.funds[asset]) await writeFile(join(root, `data/funds/${asset}.json`), JSON.stringify(input.funds[asset]));
  }
  return root;
}

test("파일 쓰기: 내용이 같으면(생성 시각 제외) 다시 쓰지 않고, 실패해도 던지지 않으며 이전 파일을 남긴다", async () => {
  const root = await tempRoot(fixture());
  try {
    const first = await writeOsBundle({ root, now: NOW });
    assert.deepEqual({ ok: first.ok, written: first.written }, { ok: true, written: true });
    const saved = await readFile(join(root, BUNDLE_PATH), "utf8");
    assert.equal(JSON.parse(saved).generatedAt, NOW.toISOString());
    const again = await writeOsBundle({ root, now: new Date("2026-11-11T09:00:00Z") });
    assert.deepEqual({ ok: again.ok, written: again.written }, { ok: true, written: false });
    assert.equal(await readFile(join(root, BUNDLE_PATH), "utf8"), saved);
    await writeFile(join(root, "data/flows/BTC.json"), "{ broken");
    const failed = await writeOsBundle({ root, now: NOW });
    assert.equal(failed.ok, false);
    assert.equal(failed.written, false);
    assert.match(failed.error, /^[A-Z0-9_]{2,64}$/);
    assert.equal(await readFile(join(root, BUNDLE_PATH), "utf8"), saved);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("XRP·LTC·NEAR 중 운용사 파일이 없는 종목은 funds가 null이고 묶음 전체는 실패하지 않는다", async () => {
  const input = fixture();
  input.funds.LTC = null;
  const root = await tempRoot(input);
  try {
    const r = await writeOsBundle({ root, now: NOW });
    assert.equal(r.ok, true);
    const bundle = JSON.parse(await readFile(join(root, BUNDLE_PATH), "utf8"));
    assert.equal(bundle.assets.LTC.funds, null);
    assert.notEqual(bundle.assets.XRP.funds, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
