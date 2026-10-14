import { PageLoadBotDetector } from './PageLoadBotDetector.js';
import { BotDetector } from './BotDetector.js';
import { NavigationRateDetector } from './NavigationRateDetector.js';

export { PageLoadBotDetector, BotDetector, NavigationRateDetector };

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
let botDetector = null;
let lastCaptchaCookie = null;

const navRateDetector = new NavigationRateDetector();
let botReportSent = false;

function readNavigationRateScore() {
  const navReport = navRateDetector.getReport();
  console.log("Navigation rate report: ", JSON.stringify(navReport));
  return navReport.score;
}

function botJsonUrl() {
  let path = window.location.pathname;
  if (path.length > 1 && path.endsWith('/')) {
    path = path.slice(0, -1);
  }
  if (path.endsWith('.html')) {
    path = path.slice(0, -'.html'.length);
  }
  if (path === '/' || path === '') {
    path = '/int/en';
  }
  return `${window.location.origin}${path}.bot.json`;
}

function reportBot() {
  if (botReportSent) {
    return;
  }
  botReportSent = true;
  fetch(botJsonUrl(), { method: 'GET', credentials: 'same-origin' });
}


function readPageLoadScore() {
  if (!pageLoadDetector.ready) {
    console.log("Page load detector not ready");
    return null;
  }
  const pageReport = pageLoadDetector.getReport();
  console.log("Page report: ", JSON.stringify(pageReport));
  return pageReport.score;
}

function thresholdFrom(datasetKey) {
  const raw = document.body?.dataset[datasetKey];
  const threshold = Number(raw);
  return Number.isFinite(threshold) ? threshold : 0.5;
}

function pageLoadThreshold() {
  return thresholdFrom('pageLoadThreshold');
}

function botThreshold() {
  return thresholdFrom('botThreshold');
}

function readBotScore() {
  if (!botDetector) {
    return null;
  }
  const report = botDetector.getReport();
  if (report.eventCount < botDetector.config.minEventsForScore) {
    return null;
  }
  return report.score;
}

function scoreIsValid(score, threshold) {
  return score < threshold;
}

function applyCaptchaCookie() {
  const pageScore = pageLoadDetector.ready ? pageLoadDetector.score : null;
  const navScore =  navRateDetector.score;
  
  if (navScore !== null && !scoreIsValid(navScore, pageLoadThreshold())) {
    setCookie('isValidCaptcha', 'false', 1);
    reportBot();
    return pageLoadDetector.ready;
  }
  const botScore = readBotScore();
  if (pageScore === null && botScore === null) {
    return false;
  }

  if (pageScore !== null && !scoreIsValid(pageScore, pageLoadThreshold())) {
    setCookie('isValidCaptcha', 'false', 1);
    reportBot();
    return pageLoadDetector.ready;
  }

  if (botScore !== null) {
    const isHuman = scoreIsValid(botScore, botThreshold());
    if (!isHuman) {
      setCookie('isValidCaptcha', 'false', 1);
      reportBot();
    } else {
      setCookie('isValidCaptcha', 'true', 1);
    }
  }

  return pageLoadDetector.ready;
}

function applyPageLoadCaptchaCookie() {
  if (!pageLoadDetector.ready) {
    return false;
  }
  readPageLoadScore();
  readNavigationRateScore();
  return applyCaptchaCookie();
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
  botDetector = detector;

  const scoreDisplay = document.getElementById('scoreDisplay');
  const signalBars = document.getElementById('signalBars');
  const flagsContainer = document.getElementById('flagsContainer');
  const metaInfo = document.getElementById('metaInfo');
  const btnStart = document.getElementById('btnStart');
  const btnStop = document.getElementById('btnStop');
  const btnReset = document.getElementById('btnReset');
  const accessibilityToggle = document.getElementById('accessibilityToggle');
  const hasDemo = scoreDisplay && signalBars && flagsContainer && metaInfo && btnStart && btnStop && btnReset && accessibilityToggle;

  if (!hasDemo) {
    detector.start();
    setInterval(() => applyCaptchaCookie(), 500);
    return;
  }

  btnStart.addEventListener('click', () => {
    detector.start();
    scoreDisplay.textContent = 'Monitoring...';
  });
  btnStop.addEventListener('click', () => { detector.stop(); });
  btnReset.addEventListener('click', () => {
    detector.reset();
    scoreDisplay.textContent = 'Reset - waiting for input...';
    scoreDisplay.className = 'score-display';
    signalBars.innerHTML = '';
    flagsContainer.innerHTML = '';
    metaInfo.textContent = '';
  });
  accessibilityToggle.addEventListener('change', (e) => {
    detector.updateConfig({ accessibilityMode: e.target.checked });
  });

  setInterval(() => {
    const report = detector.getReport();
    console.log("Report:: ", report);
    if (report.eventCount === 0) return;
    applyCaptchaCookie();
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
