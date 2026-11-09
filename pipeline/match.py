"""Join result rows to coordinate records.

Strategy, in order:

1. Exact match on normalised '<suburb> <address>' or '<address>' strings.
2. Fuzzy match restricted to coordinate records from the same electorate
   (or the general-electorate sub-heading in Māori electorate files, or the
   'electorates served' list in places.json) — threshold 0.88.
3. Fuzzy match against all records — threshold 0.95.

A candidate set that resolves to locations more than ``SAME_SITE_M`` apart is
treated as ambiguous and left unmatched (and reported), unless electorate or
voting-type evidence singles one out. Rows that look like mobile teams never
use fuzzy matching.
"""

from __future__ import annotations

import math
from collections import Counter, defaultdict
from dataclasses import dataclass

from .common import IssueLog, norm_name, norm_text, similarity
from .coords import CoordRecord
from .results import ResultRow

SAME_SITE_M = 150.0
FUZZY_LOCAL = 0.88
FUZZY_GLOBAL = 0.95
FUZZY_AMBIGUITY_GAP = 0.03
STOP_TOKENS_DF = 150


@dataclass
class _Keyed:
    rec: CoordRecord
    k_addr: str
    k_sub_addr: str
    k_addr_sub: str
    k_full: str


class CoordIndex:
    def __init__(self, records: list[CoordRecord], preferred_years: list[int]):
        self.records = records
        self.pref = {y: i for i, y in enumerate(preferred_years)}
        self.keyed = [
            _Keyed(r, norm_text(r.address), norm_text(f"{r.suburb} {r.address}"), norm_text(f"{r.address} {r.suburb}"), norm_text(r.full_label))
            for r in records
        ]
        self.by_key: dict[str, set[int]] = defaultdict(set)
        for i, k in enumerate(self.keyed):
            for key in (k.k_addr, k.k_sub_addr, k.k_addr_sub, k.k_full):
                if key:
                    self.by_key[key].add(i)
        self.by_electorate: dict[str, list[int]] = defaultdict(list)
        self.by_electorate_no: dict[int, list[int]] = defaultdict(list)
        for i, r in enumerate(records):
            if r.electorate:
                self.by_electorate[norm_name(r.electorate)].append(i)
            for e in r.served or []:
                self.by_electorate_no[e].append(i)
        df: Counter[str] = Counter()
        for k in self.keyed:
            df.update(set(k.k_addr.split()))
        self.token_index: dict[str, list[int]] = defaultdict(list)
        for i, k in enumerate(self.keyed):
            for t in set(k.k_addr.split()):
                if df[t] < STOP_TOKENS_DF and not t.isdigit():
                    self.token_index[t].append(i)

    # -- helpers -------------------------------------------------------------
    def _dist(self, a: int, b: int) -> float:
        ra, rb = self.records[a], self.records[b]
        return math.hypot(ra.x - rb.x, ra.y - rb.y)

    def _electorate_ok(self, i: int, row: ResultRow) -> bool:
        r = self.records[i]
        if r.served is not None:
            return row.electorate_no in r.served
        names = {norm_name(row.electorate)}
        if row.subheading:
            names.add(norm_name(row.subheading))
        return bool(r.electorate) and norm_name(r.electorate) in names

    @staticmethod
    def _type_ok(rec: CoordRecord, section: str) -> bool:
        return rec.type in (None, "both", section)

    def _rank(self, idx: list[int], row: ResultRow) -> list[int]:
        return sorted(
            idx,
            key=lambda i: (
                0 if self._type_ok(self.records[i], row.section) else 1,
                0 if self._electorate_ok(i, row) else 1,
                self.pref.get(self.records[i].year, 99),
            ),
        )

    def _resolve(self, cands: list[int], row: ResultRow) -> tuple[int | None, str]:
        """Pick one record from candidates or report ambiguity."""
        ranked = self._rank(cands, row)
        best = ranked[0]
        far = [c for c in ranked[1:] if self._dist(best, c) > SAME_SITE_M]
        if not far:
            return best, "ok"
        # Electorate/type evidence may disambiguate.
        strong = [c for c in ranked if self._type_ok(self.records[c], row.section) and self._electorate_ok(c, row)]
        if strong and all(self._dist(strong[0], c) <= SAME_SITE_M for c in strong):
            return strong[0], "disambiguated"
        return None, "ambiguous"

    # -- public --------------------------------------------------------------
    def match(self, row: ResultRow, log: IssueLog, allow_fuzzy: bool = True, local_only: bool = False, local_threshold: float = FUZZY_LOCAL) -> tuple[int | None, str, float]:
        q_addr = norm_text(row.address)
        q_sub_addr = norm_text(f"{row.suburb} {row.address}")
        q_addr_sub = norm_text(f"{row.address} {row.suburb}")
        for q in (q_sub_addr, q_addr_sub, q_addr):
            cands = sorted(self.by_key.get(q, ()))
            if cands:
                pick, status = self._resolve(cands, row)
                if pick is not None:
                    return pick, "exact" if status == "ok" else "exact-disambiguated", 1.0
                log.add(
                    row.year,
                    "ambiguous_join",
                    "warning",
                    f"Address {row.label!r} ({row.electorate}) matches {len(cands)} coordinate records at different locations; left unlocated",
                    at=row.source,
                    candidates=[self.records[c].source for c in cands[:6]],
                )
                return None, "ambiguous", 0.0
        if not allow_fuzzy or row.looks_mobile:
            return None, "none", 0.0

        # Local fuzzy: same electorate / sub-heading / served list
        local: list[int] = []
        if row.electorate_no in self.by_electorate_no:
            local = list(self.by_electorate_no[row.electorate_no])
        else:
            for name in filter(None, (row.electorate, row.subheading)):
                local.extend(self.by_electorate.get(norm_name(name), []))
        res = self._fuzzy(local, q_addr, q_sub_addr, row, local_threshold)
        if res[0] is not None or res[1] == "ambiguous" or local_only:
            return res
        # Global fuzzy with token prefilter
        pool: Counter[int] = Counter()
        for t in set(q_addr.split()):
            for i in self.token_index.get(t, ()):
                pool[i] += 1
        cands = [i for i, n in pool.items() if n >= 2]
        return self._fuzzy(cands, q_addr, q_sub_addr, row, FUZZY_GLOBAL)

    def _fuzzy(self, cands: list[int], q_addr: str, q_sub_addr: str, row: ResultRow, threshold: float) -> tuple[int | None, str, float]:
        if not cands:
            return None, "none", 0.0
        scored = []
        for i in set(cands):
            k = self.keyed[i]
            s = max(similarity(q_addr, k.k_addr), similarity(q_sub_addr, k.k_sub_addr), similarity(q_addr, k.k_full))
            scored.append((s, i))
        scored.sort(reverse=True)
        best_s, best = scored[0]
        if best_s < threshold:
            return None, "none", best_s
        rivals = [i for s, i in scored[1:] if s >= best_s - FUZZY_AMBIGUITY_GAP and self._dist(best, i) > SAME_SITE_M]
        if rivals:
            log_detail = [self.records[i].source for i in rivals[:4]]
            return None, "ambiguous", best_s if not log_detail else best_s
        tie = [i for s, i in scored if s >= best_s - 1e-9]
        pick = self._rank(tie, row)[0]
        return pick, "fuzzy", best_s
