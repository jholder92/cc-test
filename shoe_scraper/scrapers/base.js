/**
 * Base scraper – shared HTTP helpers, price parsing, and the Deal shape.
 * All retailer scrapers extend this class.
 */
import axios from "axios";
import * as cheerio from "cheerio";

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "en-GB,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  Connection: "keep-alive",
};

/**
 * @typedef {Object} Deal
 * @property {string} retailer        - Shop name e.g. "SportShoes"
 * @property {string} name            - Product title
 * @property {string} url             - Full product / listing URL
 * @property {number} originalPrice   - Full RRP
 * @property {number} salePrice       - Discounted price
 * @property {number} discountPct     - e.g. 35 (meaning 35% off)
 * @property {string} currency        - "GBP" | "EUR"
 * @property {string|null} brand      - Brand name if available
 * @property {string|null} imageUrl   - Product image URL
 */

/** Sleep for a random duration between min and max seconds */
export function politeDelay(minMs = 1500, maxMs = 3500) {
  const ms = Math.floor(Math.random() * (maxMs - minMs) + minMs);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Parse a price string like "£49.99" or "49,99 €" → 49.99 */
export function parsePrice(text) {
  if (!text) return null;
  const cleaned = text.replace(/[£€$\s\u00a0]/g, "").replace(",", ".");
  const match = cleaned.match(/[\d]+\.?\d*/);
  return match ? parseFloat(match[0]) : null;
}

/** Calculate % discount between original and sale price */
export function calcDiscount(original, sale) {
  if (!original || original <= 0) return 0;
  return parseFloat(((1 - sale / original) * 100).toFixed(1));
}

export class BaseScraper {
  /** @type {string} */
  retailerName = "";
  /** @type {string} */
  baseUrl = "";
  /** Minimum discount % to include */
  minDiscount = 10;

  /**
   * Fetch a URL and return a Cheerio $ instance (like jQuery for the page).
   * Retries up to `retries` times with exponential back-off.
   */
  async getPage(url, params = {}, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const response = await axios.get(url, {
          headers: BROWSER_HEADERS,
          params,
          timeout: 15_000,
          // Decompress automatically
          responseType: "text",
        });
        return cheerio.load(response.data);
      } catch (err) {
        console.warn(
          `[${this.retailerName}] Attempt ${attempt}/${retries} failed for ${url}: ${err.message}`
        );
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)));
        }
      }
    }
    console.error(`[${this.retailerName}] All retries exhausted for ${url}`);
    return null;
  }

  /**
   * Override this in each retailer scraper.
   * @returns {Promise<Deal[]>}
   */
  async getDeals() {
    throw new Error(`${this.retailerName}: getDeals() not implemented`);
  }
}
