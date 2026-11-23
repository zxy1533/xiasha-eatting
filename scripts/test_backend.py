#!/usr/bin/env python3
"""Backend test suite: seed contract + cleaning rules + cloud-function mocks.

Black-box oriented: assertions come from SPEC §4/§5/§7 and the JSON Schema,
not from the implementation's internal variables. Run from anywhere:
    python3 scripts/test_backend.py
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

from clean_rules import (  # noqa: E402
    classify_tone,
    contains_personal_info,
    desensitize,
    is_noise_comment,
    normalize_name,
)
from validate_seed import PII_CHECKS, validate  # noqa: E402

SEED_PATH = os.path.join(ROOT, "data", "restaurants.json")
SCHEMA_PATH = os.path.join(ROOT, "data", "restaurants.schema.json")


class SeedContractTests(unittest.TestCase):
    """The seed is the API both cloud functions consume."""

    @classmethod
    def setUpClass(cls):
        with open(SEED_PATH, encoding="utf-8") as fh:
            cls.seed = json.load(fh)
        with open(SCHEMA_PATH, encoding="utf-8") as fh:
            cls.schema = json.load(fh)

    def test_seed_conforms_to_schema(self):
        self.assertEqual(validate(self.seed, self.schema), [])

    def test_seed_has_no_pii_patterns(self):
        for row in self.seed:
            for field in ("name", "evidence", "tags"):
                values = row[field] if isinstance(row[field], list) else [row[field]]
                for value in values:
                    for label, pattern in PII_CHECKS.items():
                        self.assertIsNone(pattern.search(value), f"{row['id']}.{field} {label}: {value}")

    def test_ids_are_unique_and_sorted(self):
        ids = [row["id"] for row in self.seed]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual(ids, sorted(ids))

    def test_near_duplicate_sheets_merged_into_one_store(self):
        names = [row["name"] for row in self.seed]
        for alias in ("稻川島", "饭其家", "万世纸包鸡"):
            self.assertNotIn(alias, names, f"alias {alias} should map to canonical name")
        self.assertEqual(names.count("纸包鸡"), 1)
        self.assertEqual(len([n for n in names if "膳当家" in n]), 1)

    def test_brief_mandated_controversy_cases_have_both_sides(self):
        for name in ("纸包鸡", "稻川岛滑蛋饭"):
            store = next((r for r in self.seed if r["name"] == name), None)
            self.assertIsNotNone(store, f"{name} missing from seed")
            self.assertEqual(store["verdict"], "有争议")
            tones = {classify_tone(quote) for quote in store["evidence"]}
            self.assertIn("褒", tones, f"{name} lacks positive evidence")
            self.assertIn("贬", tones, f"{name} lacks negative evidence")

    def test_controversy_rows_keep_both_tones_across_seed(self):
        disputed = [r for r in self.seed if r["verdict"] == "有争议"]
        self.assertGreater(len(disputed), 0)
        for row in disputed:
            tones = {classify_tone(q) for q in row["evidence"]}
            self.assertTrue({"褒", "贬"}.issubset(tones), f"{row['id']} one-sided dispute")


class CleaningRuleTests(unittest.TestCase):
    """Rules are tested from the contract examples, not from their internals."""

    def test_desensitize_removes_phone_student_id_nickname_and_time(self):
        raw = "@小明 13812345678 学号2022113456 今晚8:30 这家真的很好吃"
        result = desensitize(raw)
        self.assertNotIn("13812345678", result)
        self.assertNotIn("2022113456", result)
        self.assertNotIn("小明", result)
        self.assertNotIn("8:30", result)
        for marker in ("[手机]", "[学号]", "[昵称]", "[时间]"):
            self.assertIn(marker, result)
        self.assertTrue(8 <= len(result) <= 60)

    def test_desensitize_drops_image_placeholders(self):
        raw = '=DISPIMG("ID_016E5F62D6AF426197EA2D9BB407B97D",1)'
        self.assertEqual(desensitize(raw), "")

    def test_desensitize_drops_quotes_under_eight_chars_after_trim(self):
        self.assertEqual(desensitize("很一般吧"), "")

    def test_mutation_guard_a_disabled_pii_regex_would_be_caught(self):
        # Mutation-oriented check (test-discipline.md §5): if the phone rule
        # were removed, this assertion must go red. It exercises the same
        # externally observable behaviour the production test relies on.
        raw = "电话13812345678打过去没人接，味道也一般般"
        cleaned = desensitize(raw)
        self.assertNotIn("13812345678", cleaned)
        self.assertIn("[手机]", cleaned)

    def test_noise_filter_removes_dianle_spam(self):
        for spam in ("点了", "老公点了", "+1点了！！", "点点点", "😂😂😂"):
            self.assertTrue(is_noise_comment(spam), spam)

    def test_noise_filter_keeps_real_review(self):
        self.assertFalse(is_noise_comment("真的很好吃，量也足"))

    def test_personal_info_filter_removes_social_chatter(self):
        self.assertTrue(contains_personal_info("蹲三月份晚八点半在二楼自己一个人吃饭的帅哥"))
        self.assertTrue(contains_personal_info("爸妈，我其实也蛮想遇到合适的人的"))
        self.assertFalse(contains_personal_info("这家拌粉真的很好吃"))

    def test_name_normalization_folds_fullwidth_and_alias(self):
        self.assertEqual(normalize_name("稻川島"), "稻川岛滑蛋饭")
        self.assertEqual(normalize_name("万世纸包鸡"), "纸包鸡")
        self.assertEqual(normalize_name("膳当家（传媒店）"), "膳当家")
        self.assertEqual(normalize_name("店名"), "")

    def test_tone_classifier_is_negation_aware(self):
        self.assertEqual(classify_tone("真的很好吃，推荐"), "褒")
        self.assertEqual(classify_tone("一点都不好吃，难吃"), "贬")
        self.assertEqual(classify_tone("不难吃，还行"), "褒")


class CloudFunctionTests(unittest.TestCase):
    """Delegate to the mock-based Node suite (service/repo/whitelist)."""

    def test_node_mock_suite_passes(self):
        script = os.path.join(HERE, "test_cloudfunctions.js")
        proc = subprocess.run(
            ["node", script], cwd=ROOT, capture_output=True, text=True, timeout=60
        )
        self.assertEqual(
            proc.returncode, 0,
            f"node suite failed:\n{proc.stdout}\n{proc.stderr}",
        )
        self.assertIn("13/13 cloud-function tests passed", proc.stdout)


if __name__ == "__main__":
    unittest.main(verbosity=2)
