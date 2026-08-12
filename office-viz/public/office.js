(function () {
  'use strict';

  const WALK_MS = 500;
  const PUFF_MS = 400;
  const BUBBLE_FADE_START_MS = 30000;
  const BUBBLE_FADE_DURATION_MS = 8000;

  const ROLE_COLORS = {
    scout: { body: '#4fd1c5', skin: '#e8c39e', accent: '#2c9e93' },
    planner: { body: '#9f7aea', skin: '#e8c39e', accent: '#7c5bd0' },
    reviewer: { body: '#f6ad55', skin: '#e8c39e', accent: '#c9822f' },
    tester: { body: '#68d391', skin: '#e8c39e', accent: '#3fae66' },
    analyst: { body: '#f687b3', skin: '#e8c39e', accent: '#c95a88' },
    claude: { body: '#a0aec0', skin: '#e8c39e', accent: '#767f92' },
  };
  const IMPLEMENTER_PALETTE = [
    { body: '#63b3ed', skin: '#e8c39e', accent: '#3a83c2' },
    { body: '#4299e1', skin: '#c98d5f', accent: '#2b6fb3' },
    { body: '#3182ce', skin: '#e8c39e', accent: '#215f9e' },
  ];

  const PHASE_LABELS = {
    '0': 'Triage', '1': 'Scout', '2': 'Plan', '3': 'Implement',
    '4': 'Verify', '5': 'Fix loop', '6': 'Deliver', done: 'Done',
  };

  const TILE_STYLE = {
    '.': { fill: '#1b1d24' },
    '#': { fill: '#0e0f14' },
    D: { fill: '#3a2f1c' },
    d: { fill: '#39485c' },
    o: { fill: '#5a3d52' },
    v: { fill: '#233021' },
  };

  let canvas, ctx, hudEl, statusDot, statusText, stageEl;
  let map = null;
  let scale = 1;
  let connected = false;

  // sessionId -> { cwd, run, agents: Map<agentKey, agentRender>, idle: agentRender|null }
  const sessions = new Map();
  const dustPuffs = [];
  const hudPanels = new Map(); // sessionId -> DOM element

  // Desk/seat assignment pools, keyed by role name (plus "lounge_idle" for idle sessions).
  const pools = {};

  function makePool(baseSlots) {
    const capacity = baseSlots.length + 8;
    return {
      slots: baseSlots,
      occupied: new Array(capacity).fill(false),
      assign() {
        for (let i = 0; i < this.occupied.length; i++) {
          if (!this.occupied[i]) { this.occupied[i] = true; return i; }
        }
        return this.occupied.length - 1;
      },
      release(i) {
        if (i != null && i >= 0 && i < this.occupied.length) this.occupied[i] = false;
      },
      position(i) {
        if (i < this.slots.length) return this.slots[i];
        const base = this.slots[this.slots.length - 1];
        const overflow = i - this.slots.length + 1;
        return { x: base.x + overflow, y: base.y + 1 };
      },
    };
  }

  function buildPools(m) {
    for (const role of ['scout', 'planner', 'implementer', 'reviewer', 'tester', 'analyst']) {
      pools[role] = makePool(m.zones[role].desks);
    }
    pools.lounge_idle = makePool(m.zones.lounge.seats);
  }

  function poolForRole(role) {
    return pools[role] || pools.lounge_idle;
  }

  function repoName(cwd) {
    if (!cwd) return 'unknown';
    const norm = String(cwd).replace(/[\\/]+$/, '');
    const idx = Math.max(norm.lastIndexOf('/'), norm.lastIndexOf('\\'));
    return idx >= 0 ? norm.slice(idx + 1) : norm;
  }

  function hueForSession(sessionId) {
    let h = 0;
    for (let i = 0; i < sessionId.length; i++) h = (h * 31 + sessionId.charCodeAt(i)) % 360;
    return h;
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function activityKey(activity) {
    return activity ? activity.tool + '\u0000' + activity.target : '';
  }

  function makeMover(from, to) {
    return { from: { x: from.x, y: from.y }, to: { x: to.x, y: to.y }, start: Date.now(), duration: WALK_MS };
  }

  function currentPos(mover) {
    const t = Math.min(1, (Date.now() - mover.start) / mover.duration);
    return { x: lerp(mover.from.x, mover.to.x, t), y: lerp(mover.from.y, mover.to.y, t) };
  }

  function moverDone(mover) {
    return Date.now() - mover.start >= mover.duration;
  }

  function spawnPuff(x, y) {
    dustPuffs.push({ x, y, start: Date.now() });
  }

  // --- state application ------------------------------------------------

  function createAgentRender(role, activity) {
    const pool = poolForRole(role);
    const slot = pool.assign();
    const desk = pool.position(slot);
    const door = map.door;
    return {
      role,
      pool,
      slot,
      mover: makeMover(door, desk),
      removing: false,
      activityKey: activityKey(activity),
      activityChangedAt: Date.now(),
      hasActivity: !!activity,
      activityText: activity ? activity.tool + ' ' + activity.target : '',
    };
  }

  function beginRemoval(render) {
    const pos = currentPos(render.mover);
    render.pool.release(render.slot);
    render.removing = true;
    const target = map.zones.lounge.seats[0];
    render.mover = makeMover(pos, target);
  }

  function ensureSession(sessionId, raw) {
    let s = sessions.get(sessionId);
    if (!s) {
      s = { cwd: raw.cwd, run: null, agents: new Map(), idle: null };
      sessions.set(sessionId, s);
    }
    s.cwd = raw.cwd;
    return s;
  }

  function applyState(state) {
    const incomingIds = new Set(Object.keys(state.sessions || {}));

    for (const sessionId of Array.from(sessions.keys())) {
      if (!incomingIds.has(sessionId)) removeSession(sessionId);
    }

    for (const sessionId of incomingIds) {
      const raw = state.sessions[sessionId];
      const s = ensureSession(sessionId, raw);
      s.run = raw.run || null;

      const incomingAgentKeys = new Set(Object.keys(raw.agents || {}));

      for (const agentKey of Array.from(s.agents.keys())) {
        if (!incomingAgentKeys.has(agentKey)) {
          const render = s.agents.get(agentKey);
          beginRemoval(render);
        }
      }

      for (const agentKey of incomingAgentKeys) {
        const agent = raw.agents[agentKey];
        let render = s.agents.get(agentKey);
        if (!render || render.removing) {
          render = createAgentRender(agent.role, agent.activity);
          s.agents.set(agentKey, render);
        } else {
          const newKey = activityKey(agent.activity);
          if (newKey !== render.activityKey) {
            render.activityKey = newKey;
            render.activityChangedAt = Date.now();
          }
          render.hasActivity = !!agent.activity;
          render.activityText = agent.activity ? agent.activity.tool + ' ' + agent.activity.target : '';
        }
      }

      const hasLiveAgents = incomingAgentKeys.size > 0;
      if (!hasLiveAgents && !s.idle) {
        s.idle = createAgentRender('claude', null);
        s.idle.isIdle = true;
      } else if (hasLiveAgents && s.idle) {
        s.idle.pool.release(s.idle.slot);
        s.idle = null;
      }
    }
  }

  function removeSession(sessionId) {
    const s = sessions.get(sessionId);
    if (!s) return;
    for (const render of s.agents.values()) render.pool.release(render.slot);
    if (s.idle) s.idle.pool.release(s.idle.slot);
    sessions.delete(sessionId);
    const panel = hudPanels.get(sessionId);
    if (panel) { panel.remove(); hudPanels.delete(sessionId); }
  }

  // --- per-frame update ---------------------------------------------------

  function update() {
    for (const s of sessions.values()) {
      for (const [agentKey, render] of Array.from(s.agents.entries())) {
        if (render.removing && moverDone(render.mover)) {
          const p = currentPos(render.mover);
          spawnPuff(p.x, p.y);
          s.agents.delete(agentKey);
        }
      }
    }
    while (dustPuffs.length && Date.now() - dustPuffs[0].start > PUFF_MS) dustPuffs.shift();
  }

  // --- drawing -------------------------------------------------------------

  function drawTiles() {
    const t = map.tileSize;
    for (let y = 0; y < map.height; y++) {
      const row = map.tiles[y];
      for (let x = 0; x < map.width; x++) {
        const ch = row[x];
        const style = TILE_STYLE[ch] || TILE_STYLE['.'];
        ctx.fillStyle = style.fill;
        ctx.fillRect(x * t, y * t, t, t);
        if (ch === 'd') {
          ctx.fillStyle = '#7fd4e8';
          ctx.fillRect(x * t + 4, y * t + 3, 8, 5);
        } else if (ch === 'o') {
          ctx.fillStyle = '#7a566d';
          ctx.fillRect(x * t + 2, y * t + 6, 12, 7);
        } else if (ch === 'v') {
          ctx.fillStyle = '#5a3d28';
          ctx.fillRect(x * t + 6, y * t + 11, 4, 4);
          ctx.fillStyle = '#3f8f52';
          ctx.fillRect(x * t + 4, y * t + 4, 8, 8);
        } else if (ch === 'D') {
          ctx.fillStyle = '#6b4f2a';
          ctx.fillRect(x * t + 2, y * t + 1, 12, 14);
        }
      }
    }
  }

  function paletteFor(render) {
    if (render.role === 'implementer') {
      return IMPLEMENTER_PALETTE[render.slot % IMPLEMENTER_PALETTE.length];
    }
    return ROLE_COLORS[render.role] || ROLE_COLORS.claude;
  }

  function drawAvatar(px, py, palette) {
    const ox = px + 3;
    const oy = py + 1;
    ctx.fillStyle = palette.skin;
    ctx.fillRect(ox + 3, oy, 4, 4);
    ctx.fillStyle = palette.body;
    ctx.fillRect(ox + 2, oy + 4, 6, 6);
    ctx.fillRect(ox + 2, oy + 10, 2, 4);
    ctx.fillRect(ox + 6, oy + 10, 2, 4);
    ctx.fillStyle = palette.accent;
    ctx.fillRect(ox + 2, oy + 4, 6, 2);
  }

  function drawLabel(px, py, text, hue) {
    ctx.font = '5px monospace';
    const w = Math.min(40, ctx.measureText(text).width + 4);
    ctx.fillStyle = `hsla(${hue}, 55%, 35%, 0.85)`;
    ctx.fillRect(px + 8 - w / 2, py + 16, w, 7);
    ctx.fillStyle = '#f0f0f0';
    ctx.textAlign = 'center';
    ctx.fillText(text, px + 8, py + 21);
    ctx.textAlign = 'left';
  }

  function drawBubble(px, py, text, alpha) {
    if (alpha <= 0) return;
    ctx.font = '5px monospace';
    const w = Math.min(64, ctx.measureText(text).width + 6);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(20, 21, 27, 0.9)';
    ctx.fillRect(px + 8 - w / 2, py - 9, w, 8);
    ctx.fillStyle = '#e8eaf0';
    ctx.textAlign = 'center';
    ctx.fillText(text, px + 8, py - 3);
    ctx.textAlign = 'left';
    ctx.globalAlpha = 1;
  }

  function bubbleAlpha(render) {
    const age = Date.now() - render.activityChangedAt;
    if (age <= BUBBLE_FADE_START_MS) return 1;
    return Math.max(0, 1 - (age - BUBBLE_FADE_START_MS) / BUBBLE_FADE_DURATION_MS);
  }

  function drawDustPuffs() {
    for (const puff of dustPuffs) {
      const t = (Date.now() - puff.start) / PUFF_MS;
      const alpha = 1 - t;
      const spread = t * 6;
      ctx.globalAlpha = Math.max(0, alpha);
      ctx.fillStyle = '#c8c8c8';
      const px = puff.x * map.tileSize + 6;
      const py = puff.y * map.tileSize + 8;
      ctx.fillRect(px - spread, py - spread, 2, 2);
      ctx.fillRect(px + spread, py - spread, 2, 2);
      ctx.fillRect(px - spread, py + spread, 2, 2);
      ctx.fillRect(px + spread, py + spread, 2, 2);
      ctx.fillRect(px, py - spread * 1.3, 2, 2);
    }
    ctx.globalAlpha = 1;
  }

  function drawSessions() {
    for (const [sessionId, s] of sessions.entries()) {
      const hue = hueForSession(sessionId);
      const label = repoName(s.cwd);
      const renders = s.idle ? [s.idle] : Array.from(s.agents.values());
      for (const render of renders) {
        const pos = currentPos(render.mover);
        const px = pos.x * map.tileSize;
        const py = pos.y * map.tileSize;
        drawAvatar(px, py, paletteFor(render));
        drawLabel(px, py, label, hue);
        if (render.hasActivity && !render.removing) {
          drawBubble(px, py, render.activityText, bubbleAlpha(render));
        }
      }
    }
  }

  function draw() {
    ctx.fillStyle = '#0b0c10';
    ctx.fillRect(0, 0, map.width * map.tileSize, map.height * map.tileSize);
    drawTiles();
    drawSessions();
    drawDustPuffs();
  }

  function loop() {
    update();
    draw();
    updateHud();
    requestAnimationFrame(loop);
  }

  // --- HUD -----------------------------------------------------------------

  function formatElapsed(startedAt) {
    const ms = Math.max(0, Date.now() - Date.parse(startedAt));
    const totalSec = Math.floor(ms / 1000);
    const mm = Math.floor(totalSec / 60);
    const ss = totalSec % 60;
    return mm + ':' + String(ss).padStart(2, '0');
  }

  function updateHud() {
    const active = new Set();
    for (const [sessionId, s] of sessions.entries()) {
      if (!s.run) continue;
      active.add(sessionId);
      let panel = hudPanels.get(sessionId);
      if (!panel) {
        panel = document.createElement('div');
        panel.className = 'run-panel';
        hudEl.appendChild(panel);
        hudPanels.set(sessionId, panel);
      }
      const run = s.run;
      const phaseLabel = PHASE_LABELS[run.phase] || run.phase;
      const findings = run.findings || { blocker: 0, major: 0, minor: 0 };
      panel.innerHTML =
        '<div class="repo">' + repoName(s.cwd) + '</div>' +
        '<div class="row"><span>Phase</span><span>' + phaseLabel + ' (' + run.phase + ')</span></div>' +
        '<div class="row"><span>Elapsed</span><span>' + formatElapsed(run.startedAt) + '</span></div>' +
        '<div class="row"><span>Fix loops</span><span>' + run.fixLoops + '</span></div>' +
        '<div class="row"><span>Findings</span><span>' +
        '<span class="sev blocker">' + findings.blocker + '</span> ' +
        '<span class="sev major">' + findings.major + '</span> ' +
        '<span class="sev minor">' + findings.minor + '</span></span></div>';
    }
    for (const [sessionId, panel] of Array.from(hudPanels.entries())) {
      if (!active.has(sessionId)) { panel.remove(); hudPanels.delete(sessionId); }
    }
  }

  // --- transport -------------------------------------------------------------

  function setConnected(v) {
    connected = v;
    statusDot.classList.toggle('connected', v);
    statusDot.classList.toggle('disconnected', !v);
    statusText.textContent = v ? 'connected' : 'reconnecting\u2026';
  }

  function connect() {
    const es = new EventSource('/events');
    es.addEventListener('open', () => setConnected(true));
    es.addEventListener('error', () => setConnected(false));
    es.addEventListener('state', (e) => {
      setConnected(true);
      try {
        applyState(JSON.parse(e.data));
      } catch (err) {
        // malformed payload from the server; ignore this update, keep previous render state
      }
    });
  }

  // --- layout ---------------------------------------------------------------

  function resize() {
    if (!map) return;
    const worldW = map.width * map.tileSize;
    const worldH = map.height * map.tileSize;
    scale = Math.max(1, Math.floor(Math.min(stageEl.clientWidth / worldW, stageEl.clientHeight / worldH)));
    canvas.width = worldW * scale;
    canvas.height = worldH * scale;
    canvas.style.left = Math.floor((stageEl.clientWidth - canvas.width) / 2) + 'px';
    canvas.style.top = Math.floor((stageEl.clientHeight - canvas.height) / 2) + 'px';
    ctx.imageSmoothingEnabled = false;
    // canvas resolution is world-size * scale; scaling the drawing context lets every
    // draw call use plain tile-grid coordinates regardless of the fitted zoom level.
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
  }

  // --- demo mode --------------------------------------------------------------

  function startDemo() {
    const sessionId = 'demo-session';
    const cwd = 'D:/repos/example-app';
    const runStart = new Date().toISOString();
    const demo = { sessions: {} };

    function snapshot() {
      applyState(JSON.parse(JSON.stringify(demo)));
    }

    function setSession(agents, run) {
      demo.sessions[sessionId] = {
        cwd,
        startedAt: runStart,
        lastSeen: new Date().toISOString(),
        agents,
        run,
      };
    }

    function agent(role, label, activity) {
      return { role, label, activity, startedAt: new Date().toISOString() };
    }

    function run(phase, triage, findings, fixLoops) {
      return { runId: 'demo-run-1', phase, triage, fixLoops, findings, startedAt: runStart };
    }

    const steps = [
      () => setSession({}, null),
      () => setSession(
        { scout1: agent('scout', 'Explore auth module', null) },
        run('0', 'STANDARD', { blocker: 0, major: 0, minor: 0 }, 0)
      ),
      () => setSession(
        { scout1: agent('scout', 'Explore auth module', { tool: 'Bash', target: 'grep -r auth src/' }) },
        run('1', 'STANDARD', { blocker: 0, major: 0, minor: 0 }, 0)
      ),
      () => setSession(
        { planner1: agent('planner', 'Plan subtasks', null) },
        run('2', 'STANDARD', { blocker: 0, major: 0, minor: 0 }, 0)
      ),
      () => setSession(
        {
          impl1: agent('implementer', 'Implement login form', { tool: 'Edit', target: 'LoginForm.tsx' }),
          impl2: agent('implementer', 'Implement API client', { tool: 'Edit', target: 'apiClient.ts' }),
        },
        run('3', 'STANDARD', { blocker: 0, major: 0, minor: 0 }, 0)
      ),
      () => setSession(
        {
          impl1: agent('implementer', 'Implement login form', { tool: 'Write', target: 'LoginForm.test.tsx' }),
          impl2: agent('implementer', 'Implement API client', { tool: 'Bash', target: 'npm run build' }),
        },
        run('3', 'STANDARD', { blocker: 0, major: 0, minor: 0 }, 0)
      ),
      () => setSession(
        {
          reviewer1: agent('reviewer', 'Review diff', { tool: 'Bash', target: 'git diff --stat' }),
          tester1: agent('tester', 'Run test suite', { tool: 'Bash', target: 'npm test' }),
        },
        run('4', 'STANDARD', { blocker: 0, major: 0, minor: 0 }, 0)
      ),
      () => setSession(
        {
          reviewer1: agent('reviewer', 'Review diff', { tool: 'Bash', target: 'git diff --stat' }),
          tester1: agent('tester', 'Run test suite', { tool: 'Bash', target: 'npm test' }),
        },
        run('5', 'STANDARD', { blocker: 0, major: 1, minor: 2 }, 1)
      ),
      () => setSession(
        { impl1: agent('implementer', 'Fix review findings', { tool: 'Edit', target: 'LoginForm.tsx' }) },
        run('5', 'STANDARD', { blocker: 0, major: 1, minor: 2 }, 1)
      ),
      () => setSession(
        {},
        run('6', 'STANDARD', { blocker: 0, major: 0, minor: 2 }, 1)
      ),
      () => setSession(
        {},
        run('done', 'STANDARD', { blocker: 0, major: 0, minor: 2 }, 1)
      ),
    ];

    let i = 0;
    function tick() {
      steps[i]();
      snapshot();
      i = (i + 1) % steps.length;
      const delay = i === 0 ? 4000 : 2200;
      setTimeout(tick, delay);
    }
    setConnected(true);
    tick();
  }

  // --- boot --------------------------------------------------------------

  function init() {
    canvas = document.getElementById('scene');
    ctx = canvas.getContext('2d');
    hudEl = document.getElementById('hud');
    statusDot = document.getElementById('statusDot');
    statusText = document.getElementById('statusText');
    stageEl = document.getElementById('stage');

    window.addEventListener('resize', resize);

    fetch('map.json')
      .then((r) => r.json())
      .then((m) => {
        map = m;
        buildPools(m);
        resize();
        requestAnimationFrame(loop);
        if (location.search.indexOf('demo') !== -1) startDemo();
        else connect();
      });
  }

  init();
})();
