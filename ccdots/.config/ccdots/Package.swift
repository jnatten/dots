// swift-tools-version:6.2
import PackageDescription

// v14 rather than the host's v26: nothing here needs a recent API, and the
// committed bundle should still run on an older Mac
let package = Package(
    name: "ccdots",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(name: "ccdots", swiftSettings: [.swiftLanguageMode(.v5)])
    ]
)
