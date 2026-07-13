import Foundation

/// On-demand detailed TCP port scan of a single host, backed by `HostProbe`.
@MainActor
final class PortScanner: ObservableObject {
    @Published private(set) var openPorts: [PortInfo] = []
    @Published private(set) var isScanning = false
    @Published private(set) var progress: Double = 0
    @Published private(set) var statusText = ""

    private var task: Task<Void, Never>?
    private let timeout: TimeInterval = 1.5
    private let concurrency = 32

    func scan(host: String) {
        guard !isScanning else { return }
        task = Task { await run(host: host) }
    }

    func cancel() {
        task?.cancel()
        isScanning = false
    }

    private func run(host: String) async {
        isScanning = true
        openPorts = []
        progress = 0
        statusText = "Scanning \(PortCatalog.commonPorts.count) common ports…"

        let ports = PortCatalog.commonPorts
        let total = max(ports.count, 1)
        var completed = 0

        for chunk in ports.chunked(into: concurrency) {
            if Task.isCancelled { break }
            let timeout = self.timeout
            await withTaskGroup(of: PortInfo?.self) { group in
                for entry in chunk {
                    group.addTask {
                        let result = await HostProbe.probe(host: host, port: entry.port, timeout: timeout)
                        return result == .open ? PortInfo(port: Int(entry.port), serviceName: entry.name) : nil
                    }
                }
                for await found in group {
                    completed += 1
                    progress = Double(completed) / Double(total)
                    if let found {
                        openPorts.append(found)
                        openPorts.sort { $0.port < $1.port }
                    }
                }
            }
        }

        if !Task.isCancelled {
            statusText = openPorts.isEmpty
                ? "No open ports found"
                : "\(openPorts.count) open port\(openPorts.count == 1 ? "" : "s")"
            progress = 1
        }
        isScanning = false
    }
}
