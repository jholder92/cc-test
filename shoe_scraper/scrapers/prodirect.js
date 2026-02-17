/**
 * Scraper for Pro:Direct Running (prodirectrunning.com)
 *
 * Sale page: https://www.prodirectrunning.com/c/road-running-shoes/filter/f-discount/
 *
 * If selectors break: open the page in Chrome, right-click a product card → Inspect.
 */
import { BaseScraper, politeDelay, parsePrice, calcDiscount } from "./base.js";

const SALE_URL = "https://www.prodirectrunning.com/c/road-running-shoes/filter/f-discount/";
const MAX_PAGES = 5;

export class ProDirectScraper extends BaseScraper {
  retailerName = "ProDirect";
  baseUrl = "https://www.prodirectrunning.com";

  async getDeals() {
    const deals = [];

    for (let page = 1; page <= MAX_PAGES; page++) {
      const pageUrl = page === 1 ? SALE_URL : `${SALE_URL}page-${page}/`;
      const $ = await this.getPage(pageUrl);

      if (!$) break;

      // Pro:Direct uses a grid of product pods
      const cards = $("div.productPod, li.product-pod, div[class*='ProductCard'], div[class*='product-card']");

      if (cards.length === 0) {
        console.log(`[ProDirect] No cards on page ${page}, stopping.`);
        break;
      }

      cards.each((_, el) => {
        const deal = this._parseCard($, el);
        if (deal) deals.push(deal);
      });

      console.log(`[ProDirect] Page ${page}: ${deals.length} deals so far`);
      await politeDelay();
    }

    return deals;
  }

  _parseCard($, el) {
    try {
      const name = $(el).find("[class*='productName'], [class*='product-name'], h2, h3").first().text().trim();
      const href = $(el).find("a[href]").first().attr("href");
      const url = href ? (href.startsWith("http") ? href : this.baseUrl + href) : null;

      // Pro:Direct shows RRP and sale price separately
      const originalText = $(el).find("[class*='rrp'], [class*='original'], [class*='was'], del, s").first().text();
      const saleText = $(el).find("[class*='sale'], [class*='now'], [class*='offer'], [class*='current']").first().text();

      const originalPrice = parsePrice(originalText);
      const salePrice = parsePrice(saleText);

      if (!name || !url || !originalPrice || !salePrice) return null;
      if (salePrice >= originalPrice) return null;

      const discountPct = calcDiscount(originalPrice, salePrice);
      if (discountPct < this.minDiscount) return null;

      const imageUrl =
        $(el).find("img").first().attr("data-lazy-src") ||
        $(el).find("img").first().attr("data-src") ||
        $(el).find("img").first().attr("src") ||
        null;

      const brand = $(el).find("[class*='brand']").first().text().trim() || null;

      return { retailer: this.retailerName, name, url, originalPrice, salePrice, discountPct, currency: "GBP", brand, imageUrl };
    } catch (err) {
      console.debug(`[ProDirect] Card parse error: ${err.message}`);
      return null;
    }
  }
}
