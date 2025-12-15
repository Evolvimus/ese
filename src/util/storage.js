const fs = require('fs');
const path = require('path');

class Storage {
    constructor() {
        this.dataDir = path.join(__dirname, '../../data');
    }

    /**
     * Saves a page object to the city's JSON file.
     * Simplification: Reads the whole file, appends, writes back (ok for demo/small scale).
     */
    savePage(city, pageData) {
        // Legacy support
        const filename = `${city}.json`;
        const filePath = path.join(this.dataDir, filename);
        let data = { pages: [] };

        try {
            if (fs.existsSync(filePath)) {
                const fileContent = fs.readFileSync(filePath, 'utf-8');
                data = JSON.parse(fileContent);
            }
        } catch (e) {
            console.error(`Error reading ${filename}`, e);
        }

        data.pages.push(pageData);
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        console.log(`[Storage] Saved ${pageData.url} to ${filename}`);
    }

    /**
     * Saves a page using the strict AI-driven naming convention:
     * [Country]-[City]-[Category]-[Domain]-[YYYYMMDD].json
     */
    saveAIClassifiedPage(aiMeta, pageData) {
        const domain = new URL(pageData.url).hostname.replace('www.', '');
        const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');

        // Sanitize components
        const safe = (str) => str.replace(/[^a-zA-Z0-9-]/g, '');

        const filename = `${safe(aiMeta.country)}-${safe(aiMeta.city)}-${safe(aiMeta.category)}-${domain}-${date}.json`;
        const filePath = path.join(this.dataDir, 'cities', filename);

        let data = { pages: [] };

        // Append to existing file if it exists (e.g. searching same domain multiple times today)
        try {
            if (fs.existsSync(filePath)) {
                const fileContent = fs.readFileSync(filePath, 'utf-8');
                data = JSON.parse(fileContent);
            }
        } catch (e) { }

        // Avoid duplicates in the same file
        if (!data.pages.some(p => p.url === pageData.url)) {
            data.pages.push(pageData);
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
            console.log(`[Storage] Saved to ${filename}`);
        }
    }
}

module.exports = new Storage();
