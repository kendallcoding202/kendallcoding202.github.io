import Foundation
import Darwin

/// A minimal ICMP echo (ping) implementation using a `SOCK_DGRAM` ICMP socket.
///
/// iOS allows unprivileged `SOCK_DGRAM` ICMP sockets (this is exactly how
/// Apple's own SimplePing sample works), so no special entitlement is needed
/// for echo/reply. The kernel manages the ICMP identifier and delivers matching
/// echo replies back to the socket.
enum ICMPPing {
    struct Reply {
        let sequence: UInt16
        let roundTripMs: Double
        let fromAddress: String
        /// Non-nil for traceroute: the ICMP type/code of a non-echo response.
        let icmpType: UInt8
    }

    enum PingError: Error { case socketFailed, sendFailed, timeout }

    /// Sends a single echo request and waits up to `timeout` for a reply.
    /// `ttl` lets the traceroute tool limit hop distance (0 = system default).
    static func ping(host: String, sequence: UInt16, timeout: TimeInterval, ttl: Int32 = 0) throws -> Reply {
        let fd = socket(AF_INET, SOCK_DGRAM, IPPROTO_ICMP)
        guard fd >= 0 else { throw PingError.socketFailed }
        defer { close(fd) }

        if ttl > 0 {
            var value = ttl
            setsockopt(fd, IPPROTO_IP, IP_TTL, &value, socklen_t(MemoryLayout<Int32>.size))
        }

        var destination = sockaddr_in()
        destination.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        destination.sin_family = sa_family_t(AF_INET)
        guard inet_pton(AF_INET, host, &destination.sin_addr) == 1 else { throw PingError.sendFailed }

        let identifier = UInt16(truncatingIfNeeded: fd)
        let packet = makeEchoPacket(identifier: identifier, sequence: sequence)

        let sentAt = DispatchTime.now()
        let sendResult = packet.withUnsafeBytes { raw -> Int in
            withUnsafePointer(to: &destination) { destPtr in
                destPtr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sa in
                    sendto(fd, raw.baseAddress, raw.count, 0, sa, socklen_t(MemoryLayout<sockaddr_in>.size))
                }
            }
        }
        guard sendResult > 0 else { throw PingError.sendFailed }

        // Wait for a reply using poll() so we don't block past the timeout.
        var pollFD = pollfd(fd: fd, events: Int16(POLLIN), revents: 0)
        let ready = poll(&pollFD, nfds_t(1), Int32(timeout * 1000))
        guard ready > 0 else { throw PingError.timeout }

        var buffer = [UInt8](repeating: 0, count: 1024)
        var sender = sockaddr_in()
        var senderLen = socklen_t(MemoryLayout<sockaddr_in>.size)
        let received = withUnsafeMutablePointer(to: &sender) { senderPtr -> Int in
            senderPtr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sa in
                recvfrom(fd, &buffer, buffer.count, 0, sa, &senderLen)
            }
        }
        guard received > 0 else { throw PingError.timeout }

        let elapsedMs = Double(DispatchTime.now().uptimeNanoseconds - sentAt.uptimeNanoseconds) / 1_000_000
        let fromAddress = addressString(from: sender)

        // On SOCK_DGRAM ICMP the datagram begins at the ICMP header.
        let icmpType = buffer[0]
        return Reply(sequence: sequence, roundTripMs: elapsedMs, fromAddress: fromAddress, icmpType: icmpType)
    }

    private static func makeEchoPacket(identifier: UInt16, sequence: UInt16, payloadSize: Int = 32) -> [UInt8] {
        var packet = [UInt8](repeating: 0, count: 8 + payloadSize)
        packet[0] = 8 // ICMP echo request
        packet[1] = 0 // code
        packet[2] = 0 // checksum (filled below)
        packet[3] = 0
        packet[4] = UInt8(identifier >> 8)
        packet[5] = UInt8(identifier & 0xFF)
        packet[6] = UInt8(sequence >> 8)
        packet[7] = UInt8(sequence & 0xFF)
        for i in 0..<payloadSize { packet[8 + i] = UInt8(i & 0xFF) }

        let checksum = checksum(packet)
        packet[2] = UInt8(checksum >> 8)
        packet[3] = UInt8(checksum & 0xFF)
        return packet
    }

    /// Standard Internet checksum (one's complement sum of 16-bit words).
    private static func checksum(_ data: [UInt8]) -> UInt16 {
        var sum: UInt32 = 0
        var index = 0
        while index + 1 < data.count {
            sum += (UInt32(data[index]) << 8) | UInt32(data[index + 1])
            index += 2
        }
        if index < data.count {
            sum += UInt32(data[index]) << 8
        }
        while (sum >> 16) != 0 {
            sum = (sum & 0xFFFF) + (sum >> 16)
        }
        return UInt16(~sum & 0xFFFF)
    }

    private static func addressString(from address: sockaddr_in) -> String {
        var copy = address
        var buffer = [CChar](repeating: 0, count: Int(INET_ADDRSTRLEN))
        inet_ntop(AF_INET, &copy.sin_addr, &buffer, socklen_t(INET_ADDRSTRLEN))
        return String(cString: buffer)
    }
}
