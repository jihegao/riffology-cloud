# Fixed b093 independent terminal readback — prepared only

This standalone reader is separate from the frozen eight operations files. It does not change the ae0614 operations manifest, the6195B/5817 archive, the original f27/bded inputs or the new b093 request. It has not run on AMD128.

Under the future exact grant, run the reviewed source in memory over one new SSH session using existing authentication with agent/port/control forwarding disabled. Its explicit entry is `--execute-readonly --grant-sha256 <the newly approved grant SHA256>`. The source itself performs no SSH, auth operation or remote file write. Do not add it to the archive or transfer operations manifest.

The reader is fixed to b093's pi-probe-readable-v1/mock-probe-once records, a946 local Engine/index identity, ae0614 operations manifest,5817 archive and the correct operation label. It reads intent/result/cleanup/cached identity, bounded probe.cid, optional strict report and known command intent/PID/startTicks/result/stream hashes. Direct files are owned, single-link regular600, and Docker CID metadata may be600/644/664 under a verified private700 parent. All original CLI terminal/PID/startTicks and current original-process absence checks finish before Docker is queried. Missing/link/unknown records stop as pending without any Docker GET.

At most two Docker GETs are available: inspect the exact original CID obtained from the bound private records, then list all containers with the fixed b093 label. There is no create/start/build/pull/push/export/rm or Cloudflare/provider operation. Existing empty Docker config is byte-checked; no grant/OAuth/provider/Registry credential body is read. The only process-stop signals concern this reader's own bounded readonly Docker CLI child, never the original mock container or request.

Output is an allowlist of known status/identity/boolean fields, file sizes/hashes, original CLI terminal identities and strict frozen probe fields. Env, complete inspect, arbitrary stderr or authorization bodies are not returned. Local CLI reaping does not prove the container stopped; actual exact original NotFound and correct label-empty reads are both required to confirm cleanup. Unknown execution/report state is not upgraded to a pass.

Four local fixture checks passed, including CID0664, absent records, links and unknown/active original CLI states. These fixtures mocked both Docker reads and performed no SSH/Docker/auth/API operation. They do not replace the future real independent readback. Source/test/check hashes are recorded in checks.json.
