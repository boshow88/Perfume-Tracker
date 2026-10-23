/**
 * Perfume Tracker - Web Version
 * Reads data from GitHub and displays perfume collection
 */

// ============================================
// Configuration
// ============================================

const CONFIG = {
    dataUrl: getDataUrl(),
};

function getDataUrl() {
    if (window.location.hostname.includes('github.io')) {
        return 'https://raw.githubusercontent.com/boshow88/Perfume-Tracker/main/data/perfumes.json';
    }
    return '../data/perfumes.json';
}

// ============================================
// State
// ============================================

let appData = null;
let perfumes = [];
let filteredPerfumes = [];
let selectedPerfumeId = null;

let brandsMap = {};
// Owned-matching configuration (mirrors desktop AppData.include_decant /
// include_past_owned).  Full bottles always count; these flags broaden the
// definition.  See deriveState / getStateCategory for the rules.
let includeDecant = false;
let includePastOwned = false;
let voteSource = 'fragrantica';        // 'fragrantica' | 'personal' | 'fallback'
let concentrationsMap = {};
let outletsMap = {};
let tagsMap = {};
let noteTitlesMap = {};
let purchaseTypesMap = {};

let filters = {
    states: [],
    seasons: [],
    times: [],
    genders: [],
    hasMyVote: false,
    hasFragrantica: false,
    brands: [],
    concentrations: [],
    locations: [],
    tags: [],
    tagsLogic: 'or', // 'or' or 'and'
    // Score ranges: { min, max, exclude }
    rating: { min: 0, max: 5, exclude: false },
    longevity: { min: 0, max: 5, exclude: false },
    sillage: { min: 0, max: 4, exclude: false },
    value: { min: 0, max: 5, exclude: false },
    // Per-dimension vote-status gate; mirrors the desktop "voted_status" filter.
    // 'any' | 'has_fr' (Has Fragrantica vote) | 'has_my' (Has Personal vote).
    // Independent of the global voteSource — see desktop FilterDialog notes.
    votedStatus: {
        rating: 'any',
        longevity: 'any',
        sillage: 'any',
        value: 'any',
        gender: 'any'
    },
    // Year range: 0 means no bound on that side
    yearMin: 0,
    yearMax: 0
};

// Multi-level sort: array of {field, ascending}
let sortDimensions = [];

// Fragrantica vote categories - matches JSON structure and desktop app
const VOTE_BLOCKS = [
    {
        key: 'rating_votes',
        myKey: 'my_rating_votes',
        label: 'Rating',
        keys: ['love', 'like', 'ok', 'dislike', 'hate'],
        weights: [5, 4, 3, 2, 1],
        maxScore: 5,
        normalize: 'sum'
    },
    {
        key: 'season_time_votes',
        myKey: 'my_season_time_votes',
        label: 'When to Wear',
        keys: ['spring', 'summer', 'fall', 'winter', 'day', 'night'],
        weights: null,  // no score for season/time
        maxScore: null,
        normalize: 'max'
    },
    {
        key: 'longevity_votes',
        myKey: 'my_longevity_votes',
        label: 'Longevity',
        keys: ['eternal', 'long', 'moderate', 'weak', 'poor'],
        weights: [5, 4, 3, 2, 1],
        maxScore: 5,
        normalize: 'sum'
    },
    {
        key: 'sillage_votes',
        myKey: 'my_sillage_votes',
        label: 'Sillage',
        keys: ['enormous', 'strong', 'moderate', 'intimate'],
        weights: [4, 3, 2, 1],
        maxScore: 4,
        normalize: 'sum'
    },
    {
        key: 'gender_votes',
        myKey: 'my_gender_votes',
        label: 'Gender',
        keys: ['male', 'more_male', 'unisex', 'more_female', 'female'],
        weights: [5, 4, 3, 2, 1],  // male=5 → female=1 (aligned with all other dims; same as desktop)
        maxScore: 5,
        normalize: 'sum'
    },
    {
        key: 'value_votes',
        myKey: 'my_value_votes',
        label: 'Price Value',
        keys: ['excellent', 'good', 'fair', 'expensive', 'overpriced'],
        weights: [5, 4, 3, 2, 1],
        maxScore: 5,
        normalize: 'sum'
    }
];

// ============================================
// Initialization
// ============================================

document.addEventListener('DOMContentLoaded', init);

async function init() {
    setupEventListeners();
    initDrafts();
    await loadData();
}

function setupEventListeners() {
    // Search
    document.getElementById('search-input').addEventListener('input', debounce(handleSearch, 300));
    
    // Sort modal
    document.getElementById('sort-btn').addEventListener('click', openSortModal);
    document.getElementById('sort-apply').addEventListener('click', applySortFromModal);
    document.getElementById('sort-clear').addEventListener('click', resetSort);
    
    // Filter modal
    document.getElementById('filter-btn').addEventListener('click', openFilterModal);
    document.getElementById('filter-apply').addEventListener('click', applyFilters);
    document.getElementById('filter-clear').addEventListener('click', clearFilters);
    
    // Settings modal
    document.getElementById('settings-btn').addEventListener('click', openSettingsModal);
    document.getElementById('settings-apply').addEventListener('click', applySettings);
    document.getElementById('settings-reset').addEventListener('click', resetSettings);
    document.getElementById('settings-font-size').addEventListener('input', previewFontSize);
    
    // Score range sliders
    initScoreRangeSliders();
    
    // Modal close buttons
    document.querySelectorAll('.modal-close').forEach(btn => {
        btn.addEventListener('click', closeAllModals);
    });
    document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
        backdrop.addEventListener('click', closeAllModals);
    });
    
    // Detail panel
    document.getElementById('close-detail').addEventListener('click', closeDetailPanel);
    document.getElementById('toggle-all-votes').addEventListener('click', toggleAllVoteBlocks);
}

// ============================================
// Data Loading
// ============================================

async function loadData() {
    try {
        const response = await fetch(CONFIG.dataUrl);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        appData = await response.json();
        
        brandsMap = appData.brands_map || {};
        concentrationsMap = appData.concentrations_map || {};
        outletsMap = appData.outlets_map || {};
        tagsMap = appData.tags_map || {};
        noteTitlesMap = appData.note_titles_map || {};
        purchaseTypesMap = appData.purchase_types_map || {};
        // Owned-matching flags (new schema; legacy
        // owned_ml_include_formats is no longer consulted -- the new code and
        // data ship together, so missing keys just fall back to the safe
        // historical defaults of False / False).
        includeDecant = !!appData.include_decant;
        includePastOwned = !!appData.include_past_owned;

        // Vote source for sort/filter (mirrors desktop AppData.vote_source).
        // Web is read-only: we honour the value the desktop saved, and any
        // change made via web Settings stays in-memory for this session.
        const savedSource = appData.vote_source;
        if (['fragrantica', 'personal', 'fallback'].includes(savedSource)) {
            voteSource = savedSource;
        } else {
            voteSource = 'fragrantica';
        }

        // Apply font size setting (convert pt to px, roughly 1.33x)
        const fontSizePt = appData.font_size || 10;
        const fontSizePx = Math.round(fontSizePt * 1.33);
        document.documentElement.style.fontSize = fontSizePx + 'px';

        perfumes = appData.perfumes || [];

        applyFiltersAndSort();
        populateFilterOptions();
        
    } catch (error) {
        console.error('Failed to load data:', error);
        document.getElementById('perfume-list').innerHTML = `
            <div class="no-results">
                <p>Failed to load data</p>
                <p style="font-size: 0.85rem; margin-top: 8px;">${error.message}</p>
            </div>
        `;
    }
}

// ============================================
// Score Calculations
// ============================================

function calculateScore(votes, block) {
    if (!block.weights || !votes) return null;
    
    const total = block.keys.reduce((sum, k) => sum + (parseInt(votes[k]) || 0), 0);
    if (total === 0) return null;
    
    let weightedSum = 0;
    block.keys.forEach((k, i) => {
        weightedSum += (parseInt(votes[k]) || 0) * block.weights[i];
    });
    
    return weightedSum / total;
}

function normalizeVotes(votes, block) {
    if (!votes) return block.keys.map(() => 0);
    
    if (block.normalize === 'max') {
        const maxVal = Math.max(...block.keys.map(k => parseInt(votes[k]) || 0));
        if (maxVal === 0) return block.keys.map(() => 0);
        return block.keys.map(k => (parseInt(votes[k]) || 0) / maxVal);
    } else {
        const total = block.keys.reduce((sum, k) => sum + (parseInt(votes[k]) || 0), 0);
        if (total === 0) return block.keys.map(() => 0);
        return block.keys.map(k => (parseInt(votes[k]) || 0) / total);
    }
}

function getSampleSize(votes, block) {
    if (!votes) return 0;
    if (block.normalize === 'max') {
        return Math.max(...block.keys.map(k => parseInt(votes[k]) || 0));
    }
    return block.keys.reduce((sum, k) => sum + (parseInt(votes[k]) || 0), 0);
}

// Top When-to-Wear picks: mirrors desktop _when_to_wear_top_keys (>=60% of max).
function whenToWearTopKeys(votes, keys) {
    if (!votes) return [];
    const maxV = Math.max(...keys.map(k => parseInt(votes[k]) || 0));
    if (maxV === 0) return [];
    const threshold = maxV * 0.6;
    return keys.filter(k => (parseInt(votes[k]) || 0) >= threshold);
}

// Personal "voted" keys for any block: simply value > 0 (matches desktop).
function personalVotedKeys(votes, keys) {
    if (!votes) return [];
    return keys.filter(k => (parseInt(votes[k]) || 0) > 0);
}

// Escape for use inside a double-quoted HTML attribute (e.g. `title="..."`).
function escapeAttr(s) {
    return String(s)
        .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
        .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Render a compact spectrum with optional Fragrantica + Personal dots.
// Mirrors desktop MiniSpectrum: blue (larger) under, orange (smaller) on top.
// `leftLabel` / `rightLabel` are optional one-char endpoint markers.
function renderMiniSpectrum(frScore, myScore, scoreMin, scoreMax, leftLabel, rightLabel, frVotes, myVotes, keys, blockName) {
    const span = scoreMax - scoreMin;
    const toPct = (s) => {
        // Keep dots inside the visible track; 6% margin both sides matches
        // the desktop margin = max(dot_radius) + 1.
        const margin = 6;
        const frac = span <= 0 ? 0.5 : Math.max(0, Math.min(1, (s - scoreMin) / span));
        return margin + frac * (100 - 2 * margin);
    };

    const dots = [];
    if (frScore !== null && frScore !== undefined) {
        dots.push(`<span class="ms-dot ms-dot-fr" style="left:${toPct(frScore).toFixed(2)}%"></span>`);
    }
    if (myScore !== null && myScore !== undefined) {
        dots.push(`<span class="ms-dot ms-dot-my" style="left:${toPct(myScore).toFixed(2)}%"></span>`);
    }

    // Hover detail: Fragrantica to 2 decimals (matches the site), personal as
    // integer (single-vote per dimension on the user's side).
    const frN = frVotes ? keys.reduce((s, k) => s + (parseInt(frVotes[k]) || 0), 0) : 0;
    const myN = myVotes ? keys.reduce((s, k) => s + (parseInt(myVotes[k]) || 0), 0) : 0;
    const frTxt = (frScore !== null && frScore !== undefined) ? `${frScore.toFixed(2)} (${frN} votes)` : '—';
    const myTxt = (myScore !== null && myScore !== undefined) ? `${Math.round(myScore)} (${myN} vote${myN === 1 ? '' : 's'})` : '—';
    const tip = `Fragrantica: ${frTxt}\nPersonal: ${myTxt}`;

    const left = leftLabel ? `<span class="ms-label">${leftLabel}</span>` : '';
    const right = rightLabel ? `<span class="ms-label">${rightLabel}</span>` : '';

    return `<span class="mini-spectrum" title="${escapeAttr(tip)}">${left}<span class="ms-track"><span class="ms-line"></span>${dots.join('')}</span>${right}</span>`;
}

// Render the 6-slot When-to-Wear strip. Four states per slot:
//   agree (both)   = green
//   fr  (Fragrantica top only) = blue
//   my  (personal voted only)  = orange
//   empty (neither) = muted line colour, icon still drawn so the slot's
//                     identity stays recognisable (matches desktop).
// Icons are inline SVGs rendered as line art (moon is the one filled
// exception). Stroke colour drives the per-slot state visually; the
// `currentColor` SVG attribute lets CSS swap colour cleanly via a class
// modifier on the slot wrapper.
function renderWhenToWearStrip(frTopKeys, myVotedKeys, frVotes, myVotes, keys) {
    const order = ['spring', 'summer', 'fall', 'winter', 'day', 'night'];
    const frSet = new Set(frTopKeys || []);
    const mySet = new Set(myVotedKeys || []);

    const slots = order.map(k => {
        const inFr = frSet.has(k);
        const inMy = mySet.has(k);
        let cls = 'empty';
        if (inFr && inMy) cls = 'agree';
        else if (inFr) cls = 'fr';
        else if (inMy) cls = 'my';
        return `<span class="when-slot ${cls}" aria-label="${k}">${WHEN_ICONS[k] || ''}</span>`;
    }).join('');

    const frN = frVotes ? keys.reduce((s, k) => s + (parseInt(frVotes[k]) || 0), 0) : 0;
    const myN = myVotes ? keys.reduce((s, k) => s + (parseInt(myVotes[k]) || 0), 0) : 0;
    const frTxt = frTopKeys && frTopKeys.length ? frTopKeys.map(k => k.replace(/_/g, ' ')).join(', ') : '—';
    const myTxt = myVotedKeys && myVotedKeys.length ? myVotedKeys.map(k => k.replace(/_/g, ' ')).join(', ') : '—';
    const tip = `Fragrantica top: ${frTxt}  (${frN} votes)\nPersonal: ${myTxt}  (${myN} votes)`;

    return `<span class="when-strip" title="${escapeAttr(tip)}">${slots}</span>`;
}

// Per-slot SVG icons. Drawn in a 16x16 viewBox, stroke="currentColor",
// fill="none" (except moon, which is filled). The .when-slot CSS class
// drives `color` per state -- so all icons inherit colour via
// currentColor and we don't need to duplicate stroke= for every state.
// SVG icons for the When-to-Wear strip.  Geometry is mirrored in
// perfume_tracker.py WhenToWearStrip._PAINTERS (Tk Canvas).  The two are
// hand-aligned, NOT generated from a shared spec - keep them in sync
// whenever you tweak any icon's parameters or shape.
const WHEN_ICONS = {
    // Sprout: short stem + curved leaf pointing up-left
    spring: `<svg class="when-icon" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M 8 14 L 8 7" stroke="currentColor" stroke-width="1.6"
              stroke-linecap="round" fill="none"/>
        <path d="M 8 7 C 5.5 7 3.5 5.5 3 3 C 5 4 7 5.5 8 7 Z"
              stroke="currentColor" stroke-width="1.4"
              stroke-linejoin="round" fill="none"/>
    </svg>`,
    // Beach umbrella: top semicircle canopy + diameter line + pole
    summer: `<svg class="when-icon" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M 2 8 A 6 6 0 0 1 14 8" stroke="currentColor"
              stroke-width="1.5" stroke-linecap="round" fill="none"/>
        <line x1="2" y1="8" x2="14" y2="8" stroke="currentColor"
              stroke-width="1.5" stroke-linecap="round"/>
        <line x1="8" y1="8" x2="8" y2="15" stroke="currentColor"
              stroke-width="1.5" stroke-linecap="round"/>
    </svg>`,
    // Stylised leaf with centre vein, tilted -10 deg so it reads as
    // 'falling in mid-air' rather than a stationary oval
    fall: `<svg class="when-icon" viewBox="0 0 16 16" aria-hidden="true">
        <g transform="rotate(-10 8 8)" fill="none" stroke="currentColor"
           stroke-linecap="round" stroke-linejoin="round">
            <path d="M 8 2 C 12 4 12 11 8 14 C 4 11 4 4 8 2 Z"
                  stroke-width="1.5"/>
            <line x1="8" y1="2" x2="8" y2="14" stroke-width="1.4"/>
        </g>
    </svg>`,
    // Snowflake: 6 arms with chevron branches near each tip
    winter: `<svg class="when-icon" viewBox="0 0 16 16" aria-hidden="true">
        <g stroke="currentColor" stroke-width="1.4" stroke-linecap="round" fill="none">
            <line x1="2" y1="8" x2="14" y2="8"/>
            <line x1="5" y1="2.8" x2="11" y2="13.2"/>
            <line x1="11" y1="2.8" x2="5" y2="13.2"/>
            <line x1="11.3" y1="8"    x2="12.8" y2="9.2"/>
            <line x1="11.3" y1="8"    x2="12.8" y2="6.8"/>
            <line x1="9.65" y1="10.86" x2="9.32" y2="12.75"/>
            <line x1="9.65" y1="10.86" x2="11.45" y2="11.52"/>
            <line x1="6.35" y1="10.86" x2="4.55" y2="11.52"/>
            <line x1="6.35" y1="10.86" x2="6.68" y2="12.75"/>
            <line x1="4.7"  y1="8"    x2="3.2"  y2="6.8"/>
            <line x1="4.7"  y1="8"    x2="3.2"  y2="9.2"/>
            <line x1="6.35" y1="5.14" x2="6.68" y2="3.25"/>
            <line x1="6.35" y1="5.14" x2="4.55" y2="4.48"/>
            <line x1="9.65" y1="5.14" x2="11.45" y2="4.48"/>
            <line x1="9.65" y1="5.14" x2="9.32" y2="3.25"/>
        </g>
    </svg>`,
    // Sun: outlined centre disc with 8 short radial rays
    // Proportions: r=0.36, ray_inner=0.56, ray_outer=0.82 of half-viewBox
    day: `<svg class="when-icon" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="2.9" stroke="currentColor"
                stroke-width="1.4" fill="none"/>
        <line x1="8" y1="1.4" x2="8" y2="3.5" stroke="currentColor"
              stroke-width="1.4" stroke-linecap="round"/>
        <line x1="8" y1="12.5" x2="8" y2="14.6" stroke="currentColor"
              stroke-width="1.4" stroke-linecap="round"/>
        <line x1="1.4" y1="8" x2="3.5" y2="8" stroke="currentColor"
              stroke-width="1.4" stroke-linecap="round"/>
        <line x1="12.5" y1="8" x2="14.6" y2="8" stroke="currentColor"
              stroke-width="1.4" stroke-linecap="round"/>
        <line x1="3.36" y1="3.36" x2="4.84" y2="4.84" stroke="currentColor"
              stroke-width="1.4" stroke-linecap="round"/>
        <line x1="11.16" y1="11.16" x2="12.64" y2="12.64" stroke="currentColor"
              stroke-width="1.4" stroke-linecap="round"/>
        <line x1="12.64" y1="3.36" x2="11.16" y2="4.84" stroke="currentColor"
              stroke-width="1.4" stroke-linecap="round"/>
        <line x1="4.84" y1="11.16" x2="3.36" y2="12.64" stroke="currentColor"
              stroke-width="1.4" stroke-linecap="round"/>
    </svg>`,
    // Crescent moon: filled crescent (single path) -- the one filled icon
    night: `<svg class="when-icon when-icon-filled" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M 11 2.5 A 6 6 0 1 0 11 13.5 A 4.5 4.5 0 1 1 11 2.5 Z"
              fill="currentColor" stroke="none"/>
    </svg>`
};

function getPerfumeScore(p, voteKey) {
    const block = VOTE_BLOCKS.find(b => b.key === voteKey);
    if (!block || !p.fragrantica) return null;
    return calculateScore(p.fragrantica[voteKey], block);
}

// ============================================
// Source-aware scoring (mirrors desktop _score_for / _has_voted)
// ============================================
// Numeric dim short name -> {key: fragrantica vote dict key, myKey: personal
// vote dict key, block: VOTE_BLOCKS entry}. Mirrors desktop _NUMERIC_DIM_INFO.
const NUMERIC_DIM_BLOCKS = {
    rating:    { key: 'rating_votes',    myKey: 'my_rating_votes' },
    longevity: { key: 'longevity_votes', myKey: 'my_longevity_votes' },
    sillage:   { key: 'sillage_votes',   myKey: 'my_sillage_votes' },
    value:     { key: 'value_votes',     myKey: 'my_value_votes' },
    gender:    { key: 'gender_votes',    myKey: 'my_gender_votes' }
};

// Return [frVotesDict, myVotesDict] for a given numeric dim. Always returns
// objects so callers can sum keys without null checks.
function voteDicts(p, dim) {
    const info = NUMERIC_DIM_BLOCKS[dim];
    if (!info) return [{}, {}];
    const fr = (p.fragrantica || {})[info.key] || {};
    const my = (p.my_votes || {})[info.myKey] || {};
    return [fr, my];
}

// Sum of vote counts across the dim's keys, on either 'fr' or 'my' side.
function voteTotal(p, dim, side) {
    const block = VOTE_BLOCKS.find(b => b.key === NUMERIC_DIM_BLOCKS[dim].key);
    if (!block) return 0;
    const [fr, my] = voteDicts(p, dim);
    const src = side === 'fr' ? fr : my;
    return block.keys.reduce((s, k) => s + (parseInt(src[k]) || 0), 0);
}

// Source-aware weighted score for a numeric dim. Returns 0 (not null) when
// the selected source has no votes -- this preserves the historical
// "no data sorts to the end on desc / start on asc" and lets score-range
// filters fall through their existing `score > 0` "has_data" gate.
//   'fragrantica' : Fragrantica only.
//   'personal'    : Personal only; 0 when the user hasn't voted.
//   'fallback'    : Personal where any personal vote exists, else Fragrantica.
function scoreFor(p, dim) {
    const block = VOTE_BLOCKS.find(b => b.key === NUMERIC_DIM_BLOCKS[dim]?.key);
    if (!block) return 0;
    const [fr, my] = voteDicts(p, dim);

    if (voteSource === 'personal') {
        return calculateScore(my, block) || 0;
    }
    if (voteSource === 'fallback') {
        const myTotal = block.keys.reduce((s, k) => s + (parseInt(my[k]) || 0), 0);
        if (myTotal > 0) return calculateScore(my, block) || 0;
        return calculateScore(fr, block) || 0;
    }
    return calculateScore(fr, block) || 0;
}

// True iff the requested side has any vote on this numeric dim.
function hasVoted(p, dim, side) {
    return voteTotal(p, dim, side) > 0;
}

function checkScoreFilter(p, scoreType, filter, maxVal) {
    // If filter is at default values (full range, not exclude), skip check
    if (filter.min === 0 && filter.max === maxVal && !filter.exclude) {
        return true;
    }

    // Use the source-aware score so filters honour the current voteSource
    // (Fragrantica / Personal / Fallback). scoreFor() returns 0 when the
    // selected source has no votes, which preserves the existing
    // "score > 0 = has_data" gate used here.
    const score = scoreFor(p, scoreType);
    const hasData = score > 0;
    const inRange = score >= filter.min && score <= filter.max;

    if (filter.exclude) {
        // Exclude mode: reject if has data and in range
        if (hasData && inRange) return false;
    } else {
        // Include mode: reject if no data or not in range
        if (!hasData || !inRange) return false;
    }

    return true;
}

// Get index of an ID in a map (for custom order sorting)
function getMapIndex(map, id) {
    const keys = Object.keys(map);
    const index = keys.indexOf(id);
    return index >= 0 ? index : keys.length; // Put unknown IDs at the end
}

function getSortValue(p, field, ascending = true) {
    switch (field) {
        case 'brand':
            // Use map order (user's custom order from desktop)
            return getMapIndex(brandsMap, p.brand_id);
        case 'name':
            return (p.name || '').toLowerCase();
        case 'location':
            // Get indices of locations in outlets_map order
            const outletOrder = Object.keys(outletsMap);
            const indices = (p.outlet_ids || [])
                .map(id => outletOrder.indexOf(id))
                .filter(i => i >= 0);
            
            if (indices.length === 0) {
                return [Infinity];  // No locations: put at end
            }
            
            if (ascending) {
                // Sort by min index first, then second-min, etc.
                return indices.slice().sort((a, b) => a - b);
            } else {
                // Sort by max index first (descending), then second-max, etc.
                return indices.slice().sort((a, b) => b - a);
            }
        case 'concentration':
            // Use map order (user's custom order from desktop)
            return getMapIndex(concentrationsMap, p.concentration_id);
        case 'year': {
            const y = parseInt(p.year, 10) || 0;
            // Unset year (0) sorts to the end in either direction
            if (y <= 0) return ascending ? Infinity : -Infinity;
            return y;
        }
        case 'state':
            return getStatePriority(p);
        case 'rating':
            return scoreFor(p, 'rating');
        case 'longevity':
            return scoreFor(p, 'longevity');
        case 'sillage':
            return scoreFor(p, 'sillage');
        case 'value':
            return scoreFor(p, 'value');
        case 'created':
            return p.created_at || '';
        default:
            return '';
    }
}

function comparePerfumes(a, b, field, ascending) {
    const valA = getSortValue(a, field, ascending);
    const valB = getSortValue(b, field, ascending);
    
    // Handle array comparison (for location)
    if (Array.isArray(valA) && Array.isArray(valB)) {
        const len = Math.max(valA.length, valB.length);
        for (let i = 0; i < len; i++) {
            const ai = valA[i] ?? Infinity;  // Missing = put at end
            const bi = valB[i] ?? Infinity;
            if (ai !== bi) {
                // For ascending, smaller index first
                // For descending, we already reversed the array in getSortValue
                return ai - bi;
            }
        }
        return 0;
    }
    
    let result;
    if (typeof valA === 'number' && typeof valB === 'number') {
        result = valA - valB;
    } else {
        result = String(valA).localeCompare(String(valB), 'zh-TW');
    }
    
    return ascending ? result : -result;
}

function getStatePriority(p) {
    const state = deriveState(p);
    if (state.includes('Owned')) return 0;
    if (state.includes('Smelled') || state.includes('On-skin')) return 1;
    if (state.includes('Want')) return 2;
    if (state === 'New') return 3;
    return 4;
}

function getStateCategory(p) {
    const events = p.events || [];
    if (events.length === 0) return 'new';

    // Past-owned is treated as 'owned' for sort priority purposes, matching
    // how the Owned filter checkbox treats both cases as a single axis.
    if (computeOwnedSnapshot(p).ownedMatch) return 'owned';

    const hasSmelled = events.some(e => e.event_type === 'smell' || e.event_type === 'skin');
    if (hasSmelled) return 'smelled';

    return 'new';
}

function getScoreForSort(p, scoreType) {
    const fragrantica = p.fragrantica || {};
    
    const blockMap = {
        'rating': VOTE_BLOCKS.find(b => b.key === 'rating_votes'),
        'longevity': VOTE_BLOCKS.find(b => b.key === 'longevity_votes'),
        'sillage': VOTE_BLOCKS.find(b => b.key === 'sillage_votes'),
        'gender': VOTE_BLOCKS.find(b => b.key === 'gender_votes'),
        'value': VOTE_BLOCKS.find(b => b.key === 'value_votes')
    };
    
    const block = blockMap[scoreType];
    if (!block) return null;
    
    const votes = fragrantica[block.key];
    return calculateScore(votes, block);
}

function getStatePriority(p, ownedFirst = true) {
    const cat = getStateCategory(p);
    if (ownedFirst) {
        return { 'owned': 0, 'smelled': 1, 'new': 2 }[cat] ?? 3;
    } else {
        return { 'smelled': 0, 'owned': 1, 'new': 2 }[cat] ?? 3;
    }
}

// ============================================
// Rendering
// ============================================

function renderPerfumeList() {
    const container = document.getElementById('perfume-list');
    const countEl = document.getElementById('perfume-count');
    
    if (filteredPerfumes.length === 0) {
        container.innerHTML = '<div class="no-results">No matching perfumes</div>';
        countEl.textContent = '0 perfumes';
        return;
    }
    
    container.innerHTML = filteredPerfumes.map(p => {
        const brand = brandsMap[p.brand_id] || 'Unknown';
        const conc = concentrationsMap[p.concentration_id] || '';
        const year = parseInt(p.year, 10) || 0;
        const yearText = year > 0 ? String(year) : '';
        const locations = (p.outlet_ids || [])
            .map(id => outletsMap[id]?.name || '')
            .filter(Boolean)
            .join(', ');
        
        return `
            <div class="perfume-item ${p.id === selectedPerfumeId ? 'selected' : ''}" 
                 data-id="${p.id}">
                <span class="brand">${escapeHtml(brand)}</span>
                <span class="name">${escapeHtml(p.name)}</span>
                <span class="concentration">${escapeHtml(conc)}</span>
                <span class="year">${escapeHtml(yearText)}</span>
                <span class="locations">${escapeHtml(locations)}</span>
            </div>
        `;
    }).join('');
    
    countEl.textContent = `${filteredPerfumes.length} perfumes`;
    
    container.querySelectorAll('.perfume-item').forEach(el => {
        el.addEventListener('click', () => selectPerfume(el.dataset.id));
    });
}

function selectPerfume(id) {
    selectedPerfumeId = id;
    
    document.querySelectorAll('.perfume-item').forEach(el => {
        el.classList.toggle('selected', el.dataset.id === id);
    });
    
    const perfume = perfumes.find(p => p.id === id);
    if (!perfume) return;
    
    renderDetailPanel(perfume);
}

function renderDetailPanel(p) {
    const panel = document.getElementById('detail-panel');
    panel.classList.remove('hidden');
    
    const brand = brandsMap[p.brand_id] || 'Unknown';
    const conc = concentrationsMap[p.concentration_id] || '';
    const year = parseInt(p.year, 10) || 0;
    document.getElementById('detail-brand').textContent = brand;
    const subtitleParts = [p.name, conc, year > 0 ? String(year) : ''].filter(Boolean);
    document.getElementById('detail-name-conc').textContent = subtitleParts.join(' · ');
    
    const state = deriveState(p);
    document.getElementById('detail-state').textContent = state;
    
    renderNotes(p);
    renderFragrantica(p);
    renderEvents(p);
    renderLinks(p);
    renderTags(p);
}

// Shared "Owned" computation -- mirrors derive_state in perfume_tracker.py.
// Full bottles always count.  Decant ml is included when includeDecant is on.
// Other custom purchase types are intentionally ignored until exposed in UI.
function computeOwnedSnapshot(p) {
    const validTypes = new Set(['full']);
    if (includeDecant) validTypes.add('decant');

    let currentMl = 0;
    let hadPositivePast = false;
    for (const e of (p.events || [])) {
        if (e.ml_delta === null || e.ml_delta === undefined) continue;
        const purchaseType = purchaseTypesMap[e.purchase_type_id] || '';
        if (!validTypes.has(purchaseType)) continue;
        const delta = e.ml_delta;
        currentMl += delta;
        if (delta > 0) hadPositivePast = true;
    }
    const isCurrentlyOwned = currentMl > 0;
    const isPastOwned = includePastOwned && !isCurrentlyOwned && hadPositivePast;
    return {
        currentMl,
        isCurrentlyOwned,
        isPastOwned,
        ownedMatch: isCurrentlyOwned || isPastOwned,
    };
}

function deriveState(p) {
    const events = p.events || [];
    if (events.length === 0) return 'New';

    let hasSmelled = false;
    let hasOnSkin = false;

    // Check most recent want/unwant event to determine current want status
    let hasWant = false;
    let latestWantTs = null;

    for (const e of events) {
        if (e.event_type === 'smell') {
            hasSmelled = true;
        }
        if (e.event_type === 'skin') {
            hasOnSkin = true;
        }
        if (e.event_type === 'want' || e.event_type === 'unwant') {
            const ts = e.timestamp || '';
            if (latestWantTs === null || ts > latestWantTs) {
                latestWantTs = ts;
                hasWant = (e.event_type === 'want');
            }
        }
    }

    const owned = computeOwnedSnapshot(p);

    const parts = [];
    if (hasSmelled) parts.push('Smelled');
    if (hasOnSkin) parts.push('On-skin');
    if (owned.isCurrentlyOwned) parts.push(`Owned ${owned.currentMl}ml`);
    else if (owned.isPastOwned) parts.push('Past-owned');
    if (hasWant) parts.push('Want');

    if (parts.length === 0) return 'New';
    return parts.join(' | ');
}

function renderNotes(p) {
    const section = document.getElementById('notes-section');
    const content = document.getElementById('notes-content');
    const notes = p.notes || [];
    
    if (notes.length === 0) {
        section.classList.add('hidden');
        return;
    }
    
    section.classList.remove('hidden');
    content.innerHTML = notes.map(note => {
        const title = note.title || 'Note';
        return `
            <div class="note-item">
                <div class="note-title">${escapeHtml(title)}</div>
                <div class="note-text">${escapeHtml(note.content || '')}</div>
            </div>
        `;
    }).join('');
}

function renderFragrantica(p) {
    const section = document.getElementById('fragrantica-section');
    const content = document.getElementById('fragrantica-content');
    const fragrantica = p.fragrantica || {};
    const myVotes = p.my_votes || {};
    
    const hasData = Object.keys(fragrantica).some(k => k.endsWith('_votes')) || 
                    Object.keys(myVotes).some(k => k.endsWith('_votes'));
    if (!hasData) {
        section.classList.add('hidden');
        return;
    }
    
    section.classList.remove('hidden');
    
    // Render Fragrantica URL if available
    const fragUrl = fragrantica.url || '';
    const headerEl = section.querySelector('.fragrantica-header .section-title');
    if (fragUrl) {
        headerEl.innerHTML = `<a href="${escapeHtml(fragUrl)}" target="_blank" rel="noopener" class="fragrantica-link">Fragrantica ↗</a>`;
    } else {
        headerEl.textContent = 'Fragrantica Votes';
    }
    
    const blocks = [];
    for (const block of VOTE_BLOCKS) {
        const fData = fragrantica[block.key] || {};
        const mData = myVotes[block.myKey] || {};
        
        const hasBlockData = block.keys.some(k => (fData[k] !== undefined) || (mData[k] !== undefined && mData[k] > 0));
        if (!hasBlockData) continue;
        
        const normalized = normalizeVotes(fData, block);
        const score = calculateScore(fData, block);
        const myScore = calculateScore(mData, block);
        const sampleSize = getSampleSize(fData, block);

        // Collapsed-state visual summary, matching the desktop widgets so the
        // user can read Fragrantica + their own vote at a glance.
        let scoreDisplay = '';
        if (block.key === 'season_time_votes') {
            const frTop = whenToWearTopKeys(fData, block.keys);
            const myVoted = personalVotedKeys(mData, block.keys);
            scoreDisplay = renderWhenToWearStrip(frTop, myVoted, fData, mData, block.keys);
        } else if (block.maxScore) {
            const scoreMin = 1;
            const scoreMax = block.maxScore;
            const [leftLabel, rightLabel] = block.key === 'gender_votes'
                ? ['\u2640', '\u2642']                       // ♀  ♂
                : ['1', String(scoreMax)];
            scoreDisplay = renderMiniSpectrum(
                score, myScore, scoreMin, scoreMax,
                leftLabel, rightLabel,
                fData, mData, block.keys, block.key
            );
        }
        
        // Build items with bar charts
        const items = block.keys.map((k, i) => {
            const fVal = fData[k];
            const mVal = mData[k];
            const barWidth = normalized[i] * 100;
            const hasMyVote = mVal !== undefined && mVal > 0;
            const displayLabel = k.replace(/_/g, ' ');
            
            return `
                <div class="vote-item">
                    <span class="vote-label">${hasMyVote ? '<span class="vote-marker">●</span>' : ''}<span class="label-text">${escapeHtml(displayLabel)}</span></span>
                    <div class="vote-bar-container">
                        <div class="vote-bar ${hasMyVote ? 'voted' : ''}" style="width: ${barWidth}%"></div>
                        <span class="vote-count">${fVal !== undefined ? fVal : ''}</span>
                    </div>
                </div>
            `;
        }).join('');
        
        // Wrap the spectrum/strip in a fixed-width slot so the right edges
        // line up across rows regardless of which summary widget the block
        // uses (MiniSpectrum has 1/5 endpoint labels, WhenToWearStrip does
        // not -- their natural widths differ).  Mirrors the desktop layout.
        blocks.push(`
            <div class="vote-block" data-category="${block.key}">
                <div class="vote-block-header">
                    <span class="vote-block-title">${block.label}</span>
                    <span class="vote-block-info">
                        <span class="vote-summary-slot">${scoreDisplay}</span>
                        <span class="block-sample">(n=${sampleSize})</span>
                    </span>
                    <span class="vote-block-toggle">+</span>
                </div>
                <div class="vote-block-content">${items}</div>
            </div>
        `);
    }
    
    content.innerHTML = blocks.join('');
    
    content.querySelectorAll('.vote-block-header').forEach(header => {
        header.addEventListener('click', () => {
            const block = header.closest('.vote-block');
            block.classList.toggle('expanded');
            header.querySelector('.vote-block-toggle').textContent = 
                block.classList.contains('expanded') ? '-' : '+';
            updateToggleAllButton();
        });
    });
    
    updateToggleAllButton();
}

function toggleAllVoteBlocks() {
    const btn = document.getElementById('toggle-all-votes');
    const blocks = document.querySelectorAll('.vote-block');
    
    // Determine action based on current button text (like desktop)
    const shouldExpand = btn.textContent === '++';
    
    blocks.forEach(block => {
        if (shouldExpand) {
            block.classList.add('expanded');
            block.querySelector('.vote-block-toggle').textContent = '-';
        } else {
            block.classList.remove('expanded');
            block.querySelector('.vote-block-toggle').textContent = '+';
        }
    });
    
    updateToggleAllButton();
}

function updateToggleAllButton() {
    const btn = document.getElementById('toggle-all-votes');
    const blocks = document.querySelectorAll('.vote-block');
    if (blocks.length === 0) return;
    
    const allExpanded = Array.from(blocks).every(b => b.classList.contains('expanded'));
    const allCollapsed = Array.from(blocks).every(b => !b.classList.contains('expanded'));
    
    // Only update at extremes, keep current state for partial (like desktop)
    if (allExpanded) {
        btn.textContent = '--';
    } else if (allCollapsed) {
        btn.textContent = '++';
    }
    // Partial state: don't change button text
}

function renderEvents(p) {
    const section = document.getElementById('events-section');
    const content = document.getElementById('events-content');
    const events = p.events || [];
    
    if (events.length === 0) {
        section.classList.add('hidden');
        return;
    }
    
    const typeLabels = {
        smell: 'Smell',
        skin: 'Skin',
        buy: 'Buy',
        sell: 'Sell',
        want: 'Want',
        unwant: 'Unwant'
    };
    
    section.classList.remove('hidden');
    content.innerHTML = events.map(e => {
        const eventType = typeLabels[e.event_type] || e.event_type || 'Event';
        const purchaseType = e.purchase_type || purchaseTypesMap[e.purchase_type_id] || '';
        const location = e.location || '';
        
        // Differentiate explicit date vs auto timestamp
        const hasExplicitDate = e.event_date && e.event_date.trim();
        const displayDate = hasExplicitDate 
            ? e.event_date 
            : (e.timestamp?.split('T')[0] || '');
        const dateClass = hasExplicitDate ? 'event-date' : 'event-date event-date-auto';
        
        const details = [];
        if (purchaseType) details.push(`[${purchaseType}]`);
        if (e.ml_delta) details.push(`${e.ml_delta}ml`);
        if (e.price !== null && e.price !== undefined) details.push(`$${e.price}`);
        if (location) details.push(`@${location}`);
        
        return `
            <div class="event-item">
                <div class="event-info">
                    <span class="event-type">${escapeHtml(eventType)}</span>
                    ${details.length > 0 ? `<span class="event-details">${escapeHtml(details.join(' '))}</span>` : ''}
                </div>
                <span class="${dateClass}">${escapeHtml(displayDate)}</span>
            </div>
        `;
    }).join('');
}

function renderLinks(p) {
    const section = document.getElementById('links-section');
    const content = document.getElementById('links-content');
    const links = p.links || [];
    
    if (links.length === 0) {
        section.classList.add('hidden');
        return;
    }
    
    section.classList.remove('hidden');
    content.innerHTML = links.map(link => {
        const label = link.label || getDomainFromUrl(link.url) || link.url;
        return `
            <a href="${escapeHtml(link.url)}" target="_blank" rel="noopener" class="link-item">
                ${escapeHtml(label)}
            </a>
        `;
    }).join('');
}

function renderTags(p) {
    const section = document.getElementById('tags-section');
    const content = document.getElementById('tags-content');
    const tagIds = p.tag_ids || [];
    
    if (tagIds.length === 0) {
        section.classList.add('hidden');
        return;
    }
    
    section.classList.remove('hidden');
    content.innerHTML = tagIds.map(id => {
        const tag = tagsMap[id] || id;
        return `<span class="tag-item">${escapeHtml(tag)}</span>`;
    }).join('');
}

function closeDetailPanel() {
    document.getElementById('detail-panel').classList.add('hidden');
    selectedPerfumeId = null;
    document.querySelectorAll('.perfume-item').forEach(el => {
        el.classList.remove('selected');
    });
}

// ============================================
// Filtering & Sorting
// ============================================

function applyFiltersAndSort() {
    const searchTerm = document.getElementById('search-input').value.toLowerCase().trim();
    
    filteredPerfumes = perfumes.filter(p => {
        if (searchTerm) {
            const brand = (brandsMap[p.brand_id] || '').toLowerCase();
            const name = (p.name || '').toLowerCase();
            const tagNames = (p.tag_ids || []).map(id => (tagsMap[id] || '').toLowerCase()).join(' ');
            const notesText = (p.notes || []).map(n => `${n.title || ''} ${n.content || ''}`).join(' ').toLowerCase();
            
            const searchable = `${brand} ${name} ${tagNames} ${notesText}`;
            if (!searchable.includes(searchTerm)) {
                return false;
            }
        }
        
        // State filter
        if (filters.states.length > 0) {
            const state = deriveState(p).toLowerCase();
            const ownedMatch = computeOwnedSnapshot(p).ownedMatch;
            const matchesState = filters.states.some(s => {
                if (s === 'owned') return ownedMatch;
                if (s === 'smelled') return state.includes('smelled');
                if (s === 'on-skin') return state.includes('on-skin');
                if (s === 'want') return state.includes('want');
                if (s === 'new') return state === 'new';
                return false;
            });
            if (!matchesState) return false;
        }
        
        // Score filters
        if (!checkScoreFilter(p, 'rating', filters.rating, 5)) return false;
        if (!checkScoreFilter(p, 'longevity', filters.longevity, 5)) return false;
        if (!checkScoreFilter(p, 'sillage', filters.sillage, 4)) return false;
        if (!checkScoreFilter(p, 'value', filters.value, 5)) return false;

        // Per-dimension vote-status gate (independent of voteSource).
        // 'has_fr' = require Fragrantica vote; 'has_my' = require Personal
        // vote; 'any' = no constraint. Mirrors desktop FilterConfig.voted_status.
        for (const dim of Object.keys(filters.votedStatus || {})) {
            const status = filters.votedStatus[dim];
            if (status === 'has_fr' && !hasVoted(p, dim, 'fr')) return false;
            if (status === 'has_my' && !hasVoted(p, dim, 'my')) return false;
        }
        
        // Season/Time filter
        if (filters.seasons.length > 0 || filters.times.length > 0) {
            const checkItems = [...filters.seasons, ...filters.times];
            const frVotes = (p.fragrantica || {}).season_time_votes || {};
            const myVotes = ((p.my_votes || {}).my_season_time_votes) || {};
            
            const matchesWhen = checkItems.some(item => {
                const frVal = parseInt(frVotes[item] || 0);
                const myVal = parseInt(myVotes[item] || 0);
                return frVal >= 10 || myVal > 0;
            });
            if (!matchesWhen) return false;
        }
        
        // Gender filter
        if (filters.genders.length > 0) {
            const frVotes = (p.fragrantica || {}).gender_votes || {};
            const myVotes = ((p.my_votes || {}).my_gender_votes) || {};
            
            const matchesGender = filters.genders.some(gender => {
                const frVal = parseInt(frVotes[gender] || 0);
                const myVal = parseInt(myVotes[gender] || 0);
                return frVal >= 10 || myVal > 0;
            });
            if (!matchesGender) return false;
        }
        
        // Vote status filters
        if (filters.hasMyVote) {
            const myVotes = p.my_votes || {};
            const hasAnyVote = Object.values(myVotes).some(votes => 
                votes && Object.values(votes).some(v => v > 0)
            );
            if (!hasAnyVote) return false;
        }
        
        if (filters.hasFragrantica) {
            const fragrantica = p.fragrantica || {};
            const hasAnyData = Object.values(fragrantica).some(votes => 
                votes && Object.values(votes).some(v => v > 0)
            );
            if (!hasAnyData) return false;
        }
        
        if (filters.brands.length > 0 && !filters.brands.includes(p.brand_id)) {
            return false;
        }
        
        if (filters.concentrations.length > 0 && !filters.concentrations.includes(p.concentration_id)) {
            return false;
        }
        
        if (filters.locations.length > 0) {
            const hasLocation = (p.outlet_ids || []).some(id => filters.locations.includes(id));
            if (!hasLocation) return false;
        }
        
        // Year range filter (active when either bound > 0; unset years excluded)
        if (filters.yearMin > 0 || filters.yearMax > 0) {
            const py = parseInt(p.year, 10) || 0;
            if (py <= 0) return false;
            if (filters.yearMin > 0 && py < filters.yearMin) return false;
            if (filters.yearMax > 0 && py > filters.yearMax) return false;
        }
        
        if (filters.tags.length > 0) {
            const pTagIds = new Set(p.tag_ids || []);
            if (filters.tagsLogic === 'and') {
                // AND: all selected tags must be present
                const hasAllTags = filters.tags.every(id => pTagIds.has(id));
                if (!hasAllTags) return false;
            } else {
                // OR: at least one selected tag must be present
                const hasAnyTag = filters.tags.some(id => pTagIds.has(id));
                if (!hasAnyTag) return false;
            }
        }
        
        return true;
    });
    
    // Multi-level sorting
    if (sortDimensions.length > 0) {
        filteredPerfumes.sort((a, b) => {
            for (const dim of sortDimensions) {
                const result = comparePerfumes(a, b, dim.field, dim.ascending);
                if (result !== 0) return result;
            }
            return 0;
        });
    }
    
    renderPerfumeList();
    updateActiveFiltersDisplay();
    updateFilterButtonState();
    updateSortButtonState();
}

function handleSearch() {
    applyFiltersAndSort();
}

// ============================================
// Sort Modal
// ============================================

const SORT_FIELD_LABELS = {
    brand: 'Brand',
    name: 'Name',
    location: 'Location',
    concentration: 'Concentration',
    year: 'Year',
    state: 'State',
    rating: 'Rating',
    longevity: 'Longevity',
    sillage: 'Sillage',
    value: 'Price Value',
    created: 'Created'
};

// Temporary copy for editing in modal
let tempSortDimensions = [];

function openSortModal() {
    const modal = document.getElementById('sort-modal');
    modal.classList.remove('hidden');
    
    // Copy current dimensions for editing
    tempSortDimensions = sortDimensions.map(d => ({...d}));
    renderSortDimensions();
    updateSortAddOptions();
    
    // Setup add field listener
    const addSelect = document.getElementById('sort-add-field');
    addSelect.onchange = () => {
        if (addSelect.value) {
            addSortDimension(addSelect.value);
            addSelect.value = '';
        }
    };
}

function renderSortDimensions() {
    const container = document.getElementById('sort-dimensions');
    
    if (tempSortDimensions.length === 0) {
        container.innerHTML = '<p class="sort-empty">No sorting applied</p>';
        return;
    }
    
    container.innerHTML = tempSortDimensions.map((dim, index) => `
        <div class="sort-dimension-item" data-index="${index}">
            <span class="sort-dimension-num">${index + 1}.</span>
            <span class="sort-dimension-name">${SORT_FIELD_LABELS[dim.field] || dim.field}</span>
            <div class="sort-dimension-dir">
                <button class="asc-btn ${dim.ascending ? 'active' : ''}" onclick="toggleSortDirection(${index}, true)">▲</button>
                <button class="desc-btn ${!dim.ascending ? 'active' : ''}" onclick="toggleSortDirection(${index}, false)">▼</button>
            </div>
            <button class="sort-dimension-remove" onclick="removeSortDimension(${index})">✕</button>
        </div>
    `).join('');
}

function addSortDimension(field) {
    // Don't add if already exists
    if (tempSortDimensions.some(d => d.field === field)) return;
    
    tempSortDimensions.push({ field, ascending: true });
    renderSortDimensions();
    updateSortAddOptions();
}

function removeSortDimension(index) {
    tempSortDimensions.splice(index, 1);
    renderSortDimensions();
    updateSortAddOptions();
}

function toggleSortDirection(index, ascending) {
    tempSortDimensions[index].ascending = ascending;
    renderSortDimensions();
}

function updateSortAddOptions() {
    const addSelect = document.getElementById('sort-add-field');
    const usedFields = new Set(tempSortDimensions.map(d => d.field));
    
    Array.from(addSelect.options).forEach(opt => {
        if (opt.value) {
            opt.disabled = usedFields.has(opt.value);
        }
    });
}

function applySortFromModal() {
    sortDimensions = tempSortDimensions.map(d => ({...d}));
    closeAllModals();
    applyFiltersAndSort();
    updateSortButtonState();
}

function resetSort() {
    tempSortDimensions = [];
    renderSortDimensions();
    updateSortAddOptions();
}

function closeAllModals() {
    document.getElementById('sort-modal').classList.add('hidden');
    document.getElementById('filter-modal').classList.add('hidden');
    document.getElementById('settings-modal').classList.add('hidden');
    // Draft modals (Phase 2).  These IDs may not exist during very early
    // startup but are always present by the time this runs.
    const draftModalIds = ['drafts-modal', 'event-modal', 'perfume-form-modal', 'export-modal'];
    draftModalIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    });
}

// ============================================
// Settings Modal
// ============================================

let originalFontSize = 10;
let originalIncludeDecant = false;
let originalIncludePastOwned = false;
let originalVoteSource = 'fragrantica';

function openSettingsModal() {
    const modal = document.getElementById('settings-modal');
    modal.classList.remove('hidden');

    // Store original values for reset
    originalFontSize = appData.font_size || 10;
    originalIncludeDecant = includeDecant;
    originalIncludePastOwned = includePastOwned;
    originalVoteSource = voteSource;

    // Set font size slider
    const slider = document.getElementById('settings-font-size');
    const currentPt = Math.round(parseInt(document.documentElement.style.fontSize || '13') / 1.33);
    slider.value = currentPt;
    document.getElementById('settings-font-size-label').textContent = currentPt + 'pt';

    // Restore owned-matching toggles
    const decantInput = document.getElementById('settings-include-decant');
    const pastInput = document.getElementById('settings-include-past-owned');
    if (decantInput) decantInput.checked = includeDecant;
    if (pastInput) pastInput.checked = includePastOwned;

    // Restore vote source radio
    document.querySelectorAll('#settings-vote-source input[name="vote-source"]').forEach(r => {
        r.checked = (r.value === voteSource);
    });
}

function previewFontSize() {
    const slider = document.getElementById('settings-font-size');
    const pt = parseInt(slider.value);
    document.getElementById('settings-font-size-label').textContent = pt + 'pt';
    document.documentElement.style.fontSize = Math.round(pt * 1.33) + 'px';
}

function applySettings() {
    // Owned-matching toggles
    const decantInput = document.getElementById('settings-include-decant');
    const pastInput = document.getElementById('settings-include-past-owned');
    if (decantInput) includeDecant = decantInput.checked;
    if (pastInput) includePastOwned = pastInput.checked;

    // Get selected vote source
    const sourceInput = document.querySelector('#settings-vote-source input[name="vote-source"]:checked');
    if (sourceInput && ['fragrantica', 'personal', 'fallback'].includes(sourceInput.value)) {
        voteSource = sourceInput.value;
    }

    closeAllModals();
    applyFiltersAndSort();  // Refresh list with new owned-matching + vote source
}

function resetSettings() {
    // Reset to original JSON values
    document.getElementById('settings-font-size').value = originalFontSize;
    document.getElementById('settings-font-size-label').textContent = originalFontSize + 'pt';
    document.documentElement.style.fontSize = Math.round(originalFontSize * 1.33) + 'px';

    // Reset owned-matching toggles
    includeDecant = originalIncludeDecant;
    includePastOwned = originalIncludePastOwned;
    const decantInput = document.getElementById('settings-include-decant');
    const pastInput = document.getElementById('settings-include-past-owned');
    if (decantInput) decantInput.checked = includeDecant;
    if (pastInput) pastInput.checked = includePastOwned;

    // Reset vote source radio
    voteSource = originalVoteSource;
    document.querySelectorAll('#settings-vote-source input[name="vote-source"]').forEach(r => {
        r.checked = (r.value === voteSource);
    });
}

function updateSortButtonState() {
    const btn = document.getElementById('sort-btn');
    btn.classList.toggle('active', sortDimensions.length > 0);
}

// ============================================
// Filter Modal
// ============================================

function populateFilterOptions() {
    const brandSelect = document.getElementById('filter-brand');
    brandSelect.innerHTML = Object.entries(brandsMap)
        .sort((a, b) => a[1].localeCompare(b[1], 'zh-TW'))
        .map(([id, name]) => `<option value="${id}">${escapeHtml(name)}</option>`)
        .join('');
    
    const concSelect = document.getElementById('filter-concentration');
    concSelect.innerHTML = Object.entries(concentrationsMap)
        .map(([id, name]) => `<option value="${id}">${escapeHtml(name)}</option>`)
        .join('');
    
    const locSelect = document.getElementById('filter-location');
    locSelect.innerHTML = Object.entries(outletsMap)
        .sort((a, b) => (a[1].name || '').localeCompare(b[1].name || '', 'zh-TW'))
        .map(([id, info]) => `<option value="${id}">${escapeHtml(info.name || '')}</option>`)
        .join('');
    
    const tagSelect = document.getElementById('filter-tag');
    tagSelect.innerHTML = Object.entries(tagsMap)
        .sort((a, b) => a[1].localeCompare(b[1], 'zh-TW'))
        .map(([id, name]) => `<option value="${id}">${escapeHtml(name)}</option>`)
        .join('');
}

function initScoreRangeSliders() {
    document.querySelectorAll('.score-filter-item').forEach(item => {
        const scoreType = item.dataset.score;
        const maxVal = parseFloat(item.dataset.max);
        const minInput = item.querySelector('.range-min');
        const maxInput = item.querySelector('.range-max');
        const excludeCheckbox = item.querySelector('.score-exclude');
        const selectedBar = item.querySelector('.range-selected');
        const minDisplay = item.querySelector('.range-value-min');
        const maxDisplay = item.querySelector('.range-value-max');
        
        function updateSlider() {
            let minVal = parseFloat(minInput.value);
            let maxValCurrent = parseFloat(maxInput.value);
            
            // Allow min = max, but don't let min exceed max
            if (minVal > maxValCurrent) {
                minInput.value = maxValCurrent;
                minVal = maxValCurrent;
            }
            if (maxValCurrent < minVal) {
                maxInput.value = minVal;
                maxValCurrent = minVal;
            }
            
            // Update display
            minDisplay.textContent = minVal.toFixed(1);
            maxDisplay.textContent = maxValCurrent.toFixed(1);
            
            // Update selected bar position
            // Sliders are narrower (100% - 16px) and start at 8px, so calculate within that range
            const sliderMargin = 8; // px from each side
            const containerWidth = selectedBar.parentElement.offsetWidth || 200;
            const effectiveWidth = containerWidth - 2 * sliderMargin;
            
            // Calculate positions within the effective slider range
            const minPos = sliderMargin + (minVal / maxVal) * effectiveWidth - 8; // -8 for min thumb offset
            const maxPos = sliderMargin + (maxValCurrent / maxVal) * effectiveWidth + 8; // +8 for max thumb offset
            
            selectedBar.style.left = Math.max(0, minPos) + 'px';
            selectedBar.style.width = Math.min(containerWidth, maxPos) - Math.max(0, minPos) + 'px';
        }
        
        function updateExcludeStyle() {
            if (excludeCheckbox.checked) {
                item.classList.add('excluded');
            } else {
                item.classList.remove('excluded');
            }
        }
        
        minInput.addEventListener('input', updateSlider);
        maxInput.addEventListener('input', updateSlider);
        excludeCheckbox.addEventListener('change', updateExcludeStyle);
        
        // Initialize
        updateSlider();
        updateExcludeStyle();
    });
}

function openFilterModal() {
    const modal = document.getElementById('filter-modal');
    modal.classList.remove('hidden');
    
    // Restore state checkboxes
    document.querySelectorAll('#filter-state input').forEach(cb => {
        cb.checked = filters.states.includes(cb.value);
    });
    
    // Restore season checkboxes
    document.querySelectorAll('#filter-season input').forEach(cb => {
        cb.checked = filters.seasons.includes(cb.value);
    });
    
    // Restore time checkboxes
    document.querySelectorAll('#filter-time input').forEach(cb => {
        cb.checked = filters.times.includes(cb.value);
    });
    
    // Restore gender checkboxes
    document.querySelectorAll('#filter-gender input').forEach(cb => {
        cb.checked = filters.genders.includes(cb.value);
    });
    
    // Restore vote status checkboxes
    const voteStatusInputs = document.querySelectorAll('#filter-vote-status input');
    voteStatusInputs.forEach(cb => {
        if (cb.value === 'has_my_vote') cb.checked = filters.hasMyVote;
        if (cb.value === 'has_fragrantica') cb.checked = filters.hasFragrantica;
    });
    
    // Restore score range sliders
    document.querySelectorAll('.score-filter-item').forEach(item => {
        const scoreType = item.dataset.score;
        const scoreFilter = filters[scoreType];
        if (scoreFilter) {
            item.querySelector('.range-min').value = scoreFilter.min;
            item.querySelector('.range-max').value = scoreFilter.max;
            item.querySelector('.score-exclude').checked = scoreFilter.exclude;
            
            // Update visuals
            const maxVal = parseFloat(item.dataset.max);
            const selectedBar = item.querySelector('.range-selected');
            const leftPercent = (scoreFilter.min / maxVal) * 100;
            const rightPercent = (scoreFilter.max / maxVal) * 100;
            selectedBar.style.left = leftPercent + '%';
            selectedBar.style.width = (rightPercent - leftPercent) + '%';
            
            item.querySelector('.range-value-min').textContent = scoreFilter.min.toFixed(1);
            item.querySelector('.range-value-max').textContent = scoreFilter.max.toFixed(1);
            
            if (scoreFilter.exclude) {
                item.classList.add('excluded');
            } else {
                item.classList.remove('excluded');
            }
        }
        // Restore per-dim voted_status dropdown
        const vs = item.querySelector('.voted-status-select');
        if (vs) {
            vs.value = (filters.votedStatus && filters.votedStatus[scoreType]) || 'any';
        }
    });

    // Restore gender voted_status
    const genderVoted = document.getElementById('filter-gender-voted');
    if (genderVoted) {
        genderVoted.value = (filters.votedStatus && filters.votedStatus.gender) || 'any';
    }
    
    setSelectValues('filter-brand', filters.brands);
    setSelectValues('filter-concentration', filters.concentrations);
    setSelectValues('filter-location', filters.locations);
    setSelectValues('filter-tag', filters.tags);
    
    // Restore year range entries
    document.getElementById('filter-year-min').value = filters.yearMin > 0 ? String(filters.yearMin) : '';
    document.getElementById('filter-year-max').value = filters.yearMax > 0 ? String(filters.yearMax) : '';
    
    // Restore tags logic
    document.querySelectorAll('input[name="tags-logic"]').forEach(radio => {
        radio.checked = (radio.value === filters.tagsLogic);
    });
}

function applyFilters() {
    // Get state checkboxes
    filters.states = Array.from(document.querySelectorAll('#filter-state input:checked'))
        .map(cb => cb.value);
    
    // Get season checkboxes
    filters.seasons = Array.from(document.querySelectorAll('#filter-season input:checked'))
        .map(cb => cb.value);
    
    // Get time checkboxes
    filters.times = Array.from(document.querySelectorAll('#filter-time input:checked'))
        .map(cb => cb.value);
    
    // Get gender checkboxes
    filters.genders = Array.from(document.querySelectorAll('#filter-gender input:checked'))
        .map(cb => cb.value);
    
    // Get vote status
    const voteStatusChecked = Array.from(document.querySelectorAll('#filter-vote-status input:checked'))
        .map(cb => cb.value);
    filters.hasMyVote = voteStatusChecked.includes('has_my_vote');
    filters.hasFragrantica = voteStatusChecked.includes('has_fragrantica');
    
    // Get score range values + per-dim voted_status
    document.querySelectorAll('.score-filter-item').forEach(item => {
        const scoreType = item.dataset.score;
        filters[scoreType] = {
            min: parseFloat(item.querySelector('.range-min').value),
            max: parseFloat(item.querySelector('.range-max').value),
            exclude: item.querySelector('.score-exclude').checked
        };
        const vs = item.querySelector('.voted-status-select');
        if (vs) {
            filters.votedStatus[scoreType] = vs.value || 'any';
        }
    });

    // Gender per-dim voted_status (lives outside the score-filter-item grid)
    const genderVoted = document.getElementById('filter-gender-voted');
    if (genderVoted) {
        filters.votedStatus.gender = genderVoted.value || 'any';
    }
    
    filters.brands = getSelectValues('filter-brand');
    filters.concentrations = getSelectValues('filter-concentration');
    filters.locations = getSelectValues('filter-location');
    filters.tags = getSelectValues('filter-tag');
    
    // Year range
    const yMin = parseInt(document.getElementById('filter-year-min').value, 10);
    const yMax = parseInt(document.getElementById('filter-year-max').value, 10);
    filters.yearMin = Number.isFinite(yMin) && yMin > 0 ? yMin : 0;
    filters.yearMax = Number.isFinite(yMax) && yMax > 0 ? yMax : 0;
    
    // Get tags logic
    const selectedLogic = document.querySelector('input[name="tags-logic"]:checked');
    filters.tagsLogic = selectedLogic ? selectedLogic.value : 'or';
    
    closeAllModals();
    applyFiltersAndSort();
}

function clearFilters() {
    filters = {
        states: [],
        seasons: [],
        times: [],
        genders: [],
        hasMyVote: false,
        hasFragrantica: false,
        brands: [],
        concentrations: [],
        locations: [],
        tags: [],
        tagsLogic: 'or',
        rating: { min: 0, max: 5, exclude: false },
        longevity: { min: 0, max: 5, exclude: false },
        sillage: { min: 0, max: 4, exclude: false },
        value: { min: 0, max: 5, exclude: false },
        votedStatus: {
            rating: 'any',
            longevity: 'any',
            sillage: 'any',
            value: 'any',
            gender: 'any'
        },
        yearMin: 0,
        yearMax: 0
    };
    
    // Clear state checkboxes
    document.querySelectorAll('#filter-state input').forEach(cb => cb.checked = false);
    
    // Clear season/time/gender/vote-status checkboxes
    document.querySelectorAll('#filter-season input, #filter-time input, #filter-gender input, #filter-vote-status input')
        .forEach(cb => cb.checked = false);
    
    // Reset score range sliders
    document.querySelectorAll('.score-filter-item').forEach(item => {
        const maxVal = parseFloat(item.dataset.max);
        item.querySelector('.range-min').value = 0;
        item.querySelector('.range-max').value = maxVal;
        item.querySelector('.score-exclude').checked = false;
        item.querySelector('.range-value-min').textContent = '0.0';
        item.querySelector('.range-value-max').textContent = maxVal.toFixed(1);
        item.querySelector('.range-selected').style.left = '0%';
        item.querySelector('.range-selected').style.width = '100%';
        item.classList.remove('excluded');
        const vs = item.querySelector('.voted-status-select');
        if (vs) vs.value = 'any';
    });

    // Reset gender voted-status dropdown
    const genderVoted = document.getElementById('filter-gender-voted');
    if (genderVoted) genderVoted.value = 'any';
    
    // Clear select boxes
    ['filter-brand', 'filter-concentration', 'filter-location', 'filter-tag'].forEach(id => {
        const select = document.getElementById(id);
        Array.from(select.options).forEach(opt => opt.selected = false);
    });
    
    // Reset year range entries
    document.getElementById('filter-year-min').value = '';
    document.getElementById('filter-year-max').value = '';
    
    // Reset tags logic to OR
    document.querySelectorAll('input[name="tags-logic"]').forEach(radio => {
        radio.checked = (radio.value === 'or');
    });
    
    closeAllModals();
    applyFiltersAndSort();
}

function updateActiveFiltersDisplay() {
    const container = document.getElementById('active-filters');
    const tags = [];
    
    filters.brands.forEach(id => {
        tags.push({ type: 'brand', id, label: brandsMap[id] || id });
    });
    filters.concentrations.forEach(id => {
        tags.push({ type: 'concentration', id, label: concentrationsMap[id] || id });
    });
    filters.locations.forEach(id => {
        tags.push({ type: 'location', id, label: outletsMap[id]?.name || id });
    });
    filters.tags.forEach(id => {
        tags.push({ type: 'tag', id, label: tagsMap[id] || id });
    });
    
    if (tags.length === 0) {
        container.classList.add('hidden');
        return;
    }
    
    container.classList.remove('hidden');
    container.innerHTML = tags.map(t => `
        <span class="filter-tag" data-type="${t.type}" data-id="${t.id}">
            ${escapeHtml(t.label)}
            <span class="remove" onclick="removeFilter('${t.type}', '${t.id}')">✕</span>
        </span>
    `).join('');
}

function removeFilter(type, id) {
    const key = type === 'brand' ? 'brands' : 
                type === 'concentration' ? 'concentrations' :
                type === 'location' ? 'locations' : 'tags';
    filters[key] = filters[key].filter(x => x !== id);
    applyFiltersAndSort();
}

function updateFilterButtonState() {
    const btn = document.getElementById('filter-btn');
    
    // Check if any score filter is active
    const hasScoreFilter = (
        filters.rating.min > 0 || filters.rating.max < 5 || filters.rating.exclude ||
        filters.longevity.min > 0 || filters.longevity.max < 5 || filters.longevity.exclude ||
        filters.sillage.min > 0 || filters.sillage.max < 4 || filters.sillage.exclude ||
        filters.value.min > 0 || filters.value.max < 5 || filters.value.exclude
    );
    
    // Per-dim voted_status (any non-'any' value counts as an active filter)
    const hasVotedStatusFilter = Object.values(filters.votedStatus || {})
        .some(v => v && v !== 'any');

    const hasFilters = filters.states.length > 0 ||
                       filters.seasons.length > 0 ||
                       filters.times.length > 0 ||
                       filters.genders.length > 0 ||
                       filters.hasMyVote ||
                       filters.hasFragrantica ||
                       filters.brands.length > 0 || 
                       filters.concentrations.length > 0 || 
                       filters.locations.length > 0 || 
                       filters.tags.length > 0 ||
                       filters.yearMin > 0 ||
                       filters.yearMax > 0 ||
                       hasScoreFilter ||
                       hasVotedStatusFilter;
    btn.classList.toggle('active', hasFilters);
}

// ============================================
// Utilities
// ============================================

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function getDomainFromUrl(url) {
    try {
        const u = new URL(url);
        return u.hostname.replace('www.', '');
    } catch {
        return null;
    }
}

function debounce(fn, delay) {
    let timer;
    return function(...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
}

function getSelectValues(id) {
    const select = document.getElementById(id);
    return Array.from(select.selectedOptions).map(opt => opt.value);
}

function setSelectValues(id, values) {
    const select = document.getElementById(id);
    Array.from(select.options).forEach(opt => {
        opt.selected = values.includes(opt.value);
    });
}

// ============================================
// Mobile Data Entry (Drafts) — Phase 2
// ============================================
//
// Wire format matches the desktop MobileImportDialog in perfume_tracker.py.
// Drafts live in localStorage only; export produces a version-1 bundle the
// desktop dialog reads.  See the schema block near the top of the Python
// file for the full contract.

const DRAFTS_STORAGE_KEY = 'perfumeTracker.drafts.v1';
const DRAFTS_BUNDLE_VERSION = 1;
const DRAFTS_GENERATOR = 'perfume-tracker-web/1.0';

// Which dimensions get the compact vote UI.
//
// IMPORTANT: `key` here must be the *personal* vote key (my_* prefix),
// not the Fragrantica-side key.  These are the keys used *inside*
// p.my_votes.  Corresponds to VOTE_BLOCKS[*].myKey in this file.
// Writing to bare "rating_votes" instead of "my_rating_votes" here
// (a) fails to pre-select the user's existing personal vote in the
// compact UI, and (b) writes new votes under a key that desktop UI
// silently ignores -- so the mobile edit effectively becomes a no-op.
//
// season_time_votes is intentionally excluded from the compact UI
// because "when to wear" is 6 tap targets and mobile-heavy users usually
// vote it from the desktop; leaving it out keeps the form short.  If
// you want it later, add {key:'my_season_time_votes', ...} here.
const COMPACT_VOTE_DIMS = [
    { key: 'my_rating_votes',    label: 'Rating',     options: ['love','like','ok','dislike','hate'] },
    { key: 'my_longevity_votes', label: 'Longevity',  options: ['eternal','long','moderate','weak','poor'] },
    { key: 'my_sillage_votes',   label: 'Sillage',    options: ['enormous','strong','moderate','intimate'] },
    { key: 'my_value_votes',     label: 'Value',      options: ['excellent','good','fair','expensive','overpriced'] },
    { key: 'my_gender_votes',    label: 'Gender',     options: ['male','more_male','unisex','more_female','female'] },
];

// Draft-list state.  Loaded on init; every mutation writes back through saveDrafts().
let drafts = [];

// Modal context tracked so Save knows whether to overwrite an existing
// draft or append a new one.
let currentEventDraftEditing = null;
let currentEventPerfume = null;
let pformContext = { mode: 'new', originalPerfume: null, draft: null };
let pformInitialEvents = [];

// ---------- localStorage ----------

function loadDrafts() {
    try {
        const raw = localStorage.getItem(DRAFTS_STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        console.warn('Failed to load drafts:', e);
        return [];
    }
}

function saveDrafts() {
    try {
        localStorage.setItem(DRAFTS_STORAGE_KEY, JSON.stringify(drafts));
    } catch (e) {
        alert('Failed to save drafts to localStorage: ' + e.message);
    }
    updateDraftsBadge();
}

function clearAllDrafts() {
    drafts = [];
    saveDrafts();
}

function newTempId() {
    // Not a proper UUID; the desktop only treats these as opaque strings.
    return 'draft-' + Date.now().toString(36) + '-' +
           Math.random().toString(36).slice(2, 10);
}

function nowIso() {
    return new Date().toISOString();
}

// ---------- Draft factories ----------

function makeNewEventDraft(perfume, event) {
    return {
        kind: 'new_event',
        temp_id: newTempId(),
        created_at: nowIso(),
        perfume_id: perfume.id,
        perfume_name_snapshot: perfume.name,
        brand_name_snapshot: brandsMap[perfume.brand_id] || '',
        event: event,
    };
}

function makeNewPerfumeDraft(data) {
    return {
        kind: 'new_perfume',
        temp_id: newTempId(),
        created_at: nowIso(),
        data: data,
    };
}

function makeEditPerfumeDraft(perfume, modifiedFields) {
    return {
        kind: 'edit_perfume',
        temp_id: newTempId(),
        created_at: nowIso(),
        perfume_id: perfume.id,
        perfume_name_snapshot: perfume.name,
        brand_name_snapshot: brandsMap[perfume.brand_id] || '',
        modified_fields: modifiedFields,
    };
}

// ---------- Bootstrap ----------

function initDrafts() {
    drafts = loadDrafts();
    updateDraftsBadge();
    wireDraftEventListeners();
}

function updateDraftsBadge() {
    const badge = document.getElementById('drafts-badge');
    if (!badge) return;
    const n = drafts.length;
    if (n === 0) {
        badge.classList.add('hidden');
    } else {
        badge.classList.remove('hidden');
        badge.textContent = n > 99 ? '99+' : String(n);
    }
}

function wireDraftEventListeners() {
    document.getElementById('drafts-btn').addEventListener('click', openDraftsModal);
    document.getElementById('drafts-add-perfume').addEventListener('click', () => {
        document.getElementById('drafts-modal').classList.add('hidden');
        openNewPerfumeModal();
    });
    document.getElementById('drafts-clear-all').addEventListener('click', handleClearAllDrafts);
    document.getElementById('drafts-export').addEventListener('click', () => {
        document.getElementById('drafts-modal').classList.add('hidden');
        openExportModal();
    });

    document.getElementById('detail-add-event').addEventListener('click', () => {
        const p = getSelectedPerfume();
        if (p) openNewEventModal(p);
    });
    document.getElementById('detail-edit-perfume').addEventListener('click', () => {
        const p = getSelectedPerfume();
        if (p) openEditPerfumeModal(p);
    });

    document.getElementById('event-save').addEventListener('click', saveEventDraft);
    document.querySelectorAll('#event-type-buttons .chip-btn').forEach(b => {
        b.addEventListener('click', () => {
            document.querySelectorAll('#event-type-buttons .chip-btn').forEach(x => x.classList.remove('active'));
            b.classList.add('active');
        });
    });

    document.getElementById('pform-save').addEventListener('click', savePerfumeDraft);
    document.getElementById('pform-add-event').addEventListener('click', addInitialEventRow);

    document.getElementById('export-copy').addEventListener('click', handleExportCopy);
    document.getElementById('export-download').addEventListener('click', handleExportDownload);

    // Extend generic close handlers to include our new modals.  We hook
    // .modal-close directly rather than patching closeAllModals() because
    // the existing closeAllModals() is only used from the old-modal
    // handlers -- the .modal-close class is already wired in
    // setupEventListeners() for every button with that class.
    // But the modal-backdrop click was also wired; our new modals get
    // that wiring for free because we reused the same HTML structure.
    // Nothing extra needed here.
}

function getSelectedPerfume() {
    if (!selectedPerfumeId) return null;
    return perfumes.find(p => p.id === selectedPerfumeId) || null;
}

// ---------- Drafts modal ----------

function openDraftsModal() {
    renderDraftsList();
    document.getElementById('drafts-modal').classList.remove('hidden');
}

function renderDraftsList() {
    const container = document.getElementById('drafts-list');
    if (!container) return;
    if (drafts.length === 0) {
        container.innerHTML = '<p class="drafts-empty">No drafts yet. Tap "+ Event" on a perfume, "✎ Edit" to modify one, or "+ New Perfume" below.</p>';
        return;
    }
    container.innerHTML = drafts.map(d => renderDraftRow(d)).join('');
    container.querySelectorAll('[data-action="delete-draft"]').forEach(btn => {
        btn.addEventListener('click', () => deleteDraft(btn.dataset.tempId));
    });
    container.querySelectorAll('[data-action="edit-draft"]').forEach(btn => {
        btn.addEventListener('click', () => openEditDraft(btn.dataset.tempId));
    });
}

function renderDraftRow(draft) {
    const kind = draft.kind;
    const kindLabel = kind === 'new_event'    ? 'Event'
                    : kind === 'new_perfume'  ? 'New'
                    : kind === 'edit_perfume' ? 'Edit'
                    : kind;
    let title = '';
    let detail = '';
    if (kind === 'new_event') {
        title = `${draft.brand_name_snapshot || ''} — ${draft.perfume_name_snapshot || '?'}`;
        const evt = draft.event || {};
        const parts = [evt.event_type, evt.event_date || '(today)'];
        if (evt.outlet_name_new) parts.push('@ ' + evt.outlet_name_new);
        else if (evt.outlet_id && outletsMap[evt.outlet_id]) {
            parts.push('@ ' + outletsMap[evt.outlet_id].name);
        }
        if (evt.note) parts.push('— ' + evt.note);
        detail = parts.join('  ');
    } else if (kind === 'new_perfume') {
        const data = draft.data || {};
        const brand = data.brand_name_new || data.brand_name_snapshot || '';
        title = `${brand} — ${data.name || '(unnamed)'}`.trim();
        const bits = [];
        if (data.concentration_name_new || data.concentration_name_snapshot) {
            bits.push(data.concentration_name_new || data.concentration_name_snapshot);
        }
        if (data.year) bits.push(String(data.year));
        const nTags = (data.tag_ids || []).length + (data.tag_names_new || []).length;
        if (nTags) bits.push(`${nTags} tag(s)`);
        const nEvents = (data.events || []).length;
        if (nEvents) bits.push(`${nEvents} event(s)`);
        detail = bits.join(' · ');
    } else if (kind === 'edit_perfume') {
        title = `${draft.brand_name_snapshot || ''} — ${draft.perfume_name_snapshot || '?'}`;
        const nFields = Object.keys(draft.modified_fields || {}).length;
        detail = `${nFields} field(s) modified`;
    }
    return `
        <div class="draft-row">
            <span class="draft-row-kind k-${kind}">${escapeHtml(kindLabel)}</span>
            <div class="draft-row-body">
                <div class="draft-row-title">${escapeHtml(title)}</div>
                <div class="draft-row-detail">${escapeHtml(detail)}</div>
            </div>
            <div class="draft-row-actions">
                <button data-action="edit-draft" data-temp-id="${escapeAttr(draft.temp_id)}" class="btn btn-secondary btn-small">Edit</button>
                <button data-action="delete-draft" data-temp-id="${escapeAttr(draft.temp_id)}" class="btn btn-danger btn-small">Del</button>
            </div>
        </div>
    `;
}

function deleteDraft(tempId) {
    if (!confirm('Delete this draft?')) return;
    drafts = drafts.filter(d => d.temp_id !== tempId);
    saveDrafts();
    renderDraftsList();
}

function handleClearAllDrafts() {
    if (drafts.length === 0) return;
    if (!confirm(`Delete all ${drafts.length} draft(s)? This cannot be undone.`)) return;
    clearAllDrafts();
    renderDraftsList();
}

function openEditDraft(tempId) {
    const draft = drafts.find(d => d.temp_id === tempId);
    if (!draft) return;
    document.getElementById('drafts-modal').classList.add('hidden');
    if (draft.kind === 'new_event') {
        openNewEventModalForDraft(draft);
    } else if (draft.kind === 'new_perfume') {
        openNewPerfumeModalForDraft(draft);
    } else if (draft.kind === 'edit_perfume') {
        const perfume = perfumes.find(p => p.id === draft.perfume_id);
        if (perfume) {
            openEditPerfumeModal(perfume, draft);
        } else {
            alert('The original perfume no longer exists in the desktop data. You can Delete this draft.');
            openDraftsModal();
        }
    }
}

// ---------- Event modal (new_event) ----------

function openNewEventModal(perfume) {
    currentEventDraftEditing = null;
    currentEventPerfume = perfume;
    setupEventModal({
        title: 'Log Event',
        perfume: perfume,
        event: { event_type: 'smell' },
    });
    document.getElementById('event-modal').classList.remove('hidden');
}

function openNewEventModalForDraft(draft) {
    const perfume = perfumes.find(p => p.id === draft.perfume_id);
    currentEventDraftEditing = draft;
    currentEventPerfume = perfume || null;
    setupEventModal({
        title: perfume ? 'Edit Event' : 'Edit Event (target missing)',
        perfume: perfume,
        perfumeSnapshot: perfume ? null : {
            brand: draft.brand_name_snapshot,
            name: draft.perfume_name_snapshot,
        },
        event: draft.event || {},
    });
    document.getElementById('event-modal').classList.remove('hidden');
}

function setupEventModal(opts) {
    document.getElementById('event-modal-title').textContent = opts.title;
    let head = '';
    if (opts.perfume) {
        const b = brandsMap[opts.perfume.brand_id] || 'Unknown';
        head = `${b} — ${opts.perfume.name}`;
    } else if (opts.perfumeSnapshot) {
        const s = opts.perfumeSnapshot;
        head = `${s.brand || ''} — ${s.name || ''}`.trim();
    }
    document.getElementById('event-modal-target').textContent = head;

    const type = opts.event.event_type || 'smell';
    document.querySelectorAll('#event-type-buttons .chip-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.type === type);
    });
    document.getElementById('event-date').value = opts.event.event_date || '';
    const loc = opts.event.outlet_name_new
             || (opts.event.outlet_id && outletsMap[opts.event.outlet_id]?.name)
             || '';
    document.getElementById('event-location').value = loc;
    populateLocationDatalist('event-location-options');
    document.getElementById('event-note').value = opts.event.note || '';
}

function populateLocationDatalist(datalistId) {
    const dl = document.getElementById(datalistId);
    if (!dl) return;
    const names = Object.values(outletsMap).map(o => o.name).filter(Boolean).sort();
    dl.innerHTML = names.map(n => `<option value="${escapeAttr(n)}">`).join('');
}

function saveEventDraft() {
    const activeBtn = document.querySelector('#event-type-buttons .chip-btn.active');
    const eventType = activeBtn ? activeBtn.dataset.type : 'smell';
    const eventDate = document.getElementById('event-date').value;
    const locName = document.getElementById('event-location').value.trim();
    const note = document.getElementById('event-note').value.trim();

    const eventObj = { event_type: eventType };
    if (eventDate) eventObj.event_date = eventDate;
    if (note) eventObj.note = note;
    if (locName) {
        // Resolve to an existing outlet id when the name matches exactly;
        // otherwise carry as name_new for desktop-side create-or-match.
        const existing = Object.entries(outletsMap).find(
            ([id, o]) => (o.name || '') === locName
        );
        if (existing) eventObj.outlet_id = existing[0];
        else eventObj.outlet_name_new = locName;
    }

    if (currentEventDraftEditing) {
        currentEventDraftEditing.event = eventObj;
        if (currentEventPerfume) {
            currentEventDraftEditing.perfume_name_snapshot = currentEventPerfume.name;
            currentEventDraftEditing.brand_name_snapshot = brandsMap[currentEventPerfume.brand_id] || '';
        }
    } else if (currentEventPerfume) {
        drafts.push(makeNewEventDraft(currentEventPerfume, eventObj));
    } else {
        // Somehow got here without a perfume; bail rather than write a bad draft.
        return;
    }
    saveDrafts();
    document.getElementById('event-modal').classList.add('hidden');
    renderDraftsList();  // in case drafts modal is reopened
}

// ---------- Perfume form modal (new_perfume / edit_perfume) ----------

function openNewPerfumeModal() {
    pformContext = { mode: 'new', originalPerfume: null, draft: null };
    setupPerfumeForm({
        title: 'New Perfume',
        hint: 'Most fields are optional — capture what you know now, review on desktop later.',
        data: {},
    });
    document.getElementById('perfume-form-modal').classList.remove('hidden');
}

function openNewPerfumeModalForDraft(draft) {
    pformContext = { mode: 'new', originalPerfume: null, draft: draft };
    setupPerfumeForm({
        title: 'Edit Draft: New Perfume',
        hint: '',
        data: draft.data || {},
    });
    document.getElementById('perfume-form-modal').classList.remove('hidden');
}

function openEditPerfumeModal(perfume, existingDraft = null) {
    pformContext = { mode: 'edit', originalPerfume: perfume, draft: existingDraft };
    const seed = seedFromPerfume(perfume);
    if (existingDraft && existingDraft.modified_fields) {
        overlayModifiedFields(seed, existingDraft.modified_fields, perfume);
    }
    setupPerfumeForm({
        title: 'Edit: ' + perfume.name,
        hint: 'Only fields you actually change will be included in the export.',
        data: seed,
    });
    document.getElementById('perfume-form-modal').classList.remove('hidden');
}

function seedFromPerfume(p) {
    return {
        name: p.name || '',
        brand_id: p.brand_id || '',
        brand_name_snapshot: brandsMap[p.brand_id] || '',
        concentration_id: p.concentration_id || '',
        concentration_name_snapshot: concentrationsMap[p.concentration_id] || '',
        year: p.year || 0,
        tag_ids: (p.tag_ids || []).slice(),
        tag_names_new: [],
        outlet_ids: (p.outlet_ids || []).slice(),
        outlet_names_new: [],
        my_votes: JSON.parse(JSON.stringify(p.my_votes || {})),
        notes: (p.notes || []).map(n => ({
            id: n.id, title: n.title || 'Note', content: n.content || ''
        })),
        events: [],
        // Edit-mode "append-only note" pending state.  When reopening a
        // draft, overlayModifiedFields fills this from mods.notes so the
        // user can further tweak the note they were about to append.
        // Null means "no pending append -- fresh session".
        _pending_note: null,
    };
}

function overlayModifiedFields(seed, mods, originalPerfume) {
    if ('name' in mods) seed.name = mods.name || '';
    if ('year' in mods) seed.year = mods.year || 0;
    if ('my_votes' in mods) seed.my_votes = JSON.parse(JSON.stringify(mods.my_votes || {}));
    if ('notes' in mods) {
        // Edit-mode notes are append-only from mobile's perspective.  The
        // draft stores the full replacement list, but the "new" bit is
        // just the tail beyond the original perfume's note count.  Pull
        // that out so setupPerfumeForm can pre-fill the append field.
        // If the delta is 0 (e.g., desktop grew the notes list after
        // the draft was created), we leave _pending_note null.
        const origLen = ((originalPerfume || {}).notes || []).length;
        const modNotes = mods.notes || [];
        if (modNotes.length > origLen) {
            // Take the first tail entry; if user appended more than one
            // across sessions we only surface the first, but our current
            // Save logic only ever appends one so this is fine in practice.
            seed._pending_note = { ...modNotes[origLen] };
        }
    }
    if ('tags' in mods) {
        seed.tag_ids = (mods.tags.tag_ids || []).slice();
        seed.tag_names_new = (mods.tags.tag_names_new || []).slice();
    }
}

function setupPerfumeForm(opts) {
    const isEdit = pformContext.mode === 'edit';

    document.getElementById('pform-title').textContent = opts.title;
    document.getElementById('pform-mode-hint').textContent = opts.hint || '';
    const d = opts.data || {};

    document.getElementById('pform-name').value = d.name || '';
    document.getElementById('pform-brand').value = d.brand_name_new || d.brand_name_snapshot || '';
    document.getElementById('pform-concentration').value =
        d.concentration_name_new || d.concentration_name_snapshot || '';
    document.getElementById('pform-year').value = d.year || '';

    // Notes: mobile keeps things simple.
    //   - new_perfume mode: the single note this new perfume ships with.
    //     Pre-fill from d.notes[0] so reopening a draft is idempotent.
    //   - edit_perfume mode: append-only.  Never surfaces existing notes
    //     (avoid the "clear content = delete first note" footgun); shows
    //     any pending append the draft has staged from a prior session.
    const labelEl = document.getElementById('pform-note-label');
    const hintEl = document.getElementById('pform-note-hint');
    if (isEdit) {
        labelEl.textContent = 'Add note (optional)';
        const nExisting = ((pformContext.originalPerfume || {}).notes || []).length;
        hintEl.textContent = nExisting > 0
            ? `Appends a new note. Existing ${nExisting} note(s) are kept as-is; edit them on desktop.`
            : 'Appends a new note. Leave blank to skip.';
        const pending = d._pending_note;
        document.getElementById('pform-note-title').value = pending ? (pending.title || '') : '';
        document.getElementById('pform-note-content').value = pending ? (pending.content || '') : '';
    } else {
        labelEl.textContent = 'Note (optional)';
        hintEl.textContent = '';
        let noteTitle = '';
        let noteContent = '';
        if ((d.notes || []).length > 0) {
            noteTitle = d.notes[0].title || '';
            noteContent = d.notes[0].content || '';
        }
        document.getElementById('pform-note-title').value = noteTitle;
        document.getElementById('pform-note-content').value = noteContent;
    }

    populateBrandDatalist();
    populateConcentrationDatalist();

    // Hide brand/concentration in edit mode -- desktop's edit_perfume
    // doesn't support them, so we don't offer edits that would be lost.
    setRowVisible(document.getElementById('pform-brand'), !isEdit);
    setRowVisible(document.getElementById('pform-concentration'), !isEdit);
    // Hide outlets in edit mode for the same reason.
    document.getElementById('pform-outlets-chips').parentElement.style.display =
        isEdit ? 'none' : '';
    // Initial events section only makes sense for a brand-new perfume.
    document.getElementById('pform-initial-events-wrap').style.display =
        isEdit ? 'none' : '';

    setupChipsInput(
        'pform-tags-chips',
        (d.tag_ids || []).map(id => tagsMap[id]).filter(Boolean),
        (d.tag_names_new || []).slice(),
        Object.values(tagsMap).filter(Boolean).sort(),
    );
    if (!isEdit) {
        setupChipsInput(
            'pform-outlets-chips',
            (d.outlet_ids || []).map(id => outletsMap[id]?.name).filter(Boolean),
            (d.outlet_names_new || []).slice(),
            Object.values(outletsMap).map(o => o.name).filter(Boolean).sort(),
        );
    }

    setupCompactVotes('pform-my-votes', d.my_votes || {});

    if (!isEdit) {
        pformInitialEvents = (d.events || []).slice();
        renderPformEvents();
    }
}

function setRowVisible(inputEl, visible) {
    // .filter-group is the parent wrapper for form rows; hide/show it.
    const group = inputEl.closest('.filter-group');
    if (group) group.style.display = visible ? '' : 'none';
}

function populateBrandDatalist() {
    const dl = document.getElementById('pform-brand-options');
    if (!dl) return;
    dl.innerHTML = Object.values(brandsMap).sort()
        .map(n => `<option value="${escapeAttr(n)}">`).join('');
}

function populateConcentrationDatalist() {
    const dl = document.getElementById('pform-concentration-options');
    if (!dl) return;
    dl.innerHTML = Object.values(concentrationsMap).sort()
        .map(n => `<option value="${escapeAttr(n)}">`).join('');
}

// ---------- Chip input (tags, outlets) ----------

function setupChipsInput(containerId, existingNames, newNames, candidates) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const all = [...existingNames, ...newNames];
    container.innerHTML = '';
    container.dataset.chips = JSON.stringify(all);

    const listEl = document.createElement('div');
    listEl.className = 'chips-input-inner';
    listEl.style.display = 'contents';  // let flex-wrap in parent handle it
    container.appendChild(listEl);
    renderChips(container, listEl);

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Type + Enter';
    input.setAttribute('list', containerId + '-datalist');
    container.appendChild(input);

    // Datalist for suggestions
    let dl = document.getElementById(containerId + '-datalist');
    if (!dl) {
        dl = document.createElement('datalist');
        dl.id = containerId + '-datalist';
        container.appendChild(dl);
    }
    dl.innerHTML = candidates.map(n => `<option value="${escapeAttr(n)}">`).join('');

    const commit = () => {
        const val = input.value.trim();
        if (!val) return;
        const current = JSON.parse(container.dataset.chips || '[]');
        if (current.includes(val)) {
            input.value = '';
            return;
        }
        current.push(val);
        container.dataset.chips = JSON.stringify(current);
        input.value = '';
        renderChips(container, listEl);
    };
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            commit();
        } else if (e.key === 'Backspace' && !input.value) {
            const current = JSON.parse(container.dataset.chips || '[]');
            if (current.length > 0) {
                current.pop();
                container.dataset.chips = JSON.stringify(current);
                renderChips(container, listEl);
            }
        }
    });
    input.addEventListener('blur', commit);
}

function renderChips(container, listEl) {
    const current = JSON.parse(container.dataset.chips || '[]');
    // Remove existing chip elements (leave input alone).
    Array.from(container.querySelectorAll('.chip-tag')).forEach(el => el.remove());
    // Insert chips before the input.
    const input = container.querySelector('input[type="text"]');
    current.forEach((name, idx) => {
        const chip = document.createElement('span');
        chip.className = 'chip-tag';
        chip.innerHTML = `${escapeHtml(name)} <button type="button" data-idx="${idx}" aria-label="Remove">×</button>`;
        chip.querySelector('button').addEventListener('click', () => {
            const arr = JSON.parse(container.dataset.chips || '[]');
            arr.splice(idx, 1);
            container.dataset.chips = JSON.stringify(arr);
            renderChips(container, listEl);
        });
        if (input) container.insertBefore(chip, input);
        else container.appendChild(chip);
    });
}

function getChipsValues(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return [];
    return JSON.parse(container.dataset.chips || '[]');
}

// ---------- Compact vote UI ----------

function setupCompactVotes(containerId, existingVotes) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';
    COMPACT_VOTE_DIMS.forEach(dim => {
        const row = document.createElement('div');
        row.className = 'compact-vote-row';
        row.dataset.dimKey = dim.key;

        const label = document.createElement('div');
        label.className = 'compact-vote-label';
        label.textContent = dim.label;
        row.appendChild(label);

        const opts = document.createElement('div');
        opts.className = 'compact-vote-options';
        // Pre-existing per-option counts.  Anything >0 for an option in this
        // dimension counts as "voted for this option"; if multiple are >0
        // we pick the highest as the pre-selected chip.  The wire format
        // supports counts (matching desktop), but the UI treats each
        // dimension as "pick one" for compactness.
        const existing = existingVotes[dim.key] || {};
        let bestOpt = null;
        let bestCount = 0;
        for (const opt of dim.options) {
            const cnt = existing[opt] || 0;
            if (cnt > bestCount) { bestOpt = opt; bestCount = cnt; }
        }
        dim.options.forEach(opt => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'compact-vote-btn';
            btn.dataset.option = opt;
            btn.textContent = prettyVoteLabel(opt);
            if (opt === bestOpt) btn.classList.add('selected');
            btn.addEventListener('click', () => {
                const wasSelected = btn.classList.contains('selected');
                opts.querySelectorAll('.compact-vote-btn').forEach(b =>
                    b.classList.remove('selected'));
                if (!wasSelected) btn.classList.add('selected');
                // If wasSelected, tapping again clears -- gives a way to
                // "unvote" without a separate button.
            });
            opts.appendChild(btn);
        });
        row.appendChild(opts);
        container.appendChild(row);
    });
}

function prettyVoteLabel(opt) {
    // Convert 'more_male' -> 'M+', etc.  Keep short so buttons stay tight.
    const map = {
        'more_male':   'M+',
        'more_female': 'F+',
    };
    if (map[opt]) return map[opt];
    return opt.charAt(0).toUpperCase() + opt.slice(1);
}

function readCompactVotes(containerId) {
    // Simple read: emit a fresh {dim: {option: 1}} for every selected chip.
    // Used by new_perfume flow where there is no original to preserve.
    const container = document.getElementById(containerId);
    if (!container) return {};
    const out = {};
    container.querySelectorAll('.compact-vote-row').forEach(row => {
        const dimKey = row.dataset.dimKey;
        const selected = row.querySelector('.compact-vote-btn.selected');
        if (selected) {
            out[dimKey] = { [selected.dataset.option]: 1 };
        }
    });
    return out;
}

function topOptionOfDim(dimVotes) {
    let best = null;
    let bestCnt = 0;
    for (const [opt, cnt] of Object.entries(dimVotes || {})) {
        if (cnt > bestCnt) { best = opt; bestCnt = cnt; }
    }
    return best;
}

function readCompactVotesForEdit(containerId, originalVotes) {
    // Preserve-counts diff used by edit_perfume flow.  For each dim we
    // compare the currently-selected chip against the "top option" of the
    // original counts.  Same selection => keep original counts intact so
    // we don't silently downgrade e.g. {love: 3} to {love: 1}.  Different
    // selection (or cleared) => overwrite that dim with the new binary
    // choice.  Returns { changed: bool, votes: merged }.
    const container = document.getElementById(containerId);
    const result = JSON.parse(JSON.stringify(originalVotes || {}));
    if (!container) return { changed: false, votes: result };
    let changed = false;
    container.querySelectorAll('.compact-vote-row').forEach(row => {
        const dimKey = row.dataset.dimKey;
        const selected = row.querySelector('.compact-vote-btn.selected');
        const origDim = (originalVotes || {})[dimKey] || {};
        const origTop = topOptionOfDim(origDim);
        const newTop = selected ? selected.dataset.option : null;
        if (newTop === origTop) return;      // unchanged dim
        changed = true;
        if (newTop === null) delete result[dimKey];
        else result[dimKey] = { [newTop]: 1 };
    });
    return { changed, votes: result };
}

// ---------- Initial events (inside new_perfume form) ----------

function renderPformEvents() {
    const wrap = document.getElementById('pform-initial-events');
    const count = document.getElementById('pform-events-count');
    if (!wrap) return;
    count.textContent = `(${pformInitialEvents.length})`;
    if (pformInitialEvents.length === 0) {
        wrap.innerHTML = '<p class="hint">No events yet.</p>';
        return;
    }
    wrap.innerHTML = pformInitialEvents.map((e, i) => {
        const outlet = e.outlet_name_new
                    || (e.outlet_id && outletsMap[e.outlet_id]?.name)
                    || '';
        const parts = [e.event_type, e.event_date || '(today)'];
        if (outlet) parts.push('@ ' + outlet);
        if (e.note) parts.push('— ' + e.note);
        return `
            <div class="initial-event-row">
                <span class="flex-grow">${escapeHtml(parts.join('  '))}</span>
                <button type="button" data-idx="${i}" aria-label="Remove">×</button>
            </div>
        `;
    }).join('');
    wrap.querySelectorAll('button[data-idx]').forEach(btn => {
        btn.addEventListener('click', () => {
            pformInitialEvents.splice(parseInt(btn.dataset.idx, 10), 1);
            renderPformEvents();
        });
    });
}

function addInitialEventRow() {
    // Simple prompt-based capture; the full event modal is only used for
    // adding-events-to-existing-perfumes.  Keeps the "brand new perfume"
    // flow self-contained.
    const type = prompt('Event type (smell / skin):', 'smell');
    if (!type) return;
    const eventType = type.trim().toLowerCase();
    if (!['smell', 'skin'].includes(eventType)) {
        alert('Type must be "smell" or "skin".');
        return;
    }
    const date = prompt('Event date (YYYY-MM-DD), leave blank for today:', '');
    const loc = prompt('Location (optional):', '');
    const note = prompt('Note (optional):', '');
    const evt = { event_type: eventType };
    if (date && date.trim()) evt.event_date = date.trim();
    if (loc && loc.trim()) {
        const locName = loc.trim();
        const existing = Object.entries(outletsMap).find(
            ([id, o]) => (o.name || '') === locName);
        if (existing) evt.outlet_id = existing[0];
        else evt.outlet_name_new = locName;
    }
    if (note && note.trim()) evt.note = note.trim();
    pformInitialEvents.push(evt);
    renderPformEvents();
}

// ---------- Save perfume form ----------

function savePerfumeDraft() {
    const isEdit = pformContext.mode === 'edit';

    const name = document.getElementById('pform-name').value.trim();
    const brandTxt = document.getElementById('pform-brand').value.trim();
    const concTxt = document.getElementById('pform-concentration').value.trim();
    const yearRaw = document.getElementById('pform-year').value.trim();
    const year = yearRaw && /^\d+$/.test(yearRaw) ? parseInt(yearRaw, 10) : 0;
    const noteTitle = document.getElementById('pform-note-title').value.trim();
    const noteContent = document.getElementById('pform-note-content').value.trim();
    const tagChips = getChipsValues('pform-tags-chips');
    const outletChips = isEdit ? [] : getChipsValues('pform-outlets-chips');

    if (isEdit) {
        // For edit we need count-preserving vote comparison; the simple
        // reader would lose multi-vote counts on unchanged dims.
        const origVotes = (pformContext.originalPerfume || {}).my_votes || {};
        const voteResult = readCompactVotesForEdit('pform-my-votes', origVotes);
        return saveEditPerfumeDraft({
            name, year, tagChips, noteTitle, noteContent,
            votesChanged: voteResult.changed,
            votes: voteResult.votes,
        });
    }

    // New-perfume flow: no history to preserve, emit binary counts.
    const votes = readCompactVotes('pform-my-votes');

    // New-perfume validation: brand + name are the minimum viable draft.
    if (!name || !brandTxt) {
        alert('Name and Brand are required.');
        return;
    }

    const data = { name };

    // Brand: resolve to existing id or carry as new-name
    resolveSingleName(data, 'brand', brandTxt, brandsMap);
    // Concentration
    if (concTxt) {
        resolveSingleName(data, 'concentration', concTxt, concentrationsMap);
    }
    if (year) data.year = year;

    // Tags: partition into ids and new-names
    const tagPart = partitionChips(tagChips, tagsMap);
    if (tagPart.ids.length) data.tag_ids = tagPart.ids;
    if (tagPart.namesNew.length) data.tag_names_new = tagPart.namesNew;
    if (tagPart.snapshots.length) data.tag_names_snapshot = tagPart.snapshots;

    // Outlets: partition (outletsMap has {name, region} objects, so use a
    // name-only view).
    const outletsByName = {};
    for (const [id, o] of Object.entries(outletsMap)) {
        outletsByName[id] = o.name || '';
    }
    const outletPart = partitionChips(outletChips, outletsByName);
    if (outletPart.ids.length) data.outlet_ids = outletPart.ids;
    if (outletPart.namesNew.length) data.outlet_names_new = outletPart.namesNew;
    if (outletPart.snapshots.length) data.outlet_names_snapshot = outletPart.snapshots;

    // Events
    if (pformInitialEvents.length) {
        data.events = pformInitialEvents.slice();
    }

    // Notes (single note supported on mobile)
    if (noteContent) {
        data.notes = [{ title: noteTitle || 'My Notes', content: noteContent }];
    }

    // Votes
    if (Object.keys(votes).length) {
        data.my_votes = votes;
    }

    if (pformContext.draft) {
        // Overwrite in place
        pformContext.draft.data = data;
    } else {
        drafts.push(makeNewPerfumeDraft(data));
    }
    saveDrafts();
    document.getElementById('perfume-form-modal').classList.add('hidden');
    renderDraftsList();
}

function saveEditPerfumeDraft(vals) {
    const p = pformContext.originalPerfume;
    if (!p) return;
    const modified = {};

    // name
    if (vals.name && vals.name !== p.name) {
        modified.name = vals.name;
    }
    // year
    const origYear = p.year || 0;
    if (vals.year !== origYear) {
        modified.year = vals.year || 0;
    }
    // tags
    const origTagIds = (p.tag_ids || []).slice().sort();
    const tagPart = partitionChips(vals.tagChips, tagsMap);
    const newTagIds = tagPart.ids.slice().sort();
    const tagsChanged = origTagIds.length !== newTagIds.length
                    || origTagIds.some((id, i) => id !== newTagIds[i])
                    || tagPart.namesNew.length > 0;
    if (tagsChanged) {
        modified.tags = {
            tag_ids: tagPart.ids,
            tag_names_new: tagPart.namesNew,
        };
    }
    // notes: append-only on mobile.  If the user typed anything in the
    // note field, we ship the full existing list + one appended entry.
    // Empty content => no note change of any kind.  This makes mobile
    // Edit non-destructive w.r.t. existing notes; editing / deleting
    // existing notes has to happen on the desktop.
    if (vals.noteContent) {
        modified.notes = [
            ...(p.notes || []).map(n => ({
                id: n.id, title: n.title || 'Note', content: n.content || ''
            })),
            {
                title: vals.noteTitle || 'My Notes',
                content: vals.noteContent,
            },
        ];
    }
    if (vals.votesChanged) {
        modified.my_votes = vals.votes;
    }

    if (Object.keys(modified).length === 0) {
        alert('No changes detected.');
        return;
    }

    if (pformContext.draft) {
        pformContext.draft.modified_fields = modified;
        pformContext.draft.perfume_name_snapshot = p.name;
        pformContext.draft.brand_name_snapshot = brandsMap[p.brand_id] || '';
    } else {
        drafts.push(makeEditPerfumeDraft(p, modified));
    }
    saveDrafts();
    document.getElementById('perfume-form-modal').classList.add('hidden');
    renderDraftsList();
}

function resolveSingleName(data, prefix, txt, idNameMap) {
    // idNameMap: { id: name }
    const match = Object.entries(idNameMap).find(([id, n]) => (n || '') === txt);
    if (match) {
        data[prefix + '_id'] = match[0];
        data[prefix + '_name_snapshot'] = match[1];
    } else {
        data[prefix + '_name_new'] = txt;
    }
}

function partitionChips(chipNames, idNameMap) {
    // idNameMap: { id: name }
    const ids = [];
    const snapshots = [];
    const namesNew = [];
    for (const name of chipNames) {
        const match = Object.entries(idNameMap).find(([id, n]) => (n || '') === name);
        if (match) {
            ids.push(match[0]);
            snapshots.push(match[1]);
        } else {
            namesNew.push(name);
        }
    }
    return { ids, snapshots, namesNew };
}

// ---------- Export modal ----------

function openExportModal() {
    if (drafts.length === 0) {
        alert('No drafts to export.');
        return;
    }
    const bundle = buildExportBundle();
    document.getElementById('export-textarea').value = JSON.stringify(bundle, null, 2);
    document.getElementById('export-modal').classList.remove('hidden');
}

function buildExportBundle() {
    return {
        version: DRAFTS_BUNDLE_VERSION,
        generated_at: nowIso(),
        generator: DRAFTS_GENERATOR,
        drafts: drafts.slice(),  // shallow copy so post-export edits don't leak
    };
}

function handleExportCopy() {
    const ta = document.getElementById('export-textarea');
    // Try the modern async clipboard first (works on Android Chrome).
    // Fall back to the deprecated execCommand path for older WebViews.
    const finalize = (ok) => {
        if (ok) {
            askToClearAfterExport();
        } else {
            alert('Copy failed. Select the text and copy manually.');
        }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(ta.value)
            .then(() => finalize(true))
            .catch(() => finalize(fallbackCopy(ta)));
    } else {
        finalize(fallbackCopy(ta));
    }
}

function fallbackCopy(textareaEl) {
    try {
        textareaEl.removeAttribute('readonly');
        textareaEl.select();
        const ok = document.execCommand('copy');
        textareaEl.setAttribute('readonly', 'readonly');
        return ok;
    } catch (e) {
        return false;
    }
}

function handleExportDownload() {
    const text = document.getElementById('export-textarea').value;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `perfume-drafts-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    askToClearAfterExport();
}

function askToClearAfterExport() {
    // Default is "keep", so the user has to opt in to clearing.
    if (drafts.length === 0) return;
    const clear = confirm(
        `Export ready.\n\nClear all ${drafts.length} draft(s) now?\n\n` +
        `Cancel = keep drafts (recommended until you've imported successfully on desktop).`
    );
    if (clear) {
        clearAllDrafts();
        renderDraftsList();
        document.getElementById('export-modal').classList.add('hidden');
    }
}
