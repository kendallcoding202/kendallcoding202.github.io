import SwiftUI
import UIKit

@main
struct KovyrInteriorApp: App {
    @StateObject private var scanner = NetworkScanner()
    @Environment(\.scenePhase) private var scenePhase

    init() {
        NotificationManager.shared.configure()
        BackgroundScan.register()
        Self.applyKovyrAppearance()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(scanner)
                .tint(Color.kovyrGold)
                .preferredColorScheme(.dark)
                .task { NotificationManager.shared.requestAuthorization() }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .background { BackgroundScan.schedule() }
        }
    }

    /// Navy nav/tab bars with white titles, matching the app's theme.
    private static func applyKovyrAppearance() {
        let deep = UIColor(red: 9 / 255, green: 18 / 255, blue: 33 / 255, alpha: 1)

        let nav = UINavigationBarAppearance()
        nav.configureWithOpaqueBackground()
        nav.backgroundColor = deep
        nav.titleTextAttributes = [.foregroundColor: UIColor.white]
        nav.largeTitleTextAttributes = [.foregroundColor: UIColor.white]
        UINavigationBar.appearance().standardAppearance = nav
        UINavigationBar.appearance().scrollEdgeAppearance = nav
        UINavigationBar.appearance().compactAppearance = nav

        let tab = UITabBarAppearance()
        tab.configureWithOpaqueBackground()
        tab.backgroundColor = deep
        UITabBar.appearance().standardAppearance = tab
        UITabBar.appearance().scrollEdgeAppearance = tab
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
