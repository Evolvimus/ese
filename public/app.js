const searchInput = document.getElementById('searchInput');
const resultsArea = document.getElementById('results-area');

// Cache for loaded data
let searchIndex = [];

// 1. Load Data on Init
// 1. Load Data on Init
async function loadIndex() {
    try {
        // Dynamic Loading: Fetch list of available city indices
        const listRes = await fetch('/api/cities');
        const files = await listRes.json();

        console.log('[ESE Client] Found indices:', files);

        if (files.length === 0) {
            resultsArea.innerHTML = '<div style="text-align:center; color:#555">Index empty. Use Admin Dashboard to crawl a city.</div>';
            return;
        }

        // Load all city files
        let totalDocs = 0;
        for (const file of files) {
            try {
                const res = await fetch(`/data/cities/${file}`);
                const data = await res.json();
                if (data.pages) {
                    searchIndex = searchIndex.concat(data.pages);
                    totalDocs += data.pages.length;
                }
            } catch (err) {
                console.warn(`Failed to load ${file}`, err);
            }
        }

        console.log(`[ESE Client] Fully Loaded ${totalDocs} documents from ${files.length} cities.`);

        // Initial feedback if empty query
        if (totalDocs === 0) {
            resultsArea.innerHTML = '<div style="text-align:center; color:#555">No pages indexed yet.</div>';
        }

    } catch (e) {
        console.warn('Index loading failed:', e);
        resultsArea.innerHTML = '<div style="text-align:center; color:#555">Connection to Index Failed. Is server running?</div>';
    }
}

// 2. Search Logic
function performSearch(query) {
    if (!query) {
        resultsArea.innerHTML = '';
        return;
    }

    const lowerQuery = query.toLowerCase();
    const matches = searchIndex.filter(page => {
        return (page.title && page.title.toLowerCase().includes(lowerQuery)) ||
            (page.snippet && page.snippet.toLowerCase().includes(lowerQuery)) ||
            (page.url && page.url.toLowerCase().includes(lowerQuery));
    });

    renderResults(matches);
}

// 3. Render
function renderResults(results) {
    if (results.length === 0) {
        resultsArea.innerHTML = '<div style="text-align:center; color:#666">No results found.</div>';
        return;
    }

    resultsArea.innerHTML = results.map(item => `
        <a href="${item.url}" target="_blank" class="result-card">
            <h3 class="result-title">${item.title || 'Untitled Page'}</h3>
            <div class="result-snippet">${item.snippet}</div>
            <div class="result-meta">
                <span>${new URL(item.url).hostname}</span>
                <span>${item.word_count} words • Indexed Now</span>
            </div>
        </a>
    `).join('');
}

// 4. Listeners
searchInput.addEventListener('input', (e) => {
    performSearch(e.target.value);
});

// Start
loadIndex();
