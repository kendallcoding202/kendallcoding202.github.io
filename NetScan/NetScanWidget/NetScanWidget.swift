import WidgetKit
import SwiftUI

/// Timeline entry holding the latest scan summary read from the shared App
/// Group container.
struct NetScanEntry: TimelineEntry {
    let date: Date
    let deviceCount: Int
    let newCount: Int
    let lastScan: Date?
}

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> NetScanEntry {
        NetScanEntry(date: Date(), deviceCount: 8, newCount: 1, lastScan: Date())
    }

    func getSnapshot(in context: Context, completion: @escaping (NetScanEntry) -> Void) {
        completion(currentEntry())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<NetScanEntry>) -> Void) {
        let entry = currentEntry()
        // Refresh roughly hourly; the app also nudges the widget after each scan.
        let next = Date(timeIntervalSinceNow: 60 * 60)
        completion(Timeline(entries: [entry], policy: .after(next)))
    }

    private func currentEntry() -> NetScanEntry {
        let summary = SharedState.load()
        return NetScanEntry(
            date: Date(),
            deviceCount: summary.deviceCount,
            newCount: summary.newCount,
            lastScan: summary.lastScan
        )
    }
}

struct NetScanWidgetEntryView: View {
    var entry: NetScanEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        switch family {
        case .systemMedium:
            mediumBody
        default:
            smallBody
        }
    }

    private var smallBody: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label("NetScan", systemImage: "wifi")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.blue)
            Spacer()
            Text("\(entry.deviceCount)")
                .font(.system(size: 44, weight: .bold, design: .rounded))
                .contentTransition(.numericText())
            Text("devices")
                .font(.caption)
                .foregroundStyle(.secondary)
            if entry.newCount > 0 {
                Text("+\(entry.newCount) new")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.green)
            }
            Spacer()
            lastScanText.font(.caption2).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var mediumBody: some View {
        HStack(spacing: 18) {
            VStack(alignment: .leading, spacing: 4) {
                Label("NetScan", systemImage: "wifi").font(.caption.weight(.semibold)).foregroundStyle(.blue)
                Text("\(entry.deviceCount)")
                    .font(.system(size: 52, weight: .bold, design: .rounded))
                Text("devices on your network").font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 10) {
                if entry.newCount > 0 {
                    Text("+\(entry.newCount) new")
                        .font(.subheadline.weight(.bold))
                        .padding(.horizontal, 10).padding(.vertical, 5)
                        .background(Color.green.opacity(0.2), in: Capsule())
                        .foregroundStyle(.green)
                } else {
                    Image(systemName: "checkmark.shield.fill").font(.title2).foregroundStyle(.green)
                }
                lastScanText.font(.caption2).foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder private var lastScanText: some View {
        if let lastScan = entry.lastScan {
            Text("Scanned \(lastScan.formatted(.relative(presentation: .named)))")
        } else {
            Text("Open the app to scan")
        }
    }
}

struct NetScanWidget: Widget {
    let kind = "NetScanWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: Provider()) { entry in
            NetScanWidgetEntryView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Network Devices")
        .description("Devices found on your Wi-Fi network.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

@main
struct NetScanWidgetBundle: WidgetBundle {
    var body: some Widget {
        NetScanWidget()
    }
}
