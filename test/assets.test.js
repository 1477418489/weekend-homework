import assert from "node:assert/strict";
import test from "node:test";

import { assetCacheControl, injectAssetVersions } from "../worker/index.js";

const LONG_CACHE = "public, max-age=604800, immutable";

test("静态资源带对版本号走 7 天强缓存", () => {
  assert.equal(assetCacheControl(new URL("https://x/app.js?v=1.11.0"), "1.11.0"), LONG_CACHE);
  assert.equal(assetCacheControl(new URL("https://x/style.css?v=dev"), "dev"), LONG_CACHE);
});

test("无版本号或版本号不一致时不加长缓存", () => {
  assert.equal(assetCacheControl(new URL("https://x/app.js"), "1.11.0"), null);
  assert.equal(assetCacheControl(new URL("https://x/app.js?v=1.10.1"), "1.11.0"), null);
  assert.equal(assetCacheControl(new URL("https://x/app.js?v="), "1.11.0"), null);
});

test("index.html 里的 css / js 引用带上版本号", () => {
  const html = '<link rel="stylesheet" href="/style.css" /><script type="module" src="/app.js"></script>';
  const out = injectAssetVersions(html, "1.11.0");
  assert.match(out, /href="\/style\.css\?v=1\.11\.0"/);
  assert.match(out, /src="\/app\.js\?v=1\.11\.0"/);
  assert.equal(out.includes('"/style.css"'), false);
});

test("没有版本号时原样返回，重复注入保持幂等", () => {
  const html = '<link href="/style.css" /><script src="/app.js"></script>';
  assert.equal(injectAssetVersions(html, ""), html);
  assert.equal(injectAssetVersions(html, undefined), html);
  const once = injectAssetVersions(html, "1.11.0");
  assert.equal(injectAssetVersions(once, "1.11.0"), once);
});