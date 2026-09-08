"""Irreversible child-only Linux syscall fence around the root Sandbox service.

Project processes can listen and answer accepted HTTP connections, but cannot
initiate connections (including loopback and Unix sockets). This is not a
general network firewall: connectionless sendto remains governed by the
container egress policy. No connected sockets may be inherited by the child.
"""

import ctypes
import errno
import sys

DENIED_SYSCALLS = ('connect', 'io_uring_setup', 'io_uring_enter', 'io_uring_register')


def no_new_privileges():
    if sys.platform != 'linux':
        raise RuntimeError('project-network-linux-required')
    libc = ctypes.CDLL(None, use_errno=True)
    libc.prctl.argtypes = [ctypes.c_int, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_ulong]
    libc.prctl.restype = ctypes.c_int
    if libc.prctl(38, 1, 0, 0, 0) != 0:
        raise RuntimeError('project-no-new-privileges-unproven')


def install():
    # NNP is mandatory even when the wrapper is still root. Filters survive
    # setuid, fork and exec; later filters can only further restrict access.
    no_new_privileges()
    try:
        lib = ctypes.CDLL('libseccomp.so.2', use_errno=True)
    except OSError as error:
        raise RuntimeError('project-network-seccomp-unavailable') from error
    lib.seccomp_init.argtypes = [ctypes.c_uint32]
    lib.seccomp_init.restype = ctypes.c_void_p
    lib.seccomp_syscall_resolve_name.argtypes = [ctypes.c_char_p]
    lib.seccomp_syscall_resolve_name.restype = ctypes.c_int
    lib.seccomp_rule_add.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_int, ctypes.c_uint]
    lib.seccomp_rule_add.restype = ctypes.c_int
    lib.seccomp_load.argtypes = [ctypes.c_void_p]
    lib.seccomp_load.restype = ctypes.c_int
    lib.seccomp_release.argtypes = [ctypes.c_void_p]
    lib.seccomp_release.restype = None
    context = lib.seccomp_init(0x7fff0000)  # SCMP_ACT_ALLOW; bad architecture kills.
    if not context:
        raise RuntimeError('project-network-seccomp-init-failed')
    try:
        for name in DENIED_SYSCALLS:
            number = lib.seccomp_syscall_resolve_name(name.encode('ascii'))
            if number < 0 or lib.seccomp_rule_add(context, 0x00050000 | errno.EPERM, number, 0) != 0:
                raise RuntimeError('project-network-seccomp-rule-failed')
        loaded = lib.seccomp_load(context)
        if loaded != 0:
            raise RuntimeError(f'project-network-seccomp-load-failed:{loaded}')
    finally:
        lib.seccomp_release(context)
