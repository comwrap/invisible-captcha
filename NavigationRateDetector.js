export class NavigationRateDetector {
    constructor(options = {}) {
    this.storageKey = options.storageKey || '__nav_rate_history';
    this.maxEntries = options.maxEntries || 200;
    this.windowMs = options.windowMs || 60000; // analyse last 60s
    this.flags = [];
    this.score = 0;
    this.ready = false;
   
    // Record this page load immediately
    this._recordNavigation();
   
    // Analyse after a short delay (let Performance API populate)
    setTimeout(() => this._analyze(), 300);
    }
   
    // ── Persistence Layer ──────────────────────────────────
    _getHistory() {
    try {
    const raw = sessionStorage.getItem(this.storageKey);
    return raw ? JSON.parse(raw) : [];
    } catch {
    return [];
    }
    }
   
    _saveHistory(history) {
    // Keep only the last N entries
    const trimmed = history.slice(-this.maxEntries);
    sessionStorage.setItem(this.storageKey, JSON.stringify(trimmed));
    }
   
    _recordNavigation() {
    const nav = performance.getEntriesByType('navigation')[0];
    const history = this._getHistory();
   
    history.push({
    timestamp: Date.now(),
    url: location.pathname,
    type: nav ? nav.type : 'unknown', // navigate | reload | back_forward
    loadTime: nav ? nav.loadEventEnd - nav.startTime : 0,
    });
   
    this._saveHistory(history);
    }
   
    // ── Core Analysis ──────────────────────────────────────
    _analyze() {
    const history = this._getHistory();
   
    if (history.length < 3) {
    this.score = 0; // not enough data
    this.ready = true;
    return;
    }
   
    const signals = {
    reloadRate: this._analyzeReloadRate(history),
    navigationEntropy: this._analyzeNavigationEntropy(history),
    rateDerivative: this._analyzeRateDerivative(history),
    urlPatternEntropy: this._analyzeUrlPatternEntropy(history),
    burstDetection: this._analyzeBurstWindows(history),
    };
   
    this.signals = signals;
   
    // Weighted score
    const weights = {
    reloadRate: 0.25,
    navigationEntropy: 0.25,
    rateDerivative: 0.20,
    urlPatternEntropy: 0.15,
    burstDetection: 0.15,
    };
   
    let sum = 0, totalW = 0;
    for (const [key, weight] of Object.entries(weights)) {
    sum += signals[key].score * weight;
    totalW += weight;
    }
    this.score = Math.min(1, Math.max(0, sum / totalW));
    this.ready = true;
    }
   
    // ── Signal 1: Reload Rate ──────────────────────────────
    // How many reloads per minute? Humans rarely reload > 3x/min
    _analyzeReloadRate(history) {
    const now = Date.now();
    const recent = history.filter(
    h => h.timestamp > now - this.windowMs
    );
    const reloads = recent.filter(h => h.type === 'reload');
    const reloadsPerMin = reloads.length / (this.windowMs / 60000);
   
    let score = 0;
    const flags = [];
   
    if (reloadsPerMin > 10) {
    score = 0.9;
    flags.push('EXTREME_RELOAD_RATE');
    } else if (reloadsPerMin > 5) {
    score = 0.6;
    flags.push('HIGH_RELOAD_RATE');
    } else if (reloadsPerMin > 3) {
    score = 0.3;
    flags.push('ELEVATED_RELOAD_RATE');
    }
   
    this.flags.push(...flags);
    return { score, reloadsPerMin, reloadCount: reloads.length, flags };
    }
   
    // ── Signal 2: Navigation Interval Entropy ──────────────
    // Same concept as click entropy — low entropy = metronomic = bot
    _analyzeNavigationEntropy(history) {
    if (history.length < 4) return { score: 0, entropy: 1, flags: [] };
   
    // Compute inter-navigation intervals
    const intervals = [];
    for (let i = 1; i < history.length; i++) {
    intervals.push(history[i].timestamp - history[i - 1].timestamp);
    }
   
    // Bin into histogram (8 bins)
    const entropy = this._shannonEntropy(intervals, 8);
   
    let score = 0;
    const flags = [];
   
    // Low entropy = all intervals nearly identical = bot
    if (entropy < 0.15) {
    score = 0.9;
    flags.push('METRONOMIC_NAVIGATION');
    } else if (entropy < 0.30) {
    score = 0.6;
    flags.push('REGULAR_NAVIGATION_PATTERN');
    } else if (entropy < 0.45) {
    score = 0.3;
    flags.push('SOMEWHAT_REGULAR_NAVIGATION');
    }
   
    this.flags.push(...flags);
    return { score, entropy, intervalCount: intervals.length, flags };
    }
   
    // ── Signal 3: Rate Derivative (Acceleration) ───────────
    // Divide history into 5-second buckets, count navs per bucket,
    // compute slope → positive slope = accelerating = burst/scrape
    _analyzeRateDerivative(history) {
    const bucketMs = 5000;
    if (history.length < 5) return { score: 0, derivative: 0, flags: [] };
   
    const oldest = history[0].timestamp;
    const newest = history[history.length - 1].timestamp;
    const span = newest - oldest;
   
    if (span < bucketMs * 2) return { score: 0, derivative: 0, flags: [] };
   
    // Build time-bucketed counts
    const bucketCount = Math.ceil(span / bucketMs);
    const buckets = new Array(bucketCount).fill(0);
   
    for (const h of history) {
    const idx = Math.min(
    Math.floor((h.timestamp - oldest) / bucketMs),
    bucketCount - 1
    );
    buckets[idx]++;
    }
   
    // Linear regression: slope of bucket counts over time
    const derivative = this._linearRegressionSlope(buckets);
   
    let score = 0;
    const flags = [];
   
    // Strong positive slope = accelerating navigation = scraping ramp-up
    if (derivative > 0.5) {
    score = 0.8;
    flags.push('ACCELERATING_NAVIGATION');
    } else if (derivative > 0.2) {
    score = 0.4;
    flags.push('INCREASING_NAV_RATE');
    }
   
    // Also check if rate is constant and high (flatline)
    const mean = buckets.reduce((a, b) => a + b, 0) / buckets.length;
    const std = Math.sqrt(
    buckets.reduce((s, c) => s + (c - mean) ** 2, 0) / buckets.length
    );
    if (mean > 2 && std / mean < 0.1) {
    score = Math.max(score, 0.7);
    flags.push('FLATLINE_NAV_RATE');
    }
   
    this.flags.push(...flags);
    return { score, derivative, mean, std, buckets, flags };
    }
   
    // ── Signal 4: URL Pattern Entropy ──────────────────────
    // Bots often hit pages in sequential/predictable order:
    //   /page/1, /page/2, /page/3 → low URL entropy
    // Humans jump around unpredictably
    _analyzeUrlPatternEntropy(history) {
    if (history.length < 5) return { score: 0, entropy: 1, flags: [] };
   
    // Count unique URLs and their frequency
    const urlCounts = {};
    for (const h of history) {
    urlCounts[h.url] = (urlCounts[h.url] || 0) + 1;
    }
   
    const total = history.length;
    const probs = Object.values(urlCounts).map(c => c / total);
   
    // Shannon entropy of URL distribution
    let entropy = 0;
    for (const p of probs) {
    if (p > 0) entropy -= p * Math.log2(p);
    }
   
    // Normalise to 0–1 range
    const maxEntropy = Math.log2(Object.keys(urlCounts).length) || 1;
    const normalised = entropy / maxEntropy;
   
    let score = 0;
    const flags = [];
   
    // Single page hammered repeatedly → entropy ≈ 0
    if (normalised < 0.2 && total > 5) {
    score = 0.7;
    flags.push('SINGLE_PAGE_HAMMERING');
    }
   
    // Check for sequential URL pattern (/page/1, /page/2, ...)
    const urls = history.map(h => h.url);
    if (this._isSequentialPattern(urls)) {
    score = Math.max(score, 0.8);
    flags.push('SEQUENTIAL_URL_CRAWL');
    }
   
    this.flags.push(...flags);
    return {
    score, entropy, normalised,
    uniqueUrls: Object.keys(urlCounts).length, flags,
    };
    }
   
    // ── Signal 5: Burst Window Detection ───────────────────
    // Sliding window: were there any 5-second windows with > N navs?
    _analyzeBurstWindows(history) {
    const windowSize = 5000; // 5 seconds
    let maxInWindow = 0;
   
    for (let i = 0; i < history.length; i++) {
    const windowStart = history[i].timestamp;
    let count = 0;
    for (let j = i; j < history.length; j++) {
    if (history[j].timestamp - windowStart <= windowSize) {
    count++;
    } else break;
    }
    maxInWindow = Math.max(maxInWindow, count);
    }
   
    let score = 0;
    const flags = [];
   
    // > 8 navigations in any 5-second window is extreme
    if (maxInWindow > 8) {
    score = 0.9;
    flags.push('NAVIGATION_BURST_EXTREME');
    } else if (maxInWindow > 5) {
    score = 0.6;
    flags.push('NAVIGATION_BURST');
    } else if (maxInWindow > 3) {
    score = 0.3;
    flags.push('ELEVATED_NAV_BURST');
    }
   
    this.flags.push(...flags);
    return { score, maxInWindow, flags };
    }
   
    // ── Math Utilities ─────────────────────────────────────
    _shannonEntropy(values, numBins) {
    if (values.length < 2) return 1;
   
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const bins = new Array(numBins).fill(0);
   
    for (const v of values) {
    const idx = Math.min(
    Math.floor(((v - min) / range) * numBins),
    numBins - 1
    );
    bins[idx]++;
    }
   
    const total = values.length;
    let entropy = 0;
    for (const count of bins) {
    if (count > 0) {
    const p = count / total;
    entropy -= p * Math.log2(p);
    }
    }
   
    // Normalise to 0–1
    return entropy / Math.log2(numBins);
    }
   
    _linearRegressionSlope(values) {
    const n = values.length;
    if (n < 2) return 0;
   
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += values[i];
    sumXY += i * values[i];
    sumXX += i * i;
    }
   
    const denominator = n * sumXX - sumX * sumX;
    if (denominator === 0) return 0;
    return (n * sumXY - sumX * sumY) / denominator;
    }
   
    _isSequentialPattern(urls) {
    // Extract trailing numbers: /page/1, /page/2, /page/3
    const numbers = urls.map(u => {
    const match = u.match(/(\d+)\/?$/);
    return match ? parseInt(match[1]) : null;
    }).filter(n => n !== null);
   
    if (numbers.length < 3) return false;
   
    // Check if numbers are mostly sequential (diff = 1)
    let sequential = 0;
    for (let i = 1; i < numbers.length; i++) {
    if (numbers[i] - numbers[i - 1] === 1) sequential++;
    }
    return sequential / (numbers.length - 1) > 0.7;
    }
   
    // ── Public API ─────────────────────────────────────────
    getReport() {
    return {
    ready: this.ready,
    score: this.score,
    signals: this.signals || {},
    flags: [...new Set(this.flags)],
    history: this._getHistory(),
    };
    }
   }