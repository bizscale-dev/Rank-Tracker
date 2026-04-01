import { useState } from 'react';
import rankAPI from '../services/api';
import LocationSearch from './LocationSearch';

export default function CompetitorAnalysis({ onCostUpdate }) {
    const [keyword, setKeyword] = useState('');
    const [location, setLocation] = useState('');
    const [domainsText, setDomainsText] = useState('');
    const [device, setDevice] = useState('desktop');
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState(null);
    const [error, setError] = useState('');

    const domains = domainsText.split('\n').map(d => d.trim()).filter(Boolean);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!keyword || !location || domains.length === 0) {
            setError('Please fill in keyword, location, and at least one domain.');
            return;
        }
        setLoading(true);
        setError('');
        setResult(null);
        try {
            const data = await rankAPI.competitorAnalysis({
                keyword,
                location,
                domains: domains.slice(0, 5),
                device
            });
            setResult(data);
            if (onCostUpdate && data.cost) {
                onCostUpdate(data.cost);
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const getRankColor = (rank) => {
        if (!rank) return 'rank-notfound';
        if (rank <= 3) return 'rank-top3';
        if (rank <= 10) return 'rank-top10';
        return 'rank-found';
    };

    return (
        <div className="card">
            <h2 className="card-title">⚔️ Competitor Analysis</h2>
            <p className="card-subtitle">Compare up to 5 domains side-by-side for one keyword</p>

            <form onSubmit={handleSubmit} className="form">
                <div className="form-row">
                    <div className="form-group">
                        <label htmlFor="ca-keyword">Keyword</label>
                        <input
                            id="ca-keyword"
                            type="text"
                            placeholder="e.g. ac repair houston"
                            value={keyword}
                            onChange={e => setKeyword(e.target.value)}
                        />
                    </div>
                    <div className="form-group">
                        <label>Location</label>
                        <LocationSearch
                            id="ca-location"
                            value={location}
                            onChange={setLocation}
                            placeholder="Search city or state..."
                        />
                    </div>
                </div>

                <div className="form-group">
                    <label>
                        Domains to Compare <span className="label-count">({Math.min(domains.length, 5)}/5)</span>
                    </label>
                    <textarea
                        rows={4}
                        placeholder={'One domain per line:\nyourdomain.com\ncompetitor1.com\ncompetitor2.com'}
                        value={domainsText}
                        onChange={e => setDomainsText(e.target.value)}
                    />
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

                <button type="submit" className="btn-primary" disabled={loading}>
                    {loading ? <><span className="spinner" /> Analyzing...</> : '⚔️ Compare Rankings'}
                </button>
            </form>

            {result && (
                <div className="result-section">
                    <div className="compete-header">
                        <span>Keyword: <strong>{result.keyword}</strong></span>
                        <span>📍 {result.location}</span>
                        <span className="cost-badge">💰 ${(result.cost || 0).toFixed(4)}</span>
                    </div>

                    <div className="competitor-grid">
                        {result.competitors.map((c, i) => (
                            <div key={i} className={`competitor-card ${getRankColor(c.rank)}-card`}>
                                <div className={`rank-circle ${getRankColor(c.rank)}`}>
                                    {c.rank ? `#${c.rank}` : '—'}
                                </div>
                                <div className="competitor-domain">{c.domain}</div>
                                {c.title && <div className="competitor-title">{c.title}</div>}
                                {c.url && (
                                    <a href={c.url} target="_blank" rel="noreferrer" className="competitor-url">
                                        View page ↗
                                    </a>
                                )}
                                {!c.found && <div className="not-ranked">Not in top 100</div>}
                            </div>
                        ))}
                    </div>

                    {result.topResults && result.topResults.length > 0 && (
                        <div className="top-results">
                            <h3>Top 20 SERP Results</h3>
                            <div className="results-list">
                                {result.topResults.map((r, i) => {
                                    const isCovered = result.competitors.some(c =>
                                        c.found && (r.domain?.includes(c.domain.replace(/^www\./, '')) || c.domain.replace(/^www\./, '').includes(r.domain))
                                    );
                                    return (
                                        <div key={i} className={`result-item ${isCovered ? 'result-item-highlight' : ''}`}>
                                            <span className="result-pos">#{r.position}</span>
                                            <div className="result-info">
                                                <div className="result-title">{r.title}</div>
                                                <a href={r.url} target="_blank" rel="noreferrer" className="result-url">{r.url}</a>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
