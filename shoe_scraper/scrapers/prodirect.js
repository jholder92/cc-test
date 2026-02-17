/**
 * Scraper for Pro:Direct Sport – Running section (prodirectsport.com)
 *
 * Note: prodirectrunning.com redirects to prodirectsport.com/running/
 *
 * Strategy:
 *  1. Navigate to the road running shoes sale page with Playwright.
 *  2. Pro:Direct uses a server-rendered Magento-style layout – product cards
 *     ARE in the initial HTML, but need a real browser to handle cookies/JS.
 *  3. Extract data from rendered card elements using page.$$eval().
 *  4. Paginate by clicking the "Next" button or incrementing the URL page param.
 */
import { BaseScraper } from "./base.js";

const BASE_URL = "https://www.prodirectsport.com";
// Road running shoes, filtered to sale items, sorted by discount
const SALE_URL = `${BASE_URL}/running/mens-road-running-shoes/sale/`;
const MAX_PAGES = 5;

export class ProDirectScraper extends BaseScraper {
  retailerName = "ProDirect";
  baseUrl = BASE_URL;

  async getDeals() {
    return this.withPage(async (page) => {
      const allDeals = [];

      for (let pageNum = 1; pageNum <= MAX_PAGES; pageNum++) {
        // Pro:Direct uses ?p=N for pagination
        const url = pageNum === 1 ? SALE_URL : `${SALE_URL}?p=${pageNum}`;
        console.log(`[ProDirect] Fetching page ${pageNum}: ${url}`);
        await this.goto(page, url);

        // Wait for product grid
        try {
          await page.waitForSelector(
            ".product-item, .product-pod, [class*='ProductCard'], [class*='product-card'], ol.products li",
            { timeout: 10_000 }
          );
        } catch {
          console.log(`[ProDirect] No product cards on page ${pageNum}, stopping.`);
          break;
        }

        const deals = await page.$$eval(
          ".product-item, .product-pod, [class*='ProductCard'], [class*='product-card'], ol.products li",
          (cards, minDiscount) => {
            const results = [];
            for (const card of cards) {
              const linkEl = card.querySelector("a[href]");
              if (!linkEl) continue;
              const url = linkEl.href;

              const name = (
                card.querySelector(".product-item-name, .product-name, [class*='name'], h2, h3")?.textContent || ""
              ).trim();
              if (!name) continue;

              // Original price – look for strikethrough
              const delEl = card.querySelector("del, s, .old-price, [class*='old'], [class*='was'], [class*='rrp'], [class*='original']");
              // Sale price
              const nowEl = card.querySelector(".special-price, .price--special, [class*='special'], [class*='sale'], [class*='now'], ins");
              // If there's no explicit sale element, grab the main price
              const mainPriceEl = card.querySelector(".price-box .price, [class*='price']:not([class*='old']):not([class*='was'])");

              const parseP = (t) => {
                if (!t) return null;
                const m = t.replace(/[£€$\s,]/g, "").match(/\d+\.?\d*/);
                return m ? parseFloat(m[0]) : null;
              };

              const original = parseP(delEl?.textContent);
              const sale = parseP(nowEl?.textContent) ?? parseP(mainPriceEl?.textContent);

              if (!original || !sale || sale >= original) continue;

              const discount = parseFloat(((1 - sale / original) * 100).toFixed(1));
              if (discount < minDiscount) continue;

              const img = card.querySelector("img")?.src || null;
              const brand = card.querySelector("[class*='brand'], .manufacturer")?.textContent?.trim() || null;

              results.push({ name, url, originalPrice: original, salePrice: sale, discountPct: discount, imageUrl: img, brand });
            }
            return results;
          },
          this.minDiscount
        );

        deals.forEach((d) =>
          allDeals.push({ retailer: this.retailerName, currency: "GBP", ...d })
        );
        console.log(`[ProDirect] Page ${pageNum}: ${deals.length} deals`);

        if (deals.length === 0) break;
        await this.politeDelay();
      }

      return allDeals;
    });
  }
}
