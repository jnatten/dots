// The dots have to match the tmux status bar, so the colours are copied from
// ~/.tmux/conf/statusbar.conf rather than read back out of tmux, which would
// mean a round trip for six constants that never change
import AppKit

enum Palette {
    static let deep = srgb(0x0d_11_17)
    static let dim = srgb(0x6e_76_81)
    static let blue = srgb(0x58_a6_ff)
    static let green = srgb(0x3f_b9_50)
    static let orange = srgb(0xf0_88_3e)

    private static func srgb(_ rgb: Int) -> NSColor {
        NSColor(srgbRed: CGFloat((rgb >> 16) & 0xff) / 255,
                green: CGFloat((rgb >> 8) & 0xff) / 255,
                blue: CGFloat(rgb & 0xff) / 255,
                alpha: 1)
    }
}

extension State {
    var colour: NSColor {
        switch self {
        case .waiting: return Palette.blue
        case .idle: return Palette.green
        case .working: return Palette.orange
        }
    }
}
