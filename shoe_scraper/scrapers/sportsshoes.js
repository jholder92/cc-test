/**
 * Scraper for sportsshoes.com
 *
 * Sale URL: https://www.sportsshoes.com/sale/running-shoes/
 * Filter:   Road Running, sorted by biggest discount
 *
 * If CSS selectors break in the future, open the sale page in Chrome DevTools
 * and inspect a product card to find the updated class names.
 */
import { BaseScraper, politeDelay, parsePrice, calcDiscount } from "./base.js";

const SALE_URL = "https://www.sportsshoes.com/sale/running-shoes/";
const MAX_PAGES = 5;

export class SportShoesScraper extends BaseScraper {
  retailerName = "SportShoes";
  baseUrl = "https://www.sportsshoes.com";

  async getDeals() {
    const deals = [];

    for (let page = 1; page <= MAX_PAGES; page++) {
      const $ = await this.getPage(SALE_URL, {
        subcategory: "road-running",
        sort: "percentDiscount",
        page,
      });

      if (!$) break;

      // Product cards - update selector if layout changes
      const cards = $("div.product-card, li.product-item, article.product");

      if (cards.length === 0) {
        console.log(`[SportShoes] No cards on page ${page}, stopping.`);
        break;
      }

      cards.each((_, el) => {
        const deal = this._parseCard($, el);
        if (deal) deals.push(deal);
      });

      console.log(`[SportShoes] Page ${page}: ${deals.length} deals so far`);
      await politeDelay();
    }

    return deals;
  }

  _parseCard($, el) {
    try {
      const name = $(el).find("h2.product-title, .product-name, [class*='name']").first().text().trim();
      const href = $(el).find("a[href]").first().attr("href");
      const url = href ? (href.startsWith("http") ? href : this.baseUrl + href) : null;

      // Was price (crossed out) vs now price
      const originalText = $(el).find(".was-price, .original-price, del, [class*='was'], [class*='rrp']").first().text();
      const saleText = $(el).find(".sale-price, .now-price, ins, [class*='sale'], [class*='current']").first().text();

      const originalPrice = parsePrice(originalText);
      const salePrice = parsePrice(saleText);

      if (!name || !url || !originalPrice || !salePrice) return null;
      if (salePrice >= originalPrice) return null;

      const discountPct = calcDiscount(originalPrice, salePrice);
      if (discountPct < this.minDiscount) return null;

      const imageUrl =
        $(el).find("img").first().attr("data-src") ||
        $(el).find("img").first().attr("src") ||
        null;

      const brand = $(el).find(".product-brand, [class*='brand']").first().text().trim() || null;

      return { retailer: this.retailerName, name, url, originalPrice, salePrice, discountPct, currency: "GBP", brand, imageUrl };
    } catch (err) {
      console.debug(`[SportShoes] Card parse error: ${err.message}`);
      return null;
    }
  }
}
