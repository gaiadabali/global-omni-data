# Sources for `@god/geo`

Everything in `data/` is derived from publications of the Australian Bureau of Statistics.

> © Australian Bureau of Statistics. Licensed under Creative Commons Attribution 4.0 International (CC BY 4.0).
> https://creativecommons.org/licenses/by/4.0/

Licence checked on 2026-11-26 at https://www.abs.gov.au/website-privacy-copyright-and-disclaimer: ABS website material is CC BY 4.0, with
exceptions that do not cover these files (Coat of Arms, ABS logo, unit record data, third-party content).

**Changes made by us** (CC BY 4.0 asks for this to be said): the boundaries are simplified for screen display (details
below), area centroids and suburb points are computed by us, suburb names have the ABS disambiguation suffix removed
("Richmond (Vic.)" becomes "Richmond"), and population by 5-year age group is re-cut into the dashboard's seven age bands
by pro-rating the 10–14 and 15–19 groups. The ABS does not endorse any of it.

The exact wording on the ABS "Attributing ABS material" page for derived data was not read (the page was not reachable
through the tool used, 2026-11-26). Check it before this goes in front of a customer. [UNVERIFIED]

## Boundaries: ASGS Edition 3 (2021), GDA2020

Edition: Australian Statistical Geography Standard (ASGS) Edition 3, July 2021 to June 2026. Digital boundary files,
ESRI shapefile, GDA2020. Page: https://www.abs.gov.au/statistics/standards/australian-statistical-geography-standard-asgs/edition-3-july-2021-june-2026/access-and-downloads/digital-boundary-files

| Layer | File | Released | SHA-256 (seen 2026-11-26) |
|---|---|---|---|
| States and territories (STE) | `STE_2021_AUST_SHP_GDA2020.zip` | 20 July 2021 (Main Structure) | `d9b7f735de6085b37414faf011f796dda3c7f768c55e9dce01f96e790f399a21` |
| SA4 | `SA4_2021_AUST_SHP_GDA2020.zip` | 20 July 2021 | `36eeceb69329f981d95d08b68e8e5af37c261d23e735d701b6e466acaa1bbe39` |
| SA3 | `SA3_2021_AUST_SHP_GDA2020.zip` | 20 July 2021 | `05215ddc3a577373aa929038cad4cd0fddf910d2f62dbc36cc9c628b5e0a6a32` |
| SA2 | `SA2_2021_AUST_SHP_GDA2020.zip` | 20 July 2021 | `c4dc5bac209f01177eaa0715d27f32cdb09ab5784fb82979741556d2f8e6d148` |
| Suburbs and Localities (SAL) | `SAL_2021_AUST_GDA2020_SHP.zip` | 6 October 2021 (Non ABS Structures) | `1284f6aa4a5eedbe6d0b8c71099494f634d59f1500532c1944b8227b4d1474ca` |

Every URL is the page above plus `/<file>`; the full URLs are in `data/manifest.json`. GDA2020 differs from WGS84 by about
1.8 m, far below the simplification, so coordinates are used as lon/lat directly.

## Population: Regional population by age and sex, 2025

Estimated resident population (ERP) by SA2, by sex and 5-year age group, as at **30 June 2025**. Released **27 August
2026** (next release 31 August 2027). Page: https://www.abs.gov.au/statistics/people/population/regional-population-age-and-sex/latest-release

File: `32350DS0001_2025.xlsx` ("Population estimates by age and sex, SA2, 2025"), table 3 (persons):
https://www.abs.gov.au/statistics/people/population/regional-population-age-and-sex/2025/32350DS0001_2025.xlsx
SHA-256 `35b4aadda000e7830813a8450cee2aa817891069353805a31e58f6fd3a3f4f02`. The file uses ASGS Edition 3 SA2s, so it matches
the boundaries one to one (checked: every SA2 with a shape has a row and no row is left over). Australia adds up to
27,613,654 in this table (all SA2s, including the Other Territories).

We did not need Census 2021 G01.

## How the build works

`scripts/build-data.mjs` (run on server-f by `scripts/server-f/remote-build.sh <tree> geo-data <name>`):

1. Downloads the six files into `/opt/god-build/cache/abs`, and stops if a SHA-256 differs from the one above.
2. Reads each shapefile with `shapefile`, builds a topology with `topojson-server` (neighbours share their boundary), and
   simplifies with `topojson-simplify` (Visvalingam; vertices whose triangle with its neighbours is under N m by N m are
   removed: state 800 m, SA4 400 m, SA3 250 m, SA2 150 m), then quantises to about 10 m. Shapes with no geometry (the
   "no usual address" and "migratory" special codes) are skipped.
3. Computes, per area, a label point inside the area (centroid of the largest part, or the best interior grid point when
   the centroid falls outside), the bounding box, and the area in km² (the ABS figure).
4. Reads SAL with `shapefile`, and for each suburb stores one interior point, its area and the SA2 it is in.
5. Reads the ERP workbook (zip and XML, parsed with `fflate`) into `population.json`.

Output sizes are in `data/manifest.json`.
