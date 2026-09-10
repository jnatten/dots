import Foundation

enum State: String, CaseIterable {
    case working, waiting, idle

    // waiting first, then idle: working is the one state that asks nothing of you
    var rank: Int {
        switch self {
        case .waiting: return 0
        case .idle: return 1
        case .working: return 2
        }
    }
}

// One row of sessions.sh output
struct Session {
    let pane: String
    let state: State
    let unseen: Bool
    let sessionName: String
    let windowIndex: String
    let paneIndex: String
    let windowName: String
    let pid: String
    let changed: TimeInterval
    let name: String
    let detail: String
    let cwd: String

    var location: String { "\(sessionName):\(windowIndex).\(paneIndex)" }

    static func parse(_ tsv: String) -> [Session] {
        tsv.split(separator: "\n").compactMap { line in
            let field = line.split(separator: "\t", omittingEmptySubsequences: false).map(String.init)
            // A short row means sessions.sh has changed shape, and dropping it
            // beats mapping the columns onto the wrong fields
            guard field.count == 13, let state = State(rawValue: field[1]) else { return nil }
            return Session(pane: field[0],
                           state: state,
                           unseen: field[2] == "1" && state != .working,
                           sessionName: field[3],
                           windowIndex: field[4],
                           paneIndex: field[5],
                           windowName: field[7],
                           pid: field[8],
                           changed: TimeInterval(field[9]) ?? 0,
                           name: field[10],
                           detail: field[11],
                           cwd: field[12])
        }
    }

    // picker.sh's order: unseen, then by state, then longest since the change
    static func order(_ a: Session, _ b: Session) -> Bool {
        if a.unseen != b.unseen { return a.unseen }
        if a.state.rank != b.state.rank { return a.state.rank < b.state.rank }
        return a.changed < b.changed
    }
}
