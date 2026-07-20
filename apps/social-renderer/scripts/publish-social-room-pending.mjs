import { chromium } from "playwright";

const frontendUrl = process.env.FRONTEND_URL || "https://mundial.hadox.org";
const apiUrl = process.env.API_URL || "https://api-mundial.hadox.org";
const adminToken = process.env.ADMIN_TOKEN || "";
const limit = Number.parseInt(process.env.SOCIAL_BATCH_SIZE || "2", 10) || 2;
const loop = ["1", "true", "yes"].includes((process.env.SOCIAL_RENDERER_LOOP || "").toLowerCase());
const intervalSeconds = Number.parseInt(process.env.SOCIAL_RENDERER_INTERVAL_SECONDS || "600", 10) || 600;

if (!adminToken) {
  console.error("Missing ADMIN_TOKEN");
  process.exit(2);
}

async function pendingCandidates() {
  const url = new URL("/admin/social/publish-pending", apiUrl);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("publish", "false");
  const response = await fetch(url, {
    method: "POST",
    headers: { "X-Admin-Token": adminToken },
  });
  if (!response.ok) {
    throw new Error(`Pending request failed ${response.status}: ${await response.text()}`);
  }
  const payload = await response.json();
  return (payload.results || [])
    .filter((item) => item?.source_id && !["published", "manual_shared", "deleted", "skipped", "publishing"].includes(item.status))
    .map((item) => item.source_id);
}

async function renderAndPublish(browser, sourceId, variant = 0) {
  const url = new URL("/admin/social-room/", frontendUrl);
  url.searchParams.set("autoSocialSource", sourceId);
  url.searchParams.set("autoPublish", "1");
  url.searchParams.set("adminToken", adminToken);
  url.searchParams.set("variant", String(variant));

  const page = await browser.newPage({ viewport: { width: 1280, height: 1600 }, deviceScaleFactor: 1 });
  try {
    await page.goto(url.toString(), { waitUntil: "networkidle", timeout: 90000 });
    const result = await page.waitForFunction(
      () => window.__MUNDIAL_SOCIAL_RENDER_RESULT__,
      null,
      { timeout: 120000 },
    );
    const payload = await result.jsonValue();
    if (!payload?.ok) {
      throw new Error(payload?.error || "Social Room renderer failed");
    }
    return payload;
  } finally {
    await page.close();
  }
}

async function cycle() {
  const candidates = await pendingCandidates();
  if (!candidates.length) {
    console.log(JSON.stringify({ published: 0, candidates: 0 }));
    return;
  }
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const [index, sourceId] of candidates.entries()) {
      results.push(await renderAndPublish(browser, sourceId, index));
    }
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify({ published: results.length, results }, null, 2));
}

do {
  try {
    await cycle();
  } catch (error) {
    console.error(error instanceof Error ? error.stack || error.message : error);
    if (!loop) process.exit(1);
  }
  if (!loop) break;
  await new Promise((resolve) => setTimeout(resolve, intervalSeconds * 1000));
} while (true);
