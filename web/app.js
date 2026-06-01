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
let ownedMlIncludeFormats = ['full'];  // Default: only full bottles count
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
        ownedMlIncludeFormats = appData.owned_ml_include_formats || ['full'];

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
    // Stylised leaf with centre vein
    fall: `<svg class="when-icon" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M 8 2 C 12 4 12 11 8 14 C 4 11 4 4 8 2 Z"
              stroke="currentColor" stroke-width="1.5"
              stroke-linejoin="round" fill="none"/>
        <line x1="8" y1="2" x2="8" y2="14" stroke="currentColor"
              stroke-width="1.4" stroke-linecap="round"/>
    </svg>`,
    // Snowflake: 3 lines crossing at centre (6-arm star)
    winter: `<svg class="when-icon" viewBox="0 0 16 16" aria-hidden="true">
        <line x1="2" y1="8" x2="14" y2="8" stroke="currentColor"
              stroke-width="1.4" stroke-linecap="round"/>
        <line x1="5" y1="2.8" x2="11" y2="13.2" stroke="currentColor"
              stroke-width="1.4" stroke-linecap="round"/>
        <line x1="11" y1="2.8" x2="5" y2="13.2" stroke="currentColor"
              stroke-width="1.4" stroke-linecap="round"/>
    </svg>`,
    // Sun: outlined centre disc with 8 short radial rays
    day: `<svg class="when-icon" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="2.6" stroke="currentColor"
                stroke-width="1.4" fill="none"/>
        <line x1="8" y1="1.5" x2="8" y2="3.5" stroke="currentColor"
              stroke-width="1.4" stroke-linecap="round"/>
        <line x1="8" y1="12.5" x2="8" y2="14.5" stroke="currentColor"
              stroke-width="1.4" stroke-linecap="round"/>
        <line x1="1.5" y1="8" x2="3.5" y2="8" stroke="currentColor"
              stroke-width="1.4" stroke-linecap="round"/>
        <line x1="12.5" y1="8" x2="14.5" y2="8" stroke="currentColor"
              stroke-width="1.4" stroke-linecap="round"/>
        <line x1="3.4" y1="3.4" x2="4.8" y2="4.8" stroke="currentColor"
              stroke-width="1.4" stroke-linecap="round"/>
        <line x1="11.2" y1="11.2" x2="12.6" y2="12.6" stroke="currentColor"
              stroke-width="1.4" stroke-linecap="round"/>
        <line x1="12.6" y1="3.4" x2="11.2" y2="4.8" stroke="currentColor"
              stroke-width="1.4" stroke-linecap="round"/>
        <line x1="4.8" y1="11.2" x2="3.4" y2="12.6" stroke="currentColor"
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

    let ownedMl = 0;
    for (const e of events) {
        if (e.ml_delta !== null && e.ml_delta !== undefined) {
            // Only count if purchase_type is in ownedMlIncludeFormats
            const purchaseType = purchaseTypesMap[e.purchase_type_id] || '';
            if (ownedMlIncludeFormats.includes(purchaseType)) {
                ownedMl += e.ml_delta;
            }
        }
    }

    if (ownedMl > 0) return 'owned';

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

function deriveState(p) {
    const events = p.events || [];
    if (events.length === 0) return 'New';
    
    let ownedMl = 0;
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
        if (e.ml_delta !== null && e.ml_delta !== undefined) {
            // Only count if purchase_type is in ownedMlIncludeFormats
            const purchaseType = purchaseTypesMap[e.purchase_type_id] || '';
            if (ownedMlIncludeFormats.includes(purchaseType)) {
                ownedMl += e.ml_delta;
            }
        }
    }
    
    const parts = [];
    if (hasSmelled) parts.push('Smelled');
    if (hasOnSkin) parts.push('On-skin');
    if (ownedMl > 0) parts.push(`Owned ${ownedMl}ml`);
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
        
        blocks.push(`
            <div class="vote-block" data-category="${block.key}">
                <div class="vote-block-header">
                    <span class="vote-block-title">${block.label}</span>
                    <span class="vote-block-info">
                        ${scoreDisplay}
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
            const matchesState = filters.states.some(s => {
                if (s === 'owned') return state.includes('owned');
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
}

// ============================================
// Settings Modal
// ============================================

let originalFontSize = 10;
let originalOwnedFormats = ['full'];
let originalVoteSource = 'fragrantica';

function openSettingsModal() {
    const modal = document.getElementById('settings-modal');
    modal.classList.remove('hidden');
    
    // Store original values for reset
    originalFontSize = appData.font_size || 10;
    originalOwnedFormats = [...ownedMlIncludeFormats];
    originalVoteSource = voteSource;
    
    // Set font size slider
    const slider = document.getElementById('settings-font-size');
    const currentPt = Math.round(parseInt(document.documentElement.style.fontSize || '13') / 1.33);
    slider.value = currentPt;
    document.getElementById('settings-font-size-label').textContent = currentPt + 'pt';
    
    // Populate owned formats checkboxes
    const container = document.getElementById('settings-owned-formats');
    container.innerHTML = '';
    for (const [id, name] of Object.entries(purchaseTypesMap)) {
        const checked = ownedMlIncludeFormats.includes(name) ? 'checked' : '';
        container.innerHTML += `
            <label class="checkbox-item">
                <input type="checkbox" value="${name}" ${checked}> ${name}
            </label>
        `;
    }

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
    // Get selected owned formats
    const checkboxes = document.querySelectorAll('#settings-owned-formats input:checked');
    ownedMlIncludeFormats = Array.from(checkboxes).map(cb => cb.value);

    // Get selected vote source
    const sourceInput = document.querySelector('#settings-vote-source input[name="vote-source"]:checked');
    if (sourceInput && ['fragrantica', 'personal', 'fallback'].includes(sourceInput.value)) {
        voteSource = sourceInput.value;
    }

    closeAllModals();
    applyFiltersAndSort();  // Refresh list with new owned ml + vote source
}

function resetSettings() {
    // Reset to original JSON values
    document.getElementById('settings-font-size').value = originalFontSize;
    document.getElementById('settings-font-size-label').textContent = originalFontSize + 'pt';
    document.documentElement.style.fontSize = Math.round(originalFontSize * 1.33) + 'px';
    
    ownedMlIncludeFormats = [...originalOwnedFormats];
    
    // Update checkboxes
    document.querySelectorAll('#settings-owned-formats input').forEach(cb => {
        cb.checked = ownedMlIncludeFormats.includes(cb.value);
    });

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
