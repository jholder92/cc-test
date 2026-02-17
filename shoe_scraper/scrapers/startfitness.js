/**
 * Scraper for Start Fitness (startfitness.co.uk)
 *
 * Sale page: https://www.startfitness.co.uk/sale/running-shoes/road-running-shoes/
 *
 * If selectors break: inspect a product card on the sale page to find updated class names.
 */
import { BaseScraper, politeDelay, parsePrice, calcDiscount } from "./base.js";

const SALE_URL = "https://www.startfitness.co.uk/sale/running-shoes/road-running-shoes/";
const MAX_PAGES = 5;

export class StartFitnessScraper extends BaseScraper {
  retailerName = "StartFitness";
  baseUrl = "https://www.startfitness.co.uk";

  async getDeals() {
    const deals = [];

    for (let page = 1; page <= MAX_PAGES; page++) {
      const $ = await this.getPage(SALE_URL, { page });

      if (!$) break;

      const cards = $("div.product-item, li.product, div[class*='ProductItem'], div[class*='product-tile']");

      if (cards.length === 0) {
        console.log(`[StartFitness] No cards on page ${page}, stopping.`);
        break;
      }

      cards.each((_, el) => {
        const deal = this._parseCard($, el);
        if (deal) deals.push(deal);
      });

      console.log(`[StartFitness] Page ${page}: ${deals.length} deals so far`);
      await politeDelay();
    }

    return deals;
  }

  _parseCard($, el) {
    try {
      const name = $(el).find(".product-title, .product-name, h2, h3, [itemprop='name']").first().text().trim();
      const href = $(el).find("a[href]").first().attr("href");
      const url = href ? (href.startsWith("http") ? href : this.baseUrl + href) : null;

      const originalText = $(el).find(".original-price, .was-price, del, s, [class*='was'], [class*='original']").first().text();
      const saleText = $(el).find(".special-price, .sale-price, .now-price, ins, [class*='sale'], [class*='special'], [class*='now']").first().text();

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

      const brand = $(el).find("[class*='brand']").first().text().trim() || null;

      return { retailer: this.retailerName, name, url, originalPrice, salePrice, discountPct, currency: "GBP", brand, imageUrl };
    } catch (err) {
      console.debug(`[StartFitness] Card parse error: ${err.message}`);
      return null;
    }
  }
}
