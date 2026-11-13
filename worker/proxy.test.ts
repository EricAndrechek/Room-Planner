import { test } from "node:test";
import assert from "node:assert/strict";
import { mapIngestPath } from "./proxy.ts";

const m = (p: string) => mapIngestPath(new URL("https://roomplanner.andrechek.com" + p));

test("static + array go to assets host", () => {
  assert.deepEqual(m("/ingest/static/array.js"), { url: "https://us-assets.i.posthog.com/static/array.js", isAsset: true });
  assert.equal(m("/ingest/array/phc_x/config.js")?.url, "https://us-assets.i.posthog.com/array/phc_x/config.js");
});
test("api paths go to api host, query preserved", () => {
  assert.deepEqual(m("/ingest/e/?ip=1&v=2"), { url: "https://us.i.posthog.com/e/?ip=1&v=2", isAsset: false });
  assert.equal(m("/ingest/flags?v=2")?.url, "https://us.i.posthog.com/flags?v=2");
  assert.equal(m("/ingest")?.url, "https://us.i.posthog.com/");
});
test("non-ingest paths are not proxied", () => {
  assert.equal(m("/"), null);
  assert.equal(m("/ingestion"), null);
  assert.equal(m("/_astro/x.js"), null);
});
