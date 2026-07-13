import Foundation

/// Small helpers for converting IPv4 addresses to/from their 32-bit form and
/// enumerating the hosts in a subnet.
enum IPMath {
    static func toUInt32(_ ip: String) -> UInt32? {
        let parts = ip.split(separator: ".")
        guard parts.count == 4 else { return nil }
        var value: UInt32 = 0
        for part in parts {
            guard let octet = UInt32(part), octet <= 255 else { return nil }
            value = (value << 8) | octet
        }
        return value
    }

    static func toString(_ value: UInt32) -> String {
        "\((value >> 24) & 0xFF).\((value >> 16) & 0xFF).\((value >> 8) & 0xFF).\(value & 0xFF)"
    }

    /// Number of set bits in a subnet mask, i.e. the CIDR prefix length.
    static func prefixLength(mask: UInt32) -> Int {
        mask.nonzeroBitCount
    }
}
