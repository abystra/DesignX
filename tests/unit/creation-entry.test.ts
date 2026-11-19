import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import { creationEntries, materialFor } from "../../src/lib/creation-entry.js";
import { normalizeAsset } from "../../src/lib/creative-capabilities.js";
import {
  trustedProxy,
  requestLimitKey,
} from "../../apps/api/src/client-identity.js";

test("stock and text references never masquerade as uploaded asset IDs", () => {
  assert.deepEqual(
    materialFor({
      id: "reference-123",
      assetId: "stock-coffee",
      image: "/assets/coffee.jpg",
    }),
    { kind: "stock", id: "stock-coffee" },
  );
  assert.equal(
    normalizeAsset({ assetId: "stock-coffee", image: "/assets/coffee.jpg" })
      .assetId,
    undefined,
  );
  assert.equal(
    materialFor({ id: "reference-123", prompt: "只用文字" }),
    undefined,
  );
  assert.deepEqual(
    materialFor({
      id: "reference-123",
      image: "/api/assets/a/versions/v/file",
    }),
    { kind: "asset", id: "a", versionId: "v" },
  );
});
test("public tools contain real manual operations and registered recipes, with presets gated separately", () => {
  const entries = creationEntries(
    {
      modes: [{ id: "design", enabled: false }],
      recipes: [{ id: "multi-size", enabled: true }],
    },
    [{ id: "preset", name: "海报提示", category: "海报" }],
  );
  assert.equal(
    entries.filter((item) => item.kind === "manual" && item.enabled).length,
    4,
  );
  assert.equal(entries.find((item) => item.id === "multi-size")?.enabled, true);
  assert.equal(entries.find((item) => item.id === "preset")?.enabled, false);
  assert.equal(creationEntries(null).filter((item) => item.enabled).length, 4);
});
test("only loopback proxy peers may set client IP; authenticated users have independent budgets", async () => {
  const app = Fastify({ trustProxy: trustedProxy });
  app.addHook("onRequest", async (request) => {
    // Explicit test identity; production uses the verified durable session.
    if (request.headers["test-user"])
      request.identity = {
        user: { id: String(request.headers["test-user"]), name: "", email: "" },
        workspace: { id: "", name: "" },
        tokenHash: "",
      };
  });
  await app.register(rateLimit, {
    max: 1,
    timeWindow: "1 minute",
    keyGenerator: requestLimitKey,
  });
  app.get("/resource", async (request) => ({ ip: request.ip }));
  try {
    const proxy = await app.inject({
      url: "/resource",
      remoteAddress: "127.0.0.1",
      headers: { "x-forwarded-for": "203.0.113.1" },
    });
    assert.equal(proxy.json().ip, "203.0.113.1");
    const direct = await app.inject({
      url: "/resource",
      remoteAddress: "192.0.2.10",
      headers: { "x-forwarded-for": "203.0.113.2" },
    });
    assert.equal(direct.json().ip, "192.0.2.10");
    assert.equal(
      (
        await app.inject({
          url: "/resource",
          remoteAddress: "192.0.2.10",
          headers: { "x-forwarded-for": "203.0.113.3" },
        })
      ).statusCode,
      429,
    );
    for (const user of ["one", "two"])
      assert.equal(
        (await app.inject({ url: "/resource", headers: { "test-user": user } }))
          .statusCode,
        200,
      );
    assert.equal(
      (await app.inject({ url: "/resource", headers: { "test-user": "one" } }))
        .statusCode,
      429,
    );
  } finally {
    await app.close();
  }
});
