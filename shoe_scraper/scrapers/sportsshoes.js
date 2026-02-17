/**
 * Scraper for sportsshoes.com  (Next.js / Chakra UI storefront)
 *
 * Strategy:
 *  1. Navigate with a real Playwright browser so React renders.
 *  2. Pull window.__NEXT_DATA__ – Next.js always embeds the full page props
 *     as JSON, which contains the product list without any CSS selector fragility.
 *  3. Filter to products that have a sale price lower than the original price.
 *
 * If __NEXT_DATA__ ever stops containing products, the DOM fallback kicks in
 * and waits for rendered product cards before scraping.
 *
 * URL given by user: https://www.sportsshoes.com/products/mens/running/shoes/road
 */
import { BaseScraper } from "./base.js";

const BASE_URL = "https://www.sportsshoes.com";
// Category page for men's road running shoes
const CATEGORY_URL = `${BASE_URL}/products/mens/running/shoes/road`;
// Max pages to paginate through
const MAX_PAGES = 5;

export class SportShoesScraper extends BaseScraper {
  retailerName = "SportShoes";
  baseUrl = BASE_URL;

  async getDeals() {
    return this.withPage(async (page) => {
      const allDeals = [];

      for (let pageNum = 1; pageNum <= MAX_PAGES; pageNum++) {
        const url = pageNum === 1 ? CATEGORY_URL : `${CATEGORY_URL}?page=${pageNum}`;
        console.log(`[SportShoes] Fetching page ${pageNum}: ${url}`);
        await this.goto(page, url);

        // ── Strategy 1: extract __NEXT_DATA__ JSON ──────────────────────────
        const nextData = await this.extractNextData(page);
        if (nextData) {
          const products = this._findProducts(nextData);
          if (products && products.length > 0) {
            const deals = products.flatMap((p) => this._productToDeal(p, url));
            allDeals.push(...deals);
            console.log(`[SportShoes] Page ${pageNum}: ${deals.length} deals from __NEXT_DATA__`);

            // Check if there's a next page
            if (!this._hasNextPage(nextData, pageNum)) break;
            await this.politeDelay();
            continue;
          }
        }

        // ── Strategy 2: wait for DOM and scrape rendered cards ───────────────
        try {
          // Wait up to 10s for at least one product card to appear
          await page.waitForSelector(
            'a[href*="/products/"], [data-testid*="product"], [class*="ProductCard"], [class*="product-card"]',
            { timeout: 10_000 }
          );
        } catch {
          console.log(`[SportShoes] No product cards found on page ${pageNum}, stopping.`);
          break;
        }

        const domDeals = await page.$$eval(
          'a[href*="/products/"]',
          (anchors, minDiscount) => {
            const seen = new Set();
            const results = [];
            for (const a of anchors) {
              const href = a.href;
              if (seen.has(href)) continue;
              seen.add(href);

              const card = a.closest('[class*="Card"], [class*="card"], [class*="Product"], article, li') || a;
              const name = card.querySelector('[class*="name"], [class*="Name"], h2, h3')?.textContent?.trim();
              if (!name) continue;

              // Look for strikethrough (original) price and sale price
              const delEl = card.querySelector("del, s, [class*='was'], [class*='Was'], [class*='original'], [class*='Original']");
              const saleEl = card.querySelector("ins, [class*='sale'], [class*='Sale'], [class*='now'], [class*='Now'], [class*='current'], [class*='Current']");

              const originalText = delEl?.textContent;
              const saleText = saleEl?.textContent || card.querySelector("[class*='price'], [class*='Price']")?.textContent;

              const parseP = (t) => {
                if (!t) return null;
                const m = t.replace(/[£€$\s,]/g, "").match(/\d+\.?\d*/);
                return m ? parseFloat(m[0]) : null;
              };

              const original = parseP(originalText);
              const sale = parseP(saleText);
              if (!original || !sale || sale >= original) continue;

              const discount = parseFloat(((1 - sale / original) * 100).toFixed(1));
              if (discount < minDiscount) continue;

              const img = card.querySelector("img")?.src || null;

              results.push({ name, url: href, originalPrice: original, salePrice: sale, discountPct: discount, imageUrl: img });
            }
            return results;
          },
          this.minDiscount
        );

        domDeals.forEach((d) =>
          allDeals.push({ retailer: this.retailerName, currency: "GBP", brand: null, ...d })
        );
        console.log(`[SportShoes] Page ${pageNum}: ${domDeals.length} deals from DOM`);

        if (domDeals.length === 0) break;
        await this.politeDelay();
      }

      return allDeals;
    });
  }

  /** Recursively search the Next.js data tree for a products array */
  _findProducts(obj, depth = 0) {
    if (depth > 12 || !obj || typeof obj !== "object") return null;
    if (Array.isArray(obj)) {
      // Is this array product-shaped?
      if (obj.length > 0 && obj[0] && typeof obj[0] === "object") {
        const first = obj[0];
        if ((first.name || first.title) && (first.price !== undefined || first.prices || first.salePrice !== undefined)) {
          return obj;
        }
      }
      for (const item of obj) {
        const found = this._findProducts(item, depth + 1);
        if (found) return found;
      }
      return null;
    }
    // Check common keys first for speed
    for (const key of ["products", "items", "results", "hits", "nodes", "edges", "data", "catalogue", "catalog"]) {
      if (obj[key]) {
        const found = this._findProducts(obj[key], depth + 1);
        if (found) return found;
      }
    }
    // Recurse into all other keys
    for (const val of Object.values(obj)) {
      const found = this._findProducts(val, depth + 1);
      if (found) return found;
    }
    return null;
  }

  _productToDeal(p, pageUrl) {
    try {
      const name = p.name || p.title;
      if (!name) return [];

      // Prices can be in various shapes depending on the API version
      const original =
        p.originalPrice ?? p.rrp ?? p.compareAtPrice ?? p.prices?.original ?? p.prices?.rrp ?? null;
      const sale =
        p.salePrice ?? p.price ?? p.currentPrice ?? p.prices?.current ?? p.prices?.sale ?? null;

      const op = typeof original === "number" ? original : this.parsePrice(String(original ?? ""));
      const sp = typeof sale === "number" ? sale : this.parsePrice(String(sale ?? ""));

      if (!op || !sp || sp >= op) return [];

      const discountPct = this.calcDiscount(op, sp);
      if (discountPct < this.minDiscount) return [];

      const slug = p.slug || p.url || p.href || p.sku || "";
      const url = slug.startsWith("http") ? slug : `${this.baseUrl}${slug.startsWith("/") ? "" : "/"}${slug}`;

      return [{
        retailer: this.retailerName,
        name,
        url,
        originalPrice: op,
        salePrice: sp,
        discountPct,
        currency: "GBP",
        brand: p.brand?.name ?? p.brand ?? null,
        imageUrl: p.image ?? p.imageUrl ?? p.thumbnail ?? null,
      }];
    } catch {
      return [];
    }
  }

  _hasNextPage(nextData, currentPage) {
    // Crude heuristic – if the total pages or product count is embedded, use it.
    // Otherwise assume there might be more until we get an empty page.
    try {
      const str = JSON.stringify(nextData);
      return str.includes(`"page":${currentPage + 1}`) || str.includes(`"currentPage":${currentPage}`);
    } catch {
      return true;
    }
  }
}
