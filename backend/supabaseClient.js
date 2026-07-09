const { createClient } = require('@supabase/supabase-js');

let _client = null;

/**
 * Returns the Supabase client, creating it lazily on first call.
 * This ensures dotenv has already populated process.env before we read the vars.
 * Uses SERVICE_ROLE_SECRET for backend operations (full permissions).
 */
function getSupabase() {
    if (_client) return _client;

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SERVICE_ROLE_SECRET || process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
        throw new Error('Supabase credentials not configured. Add SUPABASE_URL and SERVICE_ROLE_SECRET to .env');
    }

    _client = createClient(supabaseUrl, supabaseKey);
    return _client;
}

module.exports = getSupabase;
