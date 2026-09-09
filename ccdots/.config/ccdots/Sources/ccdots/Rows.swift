import AppKit

enum Rows {
    private static let mono = NSFont.monospacedSystemFont(ofSize: NSFont.systemFontSize,
                                                          weight: .regular)
    private static let monoBold = NSFont.monospacedSystemFont(ofSize: NSFont.systemFontSize,
                                                              weight: .bold)

    static func title(_ session: Session, nameWidth: Int) -> NSAttributedString {
        let cell = ("0" as NSString).size(withAttributes: [.font: mono]).width
        let style = NSMutableParagraphStyle()
        // Tab stops rather than padded columns: the marker is not a monospaced
        // glyph, so spaces after it would drift every row by a fraction of one
        style.tabStops = [
            NSTextTab(textAlignment: .left, location: cell * 2),
            NSTextTab(textAlignment: .right, location: cell * 12),
            NSTextTab(textAlignment: .left, location: cell * 14),
            NSTextTab(textAlignment: .left, location: cell * CGFloat(15 + nameWidth)),
        ]

        let marker = session.unseen ? "●" : " "
        var row = "\(marker)\t\(session.state.rawValue)\t\(age(session.changed))\t"
        row += "\(fit(session.name, nameWidth))\t\(tilde(session.cwd))"
        // The cwd already says where a session is, so only a waiting one's
        // reason earns the space
        if session.state == .waiting, !session.detail.isEmpty {
            row += "  —  \(session.detail)"
        }

        let text = NSMutableAttributedString(string: row, attributes: [
            .font: session.unseen ? monoBold : mono,
            .foregroundColor: NSColor.labelColor,
            .paragraphStyle: style,
        ])
        let head = (row as NSString).range(of: marker + "\t" + session.state.rawValue)
        if head.location != NSNotFound {
            text.addAttribute(.foregroundColor, value: session.state.colour, range: head)
        }
        return text
    }

    static func age(_ changed: TimeInterval) -> String {
        guard changed > 0 else { return "?" }
        let seconds = max(0, Date().timeIntervalSince1970 - changed / 1000)
        if seconds < 60 { return "\(Int(seconds))s" }
        if seconds < 3600 { return "\(Int(seconds / 60))m" }
        if seconds < 86400 { return "\(Int(seconds / 3600))h" }
        return "\(Int(seconds / 86400))d"
    }

    private static func fit(_ text: String, _ width: Int) -> String {
        text.count > width ? String(text.prefix(max(width - 1, 1))) + "…" : text
    }

    private static func tilde(_ path: String) -> String {
        (path as NSString).abbreviatingWithTildeInPath
    }
}
