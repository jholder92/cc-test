/**
 * Scraper for Start Fitness (startfitness.co.uk)
 *
 * Strategy:
 *  1. Navigate to their road running sale page with Playwright.
 *  2. Start Fitness runs on a Magento-style platform – product cards are
 *     server-rendered so the DOM contains prices once the page loads.
 *  3. Use page.$$eval() on the live DOM to extract discounted products.
 *  4. Paginate via URL query param.
 *
 * Sale URL: https://www.startfitness.co.uk/running/road-running-shoes/?on_sale=1
 */
import { BaseScraper } from "./base.js";

const BASE_URL = "https://www.startfitness.co.uk";
const SALE_URL = `${BASE_URL}/running/road-running-shoes/`;
const MAX_PAGES = 5;

export class StartFitnessScraper extends BaseScraper {
  retailerName = "StartFitness";
  baseUrl = BASE_URL;

  async getDeals() {
    return this.withPage(async (page) => {
      const allDeals = [];

      for (let pageNum = 1; pageNum <= MAX_PAGES; pageNum++) {
        // on_sale=1 filters to sale items; p=N paginates
        const url = `${SALE_URL}?on_sale=1${pageNum > 1 ? `&p=${pageNum}` : ""}`;
        console.log(`[StartFitness] Fetching page ${pageNum}: ${url}`);
        await this.goto(page, url);

        // Wait for product cards
        try {
          await page.waitForSelector(
            ".product-item, .product-tile, [class*='ProductCard'], li.item.product",
            { timeout: 10_000 }
          );
        } catch {
          console.log(`[StartFitness] No products on page ${pageNum}, stopping.`);
          break;
        }

        const deals = await page.$$eval(
          ".product-item, .product-tile, [class*='ProductCard'], li.item.product",
          (cards, minDiscount) => {
            const results = [];
            for (const card of cards) {
              const linkEl = card.querySelector("a[href]");
              if (!linkEl) continue;

              const name = (
                card.querySelector(".product-item-name, .product-name, strong.product, h2, h3")?.textContent || ""
              ).trim();
              if (!name) continue;

              const parseP = (t) => {
                if (!t) return null;
                const m = t.replace(/[£€$\s,]/g, "").match(/\d+\.?\d*/);
                return m ? parseFloat(m[0]) : null;
              };

              // Start Fitness shows the old price as a strikethrough
              const oldEl = card.querySelector(".old-price, .was-price, del, s, [class*='old'], [class*='was']");
              const nowEl = card.querySelector(".special-price, .price--special, [class*='special'], [class*='sale'], ins");
              const mainEl = card.querySelector(".price-box .price, .product-price, [class*='price']");

              const original = parseP(oldEl?.textContent);
              const sale = parseP(nowEl?.textContent) ?? parseP(mainEl?.textContent);

              if (!original || !sale || sale >= original) continue;

              const discount = parseFloat(((1 - sale / original) * 100).toFixed(1));
              if (discount < minDiscount) continue;

              const img =
                card.querySelector("img[data-src]")?.dataset?.src ||
                card.querySelector("img")?.src ||
                null;

              const brand = card.querySelector("[class*='brand'], .manufacturer")?.textContent?.trim() || null;

              results.push({
                name,
                url: linkEl.href,
                originalPrice: original,
                salePrice: sale,
                discountPct: discount,
                imageUrl: img,
                brand,
              });
            }
            return results;
          },
          this.minDiscount
        );

        deals.forEach((d) =>
          allDeals.push({ retailer: this.retailerName, currency: "GBP", ...d })
        );
        console.log(`[StartFitness] Page ${pageNum}: ${deals.length} deals`);

        if (deals.length === 0) break;
        await this.politeDelay();
      }

      return allDeals;
    });
  }
}
