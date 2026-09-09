import AppKit

enum Dots {
    struct Slot {
        let lit: Bool
        let unseen: Bool
        let colour: NSColor
    }

    // Drawn rather than set as an attributed title: a background-colour run
    // paints a square block, and the unseen marker in the tmux bar is a capsule
    static func image(_ slots: [Slot]) -> NSImage {
        let height = min(18, NSStatusBar.system.thickness - 6)
        let dot: CGFloat = 7
        let pad: CGFloat = 4
        let gap: CGFloat = 5
        let widths = slots.map { $0.unseen ? dot + pad * 2 : dot }
        let width = widths.reduce(0, +) + gap * CGFloat(max(slots.count - 1, 0))

        let image = NSImage(size: NSSize(width: width, height: height), flipped: false) { _ in
            var x: CGFloat = 0
            for (slot, slotWidth) in zip(slots, widths) {
                let middle = height / 2
                if slot.unseen {
                    let pill = NSRect(x: x, y: 1, width: slotWidth, height: height - 2)
                    slot.colour.setFill()
                    NSBezierPath(roundedRect: pill,
                                 xRadius: pill.height / 2,
                                 yRadius: pill.height / 2).fill()
                    Palette.deep.setFill()
                    NSBezierPath(ovalIn: NSRect(x: x + pad, y: middle - dot / 2,
                                                width: dot, height: dot)).fill()
                } else {
                    // An empty state keeps its slot, dimmed, so the dots never
                    // shift about
                    (slot.lit ? slot.colour : Palette.dim).setFill()
                    NSBezierPath(ovalIn: NSRect(x: x, y: middle - dot / 2,
                                                width: dot, height: dot)).fill()
                }
                x += slotWidth + gap
            }
            return true
        }
        image.isTemplate = false
        return image
    }
}
