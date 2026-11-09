"""Party registry: maps raw ballot names to stable, typed party identifiers."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from .common import CONFIG_DIR, IssueLog, load_json, norm_name, slug

NEUTRAL_COLOURS = ["#8C8C8C", "#A39E93", "#7F8C8D", "#9E9E9E", "#B0A99F", "#8D99AE"]


@dataclass
class Party:
    id: str
    name: str
    short: str
    color: str
    aliases: list[str]
    notes: str | None = None
    classified: bool = True
    raw_names: dict[int, str] = field(default_factory=dict)  # year -> name on that year's ballot


class PartyRegistry:
    def __init__(self, path: Path | None = None) -> None:
        cfg = load_json(path or CONFIG_DIR / "parties.json")
        self.parties: dict[str, Party] = {}
        self._alias: dict[str, str] = {}
        for pid, p in cfg["parties"].items():
            party = Party(pid, p["name"], p.get("short", p["name"]), p["color"], list(p.get("aliases", [])), p.get("notes"))
            self.parties[pid] = party
            for a in [p["name"], *party.aliases]:
                key = norm_name(a)
                if key in self._alias and self._alias[key] != pid:
                    raise ValueError(f"Alias {a!r} maps to both {self._alias[key]} and {pid}")
                self._alias[key] = pid

    def resolve(self, raw: str, year: int, log: IssueLog) -> str:
        """Return the party id for a raw header name. Unknown names are given a
        generated id and logged as unclassified — they are never discarded."""
        name = raw.strip()
        key = norm_name(name)
        pid = self._alias.get(key)
        if pid is None:
            pid = "x_" + slug(name)
            if pid not in self.parties:
                colour = NEUTRAL_COLOURS[len([p for p in self.parties.values() if not p.classified]) % len(NEUTRAL_COLOURS)]
                self.parties[pid] = Party(pid, name, name, colour, [name], "Not in config/parties.json", classified=False)
                self._alias[key] = pid
            log.add(year, "unclassified_party", "warning", f"Party header {name!r} is not in config/parties.json; assigned generated id {pid!r}", party=name)
        self.parties[pid].raw_names.setdefault(year, name)
        return pid
