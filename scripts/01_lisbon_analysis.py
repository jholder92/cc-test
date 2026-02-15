#!/usr/bin/env python3
"""
Lisbon Commercial Census Analysis 1991–2010
==========================================
Analyses the Câmara Municipal de Lisboa commercial census data (Recenseamento Comercial)
showing how business types changed in the city over two decades.

Data source: CML via ArcGIS FeatureServer
https://services.arcgis.com/1dSrzEWVQn5kHHyK/arcgis/rest/services/RecenseamentoComercial/FeatureServer

NOTE: 1993 and 1996 layers appear to be partial census surveys (only ~1,500–1,650
records vs 14,000–18,000 in full census years). These years are excluded from trend
analysis but included in raw tables for reference.
"""

import json
import csv
import os
from collections import Counter, defaultdict

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "datasets", "lisbon")
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "outputs")
os.makedirs(OUTPUT_DIR, exist_ok=True)

# All available years and which are "full" census years
ALL_YEARS = [1991, 1993, 1995, 1996, 1998, 2000, 2002, 2004, 2005, 2006, 2007, 2008, 2009, 2010]
FULL_YEARS = [1991, 1995, 1998, 2000, 2002, 2004, 2005, 2006, 2007, 2008, 2009, 2010]
PARTIAL_YEARS = [1993, 1996]  # Small partial surveys, excluded from trend analysis

# Business category definitions (matching DESC_ACT_ECON field, case-insensitive substring)
# These map Portuguese activity descriptions to English analytical categories.
CATEGORIES = {
    # --- Food & Drink (tourism-sensitive) ---
    "Cafés & Pastry Shops":     ["Café/Pastelaria", "CAFE/PASTELARIA"],
    "Restaurants":              ["Restaurante", "RESTAURANTE", "Casa De Pasto",
                                 "Outros Estab. De Comidas E Refeições",
                                 "Outros N.E.(C.N.Alim. Diversos)"],
    "Snack Bars":               ["Snack-Bar", '"SNACK-BAR"'],
    "Bars & Pubs":              ["Bar/Pub", "OUTROS EST. DE BEBIDAS", "Outros Estab. De Bebidas",
                                 "Taberna"],
    # --- Tourism-oriented retail ---
    "Souvenir & Craft Shops":   ["Artigos Regionais", "Artesanato", "Recordações", "Souvenir",
                                  "Artigos Típicos"],
    "Jewellers":                ["Ourivesarias/Relojoarias"],
    # --- Everyday resident-serving retail ---
    "Traditional Grocers":      ["Mercearias"],
    "Supermarkets":             ["Mini-Mercados/Auto-Serviços", "Supermercados"],
    "Bakeries":                 ["Padarias"],
    "Butchers":                 ["Talhos"],
    "Fishmongers":              ["Peixarias"],
    "Pharmacies":               ["Farmácias"],
    "Tobacconists":             ["Tabacaria"],
    "Newsagents":               ["Papelarias (Art. Escrit.,Jornais"],
    "Shoe Shops":               ["Sapatarias"],
    "Hardware / DIY":           ["Materiais Construção", "Ferragens", "Drogarias",
                                  "Material Eléctrico"],
    "Furniture":                ["Móveis E Colchoaria"],
    "Photo & Film":             ["Material Fotográfico"],
    # --- Accommodation ---
    "Hotels & Accommodation":   ["Hotel", "Pensão", "Residencial", "Hostel",
                                  "Apartamento Turístico", "Alojamento Local"],
    # --- Clothing ---
    "Clothing Shops":           ["Artigos Vestuário"],
}

# Groupings for high-level analysis
TOURISM_CATS = ["Cafés & Pastry Shops", "Restaurants", "Snack Bars", "Bars & Pubs",
                "Souvenir & Craft Shops", "Hotels & Accommodation"]
RESIDENT_CATS = ["Traditional Grocers", "Supermarkets", "Bakeries", "Butchers",
                 "Fishmongers", "Pharmacies", "Tobacconists", "Newsagents",
                 "Hardware / DIY", "Furniture"]


def load_year(year: int) -> list:
    path = os.path.join(DATA_DIR, f"RecenseamentoComercial_{year}.geojson")
    with open(path) as f:
        return json.load(f)["features"]


def count_category(features: list, keywords: list) -> int:
    count = 0
    for f in features:
        desc = (f["properties"].get("DESC_ACT_ECON") or "").lower()
        if any(kw.lower() in desc for kw in keywords):
            count += 1
    return count


def main():
    print("Loading data...")
    data = {yr: load_year(yr) for yr in ALL_YEARS}

    # ─── 1. Raw counts per category per year ─────────────────────────────────
    counts = defaultdict(dict)
    for yr in ALL_YEARS:
        for cat, keywords in CATEGORIES.items():
            counts[cat][yr] = count_category(data[yr], keywords)

    totals = {yr: len(data[yr]) for yr in ALL_YEARS}

    # ─── 2. Print summary table ───────────────────────────────────────────────
    print("\n" + "=" * 120)
    print("LISBON COMMERCIAL CENSUS 1991–2010: BUSINESS TYPE TRENDS")
    print("=" * 120)
    print(f"\n{'* = partial survey year (excluded from trend analysis)'}")
    print(f"\n{'Category':<30}", end="")
    for yr in FULL_YEARS:
        marker = "*" if yr in PARTIAL_YEARS else ""
        print(f"{yr}{marker:>1}".rjust(7), end="")
    print("  | Change 91→10  | % Share 91 | % Share 10")
    print("-" * 120)

    for cat, keywords in CATEGORIES.items():
        row = []
        for yr in FULL_YEARS:
            row.append(counts[cat][yr])

        c_1991 = counts[cat][1991]
        c_2010 = counts[cat][2010]
        t_1991 = totals[1991]
        t_2010 = totals[2010]

        abs_change = c_2010 - c_1991
        pct_change = ((c_2010 - c_1991) / c_1991 * 100) if c_1991 > 0 else float("inf")
        share_1991 = 100 * c_1991 / t_1991
        share_2010 = 100 * c_2010 / t_2010

        marker = "▲" if pct_change > 50 else ("▼" if pct_change < 0 else "→")
        print(f"{cat:<30}", end="")
        for v in row:
            print(f"{v:>7}", end="")
        print(f"  | {marker} {abs_change:+4d} ({pct_change:+.0f}%)  | {share_1991:6.2f}%     | {share_2010:6.2f}%")

    print(f"\n{'TOTAL':<30}", end="")
    for yr in FULL_YEARS:
        print(f"{totals[yr]:>7,}", end="")
    print()

    # ─── 3. Tourism vs Resident-serving ratio ────────────────────────────────
    print("\n" + "=" * 80)
    print("TOURISM-ORIENTED vs RESIDENT-SERVING BUSINESSES")
    print("(Share of total establishments in full census years)")
    print("=" * 80)
    print(f"\n{'Year':<8} {'Total':>8} {'Tourism%':>10} {'Resident%':>11} {'Ratio T:R':>11}")
    print("-" * 55)
    for yr in FULL_YEARS:
        total = totals[yr]
        tourism = sum(counts[cat].get(yr, 0) for cat in TOURISM_CATS)
        resident = sum(counts[cat].get(yr, 0) for cat in RESIDENT_CATS)
        t_pct = 100 * tourism / total
        r_pct = 100 * resident / total
        ratio = tourism / resident if resident > 0 else float("inf")
        print(f"{yr:<8} {total:>8,} {t_pct:>10.1f}% {r_pct:>10.1f}% {ratio:>10.2f}:1")

    # ─── 4. Top activity types in 1991 vs 2010 ───────────────────────────────
    print("\n" + "=" * 80)
    print("TOP 25 ACTIVITY TYPES: 1991 vs 2010")
    print("=" * 80)

    acts_1991 = Counter(f["properties"].get("DESC_ACT_ECON", "Unknown") for f in data[1991])
    acts_2010 = Counter(f["properties"].get("DESC_ACT_ECON", "Unknown") for f in data[2010])

    all_acts = set(acts_1991.keys()) | set(acts_2010.keys())

    print(f"\n{'Activity':<45} {'1991':>6} {'%':>5} | {'2010':>6} {'%':>5} | {'Change':>8}")
    print("-" * 90)

    # Sort by 2010 count descending
    for act, _ in acts_2010.most_common(25):
        c91 = acts_1991.get(act, 0)
        c10 = acts_2010.get(act, 0)
        p91 = 100 * c91 / totals[1991]
        p10 = 100 * c10 / totals[2010]
        change = c10 - c91
        marker = "▲" if change > 0 else "▼"
        print(f"{act:<45} {c91:>6} {p91:>5.2f}% | {c10:>6} {p10:>5.2f}% | {marker}{change:>+6}")

    # ─── 5. Key journalistic findings ────────────────────────────────────────
    print("\n" + "=" * 80)
    print("KEY FINDINGS")
    print("=" * 80)

    # F&B share
    fb_cats = ["Cafés & Pastry Shops", "Restaurants", "Snack Bars", "Bars & Pubs"]
    fb_1991 = sum(counts[c][1991] for c in fb_cats)
    fb_2010 = sum(counts[c][2010] for c in fb_cats)
    fb_pct_1991 = 100 * fb_1991 / totals[1991]
    fb_pct_2010 = 100 * fb_2010 / totals[2010]
    print(f"\n1. FOOD & DRINK EXPLOSION:")
    print(f"   Cafés, restaurants, snack bars and bars accounted for {fb_pct_1991:.1f}% of all Lisbon")
    print(f"   commercial establishments in 1991. By 2010, that share had risen to {fb_pct_2010:.1f}%.")
    print(f"   In absolute terms: {fb_1991:,} F&B venues in 1991 → {fb_2010:,} in 2010.")

    # Traditional food retail decline (as share)
    trad_cats = ["Traditional Grocers", "Bakeries", "Butchers", "Fishmongers"]
    trad_1991 = sum(counts[c][1991] for c in trad_cats)
    trad_2010 = sum(counts[c][2010] for c in trad_cats)
    trad_pct_1991 = 100 * trad_1991 / totals[1991]
    trad_pct_2010 = 100 * trad_2010 / totals[2010]
    print(f"\n2. TRADITIONAL FOOD RETAIL SQUEEZED OUT:")
    print(f"   Grocers, bakeries, butchers and fishmongers: {trad_pct_1991:.1f}% of businesses in 1991")
    print(f"   → down to {trad_pct_2010:.1f}% by 2010, despite the city's total establishments more")
    print(f"   than doubling. Absolute count: {trad_1991:,} → {trad_2010:,}")

    # Souvenir growth
    sov_1991 = counts["Souvenir & Craft Shops"][1991]
    sov_2010 = counts["Souvenir & Craft Shops"][2010]
    print(f"\n3. SOUVENIR & CRAFT SHOPS:")
    print(f"   Rose from {sov_1991} in 1991 to {sov_2010} in 2010 (+{sov_2010-sov_1991}, "
          f"+{(sov_2010-sov_1991)/sov_1991*100:.0f}%)")
    print(f"   Share: {100*sov_1991/totals[1991]:.2f}% → {100*sov_2010/totals[2010]:.2f}%")

    # Bakery decline
    bak = counts["Bakeries"]
    print(f"\n4. BAKERY DECLINE IN REAL TERMS:")
    print(f"   While the city grew, bakeries barely changed in absolute numbers ({bak[1991]} → {bak[2010]})")
    print(f"   but their share halved: {100*bak[1991]/totals[1991]:.2f}% → {100*bak[2010]/totals[2010]:.2f}%")

    # ─── 6. Save outputs to CSV ──────────────────────────────────────────────
    csv_path = os.path.join(OUTPUT_DIR, "lisbon_business_trends.csv")
    with open(csv_path, "w", newline="") as f:
        writer = csv.writer(f)
        header = ["category", "tourism_type"] + [str(yr) for yr in ALL_YEARS]
        writer.writerow(header)
        for cat, keywords in CATEGORIES.items():
            tourism_type = "tourism" if cat in TOURISM_CATS else "resident" if cat in RESIDENT_CATS else "other"
            row = [cat, tourism_type] + [counts[cat][yr] for yr in ALL_YEARS]
            writer.writerow(row)
        # Totals row
        writer.writerow(["TOTAL", "all"] + [totals[yr] for yr in ALL_YEARS])

    # Save percentages CSV
    csv_path_pct = os.path.join(OUTPUT_DIR, "lisbon_business_trends_pct.csv")
    with open(csv_path_pct, "w", newline="") as f:
        writer = csv.writer(f)
        header = ["category", "tourism_type"] + [str(yr) for yr in ALL_YEARS]
        writer.writerow(header)
        for cat, keywords in CATEGORIES.items():
            tourism_type = "tourism" if cat in TOURISM_CATS else "resident" if cat in RESIDENT_CATS else "other"
            row = [cat, tourism_type] + [
                f"{100 * counts[cat][yr] / totals[yr]:.4f}" for yr in ALL_YEARS
            ]
            writer.writerow(row)

    print(f"\n\nOutputs saved to: {OUTPUT_DIR}/")
    print(f"  - lisbon_business_trends.csv (absolute counts)")
    print(f"  - lisbon_business_trends_pct.csv (% of total establishments)")


if __name__ == "__main__":
    main()
