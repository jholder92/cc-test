# Shoe Scraper Bot

Scrapes discounted **road running shoes** across major UK retailers every morning at 8 AM and saves a ranked deals list.

## Retailers covered

| Retailer | Currency | Notes |
|---|---|---|
| [SportShoes](https://www.sportsshoes.com) | GBP | Dedicated road running sale section |
| [Pro:Direct Running](https://www.prodirectrunning.com) | GBP | Filtered to discounted products |
| [Start Fitness](https://www.startfitness.co.uk) | GBP | Road running shoes sale |
| [Zalando UK](https://www.zalando.co.uk) | GBP | Uses embedded JSON + HTML fallback |
| [RunnerInn](https://www.runnerinn.com) | EUR | International retailer, ships to UK |

---

## Setup

```bash
cd shoe_scraper
npm install
```

## Running

```bash
# Run immediately (scrapes now and exits)
node index.js --now

# Start the scheduler (runs at 8:00 AM every day, keeps process alive)
node index.js
```

Or use the npm scripts:

```bash
npm start        # Start scheduler
npm run scrape   # Run now
```

## Output

Each run produces two files in `./deals/`:

- `deals/YYYY-MM-DD.txt` – human-readable ranked list
- `deals/YYYY-MM-DD.json` – full structured data (useful for feeding into other tools)

Example text output:

```
BEST ROAD RUNNING SHOE DEALS – 2025-03-01
================================================================================

1. [45% OFF] Nike Pegasus 40
   Price:  £82.50 (was £150.00)
   Shop:   SportShoes
   Link:   https://www.sportsshoes.com/product/nik3456/...
```

---

## Tuning & maintenance

### Selectors break?

Sites redesign their HTML periodically. If a scraper stops returning deals:

1. Open the sale page in Chrome
2. Right-click a product card → **Inspect**
3. Find the CSS class names for the product name, original price, and sale price
4. Update the selectors in the relevant file inside `scrapers/`

### Add more retailers

1. Create `scrapers/mynewshop.js` extending `BaseScraper`
2. Implement `async getDeals()` returning `Deal[]`
3. Add it to `scrapers/index.js` in the `ALL_SCRAPERS` array

### Change the schedule

Edit `index.js` – the `schedule` variable uses standard cron syntax:

```
"0 8 * * *"   → 8:00 AM every day
"0 8 * * 1"   → 8:00 AM every Monday only
"0 8,20 * * *" → 8:00 AM and 8:00 PM every day
```

### Run in the background (Linux/macOS)

```bash
# Using nohup
nohup node index.js > shoe_scraper.log 2>&1 &

# Or use PM2 for auto-restart
npm install -g pm2
pm2 start index.js --name shoe-scraper
pm2 save
```

### Minimum discount threshold

Default is **10%**. To change it, set `this.minDiscount` in the scraper class or edit `BaseScraper.minDiscount` in `scrapers/base.js`.
