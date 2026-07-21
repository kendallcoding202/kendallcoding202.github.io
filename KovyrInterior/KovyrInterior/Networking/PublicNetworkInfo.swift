import Foundation

/// The device's internet-facing (public / WAN) IP, as seen from the internet —
/// distinct from the local Wi-Fi IP shown elsewhere.
struct PublicNetwork: Equatable {
    var ipAddress: String
    /// ISO country code of the connection (e.g. "US"), if reported.
    var countryCode: String?
}

/// Looks up the public IP by reading Cloudflare's `cdn-cgi/trace` endpoint.
///
/// Cloudflare is the **same provider** the speed test already contacts, so this
/// introduces no new third party — the response just reports back the caller's
/// own public IP and country. The endpoint returns simple `key=value` lines.
enum PublicNetworkInfo {
    private static let traceURL = URL(string: "https://www.cloudflare.com/cdn-cgi/trace")!

    /// Returns the public network details, or nil on any failure (offline, captive
    /// portal, timeout).
    static func fetch() async -> PublicNetwork? {
        var request = URLRequest(url: traceURL)
        request.timeoutInterval = 8
        request.cachePolicy = .reloadIgnoringLocalCacheData

        guard
            let (data, response) = try? await URLSession.shared.data(for: request),
            let http = response as? HTTPURLResponse, http.statusCode == 200,
            let text = String(data: data, encoding: .utf8)
        else { return nil }

        var fields: [String: String] = [:]
        for line in text.split(separator: "\n") {
            let parts = line.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
            if parts.count == 2 {
                fields[String(parts[0])] = String(parts[1])
            }
        }

        guard let ip = fields["ip"], !ip.isEmpty else { return nil }
        let country = fields["loc"].flatMap { $0.isEmpty ? nil : $0 }
        return PublicNetwork(ipAddress: ip, countryCode: country)
    }
}
