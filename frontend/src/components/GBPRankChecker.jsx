import { useState, useRef, useEffect } from 'react';
import rankAPI from '../services/api';
import LocationSearch from './LocationSearch';

const POLL_INTERVAL = 8000;
const POLL_TIMEOUT = 900000;

export default function GBPRankChecker({ onCostUpdate }) {
    const [form, setForm] = useState({ keyword: '', business_name: '' });
    const [location, setLocation] = useState('');
    const [loading, setLoading] = useState(false);
    const [polling, setPolling] = useState(false);
    const [result, setResult] = useState(null);
    const [error, setError] = useState('');
    const [elapsed, setElapsed] = useState(0);

    const timerRef = useRef(null);
    const supabaseIdRef = useRef(null);
    const taskIdRef = useRef(null);
    const startTimeRef = useRef(null);

    useEffect(() => () => clearInterval(timerRef.current), []);

    function stopPolling() {
        clearInterval(timerRef.current);
        timerRef.current = null;
    }

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!form.keyword || !location || !form.business_name) {
            setError('Please fill in all fields.');
            return;
        }

        stopPolling();
        setLoading(true);
        setPolling(false);
        setError('');
        setResult(null);
        setElapsed(0);
        startTimeRef.current = Date.now();

        try {
            const posted = await rankAPI.checkGBPRank({ ...form, location });
            if (!posted.success || !posted.supabaseId) {
                throw new Error(posted.error || 'No Supabase ID returned');
            }

            supabaseIdRef.current = posted.supabaseId;
            taskIdRef.current = posted.taskId;
            setLoading(false);
            setPolling(true);

            const deadline = Date.now() + POLL_TIMEOUT;

            timerRef.current = setInterval(async () => {
                setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));

                if (Date.now() > deadline) {
                    stopPolling();
                    setPolling(false);
                    setError('Timed out after 15 minutes. Please try again.');
                    return;
                }
                try {
                    await rankAPI.syncGBPPending();
                    const { rows } = await rankAPI.checkGBPStatus([supabaseIdRef.current]);
                    const row = rows?.find(r => r.id === supabaseIdRef.current);

                    if (row?.status === 'completed') {
                        stopPolling();
                        setPolling(false);
                        
                        try {
                            const gbpResult = await rankAPI.getGBPResults(taskIdRef.current);
                            
                            const resultData = {
                                keyword: row.keyword || form.keyword,
                                business_name: form.business_name,
                                location,
                                cost: row.cost || 0,
                                rank: gbpResult.rank,
                                found: gbpResult.found
                            };
                            
                            setResult(resultData);
                            if (onCostUpdate && row.cost) {
                                onCostUpdate(row.cost);
                            }
                        } catch (resultErr) {
                            console.error('Error fetching GBP results:', resultErr);
                            setError('Failed to fetch results: ' + resultErr.message);
                        }
                    }
                } catch (err) {
                    console.warn('Poll error:', err.message);
                }
            }, POLL_INTERVAL);

        } catch (err) {
            setError(err.message);
            setLoading(false);
            setPolling(false);
        }
    };

    const isRunning = loading || polling;

    return (
        <div className="card">
            <h2 className="card-title">📍 GBP Ranking Check</h2>
            <p className="card-subtitle">Check your business ranking on Google Business Profile</p>

            <form onSubmit={handleSubmit} className="form">
                <div className="form-row">
                    <div className="form-group">
                        <label htmlFor="gbp-keyword">Keyword</label>
                        <input
                            id="gbp-keyword"
                            type="text"
                            placeholder="e.g. junk removal Raleigh"
                            value={form.keyword}
                            onChange={e => setForm(f => ({ ...f, keyword: e.target.value }))}
                        />
                    </div>
                    <div className="form-group">
                        <label>Location</label>
                        <LocationSearch
                            id="gbp-location"
                            value={location}
                            onChange={setLocation}
                            placeholder="Search city or state..."
                        />
                    </div>
                </div>

                <div className="form-row">
                    <div className="form-group">
                        <label htmlFor="gbp-business">Business Name</label>
                        <input
                            id="gbp-business"
                            type="text"
                            placeholder="e.g. Your Business Name"
                            value={form.business_name}
                            onChange={e => setForm(f => ({ ...f, business_name: e.target.value }))}
                        />
                    </div>
                </div>

                {error && <div className="alert alert-error">{error}</div>}

                {polling && (
                    <div className="progress-bar-wrap">
                        <div className="progress-bar-track">
                            <div className="progress-bar-fill" />
                        </div>
                        <p className="progress-label">
                            ⏳ Checking ranking… {elapsed}s elapsed
                        </p>
                    </div>
                )}

                <button type="submit" className="btn-primary" disabled={isRunning}>
                    {loading ? <><span className="spinner" /> Submitting…</>
                        : polling ? <><span className="spinner" /> Checking…</>
                            : '🔍 Check Ranking'}
                </button>
            </form>

            {result && (
                <div className="result-section">
                    <div className={`rank-badge ${result.found ? 'rank-found' : 'rank-notfound'}`}>
                        {result.found ? (
                            <>
                                <div className="rank-number">#{result.rank}</div>
                                <div className="rank-label">Position</div>
                            </>
                        ) : (
                            <>
                                <div className="rank-number">—</div>
                                <div className="rank-label">Not Found</div>
                            </>
                        )}
                    </div>
                    <div className="result-meta">
                        <div><strong>Keyword:</strong> {result.keyword}</div>
                        <div><strong>Business:</strong> {result.business_name}</div>
                        <div><strong>Location:</strong> {result.location}</div>
                        {result.cost > 0 && <div><strong>Cost:</strong> ${result.cost.toFixed(4)}</div>}
                    </div>
                </div>
            )}
        </div>
    );
}
