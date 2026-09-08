# Shared argument handling for focus.sh and menu.sh: turns the clicked mouse
# range into $state, and takes the client and mouse column off the arguments.
case "${1:-}" in
  cc-work) state=working ;;
  cc-wait) state=waiting ;;
  cc-idle) state=idle ;;
  *) exit 0 ;;
esac
client="${2:-}"
mouse_x="${3:-C}"
