(function () {
  const {Simulation, MATERIAL:M} = typeof require === 'function' ? require('./simulation.js') : ElementLab;
  const results = [];
  function test(name,fn) { try {fn();results.push({name,pass:true});} catch(e) {results.push({name,pass:false,error:e.message});} }
  function assert(ok,message) {if(!ok) throw new Error(message);}
  const make = () => new Simulation(24,20,() => .3);
  test('Initialization creates an empty bounded grid',() => {const s=make();assert(s.cells.length===480 && s.cells.every(x=>x===0),'grid');assert(s.get(-1,0)===M.WALL,'boundary');});
  test('Every material can be painted and erased',() => {const s=make();for(let m=1;m<=5;m++){s.clear();s.brush(10,10,2,m);assert(s.get(10,10)===m && s.cells.filter(x=>x===m).length===13,'brush '+m);s.brush(10,10,2,0);assert(s.cells.every(x=>x===0),'eraser');}});
  test('Sand falls and settles on the floor',() => {const s=make();s.set(12,0,M.SAND);for(let i=0;i<40;i++)s.step();assert(s.get(12,19)===M.SAND,'sand position');const before=s.cells.join();s.step();assert(s.cells.join()===before,'settled');});
  test('Sand piles without crossing a wall',() => {const s=make();for(let x=0;x<24;x++)s.set(x,15,M.WALL);for(let y=0;y<10;y++)s.set(12,y,M.SAND);for(let i=0;i<60;i++)s.step();assert(s.cells.filter(x=>x===1).length===10,'conservation');assert(s.cells.slice(16*24).every(x=>x===0),'wall crossed');assert(s.cells.slice(13*24,15*24).includes(1),'pile');});
  test('Water spreads sideways when downward motion is blocked',() => {const s=make();for(let x=0;x<24;x++)s.set(x,10,M.WALL);s.set(12,9,M.WATER);s.step();assert(s.get(12,9)===0 && (s.get(11,9)===2 || s.get(13,9)===2),'sideways');});
  test('Walls and unignited plants stay fixed',() => {const s=make();s.set(5,5,3);s.set(9,5,5);for(let i=0;i<100;i++)s.step();assert(s.get(5,5)===3&&s.get(9,5)===5,'stationary');});
  test('Fire reaches adjacent plants and the chain burns out',() => {const s=make();s.set(5,5,4);for(let x=6;x<12;x++)s.set(x,5,5);s.step();assert(s.get(6,5)===4,'ignition');for(let i=0;i<100;i++)s.step();assert(s.cells.every(x=>x===0),'burnout');});
  test('Water extinguishes neighboring fire',() => {const s=make();s.set(5,19,4);s.set(6,19,2);s.set(7,19,3);s.step();assert(!s.cells.includes(M.FIRE),'extinguish');});
  test('Clear resets cells and fire timers',() => {const s=make();s.example();s.set(5,5,4);s.step();s.clear();assert(s.cells.every(x=>!x)&&s.life.every(x=>!x)&&s.tick===0,'clear');});
  test('Mixed simulation preserves walls and bounded cell storage',() => {const s=make();for(let y=0;y<20;y++)s.set(12,y,3);s.brush(6,3,3,1);s.brush(18,3,3,2);for(let i=0;i<200;i++)s.step();assert(s.cells.length===480,'size');for(let y=0;y<20;y++)assert(s.get(12,y)===3,'wall');assert(!s.cells.slice(0).some((v,i)=>v===1&&i%24>12),'sand crossed');});
  if(typeof module!=='undefined' && module.exports) {for(const r of results)console.log(`${r.pass?'PASS':'FAIL'} ${r.name}${r.error?': '+r.error:''}`);if(results.some(r=>!r.pass))process.exitCode=1;} else globalThis.simulationTestResults=results;
})();

