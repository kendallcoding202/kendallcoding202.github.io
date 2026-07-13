import SwiftUI

/// The "History" tab: every device Kovyr Interior has ever seen (with first/last seen)
/// and a log of past scans.
struct HistoryView: View {
    @ObservedObject var store: DeviceStore
    @State private var showingClearConfirm = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    if store.scanRecords.isEmpty {
                        Text("No scans yet. Run a scan from the Overview tab.")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(store.scanRecords.prefix(10)) { record in
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(record.date, format: .dateTime.month().day().hour().minute())
                                        .font(.subheadline)
                                    Text("^[\(record.deviceCount) device](inflect: true)")
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer()
                                if record.newCount > 0 {
                                    Text("+\(record.newCount) new")
                                        .font(.caption.weight(.semibold))
                                        .padding(.horizontal, 8).padding(.vertical, 3)
                                        .background(Color.green.opacity(0.18), in: Capsule())
                                        .foregroundStyle(.green)
                                }
                            }
                        }
                    }
                } header: {
                    Text("Recent Scans")
                }

                Section {
                    if store.knownDevices.isEmpty {
                        Text("Devices you've seen will be remembered here.")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(store.knownDevices) { device in
                            VStack(alignment: .leading, spacing: 3) {
                                Text(device.displayName).font(.body.weight(.medium))
                                Text(device.lastIP).font(.caption.monospaced()).foregroundStyle(.secondary)
                                HStack(spacing: 12) {
                                    Label(device.firstSeen.formatted(.relative(presentation: .named)), systemImage: "calendar.badge.plus")
                                    Label(device.lastSeen.formatted(.relative(presentation: .named)), systemImage: "clock")
                                }
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                            }
                            .padding(.vertical, 2)
                        }
                    }
                } header: {
                    Text("^[\(store.knownDevices.count) known device](inflect: true)")
                }
            }
            .navigationTitle("History")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    if !store.knownDevices.isEmpty || !store.scanRecords.isEmpty {
                        Button("Clear", role: .destructive) { showingClearConfirm = true }
                    }
                }
            }
            .confirmationDialog("Clear all history?", isPresented: $showingClearConfirm, titleVisibility: .visible) {
                Button("Clear history", role: .destructive) { store.forgetAll() }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This forgets all known devices and scan history. New devices will be detected again from scratch.")
            }
        }
    }
}
