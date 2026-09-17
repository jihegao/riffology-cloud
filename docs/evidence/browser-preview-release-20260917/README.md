# Browser Preview release evidence — 2026-09-17

This sanitized record separates three different claims:

- deployment: passed for the app and independent execution Worker at the exact source commit recorded in `acceptance.json`;
- public online/static and fail-closed checks: passed;
- authenticated ordinary-user browser acceptance: blocked because neither acceptance host had a reusable signed-in session.

The local real-Chrome suite exercised the Pyodide runtime, malicious blob-subworker denial, storage isolation, and the retained-v1-to-v2 rebuild regression. It is implementation evidence, not a substitute for the missing deployed authenticated-user journey.

No paid model, native Simulation, service, or server-side Run was invoked. The recorded production gates remained closed.

Verify the package with:

```sh
(cd docs/evidence/browser-preview-release-20260917 && shasum -a 256 -c SHA256SUMS)
```
