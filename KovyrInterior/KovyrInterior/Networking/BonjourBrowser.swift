import Foundation
import Network

/// Discovers devices that advertise Bonjour/mDNS services and resolves each to
/// an IPv4 address. This complements the TCP sweep: some devices expose no open
/// ports but still announce services (AirPlay speakers, Chromecast, printers).
final class BonjourBrowser {
    struct Discovery: Equatable {
        let ip: String
        let name: String
        let type: String
    }

    /// Called on the main queue whenever a new service is resolved to an IP.
    var onDiscover: ((Discovery) -> Void)?

    /// The Bonjour service types we browse for. Each must also be declared in
    /// `NSBonjourServices` in Info.plist or iOS will silently ignore it.
    private let serviceTypes = [
        "_http._tcp", "_https._tcp", "_ipp._tcp", "_ipps._tcp", "_printer._tcp",
        "_airplay._tcp", "_raop._tcp", "_airport._tcp", "_ssh._tcp", "_smb._tcp",
        "_afpovertcp._tcp", "_googlecast._tcp", "_spotify-connect._tcp",
        "_companion-link._tcp", "_homekit._tcp", "_hap._tcp", "_daap._tcp",
        "_rfb._tcp", "_sftp-ssh._tcp", "_device-info._tcp", "_scanner._tcp",
        "_pdl-datastream._tcp"
    ]

    private var browsers: [NWBrowser] = []
    private var connections: [ObjectIdentifier: NWConnection] = [:]
    private var seen: Set<String> = []
    private let queue = DispatchQueue(label: "netscan.bonjour")

    func start() {
        for type in serviceTypes {
            let parameters = NWParameters()
            parameters.includePeerToPeer = true
            let browser = NWBrowser(for: .bonjour(type: type, domain: nil), using: parameters)

            browser.browseResultsChangedHandler = { [weak self] results, _ in
                for result in results {
                    if case let .service(name, serviceType, _, _) = result.endpoint {
                        self?.resolve(endpoint: result.endpoint, name: name, type: serviceType)
                    }
                }
            }
            browser.start(queue: queue)
            browsers.append(browser)
        }
    }

    func stop() {
        browsers.forEach { $0.cancel() }
        browsers.removeAll()
        queue.async { [weak self] in
            self?.connections.values.forEach { $0.cancel() }
            self?.connections.removeAll()
        }
    }

    /// Resolving a Bonjour endpoint to an IP: open a connection and, once ready,
    /// read the resolved remote endpoint from the connection's current path.
    private func resolve(endpoint: NWEndpoint, name: String, type: String) {
        let connection = NWConnection(to: endpoint, using: .tcp)
        let key = ObjectIdentifier(connection)

        connection.stateUpdateHandler = { [weak self] state in
            guard let self else { return }
            switch state {
            case .ready:
                if let path = connection.currentPath,
                   let remote = path.remoteEndpoint,
                   case let .hostPort(host, _) = remote,
                   let ip = Self.ipv4String(from: host) {
                    self.emit(Discovery(ip: ip, name: name, type: type))
                }
                self.close(key)
            case .failed, .cancelled:
                self.close(key)
            default:
                break
            }
        }

        queue.async { [weak self] in
            self?.connections[key] = connection
            connection.start(queue: self?.queue ?? .global())
        }
    }

    private func close(_ key: ObjectIdentifier) {
        queue.async { [weak self] in
            self?.connections[key]?.cancel()
            self?.connections[key] = nil
        }
    }

    private func emit(_ discovery: Discovery) {
        let dedupeKey = discovery.ip + discovery.type
        queue.async { [weak self] in
            guard let self, !self.seen.contains(dedupeKey) else { return }
            self.seen.insert(dedupeKey)
            DispatchQueue.main.async { self.onDiscover?(discovery) }
        }
    }

    private static func ipv4String(from host: NWEndpoint.Host) -> String? {
        switch host {
        case .ipv4(let address):
            let bytes = address.rawValue
            guard bytes.count == 4 else { return nil }
            return "\(bytes[0]).\(bytes[1]).\(bytes[2]).\(bytes[3])"
        default:
            return nil
        }
    }
}
