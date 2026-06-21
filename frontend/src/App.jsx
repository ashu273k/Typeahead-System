import { useState, useEffect, useRef } from 'react';
import './App.css';

const BACKEND_URL = 'http://localhost:3001';

function App() {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [isInputFocused, setIsInputFocused] = useState(false);
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
    fetchTrending(); // eslint-disable-line react-hooks/set-state-in-effect
  }, []);

  // Poll metrics every 1.5 seconds
  useEffect(() => {
    fetchMetrics(); // eslint-disable-line react-hooks/set-state-in-effect
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
      setSuggestions([]); // eslint-disable-line react-hooks/set-state-in-effect
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

  // Highlight matching prefix of suggestions
  const renderSuggestionText = (suggestionText, queryText) => {
    if (!queryText) return <span>{suggestionText}</span>;
    const lowerQuery = queryText.toLowerCase();
    const lowerSuggestion = suggestionText.toLowerCase();
    
    if (lowerSuggestion.startsWith(lowerQuery)) {
      const matchLength = queryText.length;
      return (
        <span>
          <strong>{suggestionText.substring(0, matchLength)}</strong>
          {suggestionText.substring(matchLength)}
        </span>
      );
    }
    return <span>{suggestionText}</span>;
  };

  return (
    <main className="app-container">
      {/* Toast Notification (Snackbar) */}
      {searchConfirmation && (
        <div className="toast">
          <span className="toast-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
              <polyline points="22 4 12 14.01 9 11.01"></polyline>
            </svg>
          </span>
          <span className="toast-text">{JSON.stringify(searchConfirmation)}</span>
        </div>
      )}

      {/* Header Branding */}
      <header className="header">
        <h1 className="title" aria-label="Typeahead Logo">
          <span className="g-blue">T</span>
          <span className="g-red">y</span>
          <span className="g-yellow">p</span>
          <span className="g-blue">e</span>
          <span className="g-green">a</span>
          <span className="g-red">h</span>
          <span className="g-blue">e</span>
          <span className="g-green">a</span>
          <span className="g-red">d</span>
        </h1>
        <p className="subtitle">Real-time prefix autocomplete with consistent hash caching & trending search velocity</p>
      </header>

      {/* Connection Failure State */}
      {isBackendDown ? (
        <div className="error-banner">
          <div className="error-title">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
              <line x1="12" y1="9" x2="12" y2="13"></line>
              <line x1="12" y1="17" x2="12.01" y2="17"></line>
            </svg>
            Connection Lost
          </div>
          <div className="error-msg">Could not connect to the backend server. Please make sure Docker services are running.</div>
          <button className="retry-btn" onClick={() => { fetchTrending(); if (query) setQuery(query + ' '); }}>Retry Connection</button>
        </div>
      ) : (
        <>
          {/* Focal Area: Search Bar & Dropdown Container */}
          <div 
            className={`search-wrapper ${isInputFocused ? 'focused' : ''} ${showDropdown && suggestions.length > 0 ? 'has-dropdown' : ''}`} 
            ref={searchWrapperRef}
          >
            <div className="search-box">
              <div className="input-container">
                <span className="search-icon-svg">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8"></circle>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                  </svg>
                </span>
                <input
                  type="text"
                  className="search-input"
                  placeholder="Search queries (e.g., google, yahoo, ebay)..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onFocus={() => {
                    setIsInputFocused(true);
                    if (query.trim()) setShowDropdown(true);
                  }}
                  onBlur={() => {
                    setTimeout(() => setIsInputFocused(false), 200);
                  }}
                />
                {query && (
                  <button 
                    className="clear-btn" 
                    onClick={() => { setQuery(''); setSuggestions([]); setShowDropdown(false); }} 
                    aria-label="Clear search input"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18"></line>
                      <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                  </button>
                )}
              </div>
              {isLoadingSuggestions && <span className="spinner" style={{ marginRight: '10px' }}></span>}
              <div className="divider"></div>
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
                    <span className="dropdown-item-icon">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="11" cy="11" r="8"></circle>
                        <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                      </svg>
                    </span>
                    {renderSuggestionText(item, query)}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Trending Component */}
          <section className="trending-container google-card">
            <div className="trending-header">
              <span className="trending-header-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline>
                  <polyline points="17 6 23 6 23 12"></polyline>
                </svg>
              </span>
              Trending Searches
            </div>
            
            {isLoadingTrending ? (
              <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.9rem', padding: '20px' }}>
                <span className="spinner"></span> Loading trends...
              </div>
            ) : trending.length === 0 ? (
              <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.9rem', padding: '20px' }}>
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
                    <div className="trending-item-left">
                      <span className="trending-rank">#{index + 1}</span>
                      <span className="trending-term">{item.query}</span>
                    </div>
                    <div className="trending-score-container">
                      <span className="trending-score-icon">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline>
                          <polyline points="17 6 23 6 23 12"></polyline>
                        </svg>
                      </span>
                      <span className="trending-score">{Math.round(item.score).toLocaleString()}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Performance Metrics Grid */}
          <section className="metrics-container google-card">
            <div className="metrics-header">
              <span className="metrics-header-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="20" x2="18" y2="10"></line>
                  <line x1="12" y1="20" x2="12" y2="4"></line>
                  <line x1="6" y1="20" x2="6" y2="14"></line>
                </svg>
              </span>
              System Performance & Cache Metrics
            </div>
            <div className="metrics-grid">
              <div className="metrics-card" style={{ '--card-accent': 'var(--google-green)' }}>
                <div className="metric-icon-wrapper green">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                    <polyline points="22 4 12 14.01 9 11.01"></polyline>
                  </svg>
                </div>
                <div className="metric-content">
                  <span className="metrics-value">
                    {(() => {
                      const total = metrics.cacheHits + metrics.cacheMisses;
                      if (total === 0) return '0%';
                      return `${Math.round((metrics.cacheHits / total) * 100)}%`;
                    })()}
                  </span>
                  <span className="metrics-label">Cache Hit Rate</span>
                </div>
              </div>
              <div className="metrics-card" style={{ '--card-accent': 'var(--google-blue)' }}>
                <div className="metric-icon-wrapper blue">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="17 11 21 7 17 3"></polyline>
                    <line x1="21" y1="7" x2="9" y2="7"></line>
                    <polyline points="7 13 3 17 7 21"></polyline>
                    <line x1="3" y1="17" x2="15" y2="17"></line>
                  </svg>
                </div>
                <div className="metric-content">
                  <span className="metrics-value">{metrics.cacheHits} / {metrics.cacheHits + metrics.cacheMisses}</span>
                  <span className="metrics-label">Hits / Misses</span>
                </div>
              </div>
              <div className="metrics-card" style={{ '--card-accent': 'var(--google-red)' }}>
                <div className="metric-icon-wrapper red">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"></circle>
                    <polyline points="12 6 12 12 16 14"></polyline>
                  </svg>
                </div>
                <div className="metric-content">
                  <span className="metrics-value">{metrics.p95LatencyMs} ms</span>
                  <span className="metrics-label">p95 Latency</span>
                </div>
              </div>
              <div className="metrics-card" style={{ '--card-accent': 'var(--google-blue)' }}>
                <div className="metric-icon-wrapper blue">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
                    <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path>
                    <path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3"></path>
                  </svg>
                </div>
                <div className="metric-content">
                  <span className="metrics-value">{metrics.dbReads}</span>
                  <span className="metrics-label">DB Reads</span>
                </div>
              </div>
              <div className="metrics-card" style={{ '--card-accent': 'var(--google-yellow)' }}>
                <div className="metric-icon-wrapper yellow">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
                    <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path>
                    <path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3"></path>
                  </svg>
                </div>
                <div className="metric-content">
                  <span className="metrics-value">{metrics.dbWrites}</span>
                  <span className="metrics-label">DB Writes</span>
                </div>
              </div>
              <div className="metrics-card" style={{ '--card-accent': 'var(--google-green)' }}>
                <div className="metric-icon-wrapper green">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="4 17 10 11 4 5"></polyline>
                    <line x1="12" y1="19" x2="20" y2="19"></line>
                  </svg>
                </div>
                <div className="metric-content">
                  <span className="metrics-value">{metrics.cacheHits + metrics.cacheMisses}</span>
                  <span className="metrics-label">Total Queries</span>
                </div>
              </div>
            </div>
          </section>
        </>
      )}
    </main>
  );
}

export default App;
