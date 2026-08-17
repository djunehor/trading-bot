import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('UI TypeScript - Verify index.html contains essential dashboard elements', () => {
  const htmlPath = path.join(__dirname, '../public/index.html');
  const htmlContent = fs.readFileSync(htmlPath, 'utf8');

  // Verify Account Switcher Buttons
  assert.ok(htmlContent.includes('id="modePaperBtn"'), 'Paper mode button exists');
  assert.ok(htmlContent.includes('id="modeLiveBtn"'), 'Live mode button exists');

  // Verify Account Overview Metrics
  assert.ok(htmlContent.includes('id="metricEquity"'), 'Equity metric exists');
  assert.ok(htmlContent.includes('id="metricBuyingPower"'), 'Buying Power metric exists');
  assert.ok(htmlContent.includes('id="metricCash"'), 'Cash metric exists');

  // Verify Bot Control Forms (Stock Bot & Crypto Bot)
  assert.ok(htmlContent.includes('id="startStockBotBtn"'), 'Start Stock bot button exists');
  assert.ok(htmlContent.includes('id="stopStockBotBtn"'), 'Stop Stock bot button exists');
  assert.ok(htmlContent.includes('id="startCryptoBotBtn"'), 'Start Crypto bot button exists');
  assert.ok(htmlContent.includes('id="stopCryptoBotBtn"'), 'Stop Crypto bot button exists');

  // Verify Tables
  assert.ok(htmlContent.includes('id="positionsTableBody"'), 'Positions table exists');
  assert.ok(htmlContent.includes('id="ordersTableBody"'), 'Orders table exists');
});

test('UI TypeScript - Verify CSS styling rules for responsive design & mode colors', () => {
  const cssPath = path.join(__dirname, '../public/styles.css');
  const cssContent = fs.readFileSync(cssPath, 'utf8');

  assert.ok(cssContent.includes('--color-paper'), 'Paper mode color variable defined');
  assert.ok(cssContent.includes('--color-live'), 'Live mode color variable defined');
  assert.ok(cssContent.includes('@media (max-width: 992px)'), 'Mobile responsive query defined');
});

test('UI TypeScript - Verify stream chart container & scrollable legend styling', () => {
  const cssPath = path.join(__dirname, '../public/styles.css');
  const cssContent = fs.readFileSync(cssPath, 'utf8');
  const htmlPath = path.join(__dirname, '../public/index.html');
  const htmlContent = fs.readFileSync(htmlPath, 'utf8');
  const jsPath = path.join(__dirname, '../public/app.js');
  const jsContent = fs.readFileSync(jsPath, 'utf8');

  // Verify CSS rules
  assert.ok(cssContent.includes('.stream-chart-wrapper'), 'stream-chart-wrapper class defined');
  assert.ok(cssContent.includes('.stream-chart-legend'), 'stream-chart-legend class defined');
  assert.ok(cssContent.includes('overflow-y: auto'), 'Legend has scrollable overflow-y');
  assert.ok(cssContent.includes('.stream-legend-item'), 'stream-legend-item class defined');

  // Verify HTML does not leak with overflow: visible
  assert.ok(
    !htmlContent.includes('<!-- Section: P/L Streamgraph -->\n      <section class="card full-width-card" style="overflow: visible;">'),
    'P/L Stream card does not leak overflow',
  );

  assert.ok(jsContent.includes("wrapper.className = 'stream-chart-wrapper'"), 'app.js creates stream-chart-wrapper');
  assert.ok(jsContent.includes("legendBox.className = 'stream-chart-legend'"), 'app.js creates stream-chart-legend');
  assert.ok(jsContent.includes("item.className = 'stream-legend-item'"), 'app.js creates stream-legend-item');
});

test('UI TypeScript - Verify Manual Order card grid alignment with Bot cards', () => {
  const cssPath = path.join(__dirname, '../public/styles.css');
  const cssContent = fs.readFileSync(cssPath, 'utf8');

  assert.ok(cssContent.includes('.trade-card {'), 'trade-card class defined');
  assert.ok(cssContent.includes('grid-row: span 2;'), 'trade-card spans 2 rows');
  assert.ok(cssContent.includes('.trade-card { grid-column: span 12; grid-row: auto; }'), 'trade-card resets on responsive viewport');
});

test('UI TypeScript - Verify Portfolio Allocation card has full width', () => {
  const cssPath = path.join(__dirname, '../public/styles.css');
  const cssContent = fs.readFileSync(cssPath, 'utf8');
  const htmlPath = path.join(__dirname, '../public/index.html');
  const htmlContent = fs.readFileSync(htmlPath, 'utf8');

  assert.ok(cssContent.includes('.allocation-card,'), 'allocation-card full width in CSS');
  assert.ok(htmlContent.includes('class="card allocation-card full-width-card"'), 'allocation-card has full-width-card class in HTML');
  assert.ok(!htmlContent.includes('style="grid-template-columns: repeat(3, 1fr);"'), 'No hardcoded inline 3-col style on allocation grid');
  assert.ok(
    cssContent.includes('.allocation-card .metrics-grid { grid-template-columns: 1fr !important; gap: 0.5rem; }'),
    'allocation grid collapses to 1fr on mobile',
  );
});

test('UI TypeScript - Verify full mobile responsiveness and SVG chart scaling', () => {
  const cssPath = path.join(__dirname, '../public/styles.css');
  const cssContent = fs.readFileSync(cssPath, 'utf8');
  const jsPath = path.join(__dirname, '../public/app.js');
  const jsContent = fs.readFileSync(jsPath, 'utf8');

  // Verify page horizontal overflow prevention
  assert.ok(cssContent.includes('overflow-x: hidden;'), 'overflow-x hidden prevents page horizontal overflow');

  // Verify SVG viewBox and preserveAspectRatio
  assert.ok(jsContent.includes("attr('viewBox'"), 'SVG uses responsive viewBox');
  assert.ok(jsContent.includes("attr('preserveAspectRatio', 'xMidYMid meet')"), 'SVG preserves aspect ratio');
  assert.ok(jsContent.includes('ResizeObserver'), 'ResizeObserver used for responsive container resize');
});

test('UI TypeScript - Verify Market Clock elements and countdown renderers', () => {
  const htmlPath = path.join(__dirname, '../public/index.html');
  const htmlContent = fs.readFileSync(htmlPath, 'utf8');
  const jsPath = path.join(__dirname, '../public/app.js');
  const jsContent = fs.readFileSync(jsPath, 'utf8');

  assert.ok(htmlContent.includes('id="marketStatusBadge"'), 'Status badge exists');
  assert.ok(htmlContent.includes('id="marketCountdownHours"'), 'Hours digit exists');
  assert.ok(htmlContent.includes('id="marketCountdownMinutes"'), 'Minutes digit exists');
  assert.ok(htmlContent.includes('id="marketCountdownSeconds"'), 'Seconds digit exists');
  assert.ok(htmlContent.includes('id="marketNextEventTime"'), 'Next event time label exists');

  assert.ok(jsContent.includes('function renderCountdown'), 'renderCountdown defined in app.js');
  assert.ok(jsContent.includes('function startMarketCountdown'), 'startMarketCountdown defined in app.js');
});

after(async () => {
  const { cacheService } = await import('../src/services/cacheService.js');
  await cacheService.close();
});

