"use client";

/**
 * WebMCP tools: let a browser's AI agent read and drive the atlas
 * (https://webmachinelearning.github.io/webmcp/). Progressive enhancement:
 * nothing happens unless the browser provides document.modelContext (or the
 * older navigator.modelContext). Tools only read the same public data the map
 * shows, plus one tool that changes the view the user is looking at.
 */
import { useEffect } from "react";
import { MODE_META } from "./panels/ControlBar";
import { encodingSettings } from "./useEncoding";
import { keys, loadSearch, loadYear, peek } from "@/lib/atlas/data";
import { encode, partyLabel } from "@/lib/atlas/encoding";
import { searchIndex } from "./panels/SearchBox";
import { leader, siteRow, viewFor, type YearData } from "@/lib/atlas/stats";
import { useAtlas, type AtlasState } from "@/lib/atlas/store";
import { MAP_MODES, type MapMode } from "@/lib/atlas/url";
import type { Manifest, SitesFile } from "@/lib/atlas/types";

interface ToolAnnotations {
  readOnlyHint?: boolean;
  untrustedContentHint?: boolean;
  consequentialHint?: boolean;
}
export interface WebMcpTool {
  name: string;
  title?: string;
  description: string;
  inputSchema?: object;
  execute: (input: Record<string, unknown>, options?: { signal?: AbortSignal }) => Promise<unknown>;
  annotations?: ToolAnnotations;
}
interface ModelContext {
  // Older implementations return a handle with unregister() instead of honouring signal.
  registerTool(tool: WebMcpTool, options?: { signal?: AbortSignal }): Promise<unknown> | unknown;
}
declare global {
  interface Document {
    readonly modelContext?: ModelContext;
  }
  interface Navigator {
    readonly modelContext?: ModelContext;
  }
}

const VOTES = ["party", "electorate"] as const;
const str = (v: unknown, max = 100) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const pct = (x: number) => Math.round(x * 1000) / 10;

/** A party id from an id or a name ("green", "Green Party", "Te Pāti Māori"). */
function resolveParty(manifest: Manifest, raw: string): string | null {
  const q = raw.trim().toLowerCase();
  if (!q) return null;
  if (manifest.parties[q]) return q;
  const hit = Object.entries(manifest.parties).find(([, p]) => [p.name, p.short].some((n) => n?.toLowerCase() === q));
  return hit ? hit[0] : null;
}

/** The party or bloc the map is coloured by, which depends on the mode (null
 *  when it compares every party, e.g. the leading party). */
function mapSubject(manifest: Manifest, s: AtlasState) {
  const party = (id: string) => ({ party: id, name: partyLabel(manifest, id) });
  switch (s.mode) {
    case "swing":
      // Swing colours by its own target, a party or a bloc, not by `party`.
      return s.swingTarget.kind === "party" ? party(s.swingTarget.id) : { bloc: s.swingTarget.id, name: manifest.blocs.blocs[s.swingTarget.id]?.label ?? s.swingTarget.id };
    case "party":
    case "split":
      return party(s.party);
    case "circles":
      return s.circleSize === "equal" ? null : party(s.party);
    case "compare":
      return { parties: [party(s.cmpA), party(s.partyB)] };
    default:
      return null;
  }
}

function yearOrCurrent(manifest: Manifest, raw: unknown): number | string {
  const years = manifest.elections.map((e) => e.year);
  if (raw === undefined || raw === null || raw === "") return useAtlas.getState().shownYear ?? years[years.length - 1];
  const y = Number(raw);
  return years.includes(y) ? y : `No election ${String(raw)} on the map. Elections: ${years.join(", ")}.`;
}

export function atlasTools(manifest: Manifest): WebMcpTool[] {
  const years = manifest.elections.map((e) => e.year);
  return [
    {
      name: "list_elections",
      title: "List elections",
      description: "List the New Zealand general elections on this map, with whether each result is final or a preliminary count and what the polling-place data covers.",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
      execute: async () => ({
        elections: manifest.elections.map((e) => ({
          year: e.year,
          date: e.date,
          status: e.status,
          pollingPlaces: e.sites,
          advanceVotesByPollingPlace: e.advanceByVenue,
          electorateVotesByParty: e.candidates === "byParty",
        })),
      }),
    },
    {
      name: "get_national_result",
      title: "National party vote",
      description: "Official national party-vote totals for one election (all electorates, including special votes), with each party's share. Returns party ids usable by show_on_map.",
      inputSchema: { type: "object", properties: { year: { type: "number", description: `Election year: ${years.join(", ")}. Defaults to the one on screen.` } } },
      annotations: { readOnlyHint: true },
      execute: async (input) => {
        const y = yearOrCurrent(manifest, input.year);
        if (typeof y === "string") return { error: y };
        const e = manifest.elections.find((x) => x.year === y)!;
        const parties = Object.entries(e.national)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 12)
          .map(([id, votes]) => ({ party: id, name: partyLabel(manifest, id), votes, sharePct: pct(votes / e.nationalValid) }));
        return { year: y, status: e.status, validPartyVotes: e.nationalValid, parties };
      },
    },
    {
      name: "search_places",
      title: "Search places",
      description: "Search the map for polling places, suburbs, electorates, regions and cities by name. Polling-place ids can be passed to get_polling_place and show_on_map.",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string", description: "Name to search for, at least 2 characters, e.g. 'Ponsonby' or 'Epsom'." } },
        required: ["query"],
      },
      annotations: { readOnlyHint: true },
      execute: async (input) => {
        const q = str(input.query);
        if (q.length < 2) return { error: "query must be at least 2 characters." };
        const index = await loadSearch(manifest).promise;
        const r = searchIndex(index, q, useAtlas.getState().year);
        return {
          pollingPlaces: r.places.map(([id, name, suburb, lat, lng, ys]) => ({ id, name, suburb, lat, lng, years: ys })),
          suburbs: r.suburbs.map(([name, lat, lng]) => ({ name, lat, lng })),
          electorates: r.electorates.map((e) => ({ name: e.name, kind: e.kind, years: e.years })),
          regions: r.regions.map((g) => ({ name: g.name, kind: g.kind })),
        };
      },
    },
    {
      name: "get_polling_place",
      title: "Polling place results",
      description:
        "Votes counted at one polling place in one election: total valid votes and each party's votes and share. Party votes by default; 'electorate' sums electorate (candidate) votes by the candidates' parties. Votes at one polling place are not an electorate result.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Polling-place id from search_places." },
          year: { type: "number", description: `Election year: ${years.join(", ")}. Defaults to the one on screen.` },
          votes: { type: "string", enum: [...VOTES], description: "Which votes: 'party' (default) or 'electorate'." },
        },
        required: ["id"],
      },
      annotations: { readOnlyHint: true },
      execute: async (input) => {
        const id = str(input.id, 40);
        const y = yearOrCurrent(manifest, input.year);
        if (typeof y === "string") return { error: y };
        const votes = input.votes === "electorate" ? "electorate" : "party";
        const yd = await loadYear(manifest, y).promise;
        const i = yd.stableIndex.get(id);
        if (i === undefined) return { error: `No polling place with id ${id} in ${y}. Use search_places to find ids and the years each place was used.` };
        const vd = viewFor(yd, votes === "electorate" ? "candidate" : "party");
        if (!vd) return { error: `Electorate votes can't be grouped by party for ${y}.` };
        const row = siteRow(vd, i, "all");
        const place = { id, name: yd.file.sites.name[i], address: yd.file.sites.address[i], suburb: yd.file.sites.suburb[i] };
        if (!row || row.total <= 0) return { year: y, votes, place, totalValidVotes: 0, note: "No valid votes recorded here (places with fewer than 6 votes are reported as zero)." };
        const L = leader(row.votes, row.total);
        const parties = Array.from(row.votes, (v, k) => ({ party: vd.parties[k], name: partyLabel(manifest, vd.parties[k]), votes: v, sharePct: pct(v / row.total) }))
          .filter((p) => p.votes > 0)
          .sort((a, b) => b.votes - a.votes)
          .slice(0, 10);
        return {
          year: y,
          status: manifest.elections.find((e) => e.year === y)?.status,
          votes,
          place,
          totalValidVotes: row.total,
          leading: L ? (L.tie ? { tie: L.tiedIndices.map((k) => partyLabel(manifest, vd.parties[k])) } : partyLabel(manifest, vd.parties[L.index])) : null,
          parties,
          ...(!yd.hasAdvance && { note: `${y}: advance votes were reported only as electorate totals, so these are election-day votes.` }),
        };
      },
    },
    {
      name: "get_current_view",
      title: "Current map view",
      description: "What the map is showing now: the election, map mode, party, vote type, selected polling place, map position, and the legend (e.g. how many polling places each party leads), with any notes shown on the map.",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
      execute: async () => {
        const s = useAtlas.getState();
        const yd = s.shownYear !== null ? peek<YearData>(keys.year(s.shownYear)) : undefined;
        const ref = s.refYear !== null ? (peek<YearData>(keys.year(s.refYear)) ?? null) : null;
        const enc = yd ? encode(manifest, yd, encodingSettings(s), ref, peek<SitesFile>(keys.sites) ?? null) : null;
        const i = yd && s.selected ? yd.stableIndex.get(s.selected) : undefined;
        const legend = enc?.legend;
        return {
          year: s.shownYear,
          mode: { id: s.mode, label: MODE_META[s.mode].label, about: MODE_META[s.mode].blurb },
          showing: mapSubject(manifest, s),
          votes: s.voteKind === "candidate" ? "electorate" : "party",
          voteType: s.voteType,
          selectedPlace: s.selected ? { id: s.selected, name: i !== undefined && yd ? yd.file.sites.name[i] : null } : null,
          map: s.view,
          legend: legend ? { title: legend.title, ...(legend.kind === "categorical" && { pollingPlacesLed: legend.items.slice(0, 10).map((x) => ({ label: x.label, count: x.count })) }) } : null,
          notes: enc?.notes ?? [],
        };
      },
    },
    {
      name: "show_on_map",
      title: "Show on the map",
      description: `Change what the map shows the user: the election year, map mode, party, party or electorate votes, and/or a polling place to select and zoom to. Modes: ${MAP_MODES.map((m) => `${m} (${MODE_META[m].label})`).join(", ")}. Omitted fields stay as they are.`,
      inputSchema: {
        type: "object",
        properties: {
          year: { type: "number", description: `Election year: ${years.join(", ")}.` },
          mode: { type: "string", enum: [...MAP_MODES], description: "Map mode." },
          party: { type: "string", description: "Party id or name for the party, circles, swing and split modes, e.g. 'green' or 'Labour Party'." },
          votes: { type: "string", enum: [...VOTES], description: "'party' or 'electorate' votes." },
          placeId: { type: "string", description: "Polling-place id from search_places to select and zoom to." },
        },
      },
      annotations: { readOnlyHint: false, consequentialHint: false },
      execute: async (input) => {
        const s = useAtlas.getState();
        const patch: Parameters<typeof s.set>[0] = {};
        if (input.year !== undefined) {
          const y = yearOrCurrent(manifest, input.year);
          if (typeof y === "string") return { error: y };
          patch.year = y;
        }
        if (input.mode !== undefined) {
          if (!MAP_MODES.includes(input.mode as MapMode)) return { error: `Unknown mode. Use one of: ${MAP_MODES.join(", ")}.` };
          patch.mode = input.mode as MapMode;
        }
        if (input.party !== undefined) {
          const p = resolveParty(manifest, str(input.party));
          if (!p) return { error: `Unknown party ${str(input.party)}. get_national_result lists party ids.` };
          patch.party = p;
          // Swing colours by its own target (as its party picker sets), which may be a bloc.
          if ((patch.mode ?? s.mode) === "swing") patch.swingTarget = { kind: "party", id: p };
        }
        if (input.votes !== undefined) {
          if (!VOTES.includes(input.votes as (typeof VOTES)[number])) return { error: "votes must be 'party' or 'electorate'." };
          patch.voteKind = input.votes === "electorate" ? "candidate" : "party";
        }
        let place: { lat: number; lng: number } | null = null;
        if (input.placeId !== undefined) {
          const id = str(input.placeId, 40);
          const index = await loadSearch(manifest).promise;
          const hit = index.places.find((p) => p[0] === id);
          if (!hit) return { error: `No polling place with id ${id}. Use search_places to find ids.` };
          place = { lat: hit[3], lng: hit[4] };
          // Show an election in which the place was used.
          const y = patch.year ?? s.year;
          if (y !== null && !hit[5].includes(y)) patch.year = hit[5][hit[5].length - 1];
        }
        s.set(patch);
        if (input.placeId !== undefined && place) {
          s.select(str(input.placeId, 40));
          s.requestFlyTo({ ...place, zoom: 14 });
        }
        const now = useAtlas.getState();
        return { shown: { year: now.year, mode: now.mode, showing: mapSubject(manifest, now), votes: now.voteKind === "candidate" ? "electorate" : "party", selectedPlace: now.selected } };
      },
    },
  ];
}

/** Register the atlas tools with the browser's agent while the atlas is mounted. */
export function useWebMcp(manifest: Manifest) {
  useEffect(() => {
    const mc = typeof document !== "undefined" ? (document.modelContext ?? navigator.modelContext) : undefined;
    if (!mc?.registerTool) return;
    const controller = new AbortController();
    const handles: unknown[] = [];
    for (const tool of atlasTools(manifest)) {
      Promise.resolve()
        .then(() => mc.registerTool(tool, { signal: controller.signal }))
        .then((h) => {
          handles.push(h);
          if (controller.signal.aborted) unregister(h);
        })
        .catch((e: unknown) => console.debug(`WebMCP: could not register ${tool.name}:`, e));
    }
    return () => {
      // Aborting unregisters the tools (a name can only be registered once).
      controller.abort();
      handles.forEach(unregister);
    };
  }, [manifest]);
}

function unregister(handle: unknown) {
  if (handle && typeof (handle as { unregister?: unknown }).unregister === "function") (handle as { unregister: () => void }).unregister();
}
