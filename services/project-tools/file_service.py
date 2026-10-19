#!/usr/bin/env python3
"""One-shot workspace file tool for the isolated project Sandbox.

Every path component is opened relative to an already-open directory fd with
O_NOFOLLOW. Project processes can rename paths concurrently, but they cannot
redirect an accepted operation outside the workspace inode tree.
"""
import hashlib
import json
import os
import re
import signal
import stat
import subprocess
import sys
import threading
import time
import unicodedata
import uuid

MAX_FILE_BYTES = 1024 * 1024
MAX_LIST_ENTRIES = 1000
MAX_SEARCH_FILES = 5000
MAX_COMMAND_BYTES = 1100000
MAX_DEADLINE_MS = 120000
MAX_EFFECT_RESULT_BYTES = 1060000
MAX_INLINE_PAGE_RESULT_BYTES = 15000
MAX_BASH_STREAM_BYTES = 6000
IR_NODE = "/usr/local/bin/node"
IR_PROGRAM = "/opt/riffology/riffoid-ir-plugin/scripts/riffoid-cli.mjs"
IR_PACKAGE_ROOT = "/opt/riffology/riffoid-ir-plugin"
IR_PACKAGE_LOCK = "/opt/riffology/riffoid-ir-plugin.lock.json"
IR_PYTHON = "/opt/riffology/python-compiler/bin/python3"
IR_COMPILER_WHEEL_SHA256 = "e7bcd9271dd42106b78e87176e3485b290536f5291c0440872b814fc549858f7"
TEST_HOOK = lambda _stage: None


class ToolError(Exception):
    pass


class EffectUnknown(Exception):
    pass


def fail(code):
    raise ToolError(code)


def exact(value, keys, code="invalid-tool-arguments"):
    if not isinstance(value, dict) or set(value.keys()) != set(keys):
        fail(code)
    return value


def workspace_path(value, allow_root=False):
    if value == "" and allow_root:
        return []
    if not isinstance(value, str) or not value or len(value.encode("utf-8")) > 1024 or len(value) > 512:
        fail("invalid-tool-path")
    if unicodedata.normalize("NFC", value) != value or value.startswith("/") or value.endswith("/") or "\\" in value:
        fail("invalid-tool-path")
    if any(ord(char) < 32 or ord(char) == 127 for char in value):
        fail("invalid-tool-path")
    parts = value.split("/")
    if any(part in ("", ".", "..") for part in parts) or parts[0] == ".riffology":
        fail("invalid-tool-path")
    return parts


def deadline(value):
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        fail("invalid-tool-deadline")
    now = int(time.time() * 1000)
    if value <= now:
        fail("tool-deadline-expired")
    if value - now > MAX_DEADLINE_MS:
        fail("invalid-tool-deadline")
    return value


def check_deadline(value):
    if value <= int(time.time() * 1000):
        fail("tool-deadline-expired")


def open_root(root):
    if not isinstance(root, str) or not os.path.isabs(root):
        fail("project-workspace-root-denied")
    try:
        fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    except OSError:
        fail("project-workspace-root-denied")
    if not stat.S_ISDIR(os.fstat(fd).st_mode):
        os.close(fd)
        fail("project-workspace-root-denied")
    return fd


def open_directory(root_fd, parts, deadline_at=None):
    current = os.dup(root_fd)
    try:
        for part in parts:
            if deadline_at is not None:
                check_deadline(deadline_at)
            next_fd = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=current)
            os.close(current)
            current = next_fd
        return current
    except ToolError:
        os.close(current)
        raise
    except OSError:
        os.close(current)
        fail("project-tool-path-denied")


def open_parent(root_fd, parts, deadline_at=None):
    if not parts:
        fail("invalid-tool-path")
    return open_directory(root_fd, parts[:-1], deadline_at), parts[-1]


def read_at(parent_fd, leaf, deadline_at=None):
    if deadline_at is not None:
        check_deadline(deadline_at)
    try:
        fd = os.open(leaf, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=parent_fd)
    except OSError:
        fail("project-tool-file-unreadable")
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_FILE_BYTES:
            fail("project-tool-file-unreadable")
        chunks, total = [], 0
        while True:
            if deadline_at is not None:
                check_deadline(deadline_at)
            chunk = os.read(fd, min(65536, MAX_FILE_BYTES + 1 - total))
            if not chunk:
                break
            chunks.append(chunk)
            total += len(chunk)
            if total > MAX_FILE_BYTES:
                fail("project-tool-file-unreadable")
        if deadline_at is not None:
            check_deadline(deadline_at)
        return b"".join(chunks)
    finally:
        os.close(fd)


def text_at(parent_fd, leaf, deadline_at=None):
    value = read_at(parent_fd, leaf, deadline_at)
    try:
        return value, value.decode("utf-8", errors="strict")
    except UnicodeDecodeError:
        fail("project-tool-file-not-utf8")


def file_kind(mode):
    if stat.S_ISREG(mode):
        return "file"
    if stat.S_ISDIR(mode):
        return "directory"
    return "other"


def existing_regular(parent_fd, leaf):
    try:
        info = os.stat(leaf, dir_fd=parent_fd, follow_symlinks=False)
    except FileNotFoundError:
        return False
    except OSError:
        fail("project-tool-path-denied")
    if not stat.S_ISREG(info.st_mode):
        fail("project-tool-path-denied")
    return True


def ensure_current_directory(root_fd, parts, expected_fd, deadline_at):
    current = open_directory(root_fd, parts, deadline_at)
    try:
        expected, observed = os.fstat(expected_fd), os.fstat(current)
        if (expected.st_dev, expected.st_ino) != (observed.st_dev, observed.st_ino):
            fail("project-tool-path-raced")
    finally:
        os.close(current)


def scan_names(directory_fd, limit, deadline_at):
    names, truncated = [], False
    try:
        with os.scandir(directory_fd) as entries:
            for entry in entries:
                check_deadline(deadline_at)
                if len(names) >= limit:
                    truncated = True
                    break
                names.append(entry.name)
    except OSError:
        fail("project-tool-directory-unreadable")
    return sorted(names), truncated


def atomic_write(root_fd, parts, content, deadline_at):
    encoded = content.encode("utf-8")
    if len(encoded) > MAX_FILE_BYTES:
        fail("project-tool-file-too-large")
    parent_fd, leaf = open_parent(root_fd, parts, deadline_at)
    temporary = ".riffology-write-" + str(uuid.uuid4())
    fd, committed = None, False
    try:
        check_deadline(deadline_at)
        existing_regular(parent_fd, leaf)
        fd = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600, dir_fd=parent_fd)
        offset = 0
        while offset < len(encoded):
            offset += os.write(fd, encoded[offset:])
        os.fsync(fd)
        os.close(fd)
        fd = None
        existing_regular(parent_fd, leaf)
        TEST_HOOK("parent-opened")
        check_deadline(deadline_at)
        ensure_current_directory(root_fd, parts[:-1], parent_fd, deadline_at)
        os.replace(temporary, leaf, src_dir_fd=parent_fd, dst_dir_fd=parent_fd)
        committed = True
        TEST_HOOK("after-replace")
        os.fsync(parent_fd)
        ensure_current_directory(root_fd, parts[:-1], parent_fd, deadline_at)
        return {"bytes": len(encoded), "sha256": hashlib.sha256(encoded).hexdigest()}
    except ToolError as error:
        if committed:
            raise EffectUnknown("project-tool-write-outcome-unknown") from error
        raise
    except OSError as error:
        if committed:
            raise EffectUnknown("project-tool-write-outcome-unknown") from error
        fail("project-tool-write-failed")
    finally:
        if fd is not None:
            os.close(fd)
        try:
            os.unlink(temporary, dir_fd=parent_fd)
        except FileNotFoundError:
            pass
        except OSError:
            pass
        os.close(parent_fd)


def read_tool(root_fd, path, deadline_at):
    parts = workspace_path(path)
    parent_fd, leaf = open_parent(root_fd, parts, deadline_at)
    try:
        value, text = text_at(parent_fd, leaf, deadline_at)
        ensure_current_directory(root_fd, parts[:-1], parent_fd, deadline_at)
        return {"kind": "read", "path": path, "content": text, "bytes": len(value), "sha256": hashlib.sha256(value).hexdigest()}
    finally:
        os.close(parent_fd)


def read_page_tool(root_fd, args, deadline_at):
    exact(args, ["path", "offset", "maxBytes", "expectedSha256"])
    path = args["path"]
    offset = args["offset"]
    max_bytes = args["maxBytes"]
    expected_sha256 = args["expectedSha256"]
    if isinstance(offset, bool) or not isinstance(offset, int) or offset < 0 or offset > MAX_FILE_BYTES:
        fail("invalid-tool-arguments")
    if isinstance(max_bytes, bool) or not isinstance(max_bytes, int) or max_bytes < 4 or max_bytes > 8192:
        fail("invalid-tool-arguments")
    if expected_sha256 is not None and (not isinstance(expected_sha256, str) or len(expected_sha256) != 64 or any(char not in "0123456789abcdef" for char in expected_sha256)):
        fail("invalid-tool-arguments")
    if offset > 0 and expected_sha256 is None:
        fail("project-tool-read-page-sha-required")
    parts = workspace_path(path)
    parent_fd, leaf = open_parent(root_fd, parts, deadline_at)
    try:
        value, _ = text_at(parent_fd, leaf, deadline_at)
        digest = hashlib.sha256(value).hexdigest()
        if expected_sha256 is not None and expected_sha256 != digest:
            fail("project-tool-read-page-version-changed")
        total_bytes = len(value)
        if offset > total_bytes or (offset < total_bytes and value[offset] & 0xC0 == 0x80):
            fail("project-tool-read-page-offset-invalid")
        end = min(total_bytes, offset + max_bytes)
        while end > offset and end < total_bytes and value[end] & 0xC0 == 0x80:
            end -= 1
        if end == offset and offset < total_bytes:
            fail("project-tool-read-page-size-invalid")
        while True:
            page = value[offset:end]
            try:
                content = page.decode("utf-8")
            except UnicodeDecodeError:
                fail("project-tool-file-not-utf8")
            result = {
                "kind": "read_page",
                "path": path,
                "offset": offset,
                "nextOffset": end,
                "bytes": len(page),
                "totalBytes": total_bytes,
                "sha256": digest,
                "content": content,
                "eof": end == total_bytes,
            }
            encoded_result = json.dumps(result, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            if len(encoded_result) <= MAX_INLINE_PAGE_RESULT_BYTES:
                break
            end = offset + max(1, (end - offset) // 2)
            while end > offset and end < total_bytes and value[end] & 0xC0 == 0x80:
                end -= 1
            if end == offset:
                fail("project-tool-read-page-size-invalid")
        ensure_current_directory(root_fd, parts[:-1], parent_fd, deadline_at)
        return result
    finally:
        os.close(parent_fd)


def write_tool(root_fd, args, deadline_at):
    exact(args, ["path", "content"])
    if not isinstance(args["content"], str):
        fail("invalid-tool-content")
    parts = workspace_path(args["path"])
    saved = atomic_write(root_fd, parts, args["content"], deadline_at)
    return {"kind": "write", "path": args["path"], **saved}


def edit_tool(root_fd, args, deadline_at):
    exact(args, ["path", "oldText", "newText", "replaceAll"])
    if not isinstance(args["oldText"], str) or not args["oldText"] or not isinstance(args["newText"], str) or not isinstance(args["replaceAll"], bool):
        fail("invalid-tool-content")
    if len(args["oldText"].encode("utf-8")) > 256 * 1024 or len(args["newText"].encode("utf-8")) > 256 * 1024:
        fail("invalid-tool-content")
    parts = workspace_path(args["path"])
    parent_fd, leaf = open_parent(root_fd, parts, deadline_at)
    try:
        _, current = text_at(parent_fd, leaf, deadline_at)
        ensure_current_directory(root_fd, parts[:-1], parent_fd, deadline_at)
    finally:
        os.close(parent_fd)
    occurrences = current.count(args["oldText"])
    if occurrences == 0:
        fail("project-tool-edit-no-match")
    if not args["replaceAll"] and occurrences != 1:
        fail("project-tool-edit-ambiguous")
    updated = current.replace(args["oldText"], args["newText"], -1 if args["replaceAll"] else 1)
    saved = atomic_write(root_fd, parts, updated, deadline_at)
    return {"kind": "edit", "path": args["path"], **saved}


def list_tool(root_fd, args, deadline_at):
    exact(args, ["path"])
    parts = workspace_path(args["path"], allow_root=True)
    directory_fd = open_directory(root_fd, parts, deadline_at)
    try:
        names, truncated = scan_names(directory_fd, MAX_LIST_ENTRIES, deadline_at)
        entries = []
        for name in names:
            check_deadline(deadline_at)
            try:
                info = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
                entries.append({"name": name, "kind": file_kind(info.st_mode)})
            except FileNotFoundError:
                continue
        ensure_current_directory(root_fd, parts, directory_fd, deadline_at)
        return {"kind": "list", "path": args["path"], "entries": entries, "truncated": truncated}
    finally:
        os.close(directory_fd)


def search_tool(root_fd, args, deadline_at):
    exact(args, ["path", "query", "maxResults"])
    query, maximum = args["query"], args["maxResults"]
    if not isinstance(query, str) or not query or len(query.encode("utf-8")) > 1024 or isinstance(maximum, bool) or not isinstance(maximum, int) or maximum < 1 or maximum > 200:
        fail("invalid-tool-query")
    parts = workspace_path(args["path"], allow_root=True)
    start_fd = open_directory(root_fd, parts, deadline_at)
    matches, files_scanned, truncated = [], 0, False

    def walk(directory_fd, logical_parts):
        nonlocal files_scanned, truncated
        try:
            check_deadline(deadline_at)
            names, directory_truncated = scan_names(directory_fd, MAX_SEARCH_FILES + 1, deadline_at)
            for name in names:
                check_deadline(deadline_at)
                if truncated:
                    return
                try:
                    info = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
                except FileNotFoundError:
                    continue
                if stat.S_ISLNK(info.st_mode):
                    continue
                if stat.S_ISDIR(info.st_mode):
                    try:
                        child_fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory_fd)
                    except OSError:
                        continue
                    try:
                        walk(child_fd, logical_parts + [name])
                    finally:
                        os.close(child_fd)
                    continue
                if not stat.S_ISREG(info.st_mode):
                    continue
                files_scanned += 1
                if files_scanned > MAX_SEARCH_FILES:
                    truncated = True
                    return
                try:
                    _, text = text_at(directory_fd, name, deadline_at)
                except ToolError as error:
                    if str(error) in ("project-tool-file-unreadable", "project-tool-file-not-utf8"):
                        continue
                    raise
                for number, line in enumerate(text.splitlines(), start=1):
                    if query in line:
                        matches.append({"path": "/".join(logical_parts + [name]), "line": number, "text": line[:500]})
                        if len(matches) >= maximum:
                            truncated = True
                            return
            if directory_truncated:
                truncated = True
        except OSError:
            fail("project-tool-search-failed")

    try:
        walk(start_fd, parts)
        ensure_current_directory(root_fd, parts, start_fd, deadline_at)
    finally:
        os.close(start_fd)
    return {"kind": "search", "path": args["path"], "query": query, "matches": matches, "filesScanned": files_scanned, "truncated": truncated}


def verify_ir_package(root=IR_PACKAGE_ROOT, lock=IR_PACKAGE_LOCK):
    # Both arguments are platform constants in product calls. Reject symlinks,
    # extra files/directories, hardlinks and byte drift before executing Node.
    try:
        info, lock_info = os.lstat(root), os.lstat(lock)
        if not stat.S_ISDIR(info.st_mode) or not stat.S_ISREG(lock_info.st_mode) or lock_info.st_size > 128 * 1024:
            fail("project-tool-ir-package-invalid")
        with open(lock, "rb") as stream:
            pin = json.loads(stream.read(128 * 1024 + 1))
        exact(pin, ["schema", "name", "version", "packageSha256", "contractCommit", "files"], "project-tool-ir-package-invalid")
        if (pin["schema"] != "riffoid-ir.package-pin/v1" or pin["name"] != "riffoid-ir-plugin"
                or not isinstance(pin["version"], str) or not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", pin["version"])
                or not isinstance(pin["packageSha256"], str) or not re.fullmatch(r"[a-f0-9]{64}", pin["packageSha256"])
                or not isinstance(pin["contractCommit"], str) or not re.fullmatch(r"[a-f0-9]{40}", pin["contractCommit"])
                or not isinstance(pin["files"], list) or not 0 < len(pin["files"]) <= 256):
            fail("project-tool-ir-package-invalid")
        expected, directories, total = {}, set(), 0
        for item in pin["files"]:
            exact(item, ["path", "bytes", "sha256"], "project-tool-ir-package-invalid")
            path = item["path"]
            if (not isinstance(path, str) or not re.fullmatch(r"(?:[A-Za-z0-9_-]+/)*[A-Za-z0-9_.-]+", path)
                    or any(p in {".", ".."} for p in path.split("/")) or path in expected
                    or type(item["bytes"]) is not int or not 0 <= item["bytes"] <= 1024 * 1024
                    or not isinstance(item["sha256"], str) or not re.fullmatch(r"[a-f0-9]{64}", item["sha256"])):
                fail("project-tool-ir-package-invalid")
            total += item["bytes"]
            if total > 8 * 1024 * 1024:
                fail("project-tool-ir-package-invalid")
            expected[path] = item
            parts = path.split("/")
            for index in range(1, len(parts)):
                directories.add("/".join(parts[:index]))
        found = set()
        for current, dirnames, filenames in os.walk(root, followlinks=False):
            relative = os.path.relpath(current, root)
            for name in dirnames + filenames:
                logical = name if relative == "." else relative + "/" + name
                path = os.path.join(current, name)
                info = os.lstat(path)
                if stat.S_ISDIR(info.st_mode):
                    if logical not in directories:
                        fail("project-tool-ir-package-invalid")
                    continue
                item = expected.get(logical)
                if (not item or not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size != item["bytes"]):
                    fail("project-tool-ir-package-invalid")
                with open(path, "rb") as stream:
                    content = stream.read(1024 * 1024 + 1)
                if len(content) != item["bytes"] or hashlib.sha256(content).hexdigest() != item["sha256"]:
                    fail("project-tool-ir-package-invalid")
                found.add(logical)
        if found != set(expected):
            fail("project-tool-ir-package-invalid")
        with open(os.path.join(root, "package.json"), "rb") as stream:
            manifest = json.load(stream)
        if manifest.get("name") != pin["name"] or manifest.get("version") != pin["version"]:
            fail("project-tool-ir-package-invalid")
        return pin
    except ToolError:
        raise
    except (OSError, ValueError, TypeError, KeyError):
        fail("project-tool-ir-package-invalid")


def ir_tool(args, root, deadline_at):
    exact(args, ["operation", "input"])
    operation, value = args["operation"], args["input"]
    if operation not in {"project_ir_check", "project_ir_compile", "mode", "show", "install"}:
        fail("project-tool-ir-authority-required")
    if not isinstance(value, dict):
        fail("invalid-tool-arguments")
    if operation in {"project_ir_check", "project_ir_compile"}:
        key = "draftRef" if operation == "project_ir_check" else "sealedRef"
        exact(value, [key])
        workspace_path(value[key])
    elif operation == "mode":
        exact(value, ["mode"])
        if value["mode"] not in {"ir", "code"}:
            fail("invalid-tool-arguments")
    else:
        exact(value, [])
    pin = verify_ir_package()
    # No shell, user argv, alternate executable, inherited credential or project
    # module lookup is accepted at this boundary. The package is image-owned.
    root_fd = open_root(root)
    os.close(root_fd)
    check_deadline(deadline_at)
    remaining_ms = max(1, deadline_at - int(time.time() * 1000))
    process = subprocess.Popen(
        [IR_NODE, IR_PROGRAM], cwd=root,
        env={"LANG": "C.UTF-8", "PATH": "/usr/bin:/bin", "PYTHONDONTWRITEBYTECODE": "1",
             "RIFFOID_IR_PYTHON": IR_PYTHON, "RIFFOID_IR_COMPILER_WHEEL_SHA256": IR_COMPILER_WHEEL_SHA256,
             "RIFFOID_IR_COMPILER_MODE": "installed-sdk", "RIFFOID_IR_PACKAGE_SHA256": pin["packageSha256"]},
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True,
    )
    try:
        stdout, stderr = process.communicate(json.dumps(args, separators=(",", ":")).encode("utf-8"), timeout=remaining_ms / 1000)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.communicate()
        raise EffectUnknown("project-tool-ir-timeout")
    finally:
        # A finite tool cannot leave children mutating the frozen workspace.
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    if len(stdout) > MAX_EFFECT_RESULT_BYTES or len(stderr) > 16384:
        raise EffectUnknown("project-tool-result-too-large")
    if process.returncode != 0 or stderr:
        raise EffectUnknown("project-tool-ir-process-failed")
    try:
        result = json.loads(stdout.decode("utf-8", errors="strict"))
    except (ValueError, UnicodeDecodeError) as error:
        raise EffectUnknown("project-tool-ir-invalid-output") from error
    if not isinstance(result, dict):
        raise EffectUnknown("project-tool-ir-invalid-output")
    return result


def execute(value, root="/workspace"):
    request = exact(value, ["deadlineAt", "operation", "arguments"], "invalid-tool-command")
    deadline_at = deadline(request["deadlineAt"])
    operation = request["operation"]
    if operation not in ("read", "read_page", "write", "edit", "list", "search", "bash", "ir"):
        fail("project-tool-operation-not-file")
    if operation == "ir":
        return ir_tool(request["arguments"], root, deadline_at)
    if operation == "bash":
        args = exact(request["arguments"], ["script", "timeoutMs"])
        script = args["script"]
        timeout_ms = args["timeoutMs"]
        if not isinstance(script, str) or not script or len(script.encode("utf-8")) > 16 * 1024 or "\0" in script:
            fail("invalid-tool-script")
        if any((0 < ord(char) < 9) or ord(char) in (11, 12) or (13 < ord(char) < 32) or ord(char) == 127 for char in script):
            fail("invalid-tool-script")
        if isinstance(timeout_ms, bool) or not isinstance(timeout_ms, int) or timeout_ms < 1 or timeout_ms > 30000:
            fail("invalid-tool-arguments")
        remaining_ms = min(timeout_ms, max(1, deadline_at - int(time.time() * 1000)))

        process = subprocess.Popen(
            ["/bin/bash", "--noprofile", "--norc", "-c", script],
            cwd=root,
            env={"LANG": "C.UTF-8", "PATH": "/usr/bin:/bin"},
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            start_new_session=True,
        )
        streams = {"stdout": bytearray(), "stderr": bytearray()}
        truncated = {"stdout": False, "stderr": False}

        def drain(name, source):
            while True:
                chunk = source.read(65536)
                if not chunk:
                    return
                remaining = MAX_BASH_STREAM_BYTES - len(streams[name])
                if remaining > 0:
                    streams[name].extend(chunk[:remaining])
                if len(chunk) > remaining:
                    truncated[name] = True

        readers = [
            threading.Thread(target=drain, args=("stdout", process.stdout), daemon=True),
            threading.Thread(target=drain, args=("stderr", process.stderr), daemon=True),
        ]
        for reader in readers:
            reader.start()
        try:
            process.wait(timeout=remaining_ms / 1000)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait()
            for reader in readers:
                reader.join()
            fail("project-tool-bash-timeout")
        # Bash tools are finite operations. The shell can exit successfully
        # while background children still write workspace files or hold pipes.
        # Stop the original process group before returning its terminal result.
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        for reader in readers:
            reader.join()
        return {
            "kind": "bash",
            "exitCode": process.returncode,
            "stdout": bytes(streams["stdout"]).decode("utf-8", errors="replace"),
            "stderr": bytes(streams["stderr"]).decode("utf-8", errors="replace"),
            "stdoutTruncated": truncated["stdout"],
            "stderrTruncated": truncated["stderr"],
        }
    root_fd = open_root(root)
    try:
        args = request["arguments"]
        if operation == "read":
            exact(args, ["path"])
            return read_tool(root_fd, args["path"], deadline_at)
        if operation == "read_page":
            return read_page_tool(root_fd, args, deadline_at)
        if operation == "write":
            return write_tool(root_fd, args, deadline_at)
        if operation == "edit":
            return edit_tool(root_fd, args, deadline_at)
        if operation == "list":
            return list_tool(root_fd, args, deadline_at)
        return search_tool(root_fd, args, deadline_at)
    finally:
        os.close(root_fd)


def main():
    try:
        raw = sys.stdin.buffer.read(MAX_COMMAND_BYTES + 1)
        if len(raw) > MAX_COMMAND_BYTES:
            fail("project-tool-command-too-large")
        request = json.loads(raw)
        result = execute(request, os.environ.get("RIFFOLOGY_WORKSPACE_ROOT", "/workspace"))
        encoded_result = json.dumps(result, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        if len(encoded_result) > MAX_EFFECT_RESULT_BYTES:
            fail("project-tool-result-too-large")
        print(json.dumps({"ok": True, "result": result}, ensure_ascii=False, separators=(",", ":")))
    except EffectUnknown as error:
        print(json.dumps({"ok": False, "unknown": True, "error": str(error)}, separators=(",", ":")))
        return 4
    except (ToolError, json.JSONDecodeError) as error:
        print(json.dumps({"ok": False, "error": str(error) if str(error) else "invalid-json"}, separators=(",", ":")))
        return 2
    except Exception:
        print(json.dumps({"ok": False, "error": "project-tool-internal-error"}, separators=(",", ":")))
        return 3
    return 0


if __name__ == "__main__":
    sys.exit(main())
