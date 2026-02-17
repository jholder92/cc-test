/**
 * Base scraper using Playwright – launches a real Chromium browser so
 * JavaScript-rendered (React/Next.js) pages work correctly.
 *
 * @typedef {Object} Deal
 * @property {string}      retailer
 * @property {string}      name
 * @property {string}      url
 * @property {number}      originalPrice
 * @property {number}      salePrice
 * @property {number}      discountPct     e.g. 35 means 35% off
 * @property {string}      currency        "GBP" | "EUR"
 * @property {string|null} brand
 * @property {string|null} imageUrl
 */
import { chromium } from "playwright";

const LAUNCH_OPTIONS = {
  headless: true,
  args: [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-blink-features=AutomationControlled",
  ],
};

const CONTEXT_OPTIONS = {
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  locale: "en-GB",
  timezoneId: "Europe/London",
  extraHTTPHeaders: { "Accept-Language": "en-GB,en;q=0.9" },
  viewport: { width: 1280, height: 900 },
};

export class BaseScraper {
  retailerName = "";
  baseUrl = "";
  minDiscount = 10;

  /**
   * Opens a Playwright browser + page, calls fn(page), then closes everything.
   * Use this inside getDeals().
   */
  async withPage(fn) {
    const browser = await chromium.launch(LAUNCH_OPTIONS);
    try {
      const context = await browser.newContext(CONTEXT_OPTIONS);
      // Remove the webdriver flag that some anti-bot systems check
      await context.addInitScript(() => {
        Object.defineProperty(navigator, "webdriver", { get: () => false });
      });
      const page = await context.newPage();
      return await fn(page);
    } finally {
      await browser.close();
    }
  }

  /**
   * Navigate and wait for network to settle. Swallows timeout errors since
   * networkidle often times out on busy pages even when content is loaded.
   */
  async goto(page, url) {
    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
    } catch {
      console.warn(`[${this.retailerName}] networkidle timeout on ${url} – continuing`);
    }
  }

  /**
   * Pull the Next.js data payload that Next.js embeds in every page as
   * <script id="__NEXT_DATA__">. Returns null if not a Next.js site.
   */
  async extractNextData(page) {
    return page.evaluate(() => {
      const el = document.getElementById("__NEXT_DATA__");
      if (!el) return null;
      try { return JSON.parse(el.textContent); } catch { return null; }
    });
  }

  delay(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  politeDelay(minMs = 1500, maxMs = 3500) {
    return this.delay(Math.floor(Math.random() * (maxMs - minMs) + minMs));
  }

  /** "£49.99" / "49,99 €" / 49.99 → 49.99 */
  parsePrice(text) {
    if (text == null) return null;
    const cleaned = String(text).replace(/[£€$\s\u00a0]/g, "").replace(",", ".");
    const match = cleaned.match(/\d+\.?\d*/);
    return match ? parseFloat(match[0]) : null;
  }

  calcDiscount(original, sale) {
    if (!original || original <= 0) return 0;
    return parseFloat(((1 - sale / original) * 100).toFixed(1));
  }

  /** @returns {Promise<Deal[]>} */
  async getDeals() {
    throw new Error(`${this.retailerName}: getDeals() not implemented`);
  }
}
