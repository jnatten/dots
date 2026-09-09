import Foundation

enum Shell {
    struct Output {
        let status: Int32
        let stdout: String
        let stderr: String
        let failed: Bool
    }

    @discardableResult
    static func tmux(_ arguments: [String], timeout: TimeInterval = 2) -> Output {
        run("/usr/bin/env", ["tmux"] + arguments, timeout: timeout)
    }

    static func run(_ path: String, _ arguments: [String] = [], timeout: TimeInterval) -> Output {
        let task = Process()
        task.executableURL = URL(fileURLWithPath: path)
        task.arguments = arguments
        task.environment = environment

        let out = Pipe()
        let err = Pipe()
        task.standardOutput = out
        task.standardError = err

        do {
            try task.run()
        } catch {
            return Output(status: -1, stdout: "", stderr: "\(error)", failed: true)
        }

        // Both pipes get drained, and concurrently: a script that filled the
        // stderr buffer while we blocked on stdout would never get to exit
        let collected = Collector()
        let drained = DispatchSemaphore(value: 0)
        DispatchQueue.global().async {
            collected.take(err.fileHandleForReading.readDataToEndOfFile())
            drained.signal()
        }
        let killer = DispatchWorkItem {
            collected.timedOut = true
            task.terminate()
        }
        DispatchQueue.global().asyncAfter(deadline: .now() + timeout, execute: killer)

        let stdout = out.fileHandleForReading.readDataToEndOfFile()
        task.waitUntilExit()
        killer.cancel()
        _ = drained.wait(timeout: .now() + 0.5)

        return Output(status: task.terminationStatus,
                      stdout: String(decoding: stdout, as: UTF8.self),
                      stderr: String(decoding: collected.data, as: UTF8.self),
                      failed: collected.timedOut || task.terminationStatus != 0)
    }

    // launchd hands an agent a PATH with no homebrew in it, which is where both
    // tmux and jq live
    private static var environment: [String: String] {
        var environment = ProcessInfo.processInfo.environment
        let path = environment["PATH"] ?? "/usr/bin:/bin"
        if !path.split(separator: ":").contains("/opt/homebrew/bin") {
            environment["PATH"] = "/opt/homebrew/bin:" + path
        }
        return environment
    }

    private final class Collector {
        private let lock = NSLock()
        private var buffer = Data()
        private var expired = false

        func take(_ data: Data) {
            lock.lock(); buffer = data; lock.unlock()
        }

        var data: Data {
            lock.lock(); defer { lock.unlock() }; return buffer
        }

        var timedOut: Bool {
            get { lock.lock(); defer { lock.unlock() }; return expired }
            set { lock.lock(); expired = newValue; lock.unlock() }
        }
    }
}
