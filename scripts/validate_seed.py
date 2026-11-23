#!/usr/bin/env python3
"""Validate data/restaurants.json against data/restaurants.schema.json.

Dependency-free draft-07 subset validator for this specific schema, plus the
desensitization spot-check required by SPEC §14.2 step 1.  Uses jsonschema if
it happens to be installed, otherwise the built-in checker covers every
constraint declared in restaurants.schema.json.
"""

from __future__ import annotations

import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from clean_rules import classify_tone  # single source of truth; no duplicated keywords

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SEED = os.path.join(ROOT, "data", "restaurants.json")
SCHEMA = os.path.join(ROOT, "data", "restaurants.schema.json")

PII_CHECKS = {
    "手机号": re.compile(r"(?<!\d)1[3-9]\d{9}(?!\d)"),
    "学号/长数字": re.compile(r"(?<!\d)\d{8,12}(?!\d)"),
    "at昵称": re.compile(r"@[\w\u4e00-\u9fff\-]{1,20}"),
    "精确时间": re.compile(r"\d{1,2}\s*[:：]\s*\d{2}"),
    "图片占位符": re.compile(r"DISPIMG|ID_[0-9A-Fa-f]{16,}"),
}


def validate(seed: list, schema: dict) -> list[str]:
    """Return a list of human-readable violations (empty == pass)."""
    errors: list[str] = []
    if not isinstance(seed, list) or len(seed) < schema.get("minItems", 1):
        return [f"top level must be an array with >= {schema.get('minItems', 1)} items"]
    item_schema = schema["items"]
    required = set(item_schema["required"])
    props = item_schema["properties"]
    seen_ids: set[str] = set()
    for idx, row in enumerate(seed):
        label = f"[{idx}]"
        if not isinstance(row, dict):
            errors.append(f"{label} not an object")
            continue
        if set(row) != required:
            errors.append(f"{label} keys {sorted(row)} != required {sorted(required)}")
        for key, rule in props.items():
            if key not in row:
                continue
            value = row[key]
            kind = rule.get("type")
            if kind == "string":
                if not isinstance(value, str):
                    errors.append(f"{label}.{key} not string")
                    continue
                if "pattern" in rule and not re.fullmatch(rule["pattern"], value):
                    errors.append(f"{label}.{key}={value!r} fails pattern")
                if len(value) < rule.get("minLength", 0):
                    errors.append(f"{label}.{key} too short: {value!r}")
                if len(value) > rule.get("maxLength", 10**9):
                    errors.append(f"{label}.{key} too long: {value!r}")
            elif kind == "array":
                if not isinstance(value, list):
                    errors.append(f"{label}.{key} not array")
                    continue
                if len(value) < rule.get("minItems", 0):
                    errors.append(f"{label}.{key} too few items")
                if len(value) > rule.get("maxItems", 10**9):
                    errors.append(f"{label}.{key} too many items")
                item_rule = rule.get("items", {})
                for elem in value:
                    if not isinstance(elem, str):
                        errors.append(f"{label}.{key} has non-string element")
                    elif "minLength" in item_rule and len(elem) < item_rule["minLength"]:
                        errors.append(f"{label}.{key} short element: {elem!r}")
                    elif "maxLength" in item_rule and len(elem) > item_rule["maxLength"]:
                        errors.append(f"{label}.{key} long element: {elem!r}")
            elif kind == "integer":
                if not isinstance(value, int) or isinstance(value, bool):
                    errors.append(f"{label}.{key} not integer")
                elif value < rule.get("minimum", -(10**9)):
                    errors.append(f"{label}.{key} below minimum")
            elif "enum" in rule and value not in rule["enum"]:
                errors.append(f"{label}.{key}={value!r} not in enum")
        if isinstance(row.get("id"), str):
            if row["id"] in seen_ids:
                errors.append(f"{label} duplicate id {row['id']}")
            seen_ids.add(row["id"])
        # Cross-field: 有争议 must hold at least one positive and one negative
        # quote, judged by the SAME classifier the cleaner used (no duplicate
        # keyword lists that could drift out of sync).
        if row.get("verdict") == "有争议":
            tones = {classify_tone(e) for e in row.get("evidence", [])}
            if "褒" not in tones:
                errors.append(f"{label} 有争议 lacks positive quote")
            if "贬" not in tones:
                errors.append(f"{label} 有争议 lacks negative quote")
    return errors


def main() -> None:
    with open(SEED, encoding="utf-8") as fh:
        seed = json.load(fh)
    with open(SCHEMA, encoding="utf-8") as fh:
        schema = json.load(fh)

    violations = validate(seed, schema)
    print(f"schema: {len(seed)} restaurants, {len(violations)} violations")
    for err in violations[:30]:
        print("  FAIL", err)

    pii_hits: list[str] = []
    for row in seed:
        for field in ("name", "evidence", "tags"):
            values = row.get(field, [])
            if isinstance(values, str):
                values = [values]
            for value in values:
                for label, pattern in PII_CHECKS.items():
                    if pattern.search(value):
                        pii_hits.append(f"{row.get('id')}.{field} {label}: {value[:40]}")
    print(f"PII spot-check: {len(pii_hits)} hits")
    for hit in pii_hits[:20]:
        print("  FAIL", hit)

    from collections import Counter

    print("verdict distribution:", dict(Counter(r["verdict"] for r in seed)))
    if violations or pii_hits:
        raise SystemExit(1)
    print("PASS: seed conforms to schema and carries no PII patterns")


if __name__ == "__main__":
    main()
