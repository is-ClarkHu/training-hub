"""Synonym / body-part alias table for rule-based retrieval recall (plan item 1).

Maps the domain's key concepts to their zh+en aliases so keyword matching in the
context builder catches synonyms (肩 = shoulder = 过顶 = rotator cuff …). Matching is
substring-based, which works for both English tokens and un-segmented Chinese. No
embeddings — the cheapest recall rung per the plan; semantic search stays deferred.
"""
from __future__ import annotations

import re

BODY_PART_ALIASES: dict[str, list[str]] = {
    "shoulders": ["shoulder", "shoulders", "肩", "肩膀", "三角肌", "deltoid", "delt", "rotator cuff", "旋转肌", "过顶", "overhead", "推举"],
    "chest": ["chest", "胸", "胸肌", "pec", "pectoral", "卧推", "bench", "dip", "臂屈伸"],
    "back": ["back", "背", "背部", "lat", "lats", "阔背", "背阔", "row", "划船", "引体", "pull-up", "pullup", "deadlift", "硬拉"],
    "legs": ["leg", "legs", "腿", "股四头", "quad", "hamstring", "腘绳", "小腿", "calf", "squat", "深蹲", "臀", "glute", "lunge", "箭步"],
    "arms": ["arm", "arms", "手臂", "二头", "biceps", "三头", "triceps", "curl", "弯举", "前臂", "forearm"],
    "core": ["core", "核心", "腹", "腹肌", "abs", "plank", "平板"],
    "frisbee": ["frisbee", "飞盘", "ultimate", "冲刺", "sprint"],
}

_TOKEN = re.compile(r"[a-zA-Z]+|[一-鿿]+")


def _tokens(text: str) -> list[str]:
    return [t.lower() for t in _TOKEN.findall(text or "")]


def mentioned_body_parts(text: str) -> list[str]:
    """Canonical body parts whose aliases appear anywhere in the text."""
    low = (text or "").lower()
    return [bp for bp, aliases in BODY_PART_ALIASES.items() if any(a.lower() in low for a in aliases)]


def expand_terms(text: str) -> set[str]:
    """Query tokens + the aliases of any body part mentioned — the set to match
    candidate texts against (substring). Drops 1-char English noise."""
    terms = set(_tokens(text))
    for bp in mentioned_body_parts(text):
        terms.update(a.lower() for a in BODY_PART_ALIASES[bp])
        terms.add(bp)
    return {t for t in terms if len(t) >= 2 or not t.isascii()}


def relevance(text: str, terms: set[str]) -> int:
    """How many query terms (synonyms included) appear in the candidate text."""
    if not terms:
        return 0
    low = (text or "").lower()
    return sum(1 for t in terms if t in low)
