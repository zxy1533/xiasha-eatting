"""Pure cleaning rules for the restaurant seed.

No I/O, no dependency on the workbook.  Keeping rules in a separate module
makes every rule unit-testable and keeps clean_data.py under the 300-line cap
(SPEC §2.3 / code-organization.md).

Knowledge-base grounding:
  * security-baseline.md §六 (日志与隐私) -> desensitize() removes phone,
    student-id, @nickname and minute-level timestamps before storage.
  * SPEC §4.2 rules 3-6 -> name normalization, noise/PII filtering,
    tone arbitration and evidence length clamping live here.
"""

from __future__ import annotations

import re
import unicodedata

# ---------------------------------------------------------------------------
# Emoji / symbol stripping
# ---------------------------------------------------------------------------
_EMOJI_RANGES = [
    (0x1F000, 0x1FAFF),  # pictographs, emoticons, symbols
    (0x2600, 0x27BF),    # misc symbols and dingbats
    (0x2190, 0x21FF),    # arrows (e.g. the ⬅️ in "⬅️老公点了")
    (0x2B00, 0x2BFF),    # misc symbols and arrows
    (0xFE00, 0xFE0F),    # variation selectors
    (0x1F1E6, 0x1F1FF),  # regional indicators
]
_STRIP_CHARS = set("\u200b\u200c\u200d\u2060\ufeff\u00ad")


def strip_emoji(text: str) -> str:
    """Remove emoji/symbol code points while preserving CJK and punctuation."""
    out: list[str] = []
    for ch in text:
        cp = ord(ch)
        if ch in _STRIP_CHARS or cp in (0x20E3,):
            continue
        if any(lo <= cp <= hi for lo, hi in _EMOJI_RANGES):
            continue
        out.append(ch)
    return "".join(out)


def squash_space(text: str) -> str:
    """Collapse all whitespace (incl. newlines/full-width space) to one space."""
    return re.sub(r"\s+", " ", unicodedata.normalize("NFKC", text)).strip()


# ---------------------------------------------------------------------------
# Store-name normalization (SPEC §4.2 rule 3)
# ---------------------------------------------------------------------------
_ALIASES: dict[str, str] = {
    # Traditional variant and long-form names seen in the raw sheet.
    "稻川島": "稻川岛滑蛋饭",
    "稻川岛": "稻川岛滑蛋饭",
    "稻川岛港式滑蛋饭": "稻川岛滑蛋饭",
    "万世纸包鸡": "纸包鸡",
    "饭其家": "食其家",
    "弗雷德": "福德",
    "福雷德": "福德",
}
_SEQUENCE_RE = re.compile(r"[（(]\s*[0-9０-９一二三四五六七八九十]+\s*[)）]\s*$")
_BRANCH_RE = re.compile(r"[（(][^）)]{0,8}(?:店|校区|食堂|分店)[）)]\s*$")
_HEADER_WORDS = {"店名", "文本", "畅所欲言", "文本2", "单选项"}


def normalize_name(raw: str) -> str:
    """Canonical store name: full->half width, drop emoji/sequence/branch tags."""
    name = squash_space(strip_emoji(raw))
    name = _SEQUENCE_RE.sub("", name)
    name = _BRANCH_RE.sub("", name)
    name = name.strip(" \t-—·:：")
    if name in _HEADER_WORDS or not name:
        return ""
    # Leading "店名：" style labels occasionally appear in column A.
    name = re.sub(r"^店名\s*[:：]\s*", "", name)
    return _ALIASES.get(name, name)


# ---------------------------------------------------------------------------
# Comment-level noise and personal-information filtering (SPEC §4.2 rule 4)
# ---------------------------------------------------------------------------
_NOISE_EXACT = {
    "点了", "点", "点单了", "点过", "加一", "+1", "＋1", "1", "同样", "我也是",
    "同意", "同感", "确实", "对", "顶", "赞", "好", "蹲", "蹲一个", "蹲蹲",
    "打卡", "想吃的举个手", "已点", "收到", "哈哈", "哈哈哈哈", "hhh",
    "xswl", "笑死", "救命", "呜呜", "？？？", "...", "、", "，", "。",
}
_NOISE_RE = re.compile(
    r"^(?:(?:[\s+＋~～!！。.,，0-9点點]*?(?:点點|点)了)"
    r"|(?:(?:老公|给你|互相|我也|老板|朋友|室友|同学|兄弟|姐妹|大家一起)(?:点點|点)了)"
    r"|(?:[\s+＋]*[+＋]\s*[1一](?:\s*[+＋]\s*[1一])*)"
    r"|(?:[点點]{2,}))[\s!！。.~～+＋]*$"
)
# Whole-comment filters: socializing, venting, abuse, contact solicitation.
_PERSONAL_RE = re.compile(
    r"(?:蹲(?:到|一个|一位|个)?[^。！？\n]{0,20}(?:帅哥|美女|v|微信|对象|搭话)"
    r"|找对象|处对象|征婚|恋爱|男女朋友|男朋友|女朋友"
    r"|爸妈[，,].{0,40}(?:缘分|遇到|想)"
    r"|我叫|本人|学号|手机号|微信号|vx\s*\+|加我(?:微信|好友)"
    r"|我是傻逼|我是脑残|像脑残|傻逼|狗屎中的狗屎|全家暴毙|祖宗十八代"
    r"|裸照|约炮|有偿|兼职刷单)"
)


def is_noise_comment(text: str) -> bool:
    """True for '点了' spam, bare agreement, emoji-only and empty cells."""
    cleaned = squash_space(strip_emoji(text))
    if not cleaned or cleaned in _NOISE_EXACT:
        return True
    if _NOISE_RE.match(cleaned):
        return True
    # Discard comment-like strings that carry no CJK/letters at all.
    return not re.search(r"[\u4e00-\u9fffA-Za-z]", cleaned)


def contains_personal_info(text: str) -> bool:
    """True for rows that are socializing/venting/abuse rather than a review."""
    return bool(_PERSONAL_RE.search(strip_emoji(text)))


# ---------------------------------------------------------------------------
# Desensitization (SPEC §4.2 rule 6, F7-d, security-baseline.md §六)
# ---------------------------------------------------------------------------
_PII_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"(?<!\d)1[3-9]\d{9}(?!\d)"), "[手机]"),
    (re.compile(r"(?<!\d)\d{17}[\dXx](?!\d)"), "[学号]"),  # ID-card shape
    (re.compile(r"(?<!\d)\d{8,12}(?!\d)"), "[学号]"),
    (re.compile(r"@[\w\u4e00-\u9fff\-]{1,20}"), "[昵称]"),
    (re.compile(r"\d{1,2}\s*[:：]\s*\d{2}(?:\s*[:：]\s*\d{2})?"), "[时间]"),
    (re.compile(r"(?:微信|VX|vx|QQ|qq)\s*[:：]?\s*[A-Za-z0-9_]{5,16}"), "[联系方式]"),
]
_MIN_EVIDENCE = 8
_MAX_EVIDENCE = 60
# Embedded-image formula placeholders sometimes live in shared strings, not
# only in formula cells. They must never reach evidence or the model payload.
_IMAGE_PLACEHOLDER_RE = re.compile(r"DISPIMG|ID_[0-9A-Fa-f]{16,}")


def desensitize(text: str) -> str:
    """Strip PII and emoji, then clamp to the schema's 8-60 char window."""
    if _IMAGE_PLACEHOLDER_RE.search(text):
        return ""
    clean = strip_emoji(text)
    for pattern, replacement in _PII_PATTERNS:
        clean = pattern.sub(replacement, clean)
    clean = squash_space(clean)
    clean = re.sub(r"\s+([，。！？、；])", r"\1", clean)
    if len(clean) < _MIN_EVIDENCE:
        return ""
    if len(clean) > _MAX_EVIDENCE:
        # Prefer a sentence boundary so the quote does not end mid-word.
        window = clean[:_MAX_EVIDENCE]
        cuts = [window.rfind(mark) for mark in ("。", "！", "？", "，", "；", " ")]
        cut = max(cuts)
        clean = window[: cut + 1] if cut >= _MIN_EVIDENCE - 1 else window
    clean = clean.strip(" ,，。、")
    # Final length check AFTER trailing punctuation removal (schema is strict).
    return clean if len(clean) >= _MIN_EVIDENCE else ""


# ---------------------------------------------------------------------------
# Tone classification (SPEC §4.2 rule 5)
# ---------------------------------------------------------------------------
_NEG_PATTERNS = [
    "不好吃", "不难吃", "不会想下一次", "再也不会", "不想再吃", "难喝", "难吃",
    "避雷", "踩雷", "排雷", "一般般", "很一般", "死贵", "太贵", "量少",
    "份量少", "份量小", "量小", "不新鲜", "臭的", "是臭", "馊", "拉肚子",
    "窜稀", "吃吐", "吐了", "恶心", "好油", "很油", "太油", "预制菜",
    "齁", "好腻", "太腻", "巨腥", "很腥", "难评", "失望", "翻车", "yue",
    "慎点", "谨慎", "别点", "不要点", "闭眼", "坑人", "强雷",
]
_POS_PATTERNS = [
    "好吃", "好恰", "好喝", "yyds", "绝了", "无敌", "推荐", "回购",
    "一生推", "宝藏", "神店", "太好吃", "巨好吃", "超好吃", "真的好吃",
    "好吃死", "美味", "很嫩", "超嫩", "份量足", "量多", "量大", "吃撑",
    "便宜", "划算", "性价比", "我爱", "必点", "天菜", "绝绝子", "香死",
    "很好吃", "挺好吃", "还挺好吃", "不错", "可以冲", "爱了",
    "还行", "还可以",
]


def classify_tone(text: str) -> str:
    """Return 褒/贬/中 for one desensitized comment (negation-aware)."""
    clean = squash_space(text)
    # Neutralize "不难吃" BEFORE the negative pass: otherwise the substring
    # "难吃" would be counted as negative and cancel the positive signal.
    softened = clean
    for word in ("不难吃", "不难喝"):
        softened = softened.replace(word, "好吃")
    neg_hits = 0
    masked = softened
    # Longest first so "不好吃" wins over "好吃" and gets masked out.
    for word in sorted(_NEG_PATTERNS, key=len, reverse=True):
        count = masked.count(word)
        if count:
            neg_hits += count
            masked = masked.replace(word, "[NEG]")
    pos_hits = sum(masked.count(word) for word in _POS_PATTERNS)
    if neg_hits > pos_hits:
        return "贬"
    if pos_hits > neg_hits:
        return "褒"
    return "中"


# ---------------------------------------------------------------------------
# Tags: controlled vocabulary, only emitted when the text actually says it
# ---------------------------------------------------------------------------
_TAG_RULES: list[tuple[str, tuple[str, ...]]] = [
    ("辣", ("辣",)),
    ("便宜", ("便宜", "性价比", "划算", "省钱", "平价", "不贵")),
    ("堂食", ("堂食", "到店", "店里吃", "线下")),
    ("外卖", ("外卖", "配送", "送餐", "点上")),
    ("饮品", ("奶茶", "奶绿", "果茶", "饮品", "冰茶")),
    ("份量足", ("份量足", "量多", "量大", "份量大", "吃撑")),
    ("份量少", ("份量少", "量小", "份量小", "量少")),
    ("拌粉面", ("拌粉", "拌面", "麻辣拌", "米粉", "炒米粉")),
    ("盖饭", ("盖饭", "拌饭", "滑蛋饭", "猪脚饭", "米饭")),
    ("面食", ("米线", "拉面", "面条", "馄饨", "饺子")),
    ("炸物", ("炸鸡", "鸡架", "鸡柳", "炸串", "炸猪排")),
    ("甜品", ("甜品", "蛋糕", "冰淇淋", "蛋挞", "糖水")),
    ("早餐", ("早餐", "包子", "油条", "豆浆")),
    ("夜宵", ("夜宵", "宵夜", "烧烤")),
]


def extract_tags(comments: list[str], verdict: str) -> list[str]:
    """Derive at most 6 short tags from observed wording; never invent facts."""
    joined = " ".join(comments)
    tags = [tag for tag, words in _TAG_RULES if any(w in joined for w in words)]
    if verdict == "有争议" and "争议" not in tags:
        tags.append("争议")
    return [t for t in tags if len(t) <= 10][:6]
