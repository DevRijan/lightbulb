/**
 * Pull-Rope Light Bulb — Physics Engine & Interaction
 * =====================================================
 * Spring-damper chain simulation with SVG Bézier rendering,
 * Web Audio synthesis, and light toggle logic.
 */

;(function () {
  'use strict';

  // ── DOM References ──────────────────────────────────────────────
  const body        = document.body;
  const bulb        = document.getElementById('bulb');
  const bulbAssembly = document.getElementById('bulbAssembly');
  const ropePath    = document.getElementById('ropePath');
  const ropePathShadow = document.getElementById('ropePathShadow');
  const handle      = document.getElementById('ropeHandle');
  const hint        = document.getElementById('hint');
  const audioEl     = document.getElementById('audio');

  // ── State ────────────────────────────────────────────────────────
  let isOn        = false;
  let isDragging  = false;
  let hintShown   = true;
  let audioCtx    = null;

  // ── Rope Configuration ────────────────────────────────────────────
  const NUM_NODES    = 14;     // number of chain nodes
  const REST_SEG_LEN = 24;     // natural segment length (px)
  const STIFFNESS    = 0.78;   // high stiffness = aggressive snap-back
  const DAMPING      = 0.93;   // near 1.0 = velocity preserved = bouncy oscillation
  const GRAVITY      = 1.8;    // strong gravity = fast movement, snappy whip
  const ITERATIONS   = 24;     // more iterations = tighter, more accurate chain
  const PULL_THRESHOLD = 100;  // min px downward pull to trigger toggle (must be a real tug)

  // Horizontal offset of rope anchor from viewport center (px)
  // Positive = right side, like a real room pull cord
  const ROPE_OFFSET_X = 140;

  // Brighter rope colors so the rope is clearly visible on the dark background
  const ROPE_COLOR_SLACK = '#b8874e';  // warm tan — clearly visible at rest
  const ROPE_COLOR_TAUT  = '#e8c278';  // bright gold when stretched

  // ── Rope Node Data ────────────────────────────────────────────────
  // Each node: { x, y, px, py }  (position + previous position for Verlet)
  let nodes = [];

  // ── Anchor point: ceiling, offset to the right of the bulb ──────
  // The rope hangs from the ceiling independently, like a real pull cord
  // mounted on the ceiling a bit to the side of the pendant lamp.
  function getAnchor() {
    return {
      x: window.innerWidth / 2 + ROPE_OFFSET_X,
      y: 18   // just below the ceiling bar
    };
  }

  // ── Initialize rope nodes hanging straight down from anchor ──────
  function initRope() {
    nodes = [];
    const anchor = getAnchor();
    for (let i = 0; i < NUM_NODES; i++) {
      const y = anchor.y + i * REST_SEG_LEN;
      // Give each node a tiny horizontal jitter so the chain
      // settles naturally into its catenary curve from frame 1
      const jitter = (i / NUM_NODES) * 2;
      nodes.push({ x: anchor.x + jitter, y, px: anchor.x + jitter, py: y - 1 });
    }
  }

  // ── Physics update (Verlet integration + spring constraints) ──────
  function updatePhysics(mouseX, mouseY) {
    const anchor = getAnchor();

    // 1. Verlet integration — apply velocity + gravity to each free node
    for (let i = 1; i < NUM_NODES; i++) {
      const n = nodes[i];
      const vx = (n.x - n.px) * DAMPING;
      const vy = (n.y - n.py) * DAMPING;
      n.px = n.x;
      n.py = n.y;
      n.x += vx;
      n.y += vy + GRAVITY;
    }

    // 2. If dragging, pull last node toward the mouse (with resistance)
    if (isDragging) {
      const last = nodes[NUM_NODES - 1];
      // resistance 0.28: responsive enough to follow, yet feels like pulling a rope
      const resistance = 0.28;
      last.x += (mouseX - last.x) * resistance;
      last.y += (mouseY - last.y) * resistance;
    }

    // 3. Constraint relaxation — maintain segment rest lengths
    for (let iter = 0; iter < ITERATIONS; iter++) {
      // Pin first node to anchor
      nodes[0].x = anchor.x;
      nodes[0].y = anchor.y;

      for (let i = 0; i < NUM_NODES - 1; i++) {
        const a = nodes[i];
        const b = nodes[i + 1];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.001;
        const diff = (dist - REST_SEG_LEN) / dist;

        // Distribute correction — fixed node (i=0) gets 0 share
        const shareA = (i === 0) ? 0 : 0.5;
        const shareB = (isDragging && i === NUM_NODES - 2) ? 0 : 0.5;

        a.x += dx * diff * shareA * STIFFNESS;
        a.y += dy * diff * shareA * STIFFNESS;
        b.x -= dx * diff * shareB * STIFFNESS;
        b.y -= dy * diff * shareB * STIFFNESS;
      }

      // Re-pin first node after each iteration
      nodes[0].x = anchor.x;
      nodes[0].y = anchor.y;
    }
  }

  // ── Compute current rope tension (0–1) ────────────────────────────
  function getTension() {
    const anchor = getAnchor();
    const last   = nodes[NUM_NODES - 1];
    const dy     = last.y - anchor.y;
    const naturalLen = REST_SEG_LEN * (NUM_NODES - 1);
    return Math.max(0, Math.min(1, (dy - naturalLen) / (naturalLen * 0.6)));
  }

  // ── Build smooth SVG path through nodes (quadratic Bézier) ────────
  function buildRopePath() {
    if (nodes.length < 2) return '';
    let d = `M ${nodes[0].x.toFixed(1)} ${nodes[0].y.toFixed(1)}`;
    for (let i = 1; i < nodes.length - 1; i++) {
      const mx = ((nodes[i].x + nodes[i + 1].x) / 2).toFixed(1);
      const my = ((nodes[i].y + nodes[i + 1].y) / 2).toFixed(1);
      d += ` Q ${nodes[i].x.toFixed(1)} ${nodes[i].y.toFixed(1)} ${mx} ${my}`;
    }
    const last = nodes[nodes.length - 1];
    d += ` L ${last.x.toFixed(1)} ${last.y.toFixed(1)}`;
    return d;
  }

  // ── Render: update SVG paths + position handle ────────────────────
  function render() {
    const d = buildRopePath();
    const tension = getTension();

    // Interpolate rope color: slack (warm tan) → taut (bright gold)
    const color = lerpColor(ROPE_COLOR_SLACK, ROPE_COLOR_TAUT, tension);

    // Shadow path (offset slightly for depth)
    ropePathShadow.setAttribute('d', d);

    // Main rope — thicker stroke so it's clearly visible on the dark room background
    ropePath.setAttribute('d', d);
    ropePath.setAttribute('stroke', color);
    // Stroke width: 5px at rest, swells to 6.5px when taut
    ropePath.setAttribute('stroke-width', (5 + tension * 1.5).toFixed(2));

    // Position the tassel handle at the last node
    const last = nodes[NUM_NODES - 1];
    handle.style.left = `${last.x}px`;
    handle.style.top  = `${last.y}px`;
  }

  // ── Main animation loop ───────────────────────────────────────────
  let mouseX = 0, mouseY = 0;

  function loop() {
    updatePhysics(mouseX, mouseY);
    render();
    requestAnimationFrame(loop);
  }

  // ── Color lerp helper ─────────────────────────────────────────────
  function lerpColor(a, b, t) {
    const parse = hex => [
      parseInt(hex.slice(1,3), 16),
      parseInt(hex.slice(3,5), 16),
      parseInt(hex.slice(5,7), 16)
    ];
    const ca = parse(a), cb = parse(b);
    const r = Math.round(ca[0] + (cb[0] - ca[0]) * t);
    const g = Math.round(ca[1] + (cb[1] - ca[1]) * t);
    const bl = Math.round(ca[2] + (cb[2] - ca[2]) * t);
    return `rgb(${r},${g},${bl})`;
  }

  // ── Web Audio: lazy-init AudioContext ─────────────────────────────
  function getAudioCtx() {
    if (!audioCtx) {
      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      } catch(e) { return null; }
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  // (soundGrab and soundRelease removed — rope interaction is silent.
  //  Sound only plays when the light actually switches ON or OFF.)

  // ── Sound: light ON — realistic pull-cord switch ─────────────────
  // Models three physical events:
  //   1. Mechanical snap  — sharp high-frequency noise burst (the ratchet clicking)
  //   2. Housing thud     — low sine sweep (plastic body resonating after the snap)
  //   3. Filament hum     — brief 120 Hz electrical buzz as the tungsten heats up
  function soundLightOn() {
    const ctx = getAudioCtx(); if (!ctx) return;
    const t = ctx.currentTime;
    const sr = ctx.sampleRate;

    // 1. Mechanical snap (10 ms band-passed noise at ~2.8 kHz)
    const snapLen  = Math.ceil(sr * 0.010);
    const snapBuf  = ctx.createBuffer(1, snapLen, sr);
    const snapData = snapBuf.getChannelData(0);
    for (let i = 0; i < snapLen; i++) {
      snapData[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / snapLen, 2.5);
    }
    const snapSrc = ctx.createBufferSource();
    snapSrc.buffer = snapBuf;
    const snapBpf = ctx.createBiquadFilter();
    snapBpf.type = 'bandpass';
    snapBpf.frequency.value = 2800;
    snapBpf.Q.value = 1.4;
    const snapGain = ctx.createGain();
    snapGain.gain.setValueAtTime(1.0, t);
    snapSrc.connect(snapBpf);
    snapBpf.connect(snapGain);
    snapGain.connect(ctx.destination);
    snapSrc.start(t);

    // 2. Housing thud (pitched sine, 190 Hz → 75 Hz, 55 ms)
    const thudOsc  = ctx.createOscillator();
    thudOsc.type   = 'sine';
    thudOsc.frequency.setValueAtTime(190, t);
    thudOsc.frequency.exponentialRampToValueAtTime(75, t + 0.055);
    const thudGain = ctx.createGain();
    thudGain.gain.setValueAtTime(0.40, t);
    thudGain.gain.exponentialRampToValueAtTime(0.001, t + 0.065);
    thudOsc.connect(thudGain);
    thudGain.connect(ctx.destination);
    thudOsc.start(t);
    thudOsc.stop(t + 0.07);

    // 3. Filament energise hum (120 Hz sawtooth, rises then fades — ~350 ms)
    const humOsc  = ctx.createOscillator();
    humOsc.type   = 'sawtooth';
    humOsc.frequency.value = 120;
    const humBpf  = ctx.createBiquadFilter();
    humBpf.type   = 'bandpass';
    humBpf.frequency.value = 120;
    humBpf.Q.value = 6;
    const humGain = ctx.createGain();
    humGain.gain.setValueAtTime(0.0,   t + 0.012);
    humGain.gain.linearRampToValueAtTime(0.07, t + 0.045);
    humGain.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
    humOsc.connect(humBpf);
    humBpf.connect(humGain);
    humGain.connect(ctx.destination);
    humOsc.start(t + 0.012);
    humOsc.stop(t + 0.40);
  }

  // ── Sound: light OFF — realistic pull-cord switch ─────────────────
  // Slightly softer snap + housing thud + tiny current-cut pop (no hum).
  function soundLightOff() {
    const ctx = getAudioCtx(); if (!ctx) return;
    const t = ctx.currentTime;
    const sr = ctx.sampleRate;

    // 1. Mechanical snap (OFF snap is a touch softer, centred at ~2.2 kHz)
    const snapLen  = Math.ceil(sr * 0.009);
    const snapBuf  = ctx.createBuffer(1, snapLen, sr);
    const snapData = snapBuf.getChannelData(0);
    for (let i = 0; i < snapLen; i++) {
      snapData[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / snapLen, 3);
    }
    const snapSrc = ctx.createBufferSource();
    snapSrc.buffer = snapBuf;
    const snapBpf = ctx.createBiquadFilter();
    snapBpf.type = 'bandpass';
    snapBpf.frequency.value = 2200;
    snapBpf.Q.value = 1.6;
    const snapGain = ctx.createGain();
    snapGain.gain.setValueAtTime(0.80, t);
    snapSrc.connect(snapBpf);
    snapBpf.connect(snapGain);
    snapGain.connect(ctx.destination);
    snapSrc.start(t);

    // 2. Housing thud (lower, 160 Hz → 65 Hz, 50 ms)
    const thudOsc  = ctx.createOscillator();
    thudOsc.type   = 'sine';
    thudOsc.frequency.setValueAtTime(160, t);
    thudOsc.frequency.exponentialRampToValueAtTime(65, t + 0.050);
    const thudGain = ctx.createGain();
    thudGain.gain.setValueAtTime(0.32, t);
    thudGain.gain.exponentialRampToValueAtTime(0.001, t + 0.060);
    thudOsc.connect(thudGain);
    thudGain.connect(ctx.destination);
    thudOsc.start(t);
    thudOsc.stop(t + 0.065);

    // 3. Current-cut pop — tiny crackle 5 ms after snap (circuit opens)
    const popLen  = Math.ceil(sr * 0.004);
    const popBuf  = ctx.createBuffer(1, popLen, sr);
    const popData = popBuf.getChannelData(0);
    for (let i = 0; i < popLen; i++) {
      popData[i] = (Math.random() * 2 - 1) * (1 - i / popLen) * 0.55;
    }
    const popSrc  = ctx.createBufferSource();
    popSrc.buffer = popBuf;
    const popGain = ctx.createGain();
    popGain.gain.setValueAtTime(0.60, t + 0.006);
    popSrc.connect(popGain);
    popGain.connect(ctx.destination);
    popSrc.start(t + 0.006);
    clickSrc.start(t);
  }

  // ── Toggle light state ────────────────────────────────────────────
  function toggleLight() {
    isOn = !isOn;
    body.classList.toggle('on', isOn);
    if (isOn) {
      soundLightOn();
      spawnDust();
    } else {
      soundLightOff();
    }
  }

  // ── Dust particles floating up from the bulb when light ON ───────
  function spawnDust() {
    // Dust radiates from the bulb center, not the rope anchor
    const bulbRect = document.getElementById('bulb').getBoundingClientRect();
    const bulbCX = bulbRect.left + bulbRect.width / 2;
    const bulbCY = bulbRect.top  + bulbRect.height / 2;
    for (let i = 0; i < 10; i++) {
      setTimeout(() => {
        const p = document.createElement('div');
        p.className = 'dust-particle';
        const size = 1.5 + Math.random() * 3;
        const spread = 180;
        p.style.cssText = `
          width: ${size}px;
          height: ${size}px;
          left: ${bulbCX - spread/2 + Math.random() * spread}px;
          top: ${bulbCY + 40 + Math.random() * 50}px;
          animation-duration: ${1.6 + Math.random() * 1.4}s;
        `;
        body.appendChild(p);
        p.addEventListener('animationend', () => p.remove());
      }, i * 70);
    }
  }

  // ── Pull tracking (distance + direction for toggle validation) ───────
  let dragStartY  = 0;
  let maxPullDist = 0;
  // Capture the handle position at the moment of maximum downward pull,
  // so we can validate the pull direction on release.
  let maxPullHandlePos = { x: 0, y: 0 };

  // ── Mouse / Touch event handlers ──────────────────────────────────

  function onPointerDown(e) {
    e.preventDefault();
    isDragging      = true;
    maxPullDist     = 0;
    maxPullHandlePos = { x: nodes[NUM_NODES - 1].x, y: nodes[NUM_NODES - 1].y };
    const pos       = getEventPos(e);
    mouseX          = pos.x;
    mouseY          = pos.y;
    dragStartY      = nodes[NUM_NODES - 1].y;
    handle.style.cursor = 'grabbing';
    // (no sound on grab — sound only fires when light toggles)
    dismissHint();
  }

  function onPointerMove(e) {
    if (!isDragging) return;
    const pos = getEventPos(e);
    mouseX = pos.x;
    mouseY = pos.y;
    // Track max downward pull AND record handle position at that peak
    const pullY = nodes[NUM_NODES - 1].y - dragStartY;
    if (pullY > maxPullDist) {
      maxPullDist = pullY;
      maxPullHandlePos = { x: nodes[NUM_NODES - 1].x, y: nodes[NUM_NODES - 1].y };
    }
  }

  function onPointerUp(e) {
    if (!isDragging) return;
    const tension = getTension();
    isDragging = false;
    handle.style.cursor = 'grab';
    // (no sound on release — sound only fires if toggleLight() is called below)

    // ── Toggle validation ─────────────────────────────────────────
    // Condition 1 — DISTANCE: rope must have been pulled at least PULL_THRESHOLD
    //   pixels downward. A tiny nudge or accidental touch won't count.
    const farEnough = maxPullDist >= PULL_THRESHOLD;

    // Condition 2 — DIRECTION (180° downward cone):
    //   At the moment of maximum pull, the handle must be BELOW the anchor.
    //   This gives exactly 180° of valid pulling directions — any angle that
    //   has a downward component (left-down, straight-down, right-down).
    //   Pulling purely sideways or upward will never satisfy dy > 0.
    const anchor = getAnchor();
    const dy = maxPullHandlePos.y - anchor.y;  // positive = below anchor = valid
    const pulledDownward = dy > 0;

    if (farEnough && pulledDownward) {
      toggleLight();
    }

    maxPullDist      = 0;
    maxPullHandlePos = { x: 0, y: 0 };
  }

  function getEventPos(e) {
    if (e.touches && e.touches.length > 0) {
      return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
    return { x: e.clientX, y: e.clientY };
  }

  // Dismiss hint on first interaction
  function dismissHint() {
    if (!hintShown) return;
    hintShown = false;
    hint.classList.add('hidden');
  }

  // ── Bind events ───────────────────────────────────────────────────
  // Pointer events on the handle
  handle.addEventListener('mousedown',  onPointerDown);
  handle.addEventListener('touchstart', onPointerDown, { passive: false });

  // Move / Up tracked on window so drag works outside the element
  window.addEventListener('mousemove', onPointerMove);
  window.addEventListener('touchmove',  onPointerMove, { passive: false });
  window.addEventListener('mouseup',   onPointerUp);
  window.addEventListener('touchend',  onPointerUp);

  // Keyboard accessibility: Enter / Space on handle
  handle.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleLight();
      dismissHint();
    }
  });

  // Re-init rope positions on window resize
  window.addEventListener('resize', () => {
    initRope();
  });

  // ── Boot ──────────────────────────────────────────────────────────
  initRope();
  loop();

})();
