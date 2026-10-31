import { createRequire } from 'node:module';
import { readFile, mkdtemp, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const samples = [];
const require = createRequire(join(root, 'package.json'));
const { build } = await import(pathToFileURL(require.resolve('tsdown')));
const { inlineAssets } = await import(pathToFileURL(join(root, 'scripts/inline-assets.mjs')));
const out = await mkdtemp('/tmp/office-performance-build-');

function installProbe(renderer, scene, renderFrame) {
  const sampleMs = Math.max(
    8000,
    Math.min(120000, Number(new URLSearchParams(location.search).get('sampleSeconds') || 8) * 1000),
  );
  const panel = document.createElement('section');
  panel.style.cssText = 'padding:12px;background:#e8eef5;color:#172d46;font:13px system-ui;';
  panel.innerHTML =
    '<b>Office performance probe · local simulated Sessions</b> <button id="sample">Sample 8 seconds</button> <output id="sampleStatus">Ready</output><pre id="perfOutput" style="white-space:pre-wrap">No sample yet</pre>';
  document.body.prepend(panel);
  const capture = document.createElement('button');
  capture.textContent = 'Save scene';
  capture.onclick = () => {
    renderFrame();
    void fetch('/scene', {
      method: 'POST',
      body: renderer.domElement.toDataURL('image/png').split(',')[1],
    });
  };
  panel.append(capture);
  const compare = document.createElement('button');
  compare.textContent = 'Save identical-frame comparison';
  compare.onclick = () => {
    renderFrame();
    const cached = renderer.domElement.toDataURL('image/png').split(',')[1];
    renderer.render(scene, scene.userData.perfCamera);
    const reference = renderer.domElement.toDataURL('image/png').split(',')[1];
    void fetch('/scene-cached', { method: 'POST', body: cached });
    void fetch('/scene-reference', { method: 'POST', body: reference });
    renderFrame();
  };
  panel.append(compare);
  const button = panel.querySelector('#sample');
  button.textContent = 'Sample ' + sampleMs / 1000 + ' seconds';
  const output = panel.querySelector('#perfOutput');
  const status = panel.querySelector('#sampleStatus');
  let collecting = false,
    rows = [],
    gpuRows = [],
    pending = [],
    frameStart = 0;
  let disposed = false,
    warmTimer,
    sampleTimer;
  let shadowCalls = 0,
    shadowTriangles = 0,
    lastRender,
    frameStats,
    frameQuery,
    previousFrameTime;
  let intervals = [],
    frameTimes = [];
  const gl = renderer.getContext();
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  const render = renderer.render;
  renderer.info.autoReset = true;
  const resetInfo = renderer.info.reset;
  renderer.info.reset = function () {
    shadowCalls = renderer.info.render.calls;
    shadowTriangles = renderer.info.render.triangles;
    return resetInfo.call(this);
  };
  renderer.render = function (...args) {
    if (args[0] === scene) scene.userData.perfCamera = args[1];
    resetInfo.call(renderer.info);
    shadowCalls = shadowTriangles = 0;
    const begin = performance.now();
    try {
      return render.apply(this, args);
    } finally {
      const cpu = performance.now() - begin;
      lastRender = {
        renderCpuMs: cpu,
        totalCalls: renderer.info.render.calls + shadowCalls,
        mainCalls: renderer.info.render.calls,
        shadowCalls,
        totalTriangles: renderer.info.render.triangles + shadowTriangles,
        mainTriangles: renderer.info.render.triangles,
        shadowTriangles,
      };
      if (frameStats) for (const key of Object.keys(lastRender)) frameStats[key] += lastRender[key];
    }
  };
  function percentile(values, p) {
    if (!values.length) return null;
    const sorted = values.slice().sort((a, b) => a - b);
    return +sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))].toFixed(3);
  }
  function snapshot() {
    const geoms = new Set(),
      arrays = new Set(),
      textures = new Set(),
      skins = new Set(),
      uploads = new Set();
    let meshes = 0,
      actors = 0,
      loading = 0,
      fallback = 0,
      geometryBytes = 0,
      morphBytes = 0,
      textureBytes = 0;
    scene.traverse((object) => {
      if (object.name === 'deepseek' && object.userData.assetState) actors++;
      if (object.userData.assetState === 'loading') loading++;
      if (object.userData.assetState === 'fallback') fallback++;
      if (!object.isMesh) return;
      meshes++;
      if (object.skeleton) skins.add(object.skeleton);
      if (!geoms.has(object.geometry)) {
        const geometry = object.geometry;
        geoms.add(geometry);
        for (const attr of [...Object.values(geometry.attributes), geometry.index].filter(
          Boolean,
        )) {
          const array = attr.array ?? attr.data?.array;
          if (array && !arrays.has(array)) {
            arrays.add(array);
            geometryBytes += array.byteLength;
          }
        }
        for (const attrs of Object.values(geometry.morphAttributes))
          for (const attr of attrs) {
            const array = attr.array ?? attr.data?.array;
            if (array && !arrays.has(array)) {
              arrays.add(array);
              morphBytes += array.byteLength;
            }
          }
      }
      for (const material of Array.isArray(object.material) ? object.material : [object.material])
        for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    });
    const images = [];
    for (const texture of textures) {
      const uploadKey = [
        texture.source.uuid,
        ...[
          'wrapS',
          'wrapT',
          'wrapR',
          'magFilter',
          'minFilter',
          'anisotropy',
          'internalFormat',
          'format',
          'type',
          'generateMipmaps',
          'premultiplyAlpha',
          'flipY',
          'unpackAlignment',
          'colorSpace',
        ].map((key) => texture[key]),
      ].join('|');
      if (uploads.has(uploadKey)) continue;
      uploads.add(uploadKey);
      const image = texture.image;
      if (!image?.width || !image?.height) continue;
      const bpc = texture.type === 1015 ? 4 : texture.type === 1016 ? 2 : 1;
      const size = image.width * image.height * 4 * bpc * (texture.generateMipmaps ? 4 / 3 : 1);
      textureBytes += size;
      images.push({ width: image.width, height: image.height, mipmaps: texture.generateMipmaps });
    }
    return {
      actors,
      meshes,
      loading,
      fallback,
      geometries: geoms.size,
      skeletons: skins.size,
      geometryAttributeMiB: +(geometryBytes / 1048576).toFixed(2),
      morphAttributeMiB: +(morphBytes / 1048576).toFixed(2),
      materialTextureObjects: textures.size,
      estimatedUniqueMaterialUploads: uploads.size,
      estimatedMaterialTextureMiB: +(textureBytes / 1048576).toFixed(2),
      gpuResourceCounts: { ...renderer.info.memory, programs: renderer.info.programs.length },
      drawingBuffer: {
        width: renderer.domElement.width,
        height: renderer.domElement.height,
        dpr: renderer.getPixelRatio(),
      },
      jsHeapMiB: performance.memory
        ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(2)
        : null,
      lastRender,
    };
  }
  function pollGPU() {
    if (!ext) return;
    const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
    pending = pending.filter((query) => {
      if (disjoint) {
        gl.deleteQuery(query);
        return false;
      }
      if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) return true;
      gpuRows.push(gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6);
      gl.deleteQuery(query);
      return false;
    });
  }
  const pollTimer = setInterval(pollGPU, 100);
  button.onclick = () => {
    button.disabled = true;
    status.textContent = 'Warming up';
    output.textContent =
      'Warming up for 2 seconds, then sampling for ' + sampleMs / 1000 + ' seconds';
    warmTimer = setTimeout(() => {
      if (disposed) return;
      rows = [];
      gpuRows = [];
      intervals = [];
      frameTimes = [];
      previousFrameTime = undefined;
      collecting = true;
      status.textContent = 'Sampling';
      frameStart = performance.now();
      const startSnapshot = snapshot();
      sampleTimer = setTimeout(() => {
        if (disposed) return;
        collecting = false;
        pollGPU();
        const duration = performance.now() - frameStart;
        const values = (key) => rows.map((row) => row[key]);
        const result = {
          variant: { dpr: renderer.getPixelRatio(), shadows: renderer.shadowMap.enabled },
          durationMs: +duration.toFixed(1),
          frames: rows.length,
          actualDrawFps: +((rows.length * 1000) / duration).toFixed(2),
          frameIntervalsMs: {
            p50: percentile(intervals, 0.5),
            p95: percentile(intervals, 0.95),
            p99: percentile(intervals, 0.99),
            over50: intervals.filter((value) => value > 50.5).length,
          },
          framesPerSecond: Array.from(
            { length: Math.floor(sampleMs / 1000) },
            (_, i) => frameTimes.filter((time) => time >= i * 1000 && time < (i + 1) * 1000).length,
          ),
          cpuFrameMs: {
            p50: percentile(values('frameCpuMs'), 0.5),
            p95: percentile(values('frameCpuMs'), 0.95),
          },
          cpuRenderMs: {
            p50: percentile(values('renderCpuMs'), 0.5),
            p95: percentile(values('renderCpuMs'), 0.95),
          },
          gpuMs: {
            supported: !!ext,
            samples: gpuRows.length,
            p50: percentile(gpuRows, 0.5),
            p95: percentile(gpuRows, 0.95),
          },
          calls: {
            main: percentile(values('mainCalls'), 0.5),
            shadow: percentile(values('shadowCalls'), 0.5),
            total: percentile(values('totalCalls'), 0.5),
          },
          triangles: {
            main: percentile(values('mainTriangles'), 0.5),
            shadow: percentile(values('shadowTriangles'), 0.5),
            total: percentile(values('totalTriangles'), 0.5),
          },
          cpuMeasuredMsPerSecond: +(
            (rows.reduce((sum, row) => sum + row.frameCpuMs, 0) * 1000) /
            duration
          ).toFixed(2),
          start: startSnapshot,
          end: snapshot(),
          device: {
            userAgent: navigator.userAgent,
            hardwareConcurrency: navigator.hardwareConcurrency,
            deviceMemory: navigator.deviceMemory ?? null,
            renderer: debug
              ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
              : gl.getParameter(gl.RENDERER),
          },
          resources: performance
            .getEntriesByType('resource')
            .filter((entry) => entry.name.includes('/api/clutch-dsh-office/assets'))
            .map((entry) => ({
              name: entry.name.split('assetId=')[1]?.split('&')[0],
              startTime: +entry.startTime.toFixed(2),
              responseEnd: +entry.responseEnd.toFixed(2),
              durationMs: +entry.duration.toFixed(2),
              transferSize: entry.transferSize,
              decodedBodySize: entry.decodedBodySize,
            })),
        };
        void fetch('/samples', { method: 'POST', body: JSON.stringify(result) });
        output.textContent = JSON.stringify(result, null, 2);
        status.textContent = 'Complete';
        button.disabled = false;
      }, sampleMs);
    }, 2000);
  };
  return {
    begin() {
      frameStats = {
        renderCpuMs: 0,
        totalCalls: 0,
        mainCalls: 0,
        shadowCalls: 0,
        totalTriangles: 0,
        mainTriangles: 0,
        shadowTriangles: 0,
      };
      if (collecting) {
        const now = performance.now();
        frameTimes.push(now - frameStart);
        if (previousFrameTime !== undefined) intervals.push(now - previousFrameTime);
        previousFrameTime = now;
        if (ext && pending.length < 30) {
          frameQuery = gl.createQuery();
          gl.beginQuery(ext.TIME_ELAPSED_EXT, frameQuery);
        }
      }
    },
    dispose() {
      disposed = true;
      collecting = false;
      clearInterval(pollTimer);
      clearTimeout(warmTimer);
      clearTimeout(sampleTimer);
      for (const query of pending) gl.deleteQuery(query);
      pending = [];
      panel.remove();
    },
    frame(begin) {
      if (frameQuery) {
        gl.endQuery(ext.TIME_ELAPSED_EXT);
        pending.push(frameQuery);
        frameQuery = undefined;
      }
      if (frameStats) lastRender = frameStats;
      if (collecting && frameStats)
        rows.push({ ...frameStats, frameCpuMs: performance.now() - begin });
      frameStats = undefined;
    },
  };
}

const inject = {
  name: 'local-performance-probe',
  async load(id) {
    if (!id.endsWith('/src/client/scene/runtime.ts')) return null;
    let source = await readFile(id, 'utf8');
    source = source
      .replaceAll(
        'window.devicePixelRatio',
        '(Number(new URLSearchParams(location.search).get("deviceDpr")) || window.devicePixelRatio)',
      )
      .replace(
        '  const camera = createKitchenCamera();',
        "  if(new URLSearchParams(location.search).has('noShadows')) renderer.shadowMap.enabled = false;\n  const camera = createKitchenCamera();\n  if(new URLSearchParams(location.search).has('trashCloseup')) {camera.position.add(new T.Vector3(2.23,-0.775,-1.68)); camera.lookAt(2.23,.525,-1.18); camera.zoom=5; camera.updateProjectionMatrix();}",
      )
      .replace(
        '  const draw = (now: number) => {',
        `  const perfProbe = (${installProbe.toString()})(renderer,scene, () => staticFrame.render());\n  const draw = (now: number) => {\n    const perfBegin = performance.now();`,
      )
      .replace('    const delta =', '    perfProbe.begin();\n    const delta =')
      .replace(
        '    if (!renderGuard.render(scene, camera)) return;',
        '    if (!renderGuard.render(scene, camera)) return;\n    perfProbe.frame(perfBegin);',
      )
      .replace(
        '      renderGuard.dispose();',
        '      perfProbe.dispose();\n      renderGuard.dispose();',
      );
    return { code: source, moduleType: 'ts' };
  },
};
await build({
  cwd: root,
  entry: { probe: 'test/browser-fixture.tsx' },
  outDir: out,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  dts: false,
  plugins: [
    inject,
    inlineAssets({ mode: 'external', root, indexFile: join(out, 'asset-index.json') }),
  ],
  deps: { alwaysBundle: () => true },
  define: { 'process.env.NODE_ENV': '"production"' },
});
const index = JSON.parse(await readFile(join(out, 'asset-index.json'), 'utf8'));
const byId = new Map(index.assets.map((asset) => [asset.assetId, asset]));
createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (
      req.method === 'POST' &&
      ['/samples', '/scene', '/scene-cached', '/scene-reference'].includes(url.pathname)
    ) {
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 8_000_000) throw new Error('Oversized probe output');
      }
      if (url.pathname === '/samples') {
        samples.push(JSON.parse(body));
        await writeFile(
          '/tmp/office-performance-new-samples.json',
          JSON.stringify(samples, null, 2),
        );
      } else
        await writeFile(
          '/tmp/office-performance-' + url.pathname.slice(1) + '.png',
          Buffer.from(body, 'base64'),
        );
      return res.writeHead(204).end();
    }
    if (url.pathname === '/favicon.ico') return res.writeHead(204).end();
    if (url.pathname === '/') {
      res.setHeader('Content-Type', 'text/html;charset=utf-8');
      return res.end(
        '<!doctype html><html lang="zh"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Office performance analysis</title><style>body{margin:0;background:#f7f8fa}#root{height:950px}#perfOutput{max-height:120px;overflow:auto}</style></head><body><button id="toggleOffice">Hide / show Office</button><div id="root"></div><script>document.querySelector("#toggleOffice").onclick=()=>{const root=document.querySelector("#root");root.hidden=!root.hidden;};</script><script type="module" src="/probe.js"></script></body></html>',
      );
    }
    if (url.pathname === '/probe.js') {
      res.setHeader('Content-Type', 'text/javascript');
      return res.end(await readFile(join(out, 'probe.js')));
    }
    if (url.pathname === '/api/clutch-dsh-office/assets') {
      const asset = byId.get(url.searchParams.get('assetId'));
      if (!asset || asset.sha256 !== url.searchParams.get('sha256'))
        return res.writeHead(404).end();
      res.setHeader('Content-Type', asset.mime);
      res.setHeader('Content-Length', asset.bytes);
      res.setHeader('Cache-Control', 'no-store');
      return res.end(await readFile(join(root, asset.path)));
    }
    res.writeHead(404).end();
  } catch (error) {
    res.writeHead(500).end(String(error));
  }
}).listen(4191, '127.0.0.1', () => console.log('Performance probe: http://127.0.0.1:4191/'));
