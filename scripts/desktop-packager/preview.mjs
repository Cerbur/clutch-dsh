// Browser-only preview: uses in-memory data and never touches a Desktop profile.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
const mock = `
window.__fixture = { calls: [], rows: [
  {name:'@cerbur/clutch-dsh-title', version:'0.1.2', source:'local'},
  {name:'@friend/dsh-tools', version:'1.0.0', source:'npm'}
]};
window.dshDesktop = {locale: async () => ({id: new URL(location.href).searchParams.get('lang') || 'zh'})};
window.clutchExtension = {
  version: 1, list: async () => window.__fixture.rows,
  install: async spec => {
    window.__fixture.calls.push(['install', spec]);
    await new Promise(resolve => setTimeout(resolve, 350));
    if (spec === 'fail') throw new Error('Test: installation failed; active profile preserved.');
    window.__fixture.rows.push({name:spec, version:'1.0.0', source:'local'});
  },
  remove: async name => {
    window.__fixture.calls.push(['remove', name]);
    window.__fixture.rows = window.__fixture.rows.filter(row => row.name !== name);
  },
  chooseLocal: async kind => kind === 'directory' ? '/Users/friend/My Plugin' : '/Users/friend/plugin.tgz',
  restart: async () => {window.__fixture.calls.push(['restart']);}
};
`;
const assets = new Map([
  ['/', ['plugin-manager.html', 'text/html']],
  ['/plugin-manager.js', ['plugin-manager.js', 'text/javascript']],
  ['/plugin-manager.css', ['plugin-manager.css', 'text/css']],
]);
const server = createServer((request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname;
  if (path === '/favicon.ico') {
    response.writeHead(204);
    response.end();
    return;
  }
  if (path === '/mock.js') {
    response.writeHead(200, { 'Content-Type': 'text/javascript' });
    response.end(mock);
    return;
  }
  const asset = assets.get(path);
  if (!asset) {
    response.writeHead(404);
    response.end();
    return;
  }
  let body = readFileSync(
    fileURLToPath(new URL('./renderer/' + asset[0], import.meta.url)),
    'utf8',
  );
  if (path === '/')
    body = body.replace(
      '<script src="plugin-manager.js">',
      '<script src="mock.js"></script><script src="plugin-manager.js">',
    );
  response.writeHead(200, { 'Content-Type': asset[1] });
  response.end(body);
});
const port = Number(process.env.PORT || 43188);
server.listen(port, '127.0.0.1', () =>
  process.stdout.write('Preview: http://127.0.0.1:' + port + '\n'),
);
