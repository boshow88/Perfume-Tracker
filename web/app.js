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
    brands: [],
    concentrations: [],
    locations: [],
    tags: []
};

let sortField = 'brand';
let sortAscending = true;

// Fragrantica vote categories - matches JSON structure
const VOTE_CATEGORIES = {
    'rating_votes': { label: 'Rating', myKey: 'my_rating_votes' },
    'longevity_votes': { label: 'Longevity', myKey: 'my_longevity_votes' },
    'sillage_votes': { label: 'Sillage', myKey: 'my_sillage_votes' },
    'gender_votes': { label: 'Gender', myKey: 'my_gender_votes' },
    'value_votes': { label: 'Value', myKey: 'my_value_votes' },
    'season_time_votes': { label: 'Season / Time', myKey: 'my_season_time_votes' }
};

// ============================================
// Initialization
// ============================================

document.addEventListener('DOMContentLoaded', init);

async function init() {
    setupEventListeners();
    await loadData();
}

function setupEventListeners() {
    document.getElementById('search-input').addEventListener('input', debounce(handleSearch, 300));
    document.getElementById('sort-select').addEventListener('change', handleSortChange);
    document.getElementById('sort-dir-btn').addEventListener('click', handleSortDirToggle);
    document.getElementById('filter-btn').addEventListener('click', openFilterModal);
    document.getElementById('filter-apply').addEventListener('click', applyFilters);
    document.getElementById('filter-clear').addEventListener('click', clearFilters);
    document.querySelector('.modal-close').addEventListener('click', closeFilterModal);
    document.querySelector('.modal-backdrop').addEventListener('click', closeFilterModal);
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
    if (events.length === 0) return 'Wishlist';
    
    let ownedMl = 0;
    let hasSmelled = false;
    
    for (const e of events) {
        if (e.event_type === 'smell' || e.event_type === 'skin') {
            hasSmelled = true;
        }
        if (e.ml_delta !== null && e.ml_delta !== undefined) {
            ownedMl += e.ml_delta;
        }
    }
    
    if (ownedMl > 0) return 'Owned';
    if (hasSmelled) return 'Smelled';
    return 'Wishlist';
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
    
    const blocks = [];
    for (const [fKey, config] of Object.entries(VOTE_CATEGORIES)) {
        const fData = fragrantica[fKey] || {};
        const mData = myVotes[config.myKey] || {};
        
        if (Object.keys(fData).length === 0 && Object.keys(mData).length === 0) continue;
        
        const allKeys = [...new Set([...Object.keys(fData), ...Object.keys(mData)])];
        if (allKeys.length === 0) continue;
        
        const total = Object.values(fData).reduce((sum, v) => sum + (v || 0), 0);
        
        const items = allKeys.map(k => {
            const fVal = fData[k];
            const mVal = mData[k];
            const pct = total > 0 && fVal ? ((fVal / total) * 100).toFixed(1) : null;
            const hasMyVote = mVal !== undefined && mVal > 0;
            
            return `
                <div class="vote-item ${hasMyVote ? 'voted' : ''}">
                    <span class="vote-label">${escapeHtml(k)}</span>
                    <span class="vote-values">
                        ${fVal !== undefined ? `<span class="vote-count">${fVal}</span>` : ''}
                        ${pct !== null ? `<span class="vote-pct">(${pct}%)</span>` : ''}
                        ${hasMyVote ? `<span class="vote-mine">★</span>` : ''}
                    </span>
                </div>
            `;
        }).join('');
        
        blocks.push(`
            <div class="vote-block" data-category="${fKey}">
                <div class="vote-block-header">
                    <span class="vote-block-title">${config.label}</span>
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
    
    section.classList.remove('hidden');
    content.innerHTML = events.map(e => {
        const eventType = e.event_type || 'event';
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
}

function handleSearch() {
    applyFiltersAndSort();
}

function handleSortChange(e) {
    sortField = e.target.value;
    applyFiltersAndSort();
}

function handleSortDirToggle() {
    sortAscending = !sortAscending;
    document.getElementById('sort-dir-btn').textContent = sortAscending ? '▲' : '▼';
    applyFiltersAndSort();
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

function openFilterModal() {
    const modal = document.getElementById('filter-modal');
    modal.classList.remove('hidden');
    
    setSelectValues('filter-brand', filters.brands);
    setSelectValues('filter-concentration', filters.concentrations);
    setSelectValues('filter-location', filters.locations);
    setSelectValues('filter-tag', filters.tags);
}

function closeFilterModal() {
    document.getElementById('filter-modal').classList.add('hidden');
}

function applyFilters() {
    filters.brands = getSelectValues('filter-brand');
    filters.concentrations = getSelectValues('filter-concentration');
    filters.locations = getSelectValues('filter-location');
    filters.tags = getSelectValues('filter-tag');
    
    closeFilterModal();
    applyFiltersAndSort();
}

function clearFilters() {
    filters = { brands: [], concentrations: [], locations: [], tags: [] };
    
    ['filter-brand', 'filter-concentration', 'filter-location', 'filter-tag'].forEach(id => {
        const select = document.getElementById(id);
        Array.from(select.options).forEach(opt => opt.selected = false);
    });
    
    closeFilterModal();
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
    const hasFilters = filters.brands.length > 0 || 
                       filters.concentrations.length > 0 || 
                       filters.locations.length > 0 || 
                       filters.tags.length > 0;
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
