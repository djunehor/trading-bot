document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const modePaperBtn = document.getElementById('modePaperBtn');
  const modeLiveBtn = document.getElementById('modeLiveBtn');
  const liveWarningBanner = document.getElementById('liveWarningBanner');
  const refreshDashboardBtn = document.getElementById('refreshDashboardBtn');

  const metricEquity = document.getElementById('metricEquity');
  const metricBuyingPower = document.getElementById('metricBuyingPower');
  const metricCash = document.getElementById('metricCash');
  const metricUnrealizedPl = document.getElementById('metricUnrealizedPl');
  const metricRealizedPl = document.getElementById('metricRealizedPl');
  const metricStatus = document.getElementById('metricStatus');

  const sentimentTableBody = document.getElementById('sentimentTableBody');

  const startStockBotBtn = document.getElementById('startStockBotBtn');
  const stopStockBotBtn = document.getElementById('stopStockBotBtn');
  const stockBotStateBadge = document.getElementById('stockBotStateBadge');
  const stockBotLogsList = document.getElementById('stockBotLogsList');

  const startCryptoBotBtn = document.getElementById('startCryptoBotBtn');
  const stopCryptoBotBtn = document.getElementById('stopCryptoBotBtn');
  const cryptoBotStateBadge = document.getElementById('cryptoBotStateBadge');
  const cryptoBotLogsList = document.getElementById('cryptoBotLogsList');

  const manualOrderForm = document.getElementById('manualOrderForm');
  const orderTypeSelect = document.getElementById('orderType');
  const limitPriceGroup = document.getElementById('limitPriceGroup');

  const positionsTableBody = document.getElementById('positionsTableBody');
  const ordersTableBody = document.getElementById('ordersTableBody');

  let currentMode = 'paper';

  // Open positions sort state
  let positionsSort = { key: 'unrealized_pl', dir: 'desc' };
  let lastPositions = [];

  // Toast Notification System
  function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    let icon = 'ℹ️';
    if (type === 'success') icon = '✅';
    else if (type === 'error') icon = '❌';

    toast.innerHTML = `<span style="font-size: 1.1rem;">${icon}</span><span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      toast.style.transition = 'all 0.3s ease-in';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  // Promise-based Action Confirmation Modal
  function showConfirmModal(title, message, confirmText = 'Confirm', isDanger = false) {
    return new Promise((resolve) => {
      const modal = document.getElementById('confirmModal');
      const modalTitle = document.getElementById('modalTitle');
      const modalMessage = document.getElementById('modalMessage');
      const confirmBtn = document.getElementById('modalConfirmBtn');
      const cancelBtn = document.getElementById('modalCancelBtn');

      modalTitle.textContent = title;
      modalMessage.innerHTML = message;
      confirmBtn.textContent = confirmText;
      confirmBtn.className = isDanger ? 'btn btn-danger btn-sm' : 'btn btn-primary btn-sm';

      modal.classList.remove('hidden');

      const handleConfirm = () => {
        cleanup();
        resolve(true);
      };

      const handleCancel = () => {
        cleanup();
        resolve(false);
      };

      const cleanup = () => {
        modal.classList.add('hidden');
        confirmBtn.removeEventListener('click', handleConfirm);
        cancelBtn.removeEventListener('click', handleCancel);
      };

      confirmBtn.addEventListener('click', handleConfirm);
      cancelBtn.addEventListener('click', handleCancel);
    });
  }

  // Formatting helpers
  const formatUSD = (amount) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount || 0);
  };

  const stockLink = (symbol) => {
    const isCrypto = symbol.includes('/');
    const query = isCrypto ? symbol.toLowerCase() : `\$${symbol}+ticker`;
    return `<a href="https://www.google.com/search?q=${encodeURIComponent(query)}" target="_blank" rel="noopener" style="color: #f59e0b;">${symbol}</a>`;
  };

  const formatDate = (isoString) => {
    if (!isoString) return 'N/A';
    return new Date(isoString).toLocaleString();
  };

  // ── Market Clock ──────────────────────────────────────────────
  let marketCountdownInterval = null;
  let marketNextEventMs = 0;
  let marketNextEventType = 'market_open';
  let marketNextEventTime = null;

  async function refreshMarketClock() {
    try {
      const res = await fetch('/api/market/clock');
      if (!res.ok) return;
      const data = await res.json();

      marketNextEventMs = data.countdown.totalMs;
      marketNextEventType = data.nextEvent;
      marketNextEventTime = data.nextEventTime;

      updateMarketClockDisplay(data);
    } catch (err) {
      console.error('Error fetching market clock:', err);
    }
  }

  function updateMarketClockDisplay(data) {
    const badge = document.getElementById('marketStatusBadge');
    const label = document.getElementById('marketStatusLabel');
    const nextEventLabel = document.getElementById('marketNextEventLabel');
    const nextEventTimeEl = document.getElementById('marketNextEventTime');

    if (!badge || !label) return;

    switch (data.marketStatus) {
      case 'regular-hours':
        badge.textContent = '🟢 OPEN';
        badge.className = 'status-badge status-active';
        label.textContent = 'US Stock Market is OPEN — Regular Trading Hours';
        break;
      case 'pre-market':
        badge.textContent = '🟡 PRE-MARKET';
        badge.className = 'status-badge status-pending';
        label.textContent = 'Market opens soon — Pre-market session active';
        break;
      case 'after-hours':
        badge.textContent = '🟡 AFTER HOURS';
        badge.className = 'status-badge status-pending';
        label.textContent = 'Regular session closed — After-hours trading active';
        break;
      case 'extended-weekend':
      case 'closed':
        badge.textContent = '🔴 CLOSED';
        badge.className = 'status-badge status-off';
        label.textContent = 'US Stock Market is CLOSED';
        break;
    }

    if (nextEventLabel) {
      nextEventLabel.textContent = data.nextEvent === 'market_close'
        ? '⏳ Countdown to Market Close'
        : '⏳ Countdown to Next Market Open';
    }

    if (nextEventTimeEl && data.nextEventTime) {
      nextEventTimeEl.textContent = new Date(data.nextEventTime).toLocaleString('en-US', {
        timeZone: 'America/New_York',
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZoneName: 'short'
      });
    }

    renderCountdown(data.countdown);
  }

  function renderCountdown(countdown) {
    const hEl = document.getElementById('marketCountdownHours');
    const mEl = document.getElementById('marketCountdownMinutes');
    const sEl = document.getElementById('marketCountdownSeconds');

    const pad = (n) => String(n).padStart(2, '0');

    if (hEl) hEl.textContent = pad(countdown.hours);
    if (mEl) mEl.textContent = pad(countdown.minutes);
    if (sEl) sEl.textContent = pad(countdown.seconds);
  }

  function startMarketCountdown() {
    if (marketCountdownInterval) clearInterval(marketCountdownInterval);

    marketCountdownInterval = setInterval(() => {
      if (marketNextEventMs <= 0) {
        // Time's up — refetch from server to get fresh data
        refreshMarketClock();
        return;
      }

      marketNextEventMs -= 1000;
      const totalSeconds = Math.floor(marketNextEventMs / 1000);
      const h = Math.floor(totalSeconds / 3600);
      const m = Math.floor((totalSeconds % 3600) / 60);
      const s = totalSeconds % 60;

      renderCountdown({ hours: h, minutes: m, seconds: s });

      if (marketNextEventMs <= 0) {
        // Refetch when countdown hits zero to transition to next state
        setTimeout(() => refreshMarketClock(), 1500);
      }
    }, 1000);
  }

  // ── P/L Steamgraph (D3) ────────────────────────────────────────
  // 22 perceptually-distinct categorical colors — one per symbol, no repeats
  const STREAM_PALETTE = [
    '#60a5fa','#34d399','#f87171','#fbbf24','#a78bfa','#fb923c','#38bdf8',
    '#4ade80','#f472b6','#facc15','#818cf8','#2dd4bf','#fb7185','#86efac',
    '#c084fc','#fdba74','#67e8f9','#a3e635','#e879f9','#fcd34d','#94a3b8','#f9a8d4'
  ];

  // Toggle state: 'pct' or 'usd'
  let streamMode = 'pct';
  let _lastStreamRaw = null;

  const streamModePctBtn = document.getElementById('streamModePct');
  const streamModeUsdBtn = document.getElementById('streamModeUsd');
  const streamTotalDisplay = document.getElementById('streamTotalDisplay');

  if (streamModePctBtn) streamModePctBtn.addEventListener('click', () => {
    if (streamMode === 'pct') return;
    streamMode = 'pct';
    streamModePctBtn.className = 'toggle-btn active-paper';
    streamModeUsdBtn.className = 'toggle-btn';
    if (_lastStreamRaw) renderStreamChart(_lastStreamRaw);
  });
  if (streamModeUsdBtn) streamModeUsdBtn.addEventListener('click', () => {
    if (streamMode === 'usd') return;
    streamMode = 'usd';
    streamModeUsdBtn.className = 'toggle-btn active-paper';
    streamModePctBtn.className = 'toggle-btn';
    if (_lastStreamRaw) renderStreamChart(_lastStreamRaw);
  });

  async function refreshStreamChart() {
    try {
      const res = await fetch('/api/account/equity-history?limit=200');
      if (!res.ok) return;
      const raw = await res.json();
      if (!Array.isArray(raw) || raw.length < 2) return;
      _lastStreamRaw = raw;
      renderStreamChart(raw);
    } catch (err) {
      console.error('Stream chart error:', err);
    }
  }

  function renderStreamChart(raw) {
    try {
      const isUsd = streamMode === 'usd';

      // ── 1. Symbols ──────────────────────────────────────────────
      const symbolSet = new Set();
      raw.forEach(d => (d.positions || []).forEach(p => symbolSet.add(p.symbol)));
      const symbols = [...symbolSet];
      if (symbols.length === 0) return;

      // Assign one unique color per symbol (by index, not by win/loss)
      const colorMap = {};
      symbols.forEach((sym, i) => {
        colorMap[sym] = STREAM_PALETTE[i % STREAM_PALETTE.length];
      });

      // ── Cap for USD mode: prevent one huge position from blowing out the scale ──
      // Compute 95th percentile of absolute dollar P/L across all snapshots.
      // Values above this cap get clamped so all streams remain visible.
      let usdCap = Infinity;
      if (isUsd) {
        const allAbsUsd = [];
        raw.forEach(snap => {
          (snap.positions || []).forEach(p => allAbsUsd.push(Math.abs(p.pl)));
        });
        if (allAbsUsd.length > 0) {
          allAbsUsd.sort((a, b) => a - b);
          const p95Idx = Math.floor(allAbsUsd.length * 0.95);
          usdCap = Math.max(allAbsUsd[p95Idx] || 0, 1); // at least $1 so thin streams aren't crushed
        }
      }

      // ── 2. Build rows ───────────────────────────────────────────
      // Each symbol value = its own dollar P/L or % P/L relative to cost basis
      // We always use the raw signed value (positive = gain, negative = loss)
      const rows = raw.map(snap => {
        // Convert UTC snapshot time to Europe/Berlin for display
        const utcMs = new Date(snap.time).getTime();
        const berlinOffsetMs = 2 * 60 * 60 * 1000; // CEST = UTC+2
        const row = { time: new Date(utcMs + berlinOffsetMs) };
        row._usd = {};
        row._pct = {};
        const positions = snap.positions || [];

        symbols.forEach(sym => {
          const pos = positions.find(p => p.symbol === sym);
          if (pos) {
            const dollarPl = pos.pl;
            const costBasis = Math.abs(pos.mv - pos.pl);
            // % = position's own return vs cost basis, clamped to ±50%
            const pctPl = costBasis > 0.01
              ? Math.max(-50, Math.min(50, (dollarPl / costBasis) * 100))
              : 0;
            row._usd[sym] = dollarPl;
            row._pct[sym] = pctPl;
            row[sym] = isUsd ? Math.max(-usdCap, Math.min(usdCap, dollarPl)) : pctPl;
          } else {
            row[sym] = 0;
            row._usd[sym] = 0;
            row._pct[sym] = 0;
          }
        });

        row._totalUsd = positions.reduce((acc, p) => acc + p.pl, 0);
        return row;
      });

      // ── 3. Latest values for legend & header ───────────────────
      const lastSnap = raw[raw.length - 1];
      const lastPositions = lastSnap.positions || [];
      const latestPlMapUsd = {};
      const latestPlMapPct = {};
      lastPositions.forEach(p => {
        latestPlMapUsd[p.symbol] = p.pl;
        const cb = Math.abs(p.mv - p.pl);
        latestPlMapPct[p.symbol] = cb > 0.01
          ? Math.max(-50, Math.min(50, (p.pl / cb) * 100))
          : 0;
      });

      const totalUsd = lastPositions.reduce((acc, p) => acc + p.pl, 0);
      // Weighted-average % across positions (sum of each position's % weighted by abs cost basis)
      let totalWeightedPct = 0;
      let totalCostBasis = 0;
      lastPositions.forEach(p => {
        const cb = Math.abs(p.mv - p.pl);
        if (cb > 0.01) { totalWeightedPct += p.pl; totalCostBasis += cb; }
      });
      const totalPct = totalCostBasis > 0 ? (totalWeightedPct / totalCostBasis) * 100 : 0;

      // Header total — use the snapshot's all-time P/L, not just unrealized position sum
      const lastPl = lastSnap.pl || 0;
      if (streamTotalDisplay) {
        const totalCol = lastPl >= 0 ? '#34d399' : '#f87171';
        if (isUsd) {
          const sign = lastPl >= 0 ? '+' : '';
          streamTotalDisplay.innerHTML =
            `All-Time P/L: <span style="color:${totalCol}">${sign}\$${Math.abs(lastPl).toFixed(2)}</span>`;
        } else {
          const pct = (lastPl / 100000) * 100;
          const sign = pct >= 0 ? '+' : '';
          streamTotalDisplay.innerHTML =
            `All-Time P/L: <span style="color:${totalCol}">${sign}${pct.toFixed(2)}%</span>`;
        }
      }

      // ── 4. D3 stack with silhouette offset (zero-centered) ──────
      // stackOffsetSilhouette centers the wiggle on zero so we can draw
      // a meaningful zero line at the midpoint
      const stack = d3.stack()
        .keys(symbols)
        .offset(d3.stackOffsetWiggle)
        .order(d3.stackOrderInsideOut);
      const series = stack(rows);

      // ── 5. Render ───────────────────────────────────────────────
      const container = document.getElementById('streamChartContainer');
      if (!container) return;
      container.innerHTML = '';

      const wrapper = document.createElement('div');
      wrapper.className = 'stream-chart-wrapper';
      container.appendChild(wrapper);

      const chartBox = document.createElement('div');
      chartBox.className = 'stream-chart-svg-container';
      wrapper.appendChild(chartBox);

      const legendBox = document.createElement('div');
      legendBox.className = 'stream-chart-legend';
      wrapper.appendChild(legendBox);

      // Measure true container dimensions with mobile detection
      const isMobile = window.innerWidth <= 768;
      const isSmallMobile = window.innerWidth <= 480;

      const rect = chartBox.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const measuredW = rect.width > 0 ? rect.width : (containerRect.width > 0 ? containerRect.width : container.clientWidth);
      const totalW = Math.max(260, Math.floor(measuredW || (window.innerWidth - (isSmallMobile ? 20 : 48))));

      const defaultH = isSmallMobile ? 200 : isMobile ? 260 : 420;
      let totalH = rect.height > 0 ? rect.height : chartBox.clientHeight;
      if (!totalH || totalH < 150) totalH = defaultH;

      const isCompact = totalW < 560;
      const margin = isCompact
        ? { top: 12, right: 38, bottom: 26, left: 34 }
        : { top: 16, right: 54, bottom: 32, left: 48 };

      const W = Math.max(60, totalW - margin.left - margin.right);
      const H = Math.max(60, totalH - margin.top - margin.bottom);

      const svg = d3.select(chartBox)
        .append('svg')
        .attr('viewBox', `0 0 ${totalW} ${totalH}`)
        .attr('preserveAspectRatio', 'xMidYMid meet')
        .style('width', '100%')
        .style('height', '100%')
        .style('display', 'block')
        .style('overflow', 'hidden');

      const g = svg.append('g')
        .attr('transform', `translate(${margin.left},${margin.top})`);

      const xScale = d3.scaleTime()
        .domain(d3.extent(rows, d => d.time))
        .range([0, W]);

      const yMin = d3.min(series, layer => d3.min(layer, d => d[0]));
      const yMax = d3.max(series, layer => d3.max(layer, d => d[1]));
      const yScale = d3.scaleLinear()
        .domain([yMin, yMax])
        .range([H, 0]);

      const area = d3.area()
        .x((d, i) => xScale(rows[i].time))
        .y0(d => yScale(d[0]))
        .y1(d => yScale(d[1]))
        .curve(d3.curveCatmullRom.alpha(0.5));

      // ── Y Axis ──────────────────────────────────────────────────
      // The stacked wiggle y-axis values are internal units — not directly
      // interpretable as $ or %. We label the axis with the mode unit but
      // note its a relative scale. The key visual cue is the zero line.
      const yAxisFmt = isUsd
        ? v => `$${v >= 0 ? '+' : ''}${v.toFixed(0)}`
        : v => `${v >= 0 ? '+' : ''}${v.toFixed(1)}`;

      const yAxisG = g.append('g')
        .call(
          d3.axisLeft(yScale)
            .ticks(5)
            .tickFormat(yAxisFmt)
            .tickSize(-W)
        );
      yAxisG.select('.domain').remove();
      yAxisG.selectAll('text')
        .attr('fill', '#64748b')
        .attr('font-size', '9px')
        .attr('font-family', 'Inter, sans-serif')
        .attr('x', -6);
      yAxisG.selectAll('line')
        .attr('stroke', 'rgba(51,65,85,0.2)')
        .attr('stroke-dasharray', '3,3');

      // Zero line — find where y=0 maps on the stacked scale
      // With wiggle offset, zero is near the center of the chart
      const zeroY = yScale((yMin + yMax) / 2);
      g.append('line')
        .attr('x1', 0).attr('x2', W)
        .attr('y1', zeroY).attr('y2', zeroY)
        .attr('stroke', 'rgba(148,163,184,0.55)')
        .attr('stroke-width', 1.5)
        .attr('stroke-dasharray', '2,4')
        .style('pointer-events', 'none');

      // Zero label
      g.append('text')
        .attr('x', -4).attr('y', zeroY + 3)
        .attr('text-anchor', 'end')
        .attr('fill', '#94a3b8')
        .attr('font-size', '9px')
        .attr('font-family', 'Inter, sans-serif')
        .text('0');

      // ── Streams ─────────────────────────────────────────────────
      function highlightLabel(key, active) {
        legendBox.querySelectorAll('.stream-legend-item').forEach(item => {
          const sym = item.dataset.symbol;
          if (!active) {
            item.classList.remove('dimmed', 'active');
          } else if (sym === key) {
            item.classList.add('active');
            item.classList.remove('dimmed');
            item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          } else {
            item.classList.add('dimmed');
            item.classList.remove('active');
          }
        });
      }

      const paths = g.selectAll('.stream')
        .data(series).enter()
        .append('path')
        .attr('class', 'stream')
        .attr('d', area)
        .attr('fill', d => colorMap[d.key])
        .attr('fill-opacity', 0.82)
        .attr('stroke', d => colorMap[d.key])
        .attr('stroke-width', 0.5)
        .attr('stroke-opacity', 0.4)
        .style('cursor', 'pointer')
        .on('mouseover', function(event, d) {
          d3.selectAll('.stream').attr('fill-opacity', 0.18);
          d3.select(this).attr('fill-opacity', 1).raise();
          highlightLabel(d.key, true);
        })
        .on('mouseout', function() {
          d3.selectAll('.stream').attr('fill-opacity', 0.82);
          highlightLabel(null, false);
        });

      // Entry animation
      paths.each(function() {
        const len = this.getTotalLength ? this.getTotalLength() : 0;
        d3.select(this)
          .attr('stroke-dasharray', `${len} ${len}`)
          .attr('stroke-dashoffset', len)
          .transition().duration(1000).ease(d3.easeCubicInOut)
          .attr('stroke-dashoffset', 0)
          .on('end', function() {
            d3.select(this).attr('stroke-dasharray', null).attr('stroke-dashoffset', null);
          });
      });

      // ── X Axis ─────────────────────────────────────────────────
      const tickCount = isCompact ? 4 : 8;
      const xAxis = g.append('g')
        .attr('transform', `translate(0,${H})`)
        .call(
          d3.axisBottom(xScale).ticks(tickCount)
            .tickFormat(d => d3.timeFormat('%-I:%M %p')(d).toLowerCase())
        );
      xAxis.select('.domain').attr('stroke', 'rgba(148,163,184,0.3)');
      xAxis.selectAll('text').attr('fill', '#94a3b8').attr('font-size', isCompact ? '9px' : '10px').attr('font-family', 'Inter, sans-serif');
      xAxis.selectAll('line').attr('stroke', 'rgba(148,163,184,0.3)');

      // ── HTML Scrollable Legend ──────────────────────────────────
      const sortedSymbols = [...symbols].sort((a, b) => (latestPlMapUsd[b] || 0) - (latestPlMapUsd[a] || 0));
      sortedSymbols.forEach(sym => {
        const item = document.createElement('div');
        item.className = 'stream-legend-item';
        item.dataset.symbol = sym;

        const usd = latestPlMapUsd[sym];
        const pct = latestPlMapPct[sym];
        const plCol = (usd || 0) >= 0 ? '#34d399' : '#f87171';
        let valStr = '';
        if (usd != null) {
          if (isUsd) {
            const sign = usd >= 0 ? '+' : '-';
            valStr = `${sign}$${Math.abs(usd).toFixed(2)}`;
          } else {
            const sign = pct >= 0 ? '+' : '-';
            valStr = `${sign}${Math.abs(pct).toFixed(2)}%`;
          }
        }

        const leftWrap = document.createElement('div');
        leftWrap.className = 'stream-legend-symbol-wrap';

        const swatch = document.createElement('span');
        swatch.className = 'stream-legend-swatch';
        swatch.style.backgroundColor = colorMap[sym] || '#94a3b8';

        const symLabel = document.createElement('span');
        symLabel.className = 'stream-legend-symbol';
        symLabel.textContent = sym;

        leftWrap.appendChild(swatch);
        leftWrap.appendChild(symLabel);

        const valLabel = document.createElement('span');
        valLabel.className = 'stream-legend-value';
        valLabel.style.color = plCol;
        valLabel.textContent = valStr;

        item.appendChild(leftWrap);
        item.appendChild(valLabel);

        item.addEventListener('mouseenter', () => {
          d3.selectAll('.stream').attr('fill-opacity', 0.18);
          d3.selectAll('.stream').filter(d => d.key === sym).attr('fill-opacity', 1).raise();
          highlightLabel(sym, true);
        });
        item.addEventListener('mouseleave', () => {
          d3.selectAll('.stream').attr('fill-opacity', 0.82);
          highlightLabel(null, false);
        });

        legendBox.appendChild(item);
      });

      // ── Equity Line Overlay (all-time P/L) ────────────────────
      const equityData = raw.map(s => ({
        time: new Date(new Date(s.time).getTime() + 2 * 60 * 60 * 1000), // CEST
        pl: s.pl || 0
      }));

      // Right-side y-scale for real equity P/L
      const equityMin = d3.min(equityData, d => d.pl);
      const equityMax = d3.max(equityData, d => d.pl);
      const padding = (equityMax - equityMin) * 0.1 || 100;
      const equityYScale = d3.scaleLinear()
        .domain([equityMin - padding, equityMax + padding])
        .range([H, 0]);

      // Right axis
      const equityAxisFmt = isUsd
        ? v => `\$${v >= 0 ? '+' : ''}${v.toFixed(0)}`
        : v => `${v >= 0 ? '+' : ''}${((v / 100000) * 100).toFixed(1)}%`;
      g.append('g')
        .attr('transform', `translate(${W},0)`)
        .call(d3.axisRight(equityYScale).ticks(4).tickFormat(equityAxisFmt))
        .selectAll('text')
        .attr('fill', '#e2e8f0')
        .attr('font-size', '9px')
        .attr('font-family', 'Inter, sans-serif');

      // Equity line
      const equityLine = d3.line()
        .x(d => xScale(d.time))
        .y(d => equityYScale(d.pl))
        .curve(d3.curveCatmullRom.alpha(0.5));

      g.append('path')
        .datum(equityData)
        .attr('fill', 'none')
        .attr('stroke', '#e2e8f0')
        .attr('stroke-width', 2)
        .attr('stroke-linecap', 'round')
        .attr('d', equityLine)
        .style('pointer-events', 'none');

      // ── Crosshair + Tooltip ────────────────────────────────────
      const tooltip = d3.select(chartBox)
        .append('div')
        .style('position', 'absolute')
        .style('pointer-events', 'none')
        .style('opacity', 0)
        .style('background', 'rgba(15,23,42,0.95)')
        .style('border', '1px solid rgba(148,163,184,0.2)')
        .style('border-radius', '8px')
        .style('padding', '10px 14px')
        .style('font-family', 'Inter, sans-serif')
        .style('font-size', '11px')
        .style('color', '#e2e8f0')
        .style('max-width', '240px')
        .style('backdrop-filter', 'blur(8px)')
        .style('z-index', '10')
        .style('box-shadow', '0 8px 32px rgba(0,0,0,0.6)');

      const crosshair = g.append('line')
        .attr('y1', 0).attr('y2', H)
        .attr('stroke', 'rgba(148,163,184,0.5)')
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', '4,3')
        .style('pointer-events', 'none')
        .attr('opacity', 0);

      g.append('rect')
        .attr('width', W).attr('height', H)
        .attr('fill', 'transparent')
        .style('cursor', 'crosshair')
        .on('mousemove', function(event) {
          const [mx] = d3.pointer(event);
          const hoverTime = xScale.invert(mx);
          const bisect = d3.bisector(d => d.time).left;
          let idx = bisect(rows, hoverTime);
          if (idx >= rows.length) idx = rows.length - 1;
          if (idx > 0) {
            const d0 = rows[idx - 1], d1 = rows[idx];
            idx = (hoverTime - d0.time) > (d1.time - hoverTime) ? idx : idx - 1;
          }
          const row = rows[idx];
          const cx = xScale(row.time);
          crosshair.attr('x1', cx).attr('x2', cx).attr('opacity', 1);

          const timeStr = row.time.toLocaleTimeString('en-US', {
            timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', second: '2-digit'
          });

          const sorted = [...symbols]
            .filter(s => row._usd[s] !== 0)
            .sort((a, b) => row._usd[b] - row._usd[a]);

          const rowTotal = row._totalUsd;
          const tCol = rowTotal >= 0 ? '#34d399' : '#f87171';
          const tSign = rowTotal >= 0 ? '+' : '-';

          let html = `<div style="color:#94a3b8;margin-bottom:6px;font-size:10px;">${timeStr} ET</div>`;
          html += `<div style="display:flex;justify-content:space-between;gap:16px;line-height:1.8;border-bottom:1px solid rgba(148,163,184,0.15);margin-bottom:4px;padding-bottom:3px;">
            <span style="color:#94a3b8;font-weight:600;">∑ Total</span>
            <span style="color:${tCol};font-weight:700;">${tSign}$${Math.abs(rowTotal).toFixed(2)}</span>
          </div>`;

          sorted.forEach(sym => {
            const usdVal = row._usd[sym];
            const pctVal = row._pct[sym];
            const col = usdVal >= 0 ? '#34d399' : '#f87171';
            const uSign = usdVal >= 0 ? '+' : '-';
            const pSign = pctVal >= 0 ? '+' : '-';
            html += `<div style="display:flex;justify-content:space-between;gap:12px;line-height:1.7;">
              <span style="color:${colorMap[sym]};">■ ${sym}</span>
              <span style="color:${col};font-weight:500;">${uSign}$${Math.abs(usdVal).toFixed(2)} <span style="color:#64748b;font-size:10px;">(${pSign}${Math.abs(pctVal).toFixed(2)}%)</span></span>
            </div>`;
          });

          tooltip.style('opacity', 1).html(html);
          const ttW = 240;
          let ttLeft = margin.left + cx + 14;
          if (ttLeft + ttW > totalW - 10) ttLeft = Math.max(8, margin.left + cx - ttW - 14);
          tooltip.style('left', ttLeft + 'px').style('top', (margin.top + 8) + 'px');
        })
        .on('mouseleave', function() {
          crosshair.attr('opacity', 0);
          tooltip.style('opacity', 0);
        });

    } catch (err) {
      console.error('Stream render error:', err);
    }
  }

  let _streamResizeTimer = null;
  function handleStreamResize() {
    if (_lastStreamRaw) {
      clearTimeout(_streamResizeTimer);
      _streamResizeTimer = setTimeout(() => {
        renderStreamChart(_lastStreamRaw);
      }, 100);
    }
  }
  window.addEventListener('resize', handleStreamResize);

  if (typeof ResizeObserver !== 'undefined') {
    const chartContainerEl = document.getElementById('streamChartContainer');
    if (chartContainerEl) {
      const ro = new ResizeObserver(() => {
        handleStreamResize();
      });
      ro.observe(chartContainerEl);
    }
  }

  // Initial App Load
  async function initApp() {
    await fetchMode();
    await refreshAllData();
    await refreshMarketClock();
    startMarketCountdown();
    refreshStreamChart();
  }

  async function refreshAllData() {
    await Promise.all([
      refreshAccountData(),
      refreshNewsSentiment(),
      refreshBotStatus(),
      refreshMarketClock(),
      refreshStreamChart()
    ]);
  }

  if (refreshDashboardBtn) {
    refreshDashboardBtn.addEventListener('click', async () => {
      refreshDashboardBtn.disabled = true;
      refreshDashboardBtn.textContent = '⏳ Refreshing...';
      await refreshAllData();
      refreshDashboardBtn.disabled = false;
      refreshDashboardBtn.textContent = '🔄 Refresh Dashboard';
      showToast('Dashboard data refreshed successfully', 'info');
    });
  }

  // Open positions sortable headers
  const positionsTable = positionsTableBody.closest('table');
  if (positionsTable) {
    positionsTable.querySelectorAll('th.sortable').forEach(th => {
      th.style.cursor = 'pointer';
      th.addEventListener('click', () => {
        const key = th.getAttribute('data-sort');
        if (positionsSort.key === key) {
          positionsSort.dir = positionsSort.dir === 'desc' ? 'asc' : 'desc';
        } else {
          positionsSort.key = key;
          positionsSort.dir = 'desc';
        }
        renderPositions(lastPositions);
      });
    });
  }

  // Account Mode Handler
  async function fetchMode() {
    try {
      const res = await fetch('/api/mode');
      const data = await res.json();
      currentMode = data.mode;
      updateModeUI();
    } catch (err) {
      console.error('Failed to fetch account mode:', err);
    }
  }

  function updateModeUI() {
    if (currentMode === 'live') {
      modePaperBtn.className = 'toggle-btn';
      modeLiveBtn.className = 'toggle-btn active-live';
      liveWarningBanner.classList.remove('hidden');
    } else {
      modePaperBtn.className = 'toggle-btn active-paper';
      modeLiveBtn.className = 'toggle-btn';
      liveWarningBanner.classList.add('hidden');
    }
  }

  async function switchMode(newMode) {
    if (newMode === currentMode) return;

    if (newMode === 'live') {
      const confirmed = await showConfirmModal(
        '⚠️ Switch to LIVE TRADING?',
        'Are you sure you want to switch to <strong>LIVE TRADING MODE</strong>? Real money will be used for all trades.',
        'Switch to LIVE Mode',
        true
      );
      if (!confirmed) return;
    }

    try {
      const res = await fetch('/api/mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: newMode })
      });
      const data = await res.json();
      if (res.ok) {
        currentMode = data.mode;
        updateModeUI();
        await refreshAllData();
        showToast(`Switched account mode to: ${currentMode.toUpperCase()}`, 'success');
      } else {
        showToast(`Error switching mode: ${data.error}`, 'error');
      }
    } catch (err) {
      showToast(`Network error: ${err.message}`, 'error');
    }
  }

  modePaperBtn.addEventListener('click', () => switchMode('paper'));
  modeLiveBtn.addEventListener('click', () => switchMode('live'));

  // News Sentiment Data Fetching
  async function refreshNewsSentiment() {
    try {
      const res = await fetch('/api/news/sentiment');
      if (res.ok) {
        const sentiments = await res.json();
        renderSentiments(sentiments);
      }
    } catch (err) {
      console.error('Error fetching news sentiment:', err);
    }
  }

  function renderSentiments(sentiments) {
    if (!Array.isArray(sentiments) || sentiments.length === 0) {
      sentimentTableBody.innerHTML = `<tr><td colspan="5" class="text-center text-muted">No news data available.</td></tr>`;
      return;
    }

    sentimentTableBody.innerHTML = sentiments.map(item => {
      let badgeClass = 'status-off';
      if (item.sentiment === 'BULLISH') badgeClass = 'status-active';
      else if (item.sentiment === 'BEARISH') badgeClass = 'btn-danger';

      return `
        <tr>
          <td><strong>${stockLink(item.symbol)}</strong></td>
          <td><span class="status-badge ${badgeClass}">${item.sentiment}</span></td>
          <td style="font-weight: 700; color: ${item.score >= 0 ? '#34d399' : '#f87171'}">${item.score >= 0 ? '+' : ''}${item.score}</td>
          <td>${item.headlineCount}</td>
          <td class="headline-cell" title="${item.topHeadline.replace(/"/g, '&quot;')}">${item.topHeadline}</td>
        </tr>
      `;
    }).join('');
  }

  // Account & Positions & Orders Data Fetching
  async function refreshAccountData() {
    try {
      // 1. Account info
      const accRes = await fetch('/api/account');
      if (accRes.ok) {
        const acc = await accRes.json();
        metricEquity.textContent = formatUSD(acc.equity);
        metricBuyingPower.textContent = formatUSD(acc.buying_power);
        metricCash.textContent = formatUSD(acc.cash);

        // ── All-Time Profit (vs $100k paper baseline) ──
        const allTimePl = parseFloat(acc.all_time_pl || 0);
        const allTimePlPct = parseFloat(acc.all_time_pl_pct || 0);
        const allTimeEl = document.getElementById('metricAllTimePl');
        if (allTimeEl) {
          allTimeEl.textContent = `${allTimePl >= 0 ? '+' : ''}${formatUSD(allTimePl)} (${allTimePlPct >= 0 ? '+' : ''}${allTimePlPct.toFixed(2)}%)`;
          allTimeEl.style.color = allTimePl >= 0 ? '#34d399' : '#f87171';
        }

        // ── Daily Change (from Alpaca's last_equity) ──
        const dailyChange = parseFloat(acc.daily_change || 0);
        const dailyChangePct = parseFloat(acc.daily_change_pct || 0);
        const dailyEl = document.getElementById('metricDailyChange');
        if (dailyEl) {
          dailyEl.textContent = `${dailyChange >= 0 ? '+' : ''}${formatUSD(dailyChange)} (${dailyChangePct >= 0 ? '+' : ''}${dailyChangePct.toFixed(2)}%)`;
          dailyEl.style.color = dailyChange >= 0 ? '#34d399' : '#f87171';
        }

        const ALL_TIME_BASELINE = 100000;

        const sUPl  = parseFloat(acc.stock_unrealized_pl  || 0);
        const sRPl  = parseFloat(acc.stock_realized_pl    || 0);
        const cUPl  = parseFloat(acc.crypto_unrealized_pl || 0);
        const cRPl  = parseFloat(acc.crypto_realized_pl   || 0);

        function renderPl(id, value) {
          const el = document.getElementById(id);
          if (!el) return;
          const pct = (value / ALL_TIME_BASELINE) * 100;
          el.textContent = `${value >= 0 ? '+' : ''}${formatUSD(value)} (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%)`;
          el.style.color = value >= 0 ? '#34d399' : '#f87171';
        }

        renderPl('metricCryptoUnrealizedPl', cUPl);
        renderPl('metricCryptoRealizedPl',   cRPl);

        // Today's P/L
        const todayUPl = parseFloat(acc.today_unrealized_pl || 0);
        const todayRPl = parseFloat(acc.today_realized_pl || 0);
        renderPl('metricTodayUnrealizedPl', todayUPl);
        renderPl('metricTodayRealizedPl',   todayRPl);

        // Portfolio allocation
        const stockMv = parseFloat(acc.stock_market_value || 0);
        const cryptoMv = parseFloat(acc.crypto_market_value || 0);
        const cash = parseFloat(acc.cash_on_hand || acc.cash || 0);
        const stockPct = acc.stock_pct || '0';
        const cryptoPct = acc.crypto_pct || '0';
        const cashPct = acc.cash_pct || '0';
        const allocStocks = document.getElementById('metricAllocStocks');
        const allocCrypto = document.getElementById('metricAllocCrypto');
        const allocCash = document.getElementById('metricAllocCash');
        if (allocStocks) allocStocks.textContent = `${formatUSD(stockMv)} (${stockPct}%)`;
        if (allocCrypto) allocCrypto.textContent = `${formatUSD(cryptoMv)} (${cryptoPct}%)`;
        if (allocCash) allocCash.textContent = `${formatUSD(cash)} (${cashPct}%)`;

        metricStatus.textContent = acc.status.toUpperCase();
        metricStatus.className = `status-badge ${acc.status === 'ACTIVE' ? 'status-active' : 'status-off'}`;
      } else {
        metricStatus.textContent = 'API ERROR';
        metricStatus.className = 'status-badge status-off';
      }

      // 2. Positions
      const posRes = await fetch('/api/positions');
      if (posRes.ok) {
        const positions = await posRes.json();
        renderPositions(positions);
      }

      // 2b. Closed positions performance
      const closedRes = await fetch('/api/positions/closed');
      if (closedRes.ok) {
        const closed = await closedRes.json();
        renderClosedPositions(closed);
      }

      // 3. Orders
      const ordRes = await fetch('/api/orders');
      if (ordRes.ok) {
        const ordersData = await ordRes.json();
        renderOrders(ordersData);
      }
    } catch (err) {
      console.error('Error refreshing dashboard:', err);
    }
  }

  function renderPositions(positions) {
    if (!Array.isArray(positions) || positions.length === 0) {
      positionsTableBody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">No open positions found.</td></tr>`;
      return;
    }

    lastPositions = positions;

    const sorted = sortPositions(positions, positionsSort.key, positionsSort.dir);
    updateSortIndicators();

    positionsTableBody.innerHTML = sorted.map(pos => {
      const pl = parseFloat(pos.unrealized_pl || 0);
      const plpc = parseFloat(pos.unrealized_plpc || 0) * 100;
      const plClass = pl >= 0 ? 'text-success' : 'text-danger';
      const plFormatted = `${pl >= 0 ? '+' : ''}${formatUSD(pl)} (${plpc >= 0 ? '+' : ''}${plpc.toFixed(2)}%)`;

      return `
        <tr>
          <td><strong>${stockLink(pos.symbol)}</strong></td>
          <td>${pos.qty}</td>
          <td>${formatUSD(pos.avg_entry_price)}</td>
          <td>${formatUSD(pos.market_value)}</td>
          <td class="${plClass}">${plFormatted}</td>
          <td>
            <button onclick="closePosition('${pos.symbol}')" class="btn btn-danger btn-sm">Close</button>
          </td>
        </tr>
      `;
    }).join('');
  }

  function sortPositions(positions, key, dir) {
    const sorted = [...positions].sort((a, b) => {
      if (key === 'symbol') {
        return a.symbol.localeCompare(b.symbol);
      }
      const av = parseFloat(a[key] || 0);
      const bv = parseFloat(b[key] || 0);
      return av - bv;
    });
    return dir === 'desc' ? sorted.reverse() : sorted;
  }

  function updateSortIndicators() {
    document.querySelectorAll('#positionsTableBody').forEach(() => {});
    const table = positionsTableBody.closest('table');
    if (!table) return;
    table.querySelectorAll('th.sortable').forEach(th => {
      const key = th.getAttribute('data-sort');
      let arrow = '';
      if (key === positionsSort.key) {
        arrow = positionsSort.dir === 'desc' ? ' ▼' : ' ▲';
      }
      th.textContent = th.getAttribute('data-sort') === 'symbol' ? 'Symbol' + arrow
        : th.getAttribute('data-sort') === 'qty' ? 'Qty' + arrow
        : th.getAttribute('data-sort') === 'avg_entry_price' ? 'Avg Entry Price' + arrow
        : th.getAttribute('data-sort') === 'market_value' ? 'Market Value' + arrow
        : 'Unrealized P/L' + arrow;
    });
  }

  function renderClosedPositions(closed) {
    const topBody = document.getElementById('topPerformersBody');
    const worstBody = document.getElementById('worstPerformersBody');
    if (!topBody || !worstBody) return;

    if (!Array.isArray(closed) || closed.length === 0) {
      topBody.innerHTML = '<tr><td colspan="3" class="text-center text-muted">No closed trades yet.</td></tr>';
      worstBody.innerHTML = '<tr><td colspan="3" class="text-center text-muted">No closed trades yet.</td></tr>';
      return;
    }

    const winners = closed.filter(c => c.realizedPl > 0).slice(0, 5);
    const losers = closed.filter(c => c.realizedPl < 0).sort((a, b) => a.realizedPl - b.realizedPl).slice(0, 5);

    const row = c => {
      const pl = parseFloat(c.realizedPl || 0);
      const plClass = pl >= 0 ? 'text-success' : 'text-danger';
      return `<tr>
        <td><strong>${stockLink(c.symbol)}</strong></td>
        <td>${c.closedQty || 0}</td>
        <td class="${plClass}">${pl >= 0 ? '+' : ''}${formatUSD(pl)}</td>
      </tr>`;
    };

    topBody.innerHTML = winners.length > 0
      ? winners.map(row).join('')
      : '<tr><td colspan="3" class="text-center text-muted">No winners yet.</td></tr>';

    worstBody.innerHTML = losers.length > 0
      ? losers.map(row).join('')
      : '<tr><td colspan="3" class="text-center text-muted">No losers yet.</td></tr>';
  }

  function renderPLBreakdown(positions) {
    const chartEl = document.getElementById('plBreakdownChart');
    const totalEl = document.getElementById('plBreakdownTotal');
    if (!chartEl) return;

    if (!Array.isArray(positions) || positions.length === 0) {
      chartEl.innerHTML = '<span class="text-muted">No open positions.</span>';
      if (totalEl) totalEl.innerHTML = '';
      return;
    }

    // Sort by absolute P/L (largest impact first)
    const sorted = [...positions].sort((a, b) => {
      return Math.abs(parseFloat(b.unrealized_pl)) - Math.abs(parseFloat(a.unrealized_pl));
    });

    const maxAbsPl = Math.max(...sorted.map(p => Math.abs(parseFloat(p.unrealized_pl || 0))), 1);
    const pctScale = 100 / maxAbsPl;
    let totalPl = 0;

    chartEl.innerHTML = sorted.map(p => {
      const pl = parseFloat(p.unrealized_pl || 0);
      totalPl += pl;
      const isPositive = pl >= 0;
      const barWidth = Math.max(Math.abs(pl) * pctScale, 2);
      const sign = isPositive ? '+' : '';

      return `
        <div class="pl-bar-row">
          <span class="pl-bar-label">${stockLink(p.symbol)}</span>
          <div class="pl-bar-track">
            <div class="pl-bar-fill ${isPositive ? 'positive' : 'negative'}" style="width: ${barWidth}%">
              <span class="pl-bar-value">${sign}${formatUSD(pl)}</span>
            </div>
          </div>
          <span class="pl-bar-amount ${isPositive ? 'positive' : 'negative'}">${sign}${formatUSD(pl)}</span>
        </div>
      `;
    }).join('');

    if (totalEl) {
      const totalSign = totalPl >= 0 ? '+' : '';
      totalEl.innerHTML = `Total: <span style="color: ${totalPl >= 0 ? '#34d399' : '#f87171'}">${totalSign}${formatUSD(totalPl)}</span>`;
    }
  }

  function renderOrders(ordersData) {
    const orders = Array.isArray(ordersData)
      ? ordersData
      : (ordersData && Array.isArray(ordersData.orders) ? ordersData.orders : []);

    if (orders.length === 0) {
      ordersTableBody.innerHTML = `<tr><td colspan="8" class="text-center text-muted">No recent or pending orders found.</td></tr>`;
      return;
    }

    ordersTableBody.innerHTML = orders.map(ord => {
      const statusLower = String(ord.status).toLowerCase();
      const isPending = ['new', 'accepted', 'pending_new', 'held'].includes(statusLower);
      const isFilled = statusLower === 'filled';

      let statusBadge = `<span class="status-badge status-off">${ord.status}</span>`;
      if (isPending) {
        statusBadge = `<span class="status-badge status-pending" title="Pending execution when US stock market opens">PENDING (${ord.status.toUpperCase()})</span>`;
      } else if (isFilled) {
        statusBadge = `<span class="status-badge status-active">FILLED</span>`;
      }

      const reasonText = ord.reason || 'N/A';
      return `
        <tr>
          <td><small>${ord.id.substring(0, 8)}...</small></td>
          <td><strong>${stockLink(ord.symbol)}</strong></td>
          <td style="color: ${ord.side === 'buy' ? '#34d399' : '#f87171'}">${ord.side.toUpperCase()}</td>
          <td>${ord.qty}</td>
          <td>${ord.type.toUpperCase()}</td>
          <td>${statusBadge}</td>
          <td><small class="text-muted" title="${reasonText}">${reasonText}</small></td>
          <td>${formatDate(ord.submitted_at)}</td>
          <td>
            ${isPending ? `<button onclick="cancelOrder('${ord.id}', '${ord.symbol}')" class="btn btn-danger btn-sm">Cancel Order</button>` : '-'}
          </td>
        </tr>
      `;
    }).join('');
  }

  // Global functions for inline table buttons
  window.closePosition = async (symbol) => {
    const confirmed = await showConfirmModal(
      'Confirm Close Position',
      `Are you sure you want to close your position for <strong>${symbol}</strong>?`,
      'Close Position',
      true
    );

    if (!confirmed) return;

    try {
      const res = await fetch(`/api/positions/${symbol}`, { method: 'DELETE' });
      if (res.ok) {
        showToast(`Position for ${symbol} closed successfully.`, 'success');
        refreshAccountData();
      } else {
        const data = await res.json();
        showToast(`Error closing position: ${data.error}`, 'error');
      }
    } catch (err) {
      showToast(`Network error: ${err.message}`, 'error');
    }
  };

  window.cancelOrder = async (orderId, symbol = '') => {
    const confirmed = await showConfirmModal(
      'Confirm Cancel Order',
      `Are you sure you want to cancel order <strong>${orderId.substring(0, 8)}...</strong>${symbol ? ` for <strong>${symbol}</strong>` : ''}?`,
      'Cancel Order',
      true
    );

    if (!confirmed) return;

    try {
      const res = await fetch(`/api/orders/${orderId}`, { method: 'DELETE' });
      if (res.ok) {
        showToast(`Order ${orderId.substring(0, 8)}... canceled successfully.`, 'success');
        refreshAccountData();
      } else {
        const data = await res.json();
        showToast(`Error canceling order: ${data.error}`, 'error');
      }
    } catch (err) {
      showToast(`Network error: ${err.message}`, 'error');
    }
  };

  // Order Form Handler
  orderTypeSelect.addEventListener('change', () => {
    if (orderTypeSelect.value === 'limit') {
      limitPriceGroup.classList.remove('hidden');
    } else {
      limitPriceGroup.classList.add('hidden');
    }
  });

  manualOrderForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const symbol = document.getElementById('orderSymbol').value.trim().toUpperCase();
    const side = document.getElementById('orderSide').value;
    const qty = parseInt(document.getElementById('orderQty').value, 10);
    const type = document.getElementById('orderType').value;
    const limit_price = type === 'limit' ? parseFloat(document.getElementById('limitPrice').value) : null;

    if (!symbol || !qty) return;

    const confirmed = await showConfirmModal(
      'Confirm Order Placement',
      `Are you sure you want to place a <strong>${side.toUpperCase()} ${qty} ${symbol} (${type.toUpperCase()})</strong> order?`,
      'Place Order',
      false
    );

    if (!confirmed) return;

    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol, side, qty, type, limit_price })
      });
      const data = await res.json();
      if (res.ok) {
        showToast(`Order placed successfully! ID: ${data.id.substring(0, 8)}...`, 'success');
        manualOrderForm.reset();
        refreshAccountData();
      } else {
        showToast(`Order placement failed: ${data.error}`, 'error');
      }
    } catch (err) {
      showToast(`Network error: ${err.message}`, 'error');
    }
  });

  // Automated Trading Bot Handlers
  async function refreshBotStatus() {
    try {
      const res = await fetch('/api/bot/status');
      if (res.ok) {
        const data = await res.json();
        updateBotUI(data);
      }
    } catch (err) {
      console.error('Error fetching bot status:', err);
    }
  }

  function updateBotUI(data) {
    const stockBot = data.stockBot || (data.config?.assetClass === 'us_equity' ? data : null);
    const cryptoBot = data.cryptoBot || (data.config?.assetClass === 'crypto' ? data : null);

    if (stockBot) {
      if (stockBot.isRunning) {
        if (stockBotStateBadge) { stockBotStateBadge.textContent = 'RUNNING'; stockBotStateBadge.className = 'status-badge status-active'; }
        if (startStockBotBtn) startStockBotBtn.disabled = true;
        if (stopStockBotBtn) stopStockBotBtn.disabled = false;
      } else {
        if (stockBotStateBadge) { stockBotStateBadge.textContent = 'STOPPED'; stockBotStateBadge.className = 'status-badge status-off'; }
        if (startStockBotBtn) startStockBotBtn.disabled = false;
        if (stopStockBotBtn) stopStockBotBtn.disabled = true;
      }
      if (Array.isArray(stockBot.logs) && stockBotLogsList) {
        stockBotLogsList.innerHTML = stockBot.logs.map(log => `
          <div class="log-item ${log.type}">
            [${new Date(log.timestamp).toLocaleTimeString()}] ${log.message}
          </div>
        `).join('');
      }
    }

    if (cryptoBot) {
      if (cryptoBot.isRunning) {
        if (cryptoBotStateBadge) { cryptoBotStateBadge.textContent = 'RUNNING'; cryptoBotStateBadge.className = 'status-badge status-active'; }
        if (startCryptoBotBtn) startCryptoBotBtn.disabled = true;
        if (stopCryptoBotBtn) stopCryptoBotBtn.disabled = false;
      } else {
        if (cryptoBotStateBadge) { cryptoBotStateBadge.textContent = 'STOPPED'; cryptoBotStateBadge.className = 'status-badge status-off'; }
        if (startCryptoBotBtn) startCryptoBotBtn.disabled = false;
        if (stopCryptoBotBtn) stopCryptoBotBtn.disabled = true;
      }
      if (Array.isArray(cryptoBot.logs) && cryptoBotLogsList) {
        cryptoBotLogsList.innerHTML = cryptoBot.logs.map(log => `
          <div class="log-item ${log.type}">
            [${new Date(log.timestamp).toLocaleTimeString()}] ${log.message}
          </div>
        `).join('');
      }
    }
  }

  if (startStockBotBtn) {
    startStockBotBtn.addEventListener('click', async () => {
      const confirmed = await showConfirmModal(
        'Start Stock Trading Bot',
        'Are you sure you want to start the autonomous <strong>Stock Trading Bot</strong>?',
        'Start Stock Bot',
        false
      );

      if (!confirmed) return;

      try {
        const res = await fetch('/api/bot/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ assetClass: 'us_equity' })
        });
        const data = await res.json();
        refreshBotStatus();
        showToast('Stock Trading Bot started successfully', 'success');
      } catch (err) {
        showToast(`Failed to start Stock Bot: ${err.message}`, 'error');
      }
    });
  }

  if (stopStockBotBtn) {
    stopStockBotBtn.addEventListener('click', async () => {
      const confirmed = await showConfirmModal(
        'Stop Stock Trading Bot',
        'Are you sure you want to stop the autonomous <strong>Stock Trading Bot</strong>?',
        'Stop Stock Bot',
        true
      );

      if (!confirmed) return;

      try {
        const res = await fetch('/api/bot/stop', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ assetClass: 'us_equity' })
        });
        const data = await res.json();
        refreshBotStatus();
        showToast('Stock Trading Bot stopped', 'info');
      } catch (err) {
        showToast(`Failed to stop Stock Bot: ${err.message}`, 'error');
      }
    });
  }

  if (startCryptoBotBtn) {
    startCryptoBotBtn.addEventListener('click', async () => {
      const confirmed = await showConfirmModal(
        'Start Crypto Trading Bot',
        'Are you sure you want to start the autonomous 24/7 <strong>Crypto Trading Bot</strong>?',
        'Start Crypto Bot',
        false
      );

      if (!confirmed) return;

      try {
        const res = await fetch('/api/bot/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ assetClass: 'crypto' })
        });
        const data = await res.json();
        refreshBotStatus();
        showToast('Crypto Trading Bot started successfully', 'success');
      } catch (err) {
        showToast(`Failed to start Crypto Bot: ${err.message}`, 'error');
      }
    });
  }

  if (stopCryptoBotBtn) {
    stopCryptoBotBtn.addEventListener('click', async () => {
      const confirmed = await showConfirmModal(
        'Stop Crypto Trading Bot',
        'Are you sure you want to stop the 24/7 <strong>Crypto Trading Bot</strong>?',
        'Stop Crypto Bot',
        true
      );

      if (!confirmed) return;

      try {
        const res = await fetch('/api/bot/stop', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ assetClass: 'crypto' })
        });
        const data = await res.json();
        refreshBotStatus();
        showToast('Crypto Trading Bot stopped', 'info');
      } catch (err) {
        showToast(`Failed to stop Crypto Bot: ${err.message}`, 'error');
      }
    });
  }

  // ── Strategy Backtest ─────────────────────────────────────────────
  const backtestForm = document.getElementById('backtestForm');
  if (backtestForm) {
    let currentTrades = [];
    let currentSort = { col: 'exitTime', dir: 'desc' };
    let currentFilter = 'all';

    const renderTableRows = () => {
      const tbody = document.getElementById('backtestTradesBody');
      const countEl = document.getElementById('backtestTradeCount');
      if (!tbody) return;

      let filtered = currentTrades.slice();
      if (currentFilter === 'wins') {
        filtered = filtered.filter((t) => t.pnl > 0);
      } else if (currentFilter === 'losses') {
        filtered = filtered.filter((t) => t.pnl <= 0);
      }

      filtered.sort((a, b) => {
        let valA = a[currentSort.col];
        let valB = b[currentSort.col];
        if (typeof valA === 'string') {
          return currentSort.dir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        }
        return currentSort.dir === 'asc' ? valA - valB : valB - valA;
      });

      if (countEl) {
        countEl.textContent = `Showing ${Math.min(100, filtered.length)} of ${filtered.length} trades (${currentSort.col} ${currentSort.dir})`;
      }

      tbody.innerHTML = filtered
        .slice(0, 100)
        .map((t) => {
          const color = t.pnl >= 0 ? '#34d399' : '#f87171';
          const sign = t.pnl >= 0 ? '+' : '';
          const retPct = typeof t.pnlPct === 'number' ? `${sign}${t.pnlPct.toFixed(2)}%` : '—';
          return `<tr>
            <td>${t.exitTime.slice(0, 16).replace('T', ' ')}</td>
            <td><strong>${t.symbol}</strong></td>
            <td><span class="status-badge" style="font-size:0.7rem; padding:2px 8px; text-transform:none;">${t.reason}</span></td>
            <td>$${t.entry.toFixed(2)}</td>
            <td>$${t.exit.toFixed(2)}</td>
            <td style="color:${color}; font-weight:600;">${retPct}</td>
            <td style="color:${color}; font-weight:600;">${sign}$${t.pnl.toFixed(2)}</td>
          </tr>`;
        })
        .join('');

      // Update header sort indicators
      document.querySelectorAll('#backtestTable th.sortable').forEach((th) => {
        const col = th.getAttribute('data-col');
        const icon = th.querySelector('.sort-icon');
        if (icon) {
          if (col === currentSort.col) {
            icon.textContent = currentSort.dir === 'asc' ? ' ▲' : ' ▼';
            th.style.color = '#38bdf8';
          } else {
            icon.textContent = '';
            th.style.color = '';
          }
        }
      });
    };

    // Attach sort event listeners to headers
    document.querySelectorAll('#backtestTable th.sortable').forEach((th) => {
      th.addEventListener('click', () => {
        const col = th.getAttribute('data-col');
        if (currentSort.col === col) {
          currentSort.dir = currentSort.dir === 'asc' ? 'desc' : 'asc';
        } else {
          currentSort.col = col;
          currentSort.dir = col === 'exitTime' ? 'desc' : 'desc';
        }
        renderTableRows();
      });
    });

    const filterSelect = document.getElementById('backtestFilter');
    if (filterSelect) {
      filterSelect.addEventListener('change', (e) => {
        currentFilter = e.target.value;
        renderTableRows();
      });
    }

    backtestForm.addEventListener('submit', async (event) => {
      event.preventDefault();

      const symbols = document.getElementById('backtestSymbols').value.trim();
      const initialCapital = parseFloat(document.getElementById('backtestCapital')?.value || '100000');
      const positionSizePct = parseFloat(document.getElementById('backtestAllocation')?.value || '100');
      const start = document.getElementById('backtestStart').value;
      const end = document.getElementById('backtestEnd').value;
      const statusEl = document.getElementById('backtestStatus');
      const summaryEl = document.getElementById('backtestSummary');
      const wrapper = document.getElementById('backtestTradesWrapper');
      const button = document.getElementById('runBacktestBtn');

      if (!symbols || !start || !end) {
        showToast('Fill in symbols, start, and end dates.', 'error');
        return;
      }

      button.disabled = true;
      statusEl.textContent = 'Running backtest… replaying historical bars and computing benchmark…';
      summaryEl.classList.add('hidden');
      wrapper.classList.add('hidden');

      try {
        const response = await fetch('/api/backtest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbols, start, end, initialCapital, positionSizePct }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Backtest failed');

        statusEl.textContent = `Completed — ${data.symbols.length} symbol(s), ${data.trades} trades.`;
        const color = (v) => (v >= 0 ? '#34d399' : '#f87171');
        const sign = (v) => (v >= 0 ? '+' : '');

        summaryEl.innerHTML = `
          <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:12px; margin-bottom:16px;">
            <div style="background:rgba(30,41,59,0.6); padding:12px; border-radius:8px; border:1px solid rgba(255,255,255,0.06);">
              <span class="text-muted" style="font-size:12px; font-weight:600; text-transform:uppercase;">Initial Capital</span>
              <div class="metric-value" style="font-size:1.35rem; color:#f8fafc;">$${data.initialCapital.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
              <span class="text-muted" style="font-size:11px;">Alloc: ${positionSizePct}% per trade</span>
            </div>
            <div style="background:rgba(30,41,59,0.6); padding:12px; border-radius:8px; border:1px solid rgba(255,255,255,0.06);">
              <span class="text-muted" style="font-size:12px; font-weight:600; text-transform:uppercase;">Final Balance</span>
              <div class="metric-value" style="font-size:1.35rem; color:${color(data.totalPnl)};">$${data.finalEquity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
              <span class="text-muted" style="font-size:11px;">Net P/L: ${sign(data.totalPnl)}$${data.totalPnl.toFixed(2)}</span>
            </div>
            <div style="background:rgba(30,41,59,0.6); padding:12px; border-radius:8px; border:1px solid rgba(255,255,255,0.06);">
              <span class="text-muted" style="font-size:12px; font-weight:600; text-transform:uppercase;">Strategy Return</span>
              <div class="metric-value" style="font-size:1.35rem; color:${color(data.returnPct)};">${sign(data.returnPct)}${data.returnPct.toFixed(2)}%</div>
              <span class="text-muted" style="font-size:11px;">${sign(data.totalPnl)}$${data.totalPnl.toFixed(2)} net profit</span>
            </div>
            <div style="background:rgba(30,41,59,0.6); padding:12px; border-radius:8px; border:1px solid rgba(56,189,248,0.3);">
              <span class="text-muted" style="font-size:12px; font-weight:600; text-transform:uppercase; color:#38bdf8;">Buy & Hold Benchmark</span>
              <div class="metric-value" style="font-size:1.35rem; color:${color(data.buyAndHoldReturnPct)};">${sign(data.buyAndHoldReturnPct)}${data.buyAndHoldReturnPct.toFixed(2)}%</div>
              <span class="text-muted" style="font-size:11px;">$${data.buyAndHoldFinalEquity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} if held</span>
            </div>
            <div style="background:rgba(30,41,59,0.6); padding:12px; border-radius:8px; border:1px solid rgba(255,255,255,0.06);">
              <span class="text-muted" style="font-size:12px; font-weight:600; text-transform:uppercase;">Win Rate</span>
              <div class="metric-value" style="font-size:1.35rem;">${data.winRate.toFixed(1)}%</div>
              <span class="text-muted" style="font-size:11px;">${data.wins}W / ${data.losses}L (${data.trades} trades)</span>
            </div>
            <div style="background:rgba(30,41,59,0.6); padding:12px; border-radius:8px; border:1px solid rgba(255,255,255,0.06);">
              <span class="text-muted" style="font-size:12px; font-weight:600; text-transform:uppercase;">Max Drawdown</span>
              <div class="metric-value" style="font-size:1.35rem; color:#f87171;">-$${data.maxDrawdown.toFixed(2)}</div>
              <span class="text-muted" style="font-size:11px;">-${data.maxDrawdownPct.toFixed(2)}% peak drop</span>
            </div>
            <div style="background:rgba(30,41,59,0.6); padding:12px; border-radius:8px; border:1px solid rgba(255,255,255,0.06);">
              <span class="text-muted" style="font-size:12px; font-weight:600; text-transform:uppercase;">Avg Win / Loss</span>
              <div class="metric-value" style="font-size:1.2rem;"><span style="color:#34d399;">+$${data.avgWin.toFixed(2)}</span> / <span style="color:#f87171;">-$${Math.abs(data.avgLoss).toFixed(2)}</span></div>
              <span class="text-muted" style="font-size:11px;">Profit: +$${data.grossProfit.toFixed(2)} | Loss: -$${Math.abs(data.grossLoss).toFixed(2)}</span>
            </div>
          </div>`;
        summaryEl.classList.remove('hidden');

        currentTrades = data.tradesList || [];
        currentSort = { col: 'exitTime', dir: 'desc' };
        renderTableRows();
        wrapper.classList.remove('hidden');
      } catch (error) {
        statusEl.textContent = 'Error: ' + (error.message || String(error));
        showToast('Backtest failed: ' + (error.message || String(error)), 'error');
      } finally {
        button.disabled = false;
      }
    });
  }

  initApp();
});
