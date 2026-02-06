/**
 * Perfume Tracker - Web Version
 * Reads data from GitHub and displays perfume collection
 */

// ============================================
// Configuration
// ============================================

const CONFIG = {
    // Data file URL - use relative path for local, GitHub raw URL for deployment
    dataUrl: getDataUrl(),
};

function getDataUrl() {
    // If running on GitHub Pages, use raw GitHub URL
    if (window.location.hostname.includes('github.io')) {
        return 'https://raw.githubusercontent.com/boshow88/Perfume-Tracker/main/data/perfumes.json';
    }
    // Local development - relative path from web folder
    return '../data/perfumes.json';
}

// ============================================
// State
// ============================================

let appData = null;
let perfumes = [];
let filteredPerfumes = [];
let selectedPerfumeId = null;

// Maps for quick lookup
let brandsMap = {};
let concentrationsMap = {};
let outletsMap = {};
let tagsMap = {};
let noteTitlesMap = {};
let purchaseTypesMap = {};

// Filter state
let filters = {
    brands: [],
    concentrations: [],
    locations: [],
    tags: []
};

// Sort state
let sortField = 'brand';
let sortAscending = true;

// Fragrantica vote block categories
const VOTE_CATEGORIES = {
    'main_accords': '主調',
    'longevity': '持久度',
    'sillage': '擴散度',
    'gender': '性別',
    'price_value': '價值',
    'seasons': '季節',
    'time_of_day': '時段'
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
    // Search
    document.getElementById('search-input').addEventListener('input', debounce(handleSearch, 300));
    
    // Sort
    document.getElementById('sort-select').addEventListener('change', handleSortChange);
    document.getElementById('sort-dir-btn').addEventListener('click', handleSortDirToggle);
    
    // Filter
    document.getElementById('filter-btn').addEventListener('click', openFilterModal);
    document.getElementById('filter-apply').addEventListener('click', applyFilters);
    document.getElementById('filter-clear').addEventListener('click', clearFilters);
    document.querySelector('.modal-close').addEventListener('click', closeFilterModal);
    document.querySelector('.modal-backdrop').addEventListener('click', closeFilterModal);
    
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
        
        // Build maps
        brandsMap = appData.brands_map || {};
        concentrationsMap = appData.concentrations_map || {};
        outletsMap = appData.outlets_map || {};
        tagsMap = appData.tags_map || {};
        noteTitlesMap = appData.note_titles_map || {};
        purchaseTypesMap = appData.purchase_types_map || {};
        
        perfumes = appData.perfumes || [];
        
        // Initial render
        applyFiltersAndSort();
        populateFilterOptions();
        
    } catch (error) {
        console.error('Failed to load data:', error);
        document.getElementById('perfume-list').innerHTML = `
            <div class="no-results">
                <p>無法載入資料</p>
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
        container.innerHTML = '<div class="no-results">沒有符合條件的香水</div>';
        countEl.textContent = '0 支香水';
        return;
    }
    
    container.innerHTML = filteredPerfumes.map(p => {
        const brand = brandsMap[p.brand_id] || '未知品牌';
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
    
    countEl.textContent = `${filteredPerfumes.length} 支香水`;
    
    // Add click handlers
    container.querySelectorAll('.perfume-item').forEach(el => {
        el.addEventListener('click', () => selectPerfume(el.dataset.id));
    });
}

function selectPerfume(id) {
    selectedPerfumeId = id;
    
    // Update selection in list
    document.querySelectorAll('.perfume-item').forEach(el => {
        el.classList.toggle('selected', el.dataset.id === id);
    });
    
    // Find perfume
    const perfume = perfumes.find(p => p.id === id);
    if (!perfume) return;
    
    renderDetailPanel(perfume);
}

function renderDetailPanel(p) {
    const panel = document.getElementById('detail-panel');
    panel.classList.remove('hidden');
    
    // Header
    const brand = brandsMap[p.brand_id] || '未知品牌';
    const conc = concentrationsMap[p.concentration_id] || '';
    document.getElementById('detail-brand').textContent = brand;
    document.getElementById('detail-name-conc').textContent = conc ? `${p.name} · ${conc}` : p.name;
    
    // State
    const state = getOwnershipState(p);
    document.getElementById('detail-state').textContent = state;
    
    // Notes
    renderNotes(p);
    
    // Fragrantica
    renderFragrantica(p);
    
    // Events
    renderEvents(p);
    
    // Links
    renderLinks(p);
    
    // Tags
    renderTags(p);
}

function getOwnershipState(p) {
    const events = p.events || [];
    if (events.length === 0) return 'Wishlist';
    
    // Calculate ownership
    let owned = 0;
    for (const e of events) {
        const type = e.purchase_type || e.type;
        if (type === 'sold' || type === 'gave_away') {
            owned--;
        } else {
            owned++;
        }
    }
    
    if (owned > 0) return 'Owned';
    if (owned < 0) return 'Previously Owned';
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
        const title = noteTitlesMap[note.title_id] || note.title_id || '筆記';
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
    
    // Check if there's any data
    const hasData = Object.keys(fragrantica).length > 0 || Object.keys(myVotes).length > 0;
    if (!hasData) {
        section.classList.add('hidden');
        return;
    }
    
    section.classList.remove('hidden');
    
    // Render vote blocks
    const blocks = [];
    for (const [key, label] of Object.entries(VOTE_CATEGORIES)) {
        const fData = fragrantica[key] || {};
        const mData = myVotes[key] || {};
        
        if (Object.keys(fData).length === 0 && Object.keys(mData).length === 0) continue;
        
        // Merge keys
        const allKeys = [...new Set([...Object.keys(fData), ...Object.keys(mData)])];
        if (allKeys.length === 0) continue;
        
        const items = allKeys.map(k => {
            const fVal = fData[k];
            const mVal = mData[k];
            return `
                <div class="vote-item">
                    <span class="vote-label">${escapeHtml(k)}</span>
                    <span class="vote-values">
                        ${fVal !== undefined ? `<span class="vote-fragrantica">${fVal}%</span>` : ''}
                        ${mVal !== undefined ? `<span class="vote-mine">★</span>` : ''}
                    </span>
                </div>
            `;
        }).join('');
        
        blocks.push(`
            <div class="vote-block" data-category="${key}">
                <div class="vote-block-header">
                    <span class="vote-block-title">${label}</span>
                    <span class="vote-block-toggle">＋</span>
                </div>
                <div class="vote-block-content">${items}</div>
            </div>
        `);
    }
    
    content.innerHTML = blocks.join('');
    
    // Add toggle handlers
    content.querySelectorAll('.vote-block-header').forEach(header => {
        header.addEventListener('click', () => {
            const block = header.closest('.vote-block');
            block.classList.toggle('expanded');
            header.querySelector('.vote-block-toggle').textContent = 
                block.classList.contains('expanded') ? '－' : '＋';
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
            block.querySelector('.vote-block-toggle').textContent = '＋';
        } else {
            block.classList.add('expanded');
            block.querySelector('.vote-block-toggle').textContent = '－';
        }
    });
    
    updateToggleAllButton();
}

function updateToggleAllButton() {
    const btn = document.getElementById('toggle-all-votes');
    const blocks = document.querySelectorAll('.vote-block');
    if (blocks.length === 0) return;
    
    const allExpanded = Array.from(blocks).every(b => b.classList.contains('expanded'));
    btn.textContent = allExpanded ? '－－' : '＋＋';
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
        const type = purchaseTypesMap[e.purchase_type] || e.purchase_type || e.type || '購買';
        const date = e.date || '';
        const details = [];
        if (e.size) details.push(e.size);
        if (e.price) details.push(`$${e.price}`);
        if (e.source) details.push(e.source);
        
        return `
            <div class="event-item">
                <div class="event-info">
                    <span class="event-type">${escapeHtml(type)}</span>
                    ${details.length > 0 ? `<span class="event-details">${escapeHtml(details.join(' · '))}</span>` : ''}
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
    
    // Filter
    filteredPerfumes = perfumes.filter(p => {
        // Search filter
        if (searchTerm) {
            const brand = (brandsMap[p.brand_id] || '').toLowerCase();
            const name = (p.name || '').toLowerCase();
            if (!brand.includes(searchTerm) && !name.includes(searchTerm)) {
                return false;
            }
        }
        
        // Brand filter
        if (filters.brands.length > 0 && !filters.brands.includes(p.brand_id)) {
            return false;
        }
        
        // Concentration filter
        if (filters.concentrations.length > 0 && !filters.concentrations.includes(p.concentration_id)) {
            return false;
        }
        
        // Location filter
        if (filters.locations.length > 0) {
            const hasLocation = (p.outlet_ids || []).some(id => filters.locations.includes(id));
            if (!hasLocation) return false;
        }
        
        // Tag filter
        if (filters.tags.length > 0) {
            const hasTag = (p.tag_ids || []).some(id => filters.tags.includes(id));
            if (!hasTag) return false;
        }
        
        return true;
    });
    
    // Sort
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
    // Brands
    const brandSelect = document.getElementById('filter-brand');
    brandSelect.innerHTML = Object.entries(brandsMap)
        .sort((a, b) => a[1].localeCompare(b[1], 'zh-TW'))
        .map(([id, name]) => `<option value="${id}">${escapeHtml(name)}</option>`)
        .join('');
    
    // Concentrations
    const concSelect = document.getElementById('filter-concentration');
    concSelect.innerHTML = Object.entries(concentrationsMap)
        .map(([id, name]) => `<option value="${id}">${escapeHtml(name)}</option>`)
        .join('');
    
    // Locations (outletsMap values are {name, region} objects)
    const locSelect = document.getElementById('filter-location');
    locSelect.innerHTML = Object.entries(outletsMap)
        .sort((a, b) => (a[1].name || '').localeCompare(b[1].name || '', 'zh-TW'))
        .map(([id, info]) => `<option value="${id}">${escapeHtml(info.name || '')}</option>`)
        .join('');
    
    // Tags
    const tagSelect = document.getElementById('filter-tag');
    tagSelect.innerHTML = Object.entries(tagsMap)
        .sort((a, b) => a[1].localeCompare(b[1], 'zh-TW'))
        .map(([id, name]) => `<option value="${id}">${escapeHtml(name)}</option>`)
        .join('');
}

function openFilterModal() {
    const modal = document.getElementById('filter-modal');
    modal.classList.remove('hidden');
    
    // Set current selections
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
    
    // Clear selections in modal
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
