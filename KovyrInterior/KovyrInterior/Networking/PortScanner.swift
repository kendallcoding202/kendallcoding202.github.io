import Foundation

/// One open port with an optional grabbed banner / TLS cert detail.
struct PortFinding: Identifiable, Equatable {
    let port: Int
    let serviceName: String
    var detail: String?
    var id: Int { port }
}

/// How wide to scan a host (personal build unlocks the full range).
enum ScanDepth: String, CaseIterable, Identifiable {
    case common   = "Common"
    case extended = "Extended"
    case full     = "Full"
    var id: String { rawValue }

    var subtitle: String {
        switch self {
        case .common:   return "~60 well-known ports (fast)"
        case .extended: return "Ports 1–1024 (slower)"
        case .full:     return "All 65,535 ports (can take minutes)"
        }
    }

    var ports: [UInt16] {
        switch self {
        case .common:   return PortCatalog.commonPorts.map { $0.port }
        case .extended: return Array(1...1024)
        case .full:     return Array(1...65535)
        }
    }

    var concurrency: Int {
        switch self {
        case .common:   return 32
        case .extended: return 96
        case .full:     return 128
        }
    }

    var timeout: TimeInterval {
        switch self {
        case .common:   return 1.5
        case .extended: return 1.0
        case .full:     return 0.7
        }
    }
}

/// On-demand detailed TCP port scan of a single host, backed by `HostProbe`,
/// with optional banner / TLS-certificate enrichment of the ports it finds open.
@MainActor
final class PortScanner: ObservableObject {
    @Published private(set) var findings: [PortFinding] = []
    @Published private(set) var isScanning = false
    @Published private(set) var progress: Double = 0
    @Published private(set) var statusText = ""

    private var task: Task<Void, Never>?

    func scan(host: String, depth: ScanDepth) {
        guard !isScanning else { return }
        task = Task { await run(host: host, depth: depth) }
    }

    func cancel() {
        task?.cancel()
        isScanning = false
    }

    private func run(host: String, depth: ScanDepth) async {
        isScanning = true
        findings = []
        progress = 0
        let ports = depth.ports
        let total = max(ports.count, 1)
        statusText = "Scanning \(total.formatted()) ports…"
        var completed = 0

        for chunk in ports.chunked(into: depth.concurrency) {
            if Task.isCancelled { break }
            let timeout = depth.timeout
            await withTaskGroup(of: PortFinding?.self) { group in
                for port in chunk {
                    group.addTask {
                        let result = await HostProbe.probe(host: host, port: port, timeout: timeout)
                        guard result == .open else { return nil }
                        return PortFinding(port: Int(port), serviceName: PortCatalog.serviceName(for: Int(port)))
                    }
                }
                for await found in group {
                    completed += 1
                    progress = Double(completed) / Double(total)
                    if let found {
                        findings.append(found)
                        findings.sort { $0.port < $1.port }
                    }
                }
            }
        }

        if Task.isCancelled { isScanning = false; return }

        // Enrich open ports with banners / TLS cert subjects.
        statusText = "Reading service banners…"
        await enrich(host: host)

        statusText = findings.isEmpty
            ? "No open ports found"
            : "\(findings.count) open port\(findings.count == 1 ? "" : "s")"
        progress = 1
        isScanning = false
    }

    /// Grabs a banner (or TLS cert subject) for each open port, a few at a time.
    private func enrich(host: String) async {
        let ports = findings.map { UInt16($0.port) }
        for chunk in ports.chunked(into: 8) {
            if Task.isCancelled { return }
            await withTaskGroup(of: (Int, String?).self) { group in
                for port in chunk {
                    group.addTask {
                        let detail = TLSInspector.tlsPorts.contains(port)
                            ? await TLSInspector.inspect(host: host, port: port)
                            : await BannerGrabber.grab(host: host, port: port)
                        return (Int(port), detail)
                    }
                }
                for await (port, detail) in group {
                    if let detail, let idx = findings.firstIndex(where: { $0.port == port }) {
                        findings[idx].detail = detail
                    }
                }
            }
        }
    }
}
