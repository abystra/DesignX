import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
const base = process.env.DESIGNX_E2E_URL,
  output = new URL(`./.artifacts/previews-${Date.now()}/`, import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true }),
  context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  }),
  page = await context.newPage(),
  checks = [],
  errors = [];
page.setDefaultTimeout(30000);
page.on("pageerror", (e) => errors.push(e.message));
async function api(path, data, method = data === undefined ? "GET" : "POST") {
  const r = await context.request.fetch(base + "/api" + path, {
    method,
    data,
    headers: { Origin: base },
  });
  assert.ok(r.ok(), path + ": " + r.status() + " " + (await r.text()));
  return r.json();
}
async function open(route) {
  await page.goto(base + "/#" + route);
  await page.locator(".app-shell[aria-busy=false]").waitFor();
}
async function imageReady() {
  await page.locator(".dx-preview-image").first().waitFor();
  await page
    .locator(".dx-preview-image")
    .first()
    .evaluate((i) => i.decode());
  const sizing = await page
    .locator(".dx-preview-image")
    .first()
    .evaluate((i) => ({
      fit: getComputedStyle(i).objectFit,
      height: i.getBoundingClientRect().height,
      viewport: i.closest(".ws-thumb").getBoundingClientRect().height,
    }));
  assert.equal(sizing.fit, "contain");
  assert.ok(
    sizing.height <= sizing.viewport + 1,
    "private preview must fit the card without clipping",
  );
}
function check(name) {
  checks.push(name);
  console.log("PASS", name);
}
try {
  await api("/auth/register", {
    username: "preview_" + randomUUID().slice(0, 8),
    password: "preview-browser-password",
  });
  const project = await api("/projects", {
    title: "版本缩略图",
    templateId: "t1",
    workspaceMode: "editor",
  });
  const fullReads = [];
  const onRequest = (r) => {
    if (new URL(r.url()).pathname === "/api/projects/" + project.id)
      fullReads.push(r.url());
  };
  page.on("request", onRequest);
  await open("projects");
  await imageReady();
  assert.equal(fullReads.length, 0);
  const oldUrl = await page
    .locator(".dx-preview-image")
    .first()
    .getAttribute("src");
  await page.screenshot({ path: new URL("ready.png", output).pathname });
  check("library uses a real private image without downloading the document");
  page.removeListener("request", onRequest);
  await page
    .getByRole("button", { name: "打开作品 版本缩略图", exact: true })
    .click();
  await page.locator(".ed-root[aria-busy=false]").waitFor();
  await page.getByLabel("文字内容", { exact: true }).fill("保存后更新缩略图");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.locator(".ed-save-state").filter({ hasText: "已保存" }).waitFor();
  await open("projects");
  await page.waitForFunction((old) => {
    const img = document.querySelector(".dx-preview-image");
    return img && img.getAttribute("src") !== old;
  }, oldUrl);
  await imageReady();
  check("lazy Editor opens; saved revision receives a new real thumbnail");
  let fail = true;
  await page.route("**/api/previews/*/file", async (route) => {
    if (fail) {
      await route.fulfill({ status: 503, body: "fixture image failure" });
    } else await route.continue();
  });
  await page.reload();
  await page
    .getByText("预览暂不可用，可在更多操作中重试", { exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "版本缩略图 更多操作", exact: true })
    .click();
  fail = false; // Keep the fault active until the user explicitly retries.
  await page.getByRole("button", { name: "重试作品预览", exact: true }).click();
  await imageReady();
  await page.unroute("**/api/previews/*/file");
  check(
    "image delivery failure remains visible and explicit menu retry restores the preview",
  );
  const second = await browser.newContext({
      storageState: await context.storageState(),
      viewport: { width: 390, height: 844 },
    }),
    phone = await second.newPage();
  phone.on("pageerror", (e) => errors.push(e.message));
  await phone.goto(base + "/#projects");
  await phone.locator(".dx-preview-image").first().waitFor();
  await phone
    .locator(".dx-preview-image")
    .first()
    .evaluate((i) => i.decode());
  assert.ok(
    await phone.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await phone.screenshot({ path: new URL("mobile.png", output).pathname });
  await second.close();
  check(
    "another viewport reuses the authorized preview and keeps mobile list usable",
  );
  const studio = await api("/projects", {
    title: "旧工作区预览",
    workspaceMode: "studio",
  });
  await open("studio/" + studio.id);
  await page.locator(".ai-studio").waitFor();
  await page.screenshot({ path: new URL("studio.png", output).pathname });
  check("lazy legacy Studio and Board still open");
  await api("/projects/" + project.id, undefined, "DELETE");
  assert.equal((await context.request.get(base + oldUrl)).status(), 404);
  check("deleted project denies the existing private image URL");
  assert.deepEqual(errors, []);
} catch (error) {
  errors.push(error.message);
  await page
    .screenshot({ path: new URL("failure.png", output).pathname })
    .catch(() => {});
  throw error;
} finally {
  await writeFile(
    new URL("results.json", output),
    JSON.stringify({ base, checks, errors }, null, 2),
  );
  await browser.close();
}
