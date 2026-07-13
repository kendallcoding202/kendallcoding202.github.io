import Foundation

/// Best-effort reverse DNS lookup (PTR record) for an IPv4 address.
///
/// This is a blocking BSD-sockets call, so callers should run it off the main
/// actor. Many home devices have no PTR record; a `nil` result is normal.
enum ReverseDNS {
    static func hostname(for ip: String) -> String? {
        var address = sockaddr_in()
        address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        address.sin_family = sa_family_t(AF_INET)
        guard inet_pton(AF_INET, ip, &address.sin_addr) == 1 else { return nil }

        var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
        let result = withUnsafePointer(to: &address) { pointer -> Int32 in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockaddrPointer in
                getnameinfo(
                    sockaddrPointer,
                    socklen_t(MemoryLayout<sockaddr_in>.size),
                    &host,
                    socklen_t(host.count),
                    nil,
                    0,
                    NI_NAMEREQD
                )
            }
        }

        guard result == 0 else { return nil }
        let name = String(cString: host)
        return name.isEmpty || name == ip ? nil : name
    }
}
