/**
 * Scraper for RunnerInn (runnerinn.com) – international shipping to UK.
 *
 * Sale URL: https://www.runnerinn.com/running-shoes-road/
 * They include a data-price / data-original-price on product cards
 * which makes extraction easier than regex on text.
 *
 * Currency: EUR (they ship to UK but prices in EUR)
 */
import { BaseScraper, politeDelay, parsePrice, calcDiscount } from "./base.js";

const SALE_URL = "https://www.runnerinn.com/running-shoes-road/";
const MAX_PAGES = 5;

export class RunnerInnScraper extends BaseScraper {
  retailerName = "RunnerInn";
  baseUrl = "https://www.runnerinn.com";

  async getDeals() {
    const deals = [];

    for (let page = 1; page <= MAX_PAGES; page++) {
      const $ = await this.getPage(SALE_URL, { page, order: "discount" });

      if (!$) break;

      const cards = $("div.product-card, div.ProductCard, article.product, li.product");

      if (cards.length === 0) {
        console.log(`[RunnerInn] No cards on page ${page}, stopping.`);
        break;
      }

      cards.each((_, el) => {
        const deal = this._parseCard($, el);
        if (deal) deals.push(deal);
      });

      console.log(`[RunnerInn] Page ${page}: ${deals.length} deals so far`);
      await politeDelay();
    }

    return deals;
  }

  _parseCard($, el) {
    try {
      const name = $(el).find(".product-name, .product-title, h2, h3, [class*='Name']").first().text().trim();
      const href = $(el).find("a[href]").first().attr("href");
      const url = href ? (href.startsWith("http") ? href : this.baseUrl + href) : null;

      // RunnerInn sometimes stores prices in data attributes – try those first
      const originalEl = $(el).find("[data-original-price], [data-regular-price]").first();
      const saleEl = $(el).find("[data-price], [data-sale-price]").first();

      let originalPrice = parseFloat(originalEl.attr("data-original-price") || originalEl.attr("data-regular-price")) || null;
      let salePrice = parseFloat(saleEl.attr("data-price") || saleEl.attr("data-sale-price")) || null;

      // Fallback to text-based parsing
      if (!originalPrice) {
        originalPrice = parsePrice($(el).find(".original-price, .old-price, del, s, [class*='old'], [class*='original']").first().text());
      }
      if (!salePrice) {
        salePrice = parsePrice($(el).find(".current-price, .sale-price, .special-price, ins, [class*='current'], [class*='special']").first().text());
      }

      if (!name || !url || !originalPrice || !salePrice) return null;
      if (salePrice >= originalPrice) return null;

      const discountPct = calcDiscount(originalPrice, salePrice);
      if (discountPct < this.minDiscount) return null;

      // They sometimes show a badge with discount % – we use our own calculation
      const imageUrl =
        $(el).find("img").first().attr("data-src") ||
        $(el).find("img").first().attr("src") ||
        null;

      const brand = $(el).find("[class*='brand'], .brand").first().text().trim() || null;

      return { retailer: this.retailerName, name, url, originalPrice, salePrice, discountPct, currency: "EUR", brand, imageUrl };
    } catch (err) {
      console.debug(`[RunnerInn] Card parse error: ${err.message}`);
      return null;
    }
  }
}
