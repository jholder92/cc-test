/**
 * Deal reporter – formats and saves the daily deals list.
 *
 * Output files go to ./deals/YYYY-MM-DD.txt (human-readable)
 *                 and ./deals/YYYY-MM-DD.json (machine-readable)
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEALS_DIR = path.join(__dirname, "..", "deals");

/** Ensure ./deals directory exists */
function ensureDealsDir() {
  if (!fs.existsSync(DEALS_DIR)) fs.mkdirSync(DEALS_DIR, { recursive: true });
}

/** Return today's date string e.g. "2025-03-01" */
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Deduplicate deals by URL (same product may appear if paginated overlap)
 * @param {import('../scrapers/base.js').Deal[]} deals
 */
export function deduplicateDeals(deals) {
  const seen = new Set();
  return deals.filter((d) => {
    if (seen.has(d.url)) return false;
    seen.add(d.url);
    return true;
  });
}

/**
 * Sort deals: highest discount first, then by lowest sale price.
 * @param {import('../scrapers/base.js').Deal[]} deals
 */
export function sortDeals(deals) {
  return [...deals].sort((a, b) => {
    if (b.discountPct !== a.discountPct) return b.discountPct - a.discountPct;
    return a.salePrice - b.salePrice;
  });
}

/**
 * Print deals to stdout in a nice table format.
 * @param {import('../scrapers/base.js').Deal[]} deals
 */
export function printDeals(deals) {
  if (deals.length === 0) {
    console.log("\n  No deals found today.\n");
    return;
  }

  const currencySymbol = (c) => (c === "EUR" ? "€" : "£");

  console.log("\n" + "=".repeat(80));
  console.log(`  🏃 BEST ROAD RUNNING SHOE DEALS – ${todayStr()}`);
  console.log("=".repeat(80));

  deals.forEach((deal, i) => {
    const sym = currencySymbol(deal.currency);
    const rank = String(i + 1).padStart(3, " ");
    const discount = `${deal.discountPct}% OFF`.padEnd(10);
    const price = `${sym}${deal.salePrice.toFixed(2)}`.padEnd(10);
    const was = `(was ${sym}${deal.originalPrice.toFixed(2)})`.padEnd(18);
    const shop = `[${deal.retailer}]`.padEnd(15);
    const name = deal.name.length > 50 ? deal.name.slice(0, 47) + "..." : deal.name;

    console.log(`${rank}. ${discount} ${price} ${was} ${shop} ${name}`);
    console.log(`      ${deal.url}`);

    if (i < deals.length - 1) console.log();
  });

  console.log("=".repeat(80) + "\n");
}

/**
 * Save deals to ./deals/YYYY-MM-DD.txt and ./deals/YYYY-MM-DD.json
 * @param {import('../scrapers/base.js').Deal[]} deals
 */
export function saveDeals(deals) {
  ensureDealsDir();
  const today = todayStr();

  // --- JSON file ---
  const jsonPath = path.join(DEALS_DIR, `${today}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(deals, null, 2), "utf8");

  // --- Human-readable text file ---
  const txtPath = path.join(DEALS_DIR, `${today}.txt`);
  const currencySymbol = (c) => (c === "EUR" ? "€" : "£");

  const lines = [
    `BEST ROAD RUNNING SHOE DEALS – ${today}`,
    "=".repeat(80),
    "",
    ...deals.flatMap((deal, i) => {
      const sym = currencySymbol(deal.currency);
      return [
        `${i + 1}. [${deal.discountPct}% OFF] ${deal.name}`,
        `   Price:  ${sym}${deal.salePrice.toFixed(2)} (was ${sym}${deal.originalPrice.toFixed(2)})`,
        `   Shop:   ${deal.retailer}`,
        `   Link:   ${deal.url}`,
        "",
      ];
    }),
  ];

  fs.writeFileSync(txtPath, lines.join("\n"), "utf8");

  console.log(`\nDeals saved to:\n  ${jsonPath}\n  ${txtPath}\n`);
  return { jsonPath, txtPath };
}
