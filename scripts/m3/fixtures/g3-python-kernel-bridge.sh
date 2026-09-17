#!/bin/sh
# Test-only: root SDK/monitor uses its original CPython; project UID receives
# the ARM64 host-kernel filter before its translated interpreter is executed.
case "$0" in
  */python-mesa/bin/python3) real=/opt/riffology/python-mesa/bin/python3-g3-original ;;
  *) real=/usr/local/bin/python3-g3-original ;;
esac
if [ "$(/usr/bin/id -u)" = 10001 ]; then
  exec /opt/g3/project-fence "$real" "$@"
fi
exec "$real" "$@"
