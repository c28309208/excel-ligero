const { JSDOM, VirtualConsole } = require('jsdom');
const vc = new VirtualConsole();
vc.on('jsdomError', e => { console.log('DETAIL:', (e.detail && e.detail.stack) || e.message); });
(async () => {
  const dom = await JSDOM.fromURL('http://127.0.0.1:8123/', { runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc });
  await new Promise(r => dom.window.addEventListener('load', r));
  await new Promise(r => setTimeout(r, 500));
  process.exit(0);
})();
