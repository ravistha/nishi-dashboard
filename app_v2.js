console.log("Script block started executing...");

// --- SUPABASE CONFIGURATION ---
const SUPABASE_URL = 'https://kcszjiqtbqjvixtwxuqr.supabase.co';
const SUPABASE_KEY = 'sb_publishable_MsEerYlBvya2zB53sDSadA_x9p8Jlcr';
const SUPABASE_TABLE_NAME = 'nishi_data';

// Initialize Supabase safely
let supabaseClient;

// State
let appState = {
    data: [],
    selectedCommunity: null,
    scoreType: 'Base',
    weights: {},
    domainWeights: {},
    metaDomains: {},
    metaDomains: {},
    excludedIndicators: {}, // New: Track excluded indicators per domain
    viewMode: 'score' // 'score' or 'rank'
};

// Colors (UPDATED BRAND)
const CHART_COLORS = {
    primary: 'rgba(12, 140, 190, 1)',        // #0C8CBE (Brand Blue) - Solid
    primaryLight: 'rgba(12, 140, 190, 0.3)', // Lighter shade for unselected
    primaryBorder: 'rgba(12, 140, 190, 1)',  // Solid Brand Blue
    secondary: 'rgba(148, 163, 184, 0.4)',
    secondaryBorder: 'rgba(148, 163, 184, 1)',
    targetLine: 'rgba(255, 80, 80, 0.9)'     // Reddish for averages
};

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

async function initApp() {
    // Check if Supabase SDK is available
    if (!window.supabase) {
        alert("Critical Error: Supabase SDK failed to load.\n\nPossible causes:\n1. No internet connection\n2. Ad-blocker blocking scripts\n3. Firewall blocking cdn.jsdelivr.net");
        return;
    }
    // Initialize here to be safe
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

    await fetchDataFromSupabase();
    initUI();
    initCharts();
    updateDashboard();
}

async function fetchDataFromSupabase() {
    const statusEl = document.getElementById('connection-status');
    statusEl.textContent = "Connecting...";
    console.log(`Attempting to fetch from table: "${SUPABASE_TABLE_NAME}"`);

    try {
        // Timeout logic
        const timeout = new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Request timed out (10s)")), 10000)
        );

        const { data, error } = await Promise.race([
            supabaseClient.from(SUPABASE_TABLE_NAME).select('*'),
            timeout
        ]);

        if (error) {
            console.error("Supabase API Error:", error);
            throw error;
        }

        if (!data || data.length === 0) {
            statusEl.textContent = "Connected: Table Empty";
            statusEl.className = "text-xs font-semibold text-orange-500";
            alert(`Connected to Supabase, but table '${SUPABASE_TABLE_NAME}' is empty.`);
            return;
        }

        statusEl.textContent = "Live Data Connected";
        statusEl.className = "text-xs font-semibold text-green-600";
        console.log(`Loaded ${data.length} rows.`);

        // Robust Column Detection
        const firstRow = data[0];
        const keys = Object.keys(firstRow);
        const findKey = (query) => keys.find(k => k.toLowerCase().includes(query.toLowerCase()));

        const communityKey = findKey('community') || findKey('geo') || findKey('region');
        const domainKey = findKey('domain');
        const indKey = findKey('indicator') || findKey('variable');
        const baseKey = findKey('base') || findKey('score');
        const adjKey = findKey('adjust') || findKey('model');

        // Rank Column Detection
        const baseRankKey = findKey('base_rank') || findKey('rank') || findKey('rank_base');
        const adjRankKey = findKey('adjusted_rank') || findKey('rank_adj');


        if (!communityKey || !domainKey || !indKey) {
            alert(`Connected, but columns are missing.\n\nFound: ${keys.join(', ')}`);
            return;
        }

        // Transform Data
        const pivotMap = {};
        const newDomains = {};

        data.forEach(row => {
            const comm = row[communityKey];
            const domain = row[domainKey];
            const ind = row[indKey];
            const base = baseKey ? parseFloat(row[baseKey]) : 0;
            const adj = adjKey ? parseFloat(row[adjKey]) : base;
            // Capture Ranks
            const baseRank = baseRankKey ? parseFloat(row[baseRankKey]) : null;
            const adjRank = adjRankKey ? parseFloat(row[adjRankKey]) : null;

            if (!comm || !domain) return;

            if (!pivotMap[comm]) pivotMap[comm] = { Community: comm };

            pivotMap[comm][`${domain}_${ind}_Base`] = base;
            pivotMap[comm][`${domain}_${ind}_Adjusted`] = adj;
            // Store Ranks (for future use)
            pivotMap[comm][`${domain}_${ind}_Base_Rank`] = baseRank;
            pivotMap[comm][`${domain}_${ind}_Adjusted_Rank`] = adjRank;

            if (!newDomains[domain]) newDomains[domain] = new Set();
            newDomains[domain].add(ind);
        });

        appState.data = Object.values(pivotMap);

        // SORTING: Alphabetical, with "Other Rural Areas" always last
        appState.data.sort((a, b) => {
            const nameA = a.Community || "";
            const nameB = b.Community || "";
            // "Other Rural Areas" check
            if (nameA === 'Other Rural Areas') return 1;
            if (nameB === 'Other Rural Areas') return -1;
            // Standard A-Z
            return nameA.localeCompare(nameB);
        });
        appState.metaDomains = {};
        Object.keys(newDomains).forEach(d => {
            appState.metaDomains[d] = Array.from(newDomains[d]);
        });

        console.log("Transformed Data:", appState.data);
        console.log("Meta Domains:", appState.metaDomains);

        if (appState.data.length === 0) {
            alert("Data Error: Rows loaded but transformation resulted in 0 communities. Check column mapping logs.");
        }

        appState.selectedCommunity = appState.data[0]?.Community || '';
        initWeights(); // Initialize with new default logic

    } catch (err) {
        console.error("Supabase Error:", err);
        statusEl.textContent = "Connection Failed";
        statusEl.className = "text-xs font-semibold text-red-600";
        let msg = err.message;
        if (msg.includes("timed out")) msg = "Connection timed out. Check internet.";
        alert(`Failed to connect.\n\nError: ${msg}`);
    }
}

function initWeights() {
    const domains = appState.metaDomains;
    appState.domainWeights = {};
    appState.weights = {};
    appState.excludedIndicators = {};

    if (!domains) return;

    // 1. Set Default Domain Weights
    const orderedDomains = Object.keys(domains);

    // Default Policy: Housing 40%, Economic 30%, Others 10%
    const defaults = {
        'housing': 40,
        'economic': 30
    };

    let remainingWeight = 100;
    let assignedCount = 0;

    orderedDomains.forEach(d => {
        const lower = d.toLowerCase();
        if (defaults[lower] !== undefined) {
            appState.domainWeights[d] = defaults[lower] / 100;
            remainingWeight -= defaults[lower];
            assignedCount++;
        }
    });

    // Distribute remaining weight equally among non-default domains
    const unassignedCount = orderedDomains.length - assignedCount;
    if (unassignedCount > 0) {
        const equalShare = remainingWeight / unassignedCount;
        orderedDomains.forEach(d => {
            if (appState.domainWeights[d] === undefined) {
                appState.domainWeights[d] = equalShare / 100;
            }
        });
    }

    // 2. Set Default Indicator Weights (Equal Distribution)
    Object.keys(domains).forEach(domain => {
        appState.weights[domain] = {};
        appState.excludedIndicators[domain] = new Set(); // Start with none excluded

        const indicators = domains[domain];
        const count = indicators.length;
        const weight = count > 0 ? (1.0 / count) : 0;

        indicators.forEach(ind => {
            appState.weights[domain][ind] = weight;
        });
    });
}

function initUI() {
    const select = document.getElementById('community-select');
    select.innerHTML = '';
    if (appState.data.length === 0) {
        const opt = document.createElement('option');
        opt.textContent = "No Data Loaded";
        select.appendChild(opt);
    }
    appState.data.forEach(c => {
        const option = document.createElement('option');
        option.value = c.Community;
        option.textContent = c.Community;
        select.appendChild(option);
    });
    select.addEventListener('change', (e) => {
        appState.selectedCommunity = e.target.value;
        updateDashboard();
    });

    document.getElementById('btn-base').addEventListener('click', () => setScoreType('Base'));
    document.getElementById('btn-adjusted').addEventListener('click', () => setScoreType('Adjusted'));
    document.getElementById('reset-weights').addEventListener('click', resetWeights);
    document.getElementById('btn-toggle-view').addEventListener('click', toggleViewMode);

    // Info Icon Listeners
    document.getElementById('info-base').addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent button toggle
        showInfo('base');
    });
    document.getElementById('info-adjusted').addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent button toggle
        showInfo('adjusted');
    });

    if (appState.metaDomains && Object.keys(appState.metaDomains).length > 0) {
        generateWeightControls();
    }
}

// --- Info Modal Logic ---
function showInfo(type) {
    const modal = document.getElementById('info-modal');
    const content = document.getElementById('modal-content');
    const title = document.getElementById('modal-title');

    modal.classList.remove('hidden');

    if (type === 'base') {
        title.textContent = "Base Scores";
        content.textContent = "For each indicator, these scores represent the raw mean values without any control variables.";
    } else {
        title.textContent = "Adjusted Model";
        content.textContent = "For each indicator, these scores were calculated through Univariate Analysis, using control variables such as Gender, Age, Marital status, Employed status (except for Economic domain), Education level, and Total personal income (except for Economic domain).";
    }
}

window.closeModal = function () { // Attach to window for onclick in HTML
    document.getElementById('info-modal').classList.add('hidden');
};

function setScoreType(type) {
    appState.scoreType = type;
    const btnBase = document.getElementById('btn-base');
    const btnAdj = document.getElementById('btn-adjusted');

    if (type === 'Base') {
        btnBase.classList.replace('text-gray-500', 'text-teal-700');
        btnBase.classList.replace('bg-white', 'bg-white');
        btnBase.classList.add('shadow-sm');
        btnAdj.classList.replace('text-teal-700', 'text-gray-500');
        btnAdj.classList.remove('shadow-sm', 'bg-white');
    } else {
        btnAdj.classList.replace('text-gray-500', 'text-teal-700');
        btnAdj.classList.add('shadow-sm', 'bg-white');
        btnBase.classList.replace('text-teal-700', 'text-gray-500');
        btnBase.classList.remove('shadow-sm', 'bg-white');
    }
    updateDashboard();
}

function toggleViewMode() {
    appState.viewMode = appState.viewMode === 'score' ? 'rank' : 'score';
    const btn = document.getElementById('btn-toggle-view');

    if (appState.viewMode === 'rank') {
        btn.textContent = "See Scores instead of Ranks";
    } else {
        btn.textContent = "See Ranks instead of Scores";
    }

    // Update Regional Chart Header
    const regHeader = document.getElementById('regional-chart-header');
    if (regHeader) {
        regHeader.textContent = appState.viewMode === 'rank'
            ? "Regional Comparison of Overall Rank"
            : "Regional Comparison of Overall Index Score";
    }

    updateDashboard();
}

function generateWeightControls() {
    const container = document.getElementById('weight-controls-container');
    container.innerHTML = '';


    // --- 1. Domain Weights Section ---
    const domainSection = document.createElement('div');
    domainSection.className = 'border-b border-gray-100 pb-4';

    const domainTotal = Object.values(appState.domainWeights).reduce((a, b) => a + b, 0) * 100;
    const isDomainValid = Math.abs(domainTotal - 100) < 0.1;
    const domainColor = isDomainValid ? 'text-green-600' : 'text-red-500';

    domainSection.innerHTML = `
        <div class="flex justify-between items-center mb-3">
            <h4 class="text-sm font-bold text-gray-900">Domain Importance</h4>
            <span class="text-xs font-bold ${domainColor}">Total: ${Math.round(domainTotal)}%</span>
        </div>
    `;

    const currentDomains = appState.metaDomains || {};
    Object.keys(currentDomains).forEach(domain => {
        const wrapper = document.createElement('div');
        wrapper.className = 'mb-3';
        const currentWeight = (appState.domainWeights[domain] * 100).toFixed(0);

        wrapper.innerHTML = `
            <div class="flex justify-between text-xs mb-1">
                <span class="font-medium text-gray-700">${domain}</span>
                <span class="text-gray-500" id="val-domain-${domain}">${currentWeight}%</span>
            </div>
            <input type="range" min="0" max="100" step="5" value="${currentWeight}" 
                class="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                data-domain="${domain}">`;

        const input = wrapper.querySelector('input');
        input.addEventListener('input', (e) => {
            const val = parseInt(e.target.value);
            appState.domainWeights[domain] = val / 100;
            wrapper.querySelector(`#val-domain-${domain}`).textContent = `${val}%`;
            generateWeightControls();
            updateDashboard();
        });
        domainSection.appendChild(wrapper);
    });
    container.appendChild(domainSection);

    // --- 2. Indicator Weights Section (Equal Weighting) ---
    Object.entries(currentDomains).forEach(([domain, indicators]) => {
        const indSection = document.createElement('div');
        indSection.className = 'mt-4 pt-2';

        indSection.innerHTML = `
            <div class="flex justify-between items-center mb-3">
                <h4 class="text-xs font-bold text-gray-500 uppercase tracking-wider">${domain}</h4>
            </div>
        `;

        indicators.forEach(ind => {
            const wrapper = document.createElement('div');
            wrapper.className = 'mb-2 pl-2 border-l-2 border-gray-100';
            const safeId = ind.replace(/[^a-zA-Z0-9]/g, '-');
            const isExcluded = appState.excludedIndicators[domain].has(ind);

            // Display calculated weight
            // const currentWeight = (appState.weights[domain][ind] * 100).toFixed(1);
            const opacityClass = isExcluded ? 'opacity-40' : '';

            wrapper.innerHTML = `
                <div class="flex justify-between text-xs items-center p-1 rounded hover:bg-gray-50">
                    <div class="flex items-center gap-2 overflow-hidden">
                        <input type="checkbox" class="rounded text-brand focus:ring-[#0C8CBE] cursor-pointer" 
                            ${!isExcluded ? 'checked' : ''}>
                        <span class="text-gray-600 truncate ${opacityClass}" title="${ind}">${ind}</span>
                    </div>
                </div>`;

            // Handler: Checkbox (Include/Exclude + Rebalance)
            const checkbox = wrapper.querySelector('input[type=checkbox]');
            checkbox.addEventListener('change', (e) => {
                if (e.target.checked) {
                    appState.excludedIndicators[domain].delete(ind);
                } else {
                    appState.excludedIndicators[domain].add(ind);
                }

                // REBALANCE LOGIC
                const activeParams = indicators.filter(i => !appState.excludedIndicators[domain].has(i));
                const count = activeParams.length;
                const newWeight = count > 0 ? (1.0 / count) : 0;

                indicators.forEach(i => {
                    if (appState.excludedIndicators[domain].has(i)) {
                        appState.weights[domain][i] = 0;
                    } else {
                        appState.weights[domain][i] = newWeight;
                    }
                });

                generateWeightControls();
                updateDashboard();
            });

            indSection.appendChild(wrapper);
        });
        container.appendChild(indSection);
    });
}

function resetWeights() {
    initWeights(); // Re-run init to restore defaults (40/30/10)
    generateWeightControls(); // Re-build UI
    updateDashboard();
}

function calculateDomainScore(communityData, domain) {
    // 1. Calculate Raw Score for the target community
    const rawScore = _calculateRawDomainScore(communityData, domain);

    if (appState.viewMode === 'score') {
        return rawScore;
    } else {
        // RANK MODE: Rank this score against ALL communities
        // 1. Calculate score for everyone
        const allScores = appState.data.map(d => _calculateRawDomainScore(d, domain));

        // 2. Sort Descending (Higher Score is Better Rank 1)
        // Note: If scores are identical, this method is stable enough for now.
        // We want strict rank.
        allScores.sort((a, b) => b - a);

        // 3. Find index (1-based)
        // indexOf finds the first occurrence.
        const rank = allScores.indexOf(rawScore) + 1;

        return rank;
    }
}

// Helper: Pure calculation of weighted score (ignore ViewMode)
function _calculateRawDomainScore(communityData, domain) {
    if (!communityData) return 0;
    const currentDomains = appState.metaDomains || {};
    const indicators = currentDomains[domain];
    if (!indicators) return 0;

    let totalWeightedScore = 0;

    indicators.forEach(ind => {
        // Skip if excluded
        if (appState.excludedIndicators[domain].has(ind)) return;

        const domainWeights = appState.weights[domain];
        const weight = domainWeights ? (domainWeights[ind] || 0) : 0;

        // ALWAYS use Score Key (Base or Adjusted), never _Rank key
        const key = `${domain}_${ind}_${appState.scoreType}`; // e.g., Housing_Crowded_Base
        const rawScore = communityData[key] || 0;

        totalWeightedScore += rawScore * weight;
    });

    return totalWeightedScore;
}

function calculateOverallScore(communityData) {
    let totalWeightedScore = 0;

    const currentDomains = appState.metaDomains || {};
    Object.keys(currentDomains).forEach(domain => {
        const domainWeight = appState.domainWeights[domain] || 0;
        // FIX: Always use RAW score (0-100), never the boolean/rank value
        const domainScore = _calculateRawDomainScore(communityData, domain);
        totalWeightedScore += domainScore * domainWeight;
    });

    // DEBUG LOG ONCE
    if (communityData.Community === appState.selectedCommunity) {
        console.log(`[DiffLog] Overall Score for ${communityData.Community}:`, totalWeightedScore);
    }

    return totalWeightedScore;
}

let radarChartInstance = null;
let comparisonChartInstance = null;
// miniChartInstance removed

function initCharts() {
    console.log("initCharts: Starting...");

    if (!window.Chart) {
        console.error("initCharts: Chart.js global not found!");
        alert("Error: Chart.js library not loaded. Check internet connection.");
        return;
    }

    // Check Plugin
    if (window.ChartDataLabels) {
        console.log("initCharts: Registering ChartDataLabels plugin.");
        Chart.register(ChartDataLabels);
    } else {
        console.warn("initCharts: ChartDataLabels plugin not found. Labels will be missing.");
    }

    // Common Options for Datalabels
    const labelOptions = {
        color: '#333',
        anchor: 'end',
        align: 'top',
        offset: -2,
        font: { size: 10, weight: 'bold' },
        formatter: (value) => Math.round(value) || ''
    };

    // 2. Main Performance Chart (PROMINENT DOMAINS + TARGET LINE)
    const ctxRadar = document.getElementById('main-radar-chart').getContext('2d');
    radarChartInstance = new Chart(ctxRadar, {
        type: 'bar', // Base type
        data: { labels: [], datasets: [] },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            let label = context.dataset.label || '';
                            if (label) {
                                label += ': ';
                            }
                            if (context.parsed.y !== null) {
                                // For Floating Bars, parsed.y is a bit different, but raw might be array
                                let val = context.raw;
                                if (Array.isArray(val)) {
                                    // Average logic (floating bar)
                                    val = (val[0] + val[1]) / 2; // Approximate back to mean
                                    return `Territorial Average: ${Math.round(val)}`;
                                }
                                return label + Math.round(context.parsed.y);
                            }
                            return label;
                        }
                    }
                },
                datalabels: {
                    ...labelOptions,
                    formatter: (value, context) => {
                        // Don't show labels for the target line (average)
                        if (context.datasetIndex === 1) return '';
                        return Math.round(value);
                    }
                },
                legend: {
                    display: true,
                    position: 'top'
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    max: 100,
                    grid: { color: 'rgba(0,0,0,0.05)' },
                    ticks: {
                        font: { size: 12, weight: 'bold' }, // Prominent Y
                        color: '#64748b'
                    }
                },
                x: {
                    grid: { display: false },
                    ticks: {
                        font: { size: 14, weight: 'bold' }, // Prominent Domain Names
                        color: '#1e293b'
                    }
                }
            }
        }
    });

    // 3. Comparison Chart
    const ctxComp = document.getElementById('comparison-bar-chart').getContext('2d');
    comparisonChartInstance = new Chart(ctxComp, {
        type: 'bar',
        data: { labels: [], datasets: [] },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                // Increase font size and weight for these specific labels
                datalabels: {
                    ...labelOptions,
                    color: '#fff',
                    anchor: 'center',
                    align: 'center',
                    rotation: -90,
                    font: { size: 12, weight: 'bold' } // More Prominent
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    max: 100,
                    ticks: {
                        font: { size: 12, weight: 'bold' } // Prominent Values
                    }
                },
                x: {
                    ticks: {
                        font: { size: 11, weight: 'bold' }, // Prominent Names
                        autoSkip: false, // Ensure all names show if possible
                        maxRotation: 90,
                        minRotation: 45
                    }
                }
            }
        }
    });
}

function toggleDetailsTable() {
    const container = document.getElementById('details-table-container');
    const toggleText = document.getElementById('details-toggle-text');
    const toggleIcon = document.getElementById('details-toggle-icon');

    // Refresh Table if open
    if (!document.getElementById('details-table-container').classList.contains('hidden')) {
        renderDetailsTable();
    }

    if (container.classList.contains('hidden')) {
        container.classList.remove('hidden');
        toggleText.textContent = "Hide Data";
        toggleIcon.classList.replace('ph-caret-down', 'ph-caret-up');
        renderDetailsTable();
    } else {
        container.classList.add('hidden');
        toggleText.textContent = "Show Data";
        toggleIcon.classList.replace('ph-caret-up', 'ph-caret-down');
    }
}

function renderDetailsTable() {
    const tbody = document.getElementById('details-table-body');
    tbody.innerHTML = '';

    const selectedData = appState.data.find(d => d.Community === appState.selectedCommunity);
    if (!selectedData) return;

    const domainColors = {
        'housing': 'bg-orange-50 text-orange-700',
        'economic': 'bg-blue-50 text-blue-700',
        'default': 'bg-gray-50 text-gray-700'
    };

    Object.entries(appState.metaDomains).forEach(([domain, indicators]) => {
        const colorClass = domainColors[domain.toLowerCase()] || domainColors['default'];

        // Domain Header Row
        const dRow = document.createElement('tr');
        dRow.className = `${colorClass} font-bold`;
        dRow.innerHTML = `<td colspan="5" class="px-4 py-2">${domain}</td>`; // Colspan 5
        tbody.appendChild(dRow);

        indicators.forEach(ind => {
            // Check if excluded in CURRENT domain scope
            const isExcluded = appState.excludedIndicators[domain] && appState.excludedIndicators[domain].has(ind);

            const key = `${domain}_${ind}_${appState.scoreType}`;
            const val = selectedData[key];

            // RANK KEY: e.g. Housing_Crowded_Base_Rank
            // Note: DB columns are typically "Housing_Crowded_Base_Rank"
            const rankKey = `${key}_Rank`;
            const rankVal = selectedData[rankKey] !== undefined ? selectedData[rankKey] : '-';

            const weight = appState.weights[domain][ind] || 0;

            const row = document.createElement('tr');
            row.className = `border-b ${isExcluded ? 'opacity-40 bg-gray-100' : 'bg-white'}`;

            row.innerHTML = `
                <td class="px-4 py-2 text-xs text-gray-500"></td>
                <td class="px-4 py-2 font-medium text-gray-900">${ind} ${isExcluded ? '(Excluded)' : ''}</td>
                <td class="px-4 py-2 text-right font-mono">${(val || 0).toFixed(1)}</td>
                <td class="px-4 py-2 text-right font-mono text-gray-700">${rankVal}</td>
                <td class="px-4 py-2 text-right text-xs text-gray-400">${(weight * 100).toFixed(0)}%</td>
            `;
            tbody.appendChild(row);
        });
    });
}

function updateDashboard() {
    console.log("updateDashboard called. Selected:", appState.selectedCommunity);
    const selectedData = appState.data.find(d => d.Community === appState.selectedCommunity);

    if (!selectedData) {
        console.warn("No data found for selected community:", appState.selectedCommunity);
        return;
    }

    // Update Community Name Display
    const nameDisplay = document.getElementById('community-name-display');
    if (nameDisplay) nameDisplay.textContent = appState.selectedCommunity;

    const domainScores = {};
    const currentDomains = appState.metaDomains || {};
    Object.keys(currentDomains).forEach(d => {
        domainScores[d] = calculateDomainScore(selectedData, d);
    });

    // Calculate Overall Score (or Weighted Rank Value)
    const overallValue = calculateOverallScore(selectedData);

    const scoreDisplay = document.getElementById('overall-score-display');
    const typeDisplay = document.getElementById('model-type-display');

    if (appState.viewMode === 'rank') {
        // RANK MODE: Display Ordinal Rank (1st, 2nd, etc.)
        // We must calculate ranks for ALL communities to know where this one stands.
        const allValues = appState.data.map(d => ({
            id: d.Community,
            val: calculateOverallScore(d)
        }));

        // Sort: Higher weighted score is better (1 is best)
        allValues.sort((a, b) => b.val - a.val);

        const rank = allValues.findIndex(x => x.id === appState.selectedCommunity) + 1;
        scoreDisplay.textContent = rank;

        // Update Label
        if (typeDisplay) typeDisplay.textContent = `${appState.scoreType} Model (Rank)`;

        // Update Title slightly?
        const scoreTitle = document.querySelector('#overall-score-display').previousElementSibling?.querySelector('p');
        if (scoreTitle) scoreTitle.textContent = "Overall Rank";

    } else {
        // SCORE MODE: Display Raw Score
        scoreDisplay.textContent = overallValue.toFixed(1);

        if (typeDisplay) typeDisplay.textContent = `${appState.scoreType} Model`;
        const scoreTitle = document.querySelector('#overall-score-display').previousElementSibling?.querySelector('p');
        if (scoreTitle) scoreTitle.textContent = "Overall Index Score";
    }

    // Defensive Check: If charts aren't ready, skip update to prevent crash
    if (!radarChartInstance || !comparisonChartInstance) {
        console.warn("Skipping chart update. Instances:", {
            radar: !!radarChartInstance,
            comp: !!comparisonChartInstance
        });
    } else {
        // Update Chart Options based on View Mode
        const isRank = appState.viewMode === 'rank';

        // Dynamic Y-Axis Configuration
        radarChartInstance.options.scales.y.reverse = isRank; // Invert for Ranks (1 is top)
        radarChartInstance.options.scales.y.max = isRank ? null : 100; // Auto-scale for Ranks, Fixed 100 for Scors
        radarChartInstance.options.scales.y.title = {
            display: true,
            text: isRank ? 'Rank (Lower is Better)' : 'Score',
            font: { weight: 'bold' }
        };

        // Update Tooltip Title logic if needed (Chart.js handles this well usually)

        console.log("Updating charts with new data... Rank Mode:", isRank);

        // View Mode Toggle: Chart vs Table
        const chartCanvas = document.getElementById('main-radar-chart');
        const tableContainer = document.getElementById('rank-table-container');
        const chartHeader = document.getElementById('domain-chart-header'); // Get Header

        if (isRank) {
            // Show Table, Hide Chart
            chartCanvas.style.display = 'none';
            tableContainer.classList.remove('hidden');
            if (chartHeader) chartHeader.textContent = "Domain Performance"; // Remove (vs Average)
            renderRankTable(domainScores, appState.data.length);
        } else {
            // Show Chart, Hide Table
            chartCanvas.style.display = 'block';
            tableContainer.classList.add('hidden');
            if (chartHeader) chartHeader.textContent = "Domain Performance (vs Average)"; // Reset

            // Standard Chart Logic (Scores)
            radarChartInstance.options.scales.y.reverse = false;
            radarChartInstance.options.scales.y.max = 100;
            radarChartInstance.options.scales.y.title.text = 'Score';

            // Update Main Chart (Bar + Target Line) (#Refined)
            const avgScores = {};
            Object.keys(currentDomains).forEach(d => {
                const sum = appState.data.reduce((acc, curr) => acc + calculateDomainScore(curr, d), 0);
                avgScores[d] = sum / (appState.data.length || 1);
            });

            const labels = Object.keys(domainScores);
            const communityValues = Object.values(domainScores);
            // Floating Bar Data for Average (Target Line)
            const thickness = 0.5; // Thickness of the "line"
            const avgValues = Object.values(avgScores).map(v => [v - thickness, v + thickness]);

            radarChartInstance.data.labels = labels;
            radarChartInstance.data.datasets = [
                {
                    label: appState.selectedCommunity,
                    data: communityValues,
                    backgroundColor: CHART_COLORS.primary,
                    borderRadius: 4,
                    barPercentage: 0.6,
                    order: 1
                },
                {
                    label: 'Territorial Average',
                    data: avgValues,
                    backgroundColor: '#ef4444',
                    borderRadius: 4,
                    type: 'bar',
                    barPercentage: 0.8,
                    grouped: false,
                    skipNull: true,
                    order: 0
                }
            ];
            radarChartInstance.update();
        }
    }

    // Update Comparison Chart (Re-render to support type switch: Bar <-> Scatter)
    if (comparisonChartInstance) {
        comparisonChartInstance.destroy();
    }

    const ctxComp = document.getElementById('comparison-bar-chart').getContext('2d');
    const isRank = appState.viewMode === 'rank';

    // Calculate Data for all communities
    let compData = appState.data.map(d => ({
        label: d.Community,
        score: calculateOverallScore(d),
        community: d.Community
    }));

    if (isRank) {
        // RANK MODE: Scatter Dot Plot (Rank 1 is Best)
        // 1. Sort by Weighted Score DESCENDING (Higher is better for ranks)
        compData.sort((a, b) => b.score - a.score);

        // 2. Assign Ordinal Ranks (1..N)
        compData.forEach((d, i) => d.rank = i + 1);

        const total = compData.length;
        // X-Axis: 8 -> 1 (Left -> Right). Use 'reverse: true' on linear axis later?
        // Actually user wants "Rank 8 to 1 from left to right". 
        // Standard Linear: Min(1) -> Max(8). 
        // User wants Left=8 (Worst), Right=1 (Best).
        // So we want x-axis to run from Max down to 1.

        // SPLIT DATASETS for Legend Support
        const frontRunners = compData.filter(d => d.score >= 67).map(d => ({ x: d.rank, y: 0, community: d.community, score: d.score }));
        const performers = compData.filter(d => d.score >= 34 && d.score < 67).map(d => ({ x: d.rank, y: 0, community: d.community, score: d.score }));
        const aspirants = compData.filter(d => d.score < 34).map(d => ({ x: d.rank, y: 0, community: d.community, score: d.score }));

        console.log("Rank Chart Segments:", {
            frontRunners: frontRunners.length,
            performers: performers.length,
            aspirants: aspirants.length
        });

        // Common Point Style Helper
        const pointStyle = {
            borderColor: (ctx) => ctx.raw?.community === appState.selectedCommunity ? '#1e293b' : 'transparent',
            borderWidth: (ctx) => ctx.raw?.community === appState.selectedCommunity ? 3 : 1,
            pointRadius: (ctx) => ctx.raw?.community === appState.selectedCommunity ? 12 : 7,
            pointHoverRadius: 14
        };

        // Guide Line: Connects 1 to 8
        const lineData = [{ x: 1, y: 0 }, { x: 8, y: 0 }];

        comparisonChartInstance = new Chart(ctxComp, {
            type: 'scatter',
            data: {
                datasets: [
                    {
                        type: 'line',
                        label: 'Guide Line',
                        data: lineData,
                        borderColor: '#cbd5e1', // Slate-300
                        borderWidth: 2,
                        pointRadius: 0,
                        hoverRadius: 0,
                        order: 4
                    },
                    {
                        label: 'Front-Runner', // Legend Text
                        data: frontRunners,
                        backgroundColor: '#0C8CBE', // Teal
                        order: 3,
                        ...pointStyle
                    },
                    {
                        label: 'Performer', // Legend Text
                        data: performers,
                        backgroundColor: '#88D66C', // Green
                        order: 2,
                        ...pointStyle
                    },
                    {
                        label: 'Aspirant', // Legend Text
                        data: aspirants,
                        backgroundColor: '#E4E080', // Yellow
                        order: 1,
                        ...pointStyle
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                layout: {
                    padding: { top: 30, bottom: 10, left: 20, right: 20 }
                },
                plugins: {
                    legend: {
                        display: true, // Show Legend
                        position: 'top',
                        labels: {
                            usePointStyle: true,
                            font: { size: 11, weight: 'bold' },
                            // FILTER: Hide "Guide Line" from Legend
                            filter: (item) => item.text !== 'Guide Line'
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => {
                                const d = ctx.raw;
                                return `${d.community}: Rank ${d.x} (Score: ${Math.round(d.score)})`;
                            }
                        }
                    },
                    datalabels: {
                        display: (ctx) => ctx.dataset.type !== 'line',
                        // STAGGERED LABELS: Even ranks top, Odd ranks bottom to prevent overlap
                        align: (ctx) => ctx.dataIndex % 2 === 0 ? 'top' : 'bottom',
                        anchor: (ctx) => ctx.dataIndex % 2 === 0 ? 'end' : 'start',
                        offset: 4,
                        color: (ctx) => ctx.dataset.data[ctx.dataIndex].community === appState.selectedCommunity ? '#0C8CBE' : '#64748b',
                        font: { weight: 'bold', size: 10 },
                        formatter: (v) => v.community,
                        clip: false
                    }
                },
                scales: {
                    y: {
                        display: false,
                        min: -1,
                        max: 1
                    },
                    x: {
                        type: 'linear',
                        reverse: true, // 8 on Left, 1 on Right
                        min: 0.5,
                        max: 8.5,
                        grid: {
                            drawOnChartArea: false, // Hide vertical grid lines
                            drawBorder: false,       // Hide border
                            drawTicks: true         // Show ticks
                        },
                        ticks: {
                            stepSize: 1,
                            font: { weight: 'bold', size: 12 },
                            color: '#64748b',
                            callback: (val) => (val % 1 === 0 && val >= 1 && val <= 8) ? val : ''
                        },
                        title: {
                            display: false // HIDDEN
                        }
                    }
                }
            }
        });

    } else {
        // SCORE MODE: Bar Chart (Existing Logic)
        // Sort DESC (Higher score is better) usually? Chart usually handles labels order.
        // Let's keep original order or implicit sort? 

        const labels = compData.map(d => d.label);
        const scores = compData.map(d => d.score);

        // Highlight logic
        const bgColors = compData.map(d => d.label === appState.selectedCommunity ? CHART_COLORS.primary : CHART_COLORS.primaryLight);

        comparisonChartInstance = new Chart(ctxComp, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Overall Index',
                    data: scores,
                    backgroundColor: bgColors,
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    datalabels: {
                        color: '#fff', // White text inside bar
                        anchor: 'end',
                        align: 'start', // Inside the top of the bar
                        offset: 4,
                        rotation: 0,   // Horizontal
                        font: { size: 13, weight: 'bold' },
                        formatter: Math.round
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        max: 100,
                        ticks: { font: { size: 12, weight: 'bold' } }
                    },
                    x: {
                        ticks: {
                            font: { size: 11, weight: 'bold' },
                            autoSkip: false,
                            maxRotation: 90,
                            minRotation: 45
                        }
                    }
                }
            }
        });
    }


    // Refresh Table if open
    if (!document.getElementById('details-table-container').classList.contains('hidden')) {
        renderDetailsTable();
    }
}

function renderRankTable(domainScores, totalCommunities) {
    const tbody = document.getElementById('rank-table-body');
    tbody.innerHTML = '';

    Object.entries(domainScores).forEach(([domain, rank]) => {
        const row = document.createElement('tr');
        row.className = 'border-b border-gray-50 hover:bg-gray-50 transition-colors';

        // Color Logic: 1 (Best) -> Teal, 25 (Worst) -> Orange
        // Simple distinct classes for now for robustness
        const ratio = rank / totalCommunities;
        let colorClass = 'text-gray-700'; // Default

        if (ratio <= 0.33) colorClass = 'text-teal-600 font-bold'; // Top tier
        else if (ratio <= 0.66) colorClass = 'text-blue-500 font-semibold'; // Mid tier
        else colorClass = 'text-orange-500 font-bold'; // Low tier

        row.innerHTML = `
            <td class="py-3 px-4 font-medium text-slate-700">${domain}</td>
            <td class="py-3 px-4 text-right text-lg font-mono ${colorClass}">${Math.round(rank)}<span class="text-xs text-gray-400 font-normal"> / ${totalCommunities}</span></td>
        `;
        tbody.appendChild(row);
    });
}
