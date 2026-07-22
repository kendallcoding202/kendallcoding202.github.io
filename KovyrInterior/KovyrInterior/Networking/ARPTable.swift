import Foundation
import Darwin

/// Reads the system ARP cache — a map of local IPv4 address → MAC address — via
/// the BSD routing `sysctl` (`NET_RT_FLAGS` with `RTF_LLINFO`).
///
/// This is a personal-build capability. It needs no special entitlement, but the
/// cache only holds hosts this device has recently talked to, so run a scan/ping
/// sweep first to populate it. Apple has tightened this over the years — callers
/// must tolerate an empty result.
enum ARPTable {
    /// Route flag selecting link-layer (ARP) entries. Defined locally because it
    /// is not reliably exported by the current SDK's route.h.
    private static let rtfLLInfo: Int32 = 0x400

    /// Snapshot of `"192.168.1.10" → "aa:bb:cc:dd:ee:ff"`. Empty on failure.
    static func snapshot() -> [String: String] {
        var mib: [Int32] = [CTL_NET, PF_ROUTE, 0, AF_INET, NET_RT_FLAGS, rtfLLInfo]
        var needed = 0
        guard sysctl(&mib, UInt32(mib.count), nil, &needed, nil, 0) == 0, needed > 0 else {
            return [:]
        }

        var buffer = [UInt8](repeating: 0, count: needed)
        let ok = buffer.withUnsafeMutableBytes { raw in
            sysctl(&mib, UInt32(mib.count), raw.baseAddress, &needed, nil, 0) == 0
        }
        guard ok else { return [:] }

        var map: [String: String] = [:]
        buffer.withUnsafeBytes { raw in
            guard let base = raw.baseAddress else { return }
            let headerStride = MemoryLayout<kovyr_rt_msghdr>.stride
            let sinStride = MemoryLayout<sockaddr_in>.stride
            // Offset of `sdl_data` within sockaddr_dl: 8 bytes of fixed fields
            // (len, family, index, type, nlen, alen, slen) precede the name/addr.
            let sdlDataFixed = 8

            var offset = 0
            while offset + headerStride <= needed {
                let rtm = base.advanced(by: offset).assumingMemoryBound(to: kovyr_rt_msghdr.self)
                let msgLen = Int(rtm.pointee.rtm_msglen)
                if msgLen <= 0 { break }

                // sockaddr_in (IPv4) follows the header; sockaddr_dl (link) follows that.
                let sinOffset = offset + headerStride
                let sdlOffset = sinOffset + sinStride
                guard sdlOffset + sdlDataFixed <= needed else { offset += msgLen; continue }

                let sin = base.advanced(by: sinOffset).assumingMemoryBound(to: sockaddr_in.self)
                let sdl = base.advanced(by: sdlOffset).assumingMemoryBound(to: sockaddr_dl.self)
                let nlen = Int(sdl.pointee.sdl_nlen)
                let alen = Int(sdl.pointee.sdl_alen)

                if alen == 6 {
                    let macStart = sdlOffset + sdlDataFixed + nlen
                    if macStart + alen <= needed {
                        var bytes = [UInt8](repeating: 0, count: alen)
                        for i in 0..<alen { bytes[i] = raw[macStart + i] }
                        if bytes.contains(where: { $0 != 0 }) {
                            var addr = sin.pointee.sin_addr
                            var ipBuf = [CChar](repeating: 0, count: Int(INET_ADDRSTRLEN))
                            inet_ntop(AF_INET, &addr, &ipBuf, socklen_t(INET_ADDRSTRLEN))
                            let ip = String(cString: ipBuf)
                            if !ip.isEmpty {
                                map[ip] = bytes.map { String(format: "%02x", $0) }.joined(separator: ":")
                            }
                        }
                    }
                }
                offset += msgLen
            }
        }
        return map
    }
}
