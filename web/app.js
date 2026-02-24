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
let concentrationsMap = {};
let outletsMap = {};
let tagsMap = {};
let noteTitlesMap = {};
let purchaseTypesMap = {};

let filters = {
    states: [],
    brands: [],
    concentrations: [],
    locations: [],
    tags: [],
    // Score ranges: { min, max, exclude }
    rating: { min: 0, max: 5, exclude: false },
    longevity: { min: 0, max: 5, exclude: false },
    sillage: { min: 0, max: 4, exclude: false },
    value: { min: 0, max: 5, exclude: false }
};

let sortField = 'brand';
let sortAscending = true;

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
        weights: [5, 4, 3, 2, 1],
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
    document.getElementById('sort-asc').addEventListener('click', () => setSortDirection(true));
    document.getElementById('sort-desc').addEventListener('click', () => setSortDirection(false));
    
    // Filter modal
    document.getElementById('filter-btn').addEventListener('click', openFilterModal);
    document.getElementById('filter-apply').addEventListener('click', applyFilters);
    document.getElementById('filter-clear').addEventListener('click', clearFilters);
    
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

function getPerfumeScore(p, voteKey) {
    const block = VOTE_BLOCKS.find(b => b.key === voteKey);
    if (!block || !p.fragrantica) return null;
    return calculateScore(p.fragrantica[voteKey], block);
}

function checkScoreFilter(p, scoreType, filter, maxVal) {
    // If filter is at default values (full range, not exclude), skip check
    if (filter.min === 0 && filter.max === maxVal && !filter.exclude) {
        return true;
    }
    
    // Map scoreType to vote key
    const voteKeyMap = {
        rating: 'rating_votes',
        longevity: 'longevity_votes',
        sillage: 'sillage_votes',
        value: 'value_votes'
    };
    
    const score = getPerfumeScore(p, voteKeyMap[scoreType]);
    const hasData = score !== null && score > 0;
    const inRange = score !== null && score >= filter.min && score <= filter.max;
    
    if (filter.exclude) {
        // Exclude mode: reject if has data and in range
        if (hasData && inRange) return false;
    } else {
        // Include mode: reject if no data or not in range
        if (!hasData || !inRange) return false;
    }
    
    return true;
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
            ownedMl += e.ml_delta;
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
    document.getElementById('detail-brand').textContent = brand;
    document.getElementById('detail-name-conc').textContent = conc ? `${p.name} · ${conc}` : p.name;
    
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
            ownedMl += e.ml_delta;
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
        const sampleSize = getSampleSize(fData, block);
        
        // Build score display
        let scoreDisplay = '';
        if (score !== null && block.maxScore) {
            scoreDisplay = `<span class="block-score">${score.toFixed(1)}</span>`;
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
    const blocks = document.querySelectorAll('.vote-block');
    const allExpanded = Array.from(blocks).every(b => b.classList.contains('expanded'));
    
    blocks.forEach(block => {
        if (allExpanded) {
            block.classList.remove('expanded');
            block.querySelector('.vote-block-toggle').textContent = '+';
        } else {
            block.classList.add('expanded');
            block.querySelector('.vote-block-toggle').textContent = '-';
        }
    });
    
    updateToggleAllButton();
}

function updateToggleAllButton() {
    const btn = document.getElementById('toggle-all-votes');
    const blocks = document.querySelectorAll('.vote-block');
    if (blocks.length === 0) return;
    
    const allExpanded = Array.from(blocks).every(b => b.classList.contains('expanded'));
    btn.textContent = allExpanded ? '--' : '++';
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
        const date = e.event_date || e.timestamp?.split('T')[0] || '';
        const location = e.location || '';
        
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
                <span class="event-date">${escapeHtml(date)}</span>
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
        
        if (filters.tags.length > 0) {
            const hasTag = (p.tag_ids || []).some(id => filters.tags.includes(id));
            if (!hasTag) return false;
        }
        
        return true;
    });
    
    filteredPerfumes.sort((a, b) => {
        let valA, valB;
        
        switch (sortField) {
            case 'brand':
                valA = (brandsMap[a.brand_id] || '').toLowerCase();
                valB = (brandsMap[b.brand_id] || '').toLowerCase();
                break;
            case 'name':
                valA = (a.name || '').toLowerCase();
                valB = (b.name || '').toLowerCase();
                break;
            case 'concentration':
                valA = (concentrationsMap[a.concentration_id] || '').toLowerCase();
                valB = (concentrationsMap[b.concentration_id] || '').toLowerCase();
                break;
            case 'state':
                valA = getStatePriority(a);
                valB = getStatePriority(b);
                break;
            case 'rating':
                valA = getPerfumeScore(a, 'rating_votes') || 0;
                valB = getPerfumeScore(b, 'rating_votes') || 0;
                break;
            case 'longevity':
                valA = getPerfumeScore(a, 'longevity_votes') || 0;
                valB = getPerfumeScore(b, 'longevity_votes') || 0;
                break;
            case 'sillage':
                valA = getPerfumeScore(a, 'sillage_votes') || 0;
                valB = getPerfumeScore(b, 'sillage_votes') || 0;
                break;
            case 'created':
                valA = a.created_at || 0;
                valB = b.created_at || 0;
                break;
            default:
                valA = '';
                valB = '';
        }
        
        let result;
        if (typeof valA === 'number') {
            result = valA - valB;
        } else {
            result = valA.localeCompare(valB, 'zh-TW');
        }
        
        return sortAscending ? result : -result;
    });
    
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

function openSortModal() {
    const modal = document.getElementById('sort-modal');
    modal.classList.remove('hidden');
    
    // Set current values
    document.getElementById('sort-field').value = sortField;
    updateSortDirectionButtons();
}

function closeSortModal() {
    document.getElementById('sort-modal').classList.add('hidden');
}

function applySortFromModal() {
    sortField = document.getElementById('sort-field').value;
    closeSortModal();
    applyFiltersAndSort();
    updateSortButtonState();
}

function resetSort() {
    sortField = 'brand';
    sortAscending = true;
    document.getElementById('sort-field').value = 'brand';
    updateSortDirectionButtons();
    closeSortModal();
    applyFiltersAndSort();
    updateSortButtonState();
}

function setSortDirection(ascending) {
    sortAscending = ascending;
    updateSortDirectionButtons();
}

function updateSortDirectionButtons() {
    document.getElementById('sort-asc').classList.toggle('active', sortAscending);
    document.getElementById('sort-desc').classList.toggle('active', !sortAscending);
}

function closeAllModals() {
    document.getElementById('sort-modal').classList.add('hidden');
    document.getElementById('filter-modal').classList.add('hidden');
}

function updateSortButtonState() {
    const btn = document.getElementById('sort-btn');
    const isNonDefault = sortField !== 'brand' || !sortAscending;
    btn.classList.toggle('active', isNonDefault);
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
            const minVal = parseFloat(minInput.value);
            const maxValCurrent = parseFloat(maxInput.value);
            
            // Ensure min doesn't exceed max
            if (minVal > maxValCurrent) {
                minInput.value = maxValCurrent;
            }
            if (maxValCurrent < minVal) {
                maxInput.value = minVal;
            }
            
            const min = parseFloat(minInput.value);
            const max = parseFloat(maxInput.value);
            
            // Update display
            minDisplay.textContent = min.toFixed(1);
            maxDisplay.textContent = max.toFixed(1);
            
            // Update selected bar position
            const leftPercent = (min / maxVal) * 100;
            const rightPercent = (max / maxVal) * 100;
            selectedBar.style.left = leftPercent + '%';
            selectedBar.style.width = (rightPercent - leftPercent) + '%';
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
    });
    
    setSelectValues('filter-brand', filters.brands);
    setSelectValues('filter-concentration', filters.concentrations);
    setSelectValues('filter-location', filters.locations);
    setSelectValues('filter-tag', filters.tags);
}

function applyFilters() {
    // Get state checkboxes
    filters.states = Array.from(document.querySelectorAll('#filter-state input:checked'))
        .map(cb => cb.value);
    
    // Get score range values
    document.querySelectorAll('.score-filter-item').forEach(item => {
        const scoreType = item.dataset.score;
        filters[scoreType] = {
            min: parseFloat(item.querySelector('.range-min').value),
            max: parseFloat(item.querySelector('.range-max').value),
            exclude: item.querySelector('.score-exclude').checked
        };
    });
    
    filters.brands = getSelectValues('filter-brand');
    filters.concentrations = getSelectValues('filter-concentration');
    filters.locations = getSelectValues('filter-location');
    filters.tags = getSelectValues('filter-tag');
    
    closeAllModals();
    applyFiltersAndSort();
}

function clearFilters() {
    filters = {
        states: [],
        brands: [],
        concentrations: [],
        locations: [],
        tags: [],
        rating: { min: 0, max: 5, exclude: false },
        longevity: { min: 0, max: 5, exclude: false },
        sillage: { min: 0, max: 4, exclude: false },
        value: { min: 0, max: 5, exclude: false }
    };
    
    // Clear state checkboxes
    document.querySelectorAll('#filter-state input').forEach(cb => cb.checked = false);
    
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
    });
    
    // Clear select boxes
    ['filter-brand', 'filter-concentration', 'filter-location', 'filter-tag'].forEach(id => {
        const select = document.getElementById(id);
        Array.from(select.options).forEach(opt => opt.selected = false);
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
    
    const hasFilters = filters.states.length > 0 ||
                       filters.brands.length > 0 || 
                       filters.concentrations.length > 0 || 
                       filters.locations.length > 0 || 
                       filters.tags.length > 0 ||
                       hasScoreFilter;
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
