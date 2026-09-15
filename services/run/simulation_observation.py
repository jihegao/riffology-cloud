"""Pre-exec trusted setup facts; model code never sees the reporting descriptor."""
import json
import os
import resource


def report_child(fd):
    # Called only after the unchanged fail-closed child_setup, before exec.
    # Explicit close-on-exec plus close below prevents generated code reporting.
    os.set_inheritable(fd, False)
    with open('/proc/self/status', encoding='ascii') as source:
        fields = dict(line.split(':', 1) for line in source if ':' in line)
    with open('/proc/self/stat', encoding='ascii') as source:
        start_ticks = int(source.read().rsplit(')', 1)[1].split()[19])
    facts = {'pid':os.getpid(), 'startTicks':start_ticks,
             'uid':[int(v) for v in fields['Uid'].split()],
             'gid':[int(v) for v in fields['Gid'].split()],
             'noNewPrivileges':int(fields['NoNewPrivs'].strip()),
             'rlimitAS':list(resource.getrlimit(resource.RLIMIT_AS)),
             'rlimitNPROC':list(resource.getrlimit(resource.RLIMIT_NPROC)),
             'network':{'seccompMode':int(fields['Seccomp'].strip()),
                        'childSetupAcknowledged':True,
                        'specificFilterObserved':False,
                        'platformFallbackConfigured':os.environ.get('RIFFOLOGY_SERVICE_PLATFORM_EGRESS_FENCE') == 'deny-all'}}
    payload = json.dumps(facts, separators=(',', ':')).encode('ascii')
    if len(payload) > min(4096, os.fpathconf(fd, 'PC_PIPE_BUF')) or os.write(fd, payload) != len(payload):
        raise RuntimeError('simulation-observation-unconfirmed')
    os.close(fd)


def read_child(fd, pid):
    payload = os.read(fd, 4097)
    if len(payload) > 4096 or os.read(fd, 1):
        raise RuntimeError('simulation-observation-invalid')
    facts = json.loads(payload)
    if facts['pid'] != pid or facts['uid'] != [10001]*4 or facts['gid'] != [10001]*4 or facts['noNewPrivileges'] != 1:
        raise RuntimeError('simulation-observation-invalid')
    if set(facts) != {'pid','startTicks','uid','gid','noNewPrivileges','rlimitAS','rlimitNPROC','network'} or type(facts['startTicks']) is not int or facts['startTicks'] < 0 or facts['rlimitAS'] != [536870912]*2 or facts['rlimitNPROC'] != [64]*2:
        raise RuntimeError('simulation-observation-invalid')
    return facts


def open_pidfd(pid):
    try:
        return os.pidfd_open(pid, 0), 'opened'
    except AttributeError:
        return None, 'unsupported'
    except OSError:
        # Includes a fast exit; never turn a failed probe into support proof.
        return None, 'unobserved'
