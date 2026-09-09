import AppKit

// launchd owns the instance that matters, but a stray make run should not add a
// second set of dots to the bar. Counting registrations is not enough: an
// instance that has just been killed lingers in LaunchServices for a moment,
// and make reload would exit against its own ghost
let identifier = Bundle.main.bundleIdentifier ?? "dev.natten.ccdots"
let mine = ProcessInfo.processInfo.processIdentifier
let others = NSRunningApplication.runningApplications(withBundleIdentifier: identifier)
    .filter { $0.processIdentifier != mine && !$0.isTerminated }
if !others.isEmpty {
    exit(0)
}

// Retained by being a global: NSApplication holds its delegate unowned
let controller = StatusController()
let application = NSApplication.shared
application.setActivationPolicy(.accessory)
application.delegate = controller
application.run()
