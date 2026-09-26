"use strict";
(() => {
  // services/browser-preview/runtime/protocol.mjs
  var MESSAGE_SCHEMA = "riffology.browser-runtime/v1";
  var LIMITS = Object.freeze({ inputBytes: 8192, resultBytes: 8388608, frames: 501, agentsPerFrame: 1e4, gridCells: 1e6, deadlineMs: 3e4, maxSteps: 500, cacheBytes: 8388608, sourceBytes: 1048576, bundleBytes: 5242880 });

  // services/browser-preview/runtime/sha256.mjs
  var K = new Uint32Array([
    1116352408,
    1899447441,
    3049323471,
    3921009573,
    961987163,
    1508970993,
    2453635748,
    2870763221,
    3624381080,
    310598401,
    607225278,
    1426881987,
    1925078388,
    2162078206,
    2614888103,
    3248222580,
    3835390401,
    4022224774,
    264347078,
    604807628,
    770255983,
    1249150122,
    1555081692,
    1996064986,
    2554220882,
    2821834349,
    2952996808,
    3210313671,
    3336571891,
    3584528711,
    113926993,
    338241895,
    666307205,
    773529912,
    1294757372,
    1396182291,
    1695183700,
    1986661051,
    2177026350,
    2456956037,
    2730485921,
    2820302411,
    3259730800,
    3345764771,
    3516065817,
    3600352804,
    4094571909,
    275423344,
    430227734,
    506948616,
    659060556,
    883997877,
    958139571,
    1322822218,
    1537002063,
    1747873779,
    1955562222,
    2024104815,
    2227730452,
    2361852424,
    2428436474,
    2756734187,
    3204031479,
    3329325298
  ]);
  var initial = [1779033703, 3144134277, 1013904242, 2773480762, 1359893119, 2600822924, 528734635, 1541459225];
  var rotr = (value, bits) => value >>> bits | value << 32 - bits;
  function sha256Hex(bytes) {
    if (!(bytes instanceof Uint8Array)) throw Error("sha256-bytes-required");
    const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64, data = new Uint8Array(paddedLength);
    data.set(bytes);
    data[bytes.length] = 128;
    const view = new DataView(data.buffer), bitLength = bytes.length * 8;
    view.setUint32(paddedLength - 8, Math.floor(bitLength / 4294967296));
    view.setUint32(paddedLength - 4, bitLength >>> 0);
    const hash = initial.slice(), words = new Uint32Array(64);
    for (let offset = 0; offset < paddedLength; offset += 64) {
      for (let i = 0; i < 16; i++) words[i] = view.getUint32(offset + i * 4);
      for (let i = 16; i < 64; i++) {
        const x = words[i - 15], y = words[i - 2], s0 = rotr(x, 7) ^ rotr(x, 18) ^ x >>> 3, s1 = rotr(y, 17) ^ rotr(y, 19) ^ y >>> 10;
        words[i] = words[i - 16] + s0 + words[i - 7] + s1 >>> 0;
      }
      let [a, b, c, d, e, f, g, h] = hash;
      for (let i = 0; i < 64; i++) {
        const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25), choice = e & f ^ ~e & g, t1 = h + s1 + choice + K[i] + words[i] >>> 0, s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22), majority = a & b ^ a & c ^ b & c, t2 = s0 + majority >>> 0;
        h = g;
        g = f;
        f = e;
        e = d + t1 >>> 0;
        d = c;
        c = b;
        b = a;
        a = t1 + t2 >>> 0;
      }
      hash[0] = hash[0] + a >>> 0;
      hash[1] = hash[1] + b >>> 0;
      hash[2] = hash[2] + c >>> 0;
      hash[3] = hash[3] + d >>> 0;
      hash[4] = hash[4] + e >>> 0;
      hash[5] = hash[5] + f >>> 0;
      hash[6] = hash[6] + g >>> 0;
      hash[7] = hash[7] + h >>> 0;
    }
    return hash.map((value) => value.toString(16).padStart(8, "0")).join("");
  }

  // services/browser-preview/runtime/frame.mjs
  var port;
  var worker;
  var workerURL;
  var stop = () => {
    worker?.terminate();
    worker = null;
    if (workerURL) URL.revokeObjectURL(workerURL);
    workerURL = null;
  };
  self.addEventListener("message", (event) => {
    if (port || event.source !== parent || !event.data || event.data.type !== "connect" || event.ports.length !== 1) return;
    port = event.ports[0];
    port.onmessage = async (event2) => {
      const message = event2.data;
      if (message?.type === "terminate") {
        stop();
        return;
      }
      if (message?.type !== "execute" || worker) return;
      const workerAsset = message.payload.profile?.assetManifest.find((a) => a.path === "delivery/worker.bundle.mjs");
      const supplied = Array.isArray(message.payload.assets) ? message.payload.assets.filter((a) => a?.path === "delivery/worker.bundle.mjs") : [];
      try {
        if (!workerAsset || !/^[a-f0-9]{64}$/.test(workerAsset.sha256) || !Number.isSafeInteger(workerAsset.byteLength) || workerAsset.byteLength < 1 || supplied.length !== 1) throw Error("runtime-worker-delivery-mismatch");
        const bytes = supplied[0].bytes;
        if (!(bytes instanceof Uint8Array) || bytes.byteLength !== workerAsset.byteLength || sha256Hex(bytes) !== workerAsset.sha256) throw Error("runtime-worker-delivery-mismatch");
        workerURL = URL.createObjectURL(new Blob([bytes], { type: "text/javascript" }));
        worker = new Worker(workerURL);
        worker.onmessage = (event3) => {
          port.postMessage(event3.data);
          if (["result", "error"].includes(event3.data?.type)) stop();
        };
        worker.onerror = (event3) => {
          port.postMessage({ schema: MESSAGE_SCHEMA, type: "error", requestId: message.payload.request.requestId, packageIdentity: message.payload.request.packageIdentity, code: "runtime-worker-failed", text: String(event3.message).slice(0, 1024) });
          stop();
        };
        worker.postMessage(message.payload);
      } catch (error) {
        port.postMessage({ schema: MESSAGE_SCHEMA, type: "error", requestId: message.payload?.request?.requestId ?? "", packageIdentity: message.payload?.request?.packageIdentity ?? "", code: "runtime-worker-failed", text: String(error?.message ?? error).slice(0, 1024) });
        stop();
      }
    };
    port.start();
    port.postMessage({ type: "connected" });
  });
})();
