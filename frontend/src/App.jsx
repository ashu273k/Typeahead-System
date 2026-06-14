import { useState, useEffect, useRef } from 'react';
import './App.css';

const BACKEND_URL = 'http://localhost:3001';

function App() {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1);
  const [trending, setTrending] = useState([]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [isLoadingTrending, setIsLoadingTrending] = useState(false);
  const [isBackendDown, setIsBackendDown] = useState(false);
  const [searchConfirmation, setSearchConfirmation] = useState(null);
  const [metrics, setMetrics] = useState({
    cacheHits: 0,
    cacheMisses: 0,
    dbReads: 0,
    dbWrites: 0,
    p95LatencyMs: 0
  });

  const searchWrapperRef = useRef(null);
  const toastTimeoutRef = useRef(null);

  // Fetch trending searches
  const fetchTrending = async () => {
    setIsLoadingTrending(true);
    try {
      const response = await fetch(`${BACKEND_URL}/trending`);
      if (!response.ok) throw new Error('Failed to fetch trending');
      const data = await response.json();
      setTrending(data);
      setIsBackendDown(false);
    } catch (err) {
      console.error('Error fetching trending:', err);
      setIsBackendDown(true);
    } finally {
      setIsLoadingTrending(false);
    }
  };

  // Fetch performance metrics
  const fetchMetrics = async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/metrics`);
      if (!response.ok) throw new Error('Failed to fetch metrics');
      const data = await response.json();
      setMetrics(data);
    } catch (err) {
      console.error('Error fetching metrics:', err);
    }
  };

  useEffect(() => {
    fetchTrending();
  }, []);

  // Poll metrics every 1.5 seconds
  useEffect(() => {
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 1500);
    return () => clearInterval(interval);
  }, []);

  // Handle clicking outside to close suggestions dropdown
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (searchWrapperRef.current && !searchWrapperRef.current.contains(event.target)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Debouncing effect for suggest search
  useEffect(() => {
    if (!query.trim()) {
      setSuggestions([]);
      setShowDropdown(false);
      setIsLoadingSuggestions(false);
      return;
    }

    setIsLoadingSuggestions(true);
    const delayDebounceFn = setTimeout(async () => {
      try {
        const response = await fetch(`${BACKEND_URL}/suggest?q=${encodeURIComponent(query)}`);
        if (!response.ok) throw new Error('Failed to fetch suggestions');
        const data = await response.json();
        setSuggestions(data);
        setShowDropdown(true);
        setActiveSuggestionIndex(-1);
        setIsBackendDown(false);
      } catch (err) {
        console.error('Error fetching suggestions:', err);
        setIsBackendDown(true);
      } finally {
        setIsLoadingSuggestions(false);
      }
    }, 300); // 300ms debounce

    return () => clearTimeout(delayDebounceFn);
  }, [query]);

  // Submit search query
  const performSearch = async (searchTerm) => {
    const finalSearchTerm = searchTerm || query;
    if (!finalSearchTerm.trim()) return;

    const normalized = finalSearchTerm.trim().toLowerCase();

    try {
      const response = await fetch(`${BACKEND_URL}/search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: normalized }),
      });

      if (!response.ok) throw new Error('Search failed');

      const data = await response.json();
      
      // Show confirmation toast
      setSearchConfirmation(data);
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
      toastTimeoutRef.current = setTimeout(() => {
        setSearchConfirmation(null);
      }, 3000);

      // Reset dropdown states
      setShowDropdown(false);
      setActiveSuggestionIndex(-1);
      
      // Update query text to match search item
      setQuery(finalSearchTerm);
      
      // Immediately refresh metrics after a search write
      fetchMetrics();

    } catch (err) {
      console.error('Search error:', err);
      setIsBackendDown(true);
    }
  };

  // Keyboard navigation handler
  const handleKeyDown = (e) => {
    if (!showDropdown || suggestions.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveSuggestionIndex((prevIndex) => 
        prevIndex < suggestions.length - 1 ? prevIndex + 1 : 0
      );
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveSuggestionIndex((prevIndex) => 
        prevIndex > 0 ? prevIndex - 1 : suggestions.length - 1
      );
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeSuggestionIndex >= 0 && activeSuggestionIndex < suggestions.length) {
        performSearch(suggestions[activeSuggestionIndex]);
      } else {
        performSearch();
      }
    } else if (e.key === 'Escape') {
      setShowDropdown(false);
      setActiveSuggestionIndex(-1);
    }
  };

  return (
    <main className="app-container">
      {/* Toast Notification */}
      {searchConfirmation && (
        <div className="toast">
          <span>✔️</span>
          <span>{JSON.stringify(searchConfirmation)}</span>
        </div>
      )}

      {/* Header */}
      <header className="header">
        <h1 className="title">Typeahead</h1>
        <p className="subtitle">Real-time prefix autocomplete with consistent hash caching & trending search velocity</p>
      </header>

      {/* Error state */}
      {isBackendDown ? (
        <div className="error-banner">
          <div className="error-title">Connection Lost</div>
          <div className="error-msg">Could not connect to the backend server. Please make sure Docker services are running.</div>
          <button className="retry-btn" onClick={() => { fetchTrending(); if (query) setQuery(query + ' '); }}>Retry Connection</button>
        </div>
      ) : (
        /* Search Bar & Dropdown */
        <div className="search-wrapper" ref={searchWrapperRef}>
          <div className="search-box">
            <div className="input-container">
              <input
                type="text"
                className="search-input"
                placeholder="Type to search (e.g., iphone, ipad, java)..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                onFocus={() => query.trim() && setShowDropdown(true)}
              />
              <span className="search-icon">
                {isLoadingSuggestions ? <span className="spinner"></span> : '🔍'}
              </span>
            </div>
            <button className="search-btn" onClick={() => performSearch()}>
              Search
            </button>
          </div>

          {/* Suggestions Dropdown */}
          {showDropdown && (
            <ul className="dropdown">
              {isLoadingSuggestions && suggestions.length === 0 && (
                <li className="dropdown-loading">Fetching suggestions...</li>
              )}
              {!isLoadingSuggestions && suggestions.length === 0 && (
                <li className="dropdown-no-match">No matches found</li>
              )}
              {suggestions.map((item, index) => (
                <li
                  key={index}
                  className={`dropdown-item ${index === activeSuggestionIndex ? 'active' : ''}`}
                  onClick={() => performSearch(item)}
                >
                  {item}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Trending searches */}
      <section className="trending-container">
        <div className="trending-header">Trending Searches</div>
        
        {isLoadingTrending ? (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.9rem', padding: '10px' }}>
            <span className="spinner"></span> Loading trends...
          </div>
        ) : trending.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.9rem', padding: '10px' }}>
            No trending data available
          </div>
        ) : (
          <ul className="trending-list">
            {trending.map((item, index) => (
              <li
                key={index}
                className="trending-item"
                onClick={() => performSearch(item.query)}
              >
                <span className="trending-rank">#{index + 1}</span>
                <span className="trending-term">{item.query}</span>
                <span className="trending-score">{Math.round(item.score).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Metrics Dashboard */}
      {!isBackendDown && (
        <section className="metrics-container">
          <div className="metrics-header">System Metrics</div>
          <div className="metrics-grid">
            <div className="metrics-card">
              <span className="metrics-value">
                {(() => {
                  const total = metrics.cacheHits + metrics.cacheMisses;
                  if (total === 0) return '0%';
                  return `${Math.round((metrics.cacheHits / total) * 100)}%`;
                })()}
              </span>
              <span className="metrics-label">Cache Hit Rate</span>
            </div>
            <div className="metrics-card">
              <span className="metrics-value">{metrics.cacheHits} / {metrics.cacheHits + metrics.cacheMisses}</span>
              <span className="metrics-label">Hits / Misses</span>
            </div>
            <div className="metrics-card">
              <span className="metrics-value">{metrics.p95LatencyMs} ms</span>
              <span className="metrics-label">p95 Latency</span>
            </div>
            <div className="metrics-card">
              <span className="metrics-value">{metrics.dbReads}</span>
              <span className="metrics-label">DB Reads</span>
            </div>
            <div className="metrics-card">
              <span className="metrics-value">{metrics.dbWrites}</span>
              <span className="metrics-label">DB Writes</span>
            </div>
            <div className="metrics-card">
              <span className="metrics-value">{metrics.cacheHits + metrics.cacheMisses}</span>
              <span className="metrics-label">Total Queries</span>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}

export default App;
