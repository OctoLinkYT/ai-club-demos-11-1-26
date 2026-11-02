'use strict';

/*
 * Element Lab engine tests. No dependencies; run with:
 *   node tests/sim.test.js
 */

const assert = require('node:assert/strict');
const path = require('node:path');

const {
  ElementSim,
  EMPTY,
  SAND,
  WATER,
  WALL,
  FIRE,
  PLANT
} = require(path.join(__dirname, '..', 'sim.js'));

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok   ' + name);
  } catch (error) {
    failed++;
    console.log('  FAIL ' + name);
    console.log('       ' + (error && error.stack ? error.stack.split('\n').join('\n       ') : error));
  }
}

function make(width, height, options) {
  return new ElementSim(Object.assign({ width: width, height: height, seed: 7 }, options));
}

function readCell(sim, x, y) {
  return sim.cells[y * sim.width + x];
}

function sandSettled(sim) {
  const w = sim.width;
  const h = sim.height;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (readCell(sim, x, y) !== SAND) continue;
      if (y + 1 >= h) continue;
      if (readCell(sim, x, y + 1) === EMPTY) return false;
      if (x > 0 && readCell(sim, x - 1, y + 1) === EMPTY) return false;
      if (x < w - 1 && readCell(sim, x + 1, y + 1) === EMPTY) return false;
    }
  }
  return true;
}

console.log('Element Lab — engine tests\n');

test('initialization creates an empty in-bounds grid', () => {
  const sim = make(40, 30);
  assert.equal(sim.width, 40);
  assert.equal(sim.height, 30);
  assert.equal(sim.cells.length, 40 * 30);
  assert.equal(sim.steps, 0);
  assert.deepEqual(sim.counts(), {
    empty: 1200,
    sand: 0,
    water: 0,
    wall: 0,
    fire: 0,
    plant: 0
  });
});

test('each material can be painted and erased', () => {
  const sim = make(30, 20);
  const pairs = [
    [SAND, 'sand'],
    [WATER, 'water'],
    [WALL, 'wall'],
    [PLANT, 'plant']
  ];

  for (const [material, key] of pairs) {
    sim.clear();
    const painted = sim.paint(15, 10, material, 4);
    assert.ok(painted > 1, key + ' brush paints several cells');
    assert.equal(sim.get(15, 10), material, key + ' is placed at the brush centre');
    assert.equal(sim.counts()[key], painted, key + ' count matches painted cells');

    sim.paint(15, 10, EMPTY, 4);
    assert.equal(sim.counts()[key], 0, key + ' is removed by the eraser');
  }

  sim.clear();
  assert.equal(sim.set(5, 5, FIRE), true);
  assert.equal(sim.count(FIRE), 1);
  assert.ok(sim.life[5 * sim.width + 5] > 0, 'fire starts with a burn timer');
});

test('brush size changes how much material is painted', () => {
  const sim = make(40, 40);
  sim.paint(20, 20, SAND, 1);
  assert.equal(sim.count(SAND), 1, 'smallest brush paints one cell');

  sim.clear();
  const large = sim.paint(20, 20, SAND, 9);
  assert.ok(large > 30, 'large brush paints a filled circle');
  assert.equal(sim.count(SAND), large);
});

test('sand falls and piles up without losing material', () => {
  const sim = make(30, 30);
  const painted = sim.paint(15, 2, SAND, 5);
  assert.ok(painted > 10);

  for (let i = 0; i < 400; i++) sim.step();

  assert.equal(sim.count(SAND), painted, 'sand mass is conserved');
  assert.ok(sandSettled(sim), 'every grain has support below or to the side');

  let lowest = -1;
  for (let y = 0; y < sim.height; y++) {
    for (let x = 0; x < sim.width; x++) {
      if (readCell(sim, x, y) === SAND) lowest = Math.max(lowest, y);
    }
  }
  assert.ok(lowest >= sim.height - 1, 'sand reaches the bottom row (lowest row ' + lowest + ')');
});

test('sand sinks through water and conserves both materials', () => {
  const sim = make(30, 30);
  sim.fillRect(0, 25, 30, 26, WALL);
  sim.fillRect(8, 18, 22, 24, WATER);
  const water = sim.count(WATER);
  const sand = sim.paint(15, 15, SAND, 5);

  for (let i = 0; i < 200; i++) sim.step();

  assert.equal(sim.count(WATER), water, 'water mass is conserved');
  assert.equal(sim.count(SAND), sand, 'sand mass is conserved');
  let sandBelowWater = 0;
  for (let x = 0; x < sim.width; x++) {
    for (let y = 23; y < 25; y++) {
      if (readCell(sim, x, y) === SAND) sandBelowWater++;
    }
  }
  assert.ok(sandBelowWater > 0, 'sand reaches the bottom of the water layer');
});

test('water falls and spreads sideways when blocked', () => {
  const sim = make(40, 20);
  sim.fillRect(4, 17, 36, 18, WALL); // floor
  sim.fillRect(4, 8, 5, 17, WALL); // left wall
  sim.fillRect(35, 8, 36, 17, WALL); // right wall

  const painted = sim.paint(20, 10, WATER, 4);
  const startColumns = new Set();
  for (let x = 0; x < sim.width; x++) {
    for (let y = 0; y < sim.height; y++) {
      if (readCell(sim, x, y) === WATER) startColumns.add(x);
    }
  }

  for (let i = 0; i < 300; i++) sim.step();

  assert.equal(sim.count(WATER), painted, 'water mass is conserved');
  const columns = new Set();
  let lowest = 0;
  for (let x = 0; x < sim.width; x++) {
    for (let y = 0; y < sim.height; y++) {
      if (readCell(sim, x, y) !== WATER) continue;
      columns.add(x);
      lowest = Math.max(lowest, y);
      assert.ok(x >= 5 && x <= 34, 'water stays between the walls (x=' + x + ')');
      assert.ok(y < 17, 'water does not pass through the floor (y=' + y + ')');
    }
  }
  assert.ok(columns.size > startColumns.size + 4, 'water spreads across more columns');
  assert.ok(Math.min(...columns) <= 7, 'water reaches near the left wall');
  assert.ok(Math.max(...columns) >= 32, 'water reaches near the right wall');
  assert.equal(lowest, 16, 'water settles on the floor row');
});

test('walls never move or disappear', () => {
  const sim = make(30, 24);
  sim.fillRect(0, 20, 30, 21, WALL);
  sim.fillRect(8, 12, 10, 20, WALL);
  sim.fillRect(20, 8, 22, 20, WALL);
  sim.paint(12, 4, SAND, 5);
  sim.paint(24, 4, WATER, 5);
  sim.set(15, 10, FIRE);

  const walls = [];
  for (let y = 0; y < sim.height; y++) {
    for (let x = 0; x < sim.width; x++) {
      if (readCell(sim, x, y) === WALL) walls.push([x, y]);
    }
  }
  const wallCount = sim.count(WALL);

  for (let i = 0; i < 300; i++) sim.step();

  assert.equal(sim.count(WALL), wallCount, 'wall count is unchanged');
  for (const [x, y] of walls) {
    assert.equal(readCell(sim, x, y), WALL, 'wall at ' + x + ',' + y + ' stays put');
  }
});

test('plant stays still until it is ignited', () => {
  const sim = make(30, 22);
  sim.paint(15, 12, PLANT, 6);

  const before = [];
  for (let y = 0; y < sim.height; y++) {
    for (let x = 0; x < sim.width; x++) {
      if (readCell(sim, x, y) === PLANT) before.push(x + ',' + y);
    }
  }

  for (let i = 0; i < 150; i++) sim.step();

  const after = [];
  for (let y = 0; y < sim.height; y++) {
    for (let x = 0; x < sim.width; x++) {
      if (readCell(sim, x, y) === PLANT) after.push(x + ',' + y);
    }
  }
  assert.deepEqual(after, before, 'plant cells do not move on their own');
});

test('fire ignites adjacent plants and eventually burns out', () => {
  const sim = make(30, 22, { seed: 99 });
  const plants = sim.paint(15, 14, PLANT, 6);
  assert.ok(plants > 4);
  sim.set(15, 10, FIRE);
  assert.equal(sim.count(FIRE), 1);

  sim.step();
  assert.ok(sim.count(PLANT) < plants, 'a plant next to fire catches on fire');
  assert.ok(sim.count(FIRE) > 1, 'fire spreads into the plant');

  let peakFire = sim.count(FIRE);
  let burnedOutAt = -1;
  for (let i = 0; i < 800; i++) {
    sim.step();
    peakFire = Math.max(peakFire, sim.count(FIRE));
    if (sim.count(FIRE) === 0 && sim.count(PLANT) === 0) {
      burnedOutAt = i;
      break;
    }
  }

  assert.ok(peakFire > 2, 'the fire visibly grows');
  assert.ok(burnedOutAt >= 0, 'all fire and plant material is gone by the end');
  assert.equal(sim.count(FIRE), 0, 'no fire remains');
  assert.equal(sim.count(PLANT), 0, 'no plant remains');
});

test('water next to fire puts it out', () => {
  const sim = make(20, 16);
  sim.set(10, 10, FIRE);
  sim.set(11, 10, WATER);
  assert.equal(sim.count(FIRE), 1);
  sim.step();
  assert.equal(sim.count(FIRE), 0, 'adjacent water extinguishes fire');
  assert.equal(sim.count(WATER), 1, 'water is not consumed');
});

test('materials are bounded by the grid edges', () => {
  const sim = make(20, 16);
  assert.equal(sim.get(-1, 5), WALL, 'out-of-bounds reads act solid');
  assert.equal(sim.get(20, 5), WALL);
  assert.equal(sim.get(5, -1), WALL);
  assert.equal(sim.get(5, 16), WALL);

  sim.paint(-2, -2, SAND, 6);
  sim.paint(22, 18, WATER, 8);
  assert.ok(sim.count(SAND) > 0, 'brush partly over the edge still paints inside');
  assert.ok(sim.count(WATER) > 0);

  for (let i = 0; i < 80; i++) sim.step();
  assert.equal(sim.cells.length, 20 * 16);
  assert.equal(sim.activeCount(), sim.count(SAND) + sim.count(WATER));
});

test('clear empties every cell', () => {
  const sim = make(24, 20);
  sim.paint(10, 10, SAND, 4);
  sim.paint(15, 10, WATER, 4);
  sim.fillRect(0, 18, 24, 19, WALL);
  sim.paint(5, 5, PLANT, 4);
  sim.set(18, 6, FIRE);
  assert.ok(sim.activeCount() > 0);

  sim.clear();

  assert.equal(sim.activeCount(), 0);
  assert.deepEqual(sim.counts(), {
    empty: sim.width * sim.height,
    sand: 0,
    water: 0,
    wall: 0,
    fire: 0,
    plant: 0
  });
});

test('resize preserves material, anchored to the bottom-left', () => {
  const sim = make(20, 20);
  sim.set(3, 19, SAND);
  sim.set(18, 19, PLANT);

  assert.equal(sim.resize(30, 30), true);
  assert.equal(sim.width, 30);
  assert.equal(sim.height, 30);
  assert.equal(sim.get(3, 29), SAND, 'bottom-left sand is preserved');
  assert.equal(sim.get(18, 29), PLANT, 'bottom-row plant is preserved');

  assert.equal(sim.resize(10, 10), true);
  assert.equal(sim.get(3, 9), SAND, 'surviving sand is still bottom-left');
  assert.equal(sim.inside(18, 9), false, 'cells outside the new width are clipped');
  assert.equal(sim.count(PLANT), 0, 'clipped plant material is gone');
  assert.equal(sim.resize(10, 10), false, 'resizing to the same size is a no-op');
});

test('simulation is deterministic for a given seed', () => {
  function run(seed) {
    const sim = new ElementSim({ width: 40, height: 30, seed: seed });
    sim.paint(20, 5, SAND, 7);
    sim.paint(10, 5, WATER, 7);
    sim.paint(30, 5, PLANT, 7);
    for (let i = 0; i < 120; i++) sim.step();
    return sim.hash();
  }

  assert.equal(run(12345), run(12345), 'same seed gives the same result');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exitCode = 1;
