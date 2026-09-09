import AppKit

// A panel that shows a session's new state for a few seconds and then fades.
// Ours rather than a Notification Center banner: no authorisation prompt, no
// notification history to clear afterwards, and the five seconds are ours to
// set rather than a system preference
final class Toast {
    private static let lifetime: TimeInterval = 5
    private static let size = NSSize(width: 340, height: 56)
    private static let margin: CGFloat = 12
    private static let gap: CGFloat = 8
    private static var live: [Toast] = []

    private let panel: NSPanel
    private let pane: String
    private let pick: (String) -> Void
    private var timer: Timer?

    static func show(_ session: Session, pick: @escaping (String) -> Void) {
        let toast = Toast(session, pick: pick)
        live.append(toast)
        layout()
        toast.panel.alphaValue = 0
        toast.panel.orderFrontRegardless()
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.15
            toast.panel.animator().alphaValue = 1
        }
        toast.timer = Timer.scheduledTimer(withTimeInterval: lifetime, repeats: false) { _ in
            toast.dismiss()
        }
        RunLoop.main.add(toast.timer!, forMode: .common)
    }

    // Newest at the top, the rest pushed down by however many are still up
    private static func layout() {
        guard let screen = NSScreen.main else { return }
        var top = screen.visibleFrame.maxY - margin
        for toast in live.reversed() {
            let origin = NSPoint(x: screen.visibleFrame.maxX - size.width - margin,
                                 y: top - size.height)
            toast.panel.setFrameOrigin(origin)
            top -= size.height + gap
        }
    }

    private init(_ session: Session, pick: @escaping (String) -> Void) {
        self.pane = session.pane
        self.pick = pick

        panel = NSPanel(contentRect: NSRect(origin: .zero, size: Toast.size),
                        styleMask: [.borderless, .nonactivatingPanel],
                        backing: .buffered,
                        defer: false)
        panel.isFloatingPanel = true
        panel.level = .statusBar
        panel.backgroundColor = .clear
        panel.isOpaque = false
        panel.hasShadow = true
        panel.hidesOnDeactivate = false
        // Over full-screen apps and on whichever space you are on, since the
        // whole point is that you are somewhere else when this fires
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary,
                                    .stationary, .ignoresCycle]

        let body = ClickView(frame: NSRect(origin: .zero, size: Toast.size))
        body.wantsLayer = true
        body.layer?.cornerRadius = 10
        body.layer?.backgroundColor = Palette.deep.withAlphaComponent(0.96).cgColor
        body.layer?.borderWidth = 1
        body.layer?.borderColor = session.state.colour.withAlphaComponent(0.5).cgColor
        body.onClick = { [weak self] in
            guard let self else { return }
            self.pick(self.pane)
            self.dismiss()
        }
        panel.contentView = body

        let dot = NSView(frame: NSRect(x: 14, y: Toast.size.height / 2 - 4, width: 8, height: 8))
        dot.wantsLayer = true
        dot.layer?.cornerRadius = 4
        dot.layer?.backgroundColor = session.state.colour.cgColor
        body.addSubview(dot)

        let heading = label(NSFont.systemFont(ofSize: 12, weight: .semibold))
        heading.attributedStringValue = Toast.heading(session)
        heading.frame = NSRect(x: 32, y: 29, width: Toast.size.width - 44, height: 16)
        body.addSubview(heading)

        let detail = label(NSFont.systemFont(ofSize: 11, weight: .regular))
        detail.stringValue = Toast.detail(session)
        detail.textColor = Palette.dim
        detail.frame = NSRect(x: 32, y: 11, width: Toast.size.width - 44, height: 15)
        body.addSubview(detail)
    }

    private static func heading(_ session: Session) -> NSAttributedString {
        let text = NSMutableAttributedString(
            string: session.state.rawValue,
            attributes: [.foregroundColor: session.state.colour,
                         .font: NSFont.systemFont(ofSize: 12, weight: .bold)])
        text.append(NSAttributedString(
            string: "  " + session.name,
            attributes: [.foregroundColor: NSColor.white,
                         .font: NSFont.systemFont(ofSize: 12, weight: .semibold)]))
        return text
    }

    private static func detail(_ session: Session) -> String {
        let where_ = (session.cwd as NSString).abbreviatingWithTildeInPath
        if session.state == .waiting, !session.detail.isEmpty {
            return session.detail + " · " + where_
        }
        return where_
    }

    private func label(_ font: NSFont) -> NSTextField {
        let field = NSTextField(labelWithString: "")
        field.font = font
        field.lineBreakMode = .byTruncatingTail
        field.isSelectable = false
        return field
    }

    private func dismiss() {
        timer?.invalidate()
        timer = nil
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.2
            panel.animator().alphaValue = 0
        } completionHandler: { [weak self] in
            guard let self else { return }
            self.panel.close()
            Toast.live.removeAll { $0 === self }
            Toast.layout()
        }
    }
}

private final class ClickView: NSView {
    var onClick: (() -> Void)?

    override func mouseDown(with event: NSEvent) {
        onClick?()
    }
}
