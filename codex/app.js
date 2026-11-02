(() => {
  'use strict';
  const { Simulation } = ElementLab;
  const sim = new Simulation(), canvas = document.querySelector('#sandbox'), ctx = canvas.getContext('2d', {alpha:false});
  const names = ['Eraser','Sand','Water','Wall','Fire','Plant'];
  const colors = [[10,17,27],[245,201,107],[77,165,238],[135,150,174],[255,120,65],[126,210,145]];
  const image = ctx.createImageData(sim.width,sim.height);
  let selected = 1, radius = 4, paused = false, pointer = null, last = null, previous = 0, accumulator = 0;
  let keyboard = {x:120,y:50}, keyboardVisible = false;
  const announce = message => document.querySelector('#announcement').textContent = message;
  function select(type) {
    selected = type;
    document.querySelectorAll('[data-material]').forEach(button => {
      const active = Number(button.dataset.material) === type;
      button.classList.toggle('selected',active); button.setAttribute('aria-pressed',String(active));
    });
    const caption = document.querySelector('#tool-caption');
    caption.innerHTML = `<b>${names[type]}</b> selected · drag to ${type ? 'paint' : 'erase'}`;
    caption.querySelector('b').style.color = type ? `rgb(${colors[type].join(',')})` : '#d8b6ef';
    announce(`${names[type]} selected`);
  }
  document.querySelectorAll('[data-material]').forEach(button => button.addEventListener('click',() => select(Number(button.dataset.material))));
  document.querySelector('#brush').addEventListener('input',event => {
    radius = Number(event.target.value); document.querySelector('#brush-value').textContent = `${radius*2+1} px`;
  });
  function togglePause() {
    paused = !paused; accumulator = 0;
    document.querySelector('#pause').innerHTML = paused ? '▶ <span>Resume</span>' : 'Ⅱ <span>Pause</span>';
    document.querySelector('#status').textContent = paused ? 'PAUSED · KEEP CREATING' : 'LIVE SIMULATION';
    document.querySelector('#status-dot').classList.toggle('paused',paused);
    announce(paused ? 'Simulation paused. You can still paint.' : 'Simulation resumed.');
  }
  document.querySelector('#pause').addEventListener('click',togglePause);
  document.querySelector('#clear').addEventListener('click',() => { sim.clear(); announce('Sandbox cleared'); render(); });
  document.querySelector('#example').addEventListener('click',() => { sim.example(); announce('Example loaded. Sand falls into water. Add fire beside the plants.'); render(); });
  function point(event) {
    const rect = canvas.getBoundingClientRect();
    return {x:Math.max(0,Math.min(sim.width-1,Math.floor((event.clientX-rect.left)/rect.width*sim.width))),y:Math.max(0,Math.min(sim.height-1,Math.floor((event.clientY-rect.top)/rect.height*sim.height)))};
  }
  function paint(p) {
    const start = last || p, steps = Math.max(Math.abs(p.x-start.x),Math.abs(p.y-start.y),1);
    for(let s=0;s<=steps;s++) sim.brush(Math.round(start.x+(p.x-start.x)*s/steps),Math.round(start.y+(p.y-start.y)*s/steps),radius,selected);
    last = p; render();
  }
  canvas.addEventListener('pointerdown',event => {
    if(pointer !== null || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault(); canvas.focus({preventScroll:true}); keyboardVisible = false;
    pointer = event.pointerId; canvas.setPointerCapture(pointer); last = null; paint(point(event));
  });
  canvas.addEventListener('pointermove',event => { if(event.pointerId === pointer) {event.preventDefault();paint(point(event));} });
  function stop(event) { if(event.pointerId === pointer) {pointer=null;last=null;} }
  canvas.addEventListener('pointerup',stop); canvas.addEventListener('pointercancel',stop); canvas.addEventListener('lostpointercapture',stop);
  window.addEventListener('blur',() => {pointer=null;last=null;});
  document.addEventListener('keydown',event => {
    if(event.ctrlKey || event.metaKey || event.altKey || event.target.matches('input,textarea,select')) return;
    if(/^[1-6]$/.test(event.key)) select([1,2,3,4,5,0][Number(event.key)-1]);
    if(event.code === 'Space' && !event.target.closest('button')) {event.preventDefault(); if(!event.repeat) togglePause();}
    if(event.target !== canvas) return;
    const directions = {ArrowLeft:[-2,0],ArrowRight:[2,0],ArrowUp:[0,-2],ArrowDown:[0,2]};
    if(directions[event.key]) {
      event.preventDefault(); keyboardVisible = true;
      keyboard.x = Math.max(0,Math.min(sim.width-1,keyboard.x+directions[event.key][0]));
      keyboard.y = Math.max(0,Math.min(sim.height-1,keyboard.y+directions[event.key][1])); render();
    } else if(event.key === 'Enter') {event.preventDefault();keyboardVisible=true;sim.brush(keyboard.x,keyboard.y,radius,selected);render();}
  });
  function render() {
    let count = 0;
    for(let i=0;i<sim.cells.length;i++) {
      const type = sim.cells[i], color = colors[type]; if(type) count++;
      const variation = type ? ((i*13)%7)-3 : ((i%sim.width)%20===0 && Math.floor(i/sim.width)%20===0 ? 12 : 0);
      for(let c=0;c<3;c++) image.data[i*4+c] = color[c]+variation+(type===4 && c===1 ? sim.life[i] : 0);
      image.data[i*4+3] = 255;
    }
    ctx.putImageData(image,0,0);
    if(keyboardVisible && document.activeElement===canvas) {ctx.strokeStyle='#fff';ctx.lineWidth=1;ctx.strokeRect(keyboard.x-radius-.5,keyboard.y-radius-.5,radius*2+1,radius*2+1);}
    document.querySelector('#particle-count').textContent = `${count.toLocaleString()} particles`;
    document.querySelector('#canvas-hint').hidden = count > 0;
  }
  function frame(time) {
    accumulator += Math.min(time-previous,100); previous=time;
    if(!paused && !document.hidden) {while(accumulator>=1000/30) {sim.step();accumulator-=1000/30;} } else accumulator=0;
    render(); requestAnimationFrame(frame);
  }
  sim.example(); render(); requestAnimationFrame(frame);
})();
