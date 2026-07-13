import Foundation

/// Best-effort traceroute using ICMP echo with an increasing IP TTL.
///
/// ⚠️ iOS limitation: sandboxed apps generally do **not** receive the ICMP
/// "time exceeded" messages that intermediate routers send, so hops before the
/// destination often show as `*` (no reply). The final destination — which
/// answers with an echo reply the socket *is* allowed to see — usually resolves.
/// This mirrors the constraint every non-jailbroken iOS network app faces.
@MainActor
final class TraceRoute: ObservableObject {
    struct Hop: Identifiable {
        let id: Int          // TTL / hop number
        let ttl: Int
        let address: String? // nil == no reply
        let rttMs: Double?
        let reachedDestination: Bool
    }

    @Published private(set) var hops: [Hop] = []
    @Published private(set) var isRunning = false
    @Published private(set) var target: String = ""
    @Published private(set) var errorText: String?

    private var task: Task<Void, Never>?
    private let maxHops = 20
    private let timeout: TimeInterval = 2.0

    func start(host: String) {
        guard !isRunning else { return }
        hops = []
        errorText = nil
        isRunning = true
        task = Task { await run(host: host) }
    }

    func stop() {
        task?.cancel()
        isRunning = false
    }

    private func run(host: String) async {
        let ip = await Self.resolve(host: host)
        guard let ip else {
            errorText = "Could not resolve \(host)"
            isRunning = false
            return
        }
        target = ip

        for ttl in 1...maxHops {
            if Task.isCancelled { break }
            let timeout = self.timeout
            let hopTTL = ttl
            let result: (address: String?, rtt: Double?, done: Bool) = await Task.detached(priority: .utility) {
                do {
                    let reply = try ICMPPing.ping(host: ip, sequence: UInt16(hopTTL), timeout: timeout, ttl: Int32(hopTTL))
                    // icmpType 0 == echo reply (destination reached),
                    // 11 == time exceeded (an intermediate hop responded).
                    let reachedDestination = reply.icmpType == 0 || reply.fromAddress == ip
                    return (reply.fromAddress, reply.roundTripMs, reachedDestination)
                } catch {
                    return (nil, nil, false)
                }
            }.value

            if Task.isCancelled { break }
            hops.append(Hop(
                id: ttl,
                ttl: ttl,
                address: result.address,
                rttMs: result.rtt,
                reachedDestination: result.done
            ))

            if result.done { break }
        }

        if !Task.isCancelled && hops.allSatisfy({ $0.address == nil }) {
            errorText = "No hops responded. iOS restricts the ICMP replies apps can see, so traceroute is limited on this platform."
        }
        isRunning = false
    }

    private nonisolated static func resolve(host: String) async -> String? {
        if IPMath.toUInt32(host) != nil { return host }
        return await Task.detached(priority: .utility) {
            var hints = addrinfo(
                ai_flags: 0, ai_family: AF_INET, ai_socktype: SOCK_STREAM,
                ai_protocol: 0, ai_addrlen: 0, ai_canonname: nil, ai_addr: nil, ai_next: nil
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
