import Foundation

/// Well-known TCP ports and their service names, used both for fast host
/// discovery and for the detailed on-demand port scan.
enum PortCatalog {
    /// Small, high-signal set used to decide whether a host is alive quickly.
    static let discoveryPorts: [UInt16] = [
        80, 443, 22, 445, 139, 5000, 7000, 8080, 62078, 53, 548, 631, 3689, 32400, 8009
    ]

    /// Broader list used when the user asks for a detailed port scan of a host.
    static let commonPorts: [(port: UInt16, name: String)] = [
        (20, "FTP Data"), (21, "FTP"), (22, "SSH"), (23, "Telnet"), (25, "SMTP"),
        (53, "DNS"), (67, "DHCP"), (80, "HTTP"), (110, "POP3"), (111, "RPC"),
        (123, "NTP"), (135, "MS RPC"), (137, "NetBIOS"), (139, "NetBIOS"),
        (143, "IMAP"), (161, "SNMP"), (443, "HTTPS"), (445, "SMB"), (500, "IKE"),
        (515, "Printer (LPD)"), (548, "AFP"), (554, "RTSP"), (587, "SMTP"),
        (631, "IPP (Printer)"), (993, "IMAPS"), (995, "POP3S"), (1025, "RPC"),
        (1080, "SOCKS"), (1433, "MS SQL"), (1723, "PPTP"), (1883, "MQTT"),
        (1900, "SSDP/UPnP"), (2049, "NFS"), (3000, "Dev Server"), (3306, "MySQL"),
        (3389, "RDP"), (3689, "DAAP (iTunes)"), (5000, "UPnP/AirPlay"),
        (5001, "AirPlay"), (5060, "SIP"), (5353, "mDNS"), (5432, "PostgreSQL"),
        (5555, "ADB"), (5900, "VNC"), (6379, "Redis"), (7000, "AirPlay"),
        (8000, "HTTP Alt"), (8008, "HTTP/Chromecast"), (8009, "Chromecast"),
        (8080, "HTTP Proxy"), (8443, "HTTPS Alt"), (8883, "MQTT (TLS)"),
        (9000, "HTTP Alt"), (9100, "Printer (RAW)"), (32400, "Plex"),
        (49152, "UPnP"), (62078, "iPhone Sync")
    ]

    static func serviceName(for port: Int) -> String {
        commonPorts.first { Int($0.port) == port }?.name ?? "Unknown"
    }
}
