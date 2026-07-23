import SwiftUI

/// Summary card at the top of the Overview tab showing the current Wi-Fi
/// network details.
struct NetworkHeaderView: View {
    @EnvironmentObject private var scanner: NetworkScanner

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Image(systemName: "wifi")
                    .font(.title2)
                    .foregroundStyle(.white)
                Text("Local Network")
                    .font(.headline)
                    .foregroundStyle(.white)
                Spacer()
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text("\(scanner.deviceCount)")
                        .font(.title.bold())
                        .foregroundStyle(Color.kovyrGold)
                    Text("devices")
                        .font(.caption)
                        .foregroundStyle(.white.opacity(0.8))
                }
            }

            if let net = scanner.localNetwork {
                HStack(spacing: 20) {
                    metric("Your IP", net.ipAddress)
                    metric("Subnet", net.cidr)
                    metric("Gateway", net.gatewayGuess)
                }
                if let wifi = scanner.wifi {
                    Divider().overlay(Color.white.opacity(0.18))
                    wifiRow(wifi)
                }
                if let pub = scanner.publicNetwork {
                    Divider().overlay(Color.white.opacity(0.18))
                    publicRow(pub)
                }
            } else {
                Text("Tap Scan to read your network details.")
                    .font(.subheadline)
                    .foregroundStyle(.white.opacity(0.85))
            }
        }
        .padding(18)
        .background(
            LinearGradient(
                colors: [Color.kovyr, Color.kovyrAccent],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(Color.kovyrGold.opacity(0.35), lineWidth: 1)
        )
        .padding(.horizontal)
        .padding(.top, 8)
    }

    private func wifiRow(_ wifi: WiFiNetwork) -> some View {
        HStack(spacing: 6) {
            Image(systemName: "wifi")
                .font(.footnote)
                .foregroundStyle(Color.kovyrGold)
            Text("Wi-Fi")
                .font(.caption2)
                .foregroundStyle(.white.opacity(0.75))
            Text(wifi.ssid)
                .font(.footnote.weight(.semibold))
                .foregroundStyle(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            if let bssid = wifi.bssid {
                Text(bssid)
                    .font(.caption2.monospaced())
                    .foregroundStyle(.white.opacity(0.7))
                    .textSelection(.enabled)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
            Spacer(minLength: 0)
        }
    }

    private func publicRow(_ pub: PublicNetwork) -> some View {
        HStack(spacing: 6) {
            Image(systemName: "globe")
                .font(.footnote)
                .foregroundStyle(Color.kovyrGold)
            Text("Public IP")
                .font(.caption2)
                .foregroundStyle(.white.opacity(0.75))
            Text(pub.ipAddress)
                .font(.footnote.monospacedDigit().weight(.semibold))
                .foregroundStyle(.white)
                .textSelection(.enabled)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            if let country = pub.countryCode {
                Text(country)
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.white.opacity(0.85))
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(Color.white.opacity(0.15), in: Capsule())
            }
            Spacer(minLength: 0)
        }
    }

    private func metric(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(.caption2)
                .foregroundStyle(.white.opacity(0.75))
            Text(value)
                .font(.footnote.monospacedDigit().weight(.semibold))
                .foregroundStyle(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
    }
}
