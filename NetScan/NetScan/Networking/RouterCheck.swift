import Foundation
import Network

/// Probes the gateway for automatic port-forwarding services (NAT-PMP), which
/// let any device on the LAN open ports to the internet — a common home-router
/// exposure. Full UPnP/SSDP discovery additionally requires Apple's multicast
/// entitlement, so we surface that as guidance rather than attempting it.
@MainActor
final class RouterCheck: ObservableObject {
    enum Status: Equatable {
        case idle
        case checking
        case finished
    }

    @Published private(set) var status: Status = .idle
    @Published private(set) var gateway: String = ""
    @Published private(set) var natpmpEnabled: Bool?
    @Published private(set) var publicIP: String?
    @Published private(set) var notes: [String] = []

    private let queue = DispatchQueue(label: "netscan.routercheck")

    func run() {
        guard status != .checking else { return }
        status = .checking
        natpmpEnabled = nil
        publicIP = nil
        notes = []

        guard let network = LocalNetworkInfo.current() else {
            notes = ["Not connected to Wi-Fi."]
            status = .finished
            return
        }
        gateway = network.gatewayGuess

        Task {
            let result = await Self.queryNATPMP(gateway: network.gatewayGuess)
            switch result {
            case .some(let ip):
                natpmpEnabled = true
                publicIP = ip
                notes = [
                    "NAT-PMP is enabled on your router. Any app or device on your network can automatically open ports to the internet without asking you.",
                    "If you don't rely on it (game consoles/some apps use it), consider disabling NAT-PMP/UPnP in your router settings.",
                    "Full UPnP inspection needs Apple's multicast entitlement, which App Store apps must request separately."
                ]
            case .none:
                natpmpEnabled = false
                notes = [
                    "Your router did not respond to NAT-PMP. Automatic port forwarding via NAT-PMP appears to be off — good.",
                    "Note: routers may still expose UPnP, which requires Apple's multicast entitlement to inspect from an app."
                ]
            }
            status = .finished
        }
    }

    /// Sends a NAT-PMP "external address" request (RFC 6886) and parses the
    /// public IPv4 from the response, or nil if the gateway doesn't answer.
    private nonisolated static func queryNATPMP(gateway: String) async -> String? {
        await withCheckedContinuation { continuation in
            guard let port = NWEndpoint.Port(rawValue: 5351) else {
                continuation.resume(returning: nil)
                return
            }
            let connection = NWConnection(
                host: NWEndpoint.Host(gateway),
                port: port,
                using: .udp
            )
            let lock = NSLock()
            var finished = false
            func finish(_ value: String?) {
                lock.lock(); defer { lock.unlock() }
                guard !finished else { return }
                finished = true
                connection.cancel()
                continuation.resume(returning: value)
            }

            connection.stateUpdateHandler = { state in
                switch state {
                case .ready:
                    // Version 0, opcode 0 = request external address.
                    let request = Data([0, 0])
                    connection.send(content: request, completion: .contentProcessed { _ in })
                    connection.receiveMessage { data, _, _, _ in
                        guard let data, data.count >= 12, data[0] == 0, data[1] == 128 else {
                            finish(nil)
                            return
                        }
                        let ip = "\(data[8]).\(data[9]).\(data[10]).\(data[11])"
                        finish(ip)
                    }
                case .failed:
                    finish(nil)
                default:
                    break
                }
            }
            connection.start(queue: DispatchQueue(label: "netscan.natpmp"))
            DispatchQueue.global().asyncAfter(deadline: .now() + 3) { finish(nil) }
        }
    }
}
