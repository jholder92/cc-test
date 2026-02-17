/**
 * Scraper for Zalando UK (zalando.co.uk)
 *
 * Zalando renders products via React/Next.js, so the HTML in the initial
 * page response contains a JSON payload in a <script id="z-vegas-pdp-props">
 * or similar tag. We extract that JSON rather than parsing rendered HTML.
 *
 * Sale URL: https://www.zalando.co.uk/mens-running-shoes/?q=road+running&order=popularity&sale=true
 *
 * ⚠️  Zalando heavily rate-limits scrapers. If you get 429 responses, increase
 *     the politeDelay min/max or add a proxy. The selectors here target the
 *     structured data they embed in the page.
 */
import { BaseScraper, politeDelay, parsePrice, calcDiscount } from "./base.js";

const SALE_URL = "https://www.zalando.co.uk/mens-running-shoes/";
const MAX_PAGES = 3; // Zalando pagination uses offset

export class ZalandoScraper extends BaseScraper {
  retailerName = "Zalando";
  baseUrl = "https://www.zalando.co.uk";

  async getDeals() {
    const deals = [];

    for (let page = 0; page < MAX_PAGES; page++) {
      const offset = page * 24;
      const $ = await this.getPage(SALE_URL, {
        "q": "road running",
        "order": "sale",
        "sale": "true",
        "offset": offset,
      });

      if (!$) break;

      // Try to extract embedded JSON (Zalando often embeds a catalog in a script tag)
      const jsonDeals = this._extractJsonDeals($);
      if (jsonDeals.length > 0) {
        deals.push(...jsonDeals);
      } else {
        // Fall back to HTML parsing
        const cards = $("article[class*='product'], div[class*='ProductCard'], div[class*='product-card']");

        if (cards.length === 0) {
          console.log(`[Zalando] No cards on page ${page + 1}, stopping.`);
          break;
        }

        cards.each((_, el) => {
          const deal = this._parseCard($, el);
          if (deal) deals.push(deal);
        });
      }

      console.log(`[Zalando] Page ${page + 1}: ${deals.length} deals so far`);
      // Zalando is strict – use a longer delay
      await politeDelay(3000, 6000);
    }

    return deals;
  }

  /** Try to pull deals from the embedded JSON Zalando injects into the page */
  _extractJsonDeals($) {
    const deals = [];
    try {
      // Zalando embeds catalog data in various <script> tags
      $("script[type='application/ld+json']").each((_, el) => {
        try {
          const json = JSON.parse($(el).html());
          if (json["@type"] === "ItemList" && Array.isArray(json.itemListElement)) {
            json.itemListElement.forEach((item) => {
              if (!item.offers) return;
              const offer = Array.isArray(item.offers) ? item.offers[0] : item.offers;
              const salePrice = offer.price ? parseFloat(offer.price) : null;
              // LD+JSON often doesn't include the was-price; skip if we can't compute discount
              if (!salePrice) return;

              // Zalando sometimes includes a highPrice for the original
              const originalPrice = offer.highPrice ? parseFloat(offer.highPrice) : null;
              if (!originalPrice || salePrice >= originalPrice) return;

              const discountPct = calcDiscount(originalPrice, salePrice);
              if (discountPct < this.minDiscount) return;

              deals.push({
                retailer: this.retailerName,
                name: item.name || "Unknown",
                url: item.url || "",
                originalPrice,
                salePrice,
                discountPct,
                currency: offer.priceCurrency || "GBP",
                brand: item.brand?.name || null,
                imageUrl: item.image || null,
              });
            });
          }
        } catch (_) {
          // JSON parse failed for this script tag, skip
        }
      });
    } catch (err) {
      console.debug(`[Zalando] JSON extraction error: ${err.message}`);
    }
    return deals;
  }

  _parseCard($, el) {
    try {
      const name = $(el).find("[class*='name'], [class*='Name'], h3, h2").first().text().trim();
      const href = $(el).find("a[href]").first().attr("href");
      const url = href ? (href.startsWith("http") ? href : this.baseUrl + href) : null;

      const originalText = $(el).find("[class*='originalPrice'], [class*='crossed'], del, s").first().text();
      const saleText = $(el).find("[class*='promotionalPrice'], [class*='sale'], [class*='discount']").first().text();

      const originalPrice = parsePrice(originalText);
      const salePrice = parsePrice(saleText);

      if (!name || !url || !originalPrice || !salePrice) return null;
      if (salePrice >= originalPrice) return null;

      const discountPct = calcDiscount(originalPrice, salePrice);
      if (discountPct < this.minDiscount) return null;

      const imageUrl = $(el).find("img").first().attr("src") || null;
      const brand = $(el).find("[class*='brand'], [class*='Brand']").first().text().trim() || null;

      return { retailer: this.retailerName, name, url, originalPrice, salePrice, discountPct, currency: "GBP", brand, imageUrl };
    } catch (err) {
      console.debug(`[Zalando] Card parse error: ${err.message}`);
      return null;
    }
  }
}
