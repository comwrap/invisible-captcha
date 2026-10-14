export class PageLoadBotDetector {
  constructor() {
    this.signals = {};
    this.score = 0;
    this.flags = [];
    this.ready = false;

    // Must wait for 'load' — PerformanceNavigationTiming isn't
    // fully populated until all subresources finish.
    if (document.readyState === 'complete') {
        console.log("Document ready state is complete");
      this._analyze();
    } else {
      window.addEventListener('load', () => {
        // Delay slightly so the browser finalises paint timing
        setTimeout(() => this._analyze(), 200);
      });
    }
  }

  _analyze() {
    console.log("Analyzing page load");
    const nav = performance.getEntriesByType('navigation')[0];
    const paint = performance.getEntriesByType('paint');
    const resources = performance.getEntriesByType('resource');
    console.log("Nav: ", nav);
    if (!nav) {
      this.flags.push('NO_NAVIGATION_TIMING');
      this.score = 0.8;
      this.ready = true;
      return;
    }
   

    this.signals = {
      loadGap:          this._analyzeLoadGap(nav),
      resourceCount:    this._analyzeResourceCount(resources),
      paintTiming:      this._analyzePaintTiming(paint),
      networkStack:     this._analyzeNetworkStack(nav),
      transferIntegrity: this._analyzeTransferIntegrity(resources),
      navigationType:   this._analyzeNavigationType(nav),
      documentTiming:   this._analyzeDocumentTiming(nav),
    };
    console.log("Signals: ", this.signals);
    console.log("Score: ", this.score);
    console.log("Ready: ", this.ready);
    // Weighted aggregation
    const weights = {
      loadGap: 0.20, resourceCount: 0.18, paintTiming: 0.18,
      networkStack: 0.15, transferIntegrity: 0.12,
      navigationType: 0.07, documentTiming: 0.10,
    };

    let totalWeight = 0;
    let weightedSum = 0;
    for (const [key, weight] of Object.entries(weights)) {
      weightedSum += this.signals[key].score * weight;
      totalWeight += weight;
    }
    this.score = Math.min(1, Math.max(0, weightedSum / totalWeight));
    this.ready = true;
  }

  // ── Signal 1: DOMContentLoaded → Load gap ──────────────
  _analyzeLoadGap(nav) {
    const domReady = nav.domContentLoadedEventEnd;
    const loadEnd = nav.loadEventEnd;
    const gap = loadEnd - domReady;

    let score = 0;
    const flags = [];

    if (gap < 50) {
      // Real browsers need time to load images, fonts, CSS
      score = 0.8;
      flags.push('SUSPICIOUSLY_FAST_LOAD');
    } else if (gap < 150) {
      score = 0.4;
      flags.push('FAST_LOAD');
    }

    // DOM interactive → DOM complete should also take time
    const domProcessing = nav.domComplete - nav.domInteractive;
    if (domProcessing < 10) {
      score = Math.max(score, 0.7);
      flags.push('NO_DOM_PROCESSING');
    }

    this.flags.push(...flags);
    return { score, gap, domProcessing, flags };
  }

  // ── Signal 2: Resource count ───────────────────────────
  _analyzeResourceCount(resources) {
    const count = resources.length;
    const types = {};
    for (const r of resources) {
      types[r.initiatorType] = (types[r.initiatorType] || 0) + 1;
    }

    let score = 0;
    const flags = [];

    if (count < 5) {
      score = 0.7;
      flags.push('ALMOST_NO_RESOURCES');
    } else if (count < 15) {
      score = 0.3;
      flags.push('LOW_RESOURCE_COUNT');
    }

    // Real pages load images, CSS, fonts — absence is suspicious
    if (!types['img'] && !types['css'] && !types['link']) {
      score = Math.max(score, 0.6);
      flags.push('NO_VISUAL_RESOURCES');
    }

    this.flags.push(...flags);
    return { score, count, types, flags };
  }

  // ── Signal 3: First Paint / First Contentful Paint ─────
  _analyzePaintTiming(paintEntries) {
    const fp = paintEntries.find(p => p.name === 'first-paint');
    const fcp = paintEntries.find(p => p.name === 'first-contentful-paint');

    let score = 0;
    const flags = [];

    if (!fp && !fcp) {
      // Headless browsers often skip paint entirely
      score = 0.9;
      flags.push('NO_PAINT_EVENT');
    } else {
      const paintTime = (fcp || fp).startTime;
      if (paintTime < 5) {
        score = 0.6;
        flags.push('INSTANT_PAINT');
      }
    }

    this.flags.push(...flags);
    return {
      score,
      firstPaint: fp ? fp.startTime : null,
      firstContentfulPaint: fcp ? fcp.startTime : null,
      flags,
    };
  }

  // ── Signal 4: Network stack (DNS + TCP + TLS) ─────────
  _analyzeNetworkStack(nav) {
    const dns = nav.domainLookupEnd - nav.domainLookupStart;
    const tcp = nav.connectEnd - nav.connectStart;
    const tls = nav.secureConnectionStart > 0
      ? nav.connectEnd - nav.secureConnectionStart : 0;

    let score = 0;
    const flags = [];

    // On a first visit, DNS + TCP + TLS should be > 0
    // Bots with pre-resolved connections show all zeros
    if (dns === 0 && tcp === 0 && tls === 0) {
      score = 0.5;
      flags.push('ZERO_NETWORK_STACK');
    }

    // Request → Response unrealistically fast
    const ttfb = nav.responseStart - nav.requestStart;
    if (ttfb < 5) {
      score = Math.max(score, 0.6);
      flags.push('INSTANT_TTFB');
    }

    this.flags.push(...flags);
    return { score, dns, tcp, tls, ttfb, flags };
  }

  // ── Signal 5: Transfer size integrity ──────────────────
  _analyzeTransferIntegrity(resources) {
    let zeroTransfer = 0;
    let total = resources.length;

    for (const r of resources) {
      // encodedBodySize > 0 but transferSize === 0 → intercepted/mocked
      if (r.encodedBodySize > 0 && r.transferSize === 0) {
        zeroTransfer++;
      }
    }

    let score = 0;
    const flags = [];
    const ratio = total > 0 ? zeroTransfer / total : 0;

    if (ratio > 0.8 && total > 5) {
      score = 0.7;
      flags.push('RESOURCES_INTERCEPTED');
    } else if (ratio > 0.5 && total > 5) {
      score = 0.4;
      flags.push('PARTIAL_INTERCEPTION');
    }

    this.flags.push(...flags);
    return { score, zeroTransfer, total, ratio, flags };
  }

  // ── Signal 6: Navigation type ──────────────────────────
  _analyzeNavigationType(nav) {
    const type = nav.type; // navigate | reload | back_forward | prerender
    let score = 0;
    const flags = [];

    // Not inherently suspicious, but bots almost never use
    // back_forward or reload — they always do fresh navigations
    if (type === 'navigate') {
      score = 0.1; // slight lean
    }

    // Redirect chain length
    if (nav.redirectCount > 3) {
      score = Math.max(score, 0.5);
      flags.push('EXCESSIVE_REDIRECTS');
    }

    this.flags.push(...flags);
    return { score, type, redirectCount: nav.redirectCount, flags };
  }

  // ── Signal 7: Document timing coherence ────────────────
  _analyzeDocumentTiming(nav) {
    let score = 0;
    const flags = [];

    // Time from navigation start to first byte
    const waitTime = nav.responseStart - nav.startTime;

    // Time the browser spent parsing/rendering
    const processingTime = nav.loadEventStart - nav.responseEnd;

    // Bots in headless mode often have near-zero processing
    if (processingTime < 20 && waitTime > 0) {
      score = 0.6;
      flags.push('NO_RENDER_PROCESSING');
    }

    // If the entire page lifecycle < 100ms, highly suspicious
    const totalLifecycle = nav.loadEventEnd - nav.startTime;
    if (totalLifecycle < 100) {
      score = Math.max(score, 0.8);
      flags.push('INSTANT_LIFECYCLE');
    }

    this.flags.push(...flags);
    return { score, waitTime, processingTime, totalLifecycle, flags };
  }

  // ── Public API ─────────────────────────────────────────
  getReport() {
    return {
      ready: this.ready,
      score: this.score,
      signals: this.signals,
      flags: [...new Set(this.flags)],
    };
  }
}
