# Tourism Reshaping European City Centers — Data Investigation

A data journalism project examining how tourism is transforming the commercial
landscape of European city centers, replacing resident-serving businesses with
tourist-oriented establishments.

**Cities: Lisbon (Portugal) · Venice (Italy) · Athens (Greece)**

---

## Key Findings

### Lisbon (1991–2010 — Official Municipal Census)
- **Tourism:Resident business ratio**: 0.88:1 in 1991 → **3.03:1 by 2010** (nearly 3.5x shift)
- **Food & drink sector** (cafés, restaurants, bars, snack bars): grew from **18% to 33%** of all commercial establishments
- **Traditional grocers** (mercearias): share fell from 6.3% → 2.9% — **halved as a proportion**
- **Bakeries**: share halved from 2.65% → 1.19% despite city overall growing
- **Souvenir & craft shops**: +250% in absolute numbers (48 → 168)
- *Note: The most dramatic phase of Lisbon's transformation — driven by Airbnb (from 2012), the Golden Visa programme, and low-cost aviation — is not captured in this data, which ends in 2010.*

### Venice (2009–2022 — Academic Research + Municipal Data)
- Tourist-oriented shops: **~45% in 2009 → 74.5% by 2017 → 80%+ by 2022**
- In 2017, only **437 of 1,715 shops** (25.5%) served residents; 1,278 targeted tourists exclusively
- Only **23 grocery stores** remained in 2017 for a population of ~53,000 residents
  — approximately **1 grocer per 2,300 residents**
- Historic center population: **174,808 (1951) → ~48,900 (2023)** — a 72% collapse
- 2019 peak: **5.8 million tourist arrivals** — more than **118 tourists per resident**
- City passed DCC 26/2022 ("anti-paccottiglia" law) banning new tourist shops, with 83% reduction in neighbourhood shop closures by May 2025

### Athens (2010–2024 — National Statistics)
- Greek tourist arrivals: **15.0M (2010) → 40.7M (2024)** — a **171% increase**
- Tourism revenue: **€10B (2010) → €21.6B (2024)**
- Attica (Athens area) hotels: **doubled** from ~210 to ~420 (2010–2023)
- Airbnb in Athens: from ~2,000 listings (2014) to ~30,000 (2024) — **15x growth**
- **Data gap**: Unlike Lisbon and Venice, Athens has no publicly accessible commercial census data by business type

---

## Data Sources

| City    | Dataset | Source | Years | Status |
|---------|---------|--------|-------|--------|
| Lisbon  | Recenseamento Comercial | CML via ArcGIS FeatureServer | 1991–2010 | ✅ Downloaded (14 layers) |
| Venice  | Commercio dataset | dati.venezia.it | 2016 only | ❌ WAF-blocked (Incapsula) |
| Venice  | Shop type survey | Catalanotti (2021) IUAV / *European Spatial Research and Policy* | 2017 | 📄 Academic paper |
| Athens  | Tourism arrivals | ELSTAT / INSETE | 2010–2024 | 📊 Published statistics |
| Athens  | Hotel census | ELSTAT | 2010–2023 | 📊 Published statistics |

### Data Limitations
- **Lisbon data ends 2010** — the most dramatic touristification (Airbnb era) is not captured
- **Venice CSV files** at dati.venezia.it are protected by Incapsula WAF and could not be downloaded; Venice figures come from peer-reviewed academic research
- **Athens has no granular commercial census** available as open data
- **OSM historical data** (ohsome.org) was tested but discarded — it tracks mapping coverage, not actual business presence, making it unsuitable for this analysis

---

## Repository Structure

```
datasets/
  lisbon/          14 GeoJSON files, CML commercial census 1991-2010
  venice/          Placeholder (Venice data inaccessible due to WAF)
  osm/             OSM timeseries (NOT used in analysis — see warning in README)
  athens/          Placeholder (no machine-readable Athens census available)
scripts/
  01_lisbon_analysis.py     Full Lisbon census analysis
  02_venice_analysis.py     Venice data documentation + findings
  03_athens_analysis.py     Athens/Greece data documentation + findings
  04_combined_findings.py   Combined report across all three cities
outputs/
  lisbon_business_trends.csv        Absolute counts by category, 1991-2010
  lisbon_business_trends_pct.csv    Percentage shares by category, 1991-2010
  venice_analysis.json              Venice data points and findings
  athens_analysis.json              Athens data points and findings
  combined_findings.json            Combined cross-city findings
```

---

## Running the Analysis

```bash
python3 scripts/01_lisbon_analysis.py   # Lisbon census trends
python3 scripts/02_venice_analysis.py   # Venice findings
python3 scripts/03_athens_analysis.py   # Athens/Greece findings
python3 scripts/04_combined_findings.py # Combined report
```

No dependencies beyond the Python standard library.

---

## Lisbon Data Notes

The Recenseamento Comercial (Commercial Census) was conducted by Câmara Municipal de Lisboa and is available via:
- **ArcGIS**: `https://services.arcgis.com/1dSrzEWVQn5kHHyK/arcgis/rest/services/RecenseamentoComercial/FeatureServer`
- **Dados abertos**: `https://dados.cm-lisboa.pt/dataset/recenseamento-comercial-1991`

**Important caveat**: Years 1993 and 1996 have only ~1,500-1,650 records vs 14,000-18,000 for full census years. These appear to be partial surveys and are **excluded from trend analysis** but included in raw data files.

The 1991 data uses different category names (e.g., `CAFE/PASTELARIA - 3ª CATEGORIA` with star ratings) compared to later years (`Café/Pastelaria`). The analysis scripts use case-insensitive substring matching to handle this consistently.

---

## What to Investigate Next

1. **Lisbon post-2010**: Contact CML directly (geodados@cm-lisboa.pt) for any commercial monitoring data 2010-2025
2. **Venice 2023 snapshot**: Contact Comune di Venezia Ufficio Statistica; or request data extraction from dati.venezia.it
3. **Athens**: Submit formal data request to Athens Chamber of Commerce (ACCI) or use Greek administrative procedure law (Ν. 2690/1999)
4. **Neighbourhood-level analysis**: The Lisbon data includes `FREGUESIA` (parish) codes — analysis at parish level would reveal which specific neighbourhoods transformed most
5. **Expand to other cities**: Barcelona, Amsterdam, Dubrovnik, and Split have documented similar transformations; several have open data portals

---

## Methodology Notes

**What counts as "tourism-oriented"?**
- Cafés, restaurants, snack bars, bars & pubs
- Souvenir and craft shops
- Hotels and accommodation

**What counts as "resident-serving"?**
- Traditional grocers (mercearias), supermarkets
- Bakeries, butchers, fishmongers
- Pharmacies, tobacconists, newsagents
- Hardware/DIY stores, furniture shops

These are conservative categorisations. Many "clothing shops" may also be tourist-oriented but are classified as neutral/other due to ambiguity.

---

## Sources & Citations

- **Catalanotti, C. (2021)**. Competing landscapes of commerce and tourism: Critical relations and possible strategies in Venice's historical city. *European Spatial Research and Policy*, 28(2). https://czasopisma.uni.lodz.pl/esrap/article/view/13455
- **Comune di Venezia** (2022). DCC 26/2022 — Regulation of commercial activities in the historic center.
- **Comune di Venezia** (2023). Yearbook of Tourism Data 2023. https://www.comune.venezia.it
- **INSETE** (2024). Greek Tourism: Key Figures 2024.
- **Bank of Greece** (2025). Tourism receipts data.
- **CML / Câmara Municipal de Lisboa** — Recenseamento Comercial 1991–2010. https://dados.cm-lisboa.pt
- **ELSTAT** (Hellenic Statistical Authority) — Tourism Statistics. https://www.statistics.gr
