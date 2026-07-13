import Foundation

/// A snapshot of the Wi-Fi network the device is currently attached to.
struct LocalNetwork: Equatable {
    let interfaceName: String
    let ipAddress: String
    let netmask: String
    let prefixLength: Int
    let gatewayGuess: String
    /// Every scannable host address in the subnet (network and broadcast excluded).
    let hostAddresses: [String]

    var cidr: String { "\(IPMath.toString(networkAddress))/\(prefixLength)" }

    var networkAddress: UInt32 {
        (IPMath.toUInt32(ipAddress) ?? 0) & (IPMath.toUInt32(netmask) ?? 0)
    }
}

enum LocalNetworkInfo {
    /// If a subnet is larger than this many hosts we restrict the sweep to the
    /// local /24 so a scan stays fast and bounded.
    private static let maxHosts = 1024

    /// Reads the active IPv4 interface (preferring Wi-Fi `en0`) and computes the
    /// list of host addresses to probe.
    static func current() -> LocalNetwork? {
        var ifaddrsPointer: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&ifaddrsPointer) == 0 else { return nil }
        defer { freeifaddrs(ifaddrsPointer) }

        var fallback: LocalNetwork?
        var pointer = ifaddrsPointer
        while let current = pointer {
            defer { pointer = current.pointee.ifa_next }

            let flags = Int32(current.pointee.ifa_flags)
            guard (flags & IFF_UP) == IFF_UP,
                  (flags & IFF_LOOPBACK) == 0,
                  let addr = current.pointee.ifa_addr,
                  addr.pointee.sa_family == UInt8(AF_INET),
                  let mask = current.pointee.ifa_netmask,
                  let ip = ipString(addr),
                  let maskString = ipString(mask)
            else { continue }

            let name = String(cString: current.pointee.ifa_name)
            guard let network = makeNetwork(interface: name, ip: ip, netmask: maskString) else { continue }

            // Wi-Fi is what we want; return as soon as we find it.
            if name == "en0" { return network }
            if fallback == nil { fallback = network }
        }
        return fallback
    }

    private static func makeNetwork(interface: String, ip: String, netmask: String) -> LocalNetwork? {
        guard let ipValue = IPMath.toUInt32(ip),
              let maskValue = IPMath.toUInt32(netmask),
              maskValue != 0
        else { return nil }

        let networkAddress = ipValue & maskValue
        let broadcast = networkAddress | ~maskValue
        guard broadcast > networkAddress + 1 else { return nil }

        var start = networkAddress + 1
        var end = broadcast - 1

        // Bound very large subnets to the local /24 around this device.
        if (end - start + 1) > UInt32(maxHosts) {
            let base = ipValue & 0xFFFF_FF00
            start = base + 1
            end = base + 254
        }

        var hosts: [String] = []
        hosts.reserveCapacity(Int(end - start + 1))
        var address = start
        while address <= end {
            hosts.append(IPMath.toString(address))
            address += 1
        }

        return LocalNetwork(
            interfaceName: interface,
            ipAddress: ip,
            netmask: netmask,
            prefixLength: IPMath.prefixLength(mask: maskValue),
            gatewayGuess: IPMath.toString(networkAddress + 1),
            hostAddresses: hosts
        )
    }

    private static func ipString(_ sockaddrPointer: UnsafeMutablePointer<sockaddr>) -> String? {
        var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
        let result = getnameinfo(
            sockaddrPointer,
            socklen_t(sockaddrPointer.pointee.sa_len),
            &host,
            socklen_t(host.count),
            nil,
            0,
            NI_NUMERICHOST
        )
        guard result == 0 else { return nil }
        return String(cString: host)
    }
}
