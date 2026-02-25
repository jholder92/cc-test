#!/usr/bin/env python3
"""
assemble_arctic_settlements.py
-------------------------------
Downloads GeoNames populated-places data and assembles a point dataset
of settlements within Arctic regions, classified by population — matching
Nordregio's circumpolar settlement map categories.

Population classes:
  <2,000  |  2,000–5,000  |  5,000–10,000  |  10,000–50,000  |  >50,000

Output: outputs/arctic_settlements.geojson

Sources:
  Populated places  → GeoNames free country dumps (download.geonames.org)
  Region boundaries → outputs/arctic_regions.geojson (assembled separately)

Install: pip install geopandas requests pandas pyarrow
"""

import io
import zipfile
from pathlib import Path

import geopandas as gpd
import pandas as pd
import requests

ROOT    = Path(__file__).resolve().parent.parent
CACHE   = ROOT / "datasets" / "arctic_cache"
REGIONS = ROOT / "outputs" / "arctic_regions.geojson"
OUT     = ROOT / "outputs" / "arctic_settlements.geojson"
CACHE.mkdir(parents=True, exist_ok=True)

# Countries that have territory in the Arctic regions dataset
COUNTRIES = ["CA", "FI", "FO", "GL", "IS", "NO", "RU", "SE", "US"]

GEONAMES_COLS = [
    "geonameid", "name", "asciiname", "alternatenames",
    "latitude", "longitude", "feature_class", "feature_code",
    "country_code", "cc2", "admin1_code", "admin2_code",
    "admin3_code", "admin4_code", "population",
    "elevation", "dem", "timezone", "modification_date",
]

# Feature codes to exclude: sub-sections, abandoned, and destroyed places
EXCLUDE_CODES = {"PPLX", "PPLQ", "PPLW", "PPLS", "PPLCH"}


def pop_class(pop) -> str:
    """Map a raw population value to a Nordregio-style size class label."""
    if pd.isna(pop) or pop <= 0:
        return "<2,000"   # unknown / unstated → smallest class
    elif pop < 2_000:
        return "<2,000"
    elif pop < 5_000:
        return "2,000–5,000"
    elif pop < 10_000:
        return "5,000–10,000"
    elif pop < 50_000:
        return "10,000–50,000"
    else:
        return ">50,000"


def download_geonames(country_code: str) -> pd.DataFrame:
    """Return GeoNames populated places for one country (cached as parquet)."""
    cache_path = CACHE / f"geonames_{country_code}.parquet"
    if cache_path.exists():
        print(f"  [cache] {country_code}")
        return pd.read_parquet(cache_path)

    url = f"https://download.geonames.org/export/dump/{country_code}.zip"
    print(f"  Downloading {country_code} from GeoNames …")
    r = requests.get(url, timeout=600, stream=True)
    r.raise_for_status()
    data = b"".join(r.iter_content(65536))

    with zipfile.ZipFile(io.BytesIO(data)) as z:
        with z.open(f"{country_code}.txt") as f:
            df = pd.read_csv(
                f,
                sep="\t",
                header=None,
                names=GEONAMES_COLS,
                dtype={"population": "Int64"},
                low_memory=False,
                encoding="utf-8",
            )

    # Filter to populated places, dropping sub-sections / abandoned entries
    df = df[
        (df["feature_class"] == "P") &
        (~df["feature_code"].isin(EXCLUDE_CODES))
    ].copy()

    df.to_parquet(cache_path, index=False)
    print(f"  [ok] {country_code}: {len(df):,} populated places")
    return df


def main():
    print("\n=== Arctic settlements assembler ===\n")

    # 1. Load the Arctic region polygons we already assembled
    print("Loading Arctic region boundaries …")
    regions = gpd.read_file(REGIONS)
    print(f"  {len(regions)} regions")

    # 2. Download GeoNames for each country
    print("\nDownloading GeoNames populated places …")
    frames = []
    for cc in COUNTRIES:
        try:
            frames.append(download_geonames(cc))
        except Exception as e:
            print(f"  [WARN] {cc} failed: {e}")

    places = pd.concat(frames, ignore_index=True)
    print(f"\nTotal populated places (all countries): {len(places):,}")

    # 3. Build a GeoDataFrame of point geometries
    places = places.dropna(subset=["latitude", "longitude"])
    gdf = gpd.GeoDataFrame(
        places[["geonameid", "name", "country_code", "admin1_code",
                "feature_code", "population"]],
        geometry=gpd.points_from_xy(places["longitude"], places["latitude"]),
        crs="EPSG:4326",
    )

    # 4. Spatial join: keep only settlements inside an Arctic region polygon
    #    (uses GeoPandas R-tree index → fast even for large datasets)
    print("Spatial join against Arctic regions …")
    gdf = gpd.sjoin(
        gdf,
        regions[["ADMIN_NAME", "Country_name", "CNTRY", "geometry"]],
        how="inner",
        predicate="within",
    )
    gdf = gdf.drop(columns=["index_right"], errors="ignore")
    print(f"Settlements within Arctic regions: {len(gdf):,}")

    # 5. Classify by population
    gdf["pop_class"] = gdf["population"].apply(pop_class)

    # 6. Tidy columns and export
    gdf = gdf.rename(columns={"name": "settlement_name"})
    cols = [
        "settlement_name", "country_code", "feature_code",
        "population", "pop_class",
        "ADMIN_NAME", "Country_name", "CNTRY",
        "geometry",
    ]
    gdf = gdf[[c for c in cols if c in gdf.columns]]

    gdf.to_file(OUT, driver="GeoJSON")
    print(f"\n✓ Saved {len(gdf):,} settlements → {OUT.relative_to(ROOT)}")

    # Summary
    class_order = ["<2,000", "2,000–5,000", "5,000–10,000", "10,000–50,000", ">50,000"]
    print("\nSettlements by population class:")
    for cls in class_order:
        n = (gdf["pop_class"] == cls).sum()
        print(f"  {cls:>16}  {n:>5}")

    print("\nTop 20 settlements by population:")
    top = (
        gdf[gdf["population"].notna() & (gdf["population"] > 0)]
        .nlargest(20, "population")
        [["settlement_name", "ADMIN_NAME", "population"]]
    )
    print(top.to_string(index=False))

    print("\nDone.")


if __name__ == "__main__":
    main()
