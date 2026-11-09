# Processing report

Generated 2026-11-09T07:22:07+00:00 by `npm run data` (`python -m pipeline build`).

Every row in every source file is accounted for: venue rows are mapped to a physical site; everything else
(special, overseas, aggregated advance, mobile-team and unlocatable rows) is kept in electorate and national
totals but not drawn on the map. Nothing is silently deleted.

## Summary by election

| Election | Status | Electorates | Result rows | Venue rows | Sites | Valid votes | Mapped to sites | Unlocated venue votes |
|---|---|---|---|---|---|---|---|---|
| 2008 | final | 70 | 6,009 | 5,519 | 2,684 | 2,344,566 | 1,856,604 (79.2%) | 0 |
| 2011 | final | 70 | 6,129 | 5,508 | 2,530 | 2,237,464 | 1,631,624 (72.9%) | 77,015 |
| 2014 | final | 71 | 5,884 | 5,458 | 2,568 | 2,405,622 | 1,475,722 (61.3%) | 0 |
| 2017 | final | 71 | 7,324 | 6,988 | 2,679 | 2,591,896 | 2,136,325 (82.4%) | 124 |
| 2020 | final | 72 | 9,867 | 9,426 | 2,781 | 2,886,420 | 2,383,592 (82.6%) | 424 |
| 2023 | final | 72 | 8,532 | 8,100 | 2,564 | 2,851,211 | 2,240,004 (78.6%) | 55 |
| 2026 | preliminary | 71 | 8,907 | 8,907 | 2,521 | 2,418,565 | 2,389,664 (98.8%) | 50 |

### Votes not drawn on the map, by category

| Election | Ordinary advance votes (not reported by venue) | Hospital votes | Mobile, hospital, care-home and prison teams | Overseas special votes (incl. Defence Force) | Overseas votes for party only | Votes allowed for party only | Postal votes | Voting places with fewer than 6 votes (aggregated) | Special votes before polling day | Special votes on polling day | Venue rows that could not be located |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 2008 | 208,767 | 27,516 | 0 | 32,461 | 0 | 30,657 | 0 | 1,326 | 29,288 | 157,947 | 0 |
| 2011 | 287,104 | 0 | 0 | 20,269 | 0 | 31,146 | 0 | 1,370 | 34,001 | 154,935 | 77,015 |
| 2014 | 627,476 | 0 | 0 | 38,264 | 0 | 40,649 | 0 | 1,509 | 71,044 | 150,958 | 0 |
| 2017 | 0 | 0 | 35,819 | 58,952 | 0 | 42,254 | 0 | 1,648 | 181,223 | 135,551 | 124 |
| 2020 | 0 | 0 | 9,213 | 60,835 | 202 | 25,717 | 65 | 4,350 | 251,715 | 150,307 | 424 |
| 2023 | 0 | 0 | 26,286 | 76,559 | 630 | 41,199 | 0 | 2,313 | 255,550 | 208,615 | 55 |
| 2026 | 0 | 0 | 28,851 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 50 |

### How result rows were located

- **2008**: exact 5,515, exact:inferred-from-2014 2, fuzzy:inferred-from-2014 2
- **2011**: exact:inferred-from-2014 4,052, exact:inferred-from-2008 540, fuzzy:inferred-from-2014 471, unmatched 325, fuzzy:inferred-from-2008 100, exact:inferred-from-2020 11, exact:inferred-from-2017 6, exact:inferred-from-2026 3
- **2014**: exact 5,458
- **2017**: exact 6,750, mobile 226, exact-disambiguated 8, unmatched 2, ambiguous 2
- **2020**: exact 9,325, mobile 92, unmatched 9
- **2023**: exact 7,886, mobile 207, unmatched 4, exact:inferred-from-2020 3
- **2026**: exact 8,516, mobile 366, exact:inferred-from-2023 21, exact:inferred-from-2020 2, unmatched 2

## Historical matching

4,481 stable physical locations were identified across 7 elections.

| Pair | exact | high | probable | address-inferred | chained |
|---|---|---|---|---|---|
| 2008→2011 | 1942 | 94 | 6 | 316 | 5 |
| 2011→2014 | 97 | 45 | 9 | 2206 | 1 |
| 2014→2017 | 2096 | 92 | 17 | 0 | 7 |
| 2017→2020 | 1989 | 189 | 27 | 0 | 10 |
| 2020→2023 | 1257 | 816 | 64 | 1 | 19 |
| 2023→2026 | 1774 | 358 | 23 | 2 | 14 |

## Catchment geometry

| Election / method | Polygons invalid | Overlap km² | Gap km² | Land km² | Invalid after simplification (lo/hi) |
|---|---|---|---|---|---|
| 2008-meshblock | 0 | 0.0 | 0.0 | 264,935.039 | 0/0 |
| 2008-voronoi | 0 | -0.0 | 0.0 | 265,253.689 | 0/0 |
| 2011-meshblock | 0 | 0.0 | 0.0 | 264,935.039 | 0/0 |
| 2011-voronoi | 0 | 0.0 | 0.0 | 265,253.689 | 0/0 |
| 2014-meshblock | 0 | 0.0 | 0.0 | 264,935.039 | 0/0 |
| 2014-voronoi | 0 | -0.0 | 0.0 | 265,253.689 | 0/0 |
| 2017-meshblock | 0 | -0.0 | -0.0 | 264,935.039 | 0/0 |
| 2017-voronoi | 0 | -0.0 | 0.0 | 265,253.689 | 0/0 |
| 2020-meshblock | 0 | -0.0 | -0.0 | 264,935.039 | 0/0 |
| 2020-voronoi | 0 | -0.0 | 0.0 | 265,253.689 | 0/0 |
| 2023-meshblock | 0 | 0.0 | 0.0 | 264,935.039 | 0/0 |
| 2023-voronoi | 0 | 0.0 | 0.0 | 265,253.689 | 0/0 |
| 2026-meshblock | 0 | 0.0 | 0.0 | 264,935.039 | 0/0 |
| 2026-voronoi | 0 | 0.0 | 0.0 | 265,253.689 | 0/0 |

Remote land excluded from catchments (no polling place within 150 km in any election):

- Auckland Islands: 268 polygon(s), 571.01 km²
- Campbell Island/Motu Ihupuku: 1 polygon(s), 108.91 km²
- Kermadec Islands: 25 polygon(s), 32.7 km²
- Antipodes Island Group: 22 polygon(s), 20.95 km²
- Snares Islands/Tini Heke: 56 polygon(s), 3.66 km²
- Bounty Islands: 22 polygon(s), 0.48 km²
- (unnamed): 157 polygon(s), 0.34 km²
- Jacquemart Island: 1 polygon(s), 0.23 km²
- Meyer Islands - Kermadec Islands: 41 polygon(s), 0.21 km²
- Dent Island: 1 polygon(s), 0.2 km²
- Windward Islands: 5 polygon(s), 0.16 km²
- Herald Islets - Kermadec Islands: 13 polygon(s), 0.1 km²
- Isle de Jeanette Marie: 1 polygon(s), 0.08 km²
- Monowai Island: 1 polygon(s), 0.07 km²
- Wasp Island: 1 polygon(s), 0.05 km²
- Survey Island: 1 polygon(s), 0.03 km²
- Gomez Island: 1 polygon(s), 0.02 km²
- Cossack Rock: 1 polygon(s), 0.01 km²
- La Botte: 1 polygon(s), 0.01 km²
- Milne Islets - Kermadec Islands: 10 polygon(s), 0.01 km²
- Bull Rock: 1 polygon(s), 0.0 km²
- Davis Island: 1 polygon(s), 0.0 km²
- Dougall Rocks - Kermadec Islands: 2 polygon(s), 0.0 km²
- Seagull Rock: 1 polygon(s), 0.0 km²

## Parties

49 party identifiers in use; 0 unclassified.

## Issues by category

| Election | Severity | Category | Count |
|---|---|---|---|
| 2008 | error | invalid_coordinates | 1 |
| 2008 | info | coordinates_without_results | 1 |
| 2008 | info | encoding | 2 |
| 2008 | info | exclaves | 1 |
| 2008 | info | fuzzy_match | 2 |
| 2008 | info | inferred_location | 1 |
| 2011 | info | duplicate_polling_place | 1 |
| 2011 | info | exclaves | 1 |
| 2011 | info | fuzzy_match | 571 |
| 2011 | warning | coordinates | 1 |
| 2011 | warning | unmatched_location | 325 |
| 2014 | info | exclaves | 1 |
| 2014 | warning | coordinate_inconsistency | 1 |
| 2017 | info | coordinates_without_results | 1 |
| 2017 | info | coverage_clean | 1 |
| 2017 | info | duplicate_polling_place | 7 |
| 2017 | info | exclaves | 1 |
| 2017 | info | meshblock_split | 1 |
| 2017 | warning | ambiguous_join | 2 |
| 2017 | warning | unmatched_location | 2 |
| 2020 | info | coordinates_without_results | 1 |
| 2020 | info | coverage_clean | 1 |
| 2020 | info | duplicate_polling_place | 7 |
| 2020 | info | exclaves | 1 |
| 2020 | info | meshblock_split | 1 |
| 2020 | warning | unmatched_location | 9 |
| 2023 | info | coordinates_without_results | 1 |
| 2023 | info | duplicate_polling_place | 4 |
| 2023 | info | exclaves | 1 |
| 2023 | info | inferred_location | 1 |
| 2023 | warning | unmatched_location | 4 |
| 2026 | info | duplicate_polling_place | 3 |
| 2026 | info | exclaves | 1 |
| 2026 | info | inferred_location | 1 |
| 2026 | warning | unmatched_location | 2 |
| all | info | historical_matching | 1 |
| all | info | remote_islands | 1 |

## Unlocated venue rows (largest first)

### 2011 (325 rows)

- No coordinates for 'Clayton Park School, Wattle Farm Road entrance' (Papakura, election_day); 2335 valid votes kept in electorate totals but not mapped
- No coordinates for 'Katikati Memorial Hall, 36 Main Road' (Coromandel, election_day); 1939 valid votes kept in electorate totals but not mapped
- No coordinates for 'Stokes Valley Community Hall, Bowers Street' (Rimutaka, election_day); 1403 valid votes kept in electorate totals but not mapped
- No coordinates for 'Shop 7, Fashion Island, Gravatt Road' (Bay of Plenty, election_day); 1335 valid votes kept in electorate totals but not mapped
- No coordinates for 'Springlands School Hall, Aston Street' (Kaikōura, election_day); 1306 valid votes kept in electorate totals but not mapped
- No coordinates for 'Otatara Primary School, Dunns Road' (Invercargill, election_day); 1267 valid votes kept in electorate totals but not mapped
- No coordinates for 'Masonic Lodge, Upstairs, 12 Baxter Street' (Rodney, election_day); 1216 valid votes kept in electorate totals but not mapped
- No coordinates for 'Raroa Intermediate School Hall, 37 Haumia Street' (Ōhariu, election_day); 1199 valid votes kept in electorate totals but not mapped
- No coordinates for 'Fendalton Open Air School, The Village, 168 Clyde Road' (Ilam, election_day); 1155 valid votes kept in electorate totals but not mapped
- No coordinates for "Northwood Nursery and Preschool, 1 O'Neill Avenue" (Waimakariri, election_day); 1149 valid votes kept in electorate totals but not mapped
- No coordinates for 'Alexandra Primary School, 2 Ventry Street' (Waitaki, election_day); 1147 valid votes kept in electorate totals but not mapped
- No coordinates for 'Stratford Methodist Church Hall, Regan Street (opposite New World)' (Taranaki-King Country, election_day); 1024 valid votes kept in electorate totals but not mapped
- No coordinates for 'Knox Presbyterian Hall, 48 Albert Street' (Hamilton East, election_day); 993 valid votes kept in electorate totals but not mapped
- No coordinates for 'Waipu Presbyterian Church Hall, 50 The Centre' (Whangarei, election_day); 987 valid votes kept in electorate totals but not mapped
- No coordinates for 'Carlton School, 99 Carlton Avenue' (Whanganui, election_day); 941 valid votes kept in electorate totals but not mapped
- No coordinates for 'Riverside Community Centre, corner Bernard Street & Peace Avenue' (Manukau East, election_day); 925 valid votes kept in electorate totals but not mapped
- No coordinates for 'Lyttelton Recreation Centre, 25 Winchester Street' (Port Hills, election_day); 925 valid votes kept in electorate totals but not mapped
- No coordinates for 'Capital E, Civic Square' (Wellington Central, election_day); 873 valid votes kept in electorate totals but not mapped
- No coordinates for 'Bell Block Hall, 957 Devon Road' (New Plymouth, election_day); 866 valid votes kept in electorate totals but not mapped
- No coordinates for 'Ranui Community House, 474 Swanson Road' (Waitakere, election_day); 866 valid votes kept in electorate totals but not mapped
- No coordinates for 'Thorndon School, 19b Hobson Crescent or 26 Murphy Street' (Wellington Central, election_day); 851 valid votes kept in electorate totals but not mapped
- No coordinates for 'Berhampore School Hall, 105 Britomart Street (Stanley Street entrance)' (Rongotai, election_day); 841 valid votes kept in electorate totals but not mapped
- No coordinates for 'Avondale College Drama Room, 47 Victor Street (Gate 1 entrance)' (Mt Albert, election_day); 806 valid votes kept in electorate totals but not mapped
- No coordinates for 'Baptist Church Hall, Moana Street' (Whanganui, election_day); 794 valid votes kept in electorate totals but not mapped
- No coordinates for 'ABC Learning Centre, Tumara Park 2, 1 Pohutakawa Crescent, Tumara Park' (Christchurch East, election_day); 790 valid votes kept in electorate totals but not mapped
- No coordinates for 'Mangapapa Kindergarten, 2 Rua Street' (East Coast, election_day); 777 valid votes kept in electorate totals but not mapped
- No coordinates for 'Northcote Masonic Centre, 14 Rodney Road' (Northcote, election_day); 773 valid votes kept in electorate totals but not mapped
- No coordinates for 'Kaiapoi Rugby Club, Smith Street' (Waimakariri, election_day); 771 valid votes kept in electorate totals but not mapped
- No coordinates for 'Selwyn Library, 10 St Stephens Avenue' (Epsom, election_day); 753 valid votes kept in electorate totals but not mapped
- No coordinates for 'Stanley Avenue School, 61 Stanley Avenue' (Coromandel, election_day); 741 valid votes kept in electorate totals but not mapped
- … and 295 more (see reports/issues.json)

### 2017 (2 rows)

- No coordinates for 'UCOL Cafe & Student Centre, 143-159 Chapel Street' (Wairarapa, advance); 59 valid votes kept in electorate totals but not mapped
- No coordinates for 'UCOL Cafe & Student Centre, 143-159 Chapel Street' (Ikaroa-Rāwhiti, advance); 12 valid votes kept in electorate totals but not mapped

### 2020 (9 rows)

- No coordinates for 'University of Waikato - Tauranga Campus, Durham Street' (Tauranga, advance); 273 valid votes kept in electorate totals but not mapped
- No coordinates for 'University of Waikato - Tauranga Campus, Durham Street' (Bay of Plenty, advance); 47 valid votes kept in electorate totals but not mapped
- No coordinates for 'Northland Region Correctional Facilities, Ohaeawai Road State Highway 12' (Te Tai Tokerau, advance); 23 valid votes kept in electorate totals but not mapped
- No coordinates for 'Otago Correctional Facility Milton, 62 Narrowdale Road' (Taieri, advance); 21 valid votes kept in electorate totals but not mapped
- No coordinates for 'Northland Region Correctional Facilities, Ohaeawai Road State Highway 12' (Northland, advance); 18 valid votes kept in electorate totals but not mapped
- No coordinates for 'University of Waikato - Tauranga Campus, Durham Street' (Coromandel, advance); 13 valid votes kept in electorate totals but not mapped
- No coordinates for 'University of Waikato - Tauranga Campus, Durham Street' (Waiariki, advance); 12 valid votes kept in electorate totals but not mapped
- No coordinates for 'Otago Correctional Facility Milton, 62 Narrowdale Road' (Te Tai Tonga, advance); 9 valid votes kept in electorate totals but not mapped
- No coordinates for 'Northland Region Correctional Facilities, Ohaeawai Road State Highway 12' (Whangārei, advance); 8 valid votes kept in electorate totals but not mapped

### 2023 (4 rows)

- No coordinates for "Safina Trust NZ, 51A O' Donnell Avenue" (Mt Roskill, advance); 29 valid votes kept in electorate totals but not mapped
- No coordinates for 'Otago Correctional Facility Milton, 62 Narrowdale Road' (Taieri, advance); 10 valid votes kept in electorate totals but not mapped
- No coordinates for 'Otago Correctional Facility Milton, 62 Narrowdale Road' (Te Tai Tonga, advance); 9 valid votes kept in electorate totals but not mapped
- No coordinates for 'Otago Correctional Facility Milton, 62 Narrowdale Road' (Taieri, election_day); 7 valid votes kept in electorate totals but not mapped

### 2026 (2 rows)

- No coordinates for 'Milburn, Otago Correctional Facility Milton, 62 Narrowdale Road' (Taieri, advance); 26 valid votes kept in electorate totals but not mapped
- No coordinates for 'Milburn, Otago Correctional Facility Milton, 62 Narrowdale Road' (Te Tai Tonga, advance); 24 valid votes kept in electorate totals but not mapped

