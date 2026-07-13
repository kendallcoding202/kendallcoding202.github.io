import Foundation

/// Friendly categorisation of Bonjour service types so the UI can show a
/// meaningful label and icon instead of a raw `_raop._tcp` string.
enum ServiceCategory: Equatable {
    case airplay
    case chromecast
    case printer
    case fileSharing
    case remoteAccess
    case web
    case media
    case homeAutomation
    case appleDevice
    case other(String)

    init(rawType: String) {
        switch rawType {
        case "_airplay._tcp", "_raop._tcp", "_airport._tcp":
            self = .airplay
        case "_googlecast._tcp":
            self = .chromecast
        case "_ipp._tcp", "_ipps._tcp", "_printer._tcp", "_pdl-datastream._tcp", "_scanner._tcp":
            self = .printer
        case "_smb._tcp", "_afpovertcp._tcp", "_nfs._tcp", "_webdav._tcp":
            self = .fileSharing
        case "_ssh._tcp", "_sftp-ssh._tcp", "_rfb._tcp", "_telnet._tcp":
            self = .remoteAccess
        case "_http._tcp", "_https._tcp":
            self = .web
        case "_daap._tcp", "_dacp._tcp", "_spotify-connect._tcp", "_plexmediasvr._tcp":
            self = .media
        case "_homekit._tcp", "_hap._tcp", "_hue._tcp", "_homeassistant._tcp":
            self = .homeAutomation
        case "_companion-link._tcp", "_device-info._tcp", "_apple-mobdev2._tcp", "_touch-able._tcp":
            self = .appleDevice
        default:
            self = .other(Self.prettify(rawType))
        }
    }

    var label: String {
        switch self {
        case .airplay: return "AirPlay"
        case .chromecast: return "Chromecast"
        case .printer: return "Printer"
        case .fileSharing: return "File Sharing"
        case .remoteAccess: return "Remote Access"
        case .web: return "Web Server"
        case .media: return "Media"
        case .homeAutomation: return "Smart Home"
        case .appleDevice: return "Apple Device"
        case .other(let name): return name
        }
    }

    var symbol: String? {
        switch self {
        case .airplay: return "airplayvideo"
        case .chromecast: return "tv"
        case .printer: return "printer"
        case .fileSharing: return "externaldrive.connected.to.line.below"
        case .remoteAccess: return "terminal"
        case .web: return "globe"
        case .media: return "play.rectangle"
        case .homeAutomation: return "homekit"
        case .appleDevice: return "applelogo"
        case .other: return nil
        }
    }

    /// Turns `_spotify-connect._tcp` into "Spotify Connect".
    private static func prettify(_ rawType: String) -> String {
        var base = rawType
        for suffix in ["._tcp", "._udp"] where base.hasSuffix(suffix) {
            base = String(base.dropLast(suffix.count))
        }
        if base.hasPrefix("_") { base = String(base.dropFirst()) }
        return base
            .split(whereSeparator: { $0 == "-" || $0 == "_" })
            .map { $0.prefix(1).uppercased() + $0.dropFirst() }
            .joined(separator: " ")
    }
}
