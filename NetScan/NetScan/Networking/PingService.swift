import Foundation

/// Repeatedly pings a host and publishes rolling round-trip-time statistics for
/// the Ping tool. Runs the blocking ICMP calls on a background task.
@MainActor
final class PingService: ObservableObject {
    struct Sample: Identifiable {
        let id: Int
        let rttMs: Double?   // nil == timed out
    }

    @Published private(set) var samples: [Sample] = []
    @Published private(set) var isRunning = false
    @Published private(set) var resolvedHost: String = ""
    @Published private(set) var errorText: String?

    private var task: Task<Void, Never>?
    private let timeout: TimeInterval = 2.0

    var sent: Int { samples.count }
    var received: Int { samples.filter { $0.rttMs != nil }.count }
    var lossPercent: Double { sent == 0 ? 0 : Double(sent - received) / Double(sent) * 100 }

    var minRtt: Double? { samples.compactMap { $0.rttMs }.min() }
    var maxRtt: Double? { samples.compactMap { $0.rttMs }.max() }
    var avgRtt: Double? {
        let values = samples.compactMap { $0.rttMs }
        guard !values.isEmpty else { return nil }
        return values.reduce(0, +) / Double(values.count)
    }

    func start(host: String) {
        guard !isRunning else { return }
        samples = []
        errorText = nil
        resolvedHost = host
        isRunning = true
        task = Task { await run(host: host) }
    }

    func stop() {
        task?.cancel()
        isRunning = false
    }

    private func run(host: String) async {
        // Resolve a hostname to an IP once up front.
        let ip = await Self.resolve(host: host)
        guard let ip else {
            errorText = "Could not resolve \(host)"
            isRunning = false
            return
        }
        resolvedHost = ip

        var sequence: UInt16 = 0
        let timeout = self.timeout
        while !Task.isCancelled {
            sequence &+= 1
            let seq = sequence
            let rtt: Double? = await Task.detached(priority: .utility) {
                do {
                    let reply = try ICMPPing.ping(host: ip, sequence: seq, timeout: timeout)
                    return reply.roundTripMs
                } catch {
                    return nil
                }
            }.value

            if Task.isCancelled { break }
            samples.append(Sample(id: Int(seq), rttMs: rtt))
            if samples.count > 60 { samples.removeFirst(samples.count - 60) }

            try? await Task.sleep(nanoseconds: 900_000_000)
        }
        isRunning = false
    }

    private nonisolated static func resolve(host: String) async -> String? {
        // Already an IPv4 literal?
        if IPMath.toUInt32(host) != nil { return host }
        return await Task.detached(priority: .utility) {
            var hints = addrinfo(
                ai_flags: 0,
                ai_family: AF_INET,
                ai_socktype: SOCK_STREAM,
                ai_protocol: 0,
                ai_addrlen: 0,
                ai_canonname: nil,
                ai_addr: nil,
                ai_next: nil
            )
            var result: UnsafeMutablePointer<addrinfo>?
            guard getaddrinfo(host, nil, &hints, &result) == 0, let first = result else { return nil }
            defer { freeaddrinfo(result) }

            guard let addr = first.pointee.ai_addr else { return nil }
            var buffer = [CChar](repeating: 0, count: Int(INET_ADDRSTRLEN))
            let sin = addr.withMemoryRebound(to: sockaddr_in.self, capacity: 1) { $0.pointee }
            var sinAddr = sin.sin_addr
            inet_ntop(AF_INET, &sinAddr, &buffer, socklen_t(INET_ADDRSTRLEN))
            return String(cString: buffer)
        }.value
    }
}
