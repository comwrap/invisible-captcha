    // EVENT RATE TRACKER - Rolling events/second counter using time-bucketed sliding window
    class EventRateTracker {
      constructor(windowMs = 5000, bucketMs = 500) {
        this.windowMs = windowMs;
        this.bucketMs = bucketMs;
        this.numBuckets = Math.ceil(windowMs / bucketMs);
        this.buckets = {
          mouse: new Array(this.numBuckets).fill(0),
          click: new Array(this.numBuckets).fill(0),
          keyboard: new Array(this.numBuckets).fill(0),
        };
        this.currentBucketIndex = 0;
        this.lastBucketTime = performance.now();
      }

      record(eventType) {
        this._rotateBuckets();
        if (this.buckets[eventType] !== undefined) {
          this.buckets[eventType][this.currentBucketIndex]++;
        }
      }

      _rotateBuckets() {
        const now = performance.now();
        const elapsed = now - this.lastBucketTime;
        const bucketsToAdvance = Math.floor(elapsed / this.bucketMs);
        if (bucketsToAdvance <= 0) return;
        const toAdvance = Math.min(bucketsToAdvance, this.numBuckets);
        for (let i = 1; i <= toAdvance; i++) {
          const idx = (this.currentBucketIndex + i) % this.numBuckets;
          this.buckets.mouse[idx] = 0;
          this.buckets.click[idx] = 0;
          this.buckets.keyboard[idx] = 0;
        }
        this.currentBucketIndex = (this.currentBucketIndex + toAdvance) % this.numBuckets;
        this.lastBucketTime += toAdvance * this.bucketMs;
      }

      getRate(eventType) {
        this._rotateBuckets();
        const bucketArr = this.buckets[eventType];
        if (!bucketArr) return 0;
        let total = 0;
        for (let i = 0; i < this.numBuckets; i++) {
          total += bucketArr[i];
        }
        return total / (this.windowMs / 1000);
      }

      getRateRegularity(eventType) {
        this._rotateBuckets();
        const bucketArr = this.buckets[eventType];
        if (!bucketArr) return 1;
        const values = [];
        for (let i = 0; i < this.numBuckets; i++) {
          values.push(bucketArr[i]);
        }
        const mean = values.reduce((a, b) => a + b, 0) / values.length;
        if (mean === 0) return 1;
        const squaredDiffs = values.map(v => (v - mean) ** 2);
        const std = Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / (values.length - 1 || 1));
        return std / mean;
      }

      getSnapshot() {
        return {
          mouseRate: this.getRate('mouse'),
          clickRate: this.getRate('click'),
          keyboardRate: this.getRate('keyboard'),
          mouseRegularity: this.getRateRegularity('mouse'),
          clickRegularity: this.getRateRegularity('click'),
          keyboardRegularity: this.getRateRegularity('keyboard'),
        };
      }

      reset() {
        this.buckets.mouse = new Array(this.numBuckets).fill(0);
        this.buckets.click = new Array(this.numBuckets).fill(0);
        this.buckets.keyboard = new Array(this.numBuckets).fill(0);
        this.currentBucketIndex = 0;
        this.lastBucketTime = performance.now();
      }
    }

    // RATE DERIVATIVE TRACKER - Measures rate change over time (derivative)
    class RateDerivativeTracker {
      constructor(sampleIntervalMs = 1000, historySize = 30) {
        this.sampleIntervalMs = sampleIntervalMs;
        this.historySize = historySize;
        this.history = new CircularBuffer(historySize);
      }

      sample(rateTracker) {
        this.history.push({
          timestamp: performance.now(),
          mouseRate: rateTracker.getRate('mouse'),
          clickRate: rateTracker.getRate('click'),
          keyboardRate: rateTracker.getRate('keyboard'),
        });
      }

      getDerivative(eventType) {
        const rateKey = eventType + 'Rate';
        const samples = this.history.toArray();
        if (samples.length < 2) return 0;
        // Linear regression: derivative = slope of rate over time
        const n = samples.length;
        let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
        const t0 = samples[0].timestamp;
        for (let i = 0; i < n; i++) {
          const x = (samples[i].timestamp - t0) / 1000; // seconds
          const y = samples[i][rateKey];
          sumX += x;
          sumY += y;
          sumXY += x * y;
          sumXX += x * x;
        }
        const denom = n * sumXX - sumX * sumX;
        if (denom === 0) return 0;
        return (n * sumXY - sumX * sumY) / denom;
      }

      detectBurst(eventType, threshold = 50) {
        return this.getDerivative(eventType) > threshold;
      }

      detectFlatline(eventType, minRate = 10, maxVariation = 0.02) {
        const rateKey = eventType + 'Rate';
        const samples = this.history.toArray();
        if (samples.length < 3) return false;
        const rates = samples.map(s => s[rateKey]);
        const allAboveMin = rates.every(r => r >= minRate);
        if (!allAboveMin) return false;
        const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
        if (mean === 0) return false;
        const squaredDiffs = rates.map(v => (v - mean) ** 2);
        const std = Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / (rates.length - 1 || 1));
        const cv = std / mean;
        return cv <= maxVariation;
      }

      getHistory(eventType) {
        const rateKey = eventType + 'Rate';
        return this.history.toArray().map(s => ({ timestamp: s.timestamp, rate: s[rateKey] }));
      }

      getAnalysis() {
        return {
          mouseDerivative: this.getDerivative('mouse'),
          clickDerivative: this.getDerivative('click'),
          keyboardDerivative: this.getDerivative('keyboard'),
          mouseBurst: this.detectBurst('mouse', 50),
          clickBurst: this.detectBurst('click', 50),
          keyboardBurst: this.detectBurst('keyboard', 50),
          mouseFlatline: this.detectFlatline('mouse', 10, 0.02),
          clickFlatline: this.detectFlatline('click', 10, 0.02),
          keyboardFlatline: this.detectFlatline('keyboard', 10, 0.02),
        };
      }

      reset() {
        this.history.clear();
      }
    }

    // CIRCULAR BUFFER - no generics, no type annotations
    class CircularBuffer {
      constructor(capacity) {
        this.capacity = capacity;
        this.buffer = new Array(capacity);
        this.head = 0;
        this.count = 0;
      }

      push(item) {
        this.buffer[this.head] = item;
        this.head = (this.head + 1) % this.capacity;
        if (this.count < this.capacity) {
          this.count++;
        }
      }

      toArray() {
        if (this.count === 0) return [];
        const result = [];
        const start = this.count < this.capacity ? 0 : this.head;
        for (let i = 0; i < this.count; i++) {
          const index = (start + i) % this.capacity;
          result.push(this.buffer[index]);
        }
        return result;
      }

      getRecent(n) {
        const all = this.toArray();
        return all.slice(Math.max(0, all.length - n));
      }

      getLast() {
        if (this.count === 0) return undefined;
        const index = (this.head - 1 + this.capacity) % this.capacity;
        return this.buffer[index];
      }

      get size() {
        return this.count;
      }

      clear() {
        this.buffer = new Array(this.capacity);
        this.head = 0;
        this.count = 0;
      }
    }

    // MATH UTILITIES - no type annotations
    class MathUtils {
      static entropy(values, binCount = 10) {
        if (values.length < 2) return 0;
        const min = Math.min(...values);
        const max = Math.max(...values);
        const range = max - min;
        if (range === 0) return 0;
        const bins = new Array(binCount).fill(0);
        for (const value of values) {
          const binIndex = Math.min(
            Math.floor(((value - min) / range) * binCount),
            binCount - 1
          );
          bins[binIndex]++;
        }
        let entropy = 0;
        for (const count of bins) {
          if (count > 0) {
            const p = count / values.length;
            entropy -= p * Math.log2(p);
          }
        }
        return entropy / Math.log2(binCount);
      }

      static standardDeviation(values) {
        if (values.length < 2) return 0;
        const mean = values.reduce((a, b) => a + b, 0) / values.length;
        const squaredDiffs = values.map((v) => (v - mean) ** 2);
        return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / (values.length - 1));
      }

      static mean(values) {
        if (values.length === 0) return 0;
        return values.reduce((a, b) => a + b, 0) / values.length;
      }

      static distance(x1, y1, x2, y2) {
        return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
      }

      static straightnessIndex(points) {
        if (points.length < 3) return 0.5;
        const directDistance = this.distance(
          points[0].x, points[0].y,
          points[points.length - 1].x, points[points.length - 1].y
        );
        if (directDistance < 1) return 0.5;
        let pathDistance = 0;
        for (let i = 1; i < points.length; i++) {
          pathDistance += this.distance(
            points[i - 1].x, points[i - 1].y,
            points[i].x, points[i].y
          );
        }
        if (pathDistance === 0) return 0.5;
        return directDistance / pathDistance;
      }

      static bezierDeviation(points) {
        if (points.length < 5) return 0.5;
        const start = points[0];
        const end = points[points.length - 1];
        const mid = points[Math.floor(points.length / 2)];
        const controlX = 2 * mid.x - 0.5 * start.x - 0.5 * end.x;
        const controlY = 2 * mid.y - 0.5 * start.y - 0.5 * end.y;
        let totalDeviation = 0;
        for (let i = 1; i < points.length - 1; i++) {
          const t = i / (points.length - 1);
          const expectedX = (1 - t) ** 2 * start.x + 2 * (1 - t) * t * controlX + t ** 2 * end.x;
          const expectedY = (1 - t) ** 2 * start.y + 2 * (1 - t) * t * controlY + t ** 2 * end.y;
          totalDeviation += this.distance(points[i].x, points[i].y, expectedX, expectedY);
        }
        return totalDeviation / (points.length - 2);
      }

      static clamp01(value) {
        return Math.max(0, Math.min(1, value));
      }

      static sigmoid(x, steepness = 1) {
        return 1 / (1 + Math.exp(-steepness * x));
      }
    }

    // MAIN BOT DETECTOR CLASS - all TypeScript removed
export class BotDetector {
      static DEFAULT_CONFIG = {
        bufferSize: 500,
        minEventsForScore: 10,
        scoreDebounceMs: 250,
        accessibilityMode: false,
        weights: {
          mouseLinearity: 0.15,
          mouseVelocityConsistency: 0.12,
          mouseJitter: 0.10,
          mouseCurvature: 0.10,
          clickIntervalEntropy: 0.13,
          clickMoveRatio: 0.08,
          phantomClicks: 0.10,
          doubleClickTiming: 0.07,
          navigationPattern: 0.08,
          sessionBehavior: 0.07,
        },
        thresholds: {
          linearityThreshold: 0.98,
          velocityStdMinNormal: 15,
          velocityStdMaxNormal: 800,
          minNaturalJitter: 0.3,
          maxNaturalJitter: 50,
          minClickEntropy: 0.25,
          phantomClickRatioThreshold: 0.7,
          minDoubleClickMs: 80,
          maxDoubleClickMs: 500,
          minBezierDeviation: 0.5,
        },
      };

      constructor(config = {}) {
        this.config = this.mergeConfig(BotDetector.DEFAULT_CONFIG, config);
        if (this.config.accessibilityMode) {
          this.applyAccessibilityRelaxations();
        }
        this.mouseBuffer = new CircularBuffer(this.config.bufferSize);
        this.clickBuffer = new CircularBuffer(this.config.bufferSize);
        this.keyboardBuffer = new CircularBuffer(Math.floor(this.config.bufferSize / 2));

        this.isRunning = false;
        this.startTime = 0;
        this.lastMouseEvent = null;
        this.lastMovementTime = 0;
        this.scoreCache = null;
        this.scoreDebounceTimer = null;

        this.keyboardOnlyNavigation = false;
        this.consecutiveTabCount = 0;
        this.hasMouseInput = false;
        this.hasTouchInput = false;
        this.accessibilityIndicators = new Set();

        this.boundMouseMoveHandler = this.handleMouseMove.bind(this);
        this.boundClickHandler = this.handleClick.bind(this);
        this.boundKeydownHandler = this.handleKeydown.bind(this);
        this.boundTouchStartHandler = this.handleTouchStart.bind(this);

        this.rateTracker = new EventRateTracker(5000, 500);
        this.derivativeTracker = new RateDerivativeTracker(1000, 30);
        this.derivativeSampleTimer = null;
      }

      start() {
        if (this.isRunning) return;
        this.isRunning = true;
        this.startTime = performance.now();
        document.addEventListener('mousemove', this.boundMouseMoveHandler, { passive: true });
        document.addEventListener('click', this.boundClickHandler, { passive: true });
        document.addEventListener('keydown', this.boundKeydownHandler, { passive: true });
        document.addEventListener('touchstart', this.boundTouchStartHandler, { passive: true });
        this.derivativeSampleTimer = setInterval(() => this.derivativeTracker.sample(this.rateTracker), 1000);
      }

      stop() {
        if (!this.isRunning) return;
        this.isRunning = false;
        document.removeEventListener('mousemove', this.boundMouseMoveHandler);
        document.removeEventListener('click', this.boundClickHandler);
        document.removeEventListener('keydown', this.boundKeydownHandler);
        document.removeEventListener('touchstart', this.boundTouchStartHandler);
        if (this.derivativeSampleTimer !== null) {
          clearInterval(this.derivativeSampleTimer);
          this.derivativeSampleTimer = null;
        }
        if (this.scoreDebounceTimer !== null) {
          clearTimeout(this.scoreDebounceTimer);
          this.scoreDebounceTimer = null;
        }
      }

      getScore() {
        if (this.scoreCache !== null) {
          return this.scoreCache;
        }
        let score = this.calculateScore();
        console.log(score)
        return score;
      }

      getReport() {
        const signals = this.calculateAllSignals();
        const score = this.computeWeightedScore(signals);
        const confidence = this.calculateConfidence();
        const flags = this.generateFlags(signals);
        return {
          score,
          signals,
          confidence,
          accessibilityDetected: this.accessibilityIndicators.size > 0,
          inputModality: this.detectInputModality(),
          flags,
          eventCount: this.mouseBuffer.size + this.clickBuffer.size + this.keyboardBuffer.size,
          observationDuration: performance.now() - this.startTime,
          rateAnalysis: this.getRateReport(),
        };
      }

      getRateReport() {
        const snapshot = this.rateTracker.getSnapshot();
        const analysis = this.derivativeTracker.getAnalysis();
        return { ...snapshot, ...analysis };
      }

      reset() {
        this.mouseBuffer.clear();
        this.clickBuffer.clear();
        this.keyboardBuffer.clear();
        this.lastMouseEvent = null;
        this.lastMovementTime = 0;
        this.scoreCache = null;
        this.keyboardOnlyNavigation = false;
        this.consecutiveTabCount = 0;
        this.hasMouseInput = false;
        this.hasTouchInput = false;
        this.accessibilityIndicators.clear();
        this.rateTracker.reset();
        this.derivativeTracker.reset();
        this.startTime = performance.now();
      }

      updateConfig(config) {
        this.config = this.mergeConfig(this.config, config);
        if (this.config.accessibilityMode) {
          this.applyAccessibilityRelaxations();
        }
        this.scoreCache = null;
      }

      // EVENT HANDLERS
      handleMouseMove(e) {
        this.hasMouseInput = true;
        this.rateTracker.record('mouse');
        const event = { x: e.clientX, y: e.clientY, timestamp: performance.now() };
        this.mouseBuffer.push(event);
        this.lastMouseEvent = event;
        this.lastMovementTime = event.timestamp;
        this.detectMouseAccessibilityPatterns(event);
        this.invalidateScore();
      }

      handleClick(e) {
        this.rateTracker.record('click');
        const now = performance.now();
        const hadPrecedingMovement = this.lastMovementTime > 0 && now - this.lastMovementTime < 2000;
        const event = { x: e.clientX, y: e.clientY, timestamp: now, hadPrecedingMovement, button: e.button };
        this.clickBuffer.push(event);
        this.invalidateScore();
      }

      handleKeydown(e) {
        this.rateTracker.record('keyboard');
        const navigationKeys = new Set(['Tab', 'Enter', ' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Escape', 'Home', 'End', 'PageUp', 'PageDown']);
        const isNavigationKey = navigationKeys.has(e.key);
        const event = { key: e.key, timestamp: performance.now(), isNavigationKey };
        this.keyboardBuffer.push(event);
        if (e.key === 'Tab') {
          this.consecutiveTabCount++;
          if (this.consecutiveTabCount >= 3 && !this.hasMouseInput) {
            this.keyboardOnlyNavigation = true;
            this.accessibilityIndicators.add('keyboard-only-navigation');
          }
        } else {
          this.consecutiveTabCount = 0;
        }
        this.detectSwitchAccessPatterns();
        this.invalidateScore();
      }

      handleTouchStart(_e) {
        this.hasTouchInput = true;
        this.accessibilityIndicators.add('touch-input');
      }

      // SIGNAL ANALYSIS
      calculateAllSignals() {
        return {
          mouseLinearity: this.analyzeMouseLinearity(),
          mouseVelocityConsistency: this.analyzeVelocityConsistency(),
          mouseJitter: this.analyzeJitter(),
          mouseCurvature: this.analyzeCurvature(),
          clickIntervalEntropy: this.analyzeClickEntropy(),
          clickMoveRatio: this.analyzeClickMoveRatio(),
          phantomClicks: this.analyzePhantomClicks(),
          doubleClickTiming: this.analyzeDoubleClickTiming(),
          navigationPattern: this.analyzeNavigationPattern(),
          sessionBehavior: this.analyzeSessionBehavior(),
        };
      }

      analyzeMouseLinearity() {
        const points = this.mouseBuffer.toArray();
        if (points.length < 10) return 0;
        const windowSize = 15;
        const straightnessValues = [];
        for (let i = 0; i <= points.length - windowSize; i += 5) {
          const window = points.slice(i, i + windowSize);
          const straightness = MathUtils.straightnessIndex(window);
          straightnessValues.push(straightness);
        }
        if (straightnessValues.length === 0) return 0;
        const threshold = this.config.thresholds.linearityThreshold;
        const suspiciousCount = straightnessValues.filter((s) => s > threshold).length;
        const suspiciousRatio = suspiciousCount / straightnessValues.length;
        const meanStraightness = MathUtils.mean(straightnessValues);
        const score = MathUtils.clamp01(suspiciousRatio * 0.6 + (meanStraightness - 0.8) * 2 * 0.4);
        return score;
      }

      analyzeVelocityConsistency() {
        const points = this.mouseBuffer.toArray();
        if (points.length < 5) return 0;
        const velocities = [];
        for (let i = 1; i < points.length; i++) {
          const dt = points[i].timestamp - points[i - 1].timestamp;
          if (dt > 0 && dt < 200) {
            const distance = MathUtils.distance(points[i - 1].x, points[i - 1].y, points[i].x, points[i].y);
            velocities.push(distance / dt);
          }
        }
        if (velocities.length < 3) return 0;
        const stdDev = MathUtils.standardDeviation(velocities);
        const { velocityStdMinNormal, velocityStdMaxNormal } = this.config.thresholds;
        if (stdDev < velocityStdMinNormal) {
          return MathUtils.clamp01(1 - stdDev / velocityStdMinNormal);
        } else if (stdDev > velocityStdMaxNormal) {
          return MathUtils.clamp01((stdDev - velocityStdMaxNormal) / velocityStdMaxNormal * 0.5);
        }
        return 0;
      }

      analyzeJitter() {
        const points = this.mouseBuffer.toArray();
        if (points.length < 20) return 0;
        const microDisplacements = [];
        for (let i = 1; i < points.length; i++) {
          const dt = points[i].timestamp - points[i - 1].timestamp;
          if (dt > 0 && dt < 50) {
            const displacement = MathUtils.distance(points[i - 1].x, points[i - 1].y, points[i].x, points[i].y);
            microDisplacements.push(displacement);
          }
        }
        if (microDisplacements.length < 5) return 0;
        const meanJitter = MathUtils.mean(microDisplacements);
        const { minNaturalJitter, maxNaturalJitter } = this.config.thresholds;
        if (meanJitter < minNaturalJitter) {
          return MathUtils.clamp01(1 - meanJitter / minNaturalJitter);
        } else if (meanJitter > maxNaturalJitter) {
          return MathUtils.clamp01((meanJitter - maxNaturalJitter) / (maxNaturalJitter * 2) * 0.6);
        }
        return 0;
      }

      analyzeCurvature() {
        const points = this.mouseBuffer.toArray();
        if (points.length < 15) return 0;
        const segmentSize = 20;
        const deviations = [];
        for (let i = 0; i <= points.length - segmentSize; i += 10) {
          const segment = points.slice(i, i + segmentSize);
          const deviation = MathUtils.bezierDeviation(segment);
          deviations.push(deviation);
        }
        if (deviations.length === 0) return 0;
        const meanDeviation = MathUtils.mean(deviations);
        const deviationStd = MathUtils.standardDeviation(deviations);
        const { minBezierDeviation } = this.config.thresholds;
        let score = 0;
        if (meanDeviation < minBezierDeviation) {
          score += MathUtils.clamp01(1 - meanDeviation / minBezierDeviation) * 0.7;
        }
        if (deviationStd < 0.5 && deviations.length > 3) {
          score += 0.3;
        }
        return MathUtils.clamp01(score);
      }

      analyzeClickEntropy() {
        const clicks = this.clickBuffer.toArray();
        if (clicks.length < 4) return 0;
        const intervals = [];
        for (let i = 1; i < clicks.length; i++) {
          intervals.push(clicks[i].timestamp - clicks[i - 1].timestamp);
        }
        if (intervals.length < 3) return 0;
        const entropy = MathUtils.entropy(intervals, 8);
        const { minClickEntropy } = this.config.thresholds;
        if (entropy < minClickEntropy) {
          return MathUtils.clamp01(1 - entropy / minClickEntropy);
        }
        return 0;
      }

      analyzeClickMoveRatio() {
        const mouseCount = this.mouseBuffer.size;
        const clickCount = this.clickBuffer.size;
        if (clickCount === 0) return 0;
        if (mouseCount === 0 && clickCount > 0) {
          if (this.keyboardOnlyNavigation) return 0;
          return 0.8;
        }
        const ratio = mouseCount / clickCount;
        if (ratio < 5 && clickCount > 3) {
          return MathUtils.clamp01((5 - ratio) / 5 * 0.7);
        }
        return 0;
      }

      analyzePhantomClicks() {
        const clicks = this.clickBuffer.toArray();
        if (clicks.length < 3) return 0;
        if (this.keyboardOnlyNavigation) return 0;
        const phantomCount = clicks.filter((c) => !c.hadPrecedingMovement).length;
        const phantomRatio = phantomCount / clicks.length;
        const { phantomClickRatioThreshold } = this.config.thresholds;
        if (phantomRatio > phantomClickRatioThreshold) {
          return MathUtils.clamp01((phantomRatio - phantomClickRatioThreshold) / (1 - phantomClickRatioThreshold));
        }
        return 0;
      }

      analyzeDoubleClickTiming() {
        const clicks = this.clickBuffer.toArray();
        if (clicks.length < 4) return 0;
        const { minDoubleClickMs, maxDoubleClickMs } = this.config.thresholds;
        const doubleClickIntervals = [];
        for (let i = 1; i < clicks.length; i++) {
          const interval = clicks[i].timestamp - clicks[i - 1].timestamp;
          if (interval < maxDoubleClickMs) {
            doubleClickIntervals.push(interval);
          }
        }
        if (doubleClickIntervals.length < 2) return 0;
        const std = MathUtils.standardDeviation(doubleClickIntervals);
        const mean = MathUtils.mean(doubleClickIntervals);
        if (std < 5 && doubleClickIntervals.length >= 3) {
          return 0.8;
        }
        if (mean < minDoubleClickMs) {
          return MathUtils.clamp01((minDoubleClickMs - mean) / minDoubleClickMs);
        }
        return 0;
      }

      analyzeNavigationPattern() {
        const keyEvents = this.keyboardBuffer.toArray();
        if (keyEvents.length < 5) return 0;
        const navEvents = keyEvents.filter((k) => k.isNavigationKey);
        if (navEvents.length < 3) return 0;
        const intervals = [];
        for (let i = 1; i < navEvents.length; i++) {
          intervals.push(navEvents[i].timestamp - navEvents[i - 1].timestamp);
        }
        const meanInterval = MathUtils.mean(intervals);
        const tooFast = intervals.filter((i) => i < 30).length;
        if (tooFast / intervals.length > 0.5) {
          return 0.7;
        }
        const entropy = MathUtils.entropy(intervals, 6);
        if (entropy < 0.15 && intervals.length > 5) {
          return 0.5;
        }
        return 0;
      }

      analyzeSessionBehavior() {
        const elapsed = performance.now() - this.startTime;
        if (elapsed < 1000) return 0;
        let score = 0;
        const mouseEvents = this.mouseBuffer.toArray();
        if (mouseEvents.length > 0) {
          const firstEventDelay = mouseEvents[0].timestamp - this.startTime;
          if (firstEventDelay < 50 && mouseEvents.length > 20) {
            score += 0.3;
          }
        }
        if (mouseEvents.length > 30) {
          const intervals = [];
          for (let i = 1; i < Math.min(mouseEvents.length, 100); i++) {
            intervals.push(mouseEvents[i].timestamp - mouseEvents[i - 1].timestamp);
          }
          const std = MathUtils.standardDeviation(intervals);
          const mean = MathUtils.mean(intervals);
          if (mean > 0 && std / mean < 0.05) {
            score += 0.4;
          }
        }
        const totalEvents = this.mouseBuffer.size + this.clickBuffer.size + this.keyboardBuffer.size;
        if (elapsed > 10000 && totalEvents === 0) {
          score += 0.2;
        }

        // Rate tracker checks
        const rateSnapshot = this.rateTracker.getSnapshot();
        const derivAnalysis = this.derivativeTracker.getAnalysis();

        // Suspiciously regular mouse event rate
        if (rateSnapshot.mouseRegularity < 0.05 && rateSnapshot.mouseRate > 30) {
          score += 0.4;
        }

        // Abnormally high click-to-mouse ratio
        if (rateSnapshot.mouseRate > 0 && rateSnapshot.clickRate / rateSnapshot.mouseRate > 0.5) {
          score += 0.3;
        }

        // Mouse rate burst detected
        if (derivAnalysis.mouseBurst) {
          score += 0.2;
        }

        // Mouse rate flatline detected
        if (derivAnalysis.mouseFlatline) {
          score += 0.3;
        }

        return MathUtils.clamp01(score);
      }

      // SCORING ENGINE
      computeWeightedScore(signals) {
        const weights = this.config.weights;
        let weightedSum = 0;
        let totalWeight = 0;
        const signalEntries = [
          ['mouseLinearity', signals.mouseLinearity, weights.mouseLinearity],
          ['mouseVelocityConsistency', signals.mouseVelocityConsistency, weights.mouseVelocityConsistency],
          ['mouseJitter', signals.mouseJitter, weights.mouseJitter],
          ['mouseCurvature', signals.mouseCurvature, weights.mouseCurvature],
          ['clickIntervalEntropy', signals.clickIntervalEntropy, weights.clickIntervalEntropy],
          ['clickMoveRatio', signals.clickMoveRatio, weights.clickMoveRatio],
          ['phantomClicks', signals.phantomClicks, weights.phantomClicks],
          ['doubleClickTiming', signals.doubleClickTiming, weights.doubleClickTiming],
          ['navigationPattern', signals.navigationPattern, weights.navigationPattern],
          ['sessionBehavior', signals.sessionBehavior, weights.sessionBehavior],
        ];
        for (const [_name, signal, weight] of signalEntries) {
          weightedSum += signal * weight;
          totalWeight += weight;
        }
        let score = totalWeight > 0 ? weightedSum / totalWeight : 0;
        score = this.applyAccessibilityAdjustments(score, signals);
        const confidence = this.calculateConfidence();
        if (confidence < 0.5) {
          score = score * confidence + 0.3 * (1 - confidence);
        }
        return MathUtils.clamp01(score);
      }

      applyAccessibilityAdjustments(score, _signals) {
        let adjustment = 0;
        if (this.keyboardOnlyNavigation) adjustment -= 0.3;
        if (this.hasTouchInput) adjustment -= 0.2;
        if (this.accessibilityIndicators.has('motor-impairment-pattern')) adjustment -= 0.25;
        if (this.accessibilityIndicators.has('switch-access-pattern')) adjustment -= 0.3;
        if (this.accessibilityIndicators.has('voice-control-pattern')) adjustment -= 0.2;
        if (this.config.accessibilityMode) adjustment -= 0.15;
        return MathUtils.clamp01(score + adjustment);
      }

      calculateConfidence() {
        const totalEvents = this.mouseBuffer.size + this.clickBuffer.size + this.keyboardBuffer.size;
        const elapsed = performance.now() - this.startTime;
        const eventConfidence = Math.min(1, totalEvents / 100);
        const timeConfidence = Math.min(1, elapsed / 5000);
        const inputTypes = (this.hasMouseInput ? 1 : 0) + (this.hasTouchInput ? 1 : 0) + (this.keyboardBuffer.size > 0 ? 1 : 0);
        const diversityConfidence = Math.min(1, inputTypes / 2);
        return eventConfidence * 0.5 + timeConfidence * 0.3 + diversityConfidence * 0.2;
      }

      calculateScore() {
        const totalEvents = this.mouseBuffer.size + this.clickBuffer.size + this.keyboardBuffer.size;
        if (totalEvents < this.config.minEventsForScore) return 0;
        const signals = this.calculateAllSignals();
        const score = this.computeWeightedScore(signals);
        this.scoreCache = score;
        return score;
      }

      invalidateScore() {
        this.scoreCache = null;
        if (this.scoreDebounceTimer !== null) {
          clearTimeout(this.scoreDebounceTimer);
        }
        this.scoreDebounceTimer = setTimeout(() => {
          this.calculateScore();
          this.scoreDebounceTimer = null;
        }, this.config.scoreDebounceMs);
      }

      // ACCESSIBILITY DETECTION
      detectMouseAccessibilityPatterns(event) {
        const recentEvents = this.mouseBuffer.getRecent(30);
        if (recentEvents.length < 10) return;
        const velocities = [];
        for (let i = 1; i < recentEvents.length; i++) {
          const dt = recentEvents[i].timestamp - recentEvents[i - 1].timestamp;
          if (dt > 0) {
            const dist = MathUtils.distance(recentEvents[i - 1].x, recentEvents[i - 1].y, recentEvents[i].x, recentEvents[i].y);
            velocities.push(dist / dt);
          }
        }
        if (velocities.length > 5) {
          const meanVelocity = MathUtils.mean(velocities);
          const stdVelocity = MathUtils.standardDeviation(velocities);
          if (meanVelocity < 0.3 && stdVelocity / (meanVelocity || 1) > 1.5) {
            this.accessibilityIndicators.add('motor-impairment-pattern');
          }
          const highVelocitySpikes = velocities.filter((v) => v > meanVelocity * 3).length;
          const pauseCount = velocities.filter((v) => v < 0.01).length;
          if (highVelocitySpikes / velocities.length > 0.3 && pauseCount / velocities.length > 0.2) {
            this.accessibilityIndicators.add('voice-control-pattern');
          }
        }
      }

      detectSwitchAccessPatterns() {
        const recentKeys = this.keyboardBuffer.getRecent(10);
        if (recentKeys.length < 5) return;
        const intervals = [];
        for (let i = 1; i < recentKeys.length; i++) {
          intervals.push(recentKeys[i].timestamp - recentKeys[i - 1].timestamp);
        }
        const meanInterval = MathUtils.mean(intervals);
        if (meanInterval > 1000 && meanInterval < 5000) {
          const std = MathUtils.standardDeviation(intervals);
          if (std / meanInterval < 0.5) {
            this.accessibilityIndicators.add('switch-access-pattern');
          }
        }
      }

      // UTILITY METHODS
      generateFlags(signals) {
        const flags = [];
        const flagThreshold = 0.6;
        if (signals.mouseLinearity > flagThreshold) flags.push('UNNATURALLY_STRAIGHT_PATHS');
        if (signals.mouseVelocityConsistency > flagThreshold) flags.push('CONSTANT_VELOCITY');
        if (signals.mouseJitter > flagThreshold) flags.push('ABNORMAL_JITTER');
        if (signals.mouseCurvature > flagThreshold) flags.push('PERFECT_CURVES');
        if (signals.clickIntervalEntropy > flagThreshold) flags.push('REGULAR_CLICK_TIMING');
        if (signals.clickMoveRatio > flagThreshold) flags.push('LOW_MOVE_TO_CLICK_RATIO');
        if (signals.phantomClicks > flagThreshold) flags.push('PHANTOM_CLICKS');
        if (signals.doubleClickTiming > flagThreshold) flags.push('UNNATURAL_DOUBLE_CLICKS');
        if (signals.navigationPattern > flagThreshold) flags.push('ROBOTIC_NAVIGATION');
        if (signals.sessionBehavior > flagThreshold) flags.push('SUSPICIOUS_SESSION_PATTERN');
        return flags;
      }

      detectInputModality() {
        const hasKeys = this.keyboardBuffer.size > 0;
        if (this.hasTouchInput && !this.hasMouseInput) return 'touch';
        if (this.hasMouseInput && !hasKeys && !this.hasTouchInput) return 'mouse';
        if (!this.hasMouseInput && hasKeys && !this.hasTouchInput) return 'keyboard';
        if ((this.hasMouseInput && hasKeys) || (this.hasTouchInput && hasKeys) || (this.hasMouseInput && this.hasTouchInput)) {
          return 'mixed';
        }
        return 'unknown';
      }

      applyAccessibilityRelaxations() {
        this.config.thresholds.linearityThreshold = 0.995;
        this.config.thresholds.velocityStdMinNormal = 5;
        this.config.thresholds.maxNaturalJitter = 100;
        this.config.thresholds.phantomClickRatioThreshold = 0.9;
        this.config.thresholds.minClickEntropy = 0.15;
        this.config.thresholds.minDoubleClickMs = 50;
      }

      mergeConfig(base, override) {
        return {
          ...base,
          ...override,
          weights: { ...base.weights, ...(override.weights || {}) },
          thresholds: { ...base.thresholds, ...(override.thresholds || {}) },
        };
      }
    }
