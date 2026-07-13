import Foundation

/// Heuristically flags devices that look like IP cameras by scanning the subnet
/// for camera-specific ports/protocols (RTSP and common DVR/NVR vendor ports).
///
/// This is a fingerprint, not a guarantee — the same signals Fing uses. A hit
/// means "this device exposes camera-like services", which is worth a look.
@MainActor
final class CameraFinder: ObservableObject {
    struct Candidate: Identifiable {
        let id: String        // ip
        let ip: String
        let openPorts: [PortInfo]
        let confidence: Confidence

        enum Confidence: String { case high = "Likely camera", medium = "Possible camera" }
    }

    @Published private(set) var candidates: [Candidate] = []
    @Published private(set) var isScanning = false
    @Published private(set) var progress: Double = 0
    @Published private(set) var statusText = "Scan the network for camera-like devices."

    private var task: Task<Void, Never>?
    private let timeout: TimeInterval = 1.5
    private let concurrency = 40

    /// Ports strongly associated with IP cameras / DVRs / NVRs.
    private let cameraPorts: [(port: UInt16, name: String)] = [
        (554, "RTSP"), (8554, "RTSP Alt"), (8000, "Hikvision"), (8200, "Hikvision"),
        (37777, "Dahua"), (34567, "DVR (Sofia)"), (9000, "DVR"), (88, "ONVIF"),
        (8899, "DVR"), (10554, "RTSP Alt"), (5000, "ONVIF/UPnP")
    ]
    /// A hit on one of these alone is a strong signal.
    private let highConfidencePorts: Set<UInt16> = [554, 8554, 37777, 34567, 8899, 10554]

    func scan() {
        guard !isScanning else { return }
        task = Task { await run() }
    }

    func cancel() {
        task?.cancel()
        isScanning = false
    }

    private func run() async {
        isScanning = true
        candidates = []
        progress = 0

        guard let network = LocalNetworkInfo.current() else {
            statusText = "Not connected to Wi-Fi"
            isScanning = false
            return
        }
        statusText = "Scanning for cameras…"

        let hosts = network.hostAddresses
        let total = max(hosts.count, 1)
        var completed = 0
        let ports = cameraPorts
        let highPorts = highConfidencePorts
        let timeout = self.timeout

        for chunk in hosts.chunked(into: concurrency) {
            if Task.isCancelled { break }
            await withTaskGroup(of: Candidate?.self) { group in
                for ip in chunk {
                    group.addTask {
                        var open: [PortInfo] = []
                        for entry in ports {
                            if Task.isCancelled { break }
                            let result = await HostProbe.probe(host: ip, port: entry.port, timeout: timeout)
                            if result == .open {
                                open.append(PortInfo(port: Int(entry.port), serviceName: entry.name))
                            }
                        }
                        guard !open.isEmpty else { return nil }
                        let strong = open.contains { highPorts.contains(UInt16($0.port)) }
                        return Candidate(
                            id: ip,
                            ip: ip,
                            openPorts: open.sorted { $0.port < $1.port },
                            confidence: strong ? .high : .medium
                        )
                    }
                }
                for await candidate in group {
                    completed += 1
                    progress = Double(completed) / Double(total)
                    if let candidate {
                        candidates.append(candidate)
                        candidates.sort { $0.confidence == .high && $1.confidence != .high }
                    }
                }
            }
        }

        if !Task.isCancelled {
            statusText = candidates.isEmpty
                ? "No camera-like devices found."
                : "\(candidates.count) camera-like device\(candidates.count == 1 ? "" : "s") found."
            progress = 1
        }
        isScanning = false
    }
}
