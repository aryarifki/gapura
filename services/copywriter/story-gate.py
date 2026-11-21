"""Local editorial gate. Provider schemas are deliberately shallower than this contract."""

import json
import re
import sys
import unicodedata
from datetime import date
from decimal import Decimal
from typing import Literal

from json_repair import repair_json
from pydantic import BaseModel, ConfigDict, TypeAdapter, ValidationError


class GateError(ValueError):
    pass


def require(test, code):
    if not test:
        raise GateError(code)


def clean(text):
    return " ".join(unicodedata.normalize("NFKC", text).split())


def contains(text, phrase):
    return bool(phrase and re.search(r"(?<!\w)" + re.escape(phrase) + r"(?!\w)", text))


ID = re.compile(r"[a-z][a-z0-9_-]{0,39}\Z")
URL = r"(?:https?\s*://|www\.)"
INTERNAL = re.compile(
    URL + r"|#\w|\b(?:fact_ids|scope_note|visual_query|verification_status|metadata|verifikator)\b"
    r"|\b(?:baca (?:rilis|artikel) lengkap|cek pembaruan berikutnya|ikuti pembaruan|yang perlu diperiksa"
    r"|konteks dan batas informasi|batas klaim|belum terverifikasi otomatis|petikan terpilih"
    r"|bukan (?:hasil (?:evaluasi|review)|proyeksi|kepastian hasil|jaminan)|slide selanjutnya)\b"
    r"|\b(?:uraian|sampel|naskah|artikel) ini (?:merupakan|membaca|membahas)\b",
    re.I,
)
RELATIVE = re.compile(r"\b(?:kemarin|hari ini|besok|(?:pekan|minggu|bulan|tahun) ini)\b", re.I)
MONTH_PATTERN = (
    r"(?:Januari|Februari|Maret|April|Mei|Juni|Juli|Agustus|September|Oktober|November|Desember"
    r"|January|February|March|May|June|July|August|October|December)"
)
# Sources may quote a date in English press-release order ("November 30, 2026")
# or a short numeric form ("(11/11)"). Both are parsed into parts below.
DATE = re.compile(
    r"\b(?:\d{4}-\d\d-\d\d"
    r"|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}"
    r"|\d{1,2}/\d{1,2}"
    rf"|{MONTH_PATTERN}\s+\d{{1,2}}(?:,\s*\d{{4}})?"
    rf"|\d{{1,2}}\s+{MONTH_PATTERN}(?:\s+\d{{4}})?"
    rf"|{MONTH_PATTERN}\s+\d{{4}})\b",
    re.I,
)
NUMBER = re.compile(
    r"(?<![\w.,+\-])(?:(Rp|IDR|USD|US\$|EUR|\$)\s*)?([+\-]?\d+(?:[.,]\d+)*)"
    r"(?:\s*(%|persen\b|ribu\b|juta\b|miliar\b|triliun\b|bps\b|basis\s+(?:poin|point)\b|kg\b|km\b))?(?!\w|[.,]\d)", re.I
)
QUALIFIER = re.compile(r"\b(?:diduga|dugaan|dituduh|tuduhan|belum|berpotensi|diperkirakan|kemungkinan)\b", re.I)
ASSERTED = re.compile(r"\b(?:menetapkan|memutuskan|mengumumkan|mengonfirmasi|terjadi|meninggal|tewas|ditangkap|ditahan|mencapai|terdampak|naik|turun|menang|kalah|dinyatakan|mengalami|memastikan)\b", re.I)
QUESTION_END = re.compile(r"\?$")
MONTHS = "januari februari maret april mei juni juli agustus september oktober november desember".split()
MONTH_NUMBER = {name: index for index, name in enumerate(MONTHS, start=1)} | {
    "january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6,
    "july": 7, "august": 8, "september": 9, "october": 10, "november": 11, "december": 12,
}


def date_parts(label):
    """Return candidate (year, month, day) triples; None means "not stated"."""
    value = re.sub(r"\s+", " ", label.lower().replace(",", " ")).strip()
    results = set()
    if match := re.fullmatch(r"(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})", value):
        results.add((int(match[1]), int(match[2]), int(match[3])))
    elif match := re.fullmatch(r"(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})", value):
        year = int(match[3]) + (2000 if len(match[3]) == 2 else 0)
        results.add((year, int(match[2]), int(match[1])))
    elif match := re.fullmatch(r"(\d{1,2})/(\d{1,2})", value):
        results.add((None, int(match[2]), int(match[1])))
    elif match := re.fullmatch(r"(\d{1,2})\s+([a-z]+)(?:\s+(\d{4}))?", value):
        if match[2] in MONTH_NUMBER:
            results.add((int(match[3]) if match[3] else None, MONTH_NUMBER[match[2]], int(match[1])))
    elif match := re.fullmatch(r"([a-z]+)\s+(\d{1,2})(?:\s+(\d{4}))?", value):
        if match[1] in MONTH_NUMBER:
            results.add((int(match[3]) if match[3] else None, MONTH_NUMBER[match[1]], int(match[2])))
    elif match := re.fullmatch(r"([a-z]+)\s+(\d{4})", value):
        if match[1] in MONTH_NUMBER:
            results.add((int(match[2]), MONTH_NUMBER[match[1]], None))
    return results


def date_supported(parts, sourced):
    """A date is sourced when known fragments agree and jointly cover it."""
    known = [item for item in sourced if item]
    if not parts or not known:
        return False
    for triple in parts:
        compatible = [item for item in known if all(a is None or b is None or a == b for a, b in zip(triple, item))]
        if compatible and all(any(item[index] == value for item in compatible)
                              for index, value in enumerate(triple) if value is not None):
            return True
    return False


class Row(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid", str_strip_whitespace=True)


class Synthesis(Row):
    kind: Literal["summary", "evidence", "timeline", "number", "person", "acronym"]
    title: str = ""
    angle: str = ""
    scope_note: str = ""
    source_id: str = ""
    fact_id: str = ""
    text: str = ""
    fact_ids: str = ""
    date: str = ""
    value: str = ""
    name: str = ""
    expansion: str = ""
    short: str = ""
    full_label: str = ""
    short_label: str = ""
    quote: str = ""
    speaker: str = ""


class Article(Row):
    kind: Literal["metadata", "lead", "section", "paragraph", "takeaway"]
    headline: str = ""
    seo_title: str = ""
    meta_description: str = ""
    section: int = 0
    text: str = ""
    fact_ids: str = ""


class Carousel(Row):
    kind: Literal["slide", "paragraph"]
    no: int
    role: Literal["", "cover", "lead", "close"] = ""
    layout: Literal["", "editorial-cover", "editorial-lead", "editorial-close"] = ""
    purpose: str = ""
    kicker: str = ""
    title: str = ""
    text: str = ""
    fact_ids: str = ""
    visual_query: str = ""
    question: str = ""


class Caption(Row):
    kind: Literal["hook", "paragraph", "question", "hashtag"]
    text: str
    fact_ids: str = ""


class Threads(Row):
    no: int
    text: str
    fact_ids: str = ""


class Review(Row):
    kind: Literal["verdict", "issue"]
    supported: bool | None = None
    channel: Literal["", "article", "slides", "caption", "threads"] = ""
    location: str = ""
    reason: str = ""
    fact_ids: str = ""


def rows(model, data, max_count):
    require(isinstance(data, list) and 0 < len(data) <= max_count, "rows_invalid")
    result = TypeAdapter(list[model]).validate_python(data, strict=True)
    for row in result:
        for field in model.model_fields:
            value = getattr(row, field)
            if isinstance(value, str):
                require(len(value) <= 10000 and not re.search(r"[\ud800-\udfff\x00-\x08\x0b\x0c\x0e-\x1f\u202a-\u202e\u2066-\u2069]", value), "invalid_text_characters")
                setattr(row, field, clean(value))
    return result


def fields(row, allowed):
    require(all(field in allowed.split() for field in row.model_dump(exclude_defaults=True) if field != "kind"), f"{row.kind}_fields_invalid")


def one(items, kind):
    matches = [item for item in items if item.kind == kind]
    require(len(matches) == 1, f"{kind}_one_required")
    return matches[0]


def public(text, field, maximum, minimum=1):
    require(minimum <= len(text) <= maximum, f"{field}_length_{minimum}_{maximum}")
    require(not INTERNAL.search(text), f"{field}_internal_or_boilerplate")


def fact_refs(row, facts, field, required=False):
    ids = [item.strip() for item in row.fact_ids.split(",") if item.strip()] if row.fact_ids else []
    require(not required or ids, f"{field}_fact_ids_required")
    require(len(ids) <= len(facts) and len(set(ids)) == len(ids) and all(item in facts for item in ids), f"{field}_fact_ids_invalid")
    row.fact_ids = ",".join(ids)
    return ids


def split_quantities(text, *, source=False):
    results = set()
    text = re.sub(r"(?<![\w.,+\-])((?:19|20)\d{2})\s*[-–—]\s*((?:19|20)\d{2})(?!\w)", r"\1 dan \2", text)
    if source:
        # A sourced calendar date also supports its year in narrative prose;
        # its day/month digits are not independently sourced quantities.
        for label in DATE.findall(text):
            key = date_key(label)
            if key:
                results.add(("", Decimal(key.year), ""))
    for currency, value, unit in NUMBER.findall(DATE.sub(" ", text)):
        unit = re.sub(r"basis\s+(?:poin|point)", "bps", unit.lower())
        if "," in value:
            value = value.replace(".", "").replace(",", ".")
        elif re.fullmatch(r"[+-]?\d{1,3}(?:\.\d{3})+", value):
            value = value.replace(".", "")
        if value.count(".") > 1 or len(value) > 100:
            results.add((currency.lower(), value, unit.lower()))
        else:
            results.add(({"idr": "rp", "us$": "usd"}.get(currency.lower(), currency.lower()), Decimal(value), unit.lower().replace("persen", "%")))
    return results


def claim(text, ids, facts, field, maximum=1500, minimum=1, *, question=False):
    public(text, field, maximum, minimum)
    support = [facts[item]["text"] for item in ids]
    require(not RELATIVE.search(text), f"{field}_relative_date_unsupported")
    source_dates = [triple for source in support for label in DATE.findall(source) for triple in date_parts(label)]
    require(all(any(contains(source.lower(), label.lower()) for source in support) or date_supported(date_parts(label), source_dates)
                for label in DATE.findall(text)), f"{field}_date_unreferenced")
    require(split_quantities(text) <= set().union(*(split_quantities(source, source=True) for source in support)), f"{field}_number_unreferenced")
    quoted = re.findall(r'[“"]([^”"]+)[”"]', text)
    require(all(any(facts[key].get("quote", {}).get("text") == part.rstrip(",") and
                    contains(text, facts[key]["quote"]["speaker"]) for key in ids) for part in quoted), f"{field}_quote_unreferenced")
    if not question and ASSERTED.search(text):
        require(ids, f"{field}_fact_ids_required")
        require(QUALIFIER.search(text) or not all(QUALIFIER.search(source) for source in support), f"{field}_qualifier_missing")


def question(text, field):
    require(text.count("?") == 1 and QUESTION_END.search(text), f"{field}_exactly_one_question")


def distinct_copy(values, field):
    keys = [re.sub(r"\W+", " ", value.casefold()).strip() for value in values if value]
    require(len(keys) == len(set(keys)), f"{field}_duplicate")


def label_words(value):
    return re.findall(r"\w+", value.casefold())


def capacity_label(label, name):
    # A full label may put the supported name before or after its capacity.
    value, person = label_words(label), label_words(name)
    if value[:len(person)] == person:
        return value[len(person):]
    if value[-len(person):] == person:
        return value[:-len(person)]
    return value if not contains(label.casefold(), name.casefold()) else []


CAPACITY_STATUS = {"mantan", "calon", "eks", "plt", "plh", "sementara", "bukan", "belum", "tidak", "nonaktif", "terpilih", "utama", "independen", "wakil", "deputi", "pelaksana", "tugas"}


def sourced_capacity(entity, source):
    name = label_words(entity.name)
    capacity = capacity_label(entity.expansion, entity.name)
    if not capacity or not contains(source.casefold(), entity.name.casefold()):
        return []
    # Parenthesized, explicitly sourced acronyms may be omitted from a full
    # label. They remain available for a shorter capacity such as Direktur BEI.
    variants = [source, re.sub(r"\([^()]*\)", " ", source)]
    for variant in variants:
        words = label_words(variant)
        for index in range(len(words) - len(name) + 1):
            if words[index:index + len(name)] != name:
                continue
            before, after = words[:index], words[index + len(name):]
            for bridge in (["adalah"], ["selaku"], ["sebagai"], ["merupakan"], ["menjabat", "sebagai"]):
                if after[:len(bridge)] == bridge:
                    after = after[len(bridge):]
                    break
            leading = before[-len(capacity):] == capacity
            trailing = after[:len(capacity)] == capacity
            if not leading and not trailing:
                continue
            prefix = before[:-len(capacity)] if leading else []
            if prefix and (set(prefix[-3:]) & CAPACITY_STATUS or prefix[-2:] == ["pelaksana", "tugas"]):
                continue
            supported = list(capacity)
            for acronym in re.finditer(r"\(([A-Z][A-Z0-9]{1,11})\)", source):
                if label_words(source[:acronym.start()])[-len(capacity):] == capacity:
                    supported.append(acronym[1].casefold())
            return supported
    return []


def entity_labels(item, facts, ids):
    fields(item, "name expansion short full_label short_label fact_ids")
    require(not item.full_label or not item.expansion or item.full_label == item.expansion, "entity_full_label_conflict")
    require(not item.short_label or not item.short or item.short_label == item.short, "entity_short_label_conflict")
    item.expansion = item.full_label or item.expansion
    item.short = item.short_label or item.short
    item.full_label = item.short_label = ""
    public(item.name, "entity_name", 100)
    public(item.expansion, "entity_expansion", 180)
    capacities = [capacity for key in ids if (capacity := sourced_capacity(item, facts[key]["text"]))]
    require(capacities, "entity_not_supported_in_same_excerpt")
    if item.short:
        public(item.short, "entity_short", 120)
        short = capacity_label(item.short, item.name)
        full = capacity_label(item.expansion, item.name)
        require(short and short[0] == full[0] and (set(full) & CAPACITY_STATUS) <= set(short), "entity_short_not_sourced")
        if full[0] in ("wakil", "juru", "pelaksana"):
            require(short[:2] == full[:2], "entity_short_not_sourced")
        def ordered_subset(capacity):
            available = iter(capacity)
            return all(any(token == word for word in available) for token in short)
        require(any(ordered_subset(capacity) for capacity in capacities), "entity_short_not_sourced")


def first_mentions(blocks, entities, *, short=False):
    sentences = [part for block in blocks for part in re.split(r"(?<=[.!?])\s+", block)]
    for entity in entities:
        name = entity["name"].casefold()
        mention = next((part for part in sentences if contains(part.casefold(), name)), None)
        labels = [entity["expansion"], entity.get("short", "") if short else ""]
        normalized = " ".join(label_words(mention)) if mention else ""
        # A label identical to the entity name needs no extra capacity: the
        # mention already carries the name itself (e.g. acronym short "OJK").
        expanded = any(label and (label_words(label) == label_words(entity["name"]) or
                                  contains(normalized, " ".join(capacity_label(label, entity["name"])))) for label in labels)
        # A validated compact person label can carry an institution acronym in
        # short channels; do not demand the long institution name a second time.
        derived = short and entity["kind"] == "acronym" and any(
            person["kind"] == "person" and person.get("short") and contains(person["short"].casefold(), name) and
            contains(normalized, " ".join(label_words(person["name"]))) and
            contains(normalized, " ".join(capacity_label(person["short"], person["name"]))) and
            set(person["fact_ids"]) & set(entity["fact_ids"]) for person in entities)
        require(mention is None or expanded or derived,
                f"{entity['kind']}_first_mention_unexpanded")


def date_key(label):
    for year, month, day in date_parts(label):
        if year is not None and month is not None and day is not None:
            try:
                return date(year, month, day)
            except ValueError:
                continue
    return None


def timeline_order(labels):
    dates = [key for label in labels for match in DATE.findall(label) if (key := date_key(match))]
    require(dates == sorted(dates), "timeline_chronological_order_required")


def synthesis(data, context):
    output = rows(Synthesis, data, 60)
    summary = one(output, "summary")
    fields(summary, "title angle scope_note")
    public(summary.title, "synthesis_title", 160)
    public(summary.angle, "synthesis_angle", 300)
    require(0 < len(summary.scope_note) <= 500 and not re.search(URL, summary.scope_note, re.I), "synthesis_scope_note_invalid")
    documents = {doc["id"]: doc for doc in context["documents"]}
    facts = {}
    seen = set()
    for item in (row for row in output if row.kind == "evidence"):
        fields(item, "source_id fact_id text quote speaker")
        require(ID.fullmatch(item.fact_id) and item.fact_id not in facts, "evidence_fact_id_invalid")
        require(item.source_id in documents, "evidence_source_id_invalid")
        require(3 <= len(item.text.split()) <= 25 and len(item.text) <= 600, "evidence_excerpt_3_to_25_words")
        doc = documents[item.source_id]
        require(any(contains(passage, item.text) for passage in doc["passages"]), f"evidence_excerpt_not_verbatim:{item.fact_id}")
        key = re.sub(r"\W+", " ", item.text.casefold()).strip()
        require(key not in seen, "evidence_excerpt_duplicate")
        seen.add(key)
        facts[item.fact_id] = {"text": item.text, "source_id": item.source_id}
        if item.quote or item.speaker:
            require(item.quote and contains(item.text, item.quote) and contains(item.text, item.speaker) and
                    any(marker + item.quote + suffix + end in item.text
                        for marker, end in [('"', '"'), ('“', '”'), ('«', '»')]
                        for suffix in ('', ',', '.', ';', ':')), f"evidence_quote_not_verbatim:{item.fact_id}")
            facts[item.fact_id]["quote"] = {"text": item.quote, "speaker": item.speaker}
    require(3 <= len(facts) <= 24 and len({fact["source_id"] for fact in facts.values()}) >= 3, "evidence_three_distinct_publishers_required")
    entities = set()
    for item in output:
        if item.kind in ("summary", "evidence"):
            continue
        ids = fact_refs(item, facts, item.kind, True)
        if item.kind in ("timeline", "number"):
            key = "date" if item.kind == "timeline" else "value"
            fields(item, f"{key} text fact_ids")
            label = getattr(item, key)
            require(0 < len(label) <= 100 and any(contains(facts[i]["text"], label) for i in ids), f"{item.kind}_label_unreferenced")
            require(item.kind != "number" or re.search(r"\d", label), "number_value_missing_digits")
            claim(item.text, ids, facts, item.kind, 300)
        else:
            entity_labels(item, facts, ids)
            require(item.name.casefold() != item.expansion.casefold() and item.name.casefold() not in entities, "entity_duplicate_or_unexpanded")
            entities.add(item.name.casefold())
    require(len(entities) <= 16, "entity_limit")
    timeline_order(row.date for row in output if row.kind == "timeline")
    return output


def article_public_rows(output):
    ordered = [one(output, "metadata"), one(output, "lead"), *(row for row in output if row.kind == "takeaway")]
    for section in (row for row in output if row.kind == "section"):
        ordered.extend([section, *(row for row in output if row.kind == "paragraph" and row.section == section.section)])
    return ordered


def article(data, facts, entities):
    output = rows(Article, data, 24)
    meta, lead = (one(output, kind) for kind in ("metadata", "lead"))
    fields(meta, "headline seo_title meta_description fact_ids")
    fields(lead, "text fact_ids")
    by_kind = {kind: [row for row in output if row.kind == kind] for kind in ("section", "paragraph", "takeaway")}
    sections, paragraphs, takeaways = (by_kind[kind] for kind in ("section", "paragraph", "takeaway"))
    require(3 <= len(sections) <= 4 and [item.section for item in sections] == list(range(1, len(sections) + 1)), "article_sections_3_to_4_sequential")
    require(2 <= len(takeaways) <= 4, "article_takeaways_2_to_4")
    require(all(1 <= item.section <= len(sections) for item in paragraphs), "article_paragraph_section_invalid")
    require(10 <= len(meta.headline.split()) <= 12 and not re.match(r"(?:Laporan\s|Artikel lengkap|Berita terbaru)", meta.headline, re.I), "article_headline_10_to_12_words_no_placeholder")
    lead_refs = fact_refs(lead, facts, "article_lead", True)
    meta_refs = fact_refs(meta, facts, "article_metadata") or lead_refs
    for key, maxlength in (("headline", 120), ("seo_title", 100), ("meta_description", 200)):
        claim(getattr(meta, key), meta_refs, facts, "article_" + key, maxlength)
    require(35 <= len(lead.text.split()) <= 55, "article_lead_35_to_55_words")
    require(not re.match(r"(?:Dalam laporan|Laporan\s+\S+|Menurut\s)", lead.text, re.I), "article_lead_open_with_news")
    claim(lead.text, lead_refs, facts, "article_lead")
    all_refs = set(lead_refs)
    public_blocks = [row.headline if row.kind == "metadata" else row.text for row in article_public_rows(output)]
    for section in sections:
        fields(section, "section text fact_ids")
        group = [item for item in paragraphs if item.section == section.section]
        require(1 <= len(group) <= 3, f"article_section_{section.section}_paragraph_count")
        group_refs = set()
        for item in group:
            fields(item, "section text fact_ids")
            ids = fact_refs(item, facts, "article_paragraph", True)
            require(40 <= len(item.text.split()) <= 55, "article_paragraph_40_to_55_words")
            claim(item.text, ids, facts, "article_paragraph", minimum=20)
            group_refs.update(ids)
        heading_refs = fact_refs(section, facts, "article_heading") or group_refs
        claim(section.text, heading_refs, facts, "article_heading", 100)
        all_refs.update(group_refs)
    require(350 <= sum(len(row.text.split()) for row in [lead, *paragraphs]) <= 550, "article_body_350_to_550_words")
    require(len({facts[i]["source_id"] for i in all_refs}) >= 3, "article_three_publishers_required")
    for item in takeaways:
        fields(item, "text fact_ids")
        claim(item.text, fact_refs(item, facts, "article_takeaway", True), facts, "article_takeaway", 300)
    distinct_copy([section.text for section in sections], "article_heading")
    distinct_copy([lead.text, *(item.text for item in paragraphs), *(item.text for item in takeaways)], "article_copy")
    first_mentions(public_blocks, entities)
    return output


def carousel(data, facts, entities):
    output = rows(Carousel, data, 12)
    slides = [row for row in output if row.kind == "slide"]
    require([slide.no for slide in slides] == [1, 2, 3], "carousel_three_sequential_slides")
    require([slide.role for slide in slides] == ["cover", "lead", "close"], "carousel_three_roles")
    require([slide.layout for slide in slides] == ["editorial-cover", "editorial-lead", "editorial-close"], "carousel_three_layouts")
    require(all(1 <= row.no <= 3 for row in output), "carousel_child_slide_invalid")
    for slide in slides:
        index = slide.no
        fields(slide, "no role layout purpose kicker title text fact_ids visual_query question")
        ids = fact_refs(slide, facts, f"carousel_slide_{index}", index == 2)
        public(slide.purpose, f"carousel_purpose_{index}", 180)
        if slide.visual_query:
            public(slide.visual_query, f"carousel_visual_query_{index}", 100)
        if slide.kicker:
            claim(slide.kicker, ids, facts, f"carousel_kicker_{index}", 40)
        claim(slide.title, ids, facts, f"carousel_title_{index}", 160)
    cover, lead, close = slides
    require(not cover.text, "carousel_cover_body_must_be_empty")
    require(10 <= len(cover.title.split()) <= 12, "carousel_cover_title_10_to_12_words")
    claim(lead.text, fact_refs(lead, facts, "carousel_lead", True), facts, "carousel_lead", 400)
    require(35 <= len(lead.text.split()) <= 45, "carousel_lead_35_to_45_words")
    paragraphs = [row for row in output if row.kind == "paragraph"]
    require(all(row.no == 2 for row in paragraphs), "carousel_paragraphs_on_lead")
    require(2 <= len(paragraphs) <= 4, "carousel_body_paragraphs_2_to_4")
    lead_ids = {item for item in lead.fact_ids.split(",") if item}
    body_refs = set()
    for paragraph in paragraphs:
        refs = fact_refs(paragraph, facts, "carousel_paragraph", True)
        require(set(refs) <= lead_ids, "carousel_paragraph_ids_not_on_lead")
        body_refs.update(refs)
        claim(paragraph.text, refs, facts, "carousel_paragraph", 600, 15)
    body_words = len(lead.text.split()) + sum(len(row.text.split()) for row in paragraphs)
    require(100 <= body_words <= 300, "carousel_body_100_to_300_words")
    require(len(body_refs) >= 3, "carousel_three_facts_required")
    require("?" not in " ".join([lead.title, lead.text, *(row.text for row in paragraphs)]), "carousel_lead_body_must_be_statement")
    question(close.question, "carousel_close")
    claim(close.question, fact_refs(close, facts, "carousel_close_question"), facts, "carousel_close_question", 160, question=True)
    require(close.text, "carousel_close_cta_required")
    require(" ".join((close.title, close.text, close.question)).count("?") == 1, "carousel_close_one_question_required")
    if close.text:
        claim(close.text, fact_refs(close, facts, "carousel_close_cta"), facts, "carousel_close_cta", 200)
        require(re.search(r"\b(?:follow|ikuti)\b", close.text, re.I) and re.search(r"\b(?:share|bagikan|sebar)\b", close.text, re.I), "carousel_close_share_follow_required")
        require(re.search(r"\b(?:kritik|saran|masukan|umpan balik)\b", close.text, re.I), "carousel_close_feedback_required")
    require(sum(len(value.split()) for value in (close.title, close.text, close.question)) <= 40, "carousel_slide_3_word_budget")
    for field in ("purpose", "kicker", "title"):
        distinct_copy([getattr(slide, field) for slide in slides], f"carousel_{field}")
    public_blocks = [cover.kicker, cover.title, lead.kicker, lead.title, lead.text,
                     *(row.text for row in paragraphs), close.kicker, close.title, close.text, close.question]
    first_mentions([part for part in public_blocks if part], entities, short=True)
    return output


def caption(data, facts, entities):
    output = rows(Caption, data, 12)
    copy = [row for row in output if row.kind != "hashtag"]
    require([row.kind for row in copy] in (["hook", "paragraph", "paragraph", "question"],
            ["hook", "paragraph", "paragraph", "paragraph", "question"]), "caption_hook_2_to_3_paragraphs_one_question")
    all_refs = set()
    for row in copy:
        ids = fact_refs(row, facts, "caption_" + row.kind)
        all_refs.update(ids)
        claim(row.text, ids, facts, "caption_" + row.kind, 120 if row.kind == "hook" else 600, question=row.kind == "question")
    question(copy[-1].text, "caption")
    require(not any("?" in row.text for row in copy[:-1]), "caption_question_only_at_close")
    require(300 <= len("\n\n".join(row.text for row in copy)) <= 1700, "caption_body_300_to_1700_chars")
    require(len(all_refs) >= 3, "caption_three_facts_required")
    distinct_copy([row.text for row in copy], "caption_copy")
    first_mentions([row.text for row in copy], entities)
    tags = [row for row in output if row.kind == "hashtag"]
    require(5 <= len(tags) <= 7, "caption_5_to_7_hashtags_required")
    for row in tags:
        fields(row, "text")
        tag = row.text.removeprefix("#").lower()
        require(1 <= len(tag) <= 40 and all(ch.isalnum() or ch == "_" for ch in tag) and any(ch.isalnum() for ch in tag), "caption_hashtag_single_token")
        row.text = "#" + tag
    distinct_copy([row.text for row in tags], "caption_hashtag")
    return output


def threads(data, facts, entities):
    output = rows(Threads, data, 4)
    require([row.no for row in output] == [1, 2, 3, 4], "threads_four_sequential_posts")
    for row in output:
        claim(row.text, fact_refs(row, facts, f"threads_post_{row.no}"), facts, f"threads_post_{row.no}", 420)
    distinct_copy([row.text for row in output], "threads_copy")
    first_mentions([row.text for row in output], entities, short=True)
    return output


def review(data, facts):
    output = rows(Review, data, 17)
    result = one(output, "verdict")
    fields(result, "supported")
    require(result.supported is not None, "review_verdict_required")
    issues = [row for row in output if row.kind == "issue"]
    for row in issues:
        fields(row, "channel location reason fact_ids")
        require(row.channel and 0 < len(row.reason) <= 600 and len(row.location) <= 100, "review_issue_invalid")
        fact_refs(row, facts, "review_issue")
    require(result.supported == (not issues), "review_verdict_issues_mismatch")
    return output


# The library may infer missing values or rewrite text. Accept its result only
# when every non-comma token is conserved (including colons and all delimiters).
TOKEN = re.compile(r'''\s+|"(?:[^"\\\x00-\x1f]|\\.)*"|'(?:[^'\\\x00-\x1f]|\\')*'|[{}\[\]:,]|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|[A-Za-z_][A-Za-z0-9_]*''')


def repair_tokens(text):
    tokens = []
    position = 0
    while position < len(text):
        match = TOKEN.match(text, position)
        require(match is not None, "json_repair_not_syntax_only")
        token = match[0]
        position = match.end()
        if token.isspace() or token == ",":
            continue
        if token.startswith('"'):
            tokens.append(("string", json.loads(token)))
        elif token.startswith("'"):
            tokens.append(("string", token[1:-1].replace("\\'", "'")))
        elif token in "{}[]:" or token in ("true", "false", "null"):
            tokens.append(("syntax", token))
        elif token[0].isdigit() or token.startswith("-"):
            tokens.append(("number", Decimal(token)))
        else:
            require(text[position:].lstrip().startswith(":"), "json_repair_not_syntax_only")
            tokens.append(("string", token))
    return tokens


def unique_keys(pairs):
    require(len({key for key, _ in pairs}) == len(pairs), "json_duplicate_key")
    return dict(pairs)


def repair(raw):
    try:
        before = repair_tokens(raw)
        fixed = repair_json(raw, strict=True, skip_json_loads=True)
        require(before == repair_tokens(fixed), "json_repair_changed_content")
        value = json.loads(fixed, object_pairs_hook=unique_keys)
        require(isinstance(value, (list, dict)), "json_root_invalid")
        return value
    except (ValueError, RecursionError, ArithmeticError):
        raise GateError("json_repair_not_syntax_only") from None


def extra_ids(text, ids, facts):
    """Fact IDs whose source text genuinely supports a number or date already
    written in `text` but missing from `ids`."""
    support = [facts[item]["text"] for item in ids]
    missing = set(split_quantities(text)) - (set().union(*(split_quantities(item, source=True) for item in support)) if support else set())
    source_dates = [triple for item in support for label in DATE.findall(item) for triple in date_parts(label)]
    labels = [label for label in DATE.findall(text)
              if not any(contains(item.lower(), label.lower()) for item in support)
              and not date_supported(date_parts(label), source_dates)]
    result = set()
    for key, fact in facts.items():
        if key in ids:
            continue
        if missing & set(split_quantities(fact["text"], source=True)):
            result.add(key)
        elif labels and any(contains(fact["text"].lower(), label.lower())
                            or date_supported(date_parts(label), [triple for lbl in DATE.findall(fact["text"]) for triple in date_parts(lbl)])
                            for label in labels):
            result.add(key)
    return result

def fact_repair(stage, value, context):
    """Deterministic micro-repair: add fact_ids that genuinely support a number
    or date already written in the text. Called only after the gate rejects
    *_number_unreferenced / *_date_unreferenced or the paragraph-ids superset."""
    facts = {fact["id"]: fact for fact in context.get("facts", [])}
    if stage == "stage3a_carousel":
        output = rows(Carousel, value, 12)
        slides = [row for row in output if row.kind == "slide"]
        lead = next(row for row in slides if row.no == 2)
        paragraphs = [row for row in output if row.kind == "paragraph"]
        lead_ids = [item for item in lead.fact_ids.split(",") if item]
        added = set(extra_ids(lead.text, lead_ids, facts))
        for row in paragraphs:
            row_ids = [item for item in row.fact_ids.split(",") if item]
            row_added = extra_ids(row.text, row_ids, facts)
            if row_added:
                row.fact_ids = ",".join(sorted(set(row_ids) | row_added))
                added |= row_added
        if added:
            lead.fact_ids = ",".join(sorted(set(lead_ids) | added))
        # Mechanical superset rule: the lead's fact_ids must cover every paragraph's.
        merged = {item for item in lead.fact_ids.split(",") if item}
        for row in paragraphs:
            merged |= {item for item in row.fact_ids.split(",") if item}
        if merged <= set(lead_ids):
            raise GateError("fact_repair_no_change")
        lead.fact_ids = ",".join(sorted(merged))
        return [row.model_dump(exclude_defaults=True) for row in output]
    if stage == "stage2_article":
        output = rows(Article, value, 24)
        meta = next(row for row in output if row.kind == "metadata")
        lead = next(row for row in output if row.kind == "lead")
        meta_ids = [item for item in meta.fact_ids.split(",") if item] if meta.fact_ids else []
        lead_ids = [item for item in lead.fact_ids.split(",") if item]
        # Metadata without its own fact_ids is validated against the lead's refs.
        target, target_ids = (meta, meta_ids) if meta_ids else (lead, lead_ids)
        added = set()
        for key in ("headline", "seo_title", "meta_description"):
            added |= extra_ids(getattr(meta, key), target_ids, facts)
        if added:
            target.fact_ids = ",".join(sorted(set(target_ids) | added))
        lead_added = extra_ids(lead.text, lead_ids, facts)
        if lead_added:
            lead.fact_ids = ",".join(sorted(set(lead.fact_ids.split(",")) | lead_added))
            added |= lead_added
        for row in output:
            if row.kind in ("paragraph", "takeaway"):
                row_ids = [item for item in row.fact_ids.split(",") if item]
                row_added = extra_ids(row.text, row_ids, facts)
                if row_added:
                    row.fact_ids = ",".join(sorted(set(row_ids) | row_added))
                    added |= row_added
        if not added:
            raise GateError("fact_repair_no_change")
        return [row.model_dump(exclude_defaults=True) for row in output]
    if stage in ("stage3b_caption", "stage3c_threads"):
        output = rows(Caption if stage == "stage3b_caption" else Threads, value, 12)
        changed = False
        for row in output:
            row_ids = [item for item in row.fact_ids.split(",") if item]
            added = extra_ids(row.text, row_ids, facts)
            if added:
                row.fact_ids = ",".join(sorted(set(row_ids) | added))
                changed = True
        require(changed, "fact_repair_no_change")
        return [row.model_dump(exclude_defaults=True) for row in output]
    raise GateError("fact_repair_stage_unsupported")

def article_repair_plan(value, context):
    """Locate independent row defects without rewriting already valid copy."""
    output = rows(Article, value, 24)
    facts = {fact["id"]: fact for fact in context.get("facts", [])}
    entities = context.get("entities", [])
    lead = one(output, "lead")
    issues = {}

    def record(index, field, check):
        try:
            check()
        except GateError as error:
            issue = issues.setdefault(index, {"index": index, "fields": [], "errors": []})
            if field not in issue["fields"]:
                issue["fields"].append(field)
            issue["errors"].append(str(error))

    for index, row in enumerate(output):
        ids = [key for key in row.fact_ids.split(",") if key in facts]
        if row.kind == "metadata":
            refs = ids or [key for key in lead.fact_ids.split(",") if key in facts]
            record(index, "headline", lambda: require(10 <= len(row.headline.split()) <= 12 and not re.match(r"(?:Laporan\s|Artikel lengkap|Berita terbaru)", row.headline, re.I), "article_headline_10_to_12_words_no_placeholder"))
            for key, maximum in (("headline", 120), ("seo_title", 100), ("meta_description", 200)):
                record(index, key, lambda: claim(getattr(row, key), refs, facts, "article_" + key, maximum))
        elif row.kind in ("lead", "paragraph", "takeaway"):
            if row.kind in ("lead", "paragraph"):
                minimum = 35 if row.kind == "lead" else 40
                record(index, "text", lambda: require(minimum <= len(row.text.split()) <= 55, "article_" + row.kind + "_word_budget"))
            record(index, "text", lambda: claim(row.text, ids, facts, "article_" + row.kind))

    # Only the first occurrence of an entity is relevant, just as in article().
    indices = {id(row): index for index, row in enumerate(output)}
    for entity in entities:
        for row in article_public_rows(output):
            index = indices[id(row)]
            key = "headline" if row.kind == "metadata" else "text"
            block = getattr(row, key)
            if contains(block.casefold(), entity["name"].casefold()):
                record(index, key, lambda: first_mentions([block], [entity]))
                break
    for index, issue in issues.items():
        row = output[index]
        issue["words"] = len((row.headline if row.kind == "metadata" else row.text).split())
        if row.kind in ("lead", "paragraph"):
            issue["min_words"] = 35 if row.kind == "lead" else 40
            issue["max_words"] = 55
            issue["minimum_words_to_add"] = max(0, issue["min_words"] - issue["words"])
            issue["target_words_to_add"] = max(0, 49 - issue["words"])
            issue["minimum_words_to_remove"] = max(0, issue["words"] - issue["max_words"])
            issue["target_words_to_remove"] = max(0, issue["words"] - 49)
        if row.kind == "metadata":
            issue["current_characters"] = {field: len(getattr(row, field)) for field in issue["fields"]}
    return [issues[index] for index in sorted(issues)]


def validate(stage, value, context):
    facts = {fact["id"]: fact for fact in context.get("facts", [])}
    entities = context.get("entities", [])
    if stage == "stage1_synthesis":
        output = synthesis(value, context)
    elif stage == "stage4_review":
        output = review(value, facts)
    else:
        validator = {"stage2_article": article, "stage3a_carousel": carousel, "stage3b_caption": caption, "stage3c_threads": threads}[stage]
        output = validator(value, facts, entities)
    return [row.model_dump(exclude_defaults=True) for row in output]


def main():
    packet = json.load(sys.stdin)
    try:
        value = repair(packet["raw"]) if packet["op"] == "repair" else article_repair_plan(packet["value"], packet["context"]) if packet["op"] == "article_repair_plan" else fact_repair(packet["stage"], packet["value"], packet["context"]) if packet["op"] == "fact_repair" else validate(packet["stage"], packet["value"], packet["context"])
        print(json.dumps({"ok": True, "value": value}, allow_nan=False))
    except GateError as error:
        print(json.dumps({"ok": False, "error": str(error)}))
    except ValidationError as error:
        entries = error.errors(include_url=False, include_context=False, include_input=False)
        details = "; ".join(f"{'.'.join(str(part) for part in entry['loc'] if isinstance(part, int)) or 'root'} {entry['type']}"
                            + (f" {entry['loc'][-1]}" if entry['loc'] and entry['type'] != "extra_forbidden" and isinstance(entry['loc'][-1], str) else "")
                            for entry in entries[:5])
        print(json.dumps({"ok": False, "error": details}))


if __name__ == "__main__":
    main()
