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
                        .foregroundStyle(.white)
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
            } else {
                Text("Tap Scan to read your network details.")
                    .font(.subheadline)
                    .foregroundStyle(.white.opacity(0.85))
            }
        }
        .padding(18)
        .background(
            LinearGradient(
                colors: [Color.blue, Color.indigo],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .padding(.horizontal)
        .padding(.top, 8)
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
