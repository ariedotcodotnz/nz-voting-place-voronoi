# Party Vote Atlas

An interactive atlas of New Zealand general-election **party votes at every polling place**, 2008–2026. Each polling place is drawn as an **estimated geographic catchment** over a Google basemap, and can be coloured by leading party, political bloc, single-party strength, head-to-head margin or historical swing. There are also proportional vote circles and an animated election timeline.

> The shapes are estimated catchments — the land nearer to a polling place than to any other — not official voting precincts and not where voters live. The map shows votes **cast at** polling places. Many people vote away from home, especially in advance.

- Static Next.js site (App Router, `output: 'export'`) for **Cloudflare Pages**; no backend.
- Google Maps JavaScript API basemap (roadmap, satellite, hybrid), with **deck.gl** overlays via `@deck.gl/google-maps`.
- A **Python pipeline** (pandas, GeoPandas, Shapely, SciPy, PyProj) turns the raw Electoral Commission files in `data/` into compact, hashed JSON assets in `public/data/`.

---

## Quick start

```bash
npm install
cp .env.example .env.local          # add NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
npm run dev                         # http://localhost:3000
```

The processed datasets in `public/data/` are committed, so the app runs without Python. To rebuild them from `data/`:

```bash
python3 -m venv .venv
.venv/bin/pip install -r pipeline/requirements.txt
npm run data                         # = python -m pipeline build  (≈7 min)
```

`npm run data` rewrites `public/data/`, writes `reports/processing-report.md` and `reports/issues.json`, then runs the output validation suite (non-zero exit on failure).

### All checks

```bash
npm run lint          # ESLint
npm run typecheck     # tsc --noEmit (strict)
npm test              # Vitest unit + component tests (incl. checks on the real data)
npm run test:py       # pytest: parsing, matching, linking, geometry, output validation
npm run data:validate # integrity checks on public/data
npm run build         # static export to out/
npx playwright install chromium && npm run test:e2e   # browser tests against out/ (needs a Maps key at build time)
npm run check         # everything except the browser tests
npm run videos        # social-media timeline videos (after npm run build; see "Timeline videos")
```

---

## Using the atlas

| Map mode | What it shows |
|---|---|
| **Leading party** (default) | Party with the most party votes at each polling place. Ties are shown in grey, never assigned to a winner. Optional lighter shading for narrow leads. |
| **Strongest bloc** | Bloc with the most combined votes. Two explicit variants: *TOP excluded* and *TOP included* (TOP can be counted with the centre-left, centre-right or as its own bloc). Every party's bloc can be changed under **Who is in each bloc?**. Unassigned votes are always reported separately. |
| **Party strength** | One party's vote share (or raw count) on a single-hue scale. The scale can be fixed across all elections for fair comparison, fitted to the current election, or set manually. "Not on the ballot" and "no votes recorded" are distinct from zero support. |
| **Vote circles** | Circle **area** ∝ votes (10× the votes = 10× the area). The same scale is used for every party and election. Circles can also be sized by vote share, or drawn as equal dots per polling place to remove the visual weight of large rural catchments. Optionally shows a second party, and combines nearby circles when zoomed out (combined areas still sum correctly). |
| **Head to head** | Diverging scale: which of two parties leads and by how many percentage points (or votes). |
| **Swing** | Change in a party's or bloc's share since a chosen election, **only at polling places matched to the same physical location**. Unmatched places are shown pale and are not treated as local swings. |
| **Split** (candidate vs party) | For a chosen party, how far its electorate candidates ran ahead of, or behind, its party vote at each polling place: candidate-vote share minus party-vote share, in percentage points. This shows ticket-splitting, for example a strong local candidate, or strategic electorate voting as in Epsom. |

**Party vote / Electorate vote:** a switch beside every mode except Split. "Electorate vote" redraws the mode from electorate (candidate) votes, summed by each candidate's party. A polling place can record votes for several electorates' candidates, because voters can vote outside their electorate, so the comparison is by party rather than by individual candidate. The details panel lists every candidate whose votes were recorded there, by electorate, with the electorate's winner and the candidate-vs-party gap for the main parties.

- **Timeline:** drag, click or use the arrow keys (Space plays and pauses). Playback waits until the next election has loaded, then crossfades the map gradually with an eased fade (1.8 s, 1.3 s or 0.75 s depending on speed), and stops at the last election unless looping is on. Each election's polygons are triangulated once and reused, so a switch never stalls to rebuild geometry. The crossfade is purely visual; every number shown belongs to a real election.
- **Details panel:** click any area or circle to see all parties ranked, votes by voters' home electorate, a party-share history chart for that physical location (gaps where there was no polling place, hollow points for uncertain matches), and the location and catchment notes.
- **Search** covers polling places, suburbs, electorates, regions and cities, from a local index with no paid Google Places calls.
- **Place names on top:** town, suburb, city and region names are drawn by deck.gl *above* the coloured overlay, with collisions removed (cities first, then busier suburbs) and more names appearing as you zoom in. Google's own suburb and town names, which sit underneath the overlay, are hidden while this is on so names aren't doubled. Street names stay on the basemap underneath. The setting can be turned off.
- **Settings:** boundary method, vote type (all, election day, advance), overlay opacity, place names on top, approximate electorate outlines, and looping.
- **URL:** the election, mode, parties, blocs, map position and selection are all kept in the URL, so every view can be shared.

---

## Data

### Sources (in `data/`, unmodified)

| Folder | Contents |
|---|---|
| `data/2008` … `data/2014` | Electoral Commission `e9_part8_party_N.csv` (party votes by polling place) + coordinate files |
| `data/2017` … `data/2023` | `party-votes-by-voting-place-N.csv` + `voting-place-coordinates*.csv` |
| `data/2026` | Preliminary results as per-electorate `.xlsx` workbooks + `places.json` (vote.nz voting places, with coordinates and electorates served) |
| `data/geographic` | Stats NZ **Meshblock 2026** (GeoPackage, *not in git*, see below) and LINZ **NZ Coastlines and Islands Polygons (Topo 1:50k)** |

**Meshblock file not in git.** `data/geographic/statsnz-meshblock-2026-GPKG/meshblock-2026.gpkg` is 268 MB, over GitHub's 100 MB file limit, so it is git-ignored. It is only needed to rebuild the data (`npm run data`); the app and the Cloudflare build use the committed `public/data/`. To rebuild, download **Meshblock 2026** as a GeoPackage from [Stats NZ Datafinder](https://datafinder.stats.govt.nz/layer/123521-meshblock-2026/) and save it at that path. Its metadata files are committed alongside.

**Candidate (electorate) votes.** Each candidate file is joined row by row to the matching party file, so candidate votes inherit the venue locations already worked out for party votes. Seven 2023 candidate rows listed a venue missing from that electorate's party file; they are located from the same venue in another electorate and logged. Candidates are mapped to parties using the "Electorate Candidate Valid Votes / Party" table printed at the end of each file. Parties that stood candidates but had no party list get generated IDs (reported as information, not errors), and independent candidates are grouped as "Independent" only for party-level comparisons. Exceptions:

- **2026:** the preliminary workbooks give candidate names but **not their parties**. Candidate names and votes appear in the details panel, while candidate-by-party maps and the Split mode say they are unavailable for 2026. Affiliations are never guessed from earlier elections. To enable them, add `data/2026/candidate-parties.csv` with columns `electorate,candidate,party` (for example from the Electoral Commission's candidate list) and run `npm run data`.
- **Port Waikato 2023:** the electorate poll was cancelled (a by-election followed), so that electorate has no candidate votes; the app says so.

### Things found in the raw data, and how they are handled

- **Mixed encodings:** UTF-8 with and without a BOM, UTF-16 LE (2014 coordinates) and Windows-1252 (two 2008 files) are each detected and decoded.
- **2011 has no coordinate file of its own.** `data/2011/2014_Voting_Place_Co-ordinates.csv` is byte-identical to the 2014 file. 2011 venues are therefore located by address match against the 2014 file, then the 2008 file, then later years (exact matches only). Every such location is flagged as *inferred*. 3.4% of 2011 valid votes were cast at venues that could not be located; they are listed in the report and stay in all totals.
- **2008 coordinates are NZMG (EPSG:27200)**, converted to NZTM2000 (about 1 m agreement with the 2014 file). NZMG does not cover the Chatham Islands, so the 2008 Chathams coordinate is invalid; it is reported, and the venue is located from the 2014 file.
- **2026 results are preliminary:** election-night counts, with no special votes. They are labelled throughout.
- **Advance votes:** reported by venue only from 2017. For 2008–2014 they appear as electorate totals, which are kept but cannot be mapped. "All votes" for those years therefore means election-day votes.
- **Venues that serve several electorates** appear in several electorates' result files. They are combined into one physical site, and the panel lists votes by the voters' home electorate.
- **Non-geographic rows** — special, overseas, party-only, "fewer than 6 votes" aggregates, postal, and mobile/hospital/care-home/prison teams — are categorised, kept in electorate and national totals, and listed in the report. **Every electorate's rows reconcile exactly with its official total row in all seven elections.**
- **Suppressed booths:** places taking fewer than 6 votes are reported as zero by the Commission. They are shown as "no valid votes recorded", not as zero support.

### Pipeline stages (`pipeline/`)

1. `results.py`: parse the three result layouts (sections, Māori-electorate sub-headings, non-geographic rows); reconcile with the electorate totals.
2. `coords.py`: read the coordinate files (WGS84, NZTM, NZMG) and `places.json`; validate coordinates; cross-check WGS84 against NZTM.
3. `match.py` / `ingest.py`: join result rows to coordinates. Exact normalised address first, then fuzzy matching restricted to the same electorate (≥ 0.88) or nationally (≥ 0.95), with street-number guards. Ambiguous candidates are never guessed. Other years' coordinate files are used only as documented fallbacks.
4. `sites.py`: merge records for one physical place (≤ 15 m apart, or ≤ 60 m with a similar venue name).
5. `linking.py`: stable location IDs across elections, by greedy matching with a hard constraint that one location never contains two sites from the same election. Every pair of elections gets a confidence of *exact*, *high*, *probable*, *address-inferred* or *chained*.
6. `catchments.py`: election-specific catchments, by two methods (below), each checked for invalid polygons, overlaps and gaps.
7. `export.py` / `build.py`: compact geometry (delta-encoded integers at 1e-5°), per-election results, search index, manifest; content-hashed file names.
8. `labels.py`: place-name labels from the polling-place suburbs of every election (spelling variants such as macrons, "Mt"/"Mount" and "Wanganui"/"Whanganui" merged; same-named places in different towns kept apart), plus the cities and regions in `config/regions.json`. `python -m pipeline labels` refreshes just the labels in seconds.
9. `validate.py`: integrity checks on the output (vote arithmetic, shares, electorate accounting, geometry references, ring validity). `report.py` writes the processing report.

Party names map to typed IDs in `config/parties.json` (lineage links such as Māori Party → Te Pāti Māori, and TOP's 2026 rename, are documented there). Unknown party names get a generated ID and are reported, never dropped. Bloc definitions are in `config/blocs.json`, with year ranges and documented reasons for unassigned parties. Each election's source layout is in `config/elections.json`, and new `data/<year>` folders are auto-detected.

### Catchment methods

**Meshblock (default):** each Stats NZ 2026 land meshblock is assigned whole to its nearest polling place (by representative point) and dissolved. Boundaries follow streets, rivers and property lines, and lakes and inlets stay water. Where two venues share one meshblock, that meshblock is split by a local Voronoi so that every site has an area. Small disconnected fragments (≤ max(2 km², half the main part)) are merged into the neighbour with the longest shared border. Larger water-separated parts, such as land across a lake, stay with their own polling place.

**Raw Voronoi:** Voronoi cells of the polling places in NZTM2000, bounded by a large envelope (so no cell is unbounded) and clipped to the LINZ 1:50k coastline with lakes removed. There are no rectangular edge artefacts and no cells over open ocean.

The meshblock method is the default because its boundaries track real geography (see `reports/processing-report.md` for the side-by-side checks). Both methods are available under **Settings**. For every election and method there are **0 invalid polygons, 0 km² of overlap and 0 km² of gap**. Remote islands with no polling place within 150 km (the Kermadecs and the sub-Antarctic islands) are excluded and listed. The 2026 meshblock pattern is used for every election, while the catchments themselves are rebuilt from each election's own polling places.

Geometry is simplified with GEOS coverage simplification, so shared edges stay shared, at two levels of detail: 150 m for the national view (a single file per election, about 0.2–0.7 MB gzipped) and 8 m detail in 75 km chunks, loaded only for the visible area from zoom 9.5. This keeps nationwide delivery small without MVT tiles, which would have exceeded Cloudflare Pages' file-count limit across 7 elections × 2 methods.

### Approximate electorate outlines

The supplied data contains no official electorate boundaries. The optional dashed outlines are the union of the meshblock catchments of each general electorate's own polling places. They are labelled as approximate, are used only for navigation, and are never used in any calculation. Māori electorates zoom to the extent of the polling places where their voters voted. Official boundaries (Stats NZ "General Electoral District" layers) could be added to `data/geographic/` and wired into `pipeline/build.py` if needed.

---

## Limitations

- Catchments are geometric estimates. They show where a polling place is nearest, not who voted there. Large rural catchments carry few votes; use circles or equal dots to correct for that.
- Before 2017, advance votes cannot be mapped, so booth-level results understate early voters. Swings involving those years use election-day votes only.
- 2011 locations are inferred from other years' coordinate files. Uncertain matches are flagged and excluded from swing by default.
- 2026 results are preliminary and exclude special votes.
- Bloc membership is an editable modelling assumption, not a statement of any party's alignment.

---

## Google Maps key

1. In Google Cloud, enable the **Maps JavaScript API** for a billing-enabled project. Billing and API activation are the deployment owner's responsibility.
2. Create an API key and, under **Key restrictions**:
   - **Application restrictions → Websites:** add `https://<your-project>.pages.dev/*`, your custom domain (`https://atlas.example.nz/*`) and `http://localhost:3000/*` for development.
   - **API restrictions → Restrict key:** allow only **Maps JavaScript API**.
3. Optional: create a **Map ID** (JavaScript, vector) for vector rendering and cloud styling, and set `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID`. Without it the map uses raster tiles and a built-in muted style. deck.gl stays aligned and interactive in both cases, and in satellite and hybrid views.

The key is embedded in the static build, so it is public by design; the website restrictions are what protect it. A missing key shows a setup message, and a rejected key (detected through Google's `gm_authFailure` callback) shows instructions. Google's attribution is never hidden, and no Google tiles are cached or stored.

---

## Timeline videos (social media)

`npm run videos` renders vertical **1080×1920, 30 fps H.264 MP4s** for Reels, TikTok and YouTube Shorts: one per area in `config/videos.json` (Auckland, Wellington, Christchurch, Hamilton, Tauranga, Dunedin; add your own `bbox`). Each video is about 24 seconds: a title, then the area's map stepping through every election with eased crossfades, the year, the area's vote shares and an election strip. A poster JPEG is written alongside each MP4.

The frames come from `/video`, a page that draws the same catchments, colours and labels with deck.gl over a plain background (no Google basemap, so no map tiles are recorded and every frame is deterministic). The capture script drives it frame by frame and pipes the frames into ffmpeg. Each distinct frame is drawn once: the holds on each election and the outro repeat a single frame, so only about 210 of a video's 714 frames are rendered. Statistics cover polling places inside the area and always belong to a real election; before 2017 they are election-day votes.

Rendering is GPU-bound, so run it on a machine with a graphics card. On Windows:

```powershell
npm install
npx playwright install chromium
npm run build
npm run videos                                   # all areas -> videos\*.mp4
npm run videos -- --areas wellington,auckland    # just some areas
npm run videos -- --mode party --party green     # Green Party share instead of the leading party
npm run videos -- --vote electorate              # electorate (candidate) votes
npm run videos -- --site atlas.example.nz        # end card with your site's address
npm run videos -- --areas wellington --frames 60 # quick 2-second test
npm run videos -- --parallel 6                   # more areas at once (default 3)
```

On an RTX 4060 Ti with a Ryzen 7 7700X, all six areas take about a minute (46 s with `--parallel 6`). Chromium runs headless and still uses the GPU through Direct3D 11. Each video's first log line names the WebGL renderer. If it says SwiftShader or Microsoft Basic Render Driver, rendering is on the CPU and slow: update the graphics driver, or try `--headed` or `--browser msedge`.

The video page and `config/videos.json` are baked into the static build, so run `npm run build` again after adding an area or changing the page or data. The script notes when `out/` is older than the source. Videos are written as `name.partial.mp4` and renamed when complete: a failed or interrupted (Ctrl+C) render is removed, and other areas carry on. Windows locks files that are open, so if an older MP4 is open in a video player, the new one is kept as `.partial.mp4` and the script tells you.

ffmpeg comes from the `ffmpeg-static` dev dependency. If npm blocked its download script, run `npm approve-scripts ffmpeg-static` then `npm rebuild ffmpeg-static`, or install ffmpeg and set `FFMPEG_PATH`. libx264 (CPU) encodes far faster than frames are captured, so the GPU encoders (`--encoder nvenc|qsv|amf`) rarely save time. On a Linux server without a GPU add `--software-gl` (correct but slow: several seconds per frame).

## Analytics (Microsoft Clarity)

Set `NEXT_PUBLIC_CLARITY_PROJECT_ID` to your Clarity project ID (Clarity → your project → **Settings → Overview**) to turn on [Microsoft Clarity](https://clarity.microsoft.com/). Without it, nothing is loaded. Like the other `NEXT_PUBLIC_` variables it is read at build time, so redeploy after changing it.

- **Recorded:** Clarity's standard heatmaps and session replays, plus custom **tags** for the election, map mode, basemap and boundary method, and custom **events** for mode changes (`mode_*`), timeline playback (`timeline_play`), polling-place selection (`polling_place_selected`), search jumps (`search_*`), opening the method and bloc dialogs (`open_*`) and copying a link (`link_copied`).
- **Never recorded:** the search box is masked (`data-clarity-mask`), and no identifiers are sent (Clarity's `identify` API is not used).
- **Disclosure:** the "How to read this map" dialog gets a Privacy section whenever Clarity is on, as Clarity's terms require.
- **Consent:** no cookie banner is included. If your Clarity project requires cookie consent (for example for visitors from the EU or UK), add a consent prompt that calls `Clarity.consentV2()`. Until a consent signal is sent, Clarity limits what it stores.

## Deploying to Cloudflare Pages

| Setting | Value |
|---|---|
| Framework preset | Next.js (Static HTML Export) |
| Build command | `npm run build` |
| Build output directory | `out` |
| Root directory | `/` |
| Node version | `NODE_VERSION=20` or later (Next.js 16 needs ≥ 20.9) |
| Environment variables | `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (required) and `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID` (optional), for both Production and Preview; `NEXT_PUBLIC_CLARITY_PROJECT_ID` (optional), usually Production only so preview deployments don't mix into your analytics |

- The processed data in `public/data/` is committed, so Pages does not need Python. Re-run `npm run data` locally and commit whenever `data/` changes.
- `public/_headers` gives hashed data and `_next/static` assets a one-year `immutable` cache. `data/manifest.json` (which points to the current files) is revalidated on every load.
- It is a single-page static app, and all state lives in query parameters, so deep links such as `/?y=2014&m=swing&ref=2011&v=-41.29,174.78,12` work from any static host without rewrites.
- Local preview of the production build: `npm run build && npm run preview` (http://localhost:3000).

---

## Project layout

```
app/                 Next.js entry (static shell, fonts, global tokens)
components/atlas/    Atlas UI: map (Google + deck.gl), panels, D3 charts
components/ui/       shadcn/ui (Radix) primitives
lib/atlas/           Typed data contract, loaders, statistics, encodings, URL state — no map code
config/              parties.json, blocs.json, elections.json, regions.json (all editable)
pipeline/            Python ETL (python -m pipeline build | validate)
public/data/         Generated assets (do not edit by hand)
reports/             Processing report and full issue log
tests/unit|python|e2e
```

Google Maps code is isolated in `components/atlas/map/`. Electoral statistics and visual encodings live in `lib/atlas/` and are unit-tested without a map.
