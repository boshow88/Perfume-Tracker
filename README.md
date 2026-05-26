# Perfume Tracker

A personal fragrance collection tracking app with **ID-based data model** and **split-panel UI** for high information density.

---

## 📋 Table of Contents

- [Features](#features)
- [Web Version](#web-version)
- [Getting Started](#getting-started)
- [Interface Guide](#interface-guide)
- [Core Features](#core-features)
- [Data Structure](#data-structure)
- [Technical Architecture](#technical-architecture)

---

## ✨ Features

### Core Features
- **ID-Based Data Model** - Unified management of brands/tags/locations; rename once, update everywhere
- **Split-Panel UI** - Left panel for list, right panel for details
- **Manage Data** - Centralized management of brands, concentrations, locations, tags, purchase types
- **Advanced Filtering** - Dual-slider range filters with Include/Exclude modes
- **Advanced Sorting** - Multi-dimensional, multi-level sorting
- **Quick Event** - Fast event logging for testing fragrances
- **Fragrantica Integration** - Dual-track display of official data + personal votes
- **Links Management** - Save and open external links with one click
- **Event-Driven State** - All states derived from event history

---

## 🌐 Web Version

A read-only web version for browsing your collection on any device:

**URL**: https://boshow88.github.io/Perfume-Tracker/web/

**Features**:
- Search, Filter, Sort (mirrors desktop functionality)
- View Fragrantica data and personal votes
- Settings (font size, owned ml formats - temporary, resets on refresh)
- Responsive design for mobile and desktop
- Real-time sync with your `perfumes.json` data

**Note**: Read-only - cannot add or edit perfumes (use the desktop app for that)

---

## 🚀 Getting Started

### Requirements
- Python 3.7+
- tkinter (usually pre-installed with Python)

### Run
```bash
python perfume_tracker.py
```

### First Use
1. The app will automatically create a `data` folder
2. Click "Add" to add your first fragrance
3. Select a fragrance to use the right panel buttons for editing
4. All changes are auto-saved to `data/perfumes.json`

---

## 🖥 Interface Guide

### Main Layout
```
┌─────────────────────────┬────────────────────────────┐
│ [Add] [Manage]          │ [Info][Memo][Events]       │
│ [Sort][Filter][________ │ [Fragrantica]              │
│ Search________________] │ Date:[____] @[____]        │
│                         │ [Smell] [Skin]             │
│ ┌─────────────────────┐ │                            │
│ │   Perfume Treeview  │ │ Brand - Name               │
│ │                     │ │ State (gray, derived)      │
│ │                     │ │ Tag1, Tag2 (+N more)       │
│ │                     │ │                            │
│ │                     │ │ ▶ Rating    ████████ 4.2   │
│ │                     │ │ ▶ Longevity ████     3.1   │
│ │                     │ │ ...                        │
│ │                     │ │                            │
│ └─────────────────────┘ │ Fragrantica ↗ / Links / Notes │
└─────────────────────────┴────────────────────────────┘
      Left: General Actions       Right: Selected Perfume Details
```

### Left Panel Buttons

Listed left-to-right as they appear in the toolbar:

| Button | Function |
|--------|----------|
| Add | Add new perfume (insert position depends on sort state and settings) |
| Manage | Manage master data (Brand/Concentration/Location/Tag/Purchase Type) |
| ⚙ | Settings (font size, owned ml formats, insert position) |
| (search box) | Text search |
| ↑ / ↓ | Move selected perfume up/down in manual order (only when no sort is active; Alt+↑/↓ shortcuts available) |
| Lock Order | Apply current sort as the new manual order for ALL perfumes (only when sort is active; ignores filter) |
| Sort | Multi-dimensional sorting (button changes color when active) |
| Filter | Advanced filtering (button changes color when active) |
| Search | Run the text search |


### Right Panel Buttons

| Button | Function |
|--------|----------|
| Info | Edit basic info (Brand/Name/Concentration/Location/Tags) |
| Memo | Edit Links and Notes |
| Events | Edit event history |
| Fragrantica | Edit Fragrantica vote data |
| Date / @ / Smell / Skin | Quick Event logging |

### Treeview Columns
- **Always visible**: Brand, Name
- **Toggleable**: Concentration, Year (hidden by default), Location
- Toggle via either: **right-click on header**, or **Settings → Columns**
- Visibility is persistent (stored in `perfumes.json`)
- Double-click a perfume to open the Info edit dialog
- **Hover tooltip**: Hover on any cell to see full content (useful for truncated text)
- **Multi-select**: Ctrl-click / Shift-click to select multiple perfumes
  - Sort → "Apply to Selection" reorders the selected perfumes in place
  - Right-click → "Delete N Perfumes" (or press **Delete**) removes them all in one confirmation

### Right Panel Detail
- **Brand**: Displayed as title (first line), hover for full text
- **Name · Concentration · Year**: Displayed as subtitle (e.g., "Sauvage · EdP · 2015"). Year omitted if unset.
- **State**: Displayed as gray text (e.g., "Owned", "Smelled")
- **Tags**: Displayed as gray text, click to expand popup with full tag list
- **Links**: Click to open, hover for full URL

---

## 🔧 Core Features

### 1. Search

Enter keywords in the search box and press Enter or click the Search button.

**Search Scope**:
- Brand name
- Perfume name
- Tag names
- Note titles and content

**How it works**:
- Combines all fields above into a single string
- Checks if the keyword appears (case-insensitive)
- Works simultaneously with Filter and Sort

### 2. Manage Data

Centralized management of 5 data types; rename once, update everywhere:

| Tab | Description | Examples |
|-----|-------------|----------|
| Brands | Brand names | Dior, Chanel, Tom Ford |
| Locations | Testing locations (with region) | Sephora (NYC), Nordstrom (LA) |
| Concentrations | Concentration types | Abs., Extrait, Parfum, EdP, EdT, EdC, EF |
| Tags | Tags | woody, fresh, office, summer |
| Purchase Types | Purchase types | Full Bottle, Decant, Gift |

**Functions**:
- **Rename**: Rename once, all linked perfumes update automatically
- **Merge**: Combine multiple items into one
- **Delete**: Unused items deleted with single confirmation; in-use items require two extra confirmations (references will be removed from all linked perfumes/events)
- **Reorder**: Manually adjust display order (Custom mode only)

**Sort Modes** (persistent, auto-updates on data change):
- **Name**: Sort alphabetically (default for Brand, Location)
- **Count**: Sort by usage count (most used first)
- **Custom**: Manual order, preserved across sessions (default for Tags, Concentrations, Format)

### 3. Filter

| Category | Description |
|----------|-------------|
| Brand | Dropdown + list display, select from existing items only |
| Concentration | Dropdown + list display, select from existing items only |
| Location | Dropdown + list display, match any selected location |
| State | Owned / Smelled / Wishlist multi-select |
| Season/Time | Spring/Summer/Fall/Winter/Day/Night multi-select |
| Score | Dual-slider range (min~max), Include/Exclude modes |
| Year | From / To entries; leave empty for no bound. Perfumes without a year are excluded when active. |
| Gender | Multi-select gender preference |
| Tags | Dropdown + list display, Match Any (OR) / Match All (AND) |
| Vote Status | Has personal vote / Has Fragrantica data |

**Null Handling** (for Score filters):
- **Include mode**: Perfumes without data are hidden
- **Exclude mode**: Perfumes without data are shown

**Currently Active**: Dialog header shows all active filter conditions

### 4. Sort

| Dimension | Options |
|-----------|---------|
| Brand | A→Z / Z→A |
| Name | A→Z / Z→A |
| Location | Ascending / Descending (by manage order, supports multi-location) |
| Year | Ascending (old→new) / Descending (new→old); perfumes without a year sort to the end |
| Rating | High→Low / Low→High |
| Longevity | High→Low / Low→High |
| Sillage | High→Low / Low→High |
| Gender | Female First / Male First / Unisex First |
| Price Value | High→Low / Low→High |
| State | Owned First / Smelled First |

Supports multi-level sorting (e.g., Gender first, then Rating, then Name).

**Manual Order**:
- The perfume list has an underlying manual order (your real, persistent order).
- When no sort is active, the list shows this manual order; use ↑/↓ buttons or Alt+↑/↓ to rearrange.
  - Reorder operations only swap among visible (filtered) items; hidden items keep their position.
  - ↑/↓ require exactly one selected perfume (disabled when multiple are selected).
- When a sort is active, the manual order is preserved silently behind the scenes:
  - ↑/↓ are disabled; Lock Order becomes available.
  - Click **Lock Order** to commit the current sort view as the new manual order (applied to ALL perfumes, ignoring filter). Sort is cleared automatically afterward.
- See Settings for how new perfumes are inserted while a sort is active.

**Sort Dialog buttons** (hover for in-app tooltips):
- **Apply** — Temporary view sort. The manual order in the list is NOT modified. Use **Lock Order** on the main window to commit the current view into the manual order.
- **Apply to Selection (N)** — Appears only when 2+ perfumes are selected (Ctrl-click / Shift-click to multi-select). Permanently reorders the selected perfumes **in place**: each one is rewritten back to its own original position, sorted by the chosen dimensions. Unselected perfumes are not affected. A confirmation dialog appears before the rewrite.
  - Useful when you have a contiguous group (e.g., all perfumes of one brand) that you want to reorder internally without disturbing the rest of the list.
  - "In place" means positions are preserved; this feature does NOT move perfumes around or group them together.

### 5. Quick Event

Right panel provides quick logging:
- **Date**: Enter date (YYYY-MM-DD), leave empty for today
- **@**: Select Location
- **Smell**: Log smell event (paper strip test)
- **Skin**: Log skin event (skin test)

Date and Location persist when switching perfumes for batch logging.

### 6. Fragrantica Voting

**Fragrantica URL**: You can save the Fragrantica page URL (must be from fragrantica.com). If set, the "Fragrantica ↗" title in the right panel becomes clickable and shows the URL on hover.

**Import Text**: Click "Import Text" button to quickly import vote data from Fragrantica:
1. Open the perfume page on Fragrantica
2. Select all (Ctrl+A) and copy (Ctrl+C)
3. Paste into the import dialog and click "Parse & Fill"
4. The parser extracts vote counts from all 6 dimensions automatically

**6 Rating Dimensions**:
1. **Rating** - love / like / ok / dislike / hate
2. **Longevity** - eternal / long / moderate / weak / poor
3. **Sillage** - enormous / strong / moderate / intimate
4. **Gender** - female / more_female / unisex / more_male / male (score: female=1, male=5)
5. **Value** - excellent / good / fair / expensive / overpriced
6. **When to Wear** - spring / summer / fall / winter / day / night

**Collapsed-state title row** (at-a-glance):
- Numeric dimensions show a mini spectrum with two dots:
  - Blue circle (larger) = Fragrantica weighted score
  - Orange circle (smaller, drawn on top) = Personal score
  - Endpoint labels: `1` / `5` for ratings, `♀` / `♂` for gender (male on the right, matching "high score = right" across all dimensions)
- "When to Wear" shows a 6-slot strip (`SPR SUM FAL WIN DAY NGT`):
  - Blue text = in Fragrantica's top picks
  - Orange text = personally voted
  - Green text = both agree
  - Blank slot = neither side picked it
- Hovering any of these reveals exact numbers (Fragrantica to 2 decimals, personal as integers).

**Expanded-state bars** (click the title or `＋` to expand):
- Blue bar = Fragrantica official data, Orange bar = Personal vote
- Bar background: Gray = Not voted, Dark orange = Voted (click option name to vote/unvote)

**Expand/Collapse**:
- Click ＋/－ on each section to expand/collapse
- Click ＋＋/－－ next to title to expand/collapse all sections
- Button auto-updates only at extremes (all expanded → －－, all collapsed → ＋＋)

### 7. Links & Notes Management

Manage in the Memo dialog:

**Links**:
- Add/Edit links with URL and optional label (in single dialog)
- Empty label displays domain name automatically (e.g., "www.fragrantica.com")
- Reorder with ↑/↓ buttons
- Click links in right panel to open in browser

**Notes**:
- Each note has a Title and Content
- Quick title buttons with ⚙ management (add/delete custom titles)
- Multi-line content with auto-wrap
- Reorder with ↑/↓ buttons

### 8. Settings (⚙)

| Setting | Description |
|---------|-------------|
| Font Size | App-wide font size (live preview, persisted on Save) |
| Columns | Show / hide the optional Treeview columns (Concentration, Year, Location). Also toggleable via right-click on the column headers. |
| Owned ml Formats | Which purchase types count toward the "Owned ml" derived value |
| Auto-detect year on Fragrantica import | When enabled, attempts to extract the release year from imported Fragrantica text. The detected year fills the Year entry in the Fragrantica dialog (overwrite confirmation if a different value was already there). The change is committed only when you press Save. |
| Insert position when sort is active | Where a newly added perfume goes in the **real (manual) order** when a sort is active: **Below selected** (default) / **Append to end** / **Match sort view position** |

---

## 📊 Data Structure

### Perfume
```python
@dataclass
class Perfume:
    id: str                    # UUID
    name: str
    brand_id: str              # → brands_map
    concentration_id: str      # → concentrations_map
    outlet_ids: List[str]      # → outlets_map (multiple)
    tag_ids: List[str]         # → tags_map (multiple)
    year: int                  # Release year (0 = unset)
    created_at: int            # Creation timestamp
    updated_at: int            # Update timestamp
    events: List[Event]
    notes: List[Note]          # Notes with title and content
    links: List[Dict]          # [{"label": "...", "url": "..."}]
    fragrantica: Dict          # Fragrantica vote data
    my_votes: Dict             # Personal vote data
```

### Note
```python
@dataclass
class Note:
    id: str                    # UUID
    title: str                 # Note title (default: "Note")
    content: str               # Note content (multi-line)
    created_at: int            # Creation timestamp
```

### Event
```python
@dataclass
class Event:
    id: str                    # UUID
    perfume_id: str            # Parent perfume ID
    event_type: str            # "smell", "skin", "buy", "sell"
    timestamp: str             # System timestamp (ISO format)
    event_date: str            # User-specified date (YYYY-MM-DD, optional)
    location: str              # Location name
    ml_delta: float            # Volume change (optional)
    price: float               # Price (optional)
    purchase_type: str         # Display name (synced from purchase_types_map)
    purchase_type_id: str      # → purchase_types_map
    note: str                  # Note
```

### Mapping Tables
```python
brands_map: Dict[str, str]           # UUID → Brand name
concentrations_map: Dict[str, str]   # UUID → Concentration name
outlets_map: Dict[str, OutletInfo]   # UUID → {name, region}
tags_map: Dict[str, str]             # UUID → Tag name
purchase_types_map: Dict[str, str]   # UUID → Purchase type name
note_titles_map: Dict[str, str]      # UUID → Quick note title
```

---

## 🛠 Technical Architecture

### Tech Stack
- **Desktop**: Python 3.7+ / tkinter
- **Web**: HTML / CSS / JavaScript (vanilla, no framework)
- **Data Storage**: JSON
- **Hosting**: GitHub Pages (web version)

### File Structure
```
Fragrance/
├── perfume_tracker.py      # Main program (desktop)
├── data/
│   └── perfumes.json       # Data file
├── web/
│   ├── index.html          # Web version
│   ├── style.css
│   └── app.js
└── README.md               # This file
```

### Dependencies
Uses only Python standard library:
- `tkinter` - GUI
- `json` - Data serialization
- `uuid` - ID generation
- `dataclasses` - Data models
- `webbrowser` - Open links

---

## 📄 License

Personal use tool.

---

*Developed with AI assistance (Claude).*
