// Optional local Chrome check, using only Node built-ins. No server or packages.
const {spawn}=require('node:child_process');
const fs=require('node:fs');const path=require('node:path');const {pathToFileURL}=require('node:url');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const executable=process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe';
 fs.mkdirSync('verification',{recursive:true});
 const child=spawn(executable,['--headless','--no-sandbox','--disable-gpu','--in-process-gpu','--no-first-run','--allow-file-access-from-files','--remote-debugging-port=0',`--user-data-dir=${path.resolve('.browser-profile/automation')}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
 let socket;
 try{
 let port;for(let i=0;i<100;i++){try{port=fs.readFileSync('.browser-profile/automation/DevToolsActivePort','utf8').split('\n')[0];break;}catch{}await wait(100);}
 if(!port)throw Error('Chrome debugging port unavailable');
 const targets=await (await fetch(`http://127.0.0.1:${port}/json`)).json();
 socket=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>socket.addEventListener('open',r,{once:true}));
 let id=0;const pending=new Map();socket.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}});
 const send=(method,params={})=>new Promise((resolve,reject)=>{const key=++id;pending.set(key,{resolve,reject});socket.send(JSON.stringify({id:key,method,params}));});
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text);return r.result.value;};
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:pathToFileURL(path.resolve('tests.html')).href});
 let status;for(let i=0;i<100;i++){await wait(100);status=await evaluate('document.body.dataset.result');if(status)break;}
 const report=await evaluate('document.querySelector("#results").innerText');console.log(report);fs.writeFileSync('verification/browser-results.txt',report);
 if(status!=='PASS')throw Error('Interface tests failed or timed out');
 await send('Page.navigate',{url:pathToFileURL(path.resolve('index.html')).href});await wait(500);
 fs.writeFileSync('verification/desktop.png',Buffer.from((await send('Page.captureScreenshot')).data,'base64'));
 await evaluate('document.querySelector("#pause").click();document.querySelector("#clear").click()');
 const rect=await evaluate('(()=>{const r=document.querySelector("canvas").getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})()');
 const x=rect.x+rect.w*.3,y=rect.y+rect.h*.3;
 await send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});
 await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:x+120,y:y+30,button:'left',buttons:1});
 await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:x+120,y:y+30,button:'left',clickCount:1});
 const count=()=>evaluate('Number(document.querySelector("#particle-count").textContent.replace(/\\D/g,""))');
 if(await count()<100)throw Error('Mouse drag failed');console.log('PASS: Native mouse drag');
 await evaluate('document.querySelector("[data-material=\\"0\\"]").click()');
 await send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:x+120,y:y+30,buttons:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:x+120,y:y+30,button:'left',clickCount:1});
 if(await count()!==0)throw Error('Eraser drag failed');console.log('PASS: Native eraser drag');
 await send('Emulation.setDeviceMetricsOverride',{width:375,height:812,deviceScaleFactor:1,mobile:true});await send('Emulation.setTouchEmulationEnabled',{enabled:true});await wait(100);
 await evaluate('document.querySelector("[data-material=\\"2\\"]").click()');
 const p=await evaluate('(()=>{const r=document.querySelector("canvas").getBoundingClientRect();return {x:r.x+50,y:r.y+50}})()');
 await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:p.x,y:p.y}]});await send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:p.x+80,y:p.y+60}]});await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 if(await count()<100)throw Error('Touch drag failed');console.log('PASS: Emulated touch drag');
 await evaluate('document.querySelector("#example").click()');await wait(100);fs.writeFileSync('verification/narrow.png',Buffer.from((await send('Page.captureScreenshot')).data,'base64'));
 console.log('PASS: Desktop and narrow screenshots saved');
 }finally{if(socket)socket.close();child.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
