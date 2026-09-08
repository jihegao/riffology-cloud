#!/usr/bin/env python3
"""Platform archive entrypoint serialized against project spawn and sealing."""
import os
import stat
import sys
from process_quiescence import spawn_lock, require_unsealed
import workspace_archive

if __name__ == "__main__":
    try:
        with spawn_lock() as directory:
            if len(sys.argv) != 3 or sys.argv[1] not in {"restore", "freeze"} or not workspace_archive.TOKEN.fullmatch(sys.argv[2]):
                raise RuntimeError("project-archive-command-invalid")
            if sys.argv[1] == "restore":
                require_unsealed(directory)
            else:
                os.stat(".sealed", dir_fd=directory, follow_symlinks=False)
                # A lazily recreated empty VM must never be saved as the old
                # workspace. This root-only marker is created by restore in
                # this VM and is bound to the archive token / Turn identity.
                _, archive_root = workspace_archive.roots()
                marker = os.open(archive_root / f"{sys.argv[2]}.restore.json", os.O_RDONLY | os.O_NOFOLLOW)
                try:
                    info = os.fstat(marker)
                    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
                        raise RuntimeError("project-workspace-restore-unproven")
                finally:
                    os.close(marker)
            raise SystemExit(workspace_archive.main())
    except Exception:
        print("project-archive-fence-denied", file=sys.stderr)
        raise SystemExit(4)
