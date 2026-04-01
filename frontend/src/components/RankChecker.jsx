import { useState, useRef, useEffect } from 'react';
import rankAPI from '../services/api';
import LocationSearch from './LocationSearch';

const POLL_INTERVAL = 8000;   // 8 s between sync+status checks
const POLL_TIMEOUT = 900000; // 15 min — high-priority tasks: 1-3 min, normal: up to 10 min

export default function RankChecker({ onCostUpdate }) {
    const [form, setForm] = useState({ keyword: '', domain: '', device: 'desktop' });
    const [location, setLocation] = useState('');
    const [loading, setLoading] = useState(false);
    const [polling, setPolling] = useState(false);
    const [result, setResult] = useState(null);
    const [error, setError] = useState('');
    const [elapsed, setElapsed] = useState(0); // seconds elapsed since submit

    const timerRef = useRef(null);
    const supabaseIdRef = useRef(null);
    const startTimeRef = useRef(null);

    useEffect(() => () => clearInterval(timerRef.current), []);

    function stopPolling() {
        clearInterval(timerRef.current);
        timerRef.current = null;
    }

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!form.keyword || !location || !form.domain) {
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
            const posted = await rankAPI.checkRank({ ...form, location });
            if (!posted.success || !posted.supabaseId) {
                throw new Error(posted.error || 'No Supabase ID returned');
            }

            supabaseIdRef.current = posted.supabaseId;
            setLoading(false);
            setPolling(true);

            const deadline = Date.now() + POLL_TIMEOUT;

            timerRef.current = setInterval(async () => {
                setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));

                if (Date.now() > deadline) {
                    stopPolling();
                    setPolling(false);
                    setError('Timed out after 15 minutes. DataForSEO may be overloaded — please try again.');
                    return;
                }
                try {
                    // Trigger the backend sync, then check our specific row
                    await rankAPI.syncPending();
                    const { rows } = await rankAPI.checkStatus([supabaseIdRef.current]);
                    const row = rows?.find(r => r.id === supabaseIdRef.current);

                    if (row?.status === 'completed') {
                        stopPolling();
                        setPolling(false);
                        const resultData = {
                            keyword: row.keyword || form.keyword,
                            domain: form.domain,
                            location,
                            device: form.device,
                            found: row.rank !== null,
                            rank: row.rank,
                            url: row.url,
                            cost: row.cost || 0
                        };
                        setResult(resultData);
                        if (onCostUpdate && row.cost) {
                            onCostUpdate(row.cost);
                        }
                    }
                } catch (err) {
                    // silent — retry next tick
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
            <h2 className="card-title">🔍 Single Rank Check</h2>
            <p className="card-subtitle">Check where your domain ranks for a specific keyword</p>

            <form onSubmit={handleSubmit} className="form">
                <div className="form-row">
                    <div className="form-group">
                        <label htmlFor="rc-keyword">Keyword</label>
                        <input
                            id="rc-keyword"
                            type="text"
                            placeholder="e.g. ac repair houston"
                            value={form.keyword}
                            onChange={e => setForm(f => ({ ...f, keyword: e.target.value }))}
                        />
                    </div>
                    <div className="form-group">
                        <label>Location</label>
                        <LocationSearch
                            id="rc-location"
                            value={location}
                            onChange={setLocation}
                            placeholder="Search city or state..."
                        />
                    </div>
                </div>

                <div className="form-row">
                    <div className="form-group">
                        <label htmlFor="rc-domain">Your Domain</label>
                        <input
                            id="rc-domain"
                            type="text"
                            placeholder="e.g. yourdomain.com"
                            value={form.domain}
                            onChange={e => setForm(f => ({ ...f, domain: e.target.value }))}
                        />
                    </div>
                    <div className="form-group">
                        <label>Device</label>
                        <div className="toggle-group">
                            {['desktop', 'mobile'].map(d => (
                                <button
                                    key={d}
                                    type="button"
                                    className={`toggle-btn ${form.device === d ? 'active' : ''}`}
                                    onClick={() => setForm(f => ({ ...f, device: d }))}
                                >
                                    {d === 'desktop' ? '🖥️ Desktop' : '📱 Mobile'}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {error && <div className="alert alert-error">{error}</div>}

                {polling && (
                    <div className="progress-bar-wrap">
                        <div className="progress-bar-track">
                            <div className="progress-bar-fill" />
                        </div>
                        <p className="progress-label">
                            ⏳ Fetching Google results… {elapsed}s elapsed
                            {elapsed > 60 && ' (high-priority tasks typically take 1–3 min)'}
                        </p>
                    </div>
                )}

                <button type="submit" className="btn-primary" disabled={isRunning}>
                    {loading ? <><span className="spinner" /> Submitting…</>
                        : polling ? <><span className="spinner" /> Checking…</>
                            : '🎯 Check Ranking'}
                </button>
            </form>

            {result && (
                <div className="result-section">
                    <div className={`rank-badge ${result.found ? (result.rank <= 3 ? 'rank-top3' : result.rank <= 10 ? 'rank-top10' : 'rank-found') : 'rank-notfound'}`}>
                        {result.found ? (
                            <>
                                <div className="rank-number">#{result.rank}</div>
                                <div className="rank-label">Position</div>
                            </>
                        ) : (
                            <>
                                <div className="rank-number">—</div>
                                <div className="rank-label">Not in top 100</div>
                            </>
                        )}
                    </div>
                    <div className="result-meta">
                        <div><strong>Keyword:</strong> {result.keyword}</div>
                        <div><strong>Domain:</strong> {result.domain}</div>
                        <div><strong>Location:</strong> {result.location}</div>
                        <div><strong>Device:</strong> {result.device}</div>
                        {result.cost > 0 && <div><strong>Cost:</strong> ${result.cost.toFixed(4)}</div>}
                        {result.url && <div><strong>Ranking URL:</strong> <a href={result.url} target="_blank" rel="noreferrer">{result.url}</a></div>}
                    </div>
                </div>
            )}
        </div>
    );
}
