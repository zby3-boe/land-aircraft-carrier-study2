/* Fundamentals of Flying Vehicle Technology (2026) — Assignment 2 (EH216-S)
 * Autonomous Passenger eVTOL Safety Simulators, STPA Filter & OC Gate Audit
 */

(function () {
  'use strict';

  function isEn() {
    return document.body.classList.contains('E');
  }

  function t(cn, en) {
    return isEn() ? en : cn;
  }

  function prepareCanvas(canvas, cssHeight) {
    if (!canvas) return null;
    var dpr = window.devicePixelRatio || 1;
    var width = canvas.parentElement ? canvas.parentElement.clientWidth : 540;
    if (width < 260) width = 260;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(cssHeight * dpr);
    canvas.style.height = cssHeight + 'px';
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, w: width, h: cssHeight };
  }

  window.toggleLang = function () {
    var en = document.body.classList.toggle('E');
    var btn = document.getElementById('langBtn');
    if (btn) btn.textContent = en ? '中文' : 'EN';
    document.documentElement.lang = en ? 'en' : 'zh-CN';
    try {
      localStorage.setItem('fv_eh216_safety_lang', en ? 'E' : 'C');
    } catch (e) {}
    updateOddCalc();
    updateFtaSim();
    updateSafetyAudit();
  };

  window.toggleNav = function () {
    var links = document.querySelector('.lab-nav-links');
    if (links) links.classList.toggle('open');
  };

  document.addEventListener('click', function (ev) {
    var link = ev.target.closest('.lab-nav-links a');
    if (link && !link.closest('.lab-lang-switch')) {
      var menu = document.querySelector('.lab-nav-links');
      if (menu) menu.classList.remove('open');
    }
  });

  function setupScrollSpy() {
    var bar = document.getElementById('readingProgress');
    var tocLinks = Array.prototype.slice.call(document.querySelectorAll('.fv-toc a'));
    var sections = tocLinks
      .map(function (a) {
        var id = a.getAttribute('href');
        return id && id.charAt(0) === '#' ? document.getElementById(id.slice(1)) : null;
      })
      .filter(Boolean);

    function onScroll() {
      var doc = document.documentElement;
      var scrollTop = window.pageYOffset || doc.scrollTop;
      var height = doc.scrollHeight - doc.clientHeight;
      if (bar && height > 0) {
        bar.style.width = Math.min(100, Math.max(0, (scrollTop / height) * 100)).toFixed(1) + '%';
      }
      var currentId = '';
      for (var i = 0; i < sections.length; i++) {
        if (sections[i].getBoundingClientRect().top <= 120) currentId = sections[i].id;
      }
      tocLinks.forEach(function (a) {
        a.classList.toggle('active', a.getAttribute('href').slice(1) === currentId);
      });
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  window.filterStpa = function (domain, btnEl) {
    document.querySelectorAll('#stpaFilterBar .fv-filter-btn').forEach(function (b) {
      b.classList.remove('active');
    });
    if (btnEl) btnEl.classList.add('active');
    document.querySelectorAll('#stpaMatrixTable tbody tr').forEach(function (row) {
      var d = row.getAttribute('data-domain') || '';
      row.classList.toggle('is-hidden', domain !== 'all' && d !== domain);
    });
  };

  /* Widget #1: Autonomous ODD & Emergency Landing Pad Margin Calculator */
  function updateOddCalc() {
    var windEl = document.getElementById('oddWind');
    if (!windEl) return;
    var windMs = Number(windEl.value);
    var c2DropSec = Number(document.getElementById('oddC2Drop').value);
    var padDistKm = Number(document.getElementById('oddPadDist').value);
    var socMinPct = Number(document.getElementById('oddSocMin').value);

    document.getElementById('valOddWind').textContent = windMs + ' m/s';
    document.getElementById('valOddC2').textContent = c2DropSec + ' s';
    document.getElementById('valOddPad').textContent = padDistKm.toFixed(1) + ' km';
    document.getElementById('valOddSoc').textContent = socMinPct + '%';

    /* Effective cruise speed against headwind (~90 km/h = 25 m/s nominal) */
    var groundSpeedMs = Math.max(8, 25 - windMs);
    var timeToPadSec = (padDistKm * 1000) / groundSpeedMs;
    /* ~17 kWh pack, ~35 kW average cruise power -> ~29 min max theoretical; 1% SOC ~ 17.5 s */
    var availSec = socMinPct * 17.5 * (1 - windMs * 0.012);
    var marginSec = availSec - timeToPadSec;

    document.getElementById('outOddDivertTime').textContent =
      Math.round(timeToPadSec) + ' s (' + (timeToPadSec / 60).toFixed(1) + ' min)';
    document.getElementById('outOddMargin').textContent =
      (marginSec >= 0 ? '+' : '') + Math.round(marginSec) + ' s';

    var box = document.getElementById('outOddBox');
    var vEl = document.getElementById('outOddVerdict');
    box.classList.remove('warn-ok', 'warn-tight', 'warn-over');

    if (windMs > 12 || c2DropSec > 15 || marginSec < 60) {
      box.classList.add('warn-over');
      vEl.textContent = t(
        '禁止放行 (NO-GO)：风速/失联超时或备降能量余量不足 (<60s)，触发地面站自动中止起飞',
        'NO-GO: Wind, C2 outage, or divert energy margin (<60s) violates autonomous ODD'
      );
    } else if (marginSec < 150 || c2DropSec > 8) {
      box.classList.add('warn-tight');
      vEl.textContent = t(
        '受限放行：仅限单点低空悬停或视距内封闭景区环线，禁止跨水/跨城航线',
        'RESTRICTED GO: Closed scenic loop only; cross-water or urban transit prohibited'
      );
    } else {
      box.classList.add('warn-ok');
      vEl.textContent = t(
        '满足 OC 放行边界：备降能量余量充裕且 4G/5G 失联安全降落逻辑可有效兜底',
        'GO (Within OC Envelope): Adequate divert margin & C2 Fail-Safe landing coverage'
      );
    }
  }

  /* Widget #2: 16-Rotor Coaxial & 12-Pack Battery FTA Simulator */
  var FTA_DEFAULTS = { epu: 5, beta: 1.5, coax: 10, fcc: 0.5, c2: 2.0 };

  function fmtSci(val) {
    if (val <= 0) return '0';
    var exp = Math.floor(Math.log10(val));
    var mant = val / Math.pow(10, exp);
    return mant.toFixed(2) + '×10^' + exp;
  }

  function updateFtaSim() {
    var epuEl = document.getElementById('ftaLambdaEpu');
    if (!epuEl) return;

    var epuScaled = Number(epuEl.value); // x 1e-5 /fh
    var betaPct = Number(document.getElementById('ftaBeta').value);
    var coaxPct = Number(document.getElementById('ftaCoax').value);
    var fccScaled = Number(document.getElementById('ftaFcc').value); // x 1e-7 /fh
    var c2Scaled = Number(document.getElementById('ftaC2').value); // x 1e-4 /fh (disruption requiring fail-safe landing)

    document.getElementById('valFtaEpu').textContent = epuScaled + '×10⁻⁵ /fh';
    document.getElementById('valFtaBeta').textContent = betaPct.toFixed(1) + '%';
    document.getElementById('valFtaCoax').textContent = coaxPct + '%';
    document.getElementById('valFtaFcc').textContent = fccScaled.toFixed(1) + '×10⁻⁷ /fh';
    document.getElementById('valFtaC2').textContent = c2Scaled.toFixed(1) + '×10⁻⁴ /fh';

    var lambdaEpu = epuScaled * 1e-5;
    var beta = betaPct / 100;
    var pCoaxCascade = coaxPct / 100;
    var lambdaFccCcf = fccScaled * 1e-7;
    var lambdaC2 = c2Scaled * 1e-4;

    var lambdaInd = lambdaEpu * (1 - beta);
    /* 8 arms coaxial: 1 arm loses both rotors via single-arm cascade (8*2*lambdaInd*pCoax) OR 3-of-16 independent failures */
    var cs1 = 16 * lambdaInd * pCoaxCascade * 0.05 + 560 * Math.pow(lambdaInd, 3);
    /* DEP common-cause across >2 arms */
    var cs2 = lambdaEpu * beta * 0.25;
    /* Voting FCC + 12-pack BMS CCF */
    var cs3 = lambdaFccCcf;
    /* C2 outage × onboard autonomous emergency-landing sensor failure (approx 5e-4 conditional miss) */
    var cs4 = lambdaC2 * 5e-4;

    var pTotal = cs1 + cs2 + cs3 + cs4;

    document.getElementById('outFtaProp').textContent = fmtSci(cs1 + cs2) + ' /fh';
    document.getElementById('outFtaTotal').textContent = fmtSci(pTotal) + ' /fh';

    var maxCs = Math.max(cs1, cs2, cs3, cs4);
    var dom = '';
    if (maxCs === cs2) dom = t('CS2：电推共因失效 (β·λ)', 'CS2: DEP Common-Cause (β·λ)');
    else if (maxCs === cs1) dom = t('CS1：共轴同臂级联双失效', 'CS1: Coaxial Arm Cascade');
    else if (maxCs === cs3) dom = t('CS3：飞控/12包能源共因', 'CS3: FCC / 12-Pack CCF');
    else dom = t('CS4：C2失联 × 自主迫降感知漏检', 'CS4: C2 Loss × Auto-Land Miss');
    document.getElementById('outFtaDom').textContent = dom;

    var box = document.getElementById('outFtaVerdictBox');
    var vEl = document.getElementById('outFtaVerdict');
    box.classList.remove('warn-ok', 'warn-tight', 'warn-over');
    if (pTotal <= 1e-8) {
      box.classList.add('warn-ok');
      vEl.textContent = t('满足 10⁻⁸/fh 以上高等级商载目标（归功于 16 桨高冗余度）', 'Meets ≤10⁻⁸/fh high-assurance target via 16-rotor redundancy');
    } else if (pTotal <= 5e-7) {
      box.classList.add('warn-tight');
      vEl.textContent = t('满足当前景区/固定低空航线 OC 要求，但仍需压低共因因子 β', 'Fits current scenic OC baseline; further β-CCF reduction needed for dense cities');
    } else {
      box.classList.add('warn-over');
      vEl.textContent = t('超出 5×10⁻⁷/fh 容限：共因失效或共轴级联削弱了 16 旋翼冗余优势', 'Exceeds 5×10⁻⁷/fh limit: CCF or coaxial cascade defeats 16-rotor redundancy');
    }

    drawFtaChart(cs1, cs2, cs3, cs4, pTotal);
  }

  function drawFtaChart(cs1, cs2, cs3, cs4, pTotal) {
    var canvas = document.getElementById('ftaBarCanvas');
    var p = prepareCanvas(canvas, 240);
    if (!p) return;
    var ctx = p.ctx, w = p.w, h = p.h;
    ctx.clearRect(0, 0, w, h);

    var pad = { l: 150, r: 28, t: 36, b: 36 };
    var pw = w - pad.l - pad.r;
    var ph = h - pad.t - pad.b;
    var minExp = -9, maxExp = -3;

    function toX(val) {
      var exp = Math.log10(Math.max(1e-9, Math.min(1e-3, val)));
      return pad.l + ((exp - minExp) / (maxExp - minExp)) * pw;
    }

    for (var ex = minExp; ex <= maxExp; ex++) {
      var gx = pad.l + ((ex - minExp) / (maxExp - minExp)) * pw;
      ctx.strokeStyle = '#e5e9ed';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(gx, pad.t);
      ctx.lineTo(gx, h - pad.b);
      ctx.stroke();

      ctx.fillStyle = '#5c636b';
      ctx.font = '10.5px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText('10^' + ex, gx, h - pad.b + 16);
    }

    [
      { x: toX(1e-7), color: '#9a5b13' },
      { x: toX(1e-9) + 1, color: '#165b3d' }
    ].forEach(function (ref) {
      ctx.save();
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = ref.color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(ref.x, pad.t);
      ctx.lineTo(ref.x, h - pad.b);
      ctx.stroke();
      ctx.restore();
    });

    ctx.font = '10.5px sans-serif';
    ctx.textAlign = 'right';
    var enhLbl = '│ ' + t('商载增强目标 (10⁻⁹)', 'Enhanced Target (10⁻⁹)');
    var basicLbl = '│ ' + t('基础/景区别线 (10⁻⁷)', 'Basic Limit (10⁻⁷)');
    var enhW = ctx.measureText(enhLbl).width;
    ctx.fillStyle = '#165b3d';
    ctx.fillText(enhLbl, w - pad.r, 18);
    ctx.fillStyle = '#9a5b13';
    ctx.fillText(basicLbl, w - pad.r - enhW - 18, 18);

    var items = [
      { lbl: t('CS1 共轴同臂级联', 'CS1 Coaxial Cascade'), val: cs1, color: '#24756e' },
      { lbl: t('CS2 电推共因 (β·λ)', 'CS2 DEP CCF (β·λ)'), val: cs2, color: '#195e58' },
      { lbl: t('CS3 飞控/电池共因', 'CS3 FCC/Pack CCF'), val: cs3, color: '#6b7280' },
      { lbl: t('CS4 C2失联×迫降失误', 'CS4 C2×AutoLand Fail'), val: cs4, color: '#9a5b13' },
      { lbl: t('顶事件总失控率 P_cat', 'Total Top Event P_cat'), val: pTotal, color: pTotal > 5e-7 ? '#8e2424' : '#0f3b38' }
    ];

    var rowH = ph / items.length;
    items.forEach(function (it, idx) {
      var cy = pad.t + idx * rowH + rowH * 0.22;
      var bh = rowH * 0.56;
      var bw = Math.max(4, toX(it.val) - pad.l);

      ctx.fillStyle = '#111214';
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(it.lbl, pad.l - 10, cy + bh * 0.72);

      ctx.fillStyle = it.color;
      ctx.fillRect(pad.l, cy, bw, bh);

      ctx.font = '10px ui-monospace, monospace';
      var valText = fmtSci(it.val);
      if (pad.l + bw + 66 < w - pad.r) {
        ctx.fillStyle = '#25272b';
        ctx.textAlign = 'left';
        ctx.fillText(valText, pad.l + bw + 6, cy + bh * 0.72);
      } else {
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'right';
        ctx.fillText(valText, pad.l + bw - 6, cy + bh * 0.72);
      }
    });

    ctx.strokeStyle = '#9aa5ae';
    ctx.strokeRect(pad.l, pad.t, pw, ph);
  }

  window.resetFtaSim = function () {
    document.getElementById('ftaLambdaEpu').value = FTA_DEFAULTS.epu;
    document.getElementById('ftaBeta').value = FTA_DEFAULTS.beta;
    document.getElementById('ftaCoax').value = FTA_DEFAULTS.coax;
    document.getElementById('ftaFcc').value = FTA_DEFAULTS.fcc;
    document.getElementById('ftaC2').value = FTA_DEFAULTS.c2;
    updateFtaSim();
  };

  /* Widget #3: OC Commercial Operations Safety Gate Audit */
  window.updateSafetyAudit = function () {
    var checks = Array.prototype.slice.call(document.querySelectorAll('#safetyGateAudit .gate-check'));
    if (!checks.length) return;
    var done = 0;
    checks.forEach(function (cb) {
      var item = cb.closest('.gate-item');
      if (cb.checked) {
        done++;
        if (item) item.classList.add('checked');
      } else if (item) {
        item.classList.remove('checked');
      }
    });

    var pct = Math.round((done / checks.length) * 100);
    document.getElementById('auditScore').textContent = pct + '%';
    document.getElementById('auditCount').textContent = done + ' / ' + checks.length;
    var fill = document.getElementById('auditBarFill');
    fill.style.width = pct + '%';
    fill.style.backgroundColor = pct === 100 ? '#165b3d' : pct >= 50 ? '#195e58' : '#9a5b13';

    var box = document.getElementById('auditVerdictBox');
    var vEl = document.getElementById('auditVerdict');
    box.classList.remove('warn-ok', 'warn-tight', 'warn-over');
    if (done === checks.length) {
      box.classList.add('warn-ok');
      vEl.textContent = t(
        'FULL URBAN AIR TAXI READY：具备高频城际/城市密集空域自主载人运营能力',
        'FULL URBAN AIR TAXI READY: Substantiated for dense urban autonomous passenger routes'
      );
    } else if (done >= 4) {
      box.classList.add('warn-tight');
      vEl.textContent = t(
        'SCENIC & DESIGNATED CORRIDOR OC（当前 2026 状态）：获批景区观光与特定点对点航线，仍需强化城区备降与 5G 冗余',
        'DESIGNATED CORRIDOR OC (Current 2026 Status): Approved for scenic & fixed routes; urban scaling needs dense pads & C2 hardening'
      );
    } else {
      box.classList.add('warn-over');
      vEl.textContent = t(
        'RESTRICTED TRIAL ONLY：核心取证或运营控制环尚未完整闭合',
        'RESTRICTED TRIAL ONLY: Core certification or operational safety loops incomplete'
      );
    }
  };

  document.addEventListener('DOMContentLoaded', function () {
    try {
      if (localStorage.getItem('fv_eh216_safety_lang') === 'E') {
        document.body.classList.add('E');
        document.documentElement.lang = 'en';
        var btn = document.getElementById('langBtn');
        if (btn) btn.textContent = '中文';
      }
    } catch (e) {}

    setupScrollSpy();

    ['oddWind', 'oddC2Drop', 'oddPadDist', 'oddSocMin'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('input', updateOddCalc);
    });

    ['ftaLambdaEpu', 'ftaBeta', 'ftaCoax', 'ftaFcc', 'ftaC2'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('input', updateFtaSim);
    });

    document.querySelectorAll('#safetyGateAudit .gate-check').forEach(function (cb) {
      cb.addEventListener('change', updateSafetyAudit);
    });

    updateOddCalc();
    updateFtaSim();
    updateSafetyAudit();

    window.addEventListener('resize', updateFtaSim);
  });
})();
