#!/usr/bin/env python3
"""
assemble_arctic_shapefile.py
-----------------------------
Downloads Natural Earth + GADM boundaries and assembles a GeoJSON
that matches the Arctic/circumpolar regions dataset.

Output: outputs/arctic_regions.geojson

Region-source notes:
  Most regions    → Natural Earth 10m admin-1 (ne_10m_admin_1_states_provinces)
  Nunavik (CA/QC) → GADM CAN level-2, Kativik Regional Government area
                    (falls back to clipping Quebec north of 55 °N)
  Labrador (CA/NF)→ GADM CAN level-2, Labrador division
                    (falls back to mainland clip of NL province)
  Evenki Okrug    → NE still carries this dissolved okrug; fallback: centroid point
  Taymyr Okrug    → same as Evenki
  Koryak Okrug    → NE "Koryakia" region; fallback: centroid point
  Björnøya        → tiny island in Svalbard archipelago; not a separate NE feature;
                    represented as a 0.1° buffer around 74.47°N 19.01°E

Install:  pip install geopandas requests
"""

import io
import sys
import warnings
import zipfile
from pathlib import Path

import geopandas as gpd
import pandas as pd
import requests
from shapely.geometry import Point, box
from shapely.ops import unary_union

warnings.filterwarnings("ignore")

# ── Paths ─────────────────────────────────────────────────────────────────────
ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "datasets" / "arctic_cache"
OUT = ROOT / "outputs" / "arctic_regions.geojson"
CACHE.mkdir(parents=True, exist_ok=True)

# ── Dataset (inline, deduped) ─────────────────────────────────────────────────
ROWS = [
    ("Canada",        "Yukon",                   "CA",  "YT",       27957,   46704),
    ("Canada",        "Nunavut",                 "CA",  "NU",       22154,   41159),
    ("Canada",        "Northwest Territories",   "CA",  "NT",       38724,   44741),
    ("Canada",        "Nunavik",                 "CA",  "QC",        7689,   14045),
    ("Canada",        "Labrador",                "CA",  "NF",       30689,   25390),
    ("Finland",       "Lappi",                   "FI",  "FI1A3",   199973,  176150),
    ("Finland",       "Kainuu",                  "FI",  "FI18",     92458,   70164),
    ("Finland",       "Norra Österbotten",       "FI",  "FI17",    348292,  418205),
    ("Faroe Islands", "Faroe Islands",           "FO",  "DKXXA",    47773,   54492),
    ("Greenland",     "Greenland",               "GL",  "GL",       55558,   56699),
    ("Iceland",       "Iceland",                 "IS",  "IS000",   253785,  383726),
    ("Norway",        "Jan Mayen",               "NO",  "NOXXC",        0,       0),
    ("Norway",        "Troms",                   "NO",  "NO072",   146594,  169610),
    ("Norway",        "Björnoya",                "NO",  "NOXXB",        0,       0),
    ("Norway",        "Finnmark",                "NO",  "NO073",    74148,   75053),
    ("Norway",        "Svalbard",                "NO",  "NOXXA",    3544,    3042),
    ("Norway",        "Nordland",                "NO",  "NO071",   239532,  243081),
    ("Russia",        "Krasnoyarsk kray",        "RUS", "RUS-KRA", 3155929, 2846120),
    ("Russia",        "KoryakOkrg a Kamchatka",  "RUS", "RU-KQ",   514533,  212271),
    ("Russia",        "Karelian Republic",       "RUS", "RU-KI",   791719,  523856),
    ("Russia",        "Khanty-Mansiy Okrug",     "RUS", "RU-KM",  1267030, 1759386),
    ("Russia",        "Evenki Okrug",            "RUS", "RU-KX",    24005,   13258),
    ("Russia",        "Magadan Oblast",          "RUS", "RU-MG",   390276,  133387),
    ("Russia",        "Arkhangel'sk Oblast",     "RUS", "RU-AR",  1575502,  998072),
    ("Russia",        "Chukotka Okrug",          "RUS", "RUS-CHU", 162135,   48029),
    ("Russia",        "Murmansk Oblast",         "RUS", "RUS-MRM",1191468,  656438),
    ("Russia",        "Nenets Okrug",            "RUS", "RUS-NEN",  51993,   42224),
    ("Russia",        "Yamal-Nenets Okrug",      "RUS", "RUS-YMN", 489161,  515960),
    ("Russia",        "Taymyr Okrug",            "RUS", "RUS-TAY",  51867,   29609),
    ("Russia",        "Sakha Republic (Yakutia)","RUS", "RUS-YAK",1111480, 1001664),
    ("Sweden",        "Västerbotten",            "SE",  "SE24",    251968,  279062),
    ("Sweden",        "Norrbotten",              "SE",  "SE082",   263735,  248429),
    ("United States", "Alaska",                  "US",  "AK",      553171,  736947),
    ("Russia",        "Respublika Komi",         "RUS", "RUS-KOM",1248891,  720610),
]

df = pd.DataFrame(ROWS, columns=[
    "Country_name", "ADMIN_NAME", "CNTRY", "ADMIN", "pop_1990", "pop_2024"
]).drop_duplicates(subset=["ADMIN_NAME", "CNTRY"])  # drop duplicate Chukotka


# ── Download helpers ───────────────────────────────────────────────────────────
def _dl(url: str, desc: str, timeout: int = 180) -> bytes:
    print(f"  Downloading {desc}...")
    r = requests.get(url, timeout=timeout, stream=True)
    r.raise_for_status()
    chunks = []
    for chunk in r.iter_content(65536):
        chunks.append(chunk)
    return b"".join(chunks)


def get_ne_admin1() -> gpd.GeoDataFrame:
    cache = CACHE / "ne_10m_admin1.gpkg"
    if cache.exists():
        return gpd.read_file(cache)
    data = _dl(
        "https://naciscdn.org/naturalearth/10m/cultural/ne_10m_admin_1_states_provinces.zip",
        "Natural Earth 10m admin-1 (~5 MB)",
    )
    raw_dir = CACHE / "ne_raw"
    raw_dir.mkdir(exist_ok=True)
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        z.extractall(raw_dir)
    shp = next(raw_dir.glob("*.shp"))
    gdf = gpd.read_file(shp)
    gdf.to_file(cache, driver="GPKG")
    return gdf


def get_gadm(iso3: str, level: int = 2) -> gpd.GeoDataFrame:
    cache = CACHE / f"gadm_{iso3}_L{level}.gpkg"
    if cache.exists():
        return gpd.read_file(cache)
    url = f"https://geodata.ucdavis.edu/gadm/gadm4.1/gpkg/gadm41_{iso3}.gpkg"
    data = _dl(url, f"GADM {iso3} level {level}", timeout=300)
    tmp = CACHE / f"gadm41_{iso3}_raw.gpkg"
    tmp.write_bytes(data)
    gdf = gpd.read_file(tmp, layer=f"ADM_ADM_{level}")
    gdf.to_file(cache, driver="GPKG")
    tmp.unlink(missing_ok=True)
    return gdf


# ── Natural Earth name mapping ────────────────────────────────────────────────
# Maps ADMIN_NAME → substring to search in NE name / name_en fields
# None = handle as special case below
NE_MAP = {
    # Canada (territories are admin-1 in NE)
    "Yukon":                   "Yukon",
    "Nunavut":                 "Nunavut",
    "Northwest Territories":   "Northwest Territories",
    "Nunavik":                 None,   # sub-provincial → GADM
    "Labrador":                None,   # sub-provincial → GADM

    # Finland – NE uses English names for Finnish regions
    "Lappi":                   "Lapland",            # NE name_en = "Lapland"
    "Kainuu":                  "Kainuu",
    "Norra Österbotten":       "Northern Ostrobothnia",  # NE name_en

    # Nordic territories – Faroe Islands & Iceland come from countries file (see special cases)
    "Faroe Islands":           None,   # → NE countries file (iso_a2="FO")
    "Greenland":               "Greenland",
    "Iceland":                 None,   # → NE countries file (iso_a2="IS") — NE splits into regions

    # Norway
    "Jan Mayen":               None,   # → synthetic point buffer (not in NE admin-1)
    "Svalbard":                "Svalbard",
    "Björnoya":                None,   # → synthetic point buffer
    "Nordland":                "Nordland",
    "Troms":                   "Troms",
    "Finnmark":                "Finnmark",

    # Russia
    "Krasnoyarsk kray":        "Krasnoyarsk",
    # Koryak AO merged into Kamchatka Krai 2007; dataset treats them as one unit (~514k pop)
    "KoryakOkrg a Kamchatka":  "Kamchatka",          # NE = "Kamchatka Krai"
    "Karelian Republic":       "Karelia",
    "Khanty-Mansiy Okrug":     "Khanty-Mansiy",       # NE name (not "Khanty-Mansiysk")
    "Evenki Okrug":            None,   # dissolved into Krasnoyarsk Krai 2007; not in NE
    "Magadan Oblast":          "Magadan",
    "Arkhangel'sk Oblast":     "Arkhangel",
    "Chukotka Okrug":          "Chukotka",
    "Murmansk Oblast":         "Murmansk",
    "Nenets Okrug":            "Nenets",
    "Yamal-Nenets Okrug":      "Yamalo-Nenets",
    "Taymyr Okrug":            None,   # dissolved into Krasnoyarsk Krai 2007; not in NE
    "Sakha Republic (Yakutia)":"Sakha",
    "Respublika Komi":         "Komi",

    # Sweden
    "Västerbotten":            "Västerbotten",
    "Norrbotten":              "Norrbotten",

    # USA
    "Alaska":                  "Alaska",
}

# Fallback search strings (e.g. when Norwegian counties were merged 2020-2024)
NE_FALLBACK = {
    "Troms":    "Troms",
    "Finnmark": "Troms og Finnmark",  # NE data from 2020-2023 shows merged county
}


def ne_lookup(ne_sub: gpd.GeoDataFrame, search: str) -> gpd.GeoDataFrame:
    """Search NE admin-1 subset for a name fragment (case-insensitive)."""
    mask = (
        ne_sub["name_en"].str.contains(search, case=False, na=False)
        | ne_sub["name"].str.contains(search, case=False, na=False)
    )
    return ne_sub[mask]


# ── Main assembly ─────────────────────────────────────────────────────────────
def main():
    print("\n=== Arctic regions shapefile assembler ===\n")

    # 1. Load Natural Earth
    print("Loading Natural Earth 10m admin-1...")
    ne = get_ne_admin1()

    # Subset to the countries we care about
    iso2_keep = {"CA", "FI", "FO", "GL", "IS", "NO", "RU", "SE", "US"}
    ne_sub = ne[ne["iso_a2"].isin(iso2_keep)].copy()
    print(f"  {len(ne_sub)} features in target countries\n")

    features = []    # list of dicts with geometry
    special_cases = []
    not_found = []

    # 2. Match most regions from NE
    for _, row in df.iterrows():
        admin = row["ADMIN_NAME"]
        search = NE_MAP.get(admin)

        if search is None:
            special_cases.append(row)
            continue

        hits = ne_lookup(ne_sub, search)

        if len(hits) == 0:
            # Try fallback search string
            fb = NE_FALLBACK.get(admin)
            if fb:
                hits = ne_lookup(ne_sub, fb)
                if len(hits) > 0:
                    print(f"  [fallback] {admin}: matched via '{fb}'")

        if len(hits) == 0:
            print(f"  [WARN] not found in NE: {admin!r} (searched '{search}')")
            not_found.append(row)
            continue

        # If multiple hits, prefer exact name match
        if len(hits) > 1:
            exact = hits[hits["name_en"] == search]
            if len(exact) == 1:
                hits = exact
            else:
                # Take the one whose iso_a2 matches country
                iso2 = {"CA": "CA", "FI": "FI", "NO": "NO", "RU": "RU",
                         "SE": "SE", "US": "US"}.get(row["CNTRY"])
                if iso2:
                    filtered = hits[hits["iso_a2"] == iso2]
                    if len(filtered) >= 1:
                        hits = filtered.iloc[0:1].copy()

        geom = unary_union(hits.geometry)
        feat = row.to_dict()
        feat["geometry"] = geom
        feat["source"] = "NaturalEarth"
        features.append(feat)
        print(f"  [ok] {admin}")

    # 3. Special cases
    print("\n--- Special cases ---")

    # 3a. Nunavik (northern Quebec)
    nunavik_row = df[df["ADMIN_NAME"] == "Nunavik"].iloc[0]
    try:
        print("  Nunavik: trying GADM CAN level-2...")
        gadm_ca2 = get_gadm("CAN", level=2)
        hits = gadm_ca2[
            gadm_ca2["NAME_2"].str.contains("Kativik|Nunavik", case=False, na=False)
        ]
        if len(hits) > 0:
            geom = unary_union(hits.geometry)
            feat = nunavik_row.to_dict()
            feat["geometry"] = geom
            feat["source"] = "GADM_CAN_L2_Kativik"
            features.append(feat)
            print("  [ok] Nunavik → Kativik Regional Government area")
        else:
            # Fallback: clip Quebec above 55°N
            print("  Nunavik: Kativik not found; clipping Quebec > 55°N...")
            qc = gadm_ca2[gadm_ca2["NAME_1"].str.contains("Quebec|Québec", case=False, na=False)]
            clip = box(-85, 55, -55, 85)
            nunavik_geom = unary_union(qc.clip(clip).geometry)
            feat = nunavik_row.to_dict()
            feat["geometry"] = nunavik_geom
            feat["source"] = "GADM_CAN_L2_QC_north55"
            features.append(feat)
            print("  [approx] Nunavik: clipped Quebec > 55°N")
    except Exception as e:
        print(f"  [WARN] Nunavik GADM failed: {e}; skipping")
        not_found.append(nunavik_row)

    # 3b. Labrador (mainland portion of Newfoundland and Labrador)
    labrador_row = df[df["ADMIN_NAME"] == "Labrador"].iloc[0]
    try:
        print("  Labrador: trying GADM CAN level-2...")
        if "gadm_ca2" not in dir():
            gadm_ca2 = get_gadm("CAN", level=2)
        # GADM NL province level-2 has census divisions; Labrador = western divisions
        nl = gadm_ca2[
            gadm_ca2["NAME_1"].str.contains("Newfoundland|Labrador", case=False, na=False)
        ]
        hits = nl[nl["NAME_2"].str.contains("Labrador", case=False, na=False)]
        if len(hits) > 0:
            geom = unary_union(hits.geometry)
            feat = labrador_row.to_dict()
            feat["geometry"] = geom
            feat["source"] = "GADM_CAN_L2_Labrador"
            features.append(feat)
            print("  [ok] Labrador → GADM level-2 Labrador divisions")
        else:
            # Fallback: mainland clip (west of ~53°W; the island is 47–51°N, east)
            print("  Labrador: divisions not found; clipping NL mainland...")
            mainland_clip = box(-70, 52, -52, 62)
            lab_geom = unary_union(nl.clip(mainland_clip).geometry)
            feat = labrador_row.to_dict()
            feat["geometry"] = lab_geom
            feat["source"] = "GADM_CAN_L2_NL_mainland_approx"
            features.append(feat)
            print("  [approx] Labrador: clipped NL mainland portion")
    except Exception as e:
        print(f"  [WARN] Labrador GADM failed: {e}; skipping")
        not_found.append(labrador_row)

    # 3c. Björnøya (Bear Island) – part of Svalbard; no separate polygon in NE
    #     Use a small point buffer around its known coordinates
    bjorn_row = df[df["ADMIN_NAME"] == "Björnoya"].iloc[0]
    bjornoya_pt = Point(19.017, 74.470)   # lon, lat (WGS84)
    bjornoya_geom = bjornoya_pt.buffer(0.15)   # ~15 km radius circle
    feat = bjorn_row.to_dict()
    feat["geometry"] = bjornoya_geom
    feat["source"] = "synthetic_point_buffer"
    features.append(feat)
    print("  [synthetic] Björnøya: 0.15° buffer around 74.47°N 19.02°E (island not in NE)")

    # 3d. Faroe Islands – use NE countries file (admin-1 only has one internal region)
    faroe_row = df[df["ADMIN_NAME"] == "Faroe Islands"].iloc[0]
    try:
        ctr = gpd.read_file(CACHE / "ne_10m_countries.gpkg")
        fo = ctr[ctr["ISO_A2"] == "FO"]
        if len(fo) > 0:
            geom = unary_union(fo.geometry)
            feat = faroe_row.to_dict()
            feat["geometry"] = geom
            feat["source"] = "NE_countries_FO"
            features.append(feat)
            print("  [ok] Faroe Islands → NE countries file")
        else:
            print("  [WARN] Faroe Islands: not found in countries file")
            not_found.append(faroe_row)
    except Exception as e:
        print(f"  [WARN] Faroe Islands failed: {e}")
        not_found.append(faroe_row)

    # 3e. Iceland – dissolve all IS admin-1 regions into one polygon
    iceland_row = df[df["ADMIN_NAME"] == "Iceland"].iloc[0]
    is_features = ne_sub[ne_sub["iso_a2"] == "IS"]
    if len(is_features) > 0:
        geom = unary_union(is_features.geometry)
        feat = iceland_row.to_dict()
        feat["geometry"] = geom
        feat["source"] = "NE_admin1_IS_dissolved"
        features.append(feat)
        print(f"  [ok] Iceland → dissolved {len(is_features)} NE admin-1 regions")
    else:
        # Fallback: use countries file
        try:
            if "ctr" not in dir():
                ctr = gpd.read_file(CACHE / "ne_10m_countries.gpkg")
            isl = ctr[ctr["ISO_A2"] == "IS"]
            if len(isl) > 0:
                geom = unary_union(isl.geometry)
                feat = iceland_row.to_dict()
                feat["geometry"] = geom
                feat["source"] = "NE_countries_IS"
                features.append(feat)
                print("  [ok] Iceland → NE countries file")
        except Exception as e:
            print(f"  [WARN] Iceland failed: {e}")
            not_found.append(iceland_row)

    # 3f. Jan Mayen – Norwegian island at 71.03°N, 8.30°W; not in NE admin-1
    #     Population = 0 in the dataset (weather station only); point buffer is sufficient
    jan_row = df[df["ADMIN_NAME"] == "Jan Mayen"].iloc[0]
    jan_pt = Point(-8.30, 71.03)
    jan_geom = jan_pt.buffer(0.25)   # ~25 km radius
    feat = jan_row.to_dict()
    feat["geometry"] = jan_geom
    feat["source"] = "synthetic_point_buffer"
    features.append(feat)
    print("  [synthetic] Jan Mayen: 0.25° buffer at 71.03°N 8.30°W")

    # 3g. Evenki Okrug – dissolved into Krasnoyarsk Krai 2007; no longer in NE
    #     Evenk District of Krasnoyarsk: roughly 60-67°N, 90-108°E
    #     Using a rough bounding polygon as approximation
    evenki_row = df[df["ADMIN_NAME"] == "Evenki Okrug"].iloc[0]
    from shapely.geometry import Polygon
    # Approximate Evenki AO boundary box (very rough; ~767,600 km²)
    evenki_approx = box(90.0, 58.5, 108.0, 67.5)
    feat = evenki_row.to_dict()
    feat["geometry"] = evenki_approx
    feat["source"] = "synthetic_bbox_approx"
    features.append(feat)
    print("  [approx bbox] Evenki Okrug: rough bounding box (dissolved 2007; use historical GADM for accuracy)")

    # 3h. Taymyr Okrug – dissolved into Krasnoyarsk Krai 2007; no longer in NE
    #     Taymyr Dolgan-Nenets District: roughly 70-78°N, 80-106°E
    taymyr_row = df[df["ADMIN_NAME"] == "Taymyr Okrug"].iloc[0]
    taymyr_approx = box(80.0, 68.0, 106.0, 78.5)
    feat = taymyr_row.to_dict()
    feat["geometry"] = taymyr_approx
    feat["source"] = "synthetic_bbox_approx"
    features.append(feat)
    print("  [approx bbox] Taymyr Okrug: rough bounding box (dissolved 2007; use historical GADM for accuracy)")

    # 4. Combine and export
    print(f"\n--- Results ---")
    print(f"  Matched: {len(features)}")
    print(f"  Not found: {[r['ADMIN_NAME'] for r in not_found]}")

    gdf = gpd.GeoDataFrame(features, crs="EPSG:4326")

    # Ensure clean column order
    cols = ["Country_name", "ADMIN_NAME", "CNTRY", "ADMIN",
            "pop_1990", "pop_2024", "source", "geometry"]
    gdf = gdf[[c for c in cols if c in gdf.columns]]

    gdf.to_file(OUT, driver="GeoJSON")
    print(f"\n✓ Saved {len(gdf)} features → {OUT.relative_to(ROOT)}")

    # Summary table
    print("\n" + gdf[["Country_name", "ADMIN_NAME", "ADMIN", "pop_1990", "pop_2024", "source"]].to_string(index=False))

    if not_found:
        print("\n⚠  Regions with no geometry (add manually or check NE data vintage):")
        for r in not_found:
            print(f"   • {r['ADMIN_NAME']} ({r['CNTRY']})")

    print("\nDone.")


if __name__ == "__main__":
    main()
