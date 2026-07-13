import WidgetKit
import SwiftUI

/// Kovyr palette, inlined because the widget is a separate module from the app.
private extension Color {
    static let kovyrDeep = Color(red: 9 / 255, green: 18 / 255, blue: 33 / 255)
    static let kovyrTop = Color(red: 36 / 255, green: 70 / 255, blue: 110 / 255)
    static let kovyrGold = Color(red: 214 / 255, green: 178 / 255, blue: 94 / 255)
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

    private var wordmark: some View {
        HStack(spacing: 4) {
            Image(systemName: "wifi").foregroundStyle(Color.kovyrGold)
            Text("Kovyr").foregroundStyle(Color.kovyrGold)
            Text("Interior").foregroundStyle(.white)
        }
        .font(.caption2.weight(.bold))
    }

    private var smallBody: some View {
        VStack(alignment: .leading, spacing: 6) {
            wordmark
            Spacer()
            Text("\(entry.deviceCount)")
                .font(.system(size: 44, weight: .bold, design: .rounded))
                .foregroundStyle(.white)
                .contentTransition(.numericText())
            Text("devices")
                .font(.caption)
                .foregroundStyle(.white.opacity(0.7))
            if entry.newCount > 0 {
                Text("+\(entry.newCount) new")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(Color.kovyrGold)
            }
            Spacer()
            lastScanText.font(.caption2).foregroundStyle(.white.opacity(0.6))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var mediumBody: some View {
        HStack(spacing: 18) {
            VStack(alignment: .leading, spacing: 4) {
                wordmark
                Text("\(entry.deviceCount)")
                    .font(.system(size: 52, weight: .bold, design: .rounded))
                    .foregroundStyle(.white)
                Text("devices on your network").font(.caption).foregroundStyle(.white.opacity(0.7))
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 10) {
                if entry.newCount > 0 {
                    Text("+\(entry.newCount) new")
                        .font(.subheadline.weight(.bold))
                        .padding(.horizontal, 10).padding(.vertical, 5)
                        .background(Color.kovyrGold.opacity(0.2), in: Capsule())
                        .foregroundStyle(Color.kovyrGold)
                } else {
                    Image(systemName: "checkmark.shield.fill").font(.title2).foregroundStyle(Color.kovyrGold)
                }
                lastScanText.font(.caption2).foregroundStyle(.white.opacity(0.6))
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
                .containerBackground(for: .widget) {
                    LinearGradient(
                        colors: [.kovyrTop, .kovyrDeep],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                }
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
