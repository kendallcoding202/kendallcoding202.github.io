import Foundation

/// A best-effort guess of what kind of device an IP is, inferred from its open
/// ports and advertised Bonjour services. Fingerprint-based — a hint, not a
/// certainty, since iOS denies us MAC/OUI data.
enum DeviceType: String {
    case router
    case thisDevice
    case phone
    case computer
    case printer
    case tv
    case camera
    case nas
    case smartHome
    case mediaServer
    case unknown

    var label: String {
        switch self {
        case .router: return "Router"
        case .thisDevice: return "This Device"
        case .phone: return "Phone / Tablet"
        case .computer: return "Computer"
        case .printer: return "Printer"
        case .tv: return "TV / Streamer"
        case .camera: return "Camera"
        case .nas: return "Network Storage"
        case .smartHome: return "Smart Home"
        case .mediaServer: return "Media Server"
        case .unknown: return "Device"
        }
    }

    var symbol: String {
        switch self {
        case .router: return "wifi.router"
        case .thisDevice: return "iphone"
        case .phone: return "iphone"
        case .computer: return "desktopcomputer"
        case .printer: return "printer"
        case .tv: return "tv"
        case .camera: return "video"
        case .nas: return "externaldrive.connected.to.line.below"
        case .smartHome: return "homekit"
        case .mediaServer: return "play.rectangle.on.rectangle"
        case .unknown: return "network"
        }
    }

    static func classify(_ device: DiscoveredDevice) -> DeviceType {
        if device.isRouter { return .router }
        if device.isSelf { return .thisDevice }

        let ports = Set(device.openPorts.map { $0.port })
        func has(_ category: ServiceCategory) -> Bool {
            device.services.contains { $0.category == category }
        }

        if has(.printer) || ports.contains(9100) || ports.contains(515) || ports.contains(631) {
            return .printer
        }
        if ports.contains(554) || ports.contains(8554) || ports.contains(37777) || ports.contains(34567) {
            return .camera
        }
        if has(.airplay) || has(.chromecast) || ports.contains(8009) || ports.contains(7000) {
            return .tv
        }
        if ports.contains(32400) || has(.media) {
            return .mediaServer
        }
        if has(.fileSharing) || ports.contains(2049) || (ports.contains(445) && ports.contains(548)) {
            return .nas
        }
        if has(.homeAutomation) {
            return .smartHome
        }
        if ports.contains(62078) || has(.appleDevice) {
            return .phone
        }
        if ports.contains(3389) || ports.contains(5900) || ports.contains(22) || ports.contains(445) || has(.web) {
            return .computer
        }
        return .unknown
    }
}
