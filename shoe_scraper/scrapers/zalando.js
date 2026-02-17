/**
 * Scraper for Zalando UK (zalando.co.uk)
 *
 * Strategy:
 *  1. Navigate with Playwright to the sale page for men's running shoes.
 *  2. Zalando is a React SPA – intercept their catalog API response (JSON)
 *     before it hits the DOM. This is more reliable than CSS selectors.
 *  3. Fall back to extracting application/ld+json structured data from the page.
 *  4. Fall back to DOM scraping of rendered product cards.
 *
 * ⚠️  Zalando detects bots. Use longer delays. If you get blocked, try running
 *     headless: false so a real browser window opens (less suspicious).
 */
import { BaseScraper } from "./base.js";

const BASE_URL = "https://www.zalando.co.uk";
const SALE_URL = `${BASE_URL}/mens-running-shoes/?sale=true&q=road+running`;
const MAX_PAGES = 3;
const PAGE_SIZE = 24;

export class ZalandoScraper extends BaseScraper {
  retailerName = "Zalando";
  baseUrl = BASE_URL;

  async getDeals() {
    return this.withPage(async (page) => {
      const allDeals = [];

      // ── Intercept Zalando's catalog API calls ───────────────────────────────
      // Zalando fetches products via a GraphQL or REST endpoint – we capture it.
      const interceptedProducts = [];
      await page.route("**/*catalog*", async (route) => {
        const response = await route.fetch();
        try {
          const json = await response.json();
          const products = this._extractFromApiResponse(json);
          interceptedProducts.push(...products);
        } catch {
          // Not a JSON response or not a catalog endpoint
        }
        await route.fulfill({ response });
      });

      for (let pageNum = 1; pageNum <= MAX_PAGES; pageNum++) {
        const offset = (pageNum - 1) * PAGE_SIZE;
        const url = `${SALE_URL}&offset=${offset}`;
        console.log(`[Zalando] Fetching page ${pageNum}: ${url}`);

        interceptedProducts.length = 0; // reset capture buffer
        await this.goto(page, url);

        // Give JS time to fire API requests
        await this.delay(3000);

        if (interceptedProducts.length > 0) {
          // Use intercepted API data
          const deals = interceptedProducts
            .filter((p) => p.discountPct >= this.minDiscount)
            .map((p) => ({ retailer: this.retailerName, currency: "GBP", ...p }));
          allDeals.push(...deals);
          console.log(`[Zalando] Page ${pageNum}: ${deals.length} deals from API intercept`);
        } else {
          // ── Fallback 1: application/ld+json embedded in page ──────────────
          const ldDeals = await this._extractLdJson(page);
          if (ldDeals.length > 0) {
            allDeals.push(...ldDeals);
            console.log(`[Zalando] Page ${pageNum}: ${ldDeals.length} deals from ld+json`);
          } else {
            // ── Fallback 2: DOM scraping of rendered cards ─────────────────
            const domDeals = await this._scrapeDom(page);
            allDeals.push(...domDeals);
            console.log(`[Zalando] Page ${pageNum}: ${domDeals.length} deals from DOM`);
            if (domDeals.length === 0) break;
          }
        }

        // Zalando rate-limits aggressively – long delay between pages
        await this.politeDelay(4000, 7000);
      }

      return allDeals;
    });
  }

  _extractFromApiResponse(json) {
    const results = [];
    try {
      // Zalando's catalog API returns entities with price ranges
      const articles = json?.articles ?? json?.products ?? json?.data?.articles ?? [];
      for (const a of articles) {
        const name = a.name || a.displayName;
        if (!name) continue;

        const priceInfo = a.price ?? a.displayPrice ?? {};
        const original = parseFloat(priceInfo.original?.value ?? priceInfo.rrp?.value ?? 0);
        const sale = parseFloat(priceInfo.promotional?.value ?? priceInfo.current?.value ?? priceInfo.value ?? 0);

        if (!original || !sale || sale >= original) continue;

        const discountPct = this.calcDiscount(original, sale);
        if (discountPct < this.minDiscount) continue;

        results.push({
          name,
          url: a.uri ? `${this.baseUrl}${a.uri}` : (a.url || ""),
          originalPrice: original,
          salePrice: sale,
          discountPct,
          brand: a.brand?.name ?? null,
          imageUrl: a.media?.[0]?.uri ?? a.image ?? null,
        });
      }
    } catch {
      // Unexpected API shape – handled by fallbacks
    }
    return results;
  }

  async _extractLdJson(page) {
    const deals = [];
    try {
      const jsonBlocks = await page.$$eval(
        'script[type="application/ld+json"]',
        (els) => els.map((el) => el.textContent)
      );
      for (const block of jsonBlocks) {
        try {
          const json = JSON.parse(block);
          if (json["@type"] === "ItemList" && Array.isArray(json.itemListElement)) {
            for (const item of json.itemListElement) {
              const offer = Array.isArray(item.offers) ? item.offers[0] : item.offers;
              if (!offer) continue;
              const sale = parseFloat(offer.price);
              const original = parseFloat(offer.highPrice ?? 0);
              if (!original || !sale || sale >= original) continue;
              const discountPct = this.calcDiscount(original, sale);
              if (discountPct < this.minDiscount) continue;
              deals.push({
                retailer: this.retailerName,
                name: item.name || "Unknown",
                url: item.url || "",
                originalPrice: original,
                salePrice: sale,
                discountPct,
                currency: offer.priceCurrency || "GBP",
                brand: item.brand?.name ?? null,
                imageUrl: item.image ?? null,
              });
            }
          }
        } catch {
          // skip malformed block
        }
      }
    } catch {
      // skip
    }
    return deals;
  }

  async _scrapeDom(page) {
    try {
      await page.waitForSelector(
        'article[class*="product"], [class*="ProductCard"], [data-testid*="product"]',
        { timeout: 8_000 }
      );
    } catch {
      return [];
    }

    return page.$$eval(
      'article[class*="product"], [class*="ProductCard"], [data-testid*="product"]',
      (cards, minDiscount) => {
        const results = [];
        for (const card of cards) {
          const linkEl = card.querySelector("a[href]");
          const name = card.querySelector("[class*='name'], [class*='Name'], h3, h2")?.textContent?.trim();
          if (!name || !linkEl) continue;

          const parseP = (t) => {
            if (!t) return null;
            const m = t.replace(/[£€$\s,]/g, "").match(/\d+\.?\d*/);
            return m ? parseFloat(m[0]) : null;
          };

          const original = parseP(card.querySelector("[class*='originalPrice'], [class*='crossed'], del, s")?.textContent);
          const sale = parseP(card.querySelector("[class*='promotionalPrice'], [class*='sale'], [class*='red']")?.textContent);

          if (!original || !sale || sale >= original) continue;
          const discount = parseFloat(((1 - sale / original) * 100).toFixed(1));
          if (discount < minDiscount) continue;

          results.push({
            name,
            url: linkEl.href,
            originalPrice: original,
            salePrice: sale,
            discountPct: discount,
            currency: "GBP",
            brand: card.querySelector("[class*='brand'], [class*='Brand']")?.textContent?.trim() ?? null,
            imageUrl: card.querySelector("img")?.src ?? null,
          });
        }
        return results;
      },
      this.minDiscount
    );
  }
}
