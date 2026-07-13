import Foundation
import Network

/// Outcome of a single TCP connection attempt to one host:port.
enum ProbeResult {
    case open        // handshake completed — port is listening
    case refused     // RST received — host is up but port is closed
    case unreachable // routing/other failure
    case timeout     // no answer within the deadline
}

/// Low-level TCP reachability probing built on `Network.framework`.
///
/// Host discovery on iOS cannot rely on ICMP or ARP (no raw sockets / MAC
/// access in the sandbox), so we detect live hosts by attempting short-lived
/// TCP connections. A completed handshake means a port is open; a connection
/// *refused* (RST) still proves the host exists. Only a timeout on every probed
/// port is treated as "host down".
enum HostProbe {
    static func probe(host: String, port: UInt16, timeout: TimeInterval) async -> ProbeResult {
        await withCheckedContinuation { continuation in
            guard let nwPort = NWEndpoint.Port(rawValue: port) else {
                continuation.resume(returning: .unreachable)
                return
            }

            let parameters = NWParameters.tcp
            // Fail fast instead of parking in `.waiting` when there is no route.
            if let tcp = parameters.defaultProtocolStack.internetProtocol as? NWProtocolIP.Options {
                tcp.version = .v4
            }

            let connection = NWConnection(
                host: NWEndpoint.Host(host),
                port: nwPort,
                using: parameters
            )

            let lock = NSLock()
            var didFinish = false
            func finish(_ result: ProbeResult) {
                lock.lock()
                defer { lock.unlock() }
                guard !didFinish else { return }
                didFinish = true
                connection.stateUpdateHandler = nil
                connection.cancel()
                continuation.resume(returning: result)
            }

            connection.stateUpdateHandler = { state in
                switch state {
                case .ready:
                    finish(.open)
                case .failed(let error):
                    if case .posix(let code) = error, code == .ECONNREFUSED {
                        finish(.refused)
                    } else {
                        finish(.unreachable)
                    }
                case .waiting(let error):
                    // `.waiting` means no immediate route; refused still surfaces here.
                    if case .posix(let code) = error, code == .ECONNREFUSED {
                        finish(.refused)
                    }
                default:
                    break
                }
            }

            connection.start(queue: Self.queue)
            Self.queue.asyncAfter(deadline: .now() + timeout) {
                finish(.timeout)
            }
        }
    }

    /// Probes several ports on a host concurrently. The host is considered alive
    /// if any probe is `open` or `refused`; open ports are returned sorted.
    static func discover(host: String, ports: [UInt16], timeout: TimeInterval) async -> (alive: Bool, openPorts: [UInt16]) {
        var alive = false
        var openPorts: [UInt16] = []

        await withTaskGroup(of: (UInt16, ProbeResult).self) { group in
            for port in ports {
                group.addTask { (port, await probe(host: host, port: port, timeout: timeout)) }
            }
            for await (port, result) in group {
                switch result {
                case .open:
                    alive = true
                    openPorts.append(port)
                case .refused:
                    alive = true
                default:
                    break
                }
            }
        }

        return (alive, openPorts.sorted())
    }

    private static let queue = DispatchQueue(label: "netscan.hostprobe", attributes: .concurrent)
}
