"use client";

import { useMemo, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { Manifest, PartyId } from "@/lib/atlas/types";

export function Swatch({ color, className, ring = false }: { color: string; className?: string; ring?: boolean }) {
  return <span aria-hidden className={cn("inline-block size-2.5 shrink-0 rounded-[3px]", ring && "ring-1 ring-black/15", className)} style={{ background: color }} />;
}

/** Parties ordered: those on the given year's ballot by national vote, then the rest. */
export function partyOptions(manifest: Manifest, year: number | null) {
  const el = manifest.elections.find((e) => e.year === year);
  const onBallot = new Set(el?.parties ?? []);
  const nat = el?.national ?? {};
  const all = Object.keys(manifest.parties);
  const current = all.filter((p) => onBallot.has(p)).sort((a, b) => (nat[b] ?? 0) - (nat[a] ?? 0));
  const other = all
    .filter((p) => !onBallot.has(p))
    .sort((a, b) => {
      const ya = Math.max(...Object.keys(manifest.parties[a].ballotNames).map(Number));
      const yb = Math.max(...Object.keys(manifest.parties[b].ballotNames).map(Number));
      return yb - ya || manifest.parties[a].short.localeCompare(manifest.parties[b].short);
    });
  return { current, other };
}

export function PartyPicker({
  manifest,
  year,
  value,
  onChange,
  label,
  allowNone = false,
  className,
}: {
  manifest: Manifest;
  year: number | null;
  value: PartyId | null;
  onChange: (p: PartyId | null) => void;
  label: string;
  allowNone?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const { current, other } = useMemo(() => partyOptions(manifest, year), [manifest, year]);
  const meta = value ? manifest.parties[value] : null;
  const years = (p: PartyId) => Object.keys(manifest.parties[p].ballotNames).join(", ");
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${label}: ${meta?.short ?? "none"}`}
          className={cn("inline-flex h-8 min-w-0 items-center gap-2 rounded-lg border border-rule bg-paper px-2.5 text-[13px] font-medium text-ink hover:bg-wash", className)}
        >
          {meta ? <Swatch color={meta.color} ring /> : <span className="size-2.5 rounded-[3px] border border-dashed border-ink-3" />}
          <span className="truncate">{meta?.short ?? "None"}</span>
          <ChevronDown className="ml-auto size-3.5 text-ink-3" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="end">
        <Command
          filter={(v, search) => {
            const m = manifest.parties[v];
            const hay = `${m?.name ?? v} ${m?.short ?? ""} ${Object.values(m?.ballotNames ?? {}).join(" ")}`.toLowerCase();
            return hay.includes(search.toLowerCase()) ? 1 : 0;
          }}
        >
          <CommandInput placeholder="Find a party…" />
          <CommandList className="max-h-80">
            <CommandEmpty>No party matches.</CommandEmpty>
            {allowNone && (
              <CommandGroup>
                <CommandItem value="__none" onSelect={() => (onChange(null), setOpen(false))}>
                  <span className="size-2.5 rounded-[3px] border border-dashed border-ink-3" />
                  None
                </CommandItem>
              </CommandGroup>
            )}
            <CommandGroup heading={year ? `On the ${year} ballot` : "Parties"}>
              {current.map((p) => (
                <CommandItem key={p} value={p} onSelect={() => (onChange(p), setOpen(false))}>
                  <Swatch color={manifest.parties[p].color} ring />
                  <span className="truncate">{manifest.parties[p].short}</span>
                  {value === p && <Check className="ml-auto size-3.5" aria-hidden />}
                </CommandItem>
              ))}
            </CommandGroup>
            {other.length > 0 && (
              <CommandGroup heading="Other elections">
                {other.map((p) => (
                  <CommandItem key={p} value={p} onSelect={() => (onChange(p), setOpen(false))}>
                    <Swatch color={manifest.parties[p].color} ring />
                    <span className="truncate">{manifest.parties[p].short}</span>
                    <span className="ml-auto text-[11px] text-ink-3">{years(p)}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  size = "sm",
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: React.ReactNode; title?: string; disabled?: boolean }[];
  label: string;
  size?: "sm" | "default";
  className?: string;
}) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(v) => v && onChange(v as T)}
      aria-label={label}
      spacing={0}
      className={cn("rounded-lg bg-wash p-0.5", className)}
    >
      {options.map((o) => (
        <ToggleGroupItem
          key={o.value}
          value={o.value}
          size={size}
          title={o.title}
          disabled={o.disabled}
          className="rounded-md px-2.5 text-[12.5px] font-medium text-ink-2 hover:bg-wash-2 hover:text-ink data-[state=on]:bg-ink data-[state=on]:text-paper"
        >
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

export function FieldLabel({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="text-[12px] font-medium text-ink-2">
      {children}
    </label>
  );
}
