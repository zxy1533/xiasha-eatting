#!/usr/bin/env python3
"""F1 data cleaning: raw WeChat spreadsheet -> data/restaurants.json.

Run:  python3 scripts/clean_data.py
Reads ONLY via the standard library (see xlsx_reader.py); no openpyxl.

Pipeline: read xlsx -> merge near-duplicate sheets -> normalize names ->
filter noise/PII -> desensitize -> arbitrate tone -> emit schema-valid JSON.
"""

from __future__ import annotations

import json
import os
import re
import sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from xlsx_reader import read_xlsx
from clean_rules import (
    classify_tone,
    contains_personal_info,
    desensitize,
    extract_tags,
    is_noise_comment,
    normalize_name,
    squash_space,
)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_INPUT = (
    "D:/聊天记录/xwechat_files/wxid_28at1pam5cb612_47cc/msg/file/2026-11/"
    "tmp_ffa2dd0852c780d7d1b89b64e7617ff887278ae055de667b(1).xlsx"
)
OUTPUT = os.path.join(ROOT, "data", "restaurants.json")

# Near-duplicate sheets are merged; the majority sheet becomes source_sheet.
GROUPS = {
    "褒": ["好吃的", "好吃的(2)", "好吃的 (2)", "性价比高", "好喝的饮品！", "好吃的堂食店"],
    "贬": ["好难吃", "好难吃 (2)", "少送餐品"],
}
# Deliberately excluded: notice/chat overflow (holds the dating/venting/abuse
# rows called out in the brief), coupon codes, and free-form Q&A.  Including
# them would manufacture store rows that do not exist in the verdict sheets.
EXCLUDED = {"📣请先看📣", "外卖省钱省钱", "答疑帖"}

_GENERIC_NAMES = {
    "好吃", "难吃", "店里", "同学", "大家", "外卖", "堂食", "学校", "食堂",
    "推荐", "求推荐", "有没有", "求问", "谢谢", "补充", "楼上", "这个", "那个",
}


def _build_registry(sheets: dict) -> set[str]:
    """Short column-A names seen anywhere, used to rescue misaligned rows."""
    registry: set[str] = set()
    for group_sheets in GROUPS.values():
        for sheet_name in group_sheets:
            for row in sheets.get(sheet_name, []):
                if len(row) < 2:
                    continue
                name = normalize_name(row[0])
                if 3 <= len(name) <= 20 and name not in _GENERIC_NAMES:
                    registry.add(name)
    return registry


_DESCRIPTOR_RE = re.compile(r"好吃|难吃|外卖|堂食|店里|那家|推荐|的|！|!|，|,|很|真的")


def _resolve_long_name(name: str, registry: set[str]) -> str:
    """Recover a store name from a row where a comment spilled into column A."""
    if not name:
        return ""
    # Alias keys first (e.g. "稻川島的港式..." -> 稻川岛滑蛋饭).
    from clean_rules import _ALIASES

    for key, canonical in sorted(_ALIASES.items(), key=lambda kv: -len(kv[0])):
        if name.startswith(key):
            return canonical
    # A known short name followed by a comment-like suffix is the same store:
    # "膳当家堂食比外卖好吃一万倍" -> "膳当家". Prefer the shorter canonical
    # BEFORE the exact-registry check, otherwise the long variant (which is
    # itself in the registry) short-circuits and stays a duplicate store.
    candidates = [
        n for n in registry
        if len(n) >= 3 and len(n) < len(name)
        and name.startswith(n) and _DESCRIPTOR_RE.search(name[len(n):])
    ]
    if candidates:
        return max(candidates, key=len)
    if name in registry:
        return name
    return name if len(name) <= 20 else ""


def clean(sheets: dict) -> tuple[list[dict], dict]:
    """Return (seed_rows, stats)."""
    registry = _build_registry(sheets)
    # name -> per-store accumulator
    stores: dict[str, dict] = defaultdict(
        lambda: {
            "comments": {},     # desensitized text -> tone
            "sources": Counter(),
            "votes": Counter(),
        }
    )
    seen: set[tuple[str, str]] = set()  # (name, evidence) dedupes merged sheets
    stats = Counter()

    for base_tone, sheet_names in GROUPS.items():
        for sheet_name in sheet_names:
            rows = sheets.get(sheet_name, [])
            stats["rows_read"] += len(rows)
            for row in rows:
                stats["rows_seen"] += 1
                if len(row) < 2:
                    stats["rows_no_comments"] += 1
                    continue
                name = _resolve_long_name(normalize_name(row[0]), registry)
                if not name:
                    stats["rows_bad_name"] += 1
                    continue
                acc = stores[name]
                matched = False
                for raw in row[1:]:
                    if not raw or is_noise_comment(raw):
                        stats["comments_noise"] += 1
                        continue
                    if contains_personal_info(raw):
                        stats["comments_personal"] += 1
                        continue
                    evidence = desensitize(raw)
                    if not evidence:
                        stats["comments_too_short"] += 1
                        continue
                    key = (name, evidence)
                    if key in seen:
                        stats["comments_duplicate"] += 1
                        continue
                    seen.add(key)
                    tone = classify_tone(evidence)
                    acc["comments"][evidence] = tone
                    acc["sources"][sheet_name] += 1
                    acc["votes"][base_tone] += 1
                    matched = True
                if matched:
                    stats["rows_kept"] += 1

    # Salvage the two brief-mandated 褒贬混写 examples from the notice tab.
    # That tab is mostly social chatter, so we only accept a row when exactly
    # one KNOWN store is named somewhere in it; then its review-like cells are
    # attached to that store.  No store row is invented from free chat.
    from clean_rules import _ALIASES

    DISH_HINTS = {"稻川岛滑蛋饭": ("滑蛋饭",)}
    hint_map: dict[str, set[str]] = {n: {n} for n in stores}
    for alias, canonical in _ALIASES.items():
        if canonical in stores:
            hint_map.setdefault(canonical, set()).add(alias)
    for store_name, hints in DISH_HINTS.items():
        if store_name in stores:
            hint_map.setdefault(store_name, set()).update(hints)

    notice_rows = sheets.get("📣请先看📣", [])
    for row in notice_rows:
        row_names = {
            store_name
            for raw in row
            for store_name, hints in hint_map.items()
            if any(hint in raw for hint in hints)
        }
        if len(row_names) != 1:
            continue
        name = next(iter(row_names))
        for raw in row:
            if not raw or is_noise_comment(raw) or contains_personal_info(raw):
                continue
            evidence = desensitize(raw)
            if not evidence or (name, evidence) in seen:
                continue
            seen.add((name, evidence))
            stores[name]["comments"][evidence] = classify_tone(evidence)
            stores[name]["sources"]["📣请先看📣"] += 1
            stats["notice_salvaged"] += 1

    seed: list[dict] = []
    for name, acc in stores.items():
        pos = [e for e, t in acc["comments"].items() if t == "褒"]
        neg = [e for e, t in acc["comments"].items() if t == "贬"]
        neutral = [e for e, t in acc["comments"].items() if t == "中"]
        if pos and neg:
            verdict = "有争议"
            # SPEC §4.2: keep at least one quote from each side.
            evidence = (pos[:3] + neg[:3])[:10]
        elif pos:
            verdict = "褒"
            evidence = pos[:10]
        elif neg:
            verdict = "贬"
            evidence = neg[:10]
        else:
            # No decisive wording: fall back to the originating sheet's tone.
            verdict = "褒" if acc["votes"]["褒"] >= acc["votes"]["贬"] else "贬"
            evidence = (pos + neg + neutral)[:10]
        evidence = list(dict.fromkeys(evidence))
        if not evidence:
            stats["stores_dropped_no_evidence"] += 1
            continue
        source_sheet = acc["sources"].most_common(1)[0][0]
        seed.append(
            {
                "id": "",  # assigned after deterministic sort
                "name": name,
                "verdict": verdict,
                "evidence": evidence,
                "tags": extract_tags(list(acc["comments"].keys()), verdict),
                "source_sheet": source_sheet,
                "mention_count": len(acc["comments"]),
            }
        )

    # Stable ids: sort by name, then number sequentially (rename != new id is
    # out of MVP scope; data_version handles future reseeds).
    seed.sort(key=lambda row: (row["name"], row["source_sheet"]))
    for idx, row in enumerate(seed, start=1):
        row["id"] = f"r_{idx:04d}"
    stats["stores"] = len(seed)
    for verdict in ("褒", "贬", "有争议"):
        stats[f"verdict_{verdict}"] = sum(1 for r in seed if r["verdict"] == verdict)
    return seed, dict(stats)


def main() -> None:
    input_path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_INPUT
    if not os.path.exists(input_path):
        raise SystemExit(f"input workbook not found: {input_path}")
    sheets = read_xlsx(input_path)
    missing = [s for group in GROUPS.values() for s in group if s not in sheets]
    if missing:
        raise SystemExit(f"expected sheets missing from workbook: {missing}")
    seed, stats = clean(sheets)
    os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
    with open(OUTPUT, "w", encoding="utf-8") as fh:
        json.dump(seed, fh, ensure_ascii=False, indent=2)
        fh.write("\n")

    # Mirror into the recommend/avoid cloud-function packages (SPEC §2.3).
    mirror = os.path.join(ROOT, "cloud-functions", "shared", "data", "restaurants.json")
    os.makedirs(os.path.dirname(mirror), exist_ok=True)
    with open(mirror, "w", encoding="utf-8") as fh:
        json.dump(seed, fh, ensure_ascii=False, indent=2)
        fh.write("\n")

    print(f"input : {input_path}")
    print(f"output: {OUTPUT}")
    print(f"mirrored to: {mirror}")
    print("\n--- cleaning stats ---")
    for key in (
        "rows_seen", "rows_kept", "rows_no_comments", "rows_bad_name",
        "comments_noise", "comments_personal", "comments_too_short",
        "comments_duplicate", "stores_dropped_no_evidence", "stores",
        "verdict_褒", "verdict_贬", "verdict_有争议",
    ):
        print(f"  {key:28s} {stats.get(key, 0)}")
    print("\n--- sample (first 3) ---")
    for row in seed[:3]:
        print(json.dumps(row, ensure_ascii=False)[:260])


if __name__ == "__main__":
    main()
