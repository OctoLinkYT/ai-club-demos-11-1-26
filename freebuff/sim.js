/*
 * Element Lab — grid simulation engine.
 * Pure JavaScript, no DOM dependencies. Works as a browser global
 * (window.ElementSim / window.ElementMaterials) and as a CommonJS module
 * for the Node test suite.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.ElementSim = api.ElementSim;
    root.ElementMaterials = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var EMPTY = 0;
  var SAND = 1;
  var WATER = 2;
  var WALL = 3;
  var FIRE = 4;
  var PLANT = 5;

  var MATERIAL_NAMES = {
    0: 'Eraser',
    1: 'Sand',
    2: 'Water',
    3: 'Wall',
    4: 'Fire',
    5: 'Plant'
  };

  var COUNTS_KEYS = ['empty', 'sand', 'water', 'wall', 'fire', 'plant'];

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function clampInt(value, min, max, fallback) {
    var n = Math.floor(Number(value));
    if (!isFinite(n)) n = fallback;
    return Math.max(min, Math.min(max, n));
  }

  function ElementSim(options) {
    options = options || {};
    this.width = clampInt(options.width, 8, 400, 150);
    this.height = clampInt(options.height, 8, 300, 90);
    this.seed = (options.seed == null ? 1 : options.seed) >>> 0;
    this._random = mulberry32(this.seed);
    this.waterSpread = options.waterSpread == null ? 5 : clampInt(options.waterSpread, 1, 24, 5);
    this.fireLife = options.fireLife == null ? 140 : clampInt(options.fireLife, 10, 2000, 140);
    this.plantFireLife = options.plantFireLife == null ? 180 : clampInt(options.plantFireLife, 10, 2000, 180);

    this.cells = new Uint8Array(this.width * this.height);
    this.life = new Uint8Array(this.width * this.height);
    this.moved = new Uint8Array(this.width * this.height);
    this.steps = 0;
  }

  ElementSim.prototype.inside = function (x, y) {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  };

  ElementSim.prototype.get = function (x, y) {
    // Out of bounds is treated as solid so rules never leak past the edge.
    if (!this.inside(x, y)) return WALL;
    return this.cells[y * this.width + x];
  };

  ElementSim.prototype.set = function (x, y, material, lifeOverride) {
    if (!this.inside(x, y)) return false;
    material = material | 0;
    if (material < EMPTY || material > PLANT) return false;
    var i = y * this.width + x;
    this.cells[i] = material;
    this.life[i] = material === FIRE
      ? clampInt(lifeOverride == null ? this.fireLife : lifeOverride, 1, 255, this.fireLife)
      : 0;
    return true;
  };

  /**
   * Paint a circular brush. `diameter` is measured in grid cells.
   * Returns the number of cells that were set.
   */
  ElementSim.prototype.paint = function (cx, cy, material, diameter) {
    material = material | 0;
    if (material < EMPTY || material > PLANT) return 0;
    var d = Math.max(1, Math.round(diameter || 1));
    var radius = Math.floor(d / 2);
    var reach = radius * radius + radius * 0.5;
    var centerX = Math.round(cx);
    var centerY = Math.round(cy);
    var x0 = Math.max(0, centerX - radius);
    var x1 = Math.min(this.width - 1, centerX + radius);
    var y0 = Math.max(0, centerY - radius);
    var y1 = Math.min(this.height - 1, centerY + radius);
    var painted = 0;

    for (var y = y0; y <= y1; y++) {
      for (var x = x0; x <= x1; x++) {
        var dx = x - centerX;
        var dy = y - centerY;
        if (dx * dx + dy * dy > reach) continue;
        var fireLife = material === FIRE
          ? Math.round(this.fireLife * (0.6 + this._random() * 0.6))
          : 0;
        var i = y * this.width + x;
        this.cells[i] = material;
        this.life[i] = fireLife;
        painted++;
      }
    }
    return painted;
  };

  ElementSim.prototype.fillRect = function (x0, y0, x1, y1, material) {
    var ax = Math.max(0, Math.min(x0, x1));
    var bx = Math.min(this.width, Math.max(x0, x1));
    var ay = Math.max(0, Math.min(y0, y1));
    var by = Math.min(this.height, Math.max(y0, y1));
    var painted = 0;
    for (var y = ay; y < by; y++) {
      for (var x = ax; x < bx; x++) {
        var fireLife = material === FIRE ? this.fireLife : 0;
        var i = y * this.width + x;
        this.cells[i] = material;
        this.life[i] = fireLife;
        painted++;
      }
    }
    return painted;
  };

  ElementSim.prototype.clear = function () {
    this.cells.fill(EMPTY);
    this.life.fill(0);
    this.moved.fill(0);
  };

  ElementSim.prototype.count = function (material) {
    var cells = this.cells;
    var total = 0;
    for (var i = 0; i < cells.length; i++) {
      if (cells[i] === material) total++;
    }
    return total;
  };

  ElementSim.prototype.activeCount = function () {
    return this.cells.length - this.count(EMPTY);
  };

  ElementSim.prototype.counts = function () {
    var out = { empty: 0, sand: 0, water: 0, wall: 0, fire: 0, plant: 0 };
    var cells = this.cells;
    for (var i = 0; i < cells.length; i++) {
      out[COUNTS_KEYS[cells[i]]]++;
    }
    return out;
  };

  /** Stable fingerprint of the grid, used by pause/resume tests. */
  ElementSim.prototype.hash = function () {
    var h = 2166136261;
    var cells = this.cells;
    for (var i = 0; i < cells.length; i++) {
      h ^= cells[i];
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  };

  /**
   * Resize the grid, keeping existing material anchored to the bottom-left
   * corner so piles do not vanish when a window gets shorter.
   */
  ElementSim.prototype.resize = function (width, height) {
    var w = clampInt(width, 8, 400, this.width);
    var h = clampInt(height, 8, 300, this.height);
    if (w === this.width && h === this.height) return false;

    var nextCells = new Uint8Array(w * h);
    var nextLife = new Uint8Array(w * h);
    var copyW = Math.min(w, this.width);
    var copyH = Math.min(h, this.height);

    for (var row = 1; row <= copyH; row++) {
      var fromY = this.height - row;
      var toY = h - row;
      var from = fromY * this.width;
      var to = toY * w;
      nextCells.set(this.cells.subarray(from, from + copyW), to);
      nextLife.set(this.life.subarray(from, from + copyW), to);
    }

    this.width = w;
    this.height = h;
    this.cells = nextCells;
    this.life = nextLife;
    this.moved = new Uint8Array(w * h);
    return true;
  };

  ElementSim.prototype.step = function () {
    var w = this.width;
    var h = this.height;
    this.moved.fill(0);

    // Bottom-up so falling material only moves once per step. Alternating the
    // horizontal scan direction avoids a permanent left/right bias.
    var leftToRight = (this.steps & 1) === 0;
    for (var y = h - 1; y >= 0; y--) {
      if (leftToRight) {
        for (var x = 0; x < w; x++) this._update(x, y);
      } else {
        for (var x2 = w - 1; x2 >= 0; x2--) this._update(x2, y);
      }
    }
    this.steps++;
  };

  ElementSim.prototype._swap = function (from, to) {
    var cells = this.cells;
    var life = this.life;
    var material = cells[from];
    var energy = life[from];
    cells[from] = cells[to];
    life[from] = life[to];
    cells[to] = material;
    life[to] = energy;
  };

  ElementSim.prototype._update = function (x, y) {
    var idx = y * this.width + x;
    var material = this.cells[idx];
    if (material === EMPTY || material === WALL || this.moved[idx]) return;
    if (material === SAND) this._stepSand(x, y, idx);
    else if (material === WATER) this._stepWater(x, y, idx);
    else if (material === FIRE) this._stepFire(x, y, idx);
    // Plant cells never move on their own.
  };

  ElementSim.prototype._stepSand = function (x, y, idx) {
    var w = this.width;
    if (y + 1 >= this.height) return;

    var below = idx + w;
    var target = this.cells[below];
    if (target === EMPTY || target === WATER) {
      // Sand sinks through water by swapping with it.
      this._swap(idx, below);
      this.moved[below] = 1;
      if (target === WATER) this.moved[idx] = 1;
      return;
    }

    var first = this._random() < 0.5 ? -1 : 1;
    for (var pass = 0; pass < 2; pass++) {
      var dx = pass === 0 ? first : -first;
      var nx = x + dx;
      if (nx < 0 || nx >= w) continue;
      var nIdx = below + dx;
      if (this.cells[nIdx] === EMPTY) {
        this._swap(idx, nIdx);
        this.moved[nIdx] = 1;
        return;
      }
    }
  };

  ElementSim.prototype._stepWater = function (x, y, idx) {
    var w = this.width;

    if (y + 1 < this.height) {
      var below = idx + w;
      if (this.cells[below] === EMPTY) {
        this._swap(idx, below);
        this.moved[below] = 1;
        return;
      }
      var first = this._random() < 0.5 ? -1 : 1;
      for (var pass = 0; pass < 2; pass++) {
        var dx = pass === 0 ? first : -first;
        var nx = x + dx;
        if (nx < 0 || nx >= w) continue;
        var nIdx = below + dx;
        if (this.cells[nIdx] === EMPTY) {
          this._swap(idx, nIdx);
          this.moved[nIdx] = 1;
          return;
        }
      }
    }

    // Blocked below: flow along the row until it finds a gap or the limit.
    var direction = this._random() < 0.5 ? -1 : 1;
    var destination = -1;
    for (var d = 1; d <= this.waterSpread; d++) {
      var sx = x + direction * d;
      if (sx < 0 || sx >= w) break;
      var sIdx = y * w + sx;
      if (this.cells[sIdx] !== EMPTY) break;
      destination = sIdx;
    }
    if (destination >= 0) {
      this._swap(idx, destination);
      this.moved[destination] = 1;
    }
  };

  ElementSim.prototype._stepFire = function (x, y, idx) {
    var w = this.width;
    var h = this.height;
    var cells = this.cells;
    var life = this.life;

    // Water next to fire puts it out before it can spread.
    for (var oy = -1; oy <= 1; oy++) {
      var ny = y + oy;
      if (ny < 0 || ny >= h) continue;
      for (var ox = -1; ox <= 1; ox++) {
        if (ox === 0 && oy === 0) continue;
        var nx = x + ox;
        if (nx < 0 || nx >= w) continue;
        if (cells[ny * w + nx] === WATER) {
          cells[idx] = EMPTY;
          life[idx] = 0;
          return;
        }
      }
    }

    // Plants always catch fire when touching a flame.
    for (var oy2 = -1; oy2 <= 1; oy2++) {
      var ny2 = y + oy2;
      if (ny2 < 0 || ny2 >= h) continue;
      for (var ox2 = -1; ox2 <= 1; ox2++) {
        if (ox2 === 0 && oy2 === 0) continue;
        var nx2 = x + ox2;
        if (nx2 < 0 || nx2 >= w) continue;
        var nIdx = ny2 * w + nx2;
        if (cells[nIdx] === PLANT) {
          cells[nIdx] = FIRE;
          life[nIdx] = this.plantFireLife;
          this.moved[nIdx] = 1;
        }
      }
    }

    if (life[idx] <= 1) {
      cells[idx] = EMPTY;
      life[idx] = 0;
    } else {
      life[idx]--;
    }
  };

  return {
    ElementSim: ElementSim,
    EMPTY: EMPTY,
    SAND: SAND,
    WATER: WATER,
    WALL: WALL,
    FIRE: FIRE,
    PLANT: PLANT,
    MATERIAL_NAMES: MATERIAL_NAMES
  };
});
