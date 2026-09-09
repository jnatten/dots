import AppKit

// launchd owns the instance that matters, but a stray make run should not add a
// second set of dots to the bar
let identifier = Bundle.main.bundleIdentifier ?? "dev.natten.ccdots"
if NSRunningApplication.runningApplications(withBundleIdentifier: identifier).count > 1 {
    exit(0)
}

// Retained by being a global: NSApplication holds its delegate unowned
let controller = StatusController()
let application = NSApplication.shared
application.setActivationPolicy(.accessory)
application.delegate = controller
application.run()
