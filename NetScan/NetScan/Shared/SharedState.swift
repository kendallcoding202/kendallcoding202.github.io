import Foundation

/// Small bridge between the app and its widget via a shared App Group
/// container. The app writes the latest scan summary; the widget reads it.
///
/// IMPORTANT: the App Group capability with this identifier must be enabled on
/// BOTH the app and widget targets (Signing & Capabilities). Change the value
/// here and in both `.entitlements` files if you use a different group id.
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
