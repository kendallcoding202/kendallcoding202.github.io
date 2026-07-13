import SwiftUI

@main
struct NetScanApp: App {
    @StateObject private var scanner = NetworkScanner()
    @Environment(\.scenePhase) private var scenePhase

    init() {
        NotificationManager.shared.configure()
        BackgroundScan.register()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(scanner)
                .tint(.blue)
                .task { NotificationManager.shared.requestAuthorization() }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .background { BackgroundScan.schedule() }
        }
    }
}

struct RootView: View {
    @EnvironmentObject private var scanner: NetworkScanner

    var body: some View {
        TabView {
            DeviceListView()
                .tabItem { Label("Overview", systemImage: "house.fill") }

            ToolsView()
                .tabItem { Label("Tools", systemImage: "wrench.and.screwdriver.fill") }

            HistoryView(store: scanner.store)
                .tabItem { Label("History", systemImage: "clock.arrow.circlepath") }

            SettingsView()
                .tabItem { Label("Settings", systemImage: "gearshape.fill") }
        }
    }
}
