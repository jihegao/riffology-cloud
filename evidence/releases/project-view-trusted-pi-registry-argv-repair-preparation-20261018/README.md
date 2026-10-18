# TrustedPi Registry argv-order repair — frozen offline preparation

Same JHG-46 Goal, minimal [#247](https://github.com/jihegao/riffology-cloud/issues/247). Request `fb99c7e4-21a7-4215-8261-c17dd7c148aa`, parent stopped `9ec39434-0856-4ee7-af30-adf3dd5b5df4`. This candidate has not run a real CLI, OAuth, SSH, credential API, Docker or Registry operation. No new human grant is included. The [fixed packet](../../../docs/project-view-trusted-pi-registry-argv-repair-packet-20261018.md) defines the proposed scope; [9ec's actual result](../project-view-trusted-pi-registry-recovery-result-20261018/README.md) remains separate.

The eight operation sources total73,639B, with [operations-manifest.json](operations-manifest.json)1,313B/SHA256 `89f2f285f5f732a6f3c9b8705a47fde4b5f073970e585e779371fb20ac2680fa`. The only execution-logic change in `local-recovery.py` puts the fixed `--env-file /dev/null` pair after command arguments. Scope changes only the new request, parent and remote sibling; original c3e archive/image/account/repository/tag, exact six OAuth scopes, one-credential/push limit and all exclusions remain. The pure OCI verifier and remote operation code remain byte-identical to9ec. New [reader](independent-cleanup-readonly.py)9,065B/SHA256 `2207c49844d8bfa4777510d6c60d4333f509dd1d7ab42fabf71e6188c77d6266` changes only request/root identity.

[Preparation and check projection](public-preparation-review.json) records16 operation fakes,7 reader fixtures and the [real pinned-parser fixture](parse-fixed-wrangler-argv.mjs). The parser check reads only the public pinned CLI source, extracts11 exact pure fragments into a VM without process/require/fetch, rejects file/module capabilities, and reports0 forbidden capability calls. It reproduces the old greedy array consuming login/auth/token and preserves both commands plus exactly `/dev/null` with the fixed order. It does not import or run the complete CLI, global initializer, dotenv loader or OAuth handler. These results do not reconstruct the lost9ec stderr, establish old OAuth side effects or prove repaired login/API/push success.

Original check receipts and raw synthetic outputs are retained; [public projection](public-preparation-review.json) binds their bytes/hash and UTC times. The [source binding](candidate-source-binding.json) describes the original private candidate files, while [this public inventory](inventory.json) binds the published mirrors/envelopes below. All eight executable inputs and manifest are exact copies. Original CLI/credential outputs, OAuth config, human reply, private grants and OCI archive are excluded.

Public mappings from original artifacts (original byte/hash retained inside each envelope):

- `parser-check-first.receipt.json` → [parser-check-first.receipt.safe.json](parser-check-first.receipt.safe.json) (display command projection).
- `source-delta.patch` → [source-delta.patch.base64.json](source-delta.patch.base64.json) (lossless base64).

The remaining mapped artifacts are byte-identical copies. The original and repaired sources/records remain distinct; no original lock or terminal was cleared. Independent source/document reviews are stored separately from this inventory. No merge, rollout, gate/user acceptance, fee settlement or JHG-46/JHG-56 completion is implied.

[Independent source review](../project-view-trusted-pi-registry-argv-order-review-20261018.json) binds the frozen candidate and retained checks; it does not authorize execution.
