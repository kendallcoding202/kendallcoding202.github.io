import Foundation

/// Measures download and upload throughput and latency against Cloudflare's
/// public speed-test endpoints (`speed.cloudflare.com`).
@MainActor
final class SpeedTest: ObservableObject {
    enum Phase: String {
        case idle = "Idle"
        case latency = "Measuring latency…"
        case download = "Testing download…"
        case upload = "Testing upload…"
        case done = "Done"
    }

    @Published private(set) var phase: Phase = .idle
    @Published private(set) var downloadMbps: Double?
    @Published private(set) var uploadMbps: Double?
    @Published private(set) var latencyMs: Double?
    @Published private(set) var liveMbps: Double = 0
    @Published private(set) var errorText: String?
    @Published private(set) var isRunning = false

    private var task: Task<Void, Never>?
    private let downloadBytes = 25_000_000   // 25 MB
    private let uploadBytes = 10_000_000     // 10 MB

    func start() {
        guard !isRunning else { return }
        isRunning = true
        errorText = nil
        downloadMbps = nil
        uploadMbps = nil
        latencyMs = nil
        liveMbps = 0
        task = Task { await run() }
    }

    func stop() {
        task?.cancel()
        isRunning = false
        phase = .idle
    }

    private func run() async {
        do {
            phase = .latency
            latencyMs = try await measureLatency()

            phase = .download
            downloadMbps = try await measureDownload()
            liveMbps = 0

            phase = .upload
            uploadMbps = try await measureUpload()
            liveMbps = 0

            phase = .done
        } catch is CancellationError {
            phase = .idle
        } catch {
            errorText = "Speed test failed. Check your connection and try again."
            phase = .idle
        }
        isRunning = false
    }

    private func measureLatency() async throws -> Double {
        var best = Double.greatestFiniteMagnitude
        let url = URL(string: "https://speed.cloudflare.com/__down?bytes=0")!
        for _ in 0..<5 {
            try Task.checkCancellation()
            let start = DispatchTime.now()
            var request = URLRequest(url: url)
            request.cachePolicy = .reloadIgnoringLocalCacheData
            _ = try await URLSession.shared.data(for: request)
            let ms = Double(DispatchTime.now().uptimeNanoseconds - start.uptimeNanoseconds) / 1_000_000
            best = min(best, ms)
        }
        return best
    }

    private func measureDownload() async throws -> Double {
        let url = URL(string: "https://speed.cloudflare.com/__down?bytes=\(downloadBytes)")!
        let meter = ThroughputMeter()
        meter.onProgress = { [weak self] mbps in
            Task { @MainActor in self?.liveMbps = mbps }
        }
        return try await meter.download(url: url)
    }

    private func measureUpload() async throws -> Double {
        let url = URL(string: "https://speed.cloudflare.com/__up")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
        let payload = Data(count: uploadBytes)

        let start = DispatchTime.now()
        _ = try await URLSession.shared.upload(for: request, from: payload)
        let seconds = Double(DispatchTime.now().uptimeNanoseconds - start.uptimeNanoseconds) / 1_000_000_000
        return seconds > 0 ? (Double(uploadBytes) * 8 / seconds) / 1_000_000 : 0
    }
}

/// Delegate-based downloader that reports throughput as data arrives without the
/// per-byte overhead of iterating `URLSession.AsyncBytes`.
private final class ThroughputMeter: NSObject, URLSessionDataDelegate {
    var onProgress: ((Double) -> Void)?

    private var totalBytes = 0
    private var startTime = DispatchTime.now()
    private var lastReport = DispatchTime.now()
    private var continuation: CheckedContinuation<Double, Error>?

    func download(url: URL) async throws -> Double {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Double, Error>) in
            self.continuation = continuation
            let config = URLSessionConfiguration.ephemeral
            config.requestCachePolicy = .reloadIgnoringLocalCacheData
            let session = URLSession(configuration: config, delegate: self, delegateQueue: nil)
            startTime = DispatchTime.now()
            lastReport = startTime
            session.dataTask(with: url).resume()
        }
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        totalBytes += data.count
        let now = DispatchTime.now()
        if now.uptimeNanoseconds - lastReport.uptimeNanoseconds > 150_000_000 {
            let seconds = Double(now.uptimeNanoseconds - startTime.uptimeNanoseconds) / 1_000_000_000
            if seconds > 0 { onProgress?((Double(totalBytes) * 8 / seconds) / 1_000_000) }
            lastReport = now
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        defer { session.invalidateAndCancel() }
        if let error {
            continuation?.resume(throwing: error)
        } else {
            let seconds = Double(DispatchTime.now().uptimeNanoseconds - startTime.uptimeNanoseconds) / 1_000_000_000
            let mbps = seconds > 0 ? (Double(totalBytes) * 8 / seconds) / 1_000_000 : 0
            continuation?.resume(returning: mbps)
        }
        continuation = nil
    }
}
