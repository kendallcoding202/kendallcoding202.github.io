import Foundation

/// Widget-side copy of the shared App Group bridge. Kept identical to the app's
/// `SharedState` so both targets read/write the same keys and group id.
///
/// IMPORTANT: the App Group identifier below must match the app's and be enabled
/// on both targets' Signing & Capabilities.
enum SharedState {
    static let appGroup = "group.com.example.NetScan"

    private static var defaults: UserDefaults? { UserDefaults(suiteName: appGroup) }

    struct Summary {
        var deviceCount: Int
        var newCount: Int
        var lastScan: Date?
    }

    static func save(deviceCount: Int, newCount: Int, date: Date) {
        guard let defaults else { return }
        defaults.set(deviceCount, forKey: Keys.deviceCount)
        defaults.set(newCount, forKey: Keys.newCount)
        defaults.set(date.timeIntervalSince1970, forKey: Keys.lastScan)
    }

    static func load() -> Summary {
        guard let defaults else { return Summary(deviceCount: 0, newCount: 0, lastScan: nil) }
        let timestamp = defaults.double(forKey: Keys.lastScan)
        return Summary(
            deviceCount: defaults.integer(forKey: Keys.deviceCount),
            newCount: defaults.integer(forKey: Keys.newCount),
            lastScan: timestamp > 0 ? Date(timeIntervalSince1970: timestamp) : nil
        )
    }

    private enum Keys {
        static let deviceCount = "deviceCount"
        static let newCount = "newCount"
        static let lastScan = "lastScan"
    }
}
