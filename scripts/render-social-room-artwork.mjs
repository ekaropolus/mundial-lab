import { chromium } from "playwright";

const sourceId = process.argv.find((arg) => arg.startsWith("--source-id="))?.split("=")[1] || "";
const publish = process.argv.includes("--publish");
const variant = process.argv.find((arg) => arg.startsWith("--variant="))?.split("=")[1] || "0";
const frontendUrl = process.env.FRONTEND_URL || "https://mundial.hadox.org";
const adminToken = process.env.ADMIN_TOKEN || "";

if (!sourceId) {
  console.error("Missing --source-id=<social_publication_source_id>");
  process.exit(2);
}

if (!adminToken) {
  console.error("Missing ADMIN_TOKEN");
  process.exit(2);
}

const url = new URL("/admin/social-room/", frontendUrl);
url.searchParams.set("autoSocialSource", sourceId);
url.searchParams.set("autoPublish", publish ? "1" : "0");
url.searchParams.set("adminToken", adminToken);
url.searchParams.set("variant", variant);

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1600 }, deviceScaleFactor: 1 });
  await page.goto(url.toString(), { waitUntil: "networkidle", timeout: 90000 });
  const result = await page.waitForFunction(
    () => window.__MUNDIAL_SOCIAL_RENDER_RESULT__,
    null,
    { timeout: 120000 },
  );
  const payload = await result.jsonValue();
  console.log(JSON.stringify(payload, null, 2));
  if (!payload?.ok) process.exit(1);
} finally {
  await browser.close();
}
