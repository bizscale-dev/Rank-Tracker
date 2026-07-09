import axios from 'axios';
import { supabase } from '../supabaseClient';

const API_BASE = import.meta.env.VITE_API_URL || (import.meta.env.MODE === 'production' ? '/api' : 'http://localhost:5000/api');

const client = axios.create({
    baseURL: API_BASE,
    timeout: 300000, // 5 min — batch checks with 20 kws can take ~2-3 min
    headers: { 'Content-Type': 'application/json' }
});

// Request interceptor to attach JWT
client.interceptors.request.use(async (config) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
        config.headers.Authorization = `Bearer ${session.access_token}`;
    }
    return config;
});

// Global error interceptor
client.interceptors.response.use(
    res => res,
    err => {
        const message = err.response?.data?.error || err.message || 'Request failed';
        return Promise.reject(new Error(message));
    }
);

const rankAPI = {
    // Test DataForSEO connection
    testConnection: () => client.get('/rank/test').then(r => r.data),

    // Get account balance
    getAccountInfo: () => client.get('/rank/account').then(r => r.data),

    // Health check
    healthCheck: () => client.get('/health').then(r => r.data),

    // Get all locations
    getLocations: () => client.get('/rank/locations').then(r => r.data),

    // Search locations by query
    searchLocations: (query) =>
        client.get('/rank/locations/search', { params: { q: query } }).then(r => r.data),

    // Single rank check — returns { taskId, keyword, domain, location, device }
    checkRank: (payload) => client.post('/rank/check', payload).then(r => r.data),

    // Batch rank check — returns { taskIds: [{ taskId, keyword }], domain, ... }
    batchCheck: (payload) => client.post('/rank/batch', payload).then(r => r.data),

    // Poll a single Standard API task result (kept for backward compat)
    getTaskResult: (taskId, domain) =>
        client.get(`/rank/results/${taskId}`, { params: { domain } }).then(r => r.data),

    // Trigger the background sync — resolves all pending Supabase rows
    syncPending: () => client.get('/rank/sync').then(r => r.data),

    // Check completion status of specific Supabase rows by their IDs
    checkStatus: (ids) =>
        client.get('/rank/status', { params: { ids: ids.join(',') } }).then(r => r.data),

    // Competitor analysis (uses Live API)
    competitorAnalysis: (payload) => client.post('/rank/competitors', payload).then(r => r.data),

    // GBP (Local Finder) single check
    checkGBPRank: (payload) => client.post('/rank/gbp/check', payload).then(r => r.data),

    // GBP batch check
    batchGBPCheck: (payload) => client.post('/rank/gbp/batch', payload).then(r => r.data),

    // Get GBP results
    getGBPResults: (taskId) => client.get(`/rank/gbp/results/${taskId}`).then(r => r.data),

    // Check GBP status
    checkGBPStatus: (ids) =>
        client.get('/rank/gbp/status', { params: { ids: ids.join(',') } }).then(r => r.data),

    // Sync GBP pending checks
    syncGBPPending: () => client.get('/rank/gbp/sync').then(r => r.data),
};

export default rankAPI;
