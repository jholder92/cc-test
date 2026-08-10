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

GEONAMES_COLS = [
    "geonameid", "name", "asciiname", "alternatenames",
    "latitude", "longitude", "feature_class", "feature_code",
    "country_code", "cc2", "admin1_code", "admin2_code",
    "admin3_code", "admin4_code", "population",
    "elevation", "dem", "timezone", "modification_date",
]

# Feature codes to exclude: sub-sections, abandoned, and destroyed places
EXCLUDE_CODES = {"PPLX", "PPLQ", "PPLW", "PPLS", "PPLCH"}

# Arctic country codes (for filtering the global file)
ARCTIC_COUNTRIES = {"CA", "FI", "FO", "GL", "IS", "NO", "RU", "SE", "US"}


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


def load_geonames_places() -> pd.DataFrame:
    """
    Download GeoNames cities1000 — a single global file of all populated
    places with population ≥ 1,000.  Cached as parquet after first download.
    Returns a normalised DataFrame with columns:
      name, latitude, longitude, country_code, feature_code, population
    """
    cache_path = CACHE / "geonames_cities1000.parquet"
    if cache_path.exists():
        print("  [cache] GeoNames cities1000")
        return pd.read_parquet(cache_path)

    url = "https://download.geonames.org/export/dump/cities1000.zip"
    print("  Downloading GeoNames cities1000 (pop ≥ 1,000, global) …")
    r = requests.get(url, timeout=300, stream=True)
    r.raise_for_status()
    data = b"".join(r.iter_content(65536))

    with zipfile.ZipFile(io.BytesIO(data)) as z:
        with z.open("cities1000.txt") as f:
            df = pd.read_csv(
                f, sep="\t", header=None, names=GEONAMES_COLS,
                dtype={"population": "Int64"}, low_memory=False,
            )

    df = df[~df["feature_code"].isin(EXCLUDE_CODES)].copy()
    df.to_parquet(cache_path, index=False)
    print(f"  [ok] {len(df):,} places")
    return df


def load_ne_places() -> pd.DataFrame:
    """
    Fallback: Natural Earth 10m populated places shapefile.
    Normalises columns to match the GeoNames schema used downstream.
    """
    cache_gpkg = CACHE / "ne_10m_populated_places.gpkg"
    if cache_gpkg.exists():
        print("  [cache] Natural Earth populated places")
        gdf = gpd.read_file(cache_gpkg)
    else:
        url = ("https://naciscdn.org/naturalearth/10m/cultural/"
               "ne_10m_populated_places.zip")
        print("  Downloading Natural Earth populated places (~1 MB) …")
        r = requests.get(url, timeout=120, stream=True)
        r.raise_for_status()
        data = b"".join(r.iter_content(65536))
        raw_dir = CACHE / "ne_ppl_raw"
        raw_dir.mkdir(exist_ok=True)
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            z.extractall(raw_dir)
        shp = next(raw_dir.glob("*.shp"))
        gdf = gpd.read_file(shp)
        gdf.to_file(cache_gpkg, driver="GPKG")
        print(f"  [ok] {len(gdf):,} places")

    # Normalise to common schema
    # NE uses ADM0_A3 (3-letter) — map to 2-letter for consistency
    iso3_to_2 = {
        "CAN": "CA", "FIN": "FI", "FRO": "FO", "GRL": "GL",
        "ISL": "IS", "NOR": "NO", "RUS": "RU", "SWE": "SE", "USA": "US",
    }
    df = pd.DataFrame({
        "name":         gdf["NAME"],
        "latitude":     gdf.geometry.y,
        "longitude":    gdf.geometry.x,
        "country_code": gdf["ADM0_A3"].map(iso3_to_2),
        "feature_code": "PPL",
        "population":   pd.array(gdf["POP_MAX"], dtype="Int64"),
    })
    return df


def main():
    print("\n=== Arctic settlements assembler ===\n")

    # 1. Load the Arctic region polygons we already assembled
    print("Loading Arctic region boundaries …")
    regions = gpd.read_file(REGIONS)
    print(f"  {len(regions)} regions")

    # 2. Load populated places — GeoNames preferred, NE as fallback
    print("\nLoading populated places …")
    try:
        all_places = load_geonames_places()
        source_label = "GeoNames cities1000"
    except Exception as e:
        print(f"  GeoNames unavailable ({e}); falling back to Natural Earth …")
        all_places = load_ne_places()
        source_label = "Natural Earth 10m populated places"
    print(f"  Source: {source_label}")

    # Pre-filter to Arctic countries before the expensive spatial join
    places = all_places[all_places["country_code"].isin(ARCTIC_COUNTRIES)].copy()
    print(f"  {len(places):,} places in Arctic countries")

    # 3. Build a GeoDataFrame of point geometries
    places = places.dropna(subset=["latitude", "longitude"])
    # Only keep columns that actually exist (schema differs between GeoNames and NE)
    keep_cols = [c for c in ["geonameid", "name", "country_code", "admin1_code",
                              "feature_code", "population"] if c in places.columns]
    gdf = gpd.GeoDataFrame(
        places[keep_cols],
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
