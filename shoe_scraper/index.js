/**
 * Shoe Scraper Bot – entry point
 *
 * Usage:
 *   node index.js          → runs on a schedule (8:00 AM every day)
 *   node index.js --now    → runs immediately once, then exits
 *
 * Install dependencies first:
 *   npm install
 */
import cron from "node-cron";
import { ALL_SCRAPERS } from "./scrapers/index.js";
import { deduplicateDeals, sortDeals, printDeals, saveDeals } from "./utils/reporter.js";

const RUN_NOW = process.argv.includes("--now");

/**
 * Run all scrapers, aggregate results, deduplicate, sort, print, and save.
 */
async function runScrape() {
  const startTime = Date.now();
  console.log(`\n[${new Date().toISOString()}] Starting shoe scrape across ${ALL_SCRAPERS.length} retailers...`);

  const allDeals = [];

  for (const ScraperClass of ALL_SCRAPERS) {
    const scraper = new ScraperClass();
    console.log(`\n--- Scraping ${scraper.retailerName} ---`);

    try {
      const deals = await scraper.getDeals();
      console.log(`  → ${deals.length} deals found at ${scraper.retailerName}`);
      allDeals.push(...deals);
    } catch (err) {
      console.error(`  ✗ ${scraper.retailerName} failed: ${err.message}`);
    }
  }

  // Post-process
  const unique = deduplicateDeals(allDeals);
  const sorted = sortDeals(unique);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nScrape complete in ${elapsed}s — ${sorted.length} unique deals found.`);

  printDeals(sorted);
  saveDeals(sorted);
}

// ─── Entry point ────────────────────────────────────────────────────────────

if (RUN_NOW) {
  // Run immediately and exit
  runScrape()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Fatal error:", err);
      process.exit(1);
    });
} else {
  // Schedule for 8:00 AM every day
  // Cron syntax: minute hour day month weekday
  //              0      8    *   *     *
  const schedule = "0 8 * * *";

  console.log(`Shoe scraper scheduled to run at 8:00 AM daily (cron: "${schedule}")`);
  console.log("Tip: run with --now to trigger immediately.\n");

  cron.schedule(schedule, () => {
    runScrape().catch((err) => console.error("Scrape error:", err));
  });

  // Keep the process alive
  process.on("SIGINT", () => {
    console.log("\nShutting down scheduler. Goodbye!");
    process.exit(0);
  });
}
