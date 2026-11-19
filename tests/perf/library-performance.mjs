// Reproducible frontend comparison: G4 built assets and G5 built assets, same API/schema/fixtures.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { chromium } from "playwright";
import { tenantTransaction } from "../../packages/server-infra/src/db.ts";
assert.equal(process.env.DESIGNX_TEST_ENV, "true");
const isDocument = (path) =>
  /^\/api\/projects\/[^/]+$/.test(path) && path !== "/api/projects/page";
const baseline = process.env.DESIGNX_PERF_BASELINE === "true",
  base = process.env.DESIGNX_E2E_URL,
  output = new URL(
    `../e2e/.artifacts/performance-${baseline ? "baseline" : "optimized"}-${Date.now()}/`,
    import.meta.url,
  );
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true }),
  context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  }),
  page = await context.newPage();
page.setDefaultTimeout(60000);
const errors = [],
  measurements = [];
page.on("pageerror", (e) => {
  if (!e.message.includes("Failed to fetch dynamically imported module"))
    errors.push(e.message);
});
async function api(path, data) {
  const r = await context.request.fetch(base + "/api" + path, {
    method: data ? "POST" : "GET",
    data,
    headers: { Origin: base },
  });
  assert.ok(r.ok(), path + ": " + r.status());
  return r.json();
}
try {
  const identity = await api("/auth/register", {
      username: "perf_" + randomUUID().slice(0, 8),
      password: "isolated-performance-password",
    }),
    workspace = identity.workspace.id;
  const nodes = Array.from({ length: 1000 }, (_, n) => ({
    id: "node-" + n,
    type: n % 2 ? "text" : "rect",
    x: (n % 25) * 48,
    y: Math.floor(n / 25) * 40,
    w: 46,
    h: 38,
    ...(n % 2
      ? { text: "海报" + n, size: 10, color: "#292B2E", font: "Noto Sans SC" }
      : { color: n % 4 ? "#FFF0EA" : "#346447" }),
  }));
  const large = { width: 1200, height: 1600, background: "#ffffff", nodes },
    small = { ...large, nodes: nodes.slice(0, 3) };
  await tenantTransaction(workspace, async (tx) => {
    await tx.query(
      `INSERT INTO projects(id,workspace_id,title,workspace_mode,updated_at) SELECT $1||'-p-'||n,$1,'性能作品 '||lpad(n::text,4,'0'),'editor','2024-01-01'::timestamptz+n*interval '1 second' FROM generate_series(1,1006) n`,
      [workspace],
    );
    await tx.query(
      `INSERT INTO documents(id,workspace_id,project_id,kind,title,content) SELECT p.id||'-doc',p.workspace_id,p.id,'artboard',p.title,CASE WHEN right(p.title,4)::int>982 THEN $1::jsonb ELSE $2::jsonb END FROM projects p`,
      [JSON.stringify(large), JSON.stringify(small)],
    );
    await tx.query("UPDATE projects SET primary_artboard_id=id||'-doc'");
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  async function measure(route, label) {
    const requests = [],
      bodies = [];
    const onResponse = (r) => {
      const url = new URL(r.url());
      if (url.origin !== base) return;
      requests.push({ path: url.pathname, status: r.status() });
      if (
        url.pathname.endsWith(".js") ||
        isDocument(url.pathname) ||
        url.pathname.startsWith("/api/previews/")
      )
        bodies.push(
          r
            .body()
            .then((b) => ({
              path: url.pathname,
              bytes: b.length,
              gzipBytes: gzipSync(b).length,
            }))
            .catch(() => ({ path: url.pathname, bytes: 0, gzipBytes: 0 })),
        );
    };
    page.on("response", onResponse);
    const started = performance.now();
    await page.goto(base + "/?perf=" + randomUUID() + "/#" + route);
    await page.locator(".app-shell[aria-busy=false]").waitFor();
    await page.evaluate(() => document.fonts.ready);
    if (route === "projects") {
      await page.waitForFunction(
        () => document.querySelectorAll(".ws-project-card").length === 24,
      );
      if (baseline)
        await page.waitForFunction(
          () =>
            document.querySelectorAll(".ws-project-card .dx-artboard").length >=
            6,
        );
      else
        await page.waitForFunction(
          () =>
            document.querySelectorAll(".ws-project-card .dx-preview-image")
              .length >= 6,
        );
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all(
          [...document.querySelectorAll(".ws-project-card img")].map((i) =>
            i.decode(),
          ),
        );
      });
    }
    const elapsedMs = Math.round(performance.now() - started),
      metrics = (await cdp.send("Performance.getMetrics")).metrics,
      resources = await Promise.all(bodies);
    page.removeListener("response", onResponse);
    // CDP task/script/layout counters reset on a document navigation.
    const delta = (name) =>
      Math.round((metrics.find((m) => m.name === name)?.value || 0) * 1000);
    const result = {
      label,
      elapsedMs,
      taskMs: delta("TaskDuration"),
      scriptMs: delta("ScriptDuration"),
      layoutMs: delta("LayoutDuration"),
      domNodes: await page.locator("*").count(),
      requests: requests.length,
      scriptBytes: resources
        .filter((r) => r.path.endsWith(".js"))
        .reduce((n, r) => n + r.bytes, 0),
      scriptGzipBytes: resources
        .filter((r) => r.path.endsWith(".js"))
        .reduce((n, r) => n + r.gzipBytes, 0),
      fullDocumentRequests: requests.filter((r) => isDocument(r.path)).length,
      fullDocumentBytes: resources
        .filter((r) => isDocument(r.path))
        .reduce((n, r) => n + r.bytes, 0),
      previewImages: await page.locator(".dx-preview-image").count(),
    };
    measurements.push(result);
    await page.screenshot({ path: new URL(label + ".png", output).pathname });
    return result;
  }
  const home = await measure("home", "cold-home");
  const list = await measure("projects", "cold-large-library");
  // Scroll and load four pages (96 cards) without walking all 1006 records.
  for (let n = 0; n < 3; n++) {
    await page
      .getByRole("button", { name: "加载更多作品", exact: true })
      .click();
    await page.waitForFunction(
      (count) => document.querySelectorAll(".ws-project-card").length === count,
      24 * (n + 2),
    );
  }
  await page.locator(".ws-project-card").last().scrollIntoViewIfNeeded();
  assert.equal(await page.locator(".ws-project-card").count(), 96);
  if (!baseline)
    assert.equal(
      await page.locator(".ws-project-card .dx-artboard").count(),
      0,
    );
  const warm = await measure("projects", "warm-large-library");
  // Five concurrent scoped reads, repeated to expose serial bottlenecks without abusing production.
  const samples = [];
  for (let n = 0; n < 5; n++) {
    const start = performance.now();
    const pages = await Promise.all(
      Array.from({ length: 5 }, () => api("/projects/page")),
    );
    assert.ok(pages.every((p) => p.total === 1006 && p.items.length === 24));
    samples.push(Math.round(performance.now() - start));
  }
  measurements.push({
    label: "5-concurrent-metadata-reads",
    samplesMs: samples,
  });
  if (!baseline) {
    assert.ok(home.scriptGzipBytes < 220000, "initial JS gzip budget 220 KB");
    assert.equal(list.fullDocumentRequests, 0);
    assert.ok(list.domNodes < 2500, "first page DOM budget 2500");
    assert.ok(warm.elapsedMs < 8000, "warm list local budget 8 seconds");
    assert.ok(
      list.elapsedMs < 60000,
      "cold first preview local budget 60 seconds",
    );
  }
  if (!baseline) {
    await page.route("**/assets/Editor-*.js", (route) => route.abort("failed"));
    await page.goto(base + "/#editor/" + workspace + "-p-1");
    await page
      .getByRole("button", { name: "重新加载界面", exact: true })
      .waitFor();
    await page.unroute("**/assets/Editor-*.js");
    await page
      .getByRole("button", { name: "重新加载界面", exact: true })
      .click();
    await page.locator(".ed-root[aria-busy=false]").waitFor();
    measurements.push({
      label: "dynamic-editor-chunk-failure",
      result: "explicit reload keeps route and opens persisted project",
    });
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ baseline, measurements }));
} catch (error) {
  errors.push(error.message);
  throw error;
} finally {
  await writeFile(
    new URL("results.json", output),
    JSON.stringify(
      {
        baseline,
        fixture:
          "1006 projects; latest 24 each have 1000 nodes; 96-card scroll; 5 concurrent clients; loopback Chromium, no CPU/network throttle; G4/G5 frontend compare uses same G5 API",
        measurements,
        errors,
      },
      null,
      2,
    ),
  );
  await browser.close();
}
