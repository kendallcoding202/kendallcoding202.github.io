import Foundation

/// Builds shareable CSV / JSON exports of a completed scan (device inventory plus
/// the local, public, and Wi-Fi network context). Personal build only — a plain
/// local export via the share sheet; no data leaves the device unless the user
/// chooses a destination in the share sheet.
enum ScanExport {
    struct Context {
        var date: Date
        var local: LocalNetwork?
        var publicNet: PublicNetwork?
        var wifi: WiFiNetwork?
        var devices: [DiscoveredDevice]
    }

    // MARK: CSV

    static func csv(_ ctx: Context) -> String {
        var lines: [String] = []
        lines.append("Kovyr Interior — network scan")
        lines.append("Scanned at,\(iso(ctx.date))")
        if let l = ctx.local {
            lines.append("Local IP,\(l.ipAddress)")
            lines.append("Subnet,\(l.cidr)")
            lines.append("Gateway,\(l.gatewayGuess)")
        }
        if let p = ctx.publicNet {
            lines.append("Public IP,\(p.ipAddress)\(p.countryCode.map { " (\($0))" } ?? "")")
        }
        if let w = ctx.wifi {
            lines.append("Wi-Fi SSID,\(field(w.ssid))")
            if let b = w.bssid { lines.append("Wi-Fi BSSID,\(b)") }
            lines.append("Wi-Fi signal,\(Int((w.signalStrength * 100).rounded()))%")
        }
        lines.append("")
        lines.append("Name,IP,Type,Role,Hostname,Bonjour,Open Ports,Services")
        for d in ctx.devices.sorted(by: { $0.sortKey < $1.sortKey }) {
            let role = d.isRouter ? "Router" : (d.isSelf ? "This device" : "")
            let ports = d.openPorts.map { String($0.port) }.joined(separator: " ")
            let services = d.services.map { $0.type }.joined(separator: " ")
            let cols = [d.displayName, d.ipAddress, d.deviceType.label, role,
                        d.hostname ?? "", d.bonjourName ?? "", ports, services]
            lines.append(cols.map(field).joined(separator: ","))
        }
        return lines.joined(separator: "\n")
    }

    // MARK: JSON

    private struct Snapshot: Encodable {
        struct Net: Encodable { var localIP, subnet, gateway, publicIP, country, wifiSSID, wifiBSSID: String? }
        struct Dev: Encodable {
            var name, ip, type: String
            var isRouter, isSelf, isNew: Bool
            var hostname, bonjourName: String?
            var openPorts: [Int]
            var services: [String]
        }
        var app = "Kovyr Interior"
        var scannedAt: String
        var deviceCount: Int
        var network: Net
        var devices: [Dev]
    }

    static func json(_ ctx: Context) -> Data? {
        let net = Snapshot.Net(
            localIP: ctx.local?.ipAddress,
            subnet: ctx.local?.cidr,
            gateway: ctx.local?.gatewayGuess,
            publicIP: ctx.publicNet?.ipAddress,
            country: ctx.publicNet?.countryCode,
            wifiSSID: ctx.wifi?.ssid,
            wifiBSSID: ctx.wifi?.bssid
        )
        let devices = ctx.devices.sorted { $0.sortKey < $1.sortKey }.map { d in
            Snapshot.Dev(
                name: d.displayName, ip: d.ipAddress, type: d.deviceType.label,
                isRouter: d.isRouter, isSelf: d.isSelf, isNew: d.isNew,
                hostname: d.hostname, bonjourName: d.bonjourName,
                openPorts: d.openPorts.map(\.port),
                services: d.services.map(\.type)
            )
        }
        let snap = Snapshot(scannedAt: iso(ctx.date), deviceCount: ctx.devices.count,
                            network: net, devices: devices)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        return try? encoder.encode(snap)
    }

    // MARK: Temp files for the share sheet

    enum Format { case csv, json }

    /// Writes the export to a temp file and returns its URL (nil on failure).
    static func writeTempFile(_ ctx: Context, format: Format) -> URL? {
        let stamp = fileStamp(ctx.date)
        switch format {
        case .csv:
            let url = FileManager.default.temporaryDirectory
                .appendingPathComponent("kovyr-scan-\(stamp).csv")
            guard let data = csv(ctx).data(using: .utf8) else { return nil }
            return (try? data.write(to: url)) == nil ? nil : url
        case .json:
            let url = FileManager.default.temporaryDirectory
                .appendingPathComponent("kovyr-scan-\(stamp).json")
            guard let data = json(ctx) else { return nil }
            return (try? data.write(to: url)) == nil ? nil : url
        }
    }

    // MARK: Helpers

    /// Escapes a CSV field, quoting when it contains a comma, quote, or newline.
    private static func field(_ s: String) -> String {
        guard s.contains(where: { $0 == "," || $0 == "\"" || $0 == "\n" || $0 == "\r" }) else { return s }
        return "\"" + s.replacingOccurrences(of: "\"", with: "\"\"") + "\""
    }

    private static func iso(_ date: Date) -> String {
        let f = ISO8601DateFormatter()
        return f.string(from: date)
    }

    /// A filename-safe timestamp like `2026-07-22-1435`.
    private static func fileStamp(_ date: Date) -> String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd-HHmm"
        f.locale = Locale(identifier: "en_US_POSIX")
        return f.string(from: date)
    }
}
