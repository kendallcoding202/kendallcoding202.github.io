import Foundation

/// A single device discovered on the local network.
struct DiscoveredDevice: Identifiable, Equatable {
    /// The IPv4 address doubles as a stable identity for the scan session.
    var id: String { ipAddress }

    var ipAddress: String
    var hostname: String?
    var bonjourName: String?
    var services: [BonjourService]
    var openPorts: [PortInfo]
    var isRouter: Bool
    var isSelf: Bool
    var firstSeen: Date
    /// Set during reconciliation when this device was not in the known store.
    var isNew: Bool

    init(
        ipAddress: String,
        hostname: String? = nil,
        bonjourName: String? = nil,
        services: [BonjourService] = [],
        openPorts: [PortInfo] = [],
        isRouter: Bool = false,
        isSelf: Bool = false,
        firstSeen: Date = Date(),
        isNew: Bool = false
    ) {
        self.ipAddress = ipAddress
        self.hostname = hostname
        self.bonjourName = bonjourName
        self.services = services
        self.openPorts = openPorts
        self.isRouter = isRouter
        self.isSelf = isSelf
        self.firstSeen = firstSeen
        self.isNew = isNew
    }

    /// A best-effort stable identity across scans. IPs churn with DHCP, so we
    /// prefer a Bonjour or DNS name when one is available and fall back to IP.
    var identityKey: String {
        if let bonjourName, !bonjourName.isEmpty { return "name:" + bonjourName.lowercased() }
        if let hostname, !hostname.isEmpty { return "host:" + hostname.lowercased() }
        return "ip:" + ipAddress
    }

    /// Best available human-friendly name for the device.
    var displayName: String {
        if let bonjourName, !bonjourName.isEmpty { return bonjourName }
        if let hostname, !hostname.isEmpty { return hostname }
        if isRouter { return "Router" }
        if isSelf { return "This Device" }
        return ipAddress
    }

    /// Best guess of the device kind from its ports and advertised services.
    var deviceType: DeviceType { DeviceType.classify(self) }

    /// SF Symbol for the device, driven by the inferred device type.
    var iconName: String { deviceType.symbol }

    /// Numeric form of the address for correct ordering (1.1.1.9 before 1.1.1.10).
    var sortKey: UInt32 { IPMath.toUInt32(ipAddress) ?? 0 }
}

/// A Bonjour/mDNS service advertised by a device.
struct BonjourService: Equatable, Hashable, Identifiable {
    var id: String { type + name }
    var name: String
    /// The raw Bonjour service type, e.g. `_airplay._tcp`.
    var type: String

    var category: ServiceCategory { ServiceCategory(rawType: type) }
}

/// A TCP port found open on a device, with a best-guess service label.
struct PortInfo: Identifiable, Equatable, Hashable {
    let port: Int
    var serviceName: String
    var id: Int { port }
}
