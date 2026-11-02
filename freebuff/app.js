/*
 * Element Lab — browser glue: canvas rendering, painting, controls.
 * Requires sim.js to be loaded first.
 */
(function () {
  'use strict';

  var Materials = window.ElementMaterials;
  var ElementSim = window.ElementSim;
  if (!Materials || !ElementSim) return;

  var M = Materials;
  var canvas = document.getElementById('lab');
  var stage = document.getElementById('stage');
  var ctx = canvas.getContext('2d');
  if (!ctx) return;

  var scratch = document.createElement('canvas');
  var sctx = scratch.getContext('2d');
  var sim = new ElementSim({ width: 150, height: 90, seed: Date.now() >>> 0 });

  var brushInput = document.getElementById('brush');
  var brushValue = document.getElementById('brushValue');
  var pauseBtn = document.getElementById('pauseBtn');
  var clearBtn = document.getElementById('clearBtn');
  var exampleBtn = document.getElementById('exampleBtn');
  var statusChip = document.getElementById('statusChip');
  var statusText = document.getElementById('statusText');
  var countChip = document.getElementById('countChip');
  var hint = document.getElementById('hint');
  var announcer = document.getElementById('announcer');
  var toolButtons = Array.prototype.slice.call(document.querySelectorAll('.tool'));

  var TOOL_ORDER = [M.SAND, M.WATER, M.WALL, M.FIRE, M.PLANT, M.EMPTY];
  var TOOL_COLORS = {};
  TOOL_COLORS[M.EMPTY] = '#f9a8d4';
  TOOL_COLORS[M.SAND] = '#f6c453';
  TOOL_COLORS[M.WATER] = '#38bdf8';
  TOOL_COLORS[M.WALL] = '#cbd5e1';
  TOOL_COLORS[M.FIRE] = '#fb7185';
  TOOL_COLORS[M.PLANT] = '#4ade80';

  var tool = M.SAND;
  var brush = 7;
  var paused = false;
  var sceneLoaded = false;
  var dpr = 1;
  var imageData = null;
  var pixels = null;
  var lastFrame = 0;
  var accumulator = 0;
  var frameCount = 0;
  var STEP_MS = 1000 / 60;

  var painting = false;
  var activePointer = null;
  var stroke = { active: false, x: 0, y: 0 };
  var hover = { visible: false, nx: 0, ny: 0 };
  var hintDismissed = false;

  // ---------- Rendering palette ----------

  function rgb(r, g, b) {
    return ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
  }

  var COLORS = {
    empty: rgb(6, 11, 20),
    dot: rgb(14, 24, 38),
    sand: [rgb(250, 209, 110), rgb(236, 190, 88), rgb(255, 226, 150), rgb(219, 166, 66)],
    water: [rgb(56, 189, 248), rgb(40, 165, 224), rgb(110, 214, 255), rgb(30, 140, 200)],
    wall: [rgb(122, 138, 160), rgb(104, 119, 139), rgb(140, 157, 178), rgb(88, 102, 120)],
    wallTop: rgb(172, 188, 208),
    plant: [rgb(74, 222, 128), rgb(52, 196, 110), rgb(112, 240, 156), rgb(40, 160, 90)],
    plantTop: rgb(176, 255, 208),
    fire: [
      [rgb(255, 224, 120), rgb(255, 205, 88), rgb(255, 242, 168)],
      [rgb(255, 158, 52), rgb(255, 126, 32), rgb(255, 190, 80)],
      [rgb(236, 82, 48), rgb(204, 52, 40), rgb(255, 112, 62)]
    ]
  };

  // ---------- Sizing ----------

  function fitGrid() {
    var rect = canvas.getBoundingClientRect();
    var cssWidth = Math.round(rect.width);
    var cssHeight = Math.round(rect.height);
    if (cssWidth < 60 || cssHeight < 60) return;

    var cell = Math.max(4, Math.min(9, Math.round(cssWidth / 150)));
    var cols = Math.max(32, Math.min(220, Math.floor(cssWidth / cell)));
    var rows = Math.max(24, Math.min(150, Math.floor(cssHeight / cell)));

    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);

    scratch.width = cols;
    scratch.height = rows;
    imageData = sctx.createImageData(cols, rows);
    pixels = new Uint32Array(imageData.data.buffer);
    sim.resize(cols, rows);

    if (!sceneLoaded) {
      sceneLoaded = true;
      buildScene();
      refreshCount();
    }
    render(performance.now());
  }

  // ---------- Example scene ----------

  function plantBush(cx, floorY, radius) {
    var cy = floorY - radius - 1;
    sim.paint(cx, cy, M.PLANT, radius * 2);
  }

  function buildScene() {
    sim.clear();
    var w = sim.width;
    var h = sim.height;

    var floorY = Math.max(8, Math.round(h * 0.8));
    var bench = Math.max(2, Math.round(h * 0.025));
    sim.fillRect(0, floorY, w, Math.min(h, floorY + bench + 1), M.WALL);

    // Lay out the garden with real gaps, so one burning specimen plant does
    // not consume the whole garden on page load.
    var bigRadius = Math.max(3, Math.round(h * 0.06));
    var midRadius = Math.max(2, Math.round(h * 0.045));
    var specimenRadius = Math.max(2, Math.round(h * 0.038));
    var gap = Math.max(2, Math.round(w * 0.02));
    var bushA = Math.round(w * 0.42);
    var bushB = bushA + bigRadius + midRadius + gap;
    var bushC = bushB + midRadius + specimenRadius + gap;

    // Glass tank holding the water supply on the right.
    var tankA = Math.max(bushC + specimenRadius + 4, Math.round(w * 0.66));
    var tankB = Math.round(w * 0.94);
    var tankTop = Math.round(h * 0.42);
    var rim = Math.max(2, Math.round(w * 0.012));
    sim.fillRect(tankA, tankTop, tankA + rim, floorY, M.WALL);
    sim.fillRect(tankB, tankTop, tankB + rim, floorY, M.WALL);
    var waterTop = floorY - Math.max(4, Math.round(h * 0.18));
    sim.fillRect(tankA + rim, waterTop, tankB, floorY, M.WATER);

    // Sand dune on the left.
    var duneA = Math.round(w * 0.05);
    var duneB = Math.max(duneA + 2, Math.round(w * 0.3));
    for (var x = duneA; x <= duneB; x++) {
      var u = (x - duneA) / Math.max(1, duneB - duneA);
      var hump = Math.pow(Math.sin(Math.PI * u), 1.15);
      var top = floorY - Math.round(hump * h * 0.2);
      sim.fillRect(x, top, x + 1, floorY, M.SAND);
    }

    plantBush(bushA, floorY, bigRadius);
    plantBush(bushB, floorY, midRadius);
    plantBush(bushC, floorY, specimenRadius);

    // A lone specimen plant is already smouldering as a live demo.
    var sparkY = floorY - specimenRadius * 2 - 2;
    if (sparkY > 0) {
      sim.set(bushC, sparkY, M.FIRE);
      if (bushC + 1 < w) sim.set(bushC + 1, sparkY, M.FIRE);
    }
  }

  // ---------- State updates ----------

  function announce(message) {
    announcer.textContent = '';
    window.setTimeout(function () {
      announcer.textContent = message;
    }, 20);
  }

  function selectTool(material, silent) {
    if (TOOL_ORDER.indexOf(material) === -1) return;
    tool = material;
    for (var i = 0; i < toolButtons.length; i++) {
      var btn = toolButtons[i];
      var selected = Number(btn.getAttribute('data-material')) === material;
      btn.setAttribute('aria-pressed', selected ? 'true' : 'false');
    }
    if (!silent) announce(M.MATERIAL_NAMES[material] + ' selected');
  }

  function setBrush(value) {
    var next = Math.max(1, Math.min(24, Math.round(Number(value) || 1)));
    brush = next;
    brushInput.value = String(next);
    brushValue.textContent = String(next);
    brushInput.style.setProperty('--fill', (((next - 1) / 23) * 100).toFixed(2) + '%');
  }

  function refreshCount() {
    var total = sim.activeCount();
    countChip.textContent = total.toLocaleString('en-US') + (total === 1 ? ' cell' : ' cells');
  }

  function setPaused(next, silent) {
    paused = Boolean(next);
    pauseBtn.setAttribute('aria-pressed', paused ? 'true' : 'false');
    pauseBtn.textContent = paused ? 'Resume' : 'Pause';
    statusChip.classList.toggle('is-paused', paused);
    stage.classList.toggle('is-paused', paused);
    statusText.textContent = paused ? 'Paused' : 'Running';
    accumulator = 0;
    lastFrame = 0;
    if (!silent) announce(paused ? 'Simulation paused' : 'Simulation resumed');
  }

  function clearAll() {
    sim.clear();
    refreshCount();
    announce('Simulation cleared');
  }

  function loadExample() {
    buildScene();
    refreshCount();
    announce('Example scene loaded');
  }

  function dismissHint() {
    if (hintDismissed) return;
    hintDismissed = true;
    hint.classList.add('is-hidden');
  }

  // ---------- Painting ----------

  function pointerPosition(event) {
    var rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    var fx = (event.clientX - rect.left) / rect.width;
    var fy = (event.clientY - rect.top) / rect.height;
    return {
      nx: fx * sim.width,
      ny: fy * sim.height,
      inside: fx >= 0 && fx <= 1 && fy >= 0 && fy <= 1
    };
  }

  function paintAt(nx, ny) {
    sim.paint(nx - 0.5, ny - 0.5, tool, brush);
    if (!hintDismissed) dismissHint();
    if (!stroke.active) {
      stroke.active = true;
      stroke.x = nx;
      stroke.y = ny;
      return;
    }
    var dx = nx - stroke.x;
    var dy = ny - stroke.y;
    var steps = Math.max(1, Math.min(160, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) * 2)));
    for (var i = 1; i <= steps; i++) {
      sim.paint(stroke.x + (dx * i) / steps - 0.5, stroke.y + (dy * i) / steps - 0.5, tool, brush);
    }
    stroke.x = nx;
    stroke.y = ny;
  }

  function endStroke(event) {
    if (event && activePointer !== null && event.pointerId !== activePointer) return;
    if (event && event.pointerType && event.pointerType !== 'mouse' && event.pointerType !== 'pen') {
      hover.visible = false;
    }
    painting = false;
    activePointer = null;
    stroke.active = false;
    refreshCount();
  }

  canvas.addEventListener('pointerdown', function (event) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    var point = pointerPosition(event);
    if (!point) return;
    event.preventDefault();
    painting = true;
    activePointer = event.pointerId;
    stroke.active = false;
    hover.visible = true;
    hover.nx = point.nx;
    hover.ny = point.ny;
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch (error) {
      /* pointer capture is a nicety, not a requirement */
    }
    paintAt(point.nx, point.ny);
  });

  canvas.addEventListener('pointermove', function (event) {
    var point = pointerPosition(event);
    if (!point) return;
    if (painting && event.pointerId === activePointer) {
      event.preventDefault();
      hover.visible = true;
      hover.nx = point.nx;
      hover.ny = point.ny;
      paintAt(point.nx, point.ny);
    } else if (event.pointerType === 'mouse' || event.pointerType === 'pen') {
      hover.visible = point.inside;
      hover.nx = point.nx;
      hover.ny = point.ny;
    }
  });

  canvas.addEventListener('pointerup', endStroke);
  canvas.addEventListener('pointercancel', endStroke);
  canvas.addEventListener('lostpointercapture', endStroke);
  canvas.addEventListener('pointerleave', function () {
    if (!painting) hover.visible = false;
  });
  canvas.addEventListener('dragstart', function (event) {
    event.preventDefault();
  });

  // ---------- Controls ----------

  toolButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      selectTool(Number(btn.getAttribute('data-material')));
    });
  });

  brushInput.addEventListener('input', function () {
    setBrush(brushInput.value);
  });

  pauseBtn.addEventListener('click', function () {
    setPaused(!paused);
  });

  clearBtn.addEventListener('click', clearAll);
  exampleBtn.addEventListener('click', loadExample);

  document.addEventListener('keydown', function (event) {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    var tag = (event.target && event.target.tagName ? event.target.tagName : '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

    var digit = event.key >= '1' && event.key <= '6' ? Number(event.key) : 0;
    if (digit) {
      selectTool(TOOL_ORDER[digit - 1]);
      event.preventDefault();
      return;
    }
    if (event.code === 'Space' && tag !== 'button') {
      setPaused(!paused);
      event.preventDefault();
      return;
    }
    if ((event.key === 'c' || event.key === 'C') && !event.repeat) {
      clearAll();
      return;
    }
    if ((event.key === 'e' || event.key === 'E') && !event.repeat) {
      loadExample();
    }
  });

  window.addEventListener('resize', fitGrid);
  window.addEventListener('orientationchange', function () {
    window.setTimeout(fitGrid, 140);
  });
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(function () {
      fitGrid();
    }).observe(stage);
  }

  // ---------- Render loop ----------

  function drawCursor() {
    if (!hover.visible) return;
    var scaleX = canvas.width / sim.width;
    var scaleY = canvas.height / sim.height;
    var cx = hover.nx * scaleX;
    var cy = hover.ny * scaleY;
    var rx = Math.max(3 * dpr, (brush / 2) * scaleX);
    var ry = Math.max(3 * dpr, (brush / 2) * scaleY);
    var color = TOOL_COLORS[tool] || '#ffffff';

    ctx.save();
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(2, 6, 12, 0.88)';
    ctx.lineWidth = Math.max(2, 3.4 * dpr);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, 1.5 * dpr);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(1.4, 1.7 * dpr), 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  }

  function render(time) {
    if (!pixels) return;
    var w = sim.width;
    var h = sim.height;
    var cells = sim.cells;
    var life = sim.life;
    var tick = Math.floor((time || 0) / 110);
    var index = 0;

    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++, index++) {
        var material = cells[index];
        if (material === M.EMPTY) {
          pixels[index] = x % 16 === 0 && y % 16 === 0 ? COLORS.dot : COLORS.empty;
          continue;
        }
        var hash = ((x * 73856093) ^ (y * 19349663) ^ (index * 83492791)) >>> 0;
        var variant = hash & 3;
        var above = y > 0 ? cells[index - w] : M.WALL;

        if (material === M.SAND) {
          pixels[index] = COLORS.sand[variant];
        } else if (material === M.WATER) {
          pixels[index] = COLORS.water[variant];
        } else if (material === M.WALL) {
          pixels[index] = above === M.WALL ? COLORS.wall[variant] : COLORS.wallTop;
        } else if (material === M.PLANT) {
          pixels[index] = above === M.PLANT ? COLORS.plant[variant] : COLORS.plantTop;
        } else if (material === M.FIRE) {
          var ratio = life[index] / Math.max(1, sim.plantFireLife);
          var level = ratio > 0.55 ? 0 : ratio > 0.22 ? 1 : 2;
          pixels[index] = COLORS.fire[level][(hash + tick) % 3];
        } else {
          pixels[index] = COLORS.wall[0];
        }
      }
    }

    sctx.putImageData(imageData, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(scratch, 0, 0, canvas.width, canvas.height);
    drawCursor();
  }

  function frame(now) {
    if (!lastFrame) lastFrame = now;
    var dt = now - lastFrame;
    lastFrame = now;

    if (paused) {
      accumulator = 0;
    } else {
      if (dt > 250) dt = 250;
      accumulator += dt;
      var budget = 0;
      while (accumulator >= STEP_MS && budget < 3) {
        sim.step();
        accumulator -= STEP_MS;
        budget++;
      }
      if (budget === 3) accumulator = 0;
    }

    render(now);
    frameCount++;
    if (frameCount % 20 === 0) refreshCount();
    requestAnimationFrame(frame);
  }

  // ---------- Boot ----------

  setBrush(brushInput.value);
  selectTool(M.SAND, true);
  fitGrid();
  requestAnimationFrame(frame);

  // Small public surface for debugging and the local test suite.
  window.ElementLab = {
    sim: sim,
    selectTool: function (material) {
      selectTool(material);
    },
    setBrush: setBrush,
    setPaused: function (value) {
      setPaused(value);
    },
    clear: clearAll,
    example: loadExample,
    paint: function (cx, cy, material, diameter) {
      sim.paint(cx, cy, material, diameter);
      refreshCount();
    },
    debug: function () {
      return {
        tool: tool,
        toolName: M.MATERIAL_NAMES[tool],
        brush: brush,
        paused: paused,
        width: sim.width,
        height: sim.height,
        steps: sim.steps,
        hash: sim.hash(),
        counts: sim.counts(),
        canvas: {
          width: canvas.width,
          height: canvas.height,
          clientWidth: canvas.clientWidth,
          clientHeight: canvas.clientHeight
        }
      };
    }
  };
})();
