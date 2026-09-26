// services/browser-preview/runtime/assets/profiles.json
var profiles_default = [
  {
    runtime: {
      profileId: "python-stdlib/v1",
      runtimeVersion: "pyodide-314.0.6/v1",
      adapterVersion: "riffology.model-run/v1",
      pythonVersion: "3.14.2",
      assetSha256: "b6cb6c0e726d007c281f991eaea0d2aae415113328444de47c0681d85b553fd9",
      visualProtocol: "riffology.visual/v0.1",
      limitsSha256: "dc99f1b861f5dab9b5bb5abe5e8418fec3d76a73e09bb6fe1f4fa34cf1344484",
      dependencies: []
    },
    packages: {},
    assetManifest: [
      {
        path: "assets/pyodide-lock.json",
        sha256: "3fdaef09e9e365c85e002737720f8d0ab8f278c1c244a2dde6a37663cf488ad4",
        byteLength: 114440
      },
      {
        path: "assets/pyodide.asm.mjs",
        sha256: "2ac5eba365ec12839c75c03b39b3be1dd63b798852cc460b014b52238be042f7",
        byteLength: 1250344
      },
      {
        path: "assets/pyodide.asm.wasm",
        sha256: "3a0a00dfeaa348ac20f9ef09904233d32d33f644339662d4af368f8a2010f37a",
        byteLength: 9598218
      },
      {
        path: "assets/pyodide.mjs",
        sha256: "69e3f6ccec3e14b465df60be577ca62f536251406b9a00cce019eac5252a2495",
        byteLength: 17931
      },
      {
        path: "assets/python_stdlib.zip",
        sha256: "80c5be6babfe03297069703410c3c29404dcf2525d2b128746bae5536f94831f",
        byteLength: 2545564
      },
      {
        path: "delivery/frame.bundle.mjs",
        sha256: "288a822e2533bd89fc1de6f786961fc9f261a89d29f29eb46d4e281d29bb52bf",
        byteLength: 5811
      },
      {
        path: "delivery/worker.bundle.mjs",
        sha256: "a71a8543a100e9256049a91bc1ceecae78524e2dfc69121245a1c63aee15b717",
        byteLength: 1646213
      },
      {
        path: "runtime/frame.html",
        sha256: "4c0cec31da970cc4c3f547be87c792de128831e6f0269a7b81428596c8be46ac",
        byteLength: 161
      },
      {
        path: "runtime/frame.mjs",
        sha256: "49e63ea216c19622ce8a61b7ecfa1d570dad714da4438503e95aab6e11977b52",
        byteLength: 2276
      },
      {
        path: "runtime/host.mjs",
        sha256: "6e2e0a600f43cf1cf418095e7666a573d7c6142ac179ccc3de0c513635fcfba8",
        byteLength: 5395
      },
      {
        path: "runtime/package-loader.mjs",
        sha256: "fdfd36964c9415369daa78869c749c0ff72e04fa6165ecbd0c79b3ba7afdc396",
        byteLength: 4845
      },
      {
        path: "runtime/protocol.mjs",
        sha256: "ddc80a8321dec64e3373312dc4cbc709eec9d0d34477d7fe61e4b09378c7a197",
        byteLength: 5356
      },
      {
        path: "runtime/renderer.mjs",
        sha256: "5139f59cfb287705c920e147f5abe2a02f6b018db775b7331eb18f5f6a045044",
        byteLength: 2992
      },
      {
        path: "runtime/sha256.mjs",
        sha256: "85da435e9edaf4dca3411cf5f86fa45a95fe15c78060849d11f7eb0344b5bd24",
        byteLength: 2241
      },
      {
        path: "runtime/worker.mjs",
        sha256: "f420e78080ca2310ed591ccc990d67809914e5acfb819ee34559bebde65a61cc",
        byteLength: 5994
      },
      {
        path: "source/contract.ts",
        sha256: "2db2237783cbaabd16abd941a459784543ae95879c052efc429f90b4777b595f",
        byteLength: 8961
      },
      {
        path: "source/model-spec.ts",
        sha256: "df80d6f6218da064a00eae059e468ccf7e258b0c69f58dcaa256df56b97597e8",
        byteLength: 7670
      },
      {
        path: "source/package-lock.json",
        sha256: "a86cb7e6e748499e673303ba621ec011850ba9f3e7743f8e27162039ce5f47b5",
        byteLength: 214516
      },
      {
        path: "source/prepare-assets.mjs",
        sha256: "91f2bbd0ce334a8ce2144e6f26728cf292c5dfd3fa7943864cdd2d2e1ef30d57",
        byteLength: 5796
      }
    ],
    verified: true
  },
  {
    runtime: {
      profileId: "mesa-3.5.1/v1",
      runtimeVersion: "pyodide-314.0.6/v1",
      adapterVersion: "riffology.model-run/v1",
      pythonVersion: "3.14.2",
      assetSha256: "64f7b7606d47dd508ee0046b08ac4720dbd9bff46790de58ad2b7e40a23e6520",
      visualProtocol: "riffology.visual/v0.1",
      limitsSha256: "dc99f1b861f5dab9b5bb5abe5e8418fec3d76a73e09bb6fe1f4fa34cf1344484",
      dependencies: [
        {
          name: "contourpy",
          version: "1.3.3",
          sha256: "d1270323c10ab24141e40a854dcd407625cb4341c9b83301f1111e7db037b57f"
        },
        {
          name: "cycler",
          version: "0.12.1",
          sha256: "70682ba25f1503dde0d9d3d98a889480b42b903a5d863b0a7118bc4173aa02c8"
        },
        {
          name: "decorator",
          version: "5.2.1",
          sha256: "70c5b218495d55cd610752b01dc3d9f593dfd720bec271b5bebe4d86b51ae3c0"
        },
        {
          name: "fonttools",
          version: "4.62.1",
          sha256: "94f246abe8cd46f0695dc9256cde3966bc637b80148fe72a1e7b0e6623d62144"
        },
        {
          name: "kiwisolver",
          version: "1.5.0",
          sha256: "f8b19816e2cf8e36fc2adfabb60ad24dad422dfaffa6087173d829d9924fcc07"
        },
        {
          name: "matplotlib",
          version: "3.10.8",
          sha256: "2d127e0fbdfdd139b90c2eb487950913771846991330460fce3b183ba79d8ddb"
        },
        {
          name: "mesa",
          version: "3.5.1",
          sha256: "528f14add1b13f86f4780cf2cf067aea019885b2628720e352447cd0571234f7"
        },
        {
          name: "micropip",
          version: "0.11.1",
          sha256: "0ad7104a3cde648e5486a718799f3852f1d782ff19d4bfc13db9dc631df083f8"
        },
        {
          name: "networkx",
          version: "3.6.1",
          sha256: "adaee63a7a2088b1bad68ceb2486a8e7fa7dc43b8a90d27de91dd36e2f058126"
        },
        {
          name: "numpy",
          version: "2.4.6",
          sha256: "32959d4137cec8143d75016d029281df3d2e80a232896ed903c2b59e1c44ee9f"
        },
        {
          name: "packaging",
          version: "26.1",
          sha256: "f58ad9d3cde3f3051e3bc82df1db19ff0aa940439dfd5f5d470da61c5ea033bf"
        },
        {
          name: "pandas",
          version: "3.0.2",
          sha256: "99cef063109bb03956af3987b2351c4d6615060732597e224e9fc49ecd345392"
        },
        {
          name: "pillow",
          version: "12.2.0",
          sha256: "18b0c6a423b9b9ffe0b6679f8ebe9dc619d557c5647bfda449583d276d79d422"
        },
        {
          name: "pyparsing",
          version: "3.3.2",
          sha256: "8c3e4bb64e23a66a4c9effc4a5a09a2aafc1db7d70b8451ba3ba5b7fe6d18dd2"
        },
        {
          name: "python-dateutil",
          version: "2.9.0.post0",
          sha256: "9c1d350424840e15c16450ac0b0d6007e908d266746b61d64760dd77263085af"
        },
        {
          name: "pytz",
          version: "2026.1.post1",
          sha256: "c8eaf8e55b79c2a7e765bdce5c1b84e05a43a585a16a00efadd96a0b7913914e"
        },
        {
          name: "scipy",
          version: "1.18.0",
          sha256: "8512aee3e4b36b5a79523628d97d0d34612a366aecbb5b44a08c7ae45dd50d57"
        },
        {
          name: "setuptools",
          version: "82.0.1",
          sha256: "5dc47f9c9e9da126476870464a9608a63134ed23a2fa587966e5091b736a338f"
        },
        {
          name: "six",
          version: "1.17.0",
          sha256: "29edb1e328c61cad6ac21a2ff92c7d274a2b662eb7c12b2d147f04917b765ad6"
        },
        {
          name: "tqdm",
          version: "4.67.3",
          sha256: "f08716f1e1307718c01c03748408ffed22cbbe3c2a098a0d0cb8f616e0642a63"
        }
      ]
    },
    packages: {
      mesa: "3.5.1",
      networkx: "3.6.1",
      numpy: "2.4.6",
      pandas: "3.0.2",
      scipy: "1.18.0",
      tqdm: "4.67.3"
    },
    assetManifest: [
      {
        path: "assets/contourpy-1.3.3-cp314-cp314-pyemscripten_2026_0_wasm32.whl",
        sha256: "d1270323c10ab24141e40a854dcd407625cb4341c9b83301f1111e7db037b57f",
        byteLength: 118875
      },
      {
        path: "assets/cycler-0.12.1-py3-none-any.whl",
        sha256: "70682ba25f1503dde0d9d3d98a889480b42b903a5d863b0a7118bc4173aa02c8",
        byteLength: 8321
      },
      {
        path: "assets/decorator-5.2.1-py3-none-any.whl",
        sha256: "70c5b218495d55cd610752b01dc3d9f593dfd720bec271b5bebe4d86b51ae3c0",
        byteLength: 9167
      },
      {
        path: "assets/fonttools-4.62.1-py3-none-any.whl",
        sha256: "94f246abe8cd46f0695dc9256cde3966bc637b80148fe72a1e7b0e6623d62144",
        byteLength: 1152647
      },
      {
        path: "assets/kiwisolver-1.5.0-cp314-cp314-pyemscripten_2026_0_wasm32.whl",
        sha256: "f8b19816e2cf8e36fc2adfabb60ad24dad422dfaffa6087173d829d9924fcc07",
        byteLength: 36616
      },
      {
        path: "assets/matplotlib-3.10.8-cp314-cp314-pyemscripten_2026_0_wasm32.whl",
        sha256: "2d127e0fbdfdd139b90c2eb487950913771846991330460fce3b183ba79d8ddb",
        byteLength: 6982033
      },
      {
        path: "assets/mesa-3.5.1-py3-none-any.whl",
        sha256: "528f14add1b13f86f4780cf2cf067aea019885b2628720e352447cd0571234f7",
        byteLength: 275085
      },
      {
        path: "assets/micropip-0.11.1-py3-none-any.whl",
        sha256: "0ad7104a3cde648e5486a718799f3852f1d782ff19d4bfc13db9dc631df083f8",
        byteLength: 115486
      },
      {
        path: "assets/networkx-3.6.1-py3-none-any.whl",
        sha256: "adaee63a7a2088b1bad68ceb2486a8e7fa7dc43b8a90d27de91dd36e2f058126",
        byteLength: 1084840
      },
      {
        path: "assets/numpy-2.4.6-cp314-cp314-pyemscripten_2026_0_wasm32.whl",
        sha256: "32959d4137cec8143d75016d029281df3d2e80a232896ed903c2b59e1c44ee9f",
        byteLength: 2918760
      },
      {
        path: "assets/packaging-26.1-py3-none-any.whl",
        sha256: "f58ad9d3cde3f3051e3bc82df1db19ff0aa940439dfd5f5d470da61c5ea033bf",
        byteLength: 95852
      },
      {
        path: "assets/pandas-3.0.2-cp314-cp314-pyemscripten_2026_0_wasm32.whl",
        sha256: "99cef063109bb03956af3987b2351c4d6615060732597e224e9fc49ecd345392",
        byteLength: 4177814
      },
      {
        path: "assets/pillow-12.2.0-cp314-cp314-pyemscripten_2026_0_wasm32.whl",
        sha256: "18b0c6a423b9b9ffe0b6679f8ebe9dc619d557c5647bfda449583d276d79d422",
        byteLength: 1037807
      },
      {
        path: "assets/pyodide-lock.json",
        sha256: "3fdaef09e9e365c85e002737720f8d0ab8f278c1c244a2dde6a37663cf488ad4",
        byteLength: 114440
      },
      {
        path: "assets/pyodide.asm.mjs",
        sha256: "2ac5eba365ec12839c75c03b39b3be1dd63b798852cc460b014b52238be042f7",
        byteLength: 1250344
      },
      {
        path: "assets/pyodide.asm.wasm",
        sha256: "3a0a00dfeaa348ac20f9ef09904233d32d33f644339662d4af368f8a2010f37a",
        byteLength: 9598218
      },
      {
        path: "assets/pyodide.mjs",
        sha256: "69e3f6ccec3e14b465df60be577ca62f536251406b9a00cce019eac5252a2495",
        byteLength: 17931
      },
      {
        path: "assets/pyparsing-3.3.2-py3-none-any.whl",
        sha256: "8c3e4bb64e23a66a4c9effc4a5a09a2aafc1db7d70b8451ba3ba5b7fe6d18dd2",
        byteLength: 122781
      },
      {
        path: "assets/python_dateutil-2.9.0.post0-py2.py3-none-any.whl",
        sha256: "9c1d350424840e15c16450ac0b0d6007e908d266746b61d64760dd77263085af",
        byteLength: 229892
      },
      {
        path: "assets/python_stdlib.zip",
        sha256: "80c5be6babfe03297069703410c3c29404dcf2525d2b128746bae5536f94831f",
        byteLength: 2545564
      },
      {
        path: "assets/pytz-2026.1.post1-py2.py3-none-any.whl",
        sha256: "c8eaf8e55b79c2a7e765bdce5c1b84e05a43a585a16a00efadd96a0b7913914e",
        byteLength: 510489
      },
      {
        path: "assets/scipy-1.18.0-cp314-cp314-pyemscripten_2026_0_wasm32.whl",
        sha256: "8512aee3e4b36b5a79523628d97d0d34612a366aecbb5b44a08c7ae45dd50d57",
        byteLength: 14029768
      },
      {
        path: "assets/setuptools-82.0.1-py3-none-any.whl",
        sha256: "5dc47f9c9e9da126476870464a9608a63134ed23a2fa587966e5091b736a338f",
        byteLength: 756856
      },
      {
        path: "assets/six-1.17.0-py2.py3-none-any.whl",
        sha256: "29edb1e328c61cad6ac21a2ff92c7d274a2b662eb7c12b2d147f04917b765ad6",
        byteLength: 11050
      },
      {
        path: "assets/tqdm-4.67.3-py3-none-any.whl",
        sha256: "f08716f1e1307718c01c03748408ffed22cbbe3c2a098a0d0cb8f616e0642a63",
        byteLength: 78374
      },
      {
        path: "delivery/frame.bundle.mjs",
        sha256: "288a822e2533bd89fc1de6f786961fc9f261a89d29f29eb46d4e281d29bb52bf",
        byteLength: 5811
      },
      {
        path: "delivery/worker.bundle.mjs",
        sha256: "a71a8543a100e9256049a91bc1ceecae78524e2dfc69121245a1c63aee15b717",
        byteLength: 1646213
      },
      {
        path: "runtime/frame.html",
        sha256: "4c0cec31da970cc4c3f547be87c792de128831e6f0269a7b81428596c8be46ac",
        byteLength: 161
      },
      {
        path: "runtime/frame.mjs",
        sha256: "49e63ea216c19622ce8a61b7ecfa1d570dad714da4438503e95aab6e11977b52",
        byteLength: 2276
      },
      {
        path: "runtime/host.mjs",
        sha256: "6e2e0a600f43cf1cf418095e7666a573d7c6142ac179ccc3de0c513635fcfba8",
        byteLength: 5395
      },
      {
        path: "runtime/package-loader.mjs",
        sha256: "fdfd36964c9415369daa78869c749c0ff72e04fa6165ecbd0c79b3ba7afdc396",
        byteLength: 4845
      },
      {
        path: "runtime/protocol.mjs",
        sha256: "ddc80a8321dec64e3373312dc4cbc709eec9d0d34477d7fe61e4b09378c7a197",
        byteLength: 5356
      },
      {
        path: "runtime/renderer.mjs",
        sha256: "5139f59cfb287705c920e147f5abe2a02f6b018db775b7331eb18f5f6a045044",
        byteLength: 2992
      },
      {
        path: "runtime/sha256.mjs",
        sha256: "85da435e9edaf4dca3411cf5f86fa45a95fe15c78060849d11f7eb0344b5bd24",
        byteLength: 2241
      },
      {
        path: "runtime/worker.mjs",
        sha256: "f420e78080ca2310ed591ccc990d67809914e5acfb819ee34559bebde65a61cc",
        byteLength: 5994
      },
      {
        path: "source/contract.ts",
        sha256: "2db2237783cbaabd16abd941a459784543ae95879c052efc429f90b4777b595f",
        byteLength: 8961
      },
      {
        path: "source/model-spec.ts",
        sha256: "df80d6f6218da064a00eae059e468ccf7e258b0c69f58dcaa256df56b97597e8",
        byteLength: 7670
      },
      {
        path: "source/package-lock.json",
        sha256: "a86cb7e6e748499e673303ba621ec011850ba9f3e7743f8e27162039ce5f47b5",
        byteLength: 214516
      },
      {
        path: "source/prepare-assets.mjs",
        sha256: "91f2bbd0ce334a8ce2144e6f26728cf292c5dfd3fa7943864cdd2d2e1ef30d57",
        byteLength: 5796
      }
    ],
    verified: true
  }
];

// services/browser-preview/contract.ts
var BROWSER_PREVIEW_SCHEMA = "riffology.browser-preview/v1";
var PREVIEW_COMPATIBLE_ADAPTER_SHA256 = Object.freeze([
  "b0c785d8c08838d9e416eb87aba1c6b5ce9d8b1d6d233cf2fec32de99a0ec7f5",
  "fa7987095bbc29f2c6d87e9b0f815415f88c9079ad7070fb7fe8b91e7ebf0898"
]);
var BROWSER_PREVIEW_SOURCE_PATHS = ["model/model.py", "model/run.py", "model/model-spec.json", "model/visualization.json", "app/requirements.lock"];
var hashPattern = /^[a-f0-9]{64}$/;
var idPattern = /^[A-Za-z0-9_-]{1,128}$/;
function fail() {
  throw Error("browser-preview-contract-invalid");
}
function object(raw, keys) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || ![Object.prototype, null].includes(Object.getPrototypeOf(raw))) fail();
  const descriptors = Object.getOwnPropertyDescriptors(raw);
  if (Reflect.ownKeys(raw).length !== keys.length || keys.some((k) => !descriptors[k] || !Object.hasOwn(descriptors[k], "value"))) fail();
  return Object.fromEntries(keys.map((k) => [k, descriptors[k].value]));
}
function text(raw, pattern) {
  if (typeof raw !== "string" || !pattern.test(raw)) fail();
  return raw;
}
function integer(raw, max, min = 0) {
  if (typeof raw !== "number" || !Number.isSafeInteger(raw) || raw < min || raw > max) fail();
  return raw;
}
function parsePreviewRuntime(raw) {
  const r = object(raw, ["profileId", "runtimeVersion", "adapterVersion", "pythonVersion", "assetSha256", "visualProtocol", "limitsSha256", "dependencies"]);
  if (r.visualProtocol !== "riffology.visual/v0.1" || r.profileId !== "python-stdlib/v1" && r.profileId !== "mesa-3.5.1/v1" || !Array.isArray(r.dependencies) || r.dependencies.length > 32) fail();
  const dependencies = r.dependencies.map((d) => {
    const p = object(d, ["name", "version", "sha256"]);
    return { name: text(p.name, /^[a-z][a-z0-9_-]{0,63}$/), version: text(p.version, /^[A-Za-z0-9.+_-]{1,64}$/), sha256: text(p.sha256, hashPattern) };
  }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  if (new Set(dependencies.map((d) => d.name)).size !== dependencies.length) fail();
  return { profileId: r.profileId, runtimeVersion: text(r.runtimeVersion, /^[A-Za-z0-9./+_-]{1,128}$/), adapterVersion: text(r.adapterVersion, /^[A-Za-z0-9./+_-]{1,128}$/), pythonVersion: text(r.pythonVersion, /^3\.[0-9]+\.[0-9]+$/), assetSha256: text(r.assetSha256, hashPattern), visualProtocol: "riffology.visual/v0.1", limitsSha256: text(r.limitsSha256, hashPattern), dependencies };
}
function parsePreviewIdentityInput(raw) {
  const r = object(raw, ["schema", "projectId", "revisionId", "filesSha256", "sources", "runtime"]);
  if (r.schema !== BROWSER_PREVIEW_SCHEMA || !Array.isArray(r.sources) || r.sources.length !== BROWSER_PREVIEW_SOURCE_PATHS.length) fail();
  const sources = r.sources.map((f) => {
    const p = object(f, ["path", "sha256", "byteLength"]);
    if (!BROWSER_PREVIEW_SOURCE_PATHS.includes(p.path)) fail();
    return { path: p.path, sha256: text(p.sha256, hashPattern), byteLength: integer(p.byteLength, 1024 * 1024) };
  });
  if (new Set(sources.map((f) => f.path)).size !== sources.length) fail();
  sources.sort((a, b) => BROWSER_PREVIEW_SOURCE_PATHS.indexOf(a.path) - BROWSER_PREVIEW_SOURCE_PATHS.indexOf(b.path));
  return { schema: BROWSER_PREVIEW_SCHEMA, projectId: text(r.projectId, idPattern), revisionId: text(r.revisionId, idPattern), filesSha256: text(r.filesSha256, hashPattern), sources, runtime: parsePreviewRuntime(r.runtime) };
}
function canonicalPreviewJson(raw) {
  if (raw === null || typeof raw === "string" || typeof raw === "boolean") return JSON.stringify(raw);
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) fail();
    return JSON.stringify(raw);
  }
  if (Array.isArray(raw)) return "[" + raw.map(canonicalPreviewJson).join(",") + "]";
  if (raw && typeof raw === "object") {
    const descriptors = Object.getOwnPropertyDescriptors(raw);
    if (Reflect.ownKeys(raw).some((k) => typeof k !== "string" || !Object.hasOwn(descriptors[k], "value"))) fail();
    return "{" + Object.keys(descriptors).sort().map((k) => JSON.stringify(k) + ":" + canonicalPreviewJson(descriptors[k].value)).join(",") + "}";
  }
  return fail();
}
async function previewSha256(bytes) {
  const b = typeof bytes === "string" ? new TextEncoder().encode(bytes) : Uint8Array.from(bytes);
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", b))].map((v) => v.toString(16).padStart(2, "0")).join("");
}
async function previewPackageIdentity(raw, digest2 = previewSha256) {
  return digest2(canonicalPreviewJson(parsePreviewIdentityInput(raw)));
}
async function createPreviewManifest(raw, digest2 = previewSha256) {
  const input = parsePreviewIdentityInput(raw);
  return { ...input, packageIdentity: await previewPackageIdentity(input, digest2) };
}
async function parsePreviewManifest(raw, digest2 = previewSha256) {
  const r = object(raw, ["schema", "projectId", "revisionId", "filesSha256", "sources", "runtime", "packageIdentity"]);
  const { packageIdentity, ...input } = r;
  const manifest = await createPreviewManifest(input, digest2);
  if (text(packageIdentity, hashPattern) !== manifest.packageIdentity) fail();
  return manifest;
}

// services/browser-preview/runtime/protocol.mjs
var MESSAGE_SCHEMA = "riffology.browser-runtime/v1";
var VISUAL_SCHEMA = "riffology.visual/v0.1";
var LIMITS = Object.freeze({ inputBytes: 8192, resultBytes: 8388608, frames: 501, agentsPerFrame: 1e4, gridCells: 1e6, deadlineMs: 3e4, maxSteps: 500, cacheBytes: 8388608, sourceBytes: 1048576, bundleBytes: 5242880 });
var object2 = (v) => v !== null && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
var fail2 = (reason) => {
  throw new Error(reason);
};
var exact = (v, fields) => object2(v) && Object.keys(v).sort().join(",") === [...fields].sort().join(",");
var finite = (v) => typeof v === "number" && Number.isFinite(v);
var digest = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
function size(v, maximum) {
  let bytes;
  try {
    bytes = new TextEncoder().encode(JSON.stringify(v)).byteLength;
  } catch {
    fail2("runtime-json-invalid");
  }
  if (bytes > maximum) fail2("runtime-output-limit");
}
function validateInput(input) {
  if (!exact(input, ["parameters", "seed"]) || !object2(input.parameters) || Object.keys(input.parameters).length > 64) fail2("runtime-input-invalid");
  if (!Number.isInteger(input.seed) || input.seed < 0 || input.seed > 4294967295) fail2("runtime-seed-invalid");
  for (const [name2, value] of Object.entries(input.parameters)) {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name2) || !(finite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER || typeof value === "boolean" || typeof value === "string" && value.length <= 1024)) fail2("runtime-parameter-invalid");
  }
  if (Object.hasOwn(input.parameters, "steps") && (!Number.isInteger(input.parameters.steps) || input.parameters.steps < 1 || input.parameters.steps > LIMITS.maxSteps)) fail2("runtime-steps-invalid");
  size(input, LIMITS.inputBytes);
  return input;
}
function validateRunRequest(request) {
  if (!exact(request, ["schema", "type", "requestId", "packageIdentity", "input"]) || request.schema !== MESSAGE_SCHEMA || request.type !== "run" || typeof request.requestId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(request.requestId) || !digest(request.packageIdentity)) fail2("runtime-request-invalid");
  validateInput(request.input);
  return request;
}
function validateTrace(trace) {
  if (!exact(trace, ["model", "snapshots"]) || typeof trace.model !== "string" || trace.model.length < 1 || trace.model.length > 128 || !Array.isArray(trace.snapshots) || !trace.snapshots.length || trace.snapshots.length > LIMITS.frames) fail2("runtime-trace-invalid");
  size(trace, LIMITS.resultBytes);
  let previousFrame = -1, previousTime = -1;
  for (const snapshot of trace.snapshots) {
    if (!exact(snapshot, ["schemaVersion", "frame", "time", "space", "agents", "metrics"]) || snapshot.schemaVersion !== VISUAL_SCHEMA || !Number.isInteger(snapshot.frame) || snapshot.frame <= previousFrame || !finite(snapshot.time) || snapshot.time < 0 || snapshot.time < previousTime || !object2(snapshot.space) || !Array.isArray(snapshot.agents) || snapshot.agents.length > LIMITS.agentsPerFrame || !object2(snapshot.metrics)) fail2("runtime-snapshot-invalid");
    previousFrame = snapshot.frame;
    previousTime = snapshot.time;
    for (const [name2, value] of Object.entries(snapshot.metrics)) if (name2.length > 128 || !finite(value)) fail2("runtime-metric-invalid");
    const space = snapshot.space;
    if (space.type === "grid") {
      if (!exact(space, ["type", "width", "height"]) || !Number.isInteger(space.width) || !Number.isInteger(space.height) || space.width < 1 || space.height < 1 || space.width * space.height > LIMITS.gridCells) fail2("runtime-space-invalid");
    } else if (space.type === "lane") {
      if (!exact(space, ["type", "lanes"]) || !Array.isArray(space.lanes) || !space.lanes.length || space.lanes.length > 128 || space.lanes.some((l) => typeof l !== "string" || !l.length || l.length > 128) || new Set(space.lanes).size !== space.lanes.length) fail2("runtime-space-invalid");
    } else fail2("runtime-space-invalid");
    const ids = /* @__PURE__ */ new Set();
    for (const agent of snapshot.agents) {
      const fields = space.type === "grid" ? ["id", "type", "state", "x", "y"] : ["id", "type", "state", "lane", "position"];
      if (!exact(agent, fields) || typeof agent.id !== "string" || !agent.id.length || agent.id.length > 128 || ids.has(agent.id) || typeof agent.type !== "string" || !agent.type.length || agent.type.length > 128 || typeof agent.state !== "string" || !agent.state.length || agent.state.length > 128) fail2("runtime-agent-invalid");
      ids.add(agent.id);
      if (space.type === "grid" ? !Number.isInteger(agent.x) || !Number.isInteger(agent.y) || agent.x < 0 || agent.y < 0 || agent.x >= space.width || agent.y >= space.height : !space.lanes.includes(agent.lane) || !finite(agent.position) || agent.position < 0) fail2("runtime-agent-invalid");
    }
  }
  return trace;
}
function validateResult(message, pending) {
  if (!exact(message, ["schema", "type", "requestId", "packageIdentity", "trace"]) || message.schema !== MESSAGE_SCHEMA || message.type !== "result" || message.requestId !== pending.requestId || message.packageIdentity !== pending.packageIdentity) fail2("runtime-result-unrelated");
  return validateTrace(message.trace);
}

// services/simulation/model-spec.ts
var PARAMETER_TYPES = /* @__PURE__ */ new Set(["number", "integer", "enum", "boolean"]);
var NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
function reject() {
  throw new Error("invalid-model-spec");
}
function object3(raw, keys, optional = []) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.getPrototypeOf(raw) !== Object.prototype) reject();
  const descriptors = Object.getOwnPropertyDescriptors(raw);
  const allowed = /* @__PURE__ */ new Set([...keys, ...optional]);
  if (Reflect.ownKeys(descriptors).some((key) => typeof key !== "string" || !allowed.has(key))) reject();
  if (keys.some((key) => !Object.hasOwn(descriptors, key))) reject();
  const result = {};
  for (const key of Reflect.ownKeys(descriptors)) {
    const descriptor = descriptors[key];
    if (!("value" in descriptor) || !descriptor.enumerable) reject();
    result[key] = descriptor.value;
  }
  return result;
}
function text2(raw, code = "invalid-model-spec") {
  if (typeof raw !== "string" || !raw.trim() || raw.length > 4096 || /[\u0000-\u001f\u007f]/u.test(raw)) throw Error(code);
  return raw;
}
function name(raw) {
  if (!NAME.test(raw)) reject();
  return raw;
}
function finite2(raw) {
  if (typeof raw !== "number" || !Number.isFinite(raw) || Math.abs(raw) > Number.MAX_SAFE_INTEGER) reject();
  return raw;
}
function list(raw) {
  if (!Array.isArray(raw) || raw.length > 256) reject();
  return raw.map((item) => text2(item));
}
function path(raw, root, suffix) {
  if (typeof raw !== "string" || raw.normalize("NFC") !== raw || raw.length > 240 || !raw.endsWith(suffix) || /[\p{C}\\%]/u.test(raw)) reject();
  const parts = raw.split("/");
  if (parts.length < 2 || parts[0] !== root || parts.some((part) => !part || part === "." || part === ".." || part === ".riffology")) reject();
  return raw;
}
function map(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.getPrototypeOf(raw) !== Object.prototype) reject();
  const result = {};
  for (const key of Reflect.ownKeys(Object.getOwnPropertyDescriptors(raw))) {
    if (typeof key !== "string" || !NAME.test(key)) reject();
    const descriptor = Object.getOwnPropertyDescriptor(raw, key);
    if (!("value" in descriptor) || !descriptor.enumerable) reject();
    result[key] = descriptor.value;
  }
  return result;
}
function parameter(raw) {
  const value = object3(raw, ["type", "default"], ["unit", "minimum", "maximum", "values"]);
  if (typeof value.type !== "string" || !PARAMETER_TYPES.has(value.type)) reject();
  const type = value.type;
  if (value.unit !== void 0 && (typeof value.unit !== "string" || value.unit.length > 128)) reject();
  const minimum = value.minimum === void 0 ? void 0 : finite2(value.minimum);
  const maximum = value.maximum === void 0 ? void 0 : finite2(value.maximum);
  if (minimum !== void 0 && maximum !== void 0 && minimum > maximum) reject();
  let values;
  if (type === "enum") {
    if (!Array.isArray(value.values) || value.values.length < 1 || value.values.length > 128) reject();
    values = value.values.map((item) => text2(item, "invalid-model-spec-parameter"));
    if (new Set(values).size !== values.length) reject();
  } else if (value.values !== void 0) reject();
  const def = value.default;
  if (type === "boolean") {
    if (typeof def !== "boolean" || minimum !== void 0 || maximum !== void 0) reject();
  } else if (type === "enum") {
    if (typeof def !== "string" || !values.includes(def)) reject();
  } else {
    const n = finite2(def);
    if (type === "integer" && !Number.isSafeInteger(n)) reject();
    if (minimum !== void 0 && n < minimum || maximum !== void 0 && n > maximum) reject();
  }
  return { type, default: def, ...value.unit === void 0 ? {} : { unit: value.unit }, ...minimum === void 0 ? {} : { minimum }, ...maximum === void 0 ? {} : { maximum }, ...values === void 0 ? {} : { values } };
}
function metric(raw) {
  const value = object3(raw, [], ["unit", "description"]);
  if (value.unit !== void 0 && (typeof value.unit !== "string" || value.unit.length > 128)) reject();
  if (value.description !== void 0) text2(value.description);
  return { ...value.unit === void 0 ? {} : { unit: value.unit }, ...value.description === void 0 ? {} : { description: value.description } };
}
function parseModelSpec(raw) {
  const value = object3(raw, ["schemaVersion", "researchQuestion", "scope", "entities", "mechanisms", "assumptions", "parameters", "metrics", "limitations", "execution"]);
  if (value.schemaVersion !== 1) reject();
  const parameters = {};
  for (const [key, item] of Object.entries(map(value.parameters))) parameters[name(key)] = parameter(item);
  const metrics = {};
  for (const [key, item] of Object.entries(map(value.metrics))) metrics[name(key)] = metric(item);
  const execution = object3(value.execution, ["entrypoint", "dependencyLock"]);
  const entrypoint = path(execution.entrypoint, "model", ".py"), dependencyLock = path(execution.dependencyLock, "app", ".lock");
  return { schemaVersion: 1, researchQuestion: text2(value.researchQuestion), scope: text2(value.scope), entities: list(value.entities), mechanisms: list(value.mechanisms), assumptions: list(value.assumptions), parameters, metrics, limitations: list(value.limitations), execution: { entrypoint, dependencyLock } };
}
function resolveParameters(spec, raw = {}) {
  const model = parseModelSpec(spec), supplied = map(raw), result = {};
  for (const key of Object.keys(supplied)) if (!Object.hasOwn(model.parameters, key)) reject();
  for (const [key, definition] of Object.entries(model.parameters)) {
    const value = Object.hasOwn(supplied, key) ? supplied[key] : definition.default;
    parameter({ ...definition, default: value });
    result[key] = value;
  }
  return result;
}

// services/browser-preview/runtime/package-loader.mjs
var decode = (text3) => {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text3)) throw Error("runtime-base64-invalid");
  const bytes = Uint8Array.from(atob(text3), (c) => c.charCodeAt(0));
  let encoded = "";
  for (const byte of bytes) encoded += String.fromCharCode(byte);
  if (btoa(encoded) !== text3) throw Error("runtime-base64-invalid");
  return bytes;
};
async function checkedPackage(envelope, profiles, digest2 = previewSha256) {
  if (envelope instanceof Uint8Array) {
    const text3 = new TextDecoder("utf-8", { fatal: true }).decode(envelope);
    if (envelope.byteLength > LIMITS.bundleBytes) throw Error("runtime-package-limit");
    envelope = JSON.parse(text3);
    if (text3 !== canonicalPreviewJson(envelope)) throw Error("runtime-package-noncanonical");
  }
  if (new TextEncoder().encode(canonicalPreviewJson(envelope)).byteLength > LIMITS.bundleBytes) throw Error("runtime-package-limit");
  if (!envelope || Object.keys(envelope).sort().join(",") !== "files,manifest" || !Array.isArray(envelope.files)) throw Error("runtime-package-invalid");
  const manifest = await parsePreviewManifest(envelope.manifest, digest2);
  const profile = profiles.find((p) => canonicalPreviewJson(p.runtime) === canonicalPreviewJson(manifest.runtime));
  if (!profile || await digest2(canonicalPreviewJson(LIMITS)) !== manifest.runtime.limitsSha256 || await digest2(canonicalPreviewJson(profile.assetManifest)) !== manifest.runtime.assetSha256) throw Error("runtime-profile-unavailable");
  if (envelope.files.length !== BROWSER_PREVIEW_SOURCE_PATHS.length) throw Error("runtime-package-invalid");
  const files = /* @__PURE__ */ new Map();
  let total = 0;
  for (let i = 0; i < envelope.files.length; i++) {
    const f = envelope.files[i], source = manifest.sources[i];
    if (!f || Object.keys(f).sort().join(",") !== "base64,path" || f.path !== BROWSER_PREVIEW_SOURCE_PATHS[i] || source.path !== f.path || typeof f.base64 !== "string" || f.base64.length > Math.ceil(LIMITS.sourceBytes / 3) * 4) throw Error("runtime-package-invalid");
    const bytes = decode(f.base64);
    total += bytes.byteLength;
    if (bytes.byteLength !== source.byteLength || bytes.byteLength > LIMITS.sourceBytes || await digest2(bytes) !== source.sha256 || total > LIMITS.bundleBytes) throw Error("runtime-source-mismatch");
    files.set(f.path, bytes);
  }
  const visualization = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(files.get("model/visualization.json")));
  if (!visualization || Object.keys(visualization).sort().join(",") !== "metricKeys,protocol,renderer,schema" || visualization.schema !== "riffology.visualization/v1" || visualization.protocol !== "riffology.visual/v0.1" || !["grid", "lane"].includes(visualization.renderer) || !Array.isArray(visualization.metricKeys) || !visualization.metricKeys.length || visualization.metricKeys.length > 64 || visualization.metricKeys.some((k) => typeof k !== "string" || k.length > 128)) throw Error("runtime-visualization-invalid");
  const spec = parseModelSpec(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(files.get("model/model-spec.json"))));
  if (!PREVIEW_COMPATIBLE_ADAPTER_SHA256.includes(manifest.sources.find((s) => s.path === "model/run.py").sha256)) throw Error("runtime-server-adapter-mismatch");
  if (spec.execution.entrypoint !== "model/run.py" || spec.execution.dependencyLock !== "app/requirements.lock") throw Error("runtime-model-entrypoint-invalid");
  if (visualization.metricKeys.some((k) => !Object.hasOwn(spec.metrics, k)) || new Set(visualization.metricKeys).size !== visualization.metricKeys.length) throw Error("runtime-visualization-invalid");
  const lock = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(files.get("app/requirements.lock")));
  if (canonicalPreviewJson(lock) !== canonicalPreviewJson({ schemaVersion: 1, packages: profile.packages })) throw Error("runtime-dependency-lock-mismatch");
  return { manifest, profile, files, visualization, spec };
}
async function checkedAssets(raw, profile, digest2 = previewSha256) {
  if (!Array.isArray(raw) || raw.length !== profile.assetManifest.length) throw Error("runtime-assets-invalid");
  const result = /* @__PURE__ */ new Map();
  for (let i = 0; i < raw.length; i++) {
    const asset = raw[i], expected = profile.assetManifest[i];
    if (!asset || asset.path !== expected.path || !(asset.bytes instanceof Uint8Array)) throw Error("runtime-assets-mismatch");
    const captured = Uint8Array.from(asset.bytes);
    if (captured.byteLength !== expected.byteLength || await digest2(captured) !== expected.sha256) throw Error("runtime-assets-mismatch");
    result.set(asset.path, captured);
  }
  return result;
}

// services/browser-preview/runtime/host.mjs
var BrowserPreviewRuntime = class {
  constructor({ executionOrigin, frameUrl, assetLoader, timeoutMs = LIMITS.deadlineMs, onStarted = () => {
  }, onDiagnostic = () => {
  } }) {
    const url = new URL(executionOrigin);
    if (url.origin === location.origin || !["http:", "https:"].includes(url.protocol)) throw Error("runtime-execution-origin-invalid");
    const local = (host) => ["localhost", "127.0.0.1", "[::1]"].includes(host);
    if (!(local(url.hostname) && local(location.hostname)) && (url.protocol !== "https:" || url.hostname.split(".").slice(-2).join(".") === location.hostname.split(".").slice(-2).join("."))) throw Error("runtime-dedicated-site-required");
    const frame = new URL(frameUrl, url.origin);
    if (frame.origin !== url.origin || frame.search || frame.hash || !/^\/runtime\/[a-f0-9]{64}\/frame\.html$/.test(frame.pathname)) throw Error("runtime-frame-url-invalid");
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > LIMITS.deadlineMs) throw Error("runtime-timeout-invalid");
    this.executionOrigin = url.origin;
    this.frameUrl = frame.href;
    this.assetLoader = assetLoader;
    this.timeoutMs = Math.min(timeoutMs, LIMITS.deadlineMs);
    this.onStarted = onStarted;
    this.onDiagnostic = onDiagnostic;
    this.sequence = 0;
    this.loadGeneration = 0;
  }
  async load(envelope) {
    const generation = ++this.loadGeneration, captured = structuredClone(envelope);
    this.cancel();
    const current = () => {
      if (generation !== this.loadGeneration) throw Error("runtime-load-superseded");
    };
    const loaded = await checkedPackage(captured, profiles_default);
    current();
    const raw = await this.assetLoader(loaded.profile);
    current();
    const assets = await checkedAssets(raw, loaded.profile);
    current();
    this.cancel();
    this.loaded = loaded;
    this.envelope = captured;
    this.assets = assets;
    return loaded;
  }
  run(input) {
    this.cancel();
    if (!this.loaded) throw Error("runtime-package-not-loaded");
    validateInput(input);
    const request = validateRunRequest({ schema: MESSAGE_SCHEMA, type: "run", requestId: `local-${++this.sequence}`, packageIdentity: this.loaded.manifest.packageIdentity, input: { parameters: resolveParameters(this.loaded.spec, input.parameters), seed: input.seed } });
    return new Promise((resolve, reject2) => {
      const frame = document.createElement("iframe");
      frame.hidden = true;
      frame.sandbox = "allow-scripts";
      frame.src = this.frameUrl;
      const channel = new MessageChannel();
      this.pending = { request, resolve, reject: reject2, frame, channel, phase: "connecting", diagnostics: 0 };
      const finish = (error, trace) => {
        if (this.pending?.request !== request) return;
        this.destroy();
        error ? reject2(error) : resolve(trace);
      };
      channel.port1.onmessage = (event) => {
        if (this.pending?.request !== request) return;
        const message = event.data;
        if (message?.type === "connected" && this.pending.phase === "connecting") {
          this.pending.phase = "loading";
          channel.port1.postMessage({ type: "execute", payload: { request, envelope: this.envelope, profile: this.loaded.profile, assets: [...this.assets].map(([path2, bytes]) => ({ path: path2, bytes })) } });
          return;
        }
        if (message?.schema !== MESSAGE_SCHEMA || message?.requestId !== request.requestId || message?.packageIdentity !== request.packageIdentity) return;
        if (message.type === "diagnostic" && typeof message.directive === "string" && message.directive.length <= 128 && typeof message.blockedURI === "string" && message.blockedURI.length <= 256 && this.pending.diagnostics++ < 64) {
          this.onDiagnostic({ directive: message.directive, blockedURI: message.blockedURI });
          return;
        }
        if (message.type === "started" && this.pending.phase === "loading") {
          this.pending.phase = "running";
          this.onStarted(request);
          return;
        }
        if (message.type === "result" && this.pending.phase === "running") {
          try {
            finish(null, validateResult(message, request));
          } catch (error) {
            finish(error);
          }
        }
        if (message.type === "error" && typeof message.code === "string" && message.code.length <= 128 && typeof message.text === "string" && message.text.length <= 1024) finish(Error(message.text || message.code));
      };
      frame.onload = () => {
        if (this.pending?.request === request) frame.contentWindow.postMessage({ type: "connect" }, "*", [channel.port2]);
      };
      this.timer = setTimeout(() => finish(Error("runtime-timeout")), this.timeoutMs);
      document.body.append(frame);
    });
  }
  destroy() {
    clearTimeout(this.timer);
    const p = this.pending;
    this.pending = null;
    p?.channel.port1.postMessage({ type: "terminate" });
    p?.channel.port1.close();
    p?.channel.port2.close();
    p?.frame.remove();
  }
  cancel() {
    const p = this.pending;
    if (!p) return;
    this.destroy();
    p.reject(Error("runtime-cancelled"));
  }
  dispose() {
    this.loadGeneration++;
    this.cancel();
    this.loaded = null;
    this.envelope = null;
    this.assets = null;
  }
};
export {
  BrowserPreviewRuntime,
  profiles_default as profiles
};
