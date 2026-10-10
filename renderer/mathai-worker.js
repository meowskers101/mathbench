/* Mathbench AI worker: runs the word-problem reader (Qwen2.5 1.5B Instruct, Apache 2.0) with Transformers.js (Apache 2.0),
   on the graphics card (WebGPU) when there is one, otherwise on the processor. Everything stays on this computer. */
let gen = null, device = null;
self.onmessage = async e => {
  const m = e.data;
  try {
    if (m.type === 'load') {
      const T = await import(m.lib);
      T.env.backends.onnx.wasm.wasmPaths = m.wasm;
      T.env.allowRemoteModels = false;
      T.env.allowLocalModels = true;
      /* a path, not an http(s) address: Transformers.js only looks for local files that way */
      T.env.localModelPath = m.models;
      T.env.useBrowserCache = false;
      let gpu = null;
      try { gpu = self.navigator.gpu && await self.navigator.gpu.requestAdapter(); } catch (x) { gpu = null; }
      const opts = { dtype: 'q4', use_external_data_format: 3, progress_callback: p => { if (p.status === 'progress' && p.file) self.postMessage({ id: m.id, progress: p }); } };
      if (gpu) { try { gen = await T.pipeline('text-generation', m.name, Object.assign({ device: 'webgpu' }, opts)); device = 'gpu'; } catch (x) { gen = null; } }
      if (!gen) { gen = await T.pipeline('text-generation', m.name, Object.assign({ device: 'wasm' }, opts)); device = 'cpu'; }
      self.postMessage({ id: m.id, ok: true, device: device });
      return;
    }
    if (m.type === 'chat') {
      const out = await gen(m.messages, { max_new_tokens: m.max || 64, do_sample: false });
      self.postMessage({ id: m.id, ok: true, text: String(out[0].generated_text.at(-1).content || '').trim() });
    }
  } catch (err) { self.postMessage({ id: m.id, ok: false, error: String((err && err.message) || err) }); }
};
