import { useState, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { supabase } from './supabaseClient';
import './App.css';
import RankChecker from './components/RankChecker';
import BatchChecker from './components/BatchChecker';
import CompetitorAnalysis from './components/CompetitorAnalysis';
import Login from './components/Login';
import rankAPI from './services/api';

const TABS = [
    { id: 'single', label: '🎯 Single Check' },
    { id: 'batch', label: '📦 Batch Check' },
    { id: 'competitors', label: '⚔️ Competitors' },
];

function Dashboard({ session }) {
    const [activeTab, setActiveTab] = useState('single');
    const [isConnected, setIsConnected] = useState(null); // null = checking
    const [balance, setBalance] = useState(null);
    const [lastCost, setLastCost] = useState(null);

    const fetchBalance = async () => {
        try {
            const res = await rankAPI.getAccountInfo();
            if (res.success && res.account?.money) {
                setBalance(res.account.money.balance);
            }
        } catch (error) {
            console.error('Failed to fetch balance:', error);
        }
    };

    useEffect(() => {
        rankAPI.testConnection()
            .then(res => {
                setIsConnected(res.success);
                if (res.account?.balance != null) setBalance(res.account.balance);
            })
            .catch(() => setIsConnected(false));
        
        // Fetch full account info
        fetchBalance();
    }, []);

    const handleLogout = async () => {
        await supabase.auth.signOut();
    };

    return (
        <div className="app-bg">
            <div className="container">
                {/* Header */}
                <header className="header">
                    <img
                        src="/Bizscale Rank Tracker.png"
                        alt="BizScale Rank Tracker"
                        className="header-logo"
                    />
                    <p className="header-sub">Track your Google rankings by location with precision</p>

                    <div className="header-badges">
                        {isConnected === null && <span className="status-badge">⏳ Connecting...</span>}
                        {isConnected === true && <span className="status-badge connected">✅ Connected</span>}
                        {isConnected === false && <span className="status-badge">⚠️ No Credentials</span>}
                        {balance !== null && (
                            <span className="status-badge balance">
                                💰 Balance: ${balance.toFixed(2)}
                            </span>
                        )}
                        {lastCost !== null && (
                            <span className="status-badge cost">
                                📊 Last Check: ${lastCost.toFixed(4)}
                            </span>
                        )}
                        <button onClick={handleLogout} className="btn-secondary" style={{ padding: '4px 12px', fontSize: '0.82rem', borderRadius: '999px' }}>
                            Logout
                        </button>
                    </div>
                </header>

                {/* Tabs */}
                <div className="tabs" role="tablist">
                    {TABS.map(tab => (
                        <button
                            key={tab.id}
                            role="tab"
                            aria-selected={activeTab === tab.id}
                            className={`tab ${activeTab === tab.id ? 'active' : ''}`}
                            onClick={() => setActiveTab(tab.id)}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>

                {/* Tab Content */}
                {activeTab === 'single' && <RankChecker onCostUpdate={(cost) => { setLastCost(cost); fetchBalance(); }} />}
                {activeTab === 'batch' && <BatchChecker onCostUpdate={(cost) => { setLastCost(cost); fetchBalance(); }} />}
                {activeTab === 'competitors' && <CompetitorAnalysis onCostUpdate={(cost) => { setLastCost(cost); fetchBalance(); }} />}


                <footer className="footer">
                    <p>Powered by BizScale</p>
                </footer>
            </div>
        </div>
    );
}

function App() {
    const [session, setSession] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        supabase.auth.getSession().then(({ data: { session } }) => {
            setSession(session);
            setLoading(false);
        });

        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange((_event, session) => {
            setSession(session);
        });

        return () => subscription.unsubscribe();
    }, []);

    if (loading) {
        return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', color: 'white' }}>Loading...</div>;
    }

    return (
        <Routes>
            <Route path="/login" element={!session ? <Login /> : <Navigate to="/" />} />
            <Route path="/" element={session ? <Dashboard session={session} /> : <Navigate to="/login" />} />
        </Routes>
    );
}

export default App;
