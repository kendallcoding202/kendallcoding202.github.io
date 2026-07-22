import Foundation
import Network
import Security

/// Grabs a service banner from an open TCP port by reading whatever the server
/// sends on connect (SSH/FTP/SMTP/etc.), or by sending a minimal HTTP request to
/// web ports to elicit a `Server:` line.
enum BannerGrabber {
    private static let webPorts: Set<UInt16> = [80, 81, 591, 3000, 5000, 8000, 8008, 8080, 8081, 8888, 9000, 9090]
    private static let queue = DispatchQueue(label: "kovyr.banner", attributes: .concurrent)

    static func grab(host: String, port: UInt16, timeout: TimeInterval = 2.5) async -> String? {
        await withCheckedContinuation { (cont: CheckedContinuation<String?, Never>) in
            guard let nwPort = NWEndpoint.Port(rawValue: port) else { cont.resume(returning: nil); return }
            let conn = NWConnection(host: NWEndpoint.Host(host), port: nwPort, using: .tcp)

            let lock = NSLock()
            var done = false
            func finish(_ value: String?) {
                lock.lock(); defer { lock.unlock() }
                guard !done else { return }
                done = true
                conn.stateUpdateHandler = nil
                conn.cancel()
                cont.resume(returning: value)
            }

            conn.stateUpdateHandler = { state in
                switch state {
                case .ready:
                    let read = {
                        conn.receive(minimumIncompleteLength: 1, maximumLength: 1024) { data, _, _, _ in
                            finish(data.flatMap(Self.clean))
                        }
                    }
                    if webPorts.contains(port),
                       let probe = "HEAD / HTTP/1.0\r\nHost: scan\r\nUser-Agent: Kovyr\r\n\r\n".data(using: .ascii) {
                        conn.send(content: probe, completion: .contentProcessed { _ in read() })
                    } else {
                        read()
                    }
                case .failed, .cancelled:
                    finish(nil)
                default:
                    break
                }
            }
            conn.start(queue: queue)
            queue.asyncAfter(deadline: .now() + timeout) { finish(nil) }
        }
    }

    private static func clean(_ data: Data) -> String? {
        guard !data.isEmpty else { return nil }
        let text = String(decoding: data.prefix(400), as: UTF8.self)
        // For HTTP responses, prefer the Server: header; else take the first non-empty line(s).
        if let server = text.split(separator: "\r\n").first(where: { $0.lowercased().hasPrefix("server:") }) {
            return String(server).trimmingCharacters(in: .whitespaces)
        }
        let firstLines = text
            .split(whereSeparator: { $0 == "\n" || $0 == "\r" })
            .prefix(2)
            .joined(separator: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let printable = firstLines.filter { !$0.isNewline }
        return printable.isEmpty ? nil : String(printable.prefix(160))
    }
}

/// Inspects the TLS certificate a host presents on a TLS port, returning the
/// leaf certificate's subject summary (e.g. a common name). Accepts self-signed
/// and expired certs so we can inspect whatever the device actually serves.
enum TLSInspector {
    static let tlsPorts: Set<UInt16> = [443, 465, 563, 636, 853, 993, 995, 5061, 8443, 8883, 9443]
    private static let queue = DispatchQueue(label: "kovyr.tls", attributes: .concurrent)

    static func inspect(host: String, port: UInt16, timeout: TimeInterval = 4) async -> String? {
        await withCheckedContinuation { (cont: CheckedContinuation<String?, Never>) in
            guard let nwPort = NWEndpoint.Port(rawValue: port) else { cont.resume(returning: nil); return }

            let params = NWParameters.tls
            var subject: String?
            if let tls = params.defaultProtocolStack.applicationProtocols.first as? NWProtocolTLS.Options {
                sec_protocol_options_set_verify_block(tls.securityProtocolOptions, { _, secTrust, complete in
                    let trust = sec_trust_copy_ref(secTrust).takeRetainedValue()
                    if let chain = SecTrustCopyCertificateChain(trust) as? [SecCertificate],
                       let leaf = chain.first {
                        subject = SecCertificateCopySubjectSummary(leaf) as String?
                    }
                    complete(true) // accept regardless — we only want to read the cert
                }, queue)
            }

            let conn = NWConnection(host: NWEndpoint.Host(host), port: nwPort, using: params)
            let lock = NSLock()
            var done = false
            func finish() {
                lock.lock(); defer { lock.unlock() }
                guard !done else { return }
                done = true
                conn.stateUpdateHandler = nil
                conn.cancel()
                cont.resume(returning: subject.map { "TLS cert: \($0)" })
            }

            conn.stateUpdateHandler = { state in
                switch state {
                case .ready, .failed, .cancelled: finish() // verify block runs before either
                default: break
                }
            }
            conn.start(queue: queue)
            queue.asyncAfter(deadline: .now() + timeout) { finish() }
        }
    }
}
