import { PageLoadBotDetector } from './PageLoadBotDetector.js';
import { BotDetector } from './BotDetector.js';

export { PageLoadBotDetector, BotDetector };

function setCookie(name, value, hours, path = '/', secure = false, sameSite = 'Lax') {
    console.log("Setting cookie: ", name, value, hours, path, secure, sameSite);
    const expires = new Date();
    expires.setTime(expires.getTime() + (hours * 60 * 60 * 1000)); // hours * 3,600,000 ms

    let cookieString = `${encodeURIComponent(name)}=${encodeURIComponent(value)}`;
    cookieString += `; expires=${expires.toUTCString()}`;
    cookieString += `; path=${path}`;
    cookieString += `; SameSite=${sameSite}`;

    if (secure) {
        cookieString += '; Secure';
    }

    document.cookie = cookieString;
    }

setCookie('validCaptcha', 'true', 1);

const pageLoadDetector = new PageLoadBotDetector();

function readPageLoadScore() {
  if (!pageLoadDetector.ready) {
    console.log("Page load detector not ready");
    return null;
  }
  const pageReport = pageLoadDetector.getReport();
  console.log("Page report: ", pageReport);
  return pageReport.score;
}

function pageLoadThreshold() {
  const raw = document.body?.dataset.pageLoadThreshold;
  const threshold = Number(raw);
  return Number.isFinite(threshold) ? threshold : 0.5;
}

function applyPageLoadCaptchaCookie() {
  if (!pageLoadDetector.ready) {
    return false;
  }
  const score = readPageLoadScore();
  const threshold = pageLoadThreshold();
  const valid = score < threshold ? 'false' : 'true';
  setCookie('isValidCaptcha', valid, 1);
  return true;
}

function watchPageLoadCaptcha() {
  if (applyPageLoadCaptchaCookie()) {
    return;
  }
  const timer = setInterval(() => {
    if (applyPageLoadCaptchaCookie()) {
      clearInterval(timer);
    }
  }, 50);
}

function startBotTrackerDemo() {
  console.log("DOMContentLoaded");
  watchPageLoadCaptcha();

  const detector = new BotDetector({ accessibilityMode: false, scoreDebounceMs: 200 });
  const scoreDisplay = document.getElementById('scoreDisplay');
  const signalBars = document.getElementById('signalBars');
  const flagsContainer = document.getElementById('flagsContainer');
  const metaInfo = document.getElementById('metaInfo');

  document.getElementById('btnStart').addEventListener('click', () => {
    detector.start();
    scoreDisplay.textContent = 'Monitoring...';
  });
  document.getElementById('btnStop').addEventListener('click', () => { detector.stop(); });
  document.getElementById('btnReset').addEventListener('click', () => {
    detector.reset();
    scoreDisplay.textContent = 'Reset - waiting for input...';
    scoreDisplay.className = 'score-display';
    signalBars.innerHTML = '';
    flagsContainer.innerHTML = '';
    metaInfo.textContent = '';
  });
  document.getElementById('accessibilityToggle').addEventListener('change', (e) => {
    detector.updateConfig({ accessibilityMode: e.target.checked });
  });

  setInterval(() => {
    const report = detector.getReport();
    console.log("Report:: ", report);
    if (report.eventCount === 0) return;
    const scorePercent = (report.score * 100).toFixed(1);
    scoreDisplay.textContent = `Score: ${scorePercent}% Bot Probability`;
    if (report.score < 0.3) {
      scoreDisplay.className = 'score-display score-human';
    } else if (report.score < 0.6) {
      scoreDisplay.className = 'score-display score-uncertain';
    } else {
      scoreDisplay.className = 'score-display score-bot';
    }
    const signalNames = {
      mouseLinearity: 'Mouse Linearity',
      mouseVelocityConsistency: 'Velocity Consistency',
      mouseJitter: 'Jitter Analysis',
      mouseCurvature: 'Path Curvature',
      clickIntervalEntropy: 'Click Entropy',
      clickMoveRatio: 'Click/Move Ratio',
      phantomClicks: 'Phantom Clicks',
      doubleClickTiming: 'Double-Click Timing',
      navigationPattern: 'Navigation Pattern',
      sessionBehavior: 'Session Behavior',
    };
    signalBars.innerHTML = Object.entries(report.signals).map(([key, value]) => {
      const color = value < 0.3 ? '#28a745' : value < 0.6 ? '#ffc107' : '#dc3545';
      return `
        <div class="signal-bar">
          <span class="signal-name">${signalNames[key] || key}</span>
          <div class="signal-track">
            <div class="signal-fill" style="width: ${value * 100}%; background: ${color}"></div>
          </div>
          <span class="signal-value">${(value * 100).toFixed(0)}%</span>
        </div>`;
    }).join('');
    flagsContainer.innerHTML = report.flags.map(f => `<span class="flag">${f}</span>`).join('');
    const ra = report.rateAnalysis || {};
    metaInfo.textContent = `Confidence: ${(report.confidence * 100).toFixed(0)}% | Events: ${report.eventCount} | Duration: ${(report.observationDuration / 1000).toFixed(1)}s | Input: ${report.inputModality} | Accessibility: ${report.accessibilityDetected ? 'Yes' : 'No'}\nMouse Rate: ${(ra.mouseRate || 0).toFixed(1)}/s | Click Rate: ${(ra.clickRate || 0).toFixed(1)}/s | Key Rate: ${(ra.keyboardRate || 0).toFixed(1)}/s | Mouse Δ: ${(ra.mouseDerivative || 0).toFixed(2)}/s² | Click Δ: ${(ra.clickDerivative || 0).toFixed(2)}/s² | Key Δ: ${(ra.keyboardDerivative || 0).toFixed(2)}/s²`;
  }, 500);

  detector.start();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startBotTrackerDemo);
} else {
  startBotTrackerDemo();
}
