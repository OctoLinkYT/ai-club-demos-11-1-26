(function (root) {
  'use strict';
  const MATERIAL = { EMPTY: 0, SAND: 1, WATER: 2, WALL: 3, FIRE: 4, PLANT: 5 };
  class Simulation {
    constructor(width = 240, height = 150, random = Math.random) {
      this.width = width; this.height = height; this.random = random;
      this.cells = new Uint8Array(width * height);
      this.life = new Uint8Array(width * height);
      this.updated = new Uint8Array(width * height);
      this.tick = 0;
    }
    inside(x, y) { return x >= 0 && x < this.width && y >= 0 && y < this.height; }
    get(x, y) { return this.inside(x, y) ? this.cells[y * this.width + x] : MATERIAL.WALL; }
    set(x, y, type) {
      if (!this.inside(x, y)) return;
      const i = y * this.width + x;
      this.cells[i] = type; this.life[i] = type === MATERIAL.FIRE ? 35 + Math.floor(this.random() * 30) : 0;
    }
    clear() { this.cells.fill(0); this.life.fill(0); this.updated.fill(0); this.tick = 0; }
    brush(x, y, radius, type) {
      for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy > radius * radius || !this.inside(x + dx, y + dy)) continue;
        if (type === 0 || this.get(x + dx, y + dy) === 0) this.set(x + dx, y + dy, type);
      }
    }
    move(x, y, nx, ny) {
      if (!this.inside(nx, ny)) return false;
      const a = y * this.width + x, b = ny * this.width + nx;
      if (this.updated[b]) return false;
      if (this.cells[b] !== 0 && !(this.cells[a] === 1 && this.cells[b] === 2)) return false;
      const displaced = this.cells[b]; this.cells[b] = this.cells[a]; this.cells[a] = displaced;
      this.updated[a] = this.updated[b] = 1;
      return true;
    }
    step() {
      this.tick++; this.updated.fill(0);
      for (let y = this.height - 1; y >= 0; y--) for (let n = 0; n < this.width; n++) {
        const x = this.tick % 2 ? n : this.width - 1 - n, i = y * this.width + x;
        if (this.updated[i]) continue;
        const type = this.cells[i], d = this.random() < 0.5 ? -1 : 1;
        if (type === 1 || type === 2) {
          if (this.move(x, y, x, y + 1) || this.move(x, y, x + d, y + 1) || this.move(x, y, x - d, y + 1)) continue;
          if (type === 2) { if (!this.move(x, y, x + d, y)) this.move(x, y, x - d, y); }
        } else if (type === 4) {
          const neighbors = [[x-1,y],[x+1,y],[x,y-1],[x,y+1]];
          if (neighbors.some(([nx,ny]) => this.get(nx,ny) === 2)) { this.set(x,y,0); continue; }
          for (const [nx,ny] of neighbors) if (this.get(nx,ny) === 5) {
            this.set(nx,ny,4); this.updated[ny * this.width + nx] = 1;
          }
          if (--this.life[i] === 0) this.set(x,y,0);
        }
      }
    }
    example() {
      this.clear();
      const w = this.width, h = this.height;
      for (let x = Math.floor(w*.08); x < w*.45; x++) this.set(x,Math.floor(h*.65),3);
      for (let y = Math.floor(h*.46); y < h*.65; y++) {
        this.set(Math.floor(w*.08),y,3); this.set(Math.floor(w*.45),y,3);
      }
      for (let y = Math.floor(h*.51); y < h*.64; y++) for(let x=Math.floor(w*.1);x<w*.43;x++) this.set(x,y,2);
      this.brush(Math.floor(w*.26),Math.floor(h*.21),9,1);
      for(let x=Math.floor(w*.61);x<w*.91;x++) this.set(x,Math.floor(h*.82),3);
      for(let x=Math.floor(w*.64);x<w*.89;x+=9) {
        for(let y=Math.floor(h*.57);y<h*.82;y++) this.set(x,y,5);
        this.brush(x,Math.floor(h*.6),7,5);
        for(let xx=x;xx<x+10;xx++) this.set(xx,Math.floor(h*.79),5);
      }
    }
  }
  const api = { Simulation, MATERIAL };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ElementLab = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
