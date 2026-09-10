import AppKit

final class StatusController: NSObject, NSApplicationDelegate, NSMenuDelegate {
    private let claudeDir = ProcessInfo.processInfo.environment["CC_CLAUDE_DIR"]
        ?? NSHomeDirectory() + "/.tmux/claude"
    private let terminal = ProcessInfo.processInfo.environment["CC_TERMINAL_BUNDLE"]
        ?? "com.mitchellh.ghostty"
    private let shellQueue = DispatchQueue(label: "dev.natten.ccdots.shell")

    private var statusItem: NSStatusItem?
    private let menu = NSMenu()
    private var sessions: [Session] = []
    private var pollInFlight = false
    private var menuIsOpen = false
    private var failures = 0
    private var timer: Timer?
    private var lastFront = 0
    private var seenStates: [String: State]?

    private var sessionsScript: String { claudeDir + "/sessions.sh" }
    private var activateScript: String { claudeDir + "/activate.sh" }

    func applicationDidFinishLaunching(_: Notification) {
        if !FileManager.default.isExecutableFile(atPath: sessionsScript) {
            note("cannot run \(sessionsScript) — is the tmux package stowed?")
        }

        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        item.autosaveName = "ccdots"
        item.isVisible = false
        item.button?.imagePosition = .imageOnly
        menu.delegate = self
        menu.autoenablesItems = false
        item.menu = menu
        statusItem = item

        let ticker = Timer(timeInterval: 2, repeats: true) { [weak self] _ in self?.poll() }
        ticker.tolerance = 0.5
        // .common, or the dots would stop moving for as long as the menu is open
        RunLoop.main.add(ticker, forMode: .common)
        timer = ticker

        let workspace = NSWorkspace.shared.notificationCenter
        workspace.addObserver(self, selector: #selector(poll),
                              name: NSWorkspace.didActivateApplicationNotification, object: nil)
        workspace.addObserver(self, selector: #selector(poll),
                              name: NSWorkspace.didWakeNotification, object: nil)
        NotificationCenter.default.addObserver(
            self, selector: #selector(redraw),
            name: NSApplication.didChangeScreenParametersNotification, object: nil)

        poll()
    }

    func applicationWillTerminate(_: Notification) {
        // Hand focus tracking back to tmux alone, or the dots would stay lit
        Shell.tmux(["set", "-gu", "@cc-front"])
    }

    @objc private func poll() {
        guard !pollInFlight else { return }
        pollInFlight = true

        // The heartbeat goes out on every poll, not just while the terminal is
        // in front: a lone front stamp going stale is ambiguous between "you
        // are in another app" and "this app died", and those want opposite
        // fallbacks. Published before the read, so sessions.sh sees it current
        let beat = Int(Date().timeIntervalSince1970)
        if NSWorkspace.shared.frontmostApplication?.bundleIdentifier == terminal {
            lastFront = beat
        }
        let stamp = "\(beat) \(lastFront)"
        let script = sessionsScript
        shellQueue.async { [weak self] in
            Shell.tmux(["set", "-g", "@cc-front", stamp])
            let output = Shell.run(script, timeout: 4)
            DispatchQueue.main.async { self?.apply(output) }
        }
    }

    private func apply(_ output: Shell.Output) {
        pollInFlight = false
        if output.failed {
            failures += 1
            if failures == 1 {
                note("sessions.sh failed (status \(output.status)) "
                    + output.stderr.trimmingCharacters(in: .whitespacesAndNewlines))
            }
            // A hiccup should not blank the bar, but a lasting failure must not
            // leave stale dots claiming attention
            if failures < 3 { return }
            sessions = []
        } else {
            failures = 0
            sessions = Session.parse(output.stdout).sorted(by: Session.order)
            announce()
        }
        redraw()
        if menuIsOpen { rebuild() }
    }

    // A toast per session that has just changed into a state wanting something
    // from you, while you were not looking at its pane. The first poll only
    // records where everything stands, or logging in would raise a toast for
    // every session at once
    private func announce() {
        let states = Dictionary(sessions.map { ($0.pane, $0.state) }, uniquingKeysWith: { a, _ in a })
        defer { seenStates = states }
        guard let before = seenStates else { return }
        for session in sessions where session.unseen && before[session.pane] != session.state {
            guard before[session.pane] != nil else { continue }
            if ProcessInfo.processInfo.environment["CCDOTS_DEBUG"] != nil {
                note("toast: \(session.name) \(before[session.pane]?.rawValue ?? "?") -> \(session.state.rawValue)")
            }
            Toast.show(session) { [weak self] pane in self?.focus(pane) }
        }
    }

    @objc private func redraw() {
        guard let item = statusItem else { return }
        guard !sessions.isEmpty else {
            if item.isVisible { item.isVisible = false }
            return
        }
        let slots = [State.working, .waiting, .idle].map { state in
            Dots.Slot(lit: sessions.contains { $0.state == state },
                      unseen: sessions.contains { $0.state == state && $0.unseen },
                      colour: state.colour)
        }
        item.button?.image = Dots.image(slots)
        item.button?.toolTip = summary()
        if !item.isVisible { item.isVisible = true }
        if ProcessInfo.processInfo.environment["CCDOTS_DEBUG"] != nil {
            let frame = item.button?.window?.frame ?? .zero
            let screen = NSScreen.main
            note("\(sessions.count) sessions, visible=\(item.isVisible), "
                + "image=\(item.button?.image?.size ?? .zero), frame=\(frame)\n"
                + "  screen=\(screen?.frame ?? .zero)\n"
                + "  free left of notch=\(screen?.auxiliaryTopLeftArea ?? .zero)\n"
                + "  free right of notch=\(screen?.auxiliaryTopRightArea ?? .zero)")
        }
    }

    private func summary() -> String {
        let parts = [State.working, .waiting, .idle].compactMap { state -> String? in
            let count = sessions.filter { $0.state == state }.count
            return count > 0 ? "\(count) \(state.rawValue)" : nil
        }
        return parts.isEmpty ? "no Claude sessions" : parts.joined(separator: " · ")
    }

    func menuNeedsUpdate(_: NSMenu) {
        // Built from the last poll so the menu opens instantly, then refreshed
        // in place when the new read lands
        rebuild()
        poll()
    }

    func menuWillOpen(_: NSMenu) { menuIsOpen = true }

    func menuDidClose(_: NSMenu) { menuIsOpen = false }

    private func rebuild() {
        menu.removeAllItems()
        menu.addItem(disabled(summary()))
        menu.addItem(.separator())

        if sessions.isEmpty {
            menu.addItem(disabled(failures > 0
                ? "sessions.sh failed — see ~/Library/Logs/ccdots.log"
                : "no live Claude sessions"))
        }

        let windowWidth = min(20, sessions.map { $0.windowName.count }.max() ?? 1)
        let nameWidth = min(24, sessions.map { $0.name.count }.max() ?? 1)
        for (index, session) in sessions.enumerated() {
            let item = NSMenuItem(title: "", action: #selector(pick(_:)),
                                  keyEquivalent: index < 9 ? String(index + 1) : "")
            item.keyEquivalentModifierMask = []
            item.attributedTitle = Rows.title(session, windowWidth: windowWidth, nameWidth: nameWidth)
            item.target = self
            item.representedObject = session.pane
            menu.addItem(item)
        }

        menu.addItem(.separator())
        let refresh = NSMenuItem(title: "Refresh", action: #selector(poll), keyEquivalent: "r")
        refresh.target = self
        menu.addItem(refresh)
        menu.addItem(NSMenuItem(title: "Quit ccdots",
                                action: #selector(NSApplication.terminate(_:)),
                                keyEquivalent: "q"))
    }

    private func disabled(_ title: String) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        item.isEnabled = false
        return item
    }

    @objc private func pick(_ sender: NSMenuItem) {
        guard let pane = sender.representedObject as? String else { return }
        focus(pane)
    }

    private func focus(_ pane: String) {
        let script = activateScript
        shellQueue.async { _ = Shell.run(script, [pane], timeout: 10) }
    }

    private func note(_ message: String) {
        FileHandle.standardError.write(Data("ccdots: \(message)\n".utf8))
    }
}
