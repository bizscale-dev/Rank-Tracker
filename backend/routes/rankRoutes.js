const express = require('express');
const router = express.Router();
const DataForSEOService = require('../services/dataForSEOService');
const { findDomainInResults, getTopResults } = require('../services/rankCalculator');
const { getAllLocations, searchLocations, getLocationCode } = require('../data/locations');
const getSupabase = require('../supabaseClient'); // lazy getter — call getSupabase() per use

const activeRequests = new Set();
function cleanupRequest(reqKey) {
    setTimeout(() => activeRequests.delete(reqKey), 10000); // 10 seconds deduplication window
}

// ─── Helper: get configured service or throw ──────────────────────────────────
function getService() {
    const login = process.env.DATAFORSEO_LOGIN;
    const password = process.env.DATAFORSEO_PASSWORD;
    if (!login || !password) {
        const err = new Error('DataForSEO credentials not configured.');
        err.status = 503;
        throw err;
    }
    return new DataForSEOService(login, password);
}

// ─── Helper: resolve location and get coordinates ─────────────────────────────
// Always prefer location_name with coordinates over location_code
function resolveLocationWithCoordinates(location) {
    const { getLocationWithCoordinates } = require('../data/locations');
    
    if (!location) return { locationName: '', latitude: undefined, longitude: undefined };
    
    // If it's a number, warn (backward compat)
    if (typeof location === 'number') {
        console.warn('⚠️  Using numeric location code:', location, '- Consider using location_name instead');
        return { locationName: location.toString(), latitude: undefined, longitude: undefined };
    }
    
    // Pass location as-is to the lookup function (it handles both formats with/without spaces)
    const locData = getLocationWithCoordinates(location);
    
    if (locData) {
        console.log(`✅ Location matched: ${location} → lat: ${locData.latitude}, lng: ${locData.longitude}`);
        return { 
            locationName: locData.value,  // Use the database format with spaces
            latitude: locData.latitude, 
            longitude: locData.longitude 
        };
    }
    
    console.warn(`⚠️  Location not found in database: ${location}. Sending without coordinates.`);
    // Return as-is but without coordinates
    return { locationName: location, latitude: undefined, longitude: undefined };
}

// Legacy helper for backward compatibility
function resolveLocation(location) {
    return resolveLocationWithCoordinates(location).locationName;
}

// ─── GET /api/rank/test ───────────────────────────────────────────────────────
router.get('/test', async (req, res) => {
    try {
        const service = getService();
        const isValid = await service.validateCredentials();
        if (isValid) {
            const account = await service.getAccountInfo();
            res.json({ success: true, message: 'DataForSEO credentials are valid', account: { balance: account.money?.balance || 0, currency: account.money?.currency || 'USD' } });
        } else {
            res.status(401).json({ success: false, message: 'Invalid DataForSEO credentials' });
        }
    } catch (error) {
        res.status(error.status || 500).json({ success: false, error: error.message });
    }
});

// ─── GET /api/rank/account ────────────────────────────────────────────────────
router.get('/account', async (req, res) => {
    try {
        const service = getService();
        const info = await service.getAccountInfo();
        res.json({ success: true, account: info });
    } catch (error) {
        res.status(error.status || 500).json({ success: false, error: error.message });
    }
});

// ─── GET /api/rank/locations ──────────────────────────────────────────────────
router.get('/locations', (req, res) => {
    res.json({ success: true, locations: getAllLocations() });
});

// ─── GET /api/rank/locations/search ──────────────────────────────────────────
router.get('/locations/search', async (req, res) => {
    const query = req.query.q || '';
    try {
        const service = getService();
        const dfResults = await service.searchUSLocations(query);
        if (dfResults) return res.json({ success: true, locations: dfResults, source: 'dataforseo' });
    } catch {
        // fall through to static list
    }
    res.json({ success: true, locations: searchLocations(query), source: 'static' });
});

// ─── POST /api/rank/check ─────────────────────────────────────────────────────
// Returns: { supabaseId, taskId, keyword, domain, location, device }
router.post('/check', async (req, res) => {
    try {
        const { keyword, location, domain, device = 'desktop' } = req.body;
        if (!keyword || !location || !domain) {
            return res.status(400).json({ success: false, error: 'keyword, location, and domain are required' });
        }

        // --- Deduplication (prevent double-clicks / strict mode firing twice) ---
        const reqKey = `check:${keyword}:${location}:${domain}:${device}`;
        if (activeRequests.has(reqKey)) {
            console.warn(`Duplicate /check request blocked: ${reqKey}`);
            return res.status(429).json({ success: false, error: 'Please wait. Request is already processing.' });
        }
        activeRequests.add(reqKey);
        cleanupRequest(reqKey);

        const sb = getSupabase();

        // 1. Insert pending row
        const { data: insertedRow, error: insertError } = await sb
            .from('rank_checks')
            .insert([{ keyword, domain, location, device, status: 'pending' }])
            .select()
            .single();

        if (insertError) {
            console.error('Supabase insert error:', insertError.message);
            return res.status(500).json({ success: false, error: 'DB insert failed: ' + insertError.message });
        }

        const supabaseId = insertedRow.id;

        // 2. Post to DataForSEO
        const locInfo = resolveLocationWithCoordinates(location);

        const service = getService();
        const posted = await service.postTasks([{ keyword, location: locInfo.locationName, device, tag: domain, latitude: locInfo.latitude, longitude: locInfo.longitude }]);
        const taskId = posted[0].taskId;

        // 3. Update row with task_id (no updated_at — column may not exist)
        const { error: updateError } = await sb
            .from('rank_checks')
            .update({ task_id: taskId })
            .eq('id', supabaseId);

        if (updateError) {
            console.error('Supabase task_id update error:', updateError.message);
            // non-fatal — we still return supabaseId so frontend can fall back to /sync
        }

        res.json({ success: true, supabaseId, taskId, keyword, domain, location, device });

    } catch (error) {
        res.status(error.status || 500).json({ success: false, error: error.message });
    }
});

// ─── POST /api/rank/batch ─────────────────────────────────────────────────────
// Returns: { taskIds: [{ supabaseId, taskId, keyword }], domain, location, device }
router.post('/batch', async (req, res) => {
    try {
        const { keywords, location, domain, device = 'desktop' } = req.body;
        if (!keywords || !Array.isArray(keywords) || keywords.length === 0) {
            return res.status(400).json({ success: false, error: 'keywords array is required' });
        }
        if (!location || !domain) {
            return res.status(400).json({ success: false, error: 'location and domain are required' });
        }

        const limitedKeywords = keywords.slice(0, 100);

        // --- Deduplication (prevent double-clicks / strict mode firing twice) ---
        const reqKey = `batch:${limitedKeywords.join('|')}:${location}:${domain}:${device}`;
        if (activeRequests.has(reqKey)) {
            console.warn(`Duplicate /batch request blocked.`);
            return res.status(429).json({ success: false, error: 'Please wait. Request is already processing.' });
        }
        activeRequests.add(reqKey);
        cleanupRequest(reqKey);

        const sb = getSupabase();

        // 1. Insert one pending row per keyword

        const { data: insertedRows, error: insertError } = await sb
            .from('rank_checks')
            .insert(limitedKeywords.map(keyword => ({ keyword, domain, location, device, status: 'pending' })))
            .select();

        if (insertError) {
            console.error('Supabase batch insert error:', insertError.message);
            return res.status(500).json({ success: false, error: 'DB insert failed: ' + insertError.message });
        }

        // 2. Post all keywords in ONE DataForSEO request
        const locInfo = resolveLocationWithCoordinates(location);

        const service = getService();
        const posted = await service.postTasks(
            limitedKeywords.map(keyword => ({ keyword, location: locInfo.locationName, device, tag: domain, latitude: locInfo.latitude, longitude: locInfo.longitude }))
        );

        // 3. Update each row with its task_id (no updated_at)
        await Promise.all(
            insertedRows.map((row, i) =>
                sb.from('rank_checks').update({ task_id: posted[i].taskId }).eq('id', row.id)
                    .then(({ error }) => { if (error) console.error(`task_id update error for ${row.id}:`, error.message); })
            )
        );

        res.json({
            success: true,
            taskIds: insertedRows.map((row, i) => ({
                supabaseId: row.id,
                taskId: posted[i].taskId,
                keyword: limitedKeywords[i]
            })),
            domain,
            location,
            device,
            totalKeywords: posted.length
        });

    } catch (error) {
        res.status(error.status || 500).json({ success: false, error: error.message });
    }
});

// ─── GET /api/rank/status ─────────────────────────────────────────────────────
// Frontend polls this to check if specific rows are completed.
// Query: ?ids=uuid1,uuid2,uuid3
// Returns: { rows: [{ id, status, rank, url, keyword, cost }] }
router.get('/status', async (req, res) => {
    try {
        const ids = (req.query.ids || '').split(',').map(s => s.trim()).filter(Boolean);
        if (ids.length === 0) return res.json({ success: true, rows: [] });

        const sb = getSupabase();
        const { data, error } = await sb
            .from('rank_checks')
            .select('id, status, rank, url, keyword, cost')
            .in('id', ids);

        if (error) return res.status(500).json({ success: false, error: error.message });
        res.json({ success: true, rows: data || [] });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ─── GET /api/rank/sync ───────────────────────────────────────────────────────
// Syncs all pending rows: checks DataForSEO and marks completed ones.
// Returns: { synced: N, stillPending: M }
router.get('/sync', async (req, res) => {
    try {
        const service = getService();
        const sb = getSupabase();

        const { data: pendingRows, error: fetchError } = await sb
            .from('rank_checks')
            .select('id, task_id, domain')
            .eq('status', 'pending')
            .not('task_id', 'is', null);

        if (fetchError) return res.status(500).json({ success: false, error: fetchError.message });
        if (!pendingRows || pendingRows.length === 0) return res.json({ success: true, synced: 0, stillPending: 0 });

        let synced = 0;
        let stillPending = 0;

        await Promise.all(pendingRows.map(async (row) => {
            try {
                const taskResult = await service.getTaskResult(row.task_id);
                if (!taskResult.ready) { stillPending++; return; }

                const targetDomain = row.domain || taskResult.tag || '';
                const rankResult = findDomainInResults(targetDomain, taskResult.organicResults);

                const { error: updateError } = await sb
                    .from('rank_checks')
                    .update({
                        status: 'completed',
                        rank: rankResult.found ? rankResult.position : null,
                        url: rankResult.url || null,
                        cost: taskResult.cost || 0
                    })
                    .eq('id', row.id);

                if (updateError) {
                    console.error(`Sync update error for ${row.id}:`, updateError.message);
                    stillPending++;
                } else {
                    synced++;
                }
            } catch (err) {
                console.error(`Sync error for task ${row.task_id}:`, err.message);
                stillPending++;
            }
        }));

        res.json({ success: true, synced, stillPending });
    } catch (error) {
        res.status(error.status || 500).json({ success: false, error: error.message });
    }
});

// ─── GET /api/rank/results/:taskId ───────────────────────────────────────────
router.get('/results/:taskId', async (req, res) => {
    try {
        const { taskId } = req.params;
        const domain = req.query.domain || '';
        if (!taskId) return res.status(400).json({ success: false, error: 'taskId is required' });

        const service = getService();
        const taskResult = await service.getTaskResult(taskId);
        if (!taskResult.ready) return res.json({ ready: false });

        const targetDomain = domain || taskResult.tag || '';
        const rankResult = findDomainInResults(targetDomain, taskResult.organicResults);

        res.json({
            ready: true,
            keyword: taskResult.keyword,
            domain: targetDomain,
            found: rankResult.found,
            rank: rankResult.found ? rankResult.position : null,
            url: rankResult.url,
            title: rankResult.title,
            description: rankResult.description,
            cost: taskResult.cost,
            totalResults: taskResult.totalResults
        });
    } catch (error) {
        res.status(error.status || 500).json({ success: false, error: error.message });
    }
});

// ─── POST /api/rank/competitors ───────────────────────────────────────────────
router.post('/competitors', async (req, res) => {
    try {
        const { keyword, location, domains, device = 'desktop' } = req.body;
        if (!keyword || !location || !domains || !Array.isArray(domains) || domains.length === 0) {
            return res.status(400).json({ success: false, error: 'keyword, location, and domains array are required' });
        }

        const limitedDomains = domains.slice(0, 5);
        const locInfo = resolveLocationWithCoordinates(location);
        const service = getService();
        const serpData = await service.getSearchResults(keyword, locInfo.locationName, device, 200, locInfo.latitude, locInfo.longitude);
        const topResults = getTopResults(serpData.organicResults, 20);

        const competitors = limitedDomains.map(domain => {
            const rankResult = findDomainInResults(domain, serpData.organicResults);
            return { domain, found: rankResult.found, rank: rankResult.found ? rankResult.position : null, url: rankResult.url, title: rankResult.title };
        });

        competitors.sort((a, b) => {
            if (a.rank === null && b.rank === null) return 0;
            if (a.rank === null) return 1;
            if (b.rank === null) return -1;
            return a.rank - b.rank;
        });

        res.json({ success: true, keyword, location, device, competitors, topResults, cost: serpData.searchMetadata.total_cost });
    } catch (error) {
        res.status(error.status || 500).json({ success: false, error: error.message });
    }
});

// ─── POST /api/rank/gbp/check ─────────────────────────────────────────────────
// GBP (Local Finder) single check
router.post('/gbp/check', async (req, res) => {
    try {
        const { keyword, location, business_name } = req.body;
        if (!keyword || !location || !business_name) {
            return res.status(400).json({ success: false, error: 'keyword, location, and business_name are required' });
        }

        const reqKey = `gbp-check:${keyword}:${location}:${business_name}`;
        if (activeRequests.has(reqKey)) {
            console.warn(`Duplicate /gbp/check request blocked: ${reqKey}`);
            return res.status(429).json({ success: false, error: 'Please wait. Request is already processing.' });
        }
        activeRequests.add(reqKey);
        cleanupRequest(reqKey);

        const sb = getSupabase();

        // 1. Insert pending row into gbp_checks table
        const { data: insertedRow, error: insertError } = await sb
            .from('gbp_checks')
            .insert([{ keyword, business_name, location, status: 'pending' }])
            .select()
            .single();

        if (insertError) {
            console.error('Supabase GBP insert error:', insertError.message);
            return res.status(500).json({ success: false, error: 'DB insert failed: ' + insertError.message });
        }

        const supabaseId = insertedRow.id;

        // 2. Post to DataForSEO GBP
        const locInfo = resolveLocationWithCoordinates(location);

        const service = getService();
        const posted = await service.postGBPTasks([{ keyword, location: locInfo.locationName, tag: business_name, latitude: locInfo.latitude, longitude: locInfo.longitude }]);
        const taskId = posted[0].taskId;

        // 3. Update row with task_id
        const { error: updateError } = await sb
            .from('gbp_checks')
            .update({ task_id: taskId })
            .eq('id', supabaseId);

        if (updateError) {
            console.error('Supabase GBP task_id update error:', updateError.message);
        }

        res.json({ success: true, supabaseId, taskId, keyword, business_name, location });

    } catch (error) {
        res.status(error.status || 500).json({ success: false, error: error.message });
    }
});

// ─── POST /api/rank/gbp/batch ─────────────────────────────────────────────────
// GBP batch check
router.post('/gbp/batch', async (req, res) => {
    try {
        const { keywords, location, business_name } = req.body;
        if (!keywords || !Array.isArray(keywords) || keywords.length === 0) {
            return res.status(400).json({ success: false, error: 'keywords array is required' });
        }
        if (!location || !business_name) {
            return res.status(400).json({ success: false, error: 'location and business_name are required' });
        }

        const limitedKeywords = keywords.slice(0, 100);

        const reqKey = `gbp-batch:${limitedKeywords.join('|')}:${location}:${business_name}`;
        if (activeRequests.has(reqKey)) {
            console.warn(`Duplicate /gbp/batch request blocked.`);
            return res.status(429).json({ success: false, error: 'Please wait. Request is already processing.' });
        }
        activeRequests.add(reqKey);
        cleanupRequest(reqKey);

        const sb = getSupabase();

        // 1. Insert rows
        const { data: insertedRows, error: insertError } = await sb
            .from('gbp_checks')
            .insert(limitedKeywords.map(keyword => ({ keyword, business_name, location, status: 'pending' })))
            .select();

        if (insertError) {
            console.error('Supabase GBP batch insert error:', insertError.message);
            return res.status(500).json({ success: false, error: 'DB insert failed: ' + insertError.message });
        }

        // 2. Post all keywords
        const locInfo = resolveLocationWithCoordinates(location);

        const service = getService();
        const posted = await service.postGBPTasks(
            limitedKeywords.map(keyword => ({ keyword, location: locInfo.locationName, tag: business_name, latitude: locInfo.latitude, longitude: locInfo.longitude }))
        );

        // 3. Update rows with task_ids
        await Promise.all(
            insertedRows.map((row, i) =>
                sb.from('gbp_checks').update({ task_id: posted[i].taskId }).eq('id', row.id)
                    .then(({ error }) => { if (error) console.error(`GBP task_id update error:`, error.message); })
            )
        );

        res.json({
            success: true,
            taskIds: insertedRows.map((row, i) => ({
                supabaseId: row.id,
                taskId: posted[i].taskId,
                keyword: limitedKeywords[i]
            })),
            business_name,
            location,
            totalKeywords: posted.length
        });

    } catch (error) {
        res.status(error.status || 500).json({ success: false, error: error.message });
    }
});

// ─── GET /api/rank/gbp/results/:taskId ────────────────────────────────────────
// ─── GET /api/rank/gbp/results/:taskId ────────────────────────────────────────
// Get GBP ranking from Supabase
router.get('/gbp/results/:taskId', async (req, res) => {
    try {
        const { taskId } = req.params;
        if (!taskId) return res.status(400).json({ success: false, error: 'taskId is required' });

        const sb = getSupabase();
        
        // Query for results stored with this taskId
        const { data: rows, error: queryError } = await sb
            .from('gbp_checks')
            .select('id, rank, cost, status, keyword')
            .eq('task_id', taskId)
            .limit(1);

        if (queryError) {
            return res.status(500).json({ success: false, error: queryError.message });
        }

        if (!rows || rows.length === 0) {
            return res.json({ ready: false });
        }

        const row = rows[0];

        res.json({
            ready: true,
            keyword: row.keyword || '',
            rank: row.rank,
            found: row.rank !== null,
            cost: row.cost || 0,
            status: row.status
        });
    } catch (error) {
        res.status(error.status || 500).json({ success: false, error: error.message });
    }
});

// ─── GET /api/rank/gbp/status ───────────────────────────────────────────────────
// Frontend polls this to check if specific GBP rows are completed.
// Query: ?ids=uuid1,uuid2,uuid3
// Returns: { rows: [{ id, status, task_id, keyword, cost }] }
router.get('/gbp/status', async (req, res) => {
    try {
        const ids = (req.query.ids || '').split(',').map(s => s.trim()).filter(Boolean);
        if (ids.length === 0) return res.json({ success: true, rows: [] });

        const sb = getSupabase();
        const { data, error } = await sb
            .from('gbp_checks')
            .select('id, status, task_id, keyword, cost')
            .in('id', ids);

        if (error) return res.status(500).json({ success: false, error: error.message });
        res.json({ success: true, rows: data || [] });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ─── GET /api/rank/gbp/sync ─────────────────────────────────────────────────────
// Syncs all pending GBP rows: extracts ranking position from DataForSEO
router.get('/gbp/sync', async (req, res) => {
    try {
        const service = getService();
        const sb = getSupabase();

        const { data: pendingRows, error: fetchError } = await sb
            .from('gbp_checks')
            .select('id, task_id, business_name')
            .eq('status', 'pending')
            .not('task_id', 'is', null);

        if (fetchError) return res.status(500).json({ success: false, error: fetchError.message });
        if (!pendingRows || pendingRows.length === 0) return res.json({ success: true, synced: 0, stillPending: 0 });

        let synced = 0;
        let stillPending = 0;

        await Promise.all(pendingRows.map(async (row) => {
            try {
                const taskResult = await service.getGBPTaskResult(row.task_id);
                if (!taskResult.ready) { stillPending++; return; }

                // Find ranking position of the business in the results
                // Search for business_name in the businesses array
                let rankPosition = null;
                if (taskResult.businesses && Array.isArray(taskResult.businesses)) {
                    rankPosition = taskResult.businesses.findIndex(b => 
                        (b.title || b.name || '').toLowerCase().includes(row.business_name.toLowerCase())
                    ) + 1; // +1 because findIndex returns 0-based
                    
                    // If not found or rank is 0, set to null
                    if (rankPosition === 0) rankPosition = null;
                }

                const { error: updateError } = await sb
                    .from('gbp_checks')
                    .update({
                        status: 'completed',
                        rank: rankPosition,
                        cost: taskResult.cost || 0
                    })
                    .eq('id', row.id);

                if (updateError) {
                    console.error(`GBP Sync update error for ${row.id}:`, updateError.message);
                    stillPending++;
                } else {
                    synced++;
                    console.log(`✅ GBP Sync completed: ${row.business_name} - Rank: ${rankPosition || 'Not found'}`);
                }
            } catch (err) {
                console.error(`GBP Sync error for task ${row.task_id}:`, err.message);
                stillPending++;
            }
        }));

        res.json({ success: true, synced, stillPending });
    } catch (error) {
        res.status(error.status || 500).json({ success: false, error: error.message });
    }
});

module.exports = router;
