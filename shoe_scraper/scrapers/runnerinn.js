/**
 * Scraper for RunnerInn (runnerinn.com) – international shipping to UK.
 *
 * RunnerInn is part of the Tradeinn group and runs on a custom React frontend.
 * Their product cards often include data-* attributes with raw price numbers,
 * which we prefer over parsing formatted price strings.
 *
 * Strategy:
 *  1. Navigate with Playwright (handles JS rendering + Cloudflare challenges).
 *  2. Sort by discount (order=discount) so best deals come first.
 *  3. Extract prices from data attributes where available, fall back to text.
 *
 * Currency: EUR (prices shown in EUR; they ship to UK)
 * URL: https://www.runnerinn.com/running-shoes-road/?order=discount
 */
import { BaseScraper } from "./base.js";

const BASE_URL = "https://www.runnerinn.com";
const CATEGORY_URL = `${BASE_URL}/running-shoes-road/`;
const MAX_PAGES = 5;

export class RunnerInnScraper extends BaseScraper {
  retailerName = "RunnerInn";
  baseUrl = BASE_URL;

  async getDeals() {
    return this.withPage(async (page) => {
      const allDeals = [];

      for (let pageNum = 1; pageNum <= MAX_PAGES; pageNum++) {
        const url = `${CATEGORY_URL}?order=discount${pageNum > 1 ? `&page=${pageNum}` : ""}`;
        console.log(`[RunnerInn] Fetching page ${pageNum}: ${url}`);
        await this.goto(page, url);

        // Wait for product cards to render
        try {
          await page.waitForSelector(
            ".product, .ProductCard, [class*='product-card'], [class*='ProductCard'], article",
            { timeout: 12_000 }
          );
        } catch {
          console.log(`[RunnerInn] No product cards on page ${pageNum}, stopping.`);
          break;
        }

        const deals = await page.$$eval(
          ".product, .ProductCard, [class*='product-card'], [class*='ProductCard'], article",
          (cards, minDiscount) => {
            const parseP = (t) => {
              if (!t) return null;
              const m = String(t).replace(/[€£$\s,]/g, "").match(/\d+\.?\d*/);
              return m ? parseFloat(m[0]) : null;
            };

            const results = [];
            for (const card of cards) {
              const linkEl = card.querySelector("a[href]");
              if (!linkEl) continue;

              const name = (
                card.querySelector(".product-name, .product-title, h2, h3, [class*='name'], [class*='Name']")?.textContent || ""
              ).trim();
              if (!name) continue;

              // Prefer data attributes (raw numeric values) over formatted text
              const rawOriginal =
                card.querySelector("[data-original-price]")?.dataset?.originalPrice ||
                card.querySelector("[data-regular-price]")?.dataset?.regularPrice;
              const rawSale =
                card.querySelector("[data-price]")?.dataset?.price ||
                card.querySelector("[data-sale-price]")?.dataset?.salePrice;

              let original = rawOriginal ? parseFloat(rawOriginal) : null;
              let sale = rawSale ? parseFloat(rawSale) : null;

              // Text fallbacks
              if (!original)
                original = parseP(card.querySelector(".original-price, .old-price, del, s, [class*='old'], [class*='original']")?.textContent);
              if (!sale)
                sale = parseP(card.querySelector(".current-price, .sale-price, .special-price, ins, [class*='current'], [class*='special']")?.textContent);

              if (!original || !sale || sale >= original) continue;

              const discount = parseFloat(((1 - sale / original) * 100).toFixed(1));
              if (discount < minDiscount) continue;

              const img =
                card.querySelector("img[data-src]")?.dataset?.src ||
                card.querySelector("img")?.src ||
                null;

              const brand = card.querySelector("[class*='brand'], .brand")?.textContent?.trim() || null;

              results.push({ name, url: linkEl.href, originalPrice: original, salePrice: sale, discountPct: discount, imageUrl: img, brand });
            }
            return results;
          },
          this.minDiscount
        );

        deals.forEach((d) =>
          allDeals.push({ retailer: this.retailerName, currency: "EUR", ...d })
        );
        console.log(`[RunnerInn] Page ${pageNum}: ${deals.length} deals`);

        if (deals.length === 0) break;
        await this.politeDelay();
      }

      return allDeals;
    });
  }
}
