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

// ─── Helper: resolve location ─────────────────────────────────────────────────
function resolveLocation(location) {
    return typeof location === 'number'
        ? location
        : (getLocationCode(location) || location);
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
        const resolvedLocation = resolveLocation(location);
        const service = getService();
        const posted = await service.postTasks([{ keyword, location: resolvedLocation, device, tag: domain }]);
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
        const resolvedLocation = resolveLocation(location);
        const service = getService();
        const posted = await service.postTasks(
            limitedKeywords.map(keyword => ({ keyword, location: resolvedLocation, device, tag: domain }))
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
        const resolvedLocation = resolveLocation(location);
        const service = getService();
        const serpData = await service.getSearchResults(keyword, resolvedLocation, device);
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

module.exports = router;
