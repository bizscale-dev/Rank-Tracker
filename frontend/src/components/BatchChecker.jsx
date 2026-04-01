import { useState, useRef, useEffect } from 'react';
import rankAPI from '../services/api';
import LocationSearch from './LocationSearch';

const POLL_INTERVAL = 8000;   // 8 s
const POLL_TIMEOUT = 900000; // 15 min — high-priority tasks: 1-3 min, normal: up to 10 min

export default function BatchChecker({ onCostUpdate }) {
    const [keywordsText, setKeywordsText] = useState('');
    const [domain, setDomain] = useState('');
    const [location, setLocation] = useState('');
    const [device, setDevice] = useState('desktop');
    const [loading, setLoading] = useState(false);
    const [results, setResults] = useState([]);
    const [pending, setPending] = useState(0);
    const [total, setTotal] = useState(0);
    const [error, setError] = useState('');

    const timerRef = useRef(null);
    const pendingIdsRef = useRef([]); // supabaseIds not yet completed
    const startTimeRef = useRef(null);
    const [elapsed, setElapsed] = useState(0);

    const keywords = keywordsText.split('\n').map(k => k.trim()).filter(Boolean);

    useEffect(() => () => clearInterval(timerRef.current), []);

    function stopPolling() {
        clearInterval(timerRef.current);
        timerRef.current = null;
    }

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (keywords.length === 0 || !location || !domain) {
            setError('Please enter keywords, location, and domain.');
            return;
        }

        stopPolling();
        setLoading(true);
        setError('');
        setResults([]);
        setElapsed(0);
        startTimeRef.current = Date.now();
        pendingIdsRef.current = [];

        const kws = keywords.slice(0, 20);
        setTotal(kws.length);
        setPending(kws.length);

        try {
            const data = await rankAPI.batchCheck({ keywords: kws, location, domain, device });
            if (!data.success || !data.taskIds?.length) {
                throw new Error(data.error || 'No task IDs returned');
            }

            setLoading(false);

            // Build id → index map to update results in-place (preserving input order)
            const idToIndex = {};
            const idToKeyword = {};
            data.taskIds.forEach((t, i) => {
                idToIndex[t.supabaseId] = i;
                idToKeyword[t.supabaseId] = t.keyword;
            });
            pendingIdsRef.current = data.taskIds.map(t => t.supabaseId);

            // Pre-seed results in input order, all marked pending
            setResults(data.taskIds.map(t => ({
                _id: t.supabaseId,
                keyword: t.keyword,
                found: null,
                rank: null,
                url: null,
                error: null,
                pending: true
            })));

            const deadline = Date.now() + POLL_TIMEOUT;

            timerRef.current = setInterval(async () => {
                if (pendingIdsRef.current.length === 0) { stopPolling(); return; }
                setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));

                if (Date.now() > deadline) {
                    // Timeout: mark all still-pending slots as error in-place
                    const timedOut = new Set(pendingIdsRef.current);
                    pendingIdsRef.current = [];
                    stopPolling();
                    setResults(prev => prev.map(r =>
                        timedOut.has(r._id)
                            ? { ...r, pending: false, error: 'Timed out — DataForSEO may be overloaded' }
                            : r
                    ));
                    setPending(0);
                    return;
                }

                try {
                    await rankAPI.syncPending();
                    const { rows } = await rankAPI.checkStatus(pendingIdsRef.current);
                    if (!rows) return;

                    const completed = rows.filter(r => r.status === 'completed');
                    if (completed.length === 0) return;

                    const completedIds = new Set(completed.map(r => r.id));
                    pendingIdsRef.current = pendingIdsRef.current.filter(id => !completedIds.has(id));

                    // Calculate total cost
                    const totalCost = completed.reduce((sum, r) => sum + (r.cost || 0), 0);
                    if (onCostUpdate && totalCost > 0) {
                        onCostUpdate(totalCost);
                    }

                    // Update completed slots in-place (preserves input order)
                    const completedMap = {};
                    completed.forEach(r => { completedMap[r.id] = r; });

                    setResults(prev => prev.map(slot => {
                        const done = completedMap[slot._id];
                        if (!done) return slot;
                        return {
                            ...slot,
                            pending: false,
                            found: done.rank !== null,
                            rank: done.rank,
                            url: done.url || null,
                            cost: done.cost || 0,
                            error: null
                        };
                    }));

                    setPending(pendingIdsRef.current.length);
                    if (pendingIdsRef.current.length === 0) stopPolling();
                } catch (err) {
                    console.warn('Batch poll error:', err.message);
                }
            }, POLL_INTERVAL);

        } catch (err) {
            setError(err.message);
            setLoading(false);
            setPending(0);
        }
    };

    const exportCSV = () => {
        if (!results.length) return;
        const rows = [
            ['Keyword', 'Rank', 'Found', 'URL', 'Error'],
            ...results.map(r => [r.keyword, r.rank ?? 'N/A', r.found, r.url || '', r.error || ''])
        ];
        const csv = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const safeDomain = (domain || 'ranks').replace(/[^a-z0-9.-]/gi, '_');
        a.download = `${safeDomain}-ranks.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const isRunning = loading || (total > 0 && pending > 0);
    const doneCount = total - pending;

    return (
        <div className="card">
            <h2 className="card-title">📦 Batch Rank Check</h2>
            <p className="card-subtitle">Check up to 20 keywords at once with parallel processing</p>

            <form onSubmit={handleSubmit} className="form">
                <div className="form-group">
                    <label>
                        Keywords <span className="label-count">
                            ({Math.min(keywords.length, 20)}/20)
                            {keywords.length > 20 && <span className="label-warn"> — only first 20 will be checked</span>}
                        </span>
                    </label>
                    <textarea
                        rows={6}
                        placeholder={'One keyword per line:\nac repair houston\nplumber near me\nhvac service dallas'}
                        value={keywordsText}
                        onChange={e => setKeywordsText(e.target.value)}
                    />
                </div>

                <div className="form-row">
                    <div className="form-group">
                        <label>Location</label>
                        <LocationSearch id="bc-location" value={location} onChange={setLocation} placeholder="Search city or state..." />
                    </div>
                    <div className="form-group">
                        <label htmlFor="bc-domain">Your Domain</label>
                        <input
                            id="bc-domain"
                            type="text"
                            placeholder="e.g. yourdomain.com"
                            value={domain}
                            onChange={e => setDomain(e.target.value)}
                        />
                    </div>
                </div>

                <div className="form-group">
                    <label>Device</label>
                    <div className="toggle-group">
                        {['desktop', 'mobile'].map(d => (
                            <button key={d} type="button"
                                className={`toggle-btn ${device === d ? 'active' : ''}`}
                                onClick={() => setDevice(d)}>
                                {d === 'desktop' ? '🖥️ Desktop' : '📱 Mobile'}
                            </button>
                        ))}
                    </div>
                </div>

                {error && <div className="alert alert-error">{error}</div>}

                {isRunning && (
                    <div className="progress-bar-wrap">
                        <div className="progress-bar-track">
                            <div
                                className="progress-bar-fill"
                                style={{ width: total > 0 ? `${(doneCount / total) * 100}%` : '0%' }}
                            />
                        </div>
                        <p className="progress-label">
                            {loading && doneCount === 0
                                ? `Submitting ${Math.min(keywords.length, 20)} keywords…`
                                : `Results ready: ${doneCount} / ${total} — ⏳ ${elapsed}s elapsed${elapsed > 60 ? ' (1–3 min typical)' : ''}`}
                        </p>
                    </div>
                )}

                <button type="submit" className="btn-primary" disabled={isRunning}>
                    {isRunning ? <><span className="spinner" /> Processing...</> : '🚀 Check All Keywords'}
                </button>
            </form>

            {results.length > 0 && (
                <div className="result-section">
                    <div className="batch-summary">
                        <div className="summary-card found">
                            <div className="summary-num">{results.filter(r => r.found).length}</div>
                            <div>Found</div>
                        </div>
                        <div className="summary-card not-found">
                            <div className="summary-num">{results.filter(r => !r.pending && !r.found && !r.error).length}</div>
                            <div>Not Found</div>
                        </div>
                        <div className="summary-card error-card">
                            <div className="summary-num">{results.filter(r => r.error).length}</div>
                            <div>Errors</div>
                        </div>
                        {pending > 0 && (
                            <div className="summary-card" style={{ opacity: 0.6 }}>
                                <div className="summary-num">{pending}</div>
                                <div>Pending</div>
                            </div>
                        )}
                    </div>

                    <div className="batch-controls">
                        <button className="btn-secondary" onClick={exportCSV}>📥 Export CSV</button>
                    </div>

                    <div className="batch-table-wrap">
                        <table className="batch-table">
                            <thead>
                                <tr><th>#</th><th>Keyword</th><th>Rank</th><th>URL</th></tr>
                            </thead>
                            <tbody>
                                {results.map((r, i) => (
                                    <tr key={r._id || i} className={r.pending ? 'row-pending' : r.error ? 'row-error' : r.found ? 'row-found' : 'row-notfound'}>
                                        <td>{i + 1}</td>
                                        <td>{r.keyword}</td>
                                        <td>
                                            {r.pending
                                                ? <span className="badge badge-pending"><span className="spinner-xs" /> Checking…</span>
                                                : r.error ? <span className="badge badge-error">Error</span>
                                                    : r.found ? <span className={`badge ${r.rank <= 3 ? 'badge-top3' : r.rank <= 10 ? 'badge-top10' : 'badge-found'}`}>#{r.rank}</span>
                                                        : <span className="badge badge-notfound">—</span>}
                                        </td>
                                        <td className="url-cell">
                                            {r.pending ? ''
                                                : r.url ? <a href={r.url} target="_blank" rel="noreferrer">{r.url}</a>
                                                    : r.error || '—'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}
