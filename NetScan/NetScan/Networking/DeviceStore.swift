import Foundation

/// A device NetScan has seen before, persisted across launches.
struct KnownDevice: Codable, Identifiable {
    var id: String            // identityKey
    var displayName: String
    var lastIP: String
    var firstSeen: Date
    var lastSeen: Date
}

/// A record of one completed scan, for the History tab.
struct ScanRecord: Codable, Identifiable {
    var id: String
    var date: Date
    var deviceCount: Int
    var newCount: Int
}

/// Persists known devices and scan history to JSON in Application Support, and
/// reconciles each scan against what's already known to detect new devices.
@MainActor
final class DeviceStore: ObservableObject {
    @Published private(set) var knownDevices: [KnownDevice] = []
    @Published private(set) var scanRecords: [ScanRecord] = []

    private let knownURL: URL
    private let historyURL: URL

    init() {
        let base = (try? FileManager.default.url(
            for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true
        )) ?? FileManager.default.temporaryDirectory
        knownURL = base.appendingPathComponent("known_devices.json")
        historyURL = base.appendingPathComponent("scan_history.json")
        load()
    }

    /// True until the very first scan has been recorded — used to avoid
    /// notifying about "new" devices when the store is being seeded.
    var hasBaseline: Bool { !knownDevices.isEmpty }

    /// Compares a finished scan against the known set. Returns the identity keys
    /// of devices that are new, updates the known set and appends a history row.
    @discardableResult
    func reconcile(_ devices: [DiscoveredDevice]) -> Set<String> {
        let seeding = !hasBaseline
        let now = Date()
        var known = Dictionary(uniqueKeysWithValues: knownDevices.map { ($0.id, $0) })
        var newKeys: Set<String> = []

        for device in devices where !device.isSelf {
            if var existing = known[device.identityKey] {
                existing.lastSeen = now
                existing.lastIP = device.ipAddress
                existing.displayName = device.displayName
                known[device.identityKey] = existing
            } else {
                if !seeding { newKeys.insert(device.identityKey) }
                known[device.identityKey] = KnownDevice(
                    id: device.identityKey,
                    displayName: device.displayName,
                    lastIP: device.ipAddress,
                    firstSeen: now,
                    lastSeen: now
                )
            }
        }

        knownDevices = known.values.sorted { $0.lastSeen > $1.lastSeen }
        scanRecords.insert(
            ScanRecord(id: UUID().uuidString, date: now, deviceCount: devices.count, newCount: newKeys.count),
            at: 0
        )
        if scanRecords.count > 100 { scanRecords.removeLast(scanRecords.count - 100) }

        save()
        return newKeys
    }

    func firstSeen(for device: DiscoveredDevice) -> Date? {
        knownDevices.first { $0.id == device.identityKey }?.firstSeen
    }

    func forgetAll() {
        knownDevices = []
        scanRecords = []
        save()
    }

    private func load() {
        let decoder = JSONDecoder()
        if let data = try? Data(contentsOf: knownURL),
           let decoded = try? decoder.decode([KnownDevice].self, from: data) {
            knownDevices = decoded
        }
        if let data = try? Data(contentsOf: historyURL),
           let decoded = try? decoder.decode([ScanRecord].self, from: data) {
            scanRecords = decoded
        }
    }

    private func save() {
        let encoder = JSONEncoder()
        encoder.outputFormatting = .prettyPrinted
        if let data = try? encoder.encode(knownDevices) {
            try? data.write(to: knownURL, options: .atomic)
        }
        if let data = try? encoder.encode(scanRecords) {
            try? data.write(to: historyURL, options: .atomic)
        }
    }
}
