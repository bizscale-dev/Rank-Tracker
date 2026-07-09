const axios = require('axios');

// ── Module-level cache (lives for the server process lifetime) ──────────────────
let _usLocationsCache = null;

// US state name → abbreviation
const STATE_ABBREVS = {
    'Alabama': 'AL', 'Alaska': 'AK', 'Arizona': 'AZ', 'Arkansas': 'AR',
    'California': 'CA', 'Colorado': 'CO', 'Connecticut': 'CT', 'Delaware': 'DE',
    'Florida': 'FL', 'Georgia': 'GA', 'Hawaii': 'HI', 'Idaho': 'ID',
    'Illinois': 'IL', 'Indiana': 'IN', 'Iowa': 'IA', 'Kansas': 'KS',
    'Kentucky': 'KY', 'Louisiana': 'LA', 'Maine': 'ME', 'Maryland': 'MD',
    'Massachusetts': 'MA', 'Michigan': 'MI', 'Minnesota': 'MN', 'Mississippi': 'MS',
    'Missouri': 'MO', 'Montana': 'MT', 'Nebraska': 'NE', 'Nevada': 'NV',
    'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY',
    'North Carolina': 'NC', 'North Dakota': 'ND', 'Ohio': 'OH', 'Oklahoma': 'OK',
    'Oregon': 'OR', 'Pennsylvania': 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC',
    'South Dakota': 'SD', 'Tennessee': 'TN', 'Texas': 'TX', 'Utah': 'UT',
    'Vermont': 'VT', 'Virginia': 'VA', 'Washington': 'WA', 'West Virginia': 'WV',
    'Wisconsin': 'WI', 'Wyoming': 'WY', 'District of Columbia': 'DC'
};

/**
 * City types DataForSEO classifies under US locations
 */
const CITY_TYPES = new Set(['City', 'Municipality', 'Borough', 'Census-designated place', 'Neighborhood', 'Town', 'Village']);

class DataForSEOService {
    constructor(login, password) {
        this.login = login;
        this.password = password;
        this.baseURL = 'https://api.dataforseo.com/v3';

        this.client = axios.create({
            baseURL: this.baseURL,
            auth: {
                username: this.login,
                password: this.password
            },
            headers: { 'Content-Type': 'application/json' },
            timeout: 60000
        });
    }

    /**
     * Standard API — POST one or more keyword tasks in a single request.
     * Much cheaper than Live: $0.0006/task vs $0.03/task.
     * IMPORTANT: Always sends location_name + location_coordinate, NEVER location_code
     *
     * @param {Array<{ keyword, location, device, tag?, latitude?, longitude? }>} tasks
     * @returns {Array<{ taskId, keyword, tag }>}
     */
    async postTasks(tasks) {
        const payload = tasks.map(t => {
            // Always normalize as string (remove spaces after commas)
            const normalizedLoc = typeof t.location === 'number'
                ? t.location.toString()
                : (t.location || '').replace(/,\s+/g, ',');
            
            // Build base payload with location_name (NEVER location_code)
            const taskPayload = {
                keyword: t.keyword,
                location_name: normalizedLoc,  // Always use location_name, not location_code
                language_code: 'en',
                device: t.device || 'desktop',
                os: (t.device || 'desktop') === 'mobile' ? 'android' : undefined,
                depth: 100,       // top 100 sufficient for rank checking (faster than 200)
                priority: 2,      // high priority: 1-3 min vs normal 5-10 min
                tag: t.tag || ''  // tag stores domain so getTaskResult can use it for domain matching
            };

            // Add location_coordinate if latitude/longitude provided (for more precise targeting)
            if (t.latitude !== undefined && t.longitude !== undefined) {
                taskPayload.location_coordinate = `${t.latitude},${t.longitude}`;
            }

            return taskPayload;
        });

        console.log(`📤 DataForSEO task_post: ${tasks.length} keyword(s) with location_name + location_coordinate`);
        const response = await this.client.post('/serp/google/organic/task_post', payload);

        if (response.data.status_code !== 20000) {
            throw new Error(`DataForSEO task_post Error: ${response.data.status_message}`);
        }

        return response.data.tasks.map((task, i) => ({
            taskId: task.id,
            keyword: tasks[i].keyword,
            tag: tasks[i].tag || ''
        }));
    }

    /**
     * Standard API — Fetch result for a single task ID.
     * Returns { ready: false } while DataForSEO is still processing (status 40602).
     * Returns { ready: true, keyword, organicResults, cost, tag } when done.
     *
     * @param {string} taskId
     */
    async getTaskResult(taskId) {
        console.log(`📥 DataForSEO task_get: ${taskId}`);
        const response = await this.client.get(
            `/serp/google/organic/task_get/advanced/${taskId}`
        );

        if (response.data.status_code !== 20000) {
            throw new Error(`DataForSEO task_get Error: ${response.data.status_message}`);
        }

        const task = response.data.tasks?.[0];
        if (!task) throw new Error('No task returned from DataForSEO task_get');

        // 40602 = task is still being processed
        if (task.status_code === 40602) {
            return { ready: false };
        }

        if (task.status_code !== 20000) {
            throw new Error(`Task Error: ${task.status_message}`);
        }

        const result = task.result?.[0];
        if (!result) throw new Error('No result data for task');

        return {
            ready: true,
            keyword: task.data?.keyword || '',
            tag: task.data?.tag || '',
            organicResults: result.items
                ? result.items.filter(i => i.type === 'organic')
                : [],
            totalResults: result.se_results_count || 0,
            cost: task.cost || 0
        };
    }

    /**
     * Get SERP results for a keyword + location
     * IMPORTANT: Always sends location_name + location_coordinate, NEVER location_code
     * @param {string}         keyword
     * @param {number|string}  location - location name string (e.g. "Houston, Texas, United States")
     * @param {string}         device
     * @param {number}         depth
     * @param {number}         latitude - optional latitude for more precise location
     * @param {number}         longitude - optional longitude for more precise location
     */
    async getSearchResults(keyword, location, device = 'desktop', depth = 200, latitude, longitude) {
        // Always normalize as string (remove spaces after commas)
        const normalizedLocation = typeof location === 'number'
            ? location.toString()
            : (location || '').replace(/,\s+/g, ',');
            
        try {
            console.log(`📡 DataForSEO SERP request:`, { keyword, location: normalizedLocation, device, coordinate: latitude && longitude ? `${latitude},${longitude}` : 'none' });

            const postData = [{
                keyword,
                location_name: normalizedLocation,  // Always use location_name, not location_code
                language_code: 'en',
                device,
                os: device === 'mobile' ? 'android' : undefined,
                depth
            }];

            // Add location_coordinate if provided
            if (latitude !== undefined && longitude !== undefined) {
                postData[0].location_coordinate = `${latitude},${longitude}`;
            }

            const response = await this.client.post(
                '/serp/google/organic/live/advanced',
                postData
            );

            if (response.data.status_code !== 20000) {
                throw new Error(`DataForSEO API Error: ${response.data.status_message}`);
            }

            const task = response.data.tasks[0];

            if (task.status_code !== 20000) {
                throw new Error(`Task Error: ${task.status_message}`);
            }

            if (!task.result || task.result.length === 0) {
                throw new Error('No results returned from DataForSEO');
            }

            const result = task.result[0];

            return {
                success: true,
                organicResults: result.items ? result.items.filter(i => i.type === 'organic') : [],
                allItems: result.items || [],
                totalResults: result.se_results_count || 0,
                searchMetadata: {
                    keyword,
                    location,
                    device,
                    total_cost: task.cost || 0
                }
            };
        } catch (error) {
            throw this._handleError(error);  // Explicitly throw the error
        }
    }

    /**
     * Get account info and balance
     */
    async getAccountInfo() {
        try {
            const response = await this.client.get('/appendix/user_data');

            if (response.data.status_code !== 20000) {
                throw new Error('Failed to get account info');
            }

            const result = response.data.tasks[0].result;

            return {
                money: result.money,
                limits: result.limits,
                pricing: result.pricing
            };
        } catch (error) {
            throw this._handleError(error);  // Explicitly throw the error
        }
    }

    /**
     * Validate credentials
     */
    async validateCredentials() {
        try {
            const response = await this.client.get('/appendix/user_data');
            return response.data.status_code === 20000;
        } catch {
            return false;
        }
    }
    

    /**
     * Load ALL US city locations from DataForSEO and cache in memory.
     * Free to call — locations endpoint has no per-call cost.
     * Cache persists for server lifetime (clear by restarting).
     */
    async loadUSLocations() {
        if (_usLocationsCache) return _usLocationsCache;
        console.log('📍 Loading US locations from DataForSEO (first search — cached after this)...');
        try {
            // Use a longer timeout — the all-locations endpoint returns 226k entries
            const response = await this.client.get('/serp/google/locations', {
                timeout: 90000
            });
            const result = response.data?.tasks?.[0]?.result;
            if (!result || !Array.isArray(result)) {
                console.warn('⚠️  DataForSEO locations: unexpected response shape');
                return null;
            }
            _usLocationsCache = result
                // Filter to US cities/towns only
                .filter(loc => loc.country_iso_code === 'US' && CITY_TYPES.has(loc.location_type))
                .map(loc => {
                    // location_name format: "Riverton,Utah,United States"
                    const parts = loc.location_name.split(',');
                    const city = parts[0] || '';
                    const state = (parts[1] || '').trim();
                    const abbrev = STATE_ABBREVS[state] || state;
                    return {
                        display: abbrev ? `${city}, ${abbrev}` : city,
                        value: loc.location_name, // Already correct DataForSEO format (no spaces)
                        code: loc.location_code
                    };
                })
                .sort((a, b) => a.display.localeCompare(b.display));
            console.log(`✅ Cached ${_usLocationsCache.length} US city locations`);
            return _usLocationsCache;
        } catch (err) {
            console.warn('⚠️  Could not load DataForSEO locations:', err.message);
            return null;
        }
    }

    /**
     * Search US locations by city name (uses in-memory cache).
     * Returns [{ display, value }] suitable for the LocationSearch dropdown.
     */
    async searchUSLocations(query) {
        const cache = await this.loadUSLocations();
        if (!cache) return null; // signal caller to use static fallback
        const q = (query || '').toLowerCase().trim();
        if (!q) return cache.slice(0, 25);
        return cache
            .filter(loc => loc.display.toLowerCase().includes(q))
            .slice(0, 30);
    }

    _handleError(error) {
        if (error.response) {
            const msg = error.response.data?.status_message || error.message;
            throw new Error(`DataForSEO API Error: ${msg}`);
        } else if (error.request) {
            throw new Error('No response from DataForSEO. Check your internet connection.');
        } else {
            throw error;
        }
    }

    /**
     * Post GBP (Local Finder) tasks to DataForSEO
     * IMPORTANT: Always sends location_name + location_coordinate, NEVER location_code
     * @param {Array<{ keyword, location, device, tag?, latitude?, longitude? }>} tasks
     * @returns {Array<{ taskId, keyword, tag }>}
     */
    async postGBPTasks(tasks) {
        const payload = tasks.map(t => {
            // Always normalize as string (remove spaces after commas)
            const normalizedLoc = typeof t.location === 'number'
                ? t.location.toString()
                : (t.location || '').replace(/,\s+/g, ',');
            
            // Build base payload with location_name (NEVER location_code)
            const taskPayload = {
                keyword: t.keyword,
                location_name: normalizedLoc,  // Always use location_name, not location_code
                language_name: 'English',
                depth: 100,
                priority: 2,
                tag: t.tag || ''
            };

            // Add location_coordinate if latitude/longitude provided (for more precise targeting)
            if (t.latitude !== undefined && t.longitude !== undefined) {
                taskPayload.location_coordinate = `${t.latitude},${t.longitude}`;
            }

            return taskPayload;
        });

        console.log(`📤 DataForSEO GBP task_post: ${tasks.length} keyword(s) with location_name + location_coordinate`);
        const response = await this.client.post('/serp/google/local_finder/task_post', payload);

        if (response.data.status_code !== 20000) {
            throw new Error(`DataForSEO GBP task_post Error: ${response.data.status_message}`);
        }

        return response.data.tasks.map((task, i) => ({
            taskId: task.id,
            keyword: tasks[i].keyword,
            tag: tasks[i].tag || ''
        }));
    }

    /**
     * Get GBP (Local Finder) task result
     * @param {string} taskId
     */
    async getGBPTaskResult(taskId) {
        console.log(`📥 DataForSEO GBP task_get: ${taskId}`);
        const response = await this.client.get(
            `/serp/google/local_finder/task_get/advanced/${taskId}`
        );

        if (response.data.status_code !== 20000) {
            throw new Error(`DataForSEO GBP task_get Error: ${response.data.status_message}`);
        }

        const task = response.data.tasks?.[0];
        if (!task) throw new Error('No task returned from DataForSEO');

        // 40602 = task is still being processed
        if (task.status_code === 40602) {
            return { ready: false };
        }

        if (task.status_code !== 20000) {
            throw new Error(`Task Error: ${task.status_message}`);
        }

        const result = task.result?.[0];
        if (!result) throw new Error('No result data for task');

        return {
            ready: true,
            keyword: task.data?.keyword || '',
            tag: task.data?.tag || '',
            businesses: result.items || [],
            totalResults: result.se_results_count || 0,
            cost: task.cost || 0
        };
    }

    /**
     * Get GBP live search results for a keyword + location
     * IMPORTANT: Always sends location_name + location_coordinate, NEVER location_code
     * @param {string}         keyword
     * @param {number|string}  location - location name string
     * @param {number}         latitude - optional latitude for more precise location
     * @param {number}         longitude - optional longitude for more precise location
     */
    async getGBPSearchResults(keyword, location, latitude, longitude) {
        // Always normalize as string (remove spaces after commas)
        const normalizedLocation = typeof location === 'number'
            ? location.toString()
            : (location || '').replace(/,\s+/g, ',');
            
        try {
            console.log(`📡 DataForSEO GBP live request:`, { keyword, location: normalizedLocation, coordinate: latitude && longitude ? `${latitude},${longitude}` : 'none' });

            const postData = [{
                keyword,
                location_name: normalizedLocation,  // Always use location_name, not location_code
                language_name: 'English',
                depth: 100
            }];

            // Add location_coordinate if provided
            if (latitude !== undefined && longitude !== undefined) {
                postData[0].location_coordinate = `${latitude},${longitude}`;
            }

            const response = await this.client.post(
                '/serp/google/local_finder/live/advanced',
                postData
            );

            if (response.data.status_code !== 20000) {
                throw new Error(`DataForSEO API Error: ${response.data.status_message}`);
            }

            const task = response.data.tasks[0];

            if (task.status_code !== 20000) {
                throw new Error(`Task Error: ${task.status_message}`);
            }

            if (!task.result || task.result.length === 0) {
                throw new Error('No results returned from DataForSEO');
            }

            const result = task.result[0];

            return {
                success: true,
                businesses: result.items || [],
                totalResults: result.se_results_count || 0,
                searchMetadata: {
                    keyword,
                    location,
                    total_cost: task.cost || 0
                }
            };
        } catch (error) {
            throw this._handleError(error);  // Explicitly throw the error
        }
    }
}

module.exports = DataForSEOService;
