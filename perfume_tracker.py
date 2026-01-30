"""
Perfume Tracker – GUI Prototype (tkinter)
- Single-user, local-only
- Event-driven state (no stored status)
- JSON storage
- Mouse-first UX (lots of click buttons, context menus, click-to-vote bars)

Run:
  python perfume_tracker_gui.py

Files:
  ./data/perfumes.json
"""

from __future__ import annotations

import json
import os
import time
import uuid
from datetime import datetime
from dataclasses import dataclass, asdict, field
from typing import Dict, List, Optional, Tuple

import tkinter as tk
from tkinter import ttk, messagebox, simpledialog


# -----------------------------
# Config
# -----------------------------
DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
DB_PATH = os.path.join(DATA_DIR, "perfumes.json")

LOW_SAMPLE_THRESHOLD = 30  # configurable at code level

COLORS = {
    "bg": "#111111",
    "panel": "#161616",
    "text": "#E6E6E6",
    "muted": "#A8A8A8",
    "line": "#2A2A2A",
    "accent": "#6AA9FF",
    "accent2": "#FFB86A",   # personal marker (bar color)
    "accent2_bg": "#2A1A10",  # personal marker (background)
    "nodata": "#0B0B0B",
    "lowsample": "#2B1E00",  # subtle low-sample hint
    "good": "#1F2B1F",
}

# Fragrantica-aligned options
RATING_5 = ["love", "like", "ok", "dislike", "hate"]
SEASON_TIME_6 = ["spring", "summer", "fall", "winter", "day", "night"]
LONGEVITY_5 = ["eternal", "long", "moderate", "weak", "poor"]
SILLAGE_4 = ["enormous", "strong", "moderate", "intimate"]
GENDER_5 = ["male", "more_male", "unisex", "more_female", "female"]
VALUE_5 = ["excellent", "good", "fair", "expensive", "overpriced"]

VOTE_BLOCKS = [
    ("rating_votes", RATING_5, "Rating"),
    ("season_time_votes", SEASON_TIME_6, "When to Wear"),
    ("longevity_votes", LONGEVITY_5, "Longevity"),
    ("sillage_votes", SILLAGE_4, "Sillage"),
    ("gender_votes", GENDER_5, "Gender"),
    ("value_votes", VALUE_5, "Price Value"),
]

MY_PREFIX = "my_"


# -----------------------------
# Utility functions
# -----------------------------
def display_label(key: str) -> str:
    """Convert internal key (with underscores) to display label (with spaces)"""
    return key.replace("_", " ")


def make_combobox_searchable(combobox: ttk.Combobox, all_values: list):
    """Make a Combobox searchable by filtering options as user types"""
    
    def on_keyrelease(event):
        # Ignore special keys
        if event.keysym in ('Up', 'Down', 'Left', 'Right', 'Return', 'Tab', 'Escape', 'Shift_L', 'Shift_R', 'Control_L', 'Control_R'):
            return
        
        typed = combobox.get().lower()
        if not typed:
            # Show all values if empty
            combobox['values'] = all_values
        else:
            # Filter values that contain the typed text
            filtered = [v for v in all_values if typed in v.lower()]
            combobox['values'] = filtered
        
        # Don't auto-open dropdown - let user open it when ready
    
    combobox.bind('<KeyRelease>', on_keyrelease)
    combobox['values'] = all_values


# -----------------------------
# Data model
# -----------------------------
def now_ts() -> int:
    return int(time.time())


def new_id() -> str:
    return uuid.uuid4().hex


# -----------------------------
# Sort & Filter Config
# -----------------------------
@dataclass
class SortConfig:
    """Sort configuration with priority levels"""
    dimensions: List[Tuple[str, str]] = field(default_factory=list)  # [(dimension, order), ...]
    # dimension: "brand", "name", "rating", "longevity", "sillage", "gender", "value", "state"
    # order: "asc", "desc", "female_first", "male_first", "unisex_first", etc.


@dataclass
class FilterConfig:
    """Filter configuration"""
    brands: List[str] = field(default_factory=list)
    states: List[str] = field(default_factory=list)  # "owned", "tested", "wishlist"
    seasons: List[str] = field(default_factory=list)
    times: List[str] = field(default_factory=list)  # "day", "night"
    # Score ranges (min, max, exclude mode)
    rating_min: float = 0.0
    rating_max: float = 5.0
    rating_exclude: bool = False
    longevity_min: float = 0.0
    longevity_max: float = 5.0
    longevity_exclude: bool = False
    sillage_min: float = 0.0
    sillage_max: float = 4.0
    sillage_exclude: bool = False
    value_min: float = 0.0
    value_max: float = 5.0
    value_exclude: bool = False
    gender_preference: List[str] = field(default_factory=list)  # ["female", "more_female", "unisex", "more_male", "male"]
    tags: List[str] = field(default_factory=list)
    tags_logic: str = "or"  # "or" or "and"
    has_my_vote: bool = False
    has_fragrantica: bool = False


@dataclass
class Event:
    id: str
    perfume_id: str
    event_type: str
    timestamp: str  # System timestamp (ISO format, always set)
    location: str = ""
    ml_delta: Optional[float] = None
    price: Optional[float] = None
    purchase_type: str = ""
    purchase_type_id: str = ""  # V2: ID-based reference
    note: str = ""
    event_date: str = ""  # User-specified date (YYYY-MM-DD, optional)


@dataclass
class Note:
    """A note with title and content"""
    id: str
    title: str = "Note"  # Default title
    content: str = ""
    created_at: int = field(default_factory=now_ts)


# Common note titles for quick selection
NOTE_QUICK_TITLES = ["My Notes", "Review"]


@dataclass
class Perfume:
    id: str
    name: str
    # V2: ID-based references (brand_id is required)
    brand_id: str = ""
    concentration_id: str = ""
    outlet_ids: List[str] = field(default_factory=list)
    tag_ids: List[str] = field(default_factory=list)
    
    created_at: int = field(default_factory=now_ts)
    updated_at: int = field(default_factory=now_ts)

    events: List[Event] = field(default_factory=list)

    notes: List[Note] = field(default_factory=list)  # List of Note objects
    links: List[Dict] = field(default_factory=list)  # [{"label": "...", "url": "..."}, ...]

    # Fragrantica raw vote counts (optional block)
    fragrantica: Dict = field(default_factory=dict)

    # Personal vote counts aligned with Fragrantica options (optional blocks)
    my_votes: Dict = field(default_factory=dict)


# -----------------------------
# V2 Data Structures (ID-based)
# -----------------------------
@dataclass
class OutletInfo:
    """Location info for testing fragrances"""
    name: str          # e.g., "Sephora", "Nordstrom"
    region: str = ""   # e.g., "NYC", "LA", or leave empty


@dataclass
class AppData:
    """Complete app data: perfumes + all mapping tables"""
    perfumes: List[Perfume] = field(default_factory=list)
    brands_map: Dict[str, str] = field(default_factory=dict)           # {id: name}
    concentrations_map: Dict[str, str] = field(default_factory=dict)   # {id: name}
    outlets_map: Dict[str, OutletInfo] = field(default_factory=dict)   # {id: OutletInfo}
    tags_map: Dict[str, str] = field(default_factory=dict)             # {id: name}
    purchase_types_map: Dict[str, str] = field(default_factory=dict)   # {id: name}


# Default values for new data types
DEFAULT_CONCENTRATIONS = ["Extrait", "Parfum", "EDP", "EDT", "Cologne"]
DEFAULT_PURCHASE_TYPES = ["full", "decant", "sample", "gift"]


# -----------------------------
# Persistence
# -----------------------------
def ensure_dirs():
    os.makedirs(DATA_DIR, exist_ok=True)


def load_db() -> List[Perfume]:
    ensure_dirs()
    if not os.path.exists(DB_PATH):
        return []

    with open(DB_PATH, "r", encoding="utf-8") as f:
        raw = json.load(f)

    perfumes: List[Perfume] = []
    for p in raw.get("perfumes", []):
        events = [Event(**e) for e in p.get("events", [])]
        notes = [Note(**n) for n in p.get("notes", [])]
        perfume = Perfume(
            id=p["id"],
            brand=p.get("brand", ""),
            name=p.get("name", ""),
            tags=p.get("tags", []),
            created_at=p.get("created_at", now_ts()),
            updated_at=p.get("updated_at", now_ts()),
            events=events,
            notes=notes,
            fragrantica=p.get("fragrantica", {}),
            my_votes=p.get("my_votes", {}),
            # V2 fields
            brand_id=p.get("brand_id", ""),
            concentration_id=p.get("concentration_id", ""),
            outlet_ids=p.get("outlet_ids", []),
            tag_ids=p.get("tag_ids", []),
        )
        perfumes.append(perfume)

    return perfumes


def save_db(perfumes: List[Perfume]):
    ensure_dirs()

    def perfume_to_dict(p: Perfume) -> Dict:
        d = asdict(p)
        d["events"] = [asdict(e) for e in p.events]
        d["notes"] = [asdict(n) for n in p.notes]
        return d

    data = {"version": 2, "updated_at": now_ts(), "perfumes": [perfume_to_dict(p) for p in perfumes]}
    with open(DB_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


# -----------------------------
# V2 Persistence (with mapping tables)
# -----------------------------
def load_app_data() -> AppData:
    """Load complete app data including mapping tables"""
    ensure_dirs()
    
    if not os.path.exists(DB_PATH):
        # Initialize with default values
        app_data = AppData()
        for conc in DEFAULT_CONCENTRATIONS:
            app_data.concentrations_map[new_id()] = conc
        for pt in DEFAULT_PURCHASE_TYPES:
            app_data.purchase_types_map[new_id()] = pt
        return app_data

    with open(DB_PATH, "r", encoding="utf-8") as f:
        content = f.read().strip()
        if not content:
            # Empty file - return default
            app_data = AppData()
            for conc in DEFAULT_CONCENTRATIONS:
                app_data.concentrations_map[new_id()] = conc
            for pt in DEFAULT_PURCHASE_TYPES:
                app_data.purchase_types_map[new_id()] = pt
            return app_data
        raw = json.loads(content)

    app_data = AppData()
    
    # Load mapping tables (if exist)
    app_data.brands_map = raw.get("brands_map", {})
    app_data.concentrations_map = raw.get("concentrations_map", {})
    app_data.tags_map = raw.get("tags_map", {})
    app_data.purchase_types_map = raw.get("purchase_types_map", {})
    
    # Load outlets_map (needs special handling for OutletInfo)
    for oid, oinfo in raw.get("outlets_map", {}).items():
        if isinstance(oinfo, dict):
            app_data.outlets_map[oid] = OutletInfo(
                name=oinfo.get("name", ""),
                region=oinfo.get("region", "")
            )
        else:
            app_data.outlets_map[oid] = OutletInfo(name=str(oinfo))
    
    # Load perfumes (V2: no brand/tags string fields)
    raw_perfumes = raw.get("perfumes", [])
    for p_raw in raw_perfumes:
        events = [Event(**e) for e in p_raw.get("events", [])]
        notes = [Note(**n) for n in p_raw.get("notes", [])]
        perfume = Perfume(
            id=p_raw["id"],
            name=p_raw.get("name", ""),
            brand_id=p_raw.get("brand_id", ""),
            concentration_id=p_raw.get("concentration_id", ""),
            outlet_ids=p_raw.get("outlet_ids", []),
            tag_ids=p_raw.get("tag_ids", []),
            created_at=p_raw.get("created_at", now_ts()),
            updated_at=p_raw.get("updated_at", now_ts()),
            events=events,
            notes=notes,
            links=p_raw.get("links", []),
            fragrantica=p_raw.get("fragrantica", {}),
            my_votes=p_raw.get("my_votes", {}),
        )
        app_data.perfumes.append(perfume)
    
    # Rebuild mapping tables from raw JSON data if not present (migration from old format)
    if not app_data.brands_map:
        for i, p_raw in enumerate(raw_perfumes):
            old_brand = p_raw.get("brand", "")
            brand_id = p_raw.get("brand_id", "")
            if old_brand and brand_id:
                app_data.brands_map[brand_id] = old_brand
            elif old_brand and not brand_id:
                # Old format: generate new ID
                bid = new_id()
                app_data.brands_map[bid] = old_brand
                app_data.perfumes[i].brand_id = bid
    
    if not app_data.tags_map:
        for i, p_raw in enumerate(raw_perfumes):
            old_tags = p_raw.get("tags", [])
            tag_ids = p_raw.get("tag_ids", [])
            for j, tag in enumerate(old_tags):
                if j < len(tag_ids) and tag_ids[j]:
                    app_data.tags_map[tag_ids[j]] = tag
                else:
                    # Generate new ID for tag
                    tid = new_id()
                    app_data.tags_map[tid] = tag
                    if j < len(app_data.perfumes[i].tag_ids):
                        p.tag_ids[i] = tid
                    else:
                        p.tag_ids.append(tid)
    
    # Initialize default concentrations if empty
    if not app_data.concentrations_map:
        for conc in DEFAULT_CONCENTRATIONS:
            app_data.concentrations_map[new_id()] = conc
    
    # Initialize default purchase types if empty
    if not app_data.purchase_types_map:
        for pt in DEFAULT_PURCHASE_TYPES:
            app_data.purchase_types_map[new_id()] = pt

    return app_data


def save_app_data(app_data: AppData):
    """Save complete app data including mapping tables"""
    ensure_dirs()
    
    # V2: brand and tags are now ID-based only, no auto-fix needed

    def perfume_to_dict(p: Perfume) -> Dict:
        d = asdict(p)
        d["events"] = [asdict(e) for e in p.events]
        d["notes"] = [asdict(n) for n in p.notes]
        return d
    
    def outlet_to_dict(o: OutletInfo) -> Dict:
        return {"name": o.name, "region": o.region}

    data = {
        "version": 2,
        "updated_at": now_ts(),
        "perfumes": [perfume_to_dict(p) for p in app_data.perfumes],
        "brands_map": app_data.brands_map,
        "concentrations_map": app_data.concentrations_map,
        "outlets_map": {oid: outlet_to_dict(o) for oid, o in app_data.outlets_map.items()},
        "tags_map": app_data.tags_map,
        "purchase_types_map": app_data.purchase_types_map,
    }
    
    with open(DB_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


# -----------------------------
# Derived state (event-driven)
# -----------------------------
def derive_state(p: Perfume, tag_names: List[str] = None) -> Tuple[str, float]:
    """
    Returns:
      (state_string, owned_ml)
    Rule of thumb:
      - tested? if any smell/skin exists
      - on_skin? if any skin exists
      - owned_ml = sum(ml_delta for events that have it)
      - want_to_buy? if tag has "want" or note includes "want" (prototype heuristic)
    
    V2: tag_names parameter for ID-based tag lookup
    """
    tested = any(e.event_type in ("smell", "skin") for e in p.events)
    on_skin = any(e.event_type == "skin" for e in p.events)
    owned_ml = 0.0
    for e in p.events:
        if e.ml_delta is not None:
            owned_ml += float(e.ml_delta)

    # V2: Use tag_names parameter (required for want detection)
    tags_to_check = tag_names if tag_names is not None else []
    want = ("want" in [t.lower() for t in tags_to_check]) or any(("want" in (e.note or "").lower()) for e in p.events)

    parts = []
    if tested:
        parts.append("Tested")
    if on_skin:
        parts.append("On-skin")
    if owned_ml > 0:
        parts.append(f"Owned {owned_ml:g}ml")
    if want:
        parts.append("Want")

    if not parts:
        return ("New", owned_ml)

    return (" | ".join(parts), owned_ml)


# -----------------------------
# Vote summary calculations
# -----------------------------
def calculate_rating_summary(votes: Dict[str, int], keys: List[str]) -> str:
    """Calculate weighted average for Rating: love=5, like=4, ok=3, dislike=2, hate=1"""
    total = sum(int(votes.get(k, 0) or 0) for k in keys)
    if total == 0:
        return "—"
    
    weights = {keys[0]: 5, keys[1]: 4, keys[2]: 3, keys[3]: 2, keys[4]: 1}  # love to hate
    weighted_sum = sum(int(votes.get(k, 0) or 0) * weights[k] for k in keys)
    score = weighted_sum / total
    return f"{score:.2f}"


def calculate_when_summary(votes: Dict[str, int], keys: List[str]) -> str:
    """Show top options with smart abbreviation"""
    if not votes or all(v == 0 for v in votes.values()):
        return "—"
    
    max_votes = max(int(votes.get(k, 0) or 0) for k in keys)
    if max_votes == 0:
        return "—"
    
    threshold = max_votes * 0.6
    top_options = [k for k in keys if int(votes.get(k, 0) or 0) >= threshold]
    
    if not top_options:
        return "—"
    
    # Separate seasons and times
    all_seasons = ["spring", "summer", "fall", "winter"]
    seasons = [opt for opt in top_options if opt in all_seasons]
    times = [opt for opt in top_options if opt in ["day", "night"]]
    
    parts = []
    
    # Smart season abbreviation
    if len(seasons) == 4:
        parts.append("year-round")
    elif len(seasons) == 3:
        # Find the missing season and use "except"
        missing = [s for s in all_seasons if s not in seasons][0]
        parts.append(f"except {display_label(missing)}")
    elif seasons:
        parts.append(", ".join(display_label(s) for s in seasons))
    
    # Smart time abbreviation
    if len(times) == 2:
        parts.append("anytime")
    elif times:
        parts.append(", ".join(display_label(t) for t in times))
    
    return " | ".join(parts) if parts else "—"


def calculate_longevity_summary(votes: Dict[str, int], keys: List[str]) -> str:
    """Calculate weighted average: poor=1 to enormous=5"""
    total = sum(int(votes.get(k, 0) or 0) for k in keys)
    if total == 0:
        return "—"
    
    weights = {keys[i]: i+1 for i in range(len(keys))}  # 1 to 5
    weighted_sum = sum(int(votes.get(k, 0) or 0) * weights[k] for k in keys)
    score = weighted_sum / total
    return f"{score:.2f}"


def calculate_sillage_summary(votes: Dict[str, int], keys: List[str]) -> str:
    """Calculate weighted average: intimate=1 to enormous=4"""
    total = sum(int(votes.get(k, 0) or 0) for k in keys)
    if total == 0:
        return "—"
    
    weights = {keys[i]: i+1 for i in range(len(keys))}  # 1 to 4
    weighted_sum = sum(int(votes.get(k, 0) or 0) * weights[k] for k in keys)
    score = weighted_sum / total
    return f"{score:.2f}"


def calculate_gender_summary(votes: Dict[str, int], keys: List[str]) -> str:
    """Calculate weighted average and map to nearest option"""
    total = sum(int(votes.get(k, 0) or 0) for k in keys)
    if total == 0:
        return "—"
    
    weights = {keys[i]: i+1 for i in range(len(keys))}  # 1 to 5
    weighted_sum = sum(int(votes.get(k, 0) or 0) * weights[k] for k in keys)
    score = weighted_sum / total
    
    # Map to nearest option
    index = round(score - 1)  # score 1-5 → index 0-4
    index = max(0, min(len(keys)-1, index))  # clamp
    return display_label(keys[index])


def calculate_value_summary(votes: Dict[str, int], keys: List[str]) -> str:
    """Calculate weighted average and map to nearest option (dynamic)"""
    total = sum(int(votes.get(k, 0) or 0) for k in keys)
    if total == 0:
        return "—"
    
    weights = {keys[i]: i+1 for i in range(len(keys))}  # dynamic 1 to N
    weighted_sum = sum(int(votes.get(k, 0) or 0) * weights[k] for k in keys)
    score = weighted_sum / total
    
    # Map to nearest option
    index = round(score - 1)
    index = max(0, min(len(keys)-1, index))
    return display_label(keys[index])


# -----------------------------
# Score calculations (for sorting/filtering)
# -----------------------------
def calculate_rating_score(votes: Dict[str, int], keys: List[str]) -> float:
    """Calculate rating score: love=5, like=4, ok=3, dislike=2, hate=1"""
    total = sum(int(votes.get(k, 0) or 0) for k in keys)
    if total == 0:
        return 0.0
    weights = {keys[0]: 5, keys[1]: 4, keys[2]: 3, keys[3]: 2, keys[4]: 1}
    weighted_sum = sum(int(votes.get(k, 0) or 0) * weights[k] for k in keys)
    return weighted_sum / total


def calculate_longevity_score(votes: Dict[str, int], keys: List[str]) -> float:
    """Calculate longevity score: 1 to 5"""
    total = sum(int(votes.get(k, 0) or 0) for k in keys)
    if total == 0:
        return 0.0
    weights = {keys[i]: i+1 for i in range(len(keys))}
    weighted_sum = sum(int(votes.get(k, 0) or 0) * weights[k] for k in keys)
    return weighted_sum / total


def calculate_sillage_score(votes: Dict[str, int], keys: List[str]) -> float:
    """Calculate sillage score: 1 to 4"""
    total = sum(int(votes.get(k, 0) or 0) for k in keys)
    if total == 0:
        return 0.0
    weights = {keys[i]: i+1 for i in range(len(keys))}
    weighted_sum = sum(int(votes.get(k, 0) or 0) * weights[k] for k in keys)
    return weighted_sum / total


def calculate_gender_score(votes: Dict[str, int], keys: List[str]) -> float:
    """Calculate gender score: 1 to 5 (female to male)"""
    total = sum(int(votes.get(k, 0) or 0) for k in keys)
    if total == 0:
        return 0.0
    weights = {keys[i]: i+1 for i in range(len(keys))}
    weighted_sum = sum(int(votes.get(k, 0) or 0) * weights[k] for k in keys)
    return weighted_sum / total


def calculate_value_score(votes: Dict[str, int], keys: List[str]) -> float:
    """Calculate value score: 1 to N (dynamic)"""
    total = sum(int(votes.get(k, 0) or 0) for k in keys)
    if total == 0:
        return 0.0
    weights = {keys[i]: i+1 for i in range(len(keys))}
    weighted_sum = sum(int(votes.get(k, 0) or 0) * weights[k] for k in keys)
    return weighted_sum / total


# -----------------------------
# Vote normalization (display-time only)
# -----------------------------
def normalize_votes_sum(votes: Dict[str, int], keys: List[str]) -> List[float]:
    total = sum(int(votes.get(k, 0) or 0) for k in keys)
    if total <= 0:
        return [0.0] * len(keys)
    return [(int(votes.get(k, 0) or 0) / total) for k in keys]


def normalize_votes_max(votes: Dict[str, int], keys: List[str]) -> List[float]:
    mx = max((int(votes.get(k, 0) or 0) for k in keys), default=0)
    if mx <= 0:
        return [0.0] * len(keys)
    return [(int(votes.get(k, 0) or 0) / mx) for k in keys]


def sample_size_for_block(votes: Dict[str, int], keys: List[str], mode: str) -> int:
    """
    For sum-normalized blocks: sample size = sum
    For max-normalized season_time: sample size = max (commonly indicates strongest signal)
    """
    if mode == "max":
        return max((int(votes.get(k, 0) or 0) for k in keys), default=0)
    return sum((int(votes.get(k, 0) or 0) for k in keys), 0)


# -----------------------------
# UI Widgets
# -----------------------------
class RangeSlider(tk.Canvas):
    """A dual-handle range slider widget"""
    
    def __init__(self, master, from_=0, to=5, var_min=None, var_max=None, 
                 width=200, height=30, on_change=None, **kwargs):
        super().__init__(master, width=width, height=height, highlightthickness=0, **kwargs)
        
        self.from_ = from_
        self.to = to
        self.var_min = var_min
        self.var_max = var_max
        self.on_change = on_change
        self.width = width
        self.height = height
        
        self.track_y = height // 2
        self.handle_radius = 8
        self.track_padding = 15
        
        self.dragging = None  # "min", "max", or None
        
        self.bind("<Button-1>", self._on_click)
        self.bind("<B1-Motion>", self._on_drag)
        self.bind("<ButtonRelease-1>", self._on_release)
        
        self._draw()
    
    def _value_to_x(self, value):
        """Convert value to x position"""
        range_width = self.width - 2 * self.track_padding
        ratio = (value - self.from_) / (self.to - self.from_)
        return self.track_padding + ratio * range_width
    
    def _x_to_value(self, x):
        """Convert x position to value"""
        range_width = self.width - 2 * self.track_padding
        ratio = (x - self.track_padding) / range_width
        ratio = max(0, min(1, ratio))
        return self.from_ + ratio * (self.to - self.from_)
    
    def _draw(self):
        """Redraw the slider"""
        self.delete("all")
        
        min_val = self.var_min.get() if self.var_min else self.from_
        max_val = self.var_max.get() if self.var_max else self.to
        
        min_x = self._value_to_x(min_val)
        max_x = self._value_to_x(max_val)
        
        # Track background
        self.create_line(self.track_padding, self.track_y, 
                        self.width - self.track_padding, self.track_y,
                        fill=COLORS["text"], width=2)
        
        # Selected range
        self.create_line(min_x, self.track_y, max_x, self.track_y,
                        fill=COLORS["accent"], width=4)
        
        # Min handle
        self.create_oval(min_x - self.handle_radius, self.track_y - self.handle_radius,
                        min_x + self.handle_radius, self.track_y + self.handle_radius,
                        fill=COLORS["accent"], outline=COLORS["text"], tags="min_handle")
        
        # Max handle
        self.create_oval(max_x - self.handle_radius, self.track_y - self.handle_radius,
                        max_x + self.handle_radius, self.track_y + self.handle_radius,
                        fill=COLORS["accent"], outline=COLORS["text"], tags="max_handle")
    
    def _on_click(self, event):
        """Handle click - determine which handle to drag"""
        min_x = self._value_to_x(self.var_min.get() if self.var_min else self.from_)
        max_x = self._value_to_x(self.var_max.get() if self.var_max else self.to)
        
        dist_to_min = abs(event.x - min_x)
        dist_to_max = abs(event.x - max_x)
        
        if dist_to_min < dist_to_max and dist_to_min < self.handle_radius * 2:
            self.dragging = "min"
        elif dist_to_max < self.handle_radius * 2:
            self.dragging = "max"
        else:
            # Click on track - move nearest handle
            self.dragging = "min" if dist_to_min < dist_to_max else "max"
            self._update_value(event.x)
    
    def _on_drag(self, event):
        """Handle drag"""
        if self.dragging:
            self._update_value(event.x)
    
    def _on_release(self, event):
        """Handle release"""
        self.dragging = None
    
    def _update_value(self, x):
        """Update value based on x position (minimum 0.1 gap between handles)"""
        value = self._x_to_value(x)
        value = round(value * 10) / 10  # Round to 0.1
        min_gap = 0.3  # Minimum gap between handles
        
        if self.dragging == "min":
            max_val = self.var_max.get() if self.var_max else self.to
            value = min(value, max_val - min_gap)  # Keep gap from max
            value = max(value, self.from_)  # Don't go below range
            if self.var_min:
                self.var_min.set(value)
        elif self.dragging == "max":
            min_val = self.var_min.get() if self.var_min else self.from_
            value = max(value, min_val + min_gap)  # Keep gap from min
            value = min(value, self.to)  # Don't go above range
            if self.var_max:
                self.var_max.set(value)
        
        self._draw()
        if self.on_change:
            self.on_change()


class CollapsibleVoteBlock(ttk.Frame):
    """
    Collapsible vote block with horizontal bars
    - Click title to toggle expand/collapse
    - Click option name to vote
    - Personal vote shown with orange bar + orange background
    """

    def __init__(self, master, block_name: str, keys: List[str], title: str, 
                 normalize_mode: str, summary_func, on_vote_callback, on_toggle_callback=None, 
                 global_label_width=100, **kwargs):
        super().__init__(master, **kwargs)
        self.block_name = block_name
        self.keys = keys
        self.title = title
        self.normalize_mode = normalize_mode
        self.summary_func = summary_func
        self.on_vote_callback = on_vote_callback
        self.on_toggle_callback = on_toggle_callback
        self.global_label_width = global_label_width
        
        self.expanded = False
        self.perfume_id = None
        self.fr_votes = {}
        self.my_votes = {}
        
        # Title frame (always visible)
        self.title_frame = ttk.Frame(self, style="Panel.TFrame", cursor="hand2")
        self.title_frame.pack(fill="x", pady=2)
        self.title_frame.bind("<Button-1>", self._on_title_click)
        
        # Symbol with fixed width to prevent text shifting
        self.symbol_label = tk.Label(self.title_frame, text="＋", width=2, anchor="w",
                                     bg=COLORS["panel"], fg=COLORS["text"], cursor="hand2")
        self.symbol_label.pack(side="left")
        self.symbol_label.bind("<Button-1>", self._on_title_click)
        
        # Title text (initialized with actual title)
        self.title_label = tk.Label(self.title_frame, text=f"{title}: —  (No data)", anchor="w",
                                    bg=COLORS["panel"], fg=COLORS["text"], cursor="hand2")
        self.title_label.pack(side="left")
        self.title_label.bind("<Button-1>", self._on_title_click)
        
        # Content frame (shown when expanded)
        self.content_frame = ttk.Frame(self, style="Panel.TFrame")
        
        # Bind resize event to re-render bars
        self.bind("<Configure>", self._on_resize)
        self._last_width = 0
        
    def _on_resize(self, event):
        """Re-render bars when width changes significantly"""
        current_width = self.winfo_width()
        if abs(current_width - self._last_width) > 20 and self.expanded:  # 20px threshold
            self._last_width = current_width
            if hasattr(self, 'perfume_id') and self.perfume_id:
                self._render_bars()
    
    def set_data(self, perfume_id: str, fr_votes: Dict, my_votes: Dict, expanded: bool):
        self.perfume_id = perfume_id
        self.fr_votes = fr_votes or {}
        self.my_votes = my_votes or {}
        self.expanded = expanded
        self._render()
    
    def _render(self):
        # Calculate sample size
        if self.normalize_mode == "max":
            sample = sample_size_for_block(self.fr_votes, self.keys, "max")
            sample_type = "max"
        else:
            sample = sample_size_for_block(self.fr_votes, self.keys, "sum")
            sample_type = "votes"
        
        # Calculate summary
        summary = self.summary_func(self.fr_votes, self.keys)
        
        # Low sample warning
        if sample > 0 and sample < LOW_SAMPLE_THRESHOLD:
            sample_text = f"(⚠ {sample} {sample_type})"
        elif sample > 0:
            sample_text = f"({sample} {sample_type})"
        else:
            sample_text = "(No data)"
        
        # Update symbol and title separately to avoid text shifting
        symbol = "−" if self.expanded else "＋"
        self.symbol_label.config(text=symbol)
        self.title_label.config(text=f"{self.title}: {summary}  {sample_text}")
        
        # Show/hide content
        if self.expanded:
            self.content_frame.pack(fill="x", padx=(20, 0), pady=(2, 8))
            self._render_bars()
        else:
            self.content_frame.pack_forget()
    
    def _render_bars(self):
        # Clear previous content
        for widget in self.content_frame.winfo_children():
            widget.destroy()
        
        # Normalize votes
        if self.normalize_mode == "max":
            fractions = normalize_votes_max(self.fr_votes, self.keys)
        else:
            fractions = normalize_votes_sum(self.fr_votes, self.keys)
        
        # Check which options user has voted for (can be multiple for season_time)
        my_voted_keys = set()
        for k in self.keys:
            if int(self.my_votes.get(k, 0) or 0) > 0:
                my_voted_keys.add(k)
        
        # Use global label width for alignment across all blocks
        label_width_px = self.global_label_width
        
        # Calculate dynamic bar width
        # Fixed widths: label(global) + padding(4+8) + percentage(70) = variable
        # Min bar width: 50px
        available_width = self.winfo_width()
        if available_width <= 1:  # Not yet rendered
            available_width = 400  # Default
        
        max_bar_width = max(50, available_width - label_width_px - 98)  # 98 = 4 + 8 + 70 + 16 (padding + pct + margin)
        
        for i, key in enumerate(self.keys):
            row = ttk.Frame(self.content_frame, style="Panel.TFrame")
            row.pack(fill="x", pady=1)
            
            # Determine colors - my vote only affects bar track color
            is_my_vote = (key in my_voted_keys)
            bar_color = COLORS["accent2"] if is_my_vote else COLORS["accent"]
            
            # Option label (clickable) - dynamic width
            label_text = display_label(key)
            label_char_width = int(label_width_px / 7)  # Approximate conversion to char units
            label = tk.Label(row, text=label_text, width=label_char_width, anchor="w", 
                           bg=COLORS["panel"], fg=COLORS["text"], cursor="hand2")
            label.pack(side="left")
            label.bind("<Button-1>", lambda e, k=key: self._on_option_click(k))
            
            # Bar canvas
            bar_width = int(fractions[i] * max_bar_width)
            canvas = tk.Canvas(row, width=max_bar_width, height=18, 
                             bg=COLORS["panel"], highlightthickness=0)
            canvas.pack(side="left", padx=(4, 8))  # Reduced left padding from 8 to 4
            
            # Draw background track - use accent2_bg for my votes
            track_color = COLORS["accent2_bg"] if is_my_vote else "#3a3a3a"
            canvas.create_rectangle(0, 2, max_bar_width, 16, fill=track_color, outline="")
            
            # Draw filled bar on top
            if bar_width > 0:
                canvas.create_rectangle(0, 2, bar_width, 16, fill=bar_color, outline="")
            
            # Percentage label (right-aligned, width for "100.0%" = 6 chars + margin)
            pct = fractions[i] * 100
            pct_label = tk.Label(row, text=f"{pct:.1f}%", width=8, anchor="e",
                               bg=COLORS["panel"], fg=COLORS["text"])
            pct_label.pack(side="left")
    
    def _on_title_click(self, event):
        """Toggle expand/collapse"""
        self.expanded = not self.expanded
        if self.on_toggle_callback:
            self.on_toggle_callback(self.block_name, self.expanded)
        self._render()
    
    def _on_option_click(self, key: str):
        """User clicked an option to vote"""
        if self.perfume_id and self.on_vote_callback:
            self.on_vote_callback(self.perfume_id, self.block_name, self.keys, key)


class MiniBar(ttk.Frame):
    """
    Compact mini bar chart with optional personal marker overlay (mouse-click to set my vote).

    Mouse-first behavior:
      - click segment => set personal vote to that option (toggle)
      - right-click => clear personal vote for this block
    """

    def __init__(self, master, title: str, keys: List[str], on_set_my_vote, width=140, height=16, **kwargs):
        super().__init__(master, **kwargs)
        self.title = title
        self.keys = keys
        self.on_set_my_vote = on_set_my_vote
        self.width = width
        self.height = height

        self.label = ttk.Label(self, text=title)
        self.label.grid(row=0, column=0, sticky="w")

        self.canvas = tk.Canvas(self, width=width, height=height, highlightthickness=0, bd=0)
        self.canvas.grid(row=0, column=1, padx=(8, 0), sticky="w")

        self.canvas.bind("<Button-1>", self._on_click)
        self.canvas.bind("<Button-3>", self._on_right_click)

        self._perfume_id = None
        self._block_name = None
        self._fr_votes = {}
        self._my_votes = {}

    def set_data(self, perfume_id: str, block_name: str, fr_votes: Dict, my_votes: Dict, normalize_mode: str):
        self._perfume_id = perfume_id
        self._block_name = block_name
        self._fr_votes = fr_votes or {}
        self._my_votes = my_votes or {}

        # Determine background state
        if normalize_mode == "max":
            norm = normalize_votes_max(self._fr_votes, self.keys)
            sample = sample_size_for_block(self._fr_votes, self.keys, "max")
        else:
            norm = normalize_votes_sum(self._fr_votes, self.keys)
            sample = sample_size_for_block(self._fr_votes, self.keys, "sum")

        self._render(norm, sample)

    def _render(self, norm: List[float], sample_size: int):
        self.canvas.delete("all")

        # Background
        if sum(norm) <= 0:
            bg = COLORS["nodata"]
        elif sample_size < LOW_SAMPLE_THRESHOLD:
            bg = COLORS["lowsample"]
        else:
            bg = COLORS["panel"]

        self.canvas.create_rectangle(0, 0, self.width, self.height, fill=bg, outline=COLORS["line"])

        # Bars (horizontal segmented)
        n = len(self.keys)
        if n <= 0:
            return
        seg_w = self.width / n

        for i, frac in enumerate(norm):
            x0 = int(i * seg_w)
            x1 = int((i + 1) * seg_w)
            bar_h = int(frac * (self.height - 2))
            y0 = self.height - 1 - bar_h
            y1 = self.height - 1
            # Base color (Fragrantica)
            self.canvas.create_rectangle(x0 + 1, y0, x1 - 1, y1, fill=COLORS["accent"], outline="")

        # Personal marker (dot at chosen option)
        my_block = self._my_votes or {}
        chosen = None
        for k in self.keys:
            if int(my_block.get(k, 0) or 0) > 0:
                chosen = k
                break
        if chosen:
            idx = self.keys.index(chosen)
            cx = int((idx + 0.5) * seg_w)
            cy = int(self.height / 2)
            r = 3
            self.canvas.create_oval(cx - r, cy - r, cx + r, cy + r, fill=COLORS["accent2"], outline="")

        # Tooltip-ish sample text (tiny)
        if sum(norm) > 0:
            self.canvas.create_text(
                self.width - 2, 1,
                text=f"{sample_size}",
                anchor="ne",
                fill=COLORS["muted"],
                font=("TkDefaultFont", 7),
            )

    def _hit_test_index(self, x: int) -> Optional[int]:
        n = len(self.keys)
        if n <= 0:
            return None
        seg_w = self.width / n
        idx = int(x / seg_w)
        if idx < 0 or idx >= n:
            return None
        return idx

    def _on_click(self, evt):
        if not self._perfume_id or not self._block_name:
            return
        idx = self._hit_test_index(evt.x)
        if idx is None:
            return
        key = self.keys[idx]
        self.on_set_my_vote(self._perfume_id, self._block_name, self.keys, key)

    def _on_right_click(self, evt):
        if not self._perfume_id or not self._block_name:
            return
        self.on_set_my_vote(self._perfume_id, self._block_name, self.keys, None)


# -----------------------------
# Sort & Filter Dialogs
# -----------------------------
class SortDialog(tk.Toplevel):
    """Drag-and-drop sort configuration dialog"""
    
    DIMENSIONS = [
        ("brand", "Brand"),
        ("name", "Name"),
        ("rating", "Rating"),
        ("longevity", "Longevity"),
        ("sillage", "Sillage"),
        ("gender", "Gender"),
        ("value", "Price Value"),
        ("state", "State"),
    ]
    
    def __init__(self, parent, current_config: SortConfig, on_apply):
        super().__init__(parent)
        self.title("Sort Configuration")
        self.configure(bg=COLORS["bg"])
        self.resizable(True, True)
        
        self.current_config = current_config
        self.on_apply = on_apply
        self.result = None
        
        # Track active dimensions
        self.active_dimensions = list(current_config.dimensions)  # [(dim, order), ...]
        self.available_dims = [d for d, _ in self.DIMENSIONS if d not in [dim for dim, _ in self.active_dimensions]]
        
        self._build_ui()
        self._refresh()
    
    def _build_ui(self):
        main = ttk.Frame(self, style="TFrame")
        main.pack(padx=20, pady=20, fill="both", expand=True)
        
        # Title
        ttk.Label(main, text="Sort Configuration", style="TLabel", font=("TkDefaultFont", 12, "bold")).grid(
            row=0, column=0, columnspan=2, sticky="w", pady=(0, 8)
        )
        
        # Currently Active section (fixed height)
        active_section = ttk.Frame(main, style="Panel.TFrame")
        active_section.grid(row=1, column=0, columnspan=2, sticky="ew", pady=(0, 16))
        
        ttk.Label(active_section, text="📌 Currently Active", style="Panel.TLabel", 
                 font=("TkDefaultFont", 10, "bold")).pack(anchor="w", padx=8, pady=(8, 4))
        
        # Display current active sorts using Text widget (like Filter)
        active_text_frame = tk.Text(active_section, height=6, bg=COLORS["panel"], fg=COLORS["text"],
                                    highlightthickness=1, highlightbackground=COLORS["accent"],
                                    wrap="word", padx=8, pady=4)
        active_text_frame.pack(fill="x", padx=8, pady=(0, 8))
        
        # Build text content
        if self.current_config.dimensions:
            lines = []
            for idx, (dim, order) in enumerate(self.current_config.dimensions):
                dim_label = next(lbl for d, lbl in self.DIMENSIONS if d == dim)
                orders = self._get_orders_for_dimension(dim)
                order_display = orders.get(order, list(orders.values())[0])
                lines.append(f"{idx+1}. {dim_label} ({order_display})")
            active_text_frame.insert("1.0", "\n".join(lines))
        else:
            active_text_frame.insert("1.0", "(No active sorts)")
        
        active_text_frame.config(state="disabled")  # Read-only
        
        # Clear button
        ttk.Button(active_section, text="Clear Active", command=self._clear_all).pack(pady=(0, 8))
        
        # Left: Available dimensions
        left = ttk.Frame(main, style="Panel.TFrame")
        left.grid(row=2, column=0, sticky="nsew", padx=(0, 10))
        
        ttk.Label(left, text="Available Dimensions", style="Panel.TLabel", font=("TkDefaultFont", 10, "bold")).pack(pady=(8, 4))
        self.available_list = tk.Listbox(left, width=20, height=10, bg=COLORS["panel"], fg=COLORS["text"])
        self.available_list.pack(padx=8, pady=8, fill="both", expand=True)
        self.available_list.bind("<Double-1>", self._on_double_click_available)
        
        # Right: Active sorts
        right = ttk.Frame(main, style="Panel.TFrame")
        right.grid(row=2, column=1, sticky="nsew")
        
        ttk.Label(right, text="Active Sorts (double-click to remove)", style="Panel.TLabel", font=("TkDefaultFont", 10, "bold")).pack(pady=(8, 4))
        
        # Scrollable frame for active sorts
        canvas = tk.Canvas(right, width=320, height=300, bg=COLORS["panel"], highlightthickness=0)
        scrollbar = ttk.Scrollbar(right, orient="vertical", command=canvas.yview)
        canvas.configure(yscrollcommand=scrollbar.set)
        
        canvas.pack(side="left", fill="both", expand=True, padx=(8, 0), pady=8)
        scrollbar.pack(side="right", fill="y", padx=(0, 8), pady=8)
        
        self.active_frame = ttk.Frame(canvas, style="Panel.TFrame")
        canvas.create_window((0, 0), window=self.active_frame, anchor="nw")
        self.active_frame.bind("<Configure>", lambda e: canvas.configure(scrollregion=canvas.bbox("all")))
        
        # Mouse wheel scrolling for active sorts canvas (prevent over-scrolling)
        def on_mousewheel(event):
            try:
                if not canvas.winfo_exists():
                    return
                bbox = canvas.bbox("all")
                if not bbox:
                    return
                content_height = bbox[3] - bbox[1]
                canvas_height = canvas.winfo_height()
                if content_height <= canvas_height:
                    canvas.yview_moveto(0)
                    return
                canvas.yview_scroll(int(-1 * (event.delta / 120)), "units")
            except tk.TclError:
                pass  # Widget was destroyed
        
        canvas.bind("<Enter>", lambda e: canvas.bind_all("<MouseWheel>", on_mousewheel))
        canvas.bind("<Leave>", lambda e: canvas.unbind_all("<MouseWheel>"))
        
        # Hint
        ttk.Label(main, text="Hint: Double-click left to add, double-click right to remove, use ▲▼ to adjust priority", 
                  style="Muted.TLabel").grid(row=3, column=0, columnspan=2, sticky="w", pady=(12, 0))
        
        # Buttons
        btns = ttk.Frame(main, style="TFrame")
        btns.grid(row=4, column=0, columnspan=2, sticky="e", pady=(16, 0))
        
        ttk.Button(btns, text="Cancel", command=self.destroy).pack(side="left", padx=(0, 8))
        ttk.Button(btns, text="Apply", command=self._apply).pack(side="left")
        
        # Configure grid weights for resizing
        main.columnconfigure(0, weight=1)
        main.columnconfigure(1, weight=2)
        main.rowconfigure(2, weight=1)  # Row with Available and Active sorts
    
    def _refresh(self):
        # Update available list
        self.available_list.delete(0, "end")
        self.available_dims = [d for d, _ in self.DIMENSIONS if d not in [dim for dim, _ in self.active_dimensions]]
        for dim in self.available_dims:
            label = next(lbl for d, lbl in self.DIMENSIONS if d == dim)
            self.available_list.insert("end", label)
        
        # Update active list
        for widget in self.active_frame.winfo_children():
            widget.destroy()
        
        for idx, (dim, order) in enumerate(self.active_dimensions):
            self._create_active_item(idx, dim, order)
    
    def _create_active_item(self, idx: int, dim: str, order: str):
        frame = ttk.Frame(self.active_frame, style="Panel.TFrame")
        frame.pack(fill="x", pady=2, padx=4)
        
        # Priority label
        ttk.Label(frame, text=f"{idx+1}.", style="Panel.TLabel", width=3).pack(side="left")
        
        # Dimension label
        dim_label = next(lbl for d, lbl in self.DIMENSIONS if d == dim)
        ttk.Label(frame, text=dim_label, style="Panel.TLabel", width=10).pack(side="left", padx=(4, 8))
        
        # Order dropdown
        orders = self._get_orders_for_dimension(dim)
        # Convert order key to display value
        order_display = orders.get(order, list(orders.values())[0])
        var_order = tk.StringVar(value=order_display)
        order_cb = ttk.Combobox(frame, textvariable=var_order, values=list(orders.values()), 
                               width=12, state="readonly")
        order_cb.pack(side="left", padx=(0, 8))
        order_cb.bind("<<ComboboxSelected>>", lambda e, i=idx, v=var_order: self._on_order_change(i, v.get()))
        
        # Move up/down buttons (always show, but disable at edges)
        up_btn = ttk.Button(frame, text="▲", width=3, command=lambda: self._move_up(idx))
        up_btn.pack(side="left", padx=1)
        if idx == 0:
            up_btn.config(state="disabled")
        
        down_btn = ttk.Button(frame, text="▼", width=3, command=lambda: self._move_down(idx))
        down_btn.pack(side="left", padx=1)
        if idx >= len(self.active_dimensions) - 1:
            down_btn.config(state="disabled")
        
        # Remove button (double-click)
        frame.bind("<Double-1>", lambda e: self._remove_active(idx))
        for child in frame.winfo_children():
            if isinstance(child, ttk.Label):
                child.bind("<Double-1>", lambda e: self._remove_active(idx))
    
    def _get_orders_for_dimension(self, dim: str) -> Dict[str, str]:
        """Get available orders for a dimension"""
        if dim == "gender":
            return {
                "female_first": "Female First",
                "male_first": "Male First",
                "unisex_first": "Unisex First",
            }
        elif dim == "state":
            return {
                "owned_first": "Owned First",
                "tested_first": "Tested First",
            }
        else:
            return {
                "desc": "Descending",
                "asc": "Ascending",
            }
    
    def _on_double_click_available(self, event):
        """Add dimension to active list"""
        selection = self.available_list.curselection()
        if not selection:
            return
        
        idx = selection[0]
        dim = self.available_dims[idx]
        orders = self._get_orders_for_dimension(dim)
        default_order = list(orders.keys())[0]
        
        self.active_dimensions.append((dim, default_order))
        self._refresh()
    
    def _remove_active(self, idx: int):
        """Remove dimension from active list"""
        if 0 <= idx < len(self.active_dimensions):
            self.active_dimensions.pop(idx)
            self._refresh()
    
    def _move_up(self, idx: int):
        """Move dimension up in priority"""
        if idx > 0:
            self.active_dimensions[idx], self.active_dimensions[idx-1] = \
                self.active_dimensions[idx-1], self.active_dimensions[idx]
            self._refresh()
    
    def _move_down(self, idx: int):
        """Move dimension down in priority"""
        if idx < len(self.active_dimensions) - 1:
            self.active_dimensions[idx], self.active_dimensions[idx+1] = \
                self.active_dimensions[idx+1], self.active_dimensions[idx]
            self._refresh()
    
    def _on_order_change(self, idx: int, order_label: str):
        """Update order for a dimension"""
        if 0 <= idx < len(self.active_dimensions):
            dim, _ = self.active_dimensions[idx]
            orders = self._get_orders_for_dimension(dim)
            # Find key for this label
            order_key = next(k for k, v in orders.items() if v == order_label)
            self.active_dimensions[idx] = (dim, order_key)
    
    def _clear_all(self):
        """Clear all active dimensions"""
        self.active_dimensions = []
        self._refresh()
    
    def _apply(self):
        """Apply and close"""
        self.result = SortConfig(dimensions=list(self.active_dimensions))
        if self.on_apply:
            self.on_apply(self.result)
        self.destroy()


# -----------------------------
# Edit Events Dialog
# -----------------------------
class EditEventsDialog(tk.Toplevel):
    """Dialog to view and manage events for a perfume."""
    
    def __init__(self, parent, perfume: Perfume):
        super().__init__(parent)
        self.app = parent
        self.perfume = perfume
        
        brand_name = self.app.get_brand_name(perfume.brand_id)
        self.title(f"Events - {brand_name} {perfume.name}")
        self.configure(bg=COLORS["bg"])
        self.geometry("600x450")
        self.transient(parent)
        self.grab_set()
        
        self._build_ui()
        self._refresh_list()
    
    def _build_ui(self):
        # Title
        brand_name = self.app.get_brand_name(self.perfume.brand_id)
        title_frame = ttk.Frame(self, style="TFrame")
        title_frame.pack(fill="x", padx=10, pady=(10, 5))
        ttk.Label(title_frame, text=f"{brand_name} – {self.perfume.name}", 
                  style="TLabel", font=("TkDefaultFont", 12, "bold")).pack(side="left")
        
        # Add event buttons
        btn_frame = ttk.Frame(self, style="TFrame")
        btn_frame.pack(fill="x", padx=10, pady=5)
        
        ttk.Label(btn_frame, text="Add:", style="TLabel").pack(side="left", padx=(0, 8))
        
        ttk.Button(btn_frame, text="Smell", width=8,
                   command=lambda: self._add_smell("smell")).pack(side="left", padx=2)
        ttk.Button(btn_frame, text="Skin", width=8,
                   command=lambda: self._add_smell("skin")).pack(side="left", padx=2)
        ttk.Button(btn_frame, text="Buy", width=8,
                   command=lambda: self._add_transaction("buy")).pack(side="left", padx=2)
        ttk.Button(btn_frame, text="Sell", width=8,
                   command=lambda: self._add_transaction("sell")).pack(side="left", padx=2)
        
        # Events list
        list_frame = ttk.Frame(self, style="TFrame")
        list_frame.pack(fill="both", expand=True, padx=10, pady=5)
        
        # Treeview for events
        columns = ("date", "action", "detail", "note")
        self.tree = ttk.Treeview(list_frame, columns=columns, show="headings", height=12)
        self.tree.heading("date", text="Date")
        self.tree.heading("action", text="Action")
        self.tree.heading("detail", text="Detail")
        self.tree.heading("note", text="Note")
        
        self.tree.column("date", width=100, anchor="center")
        self.tree.column("action", width=80, anchor="center")
        self.tree.column("detail", width=200)
        self.tree.column("note", width=180)
        
        scrollbar = ttk.Scrollbar(list_frame, orient="vertical", command=self.tree.yview)
        self.tree.configure(yscrollcommand=scrollbar.set)
        
        self.tree.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")
        
        # Double-click to edit
        self.tree.bind("<Double-1>", lambda e: self._edit_selected())
        
        # Bottom buttons
        bottom_frame = ttk.Frame(self, style="TFrame")
        bottom_frame.pack(fill="x", padx=10, pady=10)
        
        ttk.Button(bottom_frame, text="Edit", command=self._edit_selected).pack(side="left", padx=(0, 5))
        ttk.Button(bottom_frame, text="Delete", command=self._delete_selected).pack(side="left")
        ttk.Button(bottom_frame, text="Close", command=self.destroy).pack(side="right")
    
    def _get_timestamp_str(self, event: Event) -> str:
        """Get timestamp as comparable string (ISO format)"""
        ts = event.timestamp
        if ts:
            if isinstance(ts, str):
                return ts
            elif isinstance(ts, (int, float)):
                try:
                    dt = datetime.fromtimestamp(ts)
                    return dt.isoformat()
                except:
                    pass
        return ""
    
    def _get_sort_key(self, event: Event) -> str:
        """
        Get sort key for event:
        - If event_date set: "event_date_00:00:00_timestamp" 
        - If not set: "timestamp_timestamp"
        This ensures proper sorting with secondary sort by timestamp.
        """
        ts_str = self._get_timestamp_str(event)
        if hasattr(event, 'event_date') and event.event_date:
            # event_date_00:00:00_timestamp
            return f"{event.event_date}T00:00:00_{ts_str}"
        else:
            # timestamp_timestamp (use timestamp as both primary and secondary)
            return f"{ts_str}_{ts_str}"
    
    def _refresh_list(self):
        """Refresh events list"""
        for item in self.tree.get_children():
            self.tree.delete(item)
        
        # Sort events by sort key (newest first)
        sorted_events = sorted(self.perfume.events, 
                               key=lambda e: self._get_sort_key(e), reverse=True)
        
        action_labels = {
            "smell": "Smell",
            "skin": "Skin",
            "buy": "Buy",
            "sell": "Sell",
        }
        
        for e in sorted_events:
            # Display date: event_date if set, else empty
            if hasattr(e, 'event_date') and e.event_date:
                date_str = e.event_date
            else:
                date_str = ""
            
            # Action label
            action_label = action_labels.get(e.event_type, e.event_type)
            
            # Detail
            details = []
            if e.location:
                details.append(f"@{e.location}")
            if e.ml_delta is not None:
                details.append(f"{e.ml_delta:+.0f}ml")
            if e.price is not None:
                details.append(f"${e.price:.0f}")
            if e.purchase_type:
                details.append(f"[{e.purchase_type}]")
            detail_str = " ".join(details)
            
            self.tree.insert("", "end", iid=e.id, values=(date_str, action_label, detail_str, e.note or ""))
    
    def _add_smell(self, event_type: str, edit_event: Event = None):
        """Open dialog to add/edit smell or skin event"""
        type_name = "Smell" if event_type == "smell" else "Skin"
        is_edit = edit_event is not None
        
        win = tk.Toplevel(self)
        win.title(f"{'Edit' if is_edit else 'Add'} {type_name}")
        win.configure(bg=COLORS["bg"])
        win.transient(self)
        win.grab_set()
        
        frm = ttk.Frame(win, style="TFrame")
        frm.pack(padx=15, pady=15)
        
        # Date (optional)
        ttk.Label(frm, text="Date:", style="TLabel").grid(row=0, column=0, sticky="e", padx=(0, 8), pady=6)
        var_date = tk.StringVar(value=edit_event.event_date if is_edit and hasattr(edit_event, 'event_date') else "")
        date_entry = ttk.Entry(frm, textvariable=var_date, width=12)
        date_entry.grid(row=0, column=1, sticky="w", pady=6)
        ttk.Label(frm, text="(YYYY-MM-DD, optional)", style="Muted.TLabel").grid(row=0, column=2, sticky="w", padx=(5, 0))
        
        # Location (with search)
        ttk.Label(frm, text="Location:", style="TLabel").grid(row=1, column=0, sticky="e", padx=(0, 8), pady=6)
        location_names = self.app.get_all_outlet_names()
        var_loc = tk.StringVar(value=edit_event.location if is_edit else "")
        loc_cb = ttk.Combobox(frm, textvariable=var_loc, width=25)
        make_combobox_searchable(loc_cb, location_names)
        loc_cb.grid(row=1, column=1, sticky="w", pady=6)
        
        # Note
        ttk.Label(frm, text="Note:", style="TLabel").grid(row=2, column=0, sticky="e", padx=(0, 8), pady=6)
        var_note = tk.StringVar(value=edit_event.note if is_edit else "")
        note_entry = ttk.Entry(frm, textvariable=var_note, width=28)
        note_entry.grid(row=2, column=1, columnspan=2, sticky="w", pady=6)
        
        # Buttons
        btn_frame = ttk.Frame(frm, style="TFrame")
        btn_frame.grid(row=3, column=0, columnspan=3, sticky="e", pady=(10, 0))
        
        def do_save():
            date_val = var_date.get().strip()
            # Validate date format if provided
            if date_val:
                try:
                    datetime.strptime(date_val, "%Y-%m-%d")
                except ValueError:
                    messagebox.showwarning("Invalid", "Date must be in YYYY-MM-DD format.")
                    return
            
            loc_str = var_loc.get().strip()
            # Auto-create outlet if new location entered
            if loc_str:
                self.app.find_or_create_outlet(loc_str)
            
            if is_edit:
                edit_event.location = loc_str
                edit_event.note = var_note.get().strip()
                edit_event.event_date = date_val
                self.app.save()
            else:
                self.app._add_event_simple(self.perfume, event_type, loc_str, var_note.get(), date_val)
            self._refresh_list()
            win.destroy()
        
        ttk.Button(btn_frame, text="Cancel", command=win.destroy).pack(side="right")
        ttk.Button(btn_frame, text="Save" if is_edit else "Add", command=do_save).pack(side="right", padx=(0, 8))
        
        loc_cb.focus_set()
    
    def _add_transaction(self, event_type: str, edit_event: Event = None):
        """Open dialog to add/edit buy/sell type event"""
        type_name = "Buy" if event_type == "buy" else "Sell"
        is_edit = edit_event is not None
        
        win = tk.Toplevel(self)
        win.title(f"{'Edit' if is_edit else 'Add'} {type_name}")
        win.configure(bg=COLORS["bg"])
        win.transient(self)
        win.grab_set()
        
        frm = ttk.Frame(win, style="TFrame")
        frm.pack(padx=15, pady=15)
        
        # Date (optional)
        ttk.Label(frm, text="Date:", style="TLabel").grid(row=0, column=0, sticky="e", padx=(0, 8), pady=6)
        var_date = tk.StringVar(value=edit_event.event_date if is_edit and hasattr(edit_event, 'event_date') else "")
        date_entry = ttk.Entry(frm, textvariable=var_date, width=12)
        date_entry.grid(row=0, column=1, sticky="w", pady=6)
        ttk.Label(frm, text="(YYYY-MM-DD, optional)", style="Muted.TLabel").grid(row=0, column=2, sticky="w", padx=(5, 0))
        
        # Format (full/tester/decant) - readonly, can only select from list
        ttk.Label(frm, text="Format:", style="TLabel").grid(row=1, column=0, sticky="e", padx=(0, 8), pady=6)
        format_names = self.app.get_all_purchase_type_names()
        default_format = edit_event.purchase_type if is_edit else (format_names[0] if format_names else "")
        var_format = tk.StringVar(value=default_format)
        format_cb = ttk.Combobox(frm, textvariable=var_format, values=format_names, width=15, state="readonly")
        format_cb.grid(row=1, column=1, sticky="w", pady=6)
        
        # ML (positive only) - for edit, show absolute value
        ttk.Label(frm, text="ML:", style="TLabel").grid(row=2, column=0, sticky="e", padx=(0, 8), pady=6)
        default_ml = abs(edit_event.ml_delta) if is_edit and edit_event.ml_delta else 0
        var_ml = tk.StringVar(value=str(default_ml))
        ml_entry = ttk.Entry(frm, textvariable=var_ml, width=10)
        ml_entry.grid(row=2, column=1, sticky="w", pady=6)
        
        # Quick ML buttons
        ml_btns = ttk.Frame(frm, style="TFrame")
        ml_btns.grid(row=2, column=2, sticky="w", padx=(8, 0))
        for txt, val in [("1", "1"), ("5", "5"), ("10", "10"), ("30", "30"), ("50", "50"), ("100", "100")]:
            ttk.Button(ml_btns, text=txt, width=3, 
                      command=lambda v=val: var_ml.set(v)).pack(side="left", padx=1)
        
        # Price (positive only)
        ttk.Label(frm, text="Price:", style="TLabel").grid(row=3, column=0, sticky="e", padx=(0, 8), pady=6)
        default_price = edit_event.price if is_edit and edit_event.price else 0
        var_price = tk.StringVar(value=str(default_price))
        price_entry = ttk.Entry(frm, textvariable=var_price, width=10)
        price_entry.grid(row=3, column=1, sticky="w", pady=6)
        
        # Note
        ttk.Label(frm, text="Note:", style="TLabel").grid(row=4, column=0, sticky="e", padx=(0, 8), pady=6)
        var_note = tk.StringVar(value=edit_event.note if is_edit else "")
        note_entry = ttk.Entry(frm, textvariable=var_note, width=28)
        note_entry.grid(row=4, column=1, columnspan=2, sticky="w", pady=6)
        
        # Buttons
        btn_frame = ttk.Frame(frm, style="TFrame")
        btn_frame.grid(row=5, column=0, columnspan=3, sticky="e", pady=(10, 0))
        
        def do_save():
            # Validate ML - must be positive number
            try:
                ml = float(var_ml.get() or "0")
                if ml < 0:
                    messagebox.showwarning("Invalid", "ML must be a positive number.")
                    return
            except ValueError:
                messagebox.showwarning("Invalid", "ML must be a number.")
                return
            
            # Validate Price - must be positive number
            try:
                price = float(var_price.get() or "0")
                if price < 0:
                    messagebox.showwarning("Invalid", "Price must be a positive number.")
                    return
            except ValueError:
                messagebox.showwarning("Invalid", "Price must be a number.")
                return
            
            date_val = var_date.get().strip()
            # Validate date format if provided
            if date_val:
                try:
                    datetime.strptime(date_val, "%Y-%m-%d")
                except ValueError:
                    messagebox.showwarning("Invalid", "Date must be in YYYY-MM-DD format.")
                    return
            
            if is_edit:
                # Update existing event
                edit_event.purchase_type = var_format.get().strip()
                edit_event.ml_delta = ml if event_type == "buy" else -ml if ml else None
                edit_event.price = price if price else None
                edit_event.note = var_note.get().strip()
                edit_event.event_date = date_val
                self.app.save()
            else:
                self.app._add_event_transaction(
                    self.perfume, event_type, 
                    var_format.get(), ml, price, var_note.get(), date_val
                )
            self._refresh_list()
            win.destroy()
        
        ttk.Button(btn_frame, text="Cancel", command=win.destroy).pack(side="right")
        ttk.Button(btn_frame, text="Save" if is_edit else "Add", command=do_save).pack(side="right", padx=(0, 8))
        
        format_cb.focus_set()
    
    def _edit_selected(self):
        """Edit selected event"""
        selection = self.tree.selection()
        if not selection:
            messagebox.showwarning("Select", "Please select an event to edit.")
            return
        if len(selection) > 1:
            messagebox.showwarning("Select", "Please select only one event to edit.")
            return
        
        event_id = selection[0]
        event = next((e for e in self.perfume.events if e.id == event_id), None)
        if not event:
            return
        
        # Open appropriate dialog based on event type
        if event.event_type in ("smell", "skin"):
            self._add_smell(event.event_type, edit_event=event)
        elif event.event_type in ("buy", "sell"):
            self._add_transaction(event.event_type, edit_event=event)
        else:
            messagebox.showinfo("Info", f"Unknown event type: {event.event_type}")
    
    def _delete_selected(self):
        """Delete selected event"""
        selection = self.tree.selection()
        if not selection:
            messagebox.showwarning("Select", "Please select an event to delete.")
            return
        
        if len(selection) == 1:
            msg = "Delete this event?"
        else:
            msg = f"Delete {len(selection)} events?"
        
        if not messagebox.askyesno("Confirm", msg):
            return
        
        for event_id in selection:
            self.app._delete_event(self.perfume, event_id)
        
        self._refresh_list()


# -----------------------------
# Manage Data Dialog (V2)
# -----------------------------
class ManageDataDialog(tk.Toplevel):
    """Dialog to manage master data: brands, tags, concentrations, outlets."""
    
    def __init__(self, parent, app):
        super().__init__(parent)
        self.title("Manage Data")
        self.configure(bg=COLORS["bg"])
        self.geometry("650x550")
        self.resizable(True, True)
        
        self.app = app
        self.current_tab = "brands"
        self.sort_mode = "name"  # "name", "count", "custom"
        
        self._build_ui()
        self._refresh_list()
    
    def _build_ui(self):
        # Tab buttons
        tab_frame = ttk.Frame(self, style="TFrame")
        tab_frame.pack(fill="x", padx=10, pady=10)
        
        self.tab_buttons = {}
        tabs = [("brands", "Brands"), ("tags", "Tags"), ("outlets", "Locations"),
                ("concentrations", "Concentrations"), ("purchase_types", "Formats")]
        for tab_id, tab_name in tabs:
            btn = tk.Button(tab_frame, text=tab_name, bg=COLORS["panel"], fg=COLORS["text"],
                           command=lambda t=tab_id: self._switch_tab(t))
            btn.pack(side="left", padx=(0, 5))
            self.tab_buttons[tab_id] = btn
        
        # Sort controls
        sort_frame = ttk.Frame(self, style="TFrame")
        sort_frame.pack(fill="x", padx=10, pady=(0, 5))
        
        ttk.Label(sort_frame, text="Sort:", style="Muted.TLabel").pack(side="left")
        self.sort_var = tk.StringVar(value="name")
        for mode, label in [("name", "Name"), ("count", "Count"), ("custom", "Custom")]:
            rb = ttk.Radiobutton(sort_frame, text=label, value=mode, variable=self.sort_var,
                                command=self._on_sort_change)
            rb.pack(side="left", padx=(8, 0))
        
        # List frame with up/down buttons
        main_frame = ttk.Frame(self, style="TFrame")
        main_frame.pack(fill="both", expand=True, padx=10)
        
        # Listbox with scrollbar
        list_frame = ttk.Frame(main_frame, style="TFrame")
        list_frame.pack(side="left", fill="both", expand=True)
        
        self.listbox = tk.Listbox(list_frame, bg=COLORS["panel"], fg=COLORS["text"],
                                  selectmode="extended", height=15,
                                  selectbackground=COLORS["accent"], selectforeground=COLORS["bg"])
        scrollbar = ttk.Scrollbar(list_frame, orient="vertical", command=self.listbox.yview)
        self.listbox.configure(yscrollcommand=scrollbar.set)
        
        self.listbox.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")
        
        # Up/Down buttons for custom sort
        order_frame = ttk.Frame(main_frame, style="TFrame")
        order_frame.pack(side="left", fill="y", padx=(5, 0))
        
        self.up_btn = ttk.Button(order_frame, text="▲", width=3, command=self._move_up)
        self.up_btn.pack(pady=(0, 5))
        self.down_btn = ttk.Button(order_frame, text="▼", width=3, command=self._move_down)
        self.down_btn.pack()
        
        # Count label
        self.count_label = ttk.Label(self, text="", style="Muted.TLabel")
        self.count_label.pack(anchor="w", padx=10, pady=(5, 0))
        
        # Action buttons
        btn_frame = ttk.Frame(self, style="TFrame")
        btn_frame.pack(fill="x", padx=10, pady=10)
        
        ttk.Button(btn_frame, text="Rename", command=self._rename_selected).pack(side="left", padx=(0, 5))
        ttk.Button(btn_frame, text="Merge", command=self._merge_selected).pack(side="left", padx=(0, 5))
        ttk.Button(btn_frame, text="Delete", command=self._delete_selected).pack(side="left", padx=(0, 5))
        ttk.Button(btn_frame, text="Add New", command=self._add_new).pack(side="left")
        
        ttk.Button(btn_frame, text="Close", command=self.destroy).pack(side="right")
        
        self._update_tab_buttons()
        self._update_order_buttons()
    
    def _switch_tab(self, tab_id: str):
        self.current_tab = tab_id
        self._update_tab_buttons()
        self._refresh_list()
    
    def _update_tab_buttons(self):
        for tab_id, btn in self.tab_buttons.items():
            if tab_id == self.current_tab:
                btn.configure(bg=COLORS["accent"], fg=COLORS["bg"])
            else:
                btn.configure(bg=COLORS["panel"], fg=COLORS["text"])
    
    def _on_sort_change(self):
        self.sort_mode = self.sort_var.get()
        self._update_order_buttons()
        self._apply_sort_to_map()  # Reorder the mapping table
        self._refresh_list()
    
    def _update_order_buttons(self):
        """Enable/disable up/down buttons based on sort mode"""
        state = "normal" if self.sort_mode == "custom" else "disabled"
        self.up_btn.config(state=state)
        self.down_btn.config(state=state)
    
    def _apply_sort_to_map(self):
        """Reorder the mapping table based on current sort mode"""
        if self.sort_mode == "custom":
            return  # Don't reorder on custom mode
        
        current_map = self._get_current_map()
        
        # Build items list with name and count
        items = []
        for item_id, item in current_map.items():
            name = self._get_item_name(item_id)
            count = self._count_usage(item_id)
            items.append((item_id, item, name, count))
        
        # Sort based on mode
        if self.sort_mode == "name":
            items.sort(key=lambda x: x[2].lower())
        elif self.sort_mode == "count":
            items.sort(key=lambda x: (-x[3], x[2].lower()))
        
        # Rebuild the mapping dict in new order
        current_map.clear()
        for item_id, item, name, count in items:
            current_map[item_id] = item
        
        self.app.save()
    
    def _get_current_map(self):
        """Get the mapping dict for current tab"""
        if self.current_tab == "brands":
            return self.app.app_data.brands_map
        elif self.current_tab == "tags":
            return self.app.app_data.tags_map
        elif self.current_tab == "concentrations":
            return self.app.app_data.concentrations_map
        elif self.current_tab == "outlets":
            return self.app.app_data.outlets_map
        elif self.current_tab == "purchase_types":
            return self.app.app_data.purchase_types_map
        return {}
    
    def _get_item_name(self, item_id: str) -> str:
        """Get name for item (handles OutletInfo for outlets)"""
        current_map = self._get_current_map()
        item = current_map.get(item_id)
        if self.current_tab == "outlets" and isinstance(item, OutletInfo):
            return f"{item.name}" + (f" ({item.region})" if item.region else "")
        return item if item else ""
    
    def _count_usage(self, item_id: str) -> int:
        """Count how many perfumes/events use this item"""
        count = 0
        if self.current_tab == "brands":
            count = sum(1 for p in self.app.perfumes if p.brand_id == item_id)
        elif self.current_tab == "tags":
            count = sum(1 for p in self.app.perfumes if item_id in p.tag_ids)
        elif self.current_tab == "concentrations":
            count = sum(1 for p in self.app.perfumes if p.concentration_id == item_id)
        elif self.current_tab == "outlets":
            count = sum(1 for p in self.app.perfumes if item_id in p.outlet_ids)
        elif self.current_tab == "purchase_types":
            # Count events using this purchase type
            count = sum(1 for p in self.app.perfumes for e in p.events if e.purchase_type_id == item_id)
        return count
    
    def _refresh_list(self):
        """Refresh list display (uses mapping table order directly)"""
        self.listbox.delete(0, "end")
        current_map = self._get_current_map()
        
        # Display in mapping table order (already sorted by _apply_sort_to_map)
        self.item_ids = []
        for item_id in current_map.keys():
            name = self._get_item_name(item_id)
            count = self._count_usage(item_id)
            display = f"{name} ({count})"
            self.listbox.insert("end", display)
            self.item_ids.append(item_id)
        
        self.count_label.config(text=f"Total: {len(self.item_ids)} items")
    
    def _move_up(self):
        """Move selected item up in custom order"""
        selection = self.listbox.curselection()
        if not selection or selection[0] == 0:
            return
        
        idx = selection[0]
        current_map = self._get_current_map()
        
        # Rebuild dict with swapped order
        items = list(current_map.items())
        items[idx], items[idx-1] = items[idx-1], items[idx]
        
        current_map.clear()
        for k, v in items:
            current_map[k] = v
        
        self._refresh_list()
        self.listbox.selection_set(idx-1)
        self.app.save()
    
    def _move_down(self):
        """Move selected item down in custom order"""
        selection = self.listbox.curselection()
        if not selection or selection[0] >= len(self.item_ids) - 1:
            return
        
        idx = selection[0]
        current_map = self._get_current_map()
        
        # Rebuild dict with swapped order
        items = list(current_map.items())
        items[idx], items[idx+1] = items[idx+1], items[idx]
        
        current_map.clear()
        for k, v in items:
            current_map[k] = v
        
        self._refresh_list()
        self.listbox.selection_set(idx+1)
        self.app.save()
    
    def _rename_selected(self):
        selection = self.listbox.curselection()
        if len(selection) != 1:
            messagebox.showwarning("Select One", "Please select exactly one item to rename.")
            return
        
        idx = selection[0]
        item_id = self.item_ids[idx]
        current_map = self._get_current_map()
        
        if self.current_tab == "outlets":
            # Special handling for outlets (name + region)
            outlet = current_map.get(item_id)
            if not isinstance(outlet, OutletInfo):
                return
            
            new_name = simpledialog.askstring("Rename", f"Enter new name for '{outlet.name}':",
                                              initialvalue=outlet.name, parent=self)
            if not new_name:
                return
            new_name = new_name.strip()
            
            new_region = simpledialog.askstring("Region", f"Enter region (optional):",
                                                initialvalue=outlet.region, parent=self)
            new_region = (new_region or "").strip()
            
            current_map[item_id] = OutletInfo(name=new_name, region=new_region)
            old_display = f"{outlet.name}" + (f" ({outlet.region})" if outlet.region else "")
            new_display = f"{new_name}" + (f" ({new_region})" if new_region else "")
        else:
            old_name = current_map.get(item_id, "")
            new_name = simpledialog.askstring("Rename", f"Enter new name for '{old_name}':",
                                              initialvalue=old_name, parent=self)
            if not new_name or new_name.strip() == old_name:
                return
            new_name = new_name.strip()
            current_map[item_id] = new_name
            old_display = old_name
            new_display = new_name
        
        self.app.save()
        self._refresh_list()
        self.app._refresh_list()
        
        messagebox.showinfo("Renamed", f"'{old_display}' → '{new_display}'")
    
    def _merge_selected(self):
        selection = self.listbox.curselection()
        if len(selection) < 2:
            messagebox.showwarning("Select Multiple", "Please select 2 or more items to merge.")
            return
        
        selected_ids = [self.item_ids[i] for i in selection]
        current_map = self._get_current_map()
        selected_names = [self._get_item_name(sid) for sid in selected_ids]
        
        # Ask which name to keep
        keep_name = simpledialog.askstring("Merge", 
            f"Merging: {', '.join(selected_names)}\n\nEnter the name to keep:",
            initialvalue=selected_names[0], parent=self)
        if not keep_name:
            return
        
        keep_name = keep_name.strip()
        
        # Find or create the target ID
        target_id = selected_ids[0]
        if self.current_tab == "outlets":
            current_map[target_id] = OutletInfo(name=keep_name, region="")
        else:
            current_map[target_id] = keep_name
        
        # Update all perfumes to use target_id
        for sid in selected_ids:
            if sid == target_id:
                continue
            
            if self.current_tab == "brands":
                for p in self.app.perfumes:
                    if p.brand_id == sid:
                        p.brand_id = target_id
            elif self.current_tab == "tags":
                for p in self.app.perfumes:
                    if sid in p.tag_ids:
                        p.tag_ids = [target_id if tid == sid else tid for tid in p.tag_ids]
                        p.tag_ids = list(dict.fromkeys(p.tag_ids))
            elif self.current_tab == "concentrations":
                for p in self.app.perfumes:
                    if p.concentration_id == sid:
                        p.concentration_id = target_id
            elif self.current_tab == "outlets":
                for p in self.app.perfumes:
                    if sid in p.outlet_ids:
                        p.outlet_ids = [target_id if oid == sid else oid for oid in p.outlet_ids]
                        p.outlet_ids = list(dict.fromkeys(p.outlet_ids))
            elif self.current_tab == "purchase_types":
                for p in self.app.perfumes:
                    for e in p.events:
                        if e.purchase_type_id == sid:
                            e.purchase_type_id = target_id
            
            del current_map[sid]
        
        self.app.save()
        self._refresh_list()
        self.app._refresh_list()
        
        messagebox.showinfo("Merged", f"Merged {len(selected_ids)} items into '{keep_name}'.")
    
    def _delete_selected(self):
        selection = self.listbox.curselection()
        if not selection:
            messagebox.showwarning("Select", "Please select items to delete.")
            return
        
        selected_ids = [self.item_ids[i] for i in selection]
        current_map = self._get_current_map()
        
        used_items = []
        unused_items = []
        for sid in selected_ids:
            usage = self._count_usage(sid)
            name = self._get_item_name(sid)
            if usage > 0:
                used_items.append(f"{name} ({usage})")
            else:
                unused_items.append(name)
        
        if used_items:
            messagebox.showwarning("Cannot Delete", 
                f"Still in use:\n\n" + "\n".join(used_items))
            return
        
        if not unused_items:
            return
        
        if not messagebox.askyesno("Confirm Delete", 
            f"Delete {len(unused_items)} items?\n\n" + "\n".join(unused_items)):
            return
        
        for sid in selected_ids:
            if self._count_usage(sid) == 0:
                del current_map[sid]
        
        self.app.save()
        self._refresh_list()
    
    def _add_new(self):
        if self.current_tab == "outlets":
            name = simpledialog.askstring("Add Outlet", "Enter outlet name:", parent=self)
            if not name:
                return
            name = name.strip()
            region = simpledialog.askstring("Region", "Enter region (optional):", parent=self)
            region = (region or "").strip()
            
            item_id = new_id()
            self.app.app_data.outlets_map[item_id] = OutletInfo(name=name, region=region)
        else:
            name = simpledialog.askstring("Add New", f"Enter new {self.current_tab[:-1]} name:", parent=self)
            if not name:
                return
            name = name.strip()
            
            current_map = self._get_current_map()
            if name in current_map.values():
                messagebox.showwarning("Exists", f"'{name}' already exists.")
                return
            
            item_id = new_id()
            current_map[item_id] = name
        
        self.app.save()
        self._refresh_list()


class FilterDialog(tk.Toplevel):
    """Filter configuration dialog with checkboxes and sliders"""
    
    def __init__(self, parent, current_config: FilterConfig, perfumes: List[Perfume], expanded_state: Dict[str, bool], on_apply, app=None):
        super().__init__(parent)
        self.title("Filter Configuration")
        self.configure(bg=COLORS["bg"])
        self.geometry("600x700")
        
        self.current_config = current_config
        self.perfumes = perfumes
        self.expanded_state = expanded_state  # Persist expand/collapse state
        self.on_apply = on_apply
        self.app = app  # V2: App reference for ID lookups
        self.result = None
        
        # Variables
        self.brands_selected = list(current_config.brands)  # Pool mode
        self.vars_states = {}
        self.vars_seasons = {}
        self.vars_times = {}
        # Score ranges
        self.var_rating_min = tk.DoubleVar(value=current_config.rating_min)
        self.var_rating_max = tk.DoubleVar(value=current_config.rating_max)
        self.var_rating_exclude = tk.BooleanVar(value=current_config.rating_exclude)
        self.var_longevity_min = tk.DoubleVar(value=current_config.longevity_min)
        self.var_longevity_max = tk.DoubleVar(value=current_config.longevity_max)
        self.var_longevity_exclude = tk.BooleanVar(value=current_config.longevity_exclude)
        self.var_sillage_min = tk.DoubleVar(value=current_config.sillage_min)
        self.var_sillage_max = tk.DoubleVar(value=current_config.sillage_max)
        self.var_sillage_exclude = tk.BooleanVar(value=current_config.sillage_exclude)
        self.var_value_min = tk.DoubleVar(value=current_config.value_min)
        self.var_value_max = tk.DoubleVar(value=current_config.value_max)
        self.var_value_exclude = tk.BooleanVar(value=current_config.value_exclude)
        self.vars_genders = {}  # Changed to dict of BooleanVars for multi-select
        self.var_tags_logic = tk.StringVar(value=current_config.tags_logic)
        self.var_has_my_vote = tk.BooleanVar(value=current_config.has_my_vote)
        self.var_has_fragrantica = tk.BooleanVar(value=current_config.has_fragrantica)
        self.tags_selected = list(current_config.tags)
        
        self._build_ui()
        self._update_result_count()
    
    def _build_ui(self):
        # Main scrollable canvas
        main_canvas = tk.Canvas(self, bg=COLORS["bg"], highlightthickness=0)
        scrollbar = ttk.Scrollbar(self, orient="vertical", command=main_canvas.yview)
        main_canvas.configure(yscrollcommand=scrollbar.set)
        
        main_canvas.pack(side="left", fill="both", expand=True, padx=(20, 0), pady=20)
        scrollbar.pack(side="right", fill="y", padx=(0, 20), pady=20)
        
        content = ttk.Frame(main_canvas, style="TFrame")
        canvas_window = main_canvas.create_window((0, 0), window=content, anchor="nw")
        
        # Update content frame width when canvas resizes
        def on_canvas_configure(event):
            canvas_width = event.width
            main_canvas.itemconfig(canvas_window, width=canvas_width)
        
        main_canvas.bind("<Configure>", on_canvas_configure)
        content.bind("<Configure>", lambda e: main_canvas.configure(scrollregion=main_canvas.bbox("all")))
        
        # Mouse wheel scrolling (prevent over-scrolling)
        def on_mousewheel(event):
            try:
                if not main_canvas.winfo_exists():
                    return
                bbox = main_canvas.bbox("all")
                if not bbox:
                    return
                content_height = bbox[3] - bbox[1]
                canvas_height = main_canvas.winfo_height()
                if content_height <= canvas_height:
                    main_canvas.yview_moveto(0)
                    return
                main_canvas.yview_scroll(int(-1 * (event.delta / 120)), "units")
            except tk.TclError:
                pass  # Widget was destroyed
        
        main_canvas.bind("<Enter>", lambda e: main_canvas.bind_all("<MouseWheel>", on_mousewheel))
        main_canvas.bind("<Leave>", lambda e: main_canvas.unbind_all("<MouseWheel>"))
        
        # Title (with right padding for scrollbar)
        ttk.Label(content, text="Filter Configuration", style="TLabel", font=("TkDefaultFont", 12, "bold")).pack(
            anchor="w", pady=(0, 8), padx=(0, 20)
        )
        
        # Currently Active section (fixed height, with right padding)
        active_section = ttk.Frame(content, style="Panel.TFrame")
        active_section.pack(fill="x", pady=(0, 16), padx=(0, 20))
        
        ttk.Label(active_section, text="📌 Currently Active", style="Panel.TLabel", 
                 font=("TkDefaultFont", 10, "bold")).pack(anchor="w", padx=8, pady=(8, 4))
        
        # Display current active filters
        active_text_frame = tk.Text(active_section, height=6, bg=COLORS["panel"], fg=COLORS["text"],
                                    highlightthickness=1, highlightbackground=COLORS["accent"],
                                    wrap="word", padx=8, pady=4)
        active_text_frame.pack(fill="x", padx=8, pady=(0, 8))
        
        active_filters_text = self._get_active_filters_text()
        active_text_frame.insert("1.0", active_filters_text if active_filters_text else "(No active filters)")
        active_text_frame.config(state="disabled")  # Read-only
        
        # Clear button
        ttk.Button(active_section, text="Clear Active", command=self._clear_all).pack(pady=(0, 8))
        
        # Brands
        self._create_collapsible_section(content, "Brands", "brands", self._create_brands_section)
        
        # States
        self._create_collapsible_section(content, "States", "states", self._create_states_section)
        
        # When to Wear
        self._create_collapsible_section(content, "When to Wear", "when", self._create_when_section)
        
        # Scores
        self._create_collapsible_section(content, "Scores & Values", "scores", self._create_scores_section)
        
        # Gender
        self._create_collapsible_section(content, "Gender Preference", "gender", self._create_gender_section)
        
        # Tags
        self._create_collapsible_section(content, "Tags", "tags", self._create_tags_section)
        
        # Vote status
        self._create_collapsible_section(content, "Vote Status", "vote_status", self._create_vote_status_section)
        
        # Result count (with right padding)
        self.result_label = ttk.Label(content, text="Result: Calculating...", style="TLabel", 
                                     font=("TkDefaultFont", 10, "bold"))
        self.result_label.pack(anchor="w", pady=(16, 0), padx=(0, 20))
        
        # Buttons (with right padding)
        btns = ttk.Frame(content, style="TFrame")
        btns.pack(anchor="e", pady=(16, 0), padx=(0, 20))
        
        ttk.Button(btns, text="Cancel", command=self.destroy).pack(side="left", padx=(0, 8))
        ttk.Button(btns, text="Apply", command=self._apply).pack(side="left")
    
    def _create_collapsible_section(self, parent, title, section_key, content_func):
        """Create a collapsible section with persistent expand/collapse state"""
        frame = ttk.Frame(parent, style="Panel.TFrame")
        frame.pack(fill="x", pady=(0, 12), padx=(0, 20))
        
        # Get initial expanded state from persistent storage
        initial_expanded = self.expanded_state.get(section_key, False)
        var_expanded = tk.BooleanVar(value=initial_expanded)
        
        title_frame = ttk.Frame(frame, style="Panel.TFrame")
        title_frame.pack(fill="x", padx=8, pady=6)
        
        symbol_label = ttk.Label(title_frame, text="−" if initial_expanded else "＋", 
                                style="Panel.TLabel", width=2)
        symbol_label.pack(side="left")
        
        title_label = ttk.Label(title_frame, text=title, style="Panel.TLabel", font=("TkDefaultFont", 10, "bold"))
        title_label.pack(side="left", padx=(4, 0))
        
        content_frame = ttk.Frame(frame, style="Panel.TFrame")
        
        def toggle():
            expanded = var_expanded.get()
            var_expanded.set(not expanded)
            symbol_label.config(text="−" if not expanded else "＋")
            # Update persistent state
            self.expanded_state[section_key] = not expanded
            if not expanded:
                content_frame.pack(fill="x", padx=16, pady=(0, 8))
            else:
                content_frame.pack_forget()
        
        title_frame.bind("<Button-1>", lambda e: toggle())
        symbol_label.bind("<Button-1>", lambda e: toggle())
        title_label.bind("<Button-1>", lambda e: toggle())
        
        # Create content
        content_func(content_frame)
        
        # Show content if initially expanded
        if initial_expanded:
            content_frame.pack(fill="x", padx=16, pady=(0, 8))
    
    def _get_active_filters_text(self) -> str:
        """Generate text description of currently active filters"""
        lines = []
        
        if self.current_config.brands:
            lines.append(f"• Brands: {', '.join(self.current_config.brands)}")
        
        if self.current_config.states:
            states_display = [s.capitalize() for s in self.current_config.states]
            lines.append(f"• States: {', '.join(states_display)}")
        
        when_parts = []
        if self.current_config.seasons:
            when_parts.append(f"Seasons: {', '.join(self.current_config.seasons)}")
        if self.current_config.times:
            when_parts.append(f"Times: {', '.join(self.current_config.times)}")
        if when_parts:
            lines.append(f"• When to Wear: {' | '.join(when_parts)}")
        
        # Score range filters (show when min > 0 OR max < max_value OR exclude)
        def format_score_filter(name, min_val, max_val, exclude, default_max):
            if min_val > 0 or max_val < default_max or exclude:
                mode = "Exclude" if exclude else "Include"
                return f"• {name}: {min_val:.1f} ~ {max_val:.1f} ({mode})"
            return None
        
        rating_line = format_score_filter("Rating", self.current_config.rating_min, 
                                         self.current_config.rating_max, self.current_config.rating_exclude, 5.0)
        if rating_line:
            lines.append(rating_line)
        
        longevity_line = format_score_filter("Longevity", self.current_config.longevity_min,
                                            self.current_config.longevity_max, self.current_config.longevity_exclude, 5.0)
        if longevity_line:
            lines.append(longevity_line)
        
        sillage_line = format_score_filter("Sillage", self.current_config.sillage_min,
                                          self.current_config.sillage_max, self.current_config.sillage_exclude, 4.0)
        if sillage_line:
            lines.append(sillage_line)
        
        value_line = format_score_filter("Price Value", self.current_config.value_min,
                                        self.current_config.value_max, self.current_config.value_exclude, 5.0)
        if value_line:
            lines.append(value_line)
        
        if self.current_config.gender_preference:
            gender_labels = [display_label(g) for g in self.current_config.gender_preference]
            lines.append(f"• Gender: {', '.join(gender_labels)}")
        
        if self.current_config.tags:
            logic = "Match Any" if self.current_config.tags_logic == "or" else "Match All"
            lines.append(f"• Tags ({logic}): {', '.join(self.current_config.tags)}")
        
        if self.current_config.has_my_vote:
            lines.append("• Perfumes I've voted on")
        if self.current_config.has_fragrantica:
            lines.append("• Perfumes with Fragrantica data")
        
        return "\n".join(lines)
    
    def _create_brands_section(self, parent):
        """Create brands pool with Listbox (double-click to remove)"""
        if self.app:
            all_brands = self.app.get_all_brand_names()
        else:
            all_brands = []
        
        # Listbox with scrollbar for selected brands
        listbox_frame = ttk.Frame(parent, style="Panel.TFrame")
        listbox_frame.pack(fill="x", pady=(0, 4))
        
        scrollbar = ttk.Scrollbar(listbox_frame, orient="vertical")
        self.brands_listbox = tk.Listbox(listbox_frame, height=4, yscrollcommand=scrollbar.set)
        scrollbar.config(command=self.brands_listbox.yview)
        
        self.brands_listbox.pack(side="left", fill="x", expand=True)
        scrollbar.pack(side="right", fill="y")
        
        self._refresh_brands_listbox()
        
        def remove_brand(event):
            sel = self.brands_listbox.curselection()
            if sel:
                self.brands_selected.pop(sel[0])
                self._refresh_brands_listbox()
                self._update_result_count()
        
        self.brands_listbox.bind("<Double-1>", remove_brand)
        
        # Add brand
        add_frame = ttk.Frame(parent, style="Panel.TFrame")
        add_frame.pack(fill="x")
        
        var_new_brand = tk.StringVar()
        brand_cb = ttk.Combobox(add_frame, textvariable=var_new_brand, width=25)
        brand_cb["values"] = all_brands
        if self.app:
            make_combobox_searchable(brand_cb, all_brands)
        brand_cb.pack(side="left", padx=(0, 8))
        
        def add_brand():
            brand = var_new_brand.get().strip()
            # Only allow existing brands (no creating new ones in Filter)
            if brand and brand in all_brands and brand not in self.brands_selected:
                self.brands_selected.append(brand)
                self._refresh_brands_listbox()
                var_new_brand.set("")
                self._update_result_count()
        
        ttk.Button(add_frame, text="Add", command=add_brand).pack(side="left")
        brand_cb.bind("<Return>", lambda e: add_brand())
    
    def _refresh_brands_listbox(self):
        """Refresh brands listbox"""
        self.brands_listbox.delete(0, "end")
        if not self.brands_selected:
            self.brands_listbox.insert("end", "(All brands - double-click to remove)")
        else:
            for brand in self.brands_selected:
                self.brands_listbox.insert("end", brand)
    
    def _create_states_section(self, parent):
        """Create states checkboxes with flow layout"""
        states = [("owned", "Owned"), ("tested", "Tested"), ("wishlist", "Wishlist")]
        
        # Batch buttons (smaller padding)
        btns = ttk.Frame(parent, style="Panel.TFrame")
        btns.pack(anchor="w", pady=(0, 8))
        ttk.Button(btns, text="Select All", style="Small.TButton", command=lambda: self._toggle_all(self.vars_states, True)).pack(side="left", padx=(0, 4))
        ttk.Button(btns, text="Deselect All", style="Small.TButton", command=lambda: self._toggle_all(self.vars_states, False)).pack(side="left")
        
        # Flow layout
        flow_container = ttk.Frame(parent, style="Panel.TFrame")
        flow_container.pack(fill="x")
        
        widgets_data = []
        for state_key, state_label in states:
            var = tk.BooleanVar(value=state_key in self.current_config.states)
            self.vars_states[state_key] = var
            widgets_data.append({
                'type': 'checkbutton',
                'text': state_label,
                'variable': var,
                'command': self._update_result_count
            })
        
        self._create_single_row_layout(flow_container, widgets_data)  # States: single row
    
    def _create_when_section(self, parent):
        """Create When to Wear checkboxes"""
        # Seasons
        ttk.Label(parent, text="Seasons:", style="Panel.TLabel").pack(anchor="w", pady=(0, 4))
        seasons = ["spring", "summer", "fall", "winter"]
        season_frame = ttk.Frame(parent, style="Panel.TFrame")
        season_frame.pack(fill="x", pady=(0, 8))
        
        season_widgets_data = []
        for season in seasons:
            var = tk.BooleanVar(value=season in self.current_config.seasons)
            self.vars_seasons[season] = var
            season_widgets_data.append({
                'type': 'checkbutton',
                'text': display_label(season),
                'variable': var,
                'command': self._update_result_count
            })
        
        self._create_single_row_layout(season_frame, season_widgets_data)
        
        # Times
        ttk.Label(parent, text="Times:", style="Panel.TLabel").pack(anchor="w", pady=(0, 4))
        times = ["day", "night"]
        time_frame = ttk.Frame(parent, style="Panel.TFrame")
        time_frame.pack(fill="x")
        
        time_widgets_data = []
        for time in times:
            var = tk.BooleanVar(value=time in self.current_config.times)
            self.vars_times[time] = var
            time_widgets_data.append({
                'type': 'checkbutton',
                'text': display_label(time),
                'variable': var,
                'command': self._update_result_count
            })
        
        self._create_single_row_layout(time_frame, time_widgets_data)
        
        # Batch buttons (smaller padding)
        btns = ttk.Frame(parent, style="Panel.TFrame")
        btns.pack(anchor="w", pady=(8, 0))
        ttk.Button(btns, text="Select All", style="Small.TButton", command=lambda: (self._toggle_all(self.vars_seasons, True), 
                                                       self._toggle_all(self.vars_times, True))).pack(side="left", padx=(0, 4))
        ttk.Button(btns, text="Clear", style="Small.TButton", command=lambda: (self._toggle_all(self.vars_seasons, False), 
                                                       self._toggle_all(self.vars_times, False))).pack(side="left")
    
    def _create_scores_section(self, parent):
        """Create score range sliders with dual handles and include/exclude option"""
        scores = [
            ("Rating", self.var_rating_min, self.var_rating_max, self.var_rating_exclude, 0, 5),
            ("Longevity", self.var_longevity_min, self.var_longevity_max, self.var_longevity_exclude, 0, 5),
            ("Sillage", self.var_sillage_min, self.var_sillage_max, self.var_sillage_exclude, 0, 4),
            ("Price Value", self.var_value_min, self.var_value_max, self.var_value_exclude, 0, 5),
        ]
        
        # Store label references for updates
        self.score_labels = {}
        
        for label, var_min, var_max, var_exclude, range_min, range_max in scores:
            frame = ttk.Frame(parent, style="Panel.TFrame")
            frame.pack(fill="x", pady=4)
            
            # Row 1: Label and Exclude checkbox
            row1 = ttk.Frame(frame, style="Panel.TFrame")
            row1.pack(fill="x")
            
            ttk.Label(row1, text=f"{label}:", style="Panel.TLabel", width=12).pack(side="left")
            ttk.Checkbutton(row1, text="Exclude", variable=var_exclude,
                           command=self._update_result_count).pack(side="left", padx=(0, 8))
            
            # Value labels
            min_label = ttk.Label(row1, text=f"{var_min.get():.1f}", style="Panel.TLabel", width=4)
            min_label.pack(side="left")
            ttk.Label(row1, text="~", style="Panel.TLabel").pack(side="left", padx=4)
            max_label = ttk.Label(row1, text=f"{var_max.get():.1f}", style="Panel.TLabel", width=4)
            max_label.pack(side="left")
            
            self.score_labels[label] = (min_label, max_label)
            
            # Row 2: Range slider
            def make_update_callback(lbl, min_lbl, max_lbl, v_min, v_max):
                def callback():
                    min_lbl.config(text=f"{v_min.get():.1f}")
                    max_lbl.config(text=f"{v_max.get():.1f}")
                    self._update_result_count()
                return callback
            
            slider = RangeSlider(frame, from_=range_min, to=range_max, 
                               var_min=var_min, var_max=var_max,
                               width=250, height=24, bg=COLORS["panel"],
                               on_change=make_update_callback(label, min_label, max_label, var_min, var_max))
            slider.pack(fill="x", padx=(0, 10), pady=(2, 0))
    
    def _create_gender_section(self, parent):
        """Create gender checkboxes with flow layout (multi-select)"""
        # Reversed order: best/most masculine on top (consistent with other blocks)
        genders = [
            ("male", "Male"),
            ("more_male", "More Male"),
            ("unisex", "Unisex"),
            ("more_female", "More Female"),
            ("female", "Female"),
        ]
        
        # Batch buttons
        btns = ttk.Frame(parent, style="Panel.TFrame")
        btns.pack(anchor="w", pady=(0, 8))
        ttk.Button(btns, text="Select All", style="Small.TButton", 
                  command=lambda: self._toggle_all(self.vars_genders, True)).pack(side="left", padx=(0, 4))
        ttk.Button(btns, text="Deselect All", style="Small.TButton", 
                  command=lambda: self._toggle_all(self.vars_genders, False)).pack(side="left")
        
        # Flow layout
        flow_container = ttk.Frame(parent, style="Panel.TFrame")
        flow_container.pack(fill="x")
        
        widgets_data = []
        for val, label in genders:
            var = tk.BooleanVar(value=val in self.current_config.gender_preference)
            self.vars_genders[val] = var
            widgets_data.append({
                'type': 'checkbutton',
                'text': label,
                'variable': var,
                'command': self._update_result_count
            })
        
        self._create_single_row_layout(flow_container, widgets_data)  # Gender: single row
    
    def _create_tags_section(self, parent):
        """Create tags pool with Listbox (double-click to remove)"""
        if self.app:
            all_tags = self.app.get_all_tag_names()
        else:
            all_tags = []
        
        # Listbox with scrollbar for selected tags
        listbox_frame = ttk.Frame(parent, style="Panel.TFrame")
        listbox_frame.pack(fill="x", pady=(0, 4))
        
        scrollbar = ttk.Scrollbar(listbox_frame, orient="vertical")
        self.tags_listbox = tk.Listbox(listbox_frame, height=3, yscrollcommand=scrollbar.set)
        scrollbar.config(command=self.tags_listbox.yview)
        
        self.tags_listbox.pack(side="left", fill="x", expand=True)
        scrollbar.pack(side="right", fill="y")
        
        self._refresh_tags_listbox()
        
        def remove_tag(event):
            sel = self.tags_listbox.curselection()
            if sel:
                self.tags_selected.pop(sel[0])
                self._refresh_tags_listbox()
                self._update_result_count()
        
        self.tags_listbox.bind("<Double-1>", remove_tag)
        
        # Add tag with Combobox
        add_frame = ttk.Frame(parent, style="Panel.TFrame")
        add_frame.pack(fill="x")
        
        var_new_tag = tk.StringVar()
        tag_cb = ttk.Combobox(add_frame, textvariable=var_new_tag, width=25)
        tag_cb["values"] = all_tags
        if self.app:
            make_combobox_searchable(tag_cb, all_tags)
        tag_cb.pack(side="left", padx=(0, 8))
        
        def add_tag():
            tag = var_new_tag.get().strip()
            # Only allow existing tags (no creating new ones in Filter)
            if tag and tag in all_tags and tag not in self.tags_selected:
                self.tags_selected.append(tag)
                self._refresh_tags_listbox()
                var_new_tag.set("")
                self._update_result_count()
        
        ttk.Button(add_frame, text="Add", command=add_tag).pack(side="left")
        tag_cb.bind("<Return>", lambda e: add_tag())
        
        # Logic - radio buttons in one row
        logic_container = ttk.Frame(parent, style="Panel.TFrame")
        logic_container.pack(fill="x", pady=(8, 0))
        
        ttk.Label(logic_container, text="Logic:", style="Panel.TLabel").pack(side="left", padx=(0, 8))
        ttk.Radiobutton(logic_container, text="Match Any (OR)", variable=self.var_tags_logic, value="or", 
                      command=self._update_result_count).pack(side="left", padx=(0, 12))
        ttk.Radiobutton(logic_container, text="Match All (AND)", variable=self.var_tags_logic, value="and", 
                      command=self._update_result_count).pack(side="left")
    
    def _refresh_tags_listbox(self):
        """Refresh tags listbox"""
        self.tags_listbox.delete(0, "end")
        if not self.tags_selected:
            self.tags_listbox.insert("end", "(All tags - double-click to remove)")
        else:
            for tag in self.tags_selected:
                self.tags_listbox.insert("end", tag)
    
    def _create_vote_status_section(self, parent):
        """Create vote status checkboxes in a single row"""
        status_frame = ttk.Frame(parent, style="Panel.TFrame")
        status_frame.pack(fill="x")
        
        widgets_data = [
            {
                'type': 'checkbutton',
                'text': "Perfumes I've voted on",
                'variable': self.var_has_my_vote,
                'command': self._update_result_count
            },
            {
                'type': 'checkbutton',
                'text': "Perfumes with Fragrantica data",
                'variable': self.var_has_fragrantica,
                'command': self._update_result_count
            }
        ]
        
        self._create_single_row_layout(status_frame, widgets_data)
    
    def _create_single_row_layout(self, container, widgets_data):
        """Create a single row layout with equal width distribution"""
        # Configure columns to have equal weight
        num_items = len(widgets_data)
        for i in range(num_items):
            container.columnconfigure(i, weight=1, uniform="equal")
        
        # Create widgets in a single row
        for idx, data in enumerate(widgets_data):
            if data['type'] == 'checkbutton':
                widget = ttk.Checkbutton(container, text=data['text'], 
                                        variable=data['variable'], 
                                        command=data['command'])
            elif data['type'] == 'radiobutton':
                widget = ttk.Radiobutton(container, text=data['text'],
                                        variable=data['variable'],
                                        value=data['value'],
                                        command=data['command'])
            # sticky="ew" makes widget fill the entire column width
            widget.grid(row=0, column=idx, sticky="ew", padx=4)
    
    def _create_grid_layout(self, container, widgets_data, cols=3):
        """Create a multi-row grid layout for many items"""
        for idx, data in enumerate(widgets_data):
            if data['type'] == 'checkbutton':
                widget = ttk.Checkbutton(container, text=data['text'], 
                                        variable=data['variable'], 
                                        command=data['command'])
            elif data['type'] == 'radiobutton':
                widget = ttk.Radiobutton(container, text=data['text'],
                                        variable=data['variable'],
                                        value=data['value'],
                                        command=data['command'])
            widget.grid(row=idx//cols, column=idx%cols, sticky="w", padx=(0, 8), pady=2)
    
    def _toggle_all(self, vars_dict, state):
        """Toggle all checkboxes in a dict (True/False/None for flip)"""
        for var in vars_dict.values():
            if state is None:
                var.set(not var.get())
            else:
                var.set(state)
        self._update_result_count()
    
    def _update_result_count(self):
        """Update result count label"""
        config = self._build_config()
        count = self._count_matches(config)
        self.result_label.config(text=f"Result: {count} / {len(self.perfumes)} perfumes match")
    
    def _build_config(self) -> FilterConfig:
        """Build filter config from current UI state"""
        return FilterConfig(
            brands=list(self.brands_selected),
            states=[s for s, v in self.vars_states.items() if v.get()],
            seasons=[s for s, v in self.vars_seasons.items() if v.get()],
            times=[t for t, v in self.vars_times.items() if v.get()],
            rating_min=self.var_rating_min.get(),
            rating_max=self.var_rating_max.get(),
            rating_exclude=self.var_rating_exclude.get(),
            longevity_min=self.var_longevity_min.get(),
            longevity_max=self.var_longevity_max.get(),
            longevity_exclude=self.var_longevity_exclude.get(),
            sillage_min=self.var_sillage_min.get(),
            sillage_max=self.var_sillage_max.get(),
            sillage_exclude=self.var_sillage_exclude.get(),
            value_min=self.var_value_min.get(),
            value_max=self.var_value_max.get(),
            value_exclude=self.var_value_exclude.get(),
            gender_preference=[g for g, v in self.vars_genders.items() if v.get()],
            tags=list(self.tags_selected),
            tags_logic=self.var_tags_logic.get(),
            has_my_vote=self.var_has_my_vote.get(),
            has_fragrantica=self.var_has_fragrantica.get(),
        )
    
    def _count_matches(self, config: FilterConfig) -> int:
        """Count how many perfumes match the filter"""
        count = 0
        for p in self.perfumes:
            if self._matches_filter(p, config):
                count += 1
        return count
    
    def _matches_filter(self, p: Perfume, config: FilterConfig) -> bool:
        """Check if perfume matches filter"""
        # Brands (V2: use app's brand lookup)
        if config.brands:
            brand_name = self.app.get_brand_name(p.brand_id) if self.app else ""
            if brand_name not in config.brands:
                return False
        
        # States
        if config.states:
            tag_names = [self.app.get_tag_name(tid) for tid in p.tag_ids] if self.app else []
            state, owned_ml = derive_state(p, tag_names)
            matches_state = False
            if "owned" in config.states and owned_ml > 0:
                matches_state = True
            if "tested" in config.states and "Tested" in state:
                matches_state = True
            if "wishlist" in config.states and state == "Wishlist":
                matches_state = True
            if not matches_state:
                return False
        
        # Seasons/Times
        if config.seasons or config.times:
            fr_votes = (p.fragrantica or {}).get("season_time_votes", {})
            my_votes = (p.my_votes or {}).get("my_season_time_votes", {})
            
            check_items = config.seasons + config.times
            matches_when = False
            for item in check_items:
                fr_val = int(fr_votes.get(item, 0) or 0)
                my_val = int(my_votes.get(item, 0) or 0)
                if fr_val >= 10 or my_val > 0:
                    matches_when = True
                    break
            if not matches_when:
                return False
        
        # Rating (range with include/exclude)
        if config.rating_min > 0 or config.rating_max < 5.0 or config.rating_exclude:
            fr = (p.fragrantica or {}).get("rating_votes", {})
            score = calculate_rating_score(fr, RATING_5)
            in_range = config.rating_min <= score <= config.rating_max
            if config.rating_exclude:
                if in_range:
                    return False
            else:
                if not in_range:
                    return False
        
        # Longevity (range with include/exclude)
        if config.longevity_min > 0 or config.longevity_max < 5.0 or config.longevity_exclude:
            fr = (p.fragrantica or {}).get("longevity_votes", {})
            score = calculate_longevity_score(fr, LONGEVITY_5)
            in_range = config.longevity_min <= score <= config.longevity_max
            if config.longevity_exclude:
                if in_range:
                    return False
            else:
                if not in_range:
                    return False
        
        # Sillage (range with include/exclude)
        if config.sillage_min > 0 or config.sillage_max < 4.0 or config.sillage_exclude:
            fr = (p.fragrantica or {}).get("sillage_votes", {})
            score = calculate_sillage_score(fr, SILLAGE_4)
            in_range = config.sillage_min <= score <= config.sillage_max
            if config.sillage_exclude:
                if in_range:
                    return False
            else:
                if not in_range:
                    return False
        
        # Value (range with include/exclude)
        if config.value_min > 0 or config.value_max < 5.0 or config.value_exclude:
            fr = (p.fragrantica or {}).get("value_votes", {})
            score = calculate_value_score(fr, VALUE_5)
            in_range = config.value_min <= score <= config.value_max
            if config.value_exclude:
                if in_range:
                    return False
            else:
                if not in_range:
                    return False
        
        # Gender (multi-select)
        if config.gender_preference:
            fr = (p.fragrantica or {}).get("gender_votes", {})
            my = (p.my_votes or {}).get("my_gender_votes", {})
            matches_any_gender = False
            for gender in config.gender_preference:
                if int(fr.get(gender, 0) or 0) >= 10 or int(my.get(gender, 0) or 0) > 0:
                    matches_any_gender = True
                    break
            if not matches_any_gender:
                return False
        
        # Tags (V2: use tag_ids)
        if config.tags:
            p_tags = set(self.app.get_tag_name(tid) for tid in p.tag_ids) if self.app else set()
            config_tags = set(config.tags)
            if config.tags_logic == "and":
                if not config_tags.issubset(p_tags):
                    return False
            else:  # or
                if not config_tags.intersection(p_tags):
                    return False
        
        # Vote status
        if config.has_my_vote:
            if not p.my_votes or not any(p.my_votes.values()):
                return False
        
        if config.has_fragrantica:
            if not p.fragrantica or not any(p.fragrantica.values()):
                return False
        
        return True
    
    def _clear_all(self):
        """Clear all filters"""
        self.brands_selected = []
        self._refresh_brands_listbox()
        for var in self.vars_states.values():
            var.set(False)
        for var in self.vars_seasons.values():
            var.set(False)
        for var in self.vars_times.values():
            var.set(False)
        # Reset score ranges
        self.var_rating_min.set(0.0)
        self.var_rating_max.set(5.0)
        self.var_rating_exclude.set(False)
        self.var_longevity_min.set(0.0)
        self.var_longevity_max.set(5.0)
        self.var_longevity_exclude.set(False)
        self.var_sillage_min.set(0.0)
        self.var_sillage_max.set(4.0)
        self.var_sillage_exclude.set(False)
        self.var_value_min.set(0.0)
        self.var_value_max.set(5.0)
        self.var_value_exclude.set(False)
        for var in self.vars_genders.values():
            var.set(False)
        self.tags_selected = []
        self._refresh_tags_listbox()
        self.var_tags_logic.set("or")
        self.var_has_my_vote.set(False)
        self.var_has_fragrantica.set(False)
        self._update_result_count()
    
    def _apply(self):
        """Apply and close"""
        self.result = self._build_config()
        if self.on_apply:
            self.on_apply(self.result)
        self.destroy()


# -----------------------------
# Main App
# -----------------------------
class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Perfume Tracker (tkinter prototype)")
        self.geometry("1200x720")
        self.configure(bg=COLORS["bg"])

        # Fix paste on Windows - ensure Ctrl+V triggers <<Paste>>
        self.event_add("<<Paste>>", "<Control-v>", "<Control-V>")
        
        # V2: Load app data with mapping tables
        self.app_data: AppData = load_app_data()
        self.perfumes: List[Perfume] = self.app_data.perfumes  # Alias for compatibility
        self.filtered_ids: List[str] = []
        
        # Persistent expand/collapse state
        self.expanded_sections = {
            "rating_votes": False,
            "season_time_votes": False,
            "longevity_votes": False,
            "sillage_votes": False,
            "gender_votes": False,
            "value_votes": False,
        }
        
        # Sort & Filter configurations
        self.sort_config = SortConfig()
        self.filter_config = FilterConfig()
        
        # Filter expanded state (persist across dialog openings)
        self.filter_expanded_state = {
            "brands": False,
            "states": False,
            "when": False,
            "scores": False,
            "gender": False,
            "tags": False,
            "vote_status": False,
        }
        
        # Calculate global max label width for alignment
        self.global_label_width = self._calculate_global_label_width()

        self._build_style()
        self._build_ui()
        self._refresh_list()

    # ---- V2: Mapping helper methods ----
    def get_brand_name(self, brand_id: str) -> str:
        """Get brand name from ID"""
        return self.app_data.brands_map.get(brand_id, "")
    
    def get_concentration_name(self, conc_id: str) -> str:
        """Get concentration name from ID"""
        return self.app_data.concentrations_map.get(conc_id, "")
    
    def get_outlet_info(self, outlet_id: str) -> OutletInfo:
        """Get outlet info from ID"""
        return self.app_data.outlets_map.get(outlet_id, OutletInfo(name="", region=""))
    
    def get_outlet_display(self, outlet_id: str) -> str:
        """Get outlet display string (name + region if exists)"""
        info = self.get_outlet_info(outlet_id)
        if info.region:
            return f"{info.name} ({info.region})"
        return info.name
    
    def get_tag_name(self, tag_id: str) -> str:
        """Get tag name from ID"""
        return self.app_data.tags_map.get(tag_id, "")
    
    def get_purchase_type_name(self, pt_id: str) -> str:
        """Get purchase type name from ID"""
        return self.app_data.purchase_types_map.get(pt_id, "")
    
    def find_brand_id(self, brand_name: str) -> str:
        """Find brand ID by name, return empty string if not found"""
        for bid, bname in self.app_data.brands_map.items():
            if bname == brand_name:
                return bid
        return ""
    
    def find_or_create_brand_id(self, brand_name: str) -> str:
        """Find brand ID by name, or create new one if not found"""
        bid = self.find_brand_id(brand_name)
        if bid:
            return bid
        new_bid = new_id()
        self.app_data.brands_map[new_bid] = brand_name
        return new_bid
    
    def find_tag_id(self, tag_name: str) -> str:
        """Find tag ID by name, return empty string if not found"""
        for tid, tname in self.app_data.tags_map.items():
            if tname == tag_name:
                return tid
        return ""
    
    def find_or_create_tag_id(self, tag_name: str) -> str:
        """Find tag ID by name, or create new one if not found"""
        tid = self.find_tag_id(tag_name)
        if tid:
            return tid
        new_tid = new_id()
        self.app_data.tags_map[new_tid] = tag_name
        return new_tid
    
    def find_outlet_by_name(self, name: str) -> str:
        """Find outlet ID by name, return empty string if not found"""
        for oid, oinfo in self.app_data.outlets_map.items():
            if isinstance(oinfo, OutletInfo):
                if oinfo.name == name:
                    return oid
            elif str(oinfo) == name:
                return oid
        return ""
    
    def find_or_create_outlet(self, name: str) -> str:
        """Find outlet ID by name, or create new one if not found"""
        if not name.strip():
            return ""
        oid = self.find_outlet_by_name(name.strip())
        if oid:
            return oid
        new_oid = new_id()
        self.app_data.outlets_map[new_oid] = OutletInfo(name=name.strip(), region="")
        return new_oid
    
    def get_all_brand_names(self) -> List[str]:
        """Get all brand names in mapping order"""
        return list(self.app_data.brands_map.values())
    
    def get_all_tag_names(self) -> List[str]:
        """Get all tag names in mapping order"""
        return list(self.app_data.tags_map.values())
    
    def get_all_concentration_names(self) -> List[str]:
        """Get all concentration names in mapping order"""
        return list(self.app_data.concentrations_map.values())
    
    def get_all_outlet_names(self) -> List[str]:
        """Get all outlet display names in mapping order"""
        result = []
        for outlet in self.app_data.outlets_map.values():
            if isinstance(outlet, OutletInfo):
                display = outlet.name + (f" ({outlet.region})" if outlet.region else "")
            else:
                display = str(outlet)
            result.append(display)
        return result
    
    def get_all_purchase_type_names(self) -> List[str]:
        """Get all purchase type names in mapping order"""
        return list(self.app_data.purchase_types_map.values())

    # ---- styling
    def _build_style(self):
        style = ttk.Style(self)
        style.theme_use("clam")
        style.configure("TFrame", background=COLORS["bg"])
        style.configure("Panel.TFrame", background=COLORS["panel"])
        style.configure("TLabel", background=COLORS["bg"], foreground=COLORS["text"])
        style.configure("Panel.TLabel", background=COLORS["panel"], foreground=COLORS["text"])
        style.configure("Muted.TLabel", background=COLORS["bg"], foreground=COLORS["muted"])
        style.configure("TButton", padding=6)
        style.configure("Treeview", background=COLORS["panel"], fieldbackground=COLORS["panel"], foreground=COLORS["text"])
        style.configure("Treeview.Heading", background=COLORS["bg"], foreground=COLORS["text"])
        style.map("Treeview", background=[("selected", "#2B3A55")])

        self.option_add("*Font", ("TkDefaultFont", 10))

    # ---- UI layout
    def _build_ui(self):
        root = ttk.Frame(self, style="TFrame")
        root.pack(fill="both", expand=True)

        # Main split (left-right layout, no top bar)
        paned = ttk.PanedWindow(root, orient="horizontal")
        paned.pack(fill="both", expand=True, padx=10, pady=10)

        left = ttk.Frame(paned, style="Panel.TFrame")
        right = ttk.Frame(paned, style="Panel.TFrame")
        paned.add(left, weight=3)
        paned.add(right, weight=2)

        # ===== LEFT PANEL =====
        # Top bar: Buttons + Search
        top_frame = ttk.Frame(left, style="Panel.TFrame")
        top_frame.pack(fill="x", padx=8, pady=(8, 4))
        
        # Left side: Add + Manage
        ttk.Button(top_frame, text="Add", command=self.ui_add_perfume).pack(side="left", padx=(0, 4))
        ttk.Button(top_frame, text="Manage", command=self.ui_open_manage_data).pack(side="left", padx=(0, 12))
        
        # Right side: Sort + Filter + Search (pack in reverse order)
        ttk.Button(top_frame, text="Search", command=self._refresh_list).pack(side="right")
        
        self.var_search = tk.StringVar(value="")
        search_entry = ttk.Entry(top_frame, textvariable=self.var_search)
        search_entry.pack(side="right", fill="x", expand=True, padx=(2, 4))
        search_entry.bind("<Return>", lambda e: self._refresh_list())
        
        # Filter button (color changes when active)
        self.filter_button = tk.Button(top_frame, text="Filter", command=self.ui_open_filter,
                                       bg=COLORS["panel"], fg=COLORS["text"],
                                       relief="groove", borderwidth=2, padx=6, pady=2)
        self.filter_button.pack(side="right", padx=(0, 4))
        
        # Sort button (color changes when active)
        self.sort_button = tk.Button(top_frame, text="Sort", command=self.ui_open_sort,
                                     bg=COLORS["panel"], fg=COLORS["text"],
                                     relief="groove", borderwidth=2, padx=6, pady=2)
        self.sort_button.pack(side="right", padx=(0, 2))

        # Treeview with new columns
        tree_frame = ttk.Frame(left, style="Panel.TFrame")
        tree_frame.pack(fill="both", expand=True, padx=8, pady=4)
        
        # Column configuration (brand, name required; others optional)
        self.column_visibility = {
            "brand": True,      # Required, cannot hide
            "name": True,       # Required, cannot hide
            "concentration": True,
            "locations": True,
        }
        
        all_columns = ("brand", "name", "concentration", "locations")
        self.tree = ttk.Treeview(
            tree_frame,
            columns=all_columns,
            show="headings",
            selectmode="browse",
            height=18,
        )
        self.tree.heading("brand", text="Brand")
        self.tree.heading("name", text="Name")
        self.tree.heading("concentration", text="Conc.")
        self.tree.heading("locations", text="Location")
        
        self.tree.column("brand", width=120, anchor="w")
        self.tree.column("name", width=180, anchor="w")
        self.tree.column("concentration", width=60, anchor="w")
        self.tree.column("locations", width=120, anchor="w")

        yscroll = ttk.Scrollbar(tree_frame, orient="vertical", command=self.tree.yview)
        self.tree.configure(yscrollcommand=yscroll.set)
        self.tree.pack(side="left", fill="both", expand=True)
        yscroll.pack(side="right", fill="y")

        self.tree.bind("<<TreeviewSelect>>", self._on_select)
        self.tree.bind("<Double-1>", lambda e: self.ui_edit_info())
        
        # Right-click on header for column visibility
        self.tree.bind("<Button-3>", self._on_tree_right_click)

        # Update button states
        self._update_button_states()

        # ===== RIGHT PANEL =====
        # Perfume-specific buttons at top (use expand to fill width evenly)
        right_btn_frame = ttk.Frame(right, style="Panel.TFrame")
        right_btn_frame.pack(fill="x", padx=10, pady=(10, 3))
        
        # Use expand=True to distribute buttons evenly
        ttk.Button(right_btn_frame, text="Info", command=self.ui_edit_info).pack(side="left", fill="x", expand=True, padx=(0, 2))
        ttk.Button(right_btn_frame, text="Memo", command=self.ui_edit_notes).pack(side="left", fill="x", expand=True, padx=(0, 2))
        ttk.Button(right_btn_frame, text="Events", command=self.ui_edit_events).pack(side="left", fill="x", expand=True, padx=(0, 2))
        ttk.Button(right_btn_frame, text="Fragrantica", command=self.ui_edit_fragrantica).pack(side="left", fill="x", expand=True)
        
        # Quick event row (use expand for right alignment)
        quick_frame = ttk.Frame(right, style="Panel.TFrame")
        quick_frame.pack(fill="x", padx=10, pady=(0, 6))
        
        # Date label + entry (persists across perfume selection)
        ttk.Label(quick_frame, text="Date:", style="Panel.TLabel").pack(side="left")
        self.var_quick_date = tk.StringVar(value="")
        ttk.Entry(quick_frame, textvariable=self.var_quick_date, width=10).pack(side="left", padx=(2, 6))
        
        # Location label + dropdown (persists across perfume selection)
        ttk.Label(quick_frame, text="@", style="Panel.TLabel").pack(side="left")
        self.var_quick_location = tk.StringVar(value="")
        self.quick_location_combo = ttk.Combobox(quick_frame, textvariable=self.var_quick_location, width=12)
        self.quick_location_combo["values"] = self.get_all_outlet_names()
        make_combobox_searchable(self.quick_location_combo, self.get_all_outlet_names())
        self.quick_location_combo.pack(side="left", fill="x", expand=True, padx=(2, 6))
        
        # Smell button
        ttk.Button(quick_frame, text="Smell", command=self._quick_smell, width=6).pack(side="left", padx=(0, 2))
        
        # Skin button
        ttk.Button(quick_frame, text="Skin", command=self._quick_skin, width=6).pack(side="left")

        # Title
        self.detail_title = ttk.Label(right, text="(no selection)", style="Panel.TLabel", font=("TkDefaultFont", 12, "bold"))
        self.detail_title.pack(fill="x", padx=10, pady=(0, 2), anchor="w")
        
        # State (derived from events)
        self.state_label = ttk.Label(right, text="", style="Muted.TLabel")
        self.state_label.pack(fill="x", padx=10, pady=(0, 6), anchor="w")

        # Canvas frame for scrollable content (using pack)
        canvas_frame = ttk.Frame(right, style="Panel.TFrame")
        canvas_frame.pack(fill="both", expand=True, padx=10, pady=(0, 10))
        
        self.detail_canvas = tk.Canvas(canvas_frame, bg=COLORS["panel"], highlightthickness=0)
        detail_scrollbar = ttk.Scrollbar(canvas_frame, orient="vertical", command=self.detail_canvas.yview)
        self.detail_canvas.configure(yscrollcommand=detail_scrollbar.set)
        
        self.detail_canvas.pack(side="left", fill="both", expand=True)
        detail_scrollbar.pack(side="right", fill="y")
        
        # Scrollable frame inside canvas
        self.scrollable_detail_frame = ttk.Frame(self.detail_canvas, style="Panel.TFrame")
        
        self.scrollable_detail_frame.bind(
            "<Configure>",
            lambda e: self.detail_canvas.configure(scrollregion=self.detail_canvas.bbox("all"))
        )
        
        self.detail_canvas_window = self.detail_canvas.create_window((0, 0), window=self.scrollable_detail_frame, anchor="nw")
        
        # Bind mouse wheel for scrolling (only when mouse is over the canvas)
        self.detail_canvas.bind("<Enter>", lambda e: self.detail_canvas.bind_all("<MouseWheel>", self._on_mousewheel))
        self.detail_canvas.bind("<Leave>", lambda e: self.detail_canvas.unbind_all("<MouseWheel>"))
        
        # Bind canvas resize to update scrollable frame width
        self.detail_canvas.bind("<Configure>", self._on_canvas_configure)

        # Tags section (clickable to expand) - inside scrollable frame
        self.tags_label = tk.Label(
            self.scrollable_detail_frame, 
            text="(No tags)", 
            fg=COLORS["muted"], 
            bg=COLORS["panel"],
            cursor="hand2",
            anchor="w"
        )
        self.tags_label.pack(fill="x", padx=(0, 20), pady=(0, 12), anchor="w")
        self.tags_label.bind("<Button-1>", self._show_tags_popup)
        self.current_tags = []  # Store current tags for popup
        
        # Fragrantica section title (clickable if URL exists)
        self.fragrantica_title_frame = ttk.Frame(self.scrollable_detail_frame, style="Panel.TFrame")
        self.fragrantica_title_frame.pack(fill="x", padx=(0, 20), pady=(8, 4))
        
        self.fragrantica_title = tk.Label(
            self.fragrantica_title_frame, 
            text="Fragrantica", 
            fg=COLORS["accent"], 
            bg=COLORS["panel"],
            font=("TkDefaultFont", 10, "bold"),
            anchor="w"
        )
        self.fragrantica_title.pack(side="left")
        self.fragrantica_url = ""  # Store current URL
        
        # Vote blocks (collapsible) - inside scrollable frame
        # Add right padding to avoid content going under scrollbar
        self.bars_frame = ttk.Frame(self.scrollable_detail_frame, style="Panel.TFrame")
        self.bars_frame.pack(fill="x", padx=(0, 20))  # 20px right padding for scrollbar space

        # Summary function mapping
        summary_funcs = {
            "rating_votes": calculate_rating_summary,
            "season_time_votes": calculate_when_summary,
            "longevity_votes": calculate_longevity_summary,
            "sillage_votes": calculate_sillage_summary,
            "gender_votes": calculate_gender_summary,
            "value_votes": calculate_value_summary,
        }

        self.vote_blocks: Dict[str, CollapsibleVoteBlock] = {}
        for block_name, keys, title in VOTE_BLOCKS:
            normalize_mode = "max" if block_name == "season_time_votes" else "sum"
            summary_func = summary_funcs.get(block_name, lambda v, k: "—")
            
            block = CollapsibleVoteBlock(
                self.bars_frame,
                block_name=block_name,
                keys=keys,
                title=title,
                normalize_mode=normalize_mode,
                summary_func=summary_func,
                on_vote_callback=self.set_my_vote,
                on_toggle_callback=self._on_section_toggle,
                global_label_width=self.global_label_width,
                style="Panel.TFrame"
            )
            block.pack(fill="x", pady=2)
            self.vote_blocks[block_name] = block

        # Links (inside scrollable frame)
        ttk.Label(self.scrollable_detail_frame, text="Links", style="Panel.TLabel").pack(anchor="w", padx=(0, 20), pady=(14, 4))
        self.links_display_frame = ttk.Frame(self.scrollable_detail_frame, style="Panel.TFrame")
        self.links_display_frame.pack(fill="x", padx=(0, 20))

        # Notes (inside scrollable frame)
        ttk.Label(self.scrollable_detail_frame, text="Notes", style="Panel.TLabel").pack(anchor="w", padx=(0, 20), pady=(14, 4))
        self.notes_display_frame = ttk.Frame(self.scrollable_detail_frame, style="Panel.TFrame")
        self.notes_display_frame.pack(fill="x", padx=(0, 20))


        # Context menu on list
        self.menu = tk.Menu(self, tearoff=0)
        self.menu.add_command(label="Events", command=self.ui_edit_events)
        self.menu.add_command(label="Edit Info", command=self.ui_edit_info)
        self.menu.add_command(label="Notes", command=self.ui_edit_notes)
        self.menu.add_command(label="Edit Fragrantica Data", command=self.ui_edit_fragrantica)
        self.menu.add_separator()
        self.menu.add_command(label="Delete Perfume", command=self.ui_delete_perfume)
        # Note: Button-3 binding is set in _build_ui

    # ---- helpers
    def _calculate_global_label_width(self):
        """Calculate the maximum label width across all vote blocks for alignment"""
        max_chars = 0
        for block_name, keys, title in VOTE_BLOCKS:
            for key in keys:
                max_chars = max(max_chars, len(display_label(key)))
        # ~8px per char, min 80px, add some padding
        return max(80, max_chars * 8 + 10)
    
    def _on_section_toggle(self, block_name: str, expanded: bool):
        """Update persistent expand/collapse state"""
        self.expanded_sections[block_name] = expanded
    
    def _on_mousewheel(self, event):
        """Handle mouse wheel scrolling (prevent over-scrolling)"""
        # Get current scroll position and content bounds
        bbox = self.detail_canvas.bbox("all")
        if not bbox:
            return
        content_height = bbox[3] - bbox[1]
        canvas_height = self.detail_canvas.winfo_height()
        
        # Only scroll if content is taller than canvas
        if content_height <= canvas_height:
            # Reset to top if somehow scrolled
            self.detail_canvas.yview_moveto(0)
            return
        
        self.detail_canvas.yview_scroll(int(-1 * (event.delta / 120)), "units")
    
    def _on_canvas_configure(self, event):
        """Update scrollable frame width when canvas is resized"""
        canvas_width = event.width
        self.detail_canvas.itemconfig(self.detail_canvas_window, width=canvas_width)
    
    def save(self):
        for p in self.perfumes:
            p.updated_at = now_ts()
        save_app_data(self.app_data)  # V2: Save with mapping tables
        # Silent save - no popup
    
    def ui_open_sort(self):
        """Open sort configuration dialog"""
        def on_apply(config: SortConfig):
            self.sort_config = config
            self._update_button_states()
            self._refresh_list()
        
        SortDialog(self, self.sort_config, on_apply)
    
    def ui_open_filter(self):
        """Open filter configuration dialog"""
        def on_apply(config: FilterConfig):
            self.filter_config = config
            self._update_button_states()
            self._refresh_list()
        
        FilterDialog(self, self.filter_config, self.perfumes, self.filter_expanded_state, on_apply, app=self)
    
    def ui_open_manage_data(self):
        """Open manage data dialog for brands, tags, etc."""
        ManageDataDialog(self, self)
    
    def _update_button_states(self):
        """Update sort and filter button visual states (using color)"""
        # Check if sort is active
        has_sort = bool(self.sort_config.dimensions)
        if has_sort:
            self.sort_button.config(bg=COLORS["accent"], fg=COLORS["bg"], relief="solid")
        else:
            self.sort_button.config(bg=COLORS["panel"], fg=COLORS["text"], relief="groove")
        
        # Check if filter is active (including range filters)
        has_filter = (
            bool(self.filter_config.brands) or
            bool(self.filter_config.states) or
            bool(self.filter_config.seasons) or
            bool(self.filter_config.times) or
            self.filter_config.rating_min > 0 or self.filter_config.rating_max < 5.0 or self.filter_config.rating_exclude or
            self.filter_config.longevity_min > 0 or self.filter_config.longevity_max < 5.0 or self.filter_config.longevity_exclude or
            self.filter_config.sillage_min > 0 or self.filter_config.sillage_max < 4.0 or self.filter_config.sillage_exclude or
            self.filter_config.value_min > 0 or self.filter_config.value_max < 5.0 or self.filter_config.value_exclude or
            bool(self.filter_config.gender_preference) or
            bool(self.filter_config.tags) or
            self.filter_config.has_my_vote or
            self.filter_config.has_fragrantica
        )
        if has_filter:
            self.filter_button.config(bg=COLORS["accent"], fg=COLORS["bg"], relief="solid")
        else:
            self.filter_button.config(bg=COLORS["panel"], fg=COLORS["text"], relief="groove")

    def _get_selected_id(self) -> Optional[str]:
        sel = self.tree.selection()
        if not sel:
            return None
        return sel[0]

    def _get_perfume(self, pid: str) -> Optional[Perfume]:
        for p in self.perfumes:
            if p.id == pid:
                return p
        return None

    def _refresh_list(self):
        self.tree.delete(*self.tree.get_children())

        # Search query
        q = (self.var_search.get() or "").strip().lower()
        
        # Filter perfumes
        filtered = []
        for p in self.perfumes:
            # Apply filter config
            if not self._matches_filter(p, self.filter_config):
                continue
            
            # Search query (brand, name, tags, notes)
            if q:
                # V2: use brand_id and tag_ids lookup for search
                brand_name = self.get_brand_name(p.brand_id)
                tag_names = [self.get_tag_name(tid) for tid in p.tag_ids]
                note_contents = [n.title + " " + n.content for n in p.notes]
                blob = " ".join([brand_name, p.name, " ".join(tag_names), " ".join(note_contents)]).lower()
                if q not in blob:
                    continue
            
            filtered.append(p)
        
        # Sort perfumes
        sorted_perfumes = self._sort_perfumes(filtered, self.sort_config)
        
        # Populate tree
        ids = []
        for p in sorted_perfumes:
            # V2: Pass tag_names to derive_state
            tag_names = [self.get_tag_name(tid) for tid in p.tag_ids]
            state, _ = derive_state(p, tag_names)
            brand_display = self.get_brand_name(p.brand_id)
            
            # Get concentration name
            conc_display = self.get_concentration_name(p.concentration_id) if p.concentration_id else ""
            
            # Get locations (Available At)
            locations_display = ", ".join(self.get_outlet_display(oid) for oid in p.outlet_ids) if p.outlet_ids else ""
            
            self.tree.insert(
                "",
                "end",
                iid=p.id,
                values=(brand_display, p.name, conc_display, locations_display),
            )
            ids.append(p.id)
        
        self.filtered_ids = ids

        # Auto-select first row if nothing selected
        if ids and not self.tree.selection():
            self.tree.selection_set(ids[0])
            self.tree.focus(ids[0])
            self._on_select()
    
    def _matches_filter(self, p: Perfume, config: FilterConfig) -> bool:
        """Check if perfume matches filter configuration"""
        # Brands (V2: use brand_id lookup with fallback)
        brand_name = self.get_brand_name(p.brand_id)
        if config.brands and brand_name not in config.brands:
            return False
        
        # States
        if config.states:
            # V2: Pass tag_names to derive_state
            tag_names = [self.get_tag_name(tid) for tid in p.tag_ids]
            state, owned_ml = derive_state(p, tag_names)
            matches_state = False
            if "owned" in config.states and owned_ml > 0:
                matches_state = True
            if "tested" in config.states and "Tested" in state:
                matches_state = True
            if "wishlist" in config.states and state == "Wishlist":
                matches_state = True
            if not matches_state:
                return False
        
        # Seasons/Times
        if config.seasons or config.times:
            fr_votes = (p.fragrantica or {}).get("season_time_votes", {})
            my_votes = (p.my_votes or {}).get("my_season_time_votes", {})
            
            check_items = config.seasons + config.times
            matches_when = False
            for item in check_items:
                fr_val = int(fr_votes.get(item, 0) or 0)
                my_val = int(my_votes.get(item, 0) or 0)
                if fr_val >= 10 or my_val > 0:
                    matches_when = True
                    break
            if not matches_when:
                return False
        
        # Score filters: Empty values (score=0) are treated specially:
        # - Include mode: no match (won't show perfumes without data)
        # - Exclude mode: match (will show perfumes without data)
        
        # Rating (range with include/exclude)
        if config.rating_min > 0 or config.rating_max < 5.0 or config.rating_exclude:
            fr = (p.fragrantica or {}).get("rating_votes", {})
            score = calculate_rating_score(fr, RATING_5)
            has_data = score > 0
            in_range = config.rating_min <= score <= config.rating_max
            if config.rating_exclude:
                if has_data and in_range:
                    return False
            else:
                if not has_data or not in_range:
                    return False
        
        # Longevity (range with include/exclude)
        if config.longevity_min > 0 or config.longevity_max < 5.0 or config.longevity_exclude:
            fr = (p.fragrantica or {}).get("longevity_votes", {})
            score = calculate_longevity_score(fr, LONGEVITY_5)
            has_data = score > 0
            in_range = config.longevity_min <= score <= config.longevity_max
            if config.longevity_exclude:
                if has_data and in_range:
                    return False
            else:
                if not has_data or not in_range:
                    return False
        
        # Sillage (range with include/exclude)
        if config.sillage_min > 0 or config.sillage_max < 4.0 or config.sillage_exclude:
            fr = (p.fragrantica or {}).get("sillage_votes", {})
            score = calculate_sillage_score(fr, SILLAGE_4)
            has_data = score > 0
            in_range = config.sillage_min <= score <= config.sillage_max
            if config.sillage_exclude:
                if has_data and in_range:
                    return False
            else:
                if not has_data or not in_range:
                    return False
        
        # Value (range with include/exclude)
        if config.value_min > 0 or config.value_max < 5.0 or config.value_exclude:
            fr = (p.fragrantica or {}).get("value_votes", {})
            score = calculate_value_score(fr, VALUE_5)
            has_data = score > 0
            in_range = config.value_min <= score <= config.value_max
            if config.value_exclude:
                if has_data and in_range:
                    return False
            else:
                if not has_data or not in_range:
                    return False
        
        # Gender (multi-select: must match at least one selected gender)
        if config.gender_preference:
            fr = (p.fragrantica or {}).get("gender_votes", {})
            my = (p.my_votes or {}).get("my_gender_votes", {})
            matches_any_gender = False
            for gender in config.gender_preference:
                if int(fr.get(gender, 0) or 0) >= 10 or int(my.get(gender, 0) or 0) > 0:
                    matches_any_gender = True
                    break
            if not matches_any_gender:
                return False
        
        # Tags (V2: use tag_ids)
        if config.tags:
            p_tags = set(self.get_tag_name(tid) for tid in p.tag_ids)
            config_tags = set(config.tags)
            if config.tags_logic == "and":
                if not config_tags.issubset(p_tags):
                    return False
            else:  # or
                if not config_tags.intersection(p_tags):
                    return False
        
        # Vote status
        if config.has_my_vote:
            if not p.my_votes or not any(p.my_votes.values()):
                return False
        
        if config.has_fragrantica:
            if not p.fragrantica or not any(p.fragrantica.values()):
                return False
        
        return True
    
    def _sort_perfumes(self, perfumes: List[Perfume], config: SortConfig) -> List[Perfume]:
        """Sort perfumes according to sort configuration"""
        if not config.dimensions:
            return perfumes
        
        def sort_key(p: Perfume):
            keys = []
            for dim, order in config.dimensions:
                val = self._get_sort_value(p, dim, order)
                keys.append(val)
            return tuple(keys)
        
        return sorted(perfumes, key=sort_key)
    
    def _get_sort_value(self, p: Perfume, dimension: str, order: str) -> Tuple:
        """Get sort value for a perfume on a given dimension"""
        if dimension == "brand":
            # V2: use brand_id lookup with fallback
            brand_name = self.get_brand_name(p.brand_id).lower()
            return (brand_name,) if order == "asc" else (brand_name, True)
        
        elif dimension == "name":
            return (p.name.lower(),) if order == "asc" else (p.name.lower(), True)
        
        elif dimension == "rating":
            fr = (p.fragrantica or {}).get("rating_votes", {})
            score = calculate_rating_score(fr, RATING_5)
            return (-score,) if order == "desc" else (score,)
        
        elif dimension == "longevity":
            fr = (p.fragrantica or {}).get("longevity_votes", {})
            score = calculate_longevity_score(fr, LONGEVITY_5)
            return (-score,) if order == "desc" else (score,)
        
        elif dimension == "sillage":
            fr = (p.fragrantica or {}).get("sillage_votes", {})
            score = calculate_sillage_score(fr, SILLAGE_4)
            return (-score,) if order == "desc" else (score,)
        
        elif dimension == "gender":
            fr = (p.fragrantica or {}).get("gender_votes", {})
            score = calculate_gender_score(fr, GENDER_5)
            # female_first: lower score first, male_first: higher score first
            if order == "female_first":
                return (score,)
            elif order == "male_first":
                return (-score,)
            else:  # unisex_first (score close to 3.0)
                return (abs(score - 3.0),)
        
        elif dimension == "value":
            fr = (p.fragrantica or {}).get("value_votes", {})
            score = calculate_value_score(fr, VALUE_5)
            return (-score,) if order == "desc" else (score,)
        
        elif dimension == "state":
            # V2: Pass tag_names to derive_state
            tag_names = [self.get_tag_name(tid) for tid in p.tag_ids]
            state, owned_ml = derive_state(p, tag_names)
            state_priority = {"Owned": 0, "Tested": 1, "Wishlist": 2}
            if order == "owned_first":
                return (state_priority.get(state.split(",")[0], 3),)
            else:  # tested_first
                return (state_priority.get(state.split(",")[0], 3),)
        
        return (0,)

    def _on_select(self, event=None):
        pid = self._get_selected_id()
        if not pid:
            return

        p = self._get_perfume(pid)
        if not p:
            return

        # V2: Use brand_id lookup with fallback
        brand_display = self.get_brand_name(p.brand_id)
        self.detail_title.config(text=f"{brand_display} – {p.name}")
        
        # State (derived from events)
        tag_names_for_state = [self.get_tag_name(tid) for tid in p.tag_ids]
        state, _ = derive_state(p, tag_names_for_state)
        self.state_label.config(text=state if state else "New")
        
        # tags - display as gray text, click to expand
        tag_names = [self.get_tag_name(tid) for tid in p.tag_ids]
        self.current_tags = tag_names
        
        if not tag_names:
            self.tags_label.config(text="(No tags)", cursor="arrow")
        else:
            # Show summary: first few tags + count if more
            max_display = 3
            if len(tag_names) <= max_display:
                display_text = ", ".join(tag_names)
            else:
                display_text = ", ".join(tag_names[:max_display]) + f" (+{len(tag_names) - max_display} more)"
            self.tags_label.config(text=display_text, cursor="hand2")

        # links
        for widget in self.links_display_frame.winfo_children():
            widget.destroy()
        
        links = p.links if hasattr(p, 'links') and p.links else []
        if not links:
            ttk.Label(self.links_display_frame, text="(No links)", style="Muted.TLabel").pack(anchor="w")
        else:
            for link in links:
                label = link.get("label") or link.get("url", "")
                url = link.get("url", "")
                # Create clickable link
                link_label = tk.Label(self.links_display_frame, text=label, 
                                     fg=COLORS["accent"], bg=COLORS["panel"],
                                     cursor="hand2", anchor="w")
                link_label.pack(anchor="w", pady=1)
                link_label.bind("<Button-1>", lambda e, u=url: self._open_url(u))

        # notes
        for widget in self.notes_display_frame.winfo_children():
            widget.destroy()
        
        if not p.notes:
            ttk.Label(self.notes_display_frame, text="(No notes)", style="Muted.TLabel").pack(anchor="w")
        else:
            max_lines = 6  # Max lines to show before "more"
            max_chars = 300  # Max characters to show before "more"
            
            for note in p.notes:
                note_frame = ttk.Frame(self.notes_display_frame, style="Panel.TFrame")
                note_frame.pack(fill="x", anchor="w", pady=(8, 0))
                
                # Title on its own line
                title_label = tk.Label(note_frame, text=note.title, 
                                      fg=COLORS["accent"], bg=COLORS["panel"],
                                      font=("TkDefaultFont", 9, "bold"), anchor="w")
                title_label.pack(fill="x")
                
                # Content - preserve newlines, auto-wrap long lines
                content = note.content
                lines = content.split("\n")
                has_more = len(lines) > max_lines or len(content) > max_chars
                
                if has_more:
                    # Truncate content
                    if len(lines) > max_lines:
                        preview = "\n".join(lines[:max_lines]) + "..."
                    elif len(content) > max_chars:
                        preview = content[:max_chars] + "..."
                    else:
                        preview = content
                else:
                    preview = content
                
                # Use Label with wraplength for auto-wrap (350px width)
                content_label = tk.Label(note_frame, text=preview, 
                                       fg=COLORS["text"], bg=COLORS["panel"],
                                       anchor="nw", justify="left",
                                       wraplength=350,
                                       cursor="hand2" if has_more else "arrow")
                content_label.pack(fill="x", anchor="w")
                
                if has_more:
                    content_label.bind("<Button-1>", lambda e, n=note: self._show_note_popup(n))
                    more_label = tk.Label(note_frame, text="[more]", 
                                        fg=COLORS["muted"], bg=COLORS["panel"],
                                        cursor="hand2", anchor="w")
                    more_label.pack(anchor="w")
                    more_label.bind("<Button-1>", lambda e, n=note: self._show_note_popup(n))

        # vote blocks (Fragrantica + my votes)
        fr = (p.fragrantica or {})
        fr_blocks = {k: fr.get(k, {}) for k, _, _ in VOTE_BLOCKS}
        my = (p.my_votes or {})
        
        # Update Fragrantica title with URL if available
        self.fragrantica_url = fr.get("url", "")
        if self.fragrantica_url:
            self.fragrantica_title.config(
                text="Fragrantica ↗", 
                cursor="hand2",
                fg=COLORS["accent"]
            )
            self.fragrantica_title.bind("<Button-1>", lambda e: self._open_url(self.fragrantica_url))
        else:
            self.fragrantica_title.config(
                text="Fragrantica", 
                cursor="arrow",
                fg=COLORS["accent"]
            )
            self.fragrantica_title.unbind("<Button-1>")

        for block_name, keys, _title in VOTE_BLOCKS:
            self.vote_blocks[block_name].set_data(
                perfume_id=p.id,
                fr_votes=fr_blocks.get(block_name, {}) or {},
                my_votes=my.get(MY_PREFIX + block_name, {}) or {},
                expanded=self.expanded_sections.get(block_name, False),
            )
    
    def _show_note_popup(self, note: Note):
        """Show popup window with full note content"""
        popup = tk.Toplevel(self)
        popup.title(note.title)
        popup.geometry("400x300")
        popup.configure(bg=COLORS["panel"])
        popup.transient(self)
        
        # Title
        title_label = tk.Label(popup, text=note.title, 
                              font=("TkDefaultFont", 11, "bold"),
                              fg=COLORS["accent"], bg=COLORS["panel"])
        title_label.pack(anchor="w", padx=15, pady=(15, 5))
        
        # Content with scrollbar
        text_frame = ttk.Frame(popup, style="Panel.TFrame")
        text_frame.pack(fill="both", expand=True, padx=15, pady=(0, 15))
        
        text_widget = tk.Text(text_frame, wrap="word", 
                             bg=COLORS["panel"], fg=COLORS["text"],
                             font=("TkDefaultFont", 10),
                             relief="flat", padx=5, pady=5)
        scrollbar = ttk.Scrollbar(text_frame, orient="vertical", command=text_widget.yview)
        text_widget.configure(yscrollcommand=scrollbar.set)
        
        scrollbar.pack(side="right", fill="y")
        text_widget.pack(side="left", fill="both", expand=True)
        
        text_widget.insert("1.0", note.content)
        text_widget.config(state="disabled")  # Read-only
        
        # Close on Escape
        popup.bind("<Escape>", lambda e: popup.destroy())
        popup.focus_set()
    
    def _show_tags_popup(self, event=None):
        """Show popup window with all tags listed vertically"""
        if not self.current_tags:
            return
        
        # Create popup window
        popup = tk.Toplevel(self)
        popup.title("Tags")
        popup.configure(bg=COLORS["panel"])
        popup.transient(self)
        
        # Create container frame
        container = ttk.Frame(popup, style="Panel.TFrame")
        container.pack(fill="both", expand=True)
        
        # Create scrollable frame
        canvas = tk.Canvas(container, bg=COLORS["panel"], highlightthickness=0, width=230)
        scrollbar = ttk.Scrollbar(container, orient="vertical", command=canvas.yview)
        scrollable_frame = ttk.Frame(canvas, style="Panel.TFrame")
        
        canvas.create_window((0, 0), window=scrollable_frame, anchor="nw")
        canvas.configure(yscrollcommand=scrollbar.set)
        
        # Add tags vertically
        for tag in self.current_tags:
            tag_label = tk.Label(
                scrollable_frame,
                text=f"• {tag}",
                bg=COLORS["panel"],
                fg=COLORS["text"],
                anchor="w",
                padx=10,
                pady=4
            )
            tag_label.pack(fill="x", anchor="w")
        
        # Update to calculate content size
        scrollable_frame.update_idletasks()
        content_height = scrollable_frame.winfo_reqheight()
        max_height = 300
        
        # Determine if scrollbar is needed
        if content_height > max_height:
            # Need scrollbar
            canvas.pack(side="left", fill="both", expand=True, padx=(10, 0), pady=10)
            scrollbar.pack(side="right", fill="y", pady=10, padx=(0, 5))
            popup.geometry(f"250x{max_height}")
            
            # Configure scroll region
            scrollable_frame.bind(
                "<Configure>",
                lambda e: canvas.configure(scrollregion=canvas.bbox("all"))
            )
            
            # Mouse wheel scrolling
            def on_mousewheel(event):
                canvas.yview_scroll(int(-1 * (event.delta / 120)), "units")
            
            canvas.bind("<MouseWheel>", on_mousewheel)
            scrollable_frame.bind("<MouseWheel>", on_mousewheel)
            for child in scrollable_frame.winfo_children():
                child.bind("<MouseWheel>", on_mousewheel)
        else:
            # No scrollbar needed - fit to content
            canvas.pack(fill="both", expand=True, padx=10, pady=10)
            popup.geometry(f"250x{content_height + 20}")
        
        # Position popup near the tags label
        x = self.tags_label.winfo_rootx()
        y = self.tags_label.winfo_rooty() + self.tags_label.winfo_height()
        popup.geometry(f"+{x}+{y}")
        
        # Close on Escape
        popup.bind("<Escape>", lambda e: popup.destroy())
        popup.focus_set()
    
    def _open_url(self, url: str):
        """Open URL in default browser"""
        import webbrowser
        if url:
            webbrowser.open(url)

    def _on_tree_right_click(self, evt):
        """Handle right-click on treeview - show column menu if on header, else show item menu"""
        region = self.tree.identify_region(evt.x, evt.y)
        if region == "heading":
            # Show column visibility menu
            self._show_column_menu(evt)
        else:
            # Show item context menu
            row_id = self.tree.identify_row(evt.y)
            if row_id:
                self.tree.selection_set(row_id)
                self.tree.focus(row_id)
                self._on_select()
                self.menu.tk_popup(evt.x_root, evt.y_root)
    
    def _show_column_menu(self, evt):
        """Show menu to toggle column visibility"""
        menu = tk.Menu(self, tearoff=0)
        
        # Add checkboxes for optional columns (not brand/name)
        optional_cols = [
            ("concentration", "Concentration"),
            ("locations", "Location"),
        ]
        
        for col_id, col_name in optional_cols:
            var = tk.BooleanVar(value=self.column_visibility.get(col_id, True))
            menu.add_checkbutton(
                label=col_name,
                variable=var,
                command=lambda c=col_id, v=var: self._toggle_column(c, v.get())
            )
        
        menu.tk_popup(evt.x_root, evt.y_root)
    
    def _toggle_column(self, column: str, visible: bool):
        """Toggle column visibility"""
        self.column_visibility[column] = visible
        self._update_treeview_columns()
    
    def _update_treeview_columns(self):
        """Update treeview to show/hide columns based on visibility settings"""
        visible_cols = [col for col, vis in self.column_visibility.items() if vis]
        self.tree["displaycolumns"] = visible_cols
    
    def _on_right_click_tree(self, evt):
        """Legacy method - redirect to new handler"""
        self._on_tree_right_click(evt)

    # -----------------------------
    # Mouse-first actions
    # -----------------------------
    def ui_add_perfume(self):
        """Open Add Perfume dialog (uses shared dialog)"""
        self._open_perfume_dialog(None, is_new=True)

    def _quick_smell(self):
        """Quick add smell event"""
        self._quick_add_event("smell")
    
    def _quick_skin(self):
        """Quick add skin event"""
        self._quick_add_event("skin")
    
    def _quick_add_event(self, event_type: str):
        """Add quick event with validation"""
        pid = self._get_selected_id()
        if not pid:
            messagebox.showinfo("Select", "Please select a perfume first.")
            return
        p = self._get_perfume(pid)
        if not p:
            return
        
        # Validate date if provided
        date_str = self.var_quick_date.get().strip()
        if date_str:
            try:
                datetime.strptime(date_str, "%Y-%m-%d")
            except ValueError:
                messagebox.showwarning("Invalid Date", "Date format must be YYYY-MM-DD")
                return
        
        location = self.var_quick_location.get().strip()
        
        # Add event
        self._add_event_simple(p, event_type, location=location, note="", event_date=date_str)
        self._refresh_list()
        self.save()
    
    def ui_edit_events(self):
        """Open Events management dialog"""
        pid = self._get_selected_id()
        if not pid:
            messagebox.showinfo("Select", "Please select a perfume first.")
            return
        p = self._get_perfume(pid)
        if not p:
            return
        
        EditEventsDialog(self, p)
    
    def _add_event_simple(self, perfume: "Perfume", event_type: str, location: str = "", note: str = "", event_date: str = ""):
        """Add smell or skin event"""
        loc_str = location.strip()
        # Auto-create outlet if new location entered
        if loc_str:
            self.find_or_create_outlet(loc_str)
        
        e = Event(
            id=new_id(),
            perfume_id=perfume.id,
            event_type=event_type,
            timestamp=now_ts(),
            location=loc_str,
            note=note.strip(),
            event_date=event_date.strip(),
        )
        perfume.events.append(e)
        self._refresh_list()
        self._on_select()
        self.save()
    
    def _add_event_transaction(self, perfume: "Perfume", event_type: str, 
                                item_type: str = "", ml: float = 0, price: float = 0, note: str = "", event_date: str = ""):
        """Add buy/sell type event"""
        e = Event(
            id=new_id(),
            perfume_id=perfume.id,
            event_type=event_type,
            timestamp=now_ts(),
            ml_delta=ml if event_type == "buy" else -ml if ml else None,
            price=price if price else None,
            purchase_type=item_type.strip(),
            note=note.strip(),
            event_date=event_date.strip(),
        )
        perfume.events.append(e)
        self._refresh_list()
        self._on_select()
        self.save()
    
    def _delete_event(self, perfume: "Perfume", event_id: str):
        """Delete an event"""
        perfume.events = [e for e in perfume.events if e.id != event_id]
        self._refresh_list()
        self._on_select()
        self.save()

    def ui_edit_info(self):
        """Edit perfume info: Brand, Name, Concentration, Location, Tags"""
        pid = self._get_selected_id()
        if not pid:
            messagebox.showinfo("Select", "Please select a perfume first.")
            return
        p = self._get_perfume(pid)
        if not p:
            return
        
        self._open_perfume_dialog(p, is_new=False)
    
    def _open_perfume_dialog(self, perfume: Optional["Perfume"], is_new: bool = False):
        """Shared dialog for Add/Edit perfume info"""
        win = tk.Toplevel(self)
        win.title("Add Perfume" if is_new else "Edit Info")
        win.configure(bg=COLORS["bg"])
        win.geometry("450x500")
        win.transient(self)

        frm = ttk.Frame(win, style="TFrame")
        frm.pack(fill="both", expand=True, padx=12, pady=12)

        # === Brand ===
        brand_frame = ttk.Frame(frm, style="TFrame")
        brand_frame.pack(fill="x", pady=(0, 6))
        ttk.Label(brand_frame, text="Brand:", style="TLabel", width=12).pack(side="left")
        known_brands = self.get_all_brand_names()
        current_brand = self.get_brand_name(perfume.brand_id) if perfume and perfume.brand_id else ""
        var_brand = tk.StringVar(value=current_brand)
        brand_cb = ttk.Combobox(brand_frame, textvariable=var_brand, width=28)
        make_combobox_searchable(brand_cb, known_brands)
        brand_cb.pack(side="left", padx=(4, 0))

        # === Name ===
        name_frame = ttk.Frame(frm, style="TFrame")
        name_frame.pack(fill="x", pady=(0, 6))
        ttk.Label(name_frame, text="Name:", style="TLabel", width=12).pack(side="left")
        var_name = tk.StringVar(value=perfume.name if perfume else "")
        name_entry = ttk.Entry(name_frame, textvariable=var_name, width=30)
        name_entry.pack(side="left", padx=(4, 0))

        # === Concentration (readonly dropdown) ===
        conc_frame = ttk.Frame(frm, style="TFrame")
        conc_frame.pack(fill="x", pady=(0, 10))
        ttk.Label(conc_frame, text="Concentration:", style="TLabel", width=12).pack(side="left")
        conc_names = [""] + self.get_all_concentration_names()
        current_conc = self.get_concentration_name(perfume.concentration_id) if perfume and perfume.concentration_id else ""
        var_conc = tk.StringVar(value=current_conc)
        conc_cb = ttk.Combobox(conc_frame, textvariable=var_conc, values=conc_names, width=15, state="readonly")
        conc_cb.pack(side="left", padx=(4, 0))

        # === Location ===
        loc_frame = ttk.LabelFrame(frm, text="Location", style="TLabelframe")
        loc_frame.pack(fill="both", expand=True, pady=(0, 8))
        
        selected_loc_ids = list(perfume.outlet_ids) if perfume else []
        
        loc_list_frame = ttk.Frame(loc_frame, style="TFrame")
        loc_list_frame.pack(fill="both", expand=True, padx=8, pady=(4, 0))
        
        loc_listbox = tk.Listbox(loc_list_frame, height=3)
        loc_scrollbar = ttk.Scrollbar(loc_list_frame, orient="vertical", command=loc_listbox.yview)
        loc_listbox.configure(yscrollcommand=loc_scrollbar.set)
        loc_listbox.pack(side="left", fill="both", expand=True)
        loc_scrollbar.pack(side="right", fill="y")
        
        def refresh_loc_listbox():
            loc_listbox.delete(0, "end")
            for oid in selected_loc_ids:
                loc_listbox.insert("end", self.get_outlet_display(oid))
        
        refresh_loc_listbox()
        
        # Add location input
        loc_add_frame = ttk.Frame(loc_frame, style="TFrame")
        loc_add_frame.pack(fill="x", padx=8, pady=4)
        
        loc_names = self.get_all_outlet_names()
        var_new_loc = tk.StringVar()
        loc_entry = ttk.Combobox(loc_add_frame, textvariable=var_new_loc, width=20)
        make_combobox_searchable(loc_entry, loc_names)
        loc_entry.pack(side="left")
        
        def add_location():
            loc_name = var_new_loc.get().strip()
            if not loc_name:
                return
            oid = self.find_or_create_outlet(loc_name)
            if oid and oid not in selected_loc_ids:
                selected_loc_ids.append(oid)
                refresh_loc_listbox()
            var_new_loc.set("")
        
        def delete_location():
            sel = loc_listbox.curselection()
            if sel:
                selected_loc_ids.pop(sel[0])
                refresh_loc_listbox()
        
        def move_loc_up():
            sel = loc_listbox.curselection()
            if sel and sel[0] > 0:
                idx = sel[0]
                selected_loc_ids[idx], selected_loc_ids[idx-1] = selected_loc_ids[idx-1], selected_loc_ids[idx]
                refresh_loc_listbox()
                loc_listbox.selection_set(idx-1)
        
        def move_loc_down():
            sel = loc_listbox.curselection()
            if sel and sel[0] < len(selected_loc_ids) - 1:
                idx = sel[0]
                selected_loc_ids[idx], selected_loc_ids[idx+1] = selected_loc_ids[idx+1], selected_loc_ids[idx]
                refresh_loc_listbox()
                loc_listbox.selection_set(idx+1)
        
        # Button bar
        ttk.Button(loc_add_frame, text="Add", command=add_location, width=5).pack(side="left", padx=(4, 0))
        ttk.Button(loc_add_frame, text="Del", command=delete_location, width=4).pack(side="left", padx=(4, 0))
        ttk.Button(loc_add_frame, text="↑", command=move_loc_up, width=2).pack(side="left", padx=(8, 0))
        ttk.Button(loc_add_frame, text="↓", command=move_loc_down, width=2).pack(side="left", padx=(2, 0))

        # === Tags ===
        tags_frame = ttk.LabelFrame(frm, text="Tags", style="TLabelframe")
        tags_frame.pack(fill="both", expand=True, pady=(0, 8))
        
        selected_tag_names = [self.get_tag_name(tid) for tid in perfume.tag_ids] if perfume else []
        
        tag_list_frame = ttk.Frame(tags_frame, style="TFrame")
        tag_list_frame.pack(fill="both", expand=True, padx=8, pady=(4, 0))
        
        tag_listbox = tk.Listbox(tag_list_frame, height=3)
        tag_scrollbar = ttk.Scrollbar(tag_list_frame, orient="vertical", command=tag_listbox.yview)
        tag_listbox.configure(yscrollcommand=tag_scrollbar.set)
        tag_listbox.pack(side="left", fill="both", expand=True)
        tag_scrollbar.pack(side="right", fill="y")
        
        def refresh_tag_listbox():
            tag_listbox.delete(0, "end")
            for name in selected_tag_names:
                tag_listbox.insert("end", name)
        
        refresh_tag_listbox()
        
        # Add tag input
        tag_add_frame = ttk.Frame(tags_frame, style="TFrame")
        tag_add_frame.pack(fill="x", padx=8, pady=4)
        
        existing_tag_names = self.get_all_tag_names()
        var_new_tag = tk.StringVar()
        tag_entry = ttk.Combobox(tag_add_frame, textvariable=var_new_tag, width=20)
        make_combobox_searchable(tag_entry, existing_tag_names)
        tag_entry.pack(side="left")
        
        def add_tag():
            tag_name = var_new_tag.get().strip()
            if not tag_name:
                return
            if tag_name not in selected_tag_names:
                selected_tag_names.append(tag_name)
                refresh_tag_listbox()
            var_new_tag.set("")
        
        def delete_tag():
            sel = tag_listbox.curselection()
            if sel:
                selected_tag_names.pop(sel[0])
                refresh_tag_listbox()
        
        def move_tag_up():
            sel = tag_listbox.curselection()
            if sel and sel[0] > 0:
                idx = sel[0]
                selected_tag_names[idx], selected_tag_names[idx-1] = selected_tag_names[idx-1], selected_tag_names[idx]
                refresh_tag_listbox()
                tag_listbox.selection_set(idx-1)
        
        def move_tag_down():
            sel = tag_listbox.curselection()
            if sel and sel[0] < len(selected_tag_names) - 1:
                idx = sel[0]
                selected_tag_names[idx], selected_tag_names[idx+1] = selected_tag_names[idx+1], selected_tag_names[idx]
                refresh_tag_listbox()
                tag_listbox.selection_set(idx+1)
        
        # Button bar
        ttk.Button(tag_add_frame, text="Add", command=add_tag, width=5).pack(side="left", padx=(4, 0))
        ttk.Button(tag_add_frame, text="Del", command=delete_tag, width=4).pack(side="left", padx=(4, 0))
        ttk.Button(tag_add_frame, text="↑", command=move_tag_up, width=2).pack(side="left", padx=(8, 0))
        ttk.Button(tag_add_frame, text="↓", command=move_tag_down, width=2).pack(side="left", padx=(2, 0))

        # === Buttons ===
        btns = ttk.Frame(frm, style="TFrame")
        btns.pack(fill="x", pady=(8, 0))
        
        def apply_changes():
            brand = var_brand.get().strip()
            name = var_name.get().strip()
            if not brand or not name:
                messagebox.showwarning("Missing", "Brand and Name are required.")
                return
            
            if is_new:
                # Create new perfume
                brand_id = self.find_or_create_brand_id(brand)
                p = Perfume(id=new_id(), name=name, brand_id=brand_id)
                self.perfumes.append(p)
            else:
                p = perfume
                # Update brand and name
                p.brand_id = self.find_or_create_brand_id(brand)
                p.name = name
            
            # Concentration
            conc_name = var_conc.get()
            if conc_name:
                for cid, cname in self.app_data.concentrations_map.items():
                    if cname == conc_name:
                        p.concentration_id = cid
                        break
            else:
                p.concentration_id = ""
            
            # Locations
            p.outlet_ids = selected_loc_ids.copy()
            
            # Tags
            p.tag_ids = [self.find_or_create_tag_id(name) for name in selected_tag_names]
            
            self._refresh_list()
            self.tree.selection_set(p.id)
            self.tree.focus(p.id)
            self._on_select()
            self.save()
            win.destroy()
        
        ttk.Button(btns, text="Cancel", command=win.destroy).pack(side="right")
        ttk.Button(btns, text="Create" if is_new else "Apply", command=apply_changes).pack(side="right", padx=(0, 8))
        
        # Focus on name entry
        name_entry.focus_set()
    
    def ui_edit_tags(self):
        """Legacy - redirect to ui_edit_info"""
        self.ui_edit_info()
    
    def ui_edit_notes(self):
        """Edit perfume notes and links"""
        pid = self._get_selected_id()
        if not pid:
            messagebox.showinfo("Select", "Please select a perfume first.")
            return
        p = self._get_perfume(pid)
        if not p:
            return
        
        # Initialize if not exists
        if not hasattr(p, 'links') or p.links is None:
            p.links = []
        if not hasattr(p, 'notes') or p.notes is None:
            p.notes = []

        win = tk.Toplevel(self)
        win.title("Notes & Links")
        win.configure(bg=COLORS["bg"])
        win.geometry("550x550")
        win.transient(self)

        frm = ttk.Frame(win, style="TFrame")
        frm.pack(fill="both", expand=True, padx=12, pady=12)

        brand_display = self.get_brand_name(p.brand_id)
        ttk.Label(frm, text=f"{brand_display} – {p.name}", style="TLabel", 
                  font=("TkDefaultFont", 12, "bold")).pack(anchor="w", pady=(0, 12))

        # Helper to extract domain from URL
        def get_label_from_url(url: str) -> str:
            try:
                from urllib.parse import urlparse
                parsed = urlparse(url)
                return parsed.netloc or url
            except:
                return url

        # === Links ===
        links_frame = ttk.LabelFrame(frm, text="Links", style="TLabelframe")
        links_frame.pack(fill="x", pady=(0, 8))
        
        links_list_frame = ttk.Frame(links_frame, style="TFrame")
        links_list_frame.pack(fill="x", padx=8, pady=(4, 0))
        
        links_listbox = tk.Listbox(links_list_frame, height=3)
        links_scrollbar = ttk.Scrollbar(links_list_frame, orient="vertical", command=links_listbox.yview)
        links_listbox.configure(yscrollcommand=links_scrollbar.set)
        links_listbox.pack(side="left", fill="x", expand=True)
        links_scrollbar.pack(side="right", fill="y")
        
        def refresh_links():
            links_listbox.delete(0, "end")
            for link in p.links:
                label = link.get("label") or get_label_from_url(link.get("url", ""))
                links_listbox.insert("end", f"{label} - {link.get('url', '')}")
        
        refresh_links()
        
        # Add link input
        links_add_frame = ttk.Frame(links_frame, style="TFrame")
        links_add_frame.pack(fill="x", padx=8, pady=4)
        
        var_new_link = tk.StringVar()
        ttk.Entry(links_add_frame, textvariable=var_new_link, width=22).pack(side="left")
        
        def add_link():
            url = var_new_link.get().strip()
            if not url:
                return
            label = simpledialog.askstring("Label", "Label (leave empty for auto):", parent=win)
            p.links.append({"label": label or "", "url": url})
            refresh_links()
            var_new_link.set("")
            self.save()
            self._on_select()
        
        def edit_link():
            sel = links_listbox.curselection()
            if not sel:
                messagebox.showinfo("Select", "Please select a link first.", parent=win)
                return
            idx = sel[0]
            link = p.links[idx]
            
            new_url = simpledialog.askstring("Edit URL", "URL:", initialvalue=link.get("url", ""), parent=win)
            if new_url is None:
                return
            new_label = simpledialog.askstring("Edit Label", "Label (leave empty for auto):", 
                                              initialvalue=link.get("label", ""), parent=win)
            if new_label is None:
                return
            p.links[idx] = {"label": new_label or "", "url": new_url}
            refresh_links()
            self.save()
            self._on_select()
        
        def delete_link():
            sel = links_listbox.curselection()
            if sel:
                p.links.pop(sel[0])
                refresh_links()
                self.save()
                self._on_select()
        
        def move_link_up():
            sel = links_listbox.curselection()
            if sel and sel[0] > 0:
                idx = sel[0]
                p.links[idx], p.links[idx-1] = p.links[idx-1], p.links[idx]
                refresh_links()
                links_listbox.selection_set(idx-1)
                self.save()
                self._on_select()
        
        def move_link_down():
            sel = links_listbox.curselection()
            if sel and sel[0] < len(p.links) - 1:
                idx = sel[0]
                p.links[idx], p.links[idx+1] = p.links[idx+1], p.links[idx]
                refresh_links()
                links_listbox.selection_set(idx+1)
                self.save()
                self._on_select()
        
        # Button bar
        ttk.Button(links_add_frame, text="Add", command=add_link, width=5).pack(side="left", padx=(4, 0))
        ttk.Button(links_add_frame, text="Edit", command=edit_link, width=5).pack(side="left", padx=(4, 0))
        ttk.Button(links_add_frame, text="Del", command=delete_link, width=4).pack(side="left", padx=(4, 0))
        ttk.Button(links_add_frame, text="↑", command=move_link_up, width=2).pack(side="left", padx=(8, 0))
        ttk.Button(links_add_frame, text="↓", command=move_link_down, width=2).pack(side="left", padx=(2, 0))

        # === Notes ===
        notes_frame = ttk.LabelFrame(frm, text="Notes", style="TLabelframe")
        notes_frame.pack(fill="both", expand=True, pady=(0, 8))
        
        # Notes list with scrollbar
        notes_list_frame = ttk.Frame(notes_frame, style="TFrame")
        notes_list_frame.pack(fill="both", expand=True, padx=8, pady=(4, 0))
        
        notes_listbox = tk.Listbox(notes_list_frame, height=6)
        notes_scrollbar = ttk.Scrollbar(notes_list_frame, orient="vertical", command=notes_listbox.yview)
        notes_listbox.configure(yscrollcommand=notes_scrollbar.set)
        
        notes_listbox.pack(side="left", fill="both", expand=True)
        notes_scrollbar.pack(side="right", fill="y")
        
        def refresh_notes():
            notes_listbox.delete(0, "end")
            for note in p.notes:
                preview = note.content[:50] + "..." if len(note.content) > 50 else note.content
                preview = preview.replace("\n", " ")
                notes_listbox.insert("end", f"[{note.title}] {preview}")
        
        refresh_notes()
        
        # Note action buttons
        notes_btn_frame = ttk.Frame(notes_frame, style="TFrame")
        notes_btn_frame.pack(fill="x", padx=8, pady=4)
        
        def add_note():
            self._open_note_editor(win, p, None, refresh_notes)
        
        def edit_note():
            sel = notes_listbox.curselection()
            if not sel:
                messagebox.showinfo("Select", "Please select a note first.", parent=win)
                return
            idx = sel[0]
            self._open_note_editor(win, p, idx, refresh_notes)
        
        def delete_note():
            sel = notes_listbox.curselection()
            if not sel:
                messagebox.showinfo("Select", "Please select a note first.", parent=win)
                return
            idx = sel[0]
            note = p.notes[idx]
            if messagebox.askyesno("Delete Note", f"Delete note '{note.title}'?", parent=win):
                p.notes.pop(idx)
                refresh_notes()
                self.save()
                self._on_select()
        
        def move_up():
            sel = notes_listbox.curselection()
            if not sel or sel[0] == 0:
                return
            idx = sel[0]
            p.notes[idx], p.notes[idx-1] = p.notes[idx-1], p.notes[idx]
            refresh_notes()
            notes_listbox.selection_set(idx-1)
            self.save()
            self._on_select()
        
        def move_down():
            sel = notes_listbox.curselection()
            if not sel or sel[0] >= len(p.notes) - 1:
                return
            idx = sel[0]
            p.notes[idx], p.notes[idx+1] = p.notes[idx+1], p.notes[idx]
            refresh_notes()
            notes_listbox.selection_set(idx+1)
            self.save()
            self._on_select()
        
        ttk.Button(notes_btn_frame, text="Add", command=add_note, width=8).pack(side="left", padx=(0, 4))
        ttk.Button(notes_btn_frame, text="Edit", command=edit_note, width=8).pack(side="left", padx=(0, 4))
        ttk.Button(notes_btn_frame, text="Delete", command=delete_note, width=8).pack(side="left", padx=(0, 4))
        ttk.Button(notes_btn_frame, text="↑", command=move_up, width=3).pack(side="left", padx=(8, 2))
        ttk.Button(notes_btn_frame, text="↓", command=move_down, width=3).pack(side="left")
        
        notes_listbox.bind("<Double-1>", lambda e: edit_note())

        # === Close button ===
        ttk.Button(frm, text="Close", command=win.destroy).pack(anchor="e", pady=(8, 0))
    
    def _open_note_editor(self, parent_win, perfume: Perfume, note_idx: Optional[int], on_save):
        """Open note editor dialog for add/edit"""
        is_edit = note_idx is not None
        note = perfume.notes[note_idx] if is_edit else None
        
        win = tk.Toplevel(parent_win)
        win.title("Edit Note" if is_edit else "Add Note")
        win.configure(bg=COLORS["bg"])
        win.geometry("450x350")
        win.transient(parent_win)
        win.grab_set()
        
        frm = ttk.Frame(win, style="TFrame")
        frm.pack(fill="both", expand=True, padx=12, pady=12)
        
        # Title
        title_frame = ttk.Frame(frm, style="TFrame")
        title_frame.pack(fill="x", pady=(0, 8))
        
        ttk.Label(title_frame, text="Title:", style="TLabel").pack(side="left", padx=(0, 8))
        var_title = tk.StringVar(value=note.title if is_edit else "Note")
        title_entry = ttk.Entry(title_frame, textvariable=var_title, width=30)
        title_entry.pack(side="left", fill="x", expand=True)
        
        # Quick title buttons
        quick_btn_frame = ttk.Frame(frm, style="TFrame")
        quick_btn_frame.pack(fill="x", pady=(0, 8))
        
        for quick_title in NOTE_QUICK_TITLES:
            btn = ttk.Button(quick_btn_frame, text=quick_title, 
                           command=lambda t=quick_title: var_title.set(t), width=10)
            btn.pack(side="left", padx=(0, 4))
        
        # Buttons - pack FIRST at bottom so they don't get pushed out
        btn_frame = ttk.Frame(frm, style="TFrame")
        btn_frame.pack(side="bottom", fill="x", pady=(12, 0))
        
        # Content - now can expand in remaining space
        ttk.Label(frm, text="Content:", style="TLabel").pack(anchor="w", pady=(0, 4))
        
        content_frame = ttk.Frame(frm, style="TFrame")
        content_frame.pack(fill="both", expand=True)
        
        content_text = tk.Text(content_frame, wrap="word", 
                              font=("TkDefaultFont", 10),
                              bg=COLORS["bg"], fg=COLORS["text"])
        content_scrollbar = ttk.Scrollbar(content_frame, orient="vertical", command=content_text.yview)
        content_text.configure(yscrollcommand=content_scrollbar.set)
        
        content_text.pack(side="left", fill="both", expand=True)
        content_scrollbar.pack(side="right", fill="y")
        
        if is_edit:
            content_text.insert("1.0", note.content)
        
        def save_note():
            title = var_title.get().strip() or "Note"
            content = content_text.get("1.0", "end-1c").strip()
            
            if not content:
                messagebox.showwarning("Empty", "Please enter some content.", parent=win)
                return
            
            if is_edit:
                perfume.notes[note_idx].title = title
                perfume.notes[note_idx].content = content
            else:
                new_note = Note(
                    id=new_id(),
                    title=title,
                    content=content,
                    created_at=now_ts()
                )
                perfume.notes.append(new_note)
            
            self.save()
            self._on_select()
            on_save()
            win.destroy()
        
        # Save button on the left (more prominent), Cancel on right
        save_btn = ttk.Button(btn_frame, text="💾 Save", command=save_note, width=12)
        save_btn.pack(side="left")
        ttk.Button(btn_frame, text="Cancel", command=win.destroy).pack(side="right")

    def ui_add_note(self):
        """Quick add note - opens note editor dialog"""
        pid = self._get_selected_id()
        if not pid:
            messagebox.showinfo("Select", "Please select a perfume first.")
            return
        p = self._get_perfume(pid)
        if not p:
            return
        
        # Initialize notes if not exists
        if not hasattr(p, 'notes') or p.notes is None:
            p.notes = []
        
        self._open_note_editor(self, p, None, lambda: self._on_select())

    def quick_event(self, event_type: str):
        """
        One-click event insert:
          - uses last known location if exists
        """
        pid = self._get_selected_id()
        if not pid:
            messagebox.showinfo("Select", "Please select a perfume first.")
            return
        p = self._get_perfume(pid)
        if not p:
            return

        # Pick a reasonable default location (mouse-first, no typing)
        loc = ""
        if p.events:
            loc = p.events[-1].location or ""

        e = Event(
            id=new_id(),
            perfume_id=pid,
            event_type=event_type,
            timestamp=now_ts(),
            location=loc,
            ml_delta=None,
            note="",
        )
        p.events.append(e)

        self._refresh_list()
        self.tree.selection_set(p.id)
        self.tree.focus(p.id)
        self._on_select()
        self.save()

    def quick_buy(self, ml_delta: float):
        """
        Mouse-first: quick ml delta event.
          - positive => buy
          - negative => use/sell style (kept as buy for prototype simplicity)
        """
        pid = self._get_selected_id()
        if not pid:
            messagebox.showinfo("Select", "Please select a perfume first.")
            return
        p = self._get_perfume(pid)
        if not p:
            return

        loc = ""
        if p.events:
            loc = p.events[-1].location or ""

        # Heuristic: positive = buy, negative = "sell"/"use"
        et = "buy" if ml_delta >= 0 else "sell"

        e = Event(
            id=new_id(),
            perfume_id=pid,
            event_type=et,
            timestamp=now_ts(),
            location=loc,
            ml_delta=float(ml_delta),
            note="quick",
        )
        p.events.append(e)

        self._refresh_list()
        self.tree.selection_set(p.id)
        self.tree.focus(p.id)
        self._on_select()
        self.save()

    def set_my_vote(self, perfume_id: str, block_name: str, keys: List[str], chosen_key: Optional[str]):
        """
        Mouse-first vote interaction for a block:
          - season_time_votes: multi-choice (toggle each option independently)
          - Other blocks: single-choice (select one, deselect others)
          - Right click / None => clear all
        Data layout:
          p.my_votes["my_<block_name>"] = { option_key: 0/1 }
        """
        p = self._get_perfume(perfume_id)
        if not p:
            return

        my_block_key = MY_PREFIX + block_name
        if p.my_votes is None:
            p.my_votes = {}

        block = dict(p.my_votes.get(my_block_key, {}) or {})

        # Multi-choice for season_time_votes, single-choice for others
        is_multi_choice = (block_name == "season_time_votes")

        if chosen_key is None:
            # Right click or clear: remove all
            for k in keys:
                block[k] = 0
        else:
            # Get current state
            was_on = int(block.get(chosen_key, 0) or 0) > 0
            
            if is_multi_choice:
                # Multi-choice: toggle this option without affecting others
                block[chosen_key] = 0 if was_on else 1
            else:
                # Single-choice: clear all then set this one (unless already on)
                for k in keys:
                    block[k] = 0
                if not was_on:
                    block[chosen_key] = 1

        # Remove empty blocks to keep JSON clean
        if sum(int(block.get(k, 0) or 0) for k in keys) <= 0:
            if my_block_key in p.my_votes:
                del p.my_votes[my_block_key]
        else:
            p.my_votes[my_block_key] = block

        self._on_select()
        self.save()

    def ui_edit_fragrantica(self):
        """
        Mouse-first Fragrantica data input:
          - Input raw vote counts for all 6 categories
          - Each category shows all options with number inputs
        """
        pid = self._get_selected_id()
        if not pid:
            messagebox.showinfo("Select", "Please select a perfume first.")
            return
        p = self._get_perfume(pid)
        if not p:
            return

        win = tk.Toplevel(self)
        win.title("Edit Fragrantica Vote Data")
        win.configure(bg=COLORS["bg"])
        win.geometry("550x500")
        win.resizable(True, True)

        main_frame = ttk.Frame(win, style="TFrame")
        main_frame.pack(fill="both", expand=True, padx=12, pady=12)

        brand_display = self.get_brand_name(p.brand_id)
        ttk.Label(main_frame, text=f"{brand_display} – {p.name}", style="TLabel", font=("TkDefaultFont", 12, "bold")).pack(anchor="w", pady=(0, 10))
        
        # URL input
        url_frame = ttk.Frame(main_frame, style="TFrame")
        url_frame.pack(fill="x", pady=(0, 10))
        ttk.Label(url_frame, text="Fragrantica URL:", style="TLabel").pack(side="left")
        var_url = tk.StringVar(value=(p.fragrantica or {}).get("url", ""))
        url_entry = ttk.Entry(url_frame, textvariable=var_url, width=45)
        url_entry.pack(side="left", padx=(8, 0), fill="x", expand=True)
        
        ttk.Label(main_frame, text="Enter raw vote counts from Fragrantica:", style="Muted.TLabel").pack(anchor="w", pady=(0, 10))

        # Create a scrollable frame for all vote blocks
        canvas_frame = ttk.Frame(main_frame, style="TFrame")
        canvas_frame.pack(fill="both", expand=True)
        
        canvas = tk.Canvas(canvas_frame, bg=COLORS["bg"], highlightthickness=0)
        scrollbar = ttk.Scrollbar(canvas_frame, orient="vertical", command=canvas.yview)
        scrollable_frame = ttk.Frame(canvas, style="TFrame")

        scrollable_frame.bind(
            "<Configure>",
            lambda e: canvas.configure(scrollregion=canvas.bbox("all"))
        )

        canvas.create_window((0, 0), window=scrollable_frame, anchor="nw")
        canvas.configure(yscrollcommand=scrollbar.set)

        canvas.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")
        
        # Bind mousewheel to canvas
        def _on_mousewheel(event):
            try:
                if not canvas.winfo_exists():
                    return
                canvas.yview_scroll(int(-1*(event.delta/120)), "units")
            except tk.TclError:
                pass  # Widget was destroyed
        canvas.bind("<Enter>", lambda e: canvas.bind_all("<MouseWheel>", _on_mousewheel))
        canvas.bind("<Leave>", lambda e: canvas.unbind_all("<MouseWheel>"))

        # Load existing Fragrantica data
        fr = p.fragrantica or {}
        
        # Store entry widgets for each vote option
        entry_map: Dict[str, Dict[str, tk.StringVar]] = {}

        for block_name, keys, title in VOTE_BLOCKS:
            block_frame = ttk.LabelFrame(scrollable_frame, text=title, style="TFrame")
            block_frame.pack(fill="x", padx=5, pady=8)

            entry_map[block_name] = {}
            existing_votes = fr.get(block_name, {}) or {}

            for i, key in enumerate(keys):
                row_frame = ttk.Frame(block_frame, style="TFrame")
                row_frame.pack(fill="x", padx=8, pady=2)

                ttk.Label(row_frame, text=f"{display_label(key)}:", style="TLabel", width=18).pack(side="left")
                
                var = tk.StringVar(value=str(existing_votes.get(key, 0) or 0))
                entry = ttk.Entry(row_frame, textvariable=var, width=12)
                entry.pack(side="left", padx=(8, 0))
                
                entry_map[block_name][key] = var

        # Buttons
        btn_frame = ttk.Frame(main_frame, style="TFrame")
        btn_frame.pack(fill="x", pady=(12, 0))
        
        ttk.Button(btn_frame, text="Clear All", command=lambda: self._clear_fragrantica_inputs(entry_map)).pack(side="left")
        ttk.Button(btn_frame, text="Cancel", command=win.destroy).pack(side="right", padx=(8, 0))
        ttk.Button(btn_frame, text="Save", command=lambda: self._save_fragrantica(p, entry_map, var_url.get(), win)).pack(side="right")

    def _clear_fragrantica_inputs(self, entry_map: Dict[str, Dict[str, tk.StringVar]]):
        """Clear all Fragrantica input fields"""
        for block_name, vars_dict in entry_map.items():
            for key, var in vars_dict.items():
                var.set("0")

    def _save_fragrantica(self, p: Perfume, entry_map: Dict[str, Dict[str, tk.StringVar]], url: str, win: tk.Toplevel):
        """Save Fragrantica vote data to perfume"""
        if p.fragrantica is None:
            p.fragrantica = {}
        
        # Parse and validate all inputs
        for block_name, vars_dict in entry_map.items():
            block_data = {}
            for key, var in vars_dict.items():
                val_str = var.get().strip()
                try:
                    val = int(val_str) if val_str else 0
                    if val < 0:
                        messagebox.showwarning("Invalid", f"Vote counts must be non-negative numbers.\nInvalid: {block_name}.{key}")
                        return
                    block_data[key] = val
                except ValueError:
                    messagebox.showwarning("Invalid", f"Vote counts must be integers.\nInvalid: {block_name}.{key} = '{val_str}'")
                    return
            
            p.fragrantica[block_name] = block_data
        
        # Save URL
        url = url.strip()
        if url:
            p.fragrantica["url"] = url
        elif "url" in p.fragrantica:
            del p.fragrantica["url"]
        
        # Add metadata
        p.fragrantica["source"] = "fragrantica"
        p.fragrantica["last_updated"] = now_ts()
        
        self._on_select()
        self._refresh_list()
        self.save()
        win.destroy()

    def ui_delete_perfume(self):
        """
        Mouse-first:
          - Right-click context menu -> Delete
        """
        pid = self._get_selected_id()
        if not pid:
            return
        p = self._get_perfume(pid)
        if not p:
            return

        brand_display = self.get_brand_name(p.brand_id)
        if not messagebox.askyesno("Delete", f"Delete this perfume?\n\n{brand_display} – {p.name}\n\nThis cannot be undone."):
            return

        self.perfumes = [x for x in self.perfumes if x.id != pid]
        self.tree.delete(*self.tree.get_children())
        self.detail_title.config(text="(no selection)")
        self.state_label.config(text="")
        # Clear notes display
        for widget in self.notes_display_frame.winfo_children():
            widget.destroy()
        for block in self.vote_blocks.values():
            block.set_data("", {}, {}, False)  # clear render

        self._refresh_list()
        self.save()


if __name__ == "__main__":
    App().mainloop()
