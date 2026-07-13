import WidgetKit
import SwiftUI

/// Kovyr navy, inlined here because the widget is a separate module from the app.
private extension Color {
    static let kovyr = Color(red: 30 / 255, green: 58 / 255, blue: 95 / 255)
}

/// Timeline entry holding the latest scan summary read from the shared App
/// Group container.
struct KovyrEntry: TimelineEntry {
    let date: Date
    let deviceCount: Int
    let newCount: Int
    let lastScan: Date?
}

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> KovyrEntry {
        KovyrEntry(date: Date(), deviceCount: 8, newCount: 1, lastScan: Date())
    }

    func getSnapshot(in context: Context, completion: @escaping (KovyrEntry) -> Void) {
        completion(currentEntry())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<KovyrEntry>) -> Void) {
        let entry = currentEntry()
        // Refresh roughly hourly; the app also nudges the widget after each scan.
        let next = Date(timeIntervalSinceNow: 60 * 60)
        completion(Timeline(entries: [entry], policy: .after(next)))
    }

    private func currentEntry() -> KovyrEntry {
        let summary = SharedState.load()
        return KovyrEntry(
            date: Date(),
            deviceCount: summary.deviceCount,
            newCount: summary.newCount,
            lastScan: summary.lastScan
        )
    }
}

struct KovyrWidgetEntryView: View {
    var entry: KovyrEntry
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
            Label("Kovyr", systemImage: "wifi")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(Color.kovyr)
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
                Label("Kovyr Interior", systemImage: "wifi").font(.caption.weight(.semibold)).foregroundStyle(Color.kovyr)
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

struct KovyrInteriorWidget: Widget {
    let kind = "KovyrInteriorWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: Provider()) { entry in
            KovyrWidgetEntryView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Kovyr Interior")
        .description("Devices found on your Wi-Fi network.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

@main
struct KovyrInteriorWidgetBundle: WidgetBundle {
    var body: some Widget {
        KovyrInteriorWidget()
    }
}
