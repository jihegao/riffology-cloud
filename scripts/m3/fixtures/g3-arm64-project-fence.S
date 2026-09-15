// Test-only freestanding ARM64 kernel filter before translated Python exec.
// No libc/compiler container download is required. Linux syscall ABI only.
.global _start
.text
_start:
 mov x19, sp
 mov x8, #175 // geteuid
 svc #0
 mov x9, #10001
 cmp x0, x9
 b.ne fail
 mov x0, #38 // PR_SET_NO_NEW_PRIVS
 mov x1, #1
 mov x2, #0
 mov x3, #0
 mov x4, #0
 mov x8, #167 // prctl on aarch64
 svc #0
 cbnz x0, fail
 sub sp, sp, #16
 mov w9, #37 // filter instructions
 strh w9, [sp]
 adr x9, filter
 str x9, [sp, #8]
 mov x0, #22 // PR_SET_SECCOMP
 mov x1, #2
 mov x2, sp
 mov x3, #0
 mov x4, #0
 mov x8, #167
 svc #0
 cbnz x0, fail
 mov x0, #39 // PR_GET_NO_NEW_PRIVS actual kernel proof
 mov x1, #0
 mov x2, #0
 mov x3, #0
 mov x4, #0
 mov x8, #167
 svc #0
 cmp x0, #1
 b.ne fail
.macro probe_uring number
 mov x0, #0
 mov x1, #0
 mov x2, #0
 mov x3, #0
 mov x4, #0
 mov x8, #\number
 svc #0
 cmn x0, #1 // actual native syscall must return -EPERM
 b.ne fail
.endm
 probe_uring 425
 probe_uring 426
 probe_uring 427
 mov x0, #2
 adr x1, installed
 mov x2, #installedLength
 mov x8, #64
 svc #0
 ldr x0, [x19, #16] // argv[1] interpreter path
 add x1, x19, #16 // argv + 1
 ldr x9, [x19] // argc
 add x2, x19, #16
 add x2, x2, x9, lsl #3 // envp = stack + 8*(argc+2)
 mov x8, #221 // execve
 svc #0
fail:
 mov x0, #69
 mov x8, #93
 svc #0
.balign 8
installed: .ascii "arm64-kernel uid10001 nonewprivs1 uring425/426/427EPERM\n"
.set installedLength, .-installed
.balign 8
filter:
 .short 0x20; .byte 0,0; .word 4 // arch
 .short 0x15; .byte 1,0; .word 0xc00000b7
 .short 0x06; .byte 0,0; .word 0x80000000 // kill unknown arch
 .short 0x20; .byte 0,0; .word 0 // syscall nr
.macro deny number
 .short 0x15; .byte 0,1; .word \number
 .short 0x06; .byte 0,0; .word 0x00050001 // EPERM
.endm
 deny 203 // connect
 deny 200 // bind
 deny 201 // listen
 deny 202 // accept
 deny 242 // accept4
 deny 199 // socketpair
 deny 206 // sendto
 deny 211 // sendmsg
 deny 207 // recvfrom
 deny 212 // recvmsg
 deny 210 // shutdown
 deny 425 // io_uring_setup
 deny 426 // io_uring_enter
 deny 427 // io_uring_register
 deny 243 // recvmmsg
 deny 269 // sendmmsg
 .short 0x06; .byte 0,0; .word 0x7fff0000
